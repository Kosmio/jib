'use strict';

/**
 * Program times are text ("9h15") combined with Edition.date in Europe/Paris, then stored in UTC (A-09).
 * Intl only, no date library. The time zone is always explicit, never the one of the machine.
 */

const DEFAULT_ZONE = 'Europe/Paris';
const DAY_MS = 24 * 3600 * 1000;
const PROGRAM_TIME = /^(\d{1,2})h(\d{2})?$/;

const formatters = new Map();

/** Wall clock { year, month, day, hour, minute, second } of an instant in a time zone. */
function wallClock(instant, timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      })
    );
  }
  return Object.fromEntries(formatters.get(timeZone).formatToParts(instant).map(({ type, value }) => [type, Number(value)]));
}

/** Offset of the time zone from UTC, in milliseconds, at an instant given in milliseconds. */
function offsetMs(instant, timeZone) {
  const { year, month, day, hour, minute, second } = wallClock(new Date(instant), timeZone);
  return Date.UTC(year, month - 1, day, hour, minute, second) - Math.floor(instant / 1000) * 1000;
}

/** "9h15", "10h45" or "9h" -> { hours, minutes }; anything else ("--", "", "9:15", "25h00") -> null. */
function parseProgramTime(text) {
  const match = typeof text === 'string' ? PROGRAM_TIME.exec(text) : null;
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  return hours < 24 && minutes < 60 ? { hours, minutes } : null;
}

/**
 * Wall time of a day ("2026-12-03", { hours, minutes }) in a time zone -> Date (UTC instant).
 * A time that does not exist (clocks going forward) moves ahead by the length of the jump;
 * an ambiguous time (clocks going back) is the first of its two instants.
 */
function zonedToUtc(dateIso, { hours, minutes }, timeZone = DEFAULT_ZONE) {
  const [year, month, day] = dateIso.slice(0, 10).split('-').map(Number);
  const wall = Date.UTC(year, month - 1, day, hours, minutes);
  // The offsets in force before and after any change of the day.
  const offsets = [...new Set([offsetMs(wall - DAY_MS, timeZone), offsetMs(wall + DAY_MS, timeZone)])];
  const instants = offsets.filter((offset) => offsetMs(wall - offset, timeZone) === offset).map((offset) => wall - offset);
  return new Date(instants.length ? Math.min(...instants) : wall - offsets[0]);
}

/** "9h45", "13h00" */
function formatTimeLabel(date, timeZone = DEFAULT_ZONE) {
  const { hour, minute } = wallClock(date, timeZone);
  return `${hour}h${String(minute).padStart(2, '0')}`;
}

module.exports = { parseProgramTime, zonedToUtc, formatTimeLabel };
