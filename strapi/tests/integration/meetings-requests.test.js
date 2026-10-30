'use strict';

/**
 * Rendez-vous, demandes et consultation (lot 8, tests d'abord) : GET /slots (R-12, F-50, F-53 à F-55), POST /meetings (T-10, T-14,
 * T-18, R-11, R-14, A-33), GET /meetings (F-60 à F-66, A-36), cloisonnement entre éditions et accès sans session (NF-01).
 * Contrats : section 3.2 du plan des phases 2 et 3 (`docs/espace/journal/phase-2-plan.md`).
 *
 * Chaque test crée son édition ou ses personnes : l'état d'un créneau (tables, demandes en attente) ne déborde pas d'un test à l'autre.
 * Les rendez-vous de départ sont écrits par le Document Service ; les sessions viennent du parcours réel (lien de connexion).
 * Un seul démarrage de Strapi pour le fichier.
 *
 *   TESTS_FIRST_STRICT=8 TEST_DATABASE=strapi_l8_test corepack pnpm@12.15.0 --dir <dépôt>/strapi exec node --require ./tests/helpers/no-network.js --test tests/integration/meetings-requests.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { pending } = require('../helpers/pending');
const { SESSION_COOKIE, sleep, useEspace } = require('../helpers/espace');
const { UID } = require('../helpers/espace-data');
const W = require('../helpers/meetings-world');

const NBSP = String.fromCharCode(0xa0);

describe('rendez-vous : demandes et consultation (lot 8)', pending('lot 8', { timeout: 600_000 }), () => {
  const espace = useEspace({ overrides: { ORGANIZER_EMAILS: 'organisation@example.org' } });
  const login = W.useLogin(espace);
  const api = W.useApi(espace);
  const app = () => espace().app;

  const newEdition = (options) => W.createMeetingEdition(app(), { slug: W.unique('rdv'), title: 'Édition d’essai', ...options });
  const person = (edition, fields) => W.createPerson(app(), edition, fields);
  /** Appels de l'API au nom d'une personne (la session vient du parcours de connexion réel). */
  const as = async (edition, who) => api(await login(edition, who));
  const meetingsOf = (edition, filters) => W.meetingsAt(app(), edition, filters);
  const expectError = (response, status, code) => {
    assert.equal(response.status, status, `${response.status} ${response.text}`);
    assert.equal(response.json?.error?.code, code, response.text);
    assert.equal(typeof response.json.error.message, 'string');
    assert.ok(response.json.error.message.length > 0);
  };

  describe('routes du lot 8 et accès sans session (NF-01, A-02)', () => {
    const LOT_8_ROUTES = [
      'GET /api/espace/slots',
      'POST /api/espace/meetings',
      'GET /api/espace/meetings',
      'POST /api/espace/meetings/:x/accept',
      'POST /api/espace/meetings/:x/decline',
      'POST /api/espace/meetings/:x/counter',
      'POST /api/espace/meetings/:x/cancel',
      'GET /api/espace/meetings.ics',
    ];
    const declared = () =>
      espace()
        .app.server.listRoutes()
        .filter((route) => route.path.startsWith('/api/espace'))
        .flatMap((route) => route.methods.filter((method) => method !== 'HEAD').map((method) => `${method} ${route.path.replace(/:[A-Za-z]+/g, ':x')}`));

    it('routes:list montre les huit routes des rendez-vous', () => {
      for (const route of LOT_8_ROUTES) assert.ok(declared().includes(route), `route absente : ${route}`);
    });

    it('aucune autre route sur les créneaux et les rendez-vous : pas de CRUD', () => {
      const extra = declared().filter((route) => /\/api\/espace\/(slots|meetings)/.test(route) && !LOT_8_ROUTES.includes(route));
      assert.deepEqual(extra, []);
    });

    for (const route of LOT_8_ROUTES) {
      const [method, template] = route.split(' ');
      const path = template.replace(':x', 'abc123');
      it(`${route} sans session : 401 UNAUTHENTICATED`, async () => {
        const response = await espace().request(path, { method, json: method === 'POST' ? {} : undefined });
        expectError(response, 401, 'UNAUTHENTICATED');
      });
    }

    it('un cookie dont la signature est fausse : 401', async () => {
      const response = await espace().request('/api/espace/meetings', { cookie: `${SESSION_COOKIE}=fausse.signature` });
      assert.equal(response.status, 401);
    });
  });

  describe('GET /slots : créneaux d’une fiche (R-12, F-50 à F-55)', () => {
    it('mode « request » : 3 pauses, 10 créneaux, tous disponibles, bloc `blocked` et `pending` nuls', async () => {
      const world = await newEdition();
      const [lea, ines] = [await person(world.edition), await person(world.edition)];
      const response = await (await as(world.edition, lea)).get(`/slots?target=p:${ines.documentId}`);
      assert.equal(response.status, 200, response.text);
      const body = response.json;
      assert.equal(body.mode, 'request');
      assert.equal(body.blocked, null);
      assert.equal(body.pending, null);
      assert.equal(body.window.state, 'open');
      assert.deepEqual(body.groups.map((group) => group.session.title), ['Pause et B2B', 'Cocktail déjeunatoire & B2B', 'Pause et B2B']);
      assert.deepEqual(
        body.groups.map((group) => group.slots.map((slot) => slot.label)),
        [['10h45', '11h00'], ['12h30', '12h45', '13h00', '13h15', '13h30', '13h45'], ['15h30', '15h45']]
      );
      const slots = body.groups.flatMap((group) => group.slots);
      assert.equal(slots.length, 10);
      assert.ok(slots.every((slot) => slot.state === 'available'));
    });

    it('forme d’un groupe et d’un créneau : { session: { id, title, start, end }, slots: [{ id, label, startsAt, state }] }', async () => {
      const world = await newEdition();
      const [lea, ines] = [await person(world.edition), await person(world.edition)];
      const { groups } = (await (await as(world.edition, lea)).get(`/slots?target=p:${ines.documentId}`)).json;
      assert.deepEqual(Object.keys(groups[0]).sort(), ['session', 'slots']);
      assert.deepEqual(Object.keys(groups[0].session).sort(), ['end', 'id', 'start', 'title']);
      assert.equal(groups[0].session.start, '10h45');
      assert.equal(groups[0].session.end, '11h15');
      assert.deepEqual(Object.keys(groups[0].slots[0]).sort(), ['id', 'label', 'startsAt', 'state']);
    });

    it('les identifiants de créneau sont des documentId et `startsAt` est l’instant UTC du créneau', async () => {
      const world = await newEdition();
      const [lea, ines] = [await person(world.edition), await person(world.edition)];
      const { groups } = (await (await as(world.edition, lea)).get(`/slots?target=p:${ines.documentId}`)).json;
      const first = groups[0].slots[0];
      assert.equal(first.id, world.slots['10h45'].documentId);
      assert.equal(new Date(first.startsAt).toISOString(), new Date(world.slots['10h45'].startsAt).toISOString());
    });

    it('F-50 : un créneau commencé est absent (édition dont le jour J est passé, fenêtre encore ouverte)', async () => {
      const world = await newEdition({ daysAhead: -1 });
      const [lea, ines] = [await person(world.edition), await person(world.edition)];
      const response = await (await as(world.edition, lea)).get(`/slots?target=p:${ines.documentId}`);
      assert.equal(response.status, 200, response.text);
      assert.deepEqual(response.json.groups, []);
    });

    describe('état d’un créneau pour le visiteur (R-12)', () => {
      it('« unavailable » quand le visiteur est déjà pris sur le créneau', async () => {
        const world = await newEdition();
        const [lea, ines, hugo] = [await person(world.edition), await person(world.edition), await person(world.edition)];
        await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['11h00'], requester: lea, target: hugo, status: 'accepted', tableNumber: 1 });
        const { groups } = (await (await as(world.edition, lea)).get(`/slots?target=p:${ines.documentId}`)).json;
        const states = Object.fromEntries(groups.flatMap((group) => group.slots).map((slot) => [slot.label, slot.state]));
        assert.equal(states['11h00'], 'unavailable');
        assert.equal(states['10h45'], 'available');
      });

      it('« unavailable » quand la cible est prise, sans rien révéler de l’autre partie (R-12)', async () => {
        const world = await newEdition();
        const [lea, ines, hugo] = [await person(world.edition), await person(world.edition, { firstName: 'Inès', lastName: 'Castaing' }), await person(world.edition, { firstName: 'Hugo', lastName: 'Peyrat' })];
        await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['10h45'], requester: hugo, target: ines, status: 'accepted', tableNumber: 1 });
        const response = await (await as(world.edition, lea)).get(`/slots?target=p:${ines.documentId}`);
        const states = Object.fromEntries(response.json.groups.flatMap((group) => group.slots).map((slot) => [slot.label, slot.state]));
        assert.equal(states['10h45'], 'unavailable');
        assert.equal(states['11h00'], 'available');
        assert.ok(!response.text.includes(hugo.documentId) && !response.text.includes('Peyrat'), 'la réponse nomme l’autre partie');
      });

      it('« unavailable » quand toutes les tables du créneau sont prises (R-11.8)', async () => {
        const world = await newEdition();
        const [lea, ines] = [await person(world.edition), await person(world.edition)];
        for (let table = 1; table <= 3; table += 1) {
          await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['12h30'], requester: await person(world.edition), target: await person(world.edition), status: 'accepted', tableNumber: table });
        }
        const { groups } = (await (await as(world.edition, lea)).get(`/slots?target=p:${ines.documentId}`)).json;
        const states = Object.fromEntries(groups.flatMap((group) => group.slots).map((slot) => [slot.label, slot.state]));
        assert.equal(states['12h30'], 'unavailable');
        assert.equal(states['12h45'], 'available');
      });

      it('« requested » et `pending` : le visiteur a une demande en attente à cette cible', async () => {
        const world = await newEdition();
        const [lea, ines] = [await person(world.edition), await person(world.edition)];
        const meeting = await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['10h45'], requester: lea, target: ines });
        const { json } = await (await as(world.edition, lea)).get(`/slots?target=p:${ines.documentId}`);
        const states = Object.fromEntries(json.groups.flatMap((group) => group.slots).map((slot) => [slot.label, slot.state]));
        assert.equal(states['10h45'], 'requested');
        assert.equal(json.pending.meetingId, meeting.documentId);
        assert.match(json.pending.slotLabel, /10h45/);
        assert.deepEqual(Object.keys(json.pending).sort(), ['meetingId', 'slotLabel']);
      });

      it('« confirmed » : un rendez-vous accepté avec cette cible ; `pending` redevient nul', async () => {
        const world = await newEdition();
        const [lea, ines] = [await person(world.edition), await person(world.edition)];
        await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['11h00'], requester: ines, target: lea, status: 'accepted', tableNumber: 1 });
        const { json } = await (await as(world.edition, lea)).get(`/slots?target=p:${ines.documentId}`);
        const states = Object.fromEntries(json.groups.flatMap((group) => group.slots).map((slot) => [slot.label, slot.state]));
        assert.equal(states['11h00'], 'confirmed');
        assert.equal(json.pending, null);
      });
    });

    describe('modes et blocs remplacés (F-53 à F-55, R-19)', () => {
      it('exposant : mode « stand », les tables prises ne comptent pas', async () => {
        const world = await newEdition();
        const lea = await person(world.edition);
        const { exhibitor } = await W.createExhibitor(app(), world.edition, { name: 'Sylvadour', standNumber: '4' });
        await person(world.edition, { role: 'exhibitor_rep', exhibitor: { documentId: exhibitor.documentId } });
        for (let table = 1; table <= 3; table += 1) {
          await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['12h30'], requester: await person(world.edition), target: await person(world.edition), status: 'accepted', tableNumber: table });
        }
        const { json } = await (await as(world.edition, lea)).get(`/slots?target=x:${exhibitor.documentId}`);
        assert.equal(json.mode, 'stand');
        assert.equal(json.blocked, null);
        assert.equal(json.groups.flatMap((group) => group.slots).find((slot) => slot.label === '12h30').state, 'available');
      });

      it('intervenant à table dédiée : mode « booking », même sans meetingsOptIn de l’hôte (R-19.5)', async () => {
        const world = await newEdition();
        const lea = await person(world.edition);
        const host = await person(world.edition, { role: 'speaker', hostedTableNumber: 2, meetingsOptIn: false, directoryOptIn: false });
        const { json } = await (await as(world.edition, lea)).get(`/slots?target=p:${host.documentId}`);
        assert.equal(json.mode, 'booking');
        assert.equal(json.blocked, null);
      });

      it('table dédiée : le créneau déjà réservé est « unavailable »', async () => {
        const world = await newEdition();
        const [lea, other] = [await person(world.edition), await person(world.edition)];
        const host = await person(world.edition, { role: 'speaker', hostedTableNumber: 2, meetingsOptIn: false });
        await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['10h45'], requester: other, target: host, status: 'accepted', tableNumber: 2 });
        const { json } = await (await as(world.edition, lea)).get(`/slots?target=p:${host.documentId}`);
        const states = Object.fromEntries(json.groups.flatMap((group) => group.slots).map((slot) => [slot.label, slot.state]));
        assert.equal(states['10h45'], 'unavailable');
        assert.equal(states['11h00'], 'available');
      });

      it('F-54 : sa propre fiche, `blocked.code` SELF', async () => {
        const world = await newEdition();
        const lea = await person(world.edition);
        const { json } = await (await as(world.edition, lea)).get(`/slots?target=p:${lea.documentId}`);
        assert.equal(json.blocked.code, 'SELF');
        assert.equal(typeof json.blocked.message, 'string');
        assert.ok(json.blocked.message.length > 0);
        assert.deepEqual(Object.keys(json.blocked).sort(), ['code', 'message']);
      });

      it('F-53 : une cible sans meetingsOptIn, `blocked.code` TARGET_UNAVAILABLE', async () => {
        const world = await newEdition();
        const [lea, hugo] = [await person(world.edition), await person(world.edition, { meetingsOptIn: false })];
        const { json } = await (await as(world.edition, lea)).get(`/slots?target=p:${hugo.documentId}`);
        assert.equal(json.blocked.code, 'TARGET_UNAVAILABLE');
      });

      it('R-19.3 : un intervenant à table dédiée qui consulte une fiche, `blocked.code` HOST_AT_TABLE', async () => {
        const world = await newEdition();
        const [ines, host] = [await person(world.edition), await person(world.edition, { role: 'speaker', hostedTableNumber: 2, meetingsOptIn: false })];
        const { json } = await (await as(world.edition, host)).get(`/slots?target=p:${ines.documentId}`);
        assert.equal(json.blocked.code, 'HOST_AT_TABLE');
      });

      it('F-55 : fenêtre fermée, `blocked.code` WINDOW_CLOSED et `window.state` « closed »', async () => {
        const world = await newEdition({ window: 'closed' });
        const [lea, ines] = [await person(world.edition), await person(world.edition)];
        const { json } = await (await as(world.edition, lea)).get(`/slots?target=p:${ines.documentId}`);
        assert.equal(json.blocked.code, 'WINDOW_CLOSED');
        assert.equal(json.window.state, 'closed');
      });

      it('F-55 : fenêtre pas encore ouverte, `blocked.code` WINDOW_CLOSED et `window.state` « not_open »', async () => {
        const world = await newEdition({ window: 'not_open' });
        const [lea, ines] = [await person(world.edition), await person(world.edition)];
        const { json } = await (await as(world.edition, lea)).get(`/slots?target=p:${ines.documentId}`);
        assert.equal(json.blocked.code, 'WINDOW_CLOSED');
        assert.equal(json.window.state, 'not_open');
      });
    });

    describe('erreurs', () => {
      it('`target` absent ou mal formé : 400 VALIDATION', async () => {
        const world = await newEdition();
        const lea = await as(world.edition, await person(world.edition));
        for (const query of ['', '?target=', '?target=zzz', '?target=p:', '?target=q:abc', '?target=p:a:b']) {
          expectError(await lea.get(`/slots${query}`), 400, 'VALIDATION');
        }
      });

      it('cible inconnue : 404 TARGET_NOT_FOUND', async () => {
        const world = await newEdition();
        const lea = await as(world.edition, await person(world.edition));
        expectError(await lea.get('/slots?target=p:inconnu0000000000000000'), 404, 'TARGET_NOT_FOUND');
        expectError(await lea.get('/slots?target=x:inconnu0000000000000000'), 404, 'TARGET_NOT_FOUND');
      });

      it('cible d’une autre édition : 404 TARGET_NOT_FOUND (NF-01)', async () => {
        const [mine, theirs] = [await newEdition(), await newEdition()];
        const lea = await as(mine.edition, await person(mine.edition));
        const stranger = await person(theirs.edition);
        const { exhibitor } = await W.createExhibitor(app(), theirs.edition, { name: 'Ailleurs' });
        expectError(await lea.get(`/slots?target=p:${stranger.documentId}`), 404, 'TARGET_NOT_FOUND');
        expectError(await lea.get(`/slots?target=x:${exhibitor.documentId}`), 404, 'TARGET_NOT_FOUND');
      });
    });
  });

  describe('POST /meetings : créer une demande (T-10, T-14, T-18, R-11, R-14, A-33)', () => {
    const ask = async (world, requester, target, label = '10h45', body = {}) =>
      (await as(world.edition, requester)).post('/meetings', {
        slotId: world.slots[label].documentId,
        target: typeof target === 'string' ? target : `p:${target.documentId}`,
        ...body,
      });
    const linkAfter = (text, label) => new RegExp(`${label}[\\s${NBSP}]*:[\\s${NBSP}]*(https?://\\S+)`).exec(text)?.[1];
    const mailTo = (attendee) => W.outboxTo(espace, attendee.email).at(-1);

    describe('T-14 : une demande valable', () => {
      const setup = async () => {
        const world = await newEdition();
        const lea = await person(world.edition, { firstName: 'Léa', lastName: 'Ducasse', jobTitle: 'Cheffe de projet', company: 'Atelier Fictif' });
        const ines = await person(world.edition, { firstName: 'Inès', lastName: 'Castaing' });
        return { world, lea, ines };
      };

      it('répond 201 avec un Meeting `pending`, vu du demandeur (direction « sent »)', async () => {
        const { world, lea, ines } = await setup();
        const response = await ask(world, lea, ines, '10h45', { message: 'Bonjour Inès, échangeons sur la construction bois.' });
        assert.equal(response.status, 201, response.text);
        const meeting = response.json;
        assert.deepEqual(Object.keys(meeting).sort(), W.MEETING_KEYS);
        assert.equal(meeting.status, 'pending');
        assert.equal(meeting.direction, 'sent');
        assert.equal(meeting.location, null);
        assert.equal(meeting.message, 'Bonjour Inès, échangeons sur la construction bois.');
        assert.equal(meeting.viaExhibitor, null);
        assert.equal(meeting.answeredByName ?? null, null);
        assert.deepEqual([meeting.canAccept, meeting.canDecline, meeting.canCounter, meeting.canCancel], [false, false, false, true]);
        assert.ok(!Number.isNaN(Date.parse(meeting.createdAt)));
      });

      it('porte le créneau { id, label, startsAt, endsAt, sessionTitle } et la cible en contrepartie', async () => {
        const { world, lea, ines } = await setup();
        const { json } = await ask(world, lea, ines, '12h30');
        assert.deepEqual(Object.keys(json.slot).sort(), ['endsAt', 'id', 'label', 'sessionTitle', 'startsAt']);
        assert.equal(json.slot.id, world.slots['12h30'].documentId);
        assert.equal(json.slot.label, '12h30');
        assert.equal(json.slot.sessionTitle, 'Cocktail déjeunatoire & B2B');
        assert.equal(new Date(json.slot.endsAt) - new Date(json.slot.startsAt), 15 * 60_000);
        assert.equal(json.counterpart.kind, 'attendee');
        assert.equal(json.counterpart.id, ines.documentId);
        assert.equal(json.counterpart.displayName, 'Inès Castaing');
        assert.equal(json.id.length > 10, true);
      });

      it('écrit en base une seule demande `pending`, du bon demandeur vers la bonne cible, sans table', async () => {
        const { world, lea, ines } = await setup();
        const { json } = await ask(world, lea, ines);
        const rows = await meetingsOf(world.edition);
        assert.equal(rows.length, 1);
        const [row] = rows;
        assert.equal(row.documentId, json.id);
        assert.equal(row.status, 'pending');
        assert.equal(row.requester.documentId, lea.documentId);
        assert.equal(row.targetAttendee.documentId, ines.documentId);
        assert.equal(row.targetExhibitor ?? null, null);
        assert.equal(row.slot.documentId, world.slots['10h45'].documentId);
        assert.equal(row.tableKey ?? null, null);
        assert.equal(row.tableNumber ?? null, null);
      });

      it('le demandeur vient de la session, jamais du corps de la requête (NF-01)', async () => {
        const { world, lea, ines } = await setup();
        const intruder = await person(world.edition);
        const { json } = await ask(world, lea, ines, '10h45', { requester: intruder.documentId, requesterId: intruder.documentId });
        assert.equal(json.direction, 'sent');
        const [row] = await meetingsOf(world.edition);
        assert.equal(row.requester.documentId, lea.documentId);
      });

      it('sans message : le message est vide', async () => {
        const { world, lea, ines } = await setup();
        const { json } = await ask(world, lea, ines);
        assert.ok(!json.message);
      });

      it('T-10 : un participant qui n’a rien coché (ni annuaire, ni rendez-vous) peut demander', async () => {
        const world = await newEdition();
        const newcomer = await person(world.edition, { directoryOptIn: false, meetingsOptIn: false });
        const ines = await person(world.edition);
        assert.equal((await ask(world, newcomer, ines)).status, 201);
      });

      it('aucune adresse e-mail ni identifiant HelloAsso dans la réponse (R-42)', async () => {
        const { world, lea, ines } = await setup();
        assert.deepEqual(W.leaks((await ask(world, lea, ines)).text), []);
      });
    });

    describe('e-mail meeting-request à la cible (T-14, F-52, A-33)', () => {
      it('un e-mail part à la cible, jamais au demandeur ; EmailLog `meeting-request`', async () => {
        const world = await newEdition();
        const [lea, ines] = [await person(world.edition, { firstName: 'Léa', lastName: 'Ducasse' }), await person(world.edition, { firstName: 'Inès', lastName: 'Castaing' })];
        await ask(world, lea, ines, '10h45', { message: 'Bonjour Inès, échangeons sur la construction bois.' });
        await W.waitForEmailLogs(app(), ines, 'meeting-request');
        const sent = await W.settledEmailLogs(app(), lea, 'meeting-request');
        assert.equal(sent.length, 0, 'le demandeur reçoit sa propre demande');
        const mail = mailTo(ines);
        assert.ok(mail.text.includes('Léa Ducasse'), 'le demandeur est nommé');
        assert.ok(mail.text.includes('Bonjour Inès, échangeons sur la construction bois.'), 'le message est reproduit');
        assert.ok(mail.text.includes('10h45'), 'le créneau est indiqué');
      });

      it('le bouton « Accepter » porte son propre lien d’action de 72 heures vers l’agenda, avec la demande en évidence (I-21, A-33)', async () => {
        const world = await newEdition();
        const [lea, ines] = [await person(world.edition), await person(world.edition)];
        const { json } = await ask(world, lea, ines);
        await W.waitForEmailLogs(app(), ines, 'meeting-request');
        const accept = linkAfter(mailTo(ines).text, 'Accepter');
        const view = linkAfter(mailTo(ines).text, 'Voir la demande');
        assert.ok(accept && view, 'liens « Accepter » et « Voir la demande » absents du texte');
        assert.notEqual(accept, view, 'chaque bouton a son propre lien');
        for (const url of [accept, view]) {
          const parsed = new URL(url);
          assert.equal(parsed.pathname, '/espace/verifier');
          assert.equal(parsed.searchParams.get('next'), `/espace/${world.edition.slug}/agenda?demande=${json.id}`);
        }
        const tokens = (await app().db.query(UID.magicToken).findMany({ where: { attendee: { documentId: ines.documentId }, kind: 'link' } })).filter(
          (row) => Math.abs(new Date(row.expiresAt).getTime() - (Date.now() + 72 * 3_600_000)) < 10 * 60_000
        );
        assert.ok(tokens.length >= 2, `${tokens.length} lien(s) de 72 heures pour ${ines.email}`);
      });

      it('Q-13 : ouvrir le lien « Accepter » ne modifie pas la demande (aucune action par GET)', async () => {
        const world = await newEdition();
        const [lea, ines] = [await person(world.edition), await person(world.edition)];
        const { json } = await ask(world, lea, ines);
        await W.waitForEmailLogs(app(), ines, 'meeting-request');
        const token = new URL(linkAfter(mailTo(ines).text, 'Accepter')).searchParams.get('token');
        const state = await espace().request(`/api/espace/auth/link?token=${token}`);
        assert.equal(state.json.valid, true);
        const [row] = await meetingsOf(world.edition);
        assert.equal(row.documentId, json.id);
        assert.equal(row.status, 'pending');
      });

      it('préférence meetingRequests désactivée : la demande est créée, aucun e-mail', async () => {
        const world = await newEdition();
        const lea = await person(world.edition);
        const ines = await person(world.edition, { emailPrefs: { meetingRequests: false, messages: true, reminders: true } });
        assert.equal((await ask(world, lea, ines)).status, 201);
        const logs = await W.settledEmailLogs(app(), ines, 'meeting-request');
        assert.equal(logs.length, 0);
        assert.equal((await meetingsOf(world.edition)).length, 1);
      });

      it('le message du demandeur est échappé dans l’e-mail (NF-05)', async () => {
        const world = await newEdition();
        const [lea, ines] = [await person(world.edition), await person(world.edition)];
        await ask(world, lea, ines, '10h45', { message: '<script>alert(1)</script>' });
        await W.waitForEmailLogs(app(), ines, 'meeting-request');
        assert.ok(!mailTo(ines).html.includes('<script>alert(1)'));
      });

      it('exposant : chaque représentant actif qui a gardé meetingRequests reçoit l’e-mail, pas les autres', async () => {
        const world = await newEdition();
        const lea = await person(world.edition);
        const { exhibitor } = await W.createExhibitor(app(), world.edition, { name: 'Sylvadour', standNumber: '4' });
        const rep = (fields) => person(world.edition, { role: 'exhibitor_rep', exhibitor: { documentId: exhibitor.documentId }, ...fields });
        const [r1, r2, r3] = [await rep({}), await rep({ emailPrefs: { meetingRequests: false, messages: true, reminders: true } }), await rep({ status: 'cancelled' })];
        const { json } = await ask(world, lea, `x:${exhibitor.documentId}`);
        assert.equal(json.counterpart.kind, 'exhibitor');
        assert.equal(json.counterpart.id, exhibitor.documentId);
        await W.waitForEmailLogs(app(), r1, 'meeting-request');
        assert.equal((await W.settledEmailLogs(app(), r2, 'meeting-request')).length, 0, 'préférence désactivée');
        assert.equal((await W.emailLogs(app(), r3, 'meeting-request')).length, 0, 'représentant annulé');
      });
    });

    describe('vers un exposant (R-14, F-57)', () => {
      it('201 : cible exposant en base, aucune personne ciblée, `viaExhibitor` nul pour le demandeur', async () => {
        const world = await newEdition();
        const lea = await person(world.edition);
        const { exhibitor } = await W.createExhibitor(app(), world.edition, { name: 'Sylvadour', standNumber: '4' });
        await person(world.edition, { role: 'exhibitor_rep', exhibitor: { documentId: exhibitor.documentId } });
        const response = await ask(world, lea, `x:${exhibitor.documentId}`, '11h00');
        assert.equal(response.status, 201, response.text);
        assert.equal(response.json.viaExhibitor, null);
        assert.equal(response.json.counterpart.standNumber, '4');
        const [row] = await meetingsOf(world.edition);
        assert.equal(row.targetExhibitor.documentId, exhibitor.documentId);
        assert.equal(row.targetAttendee ?? null, null);
      });

      it('T-19 : exposant à 2 représentants, deux rendez-vous acceptés au créneau, la troisième demande est refusée TARGET_BUSY', async () => {
        const world = await newEdition();
        const { exhibitor } = await W.createExhibitor(app(), world.edition, { name: 'Sylvadour', standNumber: '4' });
        const reps = [];
        for (let index = 0; index < 2; index += 1) reps.push(await person(world.edition, { role: 'exhibitor_rep', exhibitor: { documentId: exhibitor.documentId } }));
        const visitors = [await person(world.edition), await person(world.edition), await person(world.edition)];
        for (const visitor of visitors.slice(0, 2)) {
          await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['10h45'], requester: visitor, exhibitor, status: 'accepted', answeredBy: reps[0] });
        }
        expectError(await ask(world, visitors[2], `x:${exhibitor.documentId}`, '10h45'), 409, 'TARGET_BUSY');
        assert.equal((await ask(world, visitors[2], `x:${exhibitor.documentId}`, '11h00')).status, 201, 'un autre créneau reste libre');
      });

      it('R-14 : un seul rendez-vous accepté sur deux représentants laisse la place à une nouvelle demande', async () => {
        const world = await newEdition();
        const { exhibitor } = await W.createExhibitor(app(), world.edition, { name: 'Sylvadour', standNumber: '4' });
        const rep = (await person(world.edition, { role: 'exhibitor_rep', exhibitor: { documentId: exhibitor.documentId } }));
        await person(world.edition, { role: 'exhibitor_rep', exhibitor: { documentId: exhibitor.documentId } });
        const [first, second] = [await person(world.edition), await person(world.edition)];
        await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['10h45'], requester: first, exhibitor, status: 'accepted', answeredBy: rep });
        assert.equal((await ask(world, second, `x:${exhibitor.documentId}`, '10h45')).status, 201);
      });
    });

    describe('400 et 404 : corps de la requête et références', () => {
      const send = async (world, who, body) => (await as(world.edition, who)).post('/meetings', body);

      it('400 VALIDATION : message de plus de 300 caractères, avec `error.fields` ; 300 caractères passent', async () => {
        const world = await newEdition();
        const [lea, ines] = [await person(world.edition), await person(world.edition)];
        const tooLong = await ask(world, lea, ines, '10h45', { message: 'x'.repeat(301) });
        expectError(tooLong, 400, 'VALIDATION');
        assert.equal(typeof tooLong.json.error.fields, 'object');
        assert.equal((await meetingsOf(world.edition)).length, 0);
        assert.equal((await ask(world, lea, ines, '10h45', { message: 'x'.repeat(300) })).status, 201);
      });

      it('400 VALIDATION : message qui n’est pas un texte', async () => {
        const world = await newEdition();
        const [lea, ines] = [await person(world.edition), await person(world.edition)];
        for (const message of [42, true, {}, ['a']]) expectError(await ask(world, lea, ines, '10h45', { message }), 400, 'VALIDATION');
      });

      it('400 VALIDATION : cible absente ou mal formée', async () => {
        const world = await newEdition();
        const lea = await person(world.edition);
        const slotId = world.slots['10h45'].documentId;
        for (const target of [undefined, null, '', 'zzz', 'p:', 'x:', 'q:abc', 'p:a:b', 42, { kind: 'p' }]) {
          expectError(await send(world, lea, { slotId, target }), 400, 'VALIDATION');
        }
      });

      it('400 VALIDATION : créneau absent ou qui n’est pas un texte', async () => {
        const world = await newEdition();
        const [lea, ines] = [await person(world.edition), await person(world.edition)];
        for (const slotId of [undefined, null, '', 42, {}]) expectError(await send(world, lea, { slotId, target: `p:${ines.documentId}` }), 400, 'VALIDATION');
      });

      it('400 VALIDATION : corps qui n’est pas un objet', async () => {
        const world = await newEdition();
        const lea = await person(world.edition);
        expectError(await send(world, lea, []), 400, 'VALIDATION');
      });

      it('404 SLOT_NOT_FOUND : créneau inconnu, ou créneau d’une autre édition (NF-01)', async () => {
        const [mine, theirs] = [await newEdition(), await newEdition()];
        const [lea, ines] = [await person(mine.edition), await person(mine.edition)];
        const target = `p:${ines.documentId}`;
        expectError(await send(mine, lea, { slotId: 'inconnu0000000000000000', target }), 404, 'SLOT_NOT_FOUND');
        expectError(await send(mine, lea, { slotId: theirs.slots['10h45'].documentId, target }), 404, 'SLOT_NOT_FOUND');
        assert.equal((await meetingsOf(mine.edition)).length, 0);
      });

      it('404 TARGET_NOT_FOUND : personne ou exposant inconnu, ou d’une autre édition (NF-01)', async () => {
        const [mine, theirs] = [await newEdition(), await newEdition()];
        const lea = await person(mine.edition);
        const stranger = await person(theirs.edition);
        const { exhibitor } = await W.createExhibitor(app(), theirs.edition, { name: 'Ailleurs' });
        for (const target of ['p:inconnu0000000000000000', 'x:inconnu0000000000000000', `p:${stranger.documentId}`, `x:${exhibitor.documentId}`]) {
          expectError(await ask(mine, lea, target), 404, 'TARGET_NOT_FOUND');
        }
        assert.equal((await meetingsOf(mine.edition)).length, 0);
      });
    });

    describe('409 : un code stable par condition (R-11)', () => {
      it('R-11.1 WINDOW_CLOSED : fenêtre fermée, puis pas encore ouverte', async () => {
        for (const window of ['closed', 'not_open']) {
          const world = await newEdition({ window });
          const [lea, ines] = [await person(world.edition), await person(world.edition)];
          expectError(await ask(world, lea, ines), 409, 'WINDOW_CLOSED');
          assert.equal((await meetingsOf(world.edition)).length, 0, window);
        }
      });

      it('R-11.2 SLOT_PAST : le créneau a commencé (jour J passé, fenêtre encore ouverte)', async () => {
        const world = await newEdition({ daysAhead: -1 });
        const [lea, ines] = [await person(world.edition), await person(world.edition)];
        expectError(await ask(world, lea, ines), 409, 'SLOT_PAST');
      });

      it('R-19.3 HOST_AT_TABLE : l’intervenant à table dédiée n’envoie pas de demande', async () => {
        const world = await newEdition();
        const [host, ines] = [await person(world.edition, { role: 'speaker', hostedTableNumber: 2, meetingsOptIn: false }), await person(world.edition)];
        expectError(await ask(world, host, ines), 409, 'HOST_AT_TABLE');
      });

      describe('R-11.3 et R-11.4 TARGET_UNAVAILABLE', () => {
        it('soi-même', async () => {
          const world = await newEdition();
          const lea = await person(world.edition);
          expectError(await ask(world, lea, lea), 409, 'TARGET_UNAVAILABLE');
        });

        it('un représentant visant son propre exposant', async () => {
          const world = await newEdition();
          const { exhibitor } = await W.createExhibitor(app(), world.edition, { name: 'Sylvadour' });
          const rep = await person(world.edition, { role: 'exhibitor_rep', exhibitor: { documentId: exhibitor.documentId } });
          expectError(await ask(world, rep, `x:${exhibitor.documentId}`), 409, 'TARGET_UNAVAILABLE');
        });

        for (const [label, fields] of [
          ['un organisateur', { role: 'organizer' }],
          ['une inscription annulée', { status: 'cancelled' }],
          ['une personne sans meetingsOptIn', { meetingsOptIn: false }],
        ]) {
          it(label, async () => {
            const world = await newEdition();
            const [lea, target] = [await person(world.edition), await person(world.edition, fields)];
            expectError(await ask(world, lea, target), 409, 'TARGET_UNAVAILABLE');
          });
        }

        it('un exposant sans représentant actif', async () => {
          const world = await newEdition();
          const lea = await person(world.edition);
          const { exhibitor } = await W.createExhibitor(app(), world.edition, { name: 'Sylvadour' });
          await person(world.edition, { role: 'exhibitor_rep', exhibitor: { documentId: exhibitor.documentId }, status: 'cancelled' });
          expectError(await ask(world, lea, `x:${exhibitor.documentId}`), 409, 'TARGET_UNAVAILABLE');
        });
      });

      it('T-18 · R-11.5 SLOT_TAKEN : le demandeur a déjà un rendez-vous accepté sur ce créneau', async () => {
        const world = await newEdition();
        const [lea, ines, hugo] = [await person(world.edition), await person(world.edition), await person(world.edition)];
        await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['10h45'], requester: hugo, target: lea, status: 'accepted', tableNumber: 1 });
        expectError(await ask(world, lea, ines, '10h45'), 409, 'SLOT_TAKEN');
        assert.equal((await ask(world, lea, ines, '11h00')).status, 201, 'un autre créneau reste possible');
      });

      it('R-11.5 SLOT_TAKEN : le demandeur a déjà une demande en attente sur ce créneau', async () => {
        const world = await newEdition();
        const [lea, ines, hugo] = [await person(world.edition), await person(world.edition), await person(world.edition)];
        assert.equal((await ask(world, lea, hugo, '10h45')).status, 201);
        expectError(await ask(world, lea, ines, '10h45'), 409, 'SLOT_TAKEN');
      });

      it('R-11.6 TARGET_BUSY : la cible a un rendez-vous accepté sur ce créneau, sans que le message nomme l’autre partie (R-12)', async () => {
        const world = await newEdition();
        const [lea, ines] = [await person(world.edition), await person(world.edition)];
        const hugo = await person(world.edition, { firstName: 'Hugo', lastName: 'Peyrat' });
        await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['10h45'], requester: hugo, target: ines, status: 'accepted', tableNumber: 1 });
        const response = await ask(world, lea, ines, '10h45');
        expectError(response, 409, 'TARGET_BUSY');
        assert.ok(!response.text.includes('Peyrat') && !response.text.includes(hugo.documentId), 'la réponse nomme l’autre partie');
      });

      it('R-11.7 ALREADY_REQUESTED : une seule demande en attente entre deux parties, dans les deux sens', async () => {
        const world = await newEdition();
        const [lea, ines] = [await person(world.edition), await person(world.edition)];
        assert.equal((await ask(world, lea, ines, '10h45')).status, 201);
        expectError(await ask(world, lea, ines, '11h00'), 409, 'ALREADY_REQUESTED');
        expectError(await ask(world, ines, lea, '11h00'), 409, 'ALREADY_REQUESTED');
        assert.equal((await meetingsOf(world.edition)).length, 1);
      });

      it('R-11.7 ALREADY_REQUESTED : vers un exposant aussi', async () => {
        const world = await newEdition();
        const lea = await person(world.edition);
        const { exhibitor } = await W.createExhibitor(app(), world.edition, { name: 'Sylvadour' });
        await person(world.edition, { role: 'exhibitor_rep', exhibitor: { documentId: exhibitor.documentId } });
        assert.equal((await ask(world, lea, `x:${exhibitor.documentId}`, '10h45')).status, 201);
        expectError(await ask(world, lea, `x:${exhibitor.documentId}`, '11h00'), 409, 'ALREADY_REQUESTED');
      });

      it('R-11.8 NO_TABLE_LEFT : les trois tables du créneau sont prises ; un stand reste demandable (R-03)', async () => {
        const world = await newEdition();
        const [lea, ines] = [await person(world.edition), await person(world.edition)];
        const { exhibitor } = await W.createExhibitor(app(), world.edition, { name: 'Sylvadour' });
        await person(world.edition, { role: 'exhibitor_rep', exhibitor: { documentId: exhibitor.documentId } });
        for (let table = 1; table <= 3; table += 1) {
          await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['12h30'], requester: await person(world.edition), target: await person(world.edition), status: 'accepted', tableNumber: table });
        }
        expectError(await ask(world, lea, ines, '12h30'), 409, 'NO_TABLE_LEFT');
        assert.equal((await ask(world, lea, `x:${exhibitor.documentId}`, '12h30')).status, 201);
      });

      it('T-26 côté demande · R-03 : table 2 dédiée, tables 1 et 3 prises, plus de table pour un 1-to-1', async () => {
        const world = await newEdition();
        const [lea, ines] = [await person(world.edition), await person(world.edition)];
        await person(world.edition, { role: 'speaker', hostedTableNumber: 2, meetingsOptIn: false });
        for (const table of [1, 3]) {
          await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['10h45'], requester: await person(world.edition), target: await person(world.edition), status: 'accepted', tableNumber: table });
        }
        expectError(await ask(world, lea, ines, '10h45'), 409, 'NO_TABLE_LEFT');
      });

      it('R-11.9 TOO_MANY_PENDING : dix demandes en attente au plus (la dixième passe, la onzième est refusée)', async () => {
        const world = await newEdition({ sequences: [{ title: 'Grande pause B2B', start_time: '10h00', end_time: '13h00', kind: 'b2b_break' }] });
        const labels = Object.keys(world.slots);
        assert.ok(labels.length >= 11, `${labels.length} créneaux`);
        const lea = await person(world.edition);
        for (let index = 0; index < 9; index += 1) {
          await W.seedMeeting(app(), { edition: world.edition, slot: world.slots[labels[index]], requester: lea, target: await person(world.edition) });
        }
        assert.equal((await ask(world, lea, await person(world.edition), labels[9])).status, 201, 'la dixième demande en attente passe');
        expectError(await ask(world, lea, await person(world.edition), labels[10]), 409, 'TOO_MANY_PENDING');
      });

      it('les 409 ne créent aucune demande et ne contiennent ni e-mail ni identifiant HelloAsso', async () => {
        const world = await newEdition({ window: 'closed' });
        const [lea, ines] = [await person(world.edition), await person(world.edition)];
        const response = await ask(world, lea, ines);
        assert.equal(response.status, 409);
        assert.deepEqual(W.leaks(response.text), []);
        assert.equal((await meetingsOf(world.edition)).length, 0);
        assert.equal((await W.settledEmailLogs(app(), ines, 'meeting-request', { settleMs: 200 })).length, 0);
      });
    });
  });

  describe('GET /meetings : agenda, demandes et historique (F-60 à F-66, A-36)', () => {
    const SEQUENCES = [...W.recette.sequences, { title: 'Séquence sans horaire', start_time: '--', kind: 'other' }];
    const NAMES = { lea: ['Léa', 'Ducasse'], ines: ['Inès', 'Castaing'], mathis: ['Mathis', 'Lagrange'], helene: ['Hélène', 'Marquès'], jules: ['Jules', 'Mazères'], eva: ['Éva', 'Cazaux'], hugo: ['Hugo', 'Peyrat'] };
    /** Édition, sept personnes et les rendez-vous de départ de Léa : reçu d’Inès, envoyé à Hélène, accepté avec Mathis, trois clos. */
    async function scene({ withMeetings = true } = {}) {
      const world = await newEdition({ sequences: SEQUENCES });
      const people = {};
      for (const [key, [firstName, lastName]] of Object.entries(NAMES)) people[key] = await person(world.edition, { firstName, lastName, jobTitle: 'Fonction fictive', company: 'Entreprise Fictive' });
      if (withMeetings) {
        const seed = (fields) => W.seedMeeting(app(), { edition: world.edition, ...fields });
        people.received = await seed({ slot: world.slots['10h45'], requester: people.ines, target: people.lea, message: 'Bonjour Léa, échangeons sur la construction bois.' });
        people.sent = await seed({ slot: world.slots['15h30'], requester: people.lea, target: people.helene });
        people.accepted = await seed({ slot: world.slots['12h30'], requester: people.lea, target: people.mathis, status: 'accepted', tableNumber: 1, answeredBy: people.mathis });
        people.declined = await seed({ slot: world.slots['13h00'], requester: people.jules, target: people.lea, status: 'declined', answeredBy: people.lea });
        people.cancelled = await seed({ slot: world.slots['13h15'], requester: people.eva, target: people.lea, status: 'cancelled' });
        people.expired = await seed({ slot: world.slots['13h30'], requester: people.hugo, target: people.lea, status: 'expired' });
      }
      return { world, ...people };
    }
    const listOf = async (world, who) => (await (await as(world.edition, who)).get('/meetings')).json;

    it('un participant sans rendez-vous : listes vides, agenda réduit au programme (F-66)', async () => {
      const { world, lea } = await scene({ withMeetings: false });
      const body = await listOf(world, lea);
      assert.deepEqual(Object.keys(body).sort(), ['agenda', 'closed', 'received', 'sent']);
      assert.deepEqual([body.received, body.sent, body.closed], [[], [], []]);
      assert.ok(body.agenda.length > 0);
      assert.ok(body.agenda.every((item) => item.type === 'session'));
    });

    describe('demandes reçues et envoyées', () => {
      it('`received` : les demandes en attente que Léa a reçues, vues du côté de la cible', async () => {
        const { world, lea, ines, received } = await scene();
        const body = await listOf(world, lea);
        assert.deepEqual(body.received.map((meeting) => meeting.id), [received.documentId]);
        const [meeting] = body.received;
        assert.deepEqual(Object.keys(meeting).sort(), W.MEETING_KEYS);
        assert.equal(meeting.status, 'pending');
        assert.equal(meeting.direction, 'received');
        assert.equal(meeting.counterpart.id, ines.documentId);
        assert.equal(meeting.counterpart.displayName, 'Inès Castaing');
        assert.equal(meeting.message, 'Bonjour Léa, échangeons sur la construction bois.');
        assert.deepEqual([meeting.canAccept, meeting.canDecline, meeting.canCounter, meeting.canCancel], [true, true, true, false]);
        assert.equal(meeting.slot.label, '10h45');
      });

      it('`sent` : les demandes en attente que Léa a envoyées', async () => {
        const { world, lea, helene, sent } = await scene();
        const body = await listOf(world, lea);
        assert.deepEqual(body.sent.map((meeting) => meeting.id), [sent.documentId]);
        const [meeting] = body.sent;
        assert.equal(meeting.direction, 'sent');
        assert.equal(meeting.counterpart.id, helene.documentId);
        assert.deepEqual([meeting.canAccept, meeting.canDecline, meeting.canCounter, meeting.canCancel], [false, false, false, true]);
      });

      it('la même demande vue de l’autre côté : Inès la voit en `sent`, Hélène en `received`', async () => {
        const { world, ines, helene, received, sent } = await scene();
        assert.deepEqual((await listOf(world, ines)).sent.map((meeting) => meeting.id), [received.documentId]);
        assert.deepEqual((await listOf(world, helene)).received.map((meeting) => meeting.id), [sent.documentId]);
      });
    });

    describe('agenda : séquences et rendez-vous, trié par heure', () => {
      it('mêle les séquences à heure lisible, les rendez-vous acceptés et les demandes envoyées ; pas les demandes reçues ni les clos', async () => {
        const { world, lea, accepted, sent, received, declined } = await scene();
        const { agenda } = await listOf(world, lea);
        const meetings = agenda.filter((item) => item.type === 'meeting');
        assert.deepEqual(meetings.map((item) => item.meeting.id).sort(), [accepted.documentId, sent.documentId].sort());
        assert.ok(!agenda.some((item) => item.type === 'meeting' && [received.documentId, declined.documentId].includes(item.meeting.id)));
        assert.equal(agenda.filter((item) => item.type === 'session').length, 9, 'neuf séquences à heure lisible, la dixième (« -- ») est écartée');
        assert.ok(!agenda.some((item) => item.title === 'Séquence sans horaire'));
      });

      it('est trié par heure de début', async () => {
        const { world, lea } = await scene();
        const { agenda } = await listOf(world, lea);
        const times = agenda.map((item) => new Date(item.startsAt).getTime());
        assert.deepEqual(times, [...times].sort((a, b) => a - b));
      });

      it('une séquence : { type, id, title, start, end, startsAt, endsAt, kind }, heures de Paris', async () => {
        const { world, lea } = await scene({ withMeetings: false });
        const { agenda } = await listOf(world, lea);
        const opening = agenda.find((item) => item.title === 'Accueil et ouverture');
        assert.deepEqual(Object.keys(opening).sort(), ['end', 'endsAt', 'id', 'kind', 'start', 'startsAt', 'title', 'type']);
        assert.equal(opening.start, '9h15');
        assert.equal(opening.end, '9h45');
        assert.equal(opening.kind, 'other');
        const { zonedToUtc } = require('../../src/api/espace/lib/time');
        assert.equal(new Date(opening.startsAt).toISOString(), zonedToUtc(world.edition.date, { hours: 9, minutes: 15 }).toISOString());
        assert.equal(new Date(opening.endsAt).toISOString(), zonedToUtc(world.edition.date, { hours: 9, minutes: 45 }).toISOString());
      });

      it('un rendez-vous : { type, startsAt, meeting } où startsAt est le début du créneau', async () => {
        const { world, lea, accepted } = await scene();
        const { agenda } = await listOf(world, lea);
        const item = agenda.find((entry) => entry.type === 'meeting' && entry.meeting.id === accepted.documentId);
        assert.deepEqual(Object.keys(item).sort(), ['meeting', 'startsAt', 'type']);
        assert.equal(new Date(item.startsAt).toISOString(), new Date(world.slots['12h30'].startsAt).toISOString());
        assert.equal(item.meeting.location, 'Table 1');
        assert.equal(item.meeting.status, 'accepted');
        assert.equal(item.meeting.counterpart.displayName, 'Mathis Lagrange');
        assert.deepEqual([item.meeting.canAccept, item.meeting.canDecline, item.meeting.canCounter, item.meeting.canCancel], [false, false, false, true]);
      });
    });

    describe('historique `closed` : refusés, annulés, expirés, 20 derniers', () => {
      it('contient les rendez-vous refusé, annulé et expiré, avec leur statut', async () => {
        const { world, lea, declined, cancelled, expired } = await scene();
        const { closed } = await listOf(world, lea);
        assert.deepEqual(Object.fromEntries(closed.map((meeting) => [meeting.id, meeting.status])), {
          [declined.documentId]: 'declined',
          [cancelled.documentId]: 'cancelled',
          [expired.documentId]: 'expired',
        });
        assert.ok(closed.every((meeting) => !meeting.canAccept && !meeting.canDecline && !meeting.canCounter && !meeting.canCancel));
      });

      it('est limité aux 20 derniers : 22 refusés donnent 20 lignes, les plus récentes', async () => {
        const world = await newEdition();
        const lea = await person(world.edition);
        const made = [];
        for (let index = 0; index < 22; index += 1) {
          made.push(await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['10h45'], requester: await person(world.edition), target: lea, status: 'declined', answeredBy: lea }));
        }
        const { closed } = await listOf(world, lea);
        assert.equal(closed.length, 20);
        const ids = closed.map((meeting) => meeting.id);
        assert.ok(ids.includes(made.at(-1).documentId), 'le plus récent manque');
        assert.ok(!ids.includes(made[0].documentId), 'le plus ancien devrait être écarté');
      });
    });

    describe('exposant : tous les représentants voient la demande et répondent au nom du stand (R-14)', () => {
      async function stand() {
        const world = await newEdition();
        const { exhibitor } = await W.createExhibitor(app(), world.edition, { name: 'Sylvadour', standNumber: '4' });
        const rep = (firstName, lastName) => person(world.edition, { firstName, lastName, role: 'exhibitor_rep', exhibitor: { documentId: exhibitor.documentId } });
        const [r1, r2] = [await rep('Benoît', 'Tastet'), await rep('Pierre', 'Haurie')];
        const visitor = await person(world.edition, { firstName: 'Alice', lastName: 'Fourcade' });
        const meeting = await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['15h45'], requester: visitor, exhibitor });
        return { world, exhibitor, r1, r2, visitor, meeting };
      }

      it('chaque représentant la reçoit, avec `viaExhibitor`, le demandeur en contrepartie et sans contre-proposition', async () => {
        const { world, exhibitor, r1, r2, visitor, meeting } = await stand();
        for (const rep of [r1, r2]) {
          const { received } = await listOf(world, rep);
          assert.deepEqual(received.map((entry) => entry.id), [meeting.documentId]);
          const [entry] = received;
          assert.deepEqual(entry.viaExhibitor, { id: exhibitor.documentId, name: 'Sylvadour', standNumber: '4' });
          assert.equal(entry.counterpart.kind, 'attendee');
          assert.equal(entry.counterpart.id, visitor.documentId);
          assert.equal(entry.direction, 'received');
          assert.deepEqual([entry.canAccept, entry.canDecline, entry.canCounter, entry.canCancel], [true, true, false, false]);
        }
      });

      it('le demandeur la voit en `sent`, l’exposant en contrepartie, `viaExhibitor` nul', async () => {
        const { world, exhibitor, visitor, meeting } = await stand();
        const { sent } = await listOf(world, visitor);
        assert.deepEqual(sent.map((entry) => entry.id), [meeting.documentId]);
        assert.equal(sent[0].viaExhibitor, null);
        assert.equal(sent[0].counterpart.kind, 'exhibitor');
        assert.equal(sent[0].counterpart.id, exhibitor.documentId);
        assert.equal(sent[0].counterpart.standNumber, '4');
      });

      it('accepté par un représentant : l’autre voit « Stand 4 » et qui a répondu', async () => {
        const { world, exhibitor, r1, r2, visitor } = await stand();
        const accepted = await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['10h45'], requester: visitor, exhibitor, status: 'accepted', answeredBy: r1 });
        const { agenda, received } = await listOf(world, r2);
        const item = agenda.find((entry) => entry.type === 'meeting' && entry.meeting.id === accepted.documentId);
        assert.ok(item, 'le rendez-vous accepté manque à l’agenda du second représentant');
        assert.equal(item.meeting.location, 'Stand 4');
        assert.match(item.meeting.answeredByName, /Benoît/);
        assert.ok(!received.some((entry) => entry.id === accepted.documentId));
      });
    });

    it('cloisonnement (NF-01) : un tiers ne voit rien des rendez-vous de Léa', async () => {
      const { world, hugo, lea, received } = await scene();
      const bystander = await person(world.edition);
      const body = await listOf(world, bystander);
      assert.deepEqual([body.received, body.sent, body.closed], [[], [], []]);
      assert.ok(!JSON.stringify(body).includes(received.documentId));
      assert.ok(!JSON.stringify(body).includes(lea.documentId));
      assert.ok(hugo.documentId);
    });

    it('cloisonnement entre éditions : les rendez-vous d’une autre édition ne figurent jamais dans la liste', async () => {
      const mine = await newEdition();
      const theirs = await newEdition();
      const lea = await person(mine.edition);
      const [a, b] = [await person(theirs.edition), await person(theirs.edition)];
      const foreign = await W.seedMeeting(app(), { edition: theirs.edition, slot: theirs.slots['10h45'], requester: a, target: b });
      const body = await listOf(mine, lea);
      assert.ok(!JSON.stringify(body).includes(foreign.documentId));
    });

    it('aucune adresse e-mail ni identifiant HelloAsso dans la réponse (R-42)', async () => {
      const { world, lea } = await scene();
      const response = await (await as(world.edition, lea)).get('/meetings');
      assert.deepEqual(W.leaks(response.text), []);
    });
  });
});
