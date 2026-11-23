'use strict';

const { parseProgramTime, zonedToUtc, formatTimeLabel } = require('./time');

const MINUTE_MS = 60 * 1000;

/**
 * Slots of an edition (R-01): from the start to the end of each b2b_break session, by steps of
 * `durationMinutes`, the last slot ending at the latest at the end of the session.
 * `sessions` are the sequences as Strapi returns them ({ documentId, title, start_time, end_time, kind }).
 * A session that cannot give slots is reported in `warnings` (MISSING_END, INVALID_TIME, TOO_SHORT, OVERLAP).
 */
function computeSlots({ date, durationMinutes, sessions, timeZone = 'Europe/Paris' }) {
  if (!(durationMinutes > 0)) throw new RangeError('durationMinutes must be a positive number');
  const step = durationMinutes * MINUTE_MS;
  const slots = [];
  const warnings = [];
  const accepted = [];

  const candidates = [];
  for (const session of sessions.filter(({ kind }) => kind === 'b2b_break')) {
    const warn = (code) => warnings.push({ sessionDocumentId: session.documentId, title: session.title, code });
    const start = parseProgramTime(session.start_time);
    const end = parseProgramTime(session.end_time);
    if (!session.end_time) warn('MISSING_END');
    else if (!start || !end) warn('INVALID_TIME');
    else candidates.push({ session, warn, startsAt: zonedToUtc(date, start, timeZone).getTime(), endsAt: zonedToUtc(date, end, timeZone).getTime() });
  }

  for (const { session, warn, startsAt, endsAt } of candidates.sort((a, b) => a.startsAt - b.startsAt)) {
    if (endsAt <= startsAt) warn('INVALID_TIME');
    else if (endsAt - startsAt < step) warn('TOO_SHORT');
    else if (accepted.some((other) => startsAt < other.endsAt && endsAt > other.startsAt)) warn('OVERLAP');
    else {
      accepted.push({ startsAt, endsAt });
      for (let at = startsAt; at + step <= endsAt; at += step) {
        slots.push({
          sessionDocumentId: session.documentId,
          startsAt: new Date(at),
          endsAt: new Date(at + step),
          label: formatTimeLabel(new Date(at), timeZone),
        });
      }
    }
  }

  return { slots, warnings };
}

const keyOf = ({ startsAt, endsAt, sessionDocumentId }) => `${new Date(startsAt).getTime()}|${new Date(endsAt).getTime()}|${sessionDocumentId}`;

/**
 * Difference between the wanted slots and the existing ones, by key (startsAt, endsAt, sessionDocumentId) (R-02).
 * An existing slot outside the wanted keys that still has pending or accepted meetings (`activeMeetings` > 0)
 * is an orphan: never removed, reported to the organizer.
 */
function planSlots({ wanted, existing }) {
  const wantedKeys = new Set(wanted.map(keyOf));
  const existingKeys = new Set(existing.map(keyOf));
  const stale = existing.filter((slot) => !wantedKeys.has(keyOf(slot)));
  return {
    create: wanted.filter((slot) => !existingKeys.has(keyOf(slot))),
    keep: existing.filter((slot) => wantedKeys.has(keyOf(slot))),
    remove: stale.filter((slot) => !slot.activeMeetings),
    orphans: stale.filter((slot) => slot.activeMeetings > 0),
  };
}

module.exports = { computeSlots, planSlots };
