'use strict';

const { EspaceError } = require('../lib/errors');
const { requireOrganizer } = require('../lib/guards');

async function organizerEdition(ctx) {
  requireOrganizer(ctx, ctx.params.edition);
  const edition = await strapi.service('api::espace.editions').findPublished(ctx.params.edition);
  if (!edition) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');
  return edition;
}

module.exports = {
  // POST /api/espace/admin/:edition/welcome/preview (organizer): F-105, { recipients, sampleHtml }.
  preview: async (ctx) => {
    ctx.body = await strapi.service('api::espace.welcome').preview(await organizerEdition(ctx));
  },

  // POST /api/espace/admin/:edition/welcome/send (organizer): F-105, { sent, failed, startedAt } ; 409 OUTSIDE_SENDING_HOURS.
  send: async (ctx) => {
    ctx.body = await strapi.service('api::espace.welcome').send(await organizerEdition(ctx));
  },
};
