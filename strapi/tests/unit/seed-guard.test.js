'use strict';

/**
 * Garde du seed de recette (A-13, B3) : le seed ne tourne que sur une base en _test ou _e2e et jamais
 * sous NODE_ENV=production.
 *
 * Ce fichier ne lance JAMAIS le seed contre `strapi` ni `strapi_espace`. Il vérifie la garde de trois façons :
 *  1. directement : `isSeedAllowed({ database, nodeEnv })`, prédicat pur exporté par scripts/espace/seed.js ;
 *  2. en code : la garde est placée avant app.load(), la seule étape qui ouvre la connexion à la base (lecture
 *     du source, faute de pouvoir observer l'ordre autrement) ;
 *  3. en sous-processus, avec un nom de base inventé (qui n'existe pas) et avec NODE_ENV=production :
 *     le seed s'arrête avec un message clair avant toute connexion. `require` du module, lui, ne lance rien.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// @strapi/strapi, que seed.js charge, lit ENV_PATH à l'import : aucun strapi/.env dans ce processus.
process.env.ENV_PATH = os.devNull;
const { isSeedAllowed } = require('../../scripts/espace/seed');

const STRAPI_DIR = path.resolve(__dirname, '../..');
const SEED = path.join(STRAPI_DIR, 'scripts/espace/seed.js');
const NO_NETWORK = path.join(STRAPI_DIR, 'tests/helpers/no-network.js');
const source = fs.readFileSync(SEED, 'utf8');

describe('garde du seed : isSeedAllowed (prédicat exporté)', () => {
  it('est une fonction exportée par le module', () => {
    assert.equal(typeof isSeedAllowed, 'function');
  });

  for (const refused of ['strapi', 'strapi_espace', 'strapi_prod', 'strapi_test_old', 'test', 'e2e', '', 'strapi_e2e_', 'strapi-e2e', 'Strapi_E2E', 'strapi_e2e\n', undefined, null]) {
    it(`refuse la base ${JSON.stringify(refused) ?? 'undefined'}`, () => {
      assert.equal(isSeedAllowed({ database: refused, nodeEnv: 'test' }), false);
    });
  }

  for (const accepted of ['strapi_e2e', 'strapi_test', 'jib_e2e', 'strapi_dev_test', 'strapi_dev_e2e']) {
    it(`admet la base « ${accepted} »`, () => {
      assert.equal(isSeedAllowed({ database: accepted, nodeEnv: 'test' }), true);
    });
  }

  for (const nodeEnv of [undefined, 'development', 'test']) {
    it(`admet une base de recette sous NODE_ENV=${nodeEnv}`, () => {
      assert.equal(isSeedAllowed({ database: 'strapi_e2e', nodeEnv }), true);
    });
  }

  it('refuse NODE_ENV=production, même sur une base de recette', () => {
    assert.equal(isSeedAllowed({ database: 'strapi_e2e', nodeEnv: 'production' }), false);
    assert.equal(isSeedAllowed({ database: 'strapi_test', nodeEnv: 'production' }), false);
  });

  it('refuse les deux bases de référence quel que soit NODE_ENV', () => {
    for (const nodeEnv of [undefined, 'development', 'test', 'production']) {
      for (const database of ['strapi', 'strapi_espace']) {
        assert.equal(isSeedAllowed({ database, nodeEnv }), false, `${database} sous ${nodeEnv}`);
      }
    }
  });
});

describe('garde du seed : ordre des étapes de main() (lecture du source)', () => {
  const at = (needle) => {
    const index = source.indexOf(needle);
    assert.notEqual(index, -1, `« ${needle} » introuvable dans seed.js`);
    return index;
  };

  it('vérifie NODE_ENV=production avant de créer Strapi', () => {
    assert.ok(at("process.env.NODE_ENV === 'production'") < at('createStrapi('));
  });

  it('vérifie le nom de la base avant app.load(), qui ouvre la connexion', () => {
    assert.ok(at('refuse(`la base') < at('app.load()'));
  });

  it('vérifie le nom de la base avant tout effacement (wipe) ou création (populate)', () => {
    assert.ok(at('refuse(`la base') < at('await wipe(app)'));
    assert.ok(at('refuse(`la base') < at('await populate(app)'));
  });

  it('lit la base effective de la configuration de Strapi, non une variable d’environnement brute', () => {
    assert.match(source, /app\.config\.get\('database\.connection\.connection\.database'\)/);
  });

  it('termine par process.exit(1) quand elle refuse', () => {
    assert.match(source, /function refuse\([^)]*\) \{[\s\S]*?process\.exit\(1\);/);
  });

  it('impose DEMO_SEED=false avant de créer Strapi, pour ne créer aucune édition de démonstration', () => {
    assert.ok(at("process.env.DEMO_SEED = 'false'") < at('createStrapi('));
  });
});

describe('garde du seed : sous-processus (base inventée, sans connexion)', () => {
  /** Environnement hermétique : aucun .env, aucune base réelle, réseau interdit. */
  const run = (overrides) =>
    spawnSync(process.execPath, [SEED], {
      cwd: STRAPI_DIR,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        ENV_PATH: os.devNull,
        TZ: 'UTC',
        HOST: '127.0.0.1',
        PORT: '0',
        APP_KEYS: 'test-key-1,test-key-2',
        API_TOKEN_SALT: 'test',
        ADMIN_JWT_SECRET: 'test',
        TRANSFER_TOKEN_SALT: 'test',
        JWT_SECRET: 'test',
        DATABASE_HOST: 'localhost',
        EMAIL_API_KEY: '',
        EMAIL_PROVIDER: 'console',
        STRAPI_TELEMETRY_DISABLED: 'true',
        NODE_OPTIONS: `--require=${NO_NETWORK}`,
        ...overrides,
      },
    });

  it('refuse un nom de base qui n’est pas _test ou _e2e, avec un message clair, et sort en erreur', () => {
    const result = run({ DATABASE_NAME: 'strapi_inexistante_prod' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Seed refusé : la base « strapi_inexistante_prod » n’est pas une base de recette/);
    assert.match(result.stderr, /_e2e ou _test/);
    assert.match(result.stderr, /DATABASE_NAME=strapi_e2e/);
    assert.ok(!result.stdout.includes('Seed de recette terminé'));
  });

  it('refuse NODE_ENV=production, même sur une base _test', () => {
    const result = run({ DATABASE_NAME: 'strapi_test', NODE_ENV: 'production' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Seed refusé : NODE_ENV vaut production/);
  });

  // main() ne s'exécute que si le fichier est lancé directement (require.main === module) : le charger pour tester
  // la garde ne doit ni créer Strapi, ni lire strapi/.env, ni terminer le processus.
  it('require ne lance pas le seed : aucun effet, aucune sortie, pas de sortie du processus', () => {
    const result = spawnSync(
      process.execPath,
      ['-e', `const seed = require(${JSON.stringify(SEED)}); console.log(Object.keys(seed).join(','))`],
      { cwd: STRAPI_DIR, encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH, HOME: process.env.HOME, ENV_PATH: os.devNull, NODE_OPTIONS: `--require=${NO_NETWORK}` } }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'isSeedAllowed');
    assert.equal(result.stderr, '');
  });

  it('ne se connecte à aucune base avant de refuser (aucune erreur de connexion dans la sortie)', () => {
    const result = run({ DATABASE_NAME: 'strapi_inexistante_prod' });
    assert.ok(!/ECONNREFUSED|does not exist|database .* does not exist|password authentication/i.test(result.stderr));
  });
});
