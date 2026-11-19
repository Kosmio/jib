'use strict';

// Participant space routes, served under /api/espace (06-api.md).
// No createCoreRouter: no CRUD route is generated for the api::espace.* types (A-02).
// Other route files of this folder (sync, auth) are loaded by Strapi as well (A-20).
const config = { auth: false, middlewares: ['api::espace.context'] };

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/espace/health',
      handler: 'health.check',
      config: {
        auth: false,
      },
    },
    { method: 'GET', path: '/espace/editions/:slug', handler: 'editions.show', config },
    { method: 'POST', path: '/espace/admin/:edition/slots/regenerate', handler: 'slots.regenerate', config },
  ],
};
