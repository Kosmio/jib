'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');
const { zonedToUtc } = require('./time');
const { profileCompletion } = require('./profile');

/**
 * Reminders (R-70 to R-72, R-87, I-39). Pure: the service loads, these functions decide. The clock is always a parameter (`now`).
 *   profile     (a) active attendees under 70 % of profile
 *   no-meeting  (b) active attendees with no accepted or pending meeting
 *   eve         (c) the day before, 16h00: agenda of the day, expired requests, place and access
 *   welcome     reminder to the attendees who never activated their space (template `welcome`)
 */

const TIME_ZONE = 'Europe/Paris';
const SCENARIOS = ['profile', 'no-meeting', 'eve', 'welcome'];
const FIRST_HOUR = 8;
const LAST_HOUR = 20;
const PROFILE_THRESHOLD = 70;
const MORNING = { hours: 9, minutes: 30 };
const EVENING = { hours: 16, minutes: 0 };
const EVE_LAST = { hours: 9, minutes: 0 };
const DAY_MS = 24 * 3600 * 1000;
// A planned send stays due for 24 hours: a restart or a night outside the sending hours loses nothing (T-34), a stale one is dropped.
const GRACE_MS = DAY_MS;
const MAX_FAILURES = 3;
const ACTIVATION_DELAY_DAYS = 2;
const IMPORT_DELAY_DAYS = 3;
const EDITION_LEAD_DAYS = 6;

const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' });
const dayLabelFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long' });

/** Day at Paris, "2026-12-03". */
const parisDate = (instant) => dateFormat.format(new Date(instant));

