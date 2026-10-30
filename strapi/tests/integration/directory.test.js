'use strict';

/**
 * Annuaire, fiches et suggestions (lot 9) : T-10 à T-13, R-41 à R-43, R-50, F-40 à F-44, A-26, A-29, A-34, NF-01.
 *   - GET /directory : visibilité (annuaire coché, intervenant à table dédiée, exposants, organisateurs jamais), recherche, filtres,
 *     tri, défilement par 30 ;
 *   - GET /directory/p/:id et /directory/x/:id : fiche d'une personne (404 sans consentement ni lien), fiche d'un exposant ;
 *   - GET /suggestions : « Ils partagent vos sujets ».
 * Aucune réponse ne contient d'adresse e-mail ni d'identifiant HelloAsso (R-42, T-13). Un seul démarrage de Strapi.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { useEspace } = require('../helpers/espace');
const { link } = require('../helpers/espace-data');
const W = require('../helpers/meetings-world');

const SECRET = { bio: 'BIO-PERSONNELLE', jobTitle: 'POSTE-PERSONNEL', company: 'ENTREPRISE-PERSONNELLE' };
const REQUIRED_CARD_KEYS = ['displayName', 'id', 'initials', 'kind', 'photoUrl', 'subtitle', 'tag', 'topics'];

describe('annuaire, fiches et suggestions (lot 9)', { timeout: 900_000 }, () => {
  const espace = useEspace({ overrides: { ORGANIZER_EMAILS: 'organisation@example.org' } });
  const login = W.useLogin(espace);
  const api = W.useApi(espace);
  const app = () => espace().app;

  const newEdition = (options) => W.createMeetingEdition(app(), { slug: W.unique('ann'), title: 'Édition d’essai', ...options });
  const person = (edition, fields) => W.createPerson(app(), edition, fields);
  const as = async (edition, who) => api(await login(edition, who));
  const ids = (list) => list.map((card) => card.id);
  const expectError = (response, status, code) => {
    assert.equal(response.status, status, `${response.status} ${response.text}`);
    if (code) assert.equal(response.json?.error?.code, code, response.text);
  };
  const search = async (world, viewer, query = '') => (await (await as(world.edition, viewer)).get(`/directory${query}`)).json;

  /**
   * Une édition avec trois sujets, des participants visibles et invisibles, deux exposants (le premier a deux représentants, dont un
   * sans consentement), un intervenant à table dédiée sans consentement, un intervenant sans table. Léa consulte.
   */
  async function scene() {
    const world = await newEdition();
    const { edition } = world;
    const [eco, bois, data] = [await W.createTopic(app(), edition, 'Économie circulaire'), await W.createTopic(app(), edition, 'Construction bois'), await W.createTopic(app(), edition, 'Process, data et IA')];
    const p = {
      lea: await person(edition, { firstName: 'Léa', lastName: 'Ducasse', jobTitle: 'Cheffe de projet', company: 'Atelier Fictif', topics: [link(eco), link(bois)] }),
      ines: await person(edition, { firstName: 'Inès', lastName: 'Castaing', jobTitle: 'Architecte', company: 'Cabinet Boisé', topics: [link(eco)] }),
      hugo: await person(edition, { firstName: 'Hugo', lastName: 'Peyrat', jobTitle: 'Ingénieur', company: 'Scierie du Sud', topics: [link(data)] }),
      mathis: await person(edition, { firstName: 'Mathis', lastName: 'Lagrange', jobTitle: 'Responsable achats', company: 'Panneaux Fictifs', topics: [link(bois)] }),
      clara: await person(edition, { firstName: 'Clara', lastName: 'Dubourdieu', directoryOptIn: false, topics: [link(eco), link(bois)] }),
      boss: await person(edition, { firstName: 'Olivia', lastName: 'Organisatrice', role: 'organizer', topics: [link(eco)] }),
      gone: await person(edition, { firstName: 'Gaspard', lastName: 'Annule', status: 'cancelled', topics: [link(eco)] }),
    };
    const { exhibitor: sylvadour } = await W.createExhibitor(app(), edition, { name: 'Sylvadour', standNumber: '4', topics: [bois, eco], description: 'Scierie fictive du Sud-Ouest.', website: 'https://sylvadour.example.org' });
    const { exhibitor: resineo } = await W.createExhibitor(app(), edition, { name: 'Résinéo', standNumber: '12', topics: [data] });
    p.benoit = await person(edition, { firstName: 'Benoît', lastName: 'Tastet', role: 'exhibitor_rep', exhibitor: link(sylvadour) });
    p.pierre = await person(edition, { firstName: 'Pierre', lastName: 'Haurie', role: 'exhibitor_rep', exhibitor: link(sylvadour), directoryOptIn: false });
    const forest = world.sequences.find((sequence) => sequence.title === 'Forêt et adaptation');
    const publicSpeaker = await W.createSpeaker(app(), edition, { name: 'Antoine Vergnes', title: 'Directeur de la recherche', organisationName: 'Institut du Bois Fictif', sequence: forest });
    p.antoine = await person(edition, { firstName: 'Antoine', lastName: 'Personnel', role: 'speaker', hostedTableNumber: 2, directoryOptIn: false, meetingsOptIn: false, speaker: link(publicSpeaker), ...SECRET, topics: [link(data)] });
    const quietSpeaker = await W.createSpeaker(app(), edition, { name: 'Hélène Marquès', title: 'Directrice scientifique', sequence: forest });
    p.helene = await person(edition, { firstName: 'Hélène', lastName: 'Marquès', role: 'speaker', directoryOptIn: false, speaker: link(quietSpeaker) });
    return { world, p, topics: { eco, bois, data }, sylvadour, resineo };
  }

  describe('routes du lot 9 et accès sans session (NF-01, A-02)', () => {
    const ROUTES = [
      'POST /api/espace/me/photo',
      'GET /api/espace/editions/:x/topics',
      'GET /api/espace/directory',
      'GET /api/espace/directory/p/:x',
      'GET /api/espace/directory/x/:x',
      'GET /api/espace/suggestions',
    ];
    const declared = () =>
      espace()
        .app.server.listRoutes()
        .filter((route) => route.path.startsWith('/api/espace'))
        .flatMap((route) => route.methods.filter((method) => method !== 'HEAD').map((method) => `${method} ${route.path.replace(/:[A-Za-z]+/g, ':x')}`));

    it('routes:list montre les six routes du lot 9', () => {
      for (const route of ROUTES) assert.ok(declared().includes(route), `route absente : ${route}`);
    });

    it('aucune autre route sous /directory, /suggestions ni /me/photo : pas de CRUD', () => {
      const extra = declared().filter((route) => /\/api\/espace\/(directory|suggestions|me\/photo)/.test(route) && !ROUTES.includes(route));
      assert.deepEqual(extra, []);
    });

    for (const route of ROUTES.filter((item) => !item.includes('/topics'))) {
      const [method, template] = route.split(' ');
      it(`${route} sans session : 401 UNAUTHENTICATED`, async () => {
        const response = await espace().request(template.replace(':x', 'abc123'), { method, json: method === 'POST' ? {} : undefined });
        expectError(response, 401, 'UNAUTHENTICATED');
      });
    }
  });

  describe('GET /directory : qui figure dans la liste (T-10, R-41, R-43, A-26, A-29, F-40)', () => {
    it('forme : { items, nextCursor, total } ; chaque carte porte les champs de la CarteProfil', async () => {
      const { world, p } = await scene();
      const body = await search(world, p.lea);
      assert.deepEqual(Object.keys(body).sort(), ['items', 'nextCursor', 'total']);
      assert.equal(typeof body.total, 'number');
      for (const card of body.items) {
        for (const key of REQUIRED_CARD_KEYS) assert.ok(key in card, `champ manquant ${key} : ${JSON.stringify(card)}`);
        for (const key of Object.keys(card)) assert.ok(W.CARD_KEYS.includes(key), `champ inattendu ${key}`);
        assert.ok(['attendee', 'exhibitor'].includes(card.kind));
        assert.ok(['participant', 'speaker', 'exhibitor_rep', 'exhibitor'].includes(card.tag), card.tag);
      }
    });

    it('liste les participants qui ont coché l’annuaire, les représentants consentants et tous les exposants', async () => {
      const { world, p, sylvadour, resineo } = await scene();
      const { items } = await search(world, p.lea);
      for (const who of [p.ines, p.hugo, p.mathis, p.benoit]) assert.ok(ids(items).includes(who.documentId), `${who.firstName} devrait figurer`);
      for (const exhibitor of [sylvadour, resineo]) assert.ok(ids(items).includes(exhibitor.documentId), 'tous les exposants figurent');
    });

    it('un exposant sans aucun représentant figure aussi dans la liste (F-40)', async () => {
      const { world, p } = await scene();
      const { exhibitor } = await W.createExhibitor(app(), world.edition, { name: 'Exposant Sans Représentant' });
      assert.ok(ids((await search(world, p.lea)).items).includes(exhibitor.documentId));
    });

    it('T-10 : un participant sans case cochée est absent de la liste, même en le cherchant par son nom', async () => {
      const { world, p } = await scene();
      assert.ok(!ids((await search(world, p.lea)).items).includes(p.clara.documentId));
      assert.deepEqual((await search(world, p.lea, '?q=dubourdieu')).items, []);
      assert.ok(!ids((await search(world, p.lea, '?q=clara')).items).includes(p.clara.documentId));
    });

    it('A-26 : un organisateur n’est jamais listé, ni une inscription annulée', async () => {
      const { world, p } = await scene();
      const listed = ids((await search(world, p.lea)).items);
      assert.ok(!listed.includes(p.boss.documentId));
      assert.ok(!listed.includes(p.gone.documentId));
    });

    it('A-26 · I-23 : une adresse de ORGANIZER_EMAILS n’est pas listée non plus, même avec la case cochée', async () => {
      const { world, p } = await scene();
      const organizer = await person(world.edition, { email: 'organisation@example.org', firstName: 'Orga', lastName: 'Nisation', directoryOptIn: true });
      assert.ok(!ids((await search(world, p.lea)).items).includes(organizer.documentId));
    });

    // Relevé au lot 16 (essai du soir) : Léa se voit dans son propre annuaire. Ni F-40, ni R-41, ni R-43, ni A-34 n'excluent le visiteur de
    // la liste (seul R-50 écrit « hors soi », pour les suggestions) et F-54 prévoit « C'est votre profil » sur sa propre fiche, qu'on n'ouvre
    // que depuis l'annuaire. Comportement actuel consigné ici ; si l'architecte décide d'exclure le visiteur, ce test change avec la règle.
    it('F-40, F-54 : un visiteur qui a coché l’annuaire figure dans sa propre liste, et sa fiche porte isSelf (seules les suggestions l’excluent, R-50)', async () => {
      const { world, p } = await scene();
      const own = (await search(world, p.lea)).items.find((item) => item.id === p.lea.documentId);
      assert.ok(own, 'le visiteur n’est pas exclu de la liste');
      assert.equal(own.displayName, 'Léa Ducasse');
      assert.equal((await (await as(world.edition, p.lea)).get(`/directory/p/${p.lea.documentId}`)).json.isSelf, true);
    });

    it('un représentant sans consentement n’est pas listé ; son exposant l’est', async () => {
      const { world, p, sylvadour } = await scene();
      const listed = ids((await search(world, p.lea)).items);
      assert.ok(!listed.includes(p.pierre.documentId));
      assert.ok(listed.includes(sylvadour.documentId));
    });

    it('R-43, A-29 : un intervenant à table dédiée est listé sans consentement, avec les données publiques du programme seulement', async () => {
      const { world, p } = await scene();
      const card = (await search(world, p.lea)).items.find((item) => item.id === p.antoine.documentId);
      assert.ok(card, 'l’intervenant à table dédiée doit figurer');
      assert.equal(card.tag, 'speaker');
      assert.equal(card.hostedTableNumber, 2);
      assert.equal(card.displayName, 'Antoine Vergnes');
      assert.match(card.subtitle, /Directeur de la recherche/);
      assert.match(card.subtitle, /Institut du Bois Fictif/);
      assert.doesNotMatch(JSON.stringify(card), /PERSONNEL/);
      assert.deepEqual(card.topics, []);
    });

    it('R-41 : un intervenant sans table dédiée ni consentement n’est pas listé', async () => {
      const { world, p } = await scene();
      assert.ok(!ids((await search(world, p.lea)).items).includes(p.helene.documentId));
    });

    it('un intervenant à table dédiée qui a aussi coché l’annuaire montre son profil personnel', async () => {
      const { world, p } = await scene();
      const camille = await person(world.edition, { firstName: 'Camille', lastName: 'Lasserre', role: 'speaker', hostedTableNumber: 3, jobTitle: 'Consultante', company: 'Cabinet Fictif', directoryOptIn: true });
      const card = (await search(world, p.lea)).items.find((item) => item.id === camille.documentId);
      assert.equal(card.displayName, 'Camille Lasserre');
      assert.match(card.subtitle, /Consultante/);
    });

    it('les exposants : kind « exhibitor », nom, numéro de stand, sujets', async () => {
      const { world, p, sylvadour } = await scene();
      const card = (await search(world, p.lea)).items.find((item) => item.id === sylvadour.documentId);
      assert.equal(card.kind, 'exhibitor');
      assert.equal(card.tag, 'exhibitor');
      assert.equal(card.displayName, 'Sylvadour');
      assert.equal(card.standNumber, '4');
      assert.deepEqual(card.topics.map((item) => item.name).sort(), ['Construction bois', 'Économie circulaire']);
    });

    it('une carte de participant : nom complet, fonction et entreprise, initiales, sujets { id, name }', async () => {
      const { world, p, topics } = await scene();
      const card = (await search(world, p.lea)).items.find((item) => item.id === p.ines.documentId);
      assert.equal(card.kind, 'attendee');
      assert.equal(card.tag, 'participant');
      assert.equal(card.displayName, 'Inès Castaing');
      assert.match(card.subtitle, /Architecte/);
      assert.match(card.subtitle, /Cabinet Boisé/);
      assert.equal(card.initials, 'IC');
      assert.deepEqual(card.topics, [{ id: topics.eco.documentId, name: 'Économie circulaire' }]);
    });

    it('NF-01 : les personnes et exposants d’une autre édition ne sont jamais listés', async () => {
      const { world, p } = await scene();
      const other = await newEdition();
      const stranger = await person(other.edition, { firstName: 'Étrangère', lastName: 'Ailleurs' });
      const { exhibitor } = await W.createExhibitor(app(), other.edition, { name: 'Exposant Ailleurs' });
      const listed = ids((await search(world, p.lea)).items);
      assert.ok(!listed.includes(stranger.documentId) && !listed.includes(exhibitor.documentId));
      assert.deepEqual((await search(world, p.lea, '?q=ailleurs')).items, []);
    });

    it('T-13 : aucune adresse e-mail ni identifiant HelloAsso dans la liste', async () => {
      const { world, p } = await scene();
      const response = await (await as(world.edition, p.lea)).get('/directory');
      assert.deepEqual(W.leaks(response.text), []);
    });
  });

  describe('GET /directory : recherche, filtres et tri (T-11, F-41 à F-43, A-34)', () => {
    it('T-11 : « econ » trouve les profils du sujet « Économie circulaire », accents et casse ignorés', async () => {
      const { world, p, sylvadour } = await scene();
      for (const query of ['econ', 'ECON', 'Économie', 'économie circ']) {
        const { items } = await search(world, p.hugo, `?q=${encodeURIComponent(query)}`);
        assert.deepEqual(ids(items).sort(), [p.lea.documentId, p.ines.documentId, sylvadour.documentId].sort(), query);
      }
    });

    it('cherche dans le nom, l’entreprise et la fonction', async () => {
      const { world, p } = await scene();
      assert.deepEqual(ids((await search(world, p.mathis, '?q=ducasse')).items), [p.lea.documentId]);
      assert.deepEqual(ids((await search(world, p.mathis, '?q=ines')).items), [p.ines.documentId]);
      assert.deepEqual(ids((await search(world, p.mathis, '?q=scierie')).items).filter((id) => id === p.hugo.documentId), [p.hugo.documentId]);
      assert.deepEqual(ids((await search(world, p.mathis, '?q=architecte')).items), [p.ines.documentId]);
    });

    it('F-41 : une saisie de moins de 2 caractères est ignorée', async () => {
      const { world, p } = await scene();
      const all = await search(world, p.lea);
      assert.equal((await search(world, p.lea, '?q=e')).total, all.total);
      assert.equal((await search(world, p.lea, '?q=')).total, all.total);
      assert.ok((await search(world, p.lea, '?q=ea')).total < all.total);
    });

    it('F-44 : aucun résultat, liste vide et total 0', async () => {
      const { world, p } = await scene();
      assert.deepEqual(await search(world, p.lea, '?q=zzzzzz'), { items: [], nextCursor: null, total: 0 });
    });

    it('type : participant, speaker, exhibitor', async () => {
      const { world, p, sylvadour, resineo } = await scene();
      const participants = (await search(world, p.lea, '?type=participant')).items;
      assert.ok(participants.every((card) => ['participant', 'exhibitor_rep'].includes(card.tag)));
      assert.ok(ids(participants).includes(p.ines.documentId) && ids(participants).includes(p.benoit.documentId));
      assert.deepEqual(ids((await search(world, p.lea, '?type=speaker')).items), [p.antoine.documentId]);
      assert.deepEqual(ids((await search(world, p.lea, '?type=exhibitor')).items).sort(), [sylvadour.documentId, resineo.documentId].sort());
    });

    it('sujets : un identifiant, puis plusieurs séparés par des virgules', async () => {
      const { world, p, topics, sylvadour, resineo } = await scene();
      assert.deepEqual(ids((await search(world, p.mathis, `?topics=${topics.data.documentId}`)).items).sort(), [p.hugo.documentId, resineo.documentId].sort());
      const both = ids((await search(world, p.mathis, `?topics=${topics.eco.documentId},${topics.bois.documentId}`)).items);
      assert.ok(both.includes(p.lea.documentId) && both.includes(sylvadour.documentId));
      assert.ok(!both.includes(p.hugo.documentId) && !both.includes(resineo.documentId));
    });

    it('un sujet inconnu ne trouve personne', async () => {
      const { world, p } = await scene();
      assert.equal((await search(world, p.lea, '?topics=inconnu0000000000000000')).total, 0);
    });

    it('F-42 : « Tous » met d’abord intervenants et exposants, puis les autres', async () => {
      const { world, p } = await scene();
      const items = (await search(world, p.lea)).items;
      const firstPeople = items.findIndex((card) => card.tag === 'participant' || card.tag === 'exhibitor_rep');
      assert.ok(firstPeople > 0, 'il y a des intervenants et exposants avant les participants');
      assert.ok(items.slice(0, firstPeople).every((card) => card.tag === 'speaker' || card.kind === 'exhibitor'));
      assert.ok(items.slice(firstPeople).every((card) => card.tag === 'participant' || card.tag === 'exhibitor_rep'));
    });

    it('A-34 : les personnes se trient par nom de famille puis prénom, les exposants par nom de structure', async () => {
      const world = await newEdition();
      const viewer = await person(world.edition, { directoryOptIn: false });
      for (const [firstName, lastName] of [['Alice', 'Zola'], ['Zoé', 'Adam'], ['Marc', 'Berger'], ['Éric', 'Berger']]) await person(world.edition, { firstName, lastName, company: 'Tritest' });
      const order = (await search(world, viewer, '?q=tritest')).items.map((card) => card.displayName);
      assert.deepEqual(order, ['Zoé Adam', 'Éric Berger', 'Marc Berger', 'Alice Zola']);
      await W.createExhibitor(app(), world.edition, { name: 'Zébra Tritest' });
      await W.createExhibitor(app(), world.edition, { name: 'Alpha Tritest' });
      const mixed = (await search(world, viewer, '?q=tritest')).items.map((card) => card.displayName);
      assert.deepEqual(mixed.slice(0, 2), ['Alpha Tritest', 'Zébra Tritest'], 'les exposants d’abord, par nom');
    });

    it('F-43 : 40 participants, deux requêtes : 30 puis 10, curseur en texte, total constant', async () => {
      const world = await newEdition();
      const viewer = await person(world.edition, { directoryOptIn: false });
      for (let index = 0; index < 40; index += 1) await person(world.edition, { firstName: 'Prénom', lastName: `Nom${String(index).padStart(2, '0')}` });
      const first = await search(world, viewer);
      assert.equal(first.items.length, 30);
      assert.equal(first.total, 40);
      assert.equal(first.nextCursor, '30');
      const second = await search(world, viewer, `?cursor=${first.nextCursor}`);
      assert.equal(second.items.length, 10);
      assert.equal(second.nextCursor, null);
      assert.equal(second.total, 40);
      assert.equal(new Set([...ids(first.items), ...ids(second.items)]).size, 40, 'aucun doublon ni oubli entre les pages');
      assert.deepEqual((await search(world, viewer, '?cursor=500')).items, []);
    });

    it('401 sans session', async () => {
      expectError(await espace().request('/api/espace/directory'), 401, 'UNAUTHENTICATED');
    });
  });

  describe('GET /directory/p/:id : fiche d’une personne (T-12, T-13, R-41, R-42, R-43)', () => {
    const fiche = async (world, viewer, target) => (await as(world.edition, viewer)).get(`/directory/p/${target.documentId}`);

    it('une personne qui a coché l’annuaire : 200 avec la carte et les champs de la fiche', async () => {
      const { world, p } = await scene();
      const response = await fiche(world, p.hugo, p.lea);
      assert.equal(response.status, 200, response.text);
      const body = response.json;
      for (const key of [...REQUIRED_CARD_KEYS, 'firstName', 'lastName', 'jobTitle', 'company', 'bio', 'sessions', 'exhibitor', 'isSelf', 'canMessage']) assert.ok(key in body, `champ manquant ${key}`);
      assert.equal(body.id, p.lea.documentId);
      assert.equal(body.firstName, 'Léa');
      assert.equal(body.lastName, 'Ducasse');
      assert.equal(body.jobTitle, 'Cheffe de projet');
      assert.equal(body.company, 'Atelier Fictif');
      assert.equal(body.isSelf, false);
      assert.deepEqual(body.sessions, []);
      assert.equal(body.exhibitor ?? null, null);
    });

    it('T-13 : aucune adresse e-mail ni identifiant HelloAsso (R-42)', async () => {
      const { world, p } = await scene();
      const response = await fiche(world, p.hugo, p.lea);
      assert.deepEqual(W.leaks(response.text), []);
    });

    it('T-12 : la fiche d’un participant qui n’a pas coché l’annuaire donne 404 PROFILE_NOT_FOUND (accès direct par l’URL)', async () => {
      const { world, p } = await scene();
      expectError(await fiche(world, p.lea, p.clara), 404, 'PROFILE_NOT_FOUND');
    });

    it('T-12 : la fiche d’un organisateur, d’une inscription annulée, d’un identifiant inconnu : 404', async () => {
      const { world, p } = await scene();
      expectError(await fiche(world, p.lea, p.boss), 404, 'PROFILE_NOT_FOUND');
      expectError(await fiche(world, p.lea, p.gone), 404, 'PROFILE_NOT_FOUND');
      expectError(await (await as(world.edition, p.lea)).get('/directory/p/inconnu0000000000000000'), 404, 'PROFILE_NOT_FOUND');
    });

    it('NF-01 : la fiche d’une personne d’une autre édition : 404', async () => {
      const { world, p } = await scene();
      const other = await newEdition();
      const stranger = await person(other.edition);
      expectError(await fiche(world, p.lea, stranger), 404, 'PROFILE_NOT_FOUND');
    });

    for (const [status, extra] of [['pending', {}], ['accepted', { tableNumber: 1 }], ['declined', {}], ['cancelled', {}], ['expired', {}]]) {
      it(`T-12 : 200 pour qui a un rendez-vous ${status} avec lui, dans les deux sens ; un tiers reste à 404`, async () => {
        const { world, p } = await scene();
        await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['10h45'], requester: p.lea, target: p.clara, status, ...extra });
        for (const [viewer, target] of [[p.lea, p.clara], [p.clara, p.lea]]) {
          const response = await fiche(world, viewer, target);
          assert.equal(response.status, 200, `${status} : ${response.text}`);
        }
        expectError(await fiche(world, p.hugo, p.clara), 404, 'PROFILE_NOT_FOUND');
      });
    }

    it('T-12 : 200 pour qui a une conversation avec lui ; un tiers reste à 404', async () => {
      const { world, p } = await scene();
      const [first, second] = [p.lea, p.clara].sort((a, b) => a.id - b.id);
      await app().documents('api::espace.conversation').create({ data: { edition: link(world.edition), participants: [link(first), link(second)], lastMessageAt: new Date() } });
      assert.equal((await fiche(world, p.lea, p.clara)).status, 200);
      assert.equal((await fiche(world, p.clara, p.lea)).status, 200);
      expectError(await fiche(world, p.hugo, p.clara), 404, 'PROFILE_NOT_FOUND');
    });

    it('sa propre fiche : 200 avec `isSelf`, même sans avoir coché l’annuaire ; `canMessage` faux', async () => {
      const { world, p } = await scene();
      const response = await fiche(world, p.clara, p.clara);
      assert.equal(response.status, 200, response.text);
      assert.equal(response.json.isSelf, true);
      assert.equal(response.json.canMessage, false);
    });

    it('`canMessage` : vrai si la cible a coché les rendez-vous, faux sinon (R-61)', async () => {
      const { world, p } = await scene();
      const open = await person(world.edition, { meetingsOptIn: true });
      const closed = await person(world.edition, { meetingsOptIn: false, directoryOptIn: true });
      assert.equal((await fiche(world, p.lea, open)).json.canMessage, true);
      assert.equal((await fiche(world, p.lea, closed)).json.canMessage, false);
    });

    it('un participant visible garde sa présentation et ses sujets dans la fiche', async () => {
      const { world, p, topics } = await scene();
      const visible = await person(world.edition, { bio: 'Présentation visible.', topics: [link(topics.eco)] });
      const { json } = await fiche(world, p.hugo, visible);
      assert.equal(json.bio, 'Présentation visible.');
      assert.deepEqual(json.topics, [{ id: topics.eco.documentId, name: 'Économie circulaire' }]);
    });

    it('un intervenant consentant : ses séances figurent dans `sessions` { title, start, end }', async () => {
      const { world, p } = await scene();
      const forest = world.sequences.find((sequence) => sequence.title === 'Forêt et adaptation');
      const speaker = await W.createSpeaker(app(), world.edition, { name: 'Intervenant Consentant', sequence: forest });
      const attendee = await person(world.edition, { role: 'speaker', speaker: link(speaker), directoryOptIn: true });
      const { json } = await fiche(world, p.hugo, attendee);
      assert.deepEqual(json.sessions.map((session) => session.title), ['Forêt et adaptation']);
      assert.deepEqual(Object.keys(json.sessions[0]).sort(), ['end', 'start', 'title']);
    });

    it('un représentant consentant : `exhibitor` renvoie son exposant', async () => {
      const { world, p, sylvadour } = await scene();
      const { json } = await fiche(world, p.lea, p.benoit);
      assert.equal(json.exhibitor.id, sylvadour.documentId);
      assert.equal(json.exhibitor.name, 'Sylvadour');
    });

    it('R-43, A-29 : un intervenant à table dédiée est consultable sans consentement, données publiques seulement, séances comprises', async () => {
      const { world, p } = await scene();
      const response = await fiche(world, p.lea, p.antoine);
      assert.equal(response.status, 200, response.text);
      assert.doesNotMatch(response.text, /PERSONNEL/, 'aucune donnée du profil personnel');
      assert.equal(response.json.displayName, 'Antoine Vergnes');
      assert.deepEqual(response.json.sessions.map((session) => session.title), ['Forêt et adaptation']);
      assert.equal(response.json.hostedTableNumber, 2);
      assert.deepEqual(W.leaks(response.text), []);
    });

    it('R-41 : un intervenant sans table dédiée ni consentement reste en 404', async () => {
      const { world, p } = await scene();
      expectError(await fiche(world, p.lea, p.helene), 404, 'PROFILE_NOT_FOUND');
    });
  });

  describe('GET /directory/x/:id : fiche d’un exposant (F-57, R-14, R-42)', () => {
    const fiche = async (world, viewer, exhibitor) => (await as(world.edition, viewer)).get(`/directory/x/${exhibitor.documentId}`);

    it('200 : la carte, la description, le site, les représentants visibles et `isMine`', async () => {
      const { world, p, sylvadour } = await scene();
      const response = await fiche(world, p.lea, sylvadour);
      assert.equal(response.status, 200, response.text);
      const body = response.json;
      for (const key of [...REQUIRED_CARD_KEYS, 'description', 'website', 'representatives', 'isMine']) assert.ok(key in body, `champ manquant ${key}`);
      assert.equal(body.kind, 'exhibitor');
      assert.equal(body.id, sylvadour.documentId);
      assert.equal(body.displayName, 'Sylvadour');
      assert.equal(body.standNumber, '4');
      assert.equal(body.description, 'Scierie fictive du Sud-Ouest.');
      assert.equal(body.website, 'https://sylvadour.example.org');
      assert.equal(body.isMine, false);
    });

    it('les représentants visibles seulement (leurs propres cases), sous forme de cartes', async () => {
      const { world, p, sylvadour } = await scene();
      const { representatives } = (await fiche(world, p.lea, sylvadour)).json;
      assert.deepEqual(ids(representatives), [p.benoit.documentId], 'Pierre n’a pas coché l’annuaire');
      assert.equal(representatives[0].displayName, 'Benoît Tastet');
      assert.equal(representatives[0].tag, 'exhibitor_rep');
    });

    it('`isMine` est vrai pour un représentant de cet exposant, faux pour un autre exposant', async () => {
      const { world, p, sylvadour, resineo } = await scene();
      assert.equal((await fiche(world, p.benoit, sylvadour)).json.isMine, true);
      assert.equal((await fiche(world, p.pierre, sylvadour)).json.isMine, true);
      assert.equal((await fiche(world, p.benoit, resineo)).json.isMine, false);
    });

    it('un exposant sans représentant : fiche valable, liste vide', async () => {
      const { world, p, resineo } = await scene();
      const response = await fiche(world, p.lea, resineo);
      assert.equal(response.status, 200);
      assert.deepEqual(response.json.representatives, []);
    });

    it('404 : identifiant inconnu ou exposant d’une autre édition (NF-01)', async () => {
      const { world, p } = await scene();
      const other = await newEdition();
      const { exhibitor } = await W.createExhibitor(app(), other.edition, { name: 'Ailleurs' });
      expectError(await fiche(world, p.lea, exhibitor), 404);
      expectError(await (await as(world.edition, p.lea)).get('/directory/x/inconnu0000000000000000'), 404);
    });

    it('T-13 : aucune adresse e-mail ni identifiant HelloAsso, pas même pour les représentants', async () => {
      const { world, p, sylvadour } = await scene();
      assert.deepEqual(W.leaks((await fiche(world, p.lea, sylvadour)).text), []);
    });
  });

  describe('GET /suggestions : « Ils partagent vos sujets » (R-50, F-23, T-10)', () => {
    const suggestions = async (world, viewer) => (await (await as(world.edition, viewer)).get('/suggestions')).json;

    /**
     * Léa partage Économie circulaire et Construction bois. Candidats : Sylvadour (2 sujets communs), Noé (2), Inès, Mathis et Omar (1).
     * Écartés : Jules (rendez-vous accepté), Sara (demande en attente), Clara (annuaire non coché), organisateur, annulé, Hugo et Éva (aucun sujet commun).
     */
    async function sharing() {
      const base = await scene();
      const { world, p, topics } = base;
      const extra = {
        noe: await person(world.edition, { firstName: 'Noé', lastName: 'Deux', topics: [link(topics.eco), link(topics.bois)] }),
        omar: await person(world.edition, { firstName: 'Omar', lastName: 'Refuse', topics: [link(topics.eco)] }),
        jules: await person(world.edition, { firstName: 'Jules', lastName: 'Accepte', topics: [link(topics.eco)] }),
        sara: await person(world.edition, { firstName: 'Sara', lastName: 'Attend', topics: [link(topics.bois)] }),
        eva: await person(world.edition, { firstName: 'Éva', lastName: 'Cazaux', topics: [link(topics.data)] }),
      };
      await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['10h45'], requester: p.lea, target: extra.jules, status: 'accepted', tableNumber: 1 });
      await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['11h00'], requester: extra.sara, target: p.lea });
      await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['12h30'], requester: p.lea, target: extra.omar, status: 'declined' });
      return { ...base, extra };
    }

    it('au plus trois cartes de la CarteProfil, sans donnée personnelle', async () => {
      const { world, p } = await sharing();
      const response = await (await as(world.edition, p.lea)).get('/suggestions');
      assert.equal(response.status, 200);
      assert.ok(Array.isArray(response.json) && response.json.length === 3);
      for (const card of response.json) for (const key of REQUIRED_CARD_KEYS) assert.ok(key in card, `champ manquant ${key}`);
      assert.deepEqual(W.leaks(response.text), []);
    });

    it('deux sujets communs d’abord, l’exposant avant le participant, puis un candidat à un sujet', async () => {
      const { world, p, sylvadour, extra } = await sharing();
      const result = ids(await suggestions(world, p.lea));
      assert.equal(result[0], sylvadour.documentId, 'à deux sujets communs, l’exposant précède le participant');
      assert.equal(result[1], extra.noe.documentId);
      assert.ok([p.ines, p.mathis, extra.omar].map((who) => who.documentId).includes(result[2]), `troisième : ${result[2]}`);
    });

    it('jamais soi, ni un annuaire non coché (T-10), ni un organisateur, ni un annulé, ni un rendez-vous accepté ou en attente, ni personne sans sujet commun', async () => {
      const { world, p, extra } = await sharing();
      const seen = new Set();
      for (const viewerView of [await suggestions(world, p.lea)]) for (const id of ids(viewerView)) seen.add(id);
      for (const who of [p.lea, p.clara, p.boss, p.gone, p.hugo, extra.jules, extra.sara, extra.eva]) assert.ok(!seen.has(who.documentId), `${who.firstName} ne devrait pas être suggéré`);
    });

    it('un rendez-vous refusé n’exclut pas : Omar, refusé, reste suggérable ; Jules (accepté) et Sara (en attente) non', async () => {
      const world = await newEdition();
      const eco = await W.createTopic(app(), world.edition, 'Économie circulaire');
      const lea = await person(world.edition, { topics: [link(eco)] });
      const [omar, jules, sara] = [await person(world.edition, { topics: [link(eco)] }), await person(world.edition, { topics: [link(eco)] }), await person(world.edition, { topics: [link(eco)] })];
      await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['10h45'], requester: lea, target: omar, status: 'declined' });
      await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['11h00'], requester: lea, target: jules, status: 'accepted', tableNumber: 1 });
      await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['12h30'], requester: sara, target: lea });
      assert.deepEqual(ids(await suggestions(world, lea)), [omar.documentId]);
    });

    it('stable dans la journée : deux appels donnent le même résultat dans le même ordre', async () => {
      const { world, p } = await sharing();
      assert.deepEqual(ids(await suggestions(world, p.lea)), ids(await suggestions(world, p.lea)));
    });

    it('sans aucun sujet : des intervenants et des exposants seulement, ceux qui sont visibles (R-43)', async () => {
      const { world, sylvadour, resineo, p } = await scene();
      const bare = await person(world.edition, { topics: [] });
      const result = await suggestions(world, bare);
      assert.deepEqual(ids(result).sort(), [sylvadour.documentId, resineo.documentId, p.antoine.documentId].sort());
      assert.ok(result.every((card) => card.tag === 'speaker' || card.kind === 'exhibitor'));
    });

    it('aucun sujet en commun avec personne : liste vide, 200', async () => {
      const world = await newEdition();
      const rare = await W.createTopic(app(), world.edition, 'Sujet isolé');
      const lone = await person(world.edition, { topics: [link(rare)] });
      await person(world.edition, { topics: [] });
      const response = await (await as(world.edition, lone)).get('/suggestions');
      assert.equal(response.status, 200);
      assert.deepEqual(response.json, []);
    });

    it('NF-01 : jamais une personne ni un exposant d’une autre édition, même sur un sujet de même nom', async () => {
      const { world, p, topics } = await sharing();
      const other = await newEdition();
      const otherTopic = await W.createTopic(app(), other.edition, topics.eco.name);
      const stranger = await person(other.edition, { topics: [link(otherTopic)] });
      const { exhibitor } = await W.createExhibitor(app(), other.edition, { name: 'Exposant Ailleurs', topics: [otherTopic] });
      const result = ids(await suggestions(world, p.lea));
      assert.ok(!result.includes(stranger.documentId) && !result.includes(exhibitor.documentId));
    });

    it('401 sans session', async () => {
      expectError(await espace().request('/api/espace/suggestions'), 401, 'UNAUTHENTICATED');
    });
  });
});
