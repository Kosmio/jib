'use strict';

/**
 * Pure part of the "Personnes" screen of the organizer interface (15-administration.md, AD-2): cumulated roles (D-20),
 * duplicate organisations (F-169, T-83) and slugs.
 */

/** Lower case without accents. */
const fold = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

/** Name reduced to letters and digits, « & », « et » and « and » left out: « Wood & Co », « wood&co » and « Wood and Co » give « woodco ». */
const nameKey = (value) =>
  fold(value)
    .replace(/&|\b(and|et)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');

/** Edit distance, bounded: only used on short keys. */
function distance(a, b) {
  if (a === b) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length];
}

/**
 * F-169, T-83: existing organisations close to `name` (same key, one contains the other, or one or two letters apart).
 * `organisations` are { documentId, name } ; at most 5, the closest first.
 */
function similarOrganisations(name, organisations) {
  const key = nameKey(name);
  if (!key) return [];
  return organisations
    .map((organisation) => {
      const other = nameKey(organisation.name);
      if (!other) return null;
      if (other === key) return { organisation, score: 0 };
      if (Math.min(key.length, other.length) >= 4 && (other.includes(key) || key.includes(other))) return { organisation, score: 1 };
      const gap = distance(key, other);
      return gap <= (key.length >= 8 ? 2 : 1) ? { organisation, score: 1 + gap } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || a.organisation.name.localeCompare(b.organisation.name))
    .slice(0, 5)
    .map(({ organisation }) => organisation);
}

/**
 * D-20: the main type shown for a person (badge, directory), from its links. An organizer by the `role` field stays one
 * (the role is how it is an organizer) ; an organizer of ORGANIZER_EMAILS is one whatever the field says.
 */
function primaryRole({ organizer = false, listedOrganizer = false, speaker = false, exhibitor = false }) {
  if (organizer && !listedOrganizer) return 'organizer';
  if (speaker) return 'speaker';
  if (exhibitor) return 'exhibitor_rep';
  return 'participant';
}

/** Roles of a person as the screen shows them (D-20): every one that applies. */
function rolesOf(attendee, { listedOrganizer = false } = {}) {
  return {
    participant: attendee.status === 'active',
    speaker: attendee.role === 'speaker' || Boolean(attendee.speaker),
    exhibitor: attendee.role === 'exhibitor_rep' || Boolean(attendee.exhibitor),
    organizer: attendee.role === 'organizer' || listedOrganizer,
    listedOrganizer,
  };
}

/** URL slug of a name, made unique against `taken` (a Set) by a numeric suffix. */
function uniqueSlug(name, taken) {
  const base =
    fold(name)
      .replace(/&/g, ' et ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'organisation';
  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
  return slug;
}

const isHttpUrl = (value) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

/** Body of an organisation (F-169) -> { data, errors } ; only the given fields on an update. */
function readOrganisation(body = {}, { partial = false } = {}) {
  const data = {};
  const errors = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const text = (value) => (value === null || value === undefined ? null : String(value).trim() || null);
  if (!partial || has('name')) {
    const name = text(body.name);
    if (!name) errors.name = 'Indiquez le nom de l’organisation.';
    else if (name.length > 150) errors.name = 'Le nom ne doit pas dépasser 150 caractères.';
    else data.name = name;
  }
  for (const [key, attribute] of [
    ['website', 'website'],
    ['linkedinUrl', 'linkedin_url'],
  ]) {
    if (!has(key)) continue;
    const value = text(body[key]);
    if (value && !isHttpUrl(value)) errors[key] = 'Indiquez une adresse qui commence par https://.';
    else data[attribute] = value;
  }
  if (has('description')) {
    const value = text(body.description);
    if (value && value.length > 500) errors.description = 'La description courte ne doit pas dépasser 500 caractères.';
    else data.description = value;
  }
  return { data, errors };
}

module.exports = { fold, nameKey, primaryRole, readOrganisation, rolesOf, similarOrganisations, uniqueSlug };
