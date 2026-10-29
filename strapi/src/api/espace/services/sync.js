'use strict';

const { EspaceError } = require('../lib/errors');
const { createHelloAssoClient, HelloAssoError } = require('../lib/helloasso');
const { planSync } = require('../lib/import');
const { linkUrl } = require('../lib/tokens');

const EDITION = 'api::edition.edition';
const ATTENDEE = 'api::espace.attendee';
const EMAIL_LOG = 'api::espace.email-log';
const SYNC_RUN = 'api::espace.sync-run';
const STALE_RUN_MS = 15 * 60 * 1000;
const WELCOME_HOURS = 72;
const WELCOME_BATCH = 10;

module.exports = ({ strapi }) => {
  const service = (name) => strapi.service(`api::espace.${name}`);
  const logLine = (error) => String(error.message).split('\n')[0];
  let client;

  /** A-16: under the lock of the edition, refuse when a run is open (and younger than 15 minutes), else open one. */
  const reserve = (editionDocumentId, now) =>
    service('locks').withLock(`sync:${editionDocumentId}`, async () => {
      const running = await strapi.documents(SYNC_RUN).findFirst({
        filters: { edition: { documentId: editionDocumentId }, endedAt: { $null: true }, startedAt: { $gt: new Date(now.getTime() - STALE_RUN_MS) } },
      });
      if (running) throw new EspaceError(409, 'SYNC_RUNNING', 'Une synchronisation est déjà en cours.');
      return strapi.documents(SYNC_RUN).create({ data: { edition: { documentId: editionDocumentId }, startedAt: now } });
    });

  /** Fetches the tickets, applies the plan, then sends the missing `welcome` e-mails. Fills `result`. */
  async function synchronize(edition, now, result) {
    const { apiBase, clientId, clientSecret } = strapi.config.get('server.helloasso');
    if (!(apiBase && clientId && clientSecret && edition.helloassoOrgSlug && edition.helloassoFormSlug)) {
      result.errors.push({ code: 'HELLOASSO_NOT_CONFIGURED' });
      return;
    }
    client ??= createHelloAssoClient({ apiBase, clientId, clientSecret });
    const items = await client.listFormItems({
      organizationSlug: edition.helloassoOrgSlug,
      formType: edition.helloassoFormType ?? 'Event',
      formSlug: edition.helloassoFormSlug,
    });

    const ofEdition = { edition: { documentId: edition.documentId } };
    const attendees = await strapi.documents(ATTENDEE).findMany({ filters: ofEdition, limit: 10000 });
    const byId = new Map(attendees.map((attendee) => [attendee.documentId, attendee]));
    const plan = planSync({ items, attendees, fieldMap: edition.helloassoFieldMap });
    result.errors.push(...plan.errors);

    // One failing ticket is reported (APPLY_FAILED) and never stops the others.
    const attempt = async (itemId, apply) => {
      try {
        return await apply();
      } catch (error) {
        strapi.log.error(`[sync] ${edition.slug}: ticket ${itemId} not applied: ${logLine(error)}`);
        result.errors.push({ itemId: String(itemId), code: 'APPLY_FAILED' });
        return false;
      }
    };

    // A-16: the uniqueness of the e-mail and of the ticket is checked again under the lock, since the organizer may have created an Attendee meanwhile.
    const create = ({ decision, reason, proposedRole, ...fields }) =>
      service('locks').withLock(`attendee:${edition.documentId}`, async () => {
        const existing = await strapi.documents(ATTENDEE).findFirst({
          filters: { ...ofEdition, $or: [{ email: { $eqi: fields.email } }, { helloassoItemId: fields.helloassoItemId }] },
        });
        if (existing) {
          if (existing.helloassoItemId !== fields.helloassoItemId) {
            result.errors.push({ itemId: fields.helloassoItemId, code: 'EMAIL_TAKEN', email: fields.email, attendeeDocumentId: existing.documentId });
          }
          return false;
        }
        await strapi.documents(ATTENDEE).create({ data: { ...fields, role: proposedRole ?? 'participant', ...ofEdition } });
        return true;
      });

    for (const mapped of plan.create) {
      if (await attempt(mapped.helloassoItemId, () => create(mapped))) result.created += 1;
    }
    for (const { documentId, changes } of plan.update) {
      const done = await attempt(byId.get(documentId).helloassoItemId, async () => {
        await strapi.documents(ATTENDEE).update({ documentId, data: changes });
        return true;
      });
      if (done) result.updated += 1;
    }
    for (const documentId of plan.cancel) {
      const attendee = byId.get(documentId);
      // Meetings first: if it fails, the Attendee stays active and the next run starts again.
      const done = await attempt(attendee.helloassoItemId, async () => {
        await service('meetings').cancelForAttendee(attendee, { now });
        await strapi.documents(ATTENDEE).update({ documentId, data: { status: 'cancelled' } });
        return true;
      });
      if (done) result.cancelled += 1;
    }

    if (edition.participantSpaceEnabled) await sendWelcomes(edition, now, attempt);
  }

  /** A-17: `welcome` to every active attendee but the organizers who has no EmailLog `welcome` sent yet ; a failed send is tried again at the next run. */
  async function sendWelcomes(edition, now, attempt) {
    const ofEdition = { edition: { documentId: edition.documentId } };
    const logs = await strapi.documents(EMAIL_LOG).findMany({
      filters: { template: 'welcome', status: 'sent', attendee: ofEdition },
      populate: { attendee: { fields: ['documentId'] } },
      limit: 10000,
    });
    const welcomed = new Set(logs.map(({ attendee }) => attendee?.documentId));
    const attendees = await strapi.documents(ATTENDEE).findMany({
      filters: { ...ofEdition, status: 'active', role: { $ne: 'organizer' } },
      limit: 10000,
    });
    const recipients = attendees.filter(({ documentId }) => !welcomed.has(documentId));

    const publicUrl = strapi.config.get('server.espace.publicUrl');
    const mailEdition = { slug: edition.slug, title: edition.title, themeColor: edition.hero_bg_color };
    for (let from = 0; from < recipients.length; from += WELCOME_BATCH) {
      await Promise.all(
        recipients.slice(from, from + WELCOME_BATCH).map((attendee) =>
          attempt(attendee.helloassoItemId ?? attendee.documentId, async () => {
            const token = await service('tokens').issueLink(attendee.documentId, { ttlMinutes: WELCOME_HOURS * 60, now });
            await service('mailer').send({
              attendee,
              template: 'welcome',
              scenarioKey: 'welcome',
              now,
              data: {
                edition: mailEdition,
                publicUrl,
                firstName: attendee.firstName,
                url: linkUrl({ publicUrl, token, next: `/espace/${edition.slug}/` }),
                validityHours: WELCOME_HOURS,
              },
            });
          })
        )
      );
    }
  }

  /**
   * I-12: synchronizes one published edition and returns its closed SyncRun (a document: created, updated, cancelled, errors).
   * 404 EDITION_NOT_FOUND, 409 SYNC_RUNNING. Any other failure closes the SyncRun with an error entry, and nothing is thrown.
   */
  async function run(editionDocumentId, { now = new Date() } = {}) {
    const edition = await strapi.documents(EDITION).findOne({ documentId: editionDocumentId, status: 'published' });
    if (!edition) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');

    const syncRun = await reserve(editionDocumentId, now);
    const result = { created: 0, updated: 0, cancelled: 0, errors: [] };
    try {
      await synchronize(edition, now, result);
    } catch (error) {
      result.errors.push(error instanceof HelloAssoError ? { code: 'FETCH_FAILED', status: error.status ?? null } : { code: 'INTERNAL' });
      strapi.log.error(`[sync] ${edition.slug}: ${logLine(error)}`);
    }
    return strapi.documents(SYNC_RUN).update({ documentId: syncRun.documentId, data: { ...result, endedAt: new Date() } });
  }

  return {
    run,

    /** A-17, cron: every published edition that has a HelloAsso form, whether its space is open or not. */
    async runAll({ now = new Date() } = {}) {
      const editions = await strapi.documents(EDITION).findMany({ status: 'published', limit: 1000 });
      for (const edition of editions.filter(({ helloassoOrgSlug, helloassoFormSlug }) => helloassoOrgSlug && helloassoFormSlug)) {
        try {
          await run(edition.documentId, { now });
        } catch (error) {
          if (error.code !== 'SYNC_RUNNING') strapi.log.error(`[sync] ${edition.slug}: ${logLine(error)}`);
        }
      }
    },
  };
};
