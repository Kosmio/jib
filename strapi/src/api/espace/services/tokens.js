'use strict';

const { generateCode, generateToken, hashCode, hashToken } = require('../lib/tokens');

const DAY_MS = 24 * 60 * 60 * 1000;

module.exports = ({ strapi }) => ({
  /** Link token of an attendee (I-20, I-21) -> the token in clear, which only leaves in the e-mail. Only its hash is stored. */
  async issueLink(attendeeDocumentId, { ttlMinutes = 30, ip, now = new Date() } = {}) {
    const token = generateToken();
    await strapi.documents('api::espace.magic-token').create({
      data: {
        attendee: { documentId: attendeeDocumentId },
        kind: 'link',
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + ttlMinutes * 60 * 1000),
        ip,
      },
    });
    return token;
  },

  /**
   * I-44: link token of a login request, with its six-digit code -> { token, code }, both in clear, which only leave in the e-mail.
   * The code is a second row bound to the link (see hashCode): consuming one invalidates the other (services/auth.js).
   */
  async issueLoginLink(attendeeDocumentId, { ttlMinutes = 30, ip, now = new Date(), secret } = {}) {
    const documents = strapi.documents('api::espace.magic-token');
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);
    const token = generateToken();
    const link = await documents.create({ data: { attendee: { documentId: attendeeDocumentId }, kind: 'link', tokenHash: hashToken(token), expiresAt, ip } });
    const code = generateCode();
    await documents.create({
      data: { attendee: { documentId: attendeeDocumentId }, kind: 'link', tokenHash: hashCode(code, { linkDocumentId: link.documentId, secret }), expiresAt, ip },
    });
    return { token, code };
  },

  /**
   * I-20, A-21: deletes the link and session tokens expired for more than `graceDays` days -> the number deleted.
   * The grace keeps the "expired link, address prefilled" state of A-18 for a week.
   */
  async purgeExpired({ now = new Date(), graceDays = 7 } = {}) {
    const { count } = await strapi.db.query('api::espace.magic-token').deleteMany({
      where: { expiresAt: { $lt: new Date(now.getTime() - graceDays * DAY_MS) } },
    });
    return count;
  },
});
