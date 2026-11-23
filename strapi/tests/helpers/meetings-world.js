'use strict';

/**
 * Monde de test des phases 2 et 3 (lot 13) : éditions aux dates relatives à l'horloge du poste (les tests ne vieillissent pas),
 * programme de la recette, créneaux générés par le service réel, sujets, exposants, intervenants, rendez-vous écrits directement
 * par le Document Service (état de départ d'un scénario), sessions ouvertes par le parcours réel (demande, lien, vérification).
 * S'appuie sur helpers/espace.js et helpers/espace-data.js sans les modifier. Toutes les personnes sont fictives (@example.org).
 */

const { sleep } = require('./espace');
const { UID, createAttendee, createEdition, createProgram, link, recette } = require('./espace-data');

const DAY = 86_400_000;
const parisDay = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const inDays = (days, from = Date.now()) => new Date(from + days * DAY);

let counter = 0;
const unique = (prefix) => `${prefix}-${Date.now().toString(36)}-${(counter += 1)}`;

/** Fenêtres de prise de rendez-vous par état, par rapport à l'instant présent. */
function windowSettings(state, daysAhead) {
  const now = Date.now();
  if (state === 'closed') return { meetingRequestsOpenAt: inDays(-5, now), meetingRequestsCloseAt: new Date(now - 3_600_000) };
  if (state === 'not_open') return { meetingRequestsOpenAt: inDays(1, now), meetingRequestsCloseAt: inDays(Math.max(daysAhead - 1, 2), now) };
  return { meetingRequestsOpenAt: inDays(-2, now), meetingRequestsCloseAt: inDays(daysAhead >= 2 ? daysAhead - 1 : 1, now) };
}

/**
 * Édition publiée et ouverte dont le jour J est dans `daysAhead` jours (négatif : déjà passé), avec le programme de la recette
 * (ou `sequences`) et ses créneaux, générés par `services/slots.js`. `window` : `open`, `closed` (fermée depuis une heure) ou `not_open`.
 * @returns {{ edition, sequences, slots: Object<string, object>, slotList: object[] }} `slots` est indexé par libellé (« 10h45 »)
 */
async function createMeetingEdition(app, { slug, title, daysAhead = 20, tablesCount = 3, window = 'open', sequences, settings = {} } = {}) {
  const edition = await createEdition(app, {
    slug,
    title,
    settings: { date: parisDay(inDays(daysAhead)), tablesCount, ...windowSettings(window, daysAhead), ...settings },
  });
  const program = await createProgram(app, edition, sequences ? { sequences } : undefined);
  await app.service('api::espace.slots').regenerate(edition.documentId);
  const slotList = await app.documents(UID.slot).findMany({ filters: { edition: { documentId: edition.documentId } }, sort: 'startsAt:asc', limit: 200 });
  return { edition, sequences: program, slotList, slots: Object.fromEntries(slotList.map((slot) => [slot.label, slot])) };
}

const createTopic = (app, edition, name) => app.documents(UID.topic).create({ data: { name, edition: link(edition) } });

/** Exposant : organisation publiée puis Exhibitor. */
async function createExhibitor(app, edition, { name, standNumber = '4', topics = [], description = 'Entreprise fictive.', website = 'https://exposant.example.org' } = {}) {
  const organisation = await app.documents(UID.organisation).create({
    data: { name, slug: unique('l13-org'), description, website },
    status: 'published',
  });
  const exhibitor = await app.documents(UID.exhibitor).create({
    data: { edition: link(edition), organisation: link(organisation), standNumber, topics: topics.map(link) },
  });
  return { exhibitor, organisation };
}

/** Intervenant du programme (public) : organisation, intervenant publié et intervention dans la séquence `sessionTitle`. */
async function createSpeaker(app, edition, { name, title = 'Directeur de la recherche', organisationName = 'Institut du Bois Fictif', sequence } = {}) {
  const organisation = await app.documents(UID.organisation).create({ data: { name: organisationName, slug: unique('l13-org') }, status: 'published' });
  const intervenant = await app.documents(UID.intervenant).create({
    data: { name, title, slug: unique('l13-intervenant'), organisation: link(organisation) },
    status: 'published',
  });
  if (sequence) {
    await app.documents('api::intervention.intervention').create({
      data: { sequence: link(sequence), intervenants: [link(intervenant)], order: 0 },
      status: 'published',
    });
  }
  return intervenant;
}

/** Attendee consentant par défaut (annuaire et rendez-vous), personnalisable. */
const createPerson = (app, edition, fields = {}) =>
  createAttendee(app, edition, { consentAt: new Date().toISOString(), activatedAt: new Date().toISOString(), directoryOptIn: true, meetingsOptIn: true, ...fields });

/** Sessions par le parcours réel, mises en cache par Attendee : `login(edition, attendee)` -> cookie. */
function useLogin(espace) {
  const cache = new Map();
  return async (edition, attendee) => {
    if (!cache.has(attendee.documentId)) cache.set(attendee.documentId, (await espace().signIn(edition.slug, attendee.email)).cookie);
    return cache.get(attendee.documentId);
  };
}

