'use strict';

/**
 * lib/meetings.js, briques de base (lot 8, tests d'abord) : `parseTarget`, `requestWindow` (R-17, A-32), `hostedTables` (R-19, A-29)
 * et `assertTransition` (R-10). Contrats : section 3.1 du plan des phases 2 et 3. Aucune base, aucun Strapi.
 *
 * Écarts d'interprétation consignés dans tests/SPEC.md :
 *   - `assertTransition(status, action)` : actions `accept`, `decline`, `cancel`, `expire` (les verbes des routes, plus l'expiration) ;
 *   - `hostedTables(attendees, tablesCount)` : lignes d'Attendee `{ id (numérique), documentId, role, status, hostedTableNumber }`,
 *     clés de `hosted` = documentId (A-28, « tout identifiant est un documentId ») ;
 *   - `requestWindow` : `now` est un `Date` ; `openAt` et `closeAt` rendus en `Date` ou `null`.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { pending } = require('../helpers/pending');
const { EspaceError } = require('../../src/api/espace/lib/errors');

const meetings = () => require('../../src/api/espace/lib/meetings');
const iso = (value) => (value == null ? null : new Date(value).toISOString());

describe('parseTarget : « p:{id} » ou « x:{id} » (06-api, POST /meetings et GET /slots)', pending('lot 8'), () => {
  it('lit une personne', () => {
    assert.deepEqual(meetings().parseTarget('p:abc123'), { kind: 'p', id: 'abc123' });
  });

  it('lit un exposant', () => {
    assert.deepEqual(meetings().parseTarget('x:xyz789'), { kind: 'x', id: 'xyz789' });
  });

  it('garde le documentId tel quel (chiffres, minuscules, 24 caractères)', () => {
    const documentId = 'k3j9d0sfn2l8m1q7r6t5y4uw';
    assert.deepEqual(meetings().parseTarget(`p:${documentId}`), { kind: 'p', id: documentId });
  });

  for (const text of ['', 'p:', 'x:', 'p', 'abc', 'z:abc', 'q:123', ':abc', 'p:a:b', 'p: abc', 'p:ab c', 'p:abc ', ' p:abc', 'P:abc', 'pp:abc', 'p;abc', 'p/abc', 'p:../x']) {
    it(`refuse ${JSON.stringify(text)} (null)`, () => {
      assert.equal(meetings().parseTarget(text), null);
    });
  }

  for (const value of [undefined, null, 42, true, {}, [], ['p:abc'], { kind: 'p', id: 'abc' }]) {
    it(`refuse une valeur qui n’est pas un texte : ${JSON.stringify(value) ?? 'undefined'}`, () => {
      assert.equal(meetings().parseTarget(value), null);
    });
  }
});

describe('requestWindow : fenêtre de prise de rendez-vous (R-17, F-55, A-32)', pending('lot 8'), () => {
  const EDITION = { date: '2026-12-03', meetingRequestsOpenAt: '2026-10-01T08:00:00.000Z', meetingRequestsCloseAt: '2026-12-02T17:00:00.000Z' };
  const window = (edition, now) => meetings().requestWindow(edition, new Date(now));

  it('est ouverte entre l’ouverture et la fermeture', () => {
    assert.equal(window(EDITION, '2026-11-25T10:00:00.000Z').state, 'open');
  });

  it('n’est pas encore ouverte avant meetingRequestsOpenAt, et l’est une milliseconde après', () => {
    assert.equal(window(EDITION, '2026-10-01T07:59:59.999Z').state, 'not_open');
    assert.equal(window(EDITION, '2026-10-01T08:00:00.001Z').state, 'open');
  });

  it('est fermée à partir de meetingRequestsCloseAt, et ouverte une milliseconde avant', () => {
    assert.equal(window(EDITION, '2026-12-02T16:59:59.999Z').state, 'open');
    assert.equal(window(EDITION, '2026-12-02T17:00:00.001Z').state, 'closed');
  });

  it('est fermée le jour de l’événement et après', () => {
    assert.equal(window(EDITION, '2026-12-03T08:00:00.000Z').state, 'closed');
    assert.equal(window(EDITION, '2027-01-15T08:00:00.000Z').state, 'closed');
  });

  it('rend les bornes ouverture et fermeture', () => {
    const result = window(EDITION, '2026-11-25T10:00:00.000Z');
    assert.equal(iso(result.openAt), '2026-10-01T08:00:00.000Z');
    assert.equal(iso(result.closeAt), '2026-12-02T17:00:00.000Z');
  });

  describe('meetingRequestsOpenAt vide : ouverte sans borne basse (A-32)', () => {
    const edition = { ...EDITION, meetingRequestsOpenAt: null };

    it('est ouverte très tôt', () => {
      assert.equal(window(edition, '2020-01-01T00:00:00.000Z').state, 'open');
    });

    it('rend openAt à null', () => {
      assert.equal(window(edition, '2026-11-25T10:00:00.000Z').openAt ?? null, null);
    });

    it('une valeur absente (undefined) vaut null', () => {
      assert.equal(window({ ...EDITION, meetingRequestsOpenAt: undefined }, '2020-01-01T00:00:00.000Z').state, 'open');
    });
  });

  describe('meetingRequestsCloseAt vide : veille de Edition.date à 18h00 Europe/Paris (A-32, zonedToUtc)', () => {
    it('hiver : le 2 décembre 2026 à 18h00 est 17h00 UTC', () => {
      const edition = { date: '2026-12-03', meetingRequestsOpenAt: null, meetingRequestsCloseAt: null };
      assert.equal(iso(window(edition, '2026-11-25T10:00:00.000Z').closeAt), '2026-12-02T17:00:00.000Z');
      assert.equal(window(edition, '2026-12-02T16:59:00.000Z').state, 'open');
      assert.equal(window(edition, '2026-12-02T17:01:00.000Z').state, 'closed');
    });

    it('été : le 23 juin 2026 à 18h00 est 16h00 UTC', () => {
      const edition = { date: '2026-06-24', meetingRequestsOpenAt: null, meetingRequestsCloseAt: null };
      assert.equal(iso(window(edition, '2026-06-01T10:00:00.000Z').closeAt), '2026-06-23T16:00:00.000Z');
      assert.equal(window(edition, '2026-06-23T15:59:00.000Z').state, 'open');
      assert.equal(window(edition, '2026-06-23T16:01:00.000Z').state, 'closed');
    });

    it('veille à cheval sur le changement d’heure d’automne : le 24 octobre 2026 à 18h00 est 16h00 UTC (CEST) pour une édition le 25', () => {
      const edition = { date: '2026-10-25', meetingRequestsOpenAt: null, meetingRequestsCloseAt: null };
      assert.equal(iso(window(edition, '2026-10-01T10:00:00.000Z').closeAt), '2026-10-24T16:00:00.000Z');
    });

    it('une fermeture explicite l’emporte sur la valeur par défaut', () => {
      const edition = { date: '2026-12-03', meetingRequestsOpenAt: null, meetingRequestsCloseAt: '2026-11-30T12:00:00.000Z' };
      assert.equal(iso(window(edition, '2026-11-01T10:00:00.000Z').closeAt), '2026-11-30T12:00:00.000Z');
      assert.equal(window(edition, '2026-12-01T10:00:00.000Z').state, 'closed');
    });
  });

  it('ne modifie pas l’édition reçue', () => {
    const copy = structuredClone(EDITION);
    window(EDITION, '2026-11-25T10:00:00.000Z');
    assert.deepEqual(EDITION, copy);
  });
});

describe('hostedTables : tables dédiées des intervenants (R-19, A-29)', pending('lot 8'), () => {
  const row = (n, fields = {}) => ({ id: n, documentId: `doc${n}`, role: 'speaker', status: 'active', hostedTableNumber: null, ...fields });
  const hostedTables = (rows, tablesCount = 3) => meetings().hostedTables(rows, tablesCount);
  const entries = (result) => Object.fromEntries(result.hosted);
  const codes = (result) => result.warnings.map((warning) => warning.code).sort();

  it('retient le numéro d’un intervenant actif, entre 1 et tablesCount', () => {
    const result = hostedTables([row(1, { hostedTableNumber: 2 })]);
    assert.deepEqual(entries(result), { doc1: 2 });
    assert.deepEqual(result.warnings, []);
  });

  it('retient la première et la dernière table', () => {
    const result = hostedTables([row(1, { hostedTableNumber: 1 }), row(2, { hostedTableNumber: 3 })]);
    assert.deepEqual(entries(result), { doc1: 1, doc2: 3 });
  });

  it('rend une Map', () => {
    assert.ok(hostedTables([]).hosted instanceof Map);
    assert.deepEqual(hostedTables([]).warnings, []);
  });

  it('ignore sans avertissement un intervenant sans numéro', () => {
    for (const hostedTableNumber of [null, undefined]) {
      const result = hostedTables([row(1, { hostedTableNumber })]);
      assert.deepEqual(entries(result), {});
      assert.deepEqual(result.warnings, []);
    }
  });

  describe('HOSTED_TABLE_INVALID : numéro non entier ou hors de 1 à tablesCount', () => {
    for (const hostedTableNumber of [0, -1, 4, 99, 2.5]) {
      it(`ignore ${hostedTableNumber} avec tablesCount 3 et le signale`, () => {
        const result = hostedTables([row(1, { hostedTableNumber })]);
        assert.deepEqual(entries(result), {});
        assert.deepEqual(codes(result), ['HOSTED_TABLE_INVALID']);
      });
    }

    it('un numéro valable pour 20 tables ne l’est plus pour 3', () => {
      assert.deepEqual(entries(hostedTables([row(1, { hostedTableNumber: 12 })], 20)), { doc1: 12 });
      assert.deepEqual(codes(hostedTables([row(1, { hostedTableNumber: 12 })], 3)), ['HOSTED_TABLE_INVALID']);
    });
  });

  describe('HOSTED_TABLE_CONFLICT : deux intervenants sur le même numéro, le plus petit id le garde', () => {
    it('garde id 3 et ignore id 5', () => {
      const result = hostedTables([row(5, { hostedTableNumber: 2 }), row(3, { hostedTableNumber: 2 })]);
      assert.deepEqual(entries(result), { doc3: 2 });
      assert.deepEqual(codes(result), ['HOSTED_TABLE_CONFLICT']);
    });

    it('ne dépend pas de l’ordre des lignes', () => {
      const forward = hostedTables([row(3, { hostedTableNumber: 2 }), row(5, { hostedTableNumber: 2 })]);
      const backward = hostedTables([row(5, { hostedTableNumber: 2 }), row(3, { hostedTableNumber: 2 })]);
      assert.deepEqual(entries(forward), entries(backward));
    });

    it('trois intervenants sur la même table : un seul gardé, deux avertissements', () => {
      const result = hostedTables([row(7, { hostedTableNumber: 1 }), row(2, { hostedTableNumber: 1 }), row(9, { hostedTableNumber: 1 })]);
      assert.deepEqual(entries(result), { doc2: 1 });
      assert.deepEqual(codes(result), ['HOSTED_TABLE_CONFLICT', 'HOSTED_TABLE_CONFLICT']);
    });

    it('compare l’id numérique, pas l’ordre alphabétique du documentId', () => {
      const result = hostedTables([
        { id: 10, documentId: 'aaa', role: 'speaker', status: 'active', hostedTableNumber: 2 },
        { id: 9, documentId: 'zzz', role: 'speaker', status: 'active', hostedTableNumber: 2 },
      ]);
      assert.deepEqual(entries(result), { zzz: 2 });
    });

    it('un conflit n’empêche pas les autres tables', () => {
      const result = hostedTables([row(1, { hostedTableNumber: 2 }), row(2, { hostedTableNumber: 2 }), row(3, { hostedTableNumber: 3 })]);
      assert.deepEqual(entries(result), { doc1: 2, doc3: 3 });
    });
  });

  describe('seuls les Attendee actifs de rôle speaker comptent', () => {
    it('ignore un participant qui porte un numéro', () => {
      assert.deepEqual(entries(hostedTables([row(1, { role: 'participant', hostedTableNumber: 2 })])), {});
    });

    it('ignore un représentant d’exposant et un organisateur', () => {
      assert.deepEqual(entries(hostedTables([row(1, { role: 'exhibitor_rep', hostedTableNumber: 1 }), row(2, { role: 'organizer', hostedTableNumber: 2 })])), {});
    });

    it('ignore un intervenant annulé', () => {
      assert.deepEqual(entries(hostedTables([row(1, { status: 'cancelled', hostedTableNumber: 2 })])), {});
    });

    it('un annulé ne prend pas le numéro d’un actif : pas de conflit', () => {
      const result = hostedTables([row(1, { status: 'cancelled', hostedTableNumber: 2 }), row(2, { hostedTableNumber: 2 })]);
      assert.deepEqual(entries(result), { doc2: 2 });
      assert.deepEqual(result.warnings, []);
    });
  });

  it('lot commun : tablesCount moins les numéros retenus (exemple de la recette, tables 1 et 3)', () => {
    const { hosted } = hostedTables([row(1, { hostedTableNumber: 2 })], 3);
    const common = [1, 2, 3].filter((table) => ![...hosted.values()].includes(table));
    assert.deepEqual(common, [1, 3]);
  });

  it('ne modifie pas les lignes reçues', () => {
    const rows = [row(5, { hostedTableNumber: 2 }), row(3, { hostedTableNumber: 2 })];
    const copy = structuredClone(rows);
    hostedTables(rows);
    assert.deepEqual(rows, copy);
  });
});

describe('assertTransition : cycle de vie d’un rendez-vous (R-10)', pending('lot 8'), () => {
  const attempt = (status, action) => () => meetings().assertTransition(status, action);
  const isInvalidTransition = (error) => {
    assert.ok(error instanceof EspaceError, 'EspaceError attendue');
    assert.equal(error.status, 409);
    assert.equal(error.code, 'INVALID_TRANSITION');
    return true;
  };

  const ALLOWED = [
    ['pending', 'accept'],
    ['pending', 'decline'],
    ['pending', 'cancel'],
    ['pending', 'expire'],
    ['accepted', 'cancel'],
  ];
  for (const [status, action] of ALLOWED) {
    it(`autorise ${status} -> ${action}`, () => {
      assert.doesNotThrow(attempt(status, action));
    });
  }

  const FORBIDDEN = [
    ['accepted', 'accept'],
    ['accepted', 'decline'],
    ['accepted', 'expire'],
    ...['declined', 'cancelled', 'expired'].flatMap((status) => ['accept', 'decline', 'cancel', 'expire'].map((action) => [status, action])),
  ];
  for (const [status, action] of FORBIDDEN) {
    it(`refuse ${status} -> ${action} par 409 INVALID_TRANSITION`, () => {
      assert.throws(attempt(status, action), isInvalidTransition);
    });
  }

  it('refuse une action inconnue', () => {
    assert.throws(attempt('pending', 'archive'), isInvalidTransition);
  });

  it('refuse un statut inconnu', () => {
    assert.throws(attempt('brouillon', 'accept'), isInvalidTransition);
  });
});
