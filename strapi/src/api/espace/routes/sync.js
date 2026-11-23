'use strict';

// HelloAsso synchronization routes (organizer), served under /api/espace. Strapi loads every file of this folder (A-20).
const config = { auth: false, middlewares: ['api::espace.context'] };

module.exports = {
  routes: [
    { method: 'POST', path: '/espace/admin/:edition/sync', handler: 'sync.run', config },
    { method: 'GET', path: '/espace/admin/:edition/sync-runs', handler: 'sync.list', config },
  ],
};
