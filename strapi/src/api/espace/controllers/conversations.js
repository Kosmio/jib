'use strict';

const { requireSession } = require('../lib/guards');

// The conversations always come from the session of the viewer: a stranger gets a 404 (NF-01, R-63).
module.exports = {
  // GET /api/espace/conversations (session)
  list: async (ctx) => {
    ctx.body = await strapi.service('api::espace.conversations').list(requireSession(ctx));
  },

  // POST /api/espace/conversations (session): 200 for the existing conversation of the pair, 201 for a new one.
  open: async (ctx) => {
    const { id, created } = await strapi.service('api::espace.conversations').open(requireSession(ctx), ctx.request.body);
    ctx.status = created ? 201 : 200;
    ctx.body = { id };
  },

  // GET /api/espace/conversations/:id/messages?after= (session): marks the received messages read.
  thread: async (ctx) => {
    ctx.body = await strapi.service('api::espace.conversations').thread(requireSession(ctx), ctx.params.id, { after: ctx.query.after });
  },

  // POST /api/espace/conversations/:id/messages (session)
  send: async (ctx) => {
    ctx.body = await strapi.service('api::espace.conversations').send(requireSession(ctx), ctx.params.id, ctx.request.body);
    ctx.status = 201;
  },
};
