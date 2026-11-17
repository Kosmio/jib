'use strict';

const { EspaceError } = require('../lib/errors');
const { renderEmail } = require('../lib/mail/render');
const { linkUrl } = require('../lib/tokens');

const EDITION = 'api::edition.edition';
const ATTENDEE = 'api::espace.attendee';
const EMAIL_LOG = 'api::espace.email-log';
const WELCOME_HOURS = 72;
const WELCOME_BATCH = 10;
const MAX_FAILURES = 3;
const FIRST_HOUR = 8;
const LAST_HOUR = 20;

/** F-105, R-85: the `welcome` e-mails leave only between 8h00 and 20h00, Paris time. */
const inSendingHours = (now) => {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' }).format(now));
  return hour >= FIRST_HOUR && hour < LAST_HOUR;
};

module.exports = ({ strapi }) => {
  const service = (name) => strapi.service(`api::espace.${name}`);
  const running = new Set();
  const mailEdition = (edition) => ({ slug: edition.slug, title: edition.title, themeColor: edition.hero_bg_color });

  /** Active attendees but the organizers with no `welcome` sent yet: [{ attendee, failures, lastError }], the failures being the consecutive ones (A-17). */
  async function pending(edition) {
    const ofEdition = { edition: { documentId: edition.documentId } };
    const logs = await strapi.documents(EMAIL_LOG).findMany({
      filters: { template: 'welcome', attendee: ofEdition },
      populate: { attendee: { fields: ['documentId'] } },
      sort: 'sentAt:desc',
      limit: 10000,
    });
    const sent = new Set();
    const failed = new Map();
    for (const { attendee, status, error } of logs) {
      const id = attendee?.documentId;
      if (status === 'sent') sent.add(id);
      else failed.set(id, { count: (failed.get(id)?.count ?? 0) + 1, lastError: failed.get(id)?.lastError ?? error ?? null });
    }
    const attendees = await strapi.documents(ATTENDEE).findMany({
      filters: { ...ofEdition, status: 'active', role: { $ne: 'organizer' } },
      limit: 10000,
    });
    return attendees
      .filter(({ documentId }) => !sent.has(documentId))
      .map((attendee) => ({ attendee, failures: failed.get(attendee.documentId)?.count ?? 0, lastError: failed.get(attendee.documentId)?.lastError ?? null }));
  }

  /** Sends the `welcome` of each recipient, ten at a time. A failure is counted, never thrown. -> { sent, failed } */
  async function deliver(edition, recipients, now) {
    const publicUrl = strapi.config.get('server.espace.publicUrl');
    const tally = { sent: 0, failed: 0 };
    for (let from = 0; from < recipients.length; from += WELCOME_BATCH) {
      await Promise.all(
        recipients.slice(from, from + WELCOME_BATCH).map(async ({ attendee }) => {
          let status = 'failed';
          try {
            const token = await service('tokens').issueLink(attendee.documentId, { ttlMinutes: WELCOME_HOURS * 60, now });
            ({ status } = await service('mailer').send({
              attendee,
              template: 'welcome',
              scenarioKey: 'welcome',
              now,
              data: {
                edition: mailEdition(edition),
                publicUrl,
                firstName: attendee.firstName,
                url: linkUrl({ publicUrl, token, next: `/espace/${edition.slug}/` }),
                validityHours: WELCOME_HOURS,
              },
            }));
          } catch (error) {
            strapi.log.error(`[welcome] ${edition.slug}: attendee ${attendee.documentId} not invited: ${String(error.message).split('\n')[0]}`);
          }
          tally[status === 'sent' ? 'sent' : 'failed'] += 1;
        })
      );
    }
    return tally;
  }

  return {
    pending,

    /** F-105: attendees abandoned after three failures in a row: [{ email, error }]. */
    async abandoned(edition) {
      return (await pending(edition)).filter(({ failures }) => failures >= MAX_FAILURES).map(({ attendee, lastError }) => ({ email: attendee.email, error: lastError }));
    },

    /** F-105: number of recipients and the HTML of the e-mail, rendered for a sample first name. */
    async preview(edition) {
      const publicUrl = strapi.config.get('server.espace.publicUrl');
      const { html } = renderEmail('welcome', {
        edition: mailEdition(edition),
        publicUrl,
        firstName: 'Camille',
        url: `${publicUrl}/espace/${edition.slug}/`,
        validityHours: WELCOME_HOURS,
      });
      return { recipients: (await pending(edition)).length, sampleHtml: html };
    },

    /**
     * F-105, R-85: the organizer's first send. Sets `welcomeStartedAt` when empty, then invites every pending attendee, the abandoned ones included.
     * 409 OUTSIDE_SENDING_HOURS, 409 WELCOME_RUNNING. -> { sent, failed, startedAt }
     */
    async send(edition, { now = new Date() } = {}) {
      if (!inSendingHours(now)) throw new EspaceError(409, 'OUTSIDE_SENDING_HOURS', 'Les e-mails de bienvenue partent entre 8h00 et 20h00, heure de Paris.');
      if (running.has(edition.documentId)) throw new EspaceError(409, 'WELCOME_RUNNING', 'Un envoi est déjà en cours.');
      running.add(edition.documentId);
      try {
        const startedAt = edition.welcomeStartedAt ?? now;
        if (!edition.welcomeStartedAt) {
          // Draft and published rows both: publishing the draft later must not erase it.
          await strapi.db.query(EDITION).updateMany({ where: { documentId: edition.documentId }, data: { welcomeStartedAt: now } });
        }
        return { ...(await deliver(edition, await pending(edition), now)), startedAt: new Date(startedAt).toISOString() };
      } finally {
        running.delete(edition.documentId);
      }
    },

    /** R-85, called by the synchronization, never awaited: invites the newcomers once the first send has happened, within the sending hours, until three failures. */
    async inviteNew(edition, now = new Date()) {
      if (!(edition.participantSpaceEnabled && edition.welcomeStartedAt && inSendingHours(now)) || running.has(edition.documentId)) return;
      running.add(edition.documentId);
      try {
        await deliver(edition, (await pending(edition)).filter(({ failures }) => failures < MAX_FAILURES), now);
      } catch (error) {
        strapi.log.error(`[welcome] ${edition.slug}: ${String(error.message).split('\n')[0]}`);
      } finally {
        running.delete(edition.documentId);
      }
    },
  };
};
