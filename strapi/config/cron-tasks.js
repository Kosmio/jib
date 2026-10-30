// Scheduled tasks of the participant space (A-08). Strapi registers them only with CRON_ENABLED=true (config/server.js).
// An error is logged and never brings Strapi down.
const TIME_ZONE = 'Europe/Paris';

const safely = (name, work) => async ({ strapi }) => {
  try {
    await work(strapi);
  } catch (error) {
    strapi.log.error(`[cron] ${name}: ${String(error.message).split('\n')[0]}`);
  }
};

module.exports = {
  // I-12, A-17: every 15 minutes, the published editions that have a HelloAsso form.
  espaceSync: {
    task: safely('espaceSync', (strapi) => strapi.service('api::espace.sync').runAll()),
    options: { rule: '*/15 * * * *', tz: TIME_ZONE },
  },
  // R-17, A-32: every 5 minutes, the pending meeting requests of the editions whose request window is closed become expired.
  espaceMeetingExpiry: {
    task: safely('espaceMeetingExpiry', (strapi) => strapi.service('api::espace.meetings').expirePending()),
    options: { rule: '*/5 * * * *', tz: TIME_ZONE },
  },
  // I-20, A-21: every night, the link and session tokens expired for more than 7 days.
  espaceTokenPurge: {
    task: safely('espaceTokenPurge', (strapi) => strapi.service('api::espace.tokens').purgeExpired()),
    options: { rule: '0 4 * * *', tz: TIME_ZONE },
  },
};
