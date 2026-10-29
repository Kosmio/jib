'use strict';

const { requireSession } = require('../lib/guards');

// The attendee always comes from the session, never from the request: a participant reaches no other profile (NF-01).
module.exports = {
  // GET /api/espace/me (session)
  show: (ctx) => {
    ctx.body = strapi.service('api::espace.me').toMe(requireSession(ctx));
  },

  // PATCH /api/espace/me (session)
  update: async (ctx) => {
    ctx.body = await strapi.service('api::espace.me').update(requireSession(ctx), ctx.request.body);
  },

  // PUT /api/espace/me/consent (session)
  consent: async (ctx) => {
    ctx.body = await strapi.service('api::espace.me').setConsent(requireSession(ctx), ctx.request.body);
  },
};
