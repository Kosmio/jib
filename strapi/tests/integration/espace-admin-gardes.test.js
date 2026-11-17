'use strict';

/**
 * Garde-fous de l'administration (V1-D, tests d'abord) : NF-63 à NF-67 par le Document Service, la base et l'API d'admin.
 *   - NF-63 : suppression ou dépublication refusées (participant, exposant, créneau porteurs d'un rendez-vous `pending` ou
 *     `accepted`, séquence `b2b_break` dont un créneau en porte un, édition ayant des participants), message en français ;
 *   - NF-64 : fenêtre de demandes, tablesCount, slotDurationMinutes à l'enregistrement d'une édition ;
 *   - NF-65 : slug figé dès qu'une édition a un participant ;
 *   - NF-66 : types masqués du gestionnaire de contenu, champs de l'attendee non modifiables ;
 *   - NF-67 : GET /meetings répond 200 quand un rendez-vous a perdu son demandeur, sa cible ou son créneau.
 *
 * Tous les groupes portent pending('V1-D') : le tester retire le marqueur quand le lot est livré. Données fictives (@example.org).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { queryDatabase } = require('../helpers/database');
const { testDatabaseName } = require('../helpers/env');
const { useEspace } = require('../helpers/espace');
const { UID, createAttendee, createEdition, createProgram, link } = require('../helpers/espace-data');
const { pending } = require('../helpers/pending');

const DATABASE = testDatabaseName();
const sql = (text, params) => queryDatabase(DATABASE, text, params).then((result) => result.rows);

const HIDDEN_TYPES = ['api::espace.message', 'api::espace.conversation', 'api::espace.magic-token', 'api::espace.slot'];
const VISIBLE_TYPES = ['api::espace.email-log', 'api::espace.sync-run'];
const READONLY_FIELDS = [
  'editedFields', 'emailPrefs', 'unavailableSessions', 'consentAt', 'activatedAt', 'lastSeenAt',
  'directoryOptIn', 'meetingsOptIn', 'newsOptIn', 'helloassoItemId', 'helloassoOrderId',
];

describe('garde-fous de l’administration (V1-D)', { timeout: 300_000 }, () => {
  const espace = useEspace();
  let counter = 0;

  const newEdition = (options = {}) => {
    counter += 1;
    return createEdition(espace().app, { slug: `gardes-${counter}`, title: `Gardes ${counter}`, ...options });
  };

  /** Édition avec programme et un créneau sur la pause B2B (séquence `b2b_break`). */
  async function world(options) {
    const { app } = espace();
    const edition = await newEdition(options);
    const sequences = await createProgram(app, edition);
    const pause = sequences.find((sequence) => sequence.kind === 'b2b_break') ?? sequences[2];
    const slot = await app.documents(UID.slot).create({
      data: { edition: link(edition), session: link(pause), startsAt: '2026-12-03T09:45:00.000Z', endsAt: '2026-12-03T10:00:00.000Z', label: '10h45' },
    });
    return { edition, sequences, pause, slot };
  }
  const meetingOn = (edition, slot, requester, target, status = 'pending', extra = {}) =>
    espace().app.documents(UID.meeting).create({
      data: { edition: link(edition), slot: link(slot), requester: link(requester), targetAttendee: link(target), status, ...extra },
    });
  const pair = (edition) => Promise.all([1, 2].map(() => createAttendee(espace().app, edition, { meetingsOptIn: true })));
  const exists = async (uid, documentId) => Boolean(await espace().app.documents(uid).findOne({ documentId }));

  describe('NF-63 : suppression et dépublication', pending('V1-D'), () => {
    for (const status of ['pending', 'accepted']) {
      it(`refuse de supprimer un participant porteur d’un rendez-vous ${status}, message en français, données intactes`, async () => {
        const { app } = espace();
        const { edition, slot } = await world();
        const [requester, target] = await pair(edition);
        const meeting = await meetingOn(edition, slot, requester, target, status, status === 'accepted' ? { tableNumber: 1, location: 'Table 1' } : {});
        await assert.rejects(app.documents(UID.attendee).delete({ documentId: requester.documentId }), /Ce participant a des rendez-vous/);
        assert.ok(await exists(UID.attendee, requester.documentId));
        assert.ok(await exists(UID.meeting, meeting.documentId));
      });
    }

    it('refuse aussi de supprimer la cible d’un rendez-vous actif', async () => {
      const { app } = espace();
      const { edition, slot } = await world();
      const [requester, target] = await pair(edition);
      await meetingOn(edition, slot, requester, target, 'accepted', { tableNumber: 1, location: 'Table 1' });
      await assert.rejects(app.documents(UID.attendee).delete({ documentId: target.documentId }), /rendez-vous/);
      assert.ok(await exists(UID.attendee, target.documentId));
    });

    it('admet la suppression d’un participant sans rendez-vous', async () => {
      const { app } = espace();
      const edition = await newEdition();
      const lone = await createAttendee(app, edition);
      await app.documents(UID.attendee).delete({ documentId: lone.documentId });
      assert.equal(await exists(UID.attendee, lone.documentId), false);
    });

    it('admet la suppression d’un participant dont les rendez-vous sont tous clos (declined, cancelled, expired)', async () => {
      const { app } = espace();
      const { edition, slot } = await world();
      const [requester, target] = await pair(edition);
      for (const status of ['declined', 'cancelled', 'expired']) await meetingOn(edition, slot, requester, target, status);
      await app.documents(UID.attendee).delete({ documentId: requester.documentId });
      assert.equal(await exists(UID.attendee, requester.documentId), false);
    });

    it('refuse de supprimer un exposant ciblé par un rendez-vous actif', async () => {
      const { app } = espace();
      const { edition, slot } = await world();
      const [requester] = await pair(edition);
      const organisation = await app.documents(UID.organisation).create({ data: { name: 'Exposant Fictif', slug: 'exposant-fictif-gardes' }, status: 'published' });
      const exhibitor = await app.documents(UID.exhibitor).create({ data: { edition: link(edition), organisation: link(organisation) } });
      await app.documents(UID.meeting).create({
        data: { edition: link(edition), slot: link(slot), requester: link(requester), targetExhibitor: link(exhibitor), status: 'pending' },
      });
      await assert.rejects(app.documents(UID.exhibitor).delete({ documentId: exhibitor.documentId }), /exposant|rendez-vous/i);
      assert.ok(await exists(UID.exhibitor, exhibitor.documentId));
    });

    it('refuse de supprimer un créneau porteur d’un rendez-vous actif, admet un créneau libre', async () => {
      const { app } = espace();
      const { edition, slot, pause } = await world();
      const [requester, target] = await pair(edition);
      await meetingOn(edition, slot, requester, target, 'pending');
      await assert.rejects(app.documents(UID.slot).delete({ documentId: slot.documentId }), /cr[ée]neau|rendez-vous/i);
      assert.ok(await exists(UID.slot, slot.documentId));
      const free = await app.documents(UID.slot).create({
        data: { edition: link(edition), session: link(pause), startsAt: '2026-12-03T10:00:00.000Z', endsAt: '2026-12-03T10:15:00.000Z', label: '11h00' },
      });
      await app.documents(UID.slot).delete({ documentId: free.documentId });
      assert.equal(await exists(UID.slot, free.documentId), false);
    });

    it('refuse de supprimer ou de dépublier une séquence b2b_break dont un créneau porte un rendez-vous actif', async () => {
      const { app } = espace();
      const { edition, slot, pause } = await world();
      const [requester, target] = await pair(edition);
      await meetingOn(edition, slot, requester, target, 'accepted', { tableNumber: 1, location: 'Table 1' });
      await assert.rejects(app.documents(UID.sequence).delete({ documentId: pause.documentId }), /rendez-vous|pause/i);
      await assert.rejects(app.documents(UID.sequence).unpublish({ documentId: pause.documentId }), /rendez-vous|pause/i);
      assert.ok(await app.documents(UID.sequence).findOne({ documentId: pause.documentId, status: 'published' }));
    });

    it('admet de supprimer une séquence b2b_break sans rendez-vous actif', async () => {
      const { app } = espace();
      const { pause } = await world();
      await app.documents(UID.sequence).delete({ documentId: pause.documentId });
      assert.equal(await exists(UID.sequence, pause.documentId), false);
    });

    it('refuse de supprimer ou de dépublier une édition qui a des participants, admet une édition vide', async () => {
      const { app } = espace();
      const populated = await newEdition();
      await createAttendee(app, populated);
      await assert.rejects(app.documents(UID.edition).delete({ documentId: populated.documentId }), /[ée]dition|participants/i);
      await assert.rejects(app.documents(UID.edition).unpublish({ documentId: populated.documentId }), /[ée]dition|participants/i);
      assert.ok(await app.documents(UID.edition).findOne({ documentId: populated.documentId, status: 'published' }));

      const empty = await newEdition();
      await app.documents(UID.edition).delete({ documentId: empty.documentId });
      assert.equal(await exists(UID.edition, empty.documentId), false);
    });
  });

  describe('NF-64 : enregistrement d’une édition', pending('V1-D'), () => {
    const save = (edition, data) => espace().app.documents(UID.edition).update({ documentId: edition.documentId, data });
    const PAST = '2020-01-01T10:00:00.000Z';

    it('critère 2 : refuse une fermeture dans le passé quand des demandes pending existent, sans en faire expirer', async () => {
      const { edition, slot } = await world();
      const [requester, target] = await pair(edition);
      const meeting = await meetingOn(edition, slot, requester, target, 'pending');
      await assert.rejects(save(edition, { meetingRequestsCloseAt: PAST }), /fermeture|demandes/i);
      const after = await espace().app.documents(UID.meeting).findOne({ documentId: meeting.documentId });
      assert.equal(after.status, 'pending');
    });

    it('admet une fermeture dans le passé sans demande en attente', async () => {
      const { edition, slot } = await world();
      const [requester, target] = await pair(edition);
      await meetingOn(edition, slot, requester, target, 'declined');
      await save(edition, { meetingRequestsCloseAt: PAST, meetingRequestsOpenAt: '2019-01-01T10:00:00.000Z' });
    });

    it('refuse une ouverture qui ne précède pas la fermeture (égale ou postérieure)', async () => {
      const edition = await newEdition();
      await assert.rejects(
        save(edition, { meetingRequestsOpenAt: '2026-12-01T10:00:00.000Z', meetingRequestsCloseAt: '2026-11-30T10:00:00.000Z' }),
        /ouverture|fermeture/i,
      );
      await assert.rejects(
        save(edition, { meetingRequestsOpenAt: '2026-12-01T10:00:00.000Z', meetingRequestsCloseAt: '2026-12-01T10:00:00.000Z' }),
        /ouverture|fermeture/i,
      );
    });

    it('refuse de descendre tablesCount sous le plus grand numéro de table attribué, admet ce numéro', async () => {
      const { edition, slot } = await world();
      const [requester, target] = await pair(edition);
      await meetingOn(edition, slot, requester, target, 'accepted', { tableNumber: 3, location: 'Table 3' });
      await assert.rejects(save(edition, { tablesCount: 2 }), /table/i);
      await save(edition, { tablesCount: 3 });
    });

    it('refuse de changer slotDurationMinutes dès qu’un rendez-vous existe, même clos', async () => {
      const { edition, slot } = await world();
      const [requester, target] = await pair(edition);
      await meetingOn(edition, slot, requester, target, 'cancelled');
      await assert.rejects(save(edition, { slotDurationMinutes: 20 }), /dur[ée]e|cr[ée]neau/i);
    });

    it('admet de changer slotDurationMinutes tant qu’aucun rendez-vous n’existe', async () => {
      const edition = await newEdition();
      await save(edition, { slotDurationMinutes: 20 });
    });
  });

  describe('NF-65 : slug d’une édition', pending('V1-D'), () => {
    it('critère 3 : refuse de changer le slug d’une édition qui a un participant', async () => {
      const { app } = espace();
      const edition = await newEdition();
      await createAttendee(app, edition);
      await assert.rejects(app.documents(UID.edition).update({ documentId: edition.documentId, data: { slug: `${edition.slug}-bis` } }), /slug|adresse/i);
      const after = await app.documents(UID.edition).findOne({ documentId: edition.documentId });
      assert.equal(after.slug, edition.slug);
    });

    it('admet de changer le slug d’une édition sans participant', async () => {
      const { app } = espace();
      const edition = await newEdition();
      const renamed = `${edition.slug}-bis`;
      await app.documents(UID.edition).update({ documentId: edition.documentId, data: { slug: renamed } });
      assert.equal((await app.documents(UID.edition).findOne({ documentId: edition.documentId })).slug, renamed);
    });

    it('admet un enregistrement qui laisse le slug inchangé sur une édition peuplée', async () => {
      const { app } = espace();
      const edition = await newEdition();
      await createAttendee(app, edition);
      await app.documents(UID.edition).update({ documentId: edition.documentId, data: { slug: edition.slug, title: 'Titre modifié' } });
    });
  });

  describe('NF-66 : gestionnaire de contenu', pending('V1-D'), () => {
    /** Jeton d'un super-admin créé dans la base de test, pour interroger /content-manager comme l'interface d'admin. */
    async function adminGet(path) {
      const { app, baseUrl } = espace();
      const roles = await app.db.query('admin::role').findMany({ where: { code: 'strapi-super-admin' } });
      const user = await app.db.query('admin::user').create({
        data: { email: `admin.gardes@example.org`, firstname: 'Admin', lastname: 'Fictif', isActive: true, roles: roles.map((role) => role.id) },
      }).catch(async () => app.db.query('admin::user').findOne({ where: { email: 'admin.gardes@example.org' } }));
      const jwt = app.service('admin::token').createJwtToken(user);
      const response = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${jwt}` } });
      return { status: response.status, json: await response.json().catch(() => undefined) };
    }

    it('critère 5 : l’API d’admin ne liste plus message, conversation, magic-token ni slot, et garde email-log et sync-run', async () => {
      const { status, json } = await adminGet('/content-manager/content-types');
      assert.equal(status, 200);
      const uids = json.data.map((type) => type.uid);
      for (const uid of HIDDEN_TYPES) assert.ok(!uids.includes(uid), `${uid} encore listé`);
      for (const uid of VISIBLE_TYPES) assert.ok(uids.includes(uid), `${uid} disparu`);
    });

    it('les schémas portent pluginOptions content-manager visible = false pour les quatre types', () => {
      const { app } = espace();
      for (const uid of HIDDEN_TYPES) assert.equal(app.contentTypes[uid].pluginOptions?.['content-manager']?.visible, false, uid);
    });

    it('les champs de l’attendee listés sont non modifiables dans la configuration du gestionnaire de contenu', async () => {
      const { status, json } = await adminGet('/content-manager/content-types/api::espace.attendee/configuration');
      assert.equal(status, 200);
      const metadatas = json.data.contentType.metadatas;
      for (const field of READONLY_FIELDS) assert.equal(metadatas[field]?.edit?.editable, false, `${field} modifiable`);
    });
  });

  describe('NF-67 : rendez-vous aux parties disparues', pending('V1-D'), () => {
    const signedIn = async (edition, viewer) => espace().signIn(edition.slug, viewer.email);
    const list = (cookie) => espace().request('/api/espace/meetings', { cookie });

    it('critère 4 : demandeur supprimé en SQL, GET /meetings répond 200 pour les autres participants', async () => {
      const { app } = espace();
      const { edition, slot } = await world();
      const [requester, target, bystander] = await Promise.all([1, 2, 3].map(() => createAttendee(app, edition, { consentAt: new Date().toISOString(), meetingsOptIn: true })));
      const meeting = await meetingOn(edition, slot, requester, target, 'pending');
      const [row] = await sql('select id from espace_attendees where document_id = $1', [requester.documentId]);
      await sql('delete from espace_meetings_requester_lnk where attendee_id = $1', [row.id]);
      await sql('delete from espace_attendees where id = $1', [row.id]);
      const orphan = await sql('select id from espace_meetings where document_id = $1', [meeting.documentId]);
      assert.ok(orphan.length > 0, 'rendez-vous orphelin absent');

      for (const viewer of [target, bystander]) {
        const { cookie } = await signedIn(edition, viewer);
        const response = await list(cookie);
        assert.equal(response.status, 200, response.text);
      }
    });

    it('cible supprimée en SQL : 200 pour le demandeur', async () => {
      const { app } = espace();
      const { edition, slot } = await world();
      const [requester, target] = await Promise.all([1, 2].map(() => createAttendee(app, edition, { consentAt: new Date().toISOString(), meetingsOptIn: true })));
      await meetingOn(edition, slot, requester, target, 'pending');
      const [row] = await sql('select id from espace_attendees where document_id = $1', [target.documentId]);
      await sql('delete from espace_meetings_target_attendee_lnk where attendee_id = $1', [row.id]);
      await sql('delete from espace_attendees where id = $1', [row.id]);
      const { cookie } = await signedIn(edition, requester);
      assert.equal((await list(cookie)).status, 200);
    });

    it('créneau supprimé en SQL : 200 pour les deux parties', async () => {
      const { app } = espace();
      const { edition, slot } = await world();
      const [requester, target] = await Promise.all([1, 2].map(() => createAttendee(app, edition, { consentAt: new Date().toISOString(), meetingsOptIn: true })));
      await meetingOn(edition, slot, requester, target, 'pending');
      const [row] = await sql('select id from espace_slots where document_id = $1', [slot.documentId]);
      await sql('delete from espace_meetings_slot_lnk where slot_id = $1', [row.id]);
      await sql('delete from espace_slots where id = $1', [row.id]);
      for (const viewer of [requester, target]) {
        const { cookie } = await signedIn(edition, viewer);
        assert.equal((await list(cookie)).status, 200);
      }
    });

    it('le rendez-vous orphelin est journalisé une seule fois', async () => {
      const { app } = espace();
      const { edition, slot } = await world();
      const [requester, target, bystander] = await Promise.all([1, 2, 3].map(() => createAttendee(app, edition, { consentAt: new Date().toISOString(), meetingsOptIn: true })));
      await meetingOn(edition, slot, requester, target, 'pending');
      const [row] = await sql('select id from espace_attendees where document_id = $1', [requester.documentId]);
      await sql('delete from espace_meetings_requester_lnk where attendee_id = $1', [row.id]);
      await sql('delete from espace_attendees where id = $1', [row.id]);

      const logged = [];
      const original = app.log.warn;
      app.log.warn = (...args) => { logged.push(args.map(String).join(' ')); return original.apply(app.log, args); };
      try {
        const { cookie } = await signedIn(edition, bystander);
        await list(cookie);
        await list(cookie);
      } finally {
        app.log.warn = original;
      }
      assert.equal(logged.filter((line) => /rendez-vous/i.test(line)).length, 1, logged.join('\n'));
    });
  });
});
