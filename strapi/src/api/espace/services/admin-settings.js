'use strict';

const { EspaceError } = require('../lib/errors');
const { createHelloAssoClient, HelloAssoError } = require('../lib/helloasso');
const { changesForm, guessFieldMap, openingChecklist, validateSettings } = require('../lib/admin-settings');
const { ACTIVE_STATUSES } = require('../lib/admin-guards');
const { parseProgramTime } = require('../lib/time');
const { isReadOnly } = require('../lib/read-only');

const EDITION = 'api::edition.edition';
const SEQUENCE = 'api::sequence.sequence';
const SLOT = 'api::espace.slot';
const MEETING = 'api::espace.meeting';
const ATTENDEE = 'api::espace.attendee';
const SYNC_RUN = 'api::espace.sync-run';

/** Minutes of a program time for sorting, unreadable times last. */
const minutesOf = (value) => {
  const time = parseProgramTime(value);
  return time ? time.hours * 60 + time.minutes : Number.POSITIVE_INFINITY;
};

/** An ApplicationError of the admin guards (NF-63, NF-64) becomes a 409 with its French message ; anything else goes through. */
async function guarded(action) {
  try {
    return await action();
  } catch (error) {
    if (error?.name === 'ApplicationError' || error?.name === 'ValidationError') throw new EspaceError(409, 'REFUSED', error.message);
    throw error;
  }
}

/**
 * "Édition" screen of the organizer interface (15-administration.md, AD-1): settings of the edition, HelloAsso, opening and
 * B2B. Every write lands on the draft then publishes the edition (the settings apply at once, unlike the program, D-22).
 * No route of this service returns a HelloAsso secret (D-21, NF-71).
 */
