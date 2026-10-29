'use strict';

const { generateToken, hashToken } = require('../lib/tokens');

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
});
