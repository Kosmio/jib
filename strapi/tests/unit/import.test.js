'use strict';

/**
 * lib/import.js (I-11, I-12, I-14, Q-03, Q-15, R-31, R-18, NF-11) : correspondance d'un billet HelloAsso avec un
 * Attendee et plan de synchronisation (créations, mises à jour, annulations, erreurs). Fonctions pures, sans Strapi,
 * sur les billets du faux HelloAsso (jeu de recette et cas limites). Tests d'abord du lot 4.
 *
 * Forme des Attendee passés à planSync : les champs du modèle (documentId, helloassoItemId, email, firstName, lastName,
 * jobTitle, company, role, status, editedFields). Forme des éléments de `create` : le résultat de mapItem.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildEdgeCaseItems, buildItem } = require('../../scripts/espace/fake-helloasso');
const defaultItems = require('../../scripts/espace/fixtures/helloasso-items.json');
const { pending } = require('../helpers/pending');

const imp = () => require('../../src/api/espace/lib/import');

// Correspondance relevée sur le formulaire Nouvelle-Aquitaine (Q-03).
const FIELD_MAP = { email: 'Email', company: 'Organisation', jobTitle: 'Poste' };
const itemById = (id) => defaultItems.find((item) => item.id === id);
const clone = (value) => structuredClone(value);

/** Billet du tarif régional avec ses réponses ; `answers` surcharge les réponses, le reste surcharge le billet. */
function regionItem(id, { answers = {}, ...overrides } = {}) {
  return buildItem({
    id,
    firstName: 'Léa',
    lastName: 'Ducasse',
    payer: { email: `payeur.${id}@example.org` },
    answers: {
      'Accès PMR': 'Non',
      Organisation: 'Charpentes du Pibal',
      Poste: 'Responsable',
      Email: `lea.${id}@example.org`,
      'N° de téléphone': '06 39 98 00 00',
      'Code Postal': '33000',
      ...answers,
    },
    ...overrides,
  });
}

describe('normalizeEmail (I-11)', pending('lot 4'), () => {
  it('met en minuscules et retire les espaces autour', () => {
    assert.equal(imp().normalizeEmail('  Zoe.Garnier@Example.ORG  '), 'zoe.garnier@example.org');
  });

  it('laisse intacte une adresse déjà propre', () => {
    assert.equal(imp().normalizeEmail('lea.ducasse@example.org'), 'lea.ducasse@example.org');
  });

  for (const value of ['pas-une-adresse', '', '   ', 'a b@example.org', 'a@@example.org', '@example.org', 'a@', 'a@example.org, b@example.org', null, undefined, 42, {}]) {
    it(`renvoie null pour ${JSON.stringify(value) ?? 'undefined'}`, () => {
      assert.equal(imp().normalizeEmail(value), null);
    });
  }
});

