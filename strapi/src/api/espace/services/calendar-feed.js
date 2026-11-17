'use strict';

const { EspaceError } = require('../lib/errors');
const { createRateLimiter } = require('../lib/rate-limit');
const { generateToken, hashToken } = require('../lib/tokens');

const FEED = 'api::espace.calendar-feed';
// NF-03: 30 requests per minute and per IP on the public feed (a calendar app polls a few times an hour).
const FEED_IP_MAX = 30;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// I-42: one answer for an unknown, revoked or regenerated token, a cancelled attendee and an edition that is not served.
const invalid = () => new EspaceError(404, 'FEED_NOT_FOUND', 'Ce flux n’est plus valable.');

module.exports = ({ strapi }) => {
  const limiter = createRateLimiter({ max: FEED_IP_MAX, windowMs: 60 * 1000 });

  return {
    /**
     * POST /me/calendar-feed (session): revokes the active feed of the attendee, if any, and creates a new one under the lock of the attendee.
     * -> { path, createdAt } ; the token only exists in `path` and is never readable again.
     */
    async create(session) {
      const attendeeId = session.attendee.documentId;
      const token = generateToken();
      const now = new Date();
      await strapi.service('api::espace.locks').withLock(`calendar-feed:${attendeeId}`, async () => {
        await strapi.db.query(FEED).updateMany({ where: { attendee: { documentId: attendeeId }, revokedAt: null }, data: { revokedAt: now } });
        await strapi.documents(FEED).create({ data: { attendee: { documentId: attendeeId }, tokenHash: hashToken(token) } });
      });
      return { path: `/api/espace/calendar/${token}.ics`, createdAt: now.toISOString() };
    },

    /** DELETE /me/calendar-feed (session): revokes every active feed of the attendee. Idempotent. -> { revoked } */
    async revoke(session) {
      const { count } = await strapi.db
        .query(FEED)
        .updateMany({ where: { attendee: { documentId: session.attendee.documentId }, revokedAt: null }, data: { revokedAt: new Date() } });
      return { revoked: count > 0 };
    },

    /** GET /calendar/{token}.ics (public, I-42): the .ics of the attendee the token belongs to, same content as GET /meetings.ics. -> { filename, body } */
    async read({ token, ip }) {
      if (!limiter.hit(String(ip))) throw new EspaceError(429, 'RATE_LIMITED', 'Trop de requêtes, réessayez dans une minute.');
      if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw invalid();

      const feed = await strapi.documents(FEED).findFirst({
        filters: { tokenHash: hashToken(token), revokedAt: { $null: true } },
        populate: { attendee: { populate: { edition: { fields: ['documentId'] } } } },
      });
      const attendee = feed?.attendee;
      if (attendee?.status !== 'active') throw invalid();
      const edition = await strapi.documents('api::edition.edition').findOne({ documentId: attendee.edition?.documentId, status: 'published', populate: ['lieux'] });
      // NF-52: an edition whose space is closed is not served.
      if (!edition?.participantSpaceEnabled) throw invalid();

      return strapi.service('api::espace.meetings').calendar({ attendee, edition });
    },
  };
};
