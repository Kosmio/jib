'use strict';

// Program (E8, public) and dashboard (E9, organizer) routes, served under /api/espace. Strapi loads every file of this folder (A-20).
const config = { auth: false, middlewares: ['api::espace.context'] };

module.exports = {
  routes: [
    { method: 'GET', path: '/espace/editions/:slug/program', handler: 'program.show', config },
    { method: 'GET', path: '/espace/admin/:edition/stats', handler: 'stats.show', config },
  ],
};
