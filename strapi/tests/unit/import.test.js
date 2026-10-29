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
const fs = require('node:fs');
const path = require('node:path');

const { buildEdgeCaseItems, buildItem } = require('../../scripts/espace/fake-helloasso');
const defaultItems = require('../../scripts/espace/fixtures/helloasso-items.json');
const { addressOfLength } = require('../helpers/addresses');

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

describe('normalizeEmail (I-11)', () => {
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

describe('normalizeEmail : 254 caractères au plus, seule règle d’adresse de l’espace (A-23)', () => {
  it('n’est définie qu’une fois dans strapi/src : services/auth.js l’importe et ne garde ni copie ni motif d’adresse', () => {
    const sources = (directory) =>
      fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? sources(file) : /\.js$/.test(entry.name) ? [file] : [];
      });
    const definitions = sources(path.resolve(__dirname, '../../src'))
      .filter((file) => /(function\s+normalizeEmail\b|(const|let|var)\s+normalizeEmail\s*=|\bnormalizeEmail\s*[:=]\s*(async\s*)?(\(|function))/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(path.resolve(__dirname, '../../src'), file));
    assert.deepEqual(definitions, ['api/espace/lib/import.js']);
    const auth = fs.readFileSync(path.resolve(__dirname, '../../src/api/espace/services/auth.js'), 'utf8');
    assert.match(auth, /normalizeEmail[^;]*require\('\.\.\/lib\/import'\)|require\('\.\.\/lib\/import'\)[^;]*normalizeEmail/);
    assert.doesNotMatch(auth, /EMAIL_PATTERN/);
  });

  it('admet une adresse de 254 caractères', () => {
    const address = addressOfLength(254);
    assert.equal(address.length, 254);
    assert.equal(imp().normalizeEmail(address), address);
  });

  it('refuse une adresse de 255 caractères', () => {
    const address = addressOfLength(255);
    assert.equal(address.length, 255);
    assert.equal(imp().normalizeEmail(address), null);
  });

  it('mesure l’adresse après avoir retiré les espaces autour : 254 caractères entourés d’espaces restent admis', () => {
    const address = addressOfLength(254);
    assert.equal(imp().normalizeEmail(`  ${address}  `), address);
  });
});

describe('mapItem : champs de l’Attendee (I-11, Q-03)', () => {
  // La correspondance de Q-03 s'applique seulement quand l'appel n'en donne aucune : un `undefined` passé explicitement
  // reste `undefined` (un paramètre par défaut le remplacerait, section 11 du plan, point 1).
  const map = (item, ...fieldMap) => imp().mapItem(item, ...(fieldMap.length ? fieldMap : [FIELD_MAP]));

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

  describe('sans helloassoFieldMap (A-23, D-03) : aucun libellé par défaut', () => {
    for (const fieldMap of [{}, undefined, null]) {
      const label = fieldMap === undefined ? 'undefined' : JSON.stringify(fieldMap);

      it(`${label} : e-mail du payeur, fonction et entreprise vides, même si le billet porte « Email », « Organisation » et « Poste »`, () => {
        const mapped = imp().mapItem(regionItem(930006), fieldMap);
        assert.equal(mapped.email, 'payeur.930006@example.org');
        assert.ok(!mapped.company, `entreprise ${mapped.company}`);
        assert.ok(!mapped.jobTitle, `fonction ${mapped.jobTitle}`);
      });
    }

    it('garde le nom et le prénom du bénéficiaire, qui ne dépendent pas de la correspondance', () => {
      const mapped = imp().mapItem(regionItem(930006), undefined);
      assert.deepEqual([mapped.firstName, mapped.lastName], ['Léa', 'Ducasse']);
    });
  });

  it('ne retient pas une adresse de 255 caractères du champ Email : repli sur le payeur (A-23)', () => {
    const mapped = map(regionItem(930020, { answers: { Email: addressOfLength(255) } }));
    assert.equal(mapped.email, 'payeur.930020@example.org');
  });

  it('renvoie email null quand le champ Email et le payeur dépassent 254 caractères (A-23)', () => {
    const long = addressOfLength(255);
    assert.equal(map(regionItem(930021, { answers: { Email: long }, payer: { email: long } })).email, null);
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

describe('planSync : synchronisation idempotente (I-12, I-14, Q-15, R-18, R-31)', () => {
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

    it('champ Email invalide et payeur valable (billet 910004) : l’Attendee est créé sur l’adresse du payeur, sans erreur (I-11, A-23)', () => {
      const result = plan(edge);
      assert.ok(emailsOf(result.create).includes('payeur.910004@example.org'), 'billet 910004 non créé sur l’adresse du payeur');
      assert.ok(!codesOf(result).some(([id]) => id === '910004'), 'erreur consignée pour le billet 910004');
    });

    it('le jeu de cas limites du faux ne contient aucun billet sans adresse valable : aucun INVALID_EMAIL', () => {
      assert.ok(!codesOf(plan(edge)).some(([, code]) => code === 'INVALID_EMAIL'));
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

    // planSync donne DUPLICATE_EMAIL pour toute adresse déjà en base ou déjà prise par un billet de plus petit id ;
    // EMAIL_TAKEN ne sort que du contrôle sous verrou du service (A-16, section 11 du plan, point 3).
    it('refuse de créer un billet dont l’adresse appartient déjà à un autre Attendee actif de l’édition : DUPLICATE_EMAIL', () => {
      const attendee = known({ helloassoItemId: '111111', email: 'lea.930100@example.org' });
      const result = plan([itemOfKnown()], [attendee]);
      assert.deepEqual(result.create, []);
      assert.deepEqual(result.errors, [{ itemId: '930100', code: 'DUPLICATE_EMAIL', email: 'lea.930100@example.org' }]);
    });

    it('reconnaît l’adresse déjà prise malgré les majuscules : DUPLICATE_EMAIL', () => {
      const attendee = known({ helloassoItemId: '111111', email: 'lea.930100@example.org' });
      const result = plan([regionItem(930100, { answers: { Email: 'LEA.930100@Example.ORG' } })], [attendee]);
      assert.deepEqual(result.create, []);
      assert.deepEqual(result.errors.map((error) => error.code), ['DUPLICATE_EMAIL']);
    });

    it('ne produit jamais EMAIL_TAKEN, quels que soient les billets et les Attendee', () => {
      const attendees = [known({ helloassoItemId: '111111', email: 'groupe@example.org' })];
      const codes = [...plan(buildEdgeCaseItems({ padding: 0 }), attendees).errors, ...plan(defaultItems).errors].map((error) => error.code);
      assert.ok(!codes.includes('EMAIL_TAKEN'), codes.join());
    });
  });

  describe('sans helloassoFieldMap (A-23, D-03)', () => {
    for (const fieldMap of [null, {}, undefined]) {
      it(`${fieldMap === undefined ? 'undefined' : JSON.stringify(fieldMap)} : crée sur l’adresse du payeur, fonction et entreprise vides, aucune erreur`, () => {
        const result = imp().planSync({ items: [regionItem(930300)], attendees: [], fieldMap });
        assert.deepEqual(result.errors, []);
        assert.equal(result.create.length, 1);
        assert.equal(result.create[0].email, 'payeur.930300@example.org');
        assert.ok(!result.create[0].jobTitle && !result.create[0].company);
      });
    }
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

  // A-22 : un Attendee annulé qui rachète un billet avec la même adresse est rattaché au nouveau billet (lot 6b).
  describe('A-22 : rachat d’un billet par un Attendee annulé', () => {
    // Billet A (930100, annulé) puis billet B (930101, Processed) à la même adresse, pour l'Attendee `known`.
    const oldTicket = (overrides = {}) => itemOfKnown({ state: 'Canceled', ...overrides });
    const newTicket = (id = 930101, { answers = {}, ...overrides } = {}) => regionItem(id, { answers: { Email: 'lea.930100@example.org', ...answers }, ...overrides });
    const returning = (overrides = {}) => known({ status: 'cancelled', ...overrides });

    it('rattache l’Attendee annulé au nouveau billet : 0 création, 1 mise à jour, aucune erreur', () => {
      const result = plan([oldTicket(), newTicket()], [returning()]);
      assert.deepEqual([result.create, result.cancel, result.errors], [[], [], []]);
      assert.equal(result.update.length, 1);
      assert.equal(result.update[0].documentId, 'att-1');
    });

    it('la mise à jour porte les identifiants du nouveau billet et le statut active', () => {
      const [update] = plan([oldTicket(), newTicket()], [returning()]).update;
      assert.equal(String(update.changes.helloassoItemId), '930101');
      assert.equal(String(update.changes.helloassoOrderId), String(newTicket().order.id));
      assert.equal(update.changes.status, 'active');
    });

    it('rafraîchit les champs importés qui ont changé, sauf ceux que le participant a édités (R-31)', () => {
      const item = newTicket(930101, { answers: { Poste: 'Directrice', Organisation: 'Autre Société' } });
      const [update] = plan([oldTicket(), item], [returning({ editedFields: ['jobTitle'] })]).update;
      assert.equal(update.changes.company, 'Autre Société');
      assert.ok(!('jobTitle' in update.changes), 'jobTitle édité par le participant');
    });

    it('ne touche ni au rôle, ni à l’e-mail, ni aux rattachements, ni aux consentements, ni à editedFields', () => {
      const [update] = plan([oldTicket(), newTicket()], [returning({ role: 'speaker', directoryOptIn: true, consentAt: '2026-10-01T08:00:00.000Z' })]).update;
      const allowed = ['helloassoItemId', 'helloassoOrderId', 'status', 'firstName', 'lastName', 'jobTitle', 'company'];
      assert.deepEqual(Object.keys(update.changes).filter((key) => !allowed.includes(key)), []);
    });

    it('est idempotent : après le rattachement, la synchronisation suivante donne 0, 0, 0 (l’ancien billet annulé est ignoré sans erreur)', () => {
      const first = plan([oldTicket(), newTicket()], [returning()]);
      const attached = known({ helloassoItemId: String(first.update[0].changes.helloassoItemId), status: 'active', ...first.update[0].changes });
      const second = plan([oldTicket(), newTicket()], [attached]);
      assert.deepEqual([second.create, second.update, second.cancel, second.errors], [[], [], [], []]);
    });

    it('ne rattache qu’une fois par synchronisation : un second billet actif à la même adresse reste en DUPLICATE_EMAIL', () => {
      const result = plan([oldTicket(), newTicket(930101), newTicket(930102)], [returning()]);
      assert.equal(result.update.length, 1);
      assert.equal(String(result.update[0].changes.helloassoItemId), '930101', 'le plus petit identifiant est rattaché');
      assert.deepEqual(result.errors, [{ itemId: '930102', code: 'DUPLICATE_EMAIL', email: 'lea.930100@example.org' }]);
      assert.deepEqual(result.create, []);
    });

    it('reconnaît l’adresse malgré les majuscules du champ Email du nouveau billet', () => {
      const item = regionItem(930101, { answers: { Email: ' LEA.930100@Example.ORG ' } });
      const result = plan([oldTicket(), item], [returning()]);
      assert.equal(result.update.length, 1);
      assert.deepEqual(result.errors, []);
    });

    it('ne rattache pas quand le nouveau billet est lui-même annulé ou en attente', () => {
      assert.deepEqual(plan([oldTicket(), newTicket(930101, { state: 'Canceled' })], [returning()]).update, []);
      const waiting = plan([oldTicket(), newTicket(930101, { state: 'Waiting' })], [returning()]);
      assert.deepEqual(waiting.update, []);
      assert.deepEqual(waiting.errors.map((error) => error.code), ['WAITING']);
    });

    it('ne rattache pas un billet à l’adresse d’un Attendee encore actif : DUPLICATE_EMAIL', () => {
      const result = plan([newTicket()], [known({ status: 'active' })]);
      assert.deepEqual(result.update, []);
      assert.deepEqual(result.errors.map((error) => error.code), ['DUPLICATE_EMAIL']);
    });

    it('un Attendee annulé pendant cette synchronisation n’est rattaché qu’à la suivante : le billet B reste en DUPLICATE_EMAIL', () => {
      const active = known({ status: 'active' });
      const first = plan([oldTicket(), newTicket()], [active]);
      assert.deepEqual(first.cancel, ['att-1']);
      assert.deepEqual(first.update, []);
      assert.deepEqual(first.errors.map((error) => error.code), ['DUPLICATE_EMAIL']);

      const second = plan([oldTicket(), newTicket()], [returning()]);
      assert.equal(second.update.length, 1);
      assert.deepEqual(second.errors, []);
    });

    it('n’affecte pas un Attendee annulé à une autre adresse', () => {
      const other = regionItem(930101, { answers: { Email: 'quelquun.d.autre@example.org' } });
      const result = plan([oldTicket(), other], [returning()]);
      assert.deepEqual(result.update, []);
      assert.equal(result.create.length, 1);
    });

    it('réactive toujours le même billet quand il redevient actif (Q-15) : aucun rattachement à un autre', () => {
      const result = plan([itemOfKnown()], [returning()]);
      assert.equal(result.update.length, 1);
      assert.equal(result.update[0].changes.status, 'active');
      assert.ok(!('helloassoItemId' in result.update[0].changes));
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

    describe('A-23 : l’e-mail est l’identifiant de connexion, une valeur vide ne vide rien', () => {
      it('ne modifie jamais l’e-mail d’un Attendee existant, même si HelloAsso en donne une autre', () => {
        const result = plan([itemOfKnown({ answers: { Email: 'autre.adresse@example.org' } })], [known()]);
        assert.deepEqual([result.create, result.update, result.cancel, result.errors], [[], [], [], []]);
      });

      it('ne modifie pas l’e-mail quand un autre champ change en même temps', () => {
        const result = plan([itemOfKnown({ answers: { Email: 'autre.adresse@example.org', Poste: 'Directrice' } })], [known()]);
        assert.deepEqual(result.update, [{ documentId: 'att-1', changes: { jobTitle: 'Directrice' } }]);
      });

      for (const [field, answers] of [
        ['jobTitle', { Poste: '' }],
        ['company', { Organisation: '   ' }],
      ]) {
        it(`une réponse vide ne vide pas « ${field} » : aucune mise à jour`, () => {
          const result = plan([itemOfKnown({ answers })], [known()]);
          assert.deepEqual(result.update, []);
        });
      }

      for (const [field, overrides] of [
        ['firstName', { firstName: '' }],
        ['lastName', { lastName: ' ' }],
      ]) {
        it(`un ${field} vide côté HelloAsso ne vide pas le champ`, () => {
          const result = plan([itemOfKnown(overrides)], [known()]);
          assert.deepEqual(result.update, []);
        });
      }
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
