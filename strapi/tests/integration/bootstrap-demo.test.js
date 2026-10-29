'use strict';

/**
 * Garde DEMO_SEED du bootstrap (B4, critère 6) : sans la variable, le bootstrap se comporte comme avant et
 * crée les éditions de démonstration sur une base vide. (Avec DEMO_SEED=false, api.test.js montre l'inverse.)
 *
 * Le téléversement d'images est simulé avant le bootstrap : les 43 Mo de strapi/seed-assets ne sont pas copiés
 * dans strapi/public/uploads, dossier que partage le Strapi de développement.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startStrapi } = require('../helpers/strapi');

describe('bootstrap sans DEMO_SEED, sur une base vide', { timeout: 300_000 }, () => {
  let strapi;
  let uploads = 0;

  before(async () => {
    strapi = await startStrapi({
      overrides: { DEMO_SEED: undefined },
      beforeBootstrap: (app) => {
        app.plugin('upload').service('upload').upload = async () => {
          uploads += 1;
          return [];
        };
      },
    });
  });

  after(async () => {
    await strapi?.stop();
  });

  it('n’a pas de variable DEMO_SEED dans l’environnement du test', () => {
    assert.equal(process.env.DEMO_SEED, undefined);
  });

  it('crée les éditions de démonstration', async () => {
    assert.ok((await strapi.app.documents('api::edition.edition').count({})) > 0);
  });

  it('crée les tags, organisations, intervenants et séquences de démonstration', async () => {
    for (const uid of ['api::tag.tag', 'api::organisation.organisation', 'api::intervenant.intervenant', 'api::sequence.sequence']) {
      assert.ok((await strapi.app.documents(uid).count({})) > 0, uid);
    }
  });

  it('tente de téléverser les images de démonstration (simulé : aucun fichier écrit)', async () => {
    assert.ok(uploads > 0);
    assert.equal(await strapi.app.db.query('plugin::upload.file').count({}), 0);
  });

  it('ne crée pas l’édition de recette (réservée au seed)', async () => {
    assert.equal(await strapi.app.documents('api::edition.edition').count({ filters: { slug: 'nouvelle-aquitaine-test' } }), 0);
  });
});
