'use strict';

const { requireSession } = require('../lib/guards');

const directory = () => strapi.service('api::espace.directory');
const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

// Everything is read for the edition of the session: an id of another edition is a 404 (NF-01).
module.exports = {
  // GET /api/espace/directory?q&type&topics&cursor (session): F-40 to F-43
  list: async (ctx) => {
    const { q, type, topics, cursor } = ctx.query;
    ctx.body = await directory().search(requireSession(ctx), {
      q: text(q, 100),
      type: text(type, 20),
      topicIds: text(topics, 1000).split(',').filter(Boolean).slice(0, 20),
      cursor: text(cursor, 10),
    });
  },

  // GET /api/espace/directory/p/:id (session): R-41, R-42
  profile: async (ctx) => {
    ctx.body = await directory().profile(requireSession(ctx), ctx.params.id);
  },

  // GET /api/espace/directory/x/:id (session)
  exhibitor: async (ctx) => {
    ctx.body = await directory().exhibitor(requireSession(ctx), ctx.params.id);
  },

  // GET /api/espace/suggestions (session): R-50
  suggestions: async (ctx) => {
    ctx.body = await directory().suggestions(requireSession(ctx));
  },

  // GET /api/espace/editions/:slug/topics (public)
  topics: async (ctx) => {
    ctx.body = await directory().topics(ctx.params.slug);
  },
};
