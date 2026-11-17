'use strict';

/**
 * Plusieurs éditions dans le pilotage, lot V5-C (E9) : sélecteur d'édition, bascule sans nouveau lien, duplication d'une édition.
 *
 *   - GET  /api/espace/admin/editions        : éditions publiées que la personne peut piloter, date décroissante ;
 *   - POST /api/espace/admin/{e}/switch      : session de la cible sans e-mail, 303 vers son pilotage, ancienne session supprimée ;
 *   - POST /api/espace/admin/{e}/duplicate   : nouvelle édition en brouillon (réglages, séquences en brouillon, thèmes), aucune donnée personnelle.
 *
 * Critères de V5-C : 1. bascule sans e-mail entre deux éditions ; 2. participant ou organisateur d'une seule édition : 403 ;
 * 3. copie avec séquences et réglages, sans donnée personnelle, non publiée ; 4. slug déjà pris : 409.
 * Aucun réseau hors localhost ; les adresses sont fictives (@example.org).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { SESSION_COOKIE, cookieHeader, parseSetCookie, useEspace } = require('../helpers/espace');
const { UID, createAttendee, createEdition, createProgram, link } = require('../helpers/espace-data');
const { createExhibitor, createSpeaker, createTopic } = require('../helpers/meetings-world');

const LISTED = Array.from({ length: 12 }, (_, index) => `liste.${index + 1}@example.org`);
const INTERVENTION = 'api::intervention.intervention';
const TAG = 'api::tag.tag';
const ORGANISATION = 'api::organisation.organisation';

const SOURCE_SETTINGS = { date: '2026-12-03', slotDurationMinutes: 20, tablesCount: 7, hero_bg_color: '#112233', city: 'Limoges', region: 'occitanie' };

describe('plusieurs éditions dans le pilotage (V5-C)', { timeout: 300_000 }, () => {
  const espace = useEspace({ overrides: { ORGANIZER_EMAILS: LISTED.join(',') } });

  let counter = 0;
  let listedIndex = 0;
  const nextListed = () => LISTED[listedIndex++];
  const uniqueEmail = (prefix) => `${prefix}.${(counter += 1)}@example.org`;

  // Monde partagé : A (modèle, 2026), B (2027, plus récente), C (2025), D (brouillon seul).
  let worldPromise;
  const world = () =>
    (worldPromise ??= (async () => {
      const { app } = espace();
      const a = await createEdition(app, { slug: 'modele-a', title: 'Modèle A', settings: SOURCE_SETTINGS });
      const b = await createEdition(app, { slug: 'edition-b', title: 'Édition B', settings: { date: '2027-03-01' } });
      const c = await createEdition(app, { slug: 'edition-c', title: 'Édition C', settings: { date: '2025-05-05' } });
      const d = await createEdition(app, { slug: 'edition-d-brouillon', title: 'Édition D brouillon', draft: true });
      const program = await createProgram(app, a);

      // Contenu du modèle : tag et organisation sur une séquence, thèmes rattachés à des séquences, intervention, et toutes les données
      // personnelles et de rendez-vous qui ne doivent pas être copiées.
      const tag = await app.documents(TAG).create({ data: { name: 'Tag du modèle' } });
      const organisation = await app.documents(ORGANISATION).create({ data: { name: 'Organisation du modèle', slug: 'org-modele' }, status: 'published' });
      await app.documents(UID.sequence).update({ documentId: program[1].documentId, data: { tags: [link(tag)], organisations: [link(organisation)] } });
      const topicForet = await createTopic(app, a, 'Forêt');
      const topicVide = await createTopic(app, a, 'Thème sans séance');
      await app.documents(UID.topic).update({ documentId: topicForet.documentId, data: { sessions: [link(program[1]), link(program[3])] } });
      await createSpeaker(app, a, { name: 'Intervenante Fictive', sequence: program[1] });
      await app.service('api::espace.slots').regenerate(a.documentId);

      const alice = await createAttendee(app, a, { consentAt: new Date().toISOString() });
      const bob = await createAttendee(app, a, { consentAt: new Date().toISOString() });
      const { exhibitor } = await createExhibitor(app, a, { name: 'Exposant du modèle' });
      const [slot] = await app.documents(UID.slot).findMany({ filters: { edition: { documentId: a.documentId } }, limit: 1 });
      await app.documents(UID.meeting).create({
        data: { edition: link(a), slot: link(slot), requester: link(alice), targetAttendee: link(bob), status: 'pending', message: 'Bonjour' },
      });
      await app.documents(UID.syncRun).create({ data: { edition: link(a), startedAt: new Date(), endedAt: new Date(), created: 1, updated: 0, cancelled: 0, errors: [] } }).catch(() => null);
      void exhibitor;
      return { a, b, c, d, program, topicForet, topicVide, tag, organisation };
    })());

  /** Attendee organisateur actif dans chaque édition de `editions`, puis session ouverte dans la première par le parcours réel. */
  async function pilot(editions, { email = uniqueEmail('pilote'), fields = {} } = {}) {
    const { app, signIn } = espace();
    for (const edition of editions) await createAttendee(app, edition, { email, role: 'organizer', consentAt: new Date().toISOString(), ...fields });
    return { email, ...(await signIn(editions[0].slug, email)) };
  }

  /** Personne de ORGANIZER_EMAILS (aucun Attendee préalable) connectée à l'édition donnée. Une adresse par appel. */
  async function listed(edition) {
    const email = nextListed();
    return { email, ...(await espace().signIn(edition.slug, email)) };
  }

  const get = (path, cookie, options) => espace().request(`/api/espace${path}`, { cookie, ...options });
  const post = (path, cookie, json, options) => espace().request(`/api/espace${path}`, { method: 'POST', cookie, json, ...options });
  // L'édition de l'URL est la cible (spec V5-C) ; `from` ne sert qu'à la lisibilité des tests.
  const switchTo = (from, target, options) => espace().request(`/api/espace/admin/${target}/switch`, { method: 'POST', cookie: options?.cookie, form: {}, ...options });
  const sessionRows = (attendee) => espace().query(UID.magicToken).findMany({ where: { attendee: { documentId: attendee.documentId }, kind: 'session' } });
  const attendeeRows = (edition, email) =>
    espace().app.documents(UID.attendee).findMany({ filters: { email, edition: { documentId: edition.documentId } }, limit: 10 });
  const sessionCount = async (email) => (await espace().query(UID.magicToken).findMany({ where: { attendee: { email }, kind: 'session' } })).length;
  const count = (uid) => espace().app.documents(uid).count({});
  const draftOf = async (slug) => (await espace().app.documents(UID.edition).findMany({ filters: { slug }, status: 'draft', populate: ['lieux'], limit: 2 }))[0];
  const publishedOf = async (slug) => (await espace().app.documents(UID.edition).findMany({ filters: { slug }, status: 'published', limit: 2 }))[0];
  const editionsWithSlug = async (slug) => new Set((await espace().query(UID.edition).findMany({ where: { slug } })).map((row) => row.documentId)).size;

  describe('GET /admin/editions : éditions pilotables', () => {
    it('401 sans session, 403 pour un participant', async () => {
      const { a } = await world();
      const { app, signIn } = espace();
      assert.equal((await get('/admin/editions')).status, 401);
      const participant = await createAttendee(app, a, { consentAt: new Date().toISOString() });
      const { cookie } = await signIn(a.slug, participant.email);
      const response = await get('/admin/editions', cookie);
      assert.equal(response.status, 403);
      assert.equal(response.json.error.code, 'FORBIDDEN');
    });

    it('un organisateur de deux éditions les voit toutes deux, de la plus récente à la plus ancienne, avec current sur celle de la session', async () => {
      const { a, b } = await world();
      const { cookie } = await pilot([a, b]);
      const response = await get('/admin/editions', cookie);
      assert.equal(response.status, 200);
      assert.deepEqual(response.json, [
        { slug: 'edition-b', title: 'Édition B', date: '2027-03-01', city: response.json[0].city, current: false },
        { slug: 'modele-a', title: 'Modèle A', date: '2026-12-03', city: 'Limoges', current: true },
      ]);
    });

    it('chaque élément n’a que slug, title, date, city, current', async () => {
      const { a } = await world();
      const { cookie } = await pilot([a]);
      const [item] = (await get('/admin/editions', cookie)).json;
      assert.deepEqual(Object.keys(item).sort(), ['city', 'current', 'date', 'slug', 'title']);
    });

    it('un organisateur d’une seule édition ne voit que celle-ci', async () => {
      const { a } = await world();
      const { cookie } = await pilot([a]);
      assert.deepEqual((await get('/admin/editions', cookie)).json.map((item) => item.slug), ['modele-a']);
    });

    it('une adresse de ORGANIZER_EMAILS voit toutes les éditions publiées, sans Attendee dans les autres ; le brouillon est absent', async () => {
      const { a } = await world();
      const { cookie } = await listed(a);
      const slugs = (await get('/admin/editions', cookie)).json.map((item) => item.slug);
      for (const slug of ['edition-b', 'modele-a', 'edition-c']) assert.ok(slugs.includes(slug), `${slug} absent de ${slugs}`);
      assert.ok(!slugs.includes('edition-d-brouillon'), 'brouillon listé');
    });

    it('l’ordre est celui de la date décroissante', async () => {
      const { a } = await world();
      const { cookie } = await listed(a);
      const dates = (await get('/admin/editions', cookie)).json.map((item) => item.date).filter(Boolean);
      assert.deepEqual(dates, [...dates].sort().reverse());
    });

    it('une édition en brouillon, même avec un Attendee organisateur, n’est pas listée', async () => {
      const { a, d } = await world();
      const { cookie } = await pilot([a, d]);
      assert.deepEqual((await get('/admin/editions', cookie)).json.map((item) => item.slug), ['modele-a']);
    });

    it('un Attendee organisateur annulé dans une édition ne la rend pas pilotable', async () => {
      const { a, b } = await world();
      const { app } = espace();
      const email = uniqueEmail('annule');
      await createAttendee(app, b, { email, role: 'organizer', status: 'cancelled' });
      const { cookie } = await pilot([a], { email });
      assert.deepEqual((await get('/admin/editions', cookie)).json.map((item) => item.slug), ['modele-a']);
    });

    it('un Attendee de rôle participant dans une autre édition ne la rend pas pilotable', async () => {
      const { a, b } = await world();
      const { app } = espace();
      const email = uniqueEmail('mixte');
      await createAttendee(app, b, { email, role: 'participant' });
      const { cookie } = await pilot([a], { email });
      assert.deepEqual((await get('/admin/editions', cookie)).json.map((item) => item.slug), ['modele-a']);
    });
  });

  describe('POST /admin/{e}/switch : passer à une autre édition (critères 1 et 2)', () => {
    it('critère 1 : un organisateur des deux éditions passe de A à B sans e-mail : 303 vers le pilotage de B, cookie posé, ancienne session supprimée', async () => {
      const { a, b } = await world();
      const { outbox, publicUrl } = espace();
      const { cookie, email } = await pilot([a, b]);
      const mailsBefore = outbox().length;
      const response = await switchTo(a.slug, b.slug, { cookie });
      assert.equal(response.status, 303, response.text);
      assert.equal(response.location, `${publicUrl}/espace/${b.slug}/organisateur`);
      const issued = response.setCookies.map(parseSetCookie).find(({ name }) => name === SESSION_COOKIE);
      assert.ok(issued?.value, 'cookie de session absent');
      assert.equal(issued.attributes.httponly, true);

      const newCookie = cookieHeader(response.setCookies);
      const profile = await get('/me', newCookie);
      assert.equal(profile.status, 200);
      assert.equal(profile.json.isOrganizer, true);
      assert.equal(profile.json.edition.slug, b.slug);
      assert.equal((await get('/me', cookie)).status, 401, 'l’ancienne session doit être révoquée');
      assert.equal(await sessionCount(email), 1);
      assert.equal(outbox().length, mailsBefore, 'la bascule n’envoie aucun e-mail');
    });

    it('la bascule marche dans les deux sens (B puis retour à A)', async () => {
      const { a, b } = await world();
      const { cookie } = await pilot([a, b]);
      const toB = await switchTo(a.slug, b.slug, { cookie });
      const back = await switchTo(b.slug, a.slug, { cookie: cookieHeader(toB.setCookies) });
      assert.equal(back.status, 303);
      assert.ok(back.location.endsWith(`/espace/${a.slug}/organisateur`));
      assert.equal((await get('/me', cookieHeader(back.setCookies))).json.edition.slug, a.slug);
    });

    it('une personne de ORGANIZER_EMAILS passe à une édition où elle n’a aucun Attendee : un Attendee organizer actif y est créé, sans consentement', async () => {
      const { a, c } = await world();
      const { cookie, email } = await listed(a);
      assert.equal((await attendeeRows(c, email)).length, 0);
      const response = await switchTo(a.slug, c.slug, { cookie });
      assert.equal(response.status, 303, response.text);
      const rows = await attendeeRows(c, email);
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0].role, rows[0].status, rows[0].directoryOptIn, rows[0].meetingsOptIn], ['organizer', 'active', false, false]);
      assert.equal(rows[0].consentAt ?? null, null);
      assert.equal((await get('/me', cookieHeader(response.setCookies))).json.edition.slug, c.slug);
    });

    it('deux bascules successives vers la même édition ne créent qu’un Attendee', async () => {
      const { a, c } = await world();
      const { cookie, email } = await listed(a);
      const first = await switchTo(a.slug, c.slug, { cookie });
      await switchTo(c.slug, a.slug, { cookie: cookieHeader(first.setCookies) });
      const again = await get('/me', cookieHeader((await switchTo(a.slug, c.slug, { cookie: (await signInAgain(a, email)).cookie })).setCookies));
      assert.equal(again.json.edition.slug, c.slug);
      assert.equal((await attendeeRows(c, email)).length, 1);
    });

    async function signInAgain(edition, email) {
      return espace().signIn(edition.slug, email);
    }

    it('cible = édition courante : 303 vers son pilotage, aucune nouvelle session, session conservée', async () => {
      const { a } = await world();
      const { cookie, email } = await pilot([a]);
      const response = await switchTo(a.slug, a.slug, { cookie });
      assert.equal(response.status, 303);
      assert.ok(response.location.endsWith(`/espace/${a.slug}/organisateur`));
      assert.equal(response.setCookies.filter((line) => line.startsWith(`${SESSION_COOKIE}=`)).length, 0);
      assert.equal(await sessionCount(email), 1);
      assert.equal((await get('/me', cookie)).status, 200);
    });

    it('cible inconnue : 404 EDITION_NOT_FOUND, session intacte', async () => {
      const { a } = await world();
      const { cookie } = await pilot([a]);
      const response = await switchTo(a.slug, 'edition-inconnue', { cookie });
      assert.equal(response.status, 404);
      assert.equal(response.json.error.code, 'EDITION_NOT_FOUND');
      assert.equal((await get('/me', cookie)).status, 200);
    });

    it('cible en brouillon (non publiée) : 404 EDITION_NOT_FOUND, même pour une adresse de ORGANIZER_EMAILS', async () => {
      const { a, d } = await world();
      const { cookie } = await listed(a);
      const response = await switchTo(a.slug, d.slug, { cookie });
      assert.equal(response.status, 404);
      assert.equal(response.json.error.code, 'EDITION_NOT_FOUND');
    });

    it('critère 2 : un participant ne peut pas basculer (403 FORBIDDEN), aucune session n’est créée', async () => {
      const { a, b } = await world();
      const { app, signIn } = espace();
      const participant = await createAttendee(app, a, { consentAt: new Date().toISOString() });
      const { cookie } = await signIn(a.slug, participant.email);
      const response = await switchTo(a.slug, b.slug, { cookie });
      assert.equal(response.status, 403);
      assert.equal(response.json.error.code, 'FORBIDDEN');
      assert.equal(response.setCookies.length, 0);
      assert.equal(await sessionCount(participant.email), 1);
    });

    it('critère 2 : l’organisateur de A seule ne peut pas passer à B (403), sans Attendee créé ni session nouvelle, session conservée', async () => {
      const { a, b } = await world();
      const { cookie, email } = await pilot([a]);
      const response = await switchTo(a.slug, b.slug, { cookie });
      assert.equal(response.status, 403);
      assert.equal(response.json.error.code, 'FORBIDDEN');
      assert.equal((await attendeeRows(b, email)).length, 0);
      assert.equal(await sessionCount(email), 1);
      assert.equal((await get('/me', cookie)).status, 200);
    });

    it('un participant de la cible (même adresse) n’ouvre pas de session d’organisateur : 403', async () => {
      const { a, b } = await world();
      const email = uniqueEmail('participant-cible');
      await createAttendee(espace().app, b, { email, role: 'participant' });
      const { cookie } = await pilot([a], { email });
      const response = await switchTo(a.slug, b.slug, { cookie });
      assert.equal(response.status, 403);
      assert.equal(response.json.error.code, 'FORBIDDEN');
    });

    it('un Attendee organisateur inactif (annulé) dans la cible : 403', async () => {
      const { a, b } = await world();
      const email = uniqueEmail('inactif');
      await createAttendee(espace().app, b, { email, role: 'organizer', status: 'cancelled' });
      const { cookie } = await pilot([a], { email });
      const response = await switchTo(a.slug, b.slug, { cookie });
      assert.equal(response.status, 403);
      assert.equal(response.json.error.code, 'FORBIDDEN');
      assert.equal((await get('/me', cookie)).status, 200);
    });

    it('une adresse de ORGANIZER_EMAILS dont l’Attendee de la cible est annulé : 403, il n’est pas réactivé', async () => {
      const { a, b } = await world();
      const { cookie, email } = await listed(a);
      await createAttendee(espace().app, b, { email, role: 'participant', status: 'cancelled' });
      const response = await switchTo(a.slug, b.slug, { cookie });
      assert.equal(response.status, 403);
      assert.equal((await attendeeRows(b, email))[0].status, 'cancelled');
    });

    it('sans session : 401', async () => {
      const { a, b } = await world();
      const response = await switchTo(a.slug, b.slug);
      assert.equal(response.status, 401);
    });

    it('NF-04 : sans Origin admis, 403 ORIGIN_REFUSED et la session reste ouverte', async () => {
      const { a, b } = await world();
      const { cookie, email } = await pilot([a, b]);
      for (const origin of [null, 'https://evil.example.org']) {
        const response = await switchTo(a.slug, b.slug, { cookie, origin });
        assert.equal(response.status, 403, String(origin));
        assert.equal(response.json.error.code, 'ORIGIN_REFUSED');
        assert.equal(response.setCookies.length, 0);
      }
      assert.equal(await sessionCount(email), 1);
      assert.equal((await get('/me', cookie)).status, 200);
    });

    it('un identifiant de cible hostile ne sort jamais de PUBLIC_URL', async () => {
      const { a } = await world();
      const { publicUrl } = espace();
      const { cookie } = await listed(a);
      for (const hostile of ['..%2F..%2Fevil', '%2F%2Fevil.example.org', 'https:%2F%2Fevil.example.org']) {
        const response = await espace().request(`/api/espace/admin/${hostile}/switch`, { method: 'POST', cookie, form: {} });
        assert.ok([303, 404].includes(response.status), `${hostile} : ${response.status}`);
        if (response.location) assert.equal(new URL(response.location).origin, new URL(publicUrl).origin, response.location);
      }
    });
  });

  describe('POST /admin/{e}/duplicate : modèle d’édition (critères 3 et 4)', () => {
    const duplicate = (from, cookie, json, options) => post(`/admin/${from}/duplicate`, cookie, json, options);
    const input = (overrides = {}) => ({ title: 'Nouvelle-Aquitaine 2027', slug: 'nouvelle-aquitaine-2027', date: '2027-06-15', ...overrides });
    let slugCounter = 0;
    const freshSlug = () => `copie-${(slugCounter += 1)}`;

    it('401 sans session, 403 pour un participant, 403 pour l’organisateur d’une autre édition, 404 pour une édition inconnue', async () => {
      const { a, b } = await world();
      const { app, signIn } = espace();
      assert.equal((await duplicate(a.slug, undefined, input({ slug: freshSlug() }))).status, 401);
      const participant = await createAttendee(app, a, { consentAt: new Date().toISOString() });
      const asParticipant = await signIn(a.slug, participant.email);
      assert.equal((await duplicate(a.slug, asParticipant.cookie, input({ slug: freshSlug() }))).status, 403);
      const organizerOfB = await pilot([b]);
      const crossing = await duplicate(a.slug, organizerOfB.cookie, input({ slug: freshSlug() }));
      assert.equal(crossing.status, 403);
      assert.equal(crossing.json.error.code, 'FORBIDDEN');
      const organizerOfA = await pilot([a]);
      assert.equal((await duplicate('inconnue', organizerOfA.cookie, input({ slug: freshSlug() }))).status, 403);
    });

    it('NF-04 : Origin absent ou refusé, 403 ORIGIN_REFUSED et rien n’est créé', async () => {
      const { a } = await world();
      const { cookie } = await pilot([a]);
      const slug = freshSlug();
      for (const origin of [null, 'https://evil.example.org']) {
        const response = await duplicate(a.slug, cookie, input({ slug }), { origin });
        assert.equal(response.status, 403);
        assert.equal(response.json.error.code, 'ORIGIN_REFUSED');
      }
      assert.equal(await editionsWithSlug(slug), 0);
    });

    it('validation : 400 VALIDATION avec fields.title, fields.slug et fields.date, et rien n’est créé', async () => {
      const { a } = await world();
      const { cookie } = await pilot([a]);
      const before = await count(UID.edition);
      const empty = await duplicate(a.slug, cookie, {});
      assert.equal(empty.status, 400);
      assert.equal(empty.json.error.code, 'VALIDATION');
      assert.deepEqual(Object.keys(empty.json.error.fields).sort(), ['date', 'slug', 'title']);

      const cases = [
        ['title', { title: '   ' }],
        ['title', { title: 'x'.repeat(201) }],
        ['title', { title: 42 }],
        ['slug', { slug: 'Majuscules' }],
        ['slug', { slug: 'avec espace' }],
        ['slug', { slug: 'tiret-final-' }],
        ['slug', { slug: 'double--tiret' }],
        ['slug', { slug: 'accentué' }],
        ['slug', { slug: `a${'b'.repeat(100)}` }],
        ['slug', { slug: '' }],
        ['date', { date: '2027-02-30' }],
        ['date', { date: '2027-2-3' }],
        ['date', { date: '03/12/2027' }],
        ['date', { date: '2027-13-01' }],
        ['date', { date: '' }],
        ['date', { date: 20270615 }],
      ];
      for (const [field, change] of cases) {
        const response = await duplicate(a.slug, cookie, input({ slug: freshSlug(), ...change }));
        assert.equal(response.status, 400, JSON.stringify(change));
        assert.equal(response.json.error.code, 'VALIDATION');
        assert.ok(response.json.error.fields[field], `${field} non signalé pour ${JSON.stringify(change)}`);
      }
      assert.equal(await count(UID.edition), before);
    });

    it('un corps qui n’est pas un objet JSON est refusé en 400 VALIDATION', async () => {
      const { a } = await world();
      const { cookie } = await pilot([a]);
      const response = await espace().request(`/api/espace/admin/${a.slug}/duplicate`, { method: 'POST', cookie });
      assert.equal(response.status, 400);
      assert.equal(response.json.error.code, 'VALIDATION');
    });

    it('critère 4 : slug déjà pris (édition publiée, brouillon seul ou modèle lui-même) : 409 SLUG_TAKEN, aucune édition créée', async () => {
      const { a, b, d } = await world();
      const { cookie } = await pilot([a]);
      const before = await count(UID.edition);
      for (const slug of [b.slug, d.slug, a.slug]) {
        const response = await duplicate(a.slug, cookie, input({ slug }));
        assert.equal(response.status, 409, slug);
        assert.equal(response.json.error.code, 'SLUG_TAKEN');
        assert.ok(response.json.error.fields?.slug, 'fields.slug absent');
        assert.equal(await editionsWithSlug(slug), 1);
      }
      assert.equal(await count(UID.edition), before);
    });

    it('deux duplications simultanées du même slug : une seule réussit (201), l’autre répond 409', async () => {
      const { a } = await world();
      const { cookie } = await pilot([a]);
      const slug = freshSlug();
      const results = await Promise.all([duplicate(a.slug, cookie, input({ slug })), duplicate(a.slug, cookie, input({ slug }))]);
      assert.deepEqual(results.map((response) => response.status).sort(), [201, 409]);
      assert.equal(await editionsWithSlug(slug), 1);
    });

    it('critère 3 : 201 { slug } ; titre, slug et date saisis (espaces retirés), édition en brouillon seulement, espace fermé', async () => {
      const { a } = await world();
      const { cookie } = await pilot([a]);
      const slug = freshSlug();
      const response = await duplicate(a.slug, cookie, { title: '  Limousin 2027  ', slug: `  ${slug}  `, date: '2027-06-15' });
      assert.equal(response.status, 201, response.text);
      assert.deepEqual(response.json, { slug });
      const copy = await draftOf(slug);
      assert.equal(copy.title, 'Limousin 2027');
      assert.equal(copy.date, '2027-06-15');
      assert.equal(copy.year, 2027);
      assert.equal(copy.participantSpaceEnabled, false);
      assert.equal(await publishedOf(slug), undefined, 'l’édition copiée ne doit pas être publiée');
    });

    it('critère 3 : la copie reprend région, ville, couleur, lieux, durée des créneaux et nombre de tables du modèle', async () => {
      const { a } = await world();
      const { cookie } = await pilot([a]);
      const slug = freshSlug();
      assert.equal((await duplicate(a.slug, cookie, input({ slug }))).status, 201);
      const copy = await draftOf(slug);
      const source = await draftOf(a.slug);
      assert.equal(copy.region, 'occitanie');
      assert.equal(copy.city, 'Limoges');
      assert.equal(copy.hero_bg_color, '#112233');
      assert.equal(copy.slotDurationMinutes, 20);
      assert.equal(copy.tablesCount, 7);
      assert.ok(source.lieux.length >= 1);
      assert.deepEqual(copy.lieux.map(({ name, address, time_slot }) => ({ name, address, time_slot })), source.lieux.map(({ name, address, time_slot }) => ({ name, address, time_slot })));
    });

    it('critère 3 : pas de fenêtre de rendez-vous, de formulaire HelloAsso, d’accueil ni de page publiée copiés', async () => {
      const { a } = await world();
      const { cookie } = await pilot([a]);
      const slug = freshSlug();
      await duplicate(a.slug, cookie, input({ slug }));
      const copy = await draftOf(slug);
      for (const field of ['meetingRequestsOpenAt', 'meetingRequestsCloseAt', 'helloassoOrgSlug', 'helloassoFormSlug', 'helloassoFieldMap', 'welcomeStartedAt']) {
        assert.equal(copy[field] ?? null, null, field);
      }
    });

    it('critère 3 : les séquences du modèle sont copiées en brouillon, dans l’ordre, avec leurs étiquettes et organisations', async () => {
      const { a, program, tag, organisation } = await world();
      const { app } = espace();
      const { cookie } = await pilot([a]);
      const slug = freshSlug();
      assert.equal((await duplicate(a.slug, cookie, input({ slug }))).status, 201);

      const filters = { edition: { slug } };
      const populate = { tags: { fields: ['documentId'] }, organisations: { fields: ['documentId'] } };
      const drafts = await app.documents(UID.sequence).findMany({ filters, status: 'draft', populate, sort: ['order:asc'], limit: 100 });
      const published = await app.documents(UID.sequence).findMany({ filters, status: 'published', limit: 100 });
      assert.equal(published.length, 0, 'aucune séquence publiée dans la copie');
      assert.equal(drafts.length, program.length);
      assert.deepEqual(
        drafts.map(({ title, start_time, end_time, kind, order }) => ({ title, start_time, end_time, kind, order })),
        program.map(({ title, start_time, end_time, kind, order }) => ({ title, start_time, end_time, kind, order })),
      );
      const withTag = drafts.find((sequence) => sequence.title === program[1].title);
      assert.deepEqual(withTag.tags.map((t) => t.documentId), [tag.documentId]);
      assert.deepEqual(withTag.organisations.map((o) => o.documentId), [organisation.documentId]);

      // Le modèle garde les siennes, avec les mêmes liens : la copie ne vole rien.
      const original = await app.documents(UID.sequence).findOne({ documentId: program[1].documentId, populate });
      assert.deepEqual(original.tags.map((t) => t.documentId), [tag.documentId]);
      assert.equal((await app.documents(UID.sequence).findMany({ filters: { edition: { slug: a.slug } }, status: 'draft', limit: 100 })).length, program.length);
    });

    it('critère 3 : les thèmes sont copiés et rattachés aux séquences copiées (jamais à celles du modèle)', async () => {
      const { a, program } = await world();
      const { app } = espace();
      const { cookie } = await pilot([a]);
      const slug = freshSlug();
      await duplicate(a.slug, cookie, input({ slug }));
      const topics = await app.documents(UID.topic).findMany({ filters: { edition: { slug } }, populate: { sessions: { fields: ['documentId', 'title'] } }, limit: 50 });
      assert.deepEqual(topics.map((topic) => topic.name).sort(), ['Forêt', 'Thème sans séance']);
      const foret = topics.find((topic) => topic.name === 'Forêt');
      assert.deepEqual(foret.sessions.map((session) => session.title).sort(), [program[1].title, program[3].title].sort());
      const originals = new Set(program.map((sequence) => sequence.documentId));
      assert.ok(foret.sessions.every((session) => !originals.has(session.documentId)), 'thème rattaché à une séquence du modèle');
      assert.equal(topics.find((topic) => topic.name === 'Thème sans séance').sessions.length, 0);
      // Les thèmes du modèle n’ont pas bougé.
      const original = await app.documents(UID.topic).findMany({ filters: { edition: { slug: a.slug } }, populate: { sessions: { fields: ['documentId'] } }, limit: 50 });
      assert.equal(original.find((topic) => topic.name === 'Forêt').sessions.length, 2);
    });

    it('critère 3 : aucune donnée personnelle ni de rendez-vous : ni participants, exposants, créneaux, rendez-vous, interventions, jetons, e-mails, synchronisations', async () => {
      const { a } = await world();
      const { app } = espace();
      const { cookie } = await pilot([a]);
      const slug = freshSlug();
      const watched = [UID.attendee, UID.exhibitor, UID.slot, UID.meeting, UID.syncRun, UID.emailLog, UID.magicToken, INTERVENTION, UID.intervenant, 'api::espace.conversation', 'api::espace.message'];
      const before = Object.fromEntries(await Promise.all(watched.map(async (uid) => [uid, await count(uid)])));
      assert.ok(before[UID.attendee] >= 2 && before[UID.meeting] >= 1 && before[UID.slot] >= 1 && before[UID.exhibitor] >= 1, 'le modèle doit contenir des données à ne pas copier');
      assert.equal((await duplicate(a.slug, cookie, input({ slug }))).status, 201);
      for (const uid of watched) assert.equal(await count(uid), before[uid], `${uid} a changé`);

      const copy = await draftOf(slug);
      const filters = { edition: { documentId: copy.documentId } };
      for (const uid of [UID.attendee, UID.exhibitor, UID.slot, UID.meeting, UID.syncRun]) {
        assert.equal(await app.documents(uid).count({ filters }), 0, `${uid} rattaché à la copie`);
      }
      assert.equal(await app.documents(INTERVENTION).count({ filters: { sequence: { edition: { documentId: copy.documentId } } } }), 0, 'intervention copiée');
    });

    it('la duplication depuis une édition fermée au public marche aussi (page du pilotage d’une édition fermée) et la copie reste fermée', async () => {
      const { app } = espace();
      const closed = await createEdition(app, { slug: 'modele-ferme', title: 'Modèle fermé', enabled: false, settings: { date: '2026-01-10' } });
      const { cookie } = await listed(closed);
      const slug = freshSlug();
      const response = await duplicate(closed.slug, cookie, input({ slug }));
      assert.equal(response.status, 201, response.text);
      assert.equal((await draftOf(slug)).participantSpaceEnabled, false);
    });

    it('la copie en brouillon n’apparaît pas dans GET /admin/editions, même pour ORGANIZER_EMAILS', async () => {
      const { a } = await world();
      const { cookie } = await listed(a);
      const slug = freshSlug();
      assert.equal((await duplicate(a.slug, cookie, input({ slug }))).status, 201);
      assert.ok(!(await get('/admin/editions', cookie)).json.some((item) => item.slug === slug));
      // Elle n’est pas non plus une cible de bascule tant qu’elle n’est pas publiée.
      assert.equal((await switchTo(a.slug, slug, { cookie })).status, 404);
    });
  });
});

