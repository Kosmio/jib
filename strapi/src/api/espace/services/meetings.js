'use strict';

const { EspaceError } = require('../lib/errors');
const { ATTENDEE_CARD_POPULATE, EXHIBITOR_CARD_POPULATE, attendeeCard, exhibitorCard } = require('../lib/cards');
const { buildCalendar } = require('../lib/ics');
const rules = require('../lib/meetings');
const { formatTimeLabel, parseProgramTime, zonedToUtc } = require('../lib/time');
const { linkUrl } = require('../lib/tokens');

const MEETING = 'api::espace.meeting';
const ATTENDEE = 'api::espace.attendee';
const EXHIBITOR = 'api::espace.exhibitor';
const SLOT = 'api::espace.slot';
const SEQUENCE = 'api::sequence.sequence';
const EDITION = 'api::edition.edition';
const ACTION_LINK_MINUTES = 72 * 60;
const MESSAGE_MAX = 300;
const REASON_MAX = 200;
const CLOSED_LIMIT = 20;
const DEFAULT_SESSION_MINUTES = 30;
const LOCK_ATTEMPTS = 3;
const CLOSED_BY_OTHER_MEETING = 'Créneau pris par un autre rendez-vous';
const ALREADY_BOOKED = 'Vous avez déjà un rendez-vous à cette table.';
const SLOT_NO_LONGER_AVAILABLE = 'Le créneau n’est plus disponible.';
const dayFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' });

// Relations of a Meeting as the rules need them: documentIds only (names of the person who answered, for the exhibitors).
const MEETING_POPULATE = {
  slot: { fields: ['documentId'] },
  requester: { fields: ['documentId'] },
  targetAttendee: { fields: ['documentId'] },
  targetExhibitor: { fields: ['documentId'] },
  answeredBy: { fields: ['documentId', 'firstName', 'lastName'] },
};

/** "jeudi 3 décembre à 10h45" */
const slotLabelOf = (startsAt) => `${dayFormat.format(new Date(startsAt))} à ${formatTimeLabel(new Date(startsAt))}`;

const fullName = ({ firstName, lastName }) => [firstName, lastName].filter(Boolean).join(' ');
const validation = (fields) => new EspaceError(400, 'VALIDATION', 'Corrigez les champs signalés.', { fields });
const asObject = (body) => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});
const isUniqueViolation = (error) => error?.code === '23505' || /espace_meetings_table_key_uq/.test(String(error?.message));
const wantsRequests = (attendee) => attendee.emailPrefs?.meetingRequests !== false;

/** Optional text of 1 to `max` characters (trimmed, empty -> null), or a message for `fields`. */
function optionalText(value, max) {
  if (value === undefined || value === null) return { text: null };
  if (typeof value !== 'string') return { error: 'Valeur non valable.' };
  const text = value.trim();
  return text.length > max ? { error: `${max} caractères au plus.` } : { text: text || null };
}

/**
 * The meetings of phase 2 (R-10 to R-19, A-27 to A-33). Every write runs under one lock per edition (A-27): it loads a snapshot of
 * the edition, asks the pure rules of lib/meetings.js, writes, and returns the e-mails, which leave AFTER the transaction.
 */
