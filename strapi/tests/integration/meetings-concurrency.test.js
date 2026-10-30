'use strict';

/**
 * Rendez-vous, concurrence réelle (lot 8, tests d'abord) : T-17 (20 acceptations simultanées sur un créneau à 3 tables), T-25 (deux
 * participants réservent en même temps la table dédiée d'un intervenant), plus les doubles soumissions et les réponses croisées.
 * Écritures sérialisées par un verrou par édition (A-27, A-16) ; l'index unique `espace_meetings_table_key_uq` reste le filet (R-13).
 * Chaque requête est une vraie requête HTTP avec sa session et son IP, lancée avec `Promise.all` : aucune simulation du verrou.
 *
 * Résultat attendu partout : aucune réponse 5xx, aucune table en double, un état final cohérent.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { pending } = require('../helpers/pending');
const { useEspace } = require('../helpers/espace');
const W = require('../helpers/meetings-world');

const codeOf = (response) => (response.status < 400 ? 'OK' : response.json?.error?.code ?? `HTTP ${response.status}`);
const tally = (responses) => responses.reduce((counts, response) => ({ ...counts, [codeOf(response)]: (counts[codeOf(response)] ?? 0) + 1 }), {});

describe('rendez-vous : concurrence (lot 8)', pending('lot 8', { timeout: 900_000 }), () => {
  const espace = useEspace({ overrides: { ORGANIZER_EMAILS: 'organisation@example.org' } });
  const login = W.useLogin(espace);
  const api = W.useApi(espace);
  const app = () => espace().app;

  const newEdition = (options) => W.createMeetingEdition(app(), { slug: W.unique('conc'), title: 'Édition d’essai', ...options });
  const person = (edition, fields) => W.createPerson(app(), edition, fields);
  const as = async (edition, who) => api(await login(edition, who));
  const noServerError = (responses) => assert.deepEqual(responses.filter((response) => response.status >= 500).map((response) => `${response.status} ${response.text}`), []);

  /** `count` demandes en attente, de personnes distinctes vers des cibles distinctes, au même créneau ; les cibles ont déjà leur session. */
  async function pendingPairs(world, count, label = '10h45') {
    const pairs = [];
    for (let index = 0; index < count; index += 1) {
      const requester = await person(world.edition);
      const target = await person(world.edition);
      const meeting = await W.seedMeeting(app(), { edition: world.edition, slot: world.slots[label], requester, target });
      pairs.push({ requester, target, meeting, client: await as(world.edition, target) });
    }
    return pairs;
  }

  describe('T-17 : 20 acceptations simultanées sur un créneau à 3 tables', () => {
    it('3 acceptées aux tables 1, 2 et 3 sans collision, les 17 autres refusées NO_TABLE_LEFT, aucune erreur serveur', async () => {
      const world = await newEdition();
      const pairs = await pendingPairs(world, 20);

      const responses = await Promise.all(pairs.map(({ client, meeting }) => client.post(`/meetings/${meeting.documentId}/accept`)));

      noServerError(responses);
      assert.deepEqual(tally(responses), { OK: 3, NO_TABLE_LEFT: 17 });
      const accepted = responses.filter((response) => response.status === 200);
      assert.deepEqual(accepted.map((response) => response.json.location).sort(), ['Table 1', 'Table 2', 'Table 3']);
      for (const response of responses.filter((candidate) => candidate.status === 409)) assert.equal(response.status, 409);
    });

    it('en base : exactement 3 `accepted` (tables 1 à 3, clés distinctes), les 17 autres toujours `pending` et sans table', async () => {
      const world = await newEdition();
      const pairs = await pendingPairs(world, 20);
      await Promise.all(pairs.map(({ client, meeting }) => client.post(`/meetings/${meeting.documentId}/accept`)));

      const rows = await W.meetingsAt(app(), world.edition);
      const accepted = rows.filter((row) => row.status === 'accepted');
      const waiting = rows.filter((row) => row.status === 'pending');
      assert.equal(accepted.length, 3);
      assert.equal(waiting.length, 17);
      assert.deepEqual(accepted.map((row) => row.tableNumber).sort(), [1, 2, 3]);
      assert.equal(new Set(accepted.map((row) => row.tableKey)).size, 3);
      for (const row of accepted) assert.equal(row.tableKey, `${world.slots['10h45'].documentId}:${row.tableNumber}`);
      for (const row of waiting) {
        assert.equal(row.tableKey ?? null, null);
        assert.equal(row.tableNumber ?? null, null);
      }
    });

    it('les 3 demandeurs acceptés reçoivent meeting-accepted, les 17 autres rien', async () => {
      const world = await newEdition();
      const pairs = await pendingPairs(world, 20);
      const responses = await Promise.all(pairs.map(({ client, meeting }) => client.post(`/meetings/${meeting.documentId}/accept`)));
      const winners = pairs.filter((_, index) => responses[index].status === 200);
      for (const { requester } of winners) await W.waitForEmailLogs(app(), requester, 'meeting-accepted');
      const losers = pairs.filter((_, index) => responses[index].status !== 200).slice(0, 4);
      for (const { requester } of losers) assert.equal((await W.settledEmailLogs(app(), requester, 'meeting-accepted', { settleMs: 50 })).length, 0);
    });

    it('table 2 dédiée : 20 acceptations simultanées donnent 2 acceptées, aux tables 1 et 3 seulement (T-26 sous charge)', async () => {
      const world = await newEdition();
      await person(world.edition, { role: 'speaker', hostedTableNumber: 2, meetingsOptIn: false });
      const pairs = await pendingPairs(world, 20);
      const responses = await Promise.all(pairs.map(({ client, meeting }) => client.post(`/meetings/${meeting.documentId}/accept`)));
      noServerError(responses);
      assert.deepEqual(tally(responses), { OK: 2, NO_TABLE_LEFT: 18 });
      const tables = (await W.meetingsAt(app(), world.edition, { status: 'accepted' })).map((row) => row.tableNumber).sort();
      assert.deepEqual(tables, [1, 3]);
    });

    it('une table libérée entre deux vagues : 17 nouvelles acceptations simultanées, une seule passe, à la table libérée', async () => {
      const world = await newEdition();
      const pairs = await pendingPairs(world, 20);
      await Promise.all(pairs.map(({ client, meeting }) => client.post(`/meetings/${meeting.documentId}/accept`)));
      const accepted = (await W.meetingsAt(app(), world.edition, { status: 'accepted' })).sort((a, b) => a.tableNumber - b.tableNumber);
      assert.equal(accepted.length, 3);

      const second = accepted.find((row) => row.tableNumber === 2);
      const owner = pairs.find((pair) => pair.meeting.documentId === second.documentId);
      assert.equal((await owner.client.post(`/meetings/${owner.meeting.documentId}/cancel`)).status, 200);

      const waiting = pairs.filter((pair) => pair.meeting.documentId !== second.documentId && !accepted.some((row) => row.documentId === pair.meeting.documentId));
      assert.equal(waiting.length, 17);
      const responses = await Promise.all(waiting.map(({ client, meeting }) => client.post(`/meetings/${meeting.documentId}/accept`)));
      noServerError(responses);
      assert.deepEqual(tally(responses), { OK: 1, NO_TABLE_LEFT: 16 });
      assert.equal(responses.find((response) => response.status === 200).json.location, 'Table 2');
    });
  });

  describe('T-25 : réservations simultanées de la table dédiée d’un intervenant (R-19, A-27)', () => {
    async function hostedWorld(participants) {
      const world = await newEdition();
      const host = await person(world.edition, { firstName: 'Antoine', lastName: 'Vergnes', role: 'speaker', hostedTableNumber: 2, meetingsOptIn: false, directoryOptIn: false });
      const clients = [];
      for (let index = 0; index < participants; index += 1) clients.push(await as(world.edition, await person(world.edition)));
      return { world, host, clients };
    }
    const book = (world, client, host, label = '10h45') => client.post('/meetings', { slotId: world.slots[label].documentId, target: `p:${host.documentId}` });

    it('deux participants, même créneau : un seul 201 `accepted` à « Table 2 », l’autre reçoit 409 TARGET_BUSY', async () => {
      const { world, host, clients } = await hostedWorld(2);
      const responses = await Promise.all(clients.map((client) => book(world, client, host)));
      noServerError(responses);
      assert.deepEqual(tally(responses), { OK: 1, TARGET_BUSY: 1 });
      const winner = responses.find((response) => response.status === 201);
      assert.equal(winner.json.status, 'accepted');
      assert.equal(winner.json.location, 'Table 2');
    });

    it('en base : un seul rendez-vous au créneau et à la table 2, sans demande préalable', async () => {
      const { world, host, clients } = await hostedWorld(2);
      await Promise.all(clients.map((client) => book(world, client, host)));
      const rows = await W.meetingsAt(app(), world.edition);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, 'accepted');
      assert.equal(rows[0].tableKey, `${world.slots['10h45'].documentId}:2`);
    });

    it('six participants, même créneau : un seul gagne, les cinq autres reçoivent TARGET_BUSY', async () => {
      const { world, host, clients } = await hostedWorld(6);
      const responses = await Promise.all(clients.map((client) => book(world, client, host)));
      noServerError(responses);
      assert.deepEqual(tally(responses), { OK: 1, TARGET_BUSY: 5 });
      assert.equal((await W.meetingsAt(app(), world.edition)).length, 1);
    });

    it('trois créneaux disputés à la fois par six participants : un gagnant par créneau, jamais deux', async () => {
      const { world, host, clients } = await hostedWorld(6);
      const labels = ['10h45', '11h00', '12h30'];
      const calls = clients.map((client, index) => book(world, client, host, labels[index % 3]));
      const responses = await Promise.all(calls);
      noServerError(responses);
      assert.equal(responses.filter((response) => response.status === 201).length, 3);
      assert.deepEqual(Object.keys(tally(responses)).sort(), ['OK', 'TARGET_BUSY']);
      const rows = await W.meetingsAt(app(), world.edition);
      assert.equal(new Set(rows.map((row) => row.tableKey)).size, rows.length);
    });

    it('double clic : le même participant réserve deux fois le même créneau, une seule réservation naît', async () => {
      const { world, host, clients } = await hostedWorld(1);
      const responses = await Promise.all([book(world, clients[0], host), book(world, clients[0], host)]);
      noServerError(responses);
      assert.equal(responses.filter((response) => response.status === 201).length, 1);
      assert.ok(responses.some((response) => response.status === 409));
      assert.equal((await W.meetingsAt(app(), world.edition)).length, 1);
    });
  });

  describe('doubles soumissions et réponses croisées', () => {
    it('double clic sur « Envoyer la demande » : une seule demande `pending`, la seconde reçoit 409', async () => {
      const world = await newEdition();
      const [lea, ines] = [await person(world.edition), await person(world.edition)];
      const client = await as(world.edition, lea);
      const send = () => client.post('/meetings', { slotId: world.slots['10h45'].documentId, target: `p:${ines.documentId}` });
      const responses = await Promise.all([send(), send(), send()]);
      noServerError(responses);
      assert.equal(responses.filter((response) => response.status === 201).length, 1);
      assert.ok(responses.filter((response) => response.status === 409).every((response) => ['SLOT_TAKEN', 'ALREADY_REQUESTED'].includes(response.json.error.code)));
      assert.equal((await W.meetingsAt(app(), world.edition)).length, 1);
    });

    it('un participant qui demande à dix cibles en même temps ne dépasse pas dix demandes en attente (R-11.9)', async () => {
      const world = await newEdition({ sequences: [{ title: 'Grande pause B2B', start_time: '10h00', end_time: '14h00', kind: 'b2b_break' }] });
      const labels = Object.keys(world.slots);
      assert.ok(labels.length >= 14, `${labels.length} créneaux`);
      const lea = await person(world.edition);
      const client = await as(world.edition, lea);
      const targets = [];
      for (let index = 0; index < 14; index += 1) targets.push(await person(world.edition));
      const responses = await Promise.all(targets.map((target, index) => client.post('/meetings', { slotId: world.slots[labels[index]].documentId, target: `p:${target.documentId}` })));
      noServerError(responses);
      assert.equal(responses.filter((response) => response.status === 201).length, 10);
      assert.ok(responses.filter((response) => response.status === 409).every((response) => response.json.error.code === 'TOO_MANY_PENDING'));
      assert.equal((await W.meetingsAt(app(), world.edition, { status: 'pending' })).length, 10);
    });

    it('deux acceptations simultanées de la même demande : une seule réussit, l’autre reçoit INVALID_TRANSITION, une seule table prise', async () => {
      const world = await newEdition();
      const [pair] = await pendingPairs(world, 1);
      const responses = await Promise.all([pair.client.post(`/meetings/${pair.meeting.documentId}/accept`), pair.client.post(`/meetings/${pair.meeting.documentId}/accept`)]);
      noServerError(responses);
      assert.deepEqual(tally(responses), { OK: 1, INVALID_TRANSITION: 1 });
      assert.equal((await W.meetingsAt(app(), world.edition, { status: 'accepted' })).length, 1);
    });

    it('acceptation et annulation simultanées : un état final cohérent (accepté avec sa table, ou annulé sans table)', async () => {
      const world = await newEdition();
      const [pair] = await pendingPairs(world, 1);
      const requesterClient = await as(world.edition, pair.requester);
      const responses = await Promise.all([pair.client.post(`/meetings/${pair.meeting.documentId}/accept`), requesterClient.post(`/meetings/${pair.meeting.documentId}/cancel`)]);
      noServerError(responses);
      const row = await W.readMeeting(app(), pair.meeting.documentId);
      if (row.status === 'accepted') {
        assert.equal(row.tableKey, `${world.slots['10h45'].documentId}:1`);
      } else {
        assert.equal(row.status, 'cancelled');
        assert.equal(row.tableKey ?? null, null);
      }
      assert.ok(responses.some((response) => response.status < 300));
    });

    it('exposant à 2 représentants : 4 acceptations simultanées, 2 rendez-vous acceptés au plus (R-14), aucune erreur serveur', async () => {
      const world = await newEdition();
      const { exhibitor } = await W.createExhibitor(app(), world.edition, { name: 'Sylvadour', standNumber: '4' });
      const reps = [];
      for (let index = 0; index < 2; index += 1) reps.push(await person(world.edition, { role: 'exhibitor_rep', exhibitor: { documentId: exhibitor.documentId } }));
      const clients = [await as(world.edition, reps[0]), await as(world.edition, reps[1])];
      const meetings = [];
      for (let index = 0; index < 4; index += 1) meetings.push(await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['11h00'], requester: await person(world.edition), exhibitor }));
      const responses = await Promise.all(meetings.map((meeting, index) => clients[index % 2].post(`/meetings/${meeting.documentId}/accept`)));
      noServerError(responses);
      assert.equal(responses.filter((response) => response.status === 200).length, 2);
      assert.equal((await W.meetingsAt(app(), world.edition, { status: 'accepted' })).length, 2);
      assert.equal((await W.meetingsAt(app(), world.edition, { status: 'accepted' })).every((row) => row.tableKey == null), true, 'un stand ne prend aucune table');
    });

    it('acceptations simultanées sur deux créneaux : chaque créneau a ses propres tables (le verrou n’en mélange aucune)', async () => {
      const world = await newEdition();
      const first = await pendingPairs(world, 4, '10h45');
      const second = await pendingPairs(world, 4, '11h00');
      const responses = await Promise.all([...first, ...second].map(({ client, meeting }) => client.post(`/meetings/${meeting.documentId}/accept`)));
      noServerError(responses);
      assert.deepEqual(tally(responses), { OK: 6, NO_TABLE_LEFT: 2 });
      for (const label of ['10h45', '11h00']) {
        const rows = await W.meetingsAt(app(), world.edition, { status: 'accepted', slot: { documentId: world.slots[label].documentId } });
        assert.deepEqual(rows.map((row) => row.tableNumber).sort(), [1, 2, 3], label);
      }
    });
  });
});
