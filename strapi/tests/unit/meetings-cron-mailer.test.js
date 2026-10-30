'use strict';

/**
 * Deux contrats du lot 8 qui ne demandent pas Strapi :
 *   - `services/mailer.js` transmet `attachments` au fournisseur (A-33, I-41) : le .ics de `meeting-accepted` ;
 *   - `config/cron-tasks.js` : tâche `espaceMeetingExpiry` toutes les 5 minutes en Europe/Paris, qui n'appelle que le service
 *     `api::espace.meetings` (A-32, R-17, A-08) ; une erreur est journalisée et ne remonte jamais.
 * Le service réel (expirePending, boîte de sortie) est couvert en intégration par integration/meetings-expiry.test.js.
 */

const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { pending } = require('../helpers/pending');

const EDITION = { slug: 'nouvelle-aquitaine-test', title: 'Nouvelle-Aquitaine (test)', themeColor: '#600e24' };
const ATTENDEE = { documentId: 'doc-lea', email: 'lea.ducasse@example.org', firstName: 'Léa', lastName: 'Ducasse' };
const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';

describe('services/mailer.js : pièces jointes (A-33, I-41)', () => {
  let directory;
  let outboxFile;
  let logs;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jib-mailer-'));
    outboxFile = path.join(directory, 'outbox.jsonl');
    logs = [];
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const fakeStrapi = () => ({
    config: { get: (key) => (key === 'server.email' ? { provider: 'console', outboxFile, from: 'Journées <no-reply@example.org>' } : undefined) },
    log: { info() {}, warn() {}, debug() {}, error: (message) => logs.push(String(message)) },
    documents: (uid) => ({
      create: async ({ data }) => {
        logs.push({ uid, data });
        return data;
      },
    }),
  });
  const mailer = () => require('../../src/api/espace/services/mailer')({ strapi: fakeStrapi() });
  const outbox = () => (fs.existsSync(outboxFile) ? fs.readFileSync(outboxFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
  const emailLogs = () => logs.filter((entry) => typeof entry === 'object');
  const send = (extra = {}) =>
    mailer().send({
      attendee: ATTENDEE,
      template: 'meeting-cancelled',
      scenarioKey: 'meeting-cancelled:abc',
      data: { edition: EDITION, publicUrl: 'https://journees.example.org', firstName: 'Léa', slotLabel: '10h45', counterpartName: 'Mathis Lagrange', agendaUrl: 'https://journees.example.org/espace/x/agenda' },
      ...extra,
    });

  it('sans pièce jointe, le message part avec une liste vide et l’EmailLog est écrit (non-régression)', async () => {
    const result = await send();
    assert.equal(result.status, 'sent');
    assert.deepEqual(outbox()[0].attachments, []);
    assert.equal(emailLogs()[0].data.status, 'sent');
  });

  describe('avec pièces jointes', pending('lot 8'), () => {
    it('transmet le .ics au fournisseur : nom, type et contenu en base64', async () => {
      await send({ attachments: [{ filename: 'rendez-vous.ics', content: ICS, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] });
      const [{ attachments }] = outbox();
      assert.equal(attachments.length, 1);
      assert.equal(attachments[0].filename, 'rendez-vous.ics');
      assert.match(attachments[0].contentType, /^text\/calendar/);
      assert.equal(Buffer.from(attachments[0].content, 'base64').toString('utf8'), ICS);
    });

    it('transmet plusieurs pièces jointes dans l’ordre', async () => {
      await send({
        attachments: [
          { filename: 'a.ics', content: ICS, contentType: 'text/calendar' },
          { filename: 'b.txt', content: Buffer.from('bonjour'), contentType: 'text/plain' },
        ],
      });
      assert.deepEqual(outbox()[0].attachments.map((attachment) => attachment.filename), ['a.ics', 'b.txt']);
    });

    it('le message reste envoyé et journalisé « sent » avec la pièce jointe', async () => {
      const result = await send({ attachments: [{ filename: 'rendez-vous.ics', content: ICS, contentType: 'text/calendar' }] });
      assert.equal(result.status, 'sent');
      assert.equal(emailLogs()[0].data.status, 'sent');
      assert.equal(emailLogs()[0].data.template, 'meeting-cancelled');
    });

    it('une pièce jointe invalide (sans nom de fichier) ne fait pas lever l’envoi : EmailLog « failed »', async () => {
      const result = await send({ attachments: [{ content: ICS }] });
      assert.equal(result.status, 'failed');
      assert.equal(emailLogs()[0].data.status, 'failed');
      assert.equal(outbox().length, 0);
    });

    it('ne journalise pas le contenu de la pièce jointe dans l’EmailLog', async () => {
      await send({ attachments: [{ filename: 'rendez-vous.ics', content: ICS, contentType: 'text/calendar' }] });
      assert.ok(!JSON.stringify(emailLogs()).includes('BEGIN:VCALENDAR'));
    });
  });
});

describe('config/cron-tasks.js : expiration des demandes toutes les 5 minutes (A-32, R-17, A-08)', pending('lot 8'), () => {
  const cron = () => require('../../config/cron-tasks');
  const entryOf = (rule) => Object.values(cron()).find((value) => value?.options?.rule === rule);

  /** Strapi simulé : un seul service accessible ; tout autre accès lève (aucune requête dans le cron). */
  function fakeStrapi({ failWith } = {}) {
    const calls = [];
    const errors = [];
    const meetings = {
      expirePending: async (...args) => {
        calls.push(args);
        if (failWith) throw failWith;
        return 2;
      },
    };
    const target = {
      service: (uid) => {
        if (uid !== 'api::espace.meetings') throw new Error(`service inattendu : ${uid}`);
        return meetings;
      },
      log: { error: (message) => errors.push(String(message)) },
    };
    const strapi = new Proxy(target, {
      get(object, property) {
        if (property in object) return object[property];
        throw new Error(`accès inattendu à strapi.${String(property)} : la tâche doit passer par un service`);
      },
    });
    return { strapi, calls, errors };
  }

  it('planifie `*/5 * * * *` en Europe/Paris', () => {
    const entry = entryOf('*/5 * * * *');
    assert.ok(entry, 'tâche d’expiration absente');
    assert.equal(entry.options.tz, 'Europe/Paris');
    assert.equal(typeof entry.task, 'function');
  });

  it('la tâche s’appelle espaceMeetingExpiry', () => {
    assert.equal(typeof cron().espaceMeetingExpiry?.task, 'function');
    assert.equal(cron().espaceMeetingExpiry.options.rule, '*/5 * * * *');
  });

  it('appelle meetings.expirePending une fois, sans autre accès à Strapi', async () => {
    const { strapi, calls, errors } = fakeStrapi();
    await cron().espaceMeetingExpiry.task({ strapi });
    assert.equal(calls.length, 1);
    assert.deepEqual(errors, []);
  });

  it('ne fige pas l’instant : aucun argument, ou `{ now }` valant l’heure courante (A-19)', async () => {
    const { strapi, calls } = fakeStrapi();
    const before = Date.now();
    await cron().espaceMeetingExpiry.task({ strapi });
    const [args] = calls;
    if (args.length) {
      const now = args[0]?.now;
      assert.ok(now instanceof Date, 'now doit être un Date');
      assert.ok(now.getTime() >= before - 1000 && now.getTime() <= Date.now() + 1000, 'now doit valoir l’heure courante');
    }
  });

  it('une erreur du service est journalisée et ne remonte jamais', async () => {
    const { strapi, errors } = fakeStrapi({ failWith: new Error('base indisponible') });
    await assert.doesNotReject(cron().espaceMeetingExpiry.task({ strapi }));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /base indisponible/);
  });

  it('garde la synchronisation (`*/15`) et la purge (`0 4`) de la phase 1', () => {
    assert.ok(entryOf('*/15 * * * *'));
    assert.ok(entryOf('0 4 * * *'));
  });
});
