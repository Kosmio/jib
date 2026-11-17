'use strict';

const { normalizeText } = require('../directory');

/** Roles of an attendee that a badge or a card can show (type of the band). `exhibitor` is the directory's name for `exhibitor_rep`. */
const BADGE_TYPES = ['participant', 'speaker', 'exhibitor_rep', 'organizer'];
const TYPE_ALIASES = { exhibitor: 'exhibitor_rep' };
const TYPE_LABELS = { participant: 'Participant', speaker: 'Intervenant', exhibitor_rep: 'Exposant', organizer: 'Organisateur' };

/** Type of an attendee: an organizer listed in ORGANIZER_EMAILS counts as one. */
const typeOf = (attendee, organizerEmails = []) =>
  attendee.role === 'organizer' || organizerEmails.includes(String(attendee.email).toLowerCase()) ? 'organizer' : BADGE_TYPES.includes(attendee.role) ? attendee.role : 'participant';

/** R-81, R-84: full card only for a visible profile that opened its space ; an organizer is never shown (R-41). */
const isReduced = (attendee, type) => type === 'organizer' || !(attendee.directoryOptIn && attendee.consentAt);

/** `types` of the request body -> role names, or null when none is asked ; a string that is no type gives undefined. */
function parseTypes(types) {
  if (types === undefined || types === null) return null;
  if (!Array.isArray(types)) return undefined;
  const roles = types.map((type) => TYPE_ALIASES[type] ?? type);
  if (!roles.every((role) => BADGE_TYPES.includes(role))) return undefined;
  return roles.length ? [...new Set(roles)] : null;
}

/** Sort of the badges: by last name then first name (default) or by company then last name. */
function sortAttendees(attendees, sort = 'name') {
  const key = (attendee) => normalizeText(sort === 'company' ? `${attendee.company ?? ''}|${attendee.lastName} ${attendee.firstName}` : `${attendee.lastName} ${attendee.firstName}`);
  return [...attendees].sort((a, b) => key(a).localeCompare(key(b), 'fr') || (a.documentId < b.documentId ? -1 : 1));
}

module.exports = { BADGE_TYPES, TYPE_LABELS, isReduced, parseTypes, sortAttendees, typeOf };
