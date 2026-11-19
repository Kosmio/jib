'use strict';

// "Édition" screen of the organizer interface (15-administration.md, AD-1), served under /api/espace. Strapi loads every file of this folder (A-20).
const config = { auth: false, middlewares: ['api::espace.context'] };
const base = '/espace/admin/:edition';

module.exports = {
  routes: [
    { method: 'GET', path: `${base}/settings`, handler: 'admin-settings.show', config },
    { method: 'PATCH', path: `${base}/settings`, handler: 'admin-settings.update', config },
    { method: 'POST', path: `${base}/helloasso/test`, handler: 'admin-settings.testHelloAsso', config },
    { method: 'PATCH', path: `${base}/sequences/:id/break`, handler: 'admin-settings.setBreak', config },
  ],
};
