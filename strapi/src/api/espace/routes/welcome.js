'use strict';

// `welcome` e-mails and state of the service (organizer), served under /api/espace. Strapi loads every file of this folder (A-20).
const config = { auth: false, middlewares: ['api::espace.context'] };

module.exports = {
  routes: [
    { method: 'POST', path: '/espace/admin/:edition/welcome/preview', handler: 'welcome.preview', config },
    { method: 'POST', path: '/espace/admin/:edition/welcome/send', handler: 'welcome.send', config },
    { method: 'GET', path: '/espace/admin/:edition/service', handler: 'service-status.status', config },
  ],
};
