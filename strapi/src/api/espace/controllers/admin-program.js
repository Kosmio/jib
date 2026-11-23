'use strict';

const { EspaceError } = require('../lib/errors');
const { requireOrganizer } = require('../lib/guards');

const program = () => strapi.service('api::espace.admin-program');
const body = (ctx) => (ctx.request.body && typeof ctx.request.body === 'object' ? ctx.request.body : {});

/** Organizer of the edition of the URL (403 otherwise, NF-71), then its published edition. */
async function organizerEdition(ctx) {
  requireOrganizer(ctx, ctx.params.edition);
  const edition = await strapi.service('api::espace.editions').findPublished(ctx.params.edition);
  if (!edition) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');
  return edition;
}

module.exports = {
  // GET /program (organizer): the draft program with the state of each document (F-164).
  show: async (ctx) => {
    ctx.body = await program().read(await organizerEdition(ctx));
  },
  // POST /program/publish (organizer): D-22.
  publish: async (ctx) => {
    ctx.body = await program().publish(await organizerEdition(ctx));
  },
  // POST /sequences (organizer): F-160 ; 201 with the program.
  createSequence: async (ctx) => {
    ctx.body = await program().createSequence(await organizerEdition(ctx), body(ctx));
    ctx.status = 201;
  },
  // PATCH /sequences/:id (organizer): F-160, F-161, F-165, R-93, R-94, NF-75.
  updateSequence: async (ctx) => {
    ctx.body = await program().updateSequence(await organizerEdition(ctx), ctx.params.id, body(ctx));
  },
  // DELETE /sequences/:id (organizer): R-93.
  deleteSequence: async (ctx) => {
    ctx.body = await program().deleteSequence(await organizerEdition(ctx), ctx.params.id);
  },
  // POST /sequences/:id/interventions (organizer): F-162 ; 201 with the program.
  createIntervention: async (ctx) => {
    ctx.body = await program().createIntervention(await organizerEdition(ctx), ctx.params.id, body(ctx));
    ctx.status = 201;
  },
  // PATCH /interventions/:id (organizer): F-161, F-162, NF-75.
  updateIntervention: async (ctx) => {
    ctx.body = await program().updateIntervention(await organizerEdition(ctx), ctx.params.id, body(ctx));
  },
  // DELETE /interventions/:id (organizer): R-95.
  deleteIntervention: async (ctx) => {
    ctx.body = await program().deleteIntervention(await organizerEdition(ctx), ctx.params.id);
  },
  // POST /intervenants (organizer): F-163 ; 201 { id }.
  createIntervenant: async (ctx) => {
    ctx.body = await program().createIntervenant(await organizerEdition(ctx), body(ctx));
    ctx.status = 201;
  },
  // PATCH /intervenants/:id (organizer): F-163, NF-75.
  updateIntervenant: async (ctx) => {
    ctx.body = await program().updateIntervenant(await organizerEdition(ctx), ctx.params.id, body(ctx));
  },
};
