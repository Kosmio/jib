'use strict';

const { EspaceError } = require('../lib/errors');
const { buildCalendar } = require('../lib/ics');
const { renderEmail } = require('../lib/mail/render');
const { formatTimeLabel, parseProgramTime } = require('../lib/time');
const { linkUrl } = require('../lib/tokens');
const reminders = require('../lib/reminders');
const { isReadOnly } = require('../lib/read-only');

const EDITION = 'api::edition.edition';
const ATTENDEE = 'api::espace.attendee';
const MEETING = 'api::espace.meeting';
const EMAIL_LOG = 'api::espace.email-log';
const SEQUENCE = 'api::sequence.sequence';
const TEMPLATES = { profile: 'reminder-profile', 'no-meeting': 'reminder-no-meeting', eve: 'reminder-eve', welcome: 'welcome' };
const ACTION_LINK_MINUTES = 72 * 60;
const WELCOME_HOURS = 72;
const BATCH = 5;
const LIMIT = 10000;

const fullName = ({ firstName, lastName } = {}) => [firstName, lastName].filter(Boolean).join(' ');

module.exports = ({ strapi }) => {
  const documents = (uid) => strapi.documents(uid);
  const service = (name) => strapi.service(`api::espace.${name}`);
  const publicUrl = () => strapi.config.get('server.espace.publicUrl').replace(/\/+$/, '');
  const running = new Set();
  const inEdition = (edition) => ({ edition: { documentId: edition.documentId } });
  const mailEdition = (edition) => ({ slug: edition.slug, title: edition.title, themeColor: edition.hero_bg_color });
  const organizerEmails = () => strapi.config.get('server.espace').organizerEmails.map((email) => email.trim().toLowerCase());
  const secret = () => String(strapi.config.get('server.app.keys')[0]);

  /** I-39: public address of the one-click unsubscription. Strapi sits under /strapi behind the proxy ; on a local machine it answers on its own URL. */
  function unsubscribeUrl(attendee) {
    const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(publicUrl());
    const base = local ? String(strapi.config.get('server.url')).replace(/\/+$/, '') : `${publicUrl()}/strapi`;
    return `${base}/api/espace/reminders/unsubscribe?token=${reminders.signUnsubscribe(secret(), attendee.documentId)}`;
  }

  /** The attendees of an edition (organizers left out) and the meetings, as the pure rules read them. */
  async function load(edition) {
    const listed = organizerEmails();
    const [attendees, meetings, logs, pauses] = await Promise.all([
      documents(ATTENDEE).findMany({
        filters: { ...inEdition(edition), status: 'active', role: { $ne: 'organizer' }, ...(listed.length && { email: { $notIn: listed } }) },
        populate: { photo: true, topics: { fields: ['documentId'] } },
        limit: LIMIT,
      }),
      documents(MEETING).findMany({
        filters: { ...inEdition(edition), status: { $in: ['pending', 'accepted', 'expired'] } },
        populate: {
          slot: { fields: ['startsAt', 'endsAt'] },
          requester: { fields: ['documentId', 'firstName', 'lastName'] },
          targetAttendee: { fields: ['documentId', 'firstName', 'lastName'] },
          targetExhibitor: { fields: ['documentId'], populate: { organisation: { fields: ['name'] }, representatives: { fields: ['documentId'] } } },
        },
        limit: LIMIT,
      }),
      documents(EMAIL_LOG).findMany({
        filters: { attendee: inEdition(edition), template: { $in: Object.values(TEMPLATES) }, scenarioKey: { $notNull: true } },
        fields: ['scenarioKey', 'status'],
        populate: { attendee: { fields: ['documentId'] } },
        limit: LIMIT,
      }),
      documents(SEQUENCE).findMany({ filters: { ...inEdition(edition), kind: 'b2b_break' }, status: 'published', fields: ['start_time'], limit: 100 }),
    ]);

    const shaped = meetings
      .filter(({ slot, requester }) => slot && requester)
      .map((meeting) => ({
        id: meeting.documentId,
        status: meeting.status,
        startsAt: meeting.slot.startsAt,
        endsAt: meeting.slot.endsAt,
        location: meeting.location,
        requesterId: meeting.requester.documentId,
        requesterName: fullName(meeting.requester),
        targetAttendeeId: meeting.targetAttendee?.documentId,
        targetName: meeting.targetAttendee ? fullName(meeting.targetAttendee) : meeting.targetExhibitor?.organisation?.name ?? '',
        targetRepIds: (meeting.targetExhibitor?.representatives ?? []).map(({ documentId }) => documentId),
      }));

    const sentKeys = new Set();
    const failures = new Map();
    for (const { attendee, scenarioKey, status } of logs) {
      const id = `${attendee?.documentId}|${scenarioKey}`;
      if (status === 'sent') sentKeys.add(id);
      else failures.set(id, (failures.get(id) ?? 0) + 1);
    }

    const times = pauses.map(({ start_time: start }) => parseProgramTime(start)).filter(Boolean).sort((a, b) => a.hours * 60 + a.minutes - (b.hours * 60 + b.minutes));
    return {
      attendees: attendees.map((attendee) => reminders.attendeeFacts(attendee, shaped)),
      meetings: shaped,
      sentKeys,
      failures,
      pauses: [...new Set(times.map(({ hours, minutes }) => `${hours}h${String(minutes).padStart(2, '0')}`))],
    };
  }

  const actionLink = async (attendee, next, now) =>
    linkUrl({ publicUrl: publicUrl(), token: await service('tokens').issueLink(attendee.documentId, { ttlMinutes: ACTION_LINK_MINUTES, now }), next });

  /** The data and attachments of one e-mail. */
  async function compose(scenario, edition, attendee, context, now) {
    const base = `/espace/${edition.slug}`;
    const data = { firstName: attendee.firstName, manageUrl: await actionLink(attendee, `${base}/profil`, now) };
    const daysLeft = edition.date ? reminders.daysUntil(edition.date, now) : null;

    if (scenario === 'welcome') {
      const token = await service('tokens').issueLink(attendee.documentId, { ttlMinutes: WELCOME_HOURS * 60, now });
      return { ...data, url: linkUrl({ publicUrl: publicUrl(), token, next: `${base}/` }), validityHours: WELCOME_HOURS };
    }

    if (scenario === 'eve') {
      const { accepted, expired } = reminders.agendaOf(attendee.documentId, context.meetings);
      const venue = edition.lieux?.[0];
      const time = ({ startsAt }) => formatTimeLabel(new Date(startsAt));
      const agendaPath = `${base}/agenda`;
      const place = (location) => [location, venue?.name].filter(Boolean).join(', ');
      const calendar = accepted.length
        ? buildCalendar({
            name: edition.title,
            now,
            events: accepted.map((meeting) => ({
              uid: `meeting-${meeting.id}@jib`,
              start: meeting.startsAt,
              end: meeting.endsAt,
              summary: `RDV ${meeting.counterpartName} · JIB`,
              location: place(meeting.location),
              description: `Rendez-vous de l’espace participant : ${publicUrl()}${agendaPath}`,
              url: `${publicUrl()}${agendaPath}`,
            })),
          })
        : null;
      return {
        data: {
          ...data,
          dayLabel: edition.date ? reminders.dayLabel(edition.date) : '',
          meetings: accepted.map((meeting) => ({ time: time(meeting), counterpartName: meeting.counterpartName, location: meeting.location })),
          expired: expired.map((meeting) => ({ time: time(meeting), counterpartName: meeting.counterpartName })),
          venue: venue ? { name: venue.name, address: venue.address, mapUrl: venue.map_url, description: venue.description } : null,
          agendaUrl: await actionLink(attendee, agendaPath, now),
        },
        attachments: calendar ? [{ filename: 'rendez-vous.ics', content: calendar, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] : undefined,
      };
    }

    let suggestions = [];
    try {
      suggestions = await service('directory').suggestions({ attendee, edition }, { now });
    } catch (error) {
      strapi.log.warn(`[reminders] suggestions for attendee ${attendee.documentId}: ${String(error.message).split('\n')[0]}`);
    }
    Object.assign(data, { suggestions, daysLeft, city: edition.city, pauses: context.pauses });
    if (scenario === 'profile') {
      Object.assign(data, { completion: attendee.completion, missing: reminders.missingParts(attendee), profileUrl: await actionLink(attendee, `${base}/profil`, now) });
    } else {
      data.directoryUrl = await actionLink(attendee, `${base}/annuaire`, now);
    }
    return data;
  }

  /** Sends one reminder to each recipient, five at a time. A failure is counted, never thrown. -> { sent, failed } */
  async function deliver(scenario, edition, recipients, context, now) {
    const tally = { sent: 0, failed: 0 };
    for (let from = 0; from < recipients.length; from += BATCH) {
      await Promise.all(
        recipients.slice(from, from + BATCH).map(async ({ attendee, scenarioKey }) => {
          let status = 'failed';
          try {
            const composed = await compose(scenario, edition, attendee, context, now);
            const { data, attachments } = scenario === 'eve' ? composed : { data: composed };
            ({ status } = await service('mailer').send({
              attendee,
              template: TEMPLATES[scenario],
              scenarioKey,
              attachments,
              headers: reminders.unsubscribeHeaders(unsubscribeUrl(attendee)),
              now,
              data: { edition: mailEdition(edition), publicUrl: publicUrl(), ...data },
            }));
          } catch (error) {
            strapi.log.error(`[reminders] ${scenario} ${edition.slug}: attendee ${attendee.documentId} not sent: ${String(error.message).split('\n')[0]}`);
          }
          tally[status === 'sent' ? 'sent' : 'failed'] += 1;
        })
      );
    }
    return tally;
  }

  /** Fictional data for the preview. */
  function sampleData(scenario, edition) {
    const base = `${publicUrl()}/espace/${edition.slug}`;
    const daysLeft = edition.date ? Math.max(reminders.daysUntil(edition.date, new Date()), 0) : null;
    const people = [
      { displayName: 'Julien Roche', subtitle: 'Intervenant, Process, data et IA', initials: 'JR' },
      { displayName: 'Sofia Vidal, Lignum Data', subtitle: 'Exposante, stand 4', initials: 'SV' },
      { displayName: 'Thomas Lafitte, Panneaux du Médoc', subtitle: 'Participant', initials: 'TL' },
    ];
    const venue = edition.lieux?.[0];
    return {
      firstName: 'Camille',
      manageUrl: `${base}/profil`,
      suggestions: people,
      daysLeft,
      city: edition.city,
      pauses: ['10h45', '12h30', '15h30'],
      completion: 60,
      missing: ['votre photo', 'vos sujets d’intérêt'],
      profileUrl: `${base}/profil`,
      directoryUrl: `${base}/annuaire`,
      url: `${base}/`,
      validityHours: WELCOME_HOURS,
      dayLabel: edition.date ? reminders.dayLabel(edition.date) : '',
      meetings: [{ time: '10h45', counterpartName: 'Julien Roche', location: 'Table 3' }],
      expired: [{ time: '15h30', counterpartName: 'Sofia Vidal' }],
      venue: venue ? { name: venue.name, address: venue.address, mapUrl: venue.map_url, description: venue.description } : null,
      agendaUrl: `${base}/agenda`,
    };
  }

  const assertScenario = (scenario) => {
    if (!reminders.SCENARIOS.includes(scenario)) throw new EspaceError(400, 'VALIDATION', 'Scénario inconnu.', { fields: { scenario: 'profile, no-meeting, eve ou welcome' } });
  };

  const guarded = async (edition, work) => {
    if (running.has(edition.documentId)) throw new EspaceError(409, 'REMINDERS_RUNNING', 'Un envoi de relances est déjà en cours.');
    running.add(edition.documentId);
    try {
      return await work();
    } finally {
      running.delete(edition.documentId);
    }
  };

  return {
    /** F-92: recipients of a manual send now, the exclusions and the e-mail rendered for a sample first name. -> { recipients, skipped, sampleHtml } */
    async preview(edition, scenario, { now = new Date() } = {}) {
      assertScenario(scenario);
      const context = await load(edition);
      const { recipients, skipped } = reminders.planReminders({ scenario, edition, attendees: context.attendees, sentKeys: context.sentKeys, failures: context.failures, now, manual: true });
      const { html } = renderEmail(TEMPLATES[scenario], { edition: mailEdition(edition), publicUrl: publicUrl(), ...sampleData(scenario, edition) });
      return { recipients: recipients.length, skipped, sampleHtml: html };
    },

    /** F-92, R-71, R-72: the manual send, keyed by the date of the day. 409 OUTSIDE_SENDING_HOURS. -> { sent, skipped, failed } */
    async send(edition, scenario, { now = new Date() } = {}) {
      assertScenario(scenario);
      if (isReadOnly(edition, now)) throw new EspaceError(409, 'EDITION_READ_ONLY', 'L’édition est terminée : les relances ne partent plus.');
      if (!reminders.inSendingHours(now)) throw new EspaceError(409, 'OUTSIDE_SENDING_HOURS', 'Les relances partent entre 8h00 et 20h00, heure de Paris.');
      return guarded(edition, async () => {
        const context = await load(edition);
        const { recipients, skipped } = reminders.planReminders({ scenario, edition, attendees: context.attendees, sentKeys: context.sentKeys, failures: context.failures, now, manual: true });
        const tally = await deliver(scenario, edition, recipients, context, now);
        return { ...tally, skipped: skipped.alreadySent + skipped.optedOut };
      });
    },

    /**
     * R-87, cron every 15 minutes: what the calendar says is due and not yet logged, within the sending hours (R-72). A run that finds
     * nothing due does nothing ; a restart or a delay loses nothing and doubles nothing (R-71). -> { sent, failed }
     */
    async runDue({ now = new Date() } = {}) {
      const total = { sent: 0, failed: 0 };
      if (!reminders.inSendingHours(now)) return total;
      const editions = await documents(EDITION).findMany({ status: 'published', populate: ['lieux'], limit: 1000 });
      for (const edition of editions.filter((edition) => edition.participantSpaceEnabled && edition.date && !isReadOnly(edition, now))) {
        if (running.has(edition.documentId)) continue;
        try {
          await guarded(edition, async () => {
            const context = await load(edition);
            for (const scenario of reminders.SCENARIOS) {
              const { recipients } = reminders.planReminders({ scenario, edition, attendees: context.attendees, sentKeys: context.sentKeys, failures: context.failures, now });
              if (!recipients.length) continue;
              const tally = await deliver(scenario, edition, recipients, context, now);
              total.sent += tally.sent;
              total.failed += tally.failed;
            }
          });
        } catch (error) {
          strapi.log.error(`[reminders] ${edition.slug}: ${String(error.message).split('\n')[0]}`);
        }
      }
      return total;
    },

    /** I-39: the owner of a signed token, without any session. `apply: false` only reads (the GET page changes nothing). -> { attendee, edition } or null for a token that is not valid. */
    async unsubscribe(token, { apply = true } = {}) {
      const id = reminders.verifyUnsubscribe(secret(), token);
      const attendee = id && (await documents(ATTENDEE).findOne({ documentId: id, populate: { edition: { fields: ['slug', 'title'] } } }));
      if (!attendee) return null;
      if (apply && attendee.emailPrefs?.reminders !== false) {
        await documents(ATTENDEE).update({ documentId: id, data: { emailPrefs: { meetingRequests: true, messages: true, ...attendee.emailPrefs, reminders: false } } });
      }
      return { attendee, edition: attendee.edition };
    },
  };
};