module.exports = ({ strapi }) => {
  const ofEdition = (edition) => ({ edition: { documentId: edition.documentId } });

  function credentials() {
    const { apiBase, clientId, clientSecret } = strapi.config.get('server.helloasso') ?? {};
    return { apiBase, present: Boolean(apiBase && clientId && clientSecret), clientId, clientSecret };
  }

  /** Published sequences of the edition in time order, with their slot count (F-180). */
  async function sequencesOf(edition) {
    const sequences = await strapi.documents(SEQUENCE).findMany({ filters: ofEdition(edition), status: 'published', limit: 500 });
    const slots = await strapi.documents(SLOT).findMany({ filters: ofEdition(edition), populate: { session: { fields: ['documentId'] } }, limit: 5000 });
    const countBySession = new Map();
    for (const slot of slots) countBySession.set(slot.session?.documentId, (countBySession.get(slot.session?.documentId) ?? 0) + 1);
    return sequences
      .sort((a, b) => minutesOf(a.start_time) - minutesOf(b.start_time) || (a.order ?? 0) - (b.order ?? 0))
      .map((sequence) => ({
        id: sequence.documentId,
        title: sequence.title ?? '',
        startTime: sequence.start_time ?? null,
        endTime: sequence.end_time ?? null,
        kind: sequence.kind ?? 'talk',
        slots: countBySession.get(sequence.documentId) ?? 0,
        updatedAt: sequence.updatedAt,
      }));
  }

  async function read(edition) {
    const current = await strapi.documents(EDITION).findOne({ documentId: edition.documentId, status: 'published' });
    const [attendees, syncs, sequences] = await Promise.all([
      strapi.documents(ATTENDEE).count({ filters: ofEdition(edition) }),
      strapi.documents(SYNC_RUN).count({ filters: { ...ofEdition(edition), endedAt: { $notNull: true } } }),
      sequencesOf(edition),
    ]);
    const { present } = credentials();
    const breaks = sequences.filter((sequence) => sequence.kind === 'b2b_break');
    const helloassoReady = present && Boolean(current.helloassoOrgSlug && current.helloassoFormSlug);
    return {
      id: current.documentId,
      updatedAt: current.updatedAt,
      readOnly: isReadOnly(current),
      attendees,
      general: {
        title: current.title ?? '',
        date: current.date ?? null,
        city: current.city ?? '',
        inscriptionUrl: current.inscription_url ?? '',
      },
      helloasso: {
        orgSlug: current.helloassoOrgSlug ?? '',
        formType: current.helloassoFormType ?? 'Event',
        formSlug: current.helloassoFormSlug ?? '',
        fieldMap: current.helloassoFieldMap ?? {},
        credentials: present,
        syncs,
      },
      space: {
        participantSpaceEnabled: Boolean(current.participantSpaceEnabled),
        b2bEnabled: current.b2bEnabled !== false,
        tablesCount: current.tablesCount ?? 20,
        slotDurationMinutes: current.slotDurationMinutes ?? 15,
        meetingRequestsOpenAt: current.meetingRequestsOpenAt ?? null,
        meetingRequestsCloseAt: current.meetingRequestsCloseAt ?? null,
        checklist: openingChecklist({
          helloassoReady,
          synced: syncs > 0 || attendees > 0,
          programPublished: sequences.length > 0,
          breaks: breaks.length,
          slots: breaks.reduce((sum, sequence) => sum + sequence.slots, 0),
        }),
      },
      sequences,
    };
  }

  function refuseReadOnly(edition) {
    if (isReadOnly(edition)) throw new EspaceError(409, 'EDITION_READ_ONLY', 'L’édition est terminée : ses réglages ne se modifient plus ici.');
  }

  /** NF-75: the client sends the `updatedAt` it read ; a newer stored value means somebody else saved in between. */
  function refuseStale(stored, sent) {
    if (sent && stored && new Date(stored).getTime() !== new Date(sent).getTime()) {
      throw new EspaceError(409, 'STALE', 'Ces réglages ont été modifiés entre-temps (par un autre organisateur ou dans Strapi). Rechargez la page pour voir la dernière version.');
    }
  }

  return {
    read,

    /** PATCH /admin/{edition}/settings: body of `validateSettings`, plus `updatedAt` (NF-75) and `confirmFormChange` (R-92). */
    async update(edition, body = {}) {
      refuseReadOnly(edition);
      const { data, errors } = validateSettings(body);
      if (Object.keys(errors).length) throw new EspaceError(400, 'VALIDATION', 'Certains champs sont à corriger.', { fields: errors });
      if (!Object.keys(data).length) return read(edition);
      const current = await strapi.documents(EDITION).findOne({ documentId: edition.documentId, status: 'published' });
      refuseStale(current.updatedAt, body.updatedAt);
      if (changesForm(current, data) && body.confirmFormChange !== true) {
        const attendees = await strapi.documents(ATTENDEE).count({ filters: ofEdition(edition) });
        if (attendees > 0) {
          throw new EspaceError(409, 'FORM_CHANGE_CONFIRM', `${attendees} inscrits viennent du formulaire actuel. Ils restent, mais seront vus comme annulés à la prochaine synchronisation, sauf ceux dont le statut est verrouillé.`, { attendees });
        }
      }
      await guarded(async () => {
        await strapi.documents(EDITION).update({ documentId: edition.documentId, data });
        await strapi.documents(EDITION).publish({ documentId: edition.documentId });
      });
      return read(edition);
    },

    /** POST /admin/{edition}/helloasso/test (F-156, I-45): reads the first page of the form, writes nothing. */
    async testHelloAsso(edition, body = {}) {
      const { apiBase, present, clientId, clientSecret } = credentials();
      if (!present) throw new EspaceError(409, 'HELLOASSO_CREDENTIALS_MISSING', 'Les identifiants HelloAsso du serveur sont absents : ils se règlent au déploiement, demandez-les à Kosmio.');
      const organizationSlug = String(body.orgSlug ?? edition.helloassoOrgSlug ?? '').trim();
      const formSlug = String(body.formSlug ?? edition.helloassoFormSlug ?? '').trim();
      const formType = String(body.formType ?? edition.helloassoFormType ?? 'Event');
      if (!organizationSlug || !formSlug) throw new EspaceError(400, 'VALIDATION', 'Indiquez l’association et le formulaire.');
      const client = createHelloAssoClient({ apiBase, clientId, clientSecret });
      try {
        const preview = await client.previewForm({ organizationSlug, formType, formSlug });
        return { ...preview, suggestedFieldMap: guessFieldMap(preview.fieldNames) };
      } catch (error) {
        if (!(error instanceof HelloAssoError)) throw error;
        if (error.status === 404) throw new EspaceError(404, 'HELLOASSO_FORM_NOT_FOUND', 'Association ou formulaire introuvable sur HelloAsso. Vérifiez l’adresse du formulaire.');
        if (error.status === 401 || error.status === 403) throw new EspaceError(409, 'HELLOASSO_ACCESS_DENIED', 'HelloAsso refuse l’accès : les identifiants du serveur ne donnent pas accès à ce formulaire.');
        throw new EspaceError(502, 'HELLOASSO_UNREACHABLE', 'HelloAsso ne répond pas. Réessayez dans quelques minutes.');
      }
    },

    /**
     * PATCH /admin/{edition}/sequences/{id}/break (F-180, F-165): turns a published sequence into a B2B break or back, then
     * publishes it. R-86: a break needs readable start and end times. R-93: a break whose slots carry active meetings stays one.
     */
    async setBreak(edition, sequenceId, { isBreak, updatedAt } = {}) {
      refuseReadOnly(edition);
      if (typeof isBreak !== 'boolean') throw new EspaceError(400, 'VALIDATION', 'Valeur attendue : oui ou non.');
      const sequence = await strapi.documents(SEQUENCE).findFirst({ filters: { documentId: sequenceId, ...ofEdition(edition) }, status: 'published' });
      if (!sequence) throw new EspaceError(404, 'SEQUENCE_NOT_FOUND', 'Séquence introuvable dans cette édition.');
      refuseStale(sequence.updatedAt, updatedAt);
      if (isBreak && !(parseProgramTime(sequence.start_time) && parseProgramTime(sequence.end_time))) {
        throw new EspaceError(409, 'BREAK_TIMES_MISSING', `« ${sequence.title} » n’a pas d’heure de début et de fin lisibles : corrigez-les dans le programme avant d’en faire une pause B2B.`);
      }
      if (!isBreak && sequence.kind === 'b2b_break') {
        const active = await strapi.documents(MEETING).count({ filters: { status: { $in: ACTIVE_STATUSES }, slot: { session: { documentId: sequenceId } } } });
        if (active > 0) {
          throw new EspaceError(409, 'BREAK_HAS_MEETINGS', `Cette pause porte ${active} rendez-vous en attente ou acceptés : déplacez-les ou annulez-les d’abord (Vue B2B).`, { meetings: active });
        }
      }
      const kind = isBreak ? 'b2b_break' : sequence.kind === 'b2b_break' ? 'other' : sequence.kind;
      await guarded(async () => {
        await strapi.documents(SEQUENCE).update({ documentId: sequenceId, data: { kind } });
        await strapi.documents(SEQUENCE).publish({ documentId: sequenceId });
      });
      return read(edition);
    },
  };
};
