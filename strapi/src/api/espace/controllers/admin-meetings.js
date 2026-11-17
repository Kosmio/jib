'use strict';

const { requireOrganizer } = require('../lib/guards');

const service = () => strapi.service('api::espace.admin-meetings');

module.exports = {
  // GET /api/espace/admin/:edition/meetings (organizer): F-139
  list: async (ctx) => {
    requireOrganizer(ctx, ctx.params.edition);
    ctx.body = await service().list(ctx.params.edition);
  },

  // POST /api/espace/admin/:edition/meetings/:id/cancel (organizer): F-140 { reason? }
  cancel: async (ctx) => {
    requireOrganizer(ctx, ctx.params.edition);
    ctx.body = await service().cancel(ctx.params.edition, ctx.params.id, ctx.request.body);
  },

  // POST /api/espace/admin/:edition/meetings/:id/move (organizer): F-141 { table }
  move: async (ctx) => {
    requireOrganizer(ctx, ctx.params.edition);
    ctx.body = await service().move(ctx.params.edition, ctx.params.id, ctx.request.body);
  },

  // PUT /api/espace/admin/:edition/slots/:id/blocks (organizer): F-141, R-90 { blockedTables, closed }
  setBlocks: async (ctx) => {
    requireOrganizer(ctx, ctx.params.edition);
    ctx.body = await service().setBlocks(ctx.params.edition, ctx.params.id, ctx.request.body);
  },
};
