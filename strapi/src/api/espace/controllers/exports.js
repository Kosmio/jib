'use strict';

const { EspaceError } = require('../lib/errors');
const { requireOrganizer } = require('../lib/guards');

module.exports = {
  // GET /api/espace/admin/:edition/export/:file (organizer, F-91): `file` is participants.csv, meetings.csv, exhibitors.csv or stats.csv.
  // F-123: the pilotage links point straight at this route, so a browser with no valid session (expired) is sent to the login page, back
  // to the pilotage afterwards, instead of reading a JSON 401. Other clients (no `Accept: text/html`) keep the 401.
  show: async (ctx) => {
    if (!ctx.state.espace && /text\/html/.test(ctx.get('accept'))) {
      const slug = encodeURIComponent(String(ctx.params.edition));
      const next = encodeURIComponent(`/espace/${slug}/organisateur`);
      ctx.status = 303;
      ctx.set('Location', `${strapi.config.get('server.espace').publicUrl.replace(/\/+$/, '')}/espace/${slug}/connexion?next=${next}&expire=1`);
      ctx.set('Cache-Control', 'private, no-store');
      return;
    }
    requireOrganizer(ctx, ctx.params.edition);
    const edition = await strapi.service('api::espace.editions').findPublished(ctx.params.edition);
    if (!edition) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');

    const [, name] = /^([a-z]+)\.csv$/.exec(String(ctx.params.file)) ?? [];
    const file = name ? await strapi.service('api::espace.exports').build(edition, name) : null;
    if (!file) throw new EspaceError(404, 'EXPORT_NOT_FOUND', 'Export introuvable.');

    ctx.set('Content-Type', 'text/csv; charset=utf-8');
    ctx.set('Content-Disposition', `attachment; filename="${file.filename}"`);
    ctx.set('Cache-Control', 'private, no-store');
    ctx.body = file.body;
  },
};
