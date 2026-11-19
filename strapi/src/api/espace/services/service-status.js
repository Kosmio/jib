'use strict';

const EMAIL_LOG = 'api::espace.email-log';
const SYNC_RUN = 'api::espace.sync-run';
const DAY_MS = 24 * 3600 * 1000;

module.exports = ({ strapi }) => {
  const mailSettings = () => {
    const { provider, from } = strapi.config.get('server.email') ?? {};
    return { provider: provider || (process.env.NODE_ENV === 'production' ? 'brevo' : 'console'), senderConfigured: Boolean(from) };
  };

  return {
    /** F-106: one line in the log when a real provider (brevo, smtp) has no sender; called by the bootstrap. */
    checkSenderAtStartup() {
      const { provider, senderConfigured } = mailSettings();
      if (provider !== 'console' && !senderConfigured) {
        strapi.log.error(`[mail] EMAIL_FROM est absent alors que le fournisseur est ${provider} : aucun e-mail de l’espace ne pourra partir.`);
      }
    },

    /** F-106: the state of the service for the organizer's dashboard. */
    async status(edition, { now = new Date() } = {}) {
      const failed = { status: 'failed', sentAt: { $gt: new Date(now.getTime() - DAY_MS) }, attendee: { edition: { documentId: edition.documentId } } };
      const [failedLast24h, lastFailure, lastRun, abandoned] = await Promise.all([
        strapi.documents(EMAIL_LOG).count({ filters: failed }),
        strapi.documents(EMAIL_LOG).findFirst({ filters: failed, sort: 'sentAt:desc' }),
        strapi.documents(SYNC_RUN).findFirst({ filters: { edition: { documentId: edition.documentId } }, sort: 'startedAt:desc' }),
        strapi.service('api::espace.welcome').abandoned(edition),
      ]);
      const { apiBase, clientId, clientSecret } = strapi.config.get('server.helloasso');
      return {
        mail: { ...mailSettings(), failedLast24h, lastError: lastFailure?.error ?? null, abandoned },
        helloasso: {
          configured: Boolean(apiBase && clientId && clientSecret && edition.helloassoOrgSlug && edition.helloassoFormSlug),
          lastRunStatus: !lastRun ? null : !lastRun.endedAt ? 'running' : lastRun.errors?.length ? 'error' : 'ok',
          lastRunAt: lastRun ? (lastRun.endedAt ?? lastRun.startedAt) : null,
        },
        cron: { enabled: Boolean(strapi.config.get('server.cron.enabled')) },
        space: { enabled: Boolean(edition.participantSpaceEnabled), welcomeStartedAt: edition.welcomeStartedAt ?? null },
      };
    },
  };
};
