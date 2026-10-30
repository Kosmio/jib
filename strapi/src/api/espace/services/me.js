'use strict';

const fs = require('node:fs');
const { EspaceError } = require('../lib/errors');
const { profileCompletion } = require('../lib/profile');

const ATTENDEE = 'api::espace.attendee';
const MEETING = 'api::espace.meeting';
const MESSAGE = 'api::espace.message';
const TOPIC = 'api::espace.topic';
// The four fields imported from HelloAsso, the ones a participant may correct (R-31).
const PROFILE_FIELDS = ['firstName', 'lastName', 'jobTitle', 'company'];
const REQUIRED = { firstName: 'Indiquez votre prénom.', lastName: 'Indiquez votre nom.', company: 'Indiquez votre entreprise.' };
const MAX_LENGTH = 100;
const BIO_MAX_LENGTH = 280;
const MAX_TOPICS = 3;
const CONSENTS = ['directoryOptIn', 'meetingsOptIn', 'newsOptIn'];
const EMAIL_PREFS = ['meetingRequests', 'messages', 'reminders'];

// What `Me` needs besides the scalar fields of the attendee (A-36).
const ME_POPULATE = {
  photo: true,
  topics: { fields: ['documentId', 'name'] },
  exhibitor: { fields: ['documentId', 'standNumber'], populate: { organisation: { fields: ['documentId', 'name'] } } },
};

// A-35: the kind of image is read from the first bytes, never from the name or the type the browser announces.
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = [
  { mime: 'image/jpeg', ext: 'jpg', matches: (head) => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff },
  { mime: 'image/png', ext: 'png', matches: (head) => head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', matches: (head) => head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP' },
];

const validation = (fields) => new EspaceError(400, 'VALIDATION', 'Corrigez les champs signalés.', { fields });
const asObject = (body) => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});
/** Plain text: control characters out, line breaks as \n, no surrounding blanks (NF-05). */
const plainText = (text) => text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();

