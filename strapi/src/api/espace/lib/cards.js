'use strict';

/**
 * Profile cards (CarteProfil, phase-2-plan.md section 3.2), shared by the directory, the suggestions, the meetings and the
 * messages. Pure: the Document Service results go in, the JSON of the API comes out. Whitelisted fields only, so that the
 * e-mail and the HelloAsso identifiers (R-42, NF-11) can never reach a response through a card. Every `id` is a documentId (A-28).
 *
 *   CarteProfil = { kind: 'attendee'|'exhibitor', id, displayName, subtitle, photoUrl, initials,
 *                   tag: 'participant'|'speaker'|'exhibitor_rep'|'exhibitor', topics: [{ id, name }],
 *                   standNumber?, hostedTableNumber? }
 */

const SUBTITLE_MAX = 100;

// What the Document Service must load for each kind of card (`populate` of findMany and findOne).
const ATTENDEE_CARD_POPULATE = {
  photo: true,
  topics: { fields: ['documentId', 'name'] },
  exhibitor: { fields: ['documentId', 'standNumber'], populate: { organisation: { fields: ['documentId', 'name'] } } },
  speaker: { fields: ['documentId', 'name', 'title'], populate: { photo: true, organisation: { fields: ['documentId', 'name'] } } },
};
const EXHIBITOR_CARD_POPULATE = {
  organisation: { fields: ['documentId', 'name', 'description', 'website'], populate: { logo: true } },
  topics: { fields: ['documentId', 'name'] },
};

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const joined = (separator, ...parts) => parts.map(clean).filter(Boolean).join(separator);

/** "Léa Ducasse" -> "LD": first letter of the first and of the last word ; one word gives one letter ; nothing gives "". */
function initials(name) {
  const letters = clean(name)
    .split(/\s+/)
    .map((word) => /[\p{L}\p{N}]/u.exec(word)?.[0])
    .filter(Boolean);
  const kept = letters.length > 1 ? [letters[0], letters[letters.length - 1]] : letters;
  return kept.join('').toLocaleUpperCase('fr');
}

/** Small version of an Upload file when Strapi made one, else the file itself ; the path as Upload returns it. */
const imageUrl = (file) => file?.formats?.thumbnail?.url ?? file?.url ?? null;

const topicsOf = (topics) => (Array.isArray(topics) ? topics.map(({ documentId, name }) => ({ id: documentId, name })) : []);

/** First line of a long text, cut at SUBTITLE_MAX characters. */
function shorten(text) {
  const line = clean(text).split(/\r?\n/)[0];
  return line.length > SUBTITLE_MAX ? `${line.slice(0, SUBTITLE_MAX - 1).trimEnd()}…` : line;
}

/**
 * Card of an Attendee loaded with ATTENDEE_CARD_POPULATE.
 * `publicOnly` (A-29, R-43): the public data of the program only, taken from the linked `intervenant` (name, function,
 * structure, photo), never the personal profile (own photo, topics). Without a linked intervenant, the identity imported
 * from HelloAsso stands in for it, without photo.
 */
function attendeeCard(attendee, { publicOnly = false } = {}) {
  const speaker = attendee.speaker ?? null;
  const program = publicOnly && speaker;
  const displayName = program ? clean(speaker.name) : joined(' ', attendee.firstName, attendee.lastName);
  const subtitle = program ? joined(', ', speaker.title, speaker.organisation?.name) : joined(', ', attendee.jobTitle, attendee.company);
  const photo = publicOnly ? speaker?.photo : (attendee.photo ?? speaker?.photo);
  const stand = clean(attendee.exhibitor?.standNumber);

  return {
    kind: 'attendee',
    id: attendee.documentId,
    displayName,
    subtitle,
    photoUrl: imageUrl(photo),
    initials: initials(displayName),
    tag: ['speaker', 'exhibitor_rep'].includes(attendee.role) ? attendee.role : 'participant',
    topics: publicOnly ? [] : topicsOf(attendee.topics),
    ...(stand && { standNumber: stand }),
    ...(attendee.role === 'speaker' && Number.isInteger(attendee.hostedTableNumber) && attendee.hostedTableNumber >= 1 && { hostedTableNumber: attendee.hostedTableNumber }),
  };
}

/** Card of an Exhibitor loaded with EXHIBITOR_CARD_POPULATE: name, logo and short description come from its organisation. */
function exhibitorCard(exhibitor) {
  const { organisation } = exhibitor;
  const displayName = clean(organisation?.name);
  const stand = clean(exhibitor.standNumber);

  return {
    kind: 'exhibitor',
    id: exhibitor.documentId,
    displayName,
    subtitle: shorten(organisation?.description),
    photoUrl: imageUrl(organisation?.logo),
    initials: initials(displayName),
    tag: 'exhibitor',
    topics: topicsOf(exhibitor.topics),
    ...(stand && { standNumber: stand }),
  };
}

module.exports = { ATTENDEE_CARD_POPULATE, EXHIBITOR_CARD_POPULATE, initials, attendeeCard, exhibitorCard };
