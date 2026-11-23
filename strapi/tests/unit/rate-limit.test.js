'use strict';

/**
 * lib/rate-limit.js (NF-03, T-04, F-02) : limiteur à fenêtre glissante, 5 demandes par 15 minutes par défaut.
 * `hit(key)` enregistre une demande et renvoie true si elle est admise, false si la limite est dépassée (hypothèse du
 * tester sur le sens du booléen, à confirmer). `now` est une fonction qui rend l'heure en millisecondes.
 * Tests d'abord du lot 5 : le module est requis dans chaque test.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');


const limiter = (options) => require('../../src/api/espace/lib/rate-limit').createRateLimiter(options);

/** Horloge contrôlée. `now()` rend un nombre enrichi de getTime et toISOString, pour qu'il serve d'heure sous l'une ou l'autre forme. */
function clock(startMs = Date.UTC(2026, 9, 29, 10, 0, 0)) {
  let ms = startMs;
  const value = () => Object.assign(new Number(ms), { getTime: () => ms, toISOString: () => new Date(ms).toISOString() });
  return { now: () => value(), advance: (delta) => { ms += delta; }, set: (next) => { ms = next; } };
}

const MINUTE = 60_000;

describe('createRateLimiter : valeurs par défaut (5 demandes par 15 minutes)', () => {
  it('admet 5 demandes puis refuse la 6e (T-04)', () => {
    const { now } = clock();
    const limit = limiter({ now });
    const results = Array.from({ length: 6 }, () => limit.hit('lea@example.org'));
    assert.deepEqual(results, [true, true, true, true, true, false]);
  });

  it('continue de refuser tant que la fenêtre n’est pas écoulée', () => {
    const time = clock();
    const limit = limiter({ now: time.now });
    for (let i = 0; i < 5; i += 1) limit.hit('k');
    time.advance(14 * MINUTE);
    assert.equal(limit.hit('k'), false);
    assert.equal(limit.hit('k'), false);
  });

  it('réadmet une demande quand la fenêtre de 15 minutes est écoulée', () => {
    const time = clock();
    const limit = limiter({ now: time.now });
    for (let i = 0; i < 5; i += 1) limit.hit('k');
    time.advance(15 * MINUTE + 1);
    assert.equal(limit.hit('k'), true);
  });

  it('compte chaque clé à part : e-mail et IP ne se gênent pas', () => {
    const { now } = clock();
    const limit = limiter({ now });
    for (let i = 0; i < 5; i += 1) limit.hit('a@example.org');
    assert.equal(limit.hit('a@example.org'), false);
    assert.equal(limit.hit('b@example.org'), true);
    assert.equal(limit.hit('ip:10.0.0.1'), true);
  });
});

describe('createRateLimiter : fenêtre glissante', () => {
  it('libère les demandes une à une, pas toutes à la fois', () => {
    const time = clock();
    const limit = limiter({ now: time.now });
    for (let i = 0; i < 3; i += 1) limit.hit('k'); // t = 0
    time.advance(10 * MINUTE);
    for (let i = 0; i < 2; i += 1) limit.hit('k'); // t = 10 min
    time.advance(4 * MINUTE);
    assert.equal(limit.hit('k'), false, 'à 14 minutes, la fenêtre porte encore 5 demandes');

    time.advance(1 * MINUTE + 1); // t = 15 min + 1 ms : les 3 premières sortent, 2 restent
    assert.deepEqual([limit.hit('k'), limit.hit('k'), limit.hit('k'), limit.hit('k')], [true, true, true, false]);
  });
});

describe('createRateLimiter : réglages et remise à zéro', () => {
  it('respecte max et windowMs', () => {
    const time = clock();
    const limit = limiter({ max: 2, windowMs: 1000, now: time.now });
    assert.deepEqual([limit.hit('k'), limit.hit('k'), limit.hit('k')], [true, true, false]);
    time.advance(1001);
    assert.equal(limit.hit('k'), true);
  });

  it('reset() efface tous les compteurs', () => {
    const { now } = clock();
    const limit = limiter({ now });
    for (let i = 0; i < 6; i += 1) limit.hit('k');
    assert.equal(limit.hit('k'), false);
    limit.reset();
    assert.equal(limit.hit('k'), true);
  });

  it('deux limiteurs ne partagent aucun état (l’instance appartient au service, jamais au module)', () => {
    const { now } = clock();
    const first = limiter({ now });
    const second = limiter({ now });
    for (let i = 0; i < 5; i += 1) first.hit('k');
    assert.equal(first.hit('k'), false);
    assert.equal(second.hit('k'), true);
  });

  it('le module ne crée pas d’instance au chargement : aucun export autre qu’une fabrique', () => {
    const exported = require('../../src/api/espace/lib/rate-limit');
    assert.equal(typeof exported.createRateLimiter, 'function');
    assert.equal(typeof exported.hit, 'undefined');
  });
});
