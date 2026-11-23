'use strict';

const { EspaceError } = require('../lib/errors');
const { requireOrganizer } = require('../lib/guards');

const people = () => strapi.service('api::espace.admin-people');
const body = (ctx) => (ctx.request.body && typeof ctx.request.body === 'object' ? ctx.request.body : {});

/** Organizer of the edition of the URL (403 otherwise, NF-71), then its published edition. */
async function organizerEdition(ctx) {
  const session = requireOrganizer(ctx, ctx.params.edition);
  const edition = await strapi.service('api::espace.editions').findPublished(ctx.params.edition);
  if (!edition) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');
  return { edition, session };
}

module.exports = {
  // GET /api/espace/admin/:edition/organisations?q=&exhibitors=true (organizer): F-169, F-172.
  listOrganisations: async (ctx) => {
    ctx.body = await people().listOrganisations((await organizerEdition(ctx)).edition, ctx.query);
  },
  // POST /api/espace/admin/:edition/organisations (organizer): 201 ; 409 SIMILAR_ORGANISATIONS { candidates } (T-83).
  createOrganisation: async (ctx) => {
    ctx.body = await people().createOrganisation((await organizerEdition(ctx)).edition, body(ctx));
    ctx.status = 201;
  },
  // PATCH /api/espace/admin/:edition/organisations/:id (organizer): fields and `exhibitor: { enabled, standNumber }`.
  updateOrganisation: async (ctx) => {
    ctx.body = await people().updateOrganisation((await organizerEdition(ctx)).edition, ctx.params.id, body(ctx));
  },
  // GET /api/espace/admin/:edition/intervenants?q= (organizer): F-163.
  searchIntervenants: async (ctx) => {
    ctx.body = await people().searchIntervenants((await organizerEdition(ctx)).edition, ctx.query);
  },
  // GET /api/espace/admin/:edition/attendees/:id/roles (organizer): D-20.
  getRoles: async (ctx) => {
    ctx.body = await people().getRoles((await organizerEdition(ctx)).edition, ctx.params.id);
  },
  // PATCH /api/espace/admin/:edition/attendees/:id/roles (organizer): F-171, F-173, R-97.
  setRoles: async (ctx) => {
    const { edition, session } = await organizerEdition(ctx);
    ctx.body = await people().setRoles(edition, ctx.params.id, body(ctx), { session });
  },
};
