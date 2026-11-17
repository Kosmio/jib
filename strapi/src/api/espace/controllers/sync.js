'use strict';

const { EspaceError } = require('../lib/errors');
const { requireOrganizer } = require('../lib/guards');

const view = ({ documentId, startedAt, endedAt, created, updated, cancelled, errors }) => ({
  id: documentId,
  startedAt,
  endedAt,
  created,
  updated,
  cancelled,
  errors: errors ?? [],
});

/**
 * F-121: a DUPLICATE_EMAIL or EMAIL_TAKEN error only holds an address ; the organizer needs to know who already uses it. `holderName`
 * (first and last name of the Attendee of the edition holding the address) is added to those errors, read once for all the runs.
 */
async function withHolders(edition, runs) {
  const wanted = (error) => error.email || error.attendeeDocumentId;
  if (!runs.some(({ errors }) => (errors ?? []).some(wanted))) return runs.map(view);
  const attendees = await strapi.documents('api::espace.attendee').findMany({
    filters: { edition: { documentId: edition.documentId } },
    fields: ['firstName', 'lastName', 'email'],
    limit: 10000,
  });
  const byEmail = new Map(attendees.map((a) => [String(a.email).toLowerCase(), a]));
  const byId = new Map(attendees.map((a) => [a.documentId, a]));
  const nameOf = (a) => [a?.firstName, a?.lastName].filter(Boolean).join(' ') || undefined;
  return runs.map((run) => ({
    ...view(run),
    errors: (run.errors ?? []).map((error) => {
      const holderName = nameOf(byId.get(error.attendeeDocumentId) ?? byEmail.get(String(error.email ?? '').toLowerCase()));
      return holderName ? { ...error, holderName } : error;
    }),
  }));
}

async function organizerEdition(ctx) {
  requireOrganizer(ctx, ctx.params.edition);
  const edition = await strapi.service('api::espace.editions').findPublished(ctx.params.edition);
  if (!edition) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');
  return edition;
}

module.exports = {
  // POST /api/espace/admin/:edition/sync (organizer): I-12, answers the closed SyncRun ; 409 SYNC_RUNNING.
  run: async (ctx) => {
    const edition = await organizerEdition(ctx);
    const run = await strapi.service('api::espace.sync').run(edition.documentId);
    [ctx.body] = await withHolders(edition, [run]);
  },

  // GET /api/espace/admin/:edition/sync-runs (organizer): the 10 latest SyncRun, newest first.
  list: async (ctx) => {
    const edition = await organizerEdition(ctx);
    const runs = await strapi.documents('api::espace.sync-run').findMany({
      filters: { edition: { documentId: edition.documentId } },
      sort: 'startedAt:desc',
      limit: 10,
    });
    ctx.body = await withHolders(edition, runs);
  },
};
