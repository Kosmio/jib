'use strict';

/**
 * Captcha verification service (Altcha, self-hosted).
 */

async function verify(token) {
  const hmacKey = strapi.config.get('server.captcha.hmacKey');

  if (!hmacKey) {
    strapi.log.warn('ALTCHA_HMAC_KEY not set, skipping captcha verification');
    return true;
  }

  if (!token) return false;

  const { verifySolution } = require('altcha-lib');
  return verifySolution(token, hmacKey, true);
}

module.exports = { verify };
