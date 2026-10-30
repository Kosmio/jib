'use strict';

const { EspaceError } = require('../lib/errors');
const { profileVisibility } = require('../lib/directory');
const { hostedTables } = require('../lib/meetings');
const { parseProgramTime, zonedToUtc } = require('../lib/time');

const SEQUENCE = 'api::sequence.sequence';
const ATTENDEE = 'api::espace.attendee';
const TOPIC = 'api::espace.topic';

const imageUrl = (file) => file?.formats?.thumbnail?.url ?? file?.url ?? null;
const minutesOf = ({ hours, minutes }) => hours * 60 + minutes;
const text = (value) => (typeof value === 'string' ? value.trim() : '');

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
     * GET /editions/:slug/program (F-80, F-81, public) -> { notes, sessions, speakers, venues }.
     * Sessions are sorted on the parsed start time (`order` is empty in the data), a sequence without a readable start
     * time goes to `notes` by its title (« les horaires sont indiqués à titre provisoire »). Contents come from Strapi, nothing is copied.
     */
    async show(slug, { viewer = null } = {}) {
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

        sessions.push({
          key: [minutesOf(start), end ? minutesOf(end) : 0, sequence.order ?? 0, sequence.id],
          value: {
            id: sequence.documentId,
            title: sequence.title,
            description: text(sequence.description) || null,
            start: sequence.start_time,
            end: end ? sequence.end_time : null,
            startsAt: edition.date ? zonedToUtc(edition.date, start).toISOString() : null,
            kind: sequence.kind ?? 'talk',
            topics: topicsOf.get(sequence.documentId) ?? [],
            speakers: [...people.values()].map(speakerOf),
          },
        });
      }
      sessions.sort((a, b) => a.key.reduce((diff, part, index) => diff || part - b.key[index], 0));

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
