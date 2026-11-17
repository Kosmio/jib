'use strict';

// Meetings and blocks of the organizer dashboard (E9, F-139 to F-141), served under /api/espace. Strapi loads every file of this folder (A-20).
const config = { auth: false, middlewares: ['api::espace.context'] };

module.exports = {
  routes: [
    { method: 'GET', path: '/espace/admin/:edition/meetings', handler: 'admin-meetings.list', config },
    { method: 'POST', path: '/espace/admin/:edition/meetings/:id/cancel', handler: 'admin-meetings.cancel', config },
    { method: 'POST', path: '/espace/admin/:edition/meetings/:id/move', handler: 'admin-meetings.move', config },
    { method: 'PUT', path: '/espace/admin/:edition/slots/:id/blocks', handler: 'admin-meetings.setBlocks', config },
  ],
};
