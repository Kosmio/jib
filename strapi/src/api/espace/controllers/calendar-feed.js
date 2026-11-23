'use strict';

const { EspaceError } = require('../lib/errors');
const { requireSession } = require('../lib/guards');

const service = () => strapi.service('api::espace.calendar-feed');

module.exports = {
  // POST /api/espace/me/calendar-feed (session): I-42, creates or regenerates the feed -> 201 { path, createdAt }, the only time the token is given.
  create: async (ctx) => {
    ctx.set('Cache-Control', 'private, no-store');
    ctx.body = await service().create(requireSession(ctx));
    ctx.status = 201;
  },

  // DELETE /api/espace/me/calendar-feed (session): I-42 -> { revoked }.
  revoke: async (ctx) => {
    ctx.body = await service().revoke(requireSession(ctx));
  },

  // GET /api/espace/calendar/{token}.ics (public): I-42. 404 FEED_NOT_FOUND for any invalid token, 429 over 30 requests a minute per IP.
  show: async (ctx) => {
    // NF-55: strapi::logger and the error log of the context middleware write the path once the response is sent: without the token.
    ctx.url = '/api/espace/calendar/:token.ics';
    ctx.set('Cache-Control', 'private, no-store');
    ctx.set('Referrer-Policy', 'no-referrer');
    ctx.set('X-Robots-Tag', 'noindex');
    const file = String(ctx.params.file);
    if (!file.endsWith('.ics')) throw new EspaceError(404, 'FEED_NOT_FOUND', 'Ce flux n’est plus valable.');
    const { filename, body } = await service().read({ token: file.slice(0, -4), ip: ctx.request.ip });
    ctx.set('Content-Type', 'text/calendar; charset=utf-8');
    ctx.set('Content-Disposition', `inline; filename="${filename}"`);
    ctx.body = body;
  },
};
