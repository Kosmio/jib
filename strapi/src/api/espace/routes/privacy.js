'use strict';

// Erasure and individual export (V5-A), served under /api/espace. Strapi loads every file of this folder (A-20).
const config = { auth: false, middlewares: ['api::espace.context'] };

module.exports = {
  routes: [
    { method: 'POST', path: '/espace/me/erase', handler: 'privacy.erase', config },
    { method: 'GET', path: '/espace/me/export', handler: 'privacy.export', config },
    { method: 'POST', path: '/espace/admin/:edition/attendees/:id/erase', handler: 'privacy.eraseAttendee', config },
  ],
};
