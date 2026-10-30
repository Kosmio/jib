'use strict';

/**
 * Seed de recette (A-13, B3, 10-recette.md) exécuté pour de bon sur la base de test (TEST_DATABASE, défaut strapi_test), dans un sous-processus,
 * comme `pnpm seed` : base vide, premier passage, données étrangères ajoutées, second passage.
 *
 * Preuves recherchées : le seed crée exactement les données de recette ; deux passages donnent le même
 * état (idempotence) ; il n'efface que les données de recette ; sur une base vide il ne crée aucune édition
 * de démonstration ni image (DEMO_SEED=false imposé).
 *
 * Phase 1 (lot 3, tests d'abord) : les types de l'espace, lus dans les mêmes démarrages (section 4.4 du plan) :
 *   - lot 2 : réglages de l'édition, 5 Topic, `kind` des 9 séquences et rattachement aux thèmes, 2 Exhibitor, 10 Slot ;
 *   - lot 4 : 17 Attendee issus des billets du faux HelloAsso, réglages de `recette.json`, 17 EmailLog `welcome`.
 * La lecture de ces types ne fait pas échouer le `before` tant que les modèles manquent : l'erreur est gardée et relancée
 * par chaque test d'abord.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { buildTestEnv, STRAPI_DIR, testDatabaseName } = require('../helpers/env');
const { queryDatabase, resetDatabase } = require('../helpers/database');
const { startStrapi } = require('../helpers/strapi');
const recette = require('../../scripts/espace/fixtures/recette.json');
const helloassoItems = require('../../scripts/espace/fixtures/helloasso-items.json');

const DATABASE = testDatabaseName();
const SEED = path.join(STRAPI_DIR, 'scripts/espace/seed.js');
const NO_NETWORK = path.join(STRAPI_DIR, 'tests/helpers/no-network.js');

/** `pnpm seed` : sous-processus, environnement de test, réseau interdit. */
function runSeed() {
  const env = { ...buildTestEnv({ database: DATABASE }), NODE_OPTIONS: `--require=${NO_NETWORK}` };
  const started = Date.now();
  const result = spawnSync(process.execPath, [SEED], { cwd: STRAPI_DIR, env, encoding: 'utf8', timeout: 120_000 });
  return { ...result, durationMs: Date.now() - started };
}

/** Lecture des données publiées comme le fait le site (status published), sans identifiants ni dates. */
async function readState(app) {
  const published = (uid, options = {}) => app.documents(uid).findMany({ status: 'published', limit: 1000, ...options });
  const editions = await published('api::edition.edition', {
    populate: { lieux: true, sequences: { populate: { interventions: { populate: ['intervenants'] } } } },
  });
  const organisations = await published('api::organisation.organisation', { sort: 'slug:asc' });
  const intervenants = await published('api::intervenant.intervenant', { sort: 'slug:asc', populate: ['organisation'] });
  const strip = (({ id, documentId, createdAt, updatedAt, publishedAt, ...rest }) => rest);

  return {
    editions: editions.map((edition) => ({
      ...strip(edition),
      lieux: edition.lieux.map(strip),
      sequences: [...edition.sequences]
        .sort((a, b) => a.order - b.order)
        .map((sequence) => ({
          title: sequence.title,
          start_time: sequence.start_time,
          end_time: sequence.end_time,
          order: sequence.order,
          interventions: sequence.interventions.map((i) => i.intervenants.map((v) => v.slug)),
        })),
    })),
    organisations: organisations.map(strip),
    intervenants: intervenants.map((i) => ({ ...strip(i), organisation: i.organisation?.slug })),
  };
}

const ESPACE = {
  edition: 'api::edition.edition',
  sequence: 'api::sequence.sequence',
  topic: 'api::espace.topic',
  slot: 'api::espace.slot',
  exhibitor: 'api::espace.exhibitor',
  attendee: 'api::espace.attendee',
  emailLog: 'api::espace.email-log',
  meeting: 'api::espace.meeting',
  conversation: 'api::espace.conversation',
  message: 'api::espace.message',
};
// Tri en JavaScript (ordre des unités de code), identique pour l'état lu et l'état attendu : pas de dépendance à la collation de Postgres.
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const SETTINGS = ['participantSpaceEnabled', 'helloassoOrgSlug', 'helloassoFormType', 'helloassoFormSlug', 'helloassoFieldMap', 'slotDurationMinutes', 'tablesCount', 'meetingRequestsOpenAt', 'meetingRequestsCloseAt'];

