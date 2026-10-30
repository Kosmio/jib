'use strict';

/**
 * Messagerie (lot 14) : T-30, T-31, T-32, R-61 à R-64, F-70 à F-74, A-37, NF-01.
 *   - POST /conversations : une conversation par paire (R-61), premier message refusé sans `meetingsOptIn` (T-30, F-74), cible visible (A-34) ;
 *   - GET /conversations, GET et POST /conversations/:id/messages : liste, fil (messages reçus marqués lus), envoi (F-72), limite de 30 par heure (T-32, R-64) ;
 *   - rendez-vous lié calculé (A-37) ;
 *   - R-63 : un tiers, un organisateur ou une autre édition reçoit 404 ;
 *   - `notifyMessages({ now })` : un seul e-mail `new-message` par conversation et destinataire sur 30 minutes (T-31, R-62).
 * Chaque test crée ses personnes et son édition. Un seul démarrage de Strapi.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { useEspace } = require('../helpers/espace');
const { link } = require('../helpers/espace-data');
const W = require('../helpers/meetings-world');

const MESSAGE = 'api::espace.message';
const CONVERSATION = 'api::espace.conversation';
const NBSP = String.fromCharCode(0xa0);
const MINUTE = 60_000;
const ROW_KEYS = ['counterpart', 'id', 'lastMessage', 'meeting', 'unread'];

describe('messagerie (lot 14)', { timeout: 900_000 }, () => {
  const espace = useEspace({ overrides: { ORGANIZER_EMAILS: 'organisation@example.org' } });
  const login = W.useLogin(espace);
  const api = W.useApi(espace);
  const app = () => espace().app;

  const person = (edition, fields) => W.createPerson(app(), edition, fields);
  const as = async (edition, who) => api(await login(edition, who));
  const expectError = (response, status, code) => {
    assert.equal(response.status, status, `${response.status} ${response.text}`);
    if (code) assert.equal(response.json?.error?.code, code, response.text);
  };
  const conversationsOf = (edition) => app().documents(CONVERSATION).findMany({ filters: { edition: { documentId: edition.documentId } }, populate: { participants: true }, limit: 200 });
  const messagesIn = (conversationId) =>
    app().documents(MESSAGE).findMany({ filters: { conversation: { documentId: conversationId } }, populate: { author: true }, sort: ['createdAt:asc', 'id:asc'], limit: 500 });

  /** Conversation écrite directement (état de départ). */
  const conversationBetween = (edition, a, b) => app().documents(CONVERSATION).create({ data: { edition: link(edition), participants: [link(a), link(b)] } });
  /** Message écrit directement, `at` : instant de création (Date). */
  const messageFrom = (conversation, author, body, { at, readAt, emailNotifiedAt } = {}) =>
    app().documents(MESSAGE).create({
      data: { conversation: link(conversation), author: link(author), body, ...(at && { createdAt: at }), ...(readAt && { readAt }), ...(emailNotifiedAt && { emailNotifiedAt }) },
    });
  const minutesAgo = (minutes, from = Date.now()) => new Date(from - minutes * MINUTE);

  /**
   * Une édition et ses personnes : Léa, Mathis et Inès reçoivent (annuaire et rendez-vous cochés) ; Manon est visible mais sans
   * `meetingsOptIn` ; Clara a `meetingsOptIn` mais pas l'annuaire (invisible sans lien) ; Gaspard est annulé.
   */
  async function scene(options) {
    const world = await W.createMeetingEdition(app(), { slug: W.unique('msg'), title: 'Édition d’essai', ...options });
    const { edition } = world;
    const p = {
      lea: await person(edition, { firstName: 'Léa', lastName: 'Ducasse' }),
      mathis: await person(edition, { firstName: 'Mathis', lastName: 'Lagrange' }),
      ines: await person(edition, { firstName: 'Inès', lastName: 'Castaing' }),
      manon: await person(edition, { firstName: 'Manon', lastName: 'Bordenave', meetingsOptIn: false }),
      clara: await person(edition, { firstName: 'Clara', lastName: 'Dubourdieu', directoryOptIn: false }),
      gaspard: await person(edition, { firstName: 'Gaspard', lastName: 'Annule', status: 'cancelled' }),
    };
    return { world, edition, p };
  }

  describe('routes du lot 14 et accès sans session (NF-01, A-02)', () => {
    const ROUTES = [
      'GET /api/espace/conversations',
      'POST /api/espace/conversations',
      'GET /api/espace/conversations/:x/messages',
      'POST /api/espace/conversations/:x/messages',
    ];
    const declared = () =>
      espace()
        .app.server.listRoutes()
        .filter((route) => route.path.startsWith('/api/espace'))
        .flatMap((route) => route.methods.filter((method) => method !== 'HEAD').map((method) => `${method} ${route.path.replace(/:[A-Za-z]+/g, ':x')}`));

    it('routes:list montre les quatre routes de la messagerie, et aucune autre sous /conversations', () => {
      for (const route of ROUTES) assert.ok(declared().includes(route), `route absente : ${route}`);
      assert.deepEqual(declared().filter((route) => route.includes('/conversations') && !ROUTES.includes(route)), []);
    });

    for (const route of ROUTES) {
      const [method, template] = route.split(' ');
      it(`${route} sans session : 401 UNAUTHENTICATED`, async () => {
        expectError(await espace().request(template.replace(':x', 'abc123'), { method, json: method === 'POST' ? {} : undefined }), 401, 'UNAUTHENTICATED');
      });
    }
  });

  describe('POST /conversations : ouvrir la conversation d’une paire (R-61, T-30, F-74, A-37)', () => {
    it('201 { id } pour une première conversation, 200 avec le même id ensuite, et dans l’autre sens (une seule par paire)', async () => {
      const { edition, p } = await scene();
      const first = await (await as(edition, p.lea)).post('/conversations', { with: `p:${p.mathis.documentId}` });
      assert.equal(first.status, 201, first.text);
      assert.deepEqual(Object.keys(first.json), ['id']);

      const again = await (await as(edition, p.lea)).post('/conversations', { with: `p:${p.mathis.documentId}` });
      assert.equal(again.status, 200);
      assert.equal(again.json.id, first.json.id);

      const reverse = await (await as(edition, p.mathis)).post('/conversations', { with: `p:${p.lea.documentId}` });
      assert.equal(reverse.status, 200);
      assert.equal(reverse.json.id, first.json.id);

      const rows = await conversationsOf(edition);
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0].participants.map(({ documentId }) => documentId).sort(), [p.lea.documentId, p.mathis.documentId].sort());
    });

    it('A-37 : des ouvertures simultanées de la même paire ne créent qu’une conversation', async () => {
      const { edition, p } = await scene();
      const lea = await as(edition, p.lea);
      const mathis = await as(edition, p.mathis);
      const responses = await Promise.all([
        lea.post('/conversations', { with: `p:${p.mathis.documentId}` }),
        mathis.post('/conversations', { with: `p:${p.lea.documentId}` }),
        lea.post('/conversations', { with: `p:${p.mathis.documentId}` }),
        mathis.post('/conversations', { with: `p:${p.lea.documentId}` }),
        lea.post('/conversations', { with: `p:${p.mathis.documentId}` }),
      ]);
      assert.deepEqual([...new Set(responses.map(({ status }) => status))].sort(), [200, 201]);
      assert.equal(responses.filter(({ status }) => status === 201).length, 1);
      assert.equal(new Set(responses.map(({ json }) => json.id)).size, 1);
      assert.equal((await conversationsOf(edition)).length, 1);
    });

    it('T-30 : le premier message à une personne sans meetingsOptIn est refusé, 403 TARGET_UNAVAILABLE, sans rien créer', async () => {
      const { edition, p } = await scene();
      expectError(await (await as(edition, p.lea)).post('/conversations', { with: `p:${p.manon.documentId}` }), 403, 'TARGET_UNAVAILABLE');
      assert.equal((await conversationsOf(edition)).length, 0);
    });

    it('F-74 : cette personne peut écrire la première, puis chacun peut écrire à l’autre (la conversation existe)', async () => {
      const { edition, p } = await scene();
      const manon = await as(edition, p.manon);
      const opened = await manon.post('/conversations', { with: `p:${p.lea.documentId}` });
      assert.equal(opened.status, 201, opened.text);
      assert.equal((await manon.post(`/conversations/${opened.json.id}/messages`, { body: 'Bonjour Léa, une question sur vos panneaux.' })).status, 201);

      const lea = await as(edition, p.lea);
      const reopened = await lea.post('/conversations', { with: `p:${p.manon.documentId}` });
      assert.equal(reopened.status, 200, reopened.text);
      assert.equal(reopened.json.id, opened.json.id);
      assert.equal((await lea.post(`/conversations/${opened.json.id}/messages`, { body: 'Bonjour Manon, volontiers.' })).status, 201);
    });

    it('un inscrit annulé : 403 TARGET_UNAVAILABLE', async () => {
      const { edition, p } = await scene();
      expectError(await (await as(edition, p.lea)).post('/conversations', { with: `p:${p.gaspard.documentId}` }), 403, 'TARGET_UNAVAILABLE');
    });

    it('soi-même : 403 TARGET_UNAVAILABLE', async () => {
      const { edition, p } = await scene();
      expectError(await (await as(edition, p.lea)).post('/conversations', { with: `p:${p.lea.documentId}` }), 403, 'TARGET_UNAVAILABLE');
    });

    it('A-34 : une personne qui n’est pas visible (annuaire non coché, aucun lien) : 404 TARGET_NOT_FOUND', async () => {
      const { edition, p } = await scene();
      expectError(await (await as(edition, p.lea)).post('/conversations', { with: `p:${p.clara.documentId}` }), 404, 'TARGET_NOT_FOUND');
      assert.equal((await conversationsOf(edition)).length, 0);
    });

    it('A-34 : la même personne, avec un rendez-vous entre elles (quel que soit le statut), devient joignable : 201', async () => {
      const { world, edition, p } = await scene();
      await W.seedMeeting(app(), { edition, slot: world.slots['10h45'], requester: p.clara, target: p.lea, status: 'pending' });
      const response = await (await as(edition, p.lea)).post('/conversations', { with: `p:${p.clara.documentId}` });
      assert.equal(response.status, 201, response.text);
    });

    it('un identifiant inconnu, ou d’une autre édition : 404 TARGET_NOT_FOUND', async () => {
      const { edition, p } = await scene();
      const other = await scene();
      const lea = await as(edition, p.lea);
      expectError(await lea.post('/conversations', { with: 'p:inconnu123' }), 404, 'TARGET_NOT_FOUND');
      expectError(await lea.post('/conversations', { with: `p:${other.p.mathis.documentId}` }), 404, 'TARGET_NOT_FOUND');
    });

    for (const [label, body] of [
      ['sans destinataire', {}],
      ['une forme qui n’est pas p:{id}', { with: 'x:abc' }],
      ['un destinataire qui n’est pas un texte', { with: 12 }],
      ['un identifiant avec des caractères interdits', { with: 'p:../etc' }],
    ]) {
      it(`${label} : 400 VALIDATION`, async () => {
        const { edition, p } = await scene();
        expectError(await (await as(edition, p.lea)).post('/conversations', body), 400, 'VALIDATION');
      });
    }

    it('ne renvoie aucune donnée personnelle (R-42)', async () => {
      const { edition, p } = await scene();
      const response = await (await as(edition, p.lea)).post('/conversations', { with: `p:${p.mathis.documentId}` });
      assert.deepEqual(W.leaks(response.text), []);
    });
  });

  describe('GET /conversations : la liste (F-70, A-37)', () => {
    it('vide sans message : une conversation ouverte mais sans message n’est pas listée', async () => {
      const { edition, p } = await scene();
      const lea = await as(edition, p.lea);
      assert.deepEqual((await lea.get('/conversations')).json, []);
      await lea.post('/conversations', { with: `p:${p.mathis.documentId}` });
      assert.deepEqual((await lea.get('/conversations')).json, []);
    });

    it('forme de chaque ligne, dernière conversation d’abord, non lus et « mine »', async () => {
      const { edition, p } = await scene();
      const withMathis = await conversationBetween(edition, p.lea, p.mathis);
      await messageFrom(withMathis, p.mathis, 'Bonjour Léa, quels panneaux vous intéressent ?', { at: minutesAgo(300), readAt: minutesAgo(290) });
      await messageFrom(withMathis, p.lea, 'Bonjour Mathis, les panneaux pour cloisons.', { at: minutesAgo(280), readAt: minutesAgo(270) });
      await messageFrom(withMathis, p.mathis, 'J’apporterai nos échantillons de panneaux.', { at: minutesAgo(200) });
      const withInes = await conversationBetween(edition, p.ines, p.lea);
      await messageFrom(withInes, p.ines, 'Bonjour Léa, je viens de vous envoyer une demande.', { at: minutesAgo(100) });
      const withManon = await conversationBetween(edition, p.lea, p.manon);
      await messageFrom(withManon, p.lea, 'Merci Manon, à bientôt.', { at: minutesAgo(20) });

      const response = await (await as(edition, p.lea)).get('/conversations');
      assert.equal(response.status, 200);
      const rows = response.json;
      assert.deepEqual(
        rows.map((row) => row.counterpart.displayName),
        ['Manon Bordenave', 'Inès Castaing', 'Mathis Lagrange'],
        'le plus récent d’abord',
      );
      for (const row of rows) {
        assert.deepEqual(Object.keys(row).sort(), ROW_KEYS);
        assert.deepEqual(Object.keys(row.lastMessage).sort(), ['at', 'excerpt', 'mine']);
        for (const key of Object.keys(row.counterpart)) assert.ok(W.CARD_KEYS.includes(key), `champ inattendu ${key}`);
      }
      const byName = Object.fromEntries(rows.map((row) => [row.counterpart.displayName, row]));
      assert.equal(byName['Manon Bordenave'].lastMessage.mine, true);
      assert.equal(byName['Manon Bordenave'].unread, 0);
      assert.equal(byName['Inès Castaing'].lastMessage.mine, false);
      assert.equal(byName['Inès Castaing'].unread, 1);
      assert.equal(byName['Mathis Lagrange'].lastMessage.excerpt, 'J’apporterai nos échantillons de panneaux.');
      assert.equal(byName['Mathis Lagrange'].unread, 1, 'seuls les messages non lus de l’autre comptent');
      assert.deepEqual(W.leaks(response.text), []);
    });

    it('chacun ne voit que ses conversations, avec ses propres compteurs', async () => {
      const { edition, p } = await scene();
      const conversation = await conversationBetween(edition, p.lea, p.mathis);
      await messageFrom(conversation, p.mathis, 'Bonjour Léa.');
      assert.equal((await (await as(edition, p.lea)).get('/conversations')).json[0].unread, 1);
      const mine = (await (await as(edition, p.mathis)).get('/conversations')).json;
      assert.equal(mine[0].unread, 0, 'l’auteur n’a rien de non lu');
      assert.equal(mine[0].lastMessage.mine, true);
      assert.deepEqual((await (await as(edition, p.ines)).get('/conversations')).json, []);
    });

    it('l’extrait de la liste est coupé à 140 caractères', async () => {
      const { edition, p } = await scene();
      const conversation = await conversationBetween(edition, p.lea, p.mathis);
      await messageFrom(conversation, p.mathis, 'a'.repeat(500));
      const [row] = (await (await as(edition, p.lea)).get('/conversations')).json;
      assert.equal(row.lastMessage.excerpt.length, 140);
    });

    it('aucune conversation d’une autre édition', async () => {
      const first = await scene();
      const second = await scene();
      const conversation = await conversationBetween(second.edition, second.p.lea, second.p.mathis);
      await messageFrom(conversation, second.p.mathis, 'Bonjour.');
      assert.deepEqual((await (await as(first.edition, first.p.lea)).get('/conversations')).json, []);
    });
  });

  describe('GET /conversations/:id/messages : le fil (F-70, F-71, R-63, NF-01)', () => {
    async function threadScene() {
      const s = await scene();
      const conversation = await conversationBetween(s.edition, s.p.lea, s.p.mathis);
      const first = await messageFrom(conversation, s.p.mathis, 'Bonjour Léa.', { at: minutesAgo(60) });
      const second = await messageFrom(conversation, s.p.lea, 'Bonjour Mathis.', { at: minutesAgo(50) });
      const third = await messageFrom(conversation, s.p.mathis, 'À tout à l’heure.', { at: minutesAgo(30) });
      return { ...s, conversation, messages: [first, second, third] };
    }

    it('forme : { conversation: { id, counterpart, meeting, counterpartGetsEmail }, messages: [{ id, body, at, mine, readAt }] }, du plus ancien au plus récent', async () => {
      const { edition, p, conversation } = await threadScene();
      const response = await (await as(edition, p.lea)).get(`/conversations/${conversation.documentId}/messages`);
      assert.equal(response.status, 200, response.text);
      assert.deepEqual(Object.keys(response.json).sort(), ['conversation', 'messages']);
      assert.deepEqual(Object.keys(response.json.conversation).sort(), ['counterpart', 'counterpartGetsEmail', 'id', 'meeting']);
      assert.equal(response.json.conversation.id, conversation.documentId);
      assert.equal(response.json.conversation.counterpart.displayName, 'Mathis Lagrange');
      assert.deepEqual(response.json.messages.map(({ body }) => body), ['Bonjour Léa.', 'Bonjour Mathis.', 'À tout à l’heure.']);
      assert.deepEqual(response.json.messages.map(({ mine }) => mine), [false, true, false]);
      for (const message of response.json.messages) assert.deepEqual(Object.keys(message).sort(), ['at', 'body', 'id', 'mine', 'readAt']);
      assert.deepEqual(W.leaks(response.text), []);
    });

    it('les messages reçus deviennent lus par cet appel (base et réponse), pas ceux que l’on a écrits', async () => {
      const { edition, p, conversation } = await threadScene();
      const lea = await as(edition, p.lea);
      assert.equal((await lea.get('/conversations')).json[0].unread, 2);
      const response = await lea.get(`/conversations/${conversation.documentId}/messages`);
      assert.ok(response.json.messages[0].readAt, 'le message reçu est lu dans la réponse');
      assert.ok(response.json.messages[2].readAt);

      const stored = await messagesIn(conversation.documentId);
      assert.ok(stored[0].readAt && stored[2].readAt, 'lu en base');
      assert.equal(stored[1].readAt, null, 'le message que Léa a écrit reste non lu : il l’est pour Mathis');
      assert.equal((await lea.get('/conversations')).json[0].unread, 0);
    });

    it('lire le fil ne marque lus que les messages que l’on reçoit : Mathis lit, le message de Léa devient lu, les siens non', async () => {
      const { edition, p, conversation } = await threadScene();
      const mathis = await as(edition, p.mathis);
      const response = await mathis.get(`/conversations/${conversation.documentId}/messages`);
      assert.deepEqual(response.json.messages.map(({ mine }) => mine), [true, false, true]);
      const stored = await messagesIn(conversation.documentId);
      assert.ok(stored[1].readAt, 'le message de Léa est lu par Mathis');
      assert.equal(stored[0].readAt, null);
      assert.equal(stored[2].readAt, null);
    });

    it('?after= ne garde que les messages envoyés plus tard (interrogation de 20 s, F-71)', async () => {
      const { edition, p, conversation, messages } = await threadScene();
      const lea = await as(edition, p.lea);
      const after = new Date(messages[1].createdAt).toISOString();
      const response = await lea.get(`/conversations/${conversation.documentId}/messages?after=${encodeURIComponent(after)}`);
      assert.deepEqual(response.json.messages.map(({ body }) => body), ['À tout à l’heure.']);
      const none = await lea.get(`/conversations/${conversation.documentId}/messages?after=${encodeURIComponent(new Date().toISOString())}`);
      assert.deepEqual(none.json.messages, []);
      const garbage = await lea.get(`/conversations/${conversation.documentId}/messages?after=pas-une-date`);
      assert.equal(garbage.json.messages.length, 3, 'une date illisible est ignorée');
    });

    it('counterpartGetsEmail : vrai par défaut, faux si l’autre a coupé les e-mails de messages ou est annulé', async () => {
      const { edition, p, conversation } = await threadScene();
      const lea = await as(edition, p.lea);
      assert.equal((await lea.get(`/conversations/${conversation.documentId}/messages`)).json.conversation.counterpartGetsEmail, true);
      await app().documents('api::espace.attendee').update({ documentId: p.mathis.documentId, data: { emailPrefs: { meetingRequests: true, messages: false, reminders: true } } });
      assert.equal((await lea.get(`/conversations/${conversation.documentId}/messages`)).json.conversation.counterpartGetsEmail, false);
    });

    it('R-63, NF-01 : un tiers reçoit 404 CONVERSATION_NOT_FOUND, en lecture comme en écriture, et rien n’est marqué lu', async () => {
      const { edition, p, conversation } = await threadScene();
      const ines = await as(edition, p.ines);
      expectError(await ines.get(`/conversations/${conversation.documentId}/messages`), 404, 'CONVERSATION_NOT_FOUND');
      expectError(await ines.post(`/conversations/${conversation.documentId}/messages`, { body: 'Je m’invite.' }), 404, 'CONVERSATION_NOT_FOUND');
      const stored = await messagesIn(conversation.documentId);
      assert.equal(stored.length, 3, 'aucun message ajouté');
      assert.equal(stored[2].readAt, null, 'aucun message marqué lu par un tiers');
    });

    it('R-63 : un organisateur n’a pas accès au contenu des messages (404)', async () => {
      const { edition, p, conversation } = await threadScene();
      const boss = await person(edition, { role: 'organizer', firstName: 'Olivia', lastName: 'Organisatrice', directoryOptIn: false, meetingsOptIn: false });
      expectError(await (await as(edition, boss)).get(`/conversations/${conversation.documentId}/messages`), 404, 'CONVERSATION_NOT_FOUND');
    });

    it('une conversation d’une autre édition, ou un identifiant inconnu : 404 CONVERSATION_NOT_FOUND', async () => {
      const first = await threadScene();
      const second = await threadScene();
      const lea = await as(first.edition, first.p.lea);
      expectError(await lea.get(`/conversations/${second.conversation.documentId}/messages`), 404, 'CONVERSATION_NOT_FOUND');
      expectError(await lea.get('/conversations/inconnu123/messages'), 404, 'CONVERSATION_NOT_FOUND');
    });
  });

  describe('POST /conversations/:id/messages : envoyer (F-72, R-64, T-32)', () => {
    async function pair() {
      const s = await scene();
      const conversation = await conversationBetween(s.edition, s.p.lea, s.p.mathis);
      return { ...s, conversation, lea: await as(s.edition, s.p.lea), mathis: await as(s.edition, s.p.mathis) };
    }

    it('201 { id, body, at, mine: true, readAt: null }, texte nettoyé, enregistré avec son auteur', async () => {
      const { conversation, lea, p } = await pair();
      const response = await lea.post(`/conversations/${conversation.documentId}/messages`, { body: '  Bonjour Mathis !  ' });
      assert.equal(response.status, 201, response.text);
      assert.deepEqual(Object.keys(response.json).sort(), ['at', 'body', 'id', 'mine', 'readAt']);
      assert.equal(response.json.body, 'Bonjour Mathis !');
      assert.equal(response.json.mine, true);
      assert.equal(response.json.readAt, null);
      const [stored] = await messagesIn(conversation.documentId);
      assert.equal(stored.author.documentId, p.lea.documentId);
      assert.equal(stored.body, 'Bonjour Mathis !');
    });

    it('le message apparaît dans le fil de l’autre, non lu, et dans sa liste', async () => {
      const { conversation, lea, mathis } = await pair();
      await lea.post(`/conversations/${conversation.documentId}/messages`, { body: 'Bonjour Mathis !' });
      const [row] = (await mathis.get('/conversations')).json;
      assert.equal(row.unread, 1);
      assert.equal(row.lastMessage.excerpt, 'Bonjour Mathis !');
      const thread = await mathis.get(`/conversations/${conversation.documentId}/messages`);
      assert.deepEqual(thread.json.messages.map(({ body, mine }) => [body, mine]), [['Bonjour Mathis !', false]]);
    });

    it('lastMessageAt de la conversation suit le dernier message', async () => {
      const { conversation, lea } = await pair();
      const sent = await lea.post(`/conversations/${conversation.documentId}/messages`, { body: 'Bonjour.' });
      const stored = await app().documents(CONVERSATION).findOne({ documentId: conversation.documentId });
      assert.equal(new Date(stored.lastMessageAt).toISOString(), new Date(sent.json.at).toISOString());
    });

    it('F-72 : 2 000 caractères acceptés', async () => {
      const { conversation, lea } = await pair();
      assert.equal((await lea.post(`/conversations/${conversation.documentId}/messages`, { body: 'a'.repeat(2000) })).status, 201);
    });

    for (const [label, body] of [
      ['vide', { body: '' }],
      ['réduit à des espaces', { body: '  \n  ' }],
      ['absent', {}],
      ['qui n’est pas un texte', { body: 123 }],
      ['de 2 001 caractères', { body: 'a'.repeat(2001) }],
    ]) {
      it(`F-72 : un message ${label} est refusé, 400 VALIDATION avec fields.body, rien d’enregistré`, async () => {
        const { conversation, lea } = await pair();
        const response = await lea.post(`/conversations/${conversation.documentId}/messages`, body);
        expectError(response, 400, 'VALIDATION');
        assert.ok(response.json.error.details?.fields?.body ?? response.json.error.fields?.body, `fields.body : ${response.text}`);
        assert.equal((await messagesIn(conversation.documentId)).length, 0);
      });
    }

    it('un texte avec du HTML est conservé tel quel (l’échappement se fait à l’affichage)', async () => {
      const { conversation, lea } = await pair();
      const html = '<b>gras</b> & <script>alert(1)</script>';
      const response = await lea.post(`/conversations/${conversation.documentId}/messages`, { body: html });
      assert.equal(response.json.body, html);
    });

    it('T-32 : 30 messages dans l’heure passent, le 31e reçoit 429 RATE_LIMITED et n’est pas enregistré', async () => {
      const { conversation, lea } = await pair();
      for (let n = 1; n <= 30; n += 1) {
        const response = await lea.post(`/conversations/${conversation.documentId}/messages`, { body: `Message ${n}` });
        assert.equal(response.status, 201, `message ${n} : ${response.text}`);
      }
      expectError(await lea.post(`/conversations/${conversation.documentId}/messages`, { body: 'Message 31' }), 429, 'RATE_LIMITED');
      assert.equal((await messagesIn(conversation.documentId)).length, 30);
    });

    it('R-64 : la limite est par auteur : l’autre participant écrit encore', async () => {
      const { conversation, lea, mathis, p } = await pair();
      for (let n = 0; n < 30; n += 1) await messageFrom(conversation, p.lea, `Message ${n}`, { at: minutesAgo(10) });
      expectError(await lea.post(`/conversations/${conversation.documentId}/messages`, { body: 'Un de trop' }), 429, 'RATE_LIMITED');
      assert.equal((await mathis.post(`/conversations/${conversation.documentId}/messages`, { body: 'Je réponds.' })).status, 201);
    });

    it('R-64 : la limite compte tous les messages de l’auteur, conversations confondues', async () => {
      const { edition, conversation, lea, p } = await pair();
      const other = await conversationBetween(edition, p.lea, p.ines);
      for (let n = 0; n < 30; n += 1) await messageFrom(other, p.lea, `Message ${n}`, { at: minutesAgo(10) });
      expectError(await lea.post(`/conversations/${conversation.documentId}/messages`, { body: 'Un de trop' }), 429, 'RATE_LIMITED');
    });

    it('R-64 : l’heure est glissante : 30 messages vieux de plus d’une heure ne comptent plus', async () => {
      const { conversation, lea, p } = await pair();
      for (let n = 0; n < 30; n += 1) await messageFrom(conversation, p.lea, `Message ${n}`, { at: minutesAgo(61) });
      assert.equal((await lea.post(`/conversations/${conversation.documentId}/messages`, { body: 'Plus d’une heure après.' })).status, 201);
    });

    it('R-64 : 40 envois simultanés du même auteur donnent exactement 30 messages et 10 refus 429', async () => {
      const { conversation, lea } = await pair();
      const responses = await Promise.all(Array.from({ length: 40 }, (_, n) => lea.post(`/conversations/${conversation.documentId}/messages`, { body: `Message ${n}` })));
      assert.equal(responses.filter(({ status }) => status === 201).length, 30);
      assert.equal(responses.filter(({ status }) => status === 429).length, 10);
      assert.equal(responses.filter(({ status }) => status >= 500).length, 0);
      assert.equal((await messagesIn(conversation.documentId)).length, 30);
    });
  });

  describe('rendez-vous lié affiché dans le fil (A-37)', () => {
    async function linked() {
      const s = await scene();
      const conversation = await conversationBetween(s.edition, s.p.lea, s.p.mathis);
      await messageFrom(conversation, s.p.mathis, 'Bonjour Léa.');
      return { ...s, conversation, lea: await as(s.edition, s.p.lea), mathis: await as(s.edition, s.p.mathis) };
    }
    const threadMeeting = async (who, conversation) => (await who.get(`/conversations/${conversation.documentId}/messages`)).json.conversation.meeting;
    const listMeeting = async (who) => (await who.get('/conversations')).json[0].meeting;

    it('sans rendez-vous accepté (aucun, en attente, refusé, annulé) : meeting est null', async () => {
      const { world, edition, p, conversation, lea } = await linked();
      for (const [slot, status] of [['10h45', 'pending'], ['11h00', 'declined'], ['12h30', 'cancelled']]) {
        await W.seedMeeting(app(), { edition, slot: world.slots[slot], requester: p.lea, target: p.mathis, status });
      }
      assert.equal(await threadMeeting(lea, conversation), null);
      assert.equal(await listMeeting(lea), null);
    });

    it('un rendez-vous accepté de la paire : { id, slotLabel, location }, vu des deux côtés, dans le fil et dans la liste', async () => {
      const { world, edition, p, conversation, lea, mathis } = await linked();
      const meeting = await W.seedMeeting(app(), { edition, slot: world.slots['10h45'], requester: p.lea, target: p.mathis, status: 'accepted', tableNumber: 1, answeredBy: p.mathis });
      for (const who of [lea, mathis]) {
        const shown = await threadMeeting(who, conversation);
        assert.deepEqual(Object.keys(shown).sort(), ['id', 'location', 'slotLabel']);
        assert.equal(shown.id, meeting.documentId);
        assert.equal(shown.location, 'Table 1');
        assert.match(shown.slotLabel, / à 10h45$/);
        assert.deepEqual(await listMeeting(who), shown);
      }
    });

    it('plusieurs rendez-vous acceptés : le prochain', async () => {
      const { world, edition, p, conversation, lea } = await linked();
      await W.seedMeeting(app(), { edition, slot: world.slots['13h00'], requester: p.lea, target: p.mathis, status: 'accepted', tableNumber: 1, answeredBy: p.mathis });
      const earlier = await W.seedMeeting(app(), { edition, slot: world.slots['11h00'], requester: p.mathis, target: p.lea, status: 'accepted', tableNumber: 1, answeredBy: p.lea });
      assert.equal((await threadMeeting(lea, conversation)).id, earlier.documentId);
    });

    it('un rendez-vous accepté avec une autre personne n’est pas affiché dans ce fil', async () => {
      const { world, edition, p, conversation, lea } = await linked();
      await W.seedMeeting(app(), { edition, slot: world.slots['10h45'], requester: p.lea, target: p.ines, status: 'accepted', tableNumber: 1, answeredBy: p.ines });
      assert.equal(await threadMeeting(lea, conversation), null);
    });

    it('un rendez-vous accepté dont le créneau est passé n’est plus « le prochain »', async () => {
      const s = await scene({ daysAhead: -3 });
      const conversation = await conversationBetween(s.edition, s.p.lea, s.p.mathis);
      await messageFrom(conversation, s.p.mathis, 'Bonjour Léa.');
      await W.seedMeeting(app(), { edition: s.edition, slot: s.world.slots['10h45'], requester: s.p.lea, target: s.p.mathis, status: 'accepted', tableNumber: 1, answeredBy: s.p.mathis });
      assert.equal(await threadMeeting(await as(s.edition, s.p.lea), conversation), null);
    });
  });

  describe('notifyMessages : e-mail `new-message` (R-62, F-73, T-31)', () => {
    const notify = (now) => app().service('api::espace.conversations').notifyMessages({ now });
    const mailsFor = (who, since = 0) => W.outboxTo(espace, who.email, since).filter((mail) => mail.subject.startsWith('Nouveau message'));
    const stored = (conversation) => messagesIn(conversation.documentId);

    async function unread({ now = new Date(), age = 10, prefs, recipient = {}, body = 'J’apporterai nos échantillons de panneaux.' } = {}) {
      const s = await scene();
      if (prefs) await app().documents('api::espace.attendee').update({ documentId: s.p.lea.documentId, data: { emailPrefs: prefs } });
      if (recipient.status) await app().documents('api::espace.attendee').update({ documentId: s.p.lea.documentId, data: { status: recipient.status } });
      const conversation = await conversationBetween(s.edition, s.p.lea, s.p.mathis);
      const message = await messageFrom(conversation, s.p.mathis, body, { at: minutesAgo(age, now.getTime()) });
      return { ...s, conversation, message };
    }

    it('T-31 : un message non lu depuis 10 minutes déclenche un e-mail au destinataire, avec l’objet, l’extrait et un lien vers le fil', async () => {
      const now = new Date();
      const { edition, p, conversation } = await unread({ now });
      const since = espace().outbox().length;
      const result = await notify(now);
      assert.ok(result.sent >= 1, JSON.stringify(result));

      const [mail, ...others] = mailsFor(p.lea, since);
      assert.equal(others.length, 0, 'un seul e-mail');
      assert.equal(mail.to.email, p.lea.email);
      assert.equal(mail.subject.replace(NBSP, ' '), 'Nouveau message : Mathis Lagrange');
      assert.match(mail.text, /J’apporterai nos échantillons de panneaux\./);
      const url = mail.text.match(/https?:\/\/[^\s"'<>)]+\/espace\/verifier\?[^\s"'<>)]+/)?.[0];
      assert.ok(url, 'lien de connexion dans l’e-mail');
      assert.match(decodeURIComponent(url), new RegExp(`next=/espace/${edition.slug}/messages/${conversation.documentId}`));
      assert.equal(mailsFor(p.mathis, since).length, 0, 'l’auteur ne reçoit rien');
    });

    it('le message notifié est marqué (emailNotifiedAt) et un second passage n’envoie rien de plus', async () => {
      const now = new Date();
      const { p, conversation } = await unread({ now });
      const since = espace().outbox().length;
      await notify(now);
      assert.ok((await stored(conversation))[0].emailNotifiedAt, 'emailNotifiedAt renseigné');
      await notify(new Date(now.getTime() + 2 * MINUTE));
      await notify(new Date(now.getTime() + 60 * MINUTE));
      assert.equal(mailsFor(p.lea, since).length, 1);
    });

    it('un journal d’e-mail new-message est écrit pour le destinataire', async () => {
      const now = new Date();
      const { p } = await unread({ now });
      await notify(now);
      assert.equal((await W.waitForEmailLogs(app(), p.lea, 'new-message')).length, 1);
    });

    it('T-31 : une rafale de trois messages donne un seul e-mail, qui cite le dernier, et les trois sont marqués', async () => {
      const now = new Date();
      const s = await scene();
      const conversation = await conversationBetween(s.edition, s.p.lea, s.p.mathis);
      await messageFrom(conversation, s.p.mathis, 'Premier message', { at: minutesAgo(9, now.getTime()) });
      await messageFrom(conversation, s.p.mathis, 'Deuxième message', { at: minutesAgo(8, now.getTime()) });
      await messageFrom(conversation, s.p.mathis, 'Troisième message', { at: minutesAgo(7, now.getTime()) });
      const since = espace().outbox().length;
      await notify(now);
      const mails = mailsFor(s.p.lea, since);
      assert.equal(mails.length, 1);
      assert.match(mails[0].text, /Troisième message/);
      assert.ok(!/Premier message/.test(mails[0].text));
      assert.ok((await stored(conversation)).every((message) => message.emailNotifiedAt));
    });

    it('T-31 : un nouveau message dans les 30 minutes attend ; il part 30 minutes après le dernier e-mail', async () => {
      const t0 = new Date();
      const s = await scene();
      const conversation = await conversationBetween(s.edition, s.p.lea, s.p.mathis);
      await messageFrom(conversation, s.p.mathis, 'Premier message', { at: minutesAgo(10, t0.getTime()) });
      const since = espace().outbox().length;
      await notify(t0);
      assert.equal(mailsFor(s.p.lea, since).length, 1);

      await messageFrom(conversation, s.p.mathis, 'Second message', { at: new Date(t0.getTime() + 2 * MINUTE) });
      await notify(new Date(t0.getTime() + 8 * MINUTE));
      await notify(new Date(t0.getTime() + 29 * MINUTE));
      assert.equal(mailsFor(s.p.lea, since).length, 1, 'rien avant 30 minutes');

      await notify(new Date(t0.getTime() + 31 * MINUTE));
      const mails = mailsFor(s.p.lea, since);
      assert.equal(mails.length, 2);
      assert.match(mails[1].text, /Second message/);
    });

    it('R-62 : un message de moins de 5 minutes attend, il part au passage suivant', async () => {
      const now = new Date();
      const { p } = await unread({ now, age: 4 });
      const since = espace().outbox().length;
      await notify(now);
      assert.equal(mailsFor(p.lea, since).length, 0);
      await notify(new Date(now.getTime() + 2 * MINUTE));
      assert.equal(mailsFor(p.lea, since).length, 1);
    });

    it('R-62 : un message déjà lu n’envoie rien', async () => {
      const now = new Date();
      const s = await scene();
      const conversation = await conversationBetween(s.edition, s.p.lea, s.p.mathis);
      await messageFrom(conversation, s.p.mathis, 'Déjà lu.', { at: minutesAgo(30, now.getTime()), readAt: minutesAgo(20, now.getTime()) });
      const since = espace().outbox().length;
      await notify(now);
      assert.equal(mailsFor(s.p.lea, since).length, 0);
    });

    it('R-62 : la préférence « messages » désactivée n’envoie rien', async () => {
      const now = new Date();
      const { p, conversation } = await unread({ now, prefs: { meetingRequests: true, messages: false, reminders: true } });
      const since = espace().outbox().length;
      await notify(now);
      assert.equal(mailsFor(p.lea, since).length, 0);
      assert.equal((await stored(conversation))[0].emailNotifiedAt ?? null, null);
    });

    it('un destinataire annulé ne reçoit rien', async () => {
      const now = new Date();
      const { p } = await unread({ now, recipient: { status: 'cancelled' } });
      const since = espace().outbox().length;
      await notify(now);
      assert.equal(mailsFor(p.lea, since).length, 0);
    });

    it('NF-52 : une édition dont l’espace est fermé n’envoie rien', async () => {
      const now = new Date();
      const s = await scene({ settings: { participantSpaceEnabled: false } });
      const conversation = await conversationBetween(s.edition, s.p.lea, s.p.mathis);
      await messageFrom(conversation, s.p.mathis, 'Bonjour.', { at: minutesAgo(10, now.getTime()) });
      const since = espace().outbox().length;
      await notify(now);
      assert.equal(mailsFor(s.p.lea, since).length, 0);
    });

    it('les deux participants qui ont chacun un message non lu reçoivent chacun leur e-mail', async () => {
      const now = new Date();
      const s = await scene();
      const conversation = await conversationBetween(s.edition, s.p.lea, s.p.mathis);
      await messageFrom(conversation, s.p.mathis, 'Pour Léa.', { at: minutesAgo(12, now.getTime()) });
      await messageFrom(conversation, s.p.lea, 'Pour Mathis.', { at: minutesAgo(11, now.getTime()) });
      const since = espace().outbox().length;
      await notify(now);
      assert.equal(mailsFor(s.p.lea, since).length, 1);
      assert.equal(mailsFor(s.p.mathis, since).length, 1);
    });

    it('l’e-mail ne porte qu’un extrait de 200 caractères (R-63)', async () => {
      const now = new Date();
      const { p } = await unread({ now, body: `${'a'.repeat(250)}FIN-DU-MESSAGE` });
      const since = espace().outbox().length;
      await notify(now);
      const [mail] = mailsFor(p.lea, since);
      assert.ok(!mail.text.includes('FIN-DU-MESSAGE'));
      assert.ok(!mail.html.includes('FIN-DU-MESSAGE'));
    });
  });
});
