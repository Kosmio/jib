'use strict';

/**
 * Billets d'une même commande pour une même personne (journée et cocktail déjeunatoire), constaté sur l'export HelloAsso du
 * 18 novembre 2026 : le billet cocktail, plus ancien et sans champ personnalisé, ne doit ni créer la personne ni provoquer un doublon.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { groupTickets, planSync } = require('../../src/api/espace/lib/import');

const FIELD_MAP = { company: 'Organisation', jobTitle: 'Poste', email: 'Email' };
const ticket = (id, { order = 500, name = 'Journée Innovation Filière Bois en Nouvelle-Aquitaine', answers = {}, state = 'Processed', first = 'Camille', last = 'Essai', payer = 'achats@example.org' } = {}) => ({
  id,
  order: { id: order },
  name,
  state,
  user: { firstName: first, lastName: last },
  payer: { email: payer },
  payments: [{ state: 'Authorized' }],
  customFields: Object.entries(answers).map(([fieldName, answer]) => ({ name: fieldName, answer })),
});
const day = (id, extra = {}) => ticket(id, { answers: { Organisation: 'Atelier Fictif', Poste: 'Directrice', Email: 'camille.essai@example.org' }, ...extra });
const cocktail = (id, extra = {}) => ticket(id, { name: 'Participation au cocktail déjeunatoire', ...extra });

describe('billets associés d’une même commande', () => {
  it('retient le billet le plus renseigné, même plus récent que le billet cocktail', () => {
    const [group] = groupTickets([cocktail(10), day(11)]);
    assert.equal(group.main.id, 11);
    assert.deepEqual(group.companions.map(({ id }) => id), [10]);
  });

  it('crée une seule personne, avec l’entreprise, la fonction et l’adresse du billet de la journée, sans doublon signalé', () => {
    const plan = planSync({ items: [cocktail(10), day(11)], attendees: [], fieldMap: FIELD_MAP });
    assert.equal(plan.create.length, 1);
    assert.deepEqual([plan.create[0].helloassoItemId, plan.create[0].company, plan.create[0].jobTitle, plan.create[0].email], ['11', 'Atelier Fictif', 'Directrice', 'camille.essai@example.org']);
    assert.deepEqual(plan.errors, []);
  });

  it('déplace sur le billet de la journée une personne déjà créée depuis le billet cocktail, et la complète', () => {
    const existing = { documentId: 'a1', helloassoItemId: '10', email: 'achats@example.org', status: 'active', firstName: 'Camille', lastName: 'Essai', company: null, jobTitle: null };
    const plan = planSync({ items: [cocktail(10), day(11)], attendees: [existing], fieldMap: FIELD_MAP });
    assert.deepEqual(plan.create, []);
    assert.deepEqual(plan.update, [{ documentId: 'a1', changes: { helloassoItemId: '11', helloassoOrderId: '500', company: 'Atelier Fictif', jobTitle: 'Directrice' } }]);
    assert.deepEqual(plan.errors, []);
  });

  it('garde séparés deux bénéficiaires d’une même commande et deux commandes d’une même personne', () => {
    const plan = planSync({ items: [day(11), day(12, { first: 'Hugo', last: 'Autre', answers: { Email: 'hugo.autre@example.org' } }), day(20, { order: 501 })], attendees: [], fieldMap: FIELD_MAP });
    assert.equal(plan.create.length, 2);
    assert.deepEqual(plan.errors.map(({ code }) => code), ['DUPLICATE_EMAIL']);
  });

  it('un billet cocktail annulé n’annule pas la personne qui garde son billet de la journée', () => {
    const existing = { documentId: 'a1', helloassoItemId: '11', email: 'camille.essai@example.org', status: 'active' };
    const plan = planSync({ items: [cocktail(10, { state: 'Canceled' }), day(11)], attendees: [existing], fieldMap: FIELD_MAP });
    assert.deepEqual(plan.cancel, []);
  });
});
