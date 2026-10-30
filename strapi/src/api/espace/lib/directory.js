'use strict';

const PAGE_SIZE = 30;
const MIN_QUERY_LENGTH = 2;

/** Lower case, diacritics removed, white space collapsed: "  Économie   Circulaire " -> "economie circulaire". */
function normalizeText(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// `participant` covers the participants and the representatives of an exhibitor ; `exhibitor` the exhibitor cards.
const TYPE_FILTERS = {
  participant: (card) => card.tag === 'participant' || card.tag === 'exhibitor_rep',
  speaker: (card) => card.tag === 'speaker',
  exhibitor: (card) => card.kind === 'exhibitor',
};

/** F-42: speakers first, then exhibitors, then everybody else. */
const rankOf = (card) => (card.tag === 'speaker' ? 0 : card.tag === 'exhibitor' ? 1 : 2);

/** Sort key: "last name first name" for a person, the structure name for an exhibitor. `sortName` wins when the service gives it. */
function sortKeyOf(card) {
  if (typeof card.sortName === 'string') return card.sortName;
  if (card.kind === 'exhibitor') return card.displayName;
  const words = card.displayName.split(/\s+/);
  return [words.pop(), ...words].join(' ');
}

const byName = (a, b) =>
  sortKeyOf(a).localeCompare(sortKeyOf(b), 'fr', { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * A-34, F-41 to F-43: filters, sorts and cuts the visible cards of an edition.
 * `q` is ignored under 2 characters ; every word of it must appear in the name, the function and company, or a topic name.
 * `type`: all, participant, speaker or exhibitor (anything else means all). `topicIds`: a card passes with any of them.
 * `cursor` is the rank of the first item, as text. -> { items, nextCursor, total }
 */
function searchDirectory({ cards, q, type = 'all', topicIds = [], cursor, pageSize = PAGE_SIZE }) {
  const words = normalizeText(q).length >= MIN_QUERY_LENGTH ? normalizeText(q).split(' ') : [];
  const wanted = new Set(topicIds);
  const typeFilter = TYPE_FILTERS[type];

  const found = cards
    .filter((card) => !typeFilter || typeFilter(card))
    .filter((card) => !wanted.size || card.topics.some(({ id }) => wanted.has(id)))
    .filter((card) => {
      if (!words.length) return true;
      const text = normalizeText([card.displayName, card.subtitle, ...card.topics.map(({ name }) => name)].join(' '));
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => rankOf(a) - rankOf(b) || byName(a, b));

  const parsed = Number.parseInt(cursor, 10);
  const start = Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  const end = start + pageSize;
  return {
    items: found.slice(start, end).map(({ sortName, ...card }) => card),
    nextCursor: end < found.length ? String(end) : null,
    total: found.length,
  };
}

/**
 * R-41, R-43, A-26, A-34: what a viewer may see of an attendee -> 'full' (personal profile), 'public' (the public data of
 * the program only, A-29) or null (404). `related`: the documentIds of the people the viewer has a meeting (any status) or
 * a conversation with ; `hosted`: the Map of the dedicated tables (hostedTables of lib/meetings.js). An organizer is never visible, except to himself.
 */
function profileVisibility({ viewerId, attendee, isOrganizer, related, hosted }) {
  if (attendee.documentId === viewerId) return 'full';
  if (isOrganizer) return null;
  if (attendee.status === 'active' && attendee.directoryOptIn) return 'full';
  if (hosted.has(attendee.documentId)) return 'public';
  return related.has(attendee.documentId) ? 'full' : null;
}

module.exports = { normalizeText, searchDirectory, profileVisibility };
