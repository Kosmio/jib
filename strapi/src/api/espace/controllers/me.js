'use strict';

const { requireSession } = require('../lib/guards');

const me = () => strapi.service('api::espace.me');

// The attendee always comes from the session, never from the request: a participant reaches no other profile (NF-01).
module.exports = {
  // GET /api/espace/me (session)
  show: async (ctx) => {
    ctx.body = await me().show(requireSession(ctx));
  },

  // PATCH /api/espace/me (session)
  update: async (ctx) => {
    ctx.body = await me().update(requireSession(ctx), ctx.request.body);
  },

  // PUT /api/espace/me/consent (session)
  consent: async (ctx) => {
    ctx.body = await me().setConsent(requireSession(ctx), ctx.request.body);
  },

  // POST /api/espace/me/photo (session): multipart, field `photo` (F-30, A-35)
  photo: async (ctx) => {
    ctx.body = await me().setPhoto(requireSession(ctx), ctx.request.files?.photo);
  },
};
