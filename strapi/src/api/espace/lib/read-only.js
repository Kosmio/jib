'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 7;

/** NF-70: the instant the edition becomes read-only. `readOnlyAt` when set, otherwise the edition date + 7 days (computed, never stored) ; null when neither exists. */
function readOnlyAt(edition) {
  if (edition?.readOnlyAt) return new Date(edition.readOnlyAt);
  if (!edition?.date) return null;
  const date = new Date(edition.date);
  return Number.isNaN(date.getTime()) ? null : new Date(date.getTime() + DEFAULT_DAYS * DAY_MS);
}

/** NF-70: true once the read-only instant has passed. */
function isReadOnly(edition, now = new Date()) {
  const at = readOnlyAt(edition);
  return Boolean(at) && !Number.isNaN(at.getTime()) && at.getTime() <= now.getTime();
}

module.exports = { readOnlyAt, isReadOnly };
