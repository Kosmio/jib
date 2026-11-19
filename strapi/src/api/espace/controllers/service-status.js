'use strict';

const { EspaceError } = require('../lib/errors');
const { requireOrganizer } = require('../lib/guards');

module.exports = {
  // GET /api/espace/admin/:edition/service (organizer): F-106, the state of mail, HelloAsso, scheduled tasks and space.
  status: async (ctx) => {
    requireOrganizer(ctx, ctx.params.edition);
    const edition = await strapi.service('api::espace.editions').findPublished(ctx.params.edition);
    if (!edition) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');
    ctx.body = await strapi.service('api::espace.service-status').status(edition);
  },
};
