'use strict';

/**
 * Strapi des tests de bout en bout (A-14, C3) : lancé par le `webServer` de web/playwright.config.ts.
 *
 *   1. vide la base e2e (E2E_DATABASE, défaut strapi_e2e ; créée si elle manque) ;
 *   2. y exécute le seed de recette, dans un sous-processus, comme `pnpm seed` ;
 *   3. démarre Strapi sans construire l'admin, sur 127.0.0.1:E2E_STRAPI_PORT (défaut 1348).
 *
 * Même environnement hermétique que les tests d'intégration : pas de .env, console pour les e-mails,
 * DEMO_SEED=false, aucun appel réseau (précharger helpers/no-network.js avec `node --require`).
 * Arrêt propre sur SIGTERM et SIGINT.
 *
 * Lot 7 de la phase 1 : le navigateur des tests parcourt l'espace participant sur le front e2e
 * (127.0.0.1:E2E_WEB_PORT, défaut 4332). PUBLIC_URL (liens des e-mails, redirections 303) et CORS_ORIGINS (contrôle `Origin`,
 * CORS des appels de l'îlot d'E2) pointent donc sur lui, et non sur http://localhost:4321 de `buildTestEnv`. ORGANIZER_EMAILS
 * et IS_PROXIED gardent les valeurs de `buildTestEnv` ; chaque test du navigateur choisit son IP par `X-Forwarded-For`.
 * La boîte de sortie des e-mails est le fichier de `buildTestEnv` pour la base e2e (dossier temporaire du système, un fichier
 * par base) : supprimée au démarrage, elle ne contient que les messages de cette exécution, et les tests la relisent
 * (web/tests/e2e/espace.ts).
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { STRAPI_DIR, buildTestEnv, e2eDatabaseName } = require('./helpers/env');
const { resetDatabase } = require('./helpers/database');
const { startStrapi } = require('./helpers/strapi');

const NO_NETWORK = path.join(__dirname, 'helpers/no-network.js');
const PORT = Number(process.env.E2E_STRAPI_PORT) || 1348;
const WEB_URL = `http://127.0.0.1:${Number(process.env.E2E_WEB_PORT) || 4332}`;

async function main() {
  const database = e2eDatabaseName();
  await resetDatabase(database);

  const seed = spawnSync(process.execPath, [path.join(STRAPI_DIR, 'scripts/espace/seed.js')], {
    cwd: STRAPI_DIR,
    env: { ...buildTestEnv({ database }), NODE_OPTIONS: `--require=${NO_NETWORK}` },
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (seed.status !== 0) {
    throw new Error(`Le seed de recette a échoué (code ${seed.status}) :\n${seed.stdout}\n${seed.stderr}`);
  }
  console.log(seed.stdout.trim());

  // Boîte de sortie propre à cette exécution : le seed n'envoie rien, mais une exécution précédente a pu y écrire.
  fs.rmSync(buildTestEnv({ database }).EMAIL_OUTBOX_FILE, { force: true });

  const strapi = await startStrapi({ database, reset: false, port: PORT, overrides: { PUBLIC_URL: WEB_URL, CORS_ORIGINS: WEB_URL } });
  console.log(`Strapi des tests e2e prêt sur ${strapi.baseUrl} (base ${database})`);

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
