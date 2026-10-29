'use strict';

/**
 * Strapi démarré sur la base de test, TEST_DATABASE ou strapi_test (A-14) : squelette de l'API de l'espace (B4, A-02), absence de route CRUD,
 * bootstrap sans données de démonstration (DEMO_SEED=false), câblage de la configuration e-mail (B1, NF-53).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { testDatabaseName } = require('../helpers/env');
const { startStrapi } = require('../helpers/strapi');
const { createMailProvider } = require('../../src/api/espace/lib/mail');

const DATABASE = testDatabaseName();

describe('Strapi sur la base de test', { timeout: 180_000 }, () => {
  let strapi;
  const request = (path, init) => fetch(`${strapi.baseUrl}${path}`, init);
  const routes = () => strapi.app.server.listRoutes();
  const espaceRoutes = () => routes().filter((route) => route.path.startsWith('/api/espace'));

  before(async () => {
    strapi = await startStrapi();
  });

  after(async () => {
    if (!strapi) return;
    await strapi.stop();
    fs.rmSync(strapi.env.EMAIL_OUTBOX_FILE, { force: true });
  });

  describe('environnement du test', () => {
    it('tourne sur la base de test configurée (TEST_DATABASE, défaut strapi_test)', () => {
      assert.equal(strapi.app.config.get('database.connection.connection.database'), DATABASE);
    });

    it('n’a lu aucun fichier .env : la clé Brevo est vide', () => {
      assert.equal(strapi.app.config.get('server.email.apiKey'), '');
    });

    it('tourne sous NODE_ENV=test', () => {
      assert.equal(strapi.app.config.get('environment') ?? process.env.NODE_ENV, 'test');
    });
  });

  describe('GET /api/espace/health (B4)', () => {
    it('répond 200 {"status":"ok"} en JSON, sans authentification', async () => {
      const response = await request('/api/espace/health');
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^application\/json/);
      assert.deepEqual(await response.json(), { status: 'ok' });
    });

    it('répond 200 à HEAD', async () => {
      assert.equal((await request('/api/espace/health', { method: 'HEAD' })).status, 200);
    });

    it('ignore un jeton d’authentification invalide (auth: false)', async () => {
      const response = await request('/api/espace/health', { headers: { authorization: 'Bearer jeton-invalide' } });
      assert.equal(response.status, 200);
    });

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      it(`répond 405 à ${method}`, async () => {
        const response = await request('/api/espace/health', {
          method,
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        assert.equal(response.status, 405);
        assert.match(response.headers.get('allow') ?? '', /GET/);
      });
    }

    it('n’écrit rien en base : aucune édition créée par un appel', async () => {
      await request('/api/espace/health');
      assert.equal(await strapi.app.documents('api::edition.edition').count({}), 0);
    });
  });

  describe('aucune route CRUD sous /api/espace (A-02)', () => {
    it('ne déclare que GET /api/espace/health sous /api/espace', () => {
      const declared = espaceRoutes().map((route) => ({ methods: route.methods.filter((m) => m !== 'HEAD'), path: route.path }));
      assert.deepEqual(declared, [{ methods: ['GET'], path: '/api/espace/health' }]);
    });

    it('ne rattache aucune route à un contrôleur d’un type api::espace.*', () => {
      const names = Object.keys(strapi.app.contentTypes).filter((uid) => uid.startsWith('api::espace.'));
      for (const uid of names) {
        const { pluralName, singularName } = strapi.app.contentTypes[uid].info;
        const crud = routes().filter((route) => [`/api/${pluralName}`, `/api/${singularName}`].some((base) => route.path.startsWith(base)));
        assert.deepEqual(
          crud.map((route) => route.path),
          [],
          `routes CRUD générées pour ${uid}`
        );
      }
    });

    // Un GET sur un chemin inconnu donne 404. Une écriture donne 404 ou 405 : le service de fichiers statiques
    // de Strapi déclare un GET fourre-tout, d'où le 405 de koa-router. Dans les deux cas, rien n'est servi.
    for (const path of ['/api/espace', '/api/espace/', '/api/espace/attendees', '/api/espace/editions', '/api/espace/meetings', '/api/attendees', '/api/espaces']) {
      it(`répond 404 à GET ${path}`, async () => {
        assert.equal((await request(path)).status, 404);
      });
    }

    for (const [method, path] of [
      ['POST', '/api/espace/attendees'],
      ['PUT', '/api/espace/attendees/1'],
      ['DELETE', '/api/espace/attendees/1'],
      ['POST', '/api/espace/meetings'],
    ]) {
      it(`ne sert pas ${method} ${path} (404 ou 405)`, async () => {
        const response = await request(path, { method, headers: { 'content-type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' });
        assert.ok([404, 405].includes(response.status), `statut ${response.status}`);
      });
    }
  });

  describe('routes existantes du site inchangées', () => {
    it('garde les routes personnalisées contact, newsletter et captcha', () => {
      const paths = routes().map((route) => `${route.methods.filter((m) => m !== 'HEAD').join(',')} ${route.path}`);
      for (const expected of ['POST /api/contact/send', 'POST /api/newsletter/subscribe', 'GET /api/captcha/challenge']) {
        assert.ok(paths.includes(expected), `${expected} absente`);
      }
    });

    it('garde les routes publiques de lecture des éditions, intervenants et organisations (permissions du bootstrap)', async () => {
      for (const path of ['/api/editions', '/api/intervenants', '/api/organisations', '/api/sequences', '/api/tags']) {
        const response = await request(path);
        assert.equal(response.status, 200, path);
        assert.deepEqual((await response.json()).data, [], `${path} : base vide attendue`);
      }
    });
  });

  describe('bootstrap avec DEMO_SEED=false', () => {
    it('ne crée aucune édition de démonstration sur une base vide', async () => {
      assert.equal(await strapi.app.documents('api::edition.edition').count({}), 0);
    });

    it('ne crée aucun tag, organisation ni intervenant de démonstration', async () => {
      for (const uid of ['api::tag.tag', 'api::organisation.organisation', 'api::intervenant.intervenant', 'api::sequence.sequence']) {
        assert.equal(await strapi.app.documents(uid).count({}), 0, uid);
      }
    });

    it('ne téléverse aucune image', async () => {
      assert.equal(await strapi.app.db.query('plugin::upload.file').count({}), 0);
    });
  });

  describe('configuration e-mail câblée dans Strapi (B1, NF-53)', () => {
    const config = () => strapi.app.config.get('server.email');

    it('lit EMAIL_PROVIDER=console, EMAIL_FROM et EMAIL_OUTBOX_FILE de l’environnement', () => {
      assert.equal(config().provider, 'console');
      assert.match(config().from, /<espace@example\.org>$/);
      assert.equal(config().outboxFile, strapi.env.EMAIL_OUTBOX_FILE);
    });

    it('produit un fournisseur console qui écrit dans la boîte du test, sans envoyer', async () => {
      const provider = createMailProvider({ ...config(), nodeEnv: process.env.NODE_ENV, logger: strapi.app.log });
      assert.equal(provider.name, 'console');

      const { messageId } = await provider.send({
        to: 'lea.ducasse@example.org',
        subject: 'Lien de connexion',
        html: '<p>Bonjour</p>',
        text: 'Bonjour https://example.org/espace/verifier?token=abc',
      });

      const lines = fs.readFileSync(strapi.env.EMAIL_OUTBOX_FILE, 'utf8').trim().split('\n');
      assert.equal(lines.length, 1);
      assert.equal(JSON.parse(lines[0]).messageId, messageId);
    });

    it('refuse brevo dans ce processus (NODE_ENV=test)', () => {
      assert.throws(
        () => createMailProvider({ ...config(), provider: 'brevo', apiKey: 'cle-factice', nodeEnv: process.env.NODE_ENV }),
        /NODE_ENV=test/
      );
    });
  });

  describe('réseau', () => {
    // NF-06 (ancien défaut D2, corrigé) : sans cela, createStrapi() interroge le registre npm une fois par jour
    // et réécrit strapi/.strapi-updater.json, fichier suivi par git.
    it('coupe la notification de mise à jour de Strapi (aucun appel au registre npm)', () => {
      assert.equal(strapi.app.config.get('server.logger.updates.enabled'), false);
    });
  });
});
