module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('BASE_URL', 'http://localhost:1337'),
  app: {
    keys: env.array('APP_KEYS'),
  },
  // No npm registry lookup on startup (seed, develop, start), and strapi/.strapi-updater.json stays untouched.
  logger: { updates: { enabled: false } },
  captcha: {
    hmacKey: env('ALTCHA_HMAC_KEY'),
  },
  email: {
    apiKey: env('EMAIL_API_KEY'),
    provider: env('EMAIL_PROVIDER'),
    from: env('EMAIL_FROM'),
    outboxFile: env('EMAIL_OUTBOX_FILE', '.tmp/mail-outbox.jsonl'),
    listId: env('EMAIL_LIST_ID'),
    contact: {
      to: env('EMAIL_CONTACT_TO'),
      templateId: env('EMAIL_CONTACT_TEMPLATE_ID'),
    },
  },
});
