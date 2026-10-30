'use strict';

// Meeting routes (E5, E6), served under /api/espace. Strapi loads every file of this folder (A-20).
const config = { auth: false, middlewares: ['api::espace.context'] };

module.exports = {
  routes: [
    { method: 'GET', path: '/espace/slots', handler: 'meetings.slots', config },
    { method: 'POST', path: '/espace/meetings', handler: 'meetings.create', config },
    { method: 'GET', path: '/espace/meetings', handler: 'meetings.list', config },
    { method: 'GET', path: '/espace/meetings.ics', handler: 'meetings.calendar', config },
    { method: 'POST', path: '/espace/meetings/:id/accept', handler: 'meetings.accept', config },
    { method: 'POST', path: '/espace/meetings/:id/decline', handler: 'meetings.decline', config },
    { method: 'POST', path: '/espace/meetings/:id/counter', handler: 'meetings.counter', config },
    { method: 'POST', path: '/espace/meetings/:id/cancel', handler: 'meetings.cancel', config },
  ],
};