describe('mapItem : champs de l’Attendee (I-11, Q-03)', pending('lot 4'), () => {
  const map = (item, fieldMap = FIELD_MAP) => imp().mapItem(item, fieldMap);

  it('reprend les champs du billet du tarif régional', () => {
    const mapped = map(itemById(100001));
    assert.equal(String(mapped.helloassoItemId), '100001');
    assert.equal(String(mapped.helloassoOrderId), String(itemById(100001).order.id));
    assert.equal(mapped.firstName, 'Léa');
    assert.equal(mapped.lastName, 'Ducasse');
    assert.equal(mapped.email, 'lea.ducasse@example.org');
    assert.equal(mapped.jobTitle, 'Responsable bureau d’études');
    assert.equal(mapped.company, 'Charpentes du Pibal');
    assert.equal(mapped.decision, 'active');
  });

  it('prend nom et prénom du bénéficiaire (user), jamais du payeur', () => {
    const item = regionItem(930001, { payer: { firstName: 'Paul', lastName: 'Payeur', email: 'paul.payeur@example.org' } });
    const mapped = map(item);
    assert.deepEqual([mapped.firstName, mapped.lastName], ['Léa', 'Ducasse']);
  });

  it('préfère l’e-mail du champ personnalisé à celui du payeur : billet 100003 payé par un secrétariat', () => {
    assert.equal(map(itemById(100003)).email, 'ines.castaing@example.org');
  });

  it('se replie sur payer.email quand le champ Email est absent (tarifs Exposant et Intervenant)', () => {
    assert.equal(map(itemById(100015)).email, 'benoit.tastet@example.org');
    assert.equal(map(itemById(100013)).email, 'helene.marques@example.org');
  });

  it('se replie sur payer.email quand le champ Email est invalide', () => {
    const mapped = map(regionItem(930002, { answers: { Email: 'pas-une-adresse' } }));
    assert.equal(mapped.email, 'payeur.930002@example.org');
  });

  it('normalise l’adresse du champ personnalisé : majuscules et espaces', () => {
    const mapped = map(regionItem(930003, { answers: { Email: '  Zoe.Garnier@Example.ORG  ' } }));
    assert.equal(mapped.email, 'zoe.garnier@example.org');
  });

  it('renvoie email null quand ni le champ ni le payeur n’ont d’adresse valable', () => {
    const mapped = map(regionItem(930004, { answers: { Email: 'pas-une-adresse' }, payer: { email: 'invalide' } }));
    assert.equal(mapped.email, null);
  });

  it('laisse vides fonction et entreprise quand le billet n’a pas ces champs', () => {
    const mapped = map(itemById(100015));
    assert.ok(!mapped.jobTitle);
    assert.ok(!mapped.company);
  });

  it('lit les libellés dans helloassoFieldMap, jamais en dur (D-03)', () => {
    const item = regionItem(930005, { answers: { Email: 'ignore@example.org', Organisation: 'Ignorée', Poste: 'Ignoré' } });
    item.customFields.push(
      { id: 9001, name: 'Courriel', type: 'TextInput', answer: 'Courriel.Pro@Example.org' },
      { id: 9002, name: 'Structure', type: 'TextInput', answer: 'Coopérative Fictive' },
      { id: 9003, name: 'Fonction', type: 'TextInput', answer: 'Directrice' }
    );
    const mapped = map(item, { email: 'Courriel', company: 'Structure', jobTitle: 'Fonction' });
    assert.equal(mapped.email, 'courriel.pro@example.org');
    assert.equal(mapped.company, 'Coopérative Fictive');
    assert.equal(mapped.jobTitle, 'Directrice');
  });

  it('ne plante pas sans correspondance de champs : e-mail du payeur, fonction et entreprise vides', () => {
    for (const fieldMap of [{}, undefined, null]) {
      const mapped = map(regionItem(930006), fieldMap);
      assert.equal(mapped.email, 'payeur.930006@example.org');
      assert.ok(!mapped.company);
    }
  });

  describe('rôle proposé selon le tarif (Q-03, I-11)', () => {
    it('Exposant donne exhibitor_rep', () => {
      assert.equal(map(itemById(100015)).proposedRole, 'exhibitor_rep');
    });

    it('Intervenant donne speaker', () => {
      assert.equal(map(itemById(100013)).proposedRole, 'speaker');
    });

    it('le tarif régional ne propose aucun rôle particulier (participant)', () => {
      assert.ok([undefined, null, 'participant'].includes(map(itemById(100001)).proposedRole));
    });

    it('reconnaît le mot dans un intitulé plus long', () => {
      assert.equal(map(regionItem(930007, { name: 'Pass Exposant 2 jours' })).proposedRole, 'exhibitor_rep');
      assert.equal(map(regionItem(930008, { name: 'Pass Intervenant' })).proposedRole, 'speaker');
    });
  });

  describe('décision selon l’état du billet (Q-15)', () => {
    for (const [state, decision] of [
      ['Processed', 'active'],
      ['Registered', 'active'],
      ['Canceled', 'cancelled'],
      ['Refused', 'cancelled'],
      ['Deleted', 'cancelled'],
      ['Abandoned', 'cancelled'],
      ['Waiting', 'ignored'],
      ['Unknown', 'ignored'],
    ]) {
      it(`${state} donne ${decision}`, () => {
        assert.equal(map(regionItem(930010, { state })).decision, decision);
      });
    }

    it('un paiement Refunded donne cancelled, quel que soit l’état du billet', () => {
      assert.equal(map(regionItem(930011, { state: 'Processed', paymentState: 'Refunded' })).decision, 'cancelled');
    });

    it('un paiement autorisé garde le billet actif', () => {
      assert.equal(map(regionItem(930012, { state: 'Processed', paymentState: 'Authorized' })).decision, 'active');
    });

    it('un billet gratuit, sans paiement, reste actif', () => {
      assert.equal(map(regionItem(930013, { amount: 0 })).decision, 'active');
    });
  });

  describe('minimisation (NF-11)', () => {
    const allowed = ['helloassoItemId', 'helloassoOrderId', 'firstName', 'lastName', 'email', 'jobTitle', 'company', 'proposedRole', 'decision', 'reason'];
    const everyItem = [...defaultItems, ...buildEdgeCaseItems({ padding: 5 })];

    it('ne renvoie que les champs de l’Attendee, pour tous les billets du faux', () => {
      for (const item of everyItem) {
        const extra = Object.keys(map(item)).filter((key) => !allowed.includes(key));
        assert.deepEqual(extra, [], `billet ${item.id}`);
      }
    });

    it('ne laisse passer ni téléphone, ni code postal, ni donnée de paiement', () => {
      for (const item of everyItem) {
        const text = JSON.stringify(map(item));
        assert.ok(!/06 39 98/.test(text), `téléphone du billet ${item.id}`);
        assert.ok(!/Code Postal|N° de téléphone|\b\d{5}\b/.test(text), `code postal du billet ${item.id}`);
        assert.ok(!/payments|shareAmount|Authorized|Refunded|"amount"/.test(text), `paiement du billet ${item.id}`);
      }
    });
  });

  it('ne modifie pas le billet reçu', () => {
    const item = clone(itemById(100001));
    map(item);
    assert.deepEqual(item, itemById(100001));
  });
});

