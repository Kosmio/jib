'use strict';

/**
 * Lot V1-C (F-105, R-85, NF-62, F-106), ce qui ne demande pas Strapi. Tests d'abord : `pending('V1-C')`.
 *   - schémas : `welcomeStartedAt` (date et heure, privé) sur l'édition, `error` (texte) sur EmailLog ;
 *   - `services/mailer.js` : un envoi en échec écrit `error` (première ligne, 300 caractères au plus), un envoi réussi non ;
 *   - fichiers livrés : services, contrôleurs et routes du lot.
 * Le comportement des routes et de la synchronisation est dans integration/espace-welcome.test.js.
 */

const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { pending } = require('../helpers/pending');

const API = path.resolve(__dirname, '../../src/api');
const ESPACE = path.join(API, 'espace');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

describe('V1-C : schémas', pending('V1-C'), () => {
  it('l’édition a un champ welcomeStartedAt de type datetime, privé', () => {
    const field = readJson(path.join(API, 'edition/content-types/edition/schema.json')).attributes.welcomeStartedAt;
    assert.equal(field?.type, 'datetime');
    assert.equal(field.private, true);
    assert.equal(field.required ?? false, false, 'vide tant que rien n’est envoyé');
  });

  it('EmailLog a un champ texte error, facultatif', () => {
    const field = readJson(path.join(ESPACE, 'content-types/email-log/schema.json')).attributes.error;
    assert.ok(['string', 'text'].includes(field?.type), `type ${field?.type}`);
    assert.equal(field.required ?? false, false);
  });
});

describe('V1-C : fichiers du lot', pending('V1-C'), () => {
  for (const file of ['services/welcome.js', 'services/service-status.js', 'controllers/welcome.js', 'controllers/service-status.js', 'routes/welcome.js']) {
    it(`src/api/espace/${file} existe`, () => {
      assert.ok(fs.existsSync(path.join(ESPACE, file)));
    });
  }

  it('les routes déclarent welcome/preview, welcome/send (POST) et service (GET) sous /espace/admin/:edition, avec le contexte de session', () => {
    const files = ['routes/welcome.js', 'routes/service-status.js'].map((file) => path.join(ESPACE, file)).filter((file) => fs.existsSync(file));
    const routes = files.flatMap((file) => require(file).routes);
    const find = (method, suffix) => routes.find((route) => route.method === method && route.path === `/espace/admin/:edition/${suffix}`);
    for (const [method, suffix] of [['POST', 'welcome/preview'], ['POST', 'welcome/send'], ['GET', 'service']]) {
      const route = find(method, suffix);
      assert.ok(route, `${method} ${suffix}`);
      assert.ok(route.config.middlewares.includes('api::espace.context'), `${suffix} sans le contexte de session`);
    }
  });
});

describe('V1-C : NF-62, services/mailer.js écrit EmailLog.error', pending('V1-C'), () => {
  let directory;
  let created;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jib-welcome-'));
    created = [];
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  const ATTENDEE = { documentId: 'doc-lea', email: 'lea.ducasse@example.org', firstName: 'Léa', lastName: 'Ducasse' };
  const DATA = {
    edition: { slug: 'essai', title: 'Édition d’essai', themeColor: '#600e24' },
    publicUrl: 'https://journees.example.org',
    firstName: 'Léa',
    url: 'https://journees.example.org/espace/verifier?token=x',
    validityHours: 72,
  };
  const mailer = (email) =>
    require('../../src/api/espace/services/mailer')({
      strapi: {
        config: { get: (key) => (key === 'server.email' ? email : undefined) },
        log: { info() {}, warn() {}, debug() {}, error() {} },
        documents: () => ({ create: async ({ data }) => created.push(data) }),
      },
    });
  const send = (email) => mailer(email).send({ attendee: ATTENDEE, template: 'welcome', data: DATA, scenarioKey: 'welcome' });

  it('un envoi réussi : statut sent, aucun motif', async () => {
    const result = await send({ provider: 'console', outboxFile: path.join(directory, 'outbox.jsonl'), from: 'Journées <espace@example.org>' });
    assert.equal(result.status, 'sent');
    assert.equal(created[0].status, 'sent');
    assert.ok(!created[0].error);
  });

  it('un envoi en échec : statut failed et motif sur une seule ligne', async () => {
    const outbox = path.join(directory, 'outbox.jsonl');
    fs.mkdirSync(outbox); // un dossier à la place du fichier : l'écriture échoue
    const result = await send({ provider: 'console', outboxFile: outbox, from: 'Journées <espace@example.org>' });
    assert.equal(result.status, 'failed');
    assert.equal(created[0].status, 'failed');
    assert.equal(typeof created[0].error, 'string');
    assert.ok(created[0].error.length > 0);
    assert.ok(!/\r|\n/.test(created[0].error), 'première ligne seulement');
  });

  it('un motif très long est coupé à 300 caractères', async () => {
    const blocker = path.join(directory, 'fichier');
    fs.writeFileSync(blocker, '');
    const long = path.join(blocker, 'a'.repeat(120), 'b'.repeat(120), 'c'.repeat(120), 'outbox.jsonl'); // ENOTDIR, chemin dans le message
    const result = await send({ provider: 'console', outboxFile: long, from: 'Journées <espace@example.org>' });
    assert.equal(result.status, 'failed');
    assert.ok(created[0].error.length > 0 && created[0].error.length <= 300, `${created[0].error.length} caractères`);
  });

  it('le motif ne contient pas l’adresse du destinataire hors de lui-même ni de contenu d’e-mail (pas de lien de connexion)', async () => {
    const outbox = path.join(directory, 'outbox.jsonl');
    fs.mkdirSync(outbox);
    await send({ provider: 'console', outboxFile: outbox, from: 'Journées <espace@example.org>' });
    assert.ok(!created[0].error.includes('/espace/verifier'));
    assert.ok(!created[0].error.includes('token='));
  });
});
