'use strict';

/**
 * lib/meetings.js, `checkRequest` (lot 8, tests d'abord) : conditions de création d'une demande (R-11), exposant (R-14),
 * réservation d'une table dédiée (R-19), table libre (R-03, R-13), contre-proposition (`ignoreMeetingId`, A-31).
 * Section 3.1 du plan : ordre des contrôles 1 (WINDOW_CLOSED), 2 (SLOT_PAST), 10 (HOST_AT_TABLE), 4 puis 3 (TARGET_UNAVAILABLE),
 * 5 (SLOT_TAKEN), 6 (TARGET_BUSY), 7 (ALREADY_REQUESTED), 8 (NO_TABLE_LEFT), 9 (TOO_MANY_PENDING).
 * L’instantané vient de helpers/meetings-snapshot.js : « a » demande, « b » est la cible par défaut, créneau « s1 ».
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { pending } = require('../helpers/pending');
const { exhibitorEntry, meeting, person, snapshot, verdict } = require('../helpers/meetings-snapshot');

const lib = () => require('../../src/api/espace/lib/meetings');
const P = (id) => ({ kind: 'p', id });
const X = (id) => ({ kind: 'x', id });
const check = (snap, { requesterId = 'a', target = P('b'), slotId = 's1', ...rest } = {}) => lib().checkRequest(snap, { requesterId, target, slotId, ...rest });
const accepted = (id, fields) => meeting(id, { status: 'accepted', ...fields });

describe('checkRequest : une demande valable', pending('lot 8'), () => {
  it('entre deux participants : mode « request », sans table (elle est attribuée à l’acceptation)', () => {
    const result = check(snapshot());
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'request');
    assert.equal(result.tableNumber ?? null, null);
  });

  it('vers un exposant : mode « stand »', () => {
    const snap = snapshot({ exhibitors: [exhibitorEntry('x1', { activeRepIds: ['r1'] })], extraPeople: [person('r1', { role: 'exhibitor_rep', exhibitorId: 'x1' })] });
    const result = check(snap, { target: X('x1') });
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'stand');
  });

  it('vers un intervenant à table dédiée : mode « booking » à la table de l’hôte (R-19)', () => {
    const result = check(snapshot({ hosted: { h: 2 } }), { target: P('h') });
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'booking');
    assert.equal(result.tableNumber, 2);
  });

  it('la réservation ne demande ni meetingsOptIn de l’hôte (R-19.5), ni qu’il ait activé son espace', () => {
    const snap = snapshot({ hosted: { h: 3 } });
    assert.equal(snap.attendees.get('h').meetingsOptIn, false);
    assert.equal(verdict(check(snap, { target: P('h') })), 'OK');
  });

  it('un demandeur qui n’a rien coché peut demander (T-10) : seul meetingsOptIn de la cible compte', () => {
    const snap = snapshot({ people: [person('a', { meetingsOptIn: false }), person('b')] });
    assert.equal(verdict(check(snap)), 'OK');
  });

  it('ne modifie pas l’instantané', () => {
    const snap = snapshot({ meetings: [accepted('m1', { requesterId: 'c', targetAttendeeId: 'd', tableNumber: 1 })] });
    const copy = structuredClone(snap);
    check(snap);
    assert.deepEqual(snap, copy);
  });
});

describe('checkRequest : un code par condition (R-11)', pending('lot 8'), () => {
  describe('R-11.1 WINDOW_CLOSED : fenêtre de prise de rendez-vous (R-17)', () => {
    it('fermée', () => assert.equal(verdict(check(snapshot({ window: 'closed' }))), 'WINDOW_CLOSED'));
    it('pas encore ouverte', () => assert.equal(verdict(check(snapshot({ window: 'not_open' }))), 'WINDOW_CLOSED'));
  });

  describe('R-11.2 SLOT_PAST : le créneau a commencé', () => {
    it('créneau passé', () => assert.equal(verdict(check(snapshot(), { slotId: 'past' })), 'SLOT_PAST'));
    it('créneau à venir : accepté', () => assert.equal(verdict(check(snapshot(), { slotId: 's4' })), 'OK'));
    it('un créneau qui commence à la milliseconde même est commencé', () => {
      const snap = snapshot({ now: new Date('2026-12-03T09:45:00.000Z') });
      assert.equal(verdict(check(snap, { slotId: 's1' })), 'SLOT_PAST');
    });
  });

  describe('R-19.3 et R-11.10 HOST_AT_TABLE : l’intervenant reste à sa table', () => {
    it('un intervenant à table dédiée ne demande rien à un participant', () => {
      assert.equal(verdict(check(snapshot({ hosted: { h: 2 } }), { requesterId: 'h' })), 'HOST_AT_TABLE');
    });

    it('ni à un exposant', () => {
      const snap = snapshot({ hosted: { h: 2 }, exhibitors: [exhibitorEntry('x1', { activeRepIds: ['r1'] })] });
      assert.equal(verdict(check(snap, { requesterId: 'h', target: X('x1') })), 'HOST_AT_TABLE');
    });

    it('ni à la table d’un autre intervenant', () => {
      const snap = snapshot({ hosted: { h: 2, h2: 3 } });
      assert.equal(verdict(check(snap, { requesterId: 'h', target: P('h2') })), 'HOST_AT_TABLE');
    });
  });

  describe('R-11.3 et R-11.4 TARGET_UNAVAILABLE', () => {
    it('on ne se demande pas à soi-même', () => assert.equal(verdict(check(snapshot(), { target: P('a') })), 'TARGET_UNAVAILABLE'));

    it('un représentant ne demande pas un rendez-vous à son propre exposant', () => {
      const snap = snapshot({
        exhibitors: [exhibitorEntry('x1', { activeRepIds: ['a'] })],
        people: [person('a', { role: 'exhibitor_rep', exhibitorId: 'x1' }), person('b')],
      });
      assert.equal(verdict(check(snap, { target: X('x1') })), 'TARGET_UNAVAILABLE');
    });

    it('un organisateur ne reçoit pas de demande', () => {
      const snap = snapshot({ people: [person('a'), person('b', { role: 'organizer' })] });
      assert.equal(verdict(check(snap)), 'TARGET_UNAVAILABLE');
    });

    it('une cible annulée ne reçoit pas de demande', () => {
      const snap = snapshot({ people: [person('a'), person('b', { status: 'cancelled' })] });
      assert.equal(verdict(check(snap)), 'TARGET_UNAVAILABLE');
    });

    it('une cible sans meetingsOptIn ne reçoit pas de demande', () => {
      const snap = snapshot({ people: [person('a'), person('b', { meetingsOptIn: false })] });
      assert.equal(verdict(check(snap)), 'TARGET_UNAVAILABLE');
    });

    it('un exposant sans représentant actif ne reçoit pas de demande', () => {
      const snap = snapshot({ exhibitors: [exhibitorEntry('x1', { activeRepIds: [] })] });
      assert.equal(verdict(check(snap, { target: X('x1') })), 'TARGET_UNAVAILABLE');
    });

    it('un exposant à un représentant actif reçoit une demande, même si le représentant n’a pas coché meetingsOptIn', () => {
      const snap = snapshot({
        exhibitors: [exhibitorEntry('x1', { activeRepIds: ['r1'] })],
        extraPeople: [person('r1', { role: 'exhibitor_rep', exhibitorId: 'x1', meetingsOptIn: false })],
      });
      assert.equal(verdict(check(snap, { target: X('x1') })), 'OK');
    });

    it('réservation : un intervenant annulé n’est pas réservable (R-19.2)', () => {
      const snap = snapshot({ hosted: { h: 2 } });
      snap.attendees.get('h').status = 'cancelled';
      assert.equal(verdict(check(snap, { target: P('h') })), 'TARGET_UNAVAILABLE');
    });
  });

  describe('R-11.5 SLOT_TAKEN : le demandeur est déjà pris sur ce créneau', () => {
    it('il a un rendez-vous accepté qu’il avait demandé', () => {
      const snap = snapshot({ meetings: [accepted('m1', { requesterId: 'a', targetAttendeeId: 'c', tableNumber: 1 })] });
      assert.equal(verdict(check(snap)), 'SLOT_TAKEN');
    });

    it('il a un rendez-vous accepté qu’il avait reçu (T-18)', () => {
      const snap = snapshot({ meetings: [accepted('m1', { requesterId: 'c', targetAttendeeId: 'a', tableNumber: 1 })] });
      assert.equal(verdict(check(snap)), 'SLOT_TAKEN');
    });

    it('il a déjà une demande en attente sur ce créneau', () => {
      const snap = snapshot({ meetings: [meeting('m1', { requesterId: 'a', targetAttendeeId: 'c' })] });
      assert.equal(verdict(check(snap)), 'SLOT_TAKEN');
    });

    it('un rendez-vous accepté sur un autre créneau ne gêne pas', () => {
      const snap = snapshot({ meetings: [accepted('m1', { slotId: 's2', requesterId: 'a', targetAttendeeId: 'c', tableNumber: 1 })] });
      assert.equal(verdict(check(snap)), 'OK');
    });

    for (const status of ['declined', 'cancelled', 'expired']) {
      it(`un rendez-vous ${status} sur ce créneau ne gêne pas`, () => {
        const snap = snapshot({ meetings: [meeting('m1', { status, requesterId: 'a', targetAttendeeId: 'c' })] });
        assert.equal(verdict(check(snap)), 'OK');
      });
    }
  });

  describe('R-11.6 TARGET_BUSY : la cible a déjà un rendez-vous accepté sur ce créneau', () => {
    it('la cible l’avait reçu', () => {
      const snap = snapshot({ meetings: [accepted('m1', { requesterId: 'c', targetAttendeeId: 'b', tableNumber: 1 })] });
      assert.equal(verdict(check(snap)), 'TARGET_BUSY');
    });

    it('la cible l’avait demandé', () => {
      const snap = snapshot({ meetings: [accepted('m1', { requesterId: 'b', targetAttendeeId: 'c', tableNumber: 1 })] });
      assert.equal(verdict(check(snap)), 'TARGET_BUSY');
    });

    it('une demande en attente de la cible ne la rend pas occupée', () => {
      const snap = snapshot({ meetings: [meeting('m1', { requesterId: 'c', targetAttendeeId: 'b' })] });
      assert.equal(verdict(check(snap)), 'OK');
    });

    it('un rendez-vous accepté de la cible sur un autre créneau ne la rend pas occupée', () => {
      const snap = snapshot({ meetings: [accepted('m1', { slotId: 's2', requesterId: 'c', targetAttendeeId: 'b', tableNumber: 1 })] });
      assert.equal(verdict(check(snap)), 'OK');
    });
  });

  describe('R-14 : un exposant tient autant de rendez-vous simultanés que de représentants actifs', () => {
    const exhibitor = (reps) => exhibitorEntry('x1', { activeRepIds: reps });
    const stand = (id, requesterId, slotId = 's1') => accepted(id, { slotId, requesterId, targetAttendeeId: null, targetExhibitorId: 'x1' });

    it('deux représentants, un rendez-vous accepté : la demande passe', () => {
      const snap = snapshot({ exhibitors: [exhibitor(['r1', 'r2'])], meetings: [stand('m1', 'c')] });
      assert.equal(verdict(check(snap, { target: X('x1') })), 'OK');
    });

    it('deux représentants, deux rendez-vous acceptés : la troisième demande est refusée TARGET_BUSY (T-19)', () => {
      const snap = snapshot({ exhibitors: [exhibitor(['r1', 'r2'])], meetings: [stand('m1', 'c'), stand('m2', 'd')] });
      assert.equal(verdict(check(snap, { target: X('x1') })), 'TARGET_BUSY');
    });

    it('un représentant, un rendez-vous accepté : TARGET_BUSY', () => {
      const snap = snapshot({ exhibitors: [exhibitor(['r1'])], meetings: [stand('m1', 'c')] });
      assert.equal(verdict(check(snap, { target: X('x1') })), 'TARGET_BUSY');
    });

    it('les rendez-vous acceptés d’un autre créneau ne comptent pas', () => {
      const snap = snapshot({ exhibitors: [exhibitor(['r1'])], meetings: [stand('m1', 'c', 's2')] });
      assert.equal(verdict(check(snap, { target: X('x1') })), 'OK');
    });

    it('les demandes en attente ne comptent pas', () => {
      const snap = snapshot({
        exhibitors: [exhibitor(['r1'])],
        meetings: [meeting('m1', { requesterId: 'c', targetAttendeeId: null, targetExhibitorId: 'x1' }), meeting('m2', { requesterId: 'd', targetAttendeeId: null, targetExhibitorId: 'x1' })],
      });
      assert.equal(verdict(check(snap, { target: X('x1') })), 'OK');
    });

    it('un autre exposant n’est pas concerné', () => {
      const snap = snapshot({
        exhibitors: [exhibitor(['r1']), exhibitorEntry('x2', { activeRepIds: ['r2'] })],
        meetings: [accepted('m1', { requesterId: 'c', targetAttendeeId: null, targetExhibitorId: 'x2' })],
      });
      assert.equal(verdict(check(snap, { target: X('x1') })), 'OK');
    });
  });

  describe('R-11.7 ALREADY_REQUESTED : une seule demande en attente entre deux mêmes parties, quel que soit le créneau', () => {
    it('même sens, autre créneau', () => {
      const snap = snapshot({ meetings: [meeting('m1', { slotId: 's2', requesterId: 'a', targetAttendeeId: 'b' })] });
      assert.equal(verdict(check(snap)), 'ALREADY_REQUESTED');
    });

    it('sens inverse, autre créneau', () => {
      const snap = snapshot({ meetings: [meeting('m1', { slotId: 's2', requesterId: 'b', targetAttendeeId: 'a' })] });
      assert.equal(verdict(check(snap)), 'ALREADY_REQUESTED');
    });

    it('vers un exposant', () => {
      const snap = snapshot({
        exhibitors: [exhibitorEntry('x1', { activeRepIds: ['r1', 'r2'] })],
        meetings: [meeting('m1', { slotId: 's2', requesterId: 'a', targetAttendeeId: null, targetExhibitorId: 'x1' })],
      });
      assert.equal(verdict(check(snap, { target: X('x1') })), 'ALREADY_REQUESTED');
    });

    it('une demande en attente vers une autre personne ne gêne pas', () => {
      const snap = snapshot({ meetings: [meeting('m1', { slotId: 's2', requesterId: 'a', targetAttendeeId: 'c' })] });
      assert.equal(verdict(check(snap)), 'OK');
    });

    for (const status of ['accepted', 'declined', 'cancelled', 'expired']) {
      it(`une demande ${status} entre les deux ne gêne pas`, () => {
        const snap = snapshot({ meetings: [meeting('m1', { slotId: 's2', status, requesterId: 'a', targetAttendeeId: 'b', tableNumber: status === 'accepted' ? 1 : null })] });
        assert.equal(verdict(check(snap)), 'OK');
      });
    }

    it('ignoreMeetingId écarte la demande initiale d’une contre-proposition (A-31)', () => {
      const snap = snapshot({ meetings: [meeting('initial', { slotId: 's1', requesterId: 'b', targetAttendeeId: 'a' })] });
      assert.equal(verdict(check(snap, { slotId: 's2' })), 'ALREADY_REQUESTED');
      assert.equal(verdict(check(snap, { slotId: 's2', ignoreMeetingId: 'initial' })), 'OK');
    });

    it('ignoreMeetingId n’écarte que la demande nommée', () => {
      const snap = snapshot({
        meetings: [meeting('initial', { slotId: 's1', requesterId: 'b', targetAttendeeId: 'a' }), meeting('autre', { slotId: 's3', requesterId: 'a', targetAttendeeId: 'b' })],
      });
      assert.equal(verdict(check(snap, { slotId: 's2', ignoreMeetingId: 'initial' })), 'ALREADY_REQUESTED');
    });
  });

  describe('R-11.8 NO_TABLE_LEFT : il reste une table libre du lot commun (R-03, R-13)', () => {
    const atTable = (id, table, extra = {}) => accepted(id, { requesterId: `p${id}`, targetAttendeeId: `q${id}`, tableNumber: table, ...extra });
    const crowd = (ids) => ids.flatMap((id) => [person(`p${id}`), person(`q${id}`)]);

    it('trois tables, trois rendez-vous acceptés au créneau : refusé', () => {
      const snap = snapshot({ extraPeople: crowd(['1', '2', '3']), meetings: [atTable('1', 1), atTable('2', 2), atTable('3', 3)] });
      assert.equal(verdict(check(snap)), 'NO_TABLE_LEFT');
    });

    it('trois tables, deux rendez-vous acceptés : passe', () => {
      const snap = snapshot({ extraPeople: crowd(['1', '2']), meetings: [atTable('1', 1), atTable('2', 2)] });
      assert.equal(verdict(check(snap)), 'OK');
    });

    it('la table dédiée ne fait pas partie du lot commun : tables 1 et 3 prises, la 2 est à l’hôte (T-26)', () => {
      const snap = snapshot({ hosted: { h: 2 }, extraPeople: crowd(['1', '2']), meetings: [atTable('1', 1), atTable('2', 3)] });
      assert.equal(verdict(check(snap)), 'NO_TABLE_LEFT');
    });

    it('la table dédiée est retirée du lot même quand personne n’y a réservé', () => {
      const snap = snapshot({ hosted: { h: 2 }, extraPeople: crowd(['1']), meetings: [atTable('1', 1)] });
      assert.equal(verdict(check(snap)), 'OK', 'la table 3 est libre');
      const snap2 = snapshot({ hosted: { h: 2 }, extraPeople: crowd(['1', '2']), meetings: [atTable('1', 1), atTable('2', 3)] });
      assert.equal(verdict(check(snap2)), 'NO_TABLE_LEFT');
    });

    it('un rendez-vous à la table dédiée ne consomme pas le lot commun', () => {
      const snap = snapshot({ hosted: { h: 2 }, extraPeople: crowd(['1', '2', '3']), meetings: [atTable('1', 1), atTable('2', 2, { targetAttendeeId: 'h' })] });
      assert.equal(verdict(check(snap)), 'OK', 'la table 3 reste libre');
    });

    it('les rendez-vous acceptés d’un autre créneau ne comptent pas', () => {
      const snap = snapshot({ extraPeople: crowd(['1', '2', '3']), meetings: [atTable('1', 1, { slotId: 's2' }), atTable('2', 2, { slotId: 's2' }), atTable('3', 3, { slotId: 's2' })] });
      assert.equal(verdict(check(snap)), 'OK');
    });

    it('les demandes en attente ne consomment pas de table', () => {
      const snap = snapshot({
        extraPeople: crowd(['1', '2', '3']),
        meetings: [1, 2, 3].map((n) => meeting(`m${n}`, { requesterId: `p${n}`, targetAttendeeId: `q${n}` })),
      });
      assert.equal(verdict(check(snap)), 'OK');
    });

    it('les rendez-vous aux stands ne consomment pas de table (R-03)', () => {
      const snap = snapshot({
        exhibitors: [exhibitorEntry('x1', { activeRepIds: ['r1', 'r2', 'r3', 'r4'] })],
        extraPeople: crowd(['1', '2', '3']),
        meetings: [1, 2, 3].map((n) => accepted(`m${n}`, { requesterId: `p${n}`, targetAttendeeId: null, targetExhibitorId: 'x1' })),
      });
      assert.equal(verdict(check(snap)), 'OK');
    });

    it('une demande vers un exposant n’exige aucune table libre', () => {
      const snap = snapshot({
        exhibitors: [exhibitorEntry('x1', { activeRepIds: ['r1'] })],
        extraPeople: crowd(['1', '2', '3']),
        meetings: [atTable('1', 1), atTable('2', 2), atTable('3', 3)],
      });
      assert.equal(verdict(check(snap, { target: X('x1') })), 'OK');
    });
  });

  describe('R-11.9 TOO_MANY_PENDING : moins de 10 demandes en attente au total', () => {
    const others = Array.from({ length: 11 }, (_, index) => person(`t${index}`));
    const pendingSent = (count) => Array.from({ length: count }, (_, index) => meeting(`m${index}`, { slotId: 's2', requesterId: 'a', targetAttendeeId: `t${index}` }));

    it('dix demandes en attente : la onzième est refusée', () => {
      assert.equal(verdict(check(snapshot({ extraPeople: others, meetings: pendingSent(10) }))), 'TOO_MANY_PENDING');
    });

    it('neuf demandes en attente : la dixième passe', () => {
      assert.equal(verdict(check(snapshot({ extraPeople: others, meetings: pendingSent(9) }))), 'OK');
    });

    it('les demandes reçues ne comptent pas', () => {
      const received = Array.from({ length: 10 }, (_, index) => meeting(`m${index}`, { slotId: 's2', requesterId: `t${index}`, targetAttendeeId: 'a' }));
      assert.equal(verdict(check(snapshot({ extraPeople: others, meetings: received }))), 'OK');
    });

    it('les demandes closies ou acceptées ne comptent pas', () => {
      const closed = ['declined', 'cancelled', 'expired', 'accepted', 'declined', 'cancelled', 'expired', 'accepted', 'declined', 'cancelled'].map((status, index) =>
        meeting(`m${index}`, { status, slotId: 's2', requesterId: 'a', targetAttendeeId: `t${index}`, tableNumber: status === 'accepted' ? 1 + (index % 3) : null })
      );
      assert.equal(verdict(check(snapshot({ extraPeople: others, meetings: closed }))), 'OK');
    });

    it('les demandes en attente d’un autre participant ne comptent pas', () => {
      const ofOthers = Array.from({ length: 10 }, (_, index) => meeting(`m${index}`, { slotId: 's2', requesterId: 'c', targetAttendeeId: `t${index}` }));
      assert.equal(verdict(check(snapshot({ extraPeople: others, meetings: ofOthers }))), 'OK');
    });
  });
});

describe('checkRequest : ordre des contrôles (section 3.1)', pending('lot 8'), () => {
  const crowd = [person('p1'), person('q1'), person('p2'), person('q2'), person('p3'), person('q3'), ...Array.from({ length: 10 }, (_, index) => person(`t${index}`))];
  const table = (id, n) => accepted(id, { requesterId: `p${id}`, targetAttendeeId: `q${id}`, tableNumber: n });
  const tenPending = Array.from({ length: 10 }, (_, index) => meeting(`pm${index}`, { slotId: 's2', requesterId: 'a', targetAttendeeId: `t${index}` }));

  it('1 avant 2 : fenêtre fermée et créneau passé donnent WINDOW_CLOSED', () => {
    assert.equal(verdict(check(snapshot({ window: 'closed' }), { slotId: 'past' })), 'WINDOW_CLOSED');
  });

  it('2 avant 10 : créneau passé et demandeur hôte donnent SLOT_PAST', () => {
    assert.equal(verdict(check(snapshot({ hosted: { h: 2 } }), { requesterId: 'h', slotId: 'past' })), 'SLOT_PAST');
  });

  it('10 avant 4 : un hôte qui se vise lui-même donne HOST_AT_TABLE', () => {
    assert.equal(verdict(check(snapshot({ hosted: { h: 2 } }), { requesterId: 'h', target: P('h') })), 'HOST_AT_TABLE');
  });

  it('10 avant 3 : un hôte qui vise une cible sans meetingsOptIn donne HOST_AT_TABLE', () => {
    const snap = snapshot({ hosted: { h: 2 }, people: [person('a'), person('b', { meetingsOptIn: false })] });
    assert.equal(verdict(check(snap, { requesterId: 'h' })), 'HOST_AT_TABLE');
  });

  it('3 avant 5 : cible sans meetingsOptIn et demandeur déjà pris donnent TARGET_UNAVAILABLE', () => {
    const snap = snapshot({
      people: [person('a'), person('b', { meetingsOptIn: false }), person('c')],
      meetings: [accepted('m1', { requesterId: 'a', targetAttendeeId: 'c', tableNumber: 1 })],
    });
    assert.equal(verdict(check(snap)), 'TARGET_UNAVAILABLE');
  });

  it('4 avant 5 : se viser soi-même alors qu’on est déjà pris donne TARGET_UNAVAILABLE', () => {
    const snap = snapshot({ meetings: [accepted('m1', { requesterId: 'a', targetAttendeeId: 'c', tableNumber: 1 })] });
    assert.equal(verdict(check(snap, { target: P('a') })), 'TARGET_UNAVAILABLE');
  });

  it('5 avant 6 : demandeur pris et cible prise donnent SLOT_TAKEN', () => {
    const snap = snapshot({
      meetings: [accepted('m1', { requesterId: 'a', targetAttendeeId: 'c', tableNumber: 1 }), accepted('m2', { requesterId: 'b', targetAttendeeId: 'd', tableNumber: 2 })],
    });
    assert.equal(verdict(check(snap)), 'SLOT_TAKEN');
  });

  it('6 avant 7 : cible prise et demande déjà en attente donnent TARGET_BUSY', () => {
    const snap = snapshot({
      meetings: [accepted('m1', { requesterId: 'b', targetAttendeeId: 'd', tableNumber: 1 }), meeting('m2', { slotId: 's2', requesterId: 'a', targetAttendeeId: 'b' })],
    });
    assert.equal(verdict(check(snap)), 'TARGET_BUSY');
  });

  it('7 avant 8 : demande déjà en attente et plus de table donnent ALREADY_REQUESTED', () => {
    const snap = snapshot({
      extraPeople: crowd,
      meetings: [table('1', 1), table('2', 2), table('3', 3), meeting('m2', { slotId: 's2', requesterId: 'a', targetAttendeeId: 'b' })],
    });
    assert.equal(verdict(check(snap)), 'ALREADY_REQUESTED');
  });

  it('8 avant 9 : plus de table et dix demandes en attente donnent NO_TABLE_LEFT', () => {
    const snap = snapshot({ extraPeople: crowd, meetings: [table('1', 1), table('2', 2), table('3', 3), ...tenPending] });
    assert.equal(verdict(check(snap)), 'NO_TABLE_LEFT');
  });

  it('9 en dernier : dix demandes en attente et rien d’autre donnent TOO_MANY_PENDING', () => {
    const snap = snapshot({ extraPeople: crowd, meetings: tenPending });
    assert.equal(verdict(check(snap)), 'TOO_MANY_PENDING');
  });
});

describe('checkRequest : réservation d’une table dédiée (R-19)', pending('lot 8'), () => {
  const host = (extra = {}) => snapshot({ hosted: { h: 2 }, ...extra });
  const booking = (id, requesterId, slotId, extra = {}) => accepted(id, { slotId, requesterId, targetAttendeeId: 'h', tableNumber: 2, ...extra });
  const book = (snap, options = {}) => check(snap, { target: P('h'), ...options });

  it('R-19.2 : la table de l’hôte déjà réservée sur le créneau donne TARGET_BUSY', () => {
    assert.equal(verdict(book(host({ meetings: [booking('m1', 'c', 's1')] }))), 'TARGET_BUSY');
  });

  it('la table de l’hôte réservée sur un autre créneau ne gêne pas', () => {
    assert.equal(verdict(book(host({ meetings: [booking('m1', 'c', 's2')] }))), 'OK');
  });

  it('un rendez-vous annulé à la table libère le créneau', () => {
    assert.equal(verdict(book(host({ meetings: [booking('m1', 'c', 's1', { status: 'cancelled', tableNumber: null })] }))), 'OK');
  });

  it('R-19.2 : un rendez-vous à venir avec l’hôte donne ALREADY_REQUESTED', () => {
    assert.equal(verdict(book(host({ meetings: [booking('m1', 'a', 's2')] }))), 'ALREADY_REQUESTED');
  });

  it('un rendez-vous passé avec l’hôte n’empêche pas une nouvelle réservation', () => {
    assert.equal(verdict(book(host({ meetings: [booking('m1', 'a', 'past')] }))), 'OK');
  });

  it('un rendez-vous annulé avec l’hôte n’empêche pas une nouvelle réservation', () => {
    assert.equal(verdict(book(host({ meetings: [booking('m1', 'a', 's2', { status: 'cancelled', tableNumber: null })] }))), 'OK');
  });

  it('R-11.5 : le participant déjà pris sur le créneau (SLOT_TAKEN) avant même de regarder la table de l’hôte', () => {
    const snap = host({
      extraPeople: [person('c')],
      meetings: [accepted('m1', { requesterId: 'a', targetAttendeeId: 'd', tableNumber: 1 }), booking('m2', 'c', 's1')],
    });
    assert.equal(verdict(book(snap)), 'SLOT_TAKEN');
  });

  it('TARGET_BUSY (table prise) avant ALREADY_REQUESTED (rendez-vous à venir avec l’hôte)', () => {
    const snap = host({ meetings: [booking('m1', 'c', 's1'), booking('m2', 'a', 's2')] });
    assert.equal(verdict(book(snap)), 'TARGET_BUSY');
  });

  it('une réservation n’est pas soumise à la limite des demandes en attente (R-19.2 ne cite pas R-11.9)', () => {
    const others = Array.from({ length: 10 }, (_, index) => person(`t${index}`));
    const pendingSent = others.map(([id], index) => meeting(`m${index}`, { slotId: 's2', requesterId: 'a', targetAttendeeId: id }));
    assert.equal(verdict(book(host({ extraPeople: others, meetings: pendingSent }))), 'OK');
  });

  it('une réservation ne dépend pas des tables du lot commun (R-11.8 ne s’y applique pas)', () => {
    const crowd = [person('p1'), person('q1'), person('p2'), person('q2')];
    const meetings = [accepted('m1', { requesterId: 'p1', targetAttendeeId: 'q1', tableNumber: 1 }), accepted('m2', { requesterId: 'p2', targetAttendeeId: 'q2', tableNumber: 3 })];
    assert.equal(verdict(book(host({ extraPeople: crowd, meetings }))), 'OK');
  });

  it('R-11.1 : fenêtre fermée donne WINDOW_CLOSED pour une réservation aussi', () => {
    assert.equal(verdict(book(host({ window: 'closed' }))), 'WINDOW_CLOSED');
  });

  it('R-11.2 : créneau passé donne SLOT_PAST pour une réservation aussi', () => {
    assert.equal(verdict(book(host(), { slotId: 'past' })), 'SLOT_PAST');
  });
});
