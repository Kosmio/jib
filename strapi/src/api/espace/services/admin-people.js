'use strict';

const { EspaceError } = require('../lib/errors');
const { ACTIVE_STATUSES } = require('../lib/admin-guards');
const { isReadOnly } = require('../lib/read-only');
const { fold, nameKey, primaryRole, readOrganisation, rolesOf, similarOrganisations, uniqueSlug } = require('../lib/people');

const ATTENDEE = 'api::espace.attendee';
const EXHIBITOR = 'api::espace.exhibitor';
const MEETING = 'api::espace.meeting';
const ORGANISATION = 'api::organisation.organisation';
const INTERVENANT = 'api::intervenant.intervenant';

const link = (documentId) => (documentId ? { documentId } : null);
const LIST_MAX = 60;

/** An ApplicationError of the admin guards (NF-63) becomes a 409 with its French message. */
async function guarded(action) {
  try {
    return await action();
  } catch (error) {
    if (error?.name === 'ApplicationError' || error?.name === 'ValidationError') throw new EspaceError(409, 'REFUSED', error.message);
    throw error;
  }
}

/**
 * "Personnes" screen of the organizer interface (15-administration.md, AD-2): organisations and their exhibitor status
 * (F-169, F-172), search of the program's speakers (F-163), cumulated roles of a person (D-20, F-171, F-173, R-97).
 * Organisations and speakers are shared by every edition ; an exhibitor and an attendee belong to one.
 */
