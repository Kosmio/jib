'use strict';

/**
 * Seed de recette puis synchronisation (plan de la phase 1, section 4.4 et critère 1 du lot 4) : sur une base fraîchement seedée,
 * une synchronisation contre le faux HelloAsso et son jeu par défaut donne 0 création, 0 mise à jour, 0 annulation, 0 erreur, et
 * n'envoie aucun e-mail (le seed a posé un EmailLog `welcome` par Attendee). C'est la preuve que le seed et l'import s'accordent
 * sur les 17 billets, dont celui de Lucas Darrigade, annulé.
 *
 * Le seed tourne dans un sous-processus sur TEST_DATABASE (comme `pnpm seed`), puis Strapi démarre sur la base seedée avec le faux
 * HelloAsso en module. Aucun réseau hors localhost, aucun e-mail réel.
 */

const { before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { resetDatabase } = require('../helpers/database');
const { buildTestEnv, STRAPI_DIR, testDatabaseName } = require('../helpers/env');
const { sleep, useEspace } = require('../helpers/espace');
const { UID } = require('../helpers/espace-data');
const recette = require('../../scripts/espace/fixtures/recette.json');

const DATABASE = testDatabaseName();
const SEED = path.join(STRAPI_DIR, 'scripts/espace/seed.js');
const NO_NETWORK = path.join(STRAPI_DIR, 'tests/helpers/no-network.js');
const SLUG = recette.edition.slug;
const ORGANIZER = 'organisation@example.org';

describe('synchronisation d’une base fraîchement seedée (4.4, critère 1 du lot 4)', { timeout: 300_000 }, () => {
  let seeded;
  before(async () => {
    await resetDatabase(DATABASE);
    const env = { ...buildTestEnv({ database: DATABASE }), NODE_OPTIONS: `--require=${NO_NETWORK}` };
    seeded = spawnSync(process.execPath, [SEED], { cwd: STRAPI_DIR, env, encoding: 'utf8', timeout: 120_000 });
  });

  // Enregistré après le `before` du seed : Strapi démarre sur la base seedée, sans la vider.
  const espace = useEspace({ fake: true, reset: false });

  const edition = () => espace().app.documents(UID.edition).findFirst({ filters: { slug: SLUG }, status: 'published' });
  const run = async (options) => espace().app.service('api::espace.sync').run((await edition()).documentId, options);
  const counts = (result) => [result.created, result.updated, result.cancelled];
  const welcomeLogs = () => espace().query(UID.emailLog).count({ where: { template: 'welcome' } });

  it('le seed s’est terminé sans erreur', () => {
    assert.equal(seeded.status, 0, seeded.stderr || seeded.stdout);
  });

  it('première synchronisation : 0 création, 0 mise à jour, 0 annulation, aucune erreur', async () => {
    const result = await run();
    assert.deepEqual(counts(result), [0, 0, 0]);
    assert.deepEqual(result.errors, []);
    assert.ok(result.endedAt, 'SyncRun non clos');
  });

  it('n’envoie aucun e-mail : les 17 EmailLog welcome du seed sont conservés, sans en ajouter', async () => {
    const since = espace().outbox().length;
    const logsBefore = await welcomeLogs();
    assert.equal(logsBefore, 17);
    await run();
    await sleep(500);
    assert.equal(espace().outbox().length, since, 'e-mail envoyé après un seed');
    assert.equal(await welcomeLogs(), logsBefore);
  });

  it('ne touche à aucun Attendee : 17 en tout, Lucas Darrigade toujours cancelled, les 16 autres actifs', async () => {
    await run();
    const attendees = await espace().app.documents(UID.attendee).findMany({ filters: { edition: { slug: SLUG } }, limit: 100 });
    assert.equal(attendees.length, 17);
    assert.deepEqual(attendees.filter((attendee) => attendee.status === 'cancelled').map((attendee) => attendee.email), ['lucas.darrigade@example.org']);
  });

  it('par la route, en session organisateur (ORGANIZER_EMAILS) : 200, 0, 0, 0, aucune erreur', async () => {
    const { request, signIn } = espace();
    const organizer = await signIn(SLUG, ORGANIZER);
    const response = await request(`/api/espace/admin/${SLUG}/sync`, { method: 'POST', cookie: organizer.cookie });
    assert.equal(response.status, 200);
    assert.deepEqual([response.json.created, response.json.updated, response.json.cancelled], [0, 0, 0]);
    assert.deepEqual(response.json.errors, []);
  });

  it('chaque synchronisation laisse un SyncRun clos', async () => {
    const runs = await espace().query(UID.syncRun).findMany({});
    assert.ok(runs.length >= 3, `${runs.length} SyncRun`);
    assert.ok(runs.every((stored) => stored.endedAt));
  });
});
