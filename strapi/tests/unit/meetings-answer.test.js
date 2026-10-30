'use strict';

/**
 * lib/meetings.js, réponses et affichage (lot 8, tests d'abord) :
 *   - `checkAccept` : droit de répondre, contrôles dans l'ordre, attribution de la plus petite table libre (R-13, R-03, R-14, T-26) ;
 *   - `closeOnAccept` : fermeture des autres demandes du créneau (R-15, A-30) ;
 *   - `slotStates` : états des créneaux d'une fiche (R-12, F-50) ;
 *   - `meetingActions` : boutons calculés par le serveur (R-16, A-31, A-32, F-60 à F-63).
 * L’instantané vient de helpers/meetings-snapshot.js : « a » demande à « b », créneau « s1 ».
 *
 * Interprétations consignées dans tests/SPEC.md : à l’acceptation, le demandeur déjà pris donne SLOT_TAKEN et la cible prise (personne
 * ou exposant complet) donne TARGET_BUSY, comme R-11.5 et R-11.6 ; l’instantané de `closeOnAccept` précède l’écriture (la demande
 * acceptée y est encore `pending`) ; `meetingActions` met `canAccept` à faux quand la fenêtre est fermée ou le créneau commencé.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { pending } = require('../helpers/pending');
const { exhibitorEntry, meeting, person, snapshot, verdict } = require('../helpers/meetings-snapshot');

const lib = () => require('../../src/api/espace/lib/meetings');
const P = (id) => ({ kind: 'p', id });
const X = (id) => ({ kind: 'x', id });
const accepted = (id, fields) => meeting(id, { status: 'accepted', ...fields });
const sorted = (list) => [...list].sort();

describe('checkAccept : qui peut accepter (T-24)', pending('lot 8'), () => {
  const snap = () => snapshot({ meetings: [meeting('m1')] });
  const accept = (s, viewerId, meetingId = 'm1') => lib().checkAccept(s, meetingId, viewerId);

  it('la cible peut accepter', () => {
    assert.equal(accept(snap(), 'b').ok, true);
  });

  it('le demandeur ne peut pas accepter sa propre demande : FORBIDDEN', () => {
    assert.equal(verdict(accept(snap(), 'a')), 'FORBIDDEN');
  });

  it('un tiers ne peut pas accepter la demande adressée à un autre : FORBIDDEN', () => {
    assert.equal(verdict(accept(snap(), 'c')), 'FORBIDDEN');
  });

  it('un visiteur inconnu de l’instantané : FORBIDDEN', () => {
    assert.equal(verdict(accept(snap(), 'zzz')), 'FORBIDDEN');
  });

  describe('demande adressée à un exposant (R-14)', () => {
    const forExhibitor = (extra = {}) =>
      snapshot({
        exhibitors: [exhibitorEntry('x1', { activeRepIds: ['r1', 'r2'] })],
        extraPeople: [person('r1', { role: 'exhibitor_rep', exhibitorId: 'x1' }), person('r2', { role: 'exhibitor_rep', exhibitorId: 'x1' }), person('r3', { role: 'exhibitor_rep', exhibitorId: 'x1', status: 'cancelled' })],
        meetings: [meeting('m1', { targetAttendeeId: null, targetExhibitorId: 'x1' })],
        ...extra,
      });

    it('n’importe quel représentant actif peut accepter', () => {
      assert.equal(accept(forExhibitor(), 'r1').ok, true);
      assert.equal(accept(forExhibitor(), 'r2').ok, true);
    });

    it('un représentant annulé ne peut pas : FORBIDDEN', () => {
      assert.equal(verdict(accept(forExhibitor(), 'r3')), 'FORBIDDEN');
    });

    it('le demandeur et un tiers ne peuvent pas : FORBIDDEN', () => {
      assert.equal(verdict(accept(forExhibitor(), 'a')), 'FORBIDDEN');
      assert.equal(verdict(accept(forExhibitor(), 'c')), 'FORBIDDEN');
    });

    it('le représentant d’un autre exposant ne peut pas : FORBIDDEN', () => {
      const s = forExhibitor({ exhibitors: [exhibitorEntry('x1', { activeRepIds: ['r1', 'r2'] }), exhibitorEntry('x2', { activeRepIds: ['r4'] })] });
      s.attendees.set('r4', { id: 'r4', status: 'active', role: 'exhibitor_rep', meetingsOptIn: true, exhibitorId: 'x2' });
      assert.equal(verdict(accept(s, 'r4')), 'FORBIDDEN');
    });
  });
});

describe('checkAccept : ordre des contrôles FORBIDDEN, INVALID_TRANSITION, WINDOW_CLOSED, SLOT_PAST, SLOT_TAKEN, TARGET_BUSY, NO_TABLE_LEFT', pending('lot 8'), () => {
  const accept = (s, viewerId = 'b') => lib().checkAccept(s, 'm1', viewerId);
  const crowd = [person('p1'), person('q1'), person('p2'), person('q2'), person('p3'), person('q3')];
  const table = (id, n) => accepted(id, { requesterId: `p${id}`, targetAttendeeId: `q${id}`, tableNumber: n });

  for (const status of ['accepted', 'declined', 'cancelled', 'expired']) {
    it(`une demande ${status} ne s’accepte pas : INVALID_TRANSITION (R-10)`, () => {
      assert.equal(verdict(accept(snapshot({ meetings: [meeting('m1', { status, tableNumber: status === 'accepted' ? 1 : null })] }))), 'INVALID_TRANSITION');
    });
  }

  it('FORBIDDEN avant INVALID_TRANSITION : un tiers sur une demande déjà acceptée', () => {
    assert.equal(verdict(accept(snapshot({ meetings: [accepted('m1', { tableNumber: 1 })] }), 'c')), 'FORBIDDEN');
  });

  it('INVALID_TRANSITION avant WINDOW_CLOSED', () => {
    assert.equal(verdict(accept(snapshot({ window: 'closed', meetings: [accepted('m1', { tableNumber: 1 })] }))), 'INVALID_TRANSITION');
  });

  it('WINDOW_CLOSED : une demande pending ne s’accepte plus après la fermeture, même avant la tâche d’expiration (A-32)', () => {
    assert.equal(verdict(accept(snapshot({ window: 'closed', meetings: [meeting('m1')] }))), 'WINDOW_CLOSED');
  });

  it('WINDOW_CLOSED avant SLOT_PAST', () => {
    assert.equal(verdict(accept(snapshot({ window: 'closed', meetings: [meeting('m1', { slotId: 'past' })] }))), 'WINDOW_CLOSED');
  });

  it('SLOT_PAST : le créneau a commencé', () => {
    assert.equal(verdict(accept(snapshot({ meetings: [meeting('m1', { slotId: 'past' })] }))), 'SLOT_PAST');
  });

  it('SLOT_PAST avant SLOT_TAKEN', () => {
    const s = snapshot({ meetings: [meeting('m1', { slotId: 'past' }), accepted('m2', { slotId: 'past', requesterId: 'a', targetAttendeeId: 'c', tableNumber: 1 })] });
    assert.equal(verdict(accept(s)), 'SLOT_PAST');
  });

  it('SLOT_TAKEN : le demandeur a obtenu un autre rendez-vous sur ce créneau entre-temps', () => {
    const s = snapshot({ meetings: [meeting('m1'), accepted('m2', { requesterId: 'a', targetAttendeeId: 'c', tableNumber: 1 })] });
    assert.equal(verdict(accept(s)), 'SLOT_TAKEN');
  });

  it('TARGET_BUSY : la cible a un autre rendez-vous accepté sur ce créneau', () => {
    const s = snapshot({ meetings: [meeting('m1'), accepted('m2', { requesterId: 'c', targetAttendeeId: 'b', tableNumber: 1 })] });
    assert.equal(verdict(accept(s)), 'TARGET_BUSY');
  });

  it('SLOT_TAKEN avant TARGET_BUSY', () => {
    const s = snapshot({
      meetings: [meeting('m1'), accepted('m2', { requesterId: 'a', targetAttendeeId: 'c', tableNumber: 1 }), accepted('m3', { requesterId: 'd', targetAttendeeId: 'b', tableNumber: 2 })],
    });
    assert.equal(verdict(accept(s)), 'SLOT_TAKEN');
  });

  it('NO_TABLE_LEFT : toutes les tables du lot commun sont prises', () => {
    const s = snapshot({ extraPeople: crowd, meetings: [meeting('m1'), table('1', 1), table('2', 2), table('3', 3)] });
    assert.equal(verdict(accept(s)), 'NO_TABLE_LEFT');
  });

  it('TARGET_BUSY avant NO_TABLE_LEFT', () => {
    const s = snapshot({ extraPeople: crowd, meetings: [meeting('m1'), table('1', 1), table('2', 2), accepted('m9', { requesterId: 'p3', targetAttendeeId: 'b', tableNumber: 3 })] });
    assert.equal(verdict(accept(s)), 'TARGET_BUSY');
  });

  it('ne modifie pas l’instantané', () => {
    const s = snapshot({ extraPeople: crowd, meetings: [meeting('m1'), table('1', 1)] });
    const copy = structuredClone(s);
    accept(s);
    assert.deepEqual(s, copy);
  });
});

describe('checkAccept : lieu et table (R-13, R-03, R-19, T-15, T-26)', pending('lot 8'), () => {
  const crowd = ['1', '2', '3', '4'].flatMap((id) => [person(`p${id}`), person(`q${id}`)]);
  const table = (id, n, extra) => accepted(id, { requesterId: `p${id}`, targetAttendeeId: `q${id}`, tableNumber: n, ...extra });
  const accept = (s) => lib().checkAccept(s, 'm1', 'b');

  it('attribue la table 1 quand aucune n’est prise, avec le lieu « Table 1 »', () => {
    const result = accept(snapshot({ meetings: [meeting('m1')] }));
    assert.equal(result.ok, true);
    assert.equal(result.tableNumber, 1);
    assert.equal(result.location, 'Table 1');
  });

  it('attribue la plus petite table libre : 2 quand la 1 est prise, 3 quand 1 et 2 le sont', () => {
    assert.equal(accept(snapshot({ extraPeople: crowd, meetings: [meeting('m1'), table('1', 1)] })).tableNumber, 2);
    assert.equal(accept(snapshot({ extraPeople: crowd, meetings: [meeting('m1'), table('1', 1), table('2', 2)] })).tableNumber, 3);
  });

  it('comble le premier trou : tables 1 et 3 prises donne 2, la 2 seule prise donne 1', () => {
    assert.equal(accept(snapshot({ extraPeople: crowd, meetings: [meeting('m1'), table('1', 1), table('2', 3)] })).tableNumber, 2);
    assert.equal(accept(snapshot({ extraPeople: crowd, meetings: [meeting('m1'), table('1', 2)] })).tableNumber, 1);
  });

  it('les tables des autres créneaux, les demandes en attente et les stands ne comptent pas', () => {
    const s = snapshot({
      exhibitors: [exhibitorEntry('x1', { activeRepIds: ['r1', 'r2', 'r3'] })],
      extraPeople: crowd,
      meetings: [
        meeting('m1'),
        table('1', 1, { slotId: 's2' }),
        meeting('m5', { requesterId: 'p2', targetAttendeeId: 'q2' }),
        accepted('m6', { requesterId: 'p3', targetAttendeeId: null, targetExhibitorId: 'x1' }),
      ],
    });
    assert.equal(accept(s).tableNumber, 1);
  });

  it('une table libérée (rendez-vous annulé) est de nouveau attribuée', () => {
    const s = snapshot({ extraPeople: crowd, meetings: [meeting('m1'), table('1', 1, { status: 'cancelled', tableNumber: null }), table('2', 2)] });
    assert.equal(accept(s).tableNumber, 1);
  });

  describe('table 2 dédiée à un intervenant : lot commun = tables 1 et 3 (R-03, R-19, T-26)', () => {
    const hosted = (meetings) => snapshot({ hosted: { h: 2 }, extraPeople: crowd, meetings: [meeting('m1'), ...meetings] });

    it('premier rendez-vous : table 1', () => {
      assert.equal(accept(hosted([])).tableNumber, 1);
    });

    it('deuxième : table 3, jamais la 2', () => {
      const result = accept(hosted([table('1', 1)]));
      assert.equal(result.tableNumber, 3);
      assert.equal(result.location, 'Table 3');
    });

    it('troisième : NO_TABLE_LEFT', () => {
      assert.equal(verdict(accept(hosted([table('1', 1), table('2', 3)]))), 'NO_TABLE_LEFT');
    });

    it('un rendez-vous déjà accepté sur la table devenue dédiée garde sa table et ne gêne pas le lot commun (A-29)', () => {
      const result = accept(hosted([table('1', 2, { targetAttendeeId: 'h' })]));
      assert.equal(result.tableNumber, 1);
    });

    it('la séquence complète de T-26 : 1, 3, puis plus rien', () => {
      const meetings = [];
      const got = [];
      for (let n = 1; n <= 3; n += 1) {
        const requesterId = `p${n}`;
        const s = snapshot({ hosted: { h: 2 }, extraPeople: crowd, meetings: [...meetings, meeting('m1', { requesterId: 'a' })] });
        const result = accept(s);
        got.push(verdict(result) === 'OK' ? result.tableNumber : verdict(result));
        if (result.ok) meetings.push(accepted(`done${n}`, { requesterId, targetAttendeeId: `q${n}`, tableNumber: result.tableNumber }));
      }
      assert.deepEqual(got, [1, 3, 'NO_TABLE_LEFT']);
    });
  });

  describe('table 1 et 3 dédiées sur 4 tables : lot commun = 2 et 4', () => {
    it('attribue 2 puis 4', () => {
      const base = (meetings) => snapshot({ tablesCount: 4, hosted: { h: 1, h2: 3 }, extraPeople: crowd, meetings: [meeting('m1'), ...meetings] });
      assert.equal(accept(base([])).tableNumber, 2);
      assert.equal(accept(base([table('1', 2)])).tableNumber, 4);
      assert.equal(verdict(accept(base([table('1', 2), table('2', 4)]))), 'NO_TABLE_LEFT');
    });
  });

  describe('exposant : « Stand {standNumber} », aucune table (R-13, R-03)', () => {
    const forExhibitor = (extra = {}) =>
      snapshot({
        exhibitors: [exhibitorEntry('x1', { standNumber: '12', activeRepIds: ['r1', 'r2'] })],
        extraPeople: [person('r1', { role: 'exhibitor_rep', exhibitorId: 'x1' }), person('r2', { role: 'exhibitor_rep', exhibitorId: 'x1' }), ...crowd],
        meetings: [meeting('m1', { targetAttendeeId: null, targetExhibitorId: 'x1' }), ...(extra.meetings ?? [])],
      });

    it('lieu « Stand 12 », tableNumber nul', () => {
      const result = lib().checkAccept(forExhibitor(), 'm1', 'r1');
      assert.equal(result.ok, true);
      assert.equal(result.location, 'Stand 12');
      assert.equal(result.tableNumber ?? null, null);
    });

    it('s’accepte même quand toutes les tables sont prises', () => {
      const s = forExhibitor({ meetings: [table('1', 1), table('2', 2), table('3', 3)] });
      assert.equal(lib().checkAccept(s, 'm1', 'r1').ok, true);
    });

    it('deux représentants : un premier rendez-vous accepté laisse la place au second (R-14)', () => {
      const s = forExhibitor({ meetings: [accepted('m2', { requesterId: 'p1', targetAttendeeId: null, targetExhibitorId: 'x1' })] });
      assert.equal(lib().checkAccept(s, 'm1', 'r2').ok, true);
    });

    it('deux représentants, deux rendez-vous acceptés : TARGET_BUSY (R-14, T-19)', () => {
      const s = forExhibitor({
        meetings: [
          accepted('m2', { requesterId: 'p1', targetAttendeeId: null, targetExhibitorId: 'x1' }),
          accepted('m3', { requesterId: 'p2', targetAttendeeId: null, targetExhibitorId: 'x1' }),
        ],
      });
      assert.equal(verdict(lib().checkAccept(s, 'm1', 'r1')), 'TARGET_BUSY');
    });
  });
});

describe('closeOnAccept : fermeture des demandes du créneau (R-15, A-30)', pending('lot 8'), () => {
  const close = (s, id = 'm1') => lib().closeOnAccept(s, s.meetings.find((candidate) => candidate.id === id));
  const asSets = (result) => ({ cancel: sorted(result.cancel), decline: sorted(result.decline) });

  it('ne ferme rien quand il n’y a pas d’autre demande', () => {
    assert.deepEqual(close(snapshot({ meetings: [meeting('m1')] })), { cancel: [], decline: [] });
  });

  it('refuse les autres demandes adressées à la même cible : declined, avec notification (le demandeur est un tiers)', () => {
    const s = snapshot({ meetings: [meeting('m1'), meeting('m2', { requesterId: 'c' }), meeting('m3', { requesterId: 'd' })] });
    assert.deepEqual(asSets(close(s)), { cancel: [], decline: ['m2', 'm3'] });
  });

  it('annule sans notification les demandes en attente envoyées par le demandeur A sur le créneau', () => {
    const s = snapshot({ meetings: [meeting('m1'), meeting('m2', { requesterId: 'a', targetAttendeeId: 'c' })] });
    assert.deepEqual(asSets(close(s)), { cancel: ['m2'], decline: [] });
  });

  it('annule sans notification les demandes en attente envoyées par la cible B sur le créneau', () => {
    const s = snapshot({ meetings: [meeting('m1'), meeting('m2', { requesterId: 'b', targetAttendeeId: 'c' })] });
    assert.deepEqual(asSets(close(s)), { cancel: ['m2'], decline: [] });
  });

  it('refuse (declined) les demandes d’un tiers adressées au demandeur A', () => {
    const s = snapshot({ meetings: [meeting('m1'), meeting('m2', { requesterId: 'c', targetAttendeeId: 'a' })] });
    assert.deepEqual(asSets(close(s)), { cancel: [], decline: ['m2'] });
  });

  it('une demande entre A et B dans l’autre sens est annulée (son demandeur est une des deux personnes)', () => {
    const s = snapshot({ meetings: [meeting('m1', { requesterId: 'a', targetAttendeeId: 'b' }), meeting('m2', { slotId: 's1', requesterId: 'b', targetAttendeeId: 'a' })] });
    assert.deepEqual(asSets(close(s)), { cancel: ['m2'], decline: [] });
  });

  it('traite les quatre cas ensemble', () => {
    const s = snapshot({
      meetings: [
        meeting('m1'),
        meeting('c-vers-b', { requesterId: 'c', targetAttendeeId: 'b' }),
        meeting('a-vers-d', { requesterId: 'a', targetAttendeeId: 'd' }),
        meeting('b-vers-e', { requesterId: 'b', targetAttendeeId: 'e' }),
        meeting('f-vers-a', { requesterId: 'f', targetAttendeeId: 'a' }),
        meeting('c-vers-d', { requesterId: 'c', targetAttendeeId: 'd' }),
      ],
    });
    assert.deepEqual(asSets(close(s)), { cancel: ['a-vers-d', 'b-vers-e'], decline: ['c-vers-b', 'f-vers-a'] });
  });

  it('ne touche ni aux autres créneaux, ni aux demandes de tiers sans lien avec A et B', () => {
    const s = snapshot({
      meetings: [
        meeting('m1'),
        meeting('autre-creneau-vers-b', { slotId: 's2', requesterId: 'c', targetAttendeeId: 'b' }),
        meeting('autre-creneau-de-a', { slotId: 's2', requesterId: 'a', targetAttendeeId: 'd' }),
        meeting('etrangere', { requesterId: 'c', targetAttendeeId: 'd' }),
      ],
    });
    assert.deepEqual(asSets(close(s)), { cancel: [], decline: [] });
  });

  it('ne touche ni aux rendez-vous acceptés, ni aux demandes déjà closes', () => {
    const s = snapshot({
      meetings: [
        meeting('m1'),
        accepted('acceptee', { requesterId: 'c', targetAttendeeId: 'd', tableNumber: 1 }),
        meeting('refusee', { status: 'declined', requesterId: 'c', targetAttendeeId: 'b' }),
        meeting('annulee', { status: 'cancelled', requesterId: 'a', targetAttendeeId: 'e' }),
        meeting('expiree', { status: 'expired', requesterId: 'f', targetAttendeeId: 'a' }),
      ],
    });
    assert.deepEqual(asSets(close(s)), { cancel: [], decline: [] });
  });

  it('ne se ferme pas elle-même', () => {
    const result = close(snapshot({ meetings: [meeting('m1'), meeting('m2', { requesterId: 'c' })] }));
    assert.ok(![...result.cancel, ...result.decline].includes('m1'));
  });

  describe('exposant devenu complet (R-14, A-30)', () => {
    const toExhibitor = (id, requesterId, fields = {}) => meeting(id, { requesterId, targetAttendeeId: null, targetExhibitorId: 'x1', ...fields });
    const exhibitors = (reps) => [exhibitorEntry('x1', { activeRepIds: reps })];

    it('un seul représentant : l’acceptation le remplit, les autres demandes au stand sont refusées (declined)', () => {
      const s = snapshot({ exhibitors: exhibitors(['r1']), meetings: [toExhibitor('m1', 'a'), toExhibitor('m2', 'c'), toExhibitor('m3', 'd')] });
      assert.deepEqual(asSets(close(s)), { cancel: [], decline: ['m2', 'm3'] });
    });

    it('deux représentants, aucun rendez-vous accepté : l’exposant n’est pas complet, les autres demandes restent', () => {
      const s = snapshot({ exhibitors: exhibitors(['r1', 'r2']), meetings: [toExhibitor('m1', 'a'), toExhibitor('m2', 'c')] });
      assert.deepEqual(asSets(close(s)), { cancel: [], decline: [] });
    });

    it('deux représentants, un rendez-vous déjà accepté : cette acceptation remplit l’exposant, les autres demandes sont refusées', () => {
      const s = snapshot({
        exhibitors: exhibitors(['r1', 'r2']),
        meetings: [toExhibitor('done', 'e', { status: 'accepted' }), toExhibitor('m1', 'a'), toExhibitor('m2', 'c'), toExhibitor('m3', 'd')],
      });
      assert.deepEqual(asSets(close(s)), { cancel: [], decline: ['m2', 'm3'] });
    });

    it('les rendez-vous acceptés d’un autre créneau ne comptent pas', () => {
      const s = snapshot({
        exhibitors: exhibitors(['r1', 'r2']),
        meetings: [toExhibitor('done', 'e', { status: 'accepted', slotId: 's2' }), toExhibitor('m1', 'a'), toExhibitor('m2', 'c')],
      });
      assert.deepEqual(asSets(close(s)), { cancel: [], decline: [] });
    });

    it('le demandeur A est une personne : ses autres demandes du créneau sont annulées, celles qu’il reçoit sont refusées', () => {
      const s = snapshot({
        exhibitors: exhibitors(['r1', 'r2']),
        meetings: [toExhibitor('m1', 'a'), meeting('a-vers-d', { requesterId: 'a', targetAttendeeId: 'd' }), meeting('f-vers-a', { requesterId: 'f', targetAttendeeId: 'a' })],
      });
      assert.deepEqual(asSets(close(s)), { cancel: ['a-vers-d'], decline: ['f-vers-a'] });
    });

    it('un autre exposant n’est pas concerné', () => {
      const s = snapshot({
        exhibitors: [...exhibitors(['r1']), exhibitorEntry('x2', { activeRepIds: ['r2'] })],
        meetings: [toExhibitor('m1', 'a'), meeting('m2', { requesterId: 'c', targetAttendeeId: null, targetExhibitorId: 'x2' })],
      });
      assert.deepEqual(asSets(close(s)), { cancel: [], decline: [] });
    });

    it('sans autre demande au stand ni chez A, rien n’est fermé', () => {
      const s = snapshot({ exhibitors: exhibitors(['r1']), meetings: [toExhibitor('m1', 'a')] });
      assert.deepEqual(close(s), { cancel: [], decline: [] });
    });
  });

  it('ne modifie pas l’instantané', () => {
    const s = snapshot({ meetings: [meeting('m1'), meeting('m2', { requesterId: 'c' }), meeting('m3', { requesterId: 'a', targetAttendeeId: 'd' })] });
    const copy = structuredClone(s);
    close(s);
    assert.deepEqual(s, copy);
  });
});

describe('slotStates : états des créneaux d’une fiche (R-12, F-50)', pending('lot 8'), () => {
  const states = (s, target = P('b'), viewerId = 'a') => lib().slotStates(s, { viewerId, target });
  const stateOf = (map, slotId) => map.get(slotId);
  const crowd = ['1', '2', '3'].flatMap((id) => [person(`p${id}`), person(`q${id}`)]);
  const table = (id, n, slotId) => accepted(id, { slotId, requesterId: `p${id}`, targetAttendeeId: `q${id}`, tableNumber: n });

  it('rend une Map créneau -> état, avec les seuls quatre états du contrat', () => {
    const map = states(snapshot());
    assert.ok(map instanceof Map);
    for (const state of map.values()) assert.ok(['available', 'unavailable', 'requested', 'confirmed'].includes(state), state);
  });

  it('tous les créneaux à venir sont disponibles quand rien ne les gêne', () => {
    const map = states(snapshot());
    assert.deepEqual(['s1', 's2', 's3', 's4'].map((id) => stateOf(map, id)), ['available', 'available', 'available', 'available']);
  });

  it('F-50 : un créneau commencé est absent', () => {
    const map = states(snapshot());
    assert.equal(map.has('past'), false);
    assert.equal(map.size, 4);
  });

  describe('indisponible si R-11.5, R-11.6 ou R-11.8 échoue', () => {
    it('le visiteur est pris sur le créneau (rendez-vous accepté)', () => {
      const map = states(snapshot({ meetings: [accepted('m1', { slotId: 's2', requesterId: 'a', targetAttendeeId: 'c', tableNumber: 1 })] }));
      assert.equal(stateOf(map, 's2'), 'unavailable');
      assert.equal(stateOf(map, 's1'), 'available');
    });

    it('le visiteur est pris sur le créneau (demande en attente envoyée à quelqu’un d’autre)', () => {
      const map = states(snapshot({ meetings: [meeting('m1', { slotId: 's3', requesterId: 'a', targetAttendeeId: 'c' })] }));
      assert.equal(stateOf(map, 's3'), 'unavailable');
    });

    it('la cible est prise sur le créneau (R-11.6), sans que la réponse dise avec qui', () => {
      const map = states(snapshot({ meetings: [accepted('m1', { slotId: 's1', requesterId: 'b', targetAttendeeId: 'c', tableNumber: 1 })] }));
      assert.equal(stateOf(map, 's1'), 'unavailable');
      assert.ok(!JSON.stringify([...map.entries()]).includes('"c"'), 'l’état ne doit rien révéler de l’autre partie');
    });

    it('plus aucune table libre au créneau (R-11.8)', () => {
      const map = states(snapshot({ extraPeople: crowd, meetings: [table('1', 1, 's4'), table('2', 2, 's4'), table('3', 3, 's4')] }));
      assert.equal(stateOf(map, 's4'), 'unavailable');
      assert.equal(stateOf(map, 's1'), 'available');
    });

    it('une demande en attente de la cible, ou ALREADY_REQUESTED (R-11.7), ne rend pas un autre créneau indisponible', () => {
      const map = states(snapshot({ meetings: [meeting('m1', { slotId: 's1', requesterId: 'a', targetAttendeeId: 'b' })] }));
      assert.equal(stateOf(map, 's2'), 'available');
    });

    it('une demande refusée, annulée ou expirée ne gêne pas', () => {
      const map = states(snapshot({ meetings: ['declined', 'cancelled', 'expired'].map((status, index) => meeting(`m${index}`, { status, slotId: `s${index + 1}`, requesterId: 'a', targetAttendeeId: 'c' })) }));
      assert.deepEqual(['s1', 's2', 's3'].map((id) => stateOf(map, id)), ['available', 'available', 'available']);
    });
  });

  describe('demandé et confirmé', () => {
    it('« requested » : le visiteur a une demande en attente envoyée à cette cible sur ce créneau', () => {
      const map = states(snapshot({ meetings: [meeting('m1', { slotId: 's1', requesterId: 'a', targetAttendeeId: 'b' })] }));
      assert.equal(stateOf(map, 's1'), 'requested');
    });

    it('« confirmed » : un rendez-vous accepté avec cette cible, demandé par le visiteur', () => {
      const map = states(snapshot({ meetings: [accepted('m1', { slotId: 's2', requesterId: 'a', targetAttendeeId: 'b', tableNumber: 1 })] }));
      assert.equal(stateOf(map, 's2'), 'confirmed');
    });

    it('« confirmed » : un rendez-vous accepté avec cette cible, demandé par la cible', () => {
      const map = states(snapshot({ meetings: [accepted('m1', { slotId: 's2', requesterId: 'b', targetAttendeeId: 'a', tableNumber: 1 })] }));
      assert.equal(stateOf(map, 's2'), 'confirmed');
    });

    it('« requested » ne vaut que pour la demande envoyée à cette cible : la demande envoyée à un tiers rend le créneau indisponible', () => {
      const map = states(snapshot({ meetings: [meeting('m1', { slotId: 's1', requesterId: 'a', targetAttendeeId: 'c' })] }));
      assert.equal(stateOf(map, 's1'), 'unavailable');
    });
  });

  describe('exposant (mode stand)', () => {
    const base = (reps, meetings = []) =>
      snapshot({ exhibitors: [exhibitorEntry('x1', { activeRepIds: reps })], extraPeople: crowd, meetings });
    const atStand = (id, requesterId, slotId, status = 'accepted') => meeting(id, { status, slotId, requesterId, targetAttendeeId: null, targetExhibitorId: 'x1' });

    it('les tables prises n’affectent pas les créneaux d’un stand', () => {
      const map = states(base(['r1'], [table('1', 1, 's4'), table('2', 2, 's4'), table('3', 3, 's4')]), X('x1'));
      assert.equal(stateOf(map, 's4'), 'available');
    });

    it('un exposant dont les représentants sont tous pris est indisponible (R-14)', () => {
      const map = states(base(['r1', 'r2'], [atStand('m1', 'p1', 's2'), atStand('m2', 'p2', 's2')]), X('x1'));
      assert.equal(stateOf(map, 's2'), 'unavailable');
    });

    it('un exposant dont un représentant reste libre est disponible', () => {
      const map = states(base(['r1', 'r2'], [atStand('m1', 'p1', 's2')]), X('x1'));
      assert.equal(stateOf(map, 's2'), 'available');
    });

    it('« requested » et « confirmed » vers l’exposant', () => {
      const map = states(base(['r1', 'r2'], [atStand('m1', 'a', 's1', 'pending'), atStand('m2', 'a', 's2', 'accepted')]), X('x1'));
      assert.equal(stateOf(map, 's1'), 'requested');
      assert.equal(stateOf(map, 's2'), 'confirmed');
    });
  });

  describe('table dédiée (mode booking, R-19)', () => {
    const base = (meetings = []) => snapshot({ hosted: { h: 2 }, extraPeople: crowd, meetings });
    const booking = (id, requesterId, slotId) => accepted(id, { slotId, requesterId, targetAttendeeId: 'h', tableNumber: 2 });

    it('un créneau dont la table de l’hôte est prise est indisponible', () => {
      const map = states(base([booking('m1', 'p1', 's2')]), P('h'));
      assert.equal(stateOf(map, 's2'), 'unavailable');
      assert.equal(stateOf(map, 's1'), 'available');
    });

    it('les tables du lot commun prises n’affectent pas la table de l’hôte', () => {
      const map = states(base([table('1', 1, 's4'), table('2', 3, 's4')]), P('h'));
      assert.equal(stateOf(map, 's4'), 'available');
    });

    it('« confirmed » pour le visiteur qui a réservé', () => {
      const map = states(base([booking('m1', 'a', 's3')]), P('h'));
      assert.equal(stateOf(map, 's3'), 'confirmed');
    });
  });

  it('ne modifie pas l’instantané', () => {
    const s = snapshot({ meetings: [meeting('m1', { requesterId: 'a', targetAttendeeId: 'b' })] });
    const copy = structuredClone(s);
    states(s);
    assert.deepEqual(s, copy);
  });
});

describe('meetingActions : boutons calculés par le serveur (R-16, A-31, A-32, F-60 à F-63)', pending('lot 8'), () => {
  const actions = (s, id, viewerId) => lib().meetingActions(s, s.meetings.find((candidate) => candidate.id === id), viewerId);
  const only = (result, ...trueKeys) => ({
    canAccept: trueKeys.includes('canAccept'),
    canDecline: trueKeys.includes('canDecline'),
    canCounter: trueKeys.includes('canCounter'),
    canCancel: trueKeys.includes('canCancel'),
  });
  const flags = ({ canAccept, canDecline, canCounter, canCancel }) => ({ canAccept, canDecline, canCounter, canCancel });

  it('rend direction et les quatre booléens, et rien d’autre', () => {
    const result = actions(snapshot({ meetings: [meeting('m1')] }), 'm1', 'a');
    assert.deepEqual(Object.keys(result).sort(), ['canAccept', 'canCancel', 'canCounter', 'canDecline', 'direction']);
    for (const key of ['canAccept', 'canCancel', 'canCounter', 'canDecline']) assert.equal(typeof result[key], 'boolean', key);
  });

  describe('demande en attente', () => {
    const s = () => snapshot({ meetings: [meeting('m1')] });

    it('le demandeur : direction « sent », peut seulement annuler', () => {
      const result = actions(s(), 'm1', 'a');
      assert.equal(result.direction, 'sent');
      assert.deepEqual(flags(result), only(result, 'canCancel'));
    });

    it('la cible : direction « received », peut accepter, refuser et contre-proposer, pas annuler', () => {
      const result = actions(s(), 'm1', 'b');
      assert.equal(result.direction, 'received');
      assert.deepEqual(flags(result), only(result, 'canAccept', 'canDecline', 'canCounter'));
    });

    it('A-32 : fenêtre fermée, la cible ne peut plus accepter', () => {
      const result = actions(snapshot({ window: 'closed', meetings: [meeting('m1')] }), 'm1', 'b');
      assert.equal(result.canAccept, false);
    });

    it('créneau commencé, la cible ne peut plus accepter', () => {
      const result = actions(snapshot({ meetings: [meeting('m1', { slotId: 'past' })] }), 'm1', 'b');
      assert.equal(result.canAccept, false);
    });
  });

  describe('rendez-vous accepté : annulation par l’une ou l’autre partie jusqu’au début du créneau (R-16)', () => {
    const s = (now) => snapshot({ now, meetings: [accepted('m1', { tableNumber: 1 })] });
    const before = new Date('2026-12-03T09:44:59.999Z');

    it('le demandeur peut annuler, rien d’autre', () => {
      const result = actions(s(before), 'm1', 'a');
      assert.equal(result.direction, 'sent');
      assert.deepEqual(flags(result), only(result, 'canCancel'));
    });

    it('la cible peut annuler, rien d’autre', () => {
      const result = actions(s(before), 'm1', 'b');
      assert.equal(result.direction, 'received');
      assert.deepEqual(flags(result), only(result, 'canCancel'));
    });

    it('au début du créneau, plus personne ne peut annuler', () => {
      const started = new Date('2026-12-03T09:45:00.000Z');
      assert.equal(actions(s(started), 'm1', 'a').canCancel, false);
      assert.equal(actions(s(started), 'm1', 'b').canCancel, false);
    });

    it('après le début du créneau, plus personne ne peut annuler', () => {
      assert.equal(actions(s(new Date('2026-12-03T10:30:00.000Z')), 'm1', 'a').canCancel, false);
    });
  });

  for (const status of ['declined', 'cancelled', 'expired']) {
    it(`une demande ${status} n’offre aucun bouton`, () => {
      const s = snapshot({ meetings: [meeting('m1', { status })] });
      for (const viewerId of ['a', 'b']) assert.deepEqual(flags(actions(s, 'm1', viewerId)), only(null), `visiteur ${viewerId}`);
    });
  }

  describe('demande adressée à un exposant (A-31 : pas de contre-proposition depuis un exposant)', () => {
    const s = () =>
      snapshot({
        exhibitors: [exhibitorEntry('x1', { activeRepIds: ['r1', 'r2'] })],
        extraPeople: [person('r1', { role: 'exhibitor_rep', exhibitorId: 'x1' }), person('r2', { role: 'exhibitor_rep', exhibitorId: 'x1' })],
        meetings: [meeting('m1', { targetAttendeeId: null, targetExhibitorId: 'x1' })],
      });

    it('un représentant : « received », peut accepter et refuser, pas contre-proposer', () => {
      for (const viewerId of ['r1', 'r2']) {
        const result = actions(s(), 'm1', viewerId);
        assert.equal(result.direction, 'received');
        assert.deepEqual(flags(result), only(result, 'canAccept', 'canDecline'));
      }
    });

    it('le demandeur : « sent », peut seulement annuler', () => {
      const result = actions(s(), 'm1', 'a');
      assert.equal(result.direction, 'sent');
      assert.deepEqual(flags(result), only(result, 'canCancel'));
    });
  });
});
