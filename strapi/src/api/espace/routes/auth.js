'use strict';

// Access and profile routes, served under /api/espace (06-api.md). Public routes and session routes share the same
// context middleware, which loads the session (A-02) ; the controllers decide with requireSession.
const config = { auth: false, middlewares: ['api::espace.context'] };

module.exports = {
  routes: [
    { method: 'POST', path: '/espace/auth/request-link', handler: 'auth.requestLink', config },
    { method: 'GET', path: '/espace/auth/link', handler: 'auth.link', config },
    { method: 'POST', path: '/espace/auth/verify', handler: 'auth.verify', config },
    { method: 'POST', path: '/espace/auth/logout', handler: 'auth.logout', config },
    { method: 'GET', path: '/espace/me', handler: 'me.show', config },
    { method: 'PATCH', path: '/espace/me', handler: 'me.update', config },
    { method: 'PUT', path: '/espace/me/consent', handler: 'me.consent', config },
  ],
};
