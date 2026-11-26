'use strict';

/**
 * Formulaire de contact du site public : message construit pour le fournisseur d'e-mail de l'espace,
 * sans gabarit Brevo (EMAIL_CONTACT_TEMPLATE_ID vide en prod depuis l'origine : le formulaire échouait).
 * Le contrôleur est exercé avec un `strapi` simulé et le fournisseur console : aucun appel réseau.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { contactMessage, MAX } = require('../../src/api/contact/lib/message');
const controller = require('../../src/api/contact/controllers/contact');

const FORM = { name: 'Léa Ducasse', email: 'lea.ducasse@example.org', subject: 'Stand 2027', message: 'Bonjour,\nauriez-vous un stand ?' };

describe('contactMessage', () => {
  it('met le visiteur en Reply-To, avec son nom', () => {
    assert.deepEqual(contactMessage(FORM).replyTo, { email: 'lea.ducasse@example.org', name: 'Léa Ducasse' });
  });

  it('reprend l’objet dans le sujet, et « sans objet » quand il manque', () => {
    assert.equal(contactMessage(FORM).subject, 'Contact du site : Stand 2027');
    assert.equal(contactMessage({ ...FORM, subject: '' }).subject, 'Contact du site : sans objet');
  });

  it('porte nom, adresse, objet et message dans le texte', () => {
    const { text } = contactMessage(FORM);
    for (const part of ['Léa Ducasse', 'lea.ducasse@example.org', 'Stand 2027', 'Bonjour,\nauriez-vous un stand ?']) {
      assert.ok(text.includes(part), part);
    }
  });

  it('échappe le HTML saisi par le visiteur', () => {
    const { html } = contactMessage({ ...FORM, name: '<b>x</b>', message: '<script>alert(1)</script>' });
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!html.includes('<b>x</b>'));
  });

  it('retire les retours à la ligne du sujet et du nom (pas d’en-tête injecté)', () => {
    const mail = contactMessage({ ...FORM, name: 'Léa\r\nBcc: x@example.org', subject: 'a\nBcc: y@example.org' });
    assert.ok(!/[\r\n]/.test(mail.subject));
    assert.ok(!/[\r\n]/.test(mail.replyTo.name));
  });

  it('coupe nom et objet trop longs', () => {
    const mail = contactMessage({ ...FORM, name: 'n'.repeat(500), subject: 's'.repeat(500) });
    assert.equal(mail.replyTo.name.length, MAX.name);
    assert.ok(mail.subject.endsWith('s'.repeat(MAX.subject)));
  });

  it('omet le nom quand il est vide', () => {
    assert.deepEqual(contactMessage({ ...FORM, name: '  ' }).replyTo, { email: 'lea.ducasse@example.org' });
  });

  for (const email of [undefined, '', 'pas-une-adresse', 'a@b', { email: 'x@example.org' }]) {
    it(`refuse l’adresse ${JSON.stringify(email) ?? 'undefined'}`, () => {
      assert.deepEqual(contactMessage({ ...FORM, email }), { error: 'invalid email' });
    });
  }

  it('refuse un message vide ou trop long', () => {
    assert.deepEqual(contactMessage({ ...FORM, message: '   ' }), { error: 'invalid content' });
    assert.deepEqual(contactMessage({ ...FORM, message: 'm'.repeat(MAX.message + 1) }), { error: 'message too long' });
  });

  it('refuse un appel sans formulaire', () => {
    assert.deepEqual(contactMessage(), { error: 'invalid email' });
  });
});

describe('POST /api/contact/send (contrôleur, strapi simulé)', () => {
  let dir;
  let outbox;
  let logs;
  let settings;
  const savedStrapi = global.strapi;

  const makeCtx = (body) => {
    const ctx = { request: { body } };
    ctx.send = (payload, status) => {
      ctx.body = payload;
      ctx.status = status;
    };
    return ctx;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jib-contact-'));
    outbox = path.join(dir, 'outbox.jsonl');
    logs = [];
    settings = {
      provider: 'console',
      from: 'Journées de l’Innovation Filière Bois <communication@example.org>',
      outboxFile: outbox,
      contact: { to: 'contact@example.org' },
    };
    const log = (level) => (line) => logs.push(`${level} ${line}`);
    global.strapi = {
      config: { get: (key) => ({ 'server.email': settings, 'server.captcha.hmacKey': undefined })[key] },
      log: { info: log('info'), warn: log('warn'), error: log('error') },
    };
  });

  afterEach(() => {
    global.strapi = savedStrapi;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const sent = () =>
    fs.existsSync(outbox)
      ? fs.readFileSync(outbox, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
      : [];

  it('envoie le message à EMAIL_CONTACT_TO depuis EMAIL_FROM, le visiteur en Reply-To', async () => {
    const ctx = makeCtx(FORM);
    await controller.send(ctx);

    assert.equal(ctx.status, 200);
    const [message] = sent();
    assert.deepEqual(message.to, { email: 'contact@example.org' });
    assert.deepEqual(message.from, { email: 'communication@example.org', name: 'Journées de l’Innovation Filière Bois' });
    assert.deepEqual(message.replyTo, { email: 'lea.ducasse@example.org', name: 'Léa Ducasse' });
    assert.equal(message.subject, 'Contact du site : Stand 2027');
  });

  it('répond 400 sans rien envoyer quand l’adresse est invalide', async () => {
    const ctx = makeCtx({ ...FORM, email: 'pas-une-adresse' });
    await controller.send(ctx);
    assert.equal(ctx.status, 400);
    assert.equal(sent().length, 0);
  });

  it('répond 400 sur un corps absent', async () => {
    const ctx = makeCtx(undefined);
    await controller.send(ctx);
    assert.equal(ctx.status, 400);
  });

  it('répond 500 et journalise quand EMAIL_CONTACT_TO est vide', async () => {
    settings.contact = { to: '' };
    const ctx = makeCtx(FORM);
    await controller.send(ctx);
    assert.equal(ctx.status, 500);
    assert.equal(sent().length, 0);
    assert.ok(logs.some((line) => line.startsWith('error [contact]') && line.includes('EMAIL_CONTACT_TO')));
  });

  it('répond 500 quand le fournisseur refuse (brevo sans clé)', async () => {
    settings.provider = 'brevo';
    const ctx = makeCtx(FORM);
    await controller.send(ctx);
    assert.equal(ctx.status, 500);
    assert.ok(logs.some((line) => line.startsWith('error [contact] message not sent')));
  });

  it('n’appelle pas Brevo pour la newsletter sans clé ni liste, et répond 200', async () => {
    const ctx = makeCtx({ ...FORM, newsletterConsent: true });
    await controller.send(ctx);
    assert.equal(ctx.status, 200);
    assert.equal(sent().length, 1);
  });
});
