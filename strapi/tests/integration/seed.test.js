'use strict';

/**
 * Seed de recette (A-13, B3, 10-recette.md) exécuté pour de bon sur strapi_test, dans un sous-processus,
 * comme `pnpm seed` : base vide, premier passage, données étrangères ajoutées, second passage.
 *
 * Preuves recherchées : le seed crée exactement les données de recette ; deux passages donnent le même
 * état (idempotence) ; il n'efface que les données de recette ; sur une base vide il ne crée aucune édition
 * de démonstration ni image (DEMO_SEED=false imposé).
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { buildTestEnv, STRAPI_DIR } = require('../helpers/env');
const { queryDatabase, resetDatabase } = require('../helpers/database');
const { startStrapi } = require('../helpers/strapi');
const recette = require('../../scripts/espace/fixtures/recette.json');

const DATABASE = 'strapi_test';
const SEED = path.join(STRAPI_DIR, 'scripts/espace/seed.js');
const NO_NETWORK = path.join(STRAPI_DIR, 'tests/helpers/no-network.js');

/** `pnpm seed` : sous-processus, environnement de test, réseau interdit. */
function runSeed() {
  const env = { ...buildTestEnv({ database: DATABASE }), NODE_OPTIONS: `--require=${NO_NETWORK}` };
  const started = Date.now();
  const result = spawnSync(process.execPath, [SEED], { cwd: STRAPI_DIR, env, encoding: 'utf8', timeout: 120_000 });
  return { ...result, durationMs: Date.now() - started };
}

/** Lecture des données publiées comme le fait le site (status published), sans identifiants ni dates. */
async function readState(app) {
  const published = (uid, options = {}) => app.documents(uid).findMany({ status: 'published', limit: 1000, ...options });
  const editions = await published('api::edition.edition', {
    populate: { lieux: true, sequences: { populate: { interventions: { populate: ['intervenants'] } } } },
  });
  const organisations = await published('api::organisation.organisation', { sort: 'slug:asc' });
  const intervenants = await published('api::intervenant.intervenant', { sort: 'slug:asc', populate: ['organisation'] });
  const strip = (({ id, documentId, createdAt, updatedAt, publishedAt, ...rest }) => rest);

  return {
    editions: editions.map((edition) => ({
      ...strip(edition),
      lieux: edition.lieux.map(strip),
      sequences: [...edition.sequences]
        .sort((a, b) => a.order - b.order)
        .map((sequence) => ({
          title: sequence.title,
          start_time: sequence.start_time,
          end_time: sequence.end_time,
          order: sequence.order,
          interventions: sequence.interventions.map((i) => i.intervenants.map((v) => v.slug)),
        })),
    })),
    organisations: organisations.map(strip),
    intervenants: intervenants.map((i) => ({ ...strip(i), organisation: i.organisation?.slug })),
  };
}

const countDocuments = async (table, where = 'true') =>
  (await queryDatabase(DATABASE, `select count(distinct document_id)::int as n from ${table} where ${where}`)).rows[0].n;

