'use strict';

/**
 * Routes organisateur de la phase 1, en session organisateur :
 *   - `POST /admin/:edition/slots/regenerate` (R-01, R-02, A-16) : créneaux, orphelins, avertissements, idempotence ;
 *   - `POST /admin/:edition/sync`, `GET /admin/:edition/sync-runs` (I-12, A-16, NF-01) ;
 *   - scénario de la porte de la phase 1 (section 7 du plan) : import idempotent sur le faux HelloAsso avec plus de 100 billets,
 *     renouvellement du jeton, T-06 (annulation, rendez-vous annulés, sessions refusées), synchronisations simultanées.
 *
 * Activées au lot 5 (la session organisateur vient du lot 5), avec le lot 2 pour les créneaux et le lot 4 pour la synchronisation.
 * Faux HelloAsso en module avec `tokenTtlSeconds: 61` (cache du jeton ramené à 1 s). Aucun réseau hors localhost.
 *
 * Réponses de l'architecte (section 11 du plan, points 8 et 9) : une synchronisation manuelle sans formulaire HelloAsso renseigné
 * répond 200 avec un SyncRun clos portant HELLOASSO_NOT_CONFIGURED ; `services/slots.js` expose `regenerate(editionDocumentId)` et
 * l'édition publiée sans date donne 409 EDITION_DATE_MISSING.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildEdgeCaseItems } = require('../../scripts/espace/fake-helloasso');
const defaultItems = require('../../scripts/espace/fixtures/helloasso-items.json');
const { sleep, useEspace } = require('../helpers/espace');
const { UID, createAttendee, createEdition, createProgram, link } = require('../helpers/espace-data');

const PORTE_ITEMS = [...defaultItems, ...buildEdgeCaseItems({ padding: 120 })];
const sortedPairs = (errors) => errors.map((error) => [String(error.itemId), error.code]).sort((a, b) => (a.join() < b.join() ? -1 : 1));

describe('routes organisateur (lots 2, 4 et 5)', { timeout: 600_000 }, () => {
  const espace = useEspace({ fake: { tokenTtlSeconds: 61, items: PORTE_ITEMS } });
  let counter = 0;

  // Édition ouverte : l'organisateur doit pouvoir se connecter (NF-52 ferme demande de lien et sessions d'une édition fermée).
  const newEdition = (options = {}) => {
    counter += 1;
    return createEdition(espace().app, { slug: `admin-${counter}`, title: `Administration ${counter}`, ...options });
  };
  /** Personne connectée par le parcours réel (demande, lien, vérification) : `fields` fixe son rôle ou ses réglages. */
  async function person(edition, fields = {}) {
    const { app, signIn } = espace();
    const attendee = await createAttendee(app, edition, { consentAt: new Date().toISOString(), ...fields });
    return { attendee, ...(await signIn(edition.slug, attendee.email)) };
  }
  const organizerOf = (edition) => person(edition, { role: 'organizer' });
  const post = (path, cookie, options = {}) => espace().request(path, { method: 'POST', cookie, ...options });
  const regenerate = (edition, cookie, options) => post(`/api/espace/admin/${edition.slug}/slots/regenerate`, cookie, options);
  const slotsOf = (edition) =>
    espace().app.documents(UID.slot).findMany({ filters: { edition: { documentId: edition.documentId } }, populate: ['session'], sort: 'startsAt:asc', limit: 1000 });

  describe('POST /admin/:edition/slots/regenerate : créneaux (R-01, R-02, A-16)', () => {
    const LABELS = ['10h45', '11h00', '12h30', '12h45', '13h00', '13h15', '13h30', '13h45', '15h30', '15h45'];

    async function editionWithProgram() {
      const edition = await newEdition();
      const sequences = await createProgram(espace().app, edition);
      return { edition, sequences, organizer: await organizerOf(edition) };
    }
    const changeSequence = async (sequence, data) => {
      const { app } = espace();
      await app.documents(UID.sequence).update({ documentId: sequence.documentId, data });
      await app.documents(UID.sequence).publish({ documentId: sequence.documentId });
    };

    it('génère les 10 créneaux de R-01 et rend { created, kept, removed, orphans, warnings }', async () => {
      const { edition, organizer } = await editionWithProgram();
      const response = await regenerate(edition, organizer.cookie);
      assert.equal(response.status, 200);
      assert.deepEqual(response.json, { created: 10, kept: 0, removed: 0, orphans: [], warnings: [] });
      assert.deepEqual((await slotsOf(edition)).map((slot) => slot.label), LABELS);
    });

    it('rattache chaque créneau à son édition et à sa pause, en UTC (3 décembre 2026, UTC+1)', async () => {
      const { edition, organizer, sequences } = await editionWithProgram();
      await regenerate(edition, organizer.cookie);
      const slots = await slotsOf(edition);
      assert.equal(new Date(slots[0].startsAt).toISOString(), '2026-12-03T09:45:00.000Z');
      assert.equal(new Date(slots.at(-1).endsAt).toISOString(), '2026-12-03T15:00:00.000Z');
      assert.deepEqual(slots.slice(0, 2).map((slot) => slot.session.documentId), [sequences[2].documentId, sequences[2].documentId]);
      assert.equal(slots[2].session.documentId, sequences[4].documentId);
    });

    it('est idempotent : le second passage donne 0 création et 0 suppression', async () => {
      const { edition, organizer } = await editionWithProgram();
      await regenerate(edition, organizer.cookie);
      const second = await regenerate(edition, organizer.cookie);
      assert.deepEqual(second.json, { created: 0, kept: 10, removed: 0, orphans: [], warnings: [] });
      assert.equal((await slotsOf(edition)).length, 10);
    });

    it('trois régénérations simultanées ne créent aucun doublon (verrou slots:, A-16)', async () => {
      const { edition, organizer } = await editionWithProgram();
      const responses = await Promise.all([1, 2, 3].map(() => regenerate(edition, organizer.cookie)));
      assert.ok(responses.every((response) => response.status === 200), responses.map((response) => response.status).join());
      const slots = await slotsOf(edition);
      assert.equal(slots.length, 10);
      assert.equal(new Set(slots.map((slot) => new Date(slot.startsAt).toISOString())).size, 10);
    });

    it('une pause sans heure de fin produit l’avertissement MISSING_END (critère 4 du lot 2)', async () => {
      const { edition, organizer, sequences } = await editionWithProgram();
      await changeSequence(sequences[7], { end_time: null });
      const response = await regenerate(edition, organizer.cookie);
      assert.equal(response.status, 200);
      assert.deepEqual(response.json.warnings, [{ sessionDocumentId: sequences[7].documentId, title: 'Pause et B2B', code: 'MISSING_END' }]);
    });

    it('ne lit que les séquences publiées : un changement resté en brouillon n’est pas pris en compte', async () => {
      const { edition, organizer, sequences } = await editionWithProgram();
      await espace().app.documents(UID.sequence).update({ documentId: sequences[7].documentId, data: { end_time: null } });
      assert.deepEqual((await regenerate(edition, organizer.cookie)).json.warnings, []);
    });

    it('R-02 : un créneau qui ne correspond plus à une pause mais porte des rendez-vous actifs devient orphelin, jamais supprimé', async () => {
      const { app } = espace();
      const { edition, organizer, sequences } = await editionWithProgram();
      await regenerate(edition, organizer.cookie);
      const [early, late] = await slotsOf(edition);
      const [requester, target, third, fourth] = await Promise.all([1, 2, 3, 4].map(() => createAttendee(app, edition, { meetingsOptIn: true })));
      const meeting = (data) => app.documents(UID.meeting).create({ data: { edition: link(edition), slot: link(late), ...data } });
      const pendingOne = await meeting({ requester: link(requester), targetAttendee: link(target), status: 'pending' });
      const acceptedOne = await meeting({ requester: link(third), targetAttendee: link(fourth), status: 'accepted', tableNumber: 1, tableKey: `${late.id}:1`, location: 'Table 1' });
      await meeting({ requester: link(fourth), targetAttendee: link(requester), status: 'declined' });
      await meeting({ requester: link(target), targetAttendee: link(third), status: 'cancelled' });

      await changeSequence(sequences[2], { kind: 'talk' }); // la pause du matin n'en est plus une
      const response = await regenerate(edition, organizer.cookie);
      assert.equal(response.status, 200);
      assert.equal(response.json.created, 0);
      assert.equal(response.json.kept, 8);
      assert.equal(response.json.removed, 1, 'le créneau de 10h45 n’a aucun rendez-vous : supprimé');
      assert.equal(response.json.orphans.length, 1);
      assert.equal(response.json.orphans[0].label, '11h00');
      assert.equal(response.json.orphans[0].activeMeetings, 2, 'un rendez-vous pending et un accepted comptent, pas les declined ni cancelled');
      assert.ok([late.documentId, String(late.id)].includes(String(response.json.orphans[0].id)), `identifiant d’orphelin ${response.json.orphans[0].id}`);

      const labels = (await slotsOf(edition)).map((slot) => slot.label);
      assert.ok(labels.includes('11h00') && !labels.includes('10h45'));
      assert.equal(early.label, '10h45');
      assert.equal((await app.documents(UID.meeting).findOne({ documentId: pendingOne.documentId })).status, 'pending');
      assert.equal((await app.documents(UID.meeting).findOne({ documentId: acceptedOne.documentId })).status, 'accepted');
    });

    it('R-02 : une fois les rendez-vous annulés, l’orphelin est supprimé au passage suivant', async () => {
      const { app } = espace();
      const { edition, organizer, sequences } = await editionWithProgram();
      await regenerate(edition, organizer.cookie);
      const [, late] = await slotsOf(edition);
      const [a, b] = await Promise.all([1, 2].map(() => createAttendee(app, edition)));
      const held = await app.documents(UID.meeting).create({ data: { edition: link(edition), slot: link(late), requester: link(a), targetAttendee: link(b), status: 'pending' } });
      await changeSequence(sequences[2], { kind: 'talk' });
      assert.equal((await regenerate(edition, organizer.cookie)).json.orphans.length, 1);
      await app.documents(UID.meeting).update({ documentId: held.documentId, data: { status: 'cancelled' } });
      const next = await regenerate(edition, organizer.cookie);
      assert.deepEqual([next.json.created, next.json.removed, next.json.orphans], [0, 1, []]);
      assert.ok(!(await slotsOf(edition)).some((slot) => slot.label === '11h00'));
    });

    it('réglage de l’édition : un pas de 30 minutes donne 5 créneaux', async () => {
      const edition = await newEdition({ settings: { slotDurationMinutes: 30 } });
      await createProgram(espace().app, edition);
      const organizer = await organizerOf(edition);
      const response = await regenerate(edition, organizer.cookie);
      assert.equal(response.json.created, 5);
    });

    it('édition publiée sans date : 409 EDITION_DATE_MISSING, aucun créneau créé', async () => {
      const edition = await newEdition({ settings: { date: null } });
      await createProgram(espace().app, edition);
      const organizer = await organizerOf(edition);
      const response = await regenerate(edition, organizer.cookie);
      assert.equal(response.status, 409);
      assert.equal(response.json.error.code, 'EDITION_DATE_MISSING');
      assert.ok(response.json.error.message.length > 0);
      assert.equal((await slotsOf(edition)).length, 0);
    });

    describe('services/slots.js : regenerate(editionDocumentId), appelable sans passer par la route (section 11, point 9)', () => {
      const service = () => espace().app.service('api::espace.slots');

      it('rend le rapport de la route : 10 créneaux créés, puis 10 gardés au second passage', async () => {
        const edition = await newEdition();
        await createProgram(espace().app, edition);
        assert.deepEqual(await service().regenerate(edition.documentId), { created: 10, kept: 0, removed: 0, orphans: [], warnings: [] });
        assert.deepEqual(await service().regenerate(edition.documentId), { created: 0, kept: 10, removed: 0, orphans: [], warnings: [] });
        assert.deepEqual((await slotsOf(edition)).map((slot) => slot.label), LABELS);
      });

      it('lève EDITION_DATE_MISSING (409) pour une édition publiée sans date', async () => {
        const edition = await newEdition({ settings: { date: null } });
        await assert.rejects(service().regenerate(edition.documentId), (error) => error.code === 'EDITION_DATE_MISSING' && error.status === 409);
      });

      it('plusieurs appels simultanés du service ne créent aucun doublon (verrou slots:, A-16)', async () => {
        const edition = await newEdition();
        await createProgram(espace().app, edition);
        await Promise.all([1, 2, 3].map(() => service().regenerate(edition.documentId)));
        assert.equal((await slotsOf(edition)).length, 10);
      });
    });

    it('refuse un participant (403 FORBIDDEN), une personne sans session (401) et l’organisateur d’une autre édition (403)', async () => {
      const { edition } = await editionWithProgram();
      const other = await newEdition();
      const participant = await person(edition);
      const foreignOrganizer = await organizerOf(other);
      const denied = await regenerate(edition, participant.cookie);
      assert.equal(denied.status, 403);
      assert.equal(denied.json.error.code, 'FORBIDDEN');
      assert.equal((await regenerate(edition, undefined)).status, 401);
      assert.equal((await regenerate(edition, foreignOrganizer.cookie)).status, 403);
      assert.equal((await slotsOf(edition)).length, 0, 'aucun créneau créé par une demande refusée');
    });

    it('exige un Origin admis (NF-04) : 403 ORIGIN_REFUSED sans Origin, même pour un organisateur', async () => {
      const { edition, organizer } = await editionWithProgram();
      const response = await regenerate(edition, organizer.cookie, { origin: null });
      assert.equal(response.status, 403);
      assert.equal(response.json.error.code, 'ORIGIN_REFUSED');
    });
  });

  describe('POST /admin/:edition/sync et GET /admin/:edition/sync-runs (I-12, A-16, NF-01)', () => {
    const syncRoute = (edition) => `/api/espace/admin/${edition.slug}/sync`;
    const runsRoute = (edition) => `/api/espace/admin/${edition.slug}/sync-runs`;

    it('lance la synchronisation en session organisateur : 200 avec le SyncRun { id, startedAt, endedAt, created, updated, cancelled, errors }', async () => {
      espace().fake.setItems(defaultItems);
      const edition = await newEdition();
      const organizer = await organizerOf(edition);
      const response = await post(syncRoute(edition), organizer.cookie);
      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(response.json).sort(), ['cancelled', 'created', 'endedAt', 'errors', 'id', 'startedAt', 'updated']);
      assert.deepEqual([response.json.created, response.json.updated, response.json.cancelled, response.json.errors], [16, 0, 0, []]);
      assert.ok(response.json.startedAt && response.json.endedAt);
    });

    it('refuse un participant (403), une personne sans session (401), l’organisateur d’une autre édition (403) et une requête sans Origin (403)', async () => {
      espace().fake.setItems(defaultItems);
      const edition = await newEdition();
      const other = await newEdition();
      const participant = await person(edition);
      const foreignOrganizer = await organizerOf(other);
      assert.equal((await post(syncRoute(edition), participant.cookie)).status, 403);
      assert.equal((await post(syncRoute(edition), undefined)).status, 401);
      assert.equal((await post(syncRoute(edition), foreignOrganizer.cookie)).status, 403);
      const organizer = await organizerOf(edition);
      const noOrigin = await post(syncRoute(edition), organizer.cookie, { origin: null });
      assert.equal(noOrigin.status, 403);
      assert.equal(noOrigin.json.error.code, 'ORIGIN_REFUSED');
      const attendees = await espace().app.documents(UID.attendee).count({ filters: { edition: { documentId: edition.documentId }, role: 'participant' } });
      assert.equal(attendees, 1, 'seul le participant de départ existe : aucun import lancé par une demande refusée');
    });

    it('deux synchronisations lancées en même temps : l’une réussit (200), l’autre reçoit 409 SYNC_RUNNING', async () => {
      espace().fake.setItems(PORTE_ITEMS);
      const edition = await newEdition();
      const organizer = await organizerOf(edition);
      const [first, second] = await Promise.all([post(syncRoute(edition), organizer.cookie), post(syncRoute(edition), organizer.cookie)]);
      const statuses = [first.status, second.status].sort();
      assert.deepEqual(statuses, [200, 409]);
      const refused = first.status === 409 ? first : second;
      assert.equal(refused.json.error.code, 'SYNC_RUNNING');
      assert.ok(refused.json.error.message.length > 0);
    });

    it('deux demandes simultanées ne créent qu’un SyncRun, et le perdant ne laisse aucune trace (A-16)', async () => {
      espace().fake.setItems(PORTE_ITEMS);
      const edition = await newEdition();
      const organizer = await organizerOf(edition);
      await Promise.all([post(syncRoute(edition), organizer.cookie), post(syncRoute(edition), organizer.cookie)]);
      const runs = await espace().query(UID.syncRun).findMany({ where: { edition: { documentId: edition.documentId } } });
      assert.equal(runs.length, 1);
      assert.ok(runs[0].endedAt, 'SyncRun non clos');
    });

    describe('formulaire HelloAsso absent ou en défaut : réponse 200 et SyncRun clos (section 11, point 8)', () => {
      it('édition sans formulaire HelloAsso renseigné : 200 avec HELLOASSO_NOT_CONFIGURED, rien créé', async () => {
        espace().fake.setItems(defaultItems);
        const edition = await newEdition({ settings: { helloassoOrgSlug: null, helloassoFormSlug: null } });
        const organizer = await organizerOf(edition);
        const response = await post(syncRoute(edition), organizer.cookie);
        assert.equal(response.status, 200);
        assert.deepEqual([response.json.created, response.json.updated, response.json.cancelled], [0, 0, 0]);
        assert.deepEqual(response.json.errors, [{ code: 'HELLOASSO_NOT_CONFIGURED' }]);
        assert.ok(response.json.endedAt, 'SyncRun non clos');
        const attendees = await espace().app.documents(UID.attendee).count({ filters: { edition: { documentId: edition.documentId }, role: 'participant' } });
        assert.equal(attendees, 0);
      });

      it('formulaire inconnu de HelloAsso : 200 avec FETCH_FAILED (statut 404), SyncRun clos, les autres routes répondent encore', async () => {
        espace().fake.setItems(defaultItems);
        const edition = await newEdition({ settings: { helloassoFormSlug: 'formulaire-inexistant' } });
        const organizer = await organizerOf(edition);
        const response = await post(syncRoute(edition), organizer.cookie);
        assert.equal(response.status, 200);
        assert.ok(response.json.errors.some((error) => error.code === 'FETCH_FAILED' && error.status === 404), JSON.stringify(response.json.errors));
        assert.ok(response.json.endedAt);
        const listed = await espace().request(runsRoute(edition), { cookie: organizer.cookie });
        assert.equal(listed.json.length, 1);
        assert.deepEqual(listed.json[0].errors, response.json.errors);
      });

      it('SyncRun d’erreur clos : la demande suivante n’est pas refusée en SYNC_RUNNING', async () => {
        espace().fake.setItems(defaultItems);
        const edition = await newEdition({ settings: { helloassoFormSlug: 'formulaire-inexistant' } });
        const organizer = await organizerOf(edition);
        assert.equal((await post(syncRoute(edition), organizer.cookie)).status, 200);
        assert.equal((await post(syncRoute(edition), organizer.cookie)).status, 200);
      });
    });

    it('sync-runs : les 10 derniers SyncRun, du plus récent au plus ancien', async () => {
      espace().fake.setItems(defaultItems);
      const edition = await newEdition();
      const organizer = await organizerOf(edition);
      const service = espace().app.service('api::espace.sync');
      for (let i = 0; i < 12; i += 1) await service.run(edition.documentId, { now: new Date(Date.UTC(2026, 9, 29, 8, i)) });
      const response = await espace().request(runsRoute(edition), { cookie: organizer.cookie });
      assert.equal(response.status, 200);
      assert.ok(Array.isArray(response.json));
      assert.equal(response.json.length, 10);
      const starts = response.json.map((run) => new Date(run.startedAt).getTime());
      assert.deepEqual([...starts].sort((a, b) => b - a), starts, 'ordre décroissant');
      assert.equal(new Date(starts[0]).toISOString(), '2026-10-29T08:11:00.000Z');
      assert.deepEqual(Object.keys(response.json[0]).sort(), ['cancelled', 'created', 'endedAt', 'errors', 'id', 'startedAt', 'updated']);
    });

    it('sync-runs ne mêle pas les éditions et reste réservé à l’organisateur de l’édition', async () => {
      espace().fake.setItems(defaultItems);
      const edition = await newEdition();
      const other = await newEdition();
      const organizer = await organizerOf(edition);
      const participant = await person(edition);
      await espace().app.service('api::espace.sync').run(edition.documentId);
      await espace().app.service('api::espace.sync').run(other.documentId);
      const own = await espace().request(runsRoute(edition), { cookie: organizer.cookie });
      assert.equal(own.json.length, 1);
      assert.equal((await espace().request(runsRoute(edition), { cookie: participant.cookie })).status, 403);
      assert.equal((await espace().request(runsRoute(edition))).status, 401);
      assert.equal((await espace().request(runsRoute(other), { cookie: organizer.cookie })).status, 403);
    });
  });

  describe('porte de la phase 1 : import du formulaire de test, idempotent (section 7, T-05, T-06)', () => {
    it('trois synchronisations de suite : import, idempotence avec renouvellement du jeton, puis annulations (T-06)', async () => {
      const { app, fake, outbox, signIn } = espace();
      fake.setItems(PORTE_ITEMS);
      const edition = await newEdition(); // publiée, ouverte, réglée sur xylofutur-test / Event / jib-nouvelle-aquitaine-test, sans Attendee
      const sync = (cookie) => post(`/api/espace/admin/${edition.slug}/sync`, cookie);
      const organizer = await signIn(edition.slug, 'organisation@example.org');
      const since = outbox().length;

      // 1. Première synchronisation.
      const first = await sync(organizer.cookie);
      assert.equal(first.status, 200);
      const firstCodes = sortedPairs(first.json.errors);
      for (const expected of [['910002', 'DUPLICATE_EMAIL'], ['910003', 'DUPLICATE_EMAIL'], ['910006', 'WAITING'], ['910010', 'UNKNOWN']]) {
        assert.ok(firstCodes.some(([id, code]) => id === expected[0] && code === expected[1]), `erreur ${expected.join(' ')} absente`);
      }
      assert.ok(first.json.created >= 138, `${first.json.created} créations`);
      assert.deepEqual([first.json.updated, first.json.cancelled], [0, 0]);
      const afterFirst = await app.documents(UID.attendee).findMany({ filters: { edition: { documentId: edition.documentId }, role: { $ne: 'organizer' } }, limit: 1000 });
      assert.equal(afterFirst.length, first.json.created);
      await sleep(800);
      const logsAfterFirst = await app.db.query(UID.emailLog).findMany({ where: { template: 'welcome', attendee: { edition: { documentId: edition.documentId } } } });
      assert.equal(logsAfterFirst.length, first.json.created, 'un welcome par Attendee créé');
      const tokensAfterFirst = fake.stats().tokenRequests;

      // 2. Seconde synchronisation, plus d'une seconde après : le jeton mis en cache a expiré.
      await sleep(1200);
      const second = await sync(organizer.cookie);
      assert.equal(second.status, 200);
      assert.deepEqual([second.json.created, second.json.updated, second.json.cancelled], [0, 0, 0]);
      assert.deepEqual(sortedPairs(second.json.errors), firstCodes, 'mêmes erreurs');
      const afterSecond = await app.documents(UID.attendee).findMany({ filters: { edition: { documentId: edition.documentId }, role: { $ne: 'organizer' } }, limit: 1000 });
      assert.equal(afterSecond.length, afterFirst.length);
      assert.equal(new Set(afterSecond.map((attendee) => attendee.email)).size, afterSecond.length, 'e-mail en double');
      assert.equal(new Set(afterSecond.map((attendee) => String(attendee.helloassoItemId))).size, afterSecond.length, 'billet en double');
      const runs = await app.db.query(UID.syncRun).findMany({ where: { edition: { documentId: edition.documentId } } });
      assert.equal(runs.length, 2);
      assert.ok(runs.every((run) => run.endedAt), '2 SyncRun clos');
      await sleep(500);
      assert.equal((await app.db.query(UID.emailLog).findMany({ where: { template: 'welcome', attendee: { edition: { documentId: edition.documentId } } } })).length, logsAfterFirst.length, 'aucun welcome de plus');
      assert.ok(fake.stats().tokenRequests > tokensAfterFirst, 'jeton renouvelé après expiration (I-10)');

      // 3. T-06 : deux Attendee annulés côté HelloAsso (Canceled et paiement Refunded), avec rendez-vous et session ouverte.
      const byEmail = (email) => afterSecond.find((attendee) => attendee.email === email);
      const [cancelledByState, cancelledByRefund, partnerOne, partnerTwo] = ['figurant.01@example.org', 'figurant.02@example.org', 'figurant.03@example.org', 'figurant.04@example.org'].map(byEmail);
      const sessionOne = await signIn(edition.slug, cancelledByState.email);
      const sessionTwo = await signIn(edition.slug, cancelledByRefund.email);
      const [, , pause] = await createProgram(app, edition);
      const slot = await app.documents(UID.slot).create({
        data: { edition: link(edition), session: link(pause), startsAt: '2026-12-03T09:45:00.000Z', endsAt: '2026-12-03T10:00:00.000Z', label: '10h45' },
      });
      const meeting = (data) => app.documents(UID.meeting).create({ data: { edition: link(edition), slot: link(slot), ...data } });
      const m1 = await meeting({ requester: link(cancelledByState), targetAttendee: link(partnerOne), status: 'pending' });
      const m2 = await meeting({ requester: link(partnerTwo), targetAttendee: link(cancelledByRefund), status: 'accepted', tableNumber: 1, tableKey: `${slot.id}:1`, location: 'Table 1' });

      fake.updateItem(920001, { state: 'Canceled' });
      fake.updateItem(920002, { payments: [{ id: 1, shareAmount: 3000, state: 'Refunded' }] });
      const mailsBefore = outbox().length;
      const third = await sync(organizer.cookie);
      assert.equal(third.status, 200);
      assert.equal(third.json.cancelled, 2);
      assert.equal(third.json.created, 0);

      for (const held of [m1, m2]) {
        const stored = await app.documents(UID.meeting).findOne({ documentId: held.documentId });
        assert.equal(stored.status, 'cancelled');
        assert.equal(stored.tableKey ?? null, null);
      }
      await sleep(600);
      const cancelledMails = outbox().slice(mailsBefore).filter((mail) => /Figurant Numero0[12]/.test(mail.text));
      assert.deepEqual(cancelledMails.map((mail) => mail.to.email).sort(), [partnerOne.email, partnerTwo.email].sort());
      assert.equal((await espace().request('/api/espace/me', { cookie: sessionOne.cookie })).status, 401);
      assert.equal((await espace().request('/api/espace/me', { cookie: sessionTwo.cookie })).status, 401);
      assert.equal((await app.documents(UID.attendee).findOne({ documentId: cancelledByState.documentId })).status, 'cancelled');
      assert.equal((await app.documents(UID.attendee).findOne({ documentId: cancelledByRefund.documentId })).status, 'cancelled');
    });
  });
});
