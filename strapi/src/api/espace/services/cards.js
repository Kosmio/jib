'use strict';

const { EspaceError } = require('../lib/errors');
const { ATTENDEE_CARD_POPULATE, attendeeCard, identity } = require('../lib/cards');
const { CARD_TOKEN_PATTERN, TYPE_LABELS, hashCardToken, isReduced, typeOf } = require('../lib/badges');
const { createRateLimiter } = require('../lib/rate-limit');
const { isReadOnly } = require('../lib/read-only');

const ATTENDEE = 'api::espace.attendee';
// NF-54: 30 requests per minute and per IP on the public card route.
const CARD_IP_MAX = 30;

// R-83, NF-54: one answer for an unknown, regenerated, expired or cancelled token, and for an edition that is not served.
const invalid = () => new EspaceError(404, 'CARD_NOT_FOUND', 'Cette carte n’est plus valable.');

module.exports = ({ strapi }) => {
  const limiter = createRateLimiter({ max: CARD_IP_MAX, windowMs: 60 * 1000 });
  const organizerEmails = () => strapi.config.get('server.espace').organizerEmails.map((email) => email.trim().toLowerCase());

  return {
    /**
     * GET /cards/:edition/:token (public, F-95, R-80 to R-84): the card of the attendee the token belongs to.
     * Visible profile that opened its space: the fields of R-42, never the e-mail or the phone. Otherwise the four printed fields and the type,
     * with no photo, no presentation and no topics (not even as empty keys). The token is neither logged nor returned.
     */
    async show({ slug, token, ip }) {
      if (!limiter.hit(String(ip))) throw new EspaceError(429, 'RATE_LIMITED', 'Trop de requêtes, réessayez dans une minute.');
      if (typeof token !== 'string' || !CARD_TOKEN_PATTERN.test(token)) throw invalid();

      const edition = await strapi.service('api::espace.editions').findPublished(String(slug));
      // NF-52 (closed space) ; read-only edition (R-83, NF-70).
      if (!edition?.participantSpaceEnabled || isReadOnly(edition)) throw invalid();

      const attendee = await strapi.documents(ATTENDEE).findFirst({
        filters: { cardTokenHash: hashCardToken(token), status: 'active', edition: { documentId: edition.documentId } },
        populate: ATTENDEE_CARD_POPULATE,
      });
      if (!attendee) throw invalid();

      const type = typeOf(attendee, organizerEmails());
      const { jobTitle, company } = identity(attendee);
      const card = attendeeCard(attendee);
      const printed = {
        kind: 'attendee',
        id: attendee.documentId,
        firstName: attendee.firstName,
        lastName: attendee.lastName,
        displayName: `${attendee.firstName} ${attendee.lastName}`.trim(),
        initials: card.initials,
        jobTitle,
        company,
        tag: type === 'participant' ? card.tag : type,
        type,
        typeLabel: TYPE_LABELS[type],
      };
      const reduced = isReduced(attendee, type);
      return {
        edition: { slug: edition.slug, title: edition.title, date: edition.date, city: edition.city, themeColor: edition.hero_bg_color ?? null },
        card: reduced
          ? { ...printed, reduced: true }
          : { ...printed, reduced: false, photoUrl: card.photoUrl, bio: attendee.bio ?? null, topics: card.topics, ...(card.standNumber && { standNumber: card.standNumber }) },
      };
    },
  };
};
