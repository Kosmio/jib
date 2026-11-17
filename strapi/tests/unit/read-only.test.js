'use strict';

/**
 * Lecture seule après l'événement (V4-F : NF-70), lib/read-only.js : `readOnlyAt` de l'édition, sinon sa date + 7 jours à 00:00 UTC
 * (calculé, jamais écrit) ; sans l'un ni l'autre, jamais en lecture seule. L'instant exact compte comme terminé (<=).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { isReadOnly, readOnlyAt } = require('../../src/api/espace/lib/read-only');

const at = (value) => new Date(value);

describe('readOnlyAt : l’instant de bascule', () => {
  it('valeur par défaut : la date de l’édition + 7 jours, à 00:00 UTC', () => {
    assert.equal(readOnlyAt({ date: '2026-12-03' }).toISOString(), '2026-12-10T00:00:00.000Z');
  });

  it('le champ readOnlyAt l’emporte sur la valeur par défaut', () => {
    assert.equal(readOnlyAt({ date: '2026-12-03', readOnlyAt: '2026-12-04T18:00:00.000Z' }).toISOString(), '2026-12-04T18:00:00.000Z');
  });

  it('le défaut passe le changement de mois et d’année', () => {
    assert.equal(readOnlyAt({ date: '2026-12-28' }).toISOString(), '2027-01-04T00:00:00.000Z');
  });

  it('sans readOnlyAt ni date, ou avec une date illisible : null', () => {
    assert.equal(readOnlyAt({}), null);
    assert.equal(readOnlyAt(null), null);
    assert.equal(readOnlyAt({ date: 'pas une date' }), null);
  });

  it('ne modifie pas l’édition reçue', () => {
    const edition = { date: '2026-12-03' };
    readOnlyAt(edition);
    assert.deepEqual(edition, { date: '2026-12-03' });
  });
});

describe('isReadOnly : avant, à l’instant, après', () => {
  const edition = { date: '2026-12-03' };

  it('avant la bascule par défaut (la veille de J+7 à 23:59:59 UTC) : faux', () => {
    assert.equal(isReadOnly(edition, at('2026-12-09T23:59:59Z')), false);
  });

  it('à l’instant exact J+7 00:00 UTC : vrai', () => {
    assert.equal(isReadOnly(edition, at('2026-12-10T00:00:00Z')), true);
  });

  it('après : vrai', () => {
    assert.equal(isReadOnly(edition, at('2027-03-01T00:00:00Z')), true);
  });

  it('le jour de l’événement et les jours qui suivent jusqu’à J+6 : faux', () => {
    for (const day of ['2026-12-03T12:00:00Z', '2026-12-05T12:00:00Z', '2026-12-09T12:00:00Z']) assert.equal(isReadOnly(edition, at(day)), false, day);
  });

  it('readOnlyAt explicite : la bascule suit ce champ, pas la date (plus tôt comme plus tard)', () => {
    const early = { date: '2026-12-03', readOnlyAt: '2026-12-04T00:00:00Z' };
    const late = { date: '2026-12-03', readOnlyAt: '2026-12-20T00:00:00Z' };
    assert.equal(isReadOnly(early, at('2026-12-05T00:00:00Z')), true);
    assert.equal(isReadOnly(late, at('2026-12-12T00:00:00Z')), false);
  });

  it('sans date ni readOnlyAt : jamais en lecture seule', () => {
    assert.equal(isReadOnly({}, at('2100-01-01T00:00:00Z')), false);
    assert.equal(isReadOnly(undefined), false);
  });

  it('sans instant donné, utilise l’horloge : une édition de 2020 est terminée, une de 2100 non', () => {
    assert.equal(isReadOnly({ date: '2020-01-01' }), true);
    assert.equal(isReadOnly({ date: '2100-01-01' }), false);
  });
});
