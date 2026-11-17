'use strict';

/**
 * lib/meetings.js, blocages posés par l'organisateur (V3-F, F-139 à F-141, R-90) :
 *   - `blockedTablesOf` : lecture tolérante du JSON `blockedTables` ;
 *   - `freeTables` et `targetBusy` : une table bloquée est occupée, la table dédiée comprise (R-13, R-19) ;
 *   - `checkRequest` et `checkAccept` : créneau fermé, SLOT_CLOSED ; tables toutes bloquées, NO_TABLE_LEFT ;
 *   - `slotStates` : créneau fermé indisponible ;
 *   - `checkMove` : déplacement par l'organisateur vers une table libre du même créneau.
 * L'instantané vient de helpers/meetings-snapshot.js ; `block` y pose `closed` et `blockedTables` sur un créneau.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { meeting, snapshot, verdict } = require('../helpers/meetings-snapshot');

const lib = () => require('../../src/api/espace/lib/meetings');
const P = (id) => ({ kind: 'p', id });
const accepted = (id, fields) => meeting(id, { status: 'accepted', ...fields });

/** Pose les blocages sur des créneaux de l'instantané : `block(snap, { s1: { blockedTables: [2] }, s3: { closed: true } })`. */
function block(snap, byslot) {
  for (const [id, fields] of Object.entries(byslot)) Object.assign(snap.slots.get(id), { closed: false, blockedTables: [], ...fields });
  return snap;
}

describe('blockedTablesOf : lecture du JSON blockedTables (R-90)', () => {
  const read = (value) => lib().blockedTablesOf(value);

  it('trie et dédoublonne les numéros', () => {
    assert.deepEqual(read([3, 1, 3, 2]), [1, 2, 3]);
  });

  it('ignore ce qui n’est pas un entier positif', () => {
    assert.deepEqual(read([0, -1, 1.5, '2', null, 4]), [4]);
  });

  it('rend une liste vide pour null, un objet ou une chaîne', () => {
    assert.deepEqual([read(null), read(undefined), read({ 1: true }), read('1,2')], [[], [], [], []]);
  });
});

describe('freeTables : une table bloquée est occupée (R-13, R-90)', () => {
  const free = (snap, slotId = 's1', ignore) => lib().freeTables(snap, slotId, ignore);

  it('sans blocage, les trois tables sont libres', () => {
    assert.deepEqual(free(snapshot()), [1, 2, 3]);
  });

  it('la table 2 bloquée sur s1 : libres 1 et 3', () => {
    assert.deepEqual(free(block(snapshot(), { s1: { blockedTables: [2] } })), [1, 3]);
  });

  it('le blocage ne vaut que pour son créneau', () => {
    assert.deepEqual(free(block(snapshot(), { s1: { blockedTables: [2] } }), 's3'), [1, 2, 3]);
  });

  it('table bloquée et table occupée se cumulent', () => {
    const snap = block(snapshot({ meetings: [accepted('m1', { requesterId: 'c', targetAttendeeId: 'd', tableNumber: 1 })] }), { s1: { blockedTables: [3] } });
    assert.deepEqual(free(snap), [2]);
  });

  it('toutes les tables bloquées : aucune libre', () => {
    assert.deepEqual(free(block(snapshot(), { s1: { blockedTables: [1, 2, 3] } })), []);
  });

  it('un numéro bloqué hors du lot commun (table dédiée, numéro inconnu) ne retire rien d’autre', () => {
    assert.deepEqual(free(block(snapshot({ hosted: { h: 2 } }), { s1: { blockedTables: [2, 9] } })), [1, 3]);
  });

  it('un créneau sans les champs de blocage (ancien instantané) se lit comme libre', () => {
    assert.deepEqual(free(snapshot()), [1, 2, 3]);
  });
});

