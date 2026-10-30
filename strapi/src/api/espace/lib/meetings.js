'use strict';

/**
 * Rules of the B2B meetings (R-10 to R-19, A-27 to A-32), pure: they read a snapshot of the edition and decide, the service
 * only loads, writes and notifies. Every identifier is a documentId (A-28). A snapshot `snap` is
 *   { now, tablesCount, window: { state, openAt, closeAt },
 *     slots: Map(id -> { id, startsAt, endsAt, sessionTitle }),
 *     meetings: [{ id, slotId, requesterId, targetAttendeeId, targetExhibitorId, status, tableNumber }],
 *     attendees: Map(id -> { id, status, role, meetingsOptIn, exhibitorId }),
 *     exhibitors: Map(id -> { id, standNumber, name, activeRepIds }),
 *     hosted: Map(attendeeId -> tableNumber) }
 * A target is { kind: 'p' | 'x', id } (parseTarget). Meetings of any status may be given: only `pending` and `accepted` count.
 */

const { EspaceError } = require('./errors');
const { zonedToUtc } = require('./time');

const MAX_PENDING = 10;
const DEFAULT_TABLES_COUNT = 20;
const CLOSING_TIME = { hours: 18, minutes: 0 };
const TARGET_PATTERN = /^([px]):([A-Za-z0-9_-]{1,64})$/;

// Error codes of the meetings: [HTTP status, message shown to the user]. 409 unless stated.
const ERRORS = {
  FORBIDDEN: [403, 'Cette demande ne vous est pas adressée.'],
  SLOT_NOT_FOUND: [404, 'Créneau introuvable.'],
  TARGET_NOT_FOUND: [404, 'Profil introuvable.'],
  MEETING_NOT_FOUND: [404, 'Rendez-vous introuvable.'],
  WINDOW_CLOSED: [409, 'La prise de rendez-vous n’est pas ouverte.'],
  SLOT_PAST: [409, 'Ce créneau a déjà commencé.'],
  HOST_AT_TABLE: [409, 'Vous tenez une table dédiée : vous recevez des réservations et n’envoyez pas de demandes.'],
  TARGET_UNAVAILABLE: [409, 'Cette personne ne reçoit pas de demandes de rendez-vous.'],
  SLOT_TAKEN: [409, 'Vous avez déjà un rendez-vous ou une demande en attente sur ce créneau.'],
  TARGET_BUSY: [409, 'Ce créneau vient d’être pris, choisissez-en un autre.'],
  ALREADY_REQUESTED: [409, 'Une demande est déjà en cours avec cette personne.'],
  NO_TABLE_LEFT: [409, 'Plus aucune table n’est libre sur ce créneau.'],
  TOO_MANY_PENDING: [409, `Vous avez déjà ${MAX_PENDING} demandes en attente. Attendez des réponses avant d’en envoyer d’autres.`],
  INVALID_TRANSITION: [409, 'Cette action n’est plus possible pour ce rendez-vous.'],
  COUNTER_UNAVAILABLE: [409, 'Une autre date ne peut pas être proposée pour cette demande. Refusez-la et écrivez un message.'],
};

/** EspaceError of a code above ; `message` replaces the usual text of the code when the case needs its own. */
function meetingError(code, message) {
  const [status, usual] = ERRORS[code] ?? [409, 'Action impossible.'];
  return new EspaceError(status, code, message ?? usual);
}

const time = (value) => new Date(value).getTime();
const isActive = (meeting, status) => meeting.status === status;
const involves = (meeting, attendeeId) => meeting.requesterId === attendeeId || meeting.targetAttendeeId === attendeeId;

/** "p:abc" or "x:abc" -> { kind, id }; anything else -> null. */
function parseTarget(text) {
  const match = typeof text === 'string' ? TARGET_PATTERN.exec(text) : null;
  return match ? { kind: match[1], id: match[2] } : null;
}

