'use strict';

const { randomUUID } = require('node:crypto');
const { EspaceError } = require('../lib/errors');
const { isReadOnly } = require('../lib/read-only');

// NF-70: after readOnlyAt, every write of the space is refused (409 EDITION_READ_ONLY) but these: sign-in, sign-out, e-mail preferences, erasure (R-44).
// The organizer routes (/espace/admin/...) stay open, and so do the exports (GET). The unsubscription route has no context middleware.
const READ_ONLY_EXEMPT = ['/espace/auth/'];
const isEmailPrefsOnly = (ctx) => {
  const body = ctx.request.body;
  return ctx.path === '/api/espace/me' && body && typeof body === 'object' && Object.keys(body).length > 0 && Object.keys(body).every((key) => key === 'emailPrefs');
};
const isExemptFromReadOnly = (ctx) => {
  const path = ctx.path.replace(/^\/api/, '');
  // R-44: the right to erasure outlives the edition.
  return path === '/espace/me/erase' || path.startsWith('/espace/admin/') || READ_ONLY_EXEMPT.some((prefix) => path.startsWith(prefix)) || isEmailPrefsOnly(ctx);
};

/**
 * Route middleware of every participant space route (A-02), declared as 'api::espace.context'.
 *  1. gives the request an id and turns errors into { error: { code, message } } (06-api.md), logging unexpected ones (NF-50) ;
 *  2. refuses a write (anything but GET and HEAD) whose Origin is not in CORS_ORIGINS (A-05, NF-04) ;
 *  3. loads the session of the signed cookie into ctx.state.espace = { attendee, edition, session, isOrganizer }, or null.
 *  4. refuses a write of a participant once the edition is read-only (NF-70).
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
    const edition = ctx.state.espace?.edition;
    if (!['GET', 'HEAD'].includes(ctx.method) && edition && isReadOnly(edition) && !isExemptFromReadOnly(ctx)) {
      throw new EspaceError(409, 'EDITION_READ_ONLY', 'L’édition est terminée, votre espace reste consultable.');
    }
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
