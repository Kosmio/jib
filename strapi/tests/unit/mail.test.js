'use strict';

/**
 * Fournisseurs d'e-mail de l'espace (I-30, NF-06, NF-53) : fabrique, fournisseur console, correspondance
 * Brevo avec un client simulé. Aucune connexion réseau : le client Brevo est toujours injecté.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const { createMailProvider, parseAddress } = require('../../src/api/espace/lib/mail');

const FROM = 'Journées de l’Innovation Filière Bois <espace@example.org>';
const MESSAGE = {
  to: 'lea.ducasse@example.org',
  subject: 'Votre lien de connexion',
  html: '<p>Bonjour</p>',
  text: 'Bonjour https://example.org/espace/verifier?token=abc',
};

/** Journal factice : collecte les lignes info. */
const makeLogger = () => {
  const lines = [];
  return { lines, info: (line) => lines.push(line) };
};

/** Client Brevo simulé : enregistre la requête et renvoie un messageId. */
const makeBrevoClient = (response = { messageId: 'brevo-123' }) => {
  const calls = [];
  return {
    calls,
    transactionalEmails: {
      sendTransacEmail: async (request) => {
        calls.push(request);
        return response;
      },
    },
  };
};

let dir;
let outbox;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jib-mail-'));
  outbox = path.join(dir, 'outbox.jsonl');
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const readOutbox = () =>
  fs
    .readFileSync(outbox, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

describe('parseAddress', () => {
  it('accepte une adresse seule', () => {
    assert.deepEqual(parseAddress('lea.ducasse@example.org'), { email: 'lea.ducasse@example.org' });
  });

  it('accepte « Nom <adresse> » et garde les accents', () => {
    assert.deepEqual(parseAddress(FROM), {
      email: 'espace@example.org',
      name: 'Journées de l’Innovation Filière Bois',
    });
  });

  it('retire les guillemets autour du nom', () => {
    assert.deepEqual(parseAddress('"Ducasse, Léa" <lea@example.org>'), { email: 'lea@example.org', name: 'Ducasse, Léa' });
  });

  it('retire les espaces autour de l’adresse', () => {
    assert.deepEqual(parseAddress('  lea@example.org  '), { email: 'lea@example.org' });
  });

  it('accepte un objet { email, name }', () => {
    assert.deepEqual(parseAddress({ email: 'lea@example.org', name: 'Léa' }), { email: 'lea@example.org', name: 'Léa' });
  });

  it('accepte un objet sans nom', () => {
    assert.deepEqual(parseAddress({ email: 'lea@example.org' }), { email: 'lea@example.org' });
  });

  for (const invalid of ['', '   ', 'pas-une-adresse', 'a@b', '@example.org', 'lea@', 'a b@example.org', 'a@b.c, d@e.f', 'Nom <>']) {
    it(`refuse « ${invalid} »`, () => {
      assert.throws(() => parseAddress(invalid), /Invalid e-mail address/);
    });
  }

  for (const invalid of [undefined, null, 42, {}, { name: 'Sans adresse' }]) {
    it(`refuse ${JSON.stringify(invalid) ?? 'undefined'}`, () => {
      assert.throws(() => parseAddress(invalid), /Invalid e-mail address/);
    });
  }
});

describe('createMailProvider : choix du fournisseur (NF-53)', () => {
  it('prend console sans EMAIL_PROVIDER ni NODE_ENV', () => {
    assert.equal(createMailProvider({ outboxFile: outbox }).name, 'console');
  });

  it('prend console sous NODE_ENV=development', () => {
    assert.equal(createMailProvider({ nodeEnv: 'development', outboxFile: outbox }).name, 'console');
  });

  it('prend console sous NODE_ENV=test', () => {
    assert.equal(createMailProvider({ nodeEnv: 'test', outboxFile: outbox }).name, 'console');
  });

  it('prend brevo par défaut sous NODE_ENV=production', () => {
    const provider = createMailProvider({ nodeEnv: 'production', apiKey: 'cle-factice', from: FROM, client: makeBrevoClient() });
    assert.equal(provider.name, 'brevo');
  });

  it('respecte EMAIL_PROVIDER=console sous NODE_ENV=production', () => {
    assert.equal(createMailProvider({ provider: 'console', nodeEnv: 'production', outboxFile: outbox }).name, 'console');
  });

  it('traite EMAIL_PROVIDER vide comme absent', () => {
    assert.equal(createMailProvider({ provider: '', outboxFile: outbox }).name, 'console');
  });

  it('refuse brevo sous NODE_ENV=test, même avec clé et expéditeur', () => {
    assert.throws(
      () => createMailProvider({ provider: 'brevo', nodeEnv: 'test', apiKey: 'cle-factice', from: FROM, client: makeBrevoClient() }),
      /refused when NODE_ENV=test/
    );
  });

  it('refuse brevo sans clé d’API', () => {
    assert.throws(() => createMailProvider({ provider: 'brevo', from: FROM, client: makeBrevoClient() }), /needs an API key/);
  });

  it('refuse brevo avec une clé vide', () => {
    assert.throws(() => createMailProvider({ provider: 'brevo', apiKey: '', from: FROM, client: makeBrevoClient() }), /needs an API key/);
  });

  it('refuse brevo sans expéditeur', () => {
    assert.throws(() => createMailProvider({ provider: 'brevo', apiKey: 'cle-factice', client: makeBrevoClient() }), /needs a sender/);
  });

  it('refuse brevo par défaut en production sans clé', () => {
    assert.throws(() => createMailProvider({ nodeEnv: 'production', from: FROM, client: makeBrevoClient() }), /needs an API key/);
  });

  it('refuse un fournisseur inconnu et nomme les valeurs admises', () => {
    assert.throws(() => createMailProvider({ provider: 'sendgrid' }), /Unknown mail provider "sendgrid".*"console" or "brevo"/);
  });

  it('refuse un expéditeur invalide', () => {
    assert.throws(() => createMailProvider({ provider: 'console', from: 'pas-une-adresse', outboxFile: outbox }), /Invalid e-mail address/);
  });

  it('refuse un expéditeur invalide pour brevo', () => {
    assert.throws(
      () => createMailProvider({ provider: 'brevo', apiKey: 'cle-factice', from: 'Nom <>', client: makeBrevoClient() }),
      /Invalid e-mail address/
    );
  });

  it('n’expose jamais la clé d’API dans un message d’erreur (NF-06)', () => {
    const apiKey = 'xkeysib-cle-tres-secrete';
    for (const options of [
      { provider: 'brevo', nodeEnv: 'test', apiKey, from: FROM },
      { provider: 'brevo', apiKey, from: 'Nom <>' },
      { provider: 'brevo', apiKey },
    ]) {
      assert.throws(
        () => createMailProvider({ ...options, client: makeBrevoClient() }),
        (error) => !error.message.includes(apiKey)
      );
    }
  });
});

describe('ConsoleMailProvider : fichier de sortie (I-30)', () => {
  it('ajoute une ligne JSON par message, sans appel réseau', async (t) => {
    const connections = t.mock.method(net.Socket.prototype, 'connect', () => {
      throw new Error('appel réseau interdit');
    });
    const provider = createMailProvider({ outboxFile: outbox, from: FROM, logger: makeLogger() });

    const { messageId } = await provider.send(MESSAGE);

    assert.match(messageId, /^console-[0-9a-f-]{36}$/);
    assert.equal(connections.mock.callCount(), 0);
    const [record] = readOutbox();
    assert.equal(record.messageId, messageId);
    assert.equal(record.subject, MESSAGE.subject);
    assert.equal(record.html, MESSAGE.html);
    assert.equal(record.text, MESSAGE.text);
    assert.deepEqual(record.to, { email: 'lea.ducasse@example.org' });
    assert.deepEqual(record.from, { email: 'espace@example.org', name: 'Journées de l’Innovation Filière Bois' });
    assert.ok(!Number.isNaN(Date.parse(record.sentAt)));
  });

  it('cumule les messages sans écraser les précédents', async () => {
    const provider = createMailProvider({ outboxFile: outbox, logger: makeLogger() });
    await provider.send(MESSAGE);
    await provider.send({ ...MESSAGE, subject: 'Second message' });
    assert.deepEqual(
      readOutbox().map((r) => r.subject),
      [MESSAGE.subject, 'Second message']
    );
  });

  it('crée le dossier du fichier de sortie s’il manque', async () => {
    const nested = path.join(dir, 'a', 'b', 'outbox.jsonl');
    await createMailProvider({ outboxFile: nested, logger: makeLogger() }).send(MESSAGE);
    assert.ok(fs.existsSync(nested));
  });

  it('écrit une ligne JSON valide même avec des retours à la ligne dans le corps', async () => {
    const provider = createMailProvider({ outboxFile: outbox, logger: makeLogger() });
    await provider.send({ ...MESSAGE, text: 'ligne 1\nligne 2', html: '<p>ligne 1</p>\n<p>ligne 2</p>' });
    assert.equal(fs.readFileSync(outbox, 'utf8').trimEnd().split('\n').length, 1);
    assert.equal(readOutbox()[0].text, 'ligne 1\nligne 2');
  });

  it('encode les pièces jointes en base64, Buffer ou texte', async () => {
    const provider = createMailProvider({ outboxFile: outbox, logger: makeLogger() });
    await provider.send({
      ...MESSAGE,
      attachments: [
        { filename: 'rdv.ics', content: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', contentType: 'text/calendar' },
        { filename: 'binaire.bin', content: Buffer.from([0, 1, 2, 255]), contentType: 'application/octet-stream' },
      ],
    });
    const [{ attachments }] = readOutbox();
    assert.equal(attachments.length, 2);
    assert.equal(attachments[0].filename, 'rdv.ics');
    assert.equal(attachments[0].contentType, 'text/calendar');
    assert.equal(Buffer.from(attachments[0].content, 'base64').toString(), 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    assert.deepEqual([...Buffer.from(attachments[1].content, 'base64')], [0, 1, 2, 255]);
  });

  it('conserve les en-têtes (List-Unsubscribe, I-39)', async () => {
    const provider = createMailProvider({ outboxFile: outbox, logger: makeLogger() });
    await provider.send({ ...MESSAGE, headers: { 'List-Unsubscribe': '<https://example.org/espace/notifications>' } });
    assert.deepEqual(readOutbox()[0].headers, { 'List-Unsubscribe': '<https://example.org/espace/notifications>' });
  });

  it('journalise destinataire, sujet et liens, une seule fois chacun', async () => {
    const logger = makeLogger();
    const provider = createMailProvider({ outboxFile: outbox, logger });
    await provider.send({
      ...MESSAGE,
      text: 'Voici https://example.org/a puis (https://example.org/b) et encore https://example.org/a',
    });
    assert.equal(logger.lines.length, 1);
    assert.match(logger.lines[0], /to=lea\.ducasse@example\.org/);
    assert.match(logger.lines[0], /subject="Votre lien de connexion"/);
    assert.match(logger.lines[0], /links=https:\/\/example\.org\/a https:\/\/example\.org\/b$/);
  });

  it('journalise « - » quand le message n’a aucun lien', async () => {
    const logger = makeLogger();
    await createMailProvider({ outboxFile: outbox, logger }).send({ ...MESSAGE, text: 'Aucun lien ici.' });
    assert.match(logger.lines[0], /links=-$/);
  });

  it('n’écrit ni la clé d’API ni le HTML dans le journal (NF-06)', async () => {
    const logger = makeLogger();
    await createMailProvider({ outboxFile: outbox, apiKey: 'cle-tres-secrete', logger }).send(MESSAGE);
    assert.ok(!logger.lines.join('\n').includes('cle-tres-secrete'));
    assert.ok(!logger.lines.join('\n').includes('<p>'));
  });

  it('accepte un destinataire « Nom <adresse> » et un objet', async () => {
    const provider = createMailProvider({ outboxFile: outbox, logger: makeLogger() });
    await provider.send({ ...MESSAGE, to: 'Léa Ducasse <lea.ducasse@example.org>' });
    await provider.send({ ...MESSAGE, to: { email: 'mathis.lagrange@example.org', name: 'Mathis Lagrange' } });
    assert.deepEqual(
      readOutbox().map((r) => r.to),
      [
        { email: 'lea.ducasse@example.org', name: 'Léa Ducasse' },
        { email: 'mathis.lagrange@example.org', name: 'Mathis Lagrange' },
      ]
    );
  });

  it('vers un chemin absolu, n’écrit que dans ce fichier', async () => {
    await createMailProvider({ outboxFile: outbox, logger: makeLogger() }).send(MESSAGE);
    assert.deepEqual(fs.readdirSync(dir), ['outbox.jsonl']);
  });
});

describe('createMailProvider : validation des messages', () => {
  for (const key of ['subject', 'html', 'text']) {
    it(`refuse un message sans « ${key} »`, async () => {
      const provider = createMailProvider({ outboxFile: outbox, logger: makeLogger() });
      await assert.rejects(provider.send({ ...MESSAGE, [key]: undefined }), new RegExp(`non-empty "${key}"`));
      await assert.rejects(provider.send({ ...MESSAGE, [key]: '' }), new RegExp(`non-empty "${key}"`));
    });
  }

  it('refuse un destinataire invalide sans rien écrire', async () => {
    const provider = createMailProvider({ outboxFile: outbox, logger: makeLogger() });
    await assert.rejects(provider.send({ ...MESSAGE, to: 'pas-une-adresse' }), /Invalid e-mail address/);
    assert.ok(!fs.existsSync(outbox));
  });

  it('refuse une pièce jointe sans nom de fichier', async () => {
    const provider = createMailProvider({ outboxFile: outbox, logger: makeLogger() });
    await assert.rejects(provider.send({ ...MESSAGE, attachments: [{ content: 'x' }] }), /needs a "filename"/);
  });

  it('refuse un appel sans message', async () => {
    const provider = createMailProvider({ outboxFile: outbox, logger: makeLogger() });
    await assert.rejects(provider.send(), /non-empty/);
  });
});

describe('BrevoMailProvider : correspondance avec l’API (client simulé)', () => {
  const brevo = (client) => createMailProvider({ provider: 'brevo', apiKey: 'cle-factice', from: FROM, nodeEnv: 'production', client });

  it('envoie sender, to, sujet, HTML et texte, et renvoie le messageId', async () => {
    const client = makeBrevoClient({ messageId: '<202610291500.1@smtp-relay.example>' });

    const result = await brevo(client).send(MESSAGE);

    assert.deepEqual(result, { messageId: '<202610291500.1@smtp-relay.example>' });
    assert.equal(client.calls.length, 1);
    assert.deepEqual(client.calls[0], {
      sender: { email: 'espace@example.org', name: 'Journées de l’Innovation Filière Bois' },
      to: [{ email: 'lea.ducasse@example.org' }],
      subject: MESSAGE.subject,
      htmlContent: MESSAGE.html,
      textContent: MESSAGE.text,
    });
  });

  it('transmet le nom du destinataire', async () => {
    const client = makeBrevoClient();
    await brevo(client).send({ ...MESSAGE, to: 'Léa Ducasse <lea.ducasse@example.org>' });
    assert.deepEqual(client.calls[0].to, [{ email: 'lea.ducasse@example.org', name: 'Léa Ducasse' }]);
  });

  it('envoie une pièce jointe sous la forme { name, content } en base64', async () => {
    const client = makeBrevoClient();
    await brevo(client).send({
      ...MESSAGE,
      attachments: [{ filename: 'rdv.ics', content: 'BEGIN:VCALENDAR', contentType: 'text/calendar' }],
    });
    assert.deepEqual(client.calls[0].attachment, [{ name: 'rdv.ics', content: Buffer.from('BEGIN:VCALENDAR').toString('base64') }]);
  });

  it('transmet les en-têtes', async () => {
    const client = makeBrevoClient();
    await brevo(client).send({ ...MESSAGE, headers: { 'List-Unsubscribe': '<https://example.org/x>' } });
    assert.deepEqual(client.calls[0].headers, { 'List-Unsubscribe': '<https://example.org/x>' });
  });

  it('omet attachment et headers quand il n’y en a pas', async () => {
    const client = makeBrevoClient();
    await brevo(client).send(MESSAGE);
    assert.ok(!('attachment' in client.calls[0]));
    assert.ok(!('headers' in client.calls[0]));
  });

  it('propage l’erreur de l’API sans l’avaler', async () => {
    const client = makeBrevoClient();
    client.transactionalEmails.sendTransacEmail = async () => {
      throw new Error('Brevo 401');
    };
    await assert.rejects(brevo(client).send(MESSAGE), /Brevo 401/);
  });

  it('valide le message avant d’appeler l’API', async () => {
    const client = makeBrevoClient();
    await assert.rejects(brevo(client).send({ ...MESSAGE, to: 'pas-une-adresse' }), /Invalid e-mail address/);
    assert.equal(client.calls.length, 0);
  });
});