/** Eve of the edition at 18:00 in Paris (A-32), or null without a date. */
function defaultCloseAt(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ''));
  if (!match) return null;
  const eve = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) - 1));
  return zonedToUtc(eve.toISOString(), CLOSING_TIME);
}

/**
 * Window of the meeting requests (R-17, F-55, A-32). An empty opening is open without a lower bound ; an empty closing is
 * the eve of the edition at 18:00 in Paris. -> { state: 'open' | 'not_open' | 'closed', openAt, closeAt } (Date or null)
 */
function requestWindow(edition, now) {
  const openAt = edition.meetingRequestsOpenAt ? new Date(edition.meetingRequestsOpenAt) : null;
  const closeAt = edition.meetingRequestsCloseAt ? new Date(edition.meetingRequestsCloseAt) : defaultCloseAt(edition.date);
  let state = 'open';
  if (closeAt && time(now) >= closeAt.getTime()) state = 'closed';
  else if (openAt && time(now) < openAt.getTime()) state = 'not_open';
  return { state, openAt, closeAt };
}

/**
 * Dedicated tables (A-29, R-19): the `hostedTableNumber` of an active attendee of role `speaker`, an integer from 1 to
 * `tablesCount`. Two attendees on one number: the smallest `id` keeps it, the other is ignored. `attendees` are
 * { id, documentId?, role, status, hostedTableNumber } ; the Map is keyed by `documentId` (else `id`), the `id` orders the conflicts.
 * -> { hosted: Map(attendeeId -> number), warnings: [{ code: 'HOSTED_TABLE_CONFLICT' | 'HOSTED_TABLE_INVALID', attendeeId, hostedTableNumber }] }
 */
function hostedTables(attendees, tablesCount) {
  const hosted = new Map();
  const warnings = [];
  const byId = (a, b) => (typeof a.id === 'number' && typeof b.id === 'number' ? a.id - b.id : 0);
  const candidates = attendees.filter(({ status, hostedTableNumber }) => status === 'active' && hostedTableNumber !== null && hostedTableNumber !== undefined);

  for (const attendee of [...candidates].sort(byId)) {
    const attendeeId = attendee.documentId ?? attendee.id;
    const number = attendee.hostedTableNumber;
    const warn = (code) => warnings.push({ code, attendeeId, hostedTableNumber: number });
    if (attendee.role !== 'speaker' || !Number.isInteger(number) || number < 1 || number > tablesCount) warn('HOSTED_TABLE_INVALID');
    else if ([...hosted.values()].includes(number)) warn('HOSTED_TABLE_CONFLICT');
    else hosted.set(attendeeId, number);
  }
  return { hosted, warnings };
}

/** A Meeting loaded with the documentIds of its relations -> the meeting of a snapshot. */
const snapshotMeeting = (meeting) => ({
  id: meeting.documentId,
  slotId: meeting.slot?.documentId,
  requesterId: meeting.requester?.documentId,
  targetAttendeeId: meeting.targetAttendee?.documentId ?? null,
  targetExhibitorId: meeting.targetExhibitor?.documentId ?? null,
  status: meeting.status,
  tableNumber: meeting.tableNumber ?? null,
});

/**
 * Snapshot of an edition from the Document Service results (A-28). `slots` are loaded with their `session`, `attendees`
 * with ATTENDEE_CARD_POPULATE, `exhibitors` with their organisation, `meetings` with the documentIds of their relations.
 * -> snap, plus `warnings` (the dedicated tables ignored, A-29).
 */
