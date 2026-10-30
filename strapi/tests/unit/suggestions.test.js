'use strict';

/**
 * lib/suggestions.js (lot 9, tests d'abord ; R-50, F-23, A-34) : `suggest({ meId, myTopicIds, candidates, excludedIds, day, limit = 3 })`.
 * « Ils partagent vos sujets » : candidats visibles ayant au moins un sujet en commun, hors soi, hors personnes déjà en rendez-vous
 * accepté ou en attente (`excludedIds`), triés par nombre de sujets communs, puis intervenants et exposants d'abord, puis aléatoire
 * stable par jour (empreinte de `meId:day:id`, `day` = YYYY-MM-DD à Paris). Trois au plus. Sans sujet : intervenants et exposants.
 * Les candidats sont déjà filtrés par visibilité (R-41) : ce module ne lit pas la base.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { pending } = require('../helpers/pending');

const lib = () => require('../../src/api/espace/lib/suggestions');

const topic = (id) => ({ id, name: `Sujet ${id}` });
const attendee = (id, topicIds, tag = 'participant') => ({
  kind: 'attendee',
  id,
  displayName: `Personne ${id}`,
  subtitle: '',
  photoUrl: null,
  initials: 'PX',
  tag,
  topics: topicIds.map(topic),
});
const exhibitor = (id, topicIds) => ({
  kind: 'exhibitor',
  id,
  displayName: `Exposant ${id}`,
  subtitle: 'Stand 4',
  photoUrl: null,
  initials: 'EX',
  tag: 'exhibitor',
  topics: topicIds.map(topic),
  standNumber: '4',
});

const DAY = '2026-12-01';
const suggest = (options) => lib().suggest({ meId: 'me', myTopicIds: ['t1'], candidates: [], excludedIds: [], day: DAY, ...options });
const ids = (list) => list.map((card) => card.id);
const days = (count, start = '2026-11-01') => Array.from({ length: count }, (_, index) => new Date(Date.parse(`${start}T12:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10));

describe('suggest : filtre (R-50)', pending('lot 9'), () => {
  it('rend les candidats qui partagent au moins un sujet', () => {
    const candidates = [attendee('a', ['t1']), attendee('b', ['t2']), attendee('c', ['t1', 't2'])];
    assert.deepEqual(ids(suggest({ candidates })).sort(), ['a', 'c']);
  });

  it('ne rend jamais le participant lui-même, même s’il figure parmi les candidats', () => {
    const candidates = [attendee('me', ['t1']), attendee('a', ['t1'])];
    assert.deepEqual(ids(suggest({ candidates })), ['a']);
  });

  it('écarte les personnes déjà en rendez-vous accepté ou en attente avec soi (excludedIds)', () => {
    const candidates = [attendee('a', ['t1']), attendee('b', ['t1']), attendee('c', ['t1'])];
    assert.deepEqual(ids(suggest({ candidates, excludedIds: ['a', 'c'] })), ['b']);
  });

  it('une personne exclue est écartée même avec trois sujets en commun', () => {
    const candidates = [attendee('a', ['t1', 't2', 't3']), attendee('b', ['t1'])];
    assert.deepEqual(ids(suggest({ myTopicIds: ['t1', 't2', 't3'], candidates, excludedIds: ['a'] })), ['b']);
  });

  it('un exposant partageant un sujet peut être suggéré', () => {
    assert.deepEqual(ids(suggest({ candidates: [exhibitor('x1', ['t1']), attendee('a', ['t2'])] })), ['x1']);
  });

  it('rend les cartes reçues (mêmes champs)', () => {
    const candidate = attendee('a', ['t1']);
    assert.deepEqual(suggest({ candidates: [candidate] }), [candidate]);
  });

  it('aucun candidat : liste vide', () => {
    assert.deepEqual(suggest({ candidates: [] }), []);
  });

  it('aucun sujet en commun avec personne : liste vide, même s’il existe des intervenants', () => {
    const candidates = [attendee('a', ['t2']), attendee('s', ['t3'], 'speaker'), exhibitor('x1', ['t4'])];
    assert.deepEqual(suggest({ candidates }), []);
  });
});

describe('suggest : au plus trois (R-50)', pending('lot 9'), () => {
  const many = Array.from({ length: 8 }, (_, index) => attendee(`p${index}`, ['t1']));

  it('trois par défaut', () => {
    assert.equal(suggest({ candidates: many }).length, 3);
  });

  it('moins de trois candidats : tous', () => {
    assert.equal(suggest({ candidates: many.slice(0, 2) }).length, 2);
  });

  it('`limit` règle le nombre', () => {
    assert.equal(suggest({ candidates: many, limit: 5 }).length, 5);
    assert.equal(suggest({ candidates: many, limit: 1 }).length, 1);
  });

  it('aucun doublon', () => {
    const result = ids(suggest({ candidates: many, limit: 8 }));
    assert.equal(new Set(result).size, result.length);
  });
});

describe('suggest : ordre (R-50)', pending('lot 9'), () => {
  it('par nombre de sujets communs décroissant', () => {
    const candidates = [attendee('un', ['t1']), attendee('trois', ['t1', 't2', 't3']), attendee('deux', ['t1', 't2'])];
    assert.deepEqual(ids(suggest({ myTopicIds: ['t1', 't2', 't3'], candidates })), ['trois', 'deux', 'un']);
  });

  it('seuls les sujets du participant comptent : les sujets en plus du candidat ne le font pas monter', () => {
    const candidates = [attendee('riche', ['t1', 't8', 't9']), attendee('pile', ['t1', 't2'])];
    assert.deepEqual(ids(suggest({ myTopicIds: ['t1', 't2'], candidates })), ['pile', 'riche']);
  });

  it('à nombre égal, les intervenants et les exposants passent avant les participants, quel que soit le jour', () => {
    const candidates = [attendee('p1', ['t1']), attendee('p2', ['t1']), attendee('p3', ['t1']), attendee('s1', ['t1'], 'speaker'), exhibitor('x1', ['t1'])];
    for (const day of days(15)) {
      const result = ids(suggest({ candidates, day }));
      assert.deepEqual(result.slice(0, 2).sort(), ['s1', 'x1'], `jour ${day}`);
      assert.ok(result[2].startsWith('p'), `jour ${day}`);
    }
  });

  it('le nombre de sujets communs l’emporte sur la catégorie : deux sujets d’un participant avant un sujet d’un intervenant', () => {
    const candidates = [attendee('s1', ['t1'], 'speaker'), attendee('p2', ['t1', 't2'])];
    assert.deepEqual(ids(suggest({ myTopicIds: ['t1', 't2'], candidates })), ['p2', 's1']);
  });

  it('un intervenant à trois sujets communs passe devant un exposant à un seul', () => {
    const candidates = [exhibitor('x1', ['t1']), attendee('s1', ['t1', 't2', 't3'], 'speaker')];
    assert.deepEqual(ids(suggest({ myTopicIds: ['t1', 't2', 't3'], candidates })), ['s1', 'x1']);
  });
});

describe('suggest : aléa stable par jour (R-50 : graine = identifiant du participant + date)', pending('lot 9'), () => {
  const tied = Array.from({ length: 8 }, (_, index) => attendee(`p${index}`, ['t1']));
  const run = (options = {}) => ids(suggest({ candidates: tied, ...options }));

  it('un même jour, un même participant : toujours le même résultat', () => {
    assert.deepEqual(run(), run());
    assert.deepEqual(run({ day: '2026-12-03' }), run({ day: '2026-12-03' }));
  });

  it('ne dépend pas de l’ordre dans lequel les candidats sont reçus', () => {
    const forward = run();
    assert.deepEqual(ids(suggest({ candidates: [...tied].reverse() })), forward);
    const shuffled = [tied[3], tied[6], tied[0], tied[7], tied[2], tied[5], tied[1], tied[4]];
    assert.deepEqual(ids(suggest({ candidates: shuffled })), forward);
  });

  it('change d’un jour à l’autre : sur 30 jours, plusieurs résultats distincts', () => {
    const outcomes = new Set(days(30).map((day) => run({ day }).join(',')));
    assert.ok(outcomes.size > 1, 'le résultat ne dépend pas du jour');
  });

  it('change d’un participant à l’autre : sur 30 participants, plusieurs résultats distincts', () => {
    const outcomes = new Set(Array.from({ length: 30 }, (_, index) => run({ meId: `me-${index}` }).join(',')));
    assert.ok(outcomes.size > 1, 'le résultat ne dépend pas du participant');
  });

  it('ne favorise pas toujours les mêmes candidats : sur 60 jours, au moins 6 des 8 sortent', () => {
    const seen = new Set(days(60).flatMap((day) => run({ day })));
    assert.ok(seen.size >= 6, `seulement ${seen.size} candidats sortis`);
  });

  it('ne modifie ni les candidats ni leur ordre', () => {
    const copy = structuredClone(tied);
    run();
    assert.deepEqual(tied, copy);
  });

  it('ne modifie pas les identifiants exclus ni les sujets du participant', () => {
    const excludedIds = ['p0'];
    const myTopicIds = ['t1'];
    suggest({ candidates: tied, excludedIds, myTopicIds });
    assert.deepEqual(excludedIds, ['p0']);
    assert.deepEqual(myTopicIds, ['t1']);
  });
});

describe('suggest : sans sujet renseigné, les intervenants et les exposants (R-50)', pending('lot 9'), () => {
  const candidates = [
    attendee('p1', ['t1', 't2']),
    attendee('p2', ['t1']),
    attendee('s1', ['t3'], 'speaker'),
    attendee('s2', [], 'speaker'),
    exhibitor('x1', ['t4']),
    exhibitor('x2', []),
  ];

  it('rend des intervenants et des exposants seulement, sans considérer leurs sujets', () => {
    const result = ids(suggest({ myTopicIds: [], candidates, limit: 10 })).sort();
    assert.deepEqual(result, ['s1', 's2', 'x1', 'x2']);
  });

  it('trois au plus', () => {
    assert.equal(suggest({ myTopicIds: [], candidates }).length, 3);
  });

  it('exclut soi-même et les personnes déjà en rendez-vous', () => {
    const withMe = [...candidates, attendee('me', [], 'speaker')];
    assert.deepEqual(ids(suggest({ myTopicIds: [], candidates: withMe, excludedIds: ['s1', 'x1'], limit: 10 })).sort(), ['s2', 'x2']);
  });

  it('aucun intervenant ni exposant : liste vide', () => {
    assert.deepEqual(suggest({ myTopicIds: [], candidates: [attendee('p1', ['t1']), attendee('p2', [])] }), []);
  });

  it('stable par jour, comme avec des sujets', () => {
    const run = (day) => ids(suggest({ myTopicIds: [], candidates, day }));
    assert.deepEqual(run(DAY), run(DAY));
    assert.ok(new Set(days(30).map((day) => run(day).join(','))).size > 1);
  });
});
