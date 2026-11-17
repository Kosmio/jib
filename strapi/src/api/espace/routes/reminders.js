'use strict';

// Reminders (organizer) and the one-click unsubscription (I-39), served under /api/espace. Strapi loads every file of this folder (A-20).
const config = { auth: false, middlewares: ['api::espace.context'] };
// The unsubscription has no context middleware: the mail providers POST it (RFC 8058) with no Origin and no session, the signed token is the only credential.
const open = { auth: false };

module.exports = {
  routes: [
    { method: 'POST', path: '/espace/admin/:edition/reminders/preview', handler: 'reminders.preview', config },
    { method: 'POST', path: '/espace/admin/:edition/reminders/send', handler: 'reminders.send', config },
    { method: 'GET', path: '/espace/reminders/unsubscribe', handler: 'reminders.unsubscribe', config: open },
    { method: 'POST', path: '/espace/reminders/unsubscribe', handler: 'reminders.unsubscribe', config: open },
  ],
};