/** Données de l'espace de l'édition de recette, sans identifiants ni dates de création : comparables d'un passage à l'autre. */
async function readEspace(app) {
  const edition = await app.documents(ESPACE.edition).findFirst({ filters: { slug: recette.edition.slug }, status: 'published' });
  const filters = { edition: { documentId: edition.documentId } };
  const many = (uid, options = {}) => app.documents(uid).findMany({ filters, limit: 1000, ...options });
  const iso = (value) => (value ? new Date(value).toISOString() : null);
  const names = (list = []) => list.map((entry) => entry.name ?? entry.title ?? entry.slug).sort();

  const sequences = await many(ESPACE.sequence, { status: 'published', sort: 'order:asc' });
  const topics = await many(ESPACE.topic, { populate: ['sessions'], sort: 'name:asc' });
  const slots = await many(ESPACE.slot, { populate: ['session'], sort: 'startsAt:asc' });
  const exhibitors = await many(ESPACE.exhibitor, { populate: ['organisation', 'topics', 'representatives'] });
  const attendees = await many(ESPACE.attendee, { populate: ['speaker', 'exhibitor', 'topics'] });
  const logs = await app.db.query(ESPACE.emailLog).findMany({ where: { attendee: { edition: { documentId: edition.documentId } } }, populate: ['attendee'] });
  // Lot 12 : rendez-vous, conversations et messages. `tableKey` contient l'identifiant du créneau, qui peut changer d'un passage à l'autre :
  // on garde « conforme » quand il vaut {créneau}:{table} (A-27), sinon la valeur trouvée.
  const meetingRows = await many(ESPACE.meeting, { populate: ['slot', 'requester', 'targetAttendee', 'targetExhibitor', 'answeredBy'] });
  const conversationRows = await many(ESPACE.conversation, { populate: ['participants'] });
  const messageRows = await app.documents(ESPACE.message).findMany({
    filters: { conversation: { edition: { documentId: edition.documentId } } },
    populate: { author: true, conversation: { populate: ['participants'] } },
    limit: 1000,
  });
  const standOf = new Map(exhibitors.map((exhibitor) => [exhibitor.documentId, exhibitor.standNumber]));

  return {
    settings: Object.fromEntries(SETTINGS.map((key) => [key, SETTINGS.slice(-2).includes(key) ? iso(edition[key]) : edition[key]])),
    sequences: sequences.map((sequence) => ({ title: sequence.title, kind: sequence.kind })),
    topics: topics.map((topic) => ({ name: topic.name, sessions: names(topic.sessions) })),
    slots: slots.map((slot) => ({ label: slot.label, startsAt: iso(slot.startsAt), endsAt: iso(slot.endsAt), session: slot.session?.title, sessionStart: slot.session?.start_time })),
    exhibitors: exhibitors
      .map((exhibitor) => ({
        standNumber: exhibitor.standNumber,
        organisation: exhibitor.organisation?.slug,
        topics: names(exhibitor.topics),
        representatives: (exhibitor.representatives ?? []).map((rep) => rep.email).sort(),
      }))
      .sort((a, b) => compare(a.standNumber, b.standNumber)),
    attendees: attendees
      .map((attendee) => ({
      email: attendee.email,
      helloassoItemId: String(attendee.helloassoItemId),
      helloassoOrderId: String(attendee.helloassoOrderId),
      firstName: attendee.firstName,
      lastName: attendee.lastName,
      jobTitle: attendee.jobTitle ?? null,
      company: attendee.company ?? null,
      role: attendee.role,
      status: attendee.status,
      speaker: attendee.speaker?.slug ?? null,
      exhibitor: attendee.exhibitor?.standNumber ?? null,
      directoryOptIn: attendee.directoryOptIn,
      meetingsOptIn: attendee.meetingsOptIn,
      newsOptIn: attendee.newsOptIn,
      topics: names(attendee.topics),
      activatedAt: iso(attendee.activatedAt),
      consentAt: iso(attendee.consentAt),
    }))
      .sort((a, b) => compare(a.email, b.email)),
    emailLogs: logs.map((log) => ({ email: log.attendee?.email, template: log.template, status: log.status })).sort((a, b) => compare(a.email, b.email)),
    hosted: attendees.map((attendee) => ({ email: attendee.email, hostedTableNumber: attendee.hostedTableNumber ?? null, bio: attendee.bio ?? null })).sort((a, b) => compare(a.email, b.email)),
    meetings: meetingRows
      .map((meeting) => ({
        requester: meeting.requester?.email,
        target: meeting.targetAttendee?.email ?? null,
        exhibitor: meeting.targetExhibitor ? (standOf.get(meeting.targetExhibitor.documentId) ?? 'inconnu') : null,
        slot: meeting.slot?.label,
        status: meeting.status,
        tableNumber: meeting.tableNumber ?? null,
        tableKey: meeting.tableKey == null ? null : meeting.tableKey === `${meeting.slot?.documentId}:${meeting.tableNumber}` ? 'conforme' : meeting.tableKey,
        location: meeting.location ?? null,
        message: meeting.message ?? null,
        answeredBy: meeting.answeredBy?.email ?? null,
        answeredAt: iso(meeting.answeredAt),
        cancelledAt: iso(meeting.cancelledAt),
        cancelReason: meeting.cancelReason ?? null,
        createdAt: iso(meeting.createdAt),
      }))
      .sort((a, b) => compare(`${a.requester}|${a.slot}`, `${b.requester}|${b.slot}`)),
    conversations: conversationRows.map((conversation) => conversation.participants.map((person) => person.email).sort().join(' + ')).sort(compare),
    messages: messageRows
      .map((message) => ({
        conversation: message.conversation.participants.map((person) => person.email).sort().join(' + '),
        author: message.author?.email,
        body: message.body,
        read: Boolean(message.readAt),
        at: iso(message.createdAt),
      }))
      .sort((a, b) => compare(`${a.conversation}|${a.at}`, `${b.conversation}|${b.at}`)),
  };
}

