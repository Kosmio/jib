'use strict';

/**
 * Lecture seule après l'événement, lot V4-F (docs/espace/specs/14-lots-finalisation.md) : NF-70.
 *
 * Champ `readOnlyAt` de l'édition (privé), sinon sa date + 7 jours à 00:00 UTC (lib/read-only.js). Passé cet instant :
 *   - toute écriture d'un participant en session répond 409 EDITION_READ_ONLY (middleware context.js) ;
 *   - exemptées : /espace/auth/*, PATCH /me dont le corps n'est que `emailPrefs`, le désabonnement des relances (sans session),
 *     toutes les routes /espace/admin/*, les GET et les exports ;
 *   - le send manuel des relances et du welcome répond 409 même côté organisateur (l'aperçu reste permis) ; `runDue` et `inviteNew` cessent ;
 *   - la carte publique de badge répond 404 CARD_NOT_FOUND ; l'API publique de l'édition expose `readOnly`, jamais `readOnlyAt`.
 *
 * Critères d'acceptation : 1 (après readOnlyAt, une demande de rendez-vous par l'API répond 409), 2 (l'export participants fonctionne),
 * 3 (avant readOnlyAt rien ne change). L'état de l'édition se règle par `readOnlyAt` ou par la date ; une session ouverte avant
 * la bascule est conservée (la bascule se fait sur les deux lignes, brouillon et publiée, de l'édition). Chaque test a son édition,
 * fermée à la fin : `runDue` parcourt toutes les éditions ouvertes.
 */

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { useEspace } = require('../helpers/espace');
const { UID, createAttendee } = require('../helpers/espace-data');
const { createMeetingEdition, createPerson, meetingsAt, useApi, useLogin } = require('../helpers/meetings-world');

const DAY_MS = 24 * 60 * 60 * 1000;
const dayOffset = (days) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
const PAST = '2020-01-01T00:00:00.000Z';
const FUTURE = '2100-01-01T00:00:00.000Z';
const NOW_J6 = new Date('2026-11-27T08:30:00Z'); // J-6 9h30 Paris pour l'édition du 3 décembre 2026

/** Instant du lendemain dont l'heure de Paris vaut `hour` h (dans les heures d'envoi). */
function parisInstant(hour) {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 1);
  const parisHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' });
  for (let utc = 0; utc < 24; utc += 1) {
    const candidate = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), utc, 0));
    if (Number(parisHour.format(candidate)) === hour) return candidate;
  }
  throw new Error(`Aucune heure de Paris ${hour}h`);
}