describe('checkRequest : blocages (R-90)', () => {
  const check = (snap, { requesterId = 'a', target = P('b'), slotId = 's1', ...rest } = {}) => lib().checkRequest(snap, { requesterId, target, slotId, ...rest });

  it('créneau fermé : SLOT_CLOSED', () => {
    assert.equal(verdict(check(block(snapshot(), { s1: { closed: true } }))), 'SLOT_CLOSED');
  });

  it('SLOT_CLOSED ne touche que le créneau fermé', () => {
    assert.equal(verdict(check(block(snapshot(), { s1: { closed: true } }), { slotId: 's3' })), 'OK');
  });

  it('SLOT_PAST passe avant SLOT_CLOSED', () => {
    assert.equal(verdict(check(block(snapshot(), { past: { closed: true } }), { slotId: 'past' })), 'SLOT_PAST');
  });

  it('WINDOW_CLOSED passe avant SLOT_CLOSED', () => {
    assert.equal(verdict(check(block(snapshot({ window: 'closed' }), { s1: { closed: true } }))), 'WINDOW_CLOSED');
  });

  it('créneau fermé : une réservation à une table dédiée est refusée aussi', () => {
    assert.equal(verdict(check(block(snapshot({ hosted: { h: 2 } }), { s1: { closed: true } }), { target: P('h') })), 'SLOT_CLOSED');
  });

  it('table 2 bloquée : la demande passe encore (une table reste libre)', () => {
    assert.equal(verdict(check(block(snapshot(), { s1: { blockedTables: [2] } }))), 'OK');
  });

  it('toutes les tables bloquées : NO_TABLE_LEFT', () => {
    assert.equal(verdict(check(block(snapshot(), { s1: { blockedTables: [1, 2, 3] } }))), 'NO_TABLE_LEFT');
  });

  it('table dédiée bloquée : la réservation donne TARGET_BUSY', () => {
    assert.equal(verdict(check(block(snapshot({ hosted: { h: 2 } }), { s1: { blockedTables: [2] } }), { target: P('h') })), 'TARGET_BUSY');
  });

  it('table dédiée bloquée sur s1 : réservable sur s3, avec la table 2', () => {
    const result = check(block(snapshot({ hosted: { h: 2 } }), { s1: { blockedTables: [2] } }), { target: P('h'), slotId: 's3' });
    assert.deepEqual(result, { ok: true, mode: 'booking', tableNumber: 2 });
  });

  it('un blocage sur une autre table que la table dédiée ne gêne pas la réservation', () => {
    assert.equal(verdict(check(block(snapshot({ hosted: { h: 2 } }), { s1: { blockedTables: [1] } }), { target: P('h') })), 'OK');
  });
});

describe('checkAccept : blocages (R-13, R-90)', () => {
  const accept = (snap, meetingId = 'm1', viewerId = 'b') => lib().checkAccept(snap, meetingId, viewerId);
  const pending = (extra) => snapshot({ meetings: [meeting('m1')], ...extra });

  it('créneau fermé : SLOT_CLOSED', () => {
    assert.equal(verdict(accept(block(pending(), { s1: { closed: true } }))), 'SLOT_CLOSED');
  });

  it('table 1 bloquée : la plus petite table libre est la 2', () => {
    const result = accept(block(pending(), { s1: { blockedTables: [1] } }));
    assert.deepEqual(result, { ok: true, location: 'Table 2', tableNumber: 2 });
  });

  it('tables 1 et 2 bloquées : la 3', () => {
    assert.equal(accept(block(pending(), { s1: { blockedTables: [1, 2] } })).tableNumber, 3);
  });

  it('toutes les tables bloquées : NO_TABLE_LEFT', () => {
    assert.equal(verdict(accept(block(pending(), { s1: { blockedTables: [1, 2, 3] } }))), 'NO_TABLE_LEFT');
  });

  it('table dédiée 2 et table 1 bloquée : la 3', () => {
    assert.equal(accept(block(pending({ hosted: { h: 2 } }), { s1: { blockedTables: [1] } })).tableNumber, 3);
  });

  it('table 2 bloquée ne change rien sur un autre créneau', () => {
    const snap = block(snapshot({ meetings: [meeting('m1', { slotId: 's3' })] }), { s1: { blockedTables: [1, 2, 3] } });
    assert.equal(accept(snap).tableNumber, 1);
  });

  it('un exposant n’est pas concerné par les tables bloquées : « Stand 4 »', () => {
    const { exhibitorEntry, person } = require('../helpers/meetings-snapshot');
    const snap = block(
      snapshot({
        exhibitors: [exhibitorEntry('x1', { activeRepIds: ['r1'] })],
        extraPeople: [person('r1', { role: 'exhibitor_rep', exhibitorId: 'x1' })],
        meetings: [meeting('m1', { targetAttendeeId: null, targetExhibitorId: 'x1' })],
      }),
      { s1: { blockedTables: [1, 2, 3] } }
    );
    const result = accept(snap, 'm1', 'r1');
    assert.equal(result.ok, true);
    assert.equal(result.tableNumber ?? null, null);
  });
});

