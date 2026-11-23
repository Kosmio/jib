'use strict';

const SWEEP_ABOVE = 10000;

/**
 * Sliding-window limiter in memory (NF-03): `hit(key)` records a request and answers true when it is admitted,
 * false once `max` requests were admitted within `windowMs`. A refused request is not recorded.
 * `now` is a function returning the time in milliseconds. One Strapi instance is assumed (A-04) ;
 * the service creates the instance, never this module.
 */
function createRateLimiter({ max = 5, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
  const hits = new Map();

  return {
    hit(key) {
      const current = Number(now());
      const since = current - windowMs;
      const recent = (hits.get(key) ?? []).filter((at) => at > since);
      const admitted = recent.length < max;
      if (admitted) recent.push(current);
      hits.set(key, recent);

      // Keys seen once (random addresses) would pile up: sweep the expired ones when the map grows large.
      if (hits.size > SWEEP_ABOVE) for (const [other, times] of hits) if (!times.some((at) => at > since)) hits.delete(other);
      return admitted;
    },
    reset: () => hits.clear(),
  };
}

module.exports = { createRateLimiter };
