'use strict';

const { EspaceError } = require('../lib/errors');
const { normalizeEmail } = require('../lib/import');
const { linkUrl } = require('../lib/tokens');

const ATTENDEE = 'api::espace.attendee';
const MEETING = 'api::espace.meeting';
const EMAIL_LOG = 'api::espace.email-log';
const ROLES = ['participant', 'speaker', 'exhibitor_rep', 'organizer'];
const STATUSES = ['active', 'cancelled'];
const SORTS = ['name', 'lastSeen'];
const PAGE_SIZE = 25;
const NAME_MAX = 100;
const TEXT_MAX = 150;
const LINK_MINUTES = 30;
const LINK_SCENARIO = 'admin-link';
const LINK_MAX_PER_HOUR = 3;
const HOUR_MS = 60 * 60 * 1000;

const validation = (fields) => new EspaceError(400, 'VALIDATION', 'Corrigez les champs signalés.', { fields });
const notFound = () => new EspaceError(404, 'ATTENDEE_NOT_FOUND', 'Inscrit introuvable.');

/** Lower case without accents, to search « dub » in « Dubois » and « élodie » with « elodie ». */
const fold = (value) => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** `true` / `false` of a query string, undefined when absent ; 400 VALIDATION otherwise. */
function flag(query, name) {
  const value = query[name];
  if (value === undefined || value === '') return undefined;
  if (value === 'true' || value === 'false') return value === 'true';
  throw validation({ [name]: 'Valeur non valable.' });
}

function oneOf(query, name, allowed) {
  const value = query[name];
  if (value === undefined || value === '') return undefined;
  if (!allowed.includes(value)) throw validation({ [name]: 'Valeur non valable.' });
  return value;
}

/** Row of the list: what the organizer needs to find someone. No message, no phone number. */
const row = (attendee) => ({
  id: attendee.documentId,
  firstName: attendee.firstName,
  lastName: attendee.lastName,
  email: attendee.email,
  company: attendee.company ?? null,
  jobTitle: attendee.jobTitle ?? null,
  role: attendee.role,
  status: attendee.status,
  activated: Boolean(attendee.activatedAt),
  lastSeenAt: attendee.lastSeenAt ?? null,
  directoryOptIn: Boolean(attendee.directoryOptIn),
  manual: attendee.helloassoItemId == null && attendee.role !== 'organizer',
});

/** Validated fields of a creation (all required but jobTitle and company) or of a correction (only the given ones). -> { data, errors } */
function readFields(body, { partial }) {
  const input = body && typeof body === 'object' ? body : {};
  const data = {};
  const errors = {};
  for (const [key, label] of [['firstName', 'Le prénom'], ['lastName', 'Le nom']]) {
    if (partial && input[key] === undefined) continue;
    const value = typeof input[key] === 'string' ? input[key].trim() : '';
    if (!value) errors[key] = `${label} est obligatoire.`;
    else if (value.length > NAME_MAX) errors[key] = `${label} ne peut pas dépasser ${NAME_MAX} caractères.`;
    else data[key] = value;
  }
  for (const [key, label] of [['jobTitle', 'La fonction'], ['company', 'L’entreprise']]) {
    if (input[key] === undefined || input[key] === null) continue;
    const value = typeof input[key] === 'string' ? input[key].trim() : null;
    if (value === null || value.length > TEXT_MAX) errors[key] = `${label} ne peut pas dépasser ${TEXT_MAX} caractères.`;
    else data[key] = value || null;
  }
  if (!partial || input.email !== undefined) {
    const email = normalizeEmail(input.email);
    if (email) data.email = email;
    else errors.email = 'Saisissez une adresse e-mail valide.';
  }
  if (input.role !== undefined || !partial) {
    const role = input.role ?? 'participant';
    if (ROLES.includes(role)) data.role = role;
    else errors.role = 'Rôle non valable.';
  }
  return { data, errors };
}

