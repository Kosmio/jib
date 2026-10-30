'use strict';

/**
 * Programme public et tableau de bord organisateur (lot 14) : F-80, F-81, F-90, T-42, R-63, A-29, A-34, NF-01, NF-52.
 *   - GET /editions/:slug/program : public, séquences triées sur l'heure analysée, séquences sans heure dans `notes`, intervenants
 *     (`attendeeId` seulement si la fiche est visible du visiteur), lieux, 404 pour une édition inconnue, fermée ou non publiée ;
 *   - GET /admin/:edition/stats : organisateur de l'édition seulement (T-42), indicateurs égaux aux comptes de la base (F-90),
 *     avertissements de tables dédiées (A-29), aucun contenu de message (R-63).
 * Un seul démarrage de Strapi. Chaque test crée son édition.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { useEspace } = require('../helpers/espace');
const { link } = require('../helpers/espace-data');
const W = require('../helpers/meetings-world');

const STATS_KEYS = ['activated', 'attendees', 'consented', 'directoryOptIn', 'lastSync', 'meetings', 'messages', 'profilesComplete', 'slots', 'topExhibitors', 'warnings'];
const parisClock = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

describe('programme et tableau de bord (lot 14)', { timeout: 900_000 }, () => {
  const espace = useEspace({ overrides: { ORGANIZER_EMAILS: 'organisation@example.org' } });
  const login = W.useLogin(espace);
  const api = W.useApi(espace);
  const app = () => espace().app;

  const person = (edition, fields) => W.createPerson(app(), edition, fields);
  const as = async (edition, who) => api(await login(edition, who));
  const organizerOf = (edition) => person(edition, { role: 'organizer', firstName: 'Olivia', lastName: 'Organisatrice', directoryOptIn: false, meetingsOptIn: false });
  const expectError = (response, status, code) => {
    assert.equal(response.status, status, `${response.status} ${response.text}`);
    if (code) assert.equal(response.json?.error?.code, code, response.text);
  };
  const program = (edition, cookie) => espace().request(`/api/espace/editions/${edition.slug}/program`, { cookie });

  describe('GET /editions/:slug/program : le programme public (F-80, F-81)', () => {
    // Séquences données dans le désordre, avec deux séquences sans heure lisible.
    const SEQUENCES = [
      { title: 'Après-midi', start_time: '14h00', end_time: '15h00', kind: 'talk', description: 'Ateliers de l’après-midi.' },
      { title: 'Horaires indiqués à titre provisoire', start_time: '--', end_time: '--', kind: 'other' },
      { title: 'Matin', start_time: '9h15', end_time: '10h45', kind: 'talk' },
      { title: 'Pause et B2B', start_time: '10h45', end_time: '11h15', kind: 'b2b_break' },
      { title: 'Sans fin', start_time: '12h00', kind: 'other' },
    ];

    async function programScene() {
      const world = await W.createMeetingEdition(app(), { slug: W.unique('prog'), title: 'Édition d’essai', sequences: SEQUENCES });
      const { edition } = world;
      const matin = world.sequences.find(({ title }) => title === 'Matin');
      const apres = world.sequences.find(({ title }) => title === 'Après-midi');
      const topic = await W.createTopic(app(), edition, 'Économie circulaire');
      await app().documents('api::espace.topic').update({ documentId: topic.documentId, data: { sessions: [link(matin)] } });

      const open = await W.createSpeaker(app(), edition, { name: 'Hélène Marquès', title: 'Directrice scientifique', organisationName: 'Institut Lignéa', sequence: matin });
      const hosted = await W.createSpeaker(app(), edition, { name: 'Antoine Vergnes', title: 'Associé', organisationName: 'Cabinet Verdelis', sequence: matin });
      const quiet = await W.createSpeaker(app(), edition, { name: 'Zoé Discrète', title: 'Consultante', organisationName: 'Atelier Zoé', sequence: apres });
      const p = {
        lea: await person(edition, { firstName: 'Léa', lastName: 'Ducasse' }),
        helene: await person(edition, { firstName: 'Hélène', lastName: 'Marquès', role: 'speaker', speaker: link(open), directoryOptIn: true }),
        antoine: await person(edition, { firstName: 'Antoine', lastName: 'Vergnes', role: 'speaker', speaker: link(hosted), directoryOptIn: false, meetingsOptIn: false, hostedTableNumber: 2 }),
        zoe: await person(edition, { firstName: 'Zoé', lastName: 'Discrète', role: 'speaker', speaker: link(quiet), directoryOptIn: false }),
      };
      return { world, edition, p };
    }

    it('public : 200 sans session, avec les quatre clés { notes, sessions, speakers, venues }', async () => {
      const { edition } = await programScene();
      const response = await program(edition);
      assert.equal(response.status, 200, response.text);
      assert.deepEqual(Object.keys(response.json).sort(), ['notes', 'sessions', 'speakers', 'venues']);
    });

    it('les séquences sont triées sur l’heure de début, quel que soit l’ordre de saisie', async () => {
      const { edition } = await programScene();
      const { sessions } = (await program(edition)).json;
      assert.deepEqual(sessions.map(({ title }) => title), ['Matin', 'Pause et B2B', 'Sans fin', 'Après-midi']);
    });

    it('forme d’une séance : id, title, description, start, end, startsAt, kind, topics, speakers', async () => {
      const { edition } = await programScene();
      const { sessions } = (await program(edition)).json;
      for (const session of sessions) assert.deepEqual(Object.keys(session).sort(), ['description', 'end', 'id', 'kind', 'speakers', 'start', 'startsAt', 'title', 'topics']);
      const afternoon = sessions.find(({ title }) => title === 'Après-midi');
      assert.equal(afternoon.description, 'Ateliers de l’après-midi.');
      assert.equal(afternoon.start, '14h00');
      assert.equal(afternoon.end, '15h00');
      assert.equal(afternoon.kind, 'talk');
      assert.equal(sessions.find(({ title }) => title === 'Pause et B2B').kind, 'b2b_break');
      assert.equal(sessions.find(({ title }) => title === 'Matin').description, null);
    });

    it('startsAt : l’heure de Paris du jour de l’édition, en UTC', async () => {
      const { edition } = await programScene();
      const { sessions } = (await program(edition)).json;
      assert.equal(parisClock(sessions.find(({ title }) => title === 'Matin').startsAt), '09:15');
      assert.equal(parisClock(sessions.find(({ title }) => title === 'Après-midi').startsAt), '14:00');
      assert.match(sessions[0].startsAt, /Z$/);
      assert.equal(new Date(sessions[0].startsAt).toISOString().slice(0, 10), edition.date);
    });

    it('une séance sans heure de fin : end est null', async () => {
      const { edition } = await programScene();
      const { sessions } = (await program(edition)).json;
      assert.equal(sessions.find(({ title }) => title === 'Sans fin').end, null);
    });

    it('une séquence sans heure lisible va dans `notes` par son titre, et pas dans les séances', async () => {
      const { edition } = await programScene();
      const { notes, sessions } = (await program(edition)).json;
      assert.deepEqual(notes, ['Horaires indiqués à titre provisoire']);
      assert.ok(!sessions.some(({ title }) => title === 'Horaires indiqués à titre provisoire'));
    });

    it('les sujets d’une séance, avec leur identifiant et leur nom', async () => {
      const { edition } = await programScene();
      const matin = (await program(edition)).json.sessions.find(({ title }) => title === 'Matin');
      assert.deepEqual(matin.topics.map(({ name }) => name), ['Économie circulaire']);
      assert.deepEqual(Object.keys(matin.topics[0]).sort(), ['id', 'name']);
    });

    it('les intervenants d’une séance : name, title, organisation, photoUrl, attendeeId', async () => {
      const { edition } = await programScene();
      const matin = (await program(edition)).json.sessions.find(({ title }) => title === 'Matin');
      assert.deepEqual(matin.speakers.map(({ name }) => name).sort(), ['Antoine Vergnes', 'Hélène Marquès']);
      const helene = matin.speakers.find(({ name }) => name === 'Hélène Marquès');
      assert.deepEqual(Object.keys(helene).sort(), ['attendeeId', 'name', 'organisation', 'photoUrl', 'title']);
      assert.equal(helene.title, 'Directrice scientifique');
      assert.equal(helene.organisation, 'Institut Lignéa');
      assert.equal(helene.photoUrl, null);
    });

    it('speakers : les intervenants du jour par ordre alphabétique, avec le titre de leurs séances', async () => {
      const { edition } = await programScene();
      const { speakers } = (await program(edition)).json;
      assert.deepEqual(speakers.map(({ name }) => name), ['Antoine Vergnes', 'Hélène Marquès', 'Zoé Discrète']);
      assert.deepEqual(speakers.find(({ name }) => name === 'Hélène Marquès').sessions, ['Matin']);
      for (const speaker of speakers) assert.deepEqual(Object.keys(speaker).sort(), ['attendeeId', 'name', 'organisation', 'photoUrl', 'sessions', 'title']);
    });

    it('F-81, A-34 : sans session, aucun intervenant ne porte d’attendeeId', async () => {
      const { edition } = await programScene();
      const { sessions, speakers } = (await program(edition)).json;
      for (const speaker of [...speakers, ...sessions.flatMap(({ speakers: list }) => list)]) assert.equal(speaker.attendeeId, null);
    });

    it('un cookie de session illisible ne casse pas la page publique : 200 et aucun attendeeId', async () => {
      const { edition } = await programScene();
      const response = await program(edition, 'jib_espace=n-importe-quoi');
      assert.equal(response.status, 200, response.text);
      assert.ok(response.json.speakers.every(({ attendeeId }) => attendeeId === null));
    });

    it('A-34, A-29 : avec une session, attendeeId seulement pour une fiche visible (annuaire coché, ou table dédiée)', async () => {
      const { edition, p } = await programScene();
      const cookie = await login(edition, p.lea);
      const { speakers } = (await program(edition, cookie)).json;
      const by = Object.fromEntries(speakers.map((speaker) => [speaker.name, speaker]));
      assert.equal(by['Hélène Marquès'].attendeeId, p.helene.documentId, 'annuaire coché');
      assert.equal(by['Antoine Vergnes'].attendeeId, p.antoine.documentId, 'table dédiée : visible au titre du programme');
      assert.equal(by['Zoé Discrète'].attendeeId, null, 'ni annuaire ni table dédiée : pas de lien');
    });

    it('une personne qui a un rendez-vous avec un intervenant sans annuaire peut ouvrir sa fiche (R-41)', async () => {
      const { world, edition, p } = await programScene();
      await W.seedMeeting(app(), { edition, slot: world.slots['10h45'], requester: p.lea, target: p.zoe, status: 'pending' });
      const { speakers } = (await program(edition, await login(edition, p.lea))).json;
      assert.equal(speakers.find(({ name }) => name === 'Zoé Discrète').attendeeId, p.zoe.documentId);
    });

    it('les lieux : name, address, mapUrl, timeSlot', async () => {
      const { edition } = await programScene();
      const { venues } = (await program(edition)).json;
      assert.ok(venues.length >= 1);
      for (const venue of venues) assert.deepEqual(Object.keys(venue).sort(), ['address', 'mapUrl', 'name', 'timeSlot']);
      assert.equal(venues[0].name, 'Salle de recette (lieu fictif)');
      assert.equal(venues[0].timeSlot, 'Journée (9h00 - 17h00)');
    });

    it('aucune adresse e-mail ni identifiant HelloAsso dans la réponse (R-42), même avec une session', async () => {
      const { edition, p } = await programScene();
      assert.deepEqual(W.leaks((await program(edition)).text), []);
      assert.deepEqual(W.leaks((await program(edition, await login(edition, p.lea))).text), []);
    });

    it('NF-52 : une édition inconnue, dont l’espace est fermé ou non publiée : 404 EDITION_NOT_FOUND', async () => {
      const closed = await W.createMeetingEdition(app(), { slug: W.unique('prog-closed'), title: 'Fermée', settings: { participantSpaceEnabled: false } });
      expectError(await program({ slug: 'edition-inconnue-lot14' }), 404, 'EDITION_NOT_FOUND');
      expectError(await program(closed.edition), 404, 'EDITION_NOT_FOUND');
    });

    it('une édition sans séquence : listes vides', async () => {
      const world = await W.createMeetingEdition(app(), { slug: W.unique('prog-vide'), title: 'Vide', sequences: [] });
      const { json } = await program(world.edition);
      assert.deepEqual([json.notes, json.sessions, json.speakers], [[], [], []]);
    });
  });

  describe('GET /admin/:edition/stats : accès réservé aux organisateurs (T-42, NF-01)', () => {
    it('route déclarée, sans session : 401 UNAUTHENTICATED', async () => {
      assert.ok(
        app().server.listRoutes().some((route) => route.path === '/api/espace/admin/:edition/stats' && route.methods.includes('GET')),
        'GET /api/espace/admin/:edition/stats absente',
      );
      const { edition } = await W.createMeetingEdition(app(), { slug: W.unique('stats-401'), title: 'Essai' });
      expectError(await espace().request(`/api/espace/admin/${edition.slug}/stats`), 401, 'UNAUTHENTICATED');
    });

    it('T-42 : un participant reçoit 403 FORBIDDEN, sans aucun chiffre', async () => {
      const { edition } = await W.createMeetingEdition(app(), { slug: W.unique('stats-403'), title: 'Essai' });
      const lea = await person(edition, { firstName: 'Léa', lastName: 'Ducasse' });
      const response = await (await as(edition, lea)).get(`/admin/${edition.slug}/stats`);
      expectError(response, 403, 'FORBIDDEN');
      assert.ok(!('attendees' in response.json), 'aucun indicateur dans la réponse');
    });

    it('NF-01 : un organisateur d’une autre édition reçoit 403, un organisateur reçoit 200', async () => {
      const first = await W.createMeetingEdition(app(), { slug: W.unique('stats-a'), title: 'Première' });
      const second = await W.createMeetingEdition(app(), { slug: W.unique('stats-b'), title: 'Seconde' });
      const bossA = await organizerOf(first.edition);
      await organizerOf(second.edition);
      const asBossA = await as(first.edition, bossA);
      assert.equal((await asBossA.get(`/admin/${first.edition.slug}/stats`)).status, 200);
      expectError(await asBossA.get(`/admin/${second.edition.slug}/stats`), 403, 'FORBIDDEN');
      expectError(await asBossA.get('/admin/edition-inconnue-lot14/stats'), 403, 'FORBIDDEN');
    });

    it('un organisateur sur une édition publiée mais fermée à l’espace : pas de chiffres (le compte ne se connecte pas)', async () => {
      const { edition } = await W.createMeetingEdition(app(), { slug: W.unique('stats-closed'), title: 'Fermée', settings: { participantSpaceEnabled: false } });
      const response = await espace().request(`/api/espace/admin/${edition.slug}/stats`);
      assert.ok([401, 403, 404].includes(response.status), response.text);
    });
  });

  describe('GET /admin/:edition/stats : indicateurs égaux aux comptes de la base (F-90, A-29, R-63)', () => {
    /**
     * Édition de 3 tables. Inscrits : 3 participants actifs (dont un sans activation ni consentement, un sans annuaire), 2 intervenants
     * actifs, 1 représentant, 1 annulé et l'organisateur (hors comptes). Profils : seuls ceux avec présentation atteignent 70 %.
     * Rendez-vous : 7 de statuts différents, dont 2 vers des exposants. Messages : 3.
     */
    async function statsScene() {
      const world = await W.createMeetingEdition(app(), { slug: W.unique('stats'), title: 'Édition d’essai', tablesCount: 3 });
      const { edition } = world;
      const { exhibitor: x1 } = await W.createExhibitor(app(), edition, { name: 'Sylvadour', standNumber: '4' });
      const { exhibitor: x2 } = await W.createExhibitor(app(), edition, { name: 'Résinéo', standNumber: '12' });
      await W.createExhibitor(app(), edition, { name: 'Sans demande', standNumber: '20' });
      const p = {
        lea: await person(edition, { firstName: 'Léa', lastName: 'Ducasse', bio: 'Présentation de Léa.' }),
        mathis: await person(edition, { firstName: 'Mathis', lastName: 'Lagrange', bio: 'Présentation de Mathis.', directoryOptIn: false }),
        tom: await person(edition, { firstName: 'Tom', lastName: 'Laffitte', activatedAt: null, consentAt: null, directoryOptIn: false, meetingsOptIn: false }),
        antoine: await person(edition, { firstName: 'Antoine', lastName: 'Vergnes', role: 'speaker', hostedTableNumber: 2 }),
        helene: await person(edition, { firstName: 'Hélène', lastName: 'Marquès', role: 'speaker' }),
        benoit: await person(edition, { firstName: 'Benoît', lastName: 'Tastet', role: 'exhibitor_rep', exhibitor: link(x1) }),
        gone: await person(edition, { firstName: 'Gaspard', lastName: 'Annule', status: 'cancelled' }),
        boss: await organizerOf(edition),
      };
      const at = (label) => world.slots[label];
      const seed = (slot, requester, target, status, extra = {}) => W.seedMeeting(app(), { edition, slot: at(slot), requester, target, status, ...extra });
      await seed('10h45', p.lea, p.mathis, 'accepted', { tableNumber: 1, answeredBy: p.mathis });
      await seed('10h45', p.helene, p.antoine, 'accepted', { tableNumber: 2 });
      await seed('11h00', p.lea, p.helene, 'pending');
      await seed('11h00', p.mathis, undefined, 'pending', { exhibitor: x1 });
      await seed('12h30', p.lea, undefined, 'accepted', { exhibitor: x2, answeredBy: p.benoit });
      await seed('12h45', p.mathis, p.lea, 'declined');
      await seed('13h00', p.lea, p.mathis, 'cancelled');
      await seed('13h15', p.lea, p.mathis, 'expired');
      await seed('13h30', p.helene, undefined, 'pending', { exhibitor: x1 });

      const conversation = await app().documents('api::espace.conversation').create({ data: { edition: link(edition), participants: [link(p.lea), link(p.mathis)] } });
      for (const [author, body] of [[p.mathis, 'SECRET-MESSAGE-1'], [p.lea, 'SECRET-MESSAGE-2'], [p.mathis, 'SECRET-MESSAGE-3']]) {
        await app().documents('api::espace.message').create({ data: { conversation: link(conversation), author: link(author), body } });
      }
      return { world, edition, p, x1, x2 };
    }
    const statsOf = async (edition, boss) => (await (await as(edition, boss)).get(`/admin/${edition.slug}/stats`));

    it('forme : les onze indicateurs de la section 3.2', async () => {
      const { edition, p } = await statsScene();
      const response = await statsOf(edition, p.boss);
      assert.equal(response.status, 200, response.text);
      assert.deepEqual(Object.keys(response.json).sort(), STATS_KEYS);
    });

    it('attendees : total, actifs, annulés et par rôle, l’organisateur n’étant pas un inscrit', async () => {
      const { edition, p } = await statsScene();
      const { attendees } = (await statsOf(edition, p.boss)).json;
      assert.equal(attendees.total, 7, '3 participants, 2 intervenants, 1 représentant, 1 annulé');
      assert.equal(attendees.active, 6);
      assert.equal(attendees.cancelled, 1);
      assert.deepEqual(attendees.byRole, { participant: 4, speaker: 2, exhibitor_rep: 1 });
    });

    it('activated, consented, directoryOptIn et profilesComplete, comptés sur les inscrits actifs', async () => {
      const { edition, p } = await statsScene();
      const stats = (await statsOf(edition, p.boss)).json;
      assert.equal(stats.activated, 5, 'tous les actifs sauf Tom');
      assert.equal(stats.consented, 5);
      assert.equal(stats.directoryOptIn, 4, 'Léa, Antoine, Hélène et Benoît (Mathis et Tom ont décoché)');
      assert.equal(stats.profilesComplete, 2, 'Léa et Mathis ont une présentation : 70 %');
    });

    it('meetings : un compteur par statut', async () => {
      const { edition, p } = await statsScene();
      assert.deepEqual((await statsOf(edition, p.boss)).json.meetings, { pending: 3, accepted: 3, declined: 1, cancelled: 1, expired: 1 });
    });

    it('messages : le nombre de messages échangés, jamais leur texte (R-63)', async () => {
      const { edition, p } = await statsScene();
      const response = await statsOf(edition, p.boss);
      assert.equal(response.json.messages, 3);
      assert.ok(!response.text.includes('SECRET-MESSAGE'), 'le texte d’un message apparaît dans les statistiques');
      assert.ok(!/"body"/.test(response.text), 'un champ body apparaît dans les statistiques');
    });

    it('slots : un par créneau, avec les rendez-vous acceptés et en attente, et le nombre de tables', async () => {
      const { world, edition, p } = await statsScene();
      const { slots } = (await statsOf(edition, p.boss)).json;
      assert.equal(slots.length, world.slotList.length);
      for (const slot of slots) assert.deepEqual(Object.keys(slot).sort(), ['accepted', 'label', 'pending', 'sessionTitle', 'tables']);
      const byLabel = Object.fromEntries(slots.map((slot) => [slot.label, slot]));
      assert.deepEqual([byLabel['10h45'].accepted, byLabel['10h45'].pending], [2, 0]);
      assert.deepEqual([byLabel['11h00'].accepted, byLabel['11h00'].pending], [0, 2]);
      assert.deepEqual([byLabel['12h30'].accepted, byLabel['12h30'].pending], [1, 0], 'un rendez-vous compte dans le créneau réservé, même vers un exposant');
      assert.deepEqual([byLabel['12h45'].accepted, byLabel['12h45'].pending], [0, 0], 'un refusé ne remplit pas');
      assert.deepEqual([byLabel['13h30'].accepted, byLabel['13h30'].pending], [0, 1]);
      assert.ok(slots.every(({ tables }) => tables === 3));
      assert.equal(byLabel['10h45'].sessionTitle, 'Pause et B2B');
    });

    it('topExhibitors : les exposants les plus sollicités, du plus au moins demandé, sans exposant sans demande', async () => {
      const { edition, p, x1, x2 } = await statsScene();
      const { topExhibitors } = (await statsOf(edition, p.boss)).json;
      assert.deepEqual(topExhibitors.map(({ name, requests }) => [name, requests]), [['Sylvadour', 2], ['Résinéo', 1]]);
      assert.deepEqual(topExhibitors.map(({ id }) => id), [x1.documentId, x2.documentId]);
      assert.deepEqual(Object.keys(topExhibitors[0]).sort(), ['id', 'name', 'requests', 'standNumber']);
    });

    it('topExhibitors : cinq au plus', async () => {
      const { world, edition, p } = await statsScene();
      for (let n = 0; n < 6; n += 1) {
        const { exhibitor } = await W.createExhibitor(app(), edition, { name: `Exposant ${n}`, standNumber: `${30 + n}` });
        await W.seedMeeting(app(), { edition, slot: world.slots['15h30'], requester: p.lea, exhibitor, status: 'declined' });
      }
      assert.equal((await statsOf(edition, p.boss)).json.topExhibitors.length, 5);
    });

    it('lastSync : null sans synchronisation', async () => {
      const { edition, p } = await statsScene();
      assert.equal((await statsOf(edition, p.boss)).json.lastSync, null);
    });

    it('warnings : une table dédiée valable ne donne aucun avertissement', async () => {
      const { edition, p } = await statsScene();
      assert.deepEqual((await statsOf(edition, p.boss)).json.warnings, []);
    });

    it('A-29 : deux intervenants sur la même table (HOSTED_TABLE_CONFLICT) et un numéro hors plage (HOSTED_TABLE_INVALID)', async () => {
      const { edition, p } = await statsScene();
      await person(edition, { firstName: 'Camille', lastName: 'Doublon', role: 'speaker', hostedTableNumber: 2 });
      await person(edition, { firstName: 'Denis', lastName: 'Horsplage', role: 'speaker', hostedTableNumber: 9 });
      const { warnings } = (await statsOf(edition, p.boss)).json;
      assert.deepEqual(warnings.map(({ code }) => code).sort(), ['HOSTED_TABLE_CONFLICT', 'HOSTED_TABLE_INVALID']);
      for (const warning of warnings) {
        assert.deepEqual(Object.keys(warning).sort(), ['attendeeId', 'code', 'message', 'tableNumber']);
        assert.match(warning.message, /ignorée/);
      }
      const conflict = warnings.find(({ code }) => code === 'HOSTED_TABLE_CONFLICT');
      assert.equal(conflict.tableNumber, 2);
      assert.match(conflict.message, /Antoine Vergnes/, 'le plus petit id garde la table : le message cite qui la tient');
      assert.equal(warnings.find(({ code }) => code === 'HOSTED_TABLE_INVALID').tableNumber, 9);
    });

    // D4 (corrigé au commit e936daa) : stats.js employait une espace ordinaire (U+0020) dans le texte des avertissements d'E9.
    it('A-29 : le message d’un avertissement porte une espace insécable avant les deux-points', async () => {
      const { edition, p } = await statsScene();
      await person(edition, { firstName: 'Denis', lastName: 'Horsplage', role: 'speaker', hostedTableNumber: 9 });
      const [warning] = (await statsOf(edition, p.boss)).json.warnings;
      assert.ok(warning.message.includes(`ignorée${String.fromCharCode(0xa0)}:`), JSON.stringify(warning.message));
    });

    it('les chiffres suivent la base : un rendez-vous accepté de plus change le compteur', async () => {
      const { world, edition, p } = await statsScene();
      await W.seedMeeting(app(), { edition, slot: world.slots['15h45'], requester: p.lea, target: p.mathis, status: 'accepted', tableNumber: 1, answeredBy: p.mathis });
      const stats = (await statsOf(edition, p.boss)).json;
      assert.equal(stats.meetings.accepted, 4);
      assert.equal(stats.slots.find(({ label }) => label === '15h45').accepted, 1);
    });

    it('cloisonnement : les chiffres d’une édition ne comptent rien d’une autre', async () => {
      const first = await statsScene();
      const other = await W.createMeetingEdition(app(), { slug: W.unique('stats-vide'), title: 'Vide' });
      const boss = await organizerOf(other.edition);
      const stats = (await statsOf(other.edition, boss)).json;
      assert.equal(stats.attendees.total, 0);
      assert.deepEqual(stats.meetings, { pending: 0, accepted: 0, declined: 0, cancelled: 0, expired: 0 });
      assert.equal(stats.messages, 0);
      assert.ok((await statsOf(first.edition, first.p.boss)).json.attendees.total > 0);
    });

    it('aucune adresse e-mail ni identifiant HelloAsso dans les statistiques (R-42, NF-11)', async () => {
      const { edition, p } = await statsScene();
      assert.deepEqual(W.leaks((await statsOf(edition, p.boss)).text), []);
    });
  });
});