module.exports = ({ strapi }) => {
  const ofEdition = (edition) => ({ edition: { documentId: edition.documentId } });
  const listed = (email) => strapi.config.get('server.espace').organizerEmails.some((item) => item.trim().toLowerCase() === String(email ?? '').toLowerCase());
  const countActive = (filters) => strapi.documents(MEETING).count({ filters: { status: { $in: ACTIVE_STATUSES }, ...filters } });

  function refuseReadOnly(edition) {
    if (isReadOnly(edition)) throw new EspaceError(409, 'EDITION_READ_ONLY', 'L’édition est terminée : les personnes ne se modifient plus ici.');
  }

  async function exhibitorsOf(edition) {
    return strapi.documents(EXHIBITOR).findMany({
      filters: ofEdition(edition),
      populate: { organisation: { fields: ['documentId', 'name'] }, representatives: { fields: ['documentId', 'firstName', 'lastName', 'status'] } },
      limit: 1000,
    });
  }

  const organisationView = (organisation, exhibitor) => ({
    id: organisation.documentId,
    name: organisation.name ?? '',
    website: organisation.website ?? '',
    linkedinUrl: organisation.linkedin_url ?? '',
    description: organisation.description ?? '',
    logoUrl: organisation.logo?.url ?? null,
    updatedAt: organisation.updatedAt,
    exhibitor: exhibitor
      ? {
          id: exhibitor.documentId,
          standNumber: exhibitor.standNumber ?? '',
          representatives: (exhibitor.representatives ?? [])
            .filter((person) => person.status === 'active')
            .map((person) => ({ id: person.documentId, name: `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim() })),
        }
      : null,
  });

  const allOrganisations = () =>
    strapi.documents(ORGANISATION).findMany({ status: 'published', fields: ['name', 'website', 'linkedin_url', 'description', 'updatedAt'], populate: { logo: { fields: ['url'] } }, limit: 5000 });

  async function organisationOf(documentId) {
    const organisation = await strapi.documents(ORGANISATION).findOne({ documentId, status: 'published', populate: { logo: { fields: ['url'] } } });
    if (!organisation) throw new EspaceError(404, 'ORGANISATION_NOT_FOUND', 'Organisation introuvable.');
    return organisation;
  }

  async function viewOf(edition, documentId) {
    const organisation = await organisationOf(documentId);
    const exhibitor = (await exhibitorsOf(edition)).find((item) => item.organisation?.documentId === documentId);
    return organisationView(organisation, exhibitor);
  }

  async function loadAttendee(edition, documentId) {
    const attendee = await strapi.documents(ATTENDEE).findFirst({
      filters: { documentId, ...ofEdition(edition) },
      populate: {
        speaker: { fields: ['documentId', 'name', 'title'] },
        exhibitor: { fields: ['documentId', 'standNumber'], populate: { organisation: { fields: ['documentId', 'name'] } } },
      },
    });
    if (!attendee) throw new EspaceError(404, 'ATTENDEE_NOT_FOUND', 'Inscrit introuvable.');
    return attendee;
  }

  function rolesView(attendee) {
    const listedOrganizer = listed(attendee.email);
    return {
      id: attendee.documentId,
      name: `${attendee.firstName ?? ''} ${attendee.lastName ?? ''}`.trim(),
      role: attendee.role,
      roles: rolesOf(attendee, { listedOrganizer }),
      speaker: attendee.speaker ? { id: attendee.speaker.documentId, name: attendee.speaker.name ?? '', title: attendee.speaker.title ?? '' } : null,
      exhibitor: attendee.exhibitor
        ? { id: attendee.exhibitor.documentId, organisationId: attendee.exhibitor.organisation?.documentId ?? null, name: attendee.exhibitor.organisation?.name ?? '', standNumber: attendee.exhibitor.standNumber ?? '' }
        : null,
      hostedTableNumber: attendee.hostedTableNumber ?? null,
      updatedAt: attendee.updatedAt,
    };
  }

  /** The exhibitor of `organisationId` in the edition, created when missing (F-171: the organisation becomes an exhibitor). */
  async function exhibitorFor(edition, organisationId, standNumber) {
    await organisationOf(organisationId);
    const existing = await strapi.documents(EXHIBITOR).findFirst({ filters: { ...ofEdition(edition), organisation: { documentId: organisationId } } });
    if (existing) {
      if (standNumber !== undefined && (existing.standNumber ?? '') !== (standNumber ?? '')) {
        return strapi.documents(EXHIBITOR).update({ documentId: existing.documentId, data: { standNumber: standNumber || null } });
      }
      return existing;
    }
    return strapi.documents(EXHIBITOR).create({ data: { edition: link(edition.documentId), organisation: link(organisationId), standNumber: standNumber || null } });
  }

  return {
    /** GET /admin/{edition}/organisations?q=&exhibitors=true (F-169, F-172): the closest names first, at most 60. */
    async listOrganisations(edition, query = {}) {
      const [organisations, exhibitors] = await Promise.all([allOrganisations(), exhibitorsOf(edition)]);
      const byOrganisation = new Map(exhibitors.map((exhibitor) => [exhibitor.organisation?.documentId, exhibitor]));
      const terms = fold(query.q).split(/\s+/).filter(Boolean);
      const onlyExhibitors = String(query.exhibitors) === 'true';
      const kept = organisations
        .filter((organisation) => !onlyExhibitors || byOrganisation.has(organisation.documentId))
        .filter((organisation) => terms.every((term) => fold(organisation.name).includes(term)))
        .sort((a, b) => Number(byOrganisation.has(b.documentId)) - Number(byOrganisation.has(a.documentId)) || fold(a.name).localeCompare(fold(b.name)));
      return {
        total: kept.length,
        exhibitors: exhibitors.length,
        items: kept.slice(0, LIST_MAX).map((organisation) => organisationView(organisation, byOrganisation.get(organisation.documentId))),
      };
    },

    /** POST /admin/{edition}/organisations: 409 SIMILAR_ORGANISATIONS { candidates } unless `force` (T-83) ; created published. */
    async createOrganisation(edition, body = {}) {
      refuseReadOnly(edition);
      const { data, errors } = readOrganisation(body);
      if (Object.keys(errors).length) throw new EspaceError(400, 'VALIDATION', 'Corrigez les champs signalés.', { fields: errors });
      const organisations = await strapi.documents(ORGANISATION).findMany({ status: 'published', fields: ['name', 'slug'], limit: 5000 });
      const exact = organisations.find((organisation) => nameKey(organisation.name) === nameKey(data.name));
      const similar = similarOrganisations(data.name, organisations);
      if (exact || (similar.length && body.force !== true)) {
        throw new EspaceError(409, 'SIMILAR_ORGANISATIONS', exact ? `« ${exact.name} » existe déjà.` : 'Des organisations proches existent déjà. Choisissez-en une, ou confirmez la création.', {
          candidates: similar.map((organisation) => ({ id: organisation.documentId, name: organisation.name })),
          exact: Boolean(exact),
        });
      }
      const slug = uniqueSlug(data.name, new Set(organisations.map((organisation) => organisation.slug)));
      const created = await strapi.documents(ORGANISATION).create({ data: { ...data, slug }, status: 'published' });
      return viewOf(edition, created.documentId);
    },

    /** PATCH /admin/{edition}/organisations/{id}: fields, and `exhibitor: { enabled, standNumber }` for this edition (F-172). */
    async updateOrganisation(edition, documentId, body = {}) {
      refuseReadOnly(edition);
      const organisation = await organisationOf(documentId);
      if (body.updatedAt && new Date(body.updatedAt).getTime() !== new Date(organisation.updatedAt).getTime()) {
        throw new EspaceError(409, 'STALE', 'Cette organisation a été modifiée entre-temps. Rechargez pour voir la dernière version.');
      }
      const { data, errors } = readOrganisation(body, { partial: true });
      if (Object.keys(errors).length) throw new EspaceError(400, 'VALIDATION', 'Corrigez les champs signalés.', { fields: errors });
      if (Object.keys(data).length) {
        await strapi.documents(ORGANISATION).update({ documentId, data });
        await strapi.documents(ORGANISATION).publish({ documentId });
      }
      if (body.exhibitor && typeof body.exhibitor === 'object') {
        const standNumber = body.exhibitor.standNumber === undefined ? undefined : String(body.exhibitor.standNumber ?? '').trim().slice(0, 20);
        const existing = (await exhibitorsOf(edition)).find((item) => item.organisation?.documentId === documentId);
        if (body.exhibitor.enabled === true) await exhibitorFor(edition, documentId, standNumber);
        if (body.exhibitor.enabled === false && existing) {
          const representatives = (existing.representatives ?? []).filter((person) => person.status === 'active').length;
          if (representatives) throw new EspaceError(409, 'EXHIBITOR_HAS_REPRESENTATIVES', `Cet exposant a ${representatives} représentant${representatives > 1 ? 's' : ''} : retirez-leur d’abord le rôle exposant.`);
          await guarded(() => strapi.documents(EXHIBITOR).delete({ documentId: existing.documentId }));
        }
      }
      return viewOf(edition, documentId);
    },

    /** GET /admin/{edition}/intervenants?q= (F-163): speakers of the program, with the person of the edition linked to each. */
    async searchIntervenants(edition, query = {}) {
      const terms = fold(query.q).split(/\s+/).filter(Boolean);
      const [intervenants, linked] = await Promise.all([
        strapi.documents(INTERVENANT).findMany({ status: 'published', fields: ['name', 'title'], populate: { organisation: { fields: ['name'] } }, limit: 5000 }),
        strapi.documents(ATTENDEE).findMany({ filters: { ...ofEdition(edition), speaker: { documentId: { $notNull: true } } }, fields: ['firstName', 'lastName'], populate: { speaker: { fields: ['documentId'] } }, limit: 5000 }),
      ]);
      const owner = new Map(linked.map((person) => [person.speaker?.documentId, { id: person.documentId, name: `${person.firstName} ${person.lastName}`.trim() }]));
      return intervenants
        .filter((item) => terms.every((term) => fold(`${item.name} ${item.organisation?.name ?? ''}`).includes(term)))
        .sort((a, b) => fold(a.name).localeCompare(fold(b.name)))
        .slice(0, 20)
        .map((item) => ({ id: item.documentId, name: item.name ?? '', title: item.title ?? '', organisation: item.organisation?.name ?? '', linkedTo: owner.get(item.documentId) ?? null }));
    },

    /** GET /admin/{edition}/attendees/{id}/roles */
    async getRoles(edition, documentId) {
      return rolesView(await loadAttendee(edition, documentId));
    },

    /**
     * PATCH /admin/{edition}/attendees/{id}/roles (F-171, F-173, R-97): `speaker` (documentId, 'new' to create one from the person, or
     * null), `exhibitor` (organisation documentId or null) and `standNumber`, `organizer` (boolean), `hostedTableNumber`. Only the keys
     * given change. The main `role` follows D-20.
     */
    async setRoles(edition, documentId, body = {}, { session } = {}) {
      refuseReadOnly(edition);
      const attendee = await loadAttendee(edition, documentId);
      const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
      const data = {};
      let speakerId = attendee.speaker?.documentId ?? null;
      let exhibitorId = attendee.exhibitor?.documentId ?? null;

      if (has('speaker')) {
        if (body.speaker === null && speakerId) {
          const atTable = attendee.hostedTableNumber
            ? await countActive({ targetAttendee: { documentId }, tableNumber: attendee.hostedTableNumber })
            : 0;
          if (atTable) throw new EspaceError(409, 'ROLE_HAS_MEETINGS', `Cette personne reçoit ${atTable} rendez-vous à sa table d’intervenant : déplacez-les ou annulez-les d’abord (Vue B2B).`, { meetings: atTable });
          speakerId = null;
          data.hostedTableNumber = null;
        } else if (body.speaker === 'new') {
          const organisations = attendee.company ? await strapi.documents(ORGANISATION).findMany({ status: 'published', fields: ['name'], limit: 5000 }) : [];
          const organisation = organisations.find((item) => nameKey(item.name) === nameKey(attendee.company));
          const taken = new Set((await strapi.documents(INTERVENANT).findMany({ fields: ['slug'], limit: 10000 })).map((item) => item.slug));
          const name = `${attendee.firstName ?? ''} ${attendee.lastName ?? ''}`.trim();
          const created = await strapi.documents(INTERVENANT).create({
            data: { name, slug: uniqueSlug(name, taken), title: attendee.jobTitle ?? null, organisation: link(organisation?.documentId) },
            status: 'published',
          });
          speakerId = created.documentId;
        } else if (typeof body.speaker === 'string' && body.speaker !== speakerId) {
          const intervenant = await strapi.documents(INTERVENANT).findOne({ documentId: body.speaker, status: 'published' });
          if (!intervenant) throw new EspaceError(404, 'INTERVENANT_NOT_FOUND', 'Intervenant introuvable.');
          const other = await strapi.documents(ATTENDEE).findFirst({ filters: { ...ofEdition(edition), speaker: { documentId: body.speaker }, documentId: { $ne: documentId } }, fields: ['firstName', 'lastName'] });
          if (other) throw new EspaceError(409, 'SPEAKER_TAKEN', `${intervenant.name} est déjà rattaché à ${other.firstName} ${other.lastName}.`);
          speakerId = body.speaker;
        }
        data.speaker = link(speakerId);
      }

      if (has('exhibitor')) {
        if (body.exhibitor === null && exhibitorId) {
          const exhibitor = await strapi.documents(EXHIBITOR).findOne({ documentId: exhibitorId, populate: { representatives: { fields: ['documentId', 'status'] } } });
          const others = (exhibitor?.representatives ?? []).filter((person) => person.status === 'active' && person.documentId !== documentId).length;
          const active = others ? 0 : await countActive({ targetExhibitor: { documentId: exhibitorId } });
          if (active) throw new EspaceError(409, 'ROLE_HAS_MEETINGS', `Cette personne est le seul représentant d’un exposant qui a ${active} rendez-vous en attente ou acceptés : déplacez-les, annulez-les, ou nommez d’abord un autre représentant.`, { meetings: active });
          exhibitorId = null;
        } else if (typeof body.exhibitor === 'string') {
          const standNumber = has('standNumber') ? String(body.standNumber ?? '').trim().slice(0, 20) : undefined;
          exhibitorId = (await exhibitorFor(edition, body.exhibitor, standNumber)).documentId;
        }
        data.exhibitor = link(exhibitorId);
      }

      if (has('hostedTableNumber')) {
        const value = body.hostedTableNumber === null || body.hostedTableNumber === '' ? null : Number(body.hostedTableNumber);
        if (value !== null && (!Number.isInteger(value) || value < 1 || value > (edition.tablesCount ?? 20))) {
          throw new EspaceError(400, 'VALIDATION', 'Corrigez les champs signalés.', { fields: { hostedTableNumber: `Une table de 1 à ${edition.tablesCount ?? 20}.` } });
        }
        if (value !== null && !speakerId) throw new EspaceError(400, 'VALIDATION', 'Corrigez les champs signalés.', { fields: { hostedTableNumber: 'Seul un intervenant a une table dédiée.' } });
        if (value !== null) {
          const holder = await strapi.documents(ATTENDEE).findFirst({ filters: { ...ofEdition(edition), status: 'active', hostedTableNumber: value, documentId: { $ne: documentId } }, fields: ['firstName', 'lastName'] });
          if (holder) throw new EspaceError(409, 'TABLE_TAKEN', `La table ${value} est déjà dédiée à ${holder.firstName} ${holder.lastName}.`);
        }
        data.hostedTableNumber = value;
      }

      const listedOrganizer = listed(attendee.email);
      let organizer = attendee.role === 'organizer';
      if (has('organizer') && typeof body.organizer === 'boolean' && !listedOrganizer) {
        if (!body.organizer && organizer && session?.attendee?.documentId === documentId) {
          throw new EspaceError(409, 'SELF_FORBIDDEN', 'Vous ne pouvez pas retirer votre propre rôle d’organisateur.');
        }
        organizer = body.organizer;
      }
      data.role = primaryRole({ organizer, listedOrganizer, speaker: Boolean(speakerId), exhibitor: Boolean(exhibitorId) });

      await guarded(() => strapi.documents(ATTENDEE).update({ documentId, data }));
      return rolesView(await loadAttendee(edition, documentId));
    },
  };
};
