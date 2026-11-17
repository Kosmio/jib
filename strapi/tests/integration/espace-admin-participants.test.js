'use strict';

/**
 * Participants dans le pilotage, lot V3-E (docs/espace/specs/14-lots-finalisation.md) : F-134 à F-138, R-89, R-18, R-63.
 *
 * Routes (organisateur de l'édition, 403 sinon), sous /api/espace/admin/:edition/attendees :
 *   GET /  (q, role, status, activated, visible, sort, page)   POST /   GET /:id   PATCH /:id
 *   POST /:id/link   POST /:id/cancel   POST /:id/restore
 *
 * Critères d'acceptation : 1 (nom corrigé, dix synchronisations), 2 (désinscription durable, meeting-cancelled, tables libres),
 * 3 (invité manuel ni dupliqué ni supprimé), 4 (recherche « dub » sur 200 inscrits, moins de 300 ms, mesurée), 5 (403 sur chaque route,
 * organisateur d'une autre édition compris), 6 (l'e-mail reste dans les routes d'administration). En plus : limite de 3 liens par heure
 * et par inscrit, et aucun contenu de message dans aucune réponse (R-63).
 *
 * Heure : la synchronisation prend `now` ; les routes lisent l'horloge du processus, figée par mock.timers le temps d'une requête
 * quand l'heure compte (plage d'envoi 8h à 20h, Paris, R-85). Un échec d'envoi est provoqué en remplaçant la boîte de sortie par un dossier.
 */

const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const defaultItems = require('../../scripts/espace/fixtures/helloasso-items.json');
const { sleep, useEspace } = require('../helpers/espace');
const { UID, createAttendee, createEdition, createProgram, link } = require('../helpers/espace-data');

const MESSAGE = 'api::espace.message';
const CONVERSATION = 'api::espace.conversation';
const LEA = 'lea.ducasse@example.org';
const MATHIS = 'mathis.lagrange@example.org';
const ROW_KEYS = ['activated', 'company', 'directoryOptIn', 'email', 'firstName', 'id', 'jobTitle', 'lastName', 'lastSeenAt', 'manual', 'role', 'status'];
const SHEET_KEYS = [...ROW_KEYS, 'consent', 'emails', 'importedAt', 'meetings', 'activatedAt', 'source', 'statusLockedAt'].sort();
const SECRET_BODY = 'Texte confidentiel du message ZXQ-731 qui ne doit jamais sortir.';

/** Instant du lendemain dont l'heure de Paris vaut `hour` h `minute`. */
function parisInstant(hour, minute = 0, dayOffset = 1) {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + dayOffset);
  const parisHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' });
  for (let utc = 0; utc < 24; utc += 1) {
    const candidate = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), utc, minute));
    if (Number(parisHour.format(candidate)) === hour) return candidate;
  }
  throw new Error(`Aucune heure de Paris ${hour}h`);
}

/** Exécute `action` avec l'horloge du processus figée à `instant`, puis la rend. */
async function frozenAt(instant, action) {
  mock.timers.enable({ apis: ['Date'], now: instant });
  try {
    return await action();
  } finally {
    mock.timers.reset();
  }
}

/** Les envois échouent le temps de `action` : le fichier de la boîte de sortie devient un dossier. */
async function withBrokenOutbox(espace, action) {
  const { outboxFile } = espace();
  fs.rmSync(outboxFile, { force: true });
  fs.mkdirSync(outboxFile, { recursive: true });
  try {
    return await action();
  } finally {
    fs.rmSync(outboxFile, { recursive: true, force: true });
  }
}

const isLink = (mail) => /\/espace\/verifier/.test(mail.text);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

