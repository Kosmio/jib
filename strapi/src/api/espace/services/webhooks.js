'use strict';

const { EspaceError } = require('../lib/errors');
const { createRateLimiter } = require('../lib/rate-limit');

// NF-03: 60 notifications per minute and per IP (a group order sends one per ticket holder at most).
const WEBHOOK_IP_MAX = 60;
const ORDER_ID_PATTERN = /^[0-9]{1,15}$/;

module.exports = ({ strapi }) => {
  const limiter = createRateLimiter({ max: WEBHOOK_IP_MAX, windowMs: 60 * 1000 });
  const logLine = (error) => String(error.message).split('\n')[0];

  return {
    /**
     * POST /webhooks/helloasso (public, I-13): `{ eventType, data: { id } }`. Only an `Order` notification with a numeric order id is acted on,
     * and only for its id: the order is read again from HelloAsso and imported in the background, so the answer does not wait for it.
     * -> 'accepted' or 'ignored'. 429 RATE_LIMITED. Nothing of the body, no e-mail address and no token is logged.
     */
    receive({ body, ip }) {
      if (!limiter.hit(String(ip))) throw new EspaceError(429, 'RATE_LIMITED', 'Trop de requêtes, réessayez dans une minute.');
      const orderId = body && typeof body === 'object' && body.eventType === 'Order' ? String(body.data?.id ?? '') : '';
      if (!ORDER_ID_PATTERN.test(orderId)) return 'ignored';

      strapi
        .service('api::espace.sync')
        .importOrder(orderId)
        .then((result) => {
          if (result.errors.length) strapi.log.warn(`[webhook] order ${orderId}: ${result.errors.map(({ code }) => code).join(', ')}`);
        })
        .catch((error) => {
          // A refused order (unknown, HelloAsso down) is the next synchronization's business: the cron imports the same tickets.
          strapi.log.error(`[webhook] order ${orderId} not imported: ${logLine(error)}`);
        });
      return 'accepted';
    },
  };
};
