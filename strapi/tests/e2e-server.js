'use strict';

/**
 * Strapi des tests de bout en bout (A-14, C3) : lancé par le `webServer` de web/playwright.config.ts.
 *
 *   1. vide la base strapi_e2e (créée si elle manque) ;
 *   2. y exécute le seed de recette, dans un sous-processus, comme `pnpm seed` ;
 *   3. démarre Strapi sans construire l'admin, sur 127.0.0.1:E2E_STRAPI_PORT (défaut 1338).
 *
 * Même environnement hermétique que les tests d'intégration : pas de .env, console pour les e-mails,
 * DEMO_SEED=false, aucun appel réseau (précharger helpers/no-network.js avec `node --require`).
 * Arrêt propre sur SIGTERM et SIGINT.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { STRAPI_DIR, buildTestEnv } = require('./helpers/env');
const { resetDatabase } = require('./helpers/database');
const { startStrapi } = require('./helpers/strapi');

const DATABASE = 'strapi_e2e';
const NO_NETWORK = path.join(__dirname, 'helpers/no-network.js');
const PORT = Number(process.env.E2E_STRAPI_PORT) || 1338;

async function main() {
  await resetDatabase(DATABASE);

  const seed = spawnSync(process.execPath, [path.join(STRAPI_DIR, 'scripts/espace/seed.js')], {
    cwd: STRAPI_DIR,
    env: { ...buildTestEnv({ database: DATABASE }), NODE_OPTIONS: `--require=${NO_NETWORK}` },
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (seed.status !== 0) {
    throw new Error(`Le seed de recette a échoué (code ${seed.status}) :\n${seed.stdout}\n${seed.stderr}`);
  }
  console.log(seed.stdout.trim());

  const strapi = await startStrapi({ database: DATABASE, reset: false, port: PORT });
  console.log(`Strapi des tests e2e prêt sur ${strapi.baseUrl} (base ${DATABASE})`);

  const stop = async () => {
    await strapi.stop();
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
