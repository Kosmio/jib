'use strict';

/**
 * Pilotage lisible, lot V2-D (F-121, F-122, F-123, F-125, T-40) :
 *   - GET /admin/:edition/sync-runs et /stats : les erreurs qui portent une adresse disent qui la tient (`holderName`, F-121) ;
 *   - POST /admin/:edition/slots/regenerate?dryRun=true : le compte rendu sans aucune écriture (F-122, critère 5) ;
 *   - GET /admin/:edition/export/participants.csv : colonnes, ordre, annulés en fin ; noms de fichiers ; session absente (F-123) ;
 *   - GET /admin/:edition/stats : totaux par rôle sans les annulés, mêmes rendez-vous que les exports (F-125, T-40).
 * Les pages (barre d'onglets, titre de synchronisation, dialogue de régénération, accès direct de l'organisateur : F-119, F-120,
 * F-124) sont dans web/tests/e2e/espace-pilotage.spec.ts. Un seul démarrage de Strapi ; chaque test crée son édition.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildEdgeCaseItems } = require('../../scripts/espace/fake-helloasso');
const defaultItems = require('../../scripts/espace/fixtures/helloasso-items.json');
const { useEspace } = require('../helpers/espace');
const { UID, link } = require('../helpers/espace-data');
const W = require('../helpers/meetings-world');

const PORTE_ITEMS = [...defaultItems, ...buildEdgeCaseItems({ padding: 5 })];
const HEADERS = [
  'Nom', 'Prénom', 'E-mail', 'Fonction', 'Entreprise', 'Rôle', 'Exposant représenté', 'Stand', 'Table dédiée', 'Page LinkedIn', 'Statut',
  'Espace activé', 'Activé le', 'Dernière connexion', 'Dans l’annuaire', 'Reçoit des demandes', 'Actualités des prochaines éditions',
  'Profil complété (%)', 'Sujets', 'Nombre de rendez-vous confirmés', 'Rendez-vous confirmés',
];
const parisDay = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

describe('pilotage lisible (V2-D)', { timeout: 900_000 }, () => {
  const espace = useEspace({ fake: { tokenTtlSeconds: 61, items: PORTE_ITEMS }, overrides: { ORGANIZER_EMAILS: 'organisation@example.org' } });
  const login = W.useLogin(espace);
  const api = W.useApi(espace);
  const app = () => espace().app;

  const person = (edition, fields) => W.createPerson(app(), edition, fields);
  const as = async (edition, who) => api(await login(edition, who));
  const organizerOf = (edition) => person(edition, { role: 'organizer', firstName: 'Olivia', lastName: 'Organisatrice', directoryOptIn: false, meetingsOptIn: false });
  const newEdition = (prefix, options) => W.createMeetingEdition(app(), { slug: W.unique(prefix), title: 'Édition d’essai', ...options });
  const lines = (text) => text.replace(/^﻿/, '').trimEnd().split('\r\n');
  const cells = (row) => row.split(';');
  const slotsOf = (edition) => app().documents(UID.slot).findMany({ filters: { edition: { documentId: edition.documentId } }, sort: 'startsAt:asc', limit: 1000 });
  const syncRun = (edition, errors, minutesAgo = 12) =>
    app().documents(UID.syncRun).create({
      data: { edition: link(edition), startedAt: new Date(Date.now() - (minutesAgo + 1) * 60_000), endedAt: new Date(Date.now() - minutesAgo * 60_000), created: 0, updated: 0, cancelled: 0, errors },
    });

  describe('F-121 : les erreurs d’import disent qui tient l’adresse', () => {
    it('critère 3 : un doublon d’e-mail du jeu de recette porte son adresse et le nom de l’inscrit qui la tient, dans la réponse de la synchronisation', async () => {
      espace().fake.setItems(PORTE_ITEMS);
      const { edition } = await newEdition('pil-doublon');
      const boss = await organizerOf(edition);
      const response = await (await as(edition, boss)).post(`/admin/${edition.slug}/sync`);
      assert.equal(response.status, 200, response.text);
      const duplicates = response.json.errors.filter(({ code }) => code === 'DUPLICATE_EMAIL');
      assert.deepEqual(duplicates.map(({ itemId }) => String(itemId)).sort(), ['910002', '910003']);
      for (const error of duplicates) {
        assert.equal(error.email, 'groupe@example.org');
        assert.equal(error.holderName, 'Agathe Lavigne');
      }
    });

    it('sync-runs et stats.lastSync donnent les mêmes erreurs enrichies ; les cas attendus (WAITING, UNKNOWN) n’ont pas de nom', async () => {
      espace().fake.setItems(PORTE_ITEMS);
      const { edition } = await newEdition('pil-doublon-liste');
      const boss = await organizerOf(edition);
      const session = await as(edition, boss);
      assert.equal((await session.post(`/admin/${edition.slug}/sync`)).status, 200);
      const [run] = (await session.get(`/admin/${edition.slug}/sync-runs`)).json;
      const holders = run.errors.filter(({ code }) => code === 'DUPLICATE_EMAIL').map(({ holderName }) => holderName);
      assert.deepEqual(holders, ['Agathe Lavigne', 'Agathe Lavigne']);
      for (const error of run.errors.filter(({ code }) => ['WAITING', 'UNKNOWN'].includes(code))) assert.equal(error.holderName, undefined, error.code);
      const { lastSync } = (await session.get(`/admin/${edition.slug}/stats`)).json;
      assert.deepEqual(lastSync.errors, run.errors);
    });

    it('EMAIL_TAKEN retrouvé par l’identifiant de l’inscrit ; adresse inconnue ou erreur de lecture : aucun nom inventé ; casse de l’adresse ignorée', async () => {
      const { edition } = await newEdition('pil-holder');
      const boss = await organizerOf(edition);
      const lea = await person(edition, { firstName: 'Léa', lastName: 'Ducasse', email: 'lea.ducasse@example.org' });
      await syncRun(edition, [
        { code: 'EMAIL_TAKEN', itemId: '1', attendeeDocumentId: lea.documentId },
        { code: 'DUPLICATE_EMAIL', itemId: '2', email: 'LEA.Ducasse@Example.org' },
        { code: 'DUPLICATE_EMAIL', itemId: '3', email: 'personne@example.org' },
        { code: 'FETCH_FAILED', status: 500 },
      ]);
      const { errors } = (await (await as(edition, boss)).get(`/admin/${edition.slug}/sync-runs`)).json[0];
      assert.equal(errors[0].holderName, 'Léa Ducasse');
      assert.equal(errors[1].holderName, 'Léa Ducasse');
      assert.equal(errors[2].holderName, undefined);
      assert.deepEqual(errors[3], { code: 'FETCH_FAILED', status: 500 });
    });

    it('un inscrit d’une autre édition ne donne pas son nom', async () => {
      const { edition } = await newEdition('pil-holder-a');
      const other = (await newEdition('pil-holder-b')).edition;
      await person(other, { firstName: 'Ailleurs', lastName: 'Inconnu', email: 'ailleurs@example.org' });
      const boss = await organizerOf(edition);
      await syncRun(edition, [{ code: 'DUPLICATE_EMAIL', itemId: '4', email: 'ailleurs@example.org' }]);
      const [run] = (await (await as(edition, boss)).get(`/admin/${edition.slug}/sync-runs`)).json;
      assert.equal(run.errors[0].holderName, undefined);
    });

    it('F-120 : une exécution en FETCH_FAILED reste lisible telle quelle comme dernière synchronisation', async () => {
      const { edition } = await newEdition('pil-echec');
      const boss = await organizerOf(edition);
      await syncRun(edition, [{ code: 'FETCH_FAILED', status: 503 }], 12);
      const { lastSync } = (await (await as(edition, boss)).get(`/admin/${edition.slug}/stats`)).json;
      assert.deepEqual(lastSync.errors, [{ code: 'FETCH_FAILED', status: 503 }]);
      assert.ok(lastSync.endedAt);
    });
  });

  describe('F-122 : POST /admin/:edition/slots/regenerate?dryRun=true', () => {
    const regenerate = (session, edition, query = '') => session.post(`/admin/${edition.slug}/slots/regenerate${query}`);
    const withProgram = async (prefix) => {
      const world = await W.createMeetingEdition(app(), { slug: W.unique(prefix), title: 'Édition d’essai' });
      return { ...world, boss: await as(world.edition, await organizerOf(world.edition)) };
    };

    it('critère 5 : la simulation annonce ce qui serait supprimé et créé sans toucher aucun créneau', async () => {
      const { edition, sequences, boss, slotList } = await withProgram('pil-dry');
      assert.equal(slotList.length, 10);
      await app().documents(UID.sequence).update({ documentId: sequences[2].documentId, data: { kind: 'talk' } });
      await app().documents(UID.sequence).publish({ documentId: sequences[2].documentId });
      const before = (await slotsOf(edition)).map(({ documentId }) => documentId);

      const dry = await regenerate(boss, edition, '?dryRun=true');
      assert.equal(dry.status, 200, dry.text);
      assert.equal(dry.json.dryRun, true);
      assert.deepEqual([dry.json.created, dry.json.kept, dry.json.removed], [0, 8, 2]);
      assert.deepEqual((await slotsOf(edition)).map(({ documentId }) => documentId), before, 'aucun créneau créé, supprimé ni modifié');

      const real = await regenerate(boss, edition);
      assert.equal(real.json.dryRun, undefined, 'la vraie régénération ne porte pas la marque de simulation');
      assert.deepEqual([real.json.created, real.json.kept, real.json.removed], [dry.json.created, dry.json.kept, dry.json.removed], 'la simulation dit ce que la vraie fera');
      assert.equal((await slotsOf(edition)).length, 8);
    });

    it('sur une édition sans créneau : la simulation annonce 10 créations, n’en crée aucune', async () => {
      const { edition, boss } = await withProgram('pil-dry-vide');
      for (const { documentId } of await slotsOf(edition)) await app().documents(UID.slot).delete({ documentId });
      const dry = await regenerate(boss, edition, '?dryRun=true');
      assert.deepEqual([dry.json.dryRun, dry.json.created, dry.json.kept, dry.json.removed], [true, 10, 0, 0]);
      assert.equal((await slotsOf(edition)).length, 0);
    });

    it('un créneau qui porte un rendez-vous actif est annoncé orphelin, jamais retiré, même en simulation', async () => {
      const { edition, sequences, boss, slots } = await withProgram('pil-dry-orphelin');
      const [a, b] = [await person(edition), await person(edition)];
      await W.seedMeeting(app(), { edition, slot: slots['11h00'], requester: a, target: b, status: 'pending' });
      await app().documents(UID.sequence).update({ documentId: sequences[2].documentId, data: { kind: 'talk' } });
      await app().documents(UID.sequence).publish({ documentId: sequences[2].documentId });
      const dry = await regenerate(boss, edition, '?dryRun=true');
      assert.deepEqual([dry.json.removed, dry.json.orphans.length, dry.json.orphans[0]?.label], [1, 1, '11h00']);
      assert.equal((await slotsOf(edition)).length, 10);
    });

    it('un autre dryRun que « true » ou « 1 » écrit pour de bon', async () => {
      const { edition, sequences, boss } = await withProgram('pil-dry-faux');
      await app().documents(UID.sequence).update({ documentId: sequences[2].documentId, data: { kind: 'talk' } });
      await app().documents(UID.sequence).publish({ documentId: sequences[2].documentId });
      const response = await regenerate(boss, edition, '?dryRun=false');
      assert.equal(response.json.dryRun, undefined);
      assert.equal((await slotsOf(edition)).length, 8);
    });

    it('la simulation reste réservée à l’organisateur : 401 sans session, 403 pour un participant', async () => {
      const { edition } = await withProgram('pil-dry-acces');
      const path = `/api/espace/admin/${edition.slug}/slots/regenerate?dryRun=true`;
      assert.equal((await espace().request(path, { method: 'POST' })).status, 401);
      assert.equal((await regenerate(await as(edition, await person(edition)), edition, '?dryRun=true')).status, 403);
    });
  });

  describe('F-123 : export des participants', () => {
    it('les 21 colonnes, dans l’ordre : Statut, Activé le, Dernière connexion et Actualités des prochaines éditions ajoutées, plus de colonne « Inscription »', async () => {
      const { edition } = await newEdition('pil-colonnes');
      const boss = await as(edition, await organizerOf(edition));
      const text = (await boss.get(`/admin/${edition.slug}/export/participants.csv`)).text;
      assert.deepEqual(cells(lines(text)[0]), HEADERS);
      assert.ok(!lines(text)[0].includes('Inscription'));
    });

    it('Statut, dates d’activation et de connexion à l’heure de Paris, abonnement aux actualités, cellules vides quand rien n’est daté', async () => {
      const { edition } = await newEdition('pil-valeurs');
      const boss = await as(edition, await organizerOf(edition));
      await person(edition, { firstName: 'Léa', lastName: 'Ducasse', activatedAt: '2026-11-20T09:30:00.000Z', lastSeenAt: '2026-12-03T07:05:00.000Z', newsOptIn: true });
      await person(edition, { firstName: 'Tom', lastName: 'Laffitte', activatedAt: null, lastSeenAt: null, newsOptIn: false });
      const rows = lines((await boss.get(`/admin/${edition.slug}/export/participants.csv`)).text);
      const col = (name) => HEADERS.indexOf(name);
      const lea = cells(rows.find((row) => row.startsWith('Ducasse;Léa;')));
      assert.equal(lea[col('Statut')], 'Actif');
      assert.equal(lea[col('Espace activé')], 'oui');
      assert.match(lea[col('Activé le')], /^20\/11\/2026\D{1,3}10:30$/, 'UTC+1 en novembre');
      assert.match(lea[col('Dernière connexion')], /^03\/12\/2026\D{1,3}08:05$/);
      assert.equal(lea[col('Actualités des prochaines éditions')], 'oui');
      const tom = cells(rows.find((row) => row.startsWith('Laffitte;Tom;')));
      assert.deepEqual([tom[col('Espace activé')], tom[col('Activé le')], tom[col('Dernière connexion')], tom[col('Actualités des prochaines éditions')]], ['non', '', '', 'non']);
    });

    it('les annulés ferment le fichier, chaque groupe par ordre alphabétique, avec le statut « Annulé »', async () => {
      const { edition } = await newEdition('pil-annules');
      const boss = await as(edition, await organizerOf(edition));
      await person(edition, { firstName: 'Zoé', lastName: 'Zola' });
      await person(edition, { firstName: 'Anna', lastName: 'Abadie', status: 'cancelled' });
      await person(edition, { firstName: 'Marc', lastName: 'Martin' });
      await person(edition, { firstName: 'Bruno', lastName: 'Bacri', status: 'cancelled' });
      const rows = lines((await boss.get(`/admin/${edition.slug}/export/participants.csv`)).text).slice(1);
      assert.deepEqual(rows.map((row) => cells(row)[0]), ['Martin', 'Zola', 'Abadie', 'Bacri']);
      assert.deepEqual(rows.map((row) => cells(row)[HEADERS.indexOf('Statut')]), ['Actif', 'Actif', 'Annulé', 'Annulé']);
    });

    it('noms de fichiers : <fichier>-<slug>-AAAA-MM-JJ.csv pour les quatre exports (en-tête Content-Disposition)', async () => {
      const { edition } = await newEdition('pil-noms');
      const boss = await as(edition, await organizerOf(edition));
      const today = parisDay(new Date());
      for (const [name, french] of [['participants', 'participants'], ['meetings', 'rendez-vous'], ['exhibitors', 'exposants'], ['stats', 'statistiques']]) {
        const response = await boss.get(`/admin/${edition.slug}/export/${name}.csv`);
        assert.equal(response.status, 200, response.text);
        assert.equal(response.headers.get('content-disposition'), `attachment; filename="${french}-${edition.slug}-${today}.csv"`);
      }
    });

    it('la date du nom est celle de Paris : 23h30 UTC le 3 décembre est le 4 décembre', async () => {
      const { edition } = await newEdition('pil-date');
      const exportsService = app().service('api::espace.exports');
      assert.equal((await exportsService.build(edition, 'participants', new Date('2026-12-03T23:30:00.000Z'))).filename, `participants-${edition.slug}-2026-12-04.csv`);
      assert.equal((await exportsService.build(edition, 'stats', new Date('2026-12-03T22:30:00.000Z'))).filename, `statistiques-${edition.slug}-2026-12-03.csv`);
      assert.equal(await exportsService.build(edition, 'inconnu'), null);
    });

    describe('session absente ou expirée sur un lien d’export', () => {
      const path = (edition, file = 'participants') => `/api/espace/admin/${edition.slug}/export/${file}.csv`;
      const HTML = { headers: { accept: 'text/html,application/xhtml+xml' } };

      it('navigateur sans session : 303 vers la connexion de l’édition, retour au pilotage, jamais de JSON', async () => {
        const { edition } = await newEdition('pil-redir');
        const response = await espace().request(path(edition), HTML);
        assert.equal(response.status, 303, response.text);
        assert.equal(response.location, `http://localhost:4321/espace/${edition.slug}/connexion?next=${encodeURIComponent(`/espace/${edition.slug}/organisateur`)}&expire=1`);
        assert.match(response.headers.get('cache-control') ?? '', /no-store/);
        assert.equal(response.json, undefined);
      });

      it('cookie périmé ou falsifié : même redirection', async () => {
        const { edition } = await newEdition('pil-redir-cookie');
        const response = await espace().request(path(edition, 'stats'), { ...HTML, cookie: 'jib_espace=cookie-invalide.signature-fausse' });
        assert.equal(response.status, 303, response.text);
        assert.match(response.location, /\/connexion\?next=.+&expire=1$/);
      });

      it('client sans Accept: text/html : le 401 JSON reste', async () => {
        const { edition } = await newEdition('pil-redir-json');
        for (const options of [{}, { headers: { accept: 'application/json' } }]) {
          const response = await espace().request(path(edition), options);
          assert.equal(response.status, 401, response.text);
          assert.equal(response.json.error.code.length > 0, true);
          assert.equal(response.location, null);
        }
      });

      it('un participant connecté qui ouvre le lien reçoit toujours 403, pas une redirection', async () => {
        const { edition } = await newEdition('pil-redir-403');
        const session = await login(edition, await person(edition));
        const response = await espace().request(path(edition), { headers: HTML.headers, cookie: session });
        assert.equal(response.status, 403, response.text);
      });

      it('l’organisateur connecté reçoit le fichier, pas une redirection, même avec Accept: text/html', async () => {
        const { edition } = await newEdition('pil-redir-ok');
        const session = await login(edition, await organizerOf(edition));
        const response = await espace().request(path(edition), { headers: HTML.headers, cookie: session });
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /^text\/csv/);
      });
    });
  });

  describe('F-125, T-40 : indicateurs et exports comptent les mêmes personnes et les mêmes rendez-vous', () => {
    async function scene() {
      const world = await newEdition('pil-stats');
      const { edition } = world;
      const p = {
        lea: await person(edition, { firstName: 'Léa', lastName: 'Ducasse' }),
        mathis: await person(edition, { firstName: 'Mathis', lastName: 'Lagrange' }),
        gone: await person(edition, { firstName: 'Gaspard', lastName: 'Annule', status: 'cancelled' }),
        goneSpeaker: await person(edition, { firstName: 'Sacha', lastName: 'Parti', role: 'speaker', status: 'cancelled' }),
        helene: await person(edition, { firstName: 'Hélène', lastName: 'Marquès', role: 'speaker' }),
        boss: await organizerOf(edition),
      };
      await W.seedMeeting(app(), { edition, slot: world.slots['10h45'], requester: p.lea, target: p.mathis, status: 'accepted', tableNumber: 1, answeredBy: p.mathis });
      await W.seedMeeting(app(), { edition, slot: world.slots['11h00'], requester: p.lea, target: p.helene, status: 'pending' });
      await W.seedMeeting(app(), { edition, slot: world.slots['12h30'], requester: p.mathis, target: p.lea, status: 'declined' });
      // Rendez-vous dont le créneau a disparu : les exports ne le listent pas, les indicateurs non plus.
      await app().documents(UID.meeting).create({ data: { edition: link(edition), requester: link(p.lea), targetAttendee: link(p.mathis), status: 'accepted' } });
      return { world, edition, p, session: await as(edition, p.boss) };
    }

    it('byRole ne compte pas les annulés, total et cancelled les comptent', async () => {
      const { edition, session } = await scene();
      const { attendees } = (await session.get(`/admin/${edition.slug}/stats`)).json;
      assert.deepEqual(attendees.byRole, { participant: 2, speaker: 1, exhibitor_rep: 0 });
      assert.deepEqual([attendees.total, attendees.active, attendees.cancelled], [5, 3, 2]);
      assert.equal(Object.values(attendees.byRole).reduce((sum, count) => sum + count, 0), attendees.active, 'la somme par rôle égale les actifs');
    });

    it('un rendez-vous sans créneau n’est compté nulle part : indicateurs égaux aux lignes de l’export des rendez-vous', async () => {
      const { edition, session } = await scene();
      const { meetings } = (await session.get(`/admin/${edition.slug}/stats`)).json;
      assert.deepEqual([meetings.accepted, meetings.pending, meetings.declined], [1, 1, 1]);
      const rows = lines((await session.get(`/admin/${edition.slug}/export/meetings.csv`)).text).slice(1);
      assert.equal(rows.length, Object.values(meetings).reduce((sum, count) => sum + count, 0), 'autant de lignes que de rendez-vous comptés');
      for (const [status, label] of [['accepted', 'Confirmé'], ['pending', 'En attente'], ['declined', 'Refusé']]) {
        assert.equal(rows.filter((row) => cells(row)[3] === label).length, meetings[status], status);
      }
    });

    it('statistiques.csv reprend les mêmes chiffres que l’API', async () => {
      const { edition, session } = await scene();
      const stats = (await session.get(`/admin/${edition.slug}/stats`)).json;
      const csv = lines((await session.get(`/admin/${edition.slug}/export/stats.csv`)).text);
      assert.ok(csv.includes('Participants;2'), csv.join('|'));
      assert.ok(csv.includes('Intervenants;1'));
      assert.ok(csv.includes(`Inscrits;${stats.attendees.total}`));
      assert.ok(csv.includes('Inscriptions annulées;2'));
      assert.ok(csv.includes('Rendez-vous : confirmé;1'));
    });
  });
});
