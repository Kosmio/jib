'use strict';

/**
 * Profil B2B, lot V5-D (docs/espace/specs/14-lots-finalisation.md) : R-50 étendu, R-42 amendé.
 *
 * `lookingFor` et `offering` (300 caractères) et `phone` (30 caractères, format libre) sont lus et écrits par GET/PATCH /me.
 * R-42 amendé : « Je cherche » et « Je propose » suivent la visibilité du profil ; le téléphone n'est lu que par la personne et par les
 * interlocuteurs d'un rendez-vous ACCEPTÉ avec elle (clé `phone` de GET /directory/p/:id, absente sinon), jamais dans l'annuaire, les
 * suggestions, les cartes, les exports, la carte de badge, /meetings ni l'administration des inscrits.
 *
 * Critères d'acceptation : 1. le téléphone n'apparaît dans aucune réponse d'API pour un tiers sans rendez-vous accepté ; 2. il apparaît
 * pour l'interlocuteur d'un rendez-vous accepté et disparaît après l'annulation ; 3. une suggestion fondée sur « Je cherche / Je propose »
 * apparaît quand aucun sujet n'est commun ; 4. profile, directory et suggestions restent verts (ces fichiers).
 * Chaque test crée son édition et ses personnes. Un seul démarrage de Strapi.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { useEspace } = require('../helpers/espace');
const { UID, link } = require('../helpers/espace-data');
const W = require('../helpers/meetings-world');

const ORGANIZER = 'organisation@example.org';
// Numéros fictifs reconnaissables : la valeur et sa forme sans espace.
const PHONE = '+33 7 55 55 01 23';
const PHONE_DIGITS = '+33755550123';
const OTHER_PHONE = '+33 7 66 66 04 56';

describe('profil B2B : Je cherche, Je propose, téléphone (V5-D, R-42, R-50)', { timeout: 900_000 }, () => {
  const espace = useEspace({ overrides: { ORGANIZER_EMAILS: ORGANIZER } });
  const login = W.useLogin(espace);
  const api = W.useApi(espace);
  const app = () => espace().app;

  const person = (edition, fields) => W.createPerson(app(), edition, fields);
  const as = async (edition, who) => api(await login(edition, who));
  const expectError = (response, status, code) => {
    assert.equal(response.status, status, `${response.status} ${response.text}`);
    if (code) assert.equal(response.json?.error?.code, code, response.text);
  };
  const stored = (attendee) => app().documents(UID.attendee).findOne({ documentId: attendee.documentId });
  /** Vrai si la réponse contient le numéro, tel quel ou sans espace. */
  const showsPhone = (value, phone = PHONE) => {
    const text = (typeof value === 'string' ? value : JSON.stringify(value)).replace(/\\u00a0/g, ' ');
    return text.includes(phone) || text.replace(/ /g, '').includes(phone.replace(/ /g, ''));
  };
  const fiche = async (edition, viewer, target) => (await (await as(edition, viewer)).get(`/directory/p/${target.documentId}`)).json;

  /** Léa consulte ; chacun des autres a un numéro. Créneaux distincts pour les rendez-vous de chacun. */
  async function scene() {
    const world = await W.createMeetingEdition(app(), { slug: W.unique('b2b'), title: 'Édition d’essai' });
    const { edition, slotList } = world;
    const eco = await W.createTopic(app(), edition, 'Économie circulaire');
    const p = {
      lea: await person(edition, { firstName: 'Léa', lastName: 'Ducasse', phone: OTHER_PHONE, lookingFor: 'Des financements pour une scierie', offering: 'Conseil en économie circulaire', topics: [link(eco)] }),
      mathis: await person(edition, { firstName: 'Mathis', lastName: 'Lagrange', phone: PHONE, lookingFor: 'Un partenaire logistique', offering: 'Financements participatifs' }),
      ines: await person(edition, { firstName: 'Inès', lastName: 'Castaing', phone: PHONE, lookingFor: 'Un chantier', offering: 'Charpente' }),
      nina: await person(edition, { firstName: 'Nina', lastName: 'Pending', phone: PHONE }),
      oscar: await person(edition, { firstName: 'Oscar', lastName: 'Annule', phone: PHONE }),
      david: await person(edition, { firstName: 'David', lastName: 'Decline', phone: PHONE }),
      boss: await person(edition, { firstName: 'Olivia', lastName: 'Organise', role: 'organizer' }),
    };
    return { world, edition, slotList, p };
  }

  const meet = (ctx, slotIndex, fields) => W.seedMeeting(app(), { edition: ctx.edition, slot: ctx.slotList[slotIndex], ...fields });

  // ----------------------------------------------------------------------------------------------------------------------------------
  describe('GET et PATCH /me : lookingFor, offering, phone', () => {
    it('GET /me rend les trois champs (null tant que vides) et PATCH les enregistre', async () => {
      const { edition } = await scene();
      const who = await person(edition);
      const client = await as(edition, who);
      const first = await client.get('/me');
      assert.deepEqual([first.json.lookingFor, first.json.offering, first.json.phone], [null, null, null]);
      const { status, json } = await client.patch('/me', { lookingFor: 'Des clients', offering: 'Du bois', phone: '06 12 34 56 78' });
      assert.equal(status, 200);
      assert.deepEqual([json.lookingFor, json.offering, json.phone], ['Des clients', 'Du bois', '06 12 34 56 78']);
      const row = await stored(who);
      assert.deepEqual([row.lookingFor, row.offering, row.phone], ['Des clients', 'Du bois', '06 12 34 56 78']);
      assert.equal((await client.get('/me')).json.phone, '06 12 34 56 78');
    });

    it('un champ non envoyé reste tel quel', async () => {
      const { edition } = await scene();
      const who = await person(edition, { lookingFor: 'A', offering: 'B', phone: '0102030405' });
      const { json } = await (await as(edition, who)).patch('/me', { bio: 'Bonjour.' });
      assert.deepEqual([json.lookingFor, json.offering, json.phone], ['A', 'B', '0102030405']);
    });

    for (const [label, value] of [['null', null], ['chaîne vide', ''], ['espaces seuls', '   ']]) {
      it(`${label} vide chacun des trois champs`, async () => {
        const { edition } = await scene();
        const who = await person(edition, { lookingFor: 'A', offering: 'B', phone: '0102030405' });
        const { status, json } = await (await as(edition, who)).patch('/me', { lookingFor: value, offering: value, phone: value });
        assert.equal(status, 200);
        assert.deepEqual([json.lookingFor, json.offering, json.phone], [null, null, null]);
        const row = await stored(who);
        assert.deepEqual([row.lookingFor ?? null, row.offering ?? null, row.phone ?? null], [null, null, null]);
      });
    }

    it('300 caractères passent, 301 sont refusés (« 300 caractères au plus. »), pour chacun des deux textes', async () => {
      const { edition } = await scene();
      const client = await as(edition, await person(edition));
      for (const name of ['lookingFor', 'offering']) {
        assert.equal((await client.patch('/me', { [name]: 'x'.repeat(300) })).status, 200, name);
        const refused = await client.patch('/me', { [name]: 'x'.repeat(301) });
        expectError(refused, 400, 'VALIDATION');
        assert.equal(refused.json.error.fields[name], '300 caractères au plus.');
      }
    });

    it('30 caractères passent pour le téléphone, 31 sont refusés (« 30 caractères au plus. »)', async () => {
      const { edition } = await scene();
      const who = await person(edition);
      const client = await as(edition, who);
      assert.equal((await client.patch('/me', { phone: '1'.repeat(30) })).status, 200);
      const refused = await client.patch('/me', { phone: '1'.repeat(31) });
      expectError(refused, 400, 'VALIDATION');
      assert.equal(refused.json.error.fields.phone, '30 caractères au plus.');
      assert.equal((await stored(who)).phone, '1'.repeat(30), 'le refus ne modifie rien');
    });

    it('un type qui n’est pas du texte : 400 VALIDATION « Valeur non valable. »', async () => {
      const { edition } = await scene();
      const client = await as(edition, await person(edition));
      for (const name of ['lookingFor', 'offering', 'phone']) {
        for (const value of [42, true, {}, ['a']]) {
          const refused = await client.patch('/me', { [name]: value });
          expectError(refused, 400, 'VALIDATION');
          assert.equal(refused.json.error.fields[name], 'Valeur non valable.', `${name} ${JSON.stringify(value)}`);
        }
      }
    });

    it('un téléphone est nettoyé : espaces multiples réduits, retours à la ligne et caractères de contrôle sans effet', async () => {
      const { edition } = await scene();
      const { json } = await (await as(edition, await person(edition))).patch('/me', { phone: '  06   12\n34\t56 78  ' });
      assert.equal(json.phone, '06 12 34 56 78');
    });

    it('le téléphone n’est pas lu dans le profil d’un autre : GET /me ne rend que le sien', async () => {
      const { edition, p } = await scene();
      assert.equal((await (await as(edition, p.lea)).get('/me')).json.phone, OTHER_PHONE);
      assert.equal((await (await as(edition, p.ines)).get('/me')).json.phone, PHONE);
    });

    it('401 sans session', async () => {
      expectError(await espace().request('/api/espace/me', { method: 'PATCH', json: { phone: '0102030405' } }), 401, 'UNAUTHENTICATED');
    });
  });

  // ----------------------------------------------------------------------------------------------------------------------------------
  describe('critère 1 : le téléphone n’apparaît pour aucun tiers sans rendez-vous accepté', () => {
    it('fiche d’un participant sans aucun lien : pas de clé `phone`, mais « Je cherche » et « Je propose » (R-42)', async () => {
      const ctx = await scene();
      const { json, status } = await (await as(ctx.edition, ctx.p.lea)).get(`/directory/p/${ctx.p.ines.documentId}`);
      assert.equal(status, 200);
      assert.equal('phone' in json, false, JSON.stringify(json));
      assert.equal(json.lookingFor, 'Un chantier');
      assert.equal(json.offering, 'Charpente');
      assert.equal(showsPhone(json), false);
    });

    it('rendez-vous en attente : pas de téléphone, ni pour le demandeur ni pour la cible', async () => {
      const ctx = await scene();
      await meet(ctx, 0, { requester: ctx.p.lea, target: ctx.p.nina, status: 'pending' });
      await meet(ctx, 1, { requester: ctx.p.nina, target: ctx.p.lea, status: 'pending' });
      assert.equal('phone' in (await fiche(ctx.edition, ctx.p.lea, ctx.p.nina)), false);
      assert.equal('phone' in (await fiche(ctx.edition, ctx.p.nina, ctx.p.lea)), false);
    });

    it('rendez-vous refusé : pas de téléphone', async () => {
      const ctx = await scene();
      await meet(ctx, 0, { requester: ctx.p.lea, target: ctx.p.david, status: 'declined', answeredBy: ctx.p.david });
      assert.equal('phone' in (await fiche(ctx.edition, ctx.p.lea, ctx.p.david)), false);
    });

    it('conversation sans rendez-vous : pas de téléphone', async () => {
      const ctx = await scene();
      await app().documents('api::espace.conversation').create({ data: { edition: link(ctx.edition), participants: [link(ctx.p.lea), link(ctx.p.mathis)] } });
      const card = await fiche(ctx.edition, ctx.p.lea, ctx.p.mathis);
      assert.equal('phone' in card, false);
    });

    it('rendez-vous accepté entre deux autres personnes : un tiers ne voit pas leur téléphone', async () => {
      const ctx = await scene();
      await meet(ctx, 0, { requester: ctx.p.mathis, target: ctx.p.ines, status: 'accepted', answeredBy: ctx.p.ines, tableNumber: 1 });
      assert.equal('phone' in (await fiche(ctx.edition, ctx.p.lea, ctx.p.mathis)), false);
      assert.equal('phone' in (await fiche(ctx.edition, ctx.p.lea, ctx.p.ines)), false);
    });

    it('un organisateur qui consulte une fiche sans rendez-vous accepté : pas de téléphone ; la fiche d’un organisateur reste en 404', async () => {
      const ctx = await scene();
      assert.equal('phone' in (await fiche(ctx.edition, ctx.p.boss, ctx.p.mathis)), false);
      await app().documents(UID.attendee).update({ documentId: ctx.p.boss.documentId, data: { phone: PHONE } });
      expectError(await (await as(ctx.edition, ctx.p.lea)).get(`/directory/p/${ctx.p.boss.documentId}`), 404, 'PROFILE_NOT_FOUND');
    });

    it('fiche d’un intervenant qui n’a pas donné son consentement : aucune des trois clés (page publique)', async () => {
      const ctx = await scene();
      const forest = ctx.world.sequences.find((sequence) => sequence.title === 'Forêt et adaptation');
      const speaker = await W.createSpeaker(app(), ctx.edition, { name: 'Antoine Vergnes', sequence: forest });
      const antoine = await person(ctx.edition, { firstName: 'Antoine', lastName: 'Vergnes', role: 'speaker', directoryOptIn: false, speaker: link(speaker), phone: PHONE, lookingFor: 'Secret cherche', offering: 'Secret propose' });
      const card = await fiche(ctx.edition, ctx.p.lea, antoine);
      for (const key of ['lookingFor', 'offering', 'phone']) assert.equal(key in card, false, key);
      assert.equal(showsPhone(card), false);
      assert.ok(!JSON.stringify(card).includes('Secret'));
    });

    it('un participant qui n’a pas coché l’annuaire et sans lien : 404, rien ne fuit', async () => {
      const ctx = await scene();
      const hidden = await person(ctx.edition, { directoryOptIn: false, phone: PHONE, lookingFor: 'Caché' });
      const response = await (await as(ctx.edition, ctx.p.lea)).get(`/directory/p/${hidden.documentId}`);
      expectError(response, 404, 'PROFILE_NOT_FOUND');
      assert.equal(showsPhone(response.text), false);
    });

    it('annuaire, recherche, fiches d’exposant et d’intervenant, suggestions : jamais le téléphone ni l’un des deux textes dans une carte', async () => {
      const ctx = await scene();
      const { exhibitor } = await W.createExhibitor(app(), ctx.edition, { name: 'Sylvadour' });
      await person(ctx.edition, { firstName: 'Benoît', lastName: 'Tastet', role: 'exhibitor_rep', exhibitor: link(exhibitor), phone: PHONE, offering: 'Financements' });
      const client = await as(ctx.edition, ctx.p.lea);
      const responses = [
        await client.get('/directory'),
        await client.get('/directory?q=mathis'),
        await client.get('/directory?type=participant'),
        await client.get(`/directory/x/${exhibitor.documentId}`),
        await client.get('/suggestions'),
      ];
      for (const response of responses) {
        assert.equal(response.status, 200, response.text);
        assert.equal(showsPhone(response.text), false, response.text.slice(0, 300));
        assert.equal(/"phone"|"lookingFor"|"offering"|"b2b"/.test(response.text), false, response.text.slice(0, 300));
      }
      assert.ok(responses[0].json.items.length >= 3, 'l’annuaire n’est pas vide');
    });

    it('/meetings, /conversations, /me d’un tiers : jamais le téléphone, même avec un rendez-vous accepté', async () => {
      const ctx = await scene();
      await meet(ctx, 0, { requester: ctx.p.lea, target: ctx.p.mathis, status: 'accepted', answeredBy: ctx.p.mathis, tableNumber: 1 });
      await app().documents('api::espace.conversation').create({ data: { edition: link(ctx.edition), participants: [link(ctx.p.lea), link(ctx.p.mathis)] } });
      const client = await as(ctx.edition, ctx.p.lea);
      for (const path of ['/meetings', '/conversations', '/me']) {
        const response = await client.get(path);
        assert.equal(response.status, 200, `${path} ${response.text}`);
        const foreign = response.text.replace(OTHER_PHONE, '');
        assert.equal(showsPhone(foreign), false, `${path} : ${response.text.slice(0, 300)}`);
      }
    });

    it('exports CSV de l’organisateur, liste et fiche d’administration des inscrits : jamais le téléphone', async () => {
      const ctx = await scene();
      await meet(ctx, 0, { requester: ctx.p.lea, target: ctx.p.mathis, status: 'accepted', answeredBy: ctx.p.mathis, tableNumber: 1 });
      const boss = await espace().signIn(ctx.edition.slug, ORGANIZER);
      const admin = (suffix) => espace().request(`/api/espace/admin/${ctx.edition.slug}${suffix}`, { cookie: boss.cookie });
      for (const suffix of ['/export/participants.csv', '/export/meetings.csv', '/export/stats.csv', '/stats', '/attendees', `/attendees/${ctx.p.mathis.documentId}`, '/meetings']) {
        const response = await admin(suffix);
        assert.equal(response.status, 200, `${suffix} ${response.status} ${response.text.slice(0, 200)}`);
        assert.equal(showsPhone(response.text), false, `${suffix} : ${response.text.slice(0, 300)}`);
        assert.equal(showsPhone(response.text, OTHER_PHONE), false, `${suffix} : numéro de Léa`);
        assert.ok(!/Financements participatifs|Un partenaire logistique/.test(response.text), `${suffix} : texte B2B`);
      }
    });

    it('carte de badge publique (jeton) : jamais le téléphone ni les textes B2B', async () => {
      const ctx = await scene();
      const { token } = await app().service('api::espace.badges').ensureToken(await stored(ctx.p.mathis));
      const response = await espace().request(`/api/espace/cards/${ctx.edition.slug}/${token}`);
      assert.equal(response.status, 200, response.text);
      assert.equal(showsPhone(response.text), false);
      assert.equal(/"phone"|"lookingFor"|"offering"/.test(response.text), false, response.text);
    });

    it('badge PDF : le numéro n’y figure pas', async () => {
      const ctx = await scene();
      const boss = await espace().signIn(ctx.edition.slug, ORGANIZER);
      const response = await fetch(`${espace().baseUrl}/api/espace/admin/${ctx.edition.slug}/attendees/${ctx.p.mathis.documentId}/badge`, { headers: { cookie: boss.cookie, 'x-forwarded-for': '10.9.9.9' } });
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer()).toString('latin1');
      assert.ok(bytes.startsWith('%PDF'));
      assert.equal(bytes.includes('755550123') || bytes.includes('55 55 01 23'), false);
    });
  });

  // ----------------------------------------------------------------------------------------------------------------------------------
  describe('critère 2 : visible de l’interlocuteur d’un rendez-vous accepté, il disparaît à l’annulation', () => {
    it('la fiche porte la clé `phone` pour le demandeur comme pour la cible', async () => {
      const ctx = await scene();
      await meet(ctx, 0, { requester: ctx.p.lea, target: ctx.p.mathis, status: 'accepted', answeredBy: ctx.p.mathis, tableNumber: 1 });
      assert.equal((await fiche(ctx.edition, ctx.p.lea, ctx.p.mathis)).phone, PHONE, 'le demandeur lit celui de la cible');
      assert.equal((await fiche(ctx.edition, ctx.p.mathis, ctx.p.lea)).phone, OTHER_PHONE, 'la cible lit celui du demandeur');
    });

    it('un rendez-vous accepté ne donne que le numéro de la personne concernée : celui d’un tiers reste caché', async () => {
      const ctx = await scene();
      await meet(ctx, 0, { requester: ctx.p.lea, target: ctx.p.mathis, status: 'accepted', answeredBy: ctx.p.mathis, tableNumber: 1 });
      assert.equal('phone' in (await fiche(ctx.edition, ctx.p.lea, ctx.p.ines)), false);
    });

    it('sans numéro enregistré : pas de clé `phone` même avec un rendez-vous accepté', async () => {
      const ctx = await scene();
      const bare = await person(ctx.edition, { firstName: 'Sans', lastName: 'Numero' });
      await meet(ctx, 0, { requester: ctx.p.lea, target: bare, status: 'accepted', answeredBy: bare, tableNumber: 1 });
      assert.equal('phone' in (await fiche(ctx.edition, ctx.p.lea, bare)), false);
    });

    it('la personne lit son propre numéro sur sa fiche, sans rendez-vous', async () => {
      const ctx = await scene();
      assert.equal((await fiche(ctx.edition, ctx.p.lea, ctx.p.lea)).phone, OTHER_PHONE);
    });

    it('annulation par l’API (POST /meetings/:id/cancel) : le numéro disparaît des deux côtés', async () => {
      const ctx = await scene();
      const meeting = await meet(ctx, 0, { requester: ctx.p.lea, target: ctx.p.oscar, status: 'accepted', answeredBy: ctx.p.oscar, tableNumber: 1 });
      assert.equal((await fiche(ctx.edition, ctx.p.lea, ctx.p.oscar)).phone, PHONE, 'avant');
      assert.equal((await fiche(ctx.edition, ctx.p.oscar, ctx.p.lea)).phone, OTHER_PHONE, 'avant');
      const cancelled = await (await as(ctx.edition, ctx.p.lea)).post(`/meetings/${meeting.documentId}/cancel`, {});
      assert.equal(cancelled.status, 200, cancelled.text);
      assert.equal('phone' in (await fiche(ctx.edition, ctx.p.lea, ctx.p.oscar)), false, 'après, côté demandeur');
      assert.equal('phone' in (await fiche(ctx.edition, ctx.p.oscar, ctx.p.lea)), false, 'après, côté cible');
    });

    it('annulation par l’organisateur (administration) : le numéro disparaît aussi', async () => {
      const ctx = await scene();
      const meeting = await meet(ctx, 0, { requester: ctx.p.lea, target: ctx.p.oscar, status: 'accepted', answeredBy: ctx.p.oscar, tableNumber: 1 });
      const boss = await espace().signIn(ctx.edition.slug, ORGANIZER);
      const cancelled = await espace().request(`/api/espace/admin/${ctx.edition.slug}/meetings/${meeting.documentId}/cancel`, { method: 'POST', cookie: boss.cookie, json: {} });
      assert.equal(cancelled.status, 200, cancelled.text);
      assert.equal('phone' in (await fiche(ctx.edition, ctx.p.lea, ctx.p.oscar)), false);
    });

    it('un second rendez-vous accepté garde le numéro quand le premier est annulé', async () => {
      const ctx = await scene();
      const first = await meet(ctx, 0, { requester: ctx.p.lea, target: ctx.p.oscar, status: 'accepted', answeredBy: ctx.p.oscar, tableNumber: 1 });
      await meet(ctx, 1, { requester: ctx.p.oscar, target: ctx.p.lea, status: 'accepted', answeredBy: ctx.p.lea, tableNumber: 1 });
      await (await as(ctx.edition, ctx.p.lea)).post(`/meetings/${first.documentId}/cancel`, {});
      assert.equal((await fiche(ctx.edition, ctx.p.lea, ctx.p.oscar)).phone, PHONE);
    });

    it('/meetings ne porte jamais le numéro : l’agenda le lit sur la fiche', async () => {
      const ctx = await scene();
      await meet(ctx, 0, { requester: ctx.p.lea, target: ctx.p.mathis, status: 'accepted', answeredBy: ctx.p.mathis, tableNumber: 1 });
      const { json, text } = await (await as(ctx.edition, ctx.p.lea)).get('/meetings');
      assert.equal(showsPhone(text), false);
      const counterpart = json.agenda.find((item) => item.type === 'meeting').meeting.counterpart;
      assert.equal(counterpart.id, ctx.p.mathis.documentId, 'l’agenda fournit l’identifiant de la fiche à lire');
    });

    it('un interlocuteur sans consentement à l’annuaire : sa fiche s’ouvre avec le rendez-vous accepté et porte le numéro', async () => {
      const ctx = await scene();
      const quiet = await person(ctx.edition, { firstName: 'Clara', lastName: 'Discrete', directoryOptIn: false, phone: PHONE });
      await meet(ctx, 0, { requester: quiet, target: ctx.p.lea, status: 'accepted', answeredBy: ctx.p.lea, tableNumber: 1 });
      assert.equal((await fiche(ctx.edition, ctx.p.lea, quiet)).phone, PHONE);
    });
  });

  // ----------------------------------------------------------------------------------------------------------------------------------
  describe('rendez-vous avec un exposant : qui voit le téléphone du demandeur', () => {
    /** Sylvadour a deux représentants (Benoît et Pierre) ; Inès demande un rendez-vous au stand. */
    async function exhibitorScene() {
      const ctx = await scene();
      const { exhibitor } = await W.createExhibitor(app(), ctx.edition, { name: 'Sylvadour', standNumber: '4' });
      ctx.exhibitor = exhibitor;
      ctx.benoit = await person(ctx.edition, { firstName: 'Benoît', lastName: 'Tastet', role: 'exhibitor_rep', exhibitor: link(exhibitor), phone: OTHER_PHONE });
      ctx.pierre = await person(ctx.edition, { firstName: 'Pierre', lastName: 'Haurie', role: 'exhibitor_rep', exhibitor: link(exhibitor), phone: OTHER_PHONE });
      return ctx;
    }

    it('rendez-vous en attente vers l’exposant : aucun représentant ne voit le téléphone du demandeur', async () => {
      const ctx = await exhibitorScene();
      await meet(ctx, 0, { requester: ctx.p.ines, exhibitor: ctx.exhibitor, status: 'pending' });
      assert.equal('phone' in (await fiche(ctx.edition, ctx.benoit, ctx.p.ines)), false);
      assert.equal('phone' in (await fiche(ctx.edition, ctx.pierre, ctx.p.ines)), false);
    });

    it('accepté par Benoît : Benoît (qui a répondu) voit le téléphone du demandeur, le demandeur celui de Benoît', async () => {
      const ctx = await exhibitorScene();
      await meet(ctx, 0, { requester: ctx.p.ines, exhibitor: ctx.exhibitor, status: 'accepted', answeredBy: ctx.benoit, tableNumber: 1 });
      assert.equal((await fiche(ctx.edition, ctx.benoit, ctx.p.ines)).phone, PHONE);
      assert.equal((await fiche(ctx.edition, ctx.p.ines, ctx.benoit)).phone, OTHER_PHONE);
    });

    it('accepté par Benoît : Pierre, autre représentant qui n’a pas répondu, voit lui aussi le téléphone du demandeur (comportement constaté du code)', async () => {
      const ctx = await exhibitorScene();
      await meet(ctx, 0, { requester: ctx.p.ines, exhibitor: ctx.exhibitor, status: 'accepted', answeredBy: ctx.benoit, tableNumber: 1 });
      assert.equal((await fiche(ctx.edition, ctx.pierre, ctx.p.ines)).phone, PHONE);
    });

    it('accepté par Benoît : le demandeur ne voit pas le téléphone de Pierre, qui n’est pas son interlocuteur', async () => {
      const ctx = await exhibitorScene();
      await meet(ctx, 0, { requester: ctx.p.ines, exhibitor: ctx.exhibitor, status: 'accepted', answeredBy: ctx.benoit, tableNumber: 1 });
      assert.equal('phone' in (await fiche(ctx.edition, ctx.p.ines, ctx.pierre)), false);
    });

    it('accepté puis annulé : plus aucun représentant ne voit le téléphone du demandeur', async () => {
      const ctx = await exhibitorScene();
      await meet(ctx, 0, { requester: ctx.p.ines, exhibitor: ctx.exhibitor, status: 'cancelled', answeredBy: ctx.benoit });
      assert.equal('phone' in (await fiche(ctx.edition, ctx.benoit, ctx.p.ines)), false);
      assert.equal('phone' in (await fiche(ctx.edition, ctx.pierre, ctx.p.ines)), false);
    });

    it('un rendez-vous accepté avec un autre exposant ne donne rien aux représentants de celui-ci', async () => {
      const ctx = await exhibitorScene();
      const { exhibitor: other } = await W.createExhibitor(app(), ctx.edition, { name: 'Résinéo', standNumber: '12' });
      await meet(ctx, 0, { requester: ctx.p.ines, exhibitor: other, status: 'accepted', answeredBy: ctx.p.mathis, tableNumber: 1 });
      assert.equal('phone' in (await fiche(ctx.edition, ctx.pierre, ctx.p.ines)), false);
    });
  });

  // ----------------------------------------------------------------------------------------------------------------------------------
  describe('critère 3 et R-50 : suggestions fondées sur « Je cherche » et « Je propose »', () => {
    const suggestionIds = async (edition, who) => (await (await as(edition, who)).get('/suggestions')).json.map((card) => card.id);

    it('aucun sujet commun : Mathis (Je propose « Financements ») est suggéré à Léa (Je cherche « financements »)', async () => {
      const ctx = await scene();
      const found = await suggestionIds(ctx.edition, ctx.p.lea);
      assert.ok(found.includes(ctx.p.mathis.documentId), found.join());
      assert.ok(!found.includes(ctx.p.ines.documentId), 'Inès n’a aucun mot en commun');
    });

    it('et inversement : Mathis voit Léa quand son « Je propose » rencontre le « Je cherche » de celle-ci', async () => {
      const ctx = await scene();
      const found = await suggestionIds(ctx.edition, ctx.p.mathis);
      assert.ok(found.includes(ctx.p.lea.documentId), found.join());
    });

    it('les cartes suggérées ne portent ni téléphone ni texte B2B', async () => {
      const ctx = await scene();
      const { status, text } = await (await as(ctx.edition, ctx.p.lea)).get('/suggestions');
      assert.equal(status, 200);
      assert.equal(/phone|lookingFor|offering|b2b|Financements participatifs/.test(text), false, text);
    });

    it('un profil qui n’a pas coché l’annuaire n’est pas suggéré, même avec des mots communs (R-41)', async () => {
      const ctx = await scene();
      const hidden = await person(ctx.edition, { directoryOptIn: false, offering: 'Financements pour scierie' });
      assert.ok(!(await suggestionIds(ctx.edition, ctx.p.lea)).includes(hidden.documentId));
    });

    it('une personne déjà en rendez-vous en attente ou accepté n’est plus suggérée', async () => {
      const ctx = await scene();
      await meet(ctx, 0, { requester: ctx.p.lea, target: ctx.p.mathis, status: 'pending' });
      assert.ok(!(await suggestionIds(ctx.edition, ctx.p.lea)).includes(ctx.p.mathis.documentId));
    });

    it('un rendez-vous refusé ou annulé ne l’exclut pas', async () => {
      const ctx = await scene();
      await meet(ctx, 0, { requester: ctx.p.lea, target: ctx.p.mathis, status: 'declined', answeredBy: ctx.p.mathis });
      assert.ok((await suggestionIds(ctx.edition, ctx.p.lea)).includes(ctx.p.mathis.documentId));
    });

    it('un profil sans texte et sans sujet commun reste absent', async () => {
      const ctx = await scene();
      const empty = await person(ctx.edition, { firstName: 'Vide', lastName: 'Total' });
      assert.ok(!(await suggestionIds(ctx.edition, ctx.p.lea)).includes(empty.documentId));
    });

    it('les sujets communs passent avant les mots communs', async () => {
      const ctx = await scene();
      const topic = await W.createTopic(app(), ctx.edition, 'Sujet partagé');
      const lea = ctx.p.lea;
      await app().documents(UID.attendee).update({ documentId: lea.documentId, data: { topics: [link(topic)] } });
      const shared = await person(ctx.edition, { firstName: 'Sujet', lastName: 'Commun', topics: [link(topic)] });
      const found = await suggestionIds(ctx.edition, lea);
      assert.ok(found.indexOf(shared.documentId) < found.indexOf(ctx.p.mathis.documentId), found.join());
    });

    it('PATCH /me prend effet sur les suggestions : renseigner « Je cherche » fait apparaître la personne', async () => {
      const ctx = await scene();
      const newcomer = await person(ctx.edition, { firstName: 'Nouvelle', lastName: 'Arrivee' });
      const client = await as(ctx.edition, newcomer);
      assert.ok(!(await suggestionIds(ctx.edition, newcomer)).includes(ctx.p.ines.documentId));
      await client.patch('/me', { lookingFor: 'Charpentes' });
      assert.ok((await suggestionIds(ctx.edition, newcomer)).includes(ctx.p.ines.documentId));
    });
  });

  // ----------------------------------------------------------------------------------------------------------------------------------
  describe('coût de la lecture de l’agenda (information)', () => {
    it('une lecture de fiche par interlocuteur accepté : durée et requêtes SQL mesurées pour 20 rendez-vous', async (t) => {
      const ctx = await scene();
      const slots = ctx.slotList;
      const people = [];
      for (let index = 0; index < 20; index += 1) {
        const other = await person(ctx.edition, { firstName: `Pair${index}`, lastName: `Test${index}`, phone: `+33 7 00 00 00 ${String(index).padStart(2, '0')}` });
        people.push(other);
        await W.seedMeeting(app(), { edition: ctx.edition, slot: slots[index % slots.length], requester: ctx.p.lea, target: other, status: 'accepted', answeredBy: other, tableNumber: (index % 3) + 1 });
      }
      const client = await as(ctx.edition, ctx.p.lea);
      let queries = 0;
      const count = () => {
        queries += 1;
      };
      app().db.connection.on('query', count);
      const started = Date.now();
      const responses = [];
      await Promise.all(people.map(async (other) => responses.push(await client.get(`/directory/p/${other.documentId}`))));
      const elapsed = Date.now() - started;
      app().db.connection.removeListener('query', count);
      t.diagnostic(`20 fiches en parallèle : ${elapsed} ms, ${queries} requêtes SQL (${(queries / 20).toFixed(1)} par fiche)`);
      assert.ok(responses.every((response) => response.status === 200 && response.json.phone));
      assert.ok(elapsed < 10_000, `${elapsed} ms pour 20 fiches`);
    });
  });
});