function buildSnapshot({ edition, now, slots, attendees, exhibitors, meetings }) {
  const tablesCount = Number.isInteger(edition.tablesCount) ? edition.tablesCount : DEFAULT_TABLES_COUNT;
  const { hosted, warnings } = hostedTables(attendees, tablesCount);

  const activeRepIds = new Map();
  for (const { documentId, status, exhibitor } of attendees) {
    if (status === 'active' && exhibitor?.documentId) activeRepIds.set(exhibitor.documentId, [...(activeRepIds.get(exhibitor.documentId) ?? []), documentId]);
  }

  return {
    now,
    tablesCount,
    window: requestWindow(edition, now),
    slots: new Map(
      slots.map((slot) => [
        slot.documentId,
        {
          id: slot.documentId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          sessionTitle: slot.session?.title ?? null,
          label: slot.label,
          sessionId: slot.session?.documentId ?? null,
          sessionStart: slot.session?.start_time ?? null,
          sessionEnd: slot.session?.end_time ?? null,
        },
      ])
    ),
    meetings: meetings.map(snapshotMeeting),
    attendees: new Map(
      attendees.map((a) => [a.documentId, { id: a.documentId, status: a.status, role: a.role, meetingsOptIn: Boolean(a.meetingsOptIn), exhibitorId: a.exhibitor?.documentId ?? null }])
    ),
    exhibitors: new Map(
      exhibitors.map((x) => [x.documentId, { id: x.documentId, standNumber: x.standNumber ?? null, name: x.organisation?.name ?? '', activeRepIds: activeRepIds.get(x.documentId) ?? [] }])
    ),
    hosted,
    warnings,
  };
}

// --- reading the snapshot ---

const hasStarted = (snap, slot) => time(slot.startsAt) <= time(snap.now);
const acceptedAt = (snap, slotId, ignoreMeetingId) =>
  snap.meetings.filter((meeting) => isActive(meeting, 'accepted') && meeting.slotId === slotId && meeting.id !== ignoreMeetingId);

/** R-11.5: the requester has an accepted meeting on the slot, or a pending request of his own. */
const requesterBusy = (snap, requesterId, slotId, ignoreMeetingId) =>
  snap.meetings.some(
    (meeting) =>
      meeting.slotId === slotId &&
      meeting.id !== ignoreMeetingId &&
      ((isActive(meeting, 'accepted') && involves(meeting, requesterId)) || (isActive(meeting, 'pending') && meeting.requesterId === requesterId))
  );

/** R-11.6, R-14, R-19: a person has an accepted meeting, a dedicated table has its table taken, an exhibitor is full (as many meetings as active representatives). */
function targetBusy(snap, target, slotId, ignoreMeetingId) {
  const accepted = acceptedAt(snap, slotId, ignoreMeetingId);
  if (target.kind === 'x') {
    const exhibitor = snap.exhibitors.get(target.id);
    return accepted.filter((meeting) => meeting.targetExhibitorId === target.id).length >= (exhibitor?.activeRepIds.length ?? 0);
  }
  const table = snap.hosted.get(target.id);
  return accepted.some((meeting) => involves(meeting, target.id) || (table !== undefined && meeting.tableNumber === table));
}

/** Tables of the common pool (R-03): 1 to tablesCount without the dedicated ones. */
function commonTables(snap) {
  const dedicated = new Set(snap.hosted.values());
  return Array.from({ length: Math.max(0, snap.tablesCount) }, (_, index) => index + 1).filter((number) => !dedicated.has(number));
}

/** Free tables of the common pool on a slot, ascending (R-13). */
function freeTables(snap, slotId, ignoreMeetingId) {
  const used = new Set(acceptedAt(snap, slotId, ignoreMeetingId).map(({ tableNumber }) => tableNumber));
  return commonTables(snap).filter((number) => !used.has(number));
}

/** R-11.7: a pending request between the same two parties, whatever the slot and the direction. */
const alreadyRequested = (snap, requesterId, target, ignoreMeetingId) =>
  snap.meetings.some(
    (meeting) =>
      isActive(meeting, 'pending') &&
      meeting.id !== ignoreMeetingId &&
      (target.kind === 'x'
        ? meeting.requesterId === requesterId && meeting.targetExhibitorId === target.id
        : (meeting.requesterId === requesterId && meeting.targetAttendeeId === target.id) || (meeting.requesterId === target.id && meeting.targetAttendeeId === requesterId))
  );

