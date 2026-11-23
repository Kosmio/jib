'use strict';

/**
 * Décisions pures des garde-fous de l'administration (V1-D, NF-63 à NF-65) : `removalRefusal` (suppression ou dépublication)
 * et `editionRefusal` (enregistrement d'une édition). Chacune rend le message en français du refus, ou null.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { editionRefusal, removalRefusal } = require('../../src/api/espace/lib/admin-guards');

const NOW = new Date('2026-11-17T10:00:00.000Z');
const FUTURE = '2026-12-02T17:00:00.000Z';
const PAST = '2026-11-01T17:00:00.000Z';
const current = { slug: 'edition-x', slotDurationMinutes: 15, tablesCount: 10, meetingRequestsOpenAt: '2026-10-01T08:00:00.000Z', meetingRequestsCloseAt: FUTURE };
const refusal = (data, facts = {}) => editionRefusal({ current, data, now: NOW, ...facts });

describe('removalRefusal (NF-63)', () => {
  const UIDS = ['api::espace.attendee', 'api::espace.exhibitor', 'api::espace.slot', 'api::sequence.sequence', 'api::edition.edition'];

  for (const uid of UIDS) {
    it(`${uid} : refuse quand quelque chose dépend du document, en français`, () => {
      const message = removalRefusal(uid, 'delete', 2);
      assert.equal(typeof message, 'string');
      assert.match(message, /supprimer/);
    });
    it(`${uid} : admet quand rien n'en dépend`, () => {
      assert.equal(removalRefusal(uid, 'delete', 0), null);
    });
  }

  it('le message d’un participant commence par « Ce participant a des rendez-vous »', () => {
    assert.match(removalRefusal('api::espace.attendee', 'delete', 1), /^Ce participant a des rendez-vous/);
  });

  it('une dépublication parle de dépublier, pas de supprimer', () => {
    const message = removalRefusal('api::edition.edition', 'unpublish', 3);
    assert.match(message, /dépublier/);
    assert.doesNotMatch(message, /supprimer/);
  });

  it('un type non gardé est toujours admis', () => {
    assert.equal(removalRefusal('api::espace.topic', 'delete', 5), null);
  });
});

describe('editionRefusal (NF-64, NF-65)', () => {
  it('NF-65 : refuse un slug modifié quand l’édition a des participants', () => {
    assert.match(refusal({ slug: 'autre' }, { attendees: 1 }), /identifiant URL/);
  });
  it('NF-65 : admet un slug modifié sans participant, ou inchangé avec des participants', () => {
    assert.equal(refusal({ slug: 'autre' }, { attendees: 0 }), null);
    assert.equal(refusal({ slug: 'edition-x' }, { attendees: 4 }), null);
  });
  it('à la création (current nul), le slug n’est jamais refusé', () => {
    assert.equal(editionRefusal({ current: null, data: { slug: 'neuve' }, now: NOW, attendees: 0 }), null);
  });

  it('NF-64 : refuse une fermeture passée avec des demandes en attente', () => {
    assert.match(refusal({ meetingRequestsCloseAt: PAST }, { pending: 2 }), /fermeture/);
  });
  it('NF-64 : admet une fermeture passée sans demande en attente, et une fermeture future avec des demandes', () => {
    assert.equal(refusal({ meetingRequestsCloseAt: PAST }, { pending: 0 }), null);
    assert.equal(refusal({ meetingRequestsCloseAt: FUTURE }, { pending: 3 }), null);
  });
  it('NF-64 : la fermeture exactement à l’instant présent compte comme passée', () => {
    assert.match(refusal({ meetingRequestsCloseAt: NOW.toISOString() }, { pending: 1 }), /fermeture/);
  });
  it('NF-64 : une fermeture passée déjà stockée n’est pas rejugée si le champ n’est pas fourni', () => {
    const stored = { ...current, meetingRequestsCloseAt: PAST };
    assert.equal(editionRefusal({ current: stored, data: { title: 'Nouveau titre' }, now: NOW, pending: 2 }), null);
  });

  it('NF-64 : refuse une ouverture égale ou postérieure à la fermeture', () => {
    assert.match(refusal({ meetingRequestsOpenAt: '2026-12-03T00:00:00.000Z' }), /ouverture/i);
    assert.match(refusal({ meetingRequestsOpenAt: FUTURE }), /ouverture/i);
  });
  it('NF-64 : l’ordre se juge avec la valeur stockée de l’autre borne', () => {
    assert.match(refusal({ meetingRequestsCloseAt: '2026-09-01T00:00:00.000Z' }), /ouverture/i);
  });
  it('NF-64 : admet une ouverture antérieure, ou une seule borne renseignée', () => {
    assert.equal(refusal({ meetingRequestsOpenAt: '2026-11-20T08:00:00.000Z' }), null);
    assert.equal(editionRefusal({ current: null, data: { meetingRequestsOpenAt: FUTURE }, now: NOW }), null);
  });

  it('NF-64 : refuse tablesCount sous le plus grand numéro de table attribué, admet ce numéro et au-dessus', () => {
    assert.match(refusal({ tablesCount: 2 }, { maxTable: 3 }), /table 3/);
    assert.equal(refusal({ tablesCount: 3 }, { maxTable: 3 }), null);
    assert.equal(refusal({ tablesCount: 20 }, { maxTable: 3 }), null);
  });
  it('NF-64 : tablesCount à 0 est refusé seulement si une table est attribuée', () => {
    assert.equal(refusal({ tablesCount: 0 }, { maxTable: 0 }), null);
    assert.notEqual(refusal({ tablesCount: 0 }, { maxTable: 1 }), null);
  });

  it('NF-64 : refuse de changer slotDurationMinutes quand un rendez-vous existe', () => {
    assert.match(refusal({ slotDurationMinutes: 20 }, { meetings: 1 }), /durée/);
  });
  it('NF-64 : admet une durée changée sans rendez-vous, ou inchangée avec des rendez-vous', () => {
    assert.equal(refusal({ slotDurationMinutes: 20 }, { meetings: 0 }), null);
    assert.equal(refusal({ slotDurationMinutes: 15 }, { meetings: 5 }), null);
  });

  it('un enregistrement qui ne touche aucun champ gardé est admis, quels que soient les faits', () => {
    assert.equal(refusal({ title: 'Titre' }, { attendees: 9, meetings: 9, pending: 9, maxTable: 9 }), null);
  });
});
