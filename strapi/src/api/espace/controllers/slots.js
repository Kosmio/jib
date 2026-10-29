'use strict';

const { EspaceError } = require('../lib/errors');
const { requireOrganizer } = require('../lib/guards');

module.exports = {
  // POST /api/espace/admin/:edition/slots/regenerate (organizer): R-02 report.
  regenerate: async (ctx) => {
    requireOrganizer(ctx, ctx.params.edition);
    const edition = await strapi.service('api::espace.editions').findPublished(ctx.params.edition);
    if (!edition) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');
    ctx.body = await strapi.service('api::espace.slots').regenerate(edition.documentId);
  },
};
