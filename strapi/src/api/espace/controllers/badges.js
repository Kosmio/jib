'use strict';

const { EspaceError } = require('../lib/errors');
const { requireOrganizer } = require('../lib/guards');

const badges = () => strapi.service('api::espace.badges');

async function organizerEdition(ctx) {
  requireOrganizer(ctx, ctx.params.edition);
  const edition = await strapi.service('api::espace.editions').findPublished(ctx.params.edition);
  if (!edition) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');
  return edition;
}

function sendPdf(ctx, pdf, filename, headers = {}) {
  ctx.type = 'application/pdf';
  ctx.set('Content-Disposition', `attachment; filename="${filename}"`);
  ctx.set('Cache-Control', 'private, no-store');
  for (const [name, value] of Object.entries(headers)) ctx.set(name, String(value));
  // The browser of the dashboard reads these headers from another origin (CORS).
  ctx.set('Access-Control-Expose-Headers', ['Content-Disposition', ...Object.keys(headers)].join(', '));
  ctx.body = pdf;
}

module.exports = {
  // POST /api/espace/admin/:edition/badges (organizer): F-97, { types?, sort? } -> application/pdf, X-Badges-Count and X-Badges-Reduced.
  generate: async (ctx) => {
    const edition = await organizerEdition(ctx);
    const body = ctx.request.body && typeof ctx.request.body === 'object' ? ctx.request.body : {};
    const { pdf, count, reduced } = await badges().generate(edition, { types: body.types, sort: body.sort });
    sendPdf(ctx, pdf, `badges-${edition.slug.replace(/[^a-z0-9-]/gi, '')}.pdf`, { 'X-Badges-Count': count, 'X-Badges-Reduced': reduced });
  },

  // GET /api/espace/admin/:edition/attendees/:id/badge (organizer): F-98 -> application/pdf. As for the exports (F-123), a browser whose session expired goes to the login page.
  show: async (ctx) => {
    if (!ctx.state.espace && /text\/html/.test(ctx.get('accept'))) {
      const slug = encodeURIComponent(String(ctx.params.edition));
      const next = encodeURIComponent(`/espace/${slug}/organisateur`);
      ctx.status = 303;
      ctx.set('Location', `${strapi.config.get('server.espace').publicUrl.replace(/\/+$/, '')}/espace/${slug}/connexion?next=${next}&expire=1`);
      ctx.set('Cache-Control', 'private, no-store');
      return;
    }
    const edition = await organizerEdition(ctx);
    const { pdf, filename } = await badges().single(edition, ctx.params.id);
    sendPdf(ctx, pdf, filename);
  },

  // POST /api/espace/admin/:edition/attendees/:id/card-token/regenerate (organizer): F-98, R-83 -> { regeneratedAt }.
  regenerate: async (ctx) => {
    const edition = await organizerEdition(ctx);
    ctx.body = await badges().regenerate(edition, ctx.params.id);
  },
};
