'use strict';

/**
 * Schéma de l'espace sur une vraie base, lot 2 de la phase 1 (tests d'abord) :
 *   - index unique `espace_meetings_table_key_uq` après un démarrage et après un redémarrage (R-13, A-07) ;
 *   - test de republication (section 3 du plan, A-03) : republier une édition, une séquence, un intervenant et une organisation
 *     ne détache ni Slot, ni Topic, ni Attendee, ni Exhibitor, et ne casse pas les relations existantes ;
 *   - les liens des types nouveaux survivent à un redémarrage (le schéma ne recrée aucune table de liaison).
 *
 * Strapi démarre deux fois sur TEST_DATABASE : à vide, puis sur la même base sans la vider.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const { queryDatabase } = require('../helpers/database');
const { testDatabaseName } = require('../helpers/env');
const { useEspace } = require('../helpers/espace');
const { UID, createAttendee, createEdition, createProgram, link } = require('../helpers/espace-data');
const { pending } = require('../helpers/pending');

const DATABASE = testDatabaseName();
const INDEX = 'espace_meetings_table_key_uq';
const sql = (text, params) => queryDatabase(DATABASE, text, params).then((result) => result.rows);

/** Relevé des relations portées par les types nouveaux et des relations existantes de l'édition, en documentId. */
async function relationsSnapshot(app, ids) {
  const one = (uid, documentId, populate) => app.documents(uid).findOne({ documentId, populate });
  const idsOf = (list = []) => list.map((entry) => entry.documentId).sort();
  const slot = await one(UID.slot, ids.slot, ['edition', 'session']);
  const topic = await one(UID.topic, ids.topic, ['edition', 'sessions']);
  const attendee = await one(UID.attendee, ids.attendee, ['edition', 'speaker', 'exhibitor', 'topics']);
  const exhibitor = await one(UID.exhibitor, ids.exhibitor, ['edition', 'organisation', 'representatives', 'topics']);
  const edition = await app.documents(UID.edition).findOne({ documentId: ids.edition, status: 'published', populate: ['sequences'] });
  return {
    slot: { edition: slot.edition?.documentId, session: slot.session?.documentId },
    topic: { edition: topic.edition?.documentId, sessions: idsOf(topic.sessions) },
    attendee: {
      edition: attendee.edition?.documentId,
      speaker: attendee.speaker?.documentId,
      exhibitor: attendee.exhibitor?.documentId,
      topics: idsOf(attendee.topics),
    },
    exhibitor: {
      edition: exhibitor.edition?.documentId,
      organisation: exhibitor.organisation?.documentId,
      representatives: idsOf(exhibitor.representatives),
      topics: idsOf(exhibitor.topics),
    },
    editionSequences: idsOf(edition.sequences),
  };
}

let ids;
let initialSnapshot;

