'use strict';

/**
 * Signalement d'un message, lot V5-B (docs/espace/specs/14-lots-finalisation.md) : F-75, R-63.
 *
 * Routes :
 *   POST /api/espace/conversations/:id/messages/:messageId/report  { reason }  -> 201 { id, status: 'open' }
 *   GET  /api/espace/admin/:edition/reports                                    -> { open, handled }, le plus récent d'abord
 *   POST /api/espace/admin/:edition/reports/:id/handle                         -> 200 { id, status: 'handled', handledAt }, idempotent
 *
 * Critères d'acceptation : 1. seuls ses messages reçus, dans ses conversations (sinon 404 MESSAGE_NOT_FOUND) ; 2. la route d'administration
 * ne renvoie aucun autre message de la conversation ; 3. second signalement du même message par la même personne : 409 ALREADY_REPORTED ;
 * 4. participant non organisateur : 403. Plus : e-mail `message-report` sans contenu, lien d'action de 72 heures vers le pilotage.
 * Chaque test crée son édition et ses personnes. Un seul démarrage de Strapi.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { useEspace } = require('../helpers/espace');
const { UID, link } = require('../helpers/espace-data');
const W = require('../helpers/meetings-world');
const { hashToken } = require('../../src/api/espace/lib/tokens');

const MESSAGE = 'api::espace.message';
const CONVERSATION = 'api::espace.conversation';
const REPORT = 'api::espace.message-report';
const ORGANIZER = 'organisation@example.org';
const HOUR = 3_600_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('signalement d’un message (V5-B, F-75, R-63)', { timeout: 900_000 }, () => {
  const espace = useEspace({ overrides: { ORGANIZER_EMAILS: ORGANIZER } });
  const login = W.useLogin(espace);
  const api = W.useApi(espace);
  const app = () => espace().app;

  const person = (edition, fields) => W.createPerson(app(), edition, fields);
  const as = async (edition, who) => api(await login(edition, who));
  const expectError = (response, status, code) => {
    assert.equal(response.status, status, `${response.status} ${response.text}`);
    if (code) assert.equal(response.json?.error?.code, code, response.text);
  };
  const admin = (edition, path = '') => `/api/espace/admin/${edition.slug}/reports${path}`;
  const adminCall = async (edition, who, path, method = 'GET') => espace().request(admin(edition, path), { method, cookie: await login(edition, who), json: method === 'POST' ? {} : undefined });
  const reportsOf = (edition) => app().documents(REPORT).findMany({ filters: { edition: { documentId: edition.documentId } }, populate: { author: true, message: true, edition: true }, limit: 200 });
  const conversationBetween = (edition, a, b) => app().documents(CONVERSATION).create({ data: { edition: link(edition), participants: [link(a), link(b)] } });
  const messageFrom = (conversation, author, body) => app().documents(MESSAGE).create({ data: { conversation: link(conversation), author: link(author), body } });
  const reportOf = (who, conversation, message, reason = 'Propos déplacés.') => who.post(`/conversations/${conversation.documentId}/messages/${message.documentId}/report`, { reason });

  /**
   * Une édition, Léa et Mathis (échange réel de trois messages, deux de Mathis et un de Léa), Inès étrangère à leur conversation,
   * un organisateur (rôle `organizer`) et une participante simple.
   */
  async function scene() {
    const world = await W.createMeetingEdition(app(), { slug: W.unique('sig'), title: 'Édition d’essai' });
    const { edition } = world;
    const p = {
      lea: await person(edition, { firstName: 'Léa', lastName: 'Ducasse' }),
      mathis: await person(edition, { firstName: 'Mathis', lastName: 'Lagrange' }),
      ines: await person(edition, { firstName: 'Inès', lastName: 'Castaing' }),
      orga: await person(edition, { firstName: 'Olivia', lastName: 'Organise', role: 'organizer' }),
    };
    const conversation = await conversationBetween(edition, p.lea, p.mathis);
    const m = {
      first: await messageFrom(conversation, p.mathis, 'MSG-PREMIER Bonjour Léa'),
      mine: await messageFrom(conversation, p.lea, 'MSG-DE-LEA Bonjour Mathis'),
      second: await messageFrom(conversation, p.mathis, 'MSG-SECOND Un propos litigieux'),
    };
    return { edition, p, conversation, m };
  }

  describe('routes et accès sans session', () => {
    const ROUTES = [
      'POST /api/espace/conversations/:x/messages/:x/report',
      'GET /api/espace/admin/:x/reports',
      'POST /api/espace/admin/:x/reports/:x/handle',
    ];
    const declared = () =>
      espace()
        .app.server.listRoutes()
        .filter((route) => route.path.startsWith('/api/espace'))
        .flatMap((route) => route.methods.filter((method) => method !== 'HEAD').map((method) => `${method} ${route.path.replace(/:[A-Za-z]+/g, ':x')}`));

    it('routes:list montre les trois routes du signalement', () => {
      for (const route of ROUTES) assert.ok(declared().includes(route), `route absente : ${route}`);
    });

    for (const route of ROUTES) {
      const [method, template] = route.split(' ');
      it(`${route} sans session : 401 UNAUTHENTICATED`, async () => {
        const response = await espace().request(template.replace(/:x/g, 'abc123'), { method, json: method === 'POST' ? { reason: 'x' } : undefined });
        expectError(response, 401, 'UNAUTHENTICATED');
      });
    }
  });

  describe('POST …/report : signaler un message reçu (F-75)', () => {
    it('201 { id, status: "open" } ; le signalement est écrit avec l’édition, le message, l’auteur et le motif', async () => {
      const { edition, p, conversation, m } = await scene();
      const response = await reportOf(await as(edition, p.lea), conversation, m.second, 'Propos déplacés.');
      assert.equal(response.status, 201, response.text);
      assert.deepEqual(Object.keys(response.json).sort(), ['id', 'status']);
      assert.equal(response.json.status, 'open');
      const rows = await reportsOf(edition);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].documentId, response.json.id);
      assert.equal(rows[0].status, 'open');
      assert.equal(rows[0].reason, 'Propos déplacés.');
      assert.equal(rows[0].author.documentId, p.lea.documentId);
      assert.equal(rows[0].message.documentId, m.second.documentId);
      assert.equal(rows[0].edition.documentId, edition.documentId);
      assert.equal(rows[0].handledAt ?? null, null);
    });

    it('le motif est rogné ; 500 caractères exactement sont acceptés', async () => {
      const { edition, p, conversation, m } = await scene();
      const lea = await as(edition, p.lea);
      assert.equal((await reportOf(lea, conversation, m.first, '   Motif court   ')).status, 201);
      assert.equal((await reportOf(lea, conversation, m.second, 'a'.repeat(500))).status, 201);
      const reasons = (await reportsOf(edition)).map((row) => row.reason).sort((a, b) => a.length - b.length);
      assert.deepEqual(reasons, ['Motif court', 'a'.repeat(500)]);
    });

    it('chacun des deux participants signale les messages reçus de l’autre', async () => {
      const { edition, p, conversation, m } = await scene();
      assert.equal((await reportOf(await as(edition, p.mathis), conversation, m.mine)).status, 201);
      assert.equal((await reportOf(await as(edition, p.lea), conversation, m.first)).status, 201);
    });

    for (const [label, body, message] of [
      ['motif absent', {}, 'Indiquez le motif du signalement.'],
      ['motif vide', { reason: '' }, 'Indiquez le motif du signalement.'],
      ['motif d’espaces', { reason: '    ' }, 'Indiquez le motif du signalement.'],
      ['motif qui n’est pas un texte', { reason: 12 }, 'Indiquez le motif du signalement.'],
      ['motif de 501 caractères', { reason: 'a'.repeat(501) }, 'Le motif ne peut pas dépasser 500 caractères.'],
    ]) {
      it(`${label} : 400 VALIDATION fields.reason, rien d’écrit, aucun e-mail`, async () => {
        const { edition, p, conversation, m } = await scene();
        const lea = await as(edition, p.lea);
        const since = espace().outbox().length;
        const response = await lea.post(`/conversations/${conversation.documentId}/messages/${m.second.documentId}/report`, body);
        expectError(response, 400, 'VALIDATION');
        assert.equal(response.json.error.fields.reason, message);
        assert.equal((await reportsOf(edition)).length, 0);
        assert.deepEqual(await espace().mailsSince(since, { settleMs: 200 }), []);
      });
    }
  });

  describe('critère 1 : seulement ses messages reçus, dans ses conversations (R-63)', () => {
    it('son propre message : 404 MESSAGE_NOT_FOUND, rien d’écrit', async () => {
      const { edition, p, conversation, m } = await scene();
      expectError(await reportOf(await as(edition, p.lea), conversation, m.mine), 404, 'MESSAGE_NOT_FOUND');
      assert.equal((await reportsOf(edition)).length, 0);
    });

    it('un tiers à la conversation : 404 MESSAGE_NOT_FOUND', async () => {
      const { edition, p, conversation, m } = await scene();
      expectError(await reportOf(await as(edition, p.ines), conversation, m.second), 404, 'MESSAGE_NOT_FOUND');
      assert.equal((await reportsOf(edition)).length, 0);
    });

    it('un organisateur qui n’est pas participant : 404 MESSAGE_NOT_FOUND', async () => {
      const { edition, p, conversation, m } = await scene();
      expectError(await reportOf(await as(edition, p.orga), conversation, m.second), 404, 'MESSAGE_NOT_FOUND');
    });

    it('un message d’une autre conversation de la même personne, cité avec cette conversation : 404', async () => {
      const { edition, p, conversation } = await scene();
      const other = await conversationBetween(edition, p.lea, p.ines);
      const foreign = await messageFrom(other, p.ines, 'MSG-AUTRE-CONVERSATION');
      expectError(await reportOf(await as(edition, p.lea), conversation, foreign), 404, 'MESSAGE_NOT_FOUND');
      assert.equal((await reportsOf(edition)).length, 0);
    });

    it('une conversation d’une autre édition : 404', async () => {
      const { edition, p } = await scene();
      const other = await scene();
      expectError(await reportOf(await as(edition, p.lea), other.conversation, other.m.second), 404, 'MESSAGE_NOT_FOUND');
    });

    it('identifiants inconnus : 404 MESSAGE_NOT_FOUND', async () => {
      const { edition, p, conversation, m } = await scene();
      const lea = await as(edition, p.lea);
      expectError(await lea.post(`/conversations/inconnue123/messages/${m.second.documentId}/report`, { reason: 'x' }), 404, 'MESSAGE_NOT_FOUND');
      expectError(await lea.post(`/conversations/${conversation.documentId}/messages/inconnu123/report`, { reason: 'x' }), 404, 'MESSAGE_NOT_FOUND');
    });
  });

  describe('critère 3 : un message ne se signale qu’une fois par personne', () => {
    it('le second signalement répond 409 ALREADY_REPORTED, sans second signalement ni second e-mail', async () => {
      const { edition, p, conversation, m } = await scene();
      const lea = await as(edition, p.lea);
      const since = espace().outbox().length;
      assert.equal((await reportOf(lea, conversation, m.second)).status, 201);
      expectError(await reportOf(lea, conversation, m.second, 'Autre motif'), 409, 'ALREADY_REPORTED');
      assert.equal((await reportsOf(edition)).length, 1);
      const mails = await espace().mailsSince(since, { settleMs: 300, to: p.orga.email });
      assert.equal(mails.filter((mail) => mail.subject === 'Un message a été signalé').length, 1);
    });

    it('des signalements simultanés du même message ne créent qu’un signalement', async () => {
      const { edition, p, conversation, m } = await scene();
      const lea = await as(edition, p.lea);
      const responses = await Promise.all([1, 2, 3].map(() => reportOf(lea, conversation, m.second)));
      assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 409, 409]);
      assert.equal((await reportsOf(edition)).length, 1);
    });

    it('le même participant signale un autre message : 201', async () => {
      const { edition, p, conversation, m } = await scene();
      const lea = await as(edition, p.lea);
      assert.equal((await reportOf(lea, conversation, m.first)).status, 201);
      assert.equal((await reportOf(lea, conversation, m.second)).status, 201);
    });
  });

  describe('critère 4 : la file des signalements est réservée aux organisateurs', () => {
    it('un participant reçoit 403 FORBIDDEN sur la liste et sur « traité », sans effet', async () => {
      const { edition, p, conversation, m } = await scene();
      const reported = await reportOf(await as(edition, p.lea), conversation, m.second);
      expectError(await adminCall(edition, p.lea, ''), 403, 'FORBIDDEN');
      expectError(await adminCall(edition, p.mathis, ''), 403, 'FORBIDDEN');
      expectError(await adminCall(edition, p.lea, `/${reported.json.id}/handle`, 'POST'), 403, 'FORBIDDEN');
      assert.equal((await reportsOf(edition))[0].status, 'open');
    });

    it('un intervenant ou un représentant d’exposant n’est pas organisateur : 403', async () => {
      const { edition } = await scene();
      for (const role of ['speaker', 'exhibitor_rep']) {
        const someone = await person(edition, { role });
        expectError(await adminCall(edition, someone, ''), 403, 'FORBIDDEN');
      }
    });

    it('un organisateur d’une autre édition : 403', async () => {
      const { edition } = await scene();
      const other = await scene();
      const call = await espace().request(admin(edition), { cookie: await login(other.edition, other.p.orga) });
      expectError(call, 403, 'FORBIDDEN');
    });

    it('un organisateur de ORGANIZER_EMAILS accède à la file', async () => {
      const { edition } = await scene();
      const { cookie } = await espace().signIn(edition.slug, ORGANIZER);
      const response = await espace().request(admin(edition), { cookie });
      assert.equal(response.status, 200, response.text);
    });
  });

  describe('GET …/reports : la file (R-63, critère 2)', () => {
    it('file vide : { open: [], handled: [] }', async () => {
      const { edition, p } = await scene();
      const response = await adminCall(edition, p.orga, '');
      assert.equal(response.status, 200, response.text);
      assert.deepEqual(response.json, { open: [], handled: [] });
    });

    it('ne renvoie que le message signalé : aucun autre message de la conversation, aucune donnée de contact', async () => {
      const { edition, p, conversation, m } = await scene();
      assert.equal((await reportOf(await as(edition, p.lea), conversation, m.second, 'Propos litigieux')).status, 201);
      const response = await adminCall(edition, p.orga, '');
      assert.equal(response.status, 200, response.text);
      assert.equal(response.json.open.length, 1);
      const text = JSON.stringify(response.json);
      assert.ok(text.includes('MSG-SECOND'), 'le message signalé est lu');
      for (const other of ['MSG-PREMIER', 'MSG-DE-LEA']) assert.ok(!text.includes(other), `${other} ne doit pas être exposé`);
      assert.deepEqual(W.leaks(response.json), [], 'adresse ou identifiant HelloAsso dans la file');
    });

    it('forme d’un élément : { id, status, at, handledAt, reason, reporter: { name }, reported: { name }, message: { body } }', async () => {
      const { edition, p, conversation, m } = await scene();
      const reported = await reportOf(await as(edition, p.lea), conversation, m.second, 'Propos litigieux');
      const { json } = await adminCall(edition, p.orga, '');
      assert.deepEqual(Object.keys(json).sort(), ['handled', 'open']);
      const [item] = json.open;
      assert.deepEqual(Object.keys(item).sort(), ['at', 'handledAt', 'id', 'message', 'reason', 'reported', 'reporter', 'status']);
      assert.equal(item.id, reported.json.id);
      assert.equal(item.status, 'open');
      assert.equal(item.handledAt, null);
      assert.equal(item.reason, 'Propos litigieux');
      assert.deepEqual(item.reporter, { name: 'Léa Ducasse' });
      assert.deepEqual(item.reported, { name: 'Mathis Lagrange' });
      assert.deepEqual(item.message, { body: 'MSG-SECOND Un propos litigieux' });
      assert.ok(Math.abs(Date.parse(item.at) - Date.now()) < 60_000, item.at);
    });

    it('les ouverts d’un côté, les traités de l’autre, le plus récent d’abord', async () => {
      const { edition, p, conversation, m } = await scene();
      const lea = await as(edition, p.lea);
      const mathis = await as(edition, p.mathis);
      const third = await messageFrom(conversation, p.mathis, 'MSG-TROISIEME');
      const a = await reportOf(lea, conversation, m.first, 'A');
      await sleep(30);
      const b = await reportOf(lea, conversation, m.second, 'B');
      await sleep(30);
      const c = await reportOf(lea, conversation, third, 'C');
      await sleep(30);
      const d = await reportOf(mathis, conversation, m.mine, 'D');
      assert.equal((await adminCall(edition, p.orga, `/${b.json.id}/handle`, 'POST')).status, 200);
      assert.equal((await adminCall(edition, p.orga, `/${a.json.id}/handle`, 'POST')).status, 200);
      const { json } = await adminCall(edition, p.orga, '');
      assert.deepEqual(json.open.map(({ id }) => id), [d.json.id, c.json.id]);
      assert.deepEqual(json.handled.map(({ id }) => id), [b.json.id, a.json.id], 'le plus récent signalement d’abord, traités compris');
      assert.ok(json.handled.every((item) => item.status === 'handled' && item.handledAt));
    });

    it('ne montre que les signalements de son édition', async () => {
      const first = await scene();
      const second = await scene();
      await reportOf(await as(first.edition, first.p.lea), first.conversation, first.m.second);
      await reportOf(await as(second.edition, second.p.lea), second.conversation, second.m.first);
      const { json } = await adminCall(first.edition, first.p.orga, '');
      assert.equal(json.open.length, 1);
      assert.equal(json.open[0].message.body, 'MSG-SECOND Un propos litigieux');
    });

    it('R-63 : le signalement n’ouvre pas la conversation à l’organisateur (fil et liste restent 404)', async () => {
      const { edition, p, conversation, m } = await scene();
      await reportOf(await as(edition, p.lea), conversation, m.second);
      const orga = await as(edition, p.orga);
      expectError(await orga.get(`/conversations/${conversation.documentId}/messages`), 404);
      const list = await orga.get('/conversations');
      assert.equal(list.status, 200, list.text);
      assert.ok(!list.text.includes('MSG-'), 'contenu de message dans la liste des conversations de l’organisateur');
    });
  });

  describe('POST …/handle : marquer comme traité', () => {
    it('200 { id, status: "handled", handledAt } ; le signalement passe dans les traités', async () => {
      const { edition, p, conversation, m } = await scene();
      const reported = await reportOf(await as(edition, p.lea), conversation, m.second);
      const response = await adminCall(edition, p.orga, `/${reported.json.id}/handle`, 'POST');
      assert.equal(response.status, 200, response.text);
      assert.deepEqual(Object.keys(response.json).sort(), ['handledAt', 'id', 'status']);
      assert.equal(response.json.id, reported.json.id);
      assert.equal(response.json.status, 'handled');
      assert.ok(Math.abs(Date.parse(response.json.handledAt) - Date.now()) < 60_000);
      const { json } = await adminCall(edition, p.orga, '');
      assert.equal(json.open.length, 0);
      assert.equal(json.handled[0].id, reported.json.id);
      assert.equal(json.handled[0].handledAt, response.json.handledAt);
    });

    it('idempotent : un second appel répond 200 et garde la première date', async () => {
      const { edition, p, conversation, m } = await scene();
      const reported = await reportOf(await as(edition, p.lea), conversation, m.second);
      const first = await adminCall(edition, p.orga, `/${reported.json.id}/handle`, 'POST');
      await sleep(30);
      const again = await adminCall(edition, p.orga, `/${reported.json.id}/handle`, 'POST');
      assert.equal(again.status, 200, again.text);
      assert.equal(again.json.status, 'handled');
      assert.equal(again.json.handledAt, first.json.handledAt);
    });

    it('identifiant inconnu : 404 REPORT_NOT_FOUND', async () => {
      const { edition, p } = await scene();
      expectError(await adminCall(edition, p.orga, '/inconnu123/handle', 'POST'), 404, 'REPORT_NOT_FOUND');
    });

    it('le signalement d’une autre édition : 404 REPORT_NOT_FOUND, sans effet', async () => {
      const first = await scene();
      const second = await scene();
      const reported = await reportOf(await as(second.edition, second.p.lea), second.conversation, second.m.second);
      expectError(await adminCall(first.edition, first.p.orga, `/${reported.json.id}/handle`, 'POST'), 404, 'REPORT_NOT_FOUND');
      assert.equal((await reportsOf(second.edition))[0].status, 'open');
    });
  });

  describe('e-mail message-report aux organisateurs (F-75, R-63)', () => {
    const SUBJECT = 'Un message a été signalé';
    const reportMails = (since, who) => W.outboxTo(espace, who.email, since).filter((mail) => mail.subject === SUBJECT);

    it('un e-mail par organisateur actif (rôle organizer ou adresse de ORGANIZER_EMAILS), aucun pour les autres', async () => {
      const { edition, p, conversation, m } = await scene();
      const second = await person(edition, { role: 'organizer', firstName: 'Omar' });
      const byAddress = await person(edition, { email: ORGANIZER, firstName: 'Odile' });
      const cancelled = await person(edition, { role: 'organizer', status: 'cancelled' });
      const since = espace().outbox().length;
      assert.equal((await reportOf(await as(edition, p.lea), conversation, m.second)).status, 201);
      await espace().mailsSince(since, { settleMs: 400 });
      for (const organizer of [p.orga, second, byAddress]) assert.equal(reportMails(since, organizer).length, 1, organizer.email);
      for (const other of [cancelled, p.lea, p.mathis, p.ines]) assert.equal(reportMails(since, other).length, 0, `${other.email} ne doit rien recevoir`);
    });

    it('un organisateur d’une autre édition ne reçoit rien', async () => {
      const { edition, p, conversation, m } = await scene();
      const other = await scene();
      const since = espace().outbox().length;
      assert.equal((await reportOf(await as(edition, p.lea), conversation, m.second)).status, 201);
      await espace().mailsSince(since, { settleMs: 400 });
      assert.equal(reportMails(since, other.p.orga).length, 0);
    });

    it('R-63 : aucun contenu du message, du motif ni des noms dans l’e-mail', async () => {
      const { edition, p, conversation, m } = await scene();
      const since = espace().outbox().length;
      await reportOf(await as(edition, p.lea), conversation, m.second, 'MOTIF-SECRET-4821');
      await espace().mailsSince(since, { settleMs: 400 });
      const [mail] = reportMails(since, p.orga);
      assert.ok(mail, 'e-mail attendu');
      const everything = JSON.stringify(mail);
      for (const forbidden of ['MSG-SECOND', 'MSG-PREMIER', 'MOTIF-SECRET-4821', 'litigieux', 'Lagrange', 'Ducasse']) {
        assert.ok(!everything.includes(forbidden), `« ${forbidden} » ne doit pas figurer dans l’e-mail`);
      }
    });

    it('le lien est un lien d’action de 72 heures vers le pilotage de l’édition', async () => {
      const { edition, p, conversation, m } = await scene();
      const since = espace().outbox().length;
      await reportOf(await as(edition, p.lea), conversation, m.second);
      await espace().mailsSince(since, { settleMs: 400 });
      const [mail] = reportMails(since, p.orga);
      const found = espace().linkOf(mail);
      assert.ok(found?.token, 'lien de connexion dans l’e-mail');
      assert.equal(found.next, `/espace/${edition.slug}/organisateur`);
      const stored = await app().db.query(UID.magicToken).findOne({ where: { tokenHash: hashToken(found.token) }, populate: { attendee: true } });
      assert.ok(stored, 'jeton enregistré');
      assert.equal(stored.kind, 'link');
      assert.equal(stored.attendee.documentId, p.orga.documentId);
      const lifetime = Date.parse(stored.expiresAt) - Date.parse(stored.createdAt);
      assert.ok(Math.abs(lifetime - 72 * HOUR) < 60_000, `durée du lien : ${lifetime / HOUR} h`);
    });

    it('le lien ouvre une session d’organisateur sur le pilotage et la file', async () => {
      const { edition, p, conversation, m } = await scene();
      const since = espace().outbox().length;
      await reportOf(await as(edition, p.lea), conversation, m.second);
      await espace().mailsSince(since, { settleMs: 400 });
      const found = espace().linkOf(reportMails(since, p.orga)[0]);
      const verified = await espace().request('/api/espace/auth/verify', { method: 'POST', json: { token: found.token, next: found.next } });
      assert.equal(verified.status, 200, verified.text);
      const cookie = verified.setCookies.map((line) => line.split(';')[0]).join('; ');
      const list = await espace().request(admin(edition), { cookie });
      assert.equal(list.status, 200, list.text);
      assert.equal(list.json.open.length, 1);
    });

    it('un signalement refusé (409, 404, 400) n’envoie aucun e-mail de plus', async () => {
      const { edition, p, conversation, m } = await scene();
      const lea = await as(edition, p.lea);
      await reportOf(lea, conversation, m.second);
      await espace().mailsSince(0, { settleMs: 400 });
      const since = espace().outbox().length;
      await reportOf(lea, conversation, m.second);
      await reportOf(lea, conversation, m.mine);
      await lea.post(`/conversations/${conversation.documentId}/messages/${m.first.documentId}/report`, { reason: '' });
      assert.deepEqual(await espace().mailsSince(since, { settleMs: 400 }), []);
    });
  });
});