describe('planSync : synchronisation idempotente (I-12, I-14, Q-15, R-18, R-31)', pending('lot 4'), () => {
  const plan = (items, attendees = [], fieldMap = FIELD_MAP) => imp().planSync({ items, attendees, fieldMap });
  const emailsOf = (list) => list.map((entry) => entry.email).sort();
  const codesOf = (result) => result.errors.map((error) => [String(error.itemId), error.code]);
  /** Attendee tel que la base le contiendrait après la création d'un élément de `create`. */
  const stored = (created, index, overrides = {}) => ({
    ...created,
    documentId: `att-${index}`,
    helloassoItemId: String(created.helloassoItemId),
    role: created.proposedRole ?? 'participant',
    status: 'active',
    editedFields: [],
    ...overrides,
  });
  const known = (overrides = {}) => ({
    documentId: 'att-1',
    helloassoItemId: '930100',
    email: 'lea.930100@example.org',
    firstName: 'Léa',
    lastName: 'Ducasse',
    jobTitle: 'Responsable',
    company: 'Charpentes du Pibal',
    role: 'participant',
    status: 'active',
    editedFields: [],
    ...overrides,
  });
  const itemOfKnown = (overrides = {}) => regionItem(930100, overrides);

  describe('jeu de recette (Q-17)', () => {
    it('crée les 16 billets actifs et ignore celui de Lucas Darrigade (Canceled, inconnu), sans erreur', () => {
      const result = plan(defaultItems);
      assert.equal(result.create.length, 16);
      assert.ok(!emailsOf(result.create).includes('lucas.darrigade@example.org'));
      assert.deepEqual([result.update, result.cancel, result.errors], [[], [], []]);
    });

    it('propose les rôles du tarif : 3 exposants et 2 intervenants', () => {
      const roles = Object.groupBy(plan(defaultItems).create, (created) => created.proposedRole ?? 'participant');
      assert.equal(roles.exhibitor_rep.length, 3);
      assert.equal(roles.speaker.length, 2);
      assert.equal(roles.participant.length, 11);
    });

    it('est idempotent : replanifier sur les Attendee créés ne donne plus rien (0 création, 0 mise à jour, 0 annulation)', () => {
      const first = plan(defaultItems);
      const attendees = first.create.map((created, index) => stored(created, index));
      const second = plan(defaultItems, attendees);
      assert.deepEqual([second.create, second.update, second.cancel, second.errors], [[], [], [], []]);
    });

    it('rapproche un billet numérique d’un Attendee dont l’identifiant est une chaîne', () => {
      const first = plan([itemById(100001)]);
      const second = plan([itemById(100001)], [stored(first.create[0], 0)]);
      assert.deepEqual(second.create, []);
    });
  });

  describe('cas limites (I-14, Q-15)', () => {
    const edge = buildEdgeCaseItems({ padding: 0 });

    it('commande groupée à e-mail commun : un seul Attendee, les deux autres billets en DUPLICATE_EMAIL', () => {
      const result = plan(edge);
      assert.ok(emailsOf(result.create).includes('groupe@example.org'));
      assert.equal(result.create.filter((created) => created.email === 'groupe@example.org').length, 1);
      assert.deepEqual(codesOf(result).filter(([, code]) => code === 'DUPLICATE_EMAIL').sort(), [['910002', 'DUPLICATE_EMAIL'], ['910003', 'DUPLICATE_EMAIL']]);
    });

    it('garde le premier billet de la commande groupée (identifiant le plus petit) et mentionne l’adresse en conflit', () => {
      const result = plan(edge);
      assert.equal(String(result.create.find((created) => created.email === 'groupe@example.org').helloassoItemId), '910001');
      assert.ok(result.errors.filter((error) => error.code === 'DUPLICATE_EMAIL').every((error) => error.email === 'groupe@example.org'));
    });

    it('signale Waiting en WAITING et Unknown en UNKNOWN, sans créer d’Attendee', () => {
      const result = plan(edge);
      assert.ok(codesOf(result).some(([id, code]) => id === '910006' && code === 'WAITING'));
      assert.ok(codesOf(result).some(([id, code]) => id === '910010' && code === 'UNKNOWN'));
      assert.ok(!emailsOf(result.create).includes('etat.waiting@example.org'));
      assert.ok(!emailsOf(result.create).includes('etat.unknown@example.org'));
    });

    it('ignore sans erreur Refused, Deleted, Abandoned, Canceled et le paiement Refunded quand le billet est inconnu', () => {
      const result = plan(edge);
      for (const id of ['910007', '910008', '910009', '910011', '910012']) {
        assert.ok(!codesOf(result).some(([itemId]) => itemId === id), `erreur pour le billet ${id}`);
      }
      for (const email of ['etat.refused@example.org', 'etat.deleted@example.org', 'etat.abandoned@example.org', 'etat.canceled@example.org', 'paiement.rembourse@example.org']) {
        assert.ok(!emailsOf(result.create).includes(email), email);
      }
    });

    it('normalise l’adresse en majuscules et avec espaces avant de créer', () => {
      assert.ok(emailsOf(plan(edge).create).includes('zoe.garnier@example.org'));
    });

    it('traite le champ Email invalide : création par l’adresse du payeur ou erreur INVALID_EMAIL (billet 910004)', () => {
      const result = plan(edge);
      const created = emailsOf(result.create).includes('payeur.910004@example.org');
      const reported = codesOf(result).some(([id, code]) => id === '910004' && code === 'INVALID_EMAIL');
      assert.ok(created || reported, 'le billet 910004 n’est ni créé ni signalé');
    });

    it('signale INVALID_EMAIL, sans créer, quand ni le champ ni le payeur n’ont d’adresse valable', () => {
      const invalid = regionItem(930200, { answers: { Email: 'pas-une-adresse' }, payer: { email: 'invalide' } });
      const result = plan([invalid]);
      assert.deepEqual(result.create, []);
      assert.deepEqual(codesOf(result), [['930200', 'INVALID_EMAIL']]);
    });

    it('crée les 120 billets de remplissage, au-delà d’une page de 100', () => {
      const result = plan(buildEdgeCaseItems({ padding: 120 }));
      assert.equal(result.create.filter((created) => /^figurant\.\d+@example\.org$/.test(created.email)).length, 120);
    });

    it('est idempotent sur les cas limites : mêmes erreurs, rien de plus à faire', () => {
      const first = plan(edge);
      const second = plan(edge, first.create.map((created, index) => stored(created, index)));
      assert.deepEqual([second.create, second.update, second.cancel], [[], [], []]);
      assert.deepEqual(codesOf(second).sort(), codesOf(first).sort());
    });

    it('traite les billets par identifiant croissant, quel que soit l’ordre reçu', () => {
      const shuffled = [...edge].reverse();
      const result = plan(shuffled);
      assert.equal(String(result.create.find((created) => created.email === 'groupe@example.org').helloassoItemId), '910001');
    });

    it('compare les identifiants comme des nombres : 99 passe avant 100', () => {
      const same = { Email: 'meme@example.org' };
      const result = plan([regionItem(100, { answers: same }), regionItem(99, { answers: same })]);
      assert.deepEqual(result.create.map((created) => String(created.helloassoItemId)), ['99']);
      assert.deepEqual(codesOf(result), [['100', 'DUPLICATE_EMAIL']]);
    });

    // Le plan distingue-t-il DUPLICATE_EMAIL (même lot) et EMAIL_TAKEN (adresse déjà en base) ? Le plan du lot 4 exige les
    // mêmes erreurs à la seconde synchronisation, ce que garantit DUPLICATE_EMAIL ; les deux codes sont admis ici.
    const REFUSAL_CODES = ['DUPLICATE_EMAIL', 'EMAIL_TAKEN'];

    it('refuse de créer un billet dont l’adresse appartient déjà à un autre Attendee de l’édition', () => {
      const attendee = known({ helloassoItemId: '111111', email: 'lea.930100@example.org' });
      const result = plan([itemOfKnown()], [attendee]);
      assert.deepEqual(result.create, []);
      assert.equal(result.errors.length, 1);
      assert.equal(String(result.errors[0].itemId), '930100');
      assert.ok(REFUSAL_CODES.includes(result.errors[0].code), result.errors[0].code);
    });

    it('reconnaît l’adresse déjà prise malgré les majuscules', () => {
      const attendee = known({ helloassoItemId: '111111', email: 'lea.930100@example.org' });
      const result = plan([regionItem(930100, { answers: { Email: 'LEA.930100@Example.ORG' } })], [attendee]);
      assert.deepEqual(result.create, []);
      assert.ok(REFUSAL_CODES.includes(result.errors[0]?.code), JSON.stringify(result.errors));
    });
  });

  describe('annulation (Q-15, R-18)', () => {
    for (const [label, overrides] of [
      ['Canceled', { state: 'Canceled' }],
      ['Refused', { state: 'Refused' }],
      ['Deleted', { state: 'Deleted' }],
      ['Abandoned', { state: 'Abandoned' }],
      ['paiement Refunded', { paymentState: 'Refunded' }],
    ]) {
      it(`annule l’Attendee connu dont le billet passe à ${label}`, () => {
        const result = plan([itemOfKnown(overrides)], [known()]);
        assert.deepEqual(result.cancel, ['att-1']);
        assert.deepEqual([result.create, result.errors], [[], []]);
      });
    }

    it('n’annule pas deux fois : Attendee déjà cancelled, billet toujours Canceled', () => {
      const result = plan([itemOfKnown({ state: 'Canceled' })], [known({ status: 'cancelled' })]);
      assert.deepEqual([result.create, result.update, result.cancel, result.errors], [[], [], [], []]);
    });

    it('réactive un Attendee cancelled dont le billet redevient actif : status active', () => {
      const result = plan([itemOfKnown()], [known({ status: 'cancelled' })]);
      assert.equal(result.update.length, 1);
      assert.equal(result.update[0].documentId, 'att-1');
      assert.equal(result.update[0].changes.status, 'active');
      assert.deepEqual(result.cancel, []);
    });

    it('n’annule pas un Attendee connu dont le billet est en attente (Waiting) : signalé, conservé', () => {
      const result = plan([itemOfKnown({ state: 'Waiting' })], [known()]);
      assert.deepEqual(result.cancel, []);
    });
  });

  describe('mises à jour et champs édités (R-31)', () => {
    it('met à jour un champ importé qui a changé côté HelloAsso : seul ce champ figure dans changes', () => {
      const result = plan([itemOfKnown({ answers: { Poste: 'Directrice' } })], [known()]);
      assert.deepEqual(result.update, [{ documentId: 'att-1', changes: { jobTitle: 'Directrice' } }]);
    });

    for (const [field, answers, item] of [
      ['jobTitle', { Poste: 'Directrice' }, {}],
      ['company', { Organisation: 'Autre Société' }, {}],
      ['firstName', {}, { firstName: 'Léana' }],
      ['lastName', {}, { lastName: 'Ducasset' }],
    ]) {
      it(`n’écrase jamais « ${field} » une fois modifié par le participant (editedFields)`, () => {
        const result = plan([itemOfKnown({ answers, ...item })], [known({ editedFields: [field] })]);
        assert.deepEqual(result.update, []);
      });
    }

    it('ne protège que les champs édités : company est mise à jour, jobTitle ne l’est pas', () => {
      const result = plan([itemOfKnown({ answers: { Poste: 'Directrice', Organisation: 'Autre Société' } })], [known({ editedFields: ['jobTitle'] })]);
      assert.deepEqual(result.update, [{ documentId: 'att-1', changes: { company: 'Autre Société' } }]);
    });

    it('ne touche jamais au rôle, aux rattachements ni aux consentements', () => {
      const attendee = known({ role: 'speaker', speaker: { documentId: 'int-1' }, directoryOptIn: true, meetingsOptIn: true, newsOptIn: true, consentAt: '2026-10-01T08:00:00.000Z', topics: [{ documentId: 't-1' }] });
      const item = itemOfKnown({ name: 'Exposant', answers: { Poste: 'Autre poste' }, firstName: 'Autre' });
      const result = plan([item], [attendee]);
      const forbidden = ['role', 'speaker', 'exhibitor', 'directoryOptIn', 'meetingsOptIn', 'newsOptIn', 'consentAt', 'activatedAt', 'topics', 'editedFields', 'photo', 'bio'];
      assert.equal(result.update.length, 1);
      assert.deepEqual(Object.keys(result.update[0].changes).filter((key) => forbidden.includes(key)), []);
    });

    it('ne change pas le rôle quand seul le tarif a changé : aucune mise à jour', () => {
      const result = plan([itemOfKnown({ name: 'Exposant' })], [known({ role: 'participant' })]);
      assert.deepEqual(result.update, []);
    });
  });

  describe('minimisation et pureté (NF-11)', () => {
    it('ne laisse passer ni téléphone ni code postal dans le plan', () => {
      const text = JSON.stringify(plan(defaultItems));
      assert.ok(!text.includes('06 39 98'), 'téléphone');
      assert.ok(!/Code Postal|N° de téléphone|"33000"|"40100"/.test(text), 'code postal ou libellé de champ non importé');
    });

    it('ne modifie ni les billets ni les Attendee reçus', () => {
      const items = clone(defaultItems);
      const attendees = [known()];
      plan(items, attendees);
      assert.deepEqual(items, defaultItems);
      assert.deepEqual(attendees, [known()]);
    });
  });
});
