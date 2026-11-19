'use strict';

/**
 * Bases de test configurables (TEST_DATABASE, E2E_DATABASE) sur le vrai Postgres : création automatique des
 * bases manquantes, remise à zéro limitée à la base visée, refus des noms interdits par le script de préparation.
 *
 * Les bases de ce fichier portent le numéro du processus (jib_tmp_<pid>_…) et sont supprimées à la fin : elles ne
 * rencontrent ni les bases par défaut, ni celles d'une autre exécution en cours. Aucune ne s'appelle strapi_test
 * ni strapi_e2e.
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { Client } = require('pg');

const { DB_SERVER, STRAPI_DIR } = require('../helpers/env');
const { dropDatabase, ensureDatabase, queryDatabase, resetDatabase } = require('../helpers/database');

const NO_NETWORK = path.join(STRAPI_DIR, 'tests/helpers/no-network.js');
const PREPARE = path.join(STRAPI_DIR, 'tests/prepare-databases.js');
const unique = `jib_tmp_${process.pid}`;
const created = new Set();

const track = (name) => {
  created.add(name);
  return name;
};

const exists = async (name) => {
  // Lecture de pg_database par la base de maintenance `postgres`, qui n'est pas une base de test.
  const client = new Client({ ...DB_SERVER, database: 'postgres' });
  await client.connect();
  try {
    return (await client.query('select 1 from pg_database where datname = $1', [name])).rowCount === 1;
  } finally {
    await client.end();
  }
};

/** `node tests/prepare-databases.js`, avec les variables données et sans autre configuration. */
const prepare = (variables) =>
  spawnSync(process.execPath, [PREPARE], {
    cwd: STRAPI_DIR,
    encoding: 'utf8',
    timeout: 60_000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_OPTIONS: `--require=${NO_NETWORK}`, ...variables },
  });

describe('bases de test configurables', { timeout: 120_000 }, () => {
  after(async () => {
    for (const name of created) await dropDatabase(name);
  });

  describe('ensureDatabase', () => {
    it('crée une base manquante, puis ne fait rien quand elle existe', async () => {
      const name = track(`${unique}_ensure_test`);
      assert.equal(await exists(name), false);
      await ensureDatabase(name);
      assert.equal(await exists(name), true);
      await ensureDatabase(name);
      assert.equal(await exists(name), true);
    });

    it('supporte des créations simultanées de la même base (deux exécutions qui démarrent ensemble)', async () => {
      const name = track(`${unique}_race_e2e`);
      await Promise.all(Array.from({ length: 6 }, () => ensureDatabase(name)));
      assert.equal(await exists(name), true);
    });
  });

  describe('resetDatabase', () => {
    it('crée la base manquante et la vide, sans toucher à une autre base de test', async () => {
      const first = track(`${unique}_reset_a_test`);
      const second = track(`${unique}_reset_b_test`);

      await resetDatabase(first);
      await resetDatabase(second);
      await queryDatabase(first, 'create table marqueur (id int)');
      await queryDatabase(second, 'create table marqueur (id int)');

      await resetDatabase(first);

      const tables = async (name) =>
        (await queryDatabase(name, `select table_name from information_schema.tables where table_schema = 'public'`)).rows;
      assert.deepEqual(await tables(first), []);
      assert.deepEqual(await tables(second), [{ table_name: 'marqueur' }]);
    });
  });

  describe('prepare-databases.js', () => {
    it('crée les deux bases nommées par TEST_DATABASE et E2E_DATABASE, et le dit', async () => {
      const test = track(`${unique}_prep_test`);
      const e2e = track(`${unique}_prep_e2e`);

      const result = prepare({ TEST_DATABASE: test, E2E_DATABASE: e2e });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`Bases de test prêtes : ${test}, ${e2e}`));
      assert.equal(await exists(test), true);
      assert.equal(await exists(e2e), true);
    });

    it('est répétable : une seconde exécution ne change rien et réussit', () => {
      const test = `${unique}_prep_test`;
      const e2e = `${unique}_prep_e2e`;
      const result = prepare({ TEST_DATABASE: test, E2E_DATABASE: e2e });
      assert.equal(result.status, 0, result.stderr);
    });

    it('conserve le contenu d’une base existante (elle ne vide rien)', async () => {
      const test = `${unique}_prep_test`;
      await queryDatabase(test, 'create table conserve (id int)');
      await queryDatabase(test, 'insert into conserve values (1)');
      const result = prepare({ TEST_DATABASE: test, E2E_DATABASE: `${unique}_prep_e2e` });
      assert.equal(result.status, 0, result.stderr);
      assert.equal((await queryDatabase(test, 'select count(*)::int as n from conserve')).rows[0].n, 1);
    });

    for (const [variable, name] of [
      ['TEST_DATABASE', 'strapi'],
      ['TEST_DATABASE', 'strapi_espace'],
      ['TEST_DATABASE', 'strapi_dev'],
      ['TEST_DATABASE', `${unique}_mauvais_e2e`],
      ['E2E_DATABASE', 'strapi'],
      ['E2E_DATABASE', 'strapi_espace'],
      ['E2E_DATABASE', 'strapi_dev'],
      ['E2E_DATABASE', `${unique}_mauvais_test`],
    ]) {
      it(`refuse ${variable}=${name} avec un message clair, sort en erreur et ne crée aucune base`, async () => {
        const validTest = `${unique}_refus_test`;
        const validE2e = `${unique}_refus_e2e`;
        const result = prepare({ TEST_DATABASE: validTest, E2E_DATABASE: validE2e, [variable]: name });

        assert.equal(result.status, 1);
        assert.match(result.stderr, new RegExp(`Impossible de préparer les bases de test : ${variable} : Base refusée par les tests`));
        assert.ok(!result.stdout.includes('Bases de test prêtes'));
        // Les deux noms sont contrôlés avant la première connexion : la base valide n'a pas été créée non plus.
        assert.equal(await exists(validTest), false);
        assert.equal(await exists(validE2e), false);
        if (name.startsWith(unique)) assert.equal(await exists(name), false, `${name} ne doit pas avoir été créée`);
      });
    }
  });
});
