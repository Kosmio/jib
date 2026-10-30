'use strict';

/**
 * Marqueur des tests d'abord (helpers/pending.js, lot 13) : `pending('lot N')` pose `todo` ; `TESTS_FIRST_STRICT` le retire pour
 * tous les groupes (`1`), pour un lot (`8`) ou pour une liste de lots (`8,9`).
 */

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { pending } = require('../helpers/pending');

const initial = process.env.TESTS_FIRST_STRICT;
const withStrict = (value, work) => {
  if (value === undefined) delete process.env.TESTS_FIRST_STRICT;
  else process.env.TESTS_FIRST_STRICT = value;
  return work();
};

afterEach(() => {
  if (initial === undefined) delete process.env.TESTS_FIRST_STRICT;
  else process.env.TESTS_FIRST_STRICT = initial;
});

describe('pending (helpers/pending.js)', () => {
  it('pose todo avec le lot d’activation quand la variable est absente', () => {
    const options = withStrict(undefined, () => pending('lot 8'));
    assert.equal(typeof options.todo, 'string');
    assert.match(options.todo, /lot 8/);
  });

  it('conserve les autres options du test', () => {
    const options = withStrict(undefined, () => pending('lot 8', { timeout: 5000 }));
    assert.equal(options.timeout, 5000);
    assert.ok(options.todo);
  });

  it('ne retire rien avec une valeur vide ou inconnue', () => {
    for (const value of ['', '0', 'oui', 'true']) assert.ok(withStrict(value, () => pending('lot 8')).todo, `valeur ${JSON.stringify(value)}`);
  });

  it('TESTS_FIRST_STRICT=1 rend tous les groupes stricts', () => {
    for (const lot of ['lot 8', 'lot 9', 'lot 11', 'lot 14']) assert.equal(withStrict('1', () => pending(lot)).todo, undefined, lot);
  });

  it('TESTS_FIRST_STRICT=8 rend strict le seul lot 8', () => {
    assert.equal(withStrict('8', () => pending('lot 8')).todo, undefined);
    assert.ok(withStrict('8', () => pending('lot 9')).todo);
    assert.ok(withStrict('8', () => pending('lot 14')).todo, '14 ne se confond pas avec 1 ni avec 8');
  });

  it('TESTS_FIRST_STRICT=8,9 rend stricts les lots 8 et 9, pas les autres', () => {
    assert.equal(withStrict('8,9', () => pending('lot 8')).todo, undefined);
    assert.equal(withStrict('8, 9', () => pending('lot 9')).todo, undefined);
    assert.ok(withStrict('8,9', () => pending('lot 11')).todo);
  });

  it('TESTS_FIRST_STRICT=14 ne rend pas strict le lot 1 ni le lot 4', () => {
    assert.equal(withStrict('14', () => pending('lot 14')).todo, undefined);
    assert.ok(withStrict('14', () => pending('lot 4')).todo);
  });
});
