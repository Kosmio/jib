module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('BASE_URL', 'http://localhost:1337'),
  app: {
    keys: env.array('APP_KEYS'),
  },
  // Behind Traefik (dev, prod) the client IP is the last X-Forwarded-For entry (A-04, rate limiting).
  proxy: { koa: env.bool('IS_PROXIED', false), maxIpsCount: 1 },
  cron: { enabled: env.bool('CRON_ENABLED', false), tasks: require('./cron-tasks') },
  // No npm registry lookup on startup (seed, develop, start), and strapi/.strapi-updater.json stays untouched.
  logger: { updates: { enabled: false } },
  captcha: {
    hmacKey: env('ALTCHA_HMAC_KEY'),
  },
  espace: {
    publicUrl: env('PUBLIC_URL', 'http://localhost:4321'),
    organizerEmails: env.array('ORGANIZER_EMAILS', []).filter(Boolean),
    corsOrigins: env.array('CORS_ORIGINS', ['http://localhost:4321']).filter(Boolean),
  },
  helloasso: {
    apiBase: env('HELLOASSO_API_BASE', ''),
    clientId: env('HELLOASSO_CLIENT_ID', ''),
    clientSecret: env('HELLOASSO_CLIENT_SECRET', ''),
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
