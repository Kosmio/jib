'use strict';

/**
 * lib/profile.js et lib/directory.js (lot 9, tests d'abord) :
 *   - `profileCompletion` (R-30) : 40 % pour prénom, nom et entreprise, puis 15 % chacun pour fonction, photo, présentation, un sujet ;
 *   - `normalizeText` et `searchDirectory` (A-34, F-40 à F-43, T-11) : recherche sans casse ni accents dès 2 caractères, filtres de
 *     type et de sujets, tri (intervenants et exposants d'abord avec « Tous »), défilement par curseur.
 * Entrées de `searchDirectory` : des CarteProfil (voir tests/unit/cards.test.js). Aucune base, aucun Strapi.
 *
 * Le contrat ne donne pas le nom de famille d'une carte : ces tests choisissent des noms dont l'ordre alphabétique du nom complet
 * et celui du nom de famille coïncident (Éva Aubry, Hugo Bernard, Inès Castaing, Léa Ducasse, Noé Tastet). Le tri par nom de famille se vérifie en intégration (integration/directory.test.js).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { pending } = require('../helpers/pending');

const profile = () => require('../../src/api/espace/lib/profile');
const directory = () => require('../../src/api/espace/lib/directory');

describe('profileCompletion (R-30)', pending('lot 9'), () => {
  const FULL = { firstName: 'Léa', lastName: 'Ducasse', company: 'Atelier Fictif', jobTitle: 'Cheffe de projet', photo: { url: '/uploads/lea.webp' }, bio: 'Je cherche des partenaires.', topics: [{ documentId: 't1' }] };
  const completion = (fields) => profile().profileCompletion({ ...FULL, ...fields });
  const BASE = { jobTitle: null, photo: null, bio: null, topics: [] };

  it('100 quand tout est renseigné', () => {
    assert.equal(completion({}), 100);
  });

  it('40 pour prénom, nom et entreprise seuls (profil importé de HelloAsso)', () => {
    assert.equal(completion(BASE), 40);
  });

  it('+15 pour la fonction', () => assert.equal(completion({ ...BASE, jobTitle: 'Cheffe de projet' }), 55));
  it('+15 pour la photo', () => assert.equal(completion({ ...BASE, photo: { url: '/uploads/x.webp' } }), 55));
  it('+15 pour la présentation', () => assert.equal(completion({ ...BASE, bio: 'Bonjour.' }), 55));
  it('+15 pour au moins un sujet', () => assert.equal(completion({ ...BASE, topics: [{ documentId: 't1' }] }), 55));

  it('un, deux ou trois sujets valent la même chose', () => {
    const one = completion({ ...BASE, topics: [{ documentId: 't1' }] });
    assert.equal(completion({ ...BASE, topics: [{ documentId: 't1' }, { documentId: 't2' }] }), one);
    assert.equal(completion({ ...BASE, topics: [{ documentId: 't1' }, { documentId: 't2' }, { documentId: 't3' }] }), one);
  });

  it('cumule : 70 avec deux éléments, 85 avec trois', () => {
    assert.equal(completion({ ...BASE, jobTitle: 'Cheffe de projet', bio: 'Bonjour.' }), 70);
    assert.equal(completion({ ...BASE, jobTitle: 'Cheffe de projet', bio: 'Bonjour.', photo: { url: '/uploads/x.webp' } }), 85);
  });

  it('un entier, pour toute combinaison', () => {
    for (const jobTitle of [null, 'x']) {
      for (const photo of [null, { url: '/u' }]) {
        for (const bio of [null, 'x']) {
          for (const topics of [[], [{ documentId: 't' }]]) {
            const value = completion({ jobTitle, photo, bio, topics });
            assert.ok(Number.isInteger(value) && value >= 40 && value <= 100, String(value));
          }
        }
      }
    }
  });

  it('une valeur vide, nulle ou absente ne compte pas', () => {
    assert.equal(completion({ ...BASE, jobTitle: '', bio: '' }), 40);
    assert.equal(profile().profileCompletion({ firstName: 'Léa', lastName: 'Ducasse', company: 'Atelier Fictif' }), 40);
  });

  describe('prénom, nom et entreprise forment un seul bloc de 40 %', () => {
    for (const missing of ['firstName', 'lastName', 'company']) {
      it(`sans ${missing}, le bloc ne compte pas`, () => {
        assert.equal(completion({ ...BASE, [missing]: '' }), 0);
      });
    }

    it('les autres éléments comptent quand même', () => {
      assert.equal(completion({ ...BASE, company: '', jobTitle: 'Cheffe de projet' }), 15);
    });
  });

  it('ne modifie pas son argument', () => {
    const input = { ...FULL };
    const copy = structuredClone(input);
    profile().profileCompletion(input);
    assert.deepEqual(input, copy);
  });
});

describe('normalizeText (A-34)', pending('lot 9'), () => {
  const normalize = (text) => directory().normalizeText(text);

  it('met en minuscules', () => assert.equal(normalize('ÉCONOMIE Circulaire'), 'economie circulaire'));
  it('retire les diacritiques (NFD)', () => assert.equal(normalize('Économie circulaire'), 'economie circulaire'));
  it('traite cédille, tréma et circonflexe', () => assert.equal(normalize('François Noël Hélène Forêt'), 'francois noel helene foret'));
  it('laisse le reste intact : chiffres, ponctuation, espaces', () => assert.equal(normalize('Process, data et IA 2026'), 'process, data et ia 2026'));
  it('un texte sans accent ne change pas', () => assert.equal(normalize('construction bois'), 'construction bois'));
  it('est idempotent', () => assert.equal(normalize(normalize('Été à Pau')), normalize('Été à Pau')));
});

describe('searchDirectory (A-34, F-40 à F-43, T-11)', pending('lot 9'), () => {
  const person = (id, displayName, { subtitle = '', tag = 'participant', topics = [] } = {}) => ({
    kind: 'attendee',
    id,
    displayName,
    subtitle,
    photoUrl: null,
    initials: displayName.split(' ').map((word) => word[0]).join('').slice(0, 2),
    tag,
    topics: topics.map(([topicId, name]) => ({ id: topicId, name })),
  });
  const exhibitor = (id, displayName, { topics = [], standNumber = '4' } = {}) => ({
    kind: 'exhibitor',
    id,
    displayName,
    subtitle: `Stand ${standNumber}`,
    photoUrl: null,
    initials: displayName.slice(0, 2).toUpperCase(),
    tag: 'exhibitor',
    topics: topics.map(([topicId, name]) => ({ id: topicId, name })),
    standNumber,
  });

  const ECO = ['t-eco', 'Économie circulaire'];
  const BOIS = ['t-bois', 'Construction bois'];
  const DATA = ['t-data', 'Process, data et IA'];

  const CARDS = [
    person('p-lea', 'Léa Ducasse', { subtitle: 'Cheffe de projet, Atelier Fictif', topics: [ECO, BOIS] }),
    person('p-hugo', 'Hugo Bernard', { subtitle: 'Ingénieur, Scierie du Sud', topics: [DATA] }),
    person('p-ines', 'Inès Castaing', { subtitle: 'Architecte, Cabinet Boisé', topics: [BOIS] }),
    person('p-eva', 'Éva Aubry', { subtitle: 'Directrice, Forêt Avenir', topics: [] }),
    person('s-antoine', 'Antoine Vergnes', { subtitle: 'Directeur de la recherche, Institut du Bois Fictif', tag: 'speaker', topics: [] }),
    person('r-noe', 'Noé Tastet', { subtitle: 'Commercial, Sylvadour', tag: 'exhibitor_rep', topics: [BOIS] }),
    exhibitor('x-sylvadour', 'Sylvadour', { topics: [BOIS, ECO] }),
    exhibitor('x-resineo', 'Résinéo', { standNumber: '12', topics: [DATA] }),
  ];
  const search = (options = {}, cards = CARDS) => directory().searchDirectory({ cards, ...options });
  const ids = (result) => result.items.map((card) => card.id);

  describe('forme du résultat', () => {
    it('{ items, nextCursor, total }', () => {
      const result = search();
      assert.deepEqual(Object.keys(result).sort(), ['items', 'nextCursor', 'total']);
      assert.ok(Array.isArray(result.items));
    });

    it('sans filtre : toutes les cartes, total égal à leur nombre, pas de page suivante', () => {
      const result = search();
      assert.equal(result.items.length, CARDS.length);
      assert.equal(result.total, CARDS.length);
      assert.equal(result.nextCursor, null);
    });

    it('rend les cartes elles-mêmes (mêmes champs)', () => {
      const lea = search().items.find((card) => card.id === 'p-lea');
      assert.deepEqual(lea, CARDS[0]);
    });

    it('aucune carte : { items: [], nextCursor: null, total: 0 }', () => {
      assert.deepEqual(search({}, []), { items: [], nextCursor: null, total: 0 });
    });
  });

  describe('recherche (F-41, T-11)', () => {
    it('T-11 : « econ » trouve le sujet « Économie circulaire » (accents ignorés)', () => {
      assert.deepEqual(ids(search({ q: 'econ' })).sort(), ['p-lea', 'x-sylvadour']);
    });

    it('insensible à la casse et aux accents dans la saisie : « ÉCON », « Économie »', () => {
      assert.deepEqual(ids(search({ q: 'ÉCON' })).sort(), ['p-lea', 'x-sylvadour']);
      assert.deepEqual(ids(search({ q: 'Économie' })).sort(), ['p-lea', 'x-sylvadour']);
    });

    it('cherche dans le nom, sans accents : « lea » trouve « Léa Ducasse »', () => {
      assert.deepEqual(ids(search({ q: 'lea' })), ['p-lea']);
    });

    it('cherche dans le nom de famille : « ducasse »', () => {
      assert.deepEqual(ids(search({ q: 'ducasse' })), ['p-lea']);
    });

    it('cherche dans l’entreprise : « atelier »', () => {
      assert.deepEqual(ids(search({ q: 'atelier' })), ['p-lea']);
    });

    it('cherche dans la fonction : « architecte »', () => {
      assert.deepEqual(ids(search({ q: 'architecte' })), ['p-ines']);
    });

    it('cherche dans le nom d’un exposant : « resineo » trouve « Résinéo »', () => {
      assert.deepEqual(ids(search({ q: 'resineo' })), ['x-resineo']);
    });

    it('cherche dans les noms de sujets : « data » trouve les profils du sujet « Process, data et IA »', () => {
      assert.deepEqual(ids(search({ q: 'data' })).sort(), ['p-hugo', 'x-resineo']);
    });

    it('trouve une partie de mot : « constru »', () => {
      assert.deepEqual(ids(search({ q: 'constru' })).sort(), ['p-lea', 'p-ines', 'r-noe', 'x-sylvadour'].sort());
    });

    it('ne cherche pas dans l’étiquette ni dans l’identifiant : « speaker », « exhibitor », « p-lea »', () => {
      for (const q of ['speaker', 'exhibitor', 'p-lea', 'attendee']) assert.deepEqual(ids(search({ q })), [], q);
    });

    it('F-44 : une recherche sans résultat donne une liste vide, total 0', () => {
      assert.deepEqual(search({ q: 'zzzz' }), { items: [], nextCursor: null, total: 0 });
    });

    describe('ignorée sous 2 caractères (F-41)', () => {
      for (const q of [undefined, null, '', 'e', 'é', ' ']) {
        it(`${JSON.stringify(q) ?? 'undefined'} : toutes les cartes`, () => {
          assert.equal(search({ q }).total, CARDS.length);
        });
      }

      it('deux caractères suffisent : « ea » filtre', () => {
        const result = search({ q: 'ea' });
        assert.ok(result.total > 0 && result.total < CARDS.length);
      });
    });
  });

  describe('type (F-40)', () => {
    it('« all » ou absent : tout', () => {
      assert.equal(search({ type: 'all' }).total, CARDS.length);
      assert.equal(search({ type: undefined }).total, CARDS.length);
    });

    it('« participant » : participants et représentants d’exposant', () => {
      assert.deepEqual(ids(search({ type: 'participant' })).sort(), ['p-eva', 'p-hugo', 'p-ines', 'p-lea', 'r-noe']);
    });

    it('« speaker » : les intervenants', () => {
      assert.deepEqual(ids(search({ type: 'speaker' })), ['s-antoine']);
    });

    it('« exhibitor » : les cartes exposant', () => {
      assert.deepEqual(ids(search({ type: 'exhibitor' })).sort(), ['x-resineo', 'x-sylvadour']);
    });

    it('se combine avec la recherche : « econ » parmi les participants', () => {
      assert.deepEqual(ids(search({ type: 'participant', q: 'econ' })), ['p-lea']);
    });
  });

  describe('sujets', () => {
    it('un sujet : les cartes qui le portent, exposants compris', () => {
      assert.deepEqual(ids(search({ topicIds: ['t-data'] })).sort(), ['p-hugo', 'x-resineo']);
    });

    it('plusieurs sujets : une carte qui les porte tous est retenue, une carte qui n’en porte aucun est écartée', () => {
      const result = ids(search({ topicIds: ['t-eco', 't-bois'] }));
      assert.ok(result.includes('p-lea'), 'Léa porte les deux sujets');
      assert.ok(result.includes('x-sylvadour'));
      for (const excluded of ['p-hugo', 'p-eva', 's-antoine', 'x-resineo']) assert.ok(!result.includes(excluded), `${excluded} ne porte aucun des deux`);
    });

    it('liste vide ou absente : pas de filtre', () => {
      assert.equal(search({ topicIds: [] }).total, CARDS.length);
      assert.equal(search({ topicIds: undefined }).total, CARDS.length);
    });

    it('un sujet inconnu ne trouve personne', () => {
      assert.equal(search({ topicIds: ['t-inconnu'] }).total, 0);
    });

    it('se combine avec le type et la recherche', () => {
      assert.deepEqual(ids(search({ topicIds: ['t-bois'], type: 'exhibitor' })), ['x-sylvadour']);
      assert.deepEqual(ids(search({ topicIds: ['t-bois'], q: 'ines' })), ['p-ines']);
    });
  });

  describe('tri (F-42, A-34)', () => {
    it('« Tous » : intervenants et exposants d’abord, puis les participants et représentants par ordre alphabétique', () => {
      assert.deepEqual(ids(search({ type: 'all' })), ['s-antoine', 'x-resineo', 'x-sylvadour', 'p-eva', 'p-hugo', 'p-ines', 'p-lea', 'r-noe']);
    });

    it('les intervenants passent avant les exposants (ils sont cités en premier)', () => {
      const result = ids(search({ type: 'all' }));
      assert.ok(result.indexOf('s-antoine') < result.indexOf('x-resineo'));
    });

    it('les exposants se trient par nom de structure, accents ignorés : « Résinéo » avant « Sylvadour »', () => {
      assert.deepEqual(ids(search({ type: 'exhibitor' })), ['x-resineo', 'x-sylvadour']);
    });

    it('un nom accentué se trie comme sa lettre de base : « Éva » avant « Hugo », « Inès » avant « Léa »', () => {
      const order = ids(search({ type: 'participant' }));
      assert.ok(order.indexOf('p-eva') < order.indexOf('p-hugo'));
      assert.ok(order.indexOf('p-ines') < order.indexOf('p-lea'));
    });

    it('avec un filtre de type, l’ordre est celui du nom, sans regroupement', () => {
      assert.deepEqual(ids(search({ type: 'participant' })), ['p-eva', 'p-hugo', 'p-ines', 'p-lea', 'r-noe']);
    });

    it('ne dépend pas de l’ordre des cartes reçues', () => {
      assert.deepEqual(ids(search({}, [...CARDS].reverse())), ids(search({})));
    });

    it('la recherche garde le même ordre : intervenants et exposants d’abord, puis les personnes par nom', () => {
      assert.deepEqual(ids(search({ q: 'bois' })), ['s-antoine', 'x-sylvadour', 'p-ines', 'p-lea', 'r-noe']);
    });
  });

  describe('défilement par curseur : 30 cartes par page (F-43)', () => {
    const MANY = Array.from({ length: 70 }, (_, index) => person(`p${String(index).padStart(3, '0')}`, `Participant ${String(index).padStart(3, '0')}`));

    it('première page : 30 cartes, curseur « 30 », total 70', () => {
      const result = search({}, MANY);
      assert.equal(result.items.length, 30);
      assert.equal(result.nextCursor, '30');
      assert.equal(result.total, 70);
    });

    it('le curseur est le rang de départ, en texte', () => {
      const result = search({ cursor: '30' }, MANY);
      assert.equal(result.items.length, 30);
      assert.equal(result.items[0].id, 'p030');
      assert.equal(result.nextCursor, '60');
      assert.equal(typeof result.nextCursor, 'string');
    });

    it('dernière page : le reste, curseur nul', () => {
      const result = search({ cursor: '60' }, MANY);
      assert.equal(result.items.length, 10);
      assert.equal(result.items[0].id, 'p060');
      assert.equal(result.nextCursor, null);
      assert.equal(result.total, 70);
    });

    it('les trois pages mises bout à bout redonnent toutes les cartes, une seule fois, dans l’ordre', () => {
      const all = [];
      let cursor;
      do {
        const page = search({ cursor }, MANY);
        all.push(...ids(page));
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      assert.deepEqual(all, MANY.map((card) => card.id));
    });

    it('exactement 30 cartes : une seule page, pas de curseur', () => {
      const result = search({}, MANY.slice(0, 30));
      assert.equal(result.items.length, 30);
      assert.equal(result.nextCursor, null);
    });

    it('31 cartes : la seconde page porte une carte', () => {
      const first = search({}, MANY.slice(0, 31));
      assert.equal(first.nextCursor, '30');
      assert.equal(search({ cursor: first.nextCursor }, MANY.slice(0, 31)).items.length, 1);
    });

    it('pageSize réglable', () => {
      const result = search({ pageSize: 10 }, MANY);
      assert.equal(result.items.length, 10);
      assert.equal(result.nextCursor, '10');
    });

    it('un curseur au-delà du total : page vide, curseur nul, total conservé', () => {
      const result = search({ cursor: '500' }, MANY);
      assert.deepEqual(result.items, []);
      assert.equal(result.nextCursor, null);
      assert.equal(result.total, 70);
    });

    it('le total compte les cartes filtrées, pas la page', () => {
      assert.equal(search({ q: 'Participant 00' }, MANY).total, 10);
    });
  });

  it('ne modifie ni la liste de cartes reçue ni l’ordre de ses éléments', () => {
    const cards = [...CARDS];
    const copy = structuredClone(cards);
    search({ type: 'all', q: 'bois' }, cards);
    assert.deepEqual(cards, copy);
  });
});
