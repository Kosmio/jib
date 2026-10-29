'use strict';

/**
 * Crée les bases de test si elles manquent, sans les vider : chaque suite vide la sienne au démarrage.
 * Ce sont TEST_DATABASE (défaut strapi_test) et E2E_DATABASE (défaut strapi_e2e). Utilisé par le workflow
 * GitHub Actions et utilisable en local :
 *
 *   node tests/prepare-databases.js        (depuis strapi/)
 *
 * Refuse tout nom qui ne finit pas par _test (TEST_DATABASE) ou _e2e (E2E_DATABASE) ; n'ouvre jamais la base `strapi`.
 */

const { e2eDatabaseName, testDatabaseName } = require('./helpers/env');
const { ensureDatabase } = require('./helpers/database');

async function main() {
  // Les noms sont contrôlés tous les deux avant la première connexion.
  const databases = [testDatabaseName(), e2eDatabaseName()];
  for (const name of databases) await ensureDatabase(name);
  console.log(`Bases de test prêtes : ${databases.join(', ')}`);
}

main().catch((error) => {
  console.error(`Impossible de préparer les bases de test : ${error.message}`);
  process.exit(1);
});
