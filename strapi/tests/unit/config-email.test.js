'use strict';

/**
 * Configuration e-mail de l'espace (B1, NF-06, NF-53) : strapi/config/server.js lit EMAIL_PROVIDER, EMAIL_FROM
 * et EMAIL_OUTBOX_FILE à côté de la clé Brevo du site, sans rien changer au reste de la configuration.
 * Le fichier .env.example documente les trois variables avec des valeurs fictives.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverConfig = require('../../config/server');
const { createMailProvider } = require('../../src/api/espace/lib/mail');
// Aide `env` complète (int, bool, array…) : config/server.js lit aussi les variables de la phase 1 (env.bool, env.array).
const { makeEnv } = require('../helpers/config-env');

describe('config/server.js : section email', () => {
  it('ne fixe ni fournisseur ni expéditeur sans variables, et range la boîte dans .tmp/', () => {
    const { email } = serverConfig({ env: makeEnv({}) });
    assert.equal(email.provider, undefined);
    assert.equal(email.from, undefined);
    assert.equal(email.outboxFile, '.tmp/mail-outbox.jsonl');
  });

  it('lit EMAIL_PROVIDER, EMAIL_FROM et EMAIL_OUTBOX_FILE', () => {
    const { email } = serverConfig({
      env: makeEnv({ EMAIL_PROVIDER: 'brevo', EMAIL_FROM: 'Nom <a@example.org>', EMAIL_OUTBOX_FILE: '/tmp/boite.jsonl' }),
    });
    assert.equal(email.provider, 'brevo');
    assert.equal(email.from, 'Nom <a@example.org>');
    assert.equal(email.outboxFile, '/tmp/boite.jsonl');
  });

  it('garde la clé Brevo et les réglages existants du site (contact, liste)', () => {
    const { email } = serverConfig({
      env: makeEnv({ EMAIL_API_KEY: 'cle', EMAIL_LIST_ID: '7', EMAIL_CONTACT_TO: 'c@example.org', EMAIL_CONTACT_TEMPLATE_ID: '3' }),
    });
    assert.equal(email.apiKey, 'cle');
    assert.equal(email.listId, '7');
    assert.deepEqual(email.contact, { to: 'c@example.org', templateId: '3' });
  });

  it('laisse le reste de la configuration serveur intact', () => {
    const config = serverConfig({ env: makeEnv({ APP_KEYS: 'a,b', ALTCHA_HMAC_KEY: 'h' }) });
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.port, 1337);
    assert.equal(config.url, 'http://localhost:1337');
    assert.deepEqual(config.app.keys, ['a', 'b']);
    assert.equal(config.captcha.hmacKey, 'h');
  });

  it('sans aucune variable, hors production, le fournisseur choisi est console (NF-53, critère B3)', () => {
    const { email } = serverConfig({ env: makeEnv({}) });
    assert.equal(createMailProvider({ ...email, nodeEnv: undefined }).name, 'console');
    assert.equal(createMailProvider({ ...email, nodeEnv: 'development' }).name, 'console');
  });

  it('EMAIL_PROVIDER=brevo sous NODE_ENV=test lève une erreur (NF-53, critère B3)', () => {
    const { email } = serverConfig({ env: makeEnv({ EMAIL_PROVIDER: 'brevo', EMAIL_API_KEY: 'cle', EMAIL_FROM: 'a@example.org' }) });
    assert.throws(() => createMailProvider({ ...email, nodeEnv: 'test' }), /NODE_ENV=test/);
  });
});

describe('.env.example : variables de l’espace (NF-06)', () => {
  const text = fs.readFileSync(path.resolve(__dirname, '../../.env.example'), 'utf8');
  const value = (key) => text.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1];

  it('documente EMAIL_PROVIDER, EMAIL_FROM et EMAIL_OUTBOX_FILE', () => {
    assert.equal(value('EMAIL_PROVIDER'), 'console');
    assert.match(value('EMAIL_FROM'), /@example\.org>"$/);
    assert.equal(value('EMAIL_OUTBOX_FILE'), '.tmp/mail-outbox.jsonl');
  });

  it('propose console par défaut, pour qu’une copie du fichier n’envoie aucun e-mail réel', () => {
    assert.equal(value('EMAIL_PROVIDER'), 'console');
  });

  it('ne contient aucun secret réel : clés fictives uniquement', () => {
    assert.ok(!/xkeysib-|xsmtpsib-|sk_live|ghp_|-----BEGIN/.test(text));
    assert.equal(value('EMAIL_API_KEY'), 'your-brevo-api-key');
  });

  it('documente DEMO_SEED en commentaire, désactivé par défaut', () => {
    assert.match(text, /^# DEMO_SEED=false$/m);
  });
});
