'use strict';

/**
 * Pure part of the "Édition" screen of the organizer interface (15-administration.md, AD-1): HelloAsso address parsing (F-155),
 * field map guess (F-157), validation of the settings (F-168, F-177 to F-179) and the opening checklist (F-177).
 */

const FORM_TYPES = ['Event', 'Membership', 'CrowdFunding', 'Donation', 'PaymentForm', 'Checkout', 'Shop'];

/** Path segment of a HelloAsso address -> form type. */
const TYPE_SEGMENTS = {
  evenements: 'Event',
  adhesions: 'Membership',
  collectes: 'CrowdFunding',
  formulaires: 'Donation',
  paiements: 'PaymentForm',
  boutiques: 'Shop',
};

/** Keys of `helloassoFieldMap` read by the import (lib/import.js) and the custom field names recognised for each. */
const FIELD_KEYS = {
  company: ['organisation', 'entreprise', 'societe', 'structure', 'raison sociale'],
  jobTitle: ['poste', 'fonction', 'metier'],
  email: ['email', 'e-mail', 'mail', 'adresse e-mail', 'adresse email', 'courriel'],
  linkedin: ['linkedin', 'profil linkedin', 'page linkedin'],
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/i;

const fold = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * F-155: a HelloAsso address (public page `www.helloasso.com/associations/{org}/evenements/{form}` or back office
 * `admin.helloasso.com/{org}/evenements/{form}/...`) -> { orgSlug, formType, formSlug }, or null when it is not one.
 */
function parseHelloAssoUrl(input) {
  let url;
  try {
    url = new URL(String(input ?? '').trim());
  } catch {
    return null;
  }
  if (!/(^|\.)helloasso\.com$/i.test(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const index = parts.findIndex((part, i) => i > 0 && TYPE_SEGMENTS[part.toLowerCase()] && parts[i + 1]);
  if (index < 1) return null;
  const orgSlug = parts[index - 1];
  const formSlug = parts[index + 1];
  if (!SLUG.test(orgSlug) || !SLUG.test(formSlug) || orgSlug === 'associations') return null;
  return { orgSlug, formType: TYPE_SEGMENTS[parts[index].toLowerCase()], formSlug };
}

/** F-157: custom field names found on the form -> the recognised map { company, jobTitle, email, linkedin } (a key absent when nothing matches). */
function guessFieldMap(fieldNames = []) {
  const map = {};
  for (const [key, known] of Object.entries(FIELD_KEYS)) {
    const found = fieldNames.find((name) => known.includes(fold(name))) ?? fieldNames.find((name) => known.some((word) => fold(name).includes(word)));
    if (found) map[key] = found;
  }
  return map;
}

const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
const isHttpUrl = (value) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

/** Optional trimmed text: '' and null become null. */
const text = (value) => (value === null || value === undefined ? null : String(value).trim() || null);

/**
 * Body of PATCH /admin/{edition}/settings -> { data, errors }. Only the fields present are judged and written; `errors` maps a
 * field to its French message (400 VALIDATION). `data` uses the attribute names of the edition.
 */
function validateSettings(body = {}) {
  const data = {};
  const errors = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

  if (has('title')) {
    const title = text(body.title);
    if (!title) errors.title = 'Indiquez le titre de l’édition.';
    else if (title.length > 200) errors.title = 'Le titre ne doit pas dépasser 200 caractères.';
    else data.title = title;
  }
  if (has('date')) {
    const date = text(body.date);
    if (date && !isDate(date)) errors.date = 'Date invalide.';
    else data.date = date;
  }
  if (has('city')) data.city = text(body.city);
  if (has('inscriptionUrl')) {
    const url = text(body.inscriptionUrl);
    if (url && !isHttpUrl(url)) errors.inscriptionUrl = 'Indiquez une adresse qui commence par https://.';
    else data.inscription_url = url;
  }
  if (has('helloassoOrgSlug')) {
    const value = text(body.helloassoOrgSlug);
    if (value && !SLUG.test(value)) errors.helloassoOrgSlug = 'Lettres, chiffres et tirets seulement, comme dans l’adresse HelloAsso.';
    else data.helloassoOrgSlug = value;
  }
  if (has('helloassoFormSlug')) {
    const value = text(body.helloassoFormSlug);
    if (value && !SLUG.test(value)) errors.helloassoFormSlug = 'Lettres, chiffres et tirets seulement, comme dans l’adresse HelloAsso.';
    else data.helloassoFormSlug = value;
  }
  if (has('helloassoFormType')) {
    if (!FORM_TYPES.includes(body.helloassoFormType)) errors.helloassoFormType = 'Type de formulaire inconnu.';
    else data.helloassoFormType = body.helloassoFormType;
  }
  if (has('helloassoFieldMap')) {
    const map = body.helloassoFieldMap;
    if (!map || typeof map !== 'object' || Array.isArray(map)) errors.helloassoFieldMap = 'Correspondance des champs invalide.';
    else {
      const clean = {};
      for (const key of Object.keys(FIELD_KEYS)) {
        const value = text(map[key]);
        if (value) clean[key] = value.slice(0, 200);
      }
      data.helloassoFieldMap = clean;
    }
  }
  for (const key of ['participantSpaceEnabled', 'b2bEnabled']) {
    if (!has(key)) continue;
    if (typeof body[key] !== 'boolean') errors[key] = 'Valeur attendue : oui ou non.';
    else data[key] = body[key];
  }
  if (has('tablesCount')) {
    const value = Number(body.tablesCount);
    if (!Number.isInteger(value) || value < 1 || value > 200) errors.tablesCount = 'Indiquez un nombre de tables entre 1 et 200.';
    else data.tablesCount = value;
  }
  if (has('slotDurationMinutes')) {
    const value = Number(body.slotDurationMinutes);
    if (!Number.isInteger(value) || value < 5 || value > 120) errors.slotDurationMinutes = 'Indiquez une durée entre 5 et 120 minutes.';
    else data.slotDurationMinutes = value;
  }
  for (const key of ['meetingRequestsOpenAt', 'meetingRequestsCloseAt']) {
    if (!has(key)) continue;
    const value = text(body[key]);
    if (value && Number.isNaN(new Date(value).getTime())) errors[key] = 'Date et heure invalides.';
    else data[key] = value ? new Date(value).toISOString() : null;
  }
  const open = data.meetingRequestsOpenAt;
  const close = data.meetingRequestsCloseAt;
  if (open && close && open >= close && !errors.meetingRequestsCloseAt) {
    errors.meetingRequestsCloseAt = 'La fermeture doit venir après l’ouverture.';
  }
  return { data, errors };
}

/** R-92: true when the association or the form changes. `current` is the stored edition, `data` what is written. */
function changesForm(current, data) {
  return ['helloassoOrgSlug', 'helloassoFormSlug', 'helloassoFormType'].some(
    (key) => data[key] !== undefined && (data[key] ?? null) !== (current?.[key] ?? (key === 'helloassoFormType' ? 'Event' : null))
  );
}

/**
 * F-177: points to check before opening the space. A missing point never forbids the opening, it is shown.
 * -> [{ key, label, done, hint }] in the order of exploitation.md, section 6.
 */
function openingChecklist({ helloassoReady, synced, programPublished, breaks, slots }) {
  return [
    { key: 'helloasso', label: 'HelloAsso réglé', done: Boolean(helloassoReady), hint: 'Renseignez le formulaire HelloAsso et testez la connexion.' },
    { key: 'sync', label: 'Inscrits importés de HelloAsso', done: Boolean(synced), hint: 'Lancez « Synchroniser maintenant » dans le pilotage.' },
    { key: 'program', label: 'Programme publié', done: Boolean(programPublished), hint: 'Publiez au moins une séquence du programme.' },
    {
      key: 'slots',
      label: 'Créneaux de rendez-vous générés',
      done: breaks === 0 || slots > 0,
      hint: breaks === 0 ? 'Aucune pause B2B dans le programme.' : 'Cliquez sur « Régénérer les créneaux » plus bas.',
    },
  ];
}

module.exports = { FIELD_KEYS, FORM_TYPES, changesForm, guessFieldMap, openingChecklist, parseHelloAssoUrl, validateSettings };
