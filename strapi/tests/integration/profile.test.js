'use strict';

/**
 * Profil (lot 9) : `GET /me` complet (A-36, R-30, F-23, F-24), `PATCH /me` étendu (F-30, F-31, R-31, 3.2 du plan des phases 2 et 3)
 * et `GET /editions/:slug/topics` (public). Les champs de phase 1 (`firstName`, `lastName`, `jobTitle`, `company`) sont couverts par
 * espace-acces.test.js ; ce fichier couvre ce que la phase 2 ajoute : présentation, sujets, préférences d'e-mail, complétion,
 * exposant, table dédiée, compteurs. Un seul démarrage de Strapi.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { useEspace } = require('../helpers/espace');
const { UID, link } = require('../helpers/espace-data');
const W = require('../helpers/meetings-world');

const ME_PHASE_1 = ['company', 'consent', 'edition', 'firstName', 'id', 'isOrganizer', 'jobTitle', 'lastName', 'role'];
const ME_PHASE_2 = ['bio', 'counts', 'emailPrefs', 'exhibitor', 'hostedTableNumber', 'photoUrl', 'profileCompletion', 'topics'];

describe('profil : GET /me, PATCH /me et sujets (lot 9)', { timeout: 600_000 }, () => {
  const espace = useEspace({ overrides: { ORGANIZER_EMAILS: 'organisation@example.org' } });
  const login = W.useLogin(espace);
  const api = W.useApi(espace);
  const app = () => espace().app;

  const newEdition = (options) => W.createMeetingEdition(app(), { slug: W.unique('prof'), title: 'Édition d’essai', ...options });
  const person = (edition, fields) => W.createPerson(app(), edition, fields);
  const as = async (edition, who) => api(await login(edition, who));
  const topic = (edition, name) => W.createTopic(app(), edition, name);
  const expectError = (response, status, code) => {
    assert.equal(response.status, status, `${response.status} ${response.text}`);
    assert.equal(response.json?.error?.code, code, response.text);
  };
  const stored = (attendee) => app().documents(UID.attendee).findOne({ documentId: attendee.documentId, populate: { topics: true } });

  describe('GET /me : le profil complet (A-36)', () => {
    it('rend les champs de la phase 1 et ceux de la phase 2, et rien d’autre', async () => {
      const world = await newEdition();
      const lea = await person(world.edition);
      const { status, json } = await (await as(world.edition, lea)).get('/me');
      assert.equal(status, 200);
      assert.deepEqual(Object.keys(json).sort(), [...ME_PHASE_1, ...ME_PHASE_2].sort());
    });

    it('un profil importé, sans rien de plus : valeurs par défaut', async () => {
      const world = await newEdition();
      const lea = await person(world.edition, { jobTitle: null });
      const { json } = await (await as(world.edition, lea)).get('/me');
      assert.equal(json.id, lea.documentId);
      assert.equal(json.bio, null);
      assert.equal(json.photoUrl, null);
      assert.deepEqual(json.topics, []);
      assert.deepEqual(json.emailPrefs, { meetingRequests: true, messages: true, reminders: true });
      assert.equal(json.profileCompletion, 40);
      assert.equal(json.exhibitor, null);
      assert.equal(json.hostedTableNumber, null);
      assert.deepEqual(json.counts, { pendingReceived: 0, unreadMessages: 0 });
    });

    it('R-30 : fonction, présentation et sujets s’ajoutent par 15 % chacun (85 % sans photo)', async () => {
      const world = await newEdition();
      const eco = await topic(world.edition, 'Économie circulaire');
      const lea = await person(world.edition, { jobTitle: 'Cheffe de projet', bio: 'Je cherche des partenaires.', topics: [link(eco)] });
      const { json } = await (await as(world.edition, lea)).get('/me');
      assert.equal(json.profileCompletion, 85);
      assert.equal(json.bio, 'Je cherche des partenaires.');
      assert.deepEqual(json.topics, [{ id: eco.documentId, name: 'Économie circulaire' }]);
    });

    it('un représentant d’exposant porte son exposant { id, name, standNumber }', async () => {
      const world = await newEdition();
      const { exhibitor } = await W.createExhibitor(app(), world.edition, { name: 'Sylvadour', standNumber: '4' });
      const rep = await person(world.edition, { role: 'exhibitor_rep', exhibitor: link(exhibitor) });
      const { json } = await (await as(world.edition, rep)).get('/me');
      assert.deepEqual(json.exhibitor, { id: exhibitor.documentId, name: 'Sylvadour', standNumber: '4' });
    });

    it('un intervenant à table dédiée porte `hostedTableNumber`', async () => {
      const world = await newEdition();
      const host = await person(world.edition, { role: 'speaker', hostedTableNumber: 2, meetingsOptIn: false });
      const { json } = await (await as(world.edition, host)).get('/me');
      assert.equal(json.hostedTableNumber, 2);
    });

    it('les préférences d’e-mail enregistrées sont rendues', async () => {
      const world = await newEdition();
      const lea = await person(world.edition, { emailPrefs: { meetingRequests: false, messages: true, reminders: false } });
      const { json } = await (await as(world.edition, lea)).get('/me');
      assert.deepEqual(json.emailPrefs, { meetingRequests: false, messages: true, reminders: false });
    });

    it('R-42 : ni e-mail, ni identifiant HelloAsso (NF-11)', async () => {
      const world = await newEdition();
      const lea = await person(world.edition);
      const response = await (await as(world.edition, lea)).get('/me');
      assert.deepEqual(W.leaks(response.text), []);
    });

    it('401 UNAUTHENTICATED sans session', async () => {
      expectError(await espace().request('/api/espace/me'), 401, 'UNAUTHENTICATED');
    });

    describe('compteurs `counts` (F-24, A-36)', () => {
      it('`pendingReceived` : les demandes reçues en attente seulement', async () => {
        const world = await newEdition();
        const [lea, ines, hugo, jules] = [await person(world.edition), await person(world.edition), await person(world.edition), await person(world.edition)];
        const seed = (fields) => W.seedMeeting(app(), { edition: world.edition, ...fields });
        await seed({ slot: world.slots['10h45'], requester: ines, target: lea });
        await seed({ slot: world.slots['11h00'], requester: hugo, target: lea });
        await seed({ slot: world.slots['12h30'], requester: jules, target: lea, status: 'declined' });
        await seed({ slot: world.slots['12h45'], requester: ines, target: lea, status: 'accepted', tableNumber: 1 });
        await seed({ slot: world.slots['13h00'], requester: lea, target: ines });
        const { json } = await (await as(world.edition, lea)).get('/me');
        assert.equal(json.counts.pendingReceived, 2);
      });

      it('`pendingReceived` : un représentant compte aussi les demandes adressées à son exposant', async () => {
        const world = await newEdition();
        const { exhibitor } = await W.createExhibitor(app(), world.edition, { name: 'Sylvadour' });
        const rep = await person(world.edition, { role: 'exhibitor_rep', exhibitor: link(exhibitor) });
        const [ines, hugo] = [await person(world.edition), await person(world.edition)];
        await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['10h45'], requester: ines, exhibitor });
        await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['11h00'], requester: hugo, exhibitor });
        const { json } = await (await as(world.edition, rep)).get('/me');
        assert.equal(json.counts.pendingReceived, 2);
      });

      it('`pendingReceived` ne compte pas les demandes d’une autre édition ni celles des autres participants', async () => {
        const [mine, theirs] = [await newEdition(), await newEdition()];
        const [lea, ines, other] = [await person(mine.edition), await person(mine.edition), await person(mine.edition)];
        const [a, b] = [await person(theirs.edition), await person(theirs.edition)];
        await W.seedMeeting(app(), { edition: theirs.edition, slot: theirs.slots['10h45'], requester: a, target: b });
        await W.seedMeeting(app(), { edition: mine.edition, slot: mine.slots['10h45'], requester: ines, target: other });
        const { json } = await (await as(mine.edition, lea)).get('/me');
        assert.equal(json.counts.pendingReceived, 0);
      });

      it('`unreadMessages` : les messages reçus non lus, pas les siens, pas les lus, pas ceux des autres conversations', async () => {
        const world = await newEdition();
        const [lea, mathis, ines] = [await person(world.edition), await person(world.edition), await person(world.edition)];
        const conversation = async (a, b) => {
          const [first, second] = [a, b].sort((x, y) => x.id - y.id);
          return app().documents('api::espace.conversation').create({ data: { edition: link(world.edition), participants: [link(first), link(second)], lastMessageAt: new Date() } });
        };
        const message = (conv, author, readAt) => app().documents('api::espace.message').create({ data: { conversation: link(conv), author: link(author), body: 'Bonjour.', ...(readAt && { readAt }) } });
        const withMathis = await conversation(lea, mathis);
        await message(withMathis, mathis, new Date());
        await message(withMathis, lea);
        await message(withMathis, mathis);
        await message(withMathis, mathis);
        const withInes = await conversation(lea, ines);
        await message(withInes, ines);
        const elsewhere = await conversation(mathis, ines);
        await message(elsewhere, ines);
        const { json } = await (await as(world.edition, lea)).get('/me');
        assert.equal(json.counts.unreadMessages, 3);
      });
    });
  });

  describe('PATCH /me : présentation, sujets et préférences (F-30, F-31)', () => {
    describe('présentation (`bio`)', () => {
      it('enregistre la présentation et la rend dans Me', async () => {
        const world = await newEdition();
        const lea = await person(world.edition);
        const { status, json } = await (await as(world.edition, lea)).patch('/me', { bio: 'Je cherche des partenaires pour la construction bois.' });
        assert.equal(status, 200);
        assert.equal(json.bio, 'Je cherche des partenaires pour la construction bois.');
        assert.equal((await stored(lea)).bio, 'Je cherche des partenaires pour la construction bois.');
      });

      it('280 caractères passent, 281 sont refusés (400 VALIDATION, `fields.bio`)', async () => {
        const world = await newEdition();
        const client = await as(world.edition, await person(world.edition));
        assert.equal((await client.patch('/me', { bio: 'x'.repeat(280) })).status, 200);
        const refused = await client.patch('/me', { bio: 'x'.repeat(281) });
        expectError(refused, 400, 'VALIDATION');
        assert.ok(refused.json.error.fields.bio, 'message sous le champ');
      });

      it('une présentation vide devient nulle', async () => {
        const world = await newEdition();
        const lea = await person(world.edition, { bio: 'Ancienne présentation.' });
        const { json } = await (await as(world.edition, lea)).patch('/me', { bio: '' });
        assert.equal(json.bio, null);
        assert.equal((await stored(lea)).bio ?? null, null);
      });

      it('une présentation qui n’est pas un texte est refusée', async () => {
        const world = await newEdition();
        const client = await as(world.edition, await person(world.edition));
        for (const bio of [42, true, {}, ['a']]) expectError(await client.patch('/me', { bio }), 400, 'VALIDATION');
      });

      it('la complétion suit : +15 % avec une présentation', async () => {
        const world = await newEdition();
        const lea = await person(world.edition, { jobTitle: null });
        const client = await as(world.edition, lea);
        assert.equal((await client.get('/me')).json.profileCompletion, 40);
        assert.equal((await client.patch('/me', { bio: 'Bonjour.' })).json.profileCompletion, 55);
      });
    });

    describe('sujets (`topics` : 0 à 3 documentId distincts de l’édition)', () => {
      it('enregistre trois sujets et les rend en [{ id, name }]', async () => {
        const world = await newEdition();
        const topics = [await topic(world.edition, 'Forêt et adaptation'), await topic(world.edition, 'Économie circulaire'), await topic(world.edition, 'Construction bois')];
        const lea = await person(world.edition);
        const { status, json } = await (await as(world.edition, lea)).patch('/me', { topics: topics.map((item) => item.documentId) });
        assert.equal(status, 200, JSON.stringify(json));
        assert.deepEqual(
          json.topics.map((item) => item.id).sort(),
          topics.map((item) => item.documentId).sort()
        );
        assert.deepEqual(json.topics.map((item) => item.name).sort(), ['Construction bois', 'Forêt et adaptation', 'Économie circulaire'].sort());
        assert.equal((await stored(lea)).topics.length, 3);
      });

      it('remplace les sujets précédents ; une liste vide les retire', async () => {
        const world = await newEdition();
        const [eco, bois] = [await topic(world.edition, 'Économie circulaire'), await topic(world.edition, 'Construction bois')];
        const lea = await person(world.edition, { topics: [link(eco)] });
        const client = await as(world.edition, lea);
        assert.deepEqual((await client.patch('/me', { topics: [bois.documentId] })).json.topics, [{ id: bois.documentId, name: 'Construction bois' }]);
        assert.deepEqual((await client.patch('/me', { topics: [] })).json.topics, []);
        assert.equal((await stored(lea)).topics.length, 0);
      });

      it('un PATCH sans `topics` ne les touche pas', async () => {
        const world = await newEdition();
        const eco = await topic(world.edition, 'Économie circulaire');
        const lea = await person(world.edition, { topics: [link(eco)] });
        const { json } = await (await as(world.edition, lea)).patch('/me', { bio: 'Bonjour.' });
        assert.equal(json.topics.length, 1);
      });

      it('quatre sujets : 400 VALIDATION, `fields.topics`, rien n’est enregistré', async () => {
        const world = await newEdition();
        const topics = [];
        for (const name of ['A', 'B', 'C', 'D']) topics.push(await topic(world.edition, `Sujet ${name}`));
        const lea = await person(world.edition);
        const response = await (await as(world.edition, lea)).patch('/me', { topics: topics.map((item) => item.documentId) });
        expectError(response, 400, 'VALIDATION');
        assert.ok(response.json.error.fields.topics);
        assert.equal((await stored(lea)).topics.length, 0);
      });

      it('un sujet en double, inconnu ou d’une autre édition : 400 VALIDATION', async () => {
        const [mine, theirs] = [await newEdition(), await newEdition()];
        const eco = await topic(mine.edition, 'Économie circulaire');
        const foreign = await topic(theirs.edition, 'Économie circulaire');
        const client = await as(mine.edition, await person(mine.edition));
        expectError(await client.patch('/me', { topics: [eco.documentId, eco.documentId] }), 400, 'VALIDATION');
        expectError(await client.patch('/me', { topics: ['inconnu0000000000000000'] }), 400, 'VALIDATION');
        expectError(await client.patch('/me', { topics: [foreign.documentId] }), 400, 'VALIDATION');
        expectError(await client.patch('/me', { topics: [eco.documentId, foreign.documentId] }), 400, 'VALIDATION');
      });

      it('`topics` qui n’est pas une liste de textes : 400 VALIDATION', async () => {
        const world = await newEdition();
        const client = await as(world.edition, await person(world.edition));
        for (const topics of ['abc', 42, {}, [1, 2], [null]]) expectError(await client.patch('/me', { topics }), 400, 'VALIDATION');
      });

      it('la complétion suit : +15 % dès le premier sujet, pas plus avec trois', async () => {
        const world = await newEdition();
        const topics = [await topic(world.edition, 'A'), await topic(world.edition, 'B'), await topic(world.edition, 'C')];
        const client = await as(world.edition, await person(world.edition, { jobTitle: null }));
        assert.equal((await client.patch('/me', { topics: [topics[0].documentId] })).json.profileCompletion, 55);
        assert.equal((await client.patch('/me', { topics: topics.map((item) => item.documentId) })).json.profileCompletion, 55);
      });
    });

    describe('préférences d’e-mail (`emailPrefs`)', () => {
      it('enregistre les trois booléens et les rend', async () => {
        const world = await newEdition();
        const lea = await person(world.edition);
        const client = await as(world.edition, lea);
        const prefs = { meetingRequests: false, messages: true, reminders: false };
        const { status, json } = await client.patch('/me', { emailPrefs: prefs });
        assert.equal(status, 200);
        assert.deepEqual(json.emailPrefs, prefs);
        assert.deepEqual((await stored(lea)).emailPrefs, prefs);
        assert.deepEqual((await client.get('/me')).json.emailPrefs, prefs);
      });

      it('une valeur qui n’est pas un booléen, ou qui n’est pas un objet : 400 VALIDATION, `fields.emailPrefs`', async () => {
        const world = await newEdition();
        const client = await as(world.edition, await person(world.edition));
        const bad = await client.patch('/me', { emailPrefs: { meetingRequests: 'oui', messages: true, reminders: true } });
        expectError(bad, 400, 'VALIDATION');
        assert.ok(bad.json.error.fields.emailPrefs);
        for (const emailPrefs of [null, 'non', [], { meetingRequests: null }]) expectError(await client.patch('/me', { emailPrefs }), 400, 'VALIDATION');
      });
    });

    describe('R-31 et NF-01 : ce que le PATCH laisse intact', () => {
      it('`editedFields` ne concerne que les quatre champs importés : présentation, sujets et préférences n’y entrent pas', async () => {
        const world = await newEdition();
        const eco = await topic(world.edition, 'Économie circulaire');
        const lea = await person(world.edition);
        const client = await as(world.edition, lea);
        await client.patch('/me', { bio: 'Bonjour.', topics: [eco.documentId], emailPrefs: { meetingRequests: false, messages: false, reminders: false } });
        assert.deepEqual((await stored(lea)).editedFields ?? [], []);
      });

      it('modifier la fonction l’ajoute à `editedFields`, avec la présentation dans le même PATCH', async () => {
        const world = await newEdition();
        const lea = await person(world.edition, { jobTitle: 'Ancienne fonction' });
        await (await as(world.edition, lea)).patch('/me', { jobTitle: 'Nouvelle fonction', bio: 'Bonjour.' });
        assert.deepEqual((await stored(lea)).editedFields, ['jobTitle']);
      });

      it('rôle, table dédiée, statut, consentements, e-mail et édition du corps sont ignorés', async () => {
        const world = await newEdition();
        const lea = await person(world.edition, { directoryOptIn: true, meetingsOptIn: true });
        const { json } = await (await as(world.edition, lea)).patch('/me', {
          bio: 'Bonjour.',
          role: 'organizer',
          hostedTableNumber: 5,
          status: 'cancelled',
          directoryOptIn: false,
          meetingsOptIn: false,
          email: 'pirate@example.org',
          edition: 'autre',
          helloassoItemId: '123',
        });
        assert.equal(json.role, 'participant');
        assert.equal(json.hostedTableNumber, null);
        assert.equal(json.consent.directoryOptIn, true);
        const row = await stored(lea);
        assert.equal(row.role, 'participant');
        assert.equal(row.status, 'active');
        assert.equal(row.email, lea.email);
        assert.equal(row.hostedTableNumber ?? null, null);
        assert.equal(row.directoryOptIn, true);
      });

      it('un PATCH ne touche que le participant de la session', async () => {
        const world = await newEdition();
        const [lea, ines] = [await person(world.edition), await person(world.edition)];
        await (await as(world.edition, lea)).patch('/me', { bio: 'Présentation de Léa.' });
        assert.equal((await stored(ines)).bio ?? null, null);
      });

      it('les erreurs de la phase 1 restent : prénom vide → 400 VALIDATION avec `fields`', async () => {
        const world = await newEdition();
        const response = await (await as(world.edition, await person(world.edition))).patch('/me', { firstName: '' });
        expectError(response, 400, 'VALIDATION');
        assert.ok(response.json.error.fields.firstName);
      });

      it('401 UNAUTHENTICATED sans session', async () => {
        expectError(await espace().request('/api/espace/me', { method: 'PATCH', json: { bio: 'x' } }), 401, 'UNAUTHENTICATED');
      });
    });
  });

  describe('GET /editions/:slug/topics (public)', () => {
    it('sans session : [{ id, name }] triés en français, accents ignorés', async () => {
      const world = await newEdition();
      for (const name of ['Territoires résilients', 'Économie circulaire', 'Process, data et IA', 'Forêt et adaptation', 'Construction bois']) await topic(world.edition, name);
      const response = await espace().request(`/api/espace/editions/${world.edition.slug}/topics`);
      assert.equal(response.status, 200, response.text);
      assert.deepEqual(response.json.map((item) => item.name), ['Construction bois', 'Économie circulaire', 'Forêt et adaptation', 'Process, data et IA', 'Territoires résilients']);
      assert.deepEqual(Object.keys(response.json[0]).sort(), ['id', 'name']);
    });

    it('l’identifiant est le documentId du sujet', async () => {
      const world = await newEdition();
      const eco = await topic(world.edition, 'Économie circulaire');
      const response = await espace().request(`/api/espace/editions/${world.edition.slug}/topics`);
      assert.deepEqual(response.json, [{ id: eco.documentId, name: 'Économie circulaire' }]);
    });

    it('les sujets d’une autre édition n’y figurent pas', async () => {
      const [mine, theirs] = [await newEdition(), await newEdition()];
      await topic(mine.edition, 'Sujet de la première');
      await topic(theirs.edition, 'Sujet de la seconde');
      const response = await espace().request(`/api/espace/editions/${mine.edition.slug}/topics`);
      assert.deepEqual(response.json.map((item) => item.name), ['Sujet de la première']);
    });

    it('une édition sans sujet : liste vide', async () => {
      const world = await newEdition();
      assert.deepEqual((await espace().request(`/api/espace/editions/${world.edition.slug}/topics`)).json, []);
    });

    it('édition inconnue : 404 EDITION_NOT_FOUND', async () => {
      expectError(await espace().request('/api/espace/editions/edition-inconnue/topics'), 404, 'EDITION_NOT_FOUND');
    });

    it('aucune donnée personnelle, aucun en-tête de session requis', async () => {
      const world = await newEdition();
      await topic(world.edition, 'Économie circulaire');
      assert.deepEqual(W.leaks((await espace().request(`/api/espace/editions/${world.edition.slug}/topics`)).text), []);
    });
  });
});