module.exports = ({ strapi }) => {
  const service = (name) => strapi.service(`api::espace.${name}`);
  const ofEdition = (edition) => ({ edition: { documentId: edition.documentId } });

  const find = async (edition, documentId) => {
    const attendee = await strapi.documents(ATTENDEE).findFirst({ filters: { documentId: String(documentId), ...ofEdition(edition) } });
    if (!attendee) throw notFound();
    return attendee;
  };

  /** A-16: the e-mail is unique in the edition, checked under the lock that the synchronization takes too. */
  const emailTaken = async (edition, email, exceptDocumentId) =>
    Boolean(
      await strapi.documents(ATTENDEE).findFirst({
        filters: { ...ofEdition(edition), email: { $eqi: email }, ...(exceptDocumentId && { documentId: { $ne: exceptDocumentId } }) },
      })
    );
  const takenError = () => new EspaceError(409, 'EMAIL_TAKEN', 'Cette adresse e-mail est déjà celle d’un inscrit de l’édition.', { fields: { email: 'Adresse déjà utilisée.' } });

  /** F-135: the sheet of an attendee. The e-mail leaves only through these routes (R-42), never the content of a message (R-63). */
  async function sheet(attendee) {
    const self = { documentId: attendee.documentId };
    const count = (filters) => strapi.documents(MEETING).count({ filters: { $or: [{ requester: self }, { targetAttendee: self }], ...filters } });
    const [total, pending, accepted, logs] = await Promise.all([
      count({}),
      count({ status: 'pending' }),
      count({ status: 'accepted' }),
      strapi.documents(EMAIL_LOG).findMany({ filters: { attendee: self }, sort: ['sentAt:desc', 'id:desc'], limit: 10 }),
    ]);
    return {
      ...row(attendee),
      importedAt: attendee.createdAt,
      source: attendee.helloassoItemId == null ? 'manual' : 'helloasso',
      activatedAt: attendee.activatedAt ?? null,
      statusLockedAt: attendee.statusLockedAt ?? null,
      consent: {
        directoryOptIn: Boolean(attendee.directoryOptIn),
        meetingsOptIn: Boolean(attendee.meetingsOptIn),
        newsOptIn: Boolean(attendee.newsOptIn),
        consentAt: attendee.consentAt ?? null,
      },
      meetings: { total, pending, accepted },
      emails: logs.map(({ template, sentAt, status, error }) => ({ template, sentAt: sentAt ?? null, status, error: error ?? null })),
    };
  }

  const refuseSelf = (attendee, session, message) => {
    if (session?.attendee?.documentId === attendee.documentId) throw new EspaceError(409, 'SELF_FORBIDDEN', message);
  };

  return {
    /**
     * F-134: the attendees of the edition, filtered and sorted in memory (some hundreds at most).
     * query: q (name, company, e-mail ; accents and case ignored), role, activated, visible (directory), status, page, sort (`name`, `lastSeen`).
     * -> { items, total, page, pageSize, pages }
     */
    async list(edition, query = {}) {
      const role = oneOf(query, 'role', ROLES);
      const status = oneOf(query, 'status', STATUSES);
      const sort = oneOf(query, 'sort', SORTS) ?? 'name';
      const activated = flag(query, 'activated');
      const visible = flag(query, 'visible');
      const terms = fold(query.q).split(/\s+/).filter(Boolean);

      const attendees = await strapi.documents(ATTENDEE).findMany({
        filters: ofEdition(edition),
        fields: ['firstName', 'lastName', 'email', 'company', 'jobTitle', 'role', 'status', 'activatedAt', 'lastSeenAt', 'directoryOptIn', 'helloassoItemId'],
        sort: ['id:asc'],
        limit: 10000,
      });
      const kept = attendees.filter((attendee) => {
        if (role && attendee.role !== role) return false;
        if (status && attendee.status !== status) return false;
        if (activated !== undefined && Boolean(attendee.activatedAt) !== activated) return false;
        if (visible !== undefined && Boolean(attendee.directoryOptIn) !== visible) return false;
        const haystack = fold([attendee.firstName, attendee.lastName, attendee.company, attendee.email].join(' '));
        return terms.every((term) => haystack.includes(term));
      });

      const byName = (a, b) => fold(a.lastName).localeCompare(fold(b.lastName)) || fold(a.firstName).localeCompare(fold(b.firstName));
      const seen = (attendee) => (attendee.lastSeenAt ? new Date(attendee.lastSeenAt).getTime() : -1);
      kept.sort(sort === 'lastSeen' ? (a, b) => seen(b) - seen(a) || byName(a, b) : byName);

      const pages = Math.max(1, Math.ceil(kept.length / PAGE_SIZE));
      const page = Math.min(Math.max(1, Number.parseInt(query.page, 10) || 1), pages);
      return { items: kept.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(row), total: kept.length, page, pageSize: PAGE_SIZE, pages };
    },

    /** F-135: GET /{id}. 404 ATTENDEE_NOT_FOUND. */
    async show(edition, documentId) {
      return sheet(await find(edition, documentId));
    },

    /**
     * F-136: an attendee added by hand (no HelloAsso ticket, so the synchronization neither duplicates nor removes it).
     * 400 VALIDATION, 409 EMAIL_TAKEN. The `welcome` leaves at once when R-85 allows it, otherwise with the next sending.
     */
    async create(edition, body, { now = new Date() } = {}) {
      const { data, errors } = readFields(body, { partial: false });
      if (Object.keys(errors).length) throw validation(errors);
      const created = await service('locks').withLock(`attendee:${edition.documentId}`, async () => {
        if (await emailTaken(edition, data.email)) throw takenError();
        return strapi.documents(ATTENDEE).create({ data: { ...data, status: 'active', ...ofEdition(edition) } });
      });
      await service('welcome').inviteNew(edition, now);
      return sheet(created);
    },

    /**
     * F-137, R-89: corrects first name, last name, job title, company, e-mail or role. The corrected fields join `editedFields`,
     * so that the synchronization no longer overwrites them. 400 VALIDATION, 409 EMAIL_TAKEN, 409 SELF_FORBIDDEN (own role).
     */
    async update(edition, documentId, body, { session } = {}) {
      const attendee = await find(edition, documentId);
      const { data: given, errors } = readFields(body, { partial: true });
      if (Object.keys(errors).length) throw validation(errors);
      const changes = Object.fromEntries(Object.entries(given).filter(([key, value]) => (attendee[key] ?? null) !== value));
      if (changes.role) refuseSelf(attendee, session, 'Vous ne pouvez pas changer votre propre rôle.');
      if (!Object.keys(changes).length) return sheet(attendee);

      const apply = () =>
        strapi.documents(ATTENDEE).update({
          documentId: attendee.documentId,
          data: { ...changes, editedFields: [...new Set([...(attendee.editedFields ?? []), ...Object.keys(changes)])] },
        });
      const updated = changes.email
        ? await service('locks').withLock(`attendee:${edition.documentId}`, async () => {
            if (await emailTaken(edition, changes.email, attendee.documentId)) throw takenError();
            return apply();
          })
        : await apply();
      return sheet(updated);
    },

    /**
     * F-135: sends a new access link. Exempt from the limit per IP, limited to 3 per hour and per attendee (counted in the EmailLog).
     * 409 ATTENDEE_CANCELLED, 409 SPACE_CLOSED, 429 RATE_LIMITED. -> { status: 'sent' | 'failed', error, remaining }
     */
    async sendLink(edition, documentId, { now = new Date() } = {}) {
      const attendee = await find(edition, documentId);
      if (attendee.status !== 'active') throw new EspaceError(409, 'ATTENDEE_CANCELLED', 'Cet inscrit est désinscrit : réinscrivez-le avant de lui renvoyer un lien.');
      if (!edition.participantSpaceEnabled) throw new EspaceError(409, 'SPACE_CLOSED', 'L’espace n’est pas ouvert : le lien ne servirait à rien.');

      return service('locks').withLock(`link:${attendee.documentId}`, async () => {
        const used = await strapi.documents(EMAIL_LOG).count({
          filters: { attendee: { documentId: attendee.documentId }, scenarioKey: LINK_SCENARIO, sentAt: { $gt: new Date(now.getTime() - HOUR_MS) } },
        });
        if (used >= LINK_MAX_PER_HOUR) {
          throw new EspaceError(429, 'RATE_LIMITED', 'Trois liens par heure au plus pour un même inscrit. Réessayez plus tard.');
        }
        const publicUrl = strapi.config.get('server.espace.publicUrl');
        const token = await service('tokens').issueLink(attendee.documentId, { ttlMinutes: LINK_MINUTES, now });
        const { status, error } = await service('mailer').send({
          attendee,
          template: 'access-link',
          scenarioKey: LINK_SCENARIO,
          now,
          data: {
            edition: { slug: edition.slug, title: edition.title, themeColor: edition.hero_bg_color },
            publicUrl,
            firstName: attendee.firstName,
            url: linkUrl({ publicUrl, token, next: `/espace/${edition.slug}/` }),
            validityMinutes: LINK_MINUTES,
          },
        });
        return { status, error: error ?? null, remaining: LINK_MAX_PER_HOUR - used - 1 };
      });
    },

    /**
     * F-138, R-89: cancels the registration. The meetings are cancelled first with notification (R-18), then the status and its
     * lock (`statusLockedAt`) are written: the synchronization will not reactivate the attendee. Idempotent. 409 SELF_FORBIDDEN.
     */
    async cancel(edition, documentId, { now = new Date(), session } = {}) {
      const attendee = await find(edition, documentId);
      refuseSelf(attendee, session, 'Vous ne pouvez pas vous désinscrire vous-même.');
      await service('meetings').cancelForAttendee(attendee, { now });
      return sheet(await strapi.documents(ATTENDEE).update({ documentId: attendee.documentId, data: { status: 'cancelled', statusLockedAt: now } }));
    },

    /** F-138, R-89: registers again, without restoring the meetings ; the lock keeps the synchronization from cancelling again. */
    async restore(edition, documentId, { now = new Date() } = {}) {
      const attendee = await find(edition, documentId);
      return sheet(await strapi.documents(ATTENDEE).update({ documentId: attendee.documentId, data: { status: 'active', statusLockedAt: now } }));
    },
  };
};
