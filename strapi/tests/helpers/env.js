'use strict';

/**
 * Environnement imposé à tout processus Strapi lancé par les tests (A-13, A-14).
 *
 * Il est hermétique : `strapi/.env` n'est jamais lu (ENV_PATH pointe sur un fichier vide), donc ni
 * la clé Brevo réelle, ni le nom de base de développement ne peuvent s'y infiltrer. Seules les bases
 * dont le nom finit par _test ou _e2e sont admises, et jamais `strapi` ni `strapi_espace`.
 *
 * Les noms des deux bases se règlent par TEST_DATABASE (défaut strapi_test) et E2E_DATABASE (défaut strapi_e2e),
 * pour que plusieurs exécutions simultanées aient chacune les leurs.
 */

const os = require('node:os');
const path = require('node:path');

const STRAPI_DIR = path.resolve(__dirname, '../..');

// Le Postgres du conteneur jib-postgres en local, le service postgres du workflow en CI.
const DB_SERVER = { host: 'localhost', port: 5432, user: 'strapi', password: 'strapi' };

const TEST_DATABASE_PATTERN = /^[a-z0-9]+(_[a-z0-9]+)*_(test|e2e)$/;
const FORBIDDEN_DATABASES = new Set(['strapi', 'strapi_espace']);
// Postgres tronque au-delà de 63 octets : un nom plus long ne serait plus celui qui a été validé.
const MAX_DATABASE_NAME_LENGTH = 63;

// Bases par défaut ; deux agents ou plus qui testent en même temps donnent chacun les leurs (TEST_DATABASE, E2E_DATABASE).
const DEFAULT_TEST_DATABASE = 'strapi_test';
const DEFAULT_E2E_DATABASE = 'strapi_e2e';

/** Lève une erreur si `name` n'est pas une base de test (_test ou _e2e). À appeler avant toute connexion. */
function assertTestDatabase(name) {
  if (
    typeof name !== 'string' ||
    name.length > MAX_DATABASE_NAME_LENGTH ||
    FORBIDDEN_DATABASES.has(name) ||
    !TEST_DATABASE_PATTERN.test(name)
  ) {
    throw new Error(`Base refusée par les tests : « ${name} ». Seules les bases en _test ou _e2e sont admises.`);
  }
  return name;
}

/**
 * Base lue dans la variable `variable` (défaut `fallback` si elle est absente ou vide), validée avant tout usage :
 * base de test (assertTestDatabase) dont le nom finit par `_${suffix}`, ce qui interdit aussi de donner la même base
 * aux tests d'intégration et au e2e.
 */
function configuredDatabase(variable, suffix, fallback, env) {
  const name = env[variable] || fallback;
  try {
    assertTestDatabase(name);
  } catch (error) {
    throw new Error(`${variable} : ${error.message}`);
  }
  if (!name.endsWith(`_${suffix}`)) {
    throw new Error(`${variable} : Base refusée par les tests : « ${name} » doit finir par _${suffix}.`);
  }
  return name;
}

/** Base des tests d'intégration : TEST_DATABASE (défaut strapi_test), en `_test`. */
const testDatabaseName = (env = process.env) => configuredDatabase('TEST_DATABASE', 'test', DEFAULT_TEST_DATABASE, env);

/** Base des tests e2e et du seed de recette : E2E_DATABASE (défaut strapi_e2e), en `_e2e`. */
const e2eDatabaseName = (env = process.env) => configuredDatabase('E2E_DATABASE', 'e2e', DEFAULT_E2E_DATABASE, env);

/**
 * Variables d'un processus Strapi de test. `overrides` s'applique en dernier (par exemple pour
 * retirer DEMO_SEED), sans jamais pouvoir changer de base : DATABASE_NAME est contrôlée ici.
 */
function buildTestEnv({ database = testDatabaseName(), port = 0, outboxFile, overrides = {} } = {}) {
  assertTestDatabase(database);
  const outbox = outboxFile || path.join(os.tmpdir(), `jib-mail-outbox-${database}.jsonl`);

  const env = {
    ...process.env,
    // Aucun fichier .env : environnement entièrement décrit ici.
    ENV_PATH: os.devNull,
    NODE_ENV: 'test',
    TZ: 'UTC',

    HOST: '127.0.0.1',
    PORT: String(port),
    BASE_URL: 'http://127.0.0.1:1337',
    // Valeurs factices, sans valeur de secret.
    APP_KEYS: 'test-key-1,test-key-2,test-key-3,test-key-4',
    API_TOKEN_SALT: 'test-api-token-salt',
    ADMIN_JWT_SECRET: 'test-admin-jwt-secret',
    TRANSFER_TOKEN_SALT: 'test-transfer-token-salt',
    JWT_SECRET: 'test-jwt-secret',
    ALTCHA_HMAC_KEY: 'test-altcha-hmac-key',

    DATABASE_CLIENT: 'postgres',
    DATABASE_HOST: DB_SERVER.host,
    DATABASE_PORT: String(DB_SERVER.port),
    DATABASE_USERNAME: DB_SERVER.user,
    DATABASE_PASSWORD: DB_SERVER.password,
    DATABASE_NAME: database,

    // Aucun e-mail réel (NF-53) : fournisseur console, aucune clé Brevo.
    EMAIL_PROVIDER: 'console',
    EMAIL_API_KEY: '',
    EMAIL_FROM: 'Journées de l’Innovation Filière Bois <espace@example.org>',
    EMAIL_OUTBOX_FILE: outbox,
    EMAIL_LIST_ID: '',
    EMAIL_CONTACT_TO: '',
    EMAIL_CONTACT_TEMPLATE_ID: '',

    DEMO_SEED: 'false',
    CRON_ENABLED: 'false',
    RESTORE_MISSING_MEDIA: 'false',

    // Phase 1 : adresse publique des liens et des redirections, origines admises (CORS et contrôle Origin, NF-04),
    // organisateur par e-mail (I-23). IS_PROXIED : Strapi lit l'IP dans X-Forwarded-For, ce qui permet à chaque
    // requête de test de choisir la sienne (limitation de débit, NF-03).
    PUBLIC_URL: 'http://localhost:4321',
    CORS_ORIGINS: 'http://localhost:4321',
    ORGANIZER_EMAILS: 'organisation@example.org',
    IS_PROXIED: 'true',
    // HelloAsso : jamais celui de l'environnement du poste. Un test qui synchronise démarre le faux HelloAsso en module
    // et passe son `apiBase` en surcharge (tests/helpers/espace.js).
    HELLOASSO_API_BASE: '',
    HELLOASSO_CLIENT_ID: '',
    HELLOASSO_CLIENT_SECRET: '',

    // Aucun appel réseau : télémétrie de Strapi coupée (la notification de mise à jour n'a pas de variable : voir no-network.js).
    STRAPI_TELEMETRY_DISABLED: 'true',
    STRAPI_HIDE_STARTUP_MESSAGE: 'true',
  };

  Object.assign(env, overrides);
  // Une surcharge `undefined` retire la variable (par exemple DEMO_SEED).
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  // Une surcharge ne doit jamais rouvrir la porte à une autre base.
  env.DATABASE_NAME = database;
  return env;
}

module.exports = {
  DB_SERVER,
  DEFAULT_E2E_DATABASE,
  DEFAULT_TEST_DATABASE,
  STRAPI_DIR,
  assertTestDatabase,
  buildTestEnv,
  e2eDatabaseName,
  testDatabaseName,
};
