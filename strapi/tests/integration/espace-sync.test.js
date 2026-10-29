'use strict';

/**
 * Synchronisation HelloAsso, lot 4 de la phase 1 : I-10 à I-12, I-14, Q-03, Q-15, R-18, R-31, NF-11, NF-13,
 * T-05, T-06, A-16, A-17, A-19, plus le socle d'envoi (I-30, I-31) et les tâches planifiées (A-08).
 *
 * Les tests appellent les services (`api::espace.sync` `run(editionDocumentId, { now })`, `api::espace.meetings`
 * `cancelForAttendee`, `api::espace.mailer` `send`) contre le faux HelloAsso démarré en module : aucun réseau hors localhost,
 * aucun e-mail réel. Le parcours par les routes, en session organisateur, est dans `espace-admin.test.js` (lots 4 et 5).
 *
 * Corrections de la revue, lot 6b (section 11 du plan), livrées : rachat d'un billet par un Attendee annulé
 * (A-22), édition fermée et `meeting-cancelled` (NF-52), délai de réponse de HelloAsso (FETCH_FAILED).
 */

const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');

const { buildEdgeCaseItems } = require('../../scripts/espace/fake-helloasso');
const defaultItems = require('../../scripts/espace/fixtures/helloasso-items.json');
const { sleep, startEspace, useEspace } = require('../helpers/espace');
const { UID, createAttendee, createEdition, createProgram, link } = require('../helpers/espace-data');

const clone = (value) => structuredClone(value);
const itemFrom = (id) => clone(defaultItems.find((item) => item.id === id));
const sortedPairs = (errors) => errors.map((error) => [String(error.itemId), error.code]).sort((a, b) => (a.join() < b.join() ? -1 : 1));

