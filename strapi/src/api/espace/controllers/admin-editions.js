'use strict';

const { EspaceError } = require('../lib/errors');
const { requireOrganizer, requireSession } = require('../lib/guards');
const { sessionCookieOptions } = require('../lib/session');

/** Any organizer session (of the edition it was opened for): the lists and the switch work from there. */
function organizerSession(ctx) {
  const session = requireSession(ctx);
  if (!session.isOrganizer) throw new EspaceError(403, 'FORBIDDEN', 'Accès réservé aux organisateurs.');
  return session;
}

module.exports = {
  // GET /api/espace/admin/editions (organizer): the editions that can be piloted, [{ slug, title, date, city, current }].
  list: async (ctx) => {
    ctx.body = await strapi.service('api::espace.admin-editions').list(organizerSession(ctx));
  },

  // POST /api/espace/admin/:edition/switch (organizer of the target): new session cookie, then 303 to the target's dashboard (form without JavaScript).
  switch: async (ctx) => {
    const session = organizerSession(ctx);
    const { publicUrl } = strapi.config.get('server.espace');
    // A-25: Koa refuses a Secure cookie on a request it sees in http ; checked before any session is created.
    if (!ctx.request.secure && sessionCookieOptions({ publicUrl, maxAgeMs: 0 }).secure) {
      throw new EspaceError(400, 'INSECURE_REQUEST', 'Cette demande doit passer par une connexion sécurisée.');
    }
    const opened = await strapi.service('api::espace.admin-editions').switchTo(session, ctx.params.edition, { ip: ctx.request.ip });
    if (opened) strapi.service('api::espace.auth').setCookie(ctx, opened.sessionToken);
    ctx.status = 303;
    ctx.set('Location', `${publicUrl.replace(/\/+$/, '')}/espace/${encodeURIComponent(ctx.params.edition)}/organisateur`);
  },

  // POST /api/espace/admin/:edition/duplicate (organizer of the model): { title, slug, date } -> 201 { slug } ; 400 VALIDATION, 409 SLUG_TAKEN.
  duplicate: async (ctx) => {
    requireOrganizer(ctx, ctx.params.edition);
    const source = await strapi.service('api::espace.editions').findPublished(ctx.params.edition);
    if (!source) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');
    const body = ctx.request.body && typeof ctx.request.body === 'object' ? ctx.request.body : {};
    ctx.body = await strapi.service('api::espace.admin-editions').duplicate(source, body);
    ctx.status = 201;
  },
};
