'use strict';

const { requireSession } = require('../lib/guards');

const service = () => strapi.service('api::espace.meetings');

// The viewer always comes from the session, never from the request ; the edition is the one of the session (NF-01).
module.exports = {
  // GET /api/espace/slots?target=p:{id}|x:{id} (session): E5, F-50, R-12
  slots: async (ctx) => {
    ctx.body = await service().slotsFor(requireSession(ctx), ctx.query.target);
  },

  // POST /api/espace/meetings (session): F-52, R-11, R-19 -> 201 Meeting
  create: async (ctx) => {
    ctx.body = await service().create(requireSession(ctx), ctx.request.body);
    ctx.status = 201;
  },

  // GET /api/espace/meetings (session): E6
  list: async (ctx) => {
    ctx.body = await service().list(requireSession(ctx));
  },

  // POST /api/espace/meetings/:id/accept (session, target or representative): F-60
  accept: async (ctx) => {
    ctx.body = await service().accept(requireSession(ctx), ctx.params.id);
  },

  // POST /api/espace/meetings/:id/decline (session, target or representative): F-61
  decline: async (ctx) => {
    ctx.body = await service().decline(requireSession(ctx), ctx.params.id, ctx.request.body);
  },

  // POST /api/espace/meetings/:id/counter (session, target): F-62, A-31 -> 201 Meeting (the new request)
  counter: async (ctx) => {
    ctx.body = await service().counter(requireSession(ctx), ctx.params.id, ctx.request.body);
    ctx.status = 201;
  },

  // POST /api/espace/meetings/:id/cancel (session, a party): F-63, R-16
  cancel: async (ctx) => {
    ctx.body = await service().cancel(requireSession(ctx), ctx.params.id, ctx.request.body);
  },

  // GET /api/espace/meetings.ics (session): F-65, I-40
  calendar: async (ctx) => {
    const { filename, body } = await service().calendar(requireSession(ctx));
    ctx.set('Content-Type', 'text/calendar; charset=utf-8');
    ctx.set('Content-Disposition', `attachment; filename="${filename}"`);
    ctx.set('Cache-Control', 'private, no-store');
    ctx.body = body;
  },
};
