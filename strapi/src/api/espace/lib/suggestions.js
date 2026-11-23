'use strict';

const { createHash } = require('node:crypto');
const { normalizeText } = require('./directory');

/** Stable shuffle (R-50): the same viewer, day and candidate always give the same fingerprint. */
const fingerprint = (meId, day, id) => createHash('sha1').update(`${meId}:${day}:${id}`).digest('hex');

// R-50 (V5-D): short list of French function words, so that « je cherche des financements » and « je propose des solutions » share nothing.
const STOP_WORDS = new Set(
  (
    'alors apres aussi autre autres avec avoir bien cela celui ceux chez comme dans des donc dont elle elles encore entre est etre faire fait ' +
    'leur leurs mais meme mes moi mon nos notre nous par pas plus pour que quel quelle quels qui sans ses son sur tout tous tres une vos ' +
    'votre vous cherche cherchons chercher propose proposons proposer recherche recherchons'
  ).split(' '),
);

/** Significant words of a free text: lower case, no diacritics, 3 letters or more, no stop word, plural 's' removed. */
function significantWords(text) {
  const words = normalizeText(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
    .map((word) => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word));
  return new Set(words);
}

const commonCount = (a, b) => [...a].filter((word) => b.has(word)).length;

/**
 * R-50, F-23: "Ils partagent vos sujets". `candidates` are the visible cards (CarteProfil), `excludedIds` the ids of the
 * people already in a pending or accepted meeting with the viewer, `day` the date at Paris (YYYY-MM-DD).
 * With topics: candidates sharing at least one, most shared first, then speakers and exhibitors, then the stable shuffle.
 * Without topic: the speakers and exhibitors, in the stable shuffle. 3 at most.
 * V5-D: a candidate whose `b2b.offering` shares significant words with `myLookingFor`, or whose `b2b.lookingFor` shares some with
 * `myOffering`, is suggested too, even without a common topic ; ranked after the common topics (words in common break the tie).
 */
function suggest({ meId, myTopicIds = [], myLookingFor = '', myOffering = '', candidates = [], excludedIds = [], day, limit = 3 }) {
  const mine = new Set(myTopicIds);
  const excluded = new Set(excludedIds);
  const iSeek = significantWords(myLookingFor);
  const iOffer = significantWords(myOffering);

  const pool = candidates
    .filter((card) => card.id !== meId && !excluded.has(card.id))
    .map((card) => ({
      card,
      shared: card.topics.filter(({ id }) => mine.has(id)).length,
      words: commonCount(iSeek, significantWords(card.b2b?.offering)) + commonCount(iOffer, significantWords(card.b2b?.lookingFor)),
      front: ['speaker', 'exhibitor'].includes(card.tag) ? 0 : 1,
      order: fingerprint(meId, day, card.id),
    }))
    .filter(({ shared, words, front }) => words > 0 || (mine.size ? shared > 0 : front === 0));

  return pool
    .sort((a, b) => b.shared - a.shared || b.words - a.words || a.front - b.front || (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    .slice(0, limit)
    .map(({ card }) => card);
}

module.exports = { suggest, significantWords };