describe('bascule derrière HTTPS (V5-C, A-25)', { timeout: 180_000 }, () => {
  const HTTPS = 'https://journees.example.org';
  const secure = useEspace({ overrides: { PUBLIC_URL: HTTPS, CORS_ORIGINS: HTTPS, ORGANIZER_EMAILS: 'liste.https@example.org' } });
  const PROTO = { 'x-forwarded-proto': 'https' };

  /** Session ouverte comme le fait le navigateur (https), pour un organisateur des deux éditions. */
  let eds;
  let n = 0;
  async function openSession() {
    const { app, request, waitForMail, linkOf, outbox } = secure();
    eds ??= { a: await createEdition(app, { slug: 'https-a', title: 'HTTPS A' }), b: await createEdition(app, { slug: 'https-b', title: 'HTTPS B' }) };
    const { a, b } = eds;
    const email = `orga.https.${(n += 1)}@example.org`;
    for (const edition of [a, b]) await createAttendee(app, edition, { email, role: 'organizer', consentAt: new Date().toISOString() });
    const since = outbox().length;
    assert.equal((await request('/api/espace/auth/request-link', { method: 'POST', json: { editionSlug: a.slug, email }, headers: PROTO })).status, 202);
    const { token } = linkOf(await waitForMail((mail) => mail.to.email === email, { since }));
    const verified = await request('/api/espace/auth/verify', { method: 'POST', json: { token }, headers: PROTO });
    assert.equal(verified.status, 200);
    return { a, b, email, cookie: cookieHeader(verified.setCookies) };
  }

  it('vu en http interne alors que PUBLIC_URL est en https : 400 INSECURE_REQUEST, aucune session créée ni supprimée', async () => {
    const { a, b, cookie, email } = await openSession();
    const response = await secure().request(`/api/espace/admin/${a.slug}/switch`, { method: 'POST', cookie, form: {} });
    assert.equal(response.status, 400, response.text);
    assert.equal(response.json.error.code, 'INSECURE_REQUEST');
    assert.equal(response.setCookies.length, 0);
    const rows = await secure().query(UID.magicToken).findMany({ where: { attendee: { email }, kind: 'session' } });
    assert.equal(rows.length, 1);
  });

  it('avec X-Forwarded-Proto: https : 303 vers {PUBLIC_URL}/espace/{cible}/organisateur et cookie Secure', async () => {
    const { a, b, cookie } = await openSession();
    const response = await secure().request(`/api/espace/admin/${b.slug}/switch`, { method: 'POST', cookie, form: {}, headers: PROTO });
    assert.equal(response.status, 303, response.text);
    assert.equal(response.location, `${HTTPS}/espace/${b.slug}/organisateur`);
    const issued = response.setCookies.map(parseSetCookie).find(({ name }) => name === SESSION_COOKIE);
    assert.equal(issued?.attributes.secure, true);
    const profile = await secure().request('/api/espace/me', { cookie: cookieHeader(response.setCookies), headers: PROTO });
    assert.equal(profile.json.edition.slug, b.slug);
    void a;
  });
});
