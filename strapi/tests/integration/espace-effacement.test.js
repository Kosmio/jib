'use strict';

/**
 * Effacement, export individuel et purge, lot V5-A (docs/espace/specs/14-lots-finalisation.md) : F-33, R-44, NF-12, NF-13.
 *
 * Routes :
 *   POST /api/espace/me/erase { confirm: true }                    -> 200 { erased: true }, cookie effacé ; 400 VALIDATION sans confirm
 *   GET  /api/espace/me/export                                      -> JSON en pièce jointe
 *   POST /api/espace/admin/:edition/attendees/:id/erase             -> 200 la fiche anonymisée ; 409 SELF_FORBIDDEN pour soi
 * Service api::espace.privacy : erase, exportOf, purge, erasedHashes, isErased, matcher. Tâche espacePurge (config/cron-tasks.js).
 *
 * Critères d'acceptation : 1 (annuaire, suggestions, exports, fiches, carte de badge ; messages sous « Participant supprimé »),
 * 2 (rendez-vous à venir annulés et notifiés, tables libérées, passés intacts), 3 (dix synchronisations ne la réimportent pas),
 * 4 (export sans donnée d'un tiers hors prénom, nom, entreprise), 5 (purge à date + 12 mois et un jour, programme gardé, idempotente).
 * En plus : effacement par le pilotage, exemptions lecture seule et espace fermé, reconnexion impossible.
 *
 * Les fichiers téléversés (photo) sont écrits dans strapi/public/uploads ; ceux d'un test sont relevés et retirés à la fin.
 */

