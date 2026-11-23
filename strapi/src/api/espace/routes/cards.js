'use strict';

// Public card of an attendee, reached by the QR code of the badge (F-95), served under /api/espace. Strapi loads every file of this folder (A-20).
const config = { auth: false, middlewares: ['api::espace.context'] };

module.exports = {
  routes: [{ method: 'GET', path: '/espace/cards/:edition/:token', handler: 'cards.show', config }],
};