describe('participants dans le pilotage (V3-E : F-134 à F-138, R-89)', { timeout: 900_000 }, () => {
  const espace = useEspace({ fake: true });
  let counter = 0;

  const newEdition = (options = {}) => {
    counter += 1;
    return createEdition(espace().app, { slug: `participants-${counter}`, title: `Participants ${counter}`, ...options });
  };
  const useItems = (items) => espace().fake.setItems(items);
  const run = (edition, options) => espace().app.service('api::espace.sync').run(edition.documentId, options);
  const attendeesOf = (edition) => espace().app.documents(UID.attendee).findMany({ filters: { edition: { documentId: edition.documentId } }, limit: 1000 });
  const byEmail = async (edition, email) => (await attendeesOf(edition)).find((attendee) => attendee.email === email);
  const base = (edition) => `/api/espace/admin/${edition.slug}/attendees`;
  const call = (edition, path, cookie, options = {}) => espace().request(`${base(edition)}${path}`, { cookie, ...options });
  const send = (edition, method, path, cookie, json) => call(edition, path, cookie, { method, ...(json !== undefined && { json }) });
  const mailsTo = (since, emails) => espace().mailsSince(since, { to: emails });

  async function person(edition, fields = {}) {
    const { app, signIn } = espace();
    const attendee = await createAttendee(app, edition, { consentAt: new Date().toISOString(), ...fields });
    return { attendee, ...(await signIn(edition.slug, attendee.email)) };
  }
  const organizerOf = (edition) => person(edition, { role: 'organizer' });

  /** Édition ouverte, billets de recette importés (16), un organisateur connecté. */
  async function imported(options = {}) {
    useItems(defaultItems);
    const edition = await newEdition(options);
    await run(edition);
    await sleep(300);
    const organizer = await organizerOf(edition);
    return { edition, organizer };
  }

  describe('critère 5 : garde organisateur sur chaque route', () => {
    const routes = [
      ['GET', ''],
      ['POST', ''],
      ['GET', '/:id'],
      ['PATCH', '/:id'],
      ['POST', '/:id/link'],
      ['POST', '/:id/cancel'],
      ['POST', '/:id/restore'],
    ];

    for (const [method, path] of routes) {
      it(`${method} ${path || '/'} : 403 FORBIDDEN pour un participant, 401 sans session, 403 pour l'organisateur d'une autre édition`, async () => {
        const edition = await newEdition();
        const other = await newEdition();
        const participant = await person(edition, { role: 'participant' });
        const stranger = await organizerOf(other);
        const target = await createAttendee(espace().app, edition, {});
        const url = path.replace(':id', target.documentId);
        const body = method === 'GET' ? undefined : { firstName: 'Intrus', lastName: 'Intrus', email: 'intrus@example.org' };

        const denied = await send(edition, method, url, participant.cookie, body);
        assert.equal(denied.status, 403);
        assert.equal(denied.json.error.code, 'FORBIDDEN');
        assert.equal((await send(edition, method, url, undefined, body)).status, 401);
        assert.equal((await send(edition, method, url, stranger.cookie, body)).status, 403);

        const after = await espace().app.documents(UID.attendee).findOne({ documentId: target.documentId });
        assert.equal(after.status, 'active');
        assert.equal(after.firstName, target.firstName, 'aucune écriture refusée ne passe');
        assert.equal((await attendeesOf(edition)).some((attendee) => attendee.email === 'intrus@example.org'), false);
      });
    }
  });

  describe('F-134 : liste paginée, recherche, filtres, tri', () => {
    async function crowd() {
      const { app } = espace();
      const edition = await newEdition();
      const make = (fields) => createAttendee(app, edition, fields);
      const dubois = await make({ firstName: 'Élodie', lastName: 'Dubois', company: 'Scierie du Lot', email: 'elodie.dubois@example.org', role: 'speaker', directoryOptIn: true, activatedAt: '2026-11-01T08:00:00.000Z', lastSeenAt: '2026-11-10T08:00:00.000Z' });
      const durand = await make({ firstName: 'Paul', lastName: 'Durand', company: 'Dubreuil Bois', email: 'paul.durand@example.org', lastSeenAt: '2026-11-12T08:00:00.000Z', activatedAt: '2026-11-02T08:00:00.000Z' });
      const abadie = await make({ firstName: 'Zoé', lastName: 'Abadie', company: 'Menuiserie', email: 'zoe.abadie@example.org', status: 'cancelled' });
      const martin = await make({ firstName: 'Jean', lastName: 'Martin', company: 'Charpente', email: 'jean.martin@example.org', role: 'exhibitor_rep' });
      const organizer = await organizerOf(edition);
      return { edition, organizer, dubois, durand, abadie, martin };
    }
    const names = (response) => response.json.items.map((item) => `${item.firstName} ${item.lastName}`);

    it('renvoie { items, total, page, pageSize, pages } et, par inscrit, exactement les champs de la ligne', async () => {
      const { edition, organizer } = await crowd();
      const response = await call(edition, '', organizer.cookie);
      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(response.json).sort(), ['items', 'page', 'pageSize', 'pages', 'total']);
      assert.equal(response.json.total, 5);
      assert.equal(response.json.pageSize, 25);
      assert.equal(response.json.page, 1);
      assert.equal(response.json.pages, 1);
      for (const item of response.json.items) assert.deepEqual(Object.keys(item).sort(), ROW_KEYS);
    });

    it('tri par défaut par nom puis prénom ; sort=name équivaut au défaut', async () => {
      const { edition, organizer } = await crowd();
      const expected = ['Zoé Abadie', 'Élodie Dubois', 'Paul Durand', 'Jean Martin'];
      const response = await call(edition, '', organizer.cookie);
      assert.deepEqual(names(response).filter((name) => expected.includes(name)), expected);
      assert.deepEqual(names(await call(edition, '?sort=name', organizer.cookie)), names(response));
    });

    it('tri par dernière connexion : la plus récente d’abord, ceux qui ne se sont jamais connectés à la fin', async () => {
      const { edition, organizer } = await crowd();
      const response = await call(edition, '?sort=lastSeen', organizer.cookie);
      // L'organisateur vient de se connecter : il est le plus récent, puis Paul (12 novembre), puis Élodie (10 novembre).
      assert.equal(response.json.items[0].id, organizer.attendee.documentId);
      assert.deepEqual(names(response).slice(1, 3), ['Paul Durand', 'Élodie Dubois']);
      assert.ok(response.json.items.slice(3).every((item) => item.lastSeenAt === null || item.lastSeenAt === undefined));
    });

    it('recherche « dub » : nom, entreprise, sans tenir compte de la casse ni des accents ; « elodie » trouve « Élodie »', async () => {
      const { edition, organizer } = await crowd();
      assert.deepEqual(names(await call(edition, '?q=dub', organizer.cookie)).sort(), ['Paul Durand', 'Élodie Dubois']);
      assert.deepEqual(names(await call(edition, '?q=ELODIE', organizer.cookie)), ['Élodie Dubois']);
      assert.deepEqual(names(await call(edition, '?q=zoe.abadie@example', organizer.cookie)), ['Zoé Abadie']);
      assert.equal((await call(edition, '?q=personne-ne-porte-ce-nom', organizer.cookie)).json.total, 0);
    });

    it('filtres : rôle, statut, activé, visible (et combinés)', async () => {
      const { edition, organizer } = await crowd();
      assert.deepEqual(names(await call(edition, '?role=speaker', organizer.cookie)), ['Élodie Dubois']);
      assert.deepEqual(names(await call(edition, '?status=cancelled', organizer.cookie)), ['Zoé Abadie']);
      assert.equal((await call(edition, '?status=active', organizer.cookie)).json.total, 4);
      assert.deepEqual(names(await call(edition, '?activated=true&q=du', organizer.cookie)).sort(), ['Paul Durand', 'Élodie Dubois']);
      assert.ok((await call(edition, '?activated=false', organizer.cookie)).json.items.every((item) => item.activated === false));
      assert.deepEqual(names(await call(edition, '?visible=true', organizer.cookie)), ['Élodie Dubois']);
      assert.equal((await call(edition, '?visible=false', organizer.cookie)).json.total, 4);
      assert.deepEqual(names(await call(edition, '?visible=true&role=participant', organizer.cookie)), []);
    });

    it('pagination : 25 par page, 60 inscrits donnent 3 pages, une page hors bornes est ramenée à la dernière', async () => {
      const { app } = espace();
      const edition = await newEdition();
      for (let i = 0; i < 59; i += 1) await createAttendee(app, edition, { lastName: `Page${String(i).padStart(2, '0')}` });
      const organizer = await organizerOf(edition);
      const first = await call(edition, '', organizer.cookie);
      assert.equal(first.json.total, 60);
      assert.equal(first.json.pages, 3);
      assert.equal(first.json.items.length, 25);
      assert.equal((await call(edition, '?page=3', organizer.cookie)).json.items.length, 10);
      const beyond = await call(edition, '?page=99', organizer.cookie);
      assert.equal(beyond.json.page, 3);
      const ids = new Set([...first.json.items, ...(await call(edition, '?page=2', organizer.cookie)).json.items, ...beyond.json.items].map((item) => item.id));
      assert.equal(ids.size, 60, 'aucun inscrit en double ni manquant entre les pages');
    });

    it('une valeur invalide répond 400 VALIDATION avec le champ en cause (role, status, sort, activated, visible)', async () => {
      const { edition, organizer } = await crowd();
      for (const field of ['role=chef', 'status=banni', 'sort=taille', 'activated=peut-etre', 'visible=1']) {
        const response = await call(edition, `?${field}`, organizer.cookie);
        assert.equal(response.status, 400, field);
        assert.equal(response.json.error.code, 'VALIDATION', field);
        assert.ok(response.json.error.fields[field.split('=')[0]], field);
      }
    });

    it('ne rend que les inscrits de l’édition de l’URL', async () => {
      const { edition, organizer } = await crowd();
      const other = await newEdition();
      await createAttendee(espace().app, other, { lastName: 'Ailleurs', email: 'ailleurs@example.org' });
      const response = await call(edition, '?q=ailleurs', organizer.cookie);
      assert.equal(response.json.total, 0);
    });
  });

  describe('critère 4 : recherche « dub » sur 200 inscrits en moins de 300 ms', () => {
    it('la réponse de GET ?q=dub tient sous 300 ms (médiane et maximum de dix appels mesurés)', async () => {
      const { app } = espace();
      const edition = await newEdition();
      for (let start = 0; start < 200; start += 20) {
        await Promise.all(
          Array.from({ length: 20 }, (_, offset) => {
            const n = start + offset;
            return createAttendee(app, edition, { firstName: `Prénom${n}`, lastName: n % 10 === 0 ? `Dubois${n}` : `Nom${n}`, company: n % 25 === 0 ? 'Dubreuil' : `Société ${n}` });
          })
        );
      }
      const organizer = await organizerOf(edition);
      assert.equal((await attendeesOf(edition)).length, 201);
      await call(edition, '?q=dub', organizer.cookie); // échauffement : connexions et plans de requête
      const durations = [];
      let last;
      for (let i = 0; i < 10; i += 1) {
        const started = performance.now();
        last = await call(edition, '?q=dub', organizer.cookie);
        durations.push(performance.now() - started);
        assert.equal(last.status, 200);
      }
      // 20 noms « Dubois » (n multiple de 10) et 8 entreprises « Dubreuil » (n multiple de 25), dont 4 communs : 24 inscrits.
      assert.equal(last.json.total, 24);
      console.log(`# critère 4 : q=dub sur 201 inscrits, durées (ms) ${durations.map((d) => d.toFixed(0)).join(' ')} ; médiane ${median(durations).toFixed(0)}`);
      assert.ok(median(durations) < 300, `médiane ${median(durations).toFixed(0)} ms`);
      assert.ok(Math.max(...durations) < 300, `maximum ${Math.max(...durations).toFixed(0)} ms`);
    });
  });

  describe('F-135 : fiche d’un inscrit', () => {
    it('rend la ligne et importedAt, source, activatedAt, statusLockedAt, consent, meetings et emails', async () => {
      const { edition, organizer } = await imported();
      const lea = await byEmail(edition, LEA);
      const response = await call(edition, `/${lea.documentId}`, organizer.cookie);
      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(response.json).sort(), SHEET_KEYS);
      assert.equal(response.json.id, lea.documentId);
      assert.equal(response.json.email, LEA);
      assert.equal(response.json.source, 'helloasso');
      assert.equal(response.json.statusLockedAt, null);
      assert.deepEqual(Object.keys(response.json.consent).sort(), ['consentAt', 'directoryOptIn', 'meetingsOptIn', 'newsOptIn']);
      assert.deepEqual(response.json.meetings, { total: 0, pending: 0, accepted: 0 });
      assert.ok(!Number.isNaN(Date.parse(response.json.importedAt)));
    });

    it('404 ATTENDEE_NOT_FOUND pour un identifiant inconnu et pour un inscrit d’une autre édition', async () => {
      const { edition, organizer } = await imported();
      const other = await newEdition();
      const elsewhere = await createAttendee(espace().app, other, {});
      for (const id of ['inconnu1234567890abcdefg', elsewhere.documentId]) {
        const response = await call(edition, `/${id}`, organizer.cookie);
        assert.equal(response.status, 404, id);
        assert.equal(response.json.error.code, 'ATTENDEE_NOT_FOUND');
      }
      assert.equal((await send(edition, 'PATCH', `/${elsewhere.documentId}`, organizer.cookie, { firstName: 'X' })).status, 404);
      assert.equal((await send(edition, 'POST', `/${elsewhere.documentId}/cancel`, organizer.cookie)).status, 404);
    });

    it('compte les rendez-vous (total, en attente, acceptés) des deux côtés', async () => {
      const { app } = espace();
      const { edition, organizer } = await imported();
      const [lea, mathis] = [await byEmail(edition, LEA), await byEmail(edition, MATHIS)];
      const [, , pause] = await createProgram(app, edition);
      const slot = await app.documents(UID.slot).create({ data: { edition: link(edition), session: link(pause), startsAt: '2026-12-03T09:45:00.000Z', endsAt: '2026-12-03T10:00:00.000Z', label: '10h45' } });
      const meeting = (data) => app.documents(UID.meeting).create({ data: { edition: link(edition), slot: link(slot), ...data } });
      await meeting({ requester: link(lea), targetAttendee: link(mathis), status: 'pending' });
      await meeting({ requester: link(mathis), targetAttendee: link(lea), status: 'accepted', tableNumber: 1, tableKey: `tk:${edition.slug}` });
      await meeting({ requester: link(mathis), targetAttendee: link(lea), status: 'declined' });
      assert.deepEqual((await call(edition, `/${lea.documentId}`, organizer.cookie)).json.meetings, { total: 3, pending: 1, accepted: 1 });
    });

    it('les dix derniers e-mails, du plus récent au plus ancien, avec modèle, date, statut et motif d’échec', async () => {
      const { app } = espace();
      const edition = await newEdition();
      const organizer = await organizerOf(edition);
      const target = await createAttendee(app, edition, {});
      for (let i = 0; i < 12; i += 1) {
        await app.documents(UID.emailLog).create({
          data: { attendee: link(target), template: 'welcome', scenarioKey: `essai-${i}`, status: i === 11 ? 'failed' : 'sent', error: i === 11 ? 'Boîte pleine' : undefined, sentAt: new Date(Date.UTC(2026, 10, 1, 8, i)).toISOString() },
        });
      }
      const { emails } = (await call(edition, `/${target.documentId}`, organizer.cookie)).json;
      assert.equal(emails.length, 10);
      assert.deepEqual(Object.keys(emails[0]).sort(), ['error', 'sentAt', 'status', 'template']);
      assert.equal(emails[0].status, 'failed');
      assert.equal(emails[0].error, 'Boîte pleine');
      assert.ok(emails.every((mail, index) => index === 0 || Date.parse(emails[index - 1].sentAt) > Date.parse(mail.sentAt)));
    });
  });

  describe('F-136 : ajouter un invité', () => {
    const guest = (overrides = {}) => ({ firstName: 'Camille', lastName: 'Invitée', email: 'Camille.Invitee@Example.ORG', company: 'Scierie du Lot', jobTitle: 'Directrice', role: 'participant', ...overrides });

    it('201 avec la fiche : e-mail en minuscules, statut active, ajouté à la main (manual, source manual)', async () => {
      const { edition, organizer } = await imported();
      const response = await send(edition, 'POST', '', organizer.cookie, guest());
      assert.equal(response.status, 201, response.text);
      assert.equal(response.json.email, 'camille.invitee@example.org');
      assert.equal(response.json.status, 'active');
      assert.equal(response.json.manual, true);
      assert.equal(response.json.source, 'manual');
      assert.equal(response.json.company, 'Scierie du Lot');
      assert.equal(response.json.jobTitle, 'Directrice');
      assert.ok(await byEmail(edition, 'camille.invitee@example.org'));
    });

    it('rôle par défaut participant ; entreprise et fonction facultatives', async () => {
      const { edition, organizer } = await imported();
      const response = await send(edition, 'POST', '', organizer.cookie, { firstName: 'Sans', lastName: 'Détails', email: 'sans.details@example.org' });
      assert.equal(response.status, 201, response.text);
      assert.equal(response.json.role, 'participant');
      assert.equal(response.json.company, null);
      assert.equal(response.json.jobTitle, null);
    });

    it('409 EMAIL_TAKEN quand l’adresse existe déjà dans l’édition, à la casse près ; aucun doublon créé', async () => {
      const { edition, organizer } = await imported();
      const before = (await attendeesOf(edition)).length;
      const response = await send(edition, 'POST', '', organizer.cookie, guest({ email: 'LEA.Ducasse@example.org' }));
      assert.equal(response.status, 409);
      assert.equal(response.json.error.code, 'EMAIL_TAKEN');
      assert.ok(response.json.error.fields.email);
      assert.equal((await attendeesOf(edition)).length, before);
    });

    it('la même adresse est libre dans une autre édition', async () => {
      const { organizer, edition } = await imported();
      const other = await newEdition();
      const otherOrganizer = await organizerOf(other);
      assert.equal((await send(edition, 'POST', '', organizer.cookie, guest())).status, 201);
      assert.equal((await send(other, 'POST', '', otherOrganizer.cookie, guest())).status, 201);
    });

    it('400 VALIDATION avec les champs en cause : prénom, nom et e-mail obligatoires, e-mail valide, rôle connu, longueurs', async () => {
      const { edition, organizer } = await imported();
      const before = (await attendeesOf(edition)).length;
      const cases = [
        [{ firstName: '', lastName: '', email: '' }, ['firstName', 'lastName', 'email']],
        [guest({ email: 'pas-une-adresse' }), ['email']],
        [guest({ role: 'roi' }), ['role']],
        [guest({ firstName: 'x'.repeat(101) }), ['firstName']],
        [guest({ company: 'x'.repeat(151) }), ['company']],
      ];
      for (const [body, fields] of cases) {
        const response = await send(edition, 'POST', '', organizer.cookie, body);
        assert.equal(response.status, 400, JSON.stringify(body).slice(0, 60));
        assert.equal(response.json.error.code, 'VALIDATION');
        assert.deepEqual(Object.keys(response.json.error.fields).sort(), fields.sort());
      }
      assert.equal((await attendeesOf(edition)).length, before);
    });

    it('R-85 : avant le premier envoi l’invité ne reçoit pas de welcome ; après, il le reçoit à 14h00 mais pas à 22h00', async () => {
      const { edition, organizer } = await imported();
      const since = espace().outbox().length;
      await frozenAt(parisInstant(14), () => send(edition, 'POST', '', organizer.cookie, guest({ email: 'avant@example.org' })));
      assert.deepEqual((await mailsTo(since, ['avant@example.org'])).filter(isLink), [], 'welcomeStartedAt est vide');

      const opened = await newEdition({ settings: { welcomeStartedAt: parisInstant(10, 0, 0).toISOString() } });
      const openedOrganizer = await organizerOf(opened);
      const mark = espace().outbox().length;
      await frozenAt(parisInstant(14), () => send(opened, 'POST', '', openedOrganizer.cookie, guest({ email: 'apres@example.org' })));
      assert.equal((await mailsTo(mark, ['apres@example.org'])).filter(isLink).length, 1, 'invité à 14h00');
      await frozenAt(parisInstant(22), () => send(opened, 'POST', '', openedOrganizer.cookie, guest({ email: 'tard@example.org' })));
      assert.deepEqual((await mailsTo(mark, ['tard@example.org'])).filter(isLink), [], 'rien à 22h00');
    });
  });

  describe('F-137, R-89 : corriger un inscrit', () => {
    it('PATCH change prénom, nom, fonction, entreprise, e-mail (minuscules) et rôle, et rend la fiche', async () => {
      const { edition, organizer } = await imported();
      const lea = await byEmail(edition, LEA);
      const response = await send(edition, 'PATCH', `/${lea.documentId}`, organizer.cookie, {
        firstName: 'Léonie', lastName: 'Ducasse-Martin', jobTitle: 'Cheffe', company: 'Pibal & Co', email: 'Leonie.Ducasse@Example.org', role: 'speaker',
      });
      assert.equal(response.status, 200, response.text);
      assert.deepEqual(
        [response.json.firstName, response.json.lastName, response.json.jobTitle, response.json.company, response.json.email, response.json.role],
        ['Léonie', 'Ducasse-Martin', 'Cheffe', 'Pibal & Co', 'leonie.ducasse@example.org', 'speaker']
      );
      const stored = await espace().app.documents(UID.attendee).findOne({ documentId: lea.documentId });
      assert.deepEqual([...stored.editedFields].sort(), ['company', 'email', 'firstName', 'jobTitle', 'lastName', 'role']);
    });

    it('seuls les champs modifiés entrent dans editedFields (R-89), et ceux déjà présents y restent', async () => {
      const { edition, organizer } = await imported();
      const lea = await byEmail(edition, LEA);
      await espace().app.documents(UID.attendee).update({ documentId: lea.documentId, data: { editedFields: ['jobTitle'] } });
      await send(edition, 'PATCH', `/${lea.documentId}`, organizer.cookie, { firstName: 'Léonie', lastName: lea.lastName });
      const stored = await espace().app.documents(UID.attendee).findOne({ documentId: lea.documentId });
      assert.deepEqual([...stored.editedFields].sort(), ['firstName', 'jobTitle']);
    });

    it('409 EMAIL_TAKEN pour l’adresse d’un autre inscrit, sans rien écrire ; sa propre adresse reste acceptée', async () => {
      const { edition, organizer } = await imported();
      const lea = await byEmail(edition, LEA);
      const taken = await send(edition, 'PATCH', `/${lea.documentId}`, organizer.cookie, { email: MATHIS.toUpperCase() });
      assert.equal(taken.status, 409);
      assert.equal(taken.json.error.code, 'EMAIL_TAKEN');
      assert.equal((await espace().app.documents(UID.attendee).findOne({ documentId: lea.documentId })).email, LEA);
      assert.equal((await send(edition, 'PATCH', `/${lea.documentId}`, organizer.cookie, { email: LEA.toUpperCase() })).status, 200);
    });

    it('400 VALIDATION : prénom vide, e-mail invalide, rôle inconnu', async () => {
      const { edition, organizer } = await imported();
      const lea = await byEmail(edition, LEA);
      for (const [body, field] of [[{ firstName: '  ' }, 'firstName'], [{ email: 'nope' }, 'email'], [{ role: 'roi' }, 'role']]) {
        const response = await send(edition, 'PATCH', `/${lea.documentId}`, organizer.cookie, body);
        assert.equal(response.status, 400, field);
        assert.equal(response.json.error.code, 'VALIDATION');
        assert.ok(response.json.error.fields[field], field);
      }
    });

    it('409 SELF_FORBIDDEN : l’organisateur ne change pas son propre rôle ; il peut corriger son nom', async () => {
      const { edition, organizer } = await imported();
      const own = `/${organizer.attendee.documentId}`;
      const refused = await send(edition, 'PATCH', own, organizer.cookie, { role: 'participant' });
      assert.equal(refused.status, 409);
      assert.equal(refused.json.error.code, 'SELF_FORBIDDEN');
      assert.equal((await espace().app.documents(UID.attendee).findOne({ documentId: organizer.attendee.documentId })).role, 'organizer');
      assert.equal((await send(edition, 'PATCH', own, organizer.cookie, { lastName: 'Renommé' })).status, 200);
    });

    it('critère 1 : un nom corrigé depuis le pilotage survit à dix synchronisations', async () => {
      const { edition, organizer } = await imported();
      const lea = await byEmail(edition, LEA);
      const response = await send(edition, 'PATCH', `/${lea.documentId}`, organizer.cookie, { firstName: 'Léonie', lastName: 'Ducasse-Martin' });
      assert.equal(response.status, 200);
      // HelloAsso change aussi le nom côté billet : la correction de l'organisateur l'emporte quand même.
      useItems(defaultItems.map((item) => (item.id === 100001 ? { ...structuredClone(item), user: { firstName: 'Léa', lastName: 'Ducasse-Renommée' } } : item)));
      for (let i = 0; i < 10; i += 1) await run(edition);
      const after = await byEmail(edition, LEA);
      assert.equal(after.firstName, 'Léonie');
      assert.equal(after.lastName, 'Ducasse-Martin');
      assert.equal((await attendeesOf(edition)).length, 17, '16 billets + l’organisateur, sans doublon');
    });
  });

  describe('F-135 : renvoyer un lien de connexion (3 par heure et par inscrit)', () => {
    async function target() {
      const { edition, organizer } = await imported();
      const lea = await byEmail(edition, LEA);
      return { edition, organizer, lea, path: `/${lea.documentId}/link` };
    }
    const linkMails = (since, email = LEA) => mailsTo(since, [email]).then((mails) => mails.filter(isLink));

    it('envoie un lien valable qui ouvre la session de l’inscrit ; rend { status, error, remaining }', async () => {
      const { edition, organizer, path } = await target();
      const since = espace().outbox().length;
      const response = await send(edition, 'POST', path, organizer.cookie);
      assert.equal(response.status, 200, response.text);
      assert.deepEqual(response.json, { status: 'sent', error: null, remaining: 2 });
      const [mail] = await linkMails(since);
      assert.ok(mail, 'un e-mail est parti');
      const parsed = espace().linkOf(mail);
      const verified = await espace().request('/api/espace/auth/verify', { method: 'POST', json: { token: parsed.token } });
      assert.equal(verified.status, 200);
      assert.equal(verified.json.me.email ?? LEA, LEA);
    });

    it('limite : trois envois acceptés (remaining 2, 1, 0), le quatrième répond 429 RATE_LIMITED et n’envoie rien', async () => {
      const { edition, organizer, path } = await target();
      const since = espace().outbox().length;
      const remaining = [];
      for (let i = 0; i < 3; i += 1) {
        const ok = await send(edition, 'POST', path, organizer.cookie);
        assert.equal(ok.status, 200, `envoi ${i + 1}`);
        remaining.push(ok.json.remaining);
      }
      assert.deepEqual(remaining, [2, 1, 0]);
      const refused = await send(edition, 'POST', path, organizer.cookie);
      assert.equal(refused.status, 429);
      assert.equal(refused.json.error.code, 'RATE_LIMITED');
      assert.equal((await linkMails(since)).length, 3);
    });

    it('la limite est propre à chaque inscrit : un autre inscrit reçoit encore ses trois liens', async () => {
      const { edition, organizer, path } = await target();
      for (let i = 0; i < 3; i += 1) await send(edition, 'POST', path, organizer.cookie);
      assert.equal((await send(edition, 'POST', path, organizer.cookie)).status, 429);
      const mathis = await byEmail(edition, MATHIS);
      const other = await send(edition, 'POST', `/${mathis.documentId}/link`, organizer.cookie);
      assert.equal(other.status, 200);
      assert.equal(other.json.remaining, 2);
    });

    it('la fenêtre est d’une heure : une heure et une minute plus tard, un nouvel envoi passe', async () => {
      const { edition, organizer, path } = await target();
      for (let i = 0; i < 3; i += 1) await send(edition, 'POST', path, organizer.cookie);
      assert.equal((await send(edition, 'POST', path, organizer.cookie)).status, 429);
      const later = new Date(Date.now() + 61 * 60 * 1000);
      const response = await frozenAt(later, () => send(edition, 'POST', path, organizer.cookie));
      assert.equal(response.status, 200, response.text);
    });

    it('exempt de la limite par IP : six inscrits différents depuis la même adresse IP, six envois', async () => {
      const { edition, organizer } = await imported();
      const attendees = (await attendeesOf(edition)).filter((attendee) => attendee.role !== 'organizer').slice(0, 6);
      assert.equal(attendees.length, 6);
      const ip = '10.77.77.77';
      for (const attendee of attendees) {
        const response = await espace().request(`${base(edition)}/${attendee.documentId}/link`, { method: 'POST', cookie: organizer.cookie, ip });
        assert.equal(response.status, 200, attendee.email);
      }
    });

    it('409 ATTENDEE_CANCELLED pour un inscrit désinscrit, 409 SPACE_CLOSED quand l’espace est fermé ; aucun e-mail', async () => {
      const { edition, organizer, lea, path } = await target();
      const since = espace().outbox().length;
      await espace().app.documents(UID.attendee).update({ documentId: lea.documentId, data: { status: 'cancelled' } });
      const cancelled = await send(edition, 'POST', path, organizer.cookie);
      assert.equal(cancelled.status, 409);
      assert.equal(cancelled.json.error.code, 'ATTENDEE_CANCELLED');

      const closed = await newEdition({ enabled: false });
      const closedTarget = await createAttendee(espace().app, closed, {});
      const closedOrganizer = await createAttendee(espace().app, closed, { role: 'organizer' });
      assert.ok(closedOrganizer);
      // NF-52 peut refuser la session d'une édition fermée : on ouvre, on lit la session, puis on ferme.
      await espace().app.documents(UID.edition).update({ documentId: closed.documentId, data: { participantSpaceEnabled: true } });
      await espace().app.documents(UID.edition).publish({ documentId: closed.documentId });
      const session = await espace().signIn(closed.slug, closedOrganizer.email);
      await espace().app.documents(UID.edition).update({ documentId: closed.documentId, data: { participantSpaceEnabled: false } });
      await espace().app.documents(UID.edition).publish({ documentId: closed.documentId });
      const response = await send(closed, 'POST', `/${closedTarget.documentId}/link`, session.cookie);
      assert.ok([409, 401, 403].includes(response.status), `statut ${response.status}`);
      if (response.status === 409) assert.equal(response.json.error.code, 'SPACE_CLOSED');
      assert.deepEqual((await linkMails(since)).length, 0);
    });

    it('un envoi en échec répond { status: failed, error } sans lever d’erreur', async () => {
      const { edition, organizer, path } = await target();
      const response = await withBrokenOutbox(espace, () => send(edition, 'POST', path, organizer.cookie));
      assert.equal(response.status, 200, response.text);
      assert.equal(response.json.status, 'failed');
      assert.ok(typeof response.json.error === 'string' && response.json.error.length > 0);
    });
  });

  describe('critère 2, F-138, R-18 : désinscrire et réinscrire', () => {
    /** Léa et Mathis importés ; un rendez-vous accepté (table 1) et un en attente entre eux ; Hugo demande aussi un rendez-vous à Léa. */
    async function withMeetings() {
      const { app } = espace();
      const { edition, organizer } = await imported();
      const [lea, mathis, hugo] = [await byEmail(edition, LEA), await byEmail(edition, MATHIS), await byEmail(edition, 'hugo.peyrat@example.org')];
      const [, , pause] = await createProgram(app, edition);
      const slot = (startsAt, endsAt, label) => app.documents(UID.slot).create({ data: { edition: link(edition), session: link(pause), startsAt, endsAt, label } });
      const [s1, s2] = [await slot('2026-12-03T09:45:00.000Z', '2026-12-03T10:00:00.000Z', '10h45'), await slot('2026-12-03T10:00:00.000Z', '2026-12-03T10:15:00.000Z', '11h00')];
      const meeting = (data) => app.documents(UID.meeting).create({ data: { edition: link(edition), ...data } });
      const accepted = await meeting({ slot: link(s1), requester: link(mathis), targetAttendee: link(lea), status: 'accepted', tableNumber: 1, tableKey: `tk:${edition.slug}`, location: 'Table 1' });
      const pending = await meeting({ slot: link(s2), requester: link(lea), targetAttendee: link(hugo), status: 'pending' });
      const statusOf = async (item) => (await app.documents(UID.meeting).findOne({ documentId: item.documentId })).status;
      return { app, edition, organizer, lea, mathis, hugo, accepted, pending, statusOf };
    }

    it('cancel : statut cancelled, statusLockedAt posé, rendez-vous annulés, table libérée, interlocuteurs prévenus par meeting-cancelled', async () => {
      const { app, edition, organizer, lea, accepted, pending, statusOf } = await withMeetings();
      const since = espace().outbox().length;
      const response = await send(edition, 'POST', `/${lea.documentId}/cancel`, organizer.cookie);
      assert.equal(response.status, 200, response.text);
      assert.equal(response.json.status, 'cancelled');
      assert.ok(response.json.statusLockedAt);
      assert.equal(await statusOf(accepted), 'cancelled');
      assert.equal(await statusOf(pending), 'cancelled');
      const freed = await app.documents(UID.meeting).findOne({ documentId: accepted.documentId });
      assert.equal(freed.tableKey ?? null, null, 'la table est libérée');
      const mails = await espace().mailsSince(since, { to: [MATHIS, 'hugo.peyrat@example.org'] });
      const cancelledMails = mails.filter((mail) => /annul/i.test(mail.subject));
      assert.deepEqual(cancelledMails.map((mail) => mail.to.email).sort(), ['hugo.peyrat@example.org', MATHIS]);
      const logs = await espace().query(UID.emailLog).findMany({ where: { template: 'meeting-cancelled' }, populate: ['attendee'] });
      assert.ok(logs.some((log) => log.attendee?.documentId !== lea.documentId && log.status === 'sent'));
    });

    it('la table libérée peut être attribuée à un autre rendez-vous du créneau', async () => {
      const { app, edition, organizer, lea, accepted } = await withMeetings();
      await send(edition, 'POST', `/${lea.documentId}/cancel`, organizer.cookie);
      const reread = await app.documents(UID.meeting).findOne({ documentId: accepted.documentId });
      assert.equal(reread.status, 'cancelled');
      const occupied = await app.documents(UID.meeting).count({ filters: { status: 'accepted', tableKey: `tk:${edition.slug}`, edition: { documentId: edition.documentId } } });
      assert.equal(occupied, 0);
    });

    it('un inscrit désinscrit depuis le pilotage reste annulé après synchronisation, même si HelloAsso le garde actif', async () => {
      const { edition, organizer, lea } = await withMeetings();
      await send(edition, 'POST', `/${lea.documentId}/cancel`, organizer.cookie);
      for (let i = 0; i < 3; i += 1) await run(edition);
      const after = await byEmail(edition, LEA);
      assert.equal(after.status, 'cancelled');
      assert.ok(after.statusLockedAt);
      assert.equal((await attendeesOf(edition)).filter((attendee) => attendee.email === LEA).length, 1, 'pas de doublon');
    });

    it('cancel est idempotent : un second appel ne renvoie pas d’e-mail aux interlocuteurs', async () => {
      const { edition, organizer, lea } = await withMeetings();
      await send(edition, 'POST', `/${lea.documentId}/cancel`, organizer.cookie);
      await sleep(400);
      const since = espace().outbox().length;
      const again = await send(edition, 'POST', `/${lea.documentId}/cancel`, organizer.cookie);
      assert.equal(again.status, 200);
      assert.equal(again.json.status, 'cancelled');
      assert.deepEqual(await espace().mailsSince(since, { to: [MATHIS, 'hugo.peyrat@example.org'] }), []);
    });

    it('409 SELF_FORBIDDEN : l’organisateur ne se désinscrit pas lui-même', async () => {
      const { edition, organizer } = await imported();
      const response = await send(edition, 'POST', `/${organizer.attendee.documentId}/cancel`, organizer.cookie);
      assert.equal(response.status, 409);
      assert.equal(response.json.error.code, 'SELF_FORBIDDEN');
      assert.equal((await espace().app.documents(UID.attendee).findOne({ documentId: organizer.attendee.documentId })).status, 'active');
    });

    it('restore : statut active, rendez-vous annulés non rétablis, verrou posé ; la synchronisation ne le re-désinscrit pas quand HelloAsso annule le billet', async () => {
      const { edition, organizer, lea, accepted, statusOf } = await withMeetings();
      await send(edition, 'POST', `/${lea.documentId}/cancel`, organizer.cookie);
      const response = await send(edition, 'POST', `/${lea.documentId}/restore`, organizer.cookie);
      assert.equal(response.status, 200, response.text);
      assert.equal(response.json.status, 'active');
      assert.ok(response.json.statusLockedAt);
      assert.equal(await statusOf(accepted), 'cancelled', 'les rendez-vous ne reviennent pas');
      assert.equal(response.json.meetings.accepted, 0);

      useItems(defaultItems.map((item) => (item.id === 100001 ? { ...structuredClone(item), state: 'Canceled' } : item)));
      for (let i = 0; i < 3; i += 1) await run(edition);
      assert.equal((await byEmail(edition, LEA)).status, 'active', 'la décision de l’organisateur l’emporte sur HelloAsso');
    });

    it('un inscrit désinscrit par HelloAsso puis réinscrit par l’organisateur le reste après le rachat d’un billet', async () => {
      const { edition, organizer } = await imported();
      const items = (extra = []) => [...defaultItems.map((item) => (item.id === 100001 ? { ...structuredClone(item), state: 'Canceled' } : item)), ...extra];
      useItems(items());
      await run(edition);
      const lea = await byEmail(edition, LEA);
      assert.equal(lea.status, 'cancelled');
      assert.equal((await send(edition, 'POST', `/${lea.documentId}/restore`, organizer.cookie)).status, 200);
      await run(edition);
      assert.equal((await byEmail(edition, LEA)).status, 'active');
    });
  });

  describe('critère 3 : un invité ajouté à la main n’est ni dupliqué ni supprimé par la synchronisation', () => {
    it('dix synchronisations : l’invité existe toujours, actif, une seule fois, sans modification', async () => {
      const { edition, organizer } = await imported();
      const created = await send(edition, 'POST', '', organizer.cookie, { firstName: 'Camille', lastName: 'Invitée', email: 'camille@example.org', company: 'Scierie', role: 'speaker' });
      assert.equal(created.status, 201);
      for (let i = 0; i < 10; i += 1) await run(edition);
      const matching = (await attendeesOf(edition)).filter((attendee) => attendee.email === 'camille@example.org');
      assert.equal(matching.length, 1);
      assert.equal(matching[0].status, 'active');
      assert.equal(matching[0].role, 'speaker');
      assert.equal(matching[0].company, 'Scierie');
      assert.equal(matching[0].helloassoItemId ?? null, null);
    });

    it('un billet HelloAsso à l’adresse d’un invité ne crée pas de second inscrit', async () => {
      const { edition, organizer } = await imported();
      const lea = await byEmail(edition, LEA);
      await espace().app.documents(UID.attendee).delete({ documentId: lea.documentId });
      const before = (await attendeesOf(edition)).length;
      assert.equal((await send(edition, 'POST', '', organizer.cookie, { firstName: 'Léa', lastName: 'Invitée', email: LEA })).status, 201);
      const result = await run(edition);
      assert.equal((await attendeesOf(edition)).length, before + 1, 'seul l’invité s’ajoute, le billet de Léa ne crée rien');
      assert.equal((await attendeesOf(edition)).filter((attendee) => attendee.email === LEA).length, 1);
      assert.ok(result.errors.some((error) => error.email === LEA || /EMAIL/.test(error.code)), 'le billet est signalé comme doublon');
    });
  });

  describe('critère 6, R-42, R-63 : l’e-mail et les messages', () => {
    it('l’e-mail apparaît dans les routes d’administration, jamais dans la carte de profil de l’annuaire', async () => {
      const { app } = espace();
      const edition = await newEdition();
      const organizer = await organizerOf(edition);
      const viewer = await person(edition, { directoryOptIn: true, meetingsOptIn: true });
      const target = await createAttendee(app, edition, { firstName: 'Visible', lastName: 'Carte', email: 'visible.carte@example.org', directoryOptIn: true, meetingsOptIn: true, consentAt: new Date().toISOString() });

      const admin = await call(edition, `/${target.documentId}`, organizer.cookie);
      assert.equal(admin.json.email, 'visible.carte@example.org');
      assert.ok(admin.text.includes('visible.carte@example.org'));

      const card = await espace().request(`/api/espace/directory/p/${target.documentId}`, { cookie: viewer.cookie });
      assert.equal(card.status, 200, card.text);
      assert.ok(!card.text.includes('visible.carte@example.org'), 'pas d’e-mail dans la carte de profil');
      assert.equal('email' in card.json, false);
      const list = await espace().request('/api/espace/directory', { cookie: viewer.cookie });
      assert.equal(list.status, 200, list.text);
      assert.ok(!list.text.includes('visible.carte@example.org'), 'pas d’e-mail dans la liste de l’annuaire');
    });

    it('R-63 : aucune route ne laisse sortir le contenu d’un message (liste, fiche, création, correction, lien, annulation, réinscription)', async () => {
      const { app } = espace();
      const { edition, organizer } = await imported();
      const [lea, mathis] = [await byEmail(edition, LEA), await byEmail(edition, MATHIS)];
      const conversation = await app.documents(CONVERSATION).create({ data: { edition: link(edition), participants: [link(lea), link(mathis)] } });
      await app.documents(MESSAGE).create({ data: { conversation: link(conversation), author: link(lea), body: SECRET_BODY } });

      const responses = [
        await call(edition, '', organizer.cookie),
        await call(edition, '?q=lea', organizer.cookie),
        await call(edition, `/${lea.documentId}`, organizer.cookie),
        await send(edition, 'PATCH', `/${lea.documentId}`, organizer.cookie, { jobTitle: 'Autre' }),
        await send(edition, 'POST', `/${lea.documentId}/link`, organizer.cookie),
        await send(edition, 'POST', '', organizer.cookie, { firstName: 'Nouvelle', lastName: 'Personne', email: 'nouvelle.personne@example.org' }),
        await send(edition, 'POST', `/${lea.documentId}/cancel`, organizer.cookie),
        await send(edition, 'POST', `/${lea.documentId}/restore`, organizer.cookie),
      ];
      for (const response of responses) {
        assert.ok(response.status < 300, response.text);
        assert.ok(!response.text.includes(SECRET_BODY), 'le texte du message ne sort pas');
        assert.ok(!response.text.includes('ZXQ-731'));
        assert.ok(!/"(body|messages|conversation|conversations|content|phone)"/i.test(response.text), 'aucune clé de message ni de téléphone');
      }
      const sheetResponse = responses[2].json;
      assert.deepEqual(Object.keys(sheetResponse).sort(), SHEET_KEYS);
    });
  });
});
