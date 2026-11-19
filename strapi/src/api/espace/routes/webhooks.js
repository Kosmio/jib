'use strict';

// HelloAsso notifications (I-13), served under /api/espace. Strapi loads every file of this folder (A-20).
// No context middleware: HelloAsso sends no Origin and no session, and the body is never trusted (the order is read again).
const config = { auth: false };

module.exports = {
  routes: [{ method: 'POST', path: '/espace/webhooks/helloasso', handler: 'webhooks.helloasso', config }],
};
