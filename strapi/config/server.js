module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('BASE_URL', 'http://localhost:1337'),
  app: {
    keys: env.array('APP_KEYS'),
  },
  captcha: {
    hmacKey: env('ALTCHA_HMAC_KEY'),
  },
  email: {
    apiKey: env('EMAIL_API_KEY'),
    listId: env('EMAIL_LIST_ID'),
    contact: {
      to: env('EMAIL_CONTACT_TO'),
      templateId: env('EMAIL_CONTACT_TEMPLATE_ID'),
    },
  },
});
