'use strict';

const { EspaceError } = require('../lib/errors');
const { requireOrganizer } = require('../lib/guards');

const attendees = () => strapi.service('api::espace.admin-attendees');

/** Organizer of the edition of the URL (403 otherwise, another edition's organizer included), then its published edition. */
async function organizerEdition(ctx) {
  const session = requireOrganizer(ctx, ctx.params.edition);
  const edition = await strapi.service('api::espace.editions').findPublished(ctx.params.edition);
  if (!edition) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');
  return { edition, session };
}

module.exports = {
  // GET /api/espace/admin/:edition/attendees (organizer): F-134, { items, total, page, pageSize, pages }.
  list: async (ctx) => {
    const { edition } = await organizerEdition(ctx);
    ctx.body = await attendees().list(edition, ctx.query);
  },

  // GET /api/espace/admin/:edition/attendees/:id (organizer): F-135.
  show: async (ctx) => {
    const { edition } = await organizerEdition(ctx);
    ctx.body = await attendees().show(edition, ctx.params.id);
  },

  // POST /api/espace/admin/:edition/attendees (organizer): F-136, 201 with the sheet.
  create: async (ctx) => {
    const { edition } = await organizerEdition(ctx);
    ctx.body = await attendees().create(edition, ctx.request.body);
    ctx.status = 201;
  },

  // PATCH /api/espace/admin/:edition/attendees/:id (organizer): F-137, R-89.
  update: async (ctx) => {
    const { edition, session } = await organizerEdition(ctx);
    ctx.body = await attendees().update(edition, ctx.params.id, ctx.request.body, { session });
  },

  // POST /api/espace/admin/:edition/attendees/:id/link (organizer): F-135, { status, error, remaining } ; 429 RATE_LIMITED.
  link: async (ctx) => {
    const { edition } = await organizerEdition(ctx);
    ctx.body = await attendees().sendLink(edition, ctx.params.id);
  },

  // POST /api/espace/admin/:edition/attendees/:id/cancel (organizer): F-138.
  cancel: async (ctx) => {
    const { edition, session } = await organizerEdition(ctx);
    ctx.body = await attendees().cancel(edition, ctx.params.id, { session });
  },

  // POST /api/espace/admin/:edition/attendees/:id/restore (organizer): F-138.
  restore: async (ctx) => {
    const { edition } = await organizerEdition(ctx);
    ctx.body = await attendees().restore(edition, ctx.params.id);
  },
};
