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
    ctx.body = view(await strapi.service('api::espace.sync').run(edition.documentId));
  },

  // GET /api/espace/admin/:edition/sync-runs (organizer): the 10 latest SyncRun, newest first.
  list: async (ctx) => {
    const edition = await organizerEdition(ctx);
    const runs = await strapi.documents('api::espace.sync-run').findMany({
      filters: { edition: { documentId: edition.documentId } },
      sort: 'startedAt:desc',
      limit: 10,
    });
    ctx.body = runs.map(view);
  },
};
