'use strict';

// Message reports (F-75, R-63) served under /api/espace. Strapi loads every file of this folder (A-20).
const config = { auth: false, middlewares: ['api::espace.context'] };

module.exports = {
  routes: [
    { method: 'POST', path: '/espace/conversations/:id/messages/:messageId/report', handler: 'reports.report', config },
    { method: 'GET', path: '/espace/admin/:edition/reports', handler: 'reports.list', config },
    { method: 'POST', path: '/espace/admin/:edition/reports/:id/handle', handler: 'reports.handle', config },
  ],
};