describe('schéma, index et republication (lot 2)', { timeout: 300_000 }, () => {
  const espace = useEspace();

  describe('index unique sur table_key (R-13, A-07)', pending('lot 2'), () => {
    it(`${INDEX} existe après le démarrage : unique, sur espace_meetings(table_key)`, async () => {
      espace();
      const rows = await sql(`select indexname, indexdef from pg_indexes where tablename = 'espace_meetings' and indexname = $1`, [INDEX]);
      assert.equal(rows.length, 1, `index ${INDEX} absent`);
      assert.match(rows[0].indexdef, /CREATE UNIQUE INDEX/i);
      assert.match(rows[0].indexdef, /\(table_key\)/);
    });

    it('refuse deux rendez-vous sur la même table du même créneau (tableKey identique)', async () => {
      const { app } = espace();
      const edition = await createEdition(app, { slug: 'edition-index' });
      const [, , pause] = await createProgram(app, edition);
      const slot = await app.documents(UID.slot).create({
        data: { edition: link(edition), session: link(pause), startsAt: '2026-12-03T09:45:00.000Z', endsAt: '2026-12-03T10:00:00.000Z', label: '10h45' },
      });
      const [a, b, c, d] = await Promise.all([1, 2, 3, 4].map((n) => createAttendee(app, edition, { firstName: `Personne${n}` })));
      const meeting = (requester, target, extra) =>
        app.documents(UID.meeting).create({
          data: { edition: link(edition), slot: link(slot), requester: link(requester), targetAttendee: link(target), status: 'accepted', tableNumber: 1, location: 'Table 1', ...extra },
        });
      const key = `${slot.id}:1`;

      await meeting(a, b, { tableKey: key });
      await assert.rejects(meeting(c, d, { tableKey: key }), 'la seconde table 1 du créneau doit être refusée');
      const [{ count }] = await sql('select count(*)::int as count from espace_meetings where table_key = $1', [key]);
      assert.equal(count, 1);
    });

    it('admet plusieurs rendez-vous sans table (tableKey nul) : stands, demandes en attente, annulés', async () => {
      const { app } = espace();
      const edition = await createEdition(app, { slug: 'edition-index-nul' });
      const [, , pause] = await createProgram(app, edition);
      const slot = await app.documents(UID.slot).create({
        data: { edition: link(edition), session: link(pause), startsAt: '2026-12-03T09:45:00.000Z', endsAt: '2026-12-03T10:00:00.000Z', label: '10h45' },
      });
      const [a, b, c, d] = await Promise.all([1, 2, 3, 4].map((n) => createAttendee(app, edition, { firstName: `Autre${n}` })));
      const pending1 = app.documents(UID.meeting).create({ data: { edition: link(edition), slot: link(slot), requester: link(a), targetAttendee: link(b), status: 'pending' } });
      const pending2 = app.documents(UID.meeting).create({ data: { edition: link(edition), slot: link(slot), requester: link(c), targetAttendee: link(d), status: 'pending' } });
      await assert.doesNotReject(Promise.all([pending1, pending2]));
    });
  });

  describe('republication : aucun lien des types nouveaux n’est détaché (section 3 du plan)', pending('lot 2'), () => {
    before(async () => {
      // Pas de crochet qui échoue : un modèle absent fait échouer chaque test de ce groupe à son tour.
      try {
        const { app } = espace();
        const edition = await createEdition(app, { slug: 'edition-republication' });
        const sequences = await createProgram(app, edition);
        const intervenant = await app.documents(UID.intervenant).create({
          data: { name: 'Hélène Républication', slug: 'test-helene-republication', title: 'Directrice', bio: 'Intervenante fictive.', topic: 'Forêt' },
          status: 'published',
        });
        const organisation = await app.documents(UID.organisation).create({
          data: { name: 'Organisation Républication', slug: 'test-organisation-republication', description: 'Fictive.', website: 'https://example.org/republication' },
          status: 'published',
        });
        const topic = await app.documents(UID.topic).create({ data: { name: 'Sujet republication', edition: link(edition), sessions: [link(sequences[1])] } });
        const slot = await app.documents(UID.slot).create({
          data: { edition: link(edition), session: link(sequences[2]), startsAt: '2026-12-03T09:45:00.000Z', endsAt: '2026-12-03T10:00:00.000Z', label: '10h45' },
        });
        const exhibitor = await app.documents(UID.exhibitor).create({
          data: { edition: link(edition), organisation: link(organisation), standNumber: '4', topics: [link(topic)] },
        });
        const attendee = await createAttendee(app, edition, { role: 'speaker', speaker: link(intervenant), exhibitor: link(exhibitor), topics: [link(topic)] });
        ids = {
          edition: edition.documentId,
          sequence: sequences[2].documentId,
          talk: sequences[1].documentId,
          intervenant: intervenant.documentId,
          organisation: organisation.documentId,
          topic: topic.documentId,
          slot: slot.documentId,
          exhibitor: exhibitor.documentId,
          attendee: attendee.documentId,
        };
        initialSnapshot = await relationsSnapshot(app, ids);
      } catch (error) {
        ids = undefined;
        initialSnapshot = undefined;
        console.error(`[espace-schema] préparation de la republication impossible : ${error.message}`);
      }
    });

    const snapshotNow = () => {
      assert.ok(ids && initialSnapshot, 'données de départ absentes : modèle du lot 2 non disponible');
      return relationsSnapshot(espace().app, ids);
    };

    it('le relevé de départ porte bien tous les liens (aucun lien nul)', () => {
      assert.ok(initialSnapshot, 'relevé de départ absent');
      assert.equal(initialSnapshot.slot.edition, ids.edition);
      assert.equal(initialSnapshot.slot.session, ids.sequence);
      assert.deepEqual(initialSnapshot.topic.sessions, [ids.talk]);
      assert.equal(initialSnapshot.attendee.speaker, ids.intervenant);
      assert.equal(initialSnapshot.attendee.exhibitor, ids.exhibitor);
      assert.deepEqual(initialSnapshot.exhibitor.representatives, [ids.attendee]);
      assert.equal(initialSnapshot.exhibitor.organisation, ids.organisation);
      assert.equal(initialSnapshot.editionSequences.length, 9);
    });

    for (const [label, uid, key, change] of [
      ['une édition', UID.edition, 'edition', { description: 'Description republiée.' }],
      ['une séquence (la pause du créneau)', UID.sequence, 'sequence', { title: 'Pause et B2B (republiée)' }],
      ['une séquence rattachée à un thème', UID.sequence, 'talk', { title: 'Séquence thématique republiée' }],
      ['un intervenant', UID.intervenant, 'intervenant', { title: 'Directrice générale' }],
      ['une organisation', UID.organisation, 'organisation', { description: 'Description republiée.' }],
    ]) {
      it(`republier ${label} ne détache ni Slot, ni Topic, ni Attendee, ni Exhibitor`, async () => {
        const { app } = espace();
        await snapshotNow();
        await app.documents(uid).update({ documentId: ids[key], data: change });
        await app.documents(uid).publish({ documentId: ids[key] });
        assert.deepEqual(await snapshotNow(), initialSnapshot);
      });
    }

    it('republier deux fois de suite, et toutes les entités à la file, laisse les liens intacts', async () => {
      const { app } = espace();
      for (const [uid, key] of [[UID.edition, 'edition'], [UID.sequence, 'sequence'], [UID.sequence, 'talk'], [UID.intervenant, 'intervenant'], [UID.organisation, 'organisation']]) {
        await app.documents(uid).publish({ documentId: ids[key] });
        await app.documents(uid).publish({ documentId: ids[key] });
      }
      assert.deepEqual(await snapshotNow(), initialSnapshot);
    });

    it('annuler la publication puis republier une séquence ne détache rien', async () => {
      const { app } = espace();
      await app.documents(UID.sequence).unpublish({ documentId: ids.sequence });
      await app.documents(UID.sequence).publish({ documentId: ids.sequence });
      assert.deepEqual(await snapshotNow(), initialSnapshot);
    });
  });
});

describe('après un redémarrage sur la même base (lot 2)', { timeout: 300_000 }, () => {
  const restarted = useEspace({ reset: false });

  describe('index et liens conservés', pending('lot 2'), () => {
    it(`${INDEX} existe toujours, une seule fois, après le redémarrage`, async () => {
      restarted();
      const rows = await sql(`select indexname from pg_indexes where tablename = 'espace_meetings' and indexname = $1`, [INDEX]);
      assert.equal(rows.length, 1);
    });

    it('aucun index en double ni index de table_key supplémentaire', async () => {
      restarted();
      const rows = await sql(`select indexname from pg_indexes where tablename = 'espace_meetings' and indexdef ilike '%(table_key)%'`);
      assert.deepEqual(rows.map((row) => row.indexname), [INDEX]);
    });

    it('les liens des types nouveaux et de l’édition sont identiques au relevé d’avant le redémarrage', async () => {
      assert.ok(ids && initialSnapshot, 'relevé d’avant le redémarrage absent');
      assert.deepEqual(await relationsSnapshot(restarted().app, ids), initialSnapshot);
    });
  });
});
