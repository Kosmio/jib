module.exports = ({ env }) => [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  // Only the front origins may call the API with credentials (A-05).
  { name: 'strapi::cors', config: { origin: env.array('CORS_ORIGINS', ['http://localhost:4321']), credentials: true } },
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  // The `status` enumerations of the participant space against the draft & publish `status` of the content manager.
  'global::admin-status-field',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