describe('synchronisation HelloAsso contre le faux (lot 4)', { timeout: 300_000 }, () => {
  const espace = useEspace({ fake: true });
  let counter = 0;

  /** Édition de recette à part (créneaux, tables et formulaire du faux), `enabled` ouvre ou ferme l'espace. */
  const newEdition = (options = {}) => {
    counter += 1;
    return createEdition(espace().app, { slug: `sync-${counter}`, title: `Synchronisation ${counter}`, ...options });
  };
  const run = (edition, options) => espace().app.service('api::espace.sync').run(edition.documentId, options);
  const attendeesOf = (edition) => espace().app.documents(UID.attendee).findMany({ filters: { edition: { documentId: edition.documentId } }, limit: 1000 });
  const runsOf = (edition) => espace().query(UID.syncRun).findMany({ where: { edition: { documentId: edition.documentId } }, orderBy: { startedAt: 'asc' } });
  const logsOf = (edition, template) =>
    espace().query(UID.emailLog).findMany({ where: { template, attendee: { edition: { documentId: edition.documentId } } }, populate: ['attendee'] });
  const useItems = (items) => espace().fake.setItems(items);
  const counts = (result) => [result.created, result.updated, result.cancelled];

  describe('première synchronisation et idempotence (I-11, I-12, T-05, Q-15)', () => {
    it('importe les 16 billets actifs du jeu de recette et ignore le billet Canceled inconnu, sans erreur', async () => {
      useItems(defaultItems);
      const edition = await newEdition();
      const result = await run(edition);
      assert.deepEqual(counts(result), [16, 0, 0]);
      assert.deepEqual(result.errors, []);
      const attendees = await attendeesOf(edition);
      assert.equal(attendees.length, 16);
      assert.ok(!attendees.some((attendee) => attendee.email === 'lucas.darrigade@example.org'));
    });

    it('applique la correspondance de Q-03 : e-mail du champ Email, Organisation, Poste, rôle selon le tarif', async () => {
      useItems(defaultItems);
      const edition = await newEdition();
      await run(edition);
      const byEmail = Object.fromEntries((await attendeesOf(edition)).map((attendee) => [attendee.email, attendee]));
      const lea = byEmail['lea.ducasse@example.org'];
      assert.deepEqual([lea.firstName, lea.lastName, lea.company, lea.jobTitle, lea.role, lea.status], ['Léa', 'Ducasse', 'Charpentes du Pibal', 'Responsable bureau d’études', 'participant', 'active']);
      assert.equal(String(lea.helloassoItemId), '100001');
      assert.ok(byEmail['ines.castaing@example.org'], 'le billet payé par un secrétariat porte l’e-mail du champ Email');
      assert.ok(!byEmail['secretariat.merisier@example.org']);
      assert.equal(byEmail['benoit.tastet@example.org'].role, 'exhibitor_rep');
      assert.equal(byEmail['helene.marques@example.org'].role, 'speaker');
      assert.ok(!byEmail['benoit.tastet@example.org'].company, 'les tarifs Exposant n’ont pas de champ Organisation');
    });

    it('ne stocke ni téléphone, ni code postal, ni donnée de paiement (NF-11)', async () => {
      useItems(defaultItems);
      const edition = await newEdition();
      await run(edition);
      const text = JSON.stringify(await attendeesOf(edition));
      assert.ok(!/06 39 98|Code Postal|N° de téléphone|shareAmount|Authorized/.test(text));
      assert.ok(!/"(33000|40100|33800|33380|33600|64000|24000|87000|47000|33700)"/.test(text), 'code postal stocké');
    });

    it('écrit un SyncRun clos avec ses compteurs (NF-13)', async () => {
      useItems(defaultItems);
      const edition = await newEdition();
      const result = await run(edition);
      const [stored] = await runsOf(edition);
      assert.ok(stored.startedAt && stored.endedAt, 'SyncRun non clos');
      assert.ok(new Date(stored.endedAt) >= new Date(stored.startedAt));
      assert.deepEqual([stored.created, stored.updated, stored.cancelled], [16, 0, 0]);
      assert.deepEqual(stored.errors, []);
      assert.equal(result.created, 16);
    });

    it('prend l’heure en paramètre (A-19) : startedAt vaut le `now` donné', async () => {
      useItems(defaultItems);
      const edition = await newEdition();
      await run(edition, { now: new Date('2026-10-29T10:00:00.000Z') });
      assert.equal(new Date((await runsOf(edition))[0].startedAt).toISOString(), '2026-10-29T10:00:00.000Z');
    });

    it('seconde synchronisation : 0 création, 0 mise à jour, 0 annulation, aucune erreur, 2 SyncRun clos', async () => {
      useItems(defaultItems);
      const edition = await newEdition();
      await run(edition);
      const second = await run(edition);
      assert.deepEqual(counts(second), [0, 0, 0]);
      assert.deepEqual(second.errors, []);
      assert.equal((await attendeesOf(edition)).length, 16);
      const runs = await runsOf(edition);
      assert.equal(runs.length, 2);
      assert.ok(runs.every((stored) => stored.endedAt));
    });

    it('cas limites : crée les billets valables, consigne DUPLICATE_EMAIL, WAITING et UNKNOWN, puis donne 0, 0, 0 avec les mêmes erreurs', async () => {
      useItems([...defaultItems, ...buildEdgeCaseItems()]);
      const edition = await newEdition();
      const first = await run(edition);
      const codes = sortedPairs(first.errors);
      for (const expected of [['910002', 'DUPLICATE_EMAIL'], ['910003', 'DUPLICATE_EMAIL'], ['910006', 'WAITING'], ['910010', 'UNKNOWN']]) {
        assert.ok(codes.some(([id, code]) => id === expected[0] && code === expected[1]), `erreur ${expected.join(' ')} absente de ${JSON.stringify(codes)}`);
      }
      // 16 billets de recette + commande groupée (1) + « Zoe » + 20 figurants, plus le billet à e-mail invalide s’il est rattaché au payeur.
      assert.ok([38, 39].includes(first.created), `${first.created} créations`);

      const second = await run(edition);
      assert.deepEqual(counts(second), [0, 0, 0]);
      assert.deepEqual(sortedPairs(second.errors), codes, 'mêmes erreurs à la seconde synchronisation');
      assert.equal((await attendeesOf(edition)).length, first.created);
    });

    it('aucun doublon d’e-mail ni d’identifiant HelloAsso dans l’édition après deux synchronisations', async () => {
      useItems([...defaultItems, ...buildEdgeCaseItems({ padding: 120 })]);
      const edition = await newEdition();
      await run(edition);
      await run(edition);
      const attendees = await attendeesOf(edition);
      assert.equal(new Set(attendees.map((attendee) => attendee.email)).size, attendees.length, 'e-mail en double');
      assert.equal(new Set(attendees.map((attendee) => String(attendee.helloassoItemId))).size, attendees.length, 'billet en double');
      assert.ok(attendees.length > 130, `${attendees.length} Attendee`);
    });

    it('lit plus de 100 billets (deux pages) : les 120 figurants sont tous importés', async () => {
      useItems(buildEdgeCaseItems({ padding: 120 }));
      const edition = await newEdition({ enabled: false });
      await run(edition);
      assert.equal((await attendeesOf(edition)).filter((attendee) => /^figurant\.\d+@example\.org$/.test(attendee.email)).length, 120);
    });

    it('ne crée qu’un Attendee pour une commande groupée à e-mail commun (I-14)', async () => {
      useItems(buildEdgeCaseItems({ padding: 0 }));
      const edition = await newEdition({ enabled: false });
      await run(edition);
      const group = (await attendeesOf(edition)).filter((attendee) => attendee.email === 'groupe@example.org');
      assert.equal(group.length, 1);
      assert.equal(String(group[0].helloassoItemId), '910001');
    });

    it('un billet ajouté après coup est créé à la synchronisation suivante (created 1)', async () => {
      useItems(defaultItems);
      const edition = await newEdition();
      await run(edition);
      const added = itemFrom(100001);
      Object.assign(added, { id: 100099 });
      added.order = { ...added.order, id: 200099 };
      added.user = { firstName: 'Nina', lastName: 'Nouvelle' };
      added.customFields.find((field) => field.name === 'Email').answer = 'nina.nouvelle@example.org';
      useItems([...defaultItems, added]);
      const next = await run(edition);
      assert.deepEqual(counts(next), [1, 0, 0]);
      assert.ok((await attendeesOf(edition)).some((attendee) => attendee.email === 'nina.nouvelle@example.org'));
    });

    it('un billet Waiting puis Processed est créé au changement d’état', async () => {
      const waiting = itemFrom(100001);
      waiting.state = 'Waiting';
      useItems([waiting]);
      const edition = await newEdition();
      const first = await run(edition);
      assert.equal(first.created, 0);
      assert.ok(sortedPairs(first.errors).some(([id, code]) => id === '100001' && code === 'WAITING'));
      espace().fake.updateItem(100001, { state: 'Processed' });
      const second = await run(edition);
      assert.equal(second.created, 1);
      assert.deepEqual(second.errors, []);
    });
  });

  describe('annulation et réactivation (Q-15, R-18)', () => {
    it('un billet passé à Canceled annule l’Attendee (status cancelled), une seule fois', async () => {
      useItems(defaultItems);
      const edition = await newEdition({ enabled: false });
      await run(edition);
      espace().fake.updateItem(100001, { state: 'Canceled' });
      const result = await run(edition);
      assert.deepEqual(counts(result), [0, 0, 1]);
      const lea = (await attendeesOf(edition)).find((attendee) => attendee.email === 'lea.ducasse@example.org');
      assert.equal(lea.status, 'cancelled');
      assert.deepEqual(counts(await run(edition)), [0, 0, 0]);
    });

    it('un paiement Refunded annule aussi l’Attendee', async () => {
      useItems(defaultItems);
      const edition = await newEdition({ enabled: false });
      await run(edition);
      espace().fake.updateItem(100002, { payments: [{ id: 1, shareAmount: 3000, state: 'Refunded' }] });
      const result = await run(edition);
      assert.deepEqual(counts(result), [0, 0, 1]);
      assert.equal((await attendeesOf(edition)).find((attendee) => attendee.email === 'mathis.lagrange@example.org').status, 'cancelled');
    });

    for (const state of ['Refused', 'Deleted', 'Abandoned']) {
      it(`un billet passé à ${state} annule l’Attendee`, async () => {
        useItems(defaultItems);
        const edition = await newEdition({ enabled: false });
        await run(edition);
        espace().fake.updateItem(100003, { state });
        assert.equal((await run(edition)).cancelled, 1);
      });
    }

    it('un billet redevenu Processed réactive l’Attendee annulé (updated 1)', async () => {
      useItems(defaultItems);
      const edition = await newEdition({ enabled: false });
      await run(edition);
      espace().fake.updateItem(100001, { state: 'Canceled' });
      await run(edition);
      espace().fake.updateItem(100001, { state: 'Processed' });
      const result = await run(edition);
      assert.deepEqual(counts(result), [0, 1, 0]);
      assert.equal((await attendeesOf(edition)).find((attendee) => attendee.email === 'lea.ducasse@example.org').status, 'active');
    });

    it('un billet Canceled jamais importé est ignoré : ni Attendee ni erreur (Lucas Darrigade)', async () => {
      useItems(defaultItems);
      const edition = await newEdition({ enabled: false });
      const result = await run(edition);
      assert.deepEqual(result.errors, []);
      assert.equal((await attendeesOf(edition)).find((attendee) => attendee.email === 'lucas.darrigade@example.org'), undefined);
    });
  });

  describe('mises à jour : champs édités et champs réservés (R-31)', () => {
    const withAnswer = (item, name, answer) => {
      item.customFields.find((field) => field.name === name).answer = answer;
      return item;
    };

    it('met à jour un champ importé que le participant n’a pas modifié (Poste)', async () => {
      useItems(defaultItems);
      const edition = await newEdition({ enabled: false });
      await run(edition);
      useItems(defaultItems.map((item) => (item.id === 100001 ? withAnswer(clone(item), 'Poste', 'Directrice d’études') : item)));
      const result = await run(edition);
      assert.deepEqual(counts(result), [0, 1, 0]);
      assert.equal((await attendeesOf(edition)).find((attendee) => attendee.email === 'lea.ducasse@example.org').jobTitle, 'Directrice d’études');
    });

    it('n’écrase jamais un champ modifié par le participant (editedFields) ; les autres champs suivent', async () => {
      useItems(defaultItems);
      const edition = await newEdition({ enabled: false });
      await run(edition);
      const { app } = espace();
      const lea = (await attendeesOf(edition)).find((attendee) => attendee.email === 'lea.ducasse@example.org');
      await app.documents(UID.attendee).update({ documentId: lea.documentId, data: { jobTitle: 'Titre choisi par Léa', editedFields: ['jobTitle'] } });

      useItems(defaultItems.map((item) => (item.id === 100001 ? withAnswer(withAnswer(clone(item), 'Poste', 'Poste imposé par HelloAsso'), 'Organisation', 'Nouvelle société') : item)));
      await run(edition);
      const after = await app.documents(UID.attendee).findOne({ documentId: lea.documentId });
      assert.equal(after.jobTitle, 'Titre choisi par Léa');
      assert.equal(after.company, 'Nouvelle société');
    });

    it('suit un changement de nom côté HelloAsso tant que le participant ne l’a pas modifié', async () => {
      useItems(defaultItems);
      const edition = await newEdition({ enabled: false });
      await run(edition);
      espace().fake.updateItem(100003, { user: { firstName: 'Inès-Marie', lastName: 'Castaing' } });
      await run(edition);
      assert.equal((await attendeesOf(edition)).find((attendee) => attendee.email === 'ines.castaing@example.org').firstName, 'Inès-Marie');
    });

    it('ne touche jamais au rôle, au rattachement ni aux consentements', async () => {
      useItems(defaultItems);
      const edition = await newEdition({ enabled: false });
      await run(edition);
      const { app } = espace();
      const hugo = (await attendeesOf(edition)).find((attendee) => attendee.email === 'hugo.peyrat@example.org');
      const consentAt = '2026-10-01T08:00:00.000Z';
      await app.documents(UID.attendee).update({ documentId: hugo.documentId, data: { role: 'speaker', directoryOptIn: true, meetingsOptIn: true, newsOptIn: true, consentAt, bio: 'Présentation.' } });
      espace().fake.updateItem(100004, { name: 'Exposant', user: { firstName: 'Hugo', lastName: 'Peyrat-Changé' } });
      await run(edition);
      const after = await app.documents(UID.attendee).findOne({ documentId: hugo.documentId });
      assert.equal(after.role, 'speaker');
      assert.deepEqual([after.directoryOptIn, after.meetingsOptIn, after.newsOptIn], [true, true, true]);
      assert.equal(new Date(after.consentAt).toISOString(), consentAt);
      assert.equal(after.bio, 'Présentation.');
      assert.equal(after.lastName, 'Peyrat-Changé');
    });
  });

  describe('verrou de synchronisation (A-16)', () => {
    const isRunning = (error) => error?.code === 'SYNC_RUNNING' || error?.status === 409;

    it('deux synchronisations simultanées : l’une réussit, l’autre est refusée SYNC_RUNNING (409)', async () => {
      useItems([...defaultItems, ...buildEdgeCaseItems({ padding: 120 })]);
      const edition = await newEdition({ enabled: false });
      const before = (await runsOf(edition)).length;
      const results = await Promise.allSettled([run(edition), run(edition)]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const rejected = results.find((result) => result.status === 'rejected');
      assert.ok(rejected && isRunning(rejected.reason), `refus attendu SYNC_RUNNING, reçu ${rejected?.reason?.message}`);
      assert.equal((await runsOf(edition)).length, before + 1, 'un seul SyncRun créé');
      const attendees = await attendeesOf(edition);
      assert.equal(new Set(attendees.map((attendee) => attendee.email)).size, attendees.length);
    });

    it('cinq synchronisations simultanées : une seule passe', async () => {
      useItems(defaultItems);
      const edition = await newEdition({ enabled: false });
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => run(edition)));
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.ok(results.filter((result) => result.status === 'rejected').every((result) => isRunning(result.reason)));
    });

    it('un SyncRun ouvert depuis moins de 15 minutes bloque la synchronisation suivante', async () => {
      useItems(defaultItems);
      const edition = await newEdition({ enabled: false });
      await espace().app.documents(UID.syncRun).create({ data: { edition: link(edition), startedAt: new Date(Date.now() - 5 * 60_000).toISOString(), created: 0, updated: 0, cancelled: 0, errors: [] } });
      await assert.rejects(run(edition), isRunning);
    });

    it('un SyncRun resté ouvert depuis plus de 15 minutes (arrêt brutal) est ignoré', async () => {
      useItems(defaultItems);
      const edition = await newEdition({ enabled: false });
      await espace().app.documents(UID.syncRun).create({ data: { edition: link(edition), startedAt: new Date(Date.now() - 16 * 60_000).toISOString(), created: 0, updated: 0, cancelled: 0, errors: [] } });
      const result = await run(edition);
      assert.equal(result.created, 16);
    });

    it('un SyncRun clos ne bloque rien, et un SyncRun ouvert d’une autre édition non plus', async () => {
      useItems(defaultItems);
      const edition = await newEdition({ enabled: false });
      const other = await newEdition({ enabled: false });
      await espace().app.documents(UID.syncRun).create({ data: { edition: link(other), startedAt: new Date(Date.now() - 60_000).toISOString(), created: 0, updated: 0, cancelled: 0, errors: [] } });
      await run(edition);
      assert.equal((await run(edition)).created, 0);
    });
  });

  describe('A-17 : e-mail welcome', () => {
    const welcomeMails = (edition, attendees, since) => espace().outbox().slice(since).filter((mail) => attendees.some((attendee) => attendee.email === mail.to.email) && /\/espace\/verifier/.test(mail.text));

    it('part une fois vers chaque Attendee créé quand l’espace est ouvert, avec un lien de 72 heures vers l’accueil de l’édition', async () => {
      useItems(defaultItems);
      const edition = await newEdition();
      const since = espace().outbox().length;
      const t0 = Date.now();
      await run(edition);
      const attendees = await attendeesOf(edition);
      await sleep(500);
      const mails = welcomeMails(edition, attendees, since);
      assert.equal(mails.length, 16);
      assert.equal(new Set(mails.map((mail) => mail.to.email)).size, 16, 'un seul e-mail par personne');
      const { linkOf } = espace();
      for (const mail of mails.slice(0, 3)) {
        const found = linkOf(mail);
        assert.equal(found.next, `/espace/${edition.slug}/`);
        assert.match(found.token, /^[A-Za-z0-9_-]{43}$/);
      }
      const rows = await espace().query(UID.magicToken).findMany({ where: { kind: 'link', attendee: { edition: { documentId: edition.documentId } } } });
      assert.equal(rows.length, 16);
      for (const row of rows) assert.ok(Math.abs(new Date(row.expiresAt).getTime() - (t0 + 72 * 3600_000)) < 5 * 60_000, 'échéance à 72 heures');
      const logs = await logsOf(edition, 'welcome');
      assert.equal(logs.length, 16);
      assert.ok(logs.every((log) => log.status === 'sent'));
    });

    it('ne part pas deux fois : la seconde synchronisation n’envoie rien de plus (EmailLog et boîte de sortie)', async () => {
      useItems(defaultItems);
      const edition = await newEdition();
      const since = espace().outbox().length;
      await run(edition);
      await sleep(500);
      const attendees = await attendeesOf(edition);
      const sent = welcomeMails(edition, attendees, since).length;
      assert.equal(sent, 16);
      await run(edition);
      await sleep(500);
      assert.equal(welcomeMails(edition, attendees, since).length, sent);
      assert.equal((await logsOf(edition, 'welcome')).length, 16);
    });

    it('ne part pas quand l’espace est fermé, mais part à la première synchronisation après l’ouverture', async () => {
      useItems(defaultItems);
      const { app } = espace();
      const edition = await newEdition({ enabled: false });
      const since = espace().outbox().length;
      await run(edition);
      await sleep(500);
      assert.deepEqual(welcomeMails(edition, await attendeesOf(edition), since), [], 'e-mail envoyé alors que l’espace est fermé');
      assert.equal((await logsOf(edition, 'welcome')).length, 0);

      await app.documents(UID.edition).update({ documentId: edition.documentId, data: { participantSpaceEnabled: true } });
      await app.documents(UID.edition).publish({ documentId: edition.documentId });
      const reopened = await run(edition);
      assert.deepEqual(counts(reopened), [0, 0, 0]);
      await sleep(500);
      assert.equal((await logsOf(edition, 'welcome')).length, 16);
    });

    it('ne part pas vers un organisateur ni vers un Attendee annulé', async () => {
      useItems(defaultItems);
      const { app } = espace();
      const edition = await newEdition();
      const organizer = await createAttendee(app, edition, { email: 'responsable.xylofutur@example.org', role: 'organizer' });
      const cancelled = await createAttendee(app, edition, { email: 'ancien.inscrit@example.org', status: 'cancelled' });
      const since = espace().outbox().length;
      await run(edition);
      await sleep(500);
      assert.deepEqual(welcomeMails(edition, [organizer, cancelled], since), []);
      assert.equal((await logsOf(edition, 'welcome')).filter((log) => [organizer.email, cancelled.email].includes(log.attendee.email)).length, 0);
    });

    it('ne renvoie rien à qui a déjà un EmailLog welcome au statut sent (seed, synchronisation antérieure)', async () => {
      useItems(defaultItems);
      const { app } = espace();
      const edition = await newEdition();
      const known = await createAttendee(app, edition, { email: 'lea.ducasse@example.org', helloassoItemId: '100001', firstName: 'Léa', lastName: 'Ducasse' });
      await app.documents(UID.emailLog).create({ data: { attendee: link(known), template: 'welcome', status: 'sent', sentAt: new Date().toISOString(), scenarioKey: 'welcome' } });
      const since = espace().outbox().length;
      await run(edition);
      await sleep(500);
      assert.deepEqual(welcomeMails(edition, [known], since), []);
    });

    it('un envoi en échec est retenté à la synchronisation suivante', async () => {
      useItems(defaultItems);
      const edition = await newEdition();
      const outbox = espace().outboxFile;
      fs.rmSync(outbox, { force: true });
      fs.mkdirSync(outbox, { recursive: true }); // le fournisseur console ne peut plus écrire : tous les envois échouent
      try {
        await run(edition);
        await sleep(500);
        assert.equal((await logsOf(edition, 'welcome')).filter((log) => log.status === 'sent').length, 0);
      } finally {
        fs.rmSync(outbox, { recursive: true, force: true });
      }
      await run(edition);
      await sleep(500);
      assert.equal((await logsOf(edition, 'welcome')).filter((log) => log.status === 'sent').length, 16);
    });
  });

  describe('A-22 : un Attendee annulé qui rachète un billet est réactivé (lot 6b, section 11 du plan, défaut 3)', () => {
    const LEA = 'lea.ducasse@example.org';
    /** Les billets de recette, le billet 100001 de Léa annulé, et ses billets de rachat (même adresse, même bénéficiaire). */
    const withCancelledLea = (...extra) => [...defaultItems.map((item) => (item.id === 100001 ? { ...clone(item), state: 'Canceled' } : item)), ...extra];
    const purchase = (id, overrides = {}) => {
      const ticket = itemFrom(100001);
      Object.assign(ticket, { id, ...overrides });
      ticket.order = { ...ticket.order, id: 300000 + id };
      return ticket;
    };
    const lea = async (edition) => (await attendeesOf(edition)).find((attendee) => attendee.email === LEA);
    const welcomesTo = (edition, since) => espace().outbox().slice(since).filter((mail) => mail.to.email === LEA && /\/espace\/verifier/.test(mail.text) && /72/.test(mail.text));

    /** Édition ouverte, billets importés, Léa personnalisée puis annulée côté HelloAsso (billet 100001 Canceled). */
    async function cancelledLea() {
      const { app } = espace();
      useItems(defaultItems);
      const edition = await newEdition();
      await run(edition);
      await sleep(400);
      const before = await lea(edition);
      await app.documents(UID.attendee).update({
        documentId: before.documentId,
        data: { directoryOptIn: true, meetingsOptIn: true, newsOptIn: false, consentAt: '2026-10-01T08:00:00.000Z', editedFields: ['jobTitle'], jobTitle: 'Titre choisi par Léa', bio: 'Présentation de Léa.' },
      });
      useItems(withCancelledLea());
      assert.equal((await run(edition)).cancelled, 1);
      return { app, edition, documentId: before.documentId };
    }

    it('rattache l’Attendee annulé au nouveau billet : 0 création, 1 mise à jour, aucune erreur, aucun doublon', async () => {
      const { edition } = await cancelledLea();
      useItems(withCancelledLea(purchase(100099)));
      const result = await run(edition);
      assert.deepEqual(counts(result), [0, 1, 0]);
      assert.deepEqual(result.errors, []);
      assert.equal((await attendeesOf(edition)).length, 16, 'aucun Attendee de plus');
    });

    it('l’Attendee redevient actif sur le nouveau billet ; profil, consentements, rôle et editedFields intacts', async () => {
      const { app, edition, documentId } = await cancelledLea();
      useItems(withCancelledLea(purchase(100099)));
      await run(edition);
      const after = await app.documents(UID.attendee).findOne({ documentId });
      assert.equal(after.status, 'active');
      assert.equal(String(after.helloassoItemId), '100099');
      assert.equal(after.email, LEA);
      assert.deepEqual([after.directoryOptIn, after.meetingsOptIn, after.newsOptIn], [true, true, false]);
      assert.equal(new Date(after.consentAt).toISOString(), '2026-10-01T08:00:00.000Z');
      assert.deepEqual(after.editedFields, ['jobTitle']);
      assert.equal(after.jobTitle, 'Titre choisi par Léa', 'champ édité écrasé');
      assert.equal(after.bio, 'Présentation de Léa.');
      assert.equal(after.role, 'participant');
    });

    it('prend l’identifiant de commande du nouveau billet', async () => {
      const { app, edition, documentId } = await cancelledLea();
      useItems(withCancelledLea(purchase(100099)));
      await run(edition);
      assert.equal(String((await app.documents(UID.attendee).findOne({ documentId })).helloassoOrderId), String(300000 + 100099));
    });

    it('n’envoie aucun welcome de plus : l’EmailLog existe déjà', async () => {
      const { edition } = await cancelledLea();
      const since = espace().outbox().length;
      const logsBefore = (await logsOf(edition, 'welcome')).length;
      useItems(withCancelledLea(purchase(100099)));
      await run(edition);
      await sleep(500);
      assert.deepEqual(welcomesTo(edition, since), []);
      assert.equal((await logsOf(edition, 'welcome')).length, logsBefore);
    });

    it('la synchronisation suivante donne 0, 0, 0 sans erreur (l’ancien billet annulé est ignoré)', async () => {
      const { edition } = await cancelledLea();
      useItems(withCancelledLea(purchase(100099)));
      await run(edition);
      const next = await run(edition);
      assert.deepEqual(counts(next), [0, 0, 0]);
      assert.deepEqual(next.errors, []);
    });

    it('ses rendez-vous annulés le restent', async () => {
      const { app } = espace();
      useItems(defaultItems);
      const edition = await newEdition();
      await run(edition);
      await sleep(400);
      const attendees = await attendeesOf(edition);
      const [leaRow, other] = [attendees.find((a) => a.email === LEA), attendees.find((a) => a.email === 'mathis.lagrange@example.org')];
      const [, , pause] = await createProgram(app, edition);
      const slot = await app.documents(UID.slot).create({ data: { edition: link(edition), session: link(pause), startsAt: '2026-12-03T09:45:00.000Z', endsAt: '2026-12-03T10:00:00.000Z', label: '10h45' } });
      const held = await app.documents(UID.meeting).create({ data: { edition: link(edition), slot: link(slot), requester: link(leaRow), targetAttendee: link(other), status: 'pending' } });
      useItems(withCancelledLea());
      await run(edition);
      assert.equal((await app.documents(UID.meeting).findOne({ documentId: held.documentId })).status, 'cancelled');
      useItems(withCancelledLea(purchase(100099)));
      await run(edition);
      assert.equal((await app.documents(UID.meeting).findOne({ documentId: held.documentId })).status, 'cancelled');
      assert.equal((await lea(edition)).status, 'active');
    });

    it('la personne peut de nouveau se connecter : sans lien tant qu’elle est annulée, avec un lien après le rachat', async () => {
      const { edition } = await cancelledLea();
      const { request, mailsSince, outbox, signIn } = espace();
      const since = outbox().length;
      assert.equal((await request('/api/espace/auth/request-link', { method: 'POST', json: { editionSlug: edition.slug, email: LEA } })).status, 202);
      assert.deepEqual(await mailsSince(since, { to: LEA }), [], 'lien envoyé à un inscrit annulé');
      useItems(withCancelledLea(purchase(100099)));
      await run(edition);
      const session = await signIn(edition.slug, LEA);
      assert.equal(session.me.firstName, 'Léa');
    });

    it('avec deux billets actifs B et C à cette adresse : B rattaché, C en DUPLICATE_EMAIL, puis mêmes erreurs et 0, 0, 0', async () => {
      const { edition } = await cancelledLea();
      useItems(withCancelledLea(purchase(100098), purchase(100099)));
      const first = await run(edition);
      assert.deepEqual(counts(first), [0, 1, 0]);
      assert.deepEqual(sortedPairs(first.errors), [['100099', 'DUPLICATE_EMAIL']]);
      assert.equal(String((await lea(edition)).helloassoItemId), '100098');
      const second = await run(edition);
      assert.deepEqual(counts(second), [0, 0, 0]);
      assert.deepEqual(sortedPairs(second.errors), [['100099', 'DUPLICATE_EMAIL']]);
    });

    it('un Attendee annulé pendant cette synchronisation n’est rattaché qu’à la suivante', async () => {
      useItems(defaultItems);
      const edition = await newEdition({ enabled: false });
      await run(edition); // Léa active sur 100001
      useItems(withCancelledLea(purchase(100099)));
      const first = await run(edition);
      assert.deepEqual(counts(first), [0, 0, 1]);
      assert.deepEqual(sortedPairs(first.errors), [['100099', 'DUPLICATE_EMAIL']]);
      assert.equal((await lea(edition)).status, 'cancelled');
      const second = await run(edition);
      assert.deepEqual(counts(second), [0, 1, 0]);
      assert.deepEqual(second.errors, []);
      assert.equal((await lea(edition)).status, 'active');
    });

    it('un billet annulé qui redevient actif réactive le même billet, sans rattachement à un autre (Q-15, inchangé)', async () => {
      const { edition } = await cancelledLea();
      useItems(defaultItems);
      const result = await run(edition);
      assert.deepEqual(counts(result), [0, 1, 0]);
      assert.equal(String((await lea(edition)).helloassoItemId), '100001');
    });
  });

  describe('T-06, R-18 : annulation et rendez-vous annulés avec meeting-cancelled', () => {
    /**
     * Édition ouverte (NF-52 coupe tout envoi d'une édition fermée, meeting-cancelled compris), billets de recette importés,
     * un créneau, et un exposant à 2 représentants (R-14).
     */
    async function scene({ enabled = true } = {}) {
      const { app } = espace();
      useItems(defaultItems);
      const edition = await newEdition({ enabled });
      await run(edition); // importe les billets de recette et envoie les welcome (espace ouvert seulement)
      await sleep(500);
      const attendees = Object.fromEntries((await attendeesOf(edition)).map((attendee) => [attendee.email, attendee]));
      const [, , pause] = await createProgram(app, edition);
      const slot = await app.documents(UID.slot).create({
        data: { edition: link(edition), session: link(pause), startsAt: '2026-12-03T09:45:00.000Z', endsAt: '2026-12-03T10:00:00.000Z', label: '10h45' },
      });
      const organisation = await app.documents(UID.organisation).create({ data: { name: 'Sylvadour de scène', slug: `scene-${edition.slug}`, description: 'Fictive.' }, status: 'published' });
      const exhibitor = await app.documents(UID.exhibitor).create({ data: { edition: link(edition), organisation: link(organisation), standNumber: '4' } });
      await app.documents(UID.attendee).update({ documentId: attendees['benoit.tastet@example.org'].documentId, data: { exhibitor: link(exhibitor), role: 'exhibitor_rep' } });
      await app.documents(UID.attendee).update({ documentId: attendees['marion.lacoste@example.org'].documentId, data: { exhibitor: link(exhibitor), role: 'exhibitor_rep' } });
      const meeting = (data) => app.documents(UID.meeting).create({ data: { edition: link(edition), slot: link(slot), ...data } });
      return { app, edition, attendees, slot, exhibitor, meeting };
    }
    const statusOf = async (app, meeting) => (await app.documents(UID.meeting).findOne({ documentId: meeting.documentId })).status;

    it('Attendee cancelled : ses rendez-vous pending et accepted passent à cancelled, avec motif, date et table libérée', async () => {
      const { app, edition, attendees, meeting, exhibitor } = await scene();
      const lea = attendees['lea.ducasse@example.org'];
      const mathis = attendees['mathis.lagrange@example.org'];
      const sent = await meeting({ requester: link(lea), targetAttendee: link(mathis), status: 'pending' });
      const received = await meeting({ requester: link(mathis), targetAttendee: link(lea), status: 'accepted', tableNumber: 1, tableKey: 'tk:1', location: 'Table 1' });
      const toStand = await meeting({ requester: link(lea), targetExhibitor: link(exhibitor), status: 'pending' });
      const declined = await meeting({ requester: link(lea), targetAttendee: link(mathis), status: 'declined' });
      const unrelated = await meeting({ requester: link(attendees['ines.castaing@example.org']), targetAttendee: link(attendees['hugo.peyrat@example.org']), status: 'accepted', tableNumber: 2, tableKey: 'tk:2', location: 'Table 2' });

      espace().fake.updateItem(100001, { state: 'Canceled' });
      const result = await run(edition);
      assert.equal(result.cancelled, 1);

      for (const cancelled of [sent, received, toStand]) {
        const stored = await app.documents(UID.meeting).findOne({ documentId: cancelled.documentId });
        assert.equal(stored.status, 'cancelled');
        assert.equal(stored.cancelReason, 'Inscription annulée');
        assert.ok(stored.cancelledAt, 'cancelledAt');
        assert.equal(stored.tableKey ?? null, null, 'la table doit être libérée');
      }
      assert.equal(await statusOf(app, declined), 'declined');
      assert.equal(await statusOf(app, unrelated), 'accepted');
      assert.equal((await app.documents(UID.meeting).findOne({ documentId: unrelated.documentId })).tableKey, 'tk:2');
    });

    it('notifie l’autre partie par meeting-cancelled : la cible personnelle, le demandeur, les représentants actifs de l’exposant', async () => {
      const { edition, attendees, meeting, exhibitor } = await scene();
      const lea = attendees['lea.ducasse@example.org'];
      const mathis = attendees['mathis.lagrange@example.org'];
      await meeting({ requester: link(lea), targetAttendee: link(mathis), status: 'pending' });
      await meeting({ requester: link(mathis), targetAttendee: link(lea), status: 'accepted', tableNumber: 1, tableKey: 'tk:3', location: 'Table 1' });
      await meeting({ requester: link(lea), targetExhibitor: link(exhibitor), status: 'pending' });

      const since = espace().outbox().length;
      espace().fake.updateItem(100001, { state: 'Canceled' });
      await run(edition);
      await sleep(600);
      const mails = espace().outbox().slice(since).filter((mail) => /Léa Ducasse/.test(mail.text));
      const recipients = mails.map((mail) => mail.to.email).sort();
      assert.deepEqual(recipients, ['benoit.tastet@example.org', 'marion.lacoste@example.org', 'mathis.lagrange@example.org', 'mathis.lagrange@example.org']);
      assert.ok(!recipients.includes('lea.ducasse@example.org'), 'la personne annulée ne reçoit rien');
      for (const mail of mails) {
        assert.match(mail.text, /10h45/);
      }
      const logs = await logsOf(edition, 'meeting-cancelled');
      assert.equal(logs.length, 4);
    });

    it('un exposant annulé : les demandes visant son stand restent en place tant qu’un autre représentant est actif (R-14)', async () => {
      const { app, edition, attendees, meeting, exhibitor } = await scene();
      const visitor = attendees['hugo.peyrat@example.org'];
      const toStand = await meeting({ requester: link(visitor), targetExhibitor: link(exhibitor), status: 'pending' });
      const ownRequest = await meeting({ requester: link(attendees['benoit.tastet@example.org']), targetAttendee: link(attendees['eva.cazaux@example.org']), status: 'pending' });

      espace().fake.updateItem(100015, { state: 'Canceled' });
      await run(edition);
      assert.equal(await statusOf(app, toStand), 'pending', 'la demande au stand doit rester');
      assert.equal(await statusOf(app, ownRequest), 'cancelled', 'sa propre demande est annulée');
    });

    it('cancelForAttendee est idempotent : un second appel n’annule ni ne notifie plus rien', async () => {
      const { app, edition, attendees, meeting } = await scene();
      const lea = attendees['lea.ducasse@example.org'];
      await meeting({ requester: link(lea), targetAttendee: link(attendees['mathis.lagrange@example.org']), status: 'pending' });
      await app.documents(UID.attendee).update({ documentId: lea.documentId, data: { status: 'cancelled' } });
      const service = app.service('api::espace.meetings');
      const fresh = await app.documents(UID.attendee).findOne({ documentId: lea.documentId, populate: ['edition', 'exhibitor'] });
      await service.cancelForAttendee(fresh, { reason: 'Inscription annulée', now: new Date('2026-10-29T10:00:00.000Z') });
      await sleep(400);
      const sent = espace().outbox().length;
      await service.cancelForAttendee(fresh, { reason: 'Inscription annulée', now: new Date('2026-10-29T10:05:00.000Z') });
      await sleep(400);
      assert.equal(espace().outbox().length, sent);
      assert.equal((await logsOf(edition, 'meeting-cancelled')).length, 1);
    });

    describe('édition fermée (NF-52, section 11 du plan, point 7 et défaut 6)', () => {
      const attendeesMails = (attendees, since) => espace().outbox().slice(since).filter((mail) => attendees.some((attendee) => attendee.email === mail.to.email));
      const tokensOf = (edition) => espace().query(UID.magicToken).count({ where: { attendee: { edition: { documentId: edition.documentId } } } });

      async function closedScene() {
        const context = await scene({ enabled: false });
        const { attendees, meeting, exhibitor } = context;
        const lea = attendees['lea.ducasse@example.org'];
        const mathis = attendees['mathis.lagrange@example.org'];
        const meetings = {
          sent: await meeting({ requester: link(lea), targetAttendee: link(mathis), status: 'pending' }),
          received: await meeting({ requester: link(mathis), targetAttendee: link(lea), status: 'accepted', tableNumber: 1, tableKey: 'tk:closed-1', location: 'Table 1' }),
          toStand: await meeting({ requester: link(lea), targetExhibitor: link(exhibitor), status: 'pending' }),
        };
        return { ...context, lea, mathis, meetings };
      }

      it('annule les rendez-vous de l’inscrit annulé (tableKey à null) sans écrire une ligne dans la boîte de sortie', async () => {
        const { app, edition, attendees, meetings } = await closedScene();
        const since = espace().outbox().length;
        espace().fake.updateItem(100001, { state: 'Canceled' });
        assert.equal((await run(edition)).cancelled, 1);
        await sleep(600);
        for (const held of Object.values(meetings)) {
          const stored = await app.documents(UID.meeting).findOne({ documentId: held.documentId });
          assert.equal(stored.status, 'cancelled');
          assert.equal(stored.cancelReason, 'Inscription annulée');
          assert.equal(stored.tableKey ?? null, null);
        }
        assert.deepEqual(attendeesMails(Object.values(attendees), since), [], 'e-mail envoyé pour une édition fermée');
      });

      it('n’émet aucun lien d’action ni aucun EmailLog meeting-cancelled', async () => {
        const { edition } = await closedScene();
        const tokensBefore = await tokensOf(edition);
        espace().fake.updateItem(100001, { state: 'Canceled' });
        await run(edition);
        await sleep(300);
        assert.equal(await tokensOf(edition), tokensBefore, 'MagicToken créé pour une édition fermée');
        assert.equal((await logsOf(edition, 'meeting-cancelled')).length, 0);
      });

      it('l’Attendee est quand même passé à cancelled et la synchronisation se clôt sans erreur', async () => {
        const { app, edition, lea } = await closedScene();
        espace().fake.updateItem(100001, { state: 'Canceled' });
        const result = await run(edition);
        assert.deepEqual(result.errors, []);
        assert.equal((await app.documents(UID.attendee).findOne({ documentId: lea.documentId })).status, 'cancelled');
      });

      it('cancelForAttendee appelé directement sur une édition fermée : mêmes effets', async () => {
        const { app, edition, attendees, meetings } = await closedScene();
        const lea = await app.documents(UID.attendee).findOne({ documentId: attendees['lea.ducasse@example.org'].documentId, populate: ['edition', 'exhibitor'] });
        const since = espace().outbox().length;
        const tokensBefore = await tokensOf(edition);
        await app.service('api::espace.meetings').cancelForAttendee(lea, { reason: 'Inscription annulée', now: new Date('2026-10-29T10:00:00.000Z') });
        await sleep(400);
        assert.equal((await app.documents(UID.meeting).findOne({ documentId: meetings.received.documentId })).status, 'cancelled');
        assert.deepEqual(attendeesMails(Object.values(attendees), since), []);
        assert.equal(await tokensOf(edition), tokensBefore);
      });

      it('rouverte, l’édition notifie de nouveau : le même scénario sur une édition ouverte envoie meeting-cancelled', async () => {
        const { app, edition, attendees, meeting } = await scene();
        const since = espace().outbox().length;
        await meeting({ requester: link(attendees['lea.ducasse@example.org']), targetAttendee: link(attendees['mathis.lagrange@example.org']), status: 'pending' });
        espace().fake.updateItem(100001, { state: 'Canceled' });
        await run(edition);
        await sleep(600);
        assert.equal(attendeesMails(Object.values(attendees), since).filter((mail) => /Léa Ducasse/.test(mail.text)).length, 1);
        assert.equal((await logsOf(edition, 'meeting-cancelled')).length, 1);
        assert.ok(app);
      });
    });
  });

  describe('HelloAsso en défaut : SyncRun d’erreur, Strapi debout, aucun secret dans les journaux (critère 6)', () => {
    it('formulaire inconnu : SyncRun clos avec { code: FETCH_FAILED, status: 404 }, aucun Attendee touché', async () => {
      useItems(defaultItems);
      const edition = await newEdition({ enabled: false, settings: { helloassoFormSlug: 'formulaire-inexistant' } });
      const result = await run(edition);
      assert.deepEqual(counts(result), [0, 0, 0]);
      assert.ok(result.errors.some((error) => error.code === 'FETCH_FAILED' && error.status === 404), JSON.stringify(result.errors));
      const [stored] = await runsOf(edition);
      assert.ok(stored.endedAt, 'SyncRun non clos');
      assert.equal((await attendeesOf(edition)).length, 0);
    });

    it('n’écrit ni le secret du client ni un jeton d’accès dans les journaux', async () => {
      const { app } = espace();
      const lines = [];
      const saved = {};
      for (const level of ['error', 'warn', 'info', 'http', 'debug']) {
        saved[level] = { own: Object.hasOwn(app.log, level), value: app.log[level] };
        app.log[level] = (...args) => lines.push(args.map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' '));
      }
      try {
        useItems(defaultItems);
        await run(await newEdition({ enabled: false, settings: { helloassoFormSlug: 'formulaire-inexistant' } }));
        await run(await newEdition({ enabled: false }));
      } finally {
        for (const [level, { own, value }] of Object.entries(saved)) {
          if (own) app.log[level] = value;
          else delete app.log[level];
        }
      }
      const text = lines.join('\n');
      assert.ok(!text.includes('fake-client-secret'), 'secret du client dans les journaux');
      assert.ok(!/Bearer\s+[0-9a-f]{16,}/i.test(text), 'jeton d’accès dans les journaux');
    });

    it('HelloAsso injoignable : SyncRun d’erreur FETCH_FAILED, et Strapi continue de répondre', async () => {
      const { fake, request } = espace();
      useItems(defaultItems);
      const edition = await newEdition({ enabled: false });
      await fake.close();
      const result = await run(edition);
      assert.deepEqual(counts(result), [0, 0, 0]);
      assert.ok(result.errors.some((error) => error.code === 'FETCH_FAILED'), JSON.stringify(result.errors));
      assert.ok((await runsOf(edition))[0].endedAt);
      assert.equal((await request('/api/espace/health')).status, 200);
    });
  });
});