const { after, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const defaultItems = require('../../scripts/espace/fixtures/helloasso-items.json');
const { SESSION_COOKIE, sleep, useEspace } = require('../helpers/espace');
const { UID, createAttendee, createEdition, link } = require('../helpers/espace-data');
const W = require('../helpers/meetings-world');
const { makePng, postFile } = require('../helpers/png');
const { emailHash } = require('../../src/api/espace/lib/erase');

const ERASED_EMAIL = 'api::espace.erased-email';
const MESSAGE = 'api::espace.message';
const CONVERSATION = 'api::espace.conversation';
const REPORT = 'api::espace.message-report';
const FILE = 'plugin::upload.file';
const LEA = 'lea.ducasse@example.org';
const STRAPI_DIR = path.resolve(__dirname, '../..');
const CANCEL_REASON = 'Données supprimées à la demande du participant';
const MONTH_DAY = 86_400_000;

// Valeurs qui n'existent qu'ici : si l'une reparaît quelque part après l'effacement, la personne y est encore.
const SECRETS = {
  firstName: 'Léandre',
  lastName: 'Ducassoulet',
  company: 'Charpentes ZXQ-Pibal',
  jobTitle: 'Cheffe de projet ZXQ',
  bio: 'Présentation ZXQ-731 de Léandre.',
  linkedinUrl: 'https://www.linkedin.com/in/leandre-ducassoulet-zxq',
};
const SECRET_STRINGS = [SECRETS.firstName, SECRETS.lastName, SECRETS.company, SECRETS.jobTitle, 'ZXQ-731', 'ducassoulet-zxq', 'Ducassoulet', 'ducassoulet'];

const uploaded = new Set();
after(() => {
  for (const url of uploaded) for (const prefix of ['', 'thumbnail_', 'small_', 'medium_', 'large_']) fs.rmSync(path.join(STRAPI_DIR, 'public', `${prefix}${path.basename(url)}`), { force: true });
});

describe('effacement, export individuel et purge (V5-A : F-33, R-44, NF-12, NF-13)', { timeout: 900_000 }, () => {
  const espace = useEspace({ fake: true });
  const login = W.useLogin(espace);
  const api = W.useApi(espace);
  const app = () => espace().app;
  const privacy = () => app().service('api::espace.privacy');
  const secret = () => app().config.get('server.app.keys')[0];

  const newEdition = (options = {}) => W.createMeetingEdition(app(), { slug: W.unique('effacement'), title: 'Effacement', ...options });
  const person = (edition, fields = {}) => W.createPerson(app(), edition, fields);
  const row = (attendee) => app().documents(UID.attendee).findOne({ documentId: attendee.documentId, populate: { photo: true, topics: true, speaker: true, exhibitor: true } });
  const meeting = (documentId) => app().documents(UID.meeting).findOne({ documentId });
  const erase = (cookie, json = { confirm: true }) => api(cookie).post('/me/erase', json);
  const admin = (edition, suffix) => `/api/espace/admin/${edition.slug}${suffix}`;
  const flip = (edition, data) => espace().query(UID.edition).updateMany({ where: { documentId: edition.documentId }, data });
  const textOf = (response) => response.text ?? JSON.stringify(response.json);
  const assertNoSecret = (value, where) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    for (const secretValue of SECRET_STRINGS) assert.ok(!text.includes(secretValue), `« ${secretValue} » reste visible dans ${where}`);
  };
  const csvOf = (cookie, edition, name) => espace().request(admin(edition, `/export/${name}.csv`), { cookie });

  /** Léandre, riche de données, avec sa photo, ses sujets et sa carte de badge ; Mathis, son interlocuteur, avec les siennes. */
  let worlds = 0;
  async function world(options = {}) {
    const n = (worlds += 1); // 5 demandes de lien par adresse et par 15 minutes : une adresse par monde
    const base = await newEdition(options);
    const { edition } = base;
    const topic = await W.createTopic(app(), edition, 'Construction bois');
    const lea = await person(edition, {
      ...SECRETS,
      email: `ducassoulet.${n}@example.org`,
      linkedinUrl: SECRETS.linkedinUrl,
      topics: [link(topic)],
      hostedTableNumber: null,
    });
    const mathis = await person(edition, { firstName: 'Mathis', lastName: 'Lagrange', company: 'Lagrange Bois', jobTitle: 'Directeur MATHIS-FONCTION', bio: 'MATHIS-BIO-QQQ', linkedinUrl: 'https://www.linkedin.com/in/mathis-qqq', email: `mathis.${n}@example.org` });
    const hugo = await person(edition, { firstName: 'Hugo', lastName: 'Peyrat', company: 'Peyrat SAS', email: `hugo.${n}@example.org` });
    const organizer = await person(edition, { role: 'organizer', firstName: 'Orga', lastName: 'Nisatrice', email: `orga.${n}@example.org` });
    return { ...base, topic, lea, mathis, hugo, organizer, leaCookie: await login(edition, lea), mathisCookie: await login(edition, mathis), organizerCookie: await login(edition, organizer) };
  }

  /** Rendez-vous : à venir accepté (table 1) Léandre -> Mathis, à venir en attente Hugo -> Léandre, passé accepté Léandre <-> Mathis. */
  async function withMeetings(w) {
    const { edition, lea, mathis, hugo, slots } = w;
    const past = await app().documents(UID.slot).create({
      data: { edition: link(edition), session: link(w.sequences[2]), startsAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), endsAt: new Date(Date.now() - 3 * 3_600_000 + 900_000).toISOString(), label: 'passé' },
    });
    const upcoming = await W.seedMeeting(app(), { edition, slot: slots['10h45'], requester: lea, target: mathis, status: 'accepted', tableNumber: 1, message: 'Bonjour Mathis' });
    const pending = await W.seedMeeting(app(), { edition, slot: slots['11h00'], requester: hugo, target: lea, status: 'pending', message: 'Bonjour de la part de Hugo' });
    const done = await W.seedMeeting(app(), { edition, slot: past, requester: lea, target: mathis, status: 'accepted', tableNumber: 2, message: 'Déjà eu lieu' });
    return { ...w, past, upcoming, pending, done };
  }

  /** Conversation Léandre / Mathis avec un message de chacun. */
  async function withConversation(w) {
    const opened = await api(w.mathisCookie).post('/conversations', { with: `p:${w.lea.documentId}` });
    assert.ok([200, 201].includes(opened.status), opened.text);
    assert.equal((await api(w.mathisCookie).post(`/conversations/${opened.json.id}/messages`, { body: 'Bonjour Léandre, MESSAGE-DE-MATHIS' })).status, 201);
    assert.equal((await api(w.leaCookie).post(`/conversations/${opened.json.id}/messages`, { body: 'Bonjour Mathis, MESSAGE-DE-LEANDRE' })).status, 201);
    return { ...w, conversationId: opened.json.id };
  }

  describe('POST /me/erase : validation, réponse, session', () => {
    it('401 sans session', async () => {
      assert.equal((await espace().request('/api/espace/me/erase', { method: 'POST', json: { confirm: true } })).status, 401);
    });

    for (const [label, body] of [['sans corps', {}], ['confirm faux', { confirm: false }], ['confirm en texte', { confirm: 'true' }], ['confirm numérique', { confirm: 1 }]]) {
      it(`400 VALIDATION ${label} : le profil reste intact, la session reste ouverte`, async () => {
        const w = await world();
        const response = await erase(w.leaCookie, body);
        assert.equal(response.status, 400, response.text);
        assert.equal(response.json.error.code, 'VALIDATION');
        const after = await row(w.lea);
        assert.equal(after.firstName, SECRETS.firstName);
        assert.equal(after.status, 'active');
        assert.equal((await api(w.leaCookie).get('/me')).status, 200);
        assert.equal(await app().documents(ERASED_EMAIL).count({ filters: { edition: { documentId: w.edition.documentId } } }), 0, 'aucune empreinte sans confirmation');
      });
    }

    it('200 { erased: true }, cookie effacé, session close, reconnexion impossible', async () => {
      const w = await world();
      const since = espace().outbox().length;
      // Un lien de connexion déjà demandé avant l'effacement ne doit plus ouvrir de session.
      const asked = await espace().request('/api/espace/auth/request-link', { method: 'POST', json: { editionSlug: w.edition.slug, email: w.lea.email } });
      assert.equal(asked.status, 202);
      const oldMail = await espace().waitForMail((mail) => mail.to.email === w.lea.email, { since });
      const oldLink = espace().linkOf(oldMail);

      const response = await erase(w.leaCookie);
      assert.equal(response.status, 200, response.text);
      assert.deepEqual(response.json, { erased: true });
      const cleared = response.setCookies.find((line) => line.startsWith(`${SESSION_COOKIE}=`));
      assert.ok(cleared, 'le cookie de session est réécrit');
      assert.match(cleared, /(Max-Age=0|Expires=Thu, 01 Jan 1970)/i);

      assert.equal((await api(w.leaCookie).get('/me')).status, 401, 'l’ancien cookie ne passe plus');
      assert.notEqual((await espace().request('/api/espace/auth/verify', { method: 'POST', json: { token: oldLink.token } })).status, 200, 'l’ancien lien ne passe plus');
      assert.equal(await espace().query('api::espace.magic-token').count({ where: { attendee: { documentId: w.lea.documentId } } }), 0, 'aucun jeton ne reste');

      const mark = espace().outbox().length;
      assert.equal((await espace().request('/api/espace/auth/request-link', { method: 'POST', json: { editionSlug: w.edition.slug, email: w.lea.email } })).status, 202, 'réponse uniforme');
      assert.equal((await espace().request('/api/espace/auth/request-link', { method: 'POST', json: { editionSlug: w.edition.slug, email: (await row(w.lea)).email } })).status, 202);
      assert.deepEqual(await espace().mailsSince(mark, { to: [w.lea.email, (await row(w.lea)).email] }), [], 'aucun lien n’est envoyé à l’ancienne adresse ni à l’adresse technique');
    });

    it('anonymise la fiche : nom, entreprise, fonction, présentation, photo, LinkedIn, sujets, consentements, préférences, statut, e-mail technique', async () => {
      const w = await world();
      const uploadedPhoto = await postFile(espace(), '/api/espace/me/photo', { cookie: w.leaCookie, bytes: makePng(), filename: 'effacement-photo.png', type: 'image/png' });
      assert.equal(uploadedPhoto.status, 200, uploadedPhoto.text);
      uploaded.add(uploadedPhoto.json.photoUrl);
      const before = await row(w.lea);
      assert.ok(before.photo?.id, 'la photo existe avant l’effacement');
      const photoFile = path.join(STRAPI_DIR, 'public', before.photo.url);
      assert.ok(fs.existsSync(photoFile));

      assert.equal((await erase(w.leaCookie)).status, 200);

      const after = await row(w.lea);
      assert.equal(after.firstName, 'Participant');
      assert.equal(after.lastName, 'supprimé');
      assert.equal(after.email, `erased-${w.lea.documentId.toLowerCase()}@erased.invalid`);
      for (const field of ['company', 'jobTitle', 'bio', 'linkedinUrl']) assert.equal(after[field] ?? null, null, field);
      assert.equal(after.photo, null);
      assert.deepEqual(after.topics, []);
      assert.equal(after.directoryOptIn, false);
      assert.equal(after.meetingsOptIn, false);
      assert.equal(after.newsOptIn, false);
      assert.equal(after.status, 'cancelled');
      assert.ok(after.statusLockedAt, 'le statut est verrouillé');
      assert.deepEqual(after.emailPrefs, { meetingRequests: false, messages: false, reminders: false });
      assert.equal(after.helloassoItemId ?? null, null);
      assert.equal(after.cardTokenHash ?? null, null);
      assertNoSecret(after, 'la ligne de l’inscrit');
      assert.equal(await app().db.query(FILE).findOne({ where: { id: before.photo.id } }), null, 'le fichier de la photo est supprimé de la médiathèque');
      assert.ok(!fs.existsSync(photoFile), 'le fichier de la photo est supprimé du disque');
    });

    it('conserve une empreinte salée : sha256 de l’adresse en minuscules, sans l’adresse, une seule par adresse même si l’effacement est rejoué', async () => {
      const w = await world();
      assert.equal((await erase(w.leaCookie)).status, 200);
      assert.deepEqual(await privacy().erase(w.lea.documentId), { erased: true }, 'rejouer ne lève rien');
      const rows = await espace().query(ERASED_EMAIL).findMany({ where: { edition: { documentId: w.edition.documentId } } });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].emailHash, emailHash(w.lea.email.toUpperCase(), secret()));
      assert.match(rows[0].emailHash, /^[0-9a-f]{64}$/);
      assert.ok(rows[0].erasedAt);
      assertNoSecret(rows[0], 'l’empreinte');
      assert.ok(!JSON.stringify(rows[0]).includes('example.org'));
      assert.equal(await privacy().isErased(w.edition, w.lea.email), true);
      assert.equal(await privacy().isErased(w.edition, 'autre@example.org'), false);
      assert.equal((await privacy().erasedHashes(w.edition)).has(rows[0].emailHash), true);
    });

    it('l’empreinte est propre à l’édition : l’autre édition n’en sait rien', async () => {
      const w = await world();
      const other = await newEdition();
      assert.equal((await erase(w.leaCookie)).status, 200);
      assert.equal(await privacy().isErased(other.edition, w.lea.email), false);
      assert.equal((await privacy().erasedHashes(other.edition)).size, 0);
    });
  });

  describe('critère 1 : plus rien de la personne ailleurs', () => {
    it('annuaire, recherche, fiche, suggestions : rien (avec témoin avant l’effacement)', async () => {
      const edition = (await newEdition()).edition;
      const topic = await W.createTopic(app(), edition, 'Sujet commun');
      const lea = await person(edition, { ...SECRETS, email: `ducassoulet.v${(worlds += 1)}@example.org`, topics: [link(topic)] });
      const viewer = await person(edition, { firstName: 'Vera', lastName: 'Visiteuse', topics: [link(topic)] });
      await person(edition, { firstName: 'Tiers', lastName: 'Visible', topics: [link(topic)] });
      const viewerCookie = await login(edition, viewer);
      const leaCookie = await login(edition, lea);

      assert.ok(textOf(await api(viewerCookie).get('/directory')).includes(lea.documentId), 'témoin : visible dans l’annuaire avant');
      assert.equal((await api(viewerCookie).get(`/directory/p/${lea.documentId}`)).status, 200, 'témoin : fiche ouverte avant');
      assert.ok(textOf(await api(viewerCookie).get('/suggestions')).includes(lea.documentId), 'témoin : suggérée avant');

      assert.equal((await erase(leaCookie)).status, 200);

      const directory = await api(viewerCookie).get('/directory');
      assert.equal(directory.status, 200);
      assert.ok(!textOf(directory).includes(lea.documentId));
      assertNoSecret(directory.json, 'l’annuaire');
      for (const q of ['Ducassoulet', 'Léandre', 'ZXQ', 'Participant', 'supprimé']) {
        const found = await api(viewerCookie).get(`/directory?q=${encodeURIComponent(q)}`);
        assert.ok(!textOf(found).includes(lea.documentId), `recherche « ${q} »`);
      }
      assert.equal((await api(viewerCookie).get(`/directory/p/${lea.documentId}`)).status, 404, 'la fiche n’existe plus');
      for (let i = 0; i < 3; i += 1) {
        const suggestions = await api(viewerCookie).get('/suggestions');
        assert.ok(!textOf(suggestions).includes(lea.documentId));
        assertNoSecret(suggestions.json, 'les suggestions');
      }
    });

    it('exports du pilotage, liste et fiche d’inscrit : plus rien de la personne ; la fiche porte l’état anonymisé', async () => {
      const w = await withMeetings(await world());
      assert.ok((await csvOf(w.organizerCookie, w.edition, 'participants')).text.includes('Ducassoulet'), 'témoin avant');
      assert.ok((await csvOf(w.organizerCookie, w.edition, 'meetings')).text.includes('Ducassoulet'), 'témoin avant (rendez-vous)');

      assert.equal((await erase(w.leaCookie)).status, 200);

      for (const name of ['participants', 'meetings', 'exhibitors', 'stats']) {
        const file = await csvOf(w.organizerCookie, w.edition, name);
        assert.equal(file.status, 200, name);
        assertNoSecret(file.text, `${name}.csv`);
      }
      const list = await espace().request(`${admin(w.edition, '/attendees')}?q=Ducassoulet`, { cookie: w.organizerCookie });
      assert.equal(list.status, 200);
      assertNoSecret(list.json, 'la liste des inscrits');
      const everyone = await espace().request(admin(w.edition, '/attendees'), { cookie: w.organizerCookie });
      assertNoSecret(everyone.json, 'la liste complète des inscrits');
      const sheet = await espace().request(admin(w.edition, `/attendees/${w.lea.documentId}`), { cookie: w.organizerCookie });
      assert.equal(sheet.status, 200);
      assertNoSecret(sheet.json, 'la fiche');
      assert.equal(sheet.json.firstName, 'Participant');
      assert.equal(sheet.json.lastName, 'supprimé');
      assert.equal(sheet.json.status, 'cancelled');
      assert.equal(sheet.json.email, `erased-${w.lea.documentId.toLowerCase()}@erased.invalid`);
    });

    it('carte de badge : l’ancien jeton répond 404 CARD_NOT_FOUND', async () => {
      const w = await world();
      const { token } = await app().service('api::espace.badges').ensureToken(w.lea);
      const card = (ip) => espace().request(`/api/espace/cards/${w.edition.slug}/${token}`, { ip });
      assert.equal((await card()).status, 200, 'témoin avant');
      assert.equal((await erase(w.leaCookie)).status, 200);
      const refused = await card();
      assert.equal(refused.status, 404);
      assert.equal(refused.json.error.code, 'CARD_NOT_FOUND');
      assertNoSecret(refused.text, 'la carte');
    });

    it('messages : gardés chez l’interlocuteur sous « Participant supprimé », sans rien de la personne', async () => {
      const w = await withConversation(await world());
      assert.equal((await erase(w.leaCookie)).status, 200);

      const list = await api(w.mathisCookie).get('/conversations');
      assert.equal(list.status, 200);
      assert.equal(list.json.length, 1, 'la conversation reste');
      assert.equal(list.json[0].counterpart.displayName, 'Participant supprimé');
      assertNoSecret(list.json, 'la liste des conversations');

      const thread = await api(w.mathisCookie).get(`/conversations/${w.conversationId}/messages`);
      assert.equal(thread.status, 200);
      assert.equal(thread.json.conversation.counterpart.displayName, 'Participant supprimé');
      assert.equal(thread.json.conversation.counterpartGetsEmail, false, 'plus d’e-mail vers la personne effacée');
      assert.deepEqual(thread.json.messages.map(({ body, mine }) => [body, mine]), [['Bonjour Léandre, MESSAGE-DE-MATHIS', true], ['Bonjour Mathis, MESSAGE-DE-LEANDRE', false]], 'les deux messages restent, l’autre sous son nom anonymisé');
      assertNoSecret(thread.json.conversation, 'l’en-tête du fil');
      assert.equal(await app().documents(MESSAGE).count({ filters: { conversation: { documentId: w.conversationId } } }), 2);
    });
  });

  describe('critère 2 : rendez-vous', () => {
    it('à venir annulés (motif, table libérée), passés intacts, interlocuteurs notifiés sous « Participant supprimé »', async () => {
      const w = await withMeetings(await world());
      const since = espace().outbox().length;
      assert.equal((await erase(w.leaCookie)).status, 200);

      for (const item of [w.upcoming, w.pending]) {
        const after = await meeting(item.documentId);
        assert.equal(after.status, 'cancelled', item.documentId);
        assert.equal(after.cancelReason, CANCEL_REASON);
        assert.equal(after.tableKey ?? null, null, 'table libérée');
        assert.ok(after.cancelledAt);
      }
      const done = await meeting(w.done.documentId);
      assert.equal(done.status, 'accepted', 'un rendez-vous passé reste tel quel');
      assert.equal(done.tableNumber, 2);
      assert.ok(done.tableKey, 'sa table reste prise');
      assert.equal(done.cancelReason ?? null, null);

      const mails = await espace().mailsSince(since, { to: [w.mathis.email, w.hugo.email] });
      const cancelled = mails.filter((mail) => /annul/i.test(mail.subject));
      assert.deepEqual(cancelled.map((mail) => mail.to.email).sort(), [w.hugo.email, w.mathis.email].sort(), 'une notification par interlocuteur, aucune pour le rendez-vous passé');
      for (const mail of cancelled) {
        assert.ok(mail.text.includes('Participant supprimé'), mail.text);
        assertNoSecret(mail.text, 'l’e-mail d’annulation');
        assertNoSecret(mail.subject, 'l’objet de l’e-mail d’annulation');
      }
      const logs = await W.emailLogs(app(), w.mathis, 'meeting-cancelled');
      assert.equal(logs.length, 1, 'le journal d’e-mails a une ligne pour l’annulation (le rendez-vous passé n’en fait pas)');
    });

    it('la table libérée est de nouveau attribuable ; la vue de l’interlocuteur montre « Participant supprimé » et le motif', async () => {
      const w = await withMeetings(await world());
      assert.equal((await erase(w.leaCookie)).status, 200);
      const occupied = await app().documents(UID.meeting).count({ filters: { edition: { documentId: w.edition.documentId }, status: 'accepted', slot: { documentId: w.slots['10h45'].documentId }, tableKey: { $notNull: true } } });
      assert.equal(occupied, 0);
      const seen = await api(w.mathisCookie).get('/meetings');
      assert.equal(seen.status, 200);
      assertNoSecret(seen.json, 'les rendez-vous de l’interlocuteur');
      assert.ok(textOf(seen).includes('Participant supprimé'));
    });

    it('un second effacement n’annule rien de plus et n’envoie aucun e-mail', async () => {
      const w = await withMeetings(await world());
      assert.equal((await erase(w.leaCookie)).status, 200);
      await sleep(500);
      const since = espace().outbox().length;
      assert.deepEqual(await privacy().erase(w.lea.documentId), { erased: true });
      assert.deepEqual(await espace().mailsSince(since, { to: [w.mathis.email, w.hugo.email] }), []);
    });
  });

  describe('critère 3 : la synchronisation ne la réimporte pas', () => {
    const run = (edition, options) => app().service('api::espace.sync').run(edition.documentId, options);
    const attendeesOf = (edition) => app().documents(UID.attendee).findMany({ filters: { edition: { documentId: edition.documentId } }, limit: 1000 });

    it('dix synchronisations : une seule ligne anonymisée, aucune adresse d’origine, ERASED signalé comme une information', async () => {
      espace().fake.setItems(defaultItems);
      const edition = await createEdition(app(), { slug: W.unique('effacement-sync'), title: 'Effacement synchro' });
      await run(edition);
      await sleep(300);
      const lea = (await attendeesOf(edition)).find(({ email }) => email === LEA);
      assert.ok(lea, 'Léa est importée');
      const count = (await attendeesOf(edition)).length;
      const { cookie } = await espace().signIn(edition.slug, LEA);
      assert.equal((await erase(cookie)).status, 200);

      let reported;
      for (let i = 0; i < 10; i += 1) {
        const result = await run(edition);
        reported ??= result.errors.find(({ code }) => code === 'ERASED');
      }
      assert.ok(reported, 'le billet est signalé ERASED');
      assert.equal(String(reported.itemId), '100001');
      const after = await attendeesOf(edition);
      assert.equal(after.length, count, 'aucune ligne en plus');
      assert.ok(!after.some(({ email }) => email.toLowerCase() === LEA), 'l’adresse n’est jamais revenue');
      const erased = after.find(({ documentId }) => documentId === lea.documentId);
      assert.equal(erased.firstName, 'Participant');
      assert.equal(erased.status, 'cancelled');
      assert.equal(erased.company ?? null, null);
      assert.equal(after.filter(({ status }) => status === 'active').length, count - 1);
    });

    it('la correspondance ignore la casse et les espaces de l’adresse du billet', async () => {
      espace().fake.setItems(defaultItems);
      const edition = await createEdition(app(), { slug: W.unique('effacement-casse'), title: 'Effacement casse' });
      await run(edition);
      await sleep(300);
      const { cookie } = await espace().signIn(edition.slug, LEA);
      assert.equal((await erase(cookie)).status, 200);
      const shouted = structuredClone(defaultItems).map((item) => {
        if (item.id !== 100001) return item;
        for (const field of item.customFields) if (field.name === 'Email') field.answer = ' LEA.Ducasse@Example.ORG ';
        return item;
      });
      espace().fake.setItems(shouted);
      const result = await run(edition);
      assert.ok(result.errors.some(({ code }) => code === 'ERASED'));
      assert.ok(!(await attendeesOf(edition)).some(({ email }) => email.toLowerCase().includes('lea.ducasse')));
    });

    it('un billet d’une autre adresse reste importé ; la même adresse dans une autre édition l’est aussi', async () => {
      espace().fake.setItems(defaultItems);
      const first = await createEdition(app(), { slug: W.unique('effacement-un'), title: 'Un' });
      const second = await createEdition(app(), { slug: W.unique('effacement-deux'), title: 'Deux' });
      await run(first);
      await sleep(300);
      const { cookie } = await espace().signIn(first.slug, LEA);
      assert.equal((await erase(cookie)).status, 200);
      await run(first);
      await run(second);
      await sleep(300);
      assert.ok((await attendeesOf(first)).some(({ email }) => email === 'mathis.lagrange@example.org'), 'les autres billets continuent d’être importés');
      assert.ok((await attendeesOf(second)).some(({ email }) => email === LEA), 'l’empreinte est propre à l’édition');
    });
  });

  describe('critère 4 : export individuel (NF-12)', () => {
    it('401 sans session', async () => {
      assert.equal((await espace().request('/api/espace/me/export')).status, 401);
    });

    it('JSON en pièce jointe ; exportedAt, edition, profile, preferences, meetings, messages ; données de la personne', async () => {
      const w = await withConversation(await withMeetings(await world()));
      const response = await api(w.leaCookie).get('/me/export');
      assert.equal(response.status, 200, response.text);
      assert.match(response.headers.get('content-type'), /application\/json/);
      assert.match(response.headers.get('content-disposition'), new RegExp(`^attachment; filename="mes-donnees-${w.edition.slug}\\.json"$`));
      assert.match(response.headers.get('cache-control'), /no-store/);

      const data = response.json;
      assert.deepEqual(Object.keys(data), ['exportedAt', 'edition', 'profile', 'preferences', 'meetings', 'messages']);
      assert.equal(new Date(data.exportedAt).toISOString(), data.exportedAt);
      assert.deepEqual(data.edition, { slug: w.edition.slug, title: w.edition.title });
      assert.equal(data.profile.firstName, SECRETS.firstName);
      assert.equal(data.profile.email, w.lea.email);
      assert.equal(data.profile.company, SECRETS.company);
      assert.equal(data.profile.bio, SECRETS.bio);
      assert.deepEqual(data.profile.topics, ['Construction bois']);
      assert.equal(data.preferences.directoryOptIn, true);
      assert.equal(data.preferences.meetingsOptIn, true);
      assert.deepEqual(data.preferences.emailPrefs, { meetingRequests: true, messages: true, reminders: true });

      assert.equal(data.meetings.length, 3, 'tous les rendez-vous, passés et annulés compris');
      const sent = data.meetings.find(({ id }) => id === w.upcoming.documentId);
      assert.equal(sent.direction, 'sent');
      assert.equal(sent.status, 'accepted');
      assert.equal(sent.tableNumber, 1);
      assert.equal(sent.message, 'Bonjour Mathis');
      assert.equal(sent.slot.label, '10h45');
      assert.deepEqual(sent.counterpart, { firstName: 'Mathis', lastName: 'Lagrange', company: 'Lagrange Bois' });
      const received = data.meetings.find(({ id }) => id === w.pending.documentId);
      assert.equal(received.direction, 'received');
      assert.deepEqual(received.counterpart, { firstName: 'Hugo', lastName: 'Peyrat', company: 'Peyrat SAS' });

      assert.equal(data.messages.length, 1, 'seulement les messages envoyés par la personne');
      assert.equal(data.messages[0].body, 'Bonjour Mathis, MESSAGE-DE-LEANDRE');
      assert.deepEqual(data.messages[0].counterpart, { firstName: 'Mathis', lastName: 'Lagrange', company: 'Lagrange Bois' });
    });

    it('rien d’un tiers hors prénom, nom et entreprise de ses interlocuteurs', async () => {
      const w = await withConversation(await withMeetings(await world()));
      const outsider = await person(w.edition, { firstName: 'Etienne', lastName: 'Etranger', company: 'Sans Lien SA', email: `etienne.${Date.now()}@example.org` });
      const response = await api(w.leaCookie).get('/me/export');
      const sections = JSON.stringify({ meetings: response.json.meetings, messages: response.json.messages });
      for (const hidden of [
        w.mathis.email, w.hugo.email, 'MATHIS-FONCTION', 'MATHIS-BIO-QQQ', 'mathis-qqq', 'MESSAGE-DE-MATHIS',
        'Bonjour de la part de Hugo', w.mathis.documentId, w.hugo.documentId, 'helloasso', 'cardToken', outsider.lastName, w.organizer.email,
      ]) {
        assert.ok(!sections.includes(hidden), `« ${hidden} » ne doit pas sortir de l’export`);
      }
      assert.ok(!response.text.includes(outsider.email));
      assert.ok(!/"(?:cardTokenHash|helloassoItemId|helloassoOrderId|statusLockedAt|editedFields)"/.test(response.text), 'aucun champ interne');
      for (const entry of [...response.json.meetings.map(({ counterpart }) => counterpart), ...response.json.messages.map(({ counterpart }) => counterpart)]) {
        assert.ok(Object.keys(entry).every((key) => ['firstName', 'lastName', 'company', 'exhibitor'].includes(key)), JSON.stringify(entry));
      }
    });

    it('un inscrit sans rien : listes vides ; l’export de l’interlocuteur ne contient rien de l’autre', async () => {
      const w = await world();
      const response = await api(await login(w.edition, w.hugo)).get('/me/export');
      assert.equal(response.status, 200);
      assert.deepEqual([response.json.meetings, response.json.messages], [[], []]);
      assertNoSecret(response.json, 'l’export d’un autre participant');
    });

    it('après l’effacement la session est close : plus d’export', async () => {
      const w = await world();
      assert.equal((await erase(w.leaCookie)).status, 200);
      assert.equal((await api(w.leaCookie).get('/me/export')).status, 401);
    });
  });

  describe('effacement par le pilotage (« Anonymiser », F-33)', () => {
    const post = (edition, id, cookie) => espace().request(admin(edition, `/attendees/${id}/erase`), { method: 'POST', cookie, json: {} });

    it('200 avec la fiche anonymisée ; rendez-vous à venir annulés, interlocuteurs prévenus, session de la personne close, empreinte posée', async () => {
      const w = await withMeetings(await world());
      const since = espace().outbox().length;
      const response = await post(w.edition, w.lea.documentId, w.organizerCookie);
      assert.equal(response.status, 200, response.text);
      assert.equal(response.json.firstName, 'Participant');
      assert.equal(response.json.lastName, 'supprimé');
      assert.equal(response.json.status, 'cancelled');
      assertNoSecret(response.json, 'la fiche rendue');

      assert.equal((await meeting(w.upcoming.documentId)).status, 'cancelled');
      assert.equal((await meeting(w.pending.documentId)).status, 'cancelled');
      assert.equal((await meeting(w.done.documentId)).status, 'accepted');
      const mails = (await espace().mailsSince(since, { to: [w.mathis.email, w.hugo.email] })).filter((mail) => /annul/i.test(mail.subject));
      assert.equal(mails.length, 2);
      assert.ok(mails.every((mail) => mail.text.includes('Participant supprimé')));
      assert.equal((await api(w.leaCookie).get('/me')).status, 401, 'la session de la personne est fermée');
      assert.equal(await privacy().isErased(w.edition, w.lea.email), true);
    });

    it('409 SELF_FORBIDDEN pour l’organisateur sur lui-même : rien ne change', async () => {
      const w = await world();
      const response = await post(w.edition, w.organizer.documentId, w.organizerCookie);
      assert.equal(response.status, 409);
      assert.equal(response.json.error.code, 'SELF_FORBIDDEN');
      const after = await row(w.organizer);
      assert.equal(after.firstName, 'Orga');
      assert.equal(after.status, 'active');
      assert.equal((await api(w.organizerCookie).get('/me')).status, 200);
    });

    it('403 pour un participant et pour l’organisateur d’une autre édition, 401 sans session, 404 pour un inconnu ou un inscrit d’une autre édition ; rien n’est effacé', async () => {
      const w = await world();
      const other = await newEdition();
      const stranger = await person(other.edition, { role: 'organizer' });
      const strangerCookie = await login(other.edition, stranger);
      const foreign = await person(other.edition, { firstName: 'Autre', lastName: 'Edition' });

      assert.equal((await post(w.edition, w.lea.documentId, w.mathisCookie)).status, 403);
      assert.equal((await post(w.edition, w.lea.documentId, strangerCookie)).status, 403);
      assert.equal((await post(w.edition, w.lea.documentId, undefined)).status, 401);
      assert.equal((await post(w.edition, 'inconnu0000', w.organizerCookie)).status, 404);
      const crossed = await post(w.edition, foreign.documentId, w.organizerCookie);
      assert.equal(crossed.status, 404);
      assert.equal((await row(foreign)).firstName, 'Autre', 'un inscrit d’une autre édition n’est pas touché');
      assert.equal((await row(w.lea)).firstName, SECRETS.firstName);
      assert.equal(await app().documents(ERASED_EMAIL).count({ filters: { edition: { documentId: w.edition.documentId } } }), 0);
    });

    it('rejouée : 200 de nouveau, une seule empreinte', async () => {
      const w = await world();
      assert.equal((await post(w.edition, w.lea.documentId, w.organizerCookie)).status, 200);
      assert.equal((await post(w.edition, w.lea.documentId, w.organizerCookie)).status, 200);
      assert.equal(await app().documents(ERASED_EMAIL).count({ filters: { edition: { documentId: w.edition.documentId } } }), 1);
    });
  });

  describe('exemptions : lecture seule et espace fermé', () => {
    it('lecture seule (readOnlyAt passé) : l’effacement et l’export passent, une autre écriture répond 409 EDITION_READ_ONLY', async () => {
      const w = await withMeetings(await world());
      await flip(w.edition, { readOnlyAt: '2020-01-01T00:00:00.000Z' });
      const control = await api(w.mathisCookie).patch('/me', { firstName: 'Mathis' });
      assert.equal(control.status, 409);
      assert.equal(control.json.error.code, 'EDITION_READ_ONLY');

      const exported = await api(w.leaCookie).get('/me/export');
      assert.equal(exported.status, 200);
      assert.equal(exported.json.profile.firstName, SECRETS.firstName);
      const erased = await erase(w.leaCookie);
      assert.equal(erased.status, 200, erased.text);
      assert.deepEqual(erased.json, { erased: true });
      assert.equal((await row(w.lea)).firstName, 'Participant');
    });


    it('espace fermé (participantSpaceEnabled faux) : l’effacement et l’export du participant passent ; rien n’est envoyé (NF-52), les rendez-vous sont annulés', async () => {
      const w = await withMeetings(await world());
      await flip(w.edition, { participantSpaceEnabled: false });
      const since = espace().outbox().length;
      const exported = await api(w.leaCookie).get('/me/export');
      assert.equal(exported.status, 200, exported.text);
      assert.equal(exported.json.profile.email, w.lea.email);
      const erased = await erase(w.leaCookie);
      assert.equal(erased.status, 200, erased.text);
      assert.deepEqual(erased.json, { erased: true });

      assert.equal((await row(w.lea)).status, 'cancelled');
      assert.equal((await meeting(w.upcoming.documentId)).status, 'cancelled');
      assert.deepEqual(await espace().mailsSince(since, { to: [w.mathis.email, w.hugo.email] }), []);
    });

    it('espace fermé : l’organisateur exporte et efface ses propres données, et anonymise un inscrit depuis le pilotage ; rien n’est envoyé (NF-52), les rendez-vous à venir sont annulés', async () => {
      const w = await withMeetings(await world());
      await flip(w.edition, { participantSpaceEnabled: false });
      const since = espace().outbox().length;
      const anonymized = await espace().request(admin(w.edition, `/attendees/${w.lea.documentId}/erase`), { method: 'POST', cookie: w.organizerCookie, json: {} });
      assert.equal(anonymized.status, 200, anonymized.text);
      assert.equal((await row(w.lea)).status, 'cancelled');
      assert.equal((await meeting(w.upcoming.documentId)).status, 'cancelled');
      assert.equal((await meeting(w.done.documentId)).status, 'accepted');
      assert.deepEqual(await espace().mailsSince(since, { to: [w.mathis.email, w.hugo.email] }), [], 'espace fermé : aucun e-mail');

      assert.equal((await api(w.organizerCookie).get('/me/export')).status, 200);
      assert.equal((await api(w.organizerCookie).get('/directory')).status, 403, 'témoin : le reste de l’espace est fermé à l’organisateur');
      assert.equal((await erase(w.organizerCookie)).status, 200);
      assert.equal((await row(w.organizer)).firstName, 'Participant');
    });

    it('lecture seule et espace fermé à la fois (participant)', async () => {
      const w = await world();
      await flip(w.edition, { readOnlyAt: '2020-01-01T00:00:00.000Z', participantSpaceEnabled: false });
      assert.equal((await api(w.leaCookie).get('/me/export')).status, 200);
      assert.equal((await erase(w.leaCookie)).status, 200);
    });
  });

  describe('critère 5 : purge (NF-13, R-44)', () => {
    const OLD_DATE = '2025-12-03';
    const AFTER = new Date('2026-12-04T04:00:00.000Z'); // date + 12 mois et un jour
    const count = (uid, filters = {}) => app().documents(uid).count({ filters });
    const rows = (uid, where) => espace().query(uid).findMany({ where });
    const inEdition = (edition) => ({ edition: { documentId: edition.documentId } });

    /** Édition du 3 décembre 2025 pleine de données personnelles, et une édition récente intacte. */
    async function populated() {
      const old = await newEdition({ settings: { date: OLD_DATE } });
      const recent = await newEdition({ daysAhead: 20 });
      const out = { old, recent };
      for (const [key, world] of Object.entries({ old, recent })) {
        const a = await person(world.edition, { firstName: 'Alice', lastName: `Purge${key}` });
        const b = await person(world.edition, { firstName: 'Bruno', lastName: `Purge${key}` });
        const cookie = await login(world.edition, a);
        const m = await W.seedMeeting(app(), { edition: world.edition, slot: world.slots['10h45'], requester: a, target: b, status: 'accepted', tableNumber: 1 });
        const conversation = await app().documents(CONVERSATION).create({ data: { edition: link(world.edition), participants: [a, b].map(link) } });
        const message = await app().documents(MESSAGE).create({ data: { conversation: link(conversation), author: link(a), body: 'Message à purger' } });
        const report = await app().documents(REPORT).create({ data: { edition: link(world.edition), message: link(message), author: link(b), reason: 'Motif', status: 'open' } });
        await app().documents(ERASED_EMAIL).create({ data: { edition: link(world.edition), emailHash: `${'a'.repeat(63)}${key === 'old' ? '1' : '2'}`, erasedAt: new Date() } });
        await app().documents(UID.emailLog).create({ data: { attendee: link(a), template: 'welcome', status: 'sent', sentAt: new Date() } });
        out[key] = { ...world, a, b, cookie, meeting: m, conversation, message, report };
      }
      return out;
    }

    const snapshot = async (edition) => ({
      attendees: await count(UID.attendee, inEdition(edition)),
      meetings: await count(UID.meeting, inEdition(edition)),
      conversations: await count(CONVERSATION, inEdition(edition)),
      messages: await count(MESSAGE, { conversation: inEdition(edition) }),
      reports: await count(REPORT, inEdition(edition)),
      erased: await count(ERASED_EMAIL, inEdition(edition)),
      tokens: (await rows('api::espace.magic-token', { attendee: inEdition(edition) })).length,
      emailLogs: (await rows(UID.emailLog, { attendee: inEdition(edition) })).length,
      sequences: await app().documents(UID.sequence).count({ filters: inEdition(edition), status: 'published' }),
    });

    it('à date + 12 mois et un jour : l’espace de l’édition est vidé (participants, rendez-vous, conversations, messages, signalements, jetons, journaux d’e-mails, empreintes), le programme et l’édition restent', async () => {
      const { old, recent } = await populated();
      const before = await snapshot(old.edition);
      assert.ok(Object.values(before).every((value) => value > 0), `témoin avant : ${JSON.stringify(before)}`);
      const recentBefore = await snapshot(recent.edition);

      const result = await privacy().purge({ now: AFTER });
      assert.deepEqual(result.editions, [old.edition.slug]);

      const after = await snapshot(old.edition);
      assert.deepEqual({ ...after, sequences: undefined }, { attendees: 0, meetings: 0, conversations: 0, messages: 0, reports: 0, erased: 0, tokens: 0, emailLogs: 0, sequences: undefined });
      assert.equal(after.sequences, before.sequences, 'le programme est gardé');
      assert.ok(await app().documents(UID.edition).findOne({ documentId: old.edition.documentId, status: 'published' }), 'l’édition est gardée, publiée');
      assert.deepEqual(await snapshot(recent.edition), recentBefore, 'une édition récente n’est pas touchée');
      assert.equal((await api(old.cookie).get('/me')).status, 401, 'les sessions disparaissent avec les jetons');
    });

    it('idempotente : une seconde exécution ne fait rien', async () => {
      const { old } = await populated();
      const first = await privacy().purge({ now: AFTER });
      assert.deepEqual(first.editions, [old.edition.slug]);
      const state = await snapshot(old.edition);
      const second = await privacy().purge({ now: AFTER });
      assert.deepEqual(second.editions, []);
      assert.equal(second.logs.emailLogs, 0);
      assert.equal(second.logs.syncRuns, 0);
      assert.deepEqual(await snapshot(old.edition), state);
    });

    it('jamais avant l’échéance : à date + 12 mois pile (minuit UTC), rien n’est purgé', async () => {
      const { old } = await populated();
      const before = await snapshot(old.edition);
      const result = await privacy().purge({ now: new Date('2026-12-03T00:00:00.000Z') });
      assert.deepEqual(result.editions, []);
      assert.deepEqual(await snapshot(old.edition), before);
    });

    it('journaux : EmailLog et SyncRun de plus de 12 mois supprimés, les autres gardés', async () => {
      const w = await newEdition();
      const attendee = await person(w.edition);
      const now = new Date('2026-12-04T04:00:00.000Z');
      const ago = (days) => new Date(now.getTime() - days * MONTH_DAY);
      const mkLog = (createdAt) => espace().query(UID.emailLog).create({ data: { attendee: attendee.id, template: 'welcome', status: 'sent', createdAt } });
      const mkRun = (startedAt) => app().documents(UID.syncRun).create({ data: { edition: link(w.edition), startedAt } });
      const [oldLog, freshLog] = [await mkLog(ago(400)), await mkLog(ago(300))];
      const [oldRun, freshRun] = [await mkRun(ago(400)), await mkRun(ago(300))];
      assert.equal(new Date((await espace().query(UID.emailLog).findOne({ where: { id: oldLog.id } })).createdAt).getTime(), ago(400).getTime(), 'la date d’origine est posée');

      const result = await privacy().purge({ now });
      assert.ok(result.logs.emailLogs >= 1);
      assert.ok(result.logs.syncRuns >= 1);
      assert.equal(await espace().query(UID.emailLog).findOne({ where: { id: oldLog.id } }), null);
      assert.ok(await espace().query(UID.emailLog).findOne({ where: { id: freshLog.id } }));
      assert.equal(await app().documents(UID.syncRun).findOne({ documentId: oldRun.documentId }), null);
      assert.ok(await app().documents(UID.syncRun).findOne({ documentId: freshRun.documentId }));
      assert.ok(await row(attendee), 'le participant d’une édition récente reste');
    });

    it('une édition sans date n’est jamais purgée', async () => {
      const w = await newEdition();
      await person(w.edition);
      await espace().query(UID.edition).updateMany({ where: { documentId: w.edition.documentId }, data: { date: null } });
      const result = await privacy().purge({ now: new Date('2040-01-01T00:00:00.000Z') });
      assert.ok(!result.editions.includes(w.edition.slug));
      assert.equal(await count(UID.attendee, inEdition(w.edition)), 1);
    });

    it('la tâche espacePurge appelle le service réel sans erreur', async () => {
      const { espacePurge } = require('../../config/cron-tasks');
      await assert.doesNotReject(espacePurge.task({ strapi: app() }));
    });
  });
});
