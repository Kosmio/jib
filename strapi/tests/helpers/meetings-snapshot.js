'use strict';

/**
 * Instantané de l'édition pour les règles pures des rendez-vous (`lib/meetings.js`, A-28, section 3.1 du plan des phases 2 et 3).
 * Les tests construisent un instantané avec les fonctions de ce fichier et ne touchent ni Strapi ni la base.
 *
 * Forme : { now, tablesCount, window: { state, openAt, closeAt }, slots: Map(id -> { id, startsAt, endsAt, sessionTitle }),
 *   meetings: [{ id, slotId, requesterId, targetAttendeeId, targetExhibitorId, status, tableNumber }],
 *   attendees: Map(id -> { id, status, role, meetingsOptIn, exhibitorId }),
 *   exhibitors: Map(id -> { id, standNumber, name, activeRepIds }), hosted: Map(attendeeId -> n) }
 * Tout identifiant est un documentId (ici des mots courts : « a », « b », « s1 »). Les dates sont des `Date`.
 *
 * Jour de l'édition : jeudi 3 décembre 2026 (CET, UTC+1). « Maintenant » : mercredi 25 novembre 2026, 11h00 à Paris.
 */

const NOW = new Date('2026-11-25T10:00:00.000Z');
const SLOT_START = {
  s1: '2026-12-03T09:45:00.000Z', // 10h45
  s2: '2026-12-03T10:00:00.000Z', // 11h00
  s3: '2026-12-03T11:30:00.000Z', // 12h30
  s4: '2026-12-03T11:45:00.000Z', // 12h45
  past: '2026-11-20T09:45:00.000Z', // déjà commencé
};
const SLOT_MS = 15 * 60_000;

const slotEntry = (id, startsAt = SLOT_START[id], sessionTitle = 'Pause et B2B') => {
  const start = new Date(startsAt);
  return [id, { id, startsAt: start, endsAt: new Date(start.getTime() + SLOT_MS), sessionTitle }];
};

const person = (id, fields = {}) => [id, { id, status: 'active', role: 'participant', meetingsOptIn: true, exhibitorId: null, ...fields }];

const exhibitorEntry = (id, fields = {}) => [id, { id, standNumber: '4', name: 'Sylvadour', activeRepIds: [], ...fields }];

/** Un rendez-vous de l'instantané ; sans cible précisée, la cible est la personne « b ». */
const meeting = (id, fields = {}) => {
  const exhibitorTarget = fields.targetExhibitorId != null;
  return {
    id,
    slotId: 's1',
    requesterId: 'a',
    targetAttendeeId: exhibitorTarget ? null : 'b',
    targetExhibitorId: null,
    status: 'pending',
    tableNumber: null,
    ...fields,
  };
};

const DEFAULT_PEOPLE = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

/**
 * @param {object} [options]
 * @param {Date} [options.now]
 * @param {number} [options.tablesCount] 3 par défaut, comme l'édition de recette
 * @param {'open'|'not_open'|'closed'|object} [options.window] état de la fenêtre (R-17) ou objet complet
 * @param {string[]} [options.slots] identifiants de créneaux parmi s1 à s4 et past (défaut : tous)
 * @param {Array<[string, object]>} [options.people] remplace les participants a à g ; `extraPeople` en ajoute
 * @param {Array<[string, object]>} [options.extraPeople]
 * @param {Array<[string, object]>} [options.exhibitors]
 * @param {object[]} [options.meetings]
 * @param {Object<string, number>} [options.hosted] attendeeId -> numéro de table dédiée (l'intervenant est ajouté, rôle speaker, sans meetingsOptIn)
 */
function snapshot({
  now = NOW,
  tablesCount = 3,
  window = 'open',
  slots = Object.keys(SLOT_START),
  people = DEFAULT_PEOPLE.map((id) => person(id)),
  extraPeople = [],
  exhibitors = [],
  meetings = [],
  hosted = {},
} = {}) {
  const windowObject =
    typeof window === 'string'
      ? { state: window, openAt: window === 'not_open' ? new Date(now.getTime() + 86_400_000) : new Date('2026-10-01T08:00:00.000Z'), closeAt: window === 'closed' ? new Date(now.getTime() - 3_600_000) : new Date('2026-12-02T17:00:00.000Z') }
      : window;
  const hostEntries = Object.keys(hosted).map((id) => person(id, { role: 'speaker', meetingsOptIn: false }));
  return {
    now,
    tablesCount,
    window: windowObject,
    slots: new Map(slots.map((id) => slotEntry(id))),
    meetings,
    attendees: new Map([...people, ...hostEntries, ...extraPeople]),
    exhibitors: new Map(exhibitors),
    hosted: new Map(Object.entries(hosted)),
  };
}

/** `{ ok: true }` -> « OK », `{ ok: false, code }` -> le code : une comparaison lisible dans les tableaux de cas. */
const verdict = (result) => (result.ok ? 'OK' : result.code);

module.exports = { NOW, SLOT_START, exhibitorEntry, meeting, person, slotEntry, snapshot, verdict };
