'use strict';

const { EspaceError } = require('../lib/errors');
const { requireOrganizer } = require('../lib/guards');

const settings = () => strapi.service('api::espace.admin-settings');
const body = (ctx) => (ctx.request.body && typeof ctx.request.body === 'object' ? ctx.request.body : {});

/** Organizer of the edition of the URL (403 otherwise, another edition's organizer included, NF-71), then its published edition. */
async function organizerEdition(ctx) {
  requireOrganizer(ctx, ctx.params.edition);
  const edition = await strapi.service('api::espace.editions').findPublished(ctx.params.edition);
  if (!edition) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');
  return edition;
}

module.exports = {
  // GET /api/espace/admin/:edition/settings (organizer): F-155 to F-159, F-168, F-177 to F-180.
  show: async (ctx) => {
    ctx.body = await settings().read(await organizerEdition(ctx));
  },

  // PATCH /api/espace/admin/:edition/settings (organizer): 400 VALIDATION { fields }, 409 STALE (NF-75), FORM_CHANGE_CONFIRM (R-92), REFUSED (NF-63, NF-64).
  update: async (ctx) => {
    ctx.body = await settings().update(await organizerEdition(ctx), body(ctx));
  },

  // POST /api/espace/admin/:edition/helloasso/test (organizer): F-156, I-45 ; nothing is imported.
  testHelloAsso: async (ctx) => {
    ctx.body = await settings().testHelloAsso(await organizerEdition(ctx), body(ctx));
  },

  // PATCH /api/espace/admin/:edition/sequences/:id/break (organizer): { isBreak, updatedAt } ; F-180, R-86, R-93.
  setBreak: async (ctx) => {
    ctx.body = await settings().setBreak(await organizerEdition(ctx), ctx.params.id, body(ctx));
  },
};
