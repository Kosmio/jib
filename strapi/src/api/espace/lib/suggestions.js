'use strict';

const { createHash } = require('node:crypto');

/** Stable shuffle (R-50): the same viewer, day and candidate always give the same fingerprint. */
const fingerprint = (meId, day, id) => createHash('sha1').update(`${meId}:${day}:${id}`).digest('hex');

/**
 * R-50, F-23: "Ils partagent vos sujets". `candidates` are the visible cards (CarteProfil), `excludedIds` the ids of the
 * people already in a pending or accepted meeting with the viewer, `day` the date at Paris (YYYY-MM-DD).
 * With topics: candidates sharing at least one, most shared first, then speakers and exhibitors, then the stable shuffle.
 * Without topic: the speakers and exhibitors, in the stable shuffle. 3 at most.
 */
function suggest({ meId, myTopicIds = [], candidates = [], excludedIds = [], day, limit = 3 }) {
  const mine = new Set(myTopicIds);
  const excluded = new Set(excludedIds);

  const pool = candidates
    .filter((card) => card.id !== meId && !excluded.has(card.id))
    .map((card) => ({
      card,
      shared: card.topics.filter(({ id }) => mine.has(id)).length,
      front: ['speaker', 'exhibitor'].includes(card.tag) ? 0 : 1,
      order: fingerprint(meId, day, card.id),
    }))
    .filter(({ shared, front }) => (mine.size ? shared > 0 : front === 0));

  return pool
    .sort((a, b) => b.shared - a.shared || a.front - b.front || (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    .slice(0, limit)
    .map(({ card }) => card);
}

module.exports = { suggest };