module.exports = ({ strapi }) => {
  const documents = (uid) => strapi.documents(uid);
  const emailPrefsOf = (attendee) => Object.fromEntries(EMAIL_PREFS.map((name) => [name, attendee.emailPrefs?.[name] !== false]));

  /**
   * `Me` of phase 1: never the e-mail, never the HelloAsso identifiers (R-42, NF-11). `id` is the documentId.
   * Synchronous and made of the scalar fields only, so that POST /auth/verify can keep answering with it.
   */
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

  /**
   * `Me` of phase 2 (A-36): phase 1 plus the presentation, photo, topics, e-mail preferences, completion, exhibitor and
   * dedicated table, from an attendee loaded with ME_POPULATE. `hostedTableNumber`: the table once A-29 has checked it.
   */
  const toFullMe = ({ attendee, edition, isOrganizer, hostedTableNumber, counts }) => ({
    ...toMe({ attendee, edition, isOrganizer }),
    bio: attendee.bio ?? null,
    photoUrl: attendee.photo?.url ?? null,
    topics: (attendee.topics ?? []).map(({ documentId, name }) => ({ id: documentId, name })),
    emailPrefs: emailPrefsOf(attendee),
    profileCompletion: profileCompletion(attendee),
    exhibitor: attendee.exhibitor?.organisation
      ? { id: attendee.exhibitor.documentId, name: attendee.exhibitor.organisation.name, standNumber: attendee.exhibitor.standNumber ?? null }
      : null,
    hostedTableNumber,
    ...(counts && { counts }),
  });

  /** The attendee of the session, reloaded with its photo, topics and exhibitor (the session only carries the scalars). */
  const loadAttendee = ({ attendee }) => documents(ATTENDEE).findOne({ documentId: attendee.documentId, populate: ME_POPULATE });

  /** Badges (F-24): pending requests addressed to the attendee or to its exhibitor, messages received and unread. */
  async function countsOf({ attendee, edition }) {
    const inEdition = { edition: { documentId: edition.documentId } };
    const exhibitorId = attendee.exhibitor?.documentId;
    const [pendingReceived, unreadMessages] = await Promise.all([
      documents(MEETING).count({
        filters: {
          ...inEdition,
          status: 'pending',
          $or: [{ targetAttendee: { documentId: attendee.documentId } }, ...(exhibitorId ? [{ targetExhibitor: { documentId: exhibitorId } }] : [])],
        },
      }),
      documents(MESSAGE).count({
        filters: {
          readAt: { $null: true },
          author: { documentId: { $ne: attendee.documentId } },
          conversation: { ...inEdition, participants: { documentId: attendee.documentId } },
        },
      }),
    ]);
    return { pendingReceived, unreadMessages };
  }

  /** Full `Me` of the session's attendee after a reload ; the counters of the badges only for GET /me. */
  async function currentMe(session, { withCounts = false } = {}) {
    const attendee = await loadAttendee(session);
    const hasTable = attendee.role === 'speaker' && Number.isInteger(attendee.hostedTableNumber);
    const owners = hasTable ? await strapi.service('api::espace.directory').hostedOwners(session.edition) : null;
    return toFullMe({
      ...session,
      attendee,
      hostedTableNumber: owners?.get(attendee.documentId) ?? null,
      ...(withCounts && { counts: await countsOf({ ...session, attendee }) }),
    });
  }

  /** The topics of the list all belong to the edition: the documentIds found are as many as asked. */
  async function allInEdition(edition, ids) {
    const found = await documents(TOPIC).findMany({ filters: { edition: { documentId: edition.documentId }, documentId: { $in: ids } }, fields: ['name'], limit: MAX_TOPICS });
    return found.length === ids.length;
  }

  return {
    toMe,
    loadAttendee,

    /** GET /me (A-36): the complete `Me`, with the counters of the badges. */
    show: (session) => currentMe(session, { withCounts: true }),

    /**
     * PATCH /me (F-30, F-31, R-31): firstName, lastName, jobTitle and company as in phase 1, then bio, topics and emailPrefs,
     * whatever else the body carries. A field that is not sent is left as it is.
     * The resulting profile needs a first name, a last name and a company ; 100 characters at most per imported field,
     * 280 for the presentation, 0 to 3 distinct topics of the edition (400 VALIDATION + fields).
     * A field of the four whose value changes is added to editedFields, so that the HelloAsso synchronisation no longer overwrites it.
     */
    async update(session, body) {
      const { attendee, edition } = session;
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

      const data = {};
      if (given.bio !== undefined) {
        const bio = given.bio === null ? '' : typeof given.bio === 'string' ? plainText(given.bio) : null;
        if (bio === null) fields.bio = 'Valeur non valable.';
        else if (bio.length > BIO_MAX_LENGTH) fields.bio = `${BIO_MAX_LENGTH} caractères au plus.`;
        else data.bio = bio || null;
      }

      if (given.topics !== undefined) {
        const ids = given.topics;
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id || id.length > 50)) fields.topics = 'Valeur non valable.';
        else if (new Set(ids).size !== ids.length) fields.topics = 'Chaque sujet ne se choisit qu’une fois.';
        else if (ids.length > MAX_TOPICS) fields.topics = `${MAX_TOPICS} sujets au plus.`;
        else if (ids.length && !(await allInEdition(edition, ids))) fields.topics = 'Sujet non valable.';
        else data.topics = ids;
      }

      if (given.emailPrefs !== undefined) {
        const sent = asObject(given.emailPrefs);
        if (given.emailPrefs !== sent || EMAIL_PREFS.some((name) => sent[name] !== undefined && typeof sent[name] !== 'boolean')) fields.emailPrefs = 'Valeur attendue : oui ou non.';
        else data.emailPrefs = { ...emailPrefsOf(attendee), ...Object.fromEntries(EMAIL_PREFS.filter((name) => sent[name] !== undefined).map((name) => [name, sent[name]])) };
      }
      if (Object.keys(fields).length) throw validation(fields);

      const changed = PROFILE_FIELDS.filter((name) => profile[name] !== (attendee[name] ?? ''));
      if (changed.length || Object.keys(data).length) {
        await documents(ATTENDEE).update({
          documentId: attendee.documentId,
          data: {
            ...Object.fromEntries(changed.map((name) => [name, profile[name] || null])),
            ...(changed.length && { editedFields: [...new Set([...(attendee.editedFields ?? []), ...changed])] }),
            ...data,
          },
        });
      }
      return currentMe(session);
    },

    /** PUT /me/consent (R-40, F-10): the three choices are booleans, all required ; consentAt = now. */
    async setConsent(session, body, { now = new Date() } = {}) {
      const given = asObject(body);
      const fields = {};
      for (const name of CONSENTS) if (typeof given[name] !== 'boolean') fields[name] = 'Valeur attendue : oui ou non.';
      if (Object.keys(fields).length) throw validation(fields);

      await documents(ATTENDEE).update({
        documentId: session.attendee.documentId,
        data: { ...Object.fromEntries(CONSENTS.map((name) => [name, given[name]])), consentAt: now },
      });
      return currentMe(session);
    },

    /**
     * POST /me/photo (F-30, A-35): `file` is the multipart file the body parser left in ctx.request.files.photo.
     * JPEG, PNG or WebP (400 PHOTO_INVALID), 5 MB at most (400 PHOTO_TOO_LARGE). The browser has already cropped and shrunk it:
     * the file is stored as it is through the Upload plugin, and the previous photo is deleted. -> { photoUrl }
     */
    async setPhoto(session, file) {
      const invalid = new EspaceError(400, 'PHOTO_INVALID', 'Choisissez une image JPEG, PNG ou WebP.');
      if (!file || Array.isArray(file) || typeof file.filepath !== 'string') throw invalid;

      try {
        const { size } = await fs.promises.stat(file.filepath);
        if (size > PHOTO_MAX_BYTES) throw new EspaceError(400, 'PHOTO_TOO_LARGE', 'La photo dépasse 5 Mo.');

        const head = Buffer.alloc(12);
        const handle = await fs.promises.open(file.filepath, 'r');
        try {
          await handle.read(head, 0, head.length, 0);
        } finally {
          await handle.close();
        }
        const type = PHOTO_TYPES.find(({ matches }) => matches(head));
        if (!type) throw invalid;

        const { documentId } = session.attendee;
        const upload = strapi.plugin('upload').service('upload');
        // The plugin decodes the image: a file with the right first bytes but no image behind them is an ApplicationError.
        const [uploaded] = await upload
          .upload({
            data: { fileInfo: { name: `profil-${documentId}` } },
            files: { filepath: file.filepath, originalFilename: `profil-${documentId}.${type.ext}`, mimetype: type.mime, size },
          })
          .catch((error) => {
            throw error.name === 'ApplicationError' ? invalid : error;
          });
        // Right first bytes, nothing to decode behind them: the plugin stored it without dimensions.
        if (!uploaded.width || !uploaded.height) {
          await upload.remove(uploaded);
          throw invalid;
        }

        const { photo: previous } = await documents(ATTENDEE).findOne({ documentId, populate: { photo: true } });
        await documents(ATTENDEE).update({ documentId, data: { photo: uploaded.id } });
        if (previous) await upload.remove(previous).catch((error) => strapi.log.warn(`[me] previous photo not removed: ${error.message.split('\n')[0]}`));
        return { photoUrl: uploaded.url };
      } finally {
        await fs.promises.rm(file.filepath, { force: true });
      }
    },
  };
};
