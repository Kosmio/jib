'use strict';

const { EspaceError } = require('../lib/errors');
const { safeNextPath } = require('../lib/session');

const isForm = (ctx) => Boolean(ctx.is('application/x-www-form-urlencoded'));
const bodyOf = (ctx) => (ctx.request.body && typeof ctx.request.body === 'object' ? ctx.request.body : {});
const text = (value) => (typeof value === 'string' && value ? value : undefined);

/** 303 to an absolute URL on PUBLIC_URL: the form was sent to Strapi, a relative path would stay on its origin (06-api.md). */
function see(ctx, path) {
  ctx.status = 303;
  ctx.set('Location', `${strapi.config.get('server.espace').publicUrl.replace(/\/+$/, '')}${path}`);
}

// Forms without JavaScript (NF-31) get a 303 to the page that fits ; the JSON clients get a status and a body.
module.exports = {
  // POST /api/espace/auth/request-link (public): F-01, F-02, NF-03
  requestLink: async (ctx) => {
    const { editionSlug, email } = bodyOf(ctx);
    try {
      strapi.service('api::espace.auth').requestLink({ editionSlug, email, ip: ctx.request.ip });
    } catch (error) {
      const failure = error instanceof EspaceError && { RATE_LIMITED: 'trop', EMAIL_INVALID: 'email' }[error.code];
      if (!isForm(ctx) || !failure) throw error;
      return see(ctx, `/espace/${encodeURIComponent(editionSlug)}/connexion?erreur=${failure}`);
    }

    if (isForm(ctx)) return see(ctx, `/espace/${encodeURIComponent(editionSlug)}/connexion?envoye=1`);
    ctx.status = 202;
    ctx.body = { status: 'accepted' };
  },

  // GET /api/espace/auth/link?token= (public): A-18, always 200
  link: async (ctx) => {
    const { token } = ctx.query;
    // strapi::logger writes ctx.url once the response is sent: without its query string, the clear token stays out of the log.
    ctx.url = ctx.path;
    ctx.body = await strapi.service('api::espace.auth').linkState(token);
  },

  // POST /api/espace/auth/verify (public): F-03, F-04, I-20 to I-22
  verify: async (ctx) => {
    const { token, next } = bodyOf(ctx);
    const auth = strapi.service('api::espace.auth');

    let opened;
    try {
      opened = await auth.verify(token, { ip: ctx.request.ip });
    } catch (error) {
      if (!isForm(ctx) || !(error instanceof EspaceError) || error.code !== 'TOKEN_INVALID') throw error;
      // The verification page shows the invalid state (A-18): same URL, no address in it.
      const query = new URLSearchParams({ ...(text(token) && { token }), ...(text(next) && { next }) }).toString();
      return see(ctx, `/espace/verifier${query && `?${query}`}`);
    }

    const { attendee, edition, isOrganizer, sessionToken } = opened;
    auth.setCookie(ctx, sessionToken);
    const redirect = attendee.consentAt ? safeNextPath(next, edition.slug) : `/espace/${edition.slug}/bienvenue`;
    if (isForm(ctx)) return see(ctx, redirect);
    ctx.body = { me: strapi.service('api::espace.me').toMe({ attendee, edition, isOrganizer }), redirect };
  },

  // POST /api/espace/auth/logout (session): the same answer without a session
  logout: async (ctx) => {
    await strapi.service('api::espace.auth').logout(ctx);
    if (!isForm(ctx)) {
      ctx.status = 204;
      return;
    }
    const slug = text(bodyOf(ctx).editionSlug) ?? ctx.state.espace?.edition.slug;
    see(ctx, slug ? `/espace/${encodeURIComponent(slug)}/connexion?deconnecte=1` : '/');
  },
};
