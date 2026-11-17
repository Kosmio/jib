'use strict';

// Editions of the dashboard (V5-C, E9), served under /api/espace. Strapi loads every file of this folder (A-20).
const config = { auth: false, middlewares: ['api::espace.context'] };

module.exports = {
  routes: [
    { method: 'GET', path: '/espace/admin/editions', handler: 'admin-editions.list', config },
    { method: 'POST', path: '/espace/admin/:edition/switch', handler: 'admin-editions.switch', config },
    { method: 'POST', path: '/espace/admin/:edition/duplicate', handler: 'admin-editions.duplicate', config },
  ],
};
