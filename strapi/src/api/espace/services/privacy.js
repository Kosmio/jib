'use strict';

const { buildExport, emailHash, erasedFields, ERASED_RELATIONS, isErasedEmail, isPurgeable, logCutoff } = require('../lib/erase');

const ATTENDEE = 'api::espace.attendee';
const MEETING = 'api::espace.meeting';
const MESSAGE = 'api::espace.message';
const CONVERSATION = 'api::espace.conversation';
const REPORT = 'api::espace.message-report';
const ERASED_EMAIL = 'api::espace.erased-email';
const MAGIC_TOKEN = 'api::espace.magic-token';
const CALENDAR_FEED = 'api::espace.calendar-feed';
const EMAIL_LOG = 'api::espace.email-log';
const SYNC_RUN = 'api::espace.sync-run';
const EDITION = 'api::edition.edition';
const LIMIT = 10000;
const CANCEL_REASON = 'Données supprimées à la demande du participant';

/** Erasure (F-33, R-44), individual export (NF-12) and retention (NF-13, R-44) of the participant space. */
module.exports = ({ strapi }) => {
  const secret = () => strapi.config.get('server.app.keys')[0];
  const ofEdition = (edition) => ({ edition: { documentId: edition.documentId } });
  const removeFile = (file) =>
    strapi
      .plugin('upload')
      .service('upload')
      .remove(file)
      .catch((error) => strapi.log.warn(`[privacy] file not removed: ${String(error.message).split('\n')[0]}`));

  return {
    /** The fingerprints of the erased addresses of an edition, as a Set of hashes (for the import). */
    async erasedHashes(edition) {
      const rows = await strapi.documents(ERASED_EMAIL).findMany({ filters: ofEdition(edition), fields: ['emailHash'], limit: LIMIT });
      return new Set(rows.map(({ emailHash: hash }) => hash));
    },

    /** True when the fingerprint of `email` is held for the edition. */
    async isErased(edition, email) {
      const hash = emailHash(email, secret());
      return Boolean(hash) && Boolean(await strapi.documents(ERASED_EMAIL).findFirst({ filters: { ...ofEdition(edition), emailHash: hash } }));
    },

    /** Predicate for planSync from the Set of fingerprints. */
    matcher(hashes) {
      return (email) => {
        const hash = emailHash(email, secret());
        return Boolean(hash) && hashes.has(hash);
      };
    },

    /**
     * F-33, R-44: anonymizes an Attendee. Upcoming meetings are cancelled with notification first (an error stops everything and the
     * Attendee stays untouched), then, under the lock the synchronization takes, the fingerprint is stored and the row is anonymized.
     * Messages stay, under the anonymized author. Sessions and links are deleted, except `keepSessionDocumentId` (the caller closes it).
     * Idempotent. -> { erased: true }
     */
    async erase(attendeeDocumentId, { now = new Date(), keepSessionDocumentId } = {}) {
      const attendee = await strapi.documents(ATTENDEE).findOne({ documentId: attendeeDocumentId, populate: { edition: { fields: ['documentId'] }, photo: true } });
      if (!attendee || isErasedEmail(attendee.email)) return { erased: true };

      // The counterpart is told "Participant supprimé", never the name.
      const anonymous = { ...attendee, ...erasedFields(attendee, now) };
      await strapi.service('api::espace.meetings').cancelForAttendee(anonymous, { reason: CANCEL_REASON, now, upcomingOnly: true });

      await strapi.service('api::espace.locks').withLock(`attendee:${attendee.edition.documentId}`, async () => {
        const hash = emailHash(attendee.email, secret());
        if (hash && !(await strapi.documents(ERASED_EMAIL).findFirst({ filters: { ...ofEdition(attendee.edition), emailHash: hash } }))) {
          await strapi.documents(ERASED_EMAIL).create({ data: { ...ofEdition(attendee.edition), emailHash: hash, erasedAt: now } });
        }
        await strapi.db.query(ATTENDEE).update({ where: { documentId: attendee.documentId }, data: { ...erasedFields(attendee, now), ...ERASED_RELATIONS } });
        await strapi.db.query(MAGIC_TOKEN).deleteMany({
          where: { attendee: { documentId: attendee.documentId }, ...(keepSessionDocumentId && { documentId: { $ne: keepSessionDocumentId } }) },
        });
        // I-42: the subscription feeds of the person go with the data.
        await strapi.db.query(CALENDAR_FEED).deleteMany({ where: { attendee: { documentId: attendee.documentId } } });
      });
      if (attendee.photo) await removeFile(attendee.photo);
      return { erased: true };
    },

    /**
     * NF-12: the data of the person as an object (profile, preferences, meetings, messages sent). Only first name, last name and
     * company of the other participants leave.
     */
    async exportOf(attendeeDocumentId, { now = new Date() } = {}) {
      const attendee = await strapi.documents(ATTENDEE).findOne({ documentId: attendeeDocumentId, populate: { photo: true, topics: { fields: ['name'] }, edition: { fields: ['documentId'] } } });
      const edition = await strapi.documents(EDITION).findOne({ documentId: attendee.edition.documentId, status: 'published' });
      const self = { documentId: attendee.documentId };
      const [meetings, messages] = await Promise.all([
        strapi.documents(MEETING).findMany({
          filters: { $or: [{ requester: self }, { targetAttendee: self }] },
          populate: { slot: true, requester: true, targetAttendee: true, targetExhibitor: { populate: { organisation: { fields: ['name'] } } } },
          sort: ['id:asc'],
          limit: LIMIT,
        }),
        strapi.documents(MESSAGE).findMany({
          filters: { author: self },
          populate: { conversation: { populate: { participants: { fields: ['firstName', 'lastName', 'company'] } } } },
          sort: ['id:asc'],
          limit: LIMIT,
        }),
      ]);
      return buildExport({ attendee, edition: edition ?? attendee.edition, meetings, messages, now });
    },

    /**
     * NF-13, R-44: deletes the EmailLog and SyncRun of more than 12 months, and the whole space (attendees, meetings, conversations,
     * messages, reports, tokens, e-mail logs, fingerprints, photo files) of every edition whose date is past by more than 12 months.
     * The edition and its program stay. Idempotent. -> { logs: { emailLogs, syncRuns }, editions: [slug] }
     */
    async purge({ now = new Date() } = {}) {
      const cutoff = logCutoff(now);
      const emailLogs = (await strapi.db.query(EMAIL_LOG).deleteMany({ where: { createdAt: { $lt: cutoff } } })).count;
      const syncRuns = (await strapi.db.query(SYNC_RUN).deleteMany({ where: { startedAt: { $lt: cutoff } } })).count;

      const editions = [];
      const published = await strapi.documents(EDITION).findMany({ status: 'published', limit: 1000 });
      for (const edition of published.filter((candidate) => isPurgeable(candidate, now))) {
        const scope = ofEdition(edition);
        const attendees = await strapi.documents(ATTENDEE).findMany({ filters: scope, populate: { photo: true }, limit: LIMIT });
        const inEdition = { attendee: { edition: { documentId: edition.documentId } } };
        const counts = [
          await strapi.db.query(REPORT).deleteMany({ where: { edition: { documentId: edition.documentId } } }),
          await strapi.db.query(MESSAGE).deleteMany({ where: { conversation: { edition: { documentId: edition.documentId } } } }),
          await strapi.db.query(CONVERSATION).deleteMany({ where: scope }),
          await strapi.db.query(MEETING).deleteMany({ where: scope }),
          await strapi.db.query(MAGIC_TOKEN).deleteMany({ where: inEdition }),
          await strapi.db.query(CALENDAR_FEED).deleteMany({ where: inEdition }),
          await strapi.db.query(EMAIL_LOG).deleteMany({ where: inEdition }),
          await strapi.db.query(ERASED_EMAIL).deleteMany({ where: scope }),
          await strapi.db.query(ATTENDEE).deleteMany({ where: scope }),
        ];
        for (const { photo } of attendees) if (photo) await removeFile(photo);
        if (attendees.length || counts.some(({ count }) => count)) editions.push(edition.slug);
      }
      return { logs: { emailLogs, syncRuns }, editions };
    },
  };
};
