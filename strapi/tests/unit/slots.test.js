'use strict';

/**
 * lib/slots.js (R-01, R-02, A-09) : génération des créneaux d'après les séquences `kind = b2b_break` et plan de
 * régénération idempotent. Tests d'abord du lot 2 : le module est requis dans chaque test.
 *
 * Entrée des séquences : les champs du type `sequence` tels que Strapi les renvoie (`documentId`, `title`, `start_time`,
 * `end_time`, `kind`). Les instants `startsAt` et `endsAt` sont comparés en ISO UTC, qu'ils soient des Date ou des chaînes.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { pending } = require('../helpers/pending');

const slots = () => require('../../src/api/espace/lib/slots');

const iso = (value) => new Date(value).toISOString();
const sequence = (documentId, start_time, end_time, kind = 'b2b_break', title = `Séquence ${documentId}`) => ({ documentId, title, start_time, end_time, kind });

// Les trois pauses du programme Nouvelle-Aquitaine (10-recette.md).
const RECETTE = [
  sequence('pause-matin', '10h45', '11h15', 'b2b_break', 'Pause et B2B'),
  sequence('cocktail', '12h30', '14h00', 'b2b_break', 'Cocktail déjeunatoire & B2B'),
  sequence('pause-apres-midi', '15h30', '16h00', 'b2b_break', 'Pause et B2B'),
  sequence('accueil', '9h15', '9h45', 'other', 'Accueil et ouverture'),
  sequence('foret', '9h45', '10h45', 'talk', 'Forêt et adaptation'),
  { documentId: 'sans-kind', title: 'Sans kind', start_time: '11h15', end_time: '12h30' }, // aucun champ kind
  sequence('kind-null', '14h00', '15h30', null, 'Kind nul'),
];

const compute = (sessions, { date = '2026-12-03', durationMinutes = 15, timeZone = 'Europe/Paris' } = {}) =>
  slots().computeSlots({ date, durationMinutes, sessions, timeZone });
const byStart = (list) => [...list].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
const labels = (result) => byStart(result.slots).map((slot) => slot.label);

describe('computeSlots : exemple de R-01 (Nouvelle-Aquitaine, pas de 15 min)', pending('lot 2'), () => {
  it('donne les 10 créneaux 10h45, 11h00 ; 12h30 à 13h45 ; 15h30, 15h45', () => {
    assert.deepEqual(labels(compute(RECETTE)), ['10h45', '11h00', '12h30', '12h45', '13h00', '13h15', '13h30', '13h45', '15h30', '15h45']);
  });

  it('n’émet aucun avertissement sur le programme de la recette', () => {
    assert.deepEqual(compute(RECETTE).warnings, []);
  });

  it('ignore les séquences talk, other, sans kind et à kind nul (valeur nulle traitée comme talk)', () => {
    const result = compute(RECETTE.filter((s) => s.kind !== 'b2b_break'));
    assert.deepEqual(result, { slots: [], warnings: [] });
  });

  it('rattache chaque créneau à sa pause par sessionDocumentId', () => {
    const result = compute(RECETTE);
    const perSession = Object.groupBy(result.slots, (slot) => slot.sessionDocumentId);
    assert.deepEqual(Object.keys(perSession).sort(), ['cocktail', 'pause-apres-midi', 'pause-matin']);
    assert.equal(perSession['pause-matin'].length, 2);
    assert.equal(perSession.cocktail.length, 6);
    assert.equal(perSession['pause-apres-midi'].length, 2);
  });

  it('place les instants en UTC d’après l’heure de Paris : 10h45 le 3 décembre est 09h45 UTC', () => {
    const [first] = byStart(compute(RECETTE).slots);
    assert.equal(iso(first.startsAt), '2026-12-03T09:45:00.000Z');
    assert.equal(iso(first.endsAt), '2026-12-03T10:00:00.000Z');
  });

  it('donne à chaque créneau une durée égale au pas', () => {
    for (const slot of compute(RECETTE).slots) {
      assert.equal(new Date(slot.endsAt) - new Date(slot.startsAt), 15 * 60_000, slot.label);
    }
  });

  it('termine le dernier créneau de chaque pause au plus tard à sa fin', () => {
    const ends = new Map([['pause-matin', '2026-12-03T10:15:00.000Z'], ['cocktail', '2026-12-03T13:00:00.000Z'], ['pause-apres-midi', '2026-12-03T15:00:00.000Z']]);
    for (const slot of compute(RECETTE).slots) {
      assert.ok(new Date(slot.endsAt) <= new Date(ends.get(slot.sessionDocumentId)), `${slot.label} dépasse la fin de ${slot.sessionDocumentId}`);
    }
  });

  it('ne dépend pas de l’ordre des séquences reçues', () => {
    const forward = labels(compute(RECETTE));
    assert.deepEqual(labels(compute([...RECETTE].reverse())), forward);
  });

  it('est déterministe et ne modifie pas ses entrées', () => {
    const input = structuredClone(RECETTE);
    const first = compute(input);
    assert.deepEqual(input, RECETTE);
    assert.deepEqual(compute(input), first);
  });

  it('calcule les libellés en heure de Paris à l’heure d’été (29 mars 2026, 12h30 donne 10h30 UTC)', () => {
    const result = compute([sequence('ete', '12h30', '13h00')], { date: '2026-03-29' });
    assert.deepEqual(labels(result), ['12h30', '12h45']);
    assert.equal(iso(byStart(result.slots)[0].startsAt), '2026-03-29T10:30:00.000Z');
  });
});

describe('computeSlots : durée du pas et bornes (R-01)', pending('lot 2'), () => {
  it('ne garde pas un dernier créneau qui dépasserait la fin : 10h45 à 11h10, pas de 15 min, un seul créneau', () => {
    assert.deepEqual(labels(compute([sequence('a', '10h45', '11h10')])), ['10h45']);
  });

  it('accepte une pause égale au pas : un créneau', () => {
    assert.deepEqual(labels(compute([sequence('a', '10h45', '11h00')])), ['10h45']);
  });

  it('suit slotDurationMinutes : 30 minutes donnent 10h45 et 11h15 sur une pause de 10h45 à 11h45', () => {
    assert.deepEqual(labels(compute([sequence('a', '10h45', '11h45')], { durationMinutes: 30 })), ['10h45', '11h15']);
  });

  it('accepte une pause qui commence par une forme sans minutes (« 9h »)', () => {
    assert.deepEqual(labels(compute([sequence('a', '9h', '9h30')])), ['9h00', '9h15']);
  });
});

describe('computeSlots : avertissements pour l’organisateur (R-01, R-02)', pending('lot 2'), () => {
  const warningsOf = (sessions) => compute(sessions).warnings;

  it('MISSING_END : pause sans heure de fin (absente, nulle ou vide), aucun créneau', () => {
    for (const end of [undefined, null, '']) {
      const result = compute([sequence('sans-fin', '10h45', end, 'b2b_break', 'Pause sans fin')]);
      assert.deepEqual(result.slots, [], `fin ${JSON.stringify(end)}`);
      assert.deepEqual(result.warnings, [{ sessionDocumentId: 'sans-fin', title: 'Pause sans fin', code: 'MISSING_END' }], `fin ${JSON.stringify(end)}`);
    }
  });

  it('INVALID_TIME : début « -- » ou illisible', () => {
    for (const start of ['--', 'bientôt', '']) {
      const warnings = warningsOf([sequence('x', start, '11h15', 'b2b_break', 'Pause')]);
      assert.deepEqual(warnings.map((w) => [w.sessionDocumentId, w.code]), [['x', 'INVALID_TIME']], `début ${JSON.stringify(start)}`);
    }
  });

  it('INVALID_TIME : fin illisible', () => {
    const warnings = warningsOf([sequence('x', '10h45', 'vers midi')]);
    assert.deepEqual(warnings.map((w) => [w.sessionDocumentId, w.code]), [['x', 'INVALID_TIME']]);
  });

  it('TOO_SHORT : pause plus courte que le pas (10 minutes pour 15), aucun créneau', () => {
    const result = compute([sequence('court', '10h45', '10h55', 'b2b_break', 'Pause courte')]);
    assert.deepEqual(result.slots, []);
    assert.deepEqual(result.warnings, [{ sessionDocumentId: 'court', title: 'Pause courte', code: 'TOO_SHORT' }]);
  });

  it('signale une fin antérieure au début (INVALID_TIME ou TOO_SHORT), sans créneau', () => {
    const result = compute([sequence('renverse', '11h15', '10h45')]);
    assert.deepEqual(result.slots, []);
    assert.equal(result.warnings.length, 1);
    assert.ok(['INVALID_TIME', 'TOO_SHORT'].includes(result.warnings[0].code), result.warnings[0].code);
  });

  it('OVERLAP : deux pauses qui se chevauchent, sans deux créneaux au même instant', () => {
    const result = compute([sequence('a', '10h45', '11h15'), sequence('b', '11h00', '11h30')]);
    assert.ok(result.warnings.some((w) => w.code === 'OVERLAP'), JSON.stringify(result.warnings));
    const starts = result.slots.map((slot) => iso(slot.startsAt));
    assert.equal(new Set(starts).size, starts.length, 'deux créneaux commencent au même instant');
  });

  it('ne signale rien pour deux pauses qui se suivent sans se chevaucher', () => {
    assert.deepEqual(compute([sequence('a', '10h45', '11h15'), sequence('b', '11h15', '11h45')]).warnings, []);
  });

  it('les séquences qui ne sont pas des pauses B2B ne produisent jamais d’avertissement, même sans horaire', () => {
    assert.deepEqual(compute([sequence('t', '--', undefined, 'talk'), sequence('o', '--', undefined, 'other')]), { slots: [], warnings: [] });
  });

  it('continue la génération des autres pauses quand l’une est en défaut', () => {
    const result = compute([sequence('bonne', '10h45', '11h15'), sequence('sans-fin', '12h30', undefined, 'b2b_break', 'Sans fin')]);
    assert.deepEqual(labels(result), ['10h45', '11h00']);
    assert.deepEqual(result.warnings.map((w) => w.code), ['MISSING_END']);
  });
});

/**
 * planSlots (R-02). `existing` : créneaux déjà en base, avec le nombre de rendez-vous `pending` ou `accepted`
 * (`activeMeetings`). Les créneaux voulus viennent de computeSlots, donc dans la même représentation.
 */