describe('seed de recette sur strapi_test', { timeout: 600_000 }, () => {
  let first;
  let second;
  let stateAfterFirst;
  let stateAfterSecond;
  let foreignAfterSecond;

  before(async () => {
    await resetDatabase(DATABASE);

    first = runSeed();

    // Données étrangères à la recette, que le second passage ne doit pas toucher.
    const strapi = await startStrapi({ database: DATABASE, reset: false });
    try {
      stateAfterFirst = await readState(strapi.app);
      await strapi.app.documents('api::edition.edition').create({
        data: { title: 'Édition étrangère', slug: 'edition-etrangere', year: 2025, region: 'normandie', city: 'Ailleurs', edition_status: 'passee' },
        status: 'published',
      });
      await strapi.app.documents('api::organisation.organisation').create({
        data: { name: 'Organisation étrangère', slug: 'organisation-etrangere' },
        status: 'published',
      });
    } finally {
      await strapi.stop();
    }

    second = runSeed();

    const strapiAgain = await startStrapi({ database: DATABASE, reset: false });
    try {
      stateAfterSecond = await readState(strapiAgain.app);
      foreignAfterSecond = {
        edition: await strapiAgain.app.documents('api::edition.edition').findFirst({ filters: { slug: 'edition-etrangere' }, status: 'published' }),
        organisation: await strapiAgain.app.documents('api::organisation.organisation').findFirst({ filters: { slug: 'organisation-etrangere' }, status: 'published' }),
      };
    } finally {
      await strapiAgain.stop();
    }
  });

  describe('premier passage sur une base vide', () => {
    it('réussit (code 0)', () => {
      assert.equal(first.status, 0, first.stderr);
    });

    it('affiche le résumé des comptes', () => {
      assert.match(first.stdout, /Seed de recette terminé sur la base strapi_test\./);
      assert.match(first.stdout, /Édition\s+1 \(nouvelle-aquitaine-test\)/);
      assert.match(first.stdout, /Séquences\s+9 \(dont 3 pauses B2B\)/);
      assert.match(first.stdout, /Intervenants\s+2\b/);
      assert.match(first.stdout, /Interventions\s+2\b/);
      assert.match(first.stdout, /Organisations\s+4\b/);
    });

    it('crée l’édition de recette publiée, avec ses réglages (10-recette.md)', () => {
      const [edition, ...others] = stateAfterFirst.editions;
      assert.equal(others.length, 0, 'une seule édition');
      assert.equal(edition.title, 'Nouvelle-Aquitaine (test)');
      assert.equal(edition.slug, 'nouvelle-aquitaine-test');
      assert.equal(edition.year, 2026);
      assert.equal(edition.region, 'nouvelle-aquitaine');
      assert.equal(edition.date, '2026-12-03');
      assert.equal(edition.city, 'Bordeaux');
      assert.equal(edition.edition_status, 'inscriptions-ouvertes');
      assert.equal(edition.hero_bg_color, '#600e24');
      assert.equal(edition.lieux.length, 1);
    });

    it('crée les 9 séquences dans l’ordre du programme, rattachées à l’édition', () => {
      const [edition] = stateAfterFirst.editions;
      assert.deepEqual(
        edition.sequences.map(({ title, start_time, end_time }) => ({ title, start_time, end_time })),
        recette.sequences.map(({ title, start_time, end_time }) => ({ title, start_time, end_time }))
      );
      assert.deepEqual(
        edition.sequences.map((s) => s.order),
        [1, 2, 3, 4, 5, 6, 7, 8, 9]
      );
    });

    it('crée les 3 pauses B2B aux horaires de la recette', () => {
      const [edition] = stateAfterFirst.editions;
      const breaks = edition.sequences.filter((s) => /B2B/.test(s.title)).map((s) => `${s.start_time}-${s.end_time}`);
      assert.deepEqual(breaks, ['10h45-11h15', '12h30-14h00', '15h30-16h00']);
    });

    it('crée les 4 organisations fictives, publiées', () => {
      assert.deepEqual(
        stateAfterFirst.organisations.map((o) => o.slug),
        ['test-cabinet-verdelis', 'test-institut-lignea', 'test-resineo', 'test-sylvadour']
      );
    });

    it('crée les 2 intervenants, chacun lié à sa structure et à une intervention de sa séquence', () => {
      assert.deepEqual(
        stateAfterFirst.intervenants.map((i) => [i.slug, i.organisation]),
        [
          ['test-antoine-vergnes', 'test-cabinet-verdelis'],
          ['test-helene-marques', 'test-institut-lignea'],
        ]
      );
      const [edition] = stateAfterFirst.editions;
      const speakers = Object.fromEntries(edition.sequences.map((s) => [s.title, s.interventions.flat()]));
      assert.deepEqual(speakers['Forêt et adaptation'], ['test-helene-marques']);
      assert.deepEqual(speakers['Économie circulaire'], ['test-antoine-vergnes']);
    });

    it('n’utilise que des adresses et des sites en example.org', () => {
      const text = JSON.stringify(stateAfterFirst);
      assert.deepEqual(
        (text.match(/https?:\/\/[^\s"\\]+/g) || []).filter((url) => !/^https:\/\/example\.org\//.test(url)),
        []
      );
    });
  });

  describe('second passage, avec des données étrangères présentes', () => {
    it('réussit (code 0) avec le même résumé', () => {
      assert.equal(second.status, 0, second.stderr);
      const summary = ({ stdout }) => stdout.split('\n').filter((line) => /^(Seed de recette|\s{2}\S)/.test(line));
      assert.deepEqual(summary(second), summary(first));
    });

    it('redonne exactement le même état de recette (idempotence)', () => {
      const recetteOnly = (state) => ({
        editions: state.editions.filter((e) => e.slug === 'nouvelle-aquitaine-test'),
        organisations: state.organisations.filter((o) => o.slug.startsWith('test-')),
        intervenants: state.intervenants,
      });
      assert.deepEqual(recetteOnly(stateAfterSecond), recetteOnly(stateAfterFirst));
    });

    it('ne multiplie aucune ligne : 1 édition, 9 séquences, 2 interventions, 2 intervenants de recette', async () => {
      assert.equal(await countDocuments('editions', `slug = 'nouvelle-aquitaine-test'`), 1);
      assert.equal(await countDocuments('sequences'), 9);
      assert.equal(await countDocuments('interventions'), 2);
      assert.equal(await countDocuments('intervenants'), 2);
      assert.equal(await countDocuments('organisations', `slug like 'test-%'`), 4);
    });

    it('ne touche pas aux données étrangères à la recette', () => {
      assert.equal(foreignAfterSecond.edition?.title, 'Édition étrangère');
      assert.equal(foreignAfterSecond.organisation?.name, 'Organisation étrangère');
      assert.equal(stateAfterSecond.editions.length, 2);
      assert.equal(stateAfterSecond.organisations.length, 5);
    });

    it('n’a créé ni tag ni fichier téléversé', async () => {
      assert.equal(await countDocuments('tags'), 0);
      assert.equal(await countDocuments('files'), 0);
    });
  });
});