/** R-11.4: one's own profile, or the exhibitor one represents (F-54). */
function isOwnProfile(snap, viewerId, target) {
  if (target.kind === 'p') return target.id === viewerId;
  return snap.attendees.get(viewerId)?.exhibitorId === target.id || Boolean(snap.exhibitors.get(target.id)?.activeRepIds.includes(viewerId));
}

/**
 * What stops a requester from addressing a target whatever the slot: R-11.10, then R-11.4 and R-11.3.
 * -> 'HOST_AT_TABLE' | 'SELF' | 'TARGET_UNAVAILABLE' | null ('SELF': one's own profile or stand, F-54).
 */
function requestBlock(snap, requesterId, target) {
  const requester = snap.attendees.get(requesterId);
  if (snap.hosted.has(requesterId)) return 'HOST_AT_TABLE';
  if (requester && requester.status !== 'active') return 'TARGET_UNAVAILABLE';
  if (isOwnProfile(snap, requesterId, target)) return 'SELF';

  if (target.kind === 'x') return snap.exhibitors.get(target.id)?.activeRepIds.length ? null : 'TARGET_UNAVAILABLE';
  const person = snap.attendees.get(target.id);
  if (!person || person.status !== 'active' || person.role === 'organizer') return 'TARGET_UNAVAILABLE';
  return person.meetingsOptIn || snap.hosted.has(target.id) ? null : 'TARGET_UNAVAILABLE';
}

/**
 * Creation of a request or of a booking (R-11, R-19). Order of the checks: R-11.1 WINDOW_CLOSED, .2 SLOT_PAST, .10 HOST_AT_TABLE,
 * .4 then .3 TARGET_UNAVAILABLE, .5 SLOT_TAKEN, .6 TARGET_BUSY, .7 ALREADY_REQUESTED, .8 NO_TABLE_LEFT, .9 TOO_MANY_PENDING.
 * A booking (R-19.2): 1, 2, 10, 4, 3, .5, TARGET_BUSY (table taken), ALREADY_REQUESTED (an upcoming meeting with the host).
 * `ignoreMeetingId`: a meeting left out of the reading (the request a counter-proposal answers, A-31).
 * -> { ok: true, mode: 'request' | 'booking' | 'stand', tableNumber? } | { ok: false, code }
 */
function checkRequest(snap, { requesterId, target, slotId, ignoreMeetingId }) {
  const fail = (code) => ({ ok: false, code });
  if (snap.window.state !== 'open') return fail('WINDOW_CLOSED');
  const slot = snap.slots.get(slotId);
  if (!slot) return fail('SLOT_NOT_FOUND');
  if (hasStarted(snap, slot)) return fail('SLOT_PAST');

  const blocked = requestBlock(snap, requesterId, target);
  if (blocked) return fail(blocked === 'SELF' ? 'TARGET_UNAVAILABLE' : blocked);
  if (requesterBusy(snap, requesterId, slotId, ignoreMeetingId)) return fail('SLOT_TAKEN');
  if (targetBusy(snap, target, slotId, ignoreMeetingId)) return fail('TARGET_BUSY');

  if (target.kind === 'p' && snap.hosted.has(target.id)) {
    const upcoming = snap.meetings.some(
      (meeting) =>
        meeting.id !== ignoreMeetingId &&
        (isActive(meeting, 'accepted') || isActive(meeting, 'pending')) &&
        involves(meeting, requesterId) &&
        involves(meeting, target.id) &&
        time(snap.slots.get(meeting.slotId)?.endsAt) > time(snap.now)
    );
    return upcoming ? fail('ALREADY_REQUESTED') : { ok: true, mode: 'booking', tableNumber: snap.hosted.get(target.id) };
  }

  if (alreadyRequested(snap, requesterId, target, ignoreMeetingId)) return fail('ALREADY_REQUESTED');
  if (target.kind === 'p' && !freeTables(snap, slotId, ignoreMeetingId).length) return fail('NO_TABLE_LEFT');
  const pending = snap.meetings.filter((meeting) => isActive(meeting, 'pending') && meeting.requesterId === requesterId && meeting.id !== ignoreMeetingId);
  if (pending.length >= MAX_PENDING) return fail('TOO_MANY_PENDING');
  return { ok: true, mode: target.kind === 'x' ? 'stand' : 'request' };
}