function operations(strapi) {
  const documents = (uid) => strapi.documents(uid);
  const settings = () => strapi.config.get('server.espace');
  const sessionOf = (session) => ({ me: session.attendee.documentId, editionId: session.edition.documentId });

  // --- loading ---

  /** The edition and all it takes to apply the rules and to build the views: one read, inside the lock for a write. */
  async function load(editionDocumentId, now) {
    const filters = { edition: { documentId: editionDocumentId } };
    const edition = await documents(EDITION).findOne({ documentId: editionDocumentId, status: 'published', populate: ['lieux'] });
    const slots = await documents(SLOT).findMany({
      filters,
      populate: { session: { fields: ['documentId', 'title', 'start_time', 'end_time'] } },
      sort: ['startsAt:asc'],
      limit: 1000,
    });
    const attendees = await documents(ATTENDEE).findMany({ filters, populate: ATTENDEE_CARD_POPULATE, limit: 5000 });
    const exhibitors = await documents(EXHIBITOR).findMany({ filters, populate: EXHIBITOR_CARD_POPULATE, limit: 1000 });
    const meetings = await documents(MEETING).findMany({ filters, populate: MEETING_POPULATE, sort: ['createdAt:asc'], limit: 10000 });

    return {
      edition,
      now,
      snap: rules.buildSnapshot({ edition, now, slots, attendees, exhibitors, meetings }),
      attendees: new Map(attendees.map((attendee) => [attendee.documentId, attendee])),
      exhibitors: new Map(exhibitors.map((exhibitor) => [exhibitor.documentId, exhibitor])),
      meetings,
    };
  }

  /**
   * Runs `work` under the lock of the edition (A-27) -> what `work` returns. The unique index on tableKey is the net under the lock
   * (R-13): a violation starts again on a fresh snapshot, 3 attempts at most, then `conflictCode`.
   */
  async function exclusive(editionDocumentId, conflictCode, work) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await strapi.service('api::espace.locks').withLock(`meetings:${editionDocumentId}`, work);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        if (attempt >= LOCK_ATTEMPTS) throw rules.meetingError(conflictCode);
      }
    }
  }

  const findMeeting = (ctx, meetingId) => {
    const meeting = typeof meetingId === 'string' ? ctx.meetings.find(({ documentId }) => documentId === meetingId) : null;
    if (!meeting) throw rules.meetingError('MEETING_NOT_FOUND');
    return meeting;
  };

  const attendeeCardOf = (ctx, attendeeId) => {
    const attendee = ctx.attendees.get(attendeeId);
    return attendeeCard(attendee, { publicOnly: ctx.snap.hosted.has(attendeeId) && !attendee.directoryOptIn });
  };
  const exhibitorCardOf = (ctx, exhibitorId) => exhibitorCard(ctx.exhibitors.get(exhibitorId));

  /** The people who receive what is addressed to the target of a meeting: the person, or the active representatives of the exhibitor. */
  const targetRecipients = (ctx, meeting) =>
    (meeting.targetAttendee
      ? [ctx.attendees.get(meeting.targetAttendee.documentId)]
      : [...ctx.attendees.values()].filter(({ exhibitor }) => exhibitor?.documentId === meeting.targetExhibitor.documentId)
    ).filter((attendee) => attendee?.status === 'active');

  /** Name of the target of a meeting as the requester sees it. */
  const targetName = (ctx, meeting) =>
    meeting.targetAttendee ? attendeeCardOf(ctx, meeting.targetAttendee.documentId).displayName : exhibitorCardOf(ctx, meeting.targetExhibitor.documentId).displayName;

  // --- views ---

  /** `Meeting` of the API for a viewer (phase-2-plan.md, section 3.2). Cards only: never an e-mail (R-42). */
  function meetingView(ctx, meeting, viewerId) {
    const actions = rules.meetingActions(ctx.snap, rules.snapshotMeeting(meeting), viewerId);
    const sent = actions.direction === 'sent';
    const exhibitor = !sent && meeting.targetExhibitor ? ctx.snap.exhibitors.get(meeting.targetExhibitor.documentId) : null;
    const slot = ctx.snap.slots.get(meeting.slot.documentId);

    return {
      id: meeting.documentId,
      status: meeting.status,
      slot: { id: slot.id, label: slot.label, startsAt: slot.startsAt, endsAt: slot.endsAt, sessionTitle: slot.sessionTitle },
      location: meeting.location ?? null,
      counterpart: sent
        ? meeting.targetAttendee
          ? attendeeCardOf(ctx, meeting.targetAttendee.documentId)
          : exhibitorCardOf(ctx, meeting.targetExhibitor.documentId)
        : attendeeCardOf(ctx, meeting.requester.documentId),
      direction: actions.direction,
      viaExhibitor: exhibitor ? { id: exhibitor.id, name: exhibitor.name, standNumber: exhibitor.standNumber } : null,
      message: meeting.message ?? null,
      answeredByName: meeting.targetExhibitor && meeting.answeredBy ? fullName(meeting.answeredBy) : null,
      createdAt: meeting.createdAt,
      canAccept: actions.canAccept,
      canDecline: actions.canDecline,
      canCounter: actions.canCounter,
      canCancel: actions.canCancel,
    };
  }

  /** Sequences of the edition with a readable start time (E6, I-40): { sequence, startsAt: Date, endsAt: Date | null }. */
  async function readableSequences(edition) {
    if (!edition.date) return [];
    const sequences = await documents(SEQUENCE).findMany({ filters: { edition: { documentId: edition.documentId } }, status: 'published', limit: 1000 });
    return sequences.flatMap((sequence) => {
      const start = parseProgramTime(sequence.start_time);
      const end = parseProgramTime(sequence.end_time);
      if (!start) return [];
      const startsAt = zonedToUtc(edition.date, start);
      const endsAt = end ? zonedToUtc(edition.date, end) : null;
      return [{ sequence, startsAt, endsAt: endsAt && endsAt > startsAt ? endsAt : null }];
    });
  }

  // --- e-mails (A-33) ---

  const agendaPath = (edition, query = '') => `/espace/${edition.slug}/agenda${query}`;
  const absoluteUrl = (path) => `${settings().publicUrl.replace(/\/+$/, '')}${path}`;

  /** The .ics of one meeting, attached to `meeting-accepted` (I-41). */
  function meetingEvent(edition, meeting, slot, counterpartName) {
    const venue = edition.lieux?.[0]?.name;
    return {
      uid: `meeting-${meeting.documentId}@jib`,
      start: slot.startsAt,
      end: slot.endsAt,
      summary: `RDV ${counterpartName} · JIB`,
      location: venue ? `${meeting.location}, ${venue}` : meeting.location,
      description: `Rendez-vous de l’espace participant : ${absoluteUrl(agendaPath(edition))}`,
      url: absoluteUrl(agendaPath(edition)),
    };
  }

  /** `meeting-accepted` for `to`, with the .ics of the meeting. */
  function acceptedMail(ctx, meeting, to, counterpartName, { booking = false } = {}) {
    const slot = ctx.snap.slots.get(meeting.slot.documentId);
    const calendar = buildCalendar({ name: ctx.edition.title, events: [meetingEvent(ctx.edition, meeting, slot, counterpartName)], now: ctx.now });
    return {
      to,
      template: 'meeting-accepted',
      scenarioKey: `meeting-accepted:${meeting.documentId}`,
      data: {
        counterpartName,
        slotLabel: slotLabelOf(slot.startsAt),
        location: meeting.location,
        venue: ctx.edition.lieux?.[0]?.name ?? null,
        booking,
      },
      links: { agendaUrl: agendaPath(ctx.edition) },
      attachments: [{ filename: 'rendez-vous.ics', content: calendar, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }],
    };
  }

  /** `meeting-declined` for the requester of `meeting`. */
  const declinedMail = (ctx, meeting, reason) => ({
    to: ctx.attendees.get(meeting.requester.documentId),
    template: 'meeting-declined',
    scenarioKey: `meeting-declined:${meeting.documentId}`,
    data: { counterpartName: targetName(ctx, meeting), slotLabel: slotLabelOf(ctx.snap.slots.get(meeting.slot.documentId).startsAt), reason },
    links: { directoryUrl: `/espace/${ctx.edition.slug}/annuaire` },
  });

  /** `meeting-request` for the target side (each active representative of an exhibitor), unless their preference says no (A-33). */
  function requestMails(ctx, meeting, { counter = null } = {}) {
    const requester = attendeeCardOf(ctx, meeting.requester.documentId);
    const slot = ctx.snap.slots.get(meeting.slot.documentId);
    const next = agendaPath(ctx.edition, `?demande=${meeting.documentId}`);
    return targetRecipients(ctx, meeting)
      .filter(wantsRequests)
      .map((to) => ({
        to,
        template: 'meeting-request',
        scenarioKey: `meeting-request:${meeting.documentId}`,
        data: {
          requesterName: requester.displayName,
          requesterSubtitle: requester.subtitle,
          slotLabel: slotLabelOf(slot.startsAt),
          sessionTitle: slot.sessionTitle,
          message: meeting.message ?? null,
          counter,
        },
        links: { acceptUrl: next, viewUrl: next },
      }));
  }

  /** `meeting-cancelled` for the other side of a meeting cancelled by `viewerId`. */
  function cancelledMails(ctx, meeting, viewerId, reason) {
    const requesterCancelled = meeting.requester.documentId === viewerId;
    const slotLabel = slotLabelOf(ctx.snap.slots.get(meeting.slot.documentId).startsAt);
    const counterpartName = requesterCancelled ? attendeeCardOf(ctx, viewerId).displayName : targetName(ctx, meeting);
    const recipients = requesterCancelled ? targetRecipients(ctx, meeting) : [ctx.attendees.get(meeting.requester.documentId)].filter((attendee) => attendee?.status === 'active');
    return recipients.map((to) => ({
      to,
      template: 'meeting-cancelled',
      scenarioKey: `meeting-cancelled:${meeting.documentId}`,
      data: { slotLabel, counterpartName, reason },
      links: { agendaUrl: agendaPath(ctx.edition) },
    }));
  }

  /**
   * Sends the e-mails after the transaction (A-27). Each link is a fresh 72 hour action link (I-21), one per button (A-33).
   * NF-52: nothing leaves when the space of the edition is closed. A failure is logged and never reaches the response.
   */
  async function deliver(edition, emails, now) {
    if (!edition.participantSpaceEnabled) return;
    for (const { to, template, scenarioKey, data, links = {}, attachments } of emails) {
      try {
        const urls = {};
        for (const [name, next] of Object.entries(links)) {
          const token = await strapi.service('api::espace.tokens').issueLink(to.documentId, { ttlMinutes: ACTION_LINK_MINUTES, now });
          urls[name] = linkUrl({ publicUrl: settings().publicUrl, token, next });
        }
        await strapi.service('api::espace.mailer').send({
          attendee: to,
          template,
          scenarioKey,
          attachments,
          now,
          data: {
            edition: { slug: edition.slug, title: edition.title, themeColor: edition.hero_bg_color },
            publicUrl: settings().publicUrl,
            firstName: to.firstName,
            ...data,
            ...urls,
          },
        });
      } catch (error) {
        strapi.log.error(`[meetings] ${template} for attendee ${to.documentId} not sent: ${String(error.message).split('\n')[0]}`);
      }
    }
  }

  // --- writes ---

  const update = (meeting, data) => documents(MEETING).update({ documentId: meeting.documentId, data, populate: MEETING_POPULATE });

  /** The accepted state of a meeting: lieu, table and the key that makes the table unique (R-13). */
  const acceptedData = ({ location, tableNumber }, slotId, now) => ({
    status: 'accepted',
    location,
    tableNumber,
    tableKey: tableNumber ? `${slotId}:${tableNumber}` : null,
    answeredAt: now,
  });

  /**
   * A-30: closes the requests that the acceptance of `meeting` (a snapshot meeting) makes impossible -> the e-mails (a `declined`
   * one tells its requester, a `cancelled` one tells nobody).
   */
  async function closeCompeting(ctx, accepted, now) {
    const { cancel, decline } = rules.closeOnAccept(ctx.snap, accepted);
    for (const id of cancel) await update(findMeeting(ctx, id), { status: 'cancelled', cancelledAt: now, cancelReason: CLOSED_BY_OTHER_MEETING, tableKey: null });
    const emails = [];
    for (const id of decline) {
      const meeting = findMeeting(ctx, id);
      await update(meeting, { status: 'declined', answeredAt: now, cancelReason: SLOT_NO_LONGER_AVAILABLE, tableKey: null });
      const to = ctx.attendees.get(meeting.requester.documentId);
      if (to?.status === 'active') emails.push(declinedMail(ctx, meeting, SLOT_NO_LONGER_AVAILABLE));
    }
    return emails;
  }

  /** Validated body of a creation or of a counter-proposal: { slotId, message }. */
  function requestBody(body, { withTarget }) {
    const given = asObject(body);
    const fields = {};
    const target = withTarget ? rules.parseTarget(given.target) : null;
    if (withTarget && !target) fields.target = 'Cible non valable.';
    if (typeof given.slotId !== 'string' || !given.slotId) fields.slotId = 'Choisissez un créneau.';
    const message = optionalText(given.message, MESSAGE_MAX);
    if (message.error) fields.message = message.error;
    if (Object.keys(fields).length) throw validation(fields);
    return { slotId: given.slotId, target, message: message.text };
  }

  const targetExists = (ctx, target) => (target.kind === 'x' ? ctx.exhibitors.has(target.id) : ctx.attendees.has(target.id));

  return {
    /**
     * GET /slots?target= (E5, F-50, R-12): the slots of the pauses still to come, grouped by pause, with their state for the viewer,
     * the mode (request, booking of a dedicated table, stand), the window and what blocks the viewer, if anything.
     */
    async slotsFor(session, targetText, { now = new Date() } = {}) {
      const { me, editionId } = sessionOf(session);
      const target = rules.parseTarget(targetText);
      if (!target) throw validation({ target: 'Cible non valable.' });
      const ctx = await load(editionId, now);
      if (!targetExists(ctx, target)) throw rules.meetingError('TARGET_NOT_FOUND');

      const { snap } = ctx;
      const mode = target.kind === 'x' ? 'stand' : snap.hosted.has(target.id) ? 'booking' : 'request';
      // One's own profile first (F-54), then the window (F-55), then what the rules of R-11 say.
      const code = rules.isOwnProfile(snap, me, target) ? 'SELF' : snap.window.state !== 'open' ? 'WINDOW_CLOSED' : rules.requestBlock(snap, me, target);
      const messages = {
        SELF: 'C’est votre profil.',
        WINDOW_CLOSED: snap.window.state === 'not_open' ? 'La prise de rendez-vous n’est pas encore ouverte.' : 'La prise de rendez-vous est terminée.',
      };
      const blocked = code ? { code, message: messages[code] ?? rules.meetingError(code).message } : null;

      const mine = ctx.meetings.find(
        (meeting) =>
          meeting.status === 'pending' &&
          meeting.requester.documentId === me &&
          (target.kind === 'x' ? meeting.targetExhibitor?.documentId === target.id : meeting.targetAttendee?.documentId === target.id)
      );
      const states = blocked ? new Map() : rules.slotStates(snap, { viewerId: me, target });
      const groups = new Map();
      for (const [slotId, state] of states) {
        const slot = snap.slots.get(slotId);
        const sessionKey = slot.sessionId ?? slot.sessionTitle;
        if (!groups.has(sessionKey)) {
          groups.set(sessionKey, { session: { id: slot.sessionId, title: slot.sessionTitle, start: slot.sessionStart, end: slot.sessionEnd }, slots: [] });
        }
        groups.get(sessionKey).slots.push({ id: slotId, label: slot.label, startsAt: slot.startsAt, state });
      }

      return {
        mode,
        window: { state: snap.window.state, openAt: snap.window.openAt, closeAt: snap.window.closeAt },
        blocked,
        pending: mine ? { meetingId: mine.documentId, slotLabel: snap.slots.get(mine.slot.documentId).label } : null,
        groups: [...groups.values()],
      };
    },

    /**
     * POST /meetings (F-52, R-11, R-19): a `pending` request, or an `accepted` booking of a dedicated table -> Meeting.
     * 400 VALIDATION, 404 SLOT_NOT_FOUND, TARGET_NOT_FOUND, 409 codes of checkRequest.
     */
    async create(session, body, { now = new Date() } = {}) {
      const { me, editionId } = sessionOf(session);
      const { slotId, target, message } = requestBody(body, { withTarget: true });

      const { view, emails, edition } = await exclusive(editionId, 'TARGET_BUSY', async () => {
        const ctx = await load(editionId, now);
        if (!ctx.snap.slots.has(slotId)) throw rules.meetingError('SLOT_NOT_FOUND');
        if (!targetExists(ctx, target)) throw rules.meetingError('TARGET_NOT_FOUND');
        const check = rules.checkRequest(ctx.snap, { requesterId: me, target, slotId });
        // R-19.2: a second booking of the same dedicated table is not a pending request.
        if (!check.ok && check.code === 'ALREADY_REQUESTED' && ctx.snap.hosted.has(target.id)) throw rules.meetingError(check.code, ALREADY_BOOKED);
        if (!check.ok) throw rules.meetingError(check.code);

        const booking = check.mode === 'booking';
        const meeting = await documents(MEETING).create({
          data: {
            edition: { documentId: editionId },
            slot: { documentId: slotId },
            requester: { documentId: me },
            ...(target.kind === 'x' ? { targetExhibitor: { documentId: target.id } } : { targetAttendee: { documentId: target.id } }),
            message,
            ...(booking ? acceptedData({ location: `Table ${check.tableNumber}`, tableNumber: check.tableNumber }, slotId, now) : { status: 'pending' }),
          },
          populate: MEETING_POPULATE,
        });

        const emails = [];
        if (booking) {
          // R-19, A-33: the booking is an acceptance, both people receive meeting-accepted ; the requests it makes impossible are closed (A-30).
          emails.push(acceptedMail(ctx, meeting, ctx.attendees.get(me), targetName(ctx, meeting), { booking }));
          emails.push(acceptedMail(ctx, meeting, ctx.attendees.get(target.id), attendeeCardOf(ctx, me).displayName, { booking }));
          emails.push(...(await closeCompeting(ctx, rules.snapshotMeeting(meeting), now)));
        } else {
          emails.push(...requestMails(ctx, meeting));
        }
        return { view: meetingView(ctx, meeting, me), emails, edition: ctx.edition };
      });

      await deliver(edition, emails, now);
      return view;
    },

    /**
     * GET /meetings (E6): the pending requests received and sent, the agenda (sessions with a readable time, accepted meetings and
     * pending requests sent, by time) and the 20 latest closed ones.
     */
    async list(session, { now = new Date() } = {}) {
      const { me, editionId } = sessionOf(session);
      const ctx = await load(editionId, now);
      const mine = ctx.meetings.filter((meeting) => meeting.requester.documentId === me || rules.isTargetSide(ctx.snap, rules.snapshotMeeting(meeting), me));
      const views = mine.map((meeting) => ({ meeting, view: meetingView(ctx, meeting, me) }));
      const byTime = (a, b) => new Date(a.slot.startsAt) - new Date(b.slot.startsAt);
      const open = (status, direction) => views.filter(({ view }) => view.status === status && view.direction === direction).map(({ view }) => view).sort(byTime);

      const sessions = (await readableSequences(ctx.edition)).map(({ sequence, startsAt, endsAt }) => ({
        type: 'session',
        id: sequence.documentId,
        title: sequence.title,
        start: sequence.start_time ?? null,
        end: sequence.end_time ?? null,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt ? endsAt.toISOString() : null,
        kind: sequence.kind ?? 'talk',
      }));
      const meetings = views
        .filter(({ view }) => view.status === 'accepted' || (view.status === 'pending' && view.direction === 'sent'))
        .map(({ view }) => ({ type: 'meeting', startsAt: view.slot.startsAt, meeting: view }));
      const closed = views
        .filter(({ view }) => ['declined', 'cancelled', 'expired'].includes(view.status))
        .sort((a, b) => new Date(b.meeting.updatedAt) - new Date(a.meeting.updatedAt))
        .slice(0, CLOSED_LIMIT)
        .map(({ view }) => view);

      return {
        received: open('pending', 'received'),
        sent: open('pending', 'sent'),
        agenda: [...sessions, ...meetings].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)),
        closed,
      };
    },

    /**
     * POST /meetings/:id/accept (F-60, R-13, R-14, R-15, A-30): the requester is told by `meeting-accepted` with the .ics.
     * 403 FORBIDDEN (T-24), 404 MEETING_NOT_FOUND, 409 codes of checkAccept.
     */
    async accept(session, meetingId, { now = new Date() } = {}) {
      const { me, editionId } = sessionOf(session);

      const { view, emails, edition } = await exclusive(editionId, 'NO_TABLE_LEFT', async () => {
        const ctx = await load(editionId, now);
        const found = findMeeting(ctx, meetingId);
        const check = rules.checkAccept(ctx.snap, found.documentId, me);
        if (!check.ok) throw rules.meetingError(check.code);

        const meeting = await update(found, { ...acceptedData(check, found.slot.documentId, now), answeredBy: { documentId: me } });
        const emails = [acceptedMail(ctx, meeting, ctx.attendees.get(meeting.requester.documentId), targetName(ctx, meeting))];
        emails.push(...(await closeCompeting(ctx, rules.snapshotMeeting(meeting), now)));
        return { view: meetingView(ctx, meeting, me), emails, edition: ctx.edition };
      });

      await deliver(edition, emails, now);
      return view;
    },

    /** POST /meetings/:id/decline (F-61): `meeting-declined` to the requester, with the reason if given. */
    async decline(session, meetingId, body, { now = new Date() } = {}) {
      const { me, editionId } = sessionOf(session);
      const reason = optionalText(asObject(body).reason, REASON_MAX);
      if (reason.error) throw validation({ reason: reason.error });

      const { view, emails, edition } = await exclusive(editionId, 'INVALID_TRANSITION', async () => {
        const ctx = await load(editionId, now);
        const found = findMeeting(ctx, meetingId);
        if (!rules.isTargetSide(ctx.snap, rules.snapshotMeeting(found), me)) throw rules.meetingError('FORBIDDEN');
        rules.assertTransition(found.status, 'decline');

        const meeting = await update(found, { status: 'declined', answeredBy: { documentId: me }, answeredAt: now, cancelReason: reason.text, tableKey: null });
        const to = ctx.attendees.get(meeting.requester.documentId);
        return { view: meetingView(ctx, meeting, me), emails: to?.status === 'active' ? [declinedMail(ctx, meeting, reason.text)] : [], edition: ctx.edition };
      });

      await deliver(edition, emails, now);
      return view;
    },

    /**
     * POST /meetings/:id/counter (F-62, A-31): the initial request is declined and a request in the other direction is created, in
     * one transaction ; a failure leaves the initial request pending. No counter-proposal toward an exhibitor nor a dedicated table.
     * -> the new Meeting. 403 FORBIDDEN, 404, 409 INVALID_TRANSITION, COUNTER_UNAVAILABLE and the codes of checkRequest.
     */
    async counter(session, meetingId, body, { now = new Date() } = {}) {
      const { me, editionId } = sessionOf(session);
      const { slotId, message } = requestBody(body, { withTarget: false });

      const { view, emails, edition } = await exclusive(editionId, 'TARGET_BUSY', async () => {
        const ctx = await load(editionId, now);
        const initial = findMeeting(ctx, meetingId);
        const ruleMeeting = rules.snapshotMeeting(initial);
        if (!rules.isTargetSide(ctx.snap, ruleMeeting, me)) throw rules.meetingError('FORBIDDEN');
        rules.assertTransition(initial.status, 'decline');
        if (initial.targetExhibitor || ctx.snap.hosted.has(me)) throw rules.meetingError('COUNTER_UNAVAILABLE');
        if (!ctx.snap.slots.has(slotId)) throw rules.meetingError('SLOT_NOT_FOUND');

        const requesterId = initial.requester.documentId;
        const check = rules.checkRequest(ctx.snap, { requesterId: me, target: { kind: 'p', id: requesterId }, slotId, ignoreMeetingId: initial.documentId });
        if (!check.ok) throw rules.meetingError(check.code);

        await update(initial, { status: 'declined', answeredBy: { documentId: me }, answeredAt: now, tableKey: null });
        const meeting = await documents(MEETING).create({
          data: {
            edition: { documentId: editionId },
            slot: { documentId: slotId },
            requester: { documentId: me },
            targetAttendee: { documentId: requesterId },
            message,
            status: 'pending',
          },
          populate: MEETING_POPULATE,
        });
        const counter = { previousSlotLabel: slotLabelOf(ctx.snap.slots.get(initial.slot.documentId).startsAt) };
        return { view: meetingView(ctx, meeting, me), emails: requestMails(ctx, meeting, { counter }), edition: ctx.edition };
      });

      await deliver(edition, emails, now);
      return view;
    },

    /**
     * POST /meetings/:id/cancel (F-63, R-16): the requester of a pending request, a party of an accepted meeting, until the slot starts.
     * The table is released and the other side receives `meeting-cancelled`. 403 FORBIDDEN, 404, 409 INVALID_TRANSITION, SLOT_PAST.
     */
    async cancel(session, meetingId, body, { now = new Date() } = {}) {
      const { me, editionId } = sessionOf(session);
      const reason = optionalText(asObject(body).reason, REASON_MAX);
      if (reason.error) throw validation({ reason: reason.error });

      const { view, emails, edition } = await exclusive(editionId, 'INVALID_TRANSITION', async () => {
        const ctx = await load(editionId, now);
        const found = findMeeting(ctx, meetingId);
        const ruleMeeting = rules.snapshotMeeting(found);
        const isRequester = ruleMeeting.requesterId === me;
        if (!isRequester && !rules.isTargetSide(ctx.snap, ruleMeeting, me)) throw rules.meetingError('FORBIDDEN');
        rules.assertTransition(found.status, 'cancel');
        if (found.status === 'pending' && !isRequester) throw rules.meetingError('INVALID_TRANSITION');
        if (new Date(ctx.snap.slots.get(ruleMeeting.slotId).startsAt) <= now) throw rules.meetingError('SLOT_PAST');

        const meeting = await update(found, { status: 'cancelled', cancelledAt: now, cancelReason: reason.text, tableKey: null });
        return { view: meetingView(ctx, meeting, me), emails: cancelledMails(ctx, meeting, me, reason.text), edition: ctx.edition };
      });

      await deliver(edition, emails, now);
      return view;
    },

    /**
     * R-17, A-32: the `pending` requests of every published edition whose window is closed become `expired`. Sends nothing (the
     * eve summary of R-70 c tells the parties). Called every 5 minutes by `espaceMeetingExpiry` -> the number of requests expired.
     */
    async expirePending({ now = new Date() } = {}) {
      const editions = await documents(EDITION).findMany({ status: 'published', limit: 1000 });
      let expired = 0;
      for (const edition of editions) {
        if (rules.requestWindow(edition, now).state !== 'closed') continue;
        expired += await exclusive(edition.documentId, 'INVALID_TRANSITION', async () => {
          const pending = await documents(MEETING).findMany({ filters: { edition: { documentId: edition.documentId }, status: 'pending' }, limit: 10000 });
          for (const meeting of pending) await update(meeting, { status: rules.assertTransition(meeting.status, 'expire'), tableKey: null });
          return pending.length;
        });
      }
      return expired;
    },

    /**
     * GET /meetings.ics (F-65, I-40): the accepted meetings of the viewer and the sequences with a readable time (30 minutes without end).
     * -> { filename, body }
     */
    async calendar(session, { now = new Date() } = {}) {
      const { me, editionId } = sessionOf(session);
      const ctx = await load(editionId, now);
      const { edition } = ctx;
      const venue = edition.lieux?.[0];

      const meetings = ctx.meetings
        .filter((meeting) => meeting.status === 'accepted' && (meeting.requester.documentId === me || rules.isTargetSide(ctx.snap, rules.snapshotMeeting(meeting), me)))
        .map((meeting) => {
          const sent = meeting.requester.documentId === me;
          const name = sent ? targetName(ctx, meeting) : attendeeCardOf(ctx, meeting.requester.documentId).displayName;
          return meetingEvent(edition, meeting, ctx.snap.slots.get(meeting.slot.documentId), name);
        });
      const sessions = (await readableSequences(edition)).map(({ sequence, startsAt, endsAt }) => ({
        uid: `session-${sequence.documentId}@jib`,
        start: startsAt,
        end: endsAt ?? new Date(startsAt.getTime() + DEFAULT_SESSION_MINUTES * 60 * 1000),
        summary: sequence.title,
        location: [venue?.name, venue?.address].filter(Boolean).join(', '),
      }));

      return {
        filename: `jib-${edition.slug}.ics`,
        body: buildCalendar({ name: `Journées de l’Innovation Filière Bois, ${edition.title}`, events: [...sessions, ...meetings], now }),
      };
    },
  };
}

