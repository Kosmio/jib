'use strict';

/**
 * Rendez-vous dans le pilotage (V3-F, F-139 à F-141, R-90) : GET /admin/:edition/meetings, POST /meetings/:id/cancel,
 * POST /meetings/:id/move, PUT /slots/:id/blocks. Accès (organisateur de l'édition seulement), contenu sans e-mail (R-42),
 * annulation avec deux e-mails, déplacement, blocages et leur effet sur la grille et sur les demandes.
 *
 *   TEST_DATABASE=strapi_c12_test TZ=UTC node --require ./tests/helpers/no-network.js --test tests/integration/espace-admin-rendezvous.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { useEspace } = require('../helpers/espace');
const { UID } = require('../helpers/espace-data');
const W = require('../helpers/meetings-world');

const NBSP = String.fromCharCode(0xa0);

describe('pilotage : rendez-vous et blocages (V3-F)', { timeout: 600_000 }, () => {
  const espace = useEspace();
  const login = W.useLogin(espace);
  const api = W.useApi(espace);
  const app = () => espace().app;

  const newEdition = (options) => W.createMeetingEdition(app(), { slug: W.unique('pil'), title: 'Édition d’essai', ...options });
  const person = (edition, fields) => W.createPerson(app(), edition, fields);
  const as = async (edition, who) => api(await login(edition, who));
  const organizerOf = async (edition) => as(edition, await person(edition, { role: 'organizer' }));
  const base = (edition) => `/admin/${edition.slug}`;
  const expectError = (response, status, code) => {
    assert.equal(response.status, status, `${response.status} ${response.text}`);
    assert.equal(response.json?.error?.code, code, response.text);
  };
  const slotRow = (slot) => app().documents(UID.slot).findOne({ documentId: slot.documentId });
  const block = (client, edition, slot, blockedTables, closed = false) => client.put(`${base(edition)}/slots/${slot.documentId}/blocks`, { blockedTables, closed });

  /** Un rendez-vous accepté à la table `tableNumber` de `label`, entre deux personnes nommées. */
  async function acceptedMeeting(world, label = '10h45', tableNumber = 1, names = {}) {
    const requester = await person(world.edition, { firstName: names.requester ?? 'Léa', lastName: names.requesterLast ?? 'Ducasse', company: 'Scierie du Sud' });
    const target = await person(world.edition, { firstName: names.target ?? 'Inès', lastName: names.targetLast ?? 'Marty', company: 'Atelier Bois' });
    const meeting = await W.seedMeeting(app(), { edition: world.edition, slot: world.slots[label], requester, target, status: 'accepted', tableNumber });
    return { requester, target, meeting };
  }
  const pendingMeeting = async (world, label = '10h45') => {
    const requester = await person(world.edition);
    const target = await person(world.edition);
    return { requester, target, meeting: await W.seedMeeting(app(), { edition: world.edition, slot: world.slots[label], requester, target }) };
  };

  describe('accès : organisateur de l’édition seulement (NF-01)', () => {
    it('les quatre routes refusent un participant (403 FORBIDDEN)', async () => {
      const world = await newEdition();
      const { meeting } = await acceptedMeeting(world);
      const participant = await as(world.edition, await person(world.edition));
      const slot = world.slots['10h45'].documentId;
      expectError(await participant.get(`${base(world.edition)}/meetings`), 403, 'FORBIDDEN');
      expectError(await participant.post(`${base(world.edition)}/meetings/${meeting.documentId}/cancel`), 403, 'FORBIDDEN');
      expectError(await participant.post(`${base(world.edition)}/meetings/${meeting.documentId}/move`, { table: 2 }), 403, 'FORBIDDEN');
      expectError(await participant.put(`${base(world.edition)}/slots/${slot}/blocks`, { blockedTables: [2], closed: false }), 403, 'FORBIDDEN');
      assert.equal((await W.readMeeting(app(), meeting.documentId)).status, 'accepted');
      assert.deepEqual((await slotRow(world.slots['10h45'])).blockedTables ?? [], []);
    });

    it('les quatre routes refusent l’organisateur d’une autre édition (403) et une personne sans session (401)', async () => {
      const world = await newEdition();
      const other = await newEdition();
      const { meeting } = await acceptedMeeting(world);
      const foreign = await organizerOf(other.edition);
      const anonymous = api(undefined);
      const slot = world.slots['10h45'].documentId;
      for (const client of [foreign, anonymous]) {
        const expected = client === foreign ? [403, 'FORBIDDEN'] : [401, 'UNAUTHENTICATED'];
        expectError(await client.get(`${base(world.edition)}/meetings`), ...expected);
        expectError(await client.post(`${base(world.edition)}/meetings/${meeting.documentId}/cancel`), ...expected);
        expectError(await client.post(`${base(world.edition)}/meetings/${meeting.documentId}/move`, { table: 2 }), ...expected);
        expectError(await client.put(`${base(world.edition)}/slots/${slot}/blocks`, { blockedTables: [2], closed: false }), ...expected);
      }
      assert.equal((await W.readMeeting(app(), meeting.documentId)).status, 'accepted');
    });
  });

  describe('GET /meetings (F-139)', () => {
    it('rend les tables, les créneaux avec leurs blocages et les rendez-vous avec leurs deux parties', async () => {
      const world = await newEdition({ tablesCount: 4 });
      const { meeting } = await acceptedMeeting(world, '10h45', 2);
      const organizer = await organizerOf(world.edition);
      const response = await organizer.get(`${base(world.edition)}/meetings`);
      assert.equal(response.status, 200, response.text);
      const { tablesCount, dedicatedTables, slots, meetings } = response.json;
      assert.equal(tablesCount, 4);
      assert.deepEqual(dedicatedTables, []);
      assert.equal(slots.length, world.slotList.length);
      const slot = slots.find((entry) => entry.label === '10h45');
      assert.deepEqual(Object.keys(slot).sort(), ['blockedTables', 'closed', 'endsAt', 'freeTables', 'id', 'label', 'sessionTitle', 'startsAt']);
      assert.equal(slot.closed, false);
      assert.deepEqual(slot.blockedTables, []);
      assert.deepEqual(slot.freeTables, [1, 3, 4]);
      assert.equal(meetings.length, 1);
      const [row] = meetings;
      assert.equal(row.id, meeting.documentId);
      assert.equal(row.status, 'accepted');
      assert.equal(row.slot.label, '10h45');
      assert.deepEqual(row.requester, { kind: 'attendee', name: 'Léa Ducasse', subtitle: 'Scierie du Sud' });
      assert.deepEqual(row.target, { kind: 'attendee', name: 'Inès Marty', subtitle: 'Atelier Bois' });
      assert.equal(row.location, 'Table 2');
      assert.equal(row.tableNumber, 2);
      assert.equal(row.conflict, false);
      assert.equal(row.canCancel, true);
      assert.equal(row.canMove, true);
      assert.deepEqual(row.freeTables.filter((table) => table !== row.tableNumber), [1, 3, 4]);
    });

    it('les slots sont triés par heure, les rendez-vous par créneau', async () => {
      const world = await newEdition();
      await acceptedMeeting(world, '11h00', 1);
      await acceptedMeeting(world, '10h45', 1);
      const { slots, meetings } = (await (await organizerOf(world.edition)).get(`${base(world.edition)}/meetings`)).json;
      const starts = slots.map((slot) => new Date(slot.startsAt).getTime());
      assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
      assert.deepEqual(meetings.map((row) => row.slot.label), ['10h45', '11h00']);
    });

    it('une cible exposant : nom de l’exposant et « Stand n », sans table ni déplacement', async () => {
      const world = await newEdition();
      const { exhibitor } = await W.createExhibitor(app(), world.edition, { name: 'Sylvadour', standNumber: '4' });
      const requester = await person(world.edition);
      await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['11h00'], requester, exhibitor, status: 'accepted' });
      const [row] = (await (await organizerOf(world.edition)).get(`${base(world.edition)}/meetings`)).json.meetings;
      assert.deepEqual(row.target, { kind: 'exhibitor', name: 'Sylvadour', subtitle: 'Stand 4' });
      assert.equal(row.tableNumber, null);
      assert.equal(row.canMove, false);
      assert.equal(row.canCancel, true);
    });

    it('la table dédiée d’un intervenant est listée, et sa réservation ne se déplace pas', async () => {
      const world = await newEdition();
      const host = await person(world.edition, { role: 'speaker', hostedTableNumber: 3, meetingsOptIn: false });
      const guest = await person(world.edition);
      await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['10h45'], requester: guest, target: host, status: 'accepted', tableNumber: 3 });
      const { dedicatedTables, meetings } = (await (await organizerOf(world.edition)).get(`${base(world.edition)}/meetings`)).json;
      assert.deepEqual(dedicatedTables, [3]);
      assert.equal(meetings[0].canMove, false);
      assert.deepEqual(meetings[0].freeTables, []);
    });

    it('un rendez-vous annulé ou refusé ne peut ni s’annuler ni se déplacer', async () => {
      const world = await newEdition();
      const [a, b] = [await person(world.edition), await person(world.edition)];
      await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['10h45'], requester: a, target: b, status: 'cancelled' });
      const [row] = (await (await organizerOf(world.edition)).get(`${base(world.edition)}/meetings`)).json.meetings;
      assert.equal(row.status, 'cancelled');
      assert.equal(row.canCancel, false);
      assert.equal(row.canMove, false);
    });

    it('un créneau commencé : ni annulation ni déplacement', async () => {
      const world = await newEdition({ daysAhead: -3 });
      await acceptedMeeting(world, '10h45', 1);
      const [row] = (await (await organizerOf(world.edition)).get(`${base(world.edition)}/meetings`)).json.meetings;
      assert.equal(row.canCancel, false);
      assert.equal(row.canMove, false);
    });

    it('ne rend que les rendez-vous de l’édition demandée', async () => {
      const world = await newEdition();
      const other = await newEdition();
      await acceptedMeeting(other);
      assert.deepEqual((await (await organizerOf(world.edition)).get(`${base(world.edition)}/meetings`)).json.meetings, []);
    });

    it('aucun e-mail, identifiant HelloAsso ni téléphone dans la réponse (R-42)', async () => {
      const world = await newEdition();
      await acceptedMeeting(world);
      const { exhibitor } = await W.createExhibitor(app(), world.edition, { name: 'Sylvadour' });
      await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['11h00'], requester: await person(world.edition), exhibitor, status: 'accepted' });
      await pendingMeeting(world, '12h30');
      const organizer = await organizerOf(world.edition);
      await block(organizer, world.edition, world.slots['10h45'], [1], false);
      const response = await organizer.get(`${base(world.edition)}/meetings`);
      assert.equal(response.status, 200);
      assert.deepEqual(W.leaks(response.text), []);
    });

    it('un rendez-vous accepté sur une table bloquée est en conflit et propose les tables libres', async () => {
      const world = await newEdition();
      await acceptedMeeting(world, '10h45', 1);
      const organizer = await organizerOf(world.edition);
      await block(organizer, world.edition, world.slots['10h45'], [1], false);
      const [row] = (await organizer.get(`${base(world.edition)}/meetings`)).json.meetings;
      assert.equal(row.conflict, true);
      assert.equal(row.canMove, true);
      assert.deepEqual(row.freeTables, [2, 3]);
    });

    it('un créneau fermé met en conflit ses rendez-vous acceptés : plus de déplacement, aucune table libre', async () => {
      const world = await newEdition();
      await acceptedMeeting(world, '10h45', 1);
      const organizer = await organizerOf(world.edition);
      await block(organizer, world.edition, world.slots['10h45'], [], true);
      const { slots, meetings } = (await organizer.get(`${base(world.edition)}/meetings`)).json;
      assert.equal(meetings[0].conflict, true);
      assert.equal(meetings[0].canMove, false);
      assert.equal(meetings[0].canCancel, true);
      assert.deepEqual(slots.find((slot) => slot.label === '10h45').freeTables, []);
    });

    it('une demande en attente n’est jamais en conflit', async () => {
      const world = await newEdition();
      await pendingMeeting(world);
      const organizer = await organizerOf(world.edition);
      await block(organizer, world.edition, world.slots['10h45'], [], true);
      assert.equal((await organizer.get(`${base(world.edition)}/meetings`)).json.meetings[0].conflict, false);
    });
  });

  describe('PUT /slots/:id/blocks (F-141, R-90)', () => {
    it('pose les blocages : liste triée sans doublon, créneau fermé, enregistrés en base', async () => {
      const world = await newEdition();
      const organizer = await organizerOf(world.edition);
      const response = await block(organizer, world.edition, world.slots['12h30'], [3, 2, 3], false);
      assert.equal(response.status, 200, response.text);
      assert.deepEqual(response.json, { id: world.slots['12h30'].documentId, blockedTables: [2, 3], closed: false, affected: [] });
      const row = await slotRow(world.slots['12h30']);
      assert.deepEqual(row.blockedTables, [2, 3]);
      assert.equal(row.closed, false);
    });

    it('un blocage vide et ouvert lève les blocages', async () => {
      const world = await newEdition();
      const organizer = await organizerOf(world.edition);
      await block(organizer, world.edition, world.slots['12h30'], [2], true);
      const response = await block(organizer, world.edition, world.slots['12h30'], [], false);
      assert.deepEqual([response.json.blockedTables, response.json.closed], [[], false]);
      assert.equal((await slotRow(world.slots['12h30'])).closed, false);
    });

    it('`affected` : les rendez-vous acceptés sur la table bloquée, pas les autres ni les demandes en attente', async () => {
      const world = await newEdition();
      const first = await acceptedMeeting(world, '10h45', 1);
      await acceptedMeeting(world, '10h45', 2);
      await pendingMeeting(world, '10h45');
      const response = await block(await organizerOf(world.edition), world.edition, world.slots['10h45'], [1], false);
      assert.deepEqual(response.json.affected, [first.meeting.documentId]);
    });

    it('`affected` : un créneau fermé touche tous les rendez-vous acceptés du créneau, pas ceux d’un autre', async () => {
      const world = await newEdition();
      const one = await acceptedMeeting(world, '10h45', 1);
      const two = await acceptedMeeting(world, '10h45', 2);
      await acceptedMeeting(world, '11h00', 1);
      const response = await block(await organizerOf(world.edition), world.edition, world.slots['10h45'], [], true);
      assert.deepEqual([...response.json.affected].sort(), [one.meeting.documentId, two.meeting.documentId].sort());
    });

    it('poser un blocage ne modifie aucun rendez-vous déjà accepté', async () => {
      const world = await newEdition();
      const { meeting } = await acceptedMeeting(world, '10h45', 1);
      await block(await organizerOf(world.edition), world.edition, world.slots['10h45'], [1], true);
      const row = await W.readMeeting(app(), meeting.documentId);
      assert.deepEqual([row.status, row.tableNumber], ['accepted', 1]);
    });

    const invalid = [
      ['blockedTables absent', { closed: false }, 'blockedTables'],
      ['blockedTables qui n’est pas une liste', { blockedTables: '2', closed: false }, 'blockedTables'],
      ['un numéro nul', { blockedTables: [0], closed: false }, 'blockedTables'],
      ['un numéro négatif', { blockedTables: [-1], closed: false }, 'blockedTables'],
      ['un numéro décimal', { blockedTables: [1.5], closed: false }, 'blockedTables'],
      ['un numéro en texte', { blockedTables: ['2'], closed: false }, 'blockedTables'],
      ['un numéro au-delà des tables de l’édition', { blockedTables: [4], closed: false }, 'blockedTables'],
      ['closed absent', { blockedTables: [] }, 'closed'],
      ['closed en texte', { blockedTables: [], closed: 'oui' }, 'closed'],
    ];
    for (const [title, body, field] of invalid) {
      it(`400 VALIDATION : ${title}`, async () => {
        const world = await newEdition();
        const response = await (await organizerOf(world.edition)).put(`${base(world.edition)}/slots/${world.slots['10h45'].documentId}/blocks`, body);
        expectError(response, 400, 'VALIDATION');
        assert.ok(field in (response.json.error.details?.fields ?? response.json.error.fields ?? { [field]: true }), response.text);
        assert.deepEqual((await slotRow(world.slots['10h45'])).blockedTables ?? [], []);
      });
    }

    it('404 SLOT_NOT_FOUND : créneau inconnu', async () => {
      const world = await newEdition();
      const response = await (await organizerOf(world.edition)).put(`${base(world.edition)}/slots/inconnu0000000000000000/blocks`, { blockedTables: [], closed: false });
      expectError(response, 404, 'SLOT_NOT_FOUND');
    });

    it('404 SLOT_NOT_FOUND : créneau d’une autre édition, qui reste intact', async () => {
      const world = await newEdition();
      const other = await newEdition();
      const response = await block(await organizerOf(world.edition), world.edition, other.slots['10h45'], [1], true);
      expectError(response, 404, 'SLOT_NOT_FOUND');
      assert.equal((await slotRow(other.slots['10h45'])).closed, false);
    });

    it('403 pour une édition inexistante (le garde refuse avant toute lecture)', async () => {
      const world = await newEdition();
      const response = await (await organizerOf(world.edition)).get('/admin/edition-qui-n-existe-pas/meetings');
      assert.equal(response.status, 403);
    });
  });

  describe('effet des blocages sur la grille et sur les demandes (R-90)', () => {
    it('créneau fermé : la grille du participant le montre « unavailable », une demande directe répond 409 SLOT_CLOSED', async () => {
      const world = await newEdition();
      const [lea, ines] = [await person(world.edition), await person(world.edition)];
      await block(await organizerOf(world.edition), world.edition, world.slots['12h30'], [], true);
      const client = await as(world.edition, lea);
      const { groups } = (await client.get(`/slots?target=p:${ines.documentId}`)).json;
      const states = Object.fromEntries(groups.flatMap((group) => group.slots).map((slot) => [slot.label, slot.state]));
      assert.equal(states['12h30'], 'unavailable');
      assert.equal(states['10h45'], 'available');
      expectError(await client.post('/meetings', { slotId: world.slots['12h30'].documentId, target: `p:${ines.documentId}`, message: 'Bonjour, échangeons.' }), 409, 'SLOT_CLOSED');
      assert.equal((await W.meetingsAt(app(), world.edition)).length, 0);
    });

    it('créneau fermé : l’acceptation d’une demande en attente répond 409 SLOT_CLOSED, la demande reste en attente', async () => {
      const world = await newEdition();
      const { target, meeting } = await pendingMeeting(world, '12h30');
      await block(await organizerOf(world.edition), world.edition, world.slots['12h30'], [], true);
      expectError(await (await as(world.edition, target)).post(`/meetings/${meeting.documentId}/accept`), 409, 'SLOT_CLOSED');
      assert.equal((await W.readMeeting(app(), meeting.documentId)).status, 'pending');
    });

    it('réouvert : la grille et les demandes redeviennent disponibles', async () => {
      const world = await newEdition();
      const [lea, ines] = [await person(world.edition), await person(world.edition)];
      const organizer = await organizerOf(world.edition);
      await block(organizer, world.edition, world.slots['12h30'], [], true);
      await block(organizer, world.edition, world.slots['12h30'], [], false);
      const created = await (await as(world.edition, lea)).post('/meetings', { slotId: world.slots['12h30'].documentId, target: `p:${ines.documentId}`, message: 'Bonjour, échangeons.' });
      assert.equal(created.status, 201, created.text);
    });

    it('table 2 bloquée : l’acceptation donne la table 1 puis la 3, jamais la 2', async () => {
      const world = await newEdition();
      await block(await organizerOf(world.edition), world.edition, world.slots['12h30'], [2], false);
      const locations = [];
      for (let index = 0; index < 2; index += 1) {
        const { target, meeting } = await pendingMeeting(world, '12h30');
        locations.push((await (await as(world.edition, target)).post(`/meetings/${meeting.documentId}/accept`)).json.location);
      }
      assert.deepEqual(locations, ['Table 1', 'Table 3']);
      const { target, meeting } = await pendingMeeting(world, '12h30');
      expectError(await (await as(world.edition, target)).post(`/meetings/${meeting.documentId}/accept`), 409, 'NO_TABLE_LEFT');
    });
  });

  describe('POST /meetings/:id/cancel (F-140, R-16)', () => {
    const cancel = (client, edition, meeting, body) => client.post(`${base(edition)}/meetings/${meeting.documentId}/cancel`, body);
    const mailOf = (attendee) => W.outboxTo(espace, attendee.email).filter((mail) => /annulé/i.test(mail.subject)).at(-1);

    it('rendez-vous accepté : { id, status: cancelled }, table libérée, tableKey vidée', async () => {
      const world = await newEdition();
      const { meeting } = await acceptedMeeting(world, '10h45', 1);
      const response = await cancel(await organizerOf(world.edition), world.edition, meeting, { reason: 'Intervenant absent' });
      assert.equal(response.status, 200, response.text);
      assert.deepEqual(response.json, { id: meeting.documentId, status: 'cancelled' });
      const row = await W.readMeeting(app(), meeting.documentId);
      assert.equal(row.status, 'cancelled');
      assert.equal(row.tableKey ?? null, null);
      assert.equal(row.cancelReason, 'Intervenant absent');
    });

    it('la table libérée est de nouveau attribuable', async () => {
      const world = await newEdition({ tablesCount: 1 });
      const { meeting } = await acceptedMeeting(world, '10h45', 1);
      const organizer = await organizerOf(world.edition);
      assert.equal((await organizer.get(`${base(world.edition)}/meetings`)).json.slots.find((slot) => slot.label === '10h45').freeTables.length, 0);
      await cancel(organizer, world.edition, meeting);
      assert.deepEqual((await organizer.get(`${base(world.edition)}/meetings`)).json.slots.find((slot) => slot.label === '10h45').freeTables, [1]);
      const { target, meeting: next } = await pendingMeeting(world, '10h45');
      const accepted = await (await as(world.edition, target)).post(`/meetings/${next.documentId}/accept`);
      assert.equal(accepted.json?.location, 'Table 1', accepted.text);
    });

    it('les deux parties reçoivent meeting-cancelled : « a été annulé par l’organisation » et « Motif : … »', async () => {
      const world = await newEdition();
      const { requester, target, meeting } = await acceptedMeeting(world, '10h45', 1);
      await cancel(await organizerOf(world.edition), world.edition, meeting, { reason: 'Intervenant absent' });
      await W.waitForEmailLogs(app(), requester, 'meeting-cancelled');
      await W.waitForEmailLogs(app(), target, 'meeting-cancelled');
      for (const [who, other] of [[requester, 'Inès Marty'], [target, 'Léa Ducasse']]) {
        const mail = mailOf(who);
        assert.ok(mail, `aucun e-mail d’annulation pour ${who.email}`);
        assert.ok(mail.text.includes('a été annulé par l’organisation'), mail.text);
        assert.ok(mail.text.includes(`Motif${NBSP}: Intervenant absent`), mail.text);
        assert.ok(mail.text.includes(other), `${other} doit être nommé`);
      }
    });

    it('sans motif : la mention « annulé par l’organisation » reste, aucune ligne « Motif »', async () => {
      const world = await newEdition();
      const { requester, meeting } = await acceptedMeeting(world);
      assert.equal((await cancel(await organizerOf(world.edition), world.edition, meeting)).status, 200);
      await W.waitForEmailLogs(app(), requester, 'meeting-cancelled');
      assert.ok(mailOf(requester).text.includes('a été annulé par l’organisation'));
      assert.equal(mailOf(requester).text.includes('Motif'), false);
    });

    it('une demande en attente s’annule aussi, et les deux parties sont prévenues', async () => {
      const world = await newEdition();
      const { requester, target, meeting } = await pendingMeeting(world);
      const response = await cancel(await organizerOf(world.edition), world.edition, meeting, {});
      assert.equal(response.status, 200, response.text);
      assert.equal(response.json.status, 'cancelled');
      await W.waitForEmailLogs(app(), requester, 'meeting-cancelled');
      await W.waitForEmailLogs(app(), target, 'meeting-cancelled');
    });

    it('cible exposant : le demandeur est prévenu et le rendez-vous annulé', async () => {
      const world = await newEdition();
      const { exhibitor } = await W.createExhibitor(app(), world.edition, { name: 'Sylvadour' });
      const requester = await person(world.edition);
      const meeting = await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['11h00'], requester, exhibitor, status: 'accepted' });
      assert.equal((await cancel(await organizerOf(world.edition), world.edition, meeting)).status, 200);
      await W.waitForEmailLogs(app(), requester, 'meeting-cancelled');
    });

    it('un participant désactivé n’est pas écrit, l’autre l’est', async () => {
      const world = await newEdition();
      const { requester, target, meeting } = await acceptedMeeting(world);
      await app().documents(UID.attendee).update({ documentId: target.documentId, data: { status: 'cancelled' } });
      await cancel(await organizerOf(world.edition), world.edition, meeting);
      await W.waitForEmailLogs(app(), requester, 'meeting-cancelled');
      assert.equal((await W.settledEmailLogs(app(), target, 'meeting-cancelled', { settleMs: 100 })).length, 0);
    });

    it('un second appel : 409 INVALID_TRANSITION, pas de nouvel e-mail', async () => {
      const world = await newEdition();
      const { requester, meeting } = await acceptedMeeting(world);
      const organizer = await organizerOf(world.edition);
      assert.equal((await cancel(organizer, world.edition, meeting)).status, 200);
      await W.waitForEmailLogs(app(), requester, 'meeting-cancelled');
      expectError(await cancel(organizer, world.edition, meeting), 409, 'INVALID_TRANSITION');
      assert.equal((await W.settledEmailLogs(app(), requester, 'meeting-cancelled', { settleMs: 150 })).length, 1);
    });

    it('un rendez-vous refusé : 409 INVALID_TRANSITION', async () => {
      const world = await newEdition();
      const [a, b] = [await person(world.edition), await person(world.edition)];
      const meeting = await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['10h45'], requester: a, target: b, status: 'declined' });
      expectError(await cancel(await organizerOf(world.edition), world.edition, meeting), 409, 'INVALID_TRANSITION');
    });

    it('créneau commencé : 409 SLOT_PAST, le rendez-vous reste accepté', async () => {
      const world = await newEdition({ daysAhead: -3 });
      const { meeting } = await acceptedMeeting(world);
      expectError(await cancel(await organizerOf(world.edition), world.edition, meeting), 409, 'SLOT_PAST');
      assert.equal((await W.readMeeting(app(), meeting.documentId)).status, 'accepted');
    });

    it('404 MEETING_NOT_FOUND : identifiant inconnu et rendez-vous d’une autre édition', async () => {
      const world = await newEdition();
      const other = await newEdition();
      const { meeting } = await acceptedMeeting(other);
      const organizer = await organizerOf(world.edition);
      expectError(await organizer.post(`${base(world.edition)}/meetings/inconnu0000000000000000/cancel`), 404, 'MEETING_NOT_FOUND');
      expectError(await cancel(organizer, world.edition, meeting), 404, 'MEETING_NOT_FOUND');
      assert.equal((await W.readMeeting(app(), meeting.documentId)).status, 'accepted');
    });

    it('400 VALIDATION : motif de plus de 200 caractères, rien n’est annulé', async () => {
      const world = await newEdition();
      const { meeting } = await acceptedMeeting(world);
      expectError(await cancel(await organizerOf(world.edition), world.edition, meeting, { reason: 'x'.repeat(201) }), 400, 'VALIDATION');
      assert.equal((await W.readMeeting(app(), meeting.documentId)).status, 'accepted');
    });

    it('le corps n’a pas besoin d’exister : un POST sans motif annule', async () => {
      const world = await newEdition();
      const { meeting } = await acceptedMeeting(world);
      assert.equal((await cancel(await organizerOf(world.edition), world.edition, meeting, undefined)).status, 200);
    });

    it('la réponse ne contient aucune donnée personnelle', async () => {
      const world = await newEdition();
      const { meeting } = await acceptedMeeting(world);
      assert.deepEqual(W.leaks((await cancel(await organizerOf(world.edition), world.edition, meeting)).text), []);
    });
  });

  describe('POST /meetings/:id/move (F-141)', () => {
    const move = (client, edition, meeting, body) => client.post(`${base(edition)}/meetings/${meeting.documentId}/move`, body);

    it('vers une table libre : { id, status, location, tableNumber }, tableKey suivie, ancienne table libre', async () => {
      const world = await newEdition();
      const { meeting } = await acceptedMeeting(world, '10h45', 1);
      const response = await move(await organizerOf(world.edition), world.edition, meeting, { table: 3 });
      assert.equal(response.status, 200, response.text);
      assert.deepEqual(response.json, { id: meeting.documentId, status: 'accepted', location: 'Table 3', tableNumber: 3 });
      const row = await W.readMeeting(app(), meeting.documentId);
      assert.equal(row.tableKey, `${world.slots['10h45'].documentId}:3`);
      assert.equal(row.location, 'Table 3');
      const slot = (await (await organizerOf(world.edition)).get(`${base(world.edition)}/meetings`)).json.slots.find((entry) => entry.label === '10h45');
      assert.deepEqual(slot.freeTables, [1, 2]);
    });

    it('conflit résolu : la table bloquée est quittée, le conflit disparaît', async () => {
      const world = await newEdition();
      const { meeting } = await acceptedMeeting(world, '10h45', 1);
      const organizer = await organizerOf(world.edition);
      await block(organizer, world.edition, world.slots['10h45'], [1], false);
      assert.equal((await move(organizer, world.edition, meeting, { table: 2 })).status, 200);
      assert.equal((await organizer.get(`${base(world.edition)}/meetings`)).json.meetings[0].conflict, false);
    });

    it('table occupée : 409 NO_TABLE_LEFT, rien ne bouge', async () => {
      const world = await newEdition();
      const { meeting } = await acceptedMeeting(world, '10h45', 1);
      await acceptedMeeting(world, '10h45', 2);
      expectError(await move(await organizerOf(world.edition), world.edition, meeting, { table: 2 }), 409, 'NO_TABLE_LEFT');
      assert.equal((await W.readMeeting(app(), meeting.documentId)).tableNumber, 1);
    });

    it('table bloquée : 409 NO_TABLE_LEFT', async () => {
      const world = await newEdition();
      const { meeting } = await acceptedMeeting(world, '10h45', 1);
      const organizer = await organizerOf(world.edition);
      await block(organizer, world.edition, world.slots['10h45'], [2], false);
      expectError(await move(organizer, world.edition, meeting, { table: 2 }), 409, 'NO_TABLE_LEFT');
    });

    it('table dédiée d’un intervenant ou table hors de l’édition : 409 NO_TABLE_LEFT', async () => {
      const world = await newEdition();
      await person(world.edition, { role: 'speaker', hostedTableNumber: 2, meetingsOptIn: false });
      const { meeting } = await acceptedMeeting(world, '10h45', 1);
      const organizer = await organizerOf(world.edition);
      expectError(await move(organizer, world.edition, meeting, { table: 2 }), 409, 'NO_TABLE_LEFT');
      expectError(await move(organizer, world.edition, meeting, { table: 9 }), 409, 'NO_TABLE_LEFT');
    });

    it('créneau fermé : 409 SLOT_CLOSED', async () => {
      const world = await newEdition();
      const { meeting } = await acceptedMeeting(world, '10h45', 1);
      const organizer = await organizerOf(world.edition);
      await block(organizer, world.edition, world.slots['10h45'], [], true);
      expectError(await move(organizer, world.edition, meeting, { table: 3 }), 409, 'SLOT_CLOSED');
    });

    it('demande en attente : 409 INVALID_TRANSITION', async () => {
      const world = await newEdition();
      const { meeting } = await pendingMeeting(world);
      expectError(await move(await organizerOf(world.edition), world.edition, meeting, { table: 2 }), 409, 'INVALID_TRANSITION');
    });

    it('créneau commencé : 409 SLOT_PAST', async () => {
      const world = await newEdition({ daysAhead: -3 });
      const { meeting } = await acceptedMeeting(world, '10h45', 1);
      expectError(await move(await organizerOf(world.edition), world.edition, meeting, { table: 3 }), 409, 'SLOT_PAST');
    });

    it('404 MEETING_NOT_FOUND pour un rendez-vous d’une autre édition', async () => {
      const world = await newEdition();
      const other = await newEdition();
      const { meeting } = await acceptedMeeting(other, '10h45', 1);
      expectError(await move(await organizerOf(world.edition), world.edition, meeting, { table: 3 }), 404, 'MEETING_NOT_FOUND');
    });

    for (const [title, body] of [
      ['table absente', {}],
      ['table en texte', { table: '2' }],
      ['table nulle', { table: 0 }],
      ['table décimale', { table: 1.5 }],
    ]) {
      it(`400 VALIDATION : ${title}`, async () => {
        const world = await newEdition();
        const { meeting } = await acceptedMeeting(world, '10h45', 1);
        expectError(await move(await organizerOf(world.edition), world.edition, meeting, body), 400, 'VALIDATION');
        assert.equal((await W.readMeeting(app(), meeting.documentId)).tableNumber, 1);
      });
    }

    it('le déplacement n’envoie aucun e-mail', async () => {
      const world = await newEdition();
      const { requester, meeting } = await acceptedMeeting(world, '10h45', 1);
      await move(await organizerOf(world.edition), world.edition, meeting, { table: 2 });
      assert.equal((await W.settledEmailLogs(app(), requester, 'meeting-cancelled', { settleMs: 150 })).length, 0);
    });
  });
});
