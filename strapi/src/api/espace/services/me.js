'use strict';

const { EspaceError } = require('../lib/errors');

const ATTENDEE = 'api::espace.attendee';
// The four fields imported from HelloAsso, the ones a participant may correct (R-31).
const PROFILE_FIELDS = ['firstName', 'lastName', 'jobTitle', 'company'];
const REQUIRED = { firstName: 'Indiquez votre prénom.', lastName: 'Indiquez votre nom.', company: 'Indiquez votre entreprise.' };
const MAX_LENGTH = 100;
const CONSENTS = ['directoryOptIn', 'meetingsOptIn', 'newsOptIn'];

const validation = (fields) => new EspaceError(400, 'VALIDATION', 'Corrigez les champs signalés.', { fields });
const asObject = (body) => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});

module.exports = ({ strapi }) => {
  /** `Me` of phase 1: never the e-mail, never the HelloAsso identifiers (R-42, NF-11). `id` is the documentId. */
  const toMe = ({ attendee, edition, isOrganizer }) => ({
    id: attendee.documentId,
    firstName: attendee.firstName,
    lastName: attendee.lastName,
    jobTitle: attendee.jobTitle ?? null,
    company: attendee.company ?? null,
    role: attendee.role,
    isOrganizer,
    edition: { slug: edition.slug, title: edition.title },
    consent: {
      directoryOptIn: Boolean(attendee.directoryOptIn),
      meetingsOptIn: Boolean(attendee.meetingsOptIn),
      newsOptIn: Boolean(attendee.newsOptIn),
      consentAt: attendee.consentAt ?? null,
    },
  });

  return {
    toMe,

    /**
     * PATCH /me (F-30, R-31): firstName, lastName, jobTitle and company only, whatever else the body carries.
     * A text is expected for each of them. The resulting profile needs a first name, a last name and a company ;
     * 100 characters at most per field (400 VALIDATION + fields).
     * A field whose value changes is added to editedFields, so that the HelloAsso synchronisation no longer overwrites it.
     */
    async update(session, body) {
      const { attendee } = session;
      const given = asObject(body);
      const profile = {};
      const fields = {};
      for (const name of PROFILE_FIELDS) {
        const sent = given[name];
        profile[name] = typeof sent === 'string' ? sent.trim() : (attendee[name] ?? '');
        if (sent !== undefined && typeof sent !== 'string') fields[name] = 'Valeur non valable.';
        else if (REQUIRED[name] && !profile[name]) fields[name] = REQUIRED[name];
        else if (profile[name].length > MAX_LENGTH) fields[name] = `${MAX_LENGTH} caractères au plus.`;
      }
      if (Object.keys(fields).length) throw validation(fields);

      const changed = PROFILE_FIELDS.filter((name) => profile[name] !== (attendee[name] ?? ''));
      if (!changed.length) return toMe(session);

      const updated = await strapi.documents(ATTENDEE).update({
        documentId: attendee.documentId,
        data: {
          ...Object.fromEntries(changed.map((name) => [name, profile[name] || null])),
          editedFields: [...new Set([...(attendee.editedFields ?? []), ...changed])],
        },
      });
      return toMe({ ...session, attendee: updated });
    },

    /** PUT /me/consent (R-40, F-10): the three choices are booleans, all required ; consentAt = now. */
    async setConsent(session, body, { now = new Date() } = {}) {
      const given = asObject(body);
      const fields = {};
      for (const name of CONSENTS) if (typeof given[name] !== 'boolean') fields[name] = 'Valeur attendue : oui ou non.';
      if (Object.keys(fields).length) throw validation(fields);

      const updated = await strapi.documents(ATTENDEE).update({
        documentId: session.attendee.documentId,
        data: { ...Object.fromEntries(CONSENTS.map((name) => [name, given[name]])), consentAt: now },
      });
      return toMe({ ...session, attendee: updated });
    },
  };
};