/** "2026-11-27" + n days -> "2026-12-01" (calendar arithmetic, no time zone involved). */
const addDays = (iso, days) => new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Number of calendar days at Paris from `now` to the day `iso` (negative once past). */
const daysUntil = (iso, now) => Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${parisDate(now)}T00:00:00Z`)) / DAY_MS);

/** "jeudi 3 décembre" */
const dayLabel = (iso) => dayLabelFormat.format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));

/** R-72, T-34: nothing leaves before 8h00 or from 20h00, Paris time. */
function inSendingHours(now) {
  const hour = Number(hourFormat.format(new Date(now)));
  return hour >= FIRST_HOUR && hour < LAST_HOUR;
}

/**
 * R-87: the sends planned for an attendee in a scenario, computed from the date of the edition, never fixed: [{ date, at: Date }].
 * a and b at D-6 9h30 ; a also at activation + 2 days ; welcome at import + 3 days and at D-6 ; c the day before at 16h00.
 * Nothing is planned on or after the day of the edition, but c.
 */
function plannedSends(scenario, edition, attendee) {
  const editionDay = edition.date ? String(edition.date).slice(0, 10) : null;
  const at = (date, time) => ({ date, at: zonedToUtc(date, time) });
  const lead = editionDay && at(addDays(editionDay, -EDITION_LEAD_DAYS), MORNING);
  const days = [];

  if (scenario === 'eve') return editionDay ? [at(addDays(editionDay, -1), EVENING)] : [];
  if (lead) days.push(lead);
  if (scenario === 'no-meeting' && !lead) return [];
  if (scenario === 'profile' && attendee.activatedAt) days.push(at(addDays(parisDate(attendee.activatedAt), ACTIVATION_DELAY_DAYS), MORNING));
  if (scenario === 'welcome' && attendee.createdAt) days.push(at(addDays(parisDate(attendee.createdAt), IMPORT_DELAY_DAYS), MORNING));
  return days.filter(({ date }) => !editionDay || date < editionDay);
}

/** The scenarioKey of the send due now for an attendee (`<scenario>:<planned day>`), or null: nothing planned or the window is over. */
function dueKey(scenario, edition, attendee, now) {
  const instant = new Date(now).getTime();
  const lastEve = edition.date && zonedToUtc(String(edition.date).slice(0, 10), EVE_LAST).getTime();
  const due = plannedSends(scenario, edition, attendee).filter(({ at }) => at.getTime() <= instant && instant < at.getTime() + GRACE_MS && (scenario !== 'eve' || instant < lastEve));
  const latest = due.sort((a, b) => b.at - a.at)[0];
  return latest ? `${scenario}:${latest.date}` : null;
}

/** A manual send takes the date of the day (R-71): twice the same day gives one e-mail. */
const manualKey = (scenario, now) => `${scenario}:${parisDate(now)}`;

const wantsReminders = (attendee) => attendee.emailPrefs?.reminders !== false;

/**
 * R-70, R-72: how a scenario concerns an attendee: null (not concerned), 'optedOut' (concerned, but `reminders` is off) or 'send'.
 * `attendee` = { status, role, activatedAt, emailPrefs, completion, engaged, accepted } (engaged = pending or accepted meetings).
 * c is an e-mail of service: it goes to everybody with an accepted meeting, to the others only if they accept reminders.
 */
function audience(scenario, attendee) {
  if (attendee.status !== 'active' || attendee.role === 'organizer') return null;
  const activated = Boolean(attendee.activatedAt);
  if (scenario === 'eve') return attendee.accepted > 0 || wantsReminders(attendee) ? 'send' : 'optedOut';
  const concerned =
    (scenario === 'profile' && activated && attendee.completion < PROFILE_THRESHOLD) ||
    (scenario === 'no-meeting' && activated && attendee.engaged === 0) ||
    (scenario === 'welcome' && !activated);
  if (!concerned) return null;
  return wantsReminders(attendee) ? 'send' : 'optedOut';
}

/**
 * The recipients of a scenario at `now` -> { recipients: [{ attendee, scenarioKey }], skipped: { alreadySent, optedOut } }.
 * `manual` (F-92): the key is the date of the day and everybody concerned counts ; otherwise only what is due by the calendar.
 * `sentKeys`: Set of "<attendee documentId>|<scenarioKey>" already sent (R-71) ; `failures`: Map of the same keys to the number of failed
 * attempts (given up at three). R-85: no welcome reminder until the first welcome send. NF-52: nothing while the space is closed.
 */
function planReminders({ scenario, edition, attendees, sentKeys = new Set(), failures = new Map(), now, manual = false }) {
  const plan = { recipients: [], skipped: { alreadySent: 0, optedOut: 0 } };
  if (!edition.participantSpaceEnabled || (scenario === 'welcome' && !edition.welcomeStartedAt)) return plan;
  // F-178: the "no meeting yet" reminder makes no sense once the B2B meetings are turned off.
  if (scenario === 'no-meeting' && edition.b2bEnabled === false) return plan;

  for (const attendee of attendees) {
    const verdict = audience(scenario, attendee);
    if (!verdict) continue;
    const scenarioKey = manual ? manualKey(scenario, now) : dueKey(scenario, edition, attendee, now);
    if (!scenarioKey) continue;
    const id = `${attendee.documentId}|${scenarioKey}`;
    if (sentKeys.has(id)) plan.skipped.alreadySent += 1;
    else if (verdict === 'optedOut') plan.skipped.optedOut += 1;
    else if ((failures.get(id) ?? 0) < MAX_FAILURES) plan.recipients.push({ attendee, scenarioKey });
  }
  return plan;
}

/** Facts of an attendee the rules need, from the loaded attendee and the meetings of the edition. */
function attendeeFacts(attendee, meetings) {
  const own = meetings.filter((meeting) => involves(meeting, attendee.documentId));
  return {
    ...attendee,
    completion: profileCompletion(attendee),
    engaged: own.filter(({ status }) => ['pending', 'accepted'].includes(status)).length,
    accepted: own.filter(({ status }) => status === 'accepted').length,
  };
}

/** Meeting = { id, status, startsAt, endsAt, location, requesterId, requesterName, targetAttendeeId, targetName, targetRepIds } */
const involves = (meeting, viewerId) => meeting.requesterId === viewerId || meeting.targetAttendeeId === viewerId || (meeting.targetRepIds ?? []).includes(viewerId);

/**
 * R-70 c, R-17: the agenda of a viewer from the meetings of the edition: accepted ones and expired requests, by time.
 * -> { accepted: [{ id, startsAt, endsAt, location, counterpartName }], expired: [{ id, startsAt, counterpartName }] }
 */
function agendaOf(viewerId, meetings) {
  const own = meetings
    .filter((meeting) => involves(meeting, viewerId))
    .map((meeting) => ({
      id: meeting.id,
      status: meeting.status,
      startsAt: meeting.startsAt,
      endsAt: meeting.endsAt,
      location: meeting.location ?? null,
      counterpartName: meeting.requesterId === viewerId ? meeting.targetName : meeting.requesterName,
    }))
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  const keep = (status) => own.filter((meeting) => meeting.status === status).map(({ status: _status, ...meeting }) => meeting);
  return { accepted: keep('accepted'), expired: keep('expired') };
}

const MISSING_LABELS = [
  ['jobTitle', 'votre fonction'],
  ['photo', 'votre photo'],
  ['bio', 'votre présentation'],
  ['topics', 'vos sujets d’intérêt'],
];

/** What a profile still lacks, in words: ["votre photo", "vos sujets d’intérêt"]. */
function missingParts(attendee) {
  const filled = (value) => (Array.isArray(value) ? value.length > 0 : typeof value === 'string' ? value.trim() !== '' : Boolean(value));
  return MISSING_LABELS.filter(([field]) => !filled(attendee[field])).map(([, label]) => label);
}

/** I-39: a link per recipient, signed with a server secret, that works for nobody else: "<documentId>.<signature>". Never expires. */
const signUnsubscribe = (secret, attendeeId) => `${attendeeId}.${createHmac('sha256', secret).update(`reminders-unsubscribe:${attendeeId}`).digest('base64url')}`;

/** The attendee documentId of a valid token, or null. */
function verifyUnsubscribe(secret, token) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  const id = token.slice(0, dot);
  if (dot < 1 || !id) return null;
  const expected = Buffer.from(signUnsubscribe(secret, id));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

/** I-39: List-Unsubscribe and List-Unsubscribe-Post (RFC 8058, one click) headers. */
const unsubscribeHeaders = (url) => ({ 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });

module.exports = {
  SCENARIOS,
  PROFILE_THRESHOLD,
  MAX_FAILURES,
  parisDate,
  addDays,
  daysUntil,
  dayLabel,
  inSendingHours,
  plannedSends,
  dueKey,
  manualKey,
  audience,
  planReminders,
  attendeeFacts,
  agendaOf,
  missingParts,
  signUnsubscribe,
  verifyUnsubscribe,
  unsubscribeHeaders,
};