/** Is the viewer the target of a meeting: the targeted person, or an active representative of the targeted exhibitor (R-14)? */
function isTargetSide(snap, meeting, viewerId) {
  if (meeting.targetAttendeeId) return meeting.targetAttendeeId === viewerId;
  return Boolean(snap.exhibitors.get(meeting.targetExhibitorId)?.activeRepIds.includes(viewerId));
}

/**
 * Acceptance (R-13, R-14): FORBIDDEN unless the viewer is the target or an active representative of the target exhibitor,
 * then INVALID_TRANSITION, WINDOW_CLOSED, SLOT_PAST, SLOT_TAKEN, TARGET_BUSY, NO_TABLE_LEFT. The table is the smallest free one of the common pool.
 * -> { ok: true, location, tableNumber } | { ok: false, code }
 */
function checkAccept(snap, meetingId, viewerId) {
  const fail = (code) => ({ ok: false, code });
  const meeting = snap.meetings.find(({ id }) => id === meetingId);
  if (!meeting) return fail('MEETING_NOT_FOUND');
  if (!isTargetSide(snap, meeting, viewerId)) return fail('FORBIDDEN');
  if (meeting.status !== 'pending') return fail('INVALID_TRANSITION');
  if (snap.window.state !== 'open') return fail('WINDOW_CLOSED');
  const slot = snap.slots.get(meeting.slotId);
  if (!slot || hasStarted(snap, slot)) return fail('SLOT_PAST');
  if (requesterBusy(snap, meeting.requesterId, meeting.slotId, meeting.id)) return fail('SLOT_TAKEN');

  const target = meeting.targetExhibitorId ? { kind: 'x', id: meeting.targetExhibitorId } : { kind: 'p', id: meeting.targetAttendeeId };
  if (targetBusy(snap, target, meeting.slotId, meeting.id)) return fail('TARGET_BUSY');

  if (target.kind === 'x') {
    const { standNumber } = snap.exhibitors.get(target.id);
    return { ok: true, location: standNumber ? `Stand ${standNumber}` : 'Stand', tableNumber: null };
  }
  const tableNumber = snap.hosted.get(target.id) ?? freeTables(snap, meeting.slotId, meeting.id)[0];
  return tableNumber === undefined ? fail('NO_TABLE_LEFT') : { ok: true, location: `Table ${tableNumber}`, tableNumber };
}

/**
 * A-30: the pending requests of the slot closed by the acceptance of `meeting` (an object with the fields of a snapshot meeting,
 * accepted or about to be). A request that involves one of its two persons, or its exhibitor once full, is closed: `cancel` when
 * its requester is one of the two persons (no e-mail), `decline` otherwise (its requester is told).
 * -> { cancel: [meetingId], decline: [meetingId] }
 */
function closeOnAccept(snap, meeting) {
  const persons = new Set([meeting.requesterId, meeting.targetAttendeeId].filter(Boolean));
  let exhibitorFull = false;
  if (meeting.targetExhibitorId) {
    const exhibitor = snap.exhibitors.get(meeting.targetExhibitorId);
    const others = acceptedAt(snap, meeting.slotId, meeting.id).filter((other) => other.targetExhibitorId === meeting.targetExhibitorId);
    exhibitorFull = others.length + 1 >= (exhibitor?.activeRepIds.length ?? 0);
  }

  const closed = { cancel: [], decline: [] };
  for (const other of snap.meetings) {
    if (other.id === meeting.id || other.slotId !== meeting.slotId || !isActive(other, 'pending')) continue;
    const touchesPerson = [other.requesterId, other.targetAttendeeId].some((id) => id && persons.has(id));
    const touchesExhibitor = exhibitorFull && other.targetExhibitorId === meeting.targetExhibitorId;
    if (touchesPerson || touchesExhibitor) closed[persons.has(other.requesterId) ? 'cancel' : 'decline'].push(other.id);
  }
  return closed;
}

