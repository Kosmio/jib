'use strict';

// GET /api/espace/editions/:slug/program (public, F-80, F-81): the session, when there is one, only decides which speakers link to a profile.
module.exports = {
  show: async (ctx) => {
    ctx.body = await strapi.service('api::espace.program').show(ctx.params.slug, { viewer: ctx.state.espace });
  },
};