describe('planSlots : régénération idempotente (R-02)', pending('lot 2'), () => {
  const wantedSlots = () => compute(RECETTE).slots;
  const asExisting = (list, overrides = {}) =>
    list.map((slot, index) => ({ ...slot, id: `s${index}`, documentId: `s${index}`, activeMeetings: 0, ...overrides }));
  const plan = (wanted, existing) => slots().planSlots({ wanted, existing });
  const idOf = (item) => item.documentId ?? item.id;
  const startsOf = (list) => list.map((slot) => iso(slot.startsAt)).sort();

  it('crée tout sur une édition sans créneau', () => {
    const wanted = wantedSlots();
    const result = plan(wanted, []);
    assert.equal(result.create.length, 10);
    assert.deepEqual([result.keep, result.remove, result.orphans], [[], [], []]);
    assert.deepEqual(startsOf(result.create), startsOf(wanted));
  });

  it('ne fait rien quand les créneaux existent déjà (second passage : 0 création, 0 suppression)', () => {
    const wanted = wantedSlots();
    const result = plan(wanted, asExisting(wanted));
    assert.equal(result.keep.length, 10);
    assert.deepEqual([result.create, result.remove, result.orphans], [[], [], []]);
  });

  it('conserve un créneau voulu même s’il porte des rendez-vous', () => {
    const wanted = wantedSlots();
    const existing = asExisting(wanted, { activeMeetings: 3 });
    const result = plan(wanted, existing);
    assert.equal(result.keep.length, 10);
    assert.deepEqual(result.orphans, []);
  });

  it('ne crée que les créneaux manquants', () => {
    const wanted = wantedSlots();
    const result = plan(wanted, asExisting(wanted.slice(2)));
    assert.deepEqual(startsOf(result.create), startsOf(wanted.slice(0, 2)));
    assert.equal(result.keep.length, 8);
  });

  it('supprime un créneau qui ne correspond plus à une pause et n’a aucun rendez-vous actif', () => {
    const wanted = wantedSlots();
    const existing = asExisting(wanted);
    const result = plan(wanted.slice(1), existing);
    assert.deepEqual(result.remove.map(idOf), ['s0']);
    assert.deepEqual(result.orphans, []);
    assert.equal(result.keep.length, 9);
  });

  it('n’efface jamais un créneau qui a des rendez-vous actifs : il devient orphelin (R-02)', () => {
    const wanted = wantedSlots();
    const existing = asExisting(wanted);
    existing[0].activeMeetings = 1;
    const result = plan(wanted.slice(1), existing);
    assert.deepEqual(result.orphans.map(idOf), ['s0']);
    assert.deepEqual(result.remove, []);
  });

  it('range à part orphelins et supprimables dans un même passage', () => {
    const wanted = wantedSlots();
    const existing = asExisting(wanted);
    existing[0].activeMeetings = 2;
    const result = plan(wanted.slice(2), existing);
    assert.deepEqual(result.orphans.map(idOf), ['s0']);
    assert.deepEqual(result.remove.map(idOf), ['s1']);
    assert.equal(result.keep.length, 8);
  });

  it('traite comme un autre créneau celui dont la fin change (pas de 15 à 20 minutes) : ancien retiré, nouveau créé', () => {
    const quarter = compute([sequence('a', '10h45', '11h45')]).slots;
    const twenty = compute([sequence('a', '10h45', '11h45')], { durationMinutes: 20 }).slots;
    const result = plan(twenty, asExisting(quarter));
    assert.equal(result.create.length, twenty.length);
    assert.equal(result.remove.length + result.orphans.length, quarter.length);
    assert.deepEqual(result.keep, []);
  });

  it('traite comme un autre créneau celui qui change de pause à heures égales', () => {
    const before = compute([sequence('ancienne', '10h45', '11h15')]).slots;
    const after = compute([sequence('nouvelle', '10h45', '11h15')]).slots;
    const result = plan(after, asExisting(before));
    assert.equal(result.create.length, 2);
    assert.equal(result.remove.length, 2);
    assert.deepEqual(result.keep, []);
  });

  it('ne compte pour orphelin que les rendez-vous pending et accepted : activeMeetings à 0 pour les autres statuts', () => {
    const wanted = wantedSlots();
    const existing = asExisting(wanted, { activeMeetings: 0 });
    const result = plan([], existing);
    assert.equal(result.remove.length, 10);
    assert.deepEqual(result.orphans, []);
  });

  it('est idempotent : appliquer le plan puis replanifier ne donne plus rien à faire', () => {
    const wanted = wantedSlots();
    const first = plan(wanted, asExisting(wanted.slice(0, 4)));
    const afterApplying = asExisting([...first.keep, ...first.create].map((slot) => ({ ...slot })));
    const second = plan(wanted, afterApplying);
    assert.deepEqual([second.create, second.remove, second.orphans], [[], [], []]);
    assert.equal(second.keep.length, 10);
  });
});
