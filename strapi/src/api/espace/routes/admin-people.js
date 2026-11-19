'use strict';

// "Personnes" screen of the organizer interface (15-administration.md, AD-2), served under /api/espace. Strapi loads every file of this folder (A-20).
const config = { auth: false, middlewares: ['api::espace.context'] };
const base = '/espace/admin/:edition';

module.exports = {
  routes: [
    { method: 'GET', path: `${base}/organisations`, handler: 'admin-people.listOrganisations', config },
    { method: 'POST', path: `${base}/organisations`, handler: 'admin-people.createOrganisation', config },
    { method: 'PATCH', path: `${base}/organisations/:id`, handler: 'admin-people.updateOrganisation', config },
    { method: 'GET', path: `${base}/intervenants`, handler: 'admin-people.searchIntervenants', config },
    { method: 'GET', path: `${base}/attendees/:id/roles`, handler: 'admin-people.getRoles', config },
    { method: 'PATCH', path: `${base}/attendees/:id/roles`, handler: 'admin-people.setRoles', config },
  ],
};
