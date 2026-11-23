'use strict';

const { EspaceError } = require('../lib/errors');
const { profileVisibility } = require('../lib/directory');
const { hostedTables } = require('../lib/meetings');
const { formatTimeLabel, parseProgramTime, zonedToUtc } = require('../lib/time');

const SEQUENCE = 'api::sequence.sequence';
const ATTENDEE = 'api::espace.attendee';
const TOPIC = 'api::espace.topic';

const imageUrl = (file) => file?.formats?.thumbnail?.url ?? file?.url ?? null;
const minutesOf = ({ hours, minutes }) => hours * 60 + minutes;
const text = (value) => (typeof value === 'string' ? value.trim() : '');
// Calendar day of an instant in Paris, « 2026-12-03 » (F-150).
const parisDay = (instant) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);

module.exports = ({ strapi }) => {
  /**
   * documentId of the attendee account of each intervenant that the viewer may open (A-34), or nothing without a session:
   * Map(intervenant documentId -> attendee documentId). The program stays public ; only the link to a profile needs a visitor.
   */
  async function reachableAccounts(edition, viewer) {
    if (!viewer) return new Map();
    const speakers = await strapi.documents(ATTENDEE).findMany({
      filters: { edition: { documentId: edition.documentId }, role: 'speaker' },
      populate: { speaker: { fields: ['documentId'] } },
      sort: 'id:asc',
      limit: 1000,
    });
    const { hosted } = hostedTables(speakers, edition.tablesCount ?? 20);
    const related = await strapi.service('api::espace.conversations').relatedAttendeeIds(viewer.attendee.documentId);

    const accounts = new Map();
    for (const attendee of speakers) {
      const intervenantId = attendee.speaker?.documentId;
      const visibility = profileVisibility({ viewerId: viewer.attendee.documentId, attendee, isOrganizer: false, related, hosted });
      if (intervenantId && visibility && !accounts.has(intervenantId)) accounts.set(intervenantId, attendee.documentId);
    }
    return accounts;
  }

  return {
    /**
     * GET /editions/:slug/program (F-80, F-81, public) -> { flyer, notes, sessions, speakers, venues }.
     * Sessions are sorted on the parsed start time (`order` is empty in the data), a sequence without a readable start
     * time goes to `notes` by its title (« les horaires sont indiqués à titre provisoire »). Contents come from Strapi, nothing is copied.
     * F-150: `now` (injectable, like the other services) gives `now`, `liveDay` and, on the day of the edition in Paris, the `state` of
     * each session (`current` or `next`). F-151: for a viewer of this edition, each b2b_break session carries `meetings`, the accepted
     * ones that fall in it (never anything without a session).
     */
    async show(slug, { viewer = null, now = new Date() } = {}) {
      const edition = await strapi.service('api::espace.editions').findPublished(slug);
      // NF-52: an edition whose space is closed is not found, as for the topics.
      if (!edition?.participantSpaceEnabled) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');

      const sequences = await strapi.documents(SEQUENCE).findMany({
        filters: { edition: { documentId: edition.documentId } },
        status: 'published',
        populate: { interventions: { populate: { intervenants: { populate: { photo: true, organisation: { fields: ['documentId', 'name'] } } } } } },
        limit: 1000,
      });
      const topics = await strapi.documents(TOPIC).findMany({
        filters: { edition: { documentId: edition.documentId } },
        populate: { sessions: { fields: ['documentId'] } },
        limit: 200,
      });
      const accounts = await reachableAccounts(edition, viewer);

      const topicsOf = new Map();
      for (const { documentId, name, sessions } of topics) {
        for (const session of new Set((sessions ?? []).map((item) => item.documentId))) {
          topicsOf.set(session, [...(topicsOf.get(session) ?? []), { id: documentId, name }]);
        }
      }
      for (const list of topicsOf.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));

      const speakerOf = (intervenant) => ({
        name: intervenant.name,
        title: text(intervenant.title) || null,
        organisation: text(intervenant.organisation?.name) || null,
        photoUrl: imageUrl(intervenant.photo),
        attendeeId: accounts.get(intervenant.documentId) ?? null,
      });

      const notes = [];
      const explicitEnds = new Map();
      const sessions = [];
      for (const sequence of sequences) {
        const start = parseProgramTime(sequence.start_time);
        if (!start) {
          if (text(sequence.title)) notes.push({ order: sequence.order ?? 0, title: text(sequence.title) });
          continue;
        }
        const end = parseProgramTime(sequence.end_time);
        const interventions = [...(sequence.interventions ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id);
        const people = new Map();
        for (const { intervenants = [] } of interventions) for (const intervenant of intervenants) people.set(intervenant.documentId, intervenant);

        if (edition.date && end) explicitEnds.set(sequence.documentId, zonedToUtc(edition.date, end).getTime());
        sessions.push({
          key: [minutesOf(start), end ? minutesOf(end) : 0, sequence.order ?? 0, sequence.id],
          value: {
            id: sequence.documentId,
            title: sequence.title,
            description: text(sequence.description) || null,
            start: sequence.start_time,
            end: end ? sequence.end_time : null,
            startsAt: edition.date ? zonedToUtc(edition.date, start).toISOString() : null,
            until: null,
            state: null,
            kind: sequence.kind ?? 'talk',
            theme: sequence.theme ?? null,
            subtitle: text(sequence.subtitle) || null,
            topics: topicsOf.get(sequence.documentId) ?? [],
            speakers: [...people.values()].map(speakerOf),
          },
        });
      }
      sessions.sort((a, b) => a.key.reduce((diff, part, index) => diff || part - b.key[index], 0));

      // F-150: on the day of the edition (Paris time), the session under way and the one that follows.
      const liveDay = Boolean(edition.date) && parisDay(now) === String(edition.date).slice(0, 10);
      const ends = new Map();
      sessions.forEach(({ value }, index) => {
        const start = Date.parse(value.startsAt);
        const explicit = explicitEnds.get(value.id) > start ? explicitEnds.get(value.id) : null;
        const later = sessions.slice(index + 1).map((item) => Date.parse(item.value.startsAt)).find((time) => time > start);
        ends.set(value.id, explicit ?? later ?? start + 3600_000);
        value.until = value.startsAt ? new Date(ends.get(value.id)).toISOString() : null;
      });
      if (liveDay) {
        let upcoming = null;
        for (const { value } of sessions) {
          const start = Date.parse(value.startsAt);
          if (start <= now.getTime() && now.getTime() < ends.get(value.id)) value.state = 'current';
          else if (start > now.getTime() && (upcoming === null || start === upcoming)) {
            upcoming = start;
            value.state = 'next';
          }
        }
      }

      // F-151: the accepted meetings of the viewer, at their break.
      const mine = [];
      if (viewer?.edition?.documentId === edition.documentId) {
        const { agenda } = await strapi.service('api::espace.meetings').list(viewer, { now });
        for (const item of agenda) {
          if (item.type !== 'meeting' || item.meeting.status !== 'accepted') continue;
          mine.push({
            id: item.meeting.id,
            startsAt: item.meeting.slot.startsAt,
            endsAt: item.meeting.slot.endsAt,
            start: formatTimeLabel(new Date(item.meeting.slot.startsAt)),
            counterpart: item.meeting.counterpart.displayName,
            location: item.meeting.location,
          });
        }
      }
      for (const { value } of sessions) {
        if (value.kind !== 'b2b_break') continue;
        const from = Date.parse(value.startsAt);
        const to = ends.get(value.id);
        value.meetings = mine.filter(({ startsAt }) => Date.parse(startsAt) >= from && Date.parse(startsAt) < to);
      }

      // Speakers of the day, by name, with the titles of their sessions.
      const speakers = new Map();
      for (const { value } of sessions) {
        for (const speaker of value.speakers) {
          const known = speakers.get(speaker.name) ?? { ...speaker, sessions: [] };
          known.sessions.push(value.title);
          speakers.set(speaker.name, known);
        }
      }

      return {
        // Printed program of the edition: the image opens the PDF (public page and E8).
        now: now.toISOString(),
        liveDay,
        flyer: { imageUrl: text(edition.programmeImageUrl) || null, pdfUrl: text(edition.programmePdfUrl) || null },
        notes: notes.sort((a, b) => a.order - b.order).map(({ title }) => title),
        sessions: sessions.map(({ value }) => value),
        speakers: [...speakers.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })),
        venues: (edition.lieux ?? []).map((lieu) => ({
          name: lieu.name,
          address: lieu.address,
          mapUrl: text(lieu.map_url) || null,
          timeSlot: text(lieu.time_slot) || null,
        })),
      };
    },
  };
};
