'use strict';

// Messaging routes (E7), served under /api/espace. Strapi loads every file of this folder (A-20).
const config = { auth: false, middlewares: ['api::espace.context'] };

module.exports = {
  routes: [
    { method: 'GET', path: '/espace/conversations', handler: 'conversations.list', config },
    { method: 'POST', path: '/espace/conversations', handler: 'conversations.open', config },
    { method: 'GET', path: '/espace/conversations/:id/messages', handler: 'conversations.thread', config },
    { method: 'POST', path: '/espace/conversations/:id/messages', handler: 'conversations.send', config },
  ],
};
