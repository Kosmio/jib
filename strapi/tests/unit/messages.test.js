'use strict';

/**
 * lib/messages.js (lot 14 ; R-62, R-64, F-72, A-37, T-31, T-32) : règles pures de la messagerie, sans Strapi.
 *   - `notificationsDue` : quels e-mails `new-message` partent maintenant (non lu depuis 5 min, jamais notifié, rien pour la paire
 *     depuis 30 min, préférence `messages` active, un seul e-mail par conversation et destinataire) ;
 *   - `excerpt`, `validateBody` (F-72 : 2 000 caractères), `canonicalPair` (A-37 : l'ordre des `id`), constantes de R-62 et R-64.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  BODY_MAX_LENGTH,
  EXCERPT_LENGTH,
  MESSAGE_LIMIT,
  MESSAGE_WINDOW_MS,
  QUIET_DELAY_MS,
  UNREAD_DELAY_MS,
  canonicalPair,
  excerpt,
  notificationsDue,
  pairKey,
  validateBody,
} = require('../../src/api/espace/lib/messages');

const MINUTE = 60_000;
const NOW = new Date('2026-11-20T10:00:00.000Z');
const ago = (minutes) => new Date(NOW.getTime() - minutes * MINUTE).toISOString();
const message = (id, overrides = {}) => ({ id, conversationId: 'c1', recipientId: 'lea', createdAt: ago(10), readAt: null, emailNotifiedAt: null, ...overrides });
const due = (messages, extra = {}) => notificationsDue({ messages, now: NOW, ...extra });

describe('constantes de R-62, R-64 et F-72', () => {
  it('5 minutes non lu, 30 minutes entre deux e-mails, 30 messages par heure, 2 000 caractères, extrait de 200', () => {
    assert.equal(UNREAD_DELAY_MS, 5 * MINUTE);
    assert.equal(QUIET_DELAY_MS, 30 * MINUTE);
    assert.equal(MESSAGE_LIMIT, 30);
    assert.equal(MESSAGE_WINDOW_MS, 60 * MINUTE);
    assert.equal(BODY_MAX_LENGTH, 2000);
    assert.equal(EXCERPT_LENGTH, 200);
  });
});

describe('notificationsDue : le délai de 5 minutes (R-62, T-31)', () => {
  it('un message non lu depuis 6 minutes est dû', () => {
    assert.deepEqual(due([message('m1', { createdAt: ago(6) })]), [{ conversationId: 'c1', recipientId: 'lea', messageIds: ['m1'] }]);
  });

  it('exactement 5 minutes : dû', () => {
    assert.equal(due([message('m1', { createdAt: ago(5) })]).length, 1);
  });

  it('4 minutes 59 secondes : pas encore', () => {
    assert.deepEqual(due([message('m1', { createdAt: new Date(NOW.getTime() - 5 * MINUTE + 1000).toISOString() })]), []);
  });

  it('un message lu n’est pas dû', () => {
    assert.deepEqual(due([message('m1', { readAt: ago(8) })]), []);
  });

  it('un message déjà notifié n’est pas dû une seconde fois', () => {
    assert.deepEqual(due([message('m1', { emailNotifiedAt: ago(40) })]), []);
  });

  it('aucun message : rien', () => {
    assert.deepEqual(due([]), []);
  });

  it('accepte des instants en Date comme en texte', () => {
    assert.equal(due([message('m1', { createdAt: new Date(NOW.getTime() - 9 * MINUTE) })]).length, 1);
  });
});

describe('notificationsDue : un seul e-mail par conversation et destinataire (R-62)', () => {
  it('trois messages de la même conversation : un seul e-mail, messageIds du plus ancien au plus récent', () => {
    const result = due([message('m3', { createdAt: ago(7) }), message('m1', { createdAt: ago(20) }), message('m2', { createdAt: ago(9) })]);
    assert.deepEqual(result, [{ conversationId: 'c1', recipientId: 'lea', messageIds: ['m1', 'm2', 'm3'] }]);
  });

  it('deux conversations du même destinataire : un e-mail chacune', () => {
    const result = due([message('m1'), message('m2', { conversationId: 'c2' })]);
    assert.deepEqual(result.map(({ conversationId }) => conversationId).sort(), ['c1', 'c2']);
  });

  it('deux destinataires d’une même conversation (un message dans chaque sens) : un e-mail chacun', () => {
    const result = due([message('m1', { recipientId: 'lea' }), message('m2', { recipientId: 'mathis' })]);
    assert.deepEqual(result.map(({ recipientId }) => recipientId).sort(), ['lea', 'mathis']);
  });
});

describe('notificationsDue : 30 minutes entre deux e-mails d’une même paire (R-62)', () => {
  const key = pairKey('c1', 'lea');

  it('un e-mail parti il y a 10 minutes pour la paire : le message attend', () => {
    assert.deepEqual(due([message('m1')], { notifiedAt: new Map([[key, ago(10)]]) }), []);
  });

  it('un e-mail parti il y a 29 minutes : le message attend encore', () => {
    assert.deepEqual(due([message('m1')], { notifiedAt: new Map([[key, ago(29)]]) }), []);
  });

  it('un e-mail parti il y a 30 minutes : le message est dû', () => {
    assert.equal(due([message('m1')], { notifiedAt: new Map([[key, ago(30)]]) }).length, 1);
  });

  it('la pause de la paire ne retient pas une autre conversation ni un autre destinataire', () => {
    const notifiedAt = new Map([[key, ago(5)]]);
    const result = due([message('m1'), message('m2', { conversationId: 'c2' }), message('m3', { recipientId: 'mathis' })], { notifiedAt });
    assert.deepEqual(result.map(({ messageIds }) => messageIds[0]).sort(), ['m2', 'm3']);
  });

  it('accepte un objet simple à la place d’une Map', () => {
    assert.deepEqual(due([message('m1')], { notifiedAt: { [key]: ago(10) } }), []);
  });
});

describe('notificationsDue : la préférence « messages » (R-62)', () => {
  it('désactivée (objet emailPrefs) : aucun e-mail', () => {
    assert.deepEqual(due([message('m1')], { prefs: new Map([['lea', { meetingRequests: true, messages: false, reminders: true }]]) }), []);
  });

  it('désactivée (booléen) : aucun e-mail', () => {
    assert.deepEqual(due([message('m1')], { prefs: { lea: false } }), []);
  });

  it('active, absente ou sans la clé : l’e-mail part (les trois préférences sont actives par défaut)', () => {
    assert.equal(due([message('m1')], { prefs: new Map([['lea', { messages: true }]]) }).length, 1);
    assert.equal(due([message('m1')], { prefs: new Map([['lea', {}]]) }).length, 1);
    assert.equal(due([message('m1')], { prefs: new Map() }).length, 1);
    assert.equal(due([message('m1')]).length, 1);
  });

  it('la préférence d’un destinataire ne retient pas l’autre', () => {
    const result = due([message('m1', { recipientId: 'lea' }), message('m2', { recipientId: 'mathis' })], { prefs: { lea: { messages: false } } });
    assert.deepEqual(result.map(({ recipientId }) => recipientId), ['mathis']);
  });
});

describe('notificationsDue : pas d’effet de bord', () => {
  it('ne modifie pas ses entrées', () => {
    const messages = [message('m2', { createdAt: ago(7) }), message('m1', { createdAt: ago(20) })];
    const copy = structuredClone(messages);
    due(messages);
    assert.deepEqual(messages, copy);
  });
});

describe('excerpt : extrait d’un message (e-mail 200 caractères, liste 140)', () => {
  it('un texte court est rendu tel quel', () => {
    assert.equal(excerpt('J’apporterai nos échantillons de panneaux.'), 'J’apporterai nos échantillons de panneaux.');
  });

  it('replie les espaces et les sauts de ligne', () => {
    assert.equal(excerpt('  Bonjour\n\n  Mathis,\t merci  '), 'Bonjour Mathis, merci');
  });

  it('200 caractères exactement : pas de coupe', () => {
    const text = 'a'.repeat(200);
    assert.equal(excerpt(text), text);
  });

  it('201 caractères : coupé à 200 avec une ellipse', () => {
    const result = excerpt('a'.repeat(201));
    assert.equal(result.length, 200);
    assert.ok(result.endsWith('…'));
  });

  it('longueur choisie', () => {
    assert.equal(excerpt('abcdefghij', 5), 'abcd…');
  });

  it('valeur absente ou autre qu’un texte : texte vide', () => {
    assert.equal(excerpt(undefined), '');
    assert.equal(excerpt(null), '');
  });
});

describe('validateBody : message à envoyer (F-72)', () => {
  const fieldsOf = (value) => {
    try {
      validateBody(value);
    } catch (error) {
      return { status: error.status, code: error.code, fields: error.fields ?? error.details?.fields ?? error.extra?.fields };
    }
    return null;
  };

  it('rend le texte nettoyé de ses espaces de bord', () => {
    assert.equal(validateBody('  Bonjour  '), 'Bonjour');
  });

  it('2 000 caractères : accepté', () => {
    assert.equal(validateBody('a'.repeat(2000)).length, 2000);
  });

  for (const [label, value] of [
    ['vide', ''],
    ['des espaces', '   \n\t '],
    ['absent', undefined],
    ['null', null],
    ['un nombre', 123],
    ['un objet', { body: 'x' }],
  ]) {
    it(`${label} : 400 VALIDATION sur le champ body`, () => {
      const failure = fieldsOf(value);
      assert.ok(failure, 'doit lever une erreur');
      assert.equal(failure.status, 400);
      assert.equal(failure.code, 'VALIDATION');
    });
  }

  it('2 001 caractères : 400 VALIDATION', () => {
    const failure = fieldsOf('a'.repeat(2001));
    assert.equal(failure.status, 400);
    assert.equal(failure.code, 'VALIDATION');
  });
});

describe('canonicalPair : participants dans l’ordre des id (A-37)', () => {
  it('range par id croissant, dans les deux sens', () => {
    const a = { id: 3, documentId: 'a' };
    const b = { id: 9, documentId: 'b' };
    assert.deepEqual(canonicalPair(a, b), [a, b]);
    assert.deepEqual(canonicalPair(b, a), [a, b]);
  });
});

describe('pairKey', () => {
  it('conversation et destinataire', () => {
    assert.equal(pairKey('c1', 'lea'), 'c1:lea');
  });
});