/**
 * Faux HelloAsso qui ne répond jamais, local : `tokenOk` fait répondre à la seule demande de jeton. Il consigne ce qu'il reçoit
 * (méthode et chemin) pour prouver que l'échec vient bien du délai, pas d'une connexion refusée.
 */
function startHangingHelloAsso() {
  const sockets = new Set();
  const state = { tokenOk: false, requests: [] };
  const server = http.createServer((req, res) => {
    state.requests.push(`${req.method} ${req.url.split('?')[0]}`);
    req.resume();
    if (state.tokenOk && req.url.startsWith('/oauth2/token')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'jeton-factice-0123456789abcdef', token_type: 'bearer', expires_in: 1800, refresh_token: 'renouvellement-factice' }));
    }
    // Toute autre requête reste sans réponse.
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({
        state,
        apiBase: `http://127.0.0.1:${server.address().port}/v5`,
        close: () => new Promise((done) => {
          for (const socket of sockets) socket.destroy();
          server.close(done);
        }),
      })
    );
  });
}

describe('HelloAsso qui ne répond pas : requête abandonnée, SyncRun clos en FETCH_FAILED (lot 6b, section 11 du plan, point 7)', { timeout: 180_000 }, () => {
  let hanging;
  let instance;
  let failure;
  const espace = () => {
    if (failure) throw failure;
    return instance;
  };
  let counter = 0;
  const realTimeout = AbortSignal.timeout;

  before(async () => {
    hanging = await startHangingHelloAsso();
    try {
      instance = await startEspace({ overrides: { HELLOASSO_API_BASE: hanging.apiBase, HELLOASSO_CLIENT_ID: 'fake-client-id', HELLOASSO_CLIENT_SECRET: 'fake-client-secret' } });
    } catch (error) {
      failure = error;
    }
  });
  after(async () => {
    AbortSignal.timeout = realTimeout;
    await instance?.stop();
    await hanging?.close();
  });

  /**
   * Le client abandonne chaque requête par `AbortSignal.timeout(timeoutMs)` (20 s par défaut). Le test ramène ce délai à 200 ms le temps
   * d'une synchronisation, sans toucher à la configuration de Strapi ; il est rétabli aussitôt.
   */
  async function syncWithShortTimeout() {
    counter += 1;
    const edition = await createEdition(espace().app, { slug: `hang-${counter}`, title: `HelloAsso muet ${counter}`, enabled: false });
    AbortSignal.timeout = () => realTimeout.call(AbortSignal, 200);
    const started = Date.now();
    try {
      const result = await espace().app.service('api::espace.sync').run(edition.documentId);
      return { edition, result, durationMs: Date.now() - started };
    } finally {
      AbortSignal.timeout = realTimeout;
    }
  }
  const runsOf = (edition) => espace().query(UID.syncRun).findMany({ where: { edition: { documentId: edition.documentId } } });

  it('jeton qui ne répond pas : SyncRun clos avec FETCH_FAILED sans statut, aucun Attendee, Strapi debout', { timeout: 30_000 }, async () => {
    hanging.state.tokenOk = false;
    const { edition, result } = await syncWithShortTimeout();
    assert.deepEqual([result.created, result.updated, result.cancelled], [0, 0, 0]);
    assert.ok(result.errors.some((error) => error.code === 'FETCH_FAILED' && (error.status ?? null) === null), JSON.stringify(result.errors));
    assert.ok(hanging.state.requests.some((line) => line.startsWith('POST /oauth2/token')), `requêtes reçues : ${hanging.state.requests}`);
    const [stored] = await runsOf(edition);
    assert.ok(stored.endedAt, 'SyncRun non clos');
    assert.equal((await espace().request('/api/espace/health')).status, 200);
  });

  it('billets qui ne répondent pas alors que le jeton est obtenu : même résultat', { timeout: 30_000 }, async () => {
    hanging.state.tokenOk = true;
    hanging.state.requests.length = 0;
    const { edition, result } = await syncWithShortTimeout();
    assert.ok(result.errors.some((error) => error.code === 'FETCH_FAILED' && (error.status ?? null) === null), JSON.stringify(result.errors));
    assert.ok(hanging.state.requests.some((line) => /GET \/v5\/organizations\/.*\/items$/.test(line)), `requêtes reçues : ${hanging.state.requests}`);
    assert.ok((await runsOf(edition))[0].endedAt);
  });

  it('la synchronisation suivante n’est pas bloquée : le SyncRun abandonné est clos, pas de SYNC_RUNNING', { timeout: 30_000 }, async () => {
    hanging.state.tokenOk = true;
    counter += 1;
    const edition = await createEdition(espace().app, { slug: `hang-${counter}`, title: `HelloAsso muet ${counter}`, enabled: false });
    const service = espace().app.service('api::espace.sync');
    AbortSignal.timeout = () => realTimeout.call(AbortSignal, 150);
    try {
      await service.run(edition.documentId);
      const second = await service.run(edition.documentId);
      assert.ok(second.errors.some((error) => error.code === 'FETCH_FAILED'));
    } finally {
      AbortSignal.timeout = realTimeout;
    }
    assert.equal((await runsOf(edition)).length, 2);
  });
});

