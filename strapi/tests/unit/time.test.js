'use strict';

/**
 * lib/time.js (A-09, R-01) : horaires du programme en texte (« 9h15 », « 10h45 », « 9h », « -- »), conversion en UTC
 * avec Europe/Paris explicite, libellés « 9h45 ». Tests d'abord du lot 2 : le module est requis dans chaque test.
 * Les tests tournent sous TZ=UTC pour révéler toute dépendance au fuseau de la machine.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { pending } = require('../helpers/pending');

const time = () => require('../../src/api/espace/lib/time');

describe('parseProgramTime : formes admises du programme (R-01)', pending('lot 2'), () => {
  for (const [text, expected] of [
    ['9h15', { hours: 9, minutes: 15 }],
    ['10h45', { hours: 10, minutes: 45 }],
    ['9h', { hours: 9, minutes: 0 }],
    ['12h30', { hours: 12, minutes: 30 }],
    ['18h00', { hours: 18, minutes: 0 }],
    ['0h00', { hours: 0, minutes: 0 }],
    ['23h59', { hours: 23, minutes: 59 }],
  ]) {
    it(`lit « ${text} »`, () => {
      assert.deepEqual(time().parseProgramTime(text), expected);
    });
  }

  // « -- » est la valeur du programme réel pour une séquence sans horaire (11-questions-ouvertes.md).
  for (const text of ['--', '', ' ', 'bientôt', '9:15', '9 h 15', '25h00', '9h75', 'h30', '9h15h', '10h45-11h15', null, undefined, 915, {}]) {
    it(`renvoie null pour ${JSON.stringify(text) ?? 'undefined'}`, () => {
      assert.equal(time().parseProgramTime(text), null);
    });
  }
});

describe('zonedToUtc : date du jour et heure du programme en Europe/Paris', pending('lot 2'), () => {
  const utc = (dateIso, hours, minutes, timeZone) => time().zonedToUtc(dateIso, { hours, minutes }, timeZone).toISOString();

  it('renvoie un objet Date', () => {
    assert.ok(time().zonedToUtc('2026-12-03', { hours: 10, minutes: 45 }) instanceof Date);
  });

  it('prend Europe/Paris par défaut : 10h45 le 3 décembre (UTC+1) donne 09h45 UTC', () => {
    assert.equal(utc('2026-12-03', 10, 45), '2026-12-03T09:45:00.000Z');
  });

  it('applique l’heure d’été (UTC+2) : 9h le 1er juillet donne 07h00 UTC', () => {
    assert.equal(utc('2026-07-01', 9, 0), '2026-07-01T07:00:00.000Z');
  });

  // Les scripts de test posent TZ=UTC : un code qui lirait le fuseau de la machine se tromperait ici.
  it('ne dépend pas du fuseau de la machine : minuit à Paris est 23h00 UTC la veille', () => {
    assert.equal(utc('2026-12-03', 0, 0), '2026-12-02T23:00:00.000Z');
  });

  it('accepte un autre fuseau passé explicitement', () => {
    assert.equal(utc('2026-12-03', 9, 0, 'UTC'), '2026-12-03T09:00:00.000Z');
    assert.equal(utc('2026-12-03', 9, 0, 'America/New_York'), '2026-12-03T14:00:00.000Z');
  });

  describe('changement d’heure du printemps (29 mars 2026, 02h00 devient 03h00)', () => {
    it('garde l’heure d’hiver avant le saut : 01h30 donne 00h30 UTC', () => {
      assert.equal(utc('2026-03-29', 1, 30), '2026-03-29T00:30:00.000Z');
    });

    it('avance une heure inexistante de la durée du saut : 02h30 devient 03h30 Paris, soit 01h30 UTC', () => {
      assert.equal(utc('2026-03-29', 2, 30), '2026-03-29T01:30:00.000Z');
    });

    it('avance aussi 02h00 : 03h00 Paris, soit 01h00 UTC', () => {
      assert.equal(utc('2026-03-29', 2, 0), '2026-03-29T01:00:00.000Z');
    });

    it('applique l’heure d’été après le saut : 04h00 donne 02h00 UTC', () => {
      assert.equal(utc('2026-03-29', 4, 0), '2026-03-29T02:00:00.000Z');
    });
  });

  describe('changement d’heure de l’automne (25 octobre 2026, 03h00 devient 02h00)', () => {
    it('prend l’heure d’été avant le saut : 01h30 donne 23h30 UTC la veille', () => {
      assert.equal(utc('2026-10-25', 1, 30), '2026-10-24T23:30:00.000Z');
    });

    it('prend le premier instant d’une heure ambiguë : 02h30 vaut 02h30 d’été, soit 00h30 UTC', () => {
      assert.equal(utc('2026-10-25', 2, 30), '2026-10-25T00:30:00.000Z');
    });

    it('applique l’heure d’hiver après le saut : 03h30 donne 02h30 UTC', () => {
      assert.equal(utc('2026-10-25', 3, 30), '2026-10-25T02:30:00.000Z');
    });
  });
});

describe('formatTimeLabel : libellé « 9h45 » en Europe/Paris', pending('lot 2'), () => {
  const label = (iso, timeZone) => time().formatTimeLabel(new Date(iso), timeZone);

  it('écrit les heures sans zéro initial et les minutes sur deux chiffres', () => {
    assert.equal(label('2026-12-03T08:45:00Z'), '9h45');
    assert.equal(label('2026-12-03T08:00:00Z'), '9h00');
    assert.equal(label('2026-12-03T12:00:00Z'), '13h00');
  });

  it('suit l’heure d’été', () => {
    assert.equal(label('2026-07-01T11:00:00Z'), '13h00');
  });

  it('écrit minuit « 0h00 »', () => {
    assert.equal(label('2026-12-02T23:00:00Z'), '0h00');
  });

  it('accepte un autre fuseau', () => {
    assert.equal(label('2026-12-03T08:45:00Z', 'UTC'), '8h45');
  });

  it('redonne le libellé du programme après un aller-retour par zonedToUtc', () => {
    for (const [text, expected] of [['10h45', '10h45'], ['9h', '9h00'], ['12h30', '12h30'], ['15h45', '15h45']]) {
      const parsed = time().parseProgramTime(text);
      assert.equal(time().formatTimeLabel(time().zonedToUtc('2026-12-03', parsed)), expected);
    }
  });
});