const safeReadEspace = (app) => readEspace(app).catch((error) => ({ error: `${error.message}` }));
/** L'état de l'espace, ou l'erreur de lecture (modèle du lot 2 absent) relancée dans le test d'abord qui l'attend. */
const espaceOf = (state) => {
  assert.ok(!state?.error, `lecture de l’espace impossible : ${state?.error}`);
  return state;
};

const countDocuments = async (table, where = 'true') =>
  (await queryDatabase(DATABASE, `select count(distinct document_id)::int as n from ${table} where ${where}`)).rows[0].n;

describe('seed de recette sur la base de test', { timeout: 600_000 }, () => {
  let first;
  let second;
  let stateAfterFirst;
  let stateAfterSecond;
  let foreignAfterSecond;
  let espaceAfterFirst;
  let espaceAfterSecond;
  let foreignEspaceAfterSecond;

  before(async () => {
    await resetDatabase(DATABASE);

    first = runSeed();

    // Données étrangères à la recette, que le second passage ne doit pas toucher.
    const strapi = await startStrapi({ database: DATABASE, reset: false });
    try {
      stateAfterFirst = await readState(strapi.app);
      espaceAfterFirst = await safeReadEspace(strapi.app);
      const foreignEdition = await strapi.app.documents('api::edition.edition').create({
        data: { title: 'Édition étrangère', slug: 'edition-etrangere', year: 2025, region: 'normandie', city: 'Ailleurs', edition_status: 'passee' },
        status: 'published',
      });
      // Donnée d'espace d'une autre édition : le seed ne l'efface pas (section 4.4 : « données espace_* de l'édition de recette »).
      // Sans le modèle du lot 2, `documents()` lève tout de suite : ce `before` ne doit pas en faire échouer les tests actifs.
      try {
        await strapi.app.documents(ESPACE.topic).create({ data: { name: 'Sujet étranger', edition: { documentId: foreignEdition.documentId } } });
      } catch {
        // modèle absent : les tests d'abord du lot 2 échouent pour cette raison
      }
      await strapi.app.documents('api::organisation.organisation').create({
        data: { name: 'Organisation étrangère', slug: 'organisation-etrangere' },
        status: 'published',
      });
    } finally {
      await strapi.stop();
    }

    second = runSeed();

    const strapiAgain = await startStrapi({ database: DATABASE, reset: false });
    try {
      stateAfterSecond = await readState(strapiAgain.app);
      espaceAfterSecond = await safeReadEspace(strapiAgain.app);
      try {
        foreignEspaceAfterSecond = await strapiAgain.app.documents(ESPACE.topic).findMany({ filters: { name: 'Sujet étranger' } });
      } catch {
        foreignEspaceAfterSecond = [];
      }
      foreignAfterSecond = {
        edition: await strapiAgain.app.documents('api::edition.edition').findFirst({ filters: { slug: 'edition-etrangere' }, status: 'published' }),
        organisation: await strapiAgain.app.documents('api::organisation.organisation').findFirst({ filters: { slug: 'organisation-etrangere' }, status: 'published' }),
      };
    } finally {
      await strapiAgain.stop();
    }
  });

  describe('premier passage sur une base vide', () => {
    it('réussit (code 0)', () => {
      assert.equal(first.status, 0, first.stderr);
    });

    it('affiche le résumé des comptes', () => {
      assert.ok(first.stdout.includes(`Seed de recette terminé sur la base ${DATABASE}.`), first.stdout);
      assert.match(first.stdout, /Édition\s+1 \(nouvelle-aquitaine-test\)/);
      assert.match(first.stdout, /Séquences\s+9 \(dont 3 pauses B2B\)/);
      assert.match(first.stdout, /Intervenants\s+2\b/);
      assert.match(first.stdout, /Interventions\s+2\b/);
      assert.match(first.stdout, /Organisations\s+4\b/);
    });

    it('crée l’édition de recette publiée, avec ses réglages (10-recette.md)', () => {
      const [edition, ...others] = stateAfterFirst.editions;
      assert.equal(others.length, 0, 'une seule édition');
      assert.equal(edition.title, 'Nouvelle-Aquitaine (test)');
      assert.equal(edition.slug, 'nouvelle-aquitaine-test');
      assert.equal(edition.year, 2026);
      assert.equal(edition.region, 'nouvelle-aquitaine');
      assert.equal(edition.date, '2026-12-03');
      assert.equal(edition.city, 'Bordeaux');
      assert.equal(edition.edition_status, 'inscriptions-ouvertes');
      assert.equal(edition.hero_bg_color, '#600e24');
      assert.equal(edition.lieux.length, 1);
    });

    it('crée les 9 séquences dans l’ordre du programme, rattachées à l’édition', () => {
      const [edition] = stateAfterFirst.editions;
      assert.deepEqual(
        edition.sequences.map(({ title, start_time, end_time }) => ({ title, start_time, end_time })),
        recette.sequences.map(({ title, start_time, end_time }) => ({ title, start_time, end_time }))
      );
      assert.deepEqual(
        edition.sequences.map((s) => s.order),
        [1, 2, 3, 4, 5, 6, 7, 8, 9]
      );
    });

    it('crée les 3 pauses B2B aux horaires de la recette', () => {
      const [edition] = stateAfterFirst.editions;
      const breaks = edition.sequences.filter((s) => /B2B/.test(s.title)).map((s) => `${s.start_time}-${s.end_time}`);
      assert.deepEqual(breaks, ['10h45-11h15', '12h30-14h00', '15h30-16h00']);
    });

    it('crée les 4 organisations fictives, publiées', () => {
      assert.deepEqual(
        stateAfterFirst.organisations.map((o) => o.slug),
        ['test-cabinet-verdelis', 'test-institut-lignea', 'test-resineo', 'test-sylvadour']
      );
    });

    it('crée les 2 intervenants, chacun lié à sa structure et à une intervention de sa séquence', () => {
      assert.deepEqual(
        stateAfterFirst.intervenants.map((i) => [i.slug, i.organisation]),
        [
          ['test-antoine-vergnes', 'test-cabinet-verdelis'],
          ['test-helene-marques', 'test-institut-lignea'],
        ]
      );
      const [edition] = stateAfterFirst.editions;
      const speakers = Object.fromEntries(edition.sequences.map((s) => [s.title, s.interventions.flat()]));
      assert.deepEqual(speakers['Forêt et adaptation'], ['test-helene-marques']);
      assert.deepEqual(speakers['Économie circulaire'], ['test-antoine-vergnes']);
    });

    it('n’utilise que des adresses et des sites en example.org', () => {
      const text = JSON.stringify(stateAfterFirst);
      assert.deepEqual(
        (text.match(/https?:\/\/[^\s"\\]+/g) || []).filter((url) => !/^https:\/\/example\.org\//.test(url)),
        []
      );
    });
  });

  describe('second passage, avec des données étrangères présentes', () => {
    it('réussit (code 0) avec le même résumé', () => {
      assert.equal(second.status, 0, second.stderr);
      const summary = ({ stdout }) => stdout.split('\n').filter((line) => /^(Seed de recette|\s{2}\S)/.test(line));
      assert.deepEqual(summary(second), summary(first));
    });

    it('redonne exactement le même état de recette (idempotence)', () => {
      const recetteOnly = (state) => ({
        editions: state.editions.filter((e) => e.slug === 'nouvelle-aquitaine-test'),
        organisations: state.organisations.filter((o) => o.slug.startsWith('test-')),
        intervenants: state.intervenants,
      });
      assert.deepEqual(recetteOnly(stateAfterSecond), recetteOnly(stateAfterFirst));
    });

    it('ne multiplie aucune ligne : 1 édition, 9 séquences, 2 interventions, 2 intervenants de recette', async () => {
      assert.equal(await countDocuments('editions', `slug = 'nouvelle-aquitaine-test'`), 1);
      assert.equal(await countDocuments('sequences'), 9);
      assert.equal(await countDocuments('interventions'), 2);
      assert.equal(await countDocuments('intervenants'), 2);
      assert.equal(await countDocuments('organisations', `slug like 'test-%'`), 4);
    });

    it('ne touche pas aux données étrangères à la recette', () => {
      assert.equal(foreignAfterSecond.edition?.title, 'Édition étrangère');
      assert.equal(foreignAfterSecond.organisation?.name, 'Organisation étrangère');
      assert.equal(stateAfterSecond.editions.length, 2);
      assert.equal(stateAfterSecond.organisations.length, 5);
    });

    it('n’a créé ni tag ni fichier téléversé', async () => {
      assert.equal(await countDocuments('tags'), 0);
      assert.equal(await countDocuments('files'), 0);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Tests d'abord de la phase 1 (lot 3). Section 4.4 du plan, 10-recette.md.
  // ---------------------------------------------------------------------------------------------------------------

  describe('seed de la phase 1, lot 2 : réglages, thèmes, pauses, exposants et créneaux (4.4, points 1 à 5)', () => {
    const kinds = recette.sequences.map(({ title, kind }) => ({ title, kind }));

    it('règle l’édition de recette : espace ouvert, formulaire HelloAsso du faux, 3 tables, créneaux de 15 min, fenêtre ouverte', () => {
      const { settings } = espaceOf(espaceAfterFirst);
      assert.deepEqual(settings, {
        ...recette.editionSettings,
        meetingRequestsOpenAt: '2026-10-01T08:00:00.000Z',
        meetingRequestsCloseAt: '2026-12-02T17:00:00.000Z',
      });
    });

    it('crée les 5 thèmes de la recette', () => {
      assert.deepEqual(espaceOf(espaceAfterFirst).topics.map((topic) => topic.name).sort(), [...recette.topics].sort());
    });

    it('rétablit le kind des 9 séquences : 3 pauses b2b_break, 5 talk, 1 other', () => {
      const { sequences } = espaceOf(espaceAfterFirst);
      assert.deepEqual(sequences, kinds);
      assert.equal(sequences.filter((sequence) => sequence.kind === 'b2b_break').length, 3);
    });

    it('rattache chaque séquence thématique à son thème par Topic.sessions (A-15)', () => {
      const { topics } = espaceOf(espaceAfterFirst);
      for (const name of recette.topics) {
        assert.deepEqual(topics.find((topic) => topic.name === name).sessions, [name], `thème ${name}`);
      }
    });

    it('crée les 2 exposants : stands 4 et 12, organisations et sujets de la recette', () => {
      const { exhibitors } = espaceOf(espaceAfterFirst);
      assert.deepEqual(
        exhibitors.map(({ standNumber, organisation, topics }) => ({ standNumber, organisation, topics })),
        recette.exhibitors
          .map(({ organisation, standNumber, topics }) => ({ standNumber, organisation, topics: [...topics].sort() }))
          .sort((a, b) => compare(a.standNumber, b.standNumber))
      );
    });

    it('génère les 10 créneaux de R-01 par le service de génération', () => {
      const { slots } = espaceOf(espaceAfterFirst);
      assert.deepEqual(slots.map((slot) => slot.label), ['10h45', '11h00', '12h30', '12h45', '13h00', '13h15', '13h30', '13h45', '15h30', '15h45']);
    });

    it('place les créneaux le 3 décembre 2026 (UTC+1) et les rattache à leur pause', () => {
      const { slots } = espaceOf(espaceAfterFirst);
      assert.equal(slots[0].startsAt, '2026-12-03T09:45:00.000Z');
      assert.equal(slots.at(-1).endsAt, '2026-12-03T15:00:00.000Z');
      assert.ok(slots.every((slot) => new Date(slot.endsAt) - new Date(slot.startsAt) === 15 * 60_000));
      assert.deepEqual(
        slots.map((slot) => slot.sessionStart),
        ['10h45', '10h45', '12h30', '12h30', '12h30', '12h30', '12h30', '12h30', '15h30', '15h30']
      );
    });

    it('rappelle dans le résumé que l’organisateur se connecte par ORGANIZER_EMAILS (Q-17)', () => {
      assert.match(first.stdout, /ORGANIZER_EMAILS/);
    });

    it('second passage : mêmes comptes, 5 thèmes, 9 séquences dont 3 pauses, 2 exposants, 10 créneaux (critère 5 du lot 2)', () => {
      const second = espaceOf(espaceAfterSecond);
      assert.equal(second.topics.length, 5);
      assert.equal(second.sequences.length, 9);
      assert.equal(second.sequences.filter((sequence) => sequence.kind === 'b2b_break').length, 3);
      assert.equal(second.exhibitors.length, 2);
      assert.equal(second.slots.length, 10);
    });

    it('second passage : état identique au premier, thèmes, exposants et créneaux compris (idempotence)', () => {
      const comparable = ({ settings, sequences, topics, slots, exhibitors }) => ({ settings, sequences, topics, slots, exhibitors });
      assert.deepEqual(comparable(espaceOf(espaceAfterSecond)), comparable(espaceOf(espaceAfterFirst)));
    });

    it('second passage : le seed ne touche pas aux thèmes d’une autre édition', () => {
      assert.equal(foreignEspaceAfterSecond?.length, 1);
    });

    it('aucun doublon en base : une ligne de table par thème, exposant et créneau de recette', async () => {
      const rows = async (query) => (await queryDatabase(DATABASE, query)).rows[0].n;
      const names = recette.topics.map((name) => `'${name.replace(/'/g, "''")}'`).join(',');
      assert.equal(await rows(`select count(*)::int as n from espace_topics where name in (${names})`), 5);
      assert.equal(await rows('select count(*)::int as n from espace_slots'), 10);
      assert.equal(await rows('select count(*)::int as n from espace_exhibitors'), 2);
    });
  });

  describe('seed de la phase 1, lot 4 : les 17 Attendee de la recette et leurs e-mails welcome (4.4, point 6)', () => {
    const emails = Object.keys(recette.attendees).sort(compare);
    const find = (state, email) => espaceOf(state).attendees.find((attendee) => attendee.email === email);

    it('crée les 17 Attendee, dont 12 participants, 2 intervenants et 3 représentants d’exposants (Q-17)', () => {
      const { attendees } = espaceOf(espaceAfterFirst);
      assert.deepEqual(attendees.map((attendee) => attendee.email), emails);
      assert.deepEqual(
        Object.fromEntries(Object.entries(Object.groupBy(attendees, (attendee) => attendee.role)).map(([role, list]) => [role, list.length])),
        { participant: 12, speaker: 2, exhibitor_rep: 3 }
      );
    });

    it('n’applique pas Q-15 : Lucas Darrigade (billet Canceled) est créé, au statut cancelled', () => {
      const lucas = find(espaceAfterFirst, 'lucas.darrigade@example.org');
      assert.equal(lucas.status, 'cancelled');
      assert.equal(espaceOf(espaceAfterFirst).attendees.filter((attendee) => attendee.status === 'active').length, 16);
    });

    it('reprend nom, prénom, fonction et entreprise des billets (mapItem), en distinguant le bénéficiaire du payeur', () => {
      const lea = find(espaceAfterFirst, 'lea.ducasse@example.org');
      assert.deepEqual([lea.firstName, lea.lastName, lea.company, lea.jobTitle], ['Léa', 'Ducasse', 'Charpentes du Pibal', 'Responsable bureau d’études']);
      const ines = find(espaceAfterFirst, 'ines.castaing@example.org');
      assert.equal(ines.helloassoItemId, '100003');
      assert.deepEqual([ines.firstName, ines.lastName], ['Inès', 'Castaing']);
    });

    it('conserve les identifiants HelloAsso de chaque billet, et seulement eux', () => {
      const ids = espaceOf(espaceAfterFirst).attendees.map((attendee) => attendee.helloassoItemId).sort();
      assert.deepEqual(ids, helloassoItems.map((item) => String(item.id)).sort());
    });

    it('applique les réglages de recette : rôle, rattachements, consentements et sujets', () => {
      const { attendees } = espaceOf(espaceAfterFirst);
      for (const [email, settings] of Object.entries(recette.attendees)) {
        const attendee = attendees.find((candidate) => candidate.email === email);
        assert.equal(attendee.role, settings.role, email);
        assert.equal(attendee.status, settings.status, email);
        assert.equal(attendee.directoryOptIn, settings.directoryOptIn, `${email} directoryOptIn`);
        assert.equal(attendee.meetingsOptIn, settings.meetingsOptIn, `${email} meetingsOptIn`);
        assert.equal(attendee.newsOptIn, settings.newsOptIn, `${email} newsOptIn`);
        assert.deepEqual(attendee.topics, [...settings.topics].sort(), `${email} sujets`);
        assert.equal(attendee.speaker, settings.speaker ?? null, `${email} intervenant`);
      }
    });

    it('rattache les représentants aux exposants : 2 au stand 4, 1 au stand 12', () => {
      const { exhibitors, attendees } = espaceOf(espaceAfterFirst);
      assert.deepEqual(exhibitors.map((exhibitor) => [exhibitor.standNumber, exhibitor.representatives.length]), [['12', 1], ['4', 2]]);
      assert.equal(attendees.find((attendee) => attendee.email === 'benoit.tastet@example.org').exhibitor, '4');
      assert.equal(attendees.find((attendee) => attendee.email === 'pierre.haurie@example.org').exhibitor, '12');
    });

    it('compte 2 participants sans consentement annuaire et 1 annulé parmi les 12 (10-recette.md)', () => {
      const participants = espaceOf(espaceAfterFirst).attendees.filter((attendee) => attendee.role === 'participant');
      assert.equal(participants.filter((attendee) => !attendee.directoryOptIn).length, 2);
      assert.equal(participants.filter((attendee) => attendee.status === 'cancelled').length, 1);
    });

    it('fixe activatedAt et consentAt à l’ouverture de la fenêtre pour les personnes activées, et les laisse vides pour Tom Laffitte', () => {
      const { attendees } = espaceOf(espaceAfterFirst);
      for (const [email, settings] of Object.entries(recette.attendees)) {
        const attendee = attendees.find((candidate) => candidate.email === email);
        const expected = settings.activated ? recette.editionSettings.meetingRequestsOpenAt : null;
        assert.equal(attendee.activatedAt, expected, `${email} activatedAt`);
        assert.equal(attendee.consentAt, expected, `${email} consentAt`);
      }
    });

    it('ne crée pas l’organisateur : organisation@example.org se connecte par ORGANIZER_EMAILS', () => {
      assert.equal(espaceOf(espaceAfterFirst).attendees.find((attendee) => attendee.email === 'organisation@example.org'), undefined);
    });

    it('crée un EmailLog welcome (sent) par Attendee, 17 en tout, pour qu’une synchronisation ultérieure ne renvoie rien', () => {
      const { emailLogs } = espaceOf(espaceAfterFirst);
      assert.equal(emailLogs.length, 17);
      assert.deepEqual(emailLogs.map((log) => log.email), emails);
      assert.ok(emailLogs.every((log) => log.template === 'welcome' && log.status === 'sent'));
    });

    it('ne stocke ni téléphone ni code postal (NF-11)', () => {
      const text = JSON.stringify(espaceOf(espaceAfterFirst).attendees);
      assert.ok(!/06 39 98|Code Postal|N° de téléphone/.test(text));
    });

    it('second passage : 17 Attendee et 17 EmailLog, état identique au premier (idempotence)', () => {
      const second = espaceOf(espaceAfterSecond);
      assert.equal(second.attendees.length, 17);
      assert.equal(second.emailLogs.length, 17);
      assert.deepEqual(second.attendees, espaceOf(espaceAfterFirst).attendees);
      assert.deepEqual(second.emailLogs, espaceOf(espaceAfterFirst).emailLogs);
    });
  });

  describe('seed des phases 2 et 3, lot 12 : rendez-vous, conversations, présentations et table dédiée (plan, section 4)', () => {
    const find = (list, predicate) => list.find(predicate);
    const meetingsOf = (state) => espaceOf(state).meetings;
    const meeting = (state, requester, slot) => find(meetingsOf(state), (item) => item.requester === `${requester}@example.org` && item.slot === slot);
    const lines = (state) => meetingsOf(state).map((item) => `${item.requester.split('@')[0]} > ${item.target?.split('@')[0] ?? `stand ${item.exhibitor}`} ${item.slot} ${item.status}`).sort(compare);

    it('crée les 8 rendez-vous du plan, avec leur demandeur, leur cible, leur créneau et leur statut', () => {
      assert.deepEqual(lines(espaceAfterFirst), [
        'alice.fourcade > stand 12 15h45 pending',
        'eva.cazaux > nathan.lasserre 11h00 cancelled',
        'hugo.peyrat > antoine.vergnes 10h45 accepted',
        'ines.castaing > lea.ducasse 13h00 pending',
        'jules.mazeres > lea.ducasse 13h15 declined',
        'lea.ducasse > helene.marques 15h30 pending',
        'lea.ducasse > mathis.lagrange 10h45 accepted',
        'lea.ducasse > stand 4 12h30 accepted',
      ].sort(compare));
    });

    it('Léa et Mathis : accepté par Mathis, table 1, clé de table {créneau}:1 (A-27)', () => {
      const item = meeting(espaceAfterFirst, 'lea.ducasse', '10h45');
      assert.deepEqual([item.target, item.tableNumber, item.location, item.tableKey, item.answeredBy], ['mathis.lagrange@example.org', 1, 'Table 1', 'conforme', 'mathis.lagrange@example.org']);
      assert.ok(item.answeredAt);
    });

    it('R-19, A-29 : la réservation de Hugo à la table d’Antoine est acceptée d’emblée à la table 2, sans répondant', () => {
      const item = meeting(espaceAfterFirst, 'hugo.peyrat', '10h45');
      assert.deepEqual([item.status, item.tableNumber, item.location, item.tableKey, item.answeredBy], ['accepted', 2, 'Table 2', 'conforme', null]);
      assert.ok(item.answeredAt, 'answeredAt = la date de la réservation');
    });

    it('Léa et Sylvadour : accepté par Benoît Tastet, au stand 4, sans table ni clé de table', () => {
      const item = meeting(espaceAfterFirst, 'lea.ducasse', '12h30');
      assert.deepEqual([item.exhibitor, item.answeredBy, item.location, item.tableNumber, item.tableKey], ['4', 'benoit.tastet@example.org', 'Stand 4', null, null]);
    });

    it('la demande d’Inès à Léa (13h00) attend sa réponse, avec son message ; celle de Léa à Hélène (15h30) aussi', () => {
      const ines = meeting(espaceAfterFirst, 'ines.castaing', '13h00');
      assert.deepEqual([ines.status, ines.message, ines.answeredBy, ines.tableNumber, ines.tableKey], ['pending', 'Bonjour Léa, échangeons sur la construction bois.', null, null, null]);
      const helene = meeting(espaceAfterFirst, 'lea.ducasse', '15h30');
      assert.deepEqual([helene.status, helene.target, helene.tableNumber], ['pending', 'helene.marques@example.org', null]);
    });

    it('la demande d’Alice à Résinéo (15h45) attend la réponse d’un représentant du stand 12', () => {
      const alice = meeting(espaceAfterFirst, 'alice.fourcade', '15h45');
      assert.deepEqual([alice.status, alice.exhibitor, alice.answeredBy], ['pending', '12', null]);
    });

    it('Jules : refusé par Léa ; Eva : annulé avec son motif et sa date', () => {
      const jules = meeting(espaceAfterFirst, 'jules.mazeres', '13h15');
      assert.deepEqual([jules.status, jules.answeredBy], ['declined', 'lea.ducasse@example.org']);
      const eva = meeting(espaceAfterFirst, 'eva.cazaux', '11h00');
      assert.equal(eva.status, 'cancelled');
      assert.equal(eva.cancelReason, 'Empêchement');
      assert.ok(eva.cancelledAt);
    });

    it('les dates sont celles du fichier de recette (fixes), pas celles de l’exécution', () => {
      for (const item of meetingsOf(espaceAfterFirst)) {
        assert.ok(item.createdAt < '2026-11-01', `${item.requester} ${item.slot} : ${item.createdAt}`);
      }
    });

    it('cohérence avec lib/meetings.js : une seule table dédiée (Antoine, 2), aucun conflit ni numéro invalide (A-29)', () => {
      const { hostedTables } = require('../../src/api/espace/lib/meetings');
      const rows = espaceOf(espaceAfterFirst).attendees.map((attendee, index) => ({
        id: index + 1,
        documentId: attendee.email,
        role: attendee.role,
        status: attendee.status,
        hostedTableNumber: espaceOf(espaceAfterFirst).hosted.find(({ email }) => email === attendee.email).hostedTableNumber,
      }));
      const { hosted, warnings } = hostedTables(rows, 3);
      assert.deepEqual([...hosted], [['antoine.vergnes@example.org', 2]]);
      assert.deepEqual(warnings, []);
    });

    it('cohérence avec les règles : aucune table en double (créneau, table), personne deux fois accepté sur un créneau, aucune demande en double (R-11.5 à R-11.7)', () => {
      const all = meetingsOf(espaceAfterFirst);
      const accepted = all.filter((item) => item.status === 'accepted');
      const tables = accepted.filter((item) => item.tableNumber).map((item) => `${item.slot}:${item.tableNumber}`);
      assert.equal(new Set(tables).size, tables.length, `table en double : ${tables}`);
      const busy = accepted.flatMap((item) => [item.requester, item.target].filter(Boolean).map((person) => `${person}@${item.slot}`));
      assert.equal(new Set(busy).size, busy.length, `personne prise deux fois : ${busy}`);
      const pairs = all.filter((item) => ['pending', 'accepted'].includes(item.status)).map((item) => [item.requester, item.target ?? `x${item.exhibitor}`].sort().join('|'));
      assert.equal(new Set(pairs).size, pairs.length, `demande en double : ${pairs}`);
      for (const item of accepted.filter((candidate) => candidate.tableNumber && candidate.target !== 'antoine.vergnes@example.org')) {
        assert.ok([1, 3].includes(item.tableNumber), `${item.requester} ${item.slot} : la table dédiée est réservée à Antoine`);
      }
    });

    it('Antoine Vergnes est un intervenant à table dédiée 2 ; personne d’autre n’a de table dédiée', () => {
      const { hosted } = espaceOf(espaceAfterFirst);
      assert.deepEqual(hosted.filter((entry) => entry.hostedTableNumber !== null).map((entry) => [entry.email, entry.hostedTableNumber]), [['antoine.vergnes@example.org', 2]]);
      assert.equal(find(espaceOf(espaceAfterFirst).attendees, (attendee) => attendee.email === 'antoine.vergnes@example.org').role, 'speaker');
    });

    it('présentations : Léa, Mathis, Inès, Antoine et Benoît en ont une, les autres non', () => {
      const withBio = espaceOf(espaceAfterFirst).hosted.filter((entry) => entry.bio).map((entry) => entry.email);
      assert.deepEqual(withBio, ['antoine.vergnes@example.org', 'benoit.tastet@example.org', 'ines.castaing@example.org', 'lea.ducasse@example.org', 'mathis.lagrange@example.org']);
    });

    it('2 conversations : Léa et Mathis, Inès et Léa ; 4 messages, dont 2 non lus de Léa', () => {
      const state = espaceOf(espaceAfterFirst);
      assert.deepEqual(state.conversations, ['ines.castaing@example.org + lea.ducasse@example.org', 'lea.ducasse@example.org + mathis.lagrange@example.org']);
      assert.equal(state.messages.length, 4);
      assert.equal(state.messages.filter((message) => !message.read && message.author !== 'lea.ducasse@example.org').length, 2);
    });

    it('la conversation de Léa et Mathis : Mathis, Léa (lus), puis Mathis (non lu) « J’apporterai nos échantillons de panneaux. »', () => {
      const thread = espaceOf(espaceAfterFirst).messages.filter((message) => message.conversation.includes('mathis'));
      assert.deepEqual(thread.map((message) => [message.author.split('.')[0], message.read]), [['mathis', true], ['lea', true], ['mathis', false]]);
      assert.equal(thread[2].body, 'J’apporterai nos échantillons de panneaux.');
    });

    it('la conversation d’Inès et Léa : un seul message, d’Inès, non lu', () => {
      const thread = espaceOf(espaceAfterFirst).messages.filter((message) => message.conversation.includes('ines'));
      assert.equal(thread.length, 1);
      assert.deepEqual([thread[0].author, thread[0].read], ['ines.castaing@example.org', false]);
    });

    it('le seed n’envoie rien de plus : toujours 17 EmailLog welcome, aucun meeting-*', () => {
      const { emailLogs } = espaceOf(espaceAfterFirst);
      assert.equal(emailLogs.length, 17);
      assert.deepEqual([...new Set(emailLogs.map((log) => log.template))], ['welcome']);
    });

    it('le résumé final compte les rendez-vous, conversations et messages', () => {
      assert.match(first.stdout, /Rendez-vous\s+8 \(3 acceptés, 3 en attente, 1 refusé, 1 annulé\)/);
      assert.match(first.stdout, /Conversations\s+2/);
      assert.match(first.stdout, /Messages\s+4 \(dont 2 non lus\)/);
    });

    it('second passage : mêmes rendez-vous, mêmes conversations, mêmes messages, sans doublon (idempotence)', () => {
      const one = espaceOf(espaceAfterFirst);
      const two = espaceOf(espaceAfterSecond);
      assert.equal(two.meetings.length, 8);
      assert.equal(two.messages.length, 4);
      assert.deepEqual(two.meetings, one.meetings);
      assert.deepEqual(two.conversations, one.conversations);
      assert.deepEqual(two.messages, one.messages);
      assert.deepEqual(two.hosted, one.hosted);
      assert.match(second.stdout, /Rendez-vous\s+8 /);
    });
  });
});
