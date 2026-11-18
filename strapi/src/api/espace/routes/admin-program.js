'use strict';

// Program editor of the organizer interface (15-administration.md, AD-3), served under /api/espace. Strapi loads every file of this folder (A-20).
const config = { auth: false, middlewares: ['api::espace.context'] };
const base = '/espace/admin/:edition';

module.exports = {
  routes: [
    { method: 'GET', path: `${base}/program`, handler: 'admin-program.show', config },
    { method: 'POST', path: `${base}/program/publish`, handler: 'admin-program.publish', config },
    { method: 'POST', path: `${base}/sequences`, handler: 'admin-program.createSequence', config },
    { method: 'PATCH', path: `${base}/sequences/:id`, handler: 'admin-program.updateSequence', config },
    { method: 'DELETE', path: `${base}/sequences/:id`, handler: 'admin-program.deleteSequence', config },
    { method: 'POST', path: `${base}/sequences/:id/interventions`, handler: 'admin-program.createIntervention', config },
    { method: 'PATCH', path: `${base}/interventions/:id`, handler: 'admin-program.updateIntervention', config },
    { method: 'DELETE', path: `${base}/interventions/:id`, handler: 'admin-program.deleteIntervention', config },
    { method: 'POST', path: `${base}/intervenants`, handler: 'admin-program.createIntervenant', config },
    { method: 'PATCH', path: `${base}/intervenants/:id`, handler: 'admin-program.updateIntervenant', config },
  ],
};
