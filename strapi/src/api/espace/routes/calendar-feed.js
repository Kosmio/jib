'use strict';

// Personal calendar subscription (I-42), served under /api/espace. Strapi loads every file of this folder (A-20).
const config = { auth: false, middlewares: ['api::espace.context'] };

module.exports = {
  routes: [
    { method: 'POST', path: '/espace/me/calendar-feed', handler: 'calendar-feed.create', config },
    { method: 'DELETE', path: '/espace/me/calendar-feed', handler: 'calendar-feed.revoke', config },
    // `:file` is « {token}.ics » ; the controller strips the extension.
    { method: 'GET', path: '/espace/calendar/:file', handler: 'calendar-feed.show', config },
  ],
};
