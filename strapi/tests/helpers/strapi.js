'use strict';

/**
 * Démarrage de Strapi par programme pour les tests d'intégration (A-14) : base de test vidée, aucun
 * admin construit, serveur HTTP sur un port libre de 127.0.0.1.
 *
 * L'environnement doit être posé avant le chargement de @strapi/strapi, qui lit ENV_PATH à
 * l'import : le module n'est donc requis qu'ici, après `buildTestEnv`.
 */

const { STRAPI_DIR, assertTestDatabase, buildTestEnv } = require('./env');
const { resetDatabase } = require('./database');

const SETTLE_MS = 750;

/**
 * @param {object} [options]
 * @param {string} [options.database] base de test (_test ou _e2e)
 * @param {boolean} [options.reset] vider la base avant le démarrage (défaut : oui)
 * @param {number} [options.port] port d'écoute sur 127.0.0.1 (défaut : 0, un port libre)
 * @param {object} [options.overrides] variables d'environnement à surcharger (undefined = retirer)
 * @param {(app: object) => Promise<void>|void} [options.beforeBootstrap] appelé entre register() et bootstrap(),
 *   c'est-à-dire après le chargement des plugins et avant src/index.js (pour simuler un service)
 * @returns {Promise<{ app: object, baseUrl: string, env: object, stop: () => Promise<void> }>}
 */
async function startStrapi({ database = 'strapi_test', reset = true, port = 0, overrides = {}, beforeBootstrap } = {}) {
  assertTestDatabase(database);
  const env = buildTestEnv({ database, port, overrides });

  if (reset) await resetDatabase(database);

  // Remplace l'environnement du processus : rien de ce qui précède ne doit subsister (clé Brevo, base).
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  process.chdir(STRAPI_DIR);

  const { compileStrapi, createStrapi } = require('@strapi/strapi');
  const app = createStrapi(await compileStrapi());

  // Strapi a lu l'environnement sans surcharge : vérifier la base effective avant toute connexion.
  const effective = app.config.get('database.connection.connection.database');
  assertTestDatabase(effective);

  app.log.level = 'error';
  // Équivalent de app.load() (register puis bootstrap), avec un point d'accroche entre les deux.
  await app.register();
  await beforeBootstrap?.(app);
  await app.bootstrap();
  app.isLoaded = true;
  app.server.mount();
  await new Promise((resolve, reject) => {
    app.server.httpServer.once('error', reject);
    app.server.httpServer.listen(port, '127.0.0.1', resolve);
  });

  const listening = app.server.httpServer.address().port;
  return {
    app,
    env,
    baseUrl: `http://127.0.0.1:${listening}`,
    stop: async () => {
      // Les événements entry.create et entry.publish sont émis sans être attendus et lisent encore la base :
      // détruire le pool tout de suite les laisserait attendre 60 s une connexion et retiendrait le processus.
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      await app.destroy();
    },
  };
}

module.exports = { startStrapi };
