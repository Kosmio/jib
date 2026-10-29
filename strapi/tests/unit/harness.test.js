'use strict';

/**
 * Garde-fous du harnais de test (A-13, A-14) : aucun test n'ouvre la base `strapi` ni `strapi_espace`, aucun
 * secret réel n'entre dans un processus de test, aucun e-mail réel ne peut partir. Ce sont les preuves que
 * « aucun test ne touche aux bases de référence » ne repose pas sur la seule discipline de celui qui écrit un test.
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const os = require('node:os');

const { assertTestDatabase, buildTestEnv } = require('../helpers/env');
const { ensureDatabase, queryDatabase, resetDatabase } = require('../helpers/database');

describe('assertTestDatabase', () => {
  for (const name of ['strapi', 'strapi_espace']) {
    it(`refuse la base « ${name} »`, () => {
      assert.throws(() => assertTestDatabase(name), /Base refusée par les tests/);
    });
  }

  for (const name of ['strapi_prod', 'postgres', 'strapi_test_old', 'test', '_test', 'Strapi_Test', 'strapi-test', 'strapi_test; drop', '', undefined, null, 42]) {
    it(`refuse ${JSON.stringify(name) ?? 'undefined'}`, () => {
      assert.throws(() => assertTestDatabase(name), /Base refusée par les tests/);
    });
  }

  for (const name of ['strapi_test', 'strapi_e2e', 'autre_test']) {
    it(`admet « ${name} »`, () => {
      assert.equal(assertTestDatabase(name), name);
    });
  }
});

describe('base de données : aucune connexion avant la vérification du nom', () => {
  for (const name of ['strapi', 'strapi_espace']) {
    it(`ensureDatabase, resetDatabase et queryDatabase refusent « ${name} » sans se connecter`, async () => {
      // Une connexion tentée aurait échoué autrement (ou réussi) : on exige l'erreur du harnais, avant tout réseau.
      for (const call of [() => ensureDatabase(name), () => resetDatabase(name), () => queryDatabase(name, 'select 1')]) {
        await assert.rejects(call(), /Base refusée par les tests/);
      }
    });
  }

  it('n’ouvre aucune socket pendant le refus', async (t) => {
    const connect = t.mock.method(net.Socket.prototype, 'connect', () => {
      throw new Error('connexion interdite');
    });
    await assert.rejects(resetDatabase('strapi'), /Base refusée par les tests/);
    assert.equal(connect.mock.callCount(), 0);
  });
});

describe('buildTestEnv : environnement hermétique', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  });

  it('ne lit aucun fichier .env (ENV_PATH vide)', () => {
    assert.equal(buildTestEnv().ENV_PATH, os.devNull);
  });

  it('impose NODE_ENV=test, TZ=UTC et le fournisseur d’e-mail console', () => {
    const env = buildTestEnv();
    assert.equal(env.NODE_ENV, 'test');
    assert.equal(env.TZ, 'UTC');
    assert.equal(env.EMAIL_PROVIDER, 'console');
  });

  it('vide la clé Brevo, même si l’environnement parent en porte une', () => {
    process.env.EMAIL_API_KEY = 'xkeysib-cle-reelle';
    process.env.EMAIL_PROVIDER = 'brevo';
    const env = buildTestEnv();
    assert.equal(env.EMAIL_API_KEY, '');
    assert.equal(env.EMAIL_PROVIDER, 'console');
  });

  it('impose la base demandée, même si l’environnement parent en nomme une autre', () => {
    process.env.DATABASE_NAME = 'strapi_espace';
    assert.equal(buildTestEnv({ database: 'strapi_e2e' }).DATABASE_NAME, 'strapi_e2e');
    assert.equal(buildTestEnv().DATABASE_NAME, 'strapi_test');
  });

  it('refuse de construire un environnement pour une base interdite', () => {
    for (const database of ['strapi', 'strapi_espace']) {
      assert.throws(() => buildTestEnv({ database }), /Base refusée par les tests/);
    }
  });

  it('empêche une surcharge de changer de base', () => {
    const env = buildTestEnv({ database: 'strapi_test', overrides: { DATABASE_NAME: 'strapi_espace' } });
    assert.equal(env.DATABASE_NAME, 'strapi_test');
  });

  it('permet de retirer une variable par une surcharge undefined (DEMO_SEED)', () => {
    assert.equal(buildTestEnv().DEMO_SEED, 'false');
    assert.ok(!('DEMO_SEED' in buildTestEnv({ overrides: { DEMO_SEED: undefined } })));
  });

  it('coupe les tâches planifiées, la restauration de médias et la télémétrie', () => {
    const env = buildTestEnv();
    assert.equal(env.CRON_ENABLED, 'false');
    assert.equal(env.RESTORE_MISSING_MEDIA, 'false');
    assert.equal(env.STRAPI_TELEMETRY_DISABLED, 'true');
  });

  it('n’emploie que des valeurs factices pour les clés et sels de Strapi', () => {
    const env = buildTestEnv();
    for (const key of ['APP_KEYS', 'API_TOKEN_SALT', 'ADMIN_JWT_SECRET', 'TRANSFER_TOKEN_SALT', 'JWT_SECRET', 'ALTCHA_HMAC_KEY']) {
      assert.match(env[key], /^test-/, key);
    }
  });

  it('n’admet qu’un Postgres local', () => {
    assert.equal(buildTestEnv().DATABASE_HOST, 'localhost');
  });

  it('range la boîte d’e-mails dans le dossier temporaire du système, un fichier par base', () => {
    assert.ok(buildTestEnv({ database: 'strapi_test' }).EMAIL_OUTBOX_FILE.startsWith(os.tmpdir()));
    assert.notEqual(buildTestEnv({ database: 'strapi_test' }).EMAIL_OUTBOX_FILE, buildTestEnv({ database: 'strapi_e2e' }).EMAIL_OUTBOX_FILE);
  });
});

describe('garde-fou réseau (no-network.js)', () => {
  it('est chargé dans ce processus', () => {
    assert.ok(Array.isArray(globalThis.__blockedConnections), 'lancer les tests avec « node --require ./tests/helpers/no-network.js » (pnpm test)');
  });

  it('refuse une connexion hors localhost et l’enregistre', async () => {
    const before = globalThis.__blockedConnections.length;
    await assert.rejects(fetch('https://registry.npmjs.org/@strapi/strapi'));
    assert.equal(globalThis.__blockedConnections.length, before + 1);
    assert.equal(globalThis.__blockedConnections.at(-1), 'registry.npmjs.org');
    globalThis.__blockedConnections.pop();
  });

  it('laisse passer localhost', async () => {
    const server = require('node:http').createServer((req, res) => res.end('ok'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://localhost:${server.address().port}`);
      assert.equal(await response.text(), 'ok');
    } finally {
      server.close();
    }
  });
});