describe('slotStates : créneau fermé indisponible (R-90)', () => {
  const states = (snap, target = P('b')) => lib().slotStates(snap, { viewerId: 'a', target });

  it('un créneau fermé est « unavailable », les autres restent « available »', () => {
    const map = states(block(snapshot(), { s1: { closed: true } }));
    assert.equal(map.get('s1'), 'unavailable');
    assert.equal(map.get('s2'), 'available');
    assert.equal(map.get('s3'), 'available');
  });

  it('une table bloquée ne ferme pas le créneau', () => {
    assert.equal(states(block(snapshot(), { s1: { blockedTables: [2] } })).get('s1'), 'available');
  });

  it('toutes les tables bloquées : « unavailable »', () => {
    assert.equal(states(block(snapshot(), { s1: { blockedTables: [1, 2, 3] } })).get('s1'), 'unavailable');
  });

  it('table dédiée bloquée : le créneau de l’intervenant est « unavailable », pas les autres', () => {
    const map = states(block(snapshot({ hosted: { h: 2 } }), { s1: { blockedTables: [2] } }), P('h'));
    assert.equal(map.get('s1'), 'unavailable');
    assert.equal(map.get('s3'), 'available');
  });

  it('un rendez-vous déjà confirmé sur un créneau fermé reste « confirmed »', () => {
    const snap = block(snapshot({ meetings: [accepted('m1', { tableNumber: 1 })] }), { s1: { closed: true } });
    assert.equal(states(snap).get('s1'), 'confirmed');
  });
});

describe('checkMove : déplacement par l’organisateur (F-141)', () => {
  const move = (snap, table, meetingId = 'm1') => lib().checkMove(snap, meetingId, table);
  const seated = (extra, fields) => snapshot({ meetings: [accepted('m1', { tableNumber: 1, ...fields })], ...extra });

  it('vers une table libre : { ok, location, tableNumber }', () => {
    assert.deepEqual(move(seated(), 3), { ok: true, location: 'Table 3', tableNumber: 3 });
  });

  it('rendez-vous inconnu : MEETING_NOT_FOUND', () => {
    assert.equal(verdict(move(seated(), 2, 'zz')), 'MEETING_NOT_FOUND');
  });

  it('une demande en attente ne se déplace pas : INVALID_TRANSITION', () => {
    assert.equal(verdict(move(snapshot({ meetings: [meeting('m1')] }), 2)), 'INVALID_TRANSITION');
  });

  it('un rendez-vous annulé ne se déplace pas : INVALID_TRANSITION', () => {
    assert.equal(verdict(move(snapshot({ meetings: [meeting('m1', { status: 'cancelled' })] }), 2)), 'INVALID_TRANSITION');
  });

  it('un rendez-vous de stand (sans table) : INVALID_TRANSITION', () => {
    assert.equal(verdict(move(snapshot({ meetings: [accepted('m1', { tableNumber: null })] }), 2)), 'INVALID_TRANSITION');
  });

  it('une réservation à la table dédiée : INVALID_TRANSITION', () => {
    assert.equal(verdict(move(seated({ hosted: { h: 1 } }, { tableNumber: 1 }), 3)), 'INVALID_TRANSITION');
  });

  it('créneau commencé : SLOT_PAST', () => {
    assert.equal(verdict(move(seated({}, { slotId: 'past' }), 2)), 'SLOT_PAST');
  });

  it('créneau fermé : SLOT_CLOSED', () => {
    assert.equal(verdict(move(block(seated(), { s1: { closed: true } }), 2)), 'SLOT_CLOSED');
  });

  it('table occupée : NO_TABLE_LEFT', () => {
    const snap = snapshot({ meetings: [accepted('m1', { tableNumber: 1 }), accepted('m2', { requesterId: 'c', targetAttendeeId: 'd', tableNumber: 2 })] });
    assert.equal(verdict(move(snap, 2)), 'NO_TABLE_LEFT');
  });

  it('table bloquée : NO_TABLE_LEFT', () => {
    assert.equal(verdict(move(block(seated(), { s1: { blockedTables: [2] } }), 2)), 'NO_TABLE_LEFT');
  });

  it('table dédiée d’un intervenant : NO_TABLE_LEFT', () => {
    assert.equal(verdict(move(seated({ hosted: { h: 2 } }), 2)), 'NO_TABLE_LEFT');
  });

  it('numéro hors de l’édition : NO_TABLE_LEFT', () => {
    assert.equal(verdict(move(seated(), 9)), 'NO_TABLE_LEFT');
  });

  it('la table actuelle n’est pas « libre » pour soi-même : se déplacer sur sa propre table passe (ignoreMeetingId)', () => {
    assert.equal(move(seated(), 1).ok, true);
  });

  it('un rendez-vous touché par un blocage de sa propre table se déplace vers une table libre', () => {
    assert.equal(move(block(seated(), { s1: { blockedTables: [1] } }), 2).tableNumber, 2);
  });
});
