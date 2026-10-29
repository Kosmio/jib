'use strict';

const { randomUUID } = require('node:crypto');
const { EspaceError } = require('../lib/errors');

/**
 * Route middleware of every participant space route (A-02), declared as 'api::espace.context'.
 *  1. gives the request an id and turns errors into { error: { code, message } } (06-api.md), logging unexpected ones (NF-50) ;
 *  2. refuses a write (anything but GET and HEAD) whose Origin is not in CORS_ORIGINS (A-05, NF-04) ;
 *  3. loads the session of the signed cookie into ctx.state.espace = { attendee, edition, session, isOrganizer }, or null.
 *     The controllers decide with requireSession / requireOrganizer (guards.js).
 */
module.exports = (config, { strapi }) => async (ctx, next) => {
  const requestId = randomUUID();
  ctx.state.requestId = requestId;
  ctx.set('X-Request-Id', requestId);

  try {
    if (!['GET', 'HEAD'].includes(ctx.method) && !strapi.config.get('server.espace.corsOrigins').includes(ctx.get('Origin'))) {
      throw new EspaceError(403, 'ORIGIN_REFUSED', 'Origine non autorisée.');
    }
    ctx.state.espace = await strapi.service('api::espace.auth').loadSession(ctx);
    await next();
  } catch (error) {
    if (error instanceof EspaceError) {
      ctx.status = error.status;
      ctx.body = { error: { code: error.code, message: error.message, ...error.extra } };
      return;
    }
    strapi.log.error(JSON.stringify({ event: 'espace.error', requestId, method: ctx.method, path: ctx.path, error: error.message, stack: error.stack }));
    ctx.status = 500;
    ctx.body = { error: { code: 'INTERNAL', message: 'Une erreur est survenue. Réessayez dans quelques instants.', requestId } };
  }
};
