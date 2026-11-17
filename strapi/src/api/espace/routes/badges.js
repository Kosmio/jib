'use strict';

// Badges (organizer) served under /api/espace. Strapi loads every file of this folder (A-20).
const config = { auth: false, middlewares: ['api::espace.context'] };

module.exports = {
  routes: [
    { method: 'POST', path: '/espace/admin/:edition/badges', handler: 'badges.generate', config },
    { method: 'GET', path: '/espace/admin/:edition/attendees/:id/badge', handler: 'badges.show', config },
    { method: 'POST', path: '/espace/admin/:edition/attendees/:id/card-token/regenerate', handler: 'badges.regenerate', config },
  ],
};