describe('socle d’envoi et configuration absente, sans faux HelloAsso (lots 2 et 4)', { timeout: 180_000 }, () => {
  const espace = useEspace();
  let counter = 0;
  const newEdition = (options) => {
    counter += 1;
    return createEdition(espace().app, { slug: `socle-${counter}`, title: `Socle ${counter}`, ...options });
  };

  describe('services/mailer.js : send({ attendee, template, data, scenarioKey }) (I-30, I-31)', () => {
    const data = (edition) => ({ edition: { slug: edition.slug, title: edition.title, themeColor: '#600e24' }, publicUrl: espace().publicUrl, firstName: 'Léa', url: `${espace().publicUrl}/espace/verifier?token=jeton-factice&next=%2Fespace%2F${edition.slug}%2F`, validityHours: 72 });

    it('rend le gabarit, écrit une ligne dans la boîte de sortie et un EmailLog sent, puis renvoie { status, messageId }', async () => {
      const { app, outbox } = espace();
      const edition = await newEdition();
      const attendee = await createAttendee(app, edition, { email: 'lea.mailer@example.org', firstName: 'Léa' });
      const since = outbox().length;
      const result = await app.service('api::espace.mailer').send({ attendee, template: 'welcome', data: data(edition), scenarioKey: 'welcome' });
      assert.equal(result.status, 'sent');
      assert.ok(result.messageId);
      const [mail, ...others] = outbox().slice(since);
      assert.deepEqual(others, []);
      assert.equal(mail.to.email, 'lea.mailer@example.org');
      assert.ok(mail.subject && mail.html.includes('Léa') && mail.text.includes('jeton-factice'));
      assert.equal(mail.messageId, result.messageId);

      const [log] = await app.db.query(UID.emailLog).findMany({ where: { attendee: { documentId: attendee.documentId } } });
      assert.equal(log.template, 'welcome');
      assert.equal(log.scenarioKey, 'welcome');
      assert.equal(log.status, 'sent');
      assert.equal(log.providerMessageId, result.messageId);
      assert.ok(log.sentAt);
    });

    it('ne lève jamais d’erreur sur un échec d’envoi : statut failed, EmailLog failed, rien dans la boîte de sortie', async () => {
      const { app, outboxFile } = espace();
      const edition = await newEdition();
      const attendee = await createAttendee(app, edition, { email: 'echec.mailer@example.org' });
      fs.rmSync(outboxFile, { force: true });
      fs.mkdirSync(outboxFile, { recursive: true });
      let result;
      try {
        result = await app.service('api::espace.mailer').send({ attendee, template: 'welcome', data: data(edition), scenarioKey: 'welcome' });
      } finally {
        fs.rmSync(outboxFile, { recursive: true, force: true });
      }
      assert.equal(result.status, 'failed');
      const [log] = await app.db.query(UID.emailLog).findMany({ where: { attendee: { documentId: attendee.documentId } } });
      assert.equal(log.status, 'failed');
    });
  });

  describe('synchronisation sans réglage HelloAsso (HELLOASSO_* vides, 4.3 du plan)', () => {
    it('écrit un SyncRun clos portant HELLOASSO_NOT_CONFIGURED, sans rien créer ni appeler', async () => {
      const { app } = espace();
      const edition = await newEdition({ enabled: false });
      const result = await app.service('api::espace.sync').run(edition.documentId);
      assert.deepEqual([result.created, result.updated, result.cancelled], [0, 0, 0]);
      assert.ok(result.errors.some((error) => error.code === 'HELLOASSO_NOT_CONFIGURED'), JSON.stringify(result.errors));
      const [stored] = await app.db.query(UID.syncRun).findMany({ where: { edition: { documentId: edition.documentId } } });
      assert.ok(stored.endedAt);
    });
  });
});

describe('tâches planifiées (lot 4, A-08, critère 7)', { timeout: 180_000 }, () => {
  // Strapi enregistre ses propres tâches (métriques) même quand `server.cron.enabled` vaut false : seules celles de l'espace comptent.
  const STRAPI_JOBS = new Set(['uploadWeekly', 'sendProjectInformation']);
  const rulesOf = (app) =>
    app.cron.jobs
      .filter(({ name }) => !STRAPI_JOBS.has(name))
      .map(({ options }) => (typeof options === 'string' ? { rule: options } : { rule: options?.rule, tz: options?.tz }));

  describe('CRON_ENABLED=true', () => {
    const espace = useEspace({ overrides: { CRON_ENABLED: 'true' } });

    it('enregistre la synchronisation toutes les 15 minutes et la purge quotidienne à 4 h, en Europe/Paris', () => {
      const rules = rulesOf(espace().app);
      assert.deepEqual(rules.map((entry) => entry.rule).sort(), ['*/15 * * * *', '0 4 * * *']);
      assert.ok(rules.every((entry) => entry.tz === 'Europe/Paris'));
    });
  });
});
