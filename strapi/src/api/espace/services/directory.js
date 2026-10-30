'use strict';

const { EspaceError } = require('../lib/errors');
const { ATTENDEE_CARD_POPULATE, EXHIBITOR_CARD_POPULATE, attendeeCard, exhibitorCard, identity } = require('../lib/cards');
const { searchDirectory, profileVisibility } = require('../lib/directory');
const { hostedTables } = require('../lib/meetings');
const { suggest } = require('../lib/suggestions');
const { parseProgramTime } = require('../lib/time');

const ATTENDEE = 'api::espace.attendee';
const EXHIBITOR = 'api::espace.exhibitor';
const TOPIC = 'api::espace.topic';
const MEETING = 'api::espace.meeting';
const CONVERSATION = 'api::espace.conversation';
const INTERVENTION = 'api::intervention.intervention';
const DEFAULT_TABLES = 20;
const LIMIT = 1000;

const notFound = () => new EspaceError(404, 'PROFILE_NOT_FOUND', 'Ce profil est introuvable.');
const withoutSortName = ({ sortName, ...card }) => card;
const timeText = (text) => (parseProgramTime(text) ? text : null);

/** Day at Paris, "2026-12-03" (the seed of the daily shuffle of R-50). */
const parisDay = (now) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

module.exports = ({ strapi }) => {
  const documents = (uid) => strapi.documents(uid);
  const ofEdition = (edition) => ({ edition: { documentId: edition.documentId } });
  const organizerEmails = () => strapi.config.get('server.espace').organizerEmails.map((email) => email.trim().toLowerCase());
  const isOrganizer = (attendee) => attendee.role === 'organizer' || organizerEmails().includes(String(attendee.email).toLowerCase());

  /** A-29: Map(documentId -> table number) of the dedicated tables of an edition (rules of lib/meetings.js, shared with the meetings). */
  async function hostedOwners(edition) {
    const speakers = await documents(ATTENDEE).findMany({
      filters: { ...ofEdition(edition), role: 'speaker', status: 'active', hostedTableNumber: { $notNull: true } },
      fields: ['role', 'status', 'hostedTableNumber'],
      limit: LIMIT,
    });
    return hostedTables(speakers, edition.tablesCount ?? DEFAULT_TABLES).hosted;
  }

  /**
   * Everybody the viewer has a link with, from the meetings (any status) and the conversations of the edition:
   * `related` = documentIds of the people (R-41), `engaged` = ids of the people and exhibitors with a pending or accepted
   * meeting (R-50), `conversed` = the people with a conversation (R-61).
   */
  async function relations({ attendee, edition }) {
    const meId = attendee.documentId;
    const exhibitorId = attendee.exhibitor?.documentId;
    const [meetings, conversations] = await Promise.all([
      documents(MEETING).findMany({
        filters: {
          ...ofEdition(edition),
          $or: [{ requester: { documentId: meId } }, { targetAttendee: { documentId: meId } }, ...(exhibitorId ? [{ targetExhibitor: { documentId: exhibitorId } }] : [])],
        },
        fields: ['status'],
        populate: { requester: { fields: ['documentId'] }, targetAttendee: { fields: ['documentId'] }, targetExhibitor: { fields: ['documentId'] }, answeredBy: { fields: ['documentId'] } },
        limit: LIMIT,
      }),
      documents(CONVERSATION).findMany({
        filters: { ...ofEdition(edition), participants: { documentId: meId } },
        populate: { participants: { fields: ['documentId'] } },
        limit: LIMIT,
      }),
    ]);

    const related = new Set();
    const engaged = new Set(exhibitorId ? [exhibitorId] : []);
    for (const meeting of meetings) {
      const people = [meeting.requester, meeting.targetAttendee, meeting.answeredBy].filter(Boolean).map(({ documentId }) => documentId);
      for (const id of people) related.add(id);
      if (['pending', 'accepted'].includes(meeting.status)) {
        for (const id of [...people, meeting.targetExhibitor?.documentId]) if (id) engaged.add(id);
      }
    }
    const conversed = new Set(conversations.flatMap(({ participants }) => participants.map(({ documentId }) => documentId)));
    for (const id of conversed) related.add(id);
    related.delete(meId);
    conversed.delete(meId);
    return { related, engaged, conversed };
  }

  /**
   * The cards of everything the directory may list (F-40, A-26, A-29, A-34): the active attendees who ticked the
   * directory, the speakers with a dedicated table (public data only when they did not tick it), every exhibitor.
   * Organizers never. Each card carries `sortName` for the sort, removed before it leaves the API.
   */
  async function visibleCards(edition) {
    const listed = organizerEmails();
    const [attendees, exhibitors, hosted] = await Promise.all([
      documents(ATTENDEE).findMany({
        filters: {
          ...ofEdition(edition),
          status: 'active',
          role: { $ne: 'organizer' },
          ...(listed.length && { email: { $notIn: listed } }),
          $or: [{ directoryOptIn: true }, { role: 'speaker', hostedTableNumber: { $notNull: true } }],
        },
        populate: ATTENDEE_CARD_POPULATE,
        limit: LIMIT,
      }),
      documents(EXHIBITOR).findMany({ filters: ofEdition(edition), populate: EXHIBITOR_CARD_POPULATE, limit: LIMIT }),
      hostedOwners(edition),
    ]);

    const cards = [];
    for (const attendee of attendees) {
      const table = hosted.get(attendee.documentId);
      if (!attendee.directoryOptIn && table === undefined) continue;
      const card = attendeeCard({ ...attendee, hostedTableNumber: table ?? null }, { publicOnly: !attendee.directoryOptIn });
      cards.push({ ...card, sortName: `${attendee.lastName} ${attendee.firstName}` });
    }
    for (const exhibitor of exhibitors) if (exhibitor.organisation) cards.push(exhibitorCard(exhibitor));
    return cards;
  }

  /** Sequences in which an intervenant speaks, by time: [{ title, start, end }], times as the program writes them or null. */
  async function sessionsOf(speaker, edition) {
    const interventions = await documents(INTERVENTION).findMany({
      filters: { intervenants: { documentId: speaker.documentId }, sequence: ofEdition(edition) },
      status: 'published',
      populate: { sequence: { fields: ['title', 'start_time', 'end_time'] } },
      limit: LIMIT,
    });
    const minutes = (text) => {
      const time = parseProgramTime(text);
      return time ? time.hours * 60 + time.minutes : Infinity;
    };
    return interventions
      .map(({ sequence }) => sequence)
      .filter(Boolean)
      .sort((a, b) => minutes(a.start_time) - minutes(b.start_time))
      .map(({ title, start_time, end_time }) => ({ title, start: timeText(start_time), end: timeText(end_time) }));
  }

  return {
    hostedOwners,

    /** GET /directory (F-40 to F-43): the visible cards, filtered, sorted and cut. */
    async search({ edition }, { q, type, topicIds, cursor }) {
      return searchDirectory({ cards: await visibleCards(edition), q, type, topicIds, cursor });
    },

    /** GET /directory/p/:id (R-41, R-42, A-29): a person's page, 404 PROFILE_NOT_FOUND when the viewer may not see it. */
    async profile(session, id) {
      const { edition } = session;
      const attendee = await documents(ATTENDEE).findOne({ documentId: String(id), populate: { ...ATTENDEE_CARD_POPULATE, edition: { fields: ['documentId'] } } });
      if (!attendee || attendee.edition?.documentId !== edition.documentId) throw notFound();

      const viewer = await strapi.service('api::espace.me').loadAttendee(session);
      const [hosted, { related, conversed }] = await Promise.all([hostedOwners(edition), relations({ attendee: viewer, edition })]);
      const visibility = profileVisibility({ viewerId: viewer.documentId, attendee, isOrganizer: isOrganizer(attendee), related, hosted });
      if (!visibility) throw notFound();

      const isSelf = attendee.documentId === viewer.documentId;
      const full = visibility === 'full';
      const table = hosted.get(attendee.documentId);
      const card = attendeeCard({ ...attendee, hostedTableNumber: table ?? null }, { publicOnly: !full });
      const speaker = attendee.speaker;
      const program = !full && speaker;
      const { jobTitle, company } = identity(attendee);
      return {
        ...card,
        firstName: attendee.firstName,
        lastName: attendee.lastName,
        jobTitle: program ? (speaker.title ?? null) : jobTitle,
        company: program ? (speaker.organisation?.name ?? null) : company,
        bio: full ? (attendee.bio ?? null) : null,
        sessions: speaker ? await sessionsOf(speaker, edition) : [],
        exhibitor: full && attendee.exhibitor?.organisation ? { id: attendee.exhibitor.documentId, name: attendee.exhibitor.organisation.name, standNumber: attendee.exhibitor.standNumber ?? null } : null,
        isSelf,
        canMessage: !isSelf && attendee.status === 'active' && (Boolean(attendee.meetingsOptIn) || conversed.has(attendee.documentId)),
      };
    },

    /** GET /directory/x/:id: an exhibitor's page with the representatives who ticked the directory. */
    async exhibitor(session, id) {
      const { edition } = session;
      const exhibitor = await documents(EXHIBITOR).findOne({ documentId: String(id), populate: { ...EXHIBITOR_CARD_POPULATE, edition: { fields: ['documentId'] } } });
      if (!exhibitor?.organisation || exhibitor.edition?.documentId !== edition.documentId) throw notFound();

      const listed = organizerEmails();
      const representatives = await documents(ATTENDEE).findMany({
        filters: {
          exhibitor: { documentId: exhibitor.documentId },
          status: 'active',
          directoryOptIn: true,
          role: { $ne: 'organizer' },
          ...(listed.length && { email: { $notIn: listed } }),
        },
        populate: ATTENDEE_CARD_POPULATE,
        limit: LIMIT,
      });
      const viewer = await strapi.service('api::espace.me').loadAttendee(session);
      return {
        ...exhibitorCard(exhibitor),
        description: exhibitor.organisation.description ?? null,
        website: exhibitor.organisation.website ?? null,
        representatives: representatives.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'fr', { sensitivity: 'base' })).map((attendee) => attendeeCard(attendee)),
        isMine: viewer.exhibitor?.documentId === exhibitor.documentId,
      };
    },

    /** GET /suggestions (R-50, F-23): 0 to 3 cards. */
    async suggestions(session, { now = new Date() } = {}) {
      const { edition } = session;
      const viewer = await strapi.service('api::espace.me').loadAttendee(session);
      const [cards, { engaged }] = await Promise.all([visibleCards(edition), relations({ attendee: viewer, edition })]);
      return suggest({
        meId: viewer.documentId,
        myTopicIds: viewer.topics.map(({ documentId }) => documentId),
        candidates: cards,
        excludedIds: engaged,
        day: parisDay(now),
      }).map(withoutSortName);
    },

    /** GET /editions/:slug/topics (public): [{ id, name }] in French order ; an edition that is not open is not found (NF-52). */
    async topics(slug) {
      const edition = await strapi.service('api::espace.editions').findPublished(slug);
      if (!edition?.participantSpaceEnabled) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');
      const topics = await documents(TOPIC).findMany({ filters: ofEdition(edition), fields: ['name'], limit: LIMIT });
      return topics.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })).map(({ documentId, name }) => ({ id: documentId, name }));
    },
  };
};
