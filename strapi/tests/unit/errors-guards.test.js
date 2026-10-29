'use strict';

/**
 * lib/errors.js et lib/guards.js (06-api.md, NF-01, I-23) : EspaceError(status, code, message, extra?),
 * requireSession(ctx) → 401 UNAUTHENTICATED, requireOrganizer(ctx, editionSlug) → 403 FORBIDDEN.
 * Tests d'abord du lot 2 : les modules sont requis dans chaque test.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { pending } = require('../helpers/pending');

const errors = () => require('../../src/api/espace/lib/errors');
const guards = () => require('../../src/api/espace/lib/guards');

const session = (overrides = {}) => ({
  attendee: { documentId: 'att-1' },
  edition: { slug: 'nouvelle-aquitaine-test', title: 'Nouvelle-Aquitaine (test)' },
  session: { documentId: 'sess-1' },
  isOrganizer: false,
  ...overrides,
});
const ctxWith = (espace) => ({ state: espace === undefined ? {} : { espace } });
const refusal = (status, code) => (error) => {
  assert.ok(error instanceof errors().EspaceError, `EspaceError attendue, reçu ${error?.constructor?.name} : ${error?.message}`);
  assert.equal(error.status, status);
  assert.equal(error.code, code);
  assert.ok(typeof error.message === 'string' && error.message.length > 0, 'message affichable');
  return true;
};

describe('EspaceError', pending('lot 2'), () => {
  it('est une Error qui porte status, code et message', () => {
    const error = new (errors().EspaceError)(409, 'SLOT_TAKEN', 'Ce créneau n’est plus disponible.');
    assert.ok(error instanceof Error);
    assert.equal(error.status, 409);
    assert.equal(error.code, 'SLOT_TAKEN');
    assert.equal(error.message, 'Ce créneau n’est plus disponible.');
  });

  it('accepte des champs supplémentaires facultatifs', () => {
    assert.doesNotThrow(() => new (errors().EspaceError)(400, 'VALIDATION', 'Champ invalide.', { fields: { firstName: 'Obligatoire.' } }));
  });

  it('se construit sans champs supplémentaires', () => {
    assert.doesNotThrow(() => new (errors().EspaceError)(404, 'EDITION_NOT_FOUND', 'Édition introuvable.'));
  });
});

describe('requireSession (NF-01)', pending('lot 2'), () => {
  it('renvoie ctx.state.espace quand une session est chargée', () => {
    const espace = session();
    assert.equal(guards().requireSession(ctxWith(espace)), espace);
  });

  it('lève 401 UNAUTHENTICATED sans session', () => {
    assert.throws(() => guards().requireSession(ctxWith(undefined)), refusal(401, 'UNAUTHENTICATED'));
  });

  it('lève 401 UNAUTHENTICATED si ctx.state.espace est nul', () => {
    assert.throws(() => guards().requireSession(ctxWith(null)), refusal(401, 'UNAUTHENTICATED'));
  });
});

describe('requireOrganizer (I-23, NF-01)', pending('lot 2'), () => {
  it('laisse passer un organisateur de la même édition', () => {
    const espace = session({ isOrganizer: true });
    assert.equal(guards().requireOrganizer(ctxWith(espace), 'nouvelle-aquitaine-test'), espace);
  });

  it('refuse un participant : 403 FORBIDDEN', () => {
    assert.throws(() => guards().requireOrganizer(ctxWith(session()), 'nouvelle-aquitaine-test'), refusal(403, 'FORBIDDEN'));
  });

  it('refuse un organisateur d’une autre édition : 403 FORBIDDEN', () => {
    const espace = session({ isOrganizer: true });
    assert.throws(() => guards().requireOrganizer(ctxWith(espace), 'bretagne-test'), refusal(403, 'FORBIDDEN'));
  });

  it('refuse sans session : 401 UNAUTHENTICATED', () => {
    assert.throws(() => guards().requireOrganizer(ctxWith(undefined), 'nouvelle-aquitaine-test'), refusal(401, 'UNAUTHENTICATED'));
  });
});
