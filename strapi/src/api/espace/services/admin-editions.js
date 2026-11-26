'use strict';

const { EspaceError } = require('../lib/errors');
const { generateToken, hashToken } = require('../lib/tokens');

const EDITION = 'api::edition.edition';
const SEQUENCE = 'api::sequence.sequence';
const TOPIC = 'api::espace.topic';
const TOKEN = 'api::espace.magic-token';
const ATTENDEE = 'api::espace.attendee';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Identity given to an organizer created from ORGANIZER_EMAILS (I-23): its name from its address (lib/people.js).
const { organizerProfile } = require('../lib/people');
const SEQUENCE_FIELDS = ['title', 'start_time', 'end_time', 'description', 'order', 'kind', 'theme', 'subtitle'];

const validation = (fields) => new EspaceError(400, 'VALIDATION', 'Corrigez les champs signalés.', { fields });
const present = (object, keys) => Object.fromEntries(keys.filter((key) => object[key] !== null && object[key] !== undefined).map((key) => [key, object[key]]));

/** V5-C, E9: the editions a person can pilot, the switch from one to another, and the duplication of an edition as a model. */
module.exports = ({ strapi }) => {
  const documents = (uid) => strapi.documents(uid);
  const isListed = (email) => strapi.config.get('server.espace').organizerEmails.some((listed) => listed.trim().toLowerCase() === String(email).toLowerCase());

  const publishedEditions = () =>
    documents(EDITION).findMany({ status: 'published', fields: ['slug', 'title', 'date', 'city'], sort: ['date:desc', 'title:asc'], limit: 500 });

  /** Organizer attendees (active, same address) of the editions: a Map documentId of edition -> attendee. */
  async function organizerRows(email) {
    const rows = await documents(ATTENDEE).findMany({
      filters: { email: { $eqi: email }, role: 'organizer', status: 'active' },
      populate: { edition: { fields: ['documentId'] } },
      limit: 500,
    });
    return new Map(rows.filter((row) => row.edition).map((row) => [row.edition.documentId, row]));
  }

  const createOrganizer = (editionDocumentId, email) =>
    strapi.service('api::espace.locks').withLock(
      `attendee:${editionDocumentId}`,
      async () =>
        (await documents(ATTENDEE).findFirst({ filters: { edition: { documentId: editionDocumentId }, email: { $eqi: email } } })) ??
        documents(ATTENDEE).create({ data: { ...organizerProfile(email), email, role: 'organizer', meetingsOptIn: false, edition: { documentId: editionDocumentId } } })
    );

  /** Copies the settings, the draft program and the topics of `source` into a new draft edition (runs inside the lock's transaction). */
  async function copyEdition(source, { title, slug, date }) {
    const created = await documents(EDITION).create({
      data: {
        title,
        slug,
        date,
        year: Number(date.slice(0, 4)),
        region: source.region,
        city: source.city,
        edition_status: 'a-venir',
        hero_bg_color: source.hero_bg_color ?? undefined,
        lieux: (source.lieux ?? []).map(({ id, ...lieu }) => lieu),
        slotDurationMinutes: source.slotDurationMinutes,
        tablesCount: source.tablesCount,
        participantSpaceEnabled: false,
      },
    });
    const ref = { documentId: created.documentId };

    const sequences = await documents(SEQUENCE).findMany({
      filters: { edition: { documentId: source.documentId } },
      populate: { tags: { fields: ['documentId'] }, organisations: { fields: ['documentId'] } },
      sort: ['order:asc', 'start_time:asc'],
      limit: 1000,
    });
    const copied = new Map();
    for (const sequence of sequences) {
      const copy = await documents(SEQUENCE).create({
        data: {
          ...present(sequence, SEQUENCE_FIELDS),
          edition: ref,
          tags: sequence.tags.map(({ documentId }) => ({ documentId })),
          organisations: sequence.organisations.map(({ documentId }) => ({ documentId })),
        },
      });
      copied.set(sequence.documentId, copy.documentId);
    }

    const topics = await documents(TOPIC).findMany({ filters: { edition: { documentId: source.documentId } }, populate: { sessions: { fields: ['documentId'] } }, limit: 1000 });
    for (const topic of topics) {
      const sessions = topic.sessions.map(({ documentId }) => copied.get(documentId)).filter(Boolean);
      await documents(TOPIC).create({ data: { name: topic.name, edition: ref, sessions: sessions.map((documentId) => ({ documentId })) } });
    }
    return created;
  }

  return {
    /** GET /admin/editions: the published editions the session's person can pilot -> [{ slug, title, date, city, current }]. */
    async list(session) {
      const { email } = session.attendee;
      const editions = await publishedEditions();
      const allowed = isListed(email) ? editions : await organizerRows(email).then((rows) => editions.filter((edition) => rows.has(edition.documentId)));
      return allowed.map(({ slug, title, date, city }) => ({ slug, title, date: date ?? null, city: city ?? null, current: slug === session.edition.slug }));
    },

    /**
     * POST /admin/:edition/switch: opens a session for the target edition without a new link, only for its organizer (address of ORGANIZER_EMAILS, or
     * Attendee of role organizer with the same address) -> { edition, sessionToken } ; null when the target is the current edition. 404 / 403 otherwise.
     * The session left behind is revoked: the cookie is replaced.
     */
    async switchTo(session, targetSlug, { ip, now = new Date() } = {}) {
      const edition = await strapi.service('api::espace.editions').findPublished(targetSlug);
      if (!edition) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');
      if (edition.slug === session.edition.slug) return null;

      const { email } = session.attendee;
      const forbidden = new EspaceError(403, 'FORBIDDEN', 'Accès réservé aux organisateurs de cette édition.');
      let attendee = (await organizerRows(email)).get(edition.documentId);
      if (!attendee && isListed(email)) {
        attendee = await createOrganizer(edition.documentId, email);
        if (attendee.status !== 'active') throw forbidden;
      }
      if (!attendee) throw forbidden;

      const sessionToken = generateToken();
      await documents(TOKEN).create({
        data: { attendee: { documentId: attendee.documentId }, kind: 'session', tokenHash: hashToken(sessionToken), expiresAt: new Date(now.getTime() + SESSION_MS), ip },
      });
      await documents(ATTENDEE).update({ documentId: attendee.documentId, data: { lastSeenAt: now, activatedAt: attendee.activatedAt ?? now } });
      await documents(TOKEN).delete({ documentId: session.session.documentId });
      return { edition, sessionToken };
    },

    /**
     * POST /admin/:edition/duplicate: a new draft edition from `source` (published edition of the URL) -> { slug }. 400 VALIDATION, 409 SLUG_TAKEN.
     * Everything runs in one transaction under a lock on the slug: a failure leaves nothing behind.
     */
    async duplicate(source, input) {
      const title = typeof input?.title === 'string' ? input.title.trim() : '';
      const slug = typeof input?.slug === 'string' ? input.slug.trim() : '';
      const date = typeof input?.date === 'string' ? input.date.trim() : '';
      const fields = {};
      if (!title || title.length > 200) fields.title = 'Saisissez un titre de 200 caractères au plus.';
      if (!SLUG.test(slug) || slug.length > 100) fields.slug = 'Utilisez des minuscules, des chiffres et des tirets, par exemple « nouvelle-aquitaine-2027 ».';
      if (!DAY.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) fields.date = 'Saisissez une date valable.';
      if (Object.keys(fields).length) throw validation(fields);

      // The draft is the working copy the organizer edits in Strapi: settings and lieux are read from it.
      const draft = await documents(EDITION).findOne({ documentId: source.documentId, populate: ['lieux'] });
      return strapi.service('api::espace.locks').withLock(`edition-slug:${slug}`, async () => {
        if (await strapi.db.query(EDITION).count({ where: { slug } })) {
          throw new EspaceError(409, 'SLUG_TAKEN', 'Cet identifiant URL est déjà pris.', { fields: { slug: 'Cet identifiant URL est déjà pris.' } });
        }
        await copyEdition(draft ?? source, { title, slug, date });
        return { slug };
      });
    },
  };
};
