'use strict';

/**
 * Program times are text ("9h15") combined with Edition.date in Europe/Paris, then stored in UTC (A-09).
 * Intl only, no date library. The time zone is always explicit, never the one of the machine.
 */

const DEFAULT_ZONE = 'Europe/Paris';
const DAY_MS = 24 * 3600 * 1000;
// "10h45", "10H45", "10 h 45", "10:45", "9h" (R-86). Spaces include the no-break ones (U+00A0, U+202F), which \s covers.
const PROGRAM_TIME = /^(\d{1,2})(?:\s*[hH]\s*(\d{2})?|\s*:\s*(\d{2}))$/;
const PROGRAM_TIME_EXAMPLE = '10h45';

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

/**
 * The one reader of program times (R-86): "9h15", "10h45", "10H45", "10 h 45", "10:45", "9h" -> { hours, minutes };
 * anything else ("--", "", "10.45", "25h00") -> null.
 */
function parseProgramTime(text) {
  const match = typeof text === 'string' ? PROGRAM_TIME.exec(text.trim()) : null;
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? match[3] ?? 0);
  return hours < 24 && minutes < 60 ? { hours, minutes } : null;
}

/**
 * Refusal message (French) for a sequence about to be saved, or null (R-86). Only a b2b_break session is checked, and only
 * the times that are filled in: an empty end time is reported later as MISSING_END by the slot generation.
 */
function programTimeRefusal({ kind, start_time: start, end_time: end }) {
  if (kind !== 'b2b_break') return null;
  const unreadable = [['l’heure de début', start], ['l’heure de fin', end]].filter(([, value]) => typeof value === 'string' && value.trim() !== '' && !parseProgramTime(value));
  if (!unreadable.length) return null;
  return `Pause de rendez-vous B2B : ${unreadable.map(([name]) => name).join(' et ')} à corriger, elle n’est pas lisible. Écrivez-la comme ${PROGRAM_TIME_EXAMPLE} (ou 10:45).`;
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

module.exports = { parseProgramTime, programTimeRefusal, zonedToUtc, formatTimeLabel };
