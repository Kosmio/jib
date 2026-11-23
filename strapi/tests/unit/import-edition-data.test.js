'use strict';

/**
 * Import des données d'une édition (strapi/scripts/espace/import-edition-data.js), décisions pures des retours de recette du
 * 18 novembre 2026 : sujets des intervenants d'après leurs séquences (topicsBySpeaker), intervenant rattaché à l'inscrit du même nom
 * (planNameLink). Données fictives, adresses en @example.org pour les comptes de test, en .test pour les « vraies ».
 */

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { planNameLink, topicsBySpeaker } = require('../../scripts/espace/import-edition-data');

const id = (documentId) => ({ documentId });

describe('topicsBySpeaker : les sujets des séquences où l’intervenant parle', () => {
  const topics = [
    { documentId: 't-foret', name: 'Forêt', sessions: [id('s1')] },
    { documentId: 't-ressource', name: 'Ressource', sessions: [id('s1')] },
    { documentId: 't-ia', name: 'IA', sessions: [id('s2')] },
    { documentId: 't-libre', name: 'Sans séquence', sessions: [] },
  ];
  const sequences = [
    { documentId: 's1', interventions: [{ intervenants: [id('lea')] }, { intervenants: [id('lea'), id('marc')] }] },
    { documentId: 's2', interventions: [{ intervenants: [id('marc')] }] },
    { documentId: 's3', interventions: [{ intervenants: [id('ines')] }] },
  ];
  const names = (list) => (list ?? []).map(({ name }) => name);

  it('une séquence, deux sujets ; deux interventions dans la même séquence ne doublent rien', () => {
    assert.deepEqual(names(topicsBySpeaker({ sequences, topics }).get('lea')), ['Forêt', 'Ressource']);
  });

  it('deux séquences : les sujets des deux, dans l’ordre du programme', () => {
    assert.deepEqual(names(topicsBySpeaker({ sequences, topics }).get('marc')), ['Forêt', 'Ressource', 'IA']);
  });

  it('une séquence sans sujet ne donne rien ; un sujet sans séquence n’est donné à personne', () => {
    const result = topicsBySpeaker({ sequences, topics });
    assert.deepEqual(names(result.get('ines')), []);
    assert.ok(![...result.values()].flat().some(({ name }) => name === 'Sans séquence'));
  });
});

describe('planNameLink : l’intervenant rattaché à l’inscrit du même nom', () => {
  const intervenant = { documentId: 'i1', name: 'Léa Ducasse' };
  const real = (fields = {}) => ({ documentId: 'a-real', email: 'lea@atelier.test', firstName: 'Léa', lastName: 'Ducasse', role: 'participant', status: 'active', speaker: null, ...fields });
  const fake = (fields = {}) => ({ documentId: 'a-fake', email: 'lea.ducasse@example.org', firstName: 'Léa', lastName: 'Ducasse', role: 'speaker', status: 'active', speaker: id('i1'), ...fields });

  it('un inscrit réel du même nom et un compte de test : l’inscrit prend le lien, le compte de test est remplacé', () => {
    const plan = planNameLink({ intervenant, attendees: [fake(), real()] });
    assert.equal(plan.action, 'link');
    assert.equal(plan.attendee.documentId, 'a-real');
    assert.deepEqual(plan.replaced.map(({ documentId }) => documentId), ['a-fake']);
  });

  it('casse, accents et ordre nom prénom ignorés', () => {
    assert.equal(planNameLink({ intervenant, attendees: [real({ firstName: 'DUCASSE', lastName: 'lea' })] }).action, 'link');
  });

  it('déjà rattaché, sans compte de test : rien à faire (idempotent)', () => {
    assert.equal(planNameLink({ intervenant, attendees: [real({ role: 'speaker', speaker: id('i1') })] }).action, 'none');
  });

  it('aucun inscrit réel de ce nom, ou seulement un compte de test : rien', () => {
    assert.equal(planNameLink({ intervenant, attendees: [fake()] }).action, 'none');
    assert.equal(planNameLink({ intervenant, attendees: [real({ lastName: 'Marques' })] }).action, 'none');
  });

  it('un inscrit annulé ne compte pas ; deux homonymes actifs : rien de rattaché', () => {
    assert.equal(planNameLink({ intervenant, attendees: [real({ status: 'cancelled' })] }).action, 'none');
    assert.deepEqual(planNameLink({ intervenant, attendees: [real(), real({ documentId: 'a-other', email: 'lea@autre.test' })] }), { action: 'ambiguous', count: 2 });
  });

  it('le compte de test d’un autre intervenant n’est pas remplacé', () => {
    assert.deepEqual(planNameLink({ intervenant, attendees: [real(), fake({ speaker: id('i2') })] }).replaced, []);
  });
});
