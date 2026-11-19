'use strict';

// GET /api/espace/editions/:slug/program (public, F-80, F-81): the session, when there is one, decides which speakers link to a profile
// and which accepted meetings (F-151) the program shows. `?now=<ISO>` simulates the clock (F-150, tests), refused in production.
module.exports = {
  show: async (ctx) => {
    const simulated = process.env.NODE_ENV === 'production' ? NaN : Date.parse(String(ctx.query.now ?? ''));
    const now = Number.isNaN(simulated) ? new Date() : new Date(simulated);
    ctx.body = await strapi.service('api::espace.program').show(ctx.params.slug, { viewer: ctx.state.espace, now });
  },
};
