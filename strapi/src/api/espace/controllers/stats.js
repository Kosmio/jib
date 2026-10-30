'use strict';

const { EspaceError } = require('../lib/errors');
const { requireOrganizer } = require('../lib/guards');

module.exports = {
  // GET /api/espace/admin/:edition/stats (organizer, F-90): counts only, never the content of a message (R-63).
  show: async (ctx) => {
    requireOrganizer(ctx, ctx.params.edition);
    const edition = await strapi.service('api::espace.editions').findPublished(ctx.params.edition);
    if (!edition) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');
    ctx.body = await strapi.service('api::espace.stats').compute(edition);
  },
};
