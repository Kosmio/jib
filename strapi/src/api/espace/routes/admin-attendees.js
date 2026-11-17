'use strict';

// Attendees in the organizer dashboard (V3-E), served under /api/espace. Strapi loads every file of this folder (A-20).
const config = { auth: false, middlewares: ['api::espace.context'] };
const base = '/espace/admin/:edition/attendees';

module.exports = {
  routes: [
    { method: 'GET', path: base, handler: 'admin-attendees.list', config },
    { method: 'POST', path: base, handler: 'admin-attendees.create', config },
    { method: 'GET', path: `${base}/:id`, handler: 'admin-attendees.show', config },
    { method: 'PATCH', path: `${base}/:id`, handler: 'admin-attendees.update', config },
    { method: 'POST', path: `${base}/:id/link`, handler: 'admin-attendees.link', config },
    { method: 'POST', path: `${base}/:id/cancel`, handler: 'admin-attendees.cancel', config },
    { method: 'POST', path: `${base}/:id/restore`, handler: 'admin-attendees.restore', config },
  ],
};