/**
 * States of the slots for the viewer of a profile (R-12, F-50): slots already started are absent. `confirmed` and `requested`
 * (the viewer's own request) come first ; `unavailable` when R-11.2, .5, .6 or .8 fails ; otherwise `available`. Never says with whom the target meets.
 * -> Map(slotId -> 'available' | 'unavailable' | 'requested' | 'confirmed'), in time order
 */
function slotStates(snap, { viewerId, target }) {
  const states = new Map();
  const slots = [...snap.slots.values()].filter((slot) => !hasStarted(snap, slot)).sort((a, b) => time(a.startsAt) - time(b.startsAt));
  const between = (meeting) =>
    target.kind === 'x' ? meeting.requesterId === viewerId && meeting.targetExhibitorId === target.id : involves(meeting, viewerId) && involves(meeting, target.id);

  for (const { id } of slots) {
    const together = snap.meetings.find((meeting) => meeting.slotId === id && between(meeting) && (isActive(meeting, 'accepted') || (isActive(meeting, 'pending') && meeting.requesterId === viewerId)));
    if (together) states.set(id, isActive(together, 'accepted') ? 'confirmed' : 'requested');
    else if (requesterBusy(snap, viewerId, id) || targetBusy(snap, target, id) || (target.kind === 'p' && !snap.hosted.has(target.id) && !freeTables(snap, id).length)) states.set(id, 'unavailable');
    else states.set(id, 'available');
  }
  return states;
}

/**
 * What the viewer can do with a meeting (R-10, R-16), calculated here and never by the front.
 * Accepting and proposing another slot need an open window and a slot not started ; no counter-proposal toward an exhibitor nor a dedicated table (A-31) ;
 * cancelling: the requester of a pending request, a party of an accepted meeting, until the slot starts.
 * -> { direction: 'sent' | 'received', canAccept, canDecline, canCounter, canCancel }
 */
function meetingActions(snap, meeting, viewerId) {
  const isRequester = meeting.requesterId === viewerId;
  const isTarget = isTargetSide(snap, meeting, viewerId);
  const slot = snap.slots.get(meeting.slotId);
  const upcoming = Boolean(slot) && !hasStarted(snap, slot);
  const pending = isActive(meeting, 'pending');

  const canAccept = pending && isTarget && upcoming && snap.window.state === 'open';
  return {
    direction: isRequester ? 'sent' : 'received',
    canAccept,
    canDecline: pending && isTarget,
    canCounter: canAccept && !meeting.targetExhibitorId && !snap.hosted.has(meeting.targetAttendeeId),
    canCancel: upcoming && ((pending && isRequester) || (isActive(meeting, 'accepted') && (isRequester || isTarget))),
  };
}

// R-10: the only transitions, by action.
const TRANSITIONS = {
  accept: { from: ['pending'], to: 'accepted' },
  decline: { from: ['pending'], to: 'declined' },
  cancel: { from: ['pending', 'accepted'], to: 'cancelled' },
  expire: { from: ['pending'], to: 'expired' },
};

/** R-10: the status the action leads to, or 409 INVALID_TRANSITION. */
function assertTransition(status, action) {
  const transition = TRANSITIONS[action];
  if (!transition?.from.includes(status)) throw meetingError('INVALID_TRANSITION');
  return transition.to;
}

module.exports = {
  parseTarget,
  requestWindow,
  hostedTables,
  buildSnapshot,
  snapshotMeeting,
  meetingError,
  isOwnProfile,
  requestBlock,
  freeTables,
  checkRequest,
  checkAccept,
  closeOnAccept,
  slotStates,
  meetingActions,
  assertTransition,
  isTargetSide,
  MAX_PENDING,
};
