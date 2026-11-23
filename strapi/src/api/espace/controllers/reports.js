'use strict';

const { requireOrganizer, requireSession } = require('../lib/guards');

const service = () => strapi.service('api::espace.reports');

module.exports = {
  // POST /api/espace/conversations/:id/messages/:messageId/report (session): F-75 { reason } -> 201
  report: async (ctx) => {
    ctx.body = await service().report(requireSession(ctx), ctx.params.id, ctx.params.messageId, ctx.request.body);
    ctx.status = 201;
  },

  // GET /api/espace/admin/:edition/reports (organizer): R-63
  list: async (ctx) => {
    requireOrganizer(ctx, ctx.params.edition);
    ctx.body = await service().list(ctx.params.edition);
  },

  // POST /api/espace/admin/:edition/reports/:id/handle (organizer): R-63
  handle: async (ctx) => {
    requireOrganizer(ctx, ctx.params.edition);
    ctx.body = await service().handle(ctx.params.edition, ctx.params.id);
  },
};