/** Appels de l'API pour un cookie : `as(cookie).post('/meetings', { … })`. Chaque appel a sa propre IP. */
function useApi(espace) {
  return (cookie) => {
    const call = (method, path, json, options = {}) => espace().request(`/api/espace${path}`, { method, cookie, json, ...options });
    return {
      get: (path, options) => call('GET', path, undefined, options),
      post: (path, json = {}, options) => call('POST', path, json, options),
      patch: (path, json = {}, options) => call('PATCH', path, json, options),
      put: (path, json = {}, options) => call('PUT', path, json, options),
    };
  };
}

/**
 * Rendez-vous écrit directement (état de départ). `target` : Attendee ; `exhibitor` : Exhibitor ; un rendez-vous `accepted` à
 * table porte `tableNumber`, `tableKey` ({slotDocumentId}:{n}, A-27) et « Table n ».
 */
function seedMeeting(app, { edition, slot, requester, target, exhibitor, status = 'pending', tableNumber, message, answeredBy, location, cancelReason, createdAt }) {
  const stand = exhibitor && status === 'accepted' ? `Stand ${exhibitor.standNumber}` : undefined;
  return app.documents(UID.meeting).create({
    data: {
      edition: link(edition),
      slot: link(slot),
      requester: link(requester),
      ...(target && { targetAttendee: link(target) }),
      ...(exhibitor && { targetExhibitor: link(exhibitor) }),
      status,
      ...(message && { message }),
      ...(answeredBy && { answeredBy: link(answeredBy), answeredAt: new Date() }),
      ...(tableNumber && { tableNumber, tableKey: `${slot.documentId}:${tableNumber}`, location: `Table ${tableNumber}` }),
      ...((location ?? stand) && { location: location ?? stand }),
      ...(cancelReason && { cancelReason }),
      ...(createdAt && { createdAt }),
    },
  });
}

const readMeeting = (app, documentId) =>
  app.documents(UID.meeting).findOne({ documentId, populate: { slot: true, requester: true, targetAttendee: true, targetExhibitor: true, answeredBy: true } });

const meetingsAt = (app, edition, filters = {}) =>
  app.documents(UID.meeting).findMany({ filters: { edition: { documentId: edition.documentId }, ...filters }, populate: { slot: true, requester: true, targetAttendee: true, targetExhibitor: true }, limit: 1000 });

/** Journal d'e-mails (EmailLog) d'un Attendee pour un gabarit. */
const emailLogs = (app, attendee, template) =>
  app.db.query(UID.emailLog).findMany({ where: { attendee: { documentId: attendee.documentId }, ...(template && { template }) } });

/** Attend que `count` e-mails de ce gabarit aient été envoyés à l'Attendee (envoi détaché, A-19) et les rend. */
async function waitForEmailLogs(app, attendee, template, { count = 1, timeout = 6000 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const logs = await emailLogs(app, attendee, template);
    if (logs.length >= count) return logs;
    if (Date.now() > deadline) throw new Error(`${logs.length} e-mail(s) « ${template} » à ${attendee.email} après ${timeout} ms, ${count} attendu(s)`);
    await sleep(40);
  }
}

/** Laisse aux envois détachés le temps de partir, puis rend les e-mails de ce gabarit pour l'Attendee (assertion d'absence). */
async function settledEmailLogs(app, attendee, template, { settleMs = 600 } = {}) {
  await sleep(settleMs);
  return emailLogs(app, attendee, template);
}

/** Pièces jointes de la boîte de sortie pour un destinataire, e-mails écrits depuis le rang `since`. */
const outboxTo = (espace, email, since = 0) => espace().outbox().slice(since).filter((mail) => mail.to.email.toLowerCase() === email.toLowerCase());

/** Toute donnée personnelle interdite dans une réponse d'API (R-42, NF-11) : adresses, identifiants HelloAsso. */
const leaks = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return [/@example\.org/i, /"email"/i, /helloassoItemId/i, /helloassoOrderId/i, /"phone"|"telephone"/i].filter((pattern) => pattern.test(text)).map(String);
};

const CARD_KEYS = ['kind', 'id', 'displayName', 'subtitle', 'photoUrl', 'initials', 'tag', 'topics', 'standNumber', 'hostedTableNumber'];
const MEETING_KEYS = ['answeredByName', 'canAccept', 'canCancel', 'canCounter', 'canDecline', 'counterpart', 'createdAt', 'direction', 'id', 'location', 'message', 'slot', 'status', 'viaExhibitor'];

module.exports = {
  CARD_KEYS,
  DAY,
  MEETING_KEYS,
  createExhibitor,
  createMeetingEdition,
  createPerson,
  createSpeaker,
  createTopic,
  emailLogs,
  inDays,
  leaks,
  meetingsAt,
  outboxTo,
  parisDay,
  readMeeting,
  recette,
  seedMeeting,
  settledEmailLogs,
  unique,
  useApi,
  useLogin,
  waitForEmailLogs,
};
