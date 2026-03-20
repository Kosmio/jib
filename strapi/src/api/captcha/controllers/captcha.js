'use strict';

/**
 * Returns an Altcha challenge for the frontend widget.
 */
module.exports = {
  challenge: async (ctx) => {
    const hmacKey = strapi.config.get('server.captcha.hmacKey');

    if (!hmacKey) {
      return ctx.send({ error: 'ALTCHA_HMAC_KEY not configured' }, 500);
    }

    const { createChallenge } = require('altcha-lib');

    const challenge = await createChallenge({
      hmacKey,
      maxNumber: 100000,
      expires: new Date(Date.now() + 5 * 60 * 1000),
    });

    return ctx.send(challenge);
  },
};