describe('lecture seule après l’événement (V4-F : NF-70)', { timeout: 900_000 }, () => {
  const espace = useEspace();
  const created = [];
  let counter = 0;

  const login = useLogin(espace);
  const api = useApi(espace);

  // Les éditions des tests précédents sont fermées (lignes brouillon et publiée) : `runDue` parcourt toutes les éditions ouvertes.
  afterEach(async () => {
    for (const edition of created.splice(0)) await espace().query(UID.edition).updateMany({ where: { documentId: edition.documentId }, data: { participantSpaceEnabled: false } });
  });

  /** Édition avec programme et créneaux ; `settings` règle `date` et `readOnlyAt`. */
  async function newEdition(settings = {}) {
    counter += 1;
    const world = await createMeetingEdition(espace().app, { slug: `lecture-seule-${counter}`, title: `Lecture seule ${counter}`, settings });
    created.push(world.edition);
    return world;
  }
  const person = (edition, fields = {}) => createPerson(espace().app, edition, fields);
  const organizerOf = async (edition) => login(edition, await person(edition, { role: 'organizer' }));
  const flip = (edition, data) => espace().query(UID.edition).updateMany({ where: { documentId: edition.documentId }, data });
  const refreshed = (attendee) => espace().app.documents(UID.attendee).findOne({ documentId: attendee.documentId });
  const published = (edition) => espace().app.documents(UID.edition).findOne({ documentId: edition.documentId, status: 'published' });
  const admin = (edition, suffix) => `/api/espace/admin/${edition.slug}${suffix}`;

  /** Une demande de rendez-vous de `lea` à `ines`, 10h45. */
  const ask = (world, cookie, ines) => api(cookie).post('/meetings', { slotId: world.slots['10h45'].documentId, target: `p:${ines.documentId}`, message: 'Bonjour, échangeons.' });

  /** Édition, deux participants et leurs sessions ouvertes avant toute bascule. */
  async function withSessions(settings) {
    const world = await newEdition(settings);
    const lea = await person(world.edition);
    const ines = await person(world.edition);
    return { ...world, lea, ines, leaCookie: await login(world.edition, lea), organizerCookie: await organizerOf(world.edition) };
  }

  describe('critère 3 : avant readOnlyAt, aucun comportement ne change', () => {
    it('date à venir, readOnlyAt vide : demande de rendez-vous 201, PATCH /me 200, readOnly faux dans l’API publique', async () => {
      const world = await withSessions();
      assert.equal((await ask(world, world.leaCookie, world.ines)).status, 201);
      assert.equal((await api(world.leaCookie).patch('/me', { firstName: 'Léa' })).status, 200);
      const edition = await espace().request(`/api/espace/editions/${world.edition.slug}`);
      assert.equal(edition.json.readOnly, false);
    });

    it('readOnlyAt dans le futur sur une date passée : le champ l’emporte, rien n’est refusé', async () => {
      const world = await withSessions({ date: dayOffset(-30), readOnlyAt: FUTURE });
      assert.equal((await api(world.leaCookie).patch('/me', { firstName: 'Léa' })).status, 200);
      assert.equal((await api(world.leaCookie).put('/me/consent', { directoryOptIn: true, meetingsOptIn: true, newsOptIn: false })).status, 200);
    });

    it('la veille de la bascule par défaut (date = aujourd’hui - 6 jours) : écriture permise', async () => {
      const world = await withSessions({ date: dayOffset(-6) });
      assert.equal((await api(world.leaCookie).patch('/me', { firstName: 'Léa' })).status, 200);
      assert.equal((await espace().request(`/api/espace/editions/${world.edition.slug}`)).json.readOnly, false);
    });

    it('la carte publique de badge répond 200', async () => {
      const { edition } = await newEdition();
      const attendee = await person(edition);
      const { token } = await espace().app.service('api::espace.badges').ensureToken(attendee);
      assert.equal((await espace().request(`/api/espace/cards/${edition.slug}/${token}`)).status, 200);
    });
  });

  describe('critère 1 : après readOnlyAt, toute écriture du participant répond 409 EDITION_READ_ONLY', () => {
    it('demande de rendez-vous par l’API : 409, code EDITION_READ_ONLY, message en français, aucun rendez-vous créé', async () => {
      const world = await withSessions();
      await flip(world.edition, { readOnlyAt: PAST });
      const response = await ask(world, world.leaCookie, world.ines);
      assert.equal(response.status, 409, response.text);
      assert.equal(response.json.error.code, 'EDITION_READ_ONLY');
      assert.match(response.json.error.message, /terminée/);
      assert.equal((await meetingsAt(espace().app, world.edition)).length, 0);
    });

    it('valeur par défaut : date de l’édition il y a 7 jours (J+7 à 00:00 UTC passé), sans readOnlyAt : 409', async () => {
      const world = await withSessions({ date: dayOffset(-7) });
      const response = await ask(world, world.leaCookie, world.ines);
      assert.equal(response.status, 409);
      assert.equal(response.json.error.code, 'EDITION_READ_ONLY');
    });

    it('session ouverte avant la bascule : l’écriture suivante est refusée, la lecture reste permise', async () => {
      const world = await withSessions();
      assert.equal((await api(world.leaCookie).patch('/me', { firstName: 'Avant' })).status, 200);
      await flip(world.edition, { readOnlyAt: PAST });
      assert.equal((await api(world.leaCookie).patch('/me', { firstName: 'Après' })).status, 409);
      assert.equal((await refreshed(world.lea)).firstName, 'Avant');
      assert.equal((await api(world.leaCookie).get('/me')).status, 200);
    });

    it('les autres écritures sont refusées aussi : consentement, conversation, réponse et annulation de rendez-vous', async () => {
      const world = await withSessions({ readOnlyAt: PAST });
      const calls = {
        'PUT /me/consent': api(world.leaCookie).put('/me/consent', { directoryOptIn: true, meetingsOptIn: true, newsOptIn: false }),
        'POST /conversations': api(world.leaCookie).post('/conversations', { target: `p:${world.ines.documentId}` }),
        'POST /meetings/:id/accept': api(world.leaCookie).post('/meetings/x/accept', {}),
        'POST /meetings/:id/cancel': api(world.leaCookie).post('/meetings/x/cancel', {}),
        'PATCH /me': api(world.leaCookie).patch('/me', { bio: 'Nouvelle présentation' }),
      };
      for (const [name, pending] of Object.entries(calls)) {
        const response = await pending;
        assert.equal(response.status, 409, name);
        assert.equal(response.json.error.code, 'EDITION_READ_ONLY', name);
      }
    });

    it('les lectures restent permises : /me, /meetings, annuaire, programme', async () => {
      const world = await withSessions({ readOnlyAt: PAST });
      for (const path of ['/me', '/meetings', '/conversations', '/directory', `/editions/${world.edition.slug}/program`]) {
        assert.equal((await api(world.leaCookie).get(path)).status, 200, path);
      }
    });
  });

  describe('exemptions : connexion, déconnexion, préférences e-mail, désabonnement', () => {
    it('connexion : demande de lien (202) et vérification (200) sur une édition en lecture seule', async () => {
      const world = await newEdition({ readOnlyAt: PAST });
      const attendee = await person(world.edition);
      const { response, cookie } = await espace().signIn(world.edition.slug, attendee.email);
      assert.equal(response.status, 200);
      assert.equal((await api(cookie).get('/me')).status, 200);
    });

    it('déconnexion : 204, la session est close', async () => {
      const world = await withSessions({ readOnlyAt: PAST });
      assert.equal((await espace().request('/api/espace/auth/logout', { method: 'POST', cookie: world.leaCookie })).status, 204);
      assert.equal((await api(world.leaCookie).get('/me')).status, 401);
    });

    it('PATCH /me dont le corps n’est que emailPrefs : 200 et préférence enregistrée', async () => {
      const world = await withSessions({ readOnlyAt: PAST });
      const response = await api(world.leaCookie).patch('/me', { emailPrefs: { meetingRequests: false, messages: true, reminders: false } });
      assert.equal(response.status, 200, response.text);
      assert.deepEqual((await refreshed(world.lea)).emailPrefs, { meetingRequests: false, messages: true, reminders: false });
    });

    it('PATCH /me mixte (emailPrefs et autre champ) : 409, aucun champ modifié, préférences intactes', async () => {
      const world = await withSessions({ readOnlyAt: PAST });
      const before = await refreshed(world.lea);
      const response = await api(world.leaCookie).patch('/me', { emailPrefs: { meetingRequests: false, messages: false, reminders: false }, bio: 'Glissé avec les préférences' });
      assert.equal(response.status, 409);
      assert.equal(response.json.error.code, 'EDITION_READ_ONLY');
      const after = await refreshed(world.lea);
      assert.equal(after.bio ?? null, before.bio ?? null);
      assert.deepEqual(after.emailPrefs ?? null, before.emailPrefs ?? null);
    });

    it('PATCH /me avec un corps vide : 409 (pas une exemption)', async () => {
      const world = await withSessions({ readOnlyAt: PAST });
      assert.equal((await api(world.leaCookie).patch('/me', {})).status, 409);
    });

    it('désabonnement des relances par le lien de l’e-mail (sans session) : 200 et `reminders` coupé', async () => {
      const world = await newEdition({ date: '2026-12-03' });
      const attendee = await person(world.edition, { emailPrefs: { meetingRequests: true, messages: true, reminders: true } });
      const since = espace().outbox().length;
      await espace().app.service('api::espace.reminders').send(world.edition, 'no-meeting', { now: new Date('2026-11-23T10:00:00Z') });
      const [mail] = (await espace().mailsSince(since, { settleMs: 50, to: [attendee.email] })).filter((candidate) => candidate.headers?.['List-Unsubscribe']);
      assert.ok(mail, 'le rappel est parti avant la bascule');
      const url = new URL(mail.headers['List-Unsubscribe'].slice(1, -1));
      await flip(world.edition, { readOnlyAt: PAST });
      const response = await espace().request(`${url.pathname}${url.search}`, { method: 'POST', form: { 'List-Unsubscribe': 'One-Click' }, origin: null });
      assert.equal(response.status, 200);
      assert.equal((await refreshed(attendee)).emailPrefs.reminders, false);
    });
  });

  describe('critère 2 et pilotage : les routes /espace/admin/* restent ouvertes', () => {
    it('critère 2 : l’export participants fonctionne (200, CSV avec les inscrits)', async () => {
      const world = await withSessions({ readOnlyAt: PAST });
      const response = await espace().request(admin(world.edition, '/export/participants.csv'), { cookie: world.organizerCookie });
      assert.equal(response.status, 200, response.text);
      assert.match(response.headers.get('content-type'), /csv/);
      assert.ok(response.text.includes(world.lea.email), 'le CSV contient les inscrits');
    });

    it('les autres exports et les statistiques répondent', async () => {
      const world = await withSessions({ readOnlyAt: PAST });
      for (const suffix of ['/export/meetings.csv', '/export/stats.csv', '/stats']) {
        assert.equal((await espace().request(admin(world.edition, suffix), { cookie: world.organizerCookie })).status, 200, suffix);
      }
    });

    it('une écriture du pilotage passe : annuler puis restaurer un inscrit (200)', async () => {
      const world = await withSessions({ readOnlyAt: PAST });
      for (const action of ['cancel', 'restore']) {
        const response = await espace().request(admin(world.edition, `/attendees/${world.ines.documentId}/${action}`), { method: 'POST', cookie: world.organizerCookie, json: {} });
        assert.equal(response.status, 200, `${action} : ${response.text}`);
      }
    });

    it('l’aperçu des relances et du welcome reste permis', async () => {
      const world = await withSessions({ readOnlyAt: PAST });
      const reminders = await espace().request(admin(world.edition, '/reminders/preview'), { method: 'POST', cookie: world.organizerCookie, json: { scenario: 'no-meeting' } });
      assert.equal(reminders.status, 200, reminders.text);
      const welcome = await espace().request(admin(world.edition, '/welcome/preview'), { method: 'POST', cookie: world.organizerCookie, json: {} });
      assert.equal(welcome.status, 200, welcome.text);
    });
  });

  describe('relances et welcome : plus aucun envoi après readOnlyAt', () => {
    it('send manuel des relances, même côté organisateur : 409 EDITION_READ_ONLY (avant la plage horaire), rien d’envoyé', async () => {
      const world = await withSessions({ readOnlyAt: PAST });
      const since = espace().outbox().length;
      const response = await espace().request(admin(world.edition, '/reminders/send'), { method: 'POST', cookie: world.organizerCookie, json: { scenario: 'no-meeting' } });
      assert.equal(response.status, 409);
      assert.equal(response.json.error.code, 'EDITION_READ_ONLY');
      assert.deepEqual(await espace().mailsSince(since, { settleMs: 100, to: [world.lea.email, world.ines.email] }), []);
    });

    it('send manuel du welcome, même côté organisateur : 409 EDITION_READ_ONLY, welcomeStartedAt toujours vide', async () => {
      const world = await withSessions({ readOnlyAt: PAST });
      const response = await espace().request(admin(world.edition, '/welcome/send'), { method: 'POST', cookie: world.organizerCookie, json: {} });
      assert.equal(response.status, 409);
      assert.equal(response.json.error.code, 'EDITION_READ_ONLY');
      assert.equal((await published(world.edition)).welcomeStartedAt ?? null, null);
    });

    it('runDue : une édition en lecture seule ne reçoit rien ; la même édition avant readOnlyAt reçoit ses relances', async () => {
      const world = await newEdition({ date: '2026-12-03', readOnlyAt: '2026-11-20T00:00:00.000Z' });
      const target = await person(world.edition, { activatedAt: '2026-11-18T10:00:00.000Z' });
      let since = espace().outbox().length;
      assert.deepEqual(await espace().app.service('api::espace.reminders').runDue({ now: NOW_J6 }), { sent: 0, failed: 0 });
      assert.deepEqual(await espace().mailsSince(since, { settleMs: 100, to: [target.email] }), []);

      await flip(world.edition, { readOnlyAt: '2026-12-20T00:00:00.000Z' });
      since = espace().outbox().length;
      const result = await espace().app.service('api::espace.reminders').runDue({ now: NOW_J6 });
      assert.ok(result.sent > 0, 'avant readOnlyAt la tâche envoie');
      assert.ok((await espace().mailsSince(since, { settleMs: 100, to: [target.email] })).length > 0);
    });

    it('inviteNew : un nouvel inscrit n’est pas invité après readOnlyAt, il l’est avant', async () => {
      const world = await newEdition({ welcomeStartedAt: parisInstant(10).toISOString(), readOnlyAt: PAST });
      const newcomer = await createAttendee(espace().app, world.edition, { consentAt: new Date().toISOString() });
      const welcome = espace().app.service('api::espace.welcome');
      let since = espace().outbox().length;
      await welcome.inviteNew(await published(world.edition), parisInstant(14));
      assert.deepEqual(await espace().mailsSince(since, { settleMs: 200, to: [newcomer.email] }), []);

      await flip(world.edition, { readOnlyAt: FUTURE });
      since = espace().outbox().length;
      await welcome.inviteNew(await published(world.edition), parisInstant(14));
      assert.equal((await espace().mailsSince(since, { settleMs: 200, to: [newcomer.email] })).length, 1, 'avant readOnlyAt le nouvel inscrit est invité');
    });
  });

  describe('carte publique de badge et API publique de l’édition', () => {
    it('la carte répond 404 CARD_NOT_FOUND après readOnlyAt', async () => {
      const { edition } = await newEdition();
      const attendee = await person(edition);
      const { token } = await espace().app.service('api::espace.badges').ensureToken(attendee);
      await flip(edition, { readOnlyAt: PAST });
      const response = await espace().request(`/api/espace/cards/${edition.slug}/${token}`);
      assert.equal(response.status, 404);
      assert.equal(response.json.error.code, 'CARD_NOT_FOUND');
    });

    it('l’API de l’édition expose readOnly vrai, sans jamais exposer readOnlyAt', async () => {
      const { edition } = await newEdition({ readOnlyAt: PAST });
      const response = await espace().request(`/api/espace/editions/${edition.slug}`);
      assert.equal(response.status, 200);
      assert.equal(response.json.readOnly, true);
      assert.ok(!('readOnlyAt' in response.json));
    });
  });
});
