'use strict';

const { EspaceError } = require('../lib/errors');

module.exports = {
  // POST /api/espace/webhooks/helloasso (public): I-13. 200 { status: 'accepted' | 'ignored' } at once, the import runs in the background ; 429 over 60 requests a minute per IP.
  helloasso: async (ctx) => {
    ctx.set('Cache-Control', 'no-store');
    try {
      ctx.body = { status: strapi.service('api::espace.webhooks').receive({ body: ctx.request.body, ip: ctx.request.ip }) };
    } catch (error) {
      if (!(error instanceof EspaceError)) throw error;
      ctx.status = error.status;
      ctx.body = { error: { code: error.code, message: error.message } };
    }
  },
};
