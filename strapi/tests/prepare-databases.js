'use strict';

/**
 * Crée les bases de test si elles manquent (strapi_test et strapi_e2e), sans les vider : chaque suite
 * vide la sienne au démarrage. Utilisé par le workflow GitHub Actions et utilisable en local :
 *
 *   node tests/prepare-databases.js        (depuis strapi/)
 *
 * Refuse tout nom qui ne finit pas par _test ou _e2e ; n'ouvre jamais la base `strapi`.
 */

const { ensureDatabase } = require('./helpers/database');

const DATABASES = ['strapi_test', 'strapi_e2e'];

Promise.all(DATABASES.map(ensureDatabase)).then(
  () => console.log(`Bases de test prêtes : ${DATABASES.join(', ')}`),
  (error) => {
    console.error(`Impossible de préparer les bases de test : ${error.message}`);
    process.exit(1);
  }
);