module.exports = ({ strapi }) => ({
  ...operations(strapi),

  /**
   * R-18, T-06: the pending and accepted meetings an attendee asked for or received personally become `cancelled` (table released:
   * `tableKey` back to null), and the other party is told by `meeting-cancelled` : the requester, the personal target, or the
   * active representatives of the targeted exhibitor. Meetings aimed at the exhibitor the attendee represents stay (R-14).
   * NF-52: when the space of the edition is closed, the meetings are cancelled all the same, but no link is issued and nothing is sent.
   * Idempotent: a cancelled meeting is not found again. Phase 2 completes this service.
   */
  async cancelForAttendee(attendee, { reason = 'Inscription annulée', now = new Date() } = {}) {
    const self = { documentId: attendee.documentId };
    const meetings = await strapi.documents(MEETING).findMany({
      filters: { status: { $in: ['pending', 'accepted'] }, $or: [{ requester: self }, { targetAttendee: self }] },
      populate: {
        edition: { fields: ['documentId'] },
        slot: true,
        requester: true,
        targetAttendee: true,
        targetExhibitor: { populate: { representatives: true } },
      },
      limit: 1000,
    });
    if (!meetings.length) return;

    const publicUrl = strapi.config.get('server.espace.publicUrl');
    const edition = await strapi.documents('api::edition.edition').findOne({ documentId: meetings[0].edition.documentId, status: 'published' });
    const counterpartName = `${attendee.firstName} ${attendee.lastName}`;

    for (const meeting of meetings) {
      await strapi.documents(MEETING).update({
        documentId: meeting.documentId,
        data: { status: 'cancelled', cancelledAt: now, cancelReason: reason, tableKey: null },
      });
      if (!edition?.participantSpaceEnabled) continue;

      const isRequester = meeting.requester.documentId === attendee.documentId;
      const others = isRequester ? (meeting.targetAttendee ? [meeting.targetAttendee] : meeting.targetExhibitor?.representatives ?? []) : [meeting.requester];
      for (const recipient of others.filter(({ status }) => status === 'active')) {
        const token = await strapi.service('api::espace.tokens').issueLink(recipient.documentId, { ttlMinutes: ACTION_LINK_MINUTES, now });
        await strapi.service('api::espace.mailer').send({
          attendee: recipient,
          template: 'meeting-cancelled',
          scenarioKey: `meeting-cancelled:${meeting.documentId}`,
          now,
          data: {
            edition: { slug: edition.slug, title: edition.title, themeColor: edition.hero_bg_color },
            publicUrl,
            firstName: recipient.firstName,
            slotLabel: slotLabelOf(meeting.slot.startsAt),
            counterpartName,
            agendaUrl: linkUrl({ publicUrl, token, next: `/espace/${edition.slug}/agenda` }),
          },
        });
      }
    }
  },
});
