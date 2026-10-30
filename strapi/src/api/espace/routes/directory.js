'use strict';

// Profile photo, directory, suggestions and topics (phase-2-plan.md section 3.2), served under /api/espace.
// `/me` and `/me/consent` stay in auth.js. Same context middleware as every other route of the space (A-02, A-20).
const config = { auth: false, middlewares: ['api::espace.context'] };

module.exports = {
  routes: [
    { method: 'POST', path: '/espace/me/photo', handler: 'me.photo', config },
    { method: 'GET', path: '/espace/editions/:slug/topics', handler: 'directory.topics', config },
    { method: 'GET', path: '/espace/directory', handler: 'directory.list', config },
    { method: 'GET', path: '/espace/directory/p/:id', handler: 'directory.profile', config },
    { method: 'GET', path: '/espace/directory/x/:id', handler: 'directory.exhibitor', config },
    { method: 'GET', path: '/espace/suggestions', handler: 'directory.suggestions', config },
  ],
};
