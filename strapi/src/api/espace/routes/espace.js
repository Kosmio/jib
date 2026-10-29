'use strict';

// Participant space routes, served under /api/espace (06-api.md).
// No createCoreRouter: no CRUD route is generated for the api::espace.* types (A-02).
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
  ],
};
