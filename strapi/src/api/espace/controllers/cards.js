'use strict';

module.exports = {
  // GET /api/espace/cards/:edition/:token (public): F-95, R-80 to R-84, NF-54, NF-57. 404 CARD_NOT_FOUND for any invalid token, 429 over 30 requests a minute per IP.
  show: async (ctx) => {
    const { edition, token } = ctx.params;
    // NF-55: strapi::logger and the error log of the context middleware write the path once the response is sent: without the token.
    ctx.url = `/api/espace/cards/${encodeURIComponent(edition)}/:token`;
    ctx.set('Cache-Control', 'private, no-store');
    ctx.set('Referrer-Policy', 'strict-origin');
    ctx.set('X-Robots-Tag', 'noindex');
    ctx.body = await strapi.service('api::espace.cards').show({ slug: edition, token, ip: ctx.request.ip });
  },
};
