'use strict';

/**
 * Mapping and planning of the HelloAsso import (I-11, I-12, I-14, Q-03, Q-15, R-18, R-31, NF-11, A-22, A-23). Pure functions:
 * no Strapi, no network. Only the fields of the Attendee leave this module: no phone number, postal code or payment.
 * `normalizeEmail` is the only rule of e-mail address of the participant space (A-23). A cancelled Attendee who buys a new
 * ticket with the same address takes it over and is reactivated, profile and consents kept (A-22).
 */

const { normalizeLinkedin } = require('./profile');

const EMAIL_PATTERN = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const ACTIVE_STATES = ['Processed', 'Registered'];
const CANCELLED_STATES = ['Canceled', 'Refused', 'Deleted', 'Abandoned'];
// Imported fields that a synchronization may refresh, unless the participant edited them (R-31).
const REFRESHED_FIELDS = ['firstName', 'lastName', 'jobTitle', 'company', 'linkedinUrl'];

/** Lower case address without surrounding spaces, or null when it is not a single valid address of 254 characters at most. */
function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

const clean = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** Q-15: a refunded payment cancels ; Processed and Registered are active ; Waiting and Unknown wait, signalled. */
function decide({ state, payments }) {
  if ((payments ?? []).some((payment) => payment.state === 'Refunded') || CANCELLED_STATES.includes(state)) return { decision: 'cancelled' };
  if (ACTIVE_STATES.includes(state)) return { decision: 'active' };
  return { decision: 'ignored', reason: state === 'Waiting' ? 'WAITING' : 'UNKNOWN' };
}

/**
 * A HelloAsso ticket (item) -> the fields of an Attendee, plus the decision of Q-15 (`active`, `cancelled`, `ignored`) and the
 * role proposed by the tariff name (Q-03). `fieldMap` names the custom fields (Edition.helloassoFieldMap), never hard-coded.
 * Name from `user` (the beneficiary), never the payer ; e-mail from the custom field if valid, else from the payer.
 */
function mapItem(item, fieldMap) {
  const answer = (key) => clean(item.customFields?.find((field) => field.name === fieldMap?.[key])?.answer);
  const tariff = item.name ?? '';
  return {
    helloassoItemId: String(item.id),
    helloassoOrderId: item.order?.id == null ? null : String(item.order.id),
    firstName: clean(item.user?.firstName),
    lastName: clean(item.user?.lastName),
    email: normalizeEmail(answer('email')) ?? normalizeEmail(item.payer?.email),
    jobTitle: answer('jobTitle'),
    company: answer('company'),
    // D-09: kept only when the answer is a page of linkedin.com.
    linkedinUrl: normalizeLinkedin(answer('linkedin')) || null,
    proposedRole: /exposant/i.test(tariff) ? 'exhibitor_rep' : /intervenant/i.test(tariff) ? 'speaker' : null,
    ...decide(item),
  };
}

/**
 * What a synchronization must do, from the tickets and the Attendees already stored (keys: documentId, helloassoItemId, email,
 * firstName, lastName, jobTitle, company, status, statusLockedAt, editedFields).
 *   create: mapItem results to create ; update: [{ documentId, changes }] ; cancel: [documentId]
 *   errors: [{ itemId, code, email? }] with the codes DUPLICATE_EMAIL (I-14), INVALID_EMAIL, ERASED (R-44), WAITING, UNKNOWN
 * Tickets are handled by ascending id, so the first ticket of an e-mail address wins. Role, links and consents are never touched.
 * Tickets of one order for one beneficiary (day and cocktail) are one person: only the main ticket counts (groupTickets), the others
 * are neither imported nor reported.
 * A-22: an active unknown ticket whose address is that of an Attendee already `cancelled` when the synchronization starts is
 * attached to this Attendee (ticket ids, status `active`, imported fields not edited). An Attendee is attached once per run:
 * a second active ticket at the same address stays in DUPLICATE_EMAIL.
 * R-44: `isErased(email)` is true for the address of a person who asked for the erasure of their data: an unknown active ticket at
 * this address is ignored (code ERASED, an information, not a failure) and never creates nor reactivates an Attendee.
 * R-89: an Attendee whose status the organizer decided (`statusLockedAt`) is never cancelled, reactivated or taken over by a ticket:
 * a new ticket at its address stays in DUPLICATE_EMAIL. Attendees created by hand carry no ticket id and are never planned for removal,
 * until a ticket of their address arrives: it then joins them (R-96).
 */
const fold = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase();

/**
 * Tickets of one order bought for one beneficiary (the day and the lunch cocktail, 18/11/2026) are one person. The main ticket is
 * an active one first, then the one with the most custom field answers (the cocktail tariff asks none), then the oldest. -> [{ main,
 * companions }] ; a ticket without order is alone.
 */
function groupTickets(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.order?.id == null ? `item:${item.id}` : `${item.order.id}|${fold(item.user?.firstName)}|${fold(item.user?.lastName)}`;
    if (groups.has(key)) groups.get(key).push(item);
    else groups.set(key, [item]);
  }
  const answers = (item) => (item.customFields ?? []).filter((field) => clean(field.answer)).length;
  const active = (item) => (decide(item).decision === 'active' ? 1 : 0);
  return [...groups.values()].map((group) => {
    const [main, ...companions] = [...group].sort((a, b) => active(b) - active(a) || answers(b) - answers(a) || Number(a.id) - Number(b.id));
    return { main, companions };
  });
}

function planSync({ items, attendees, fieldMap, isErased = () => false }) {
  const known = new Map(attendees.filter((attendee) => attendee.helloassoItemId != null).map((attendee) => [String(attendee.helloassoItemId), attendee]));
  const taken = new Set(attendees.map((attendee) => normalizeEmail(attendee.email)));
  const returning = new Map(attendees.filter(({ status, statusLockedAt }) => status === 'cancelled' && !statusLockedAt).map((attendee) => [normalizeEmail(attendee.email), attendee]));
  // R-96: a person created by hand (no ticket yet, status not locked) is the same person as a ticket of the same address.
  const manual = new Map(attendees.filter(({ helloassoItemId, status, statusLockedAt }) => helloassoItemId == null && status === 'active' && !statusLockedAt).map((attendee) => [normalizeEmail(attendee.email), attendee]));
  const plan = { create: [], update: [], cancel: [], errors: [] };

  /** Imported fields that changed and that the participant did not edit (R-31) ; a blank value never empties a field. */
  const refreshed = (attendee, mapped) => {
    const edited = attendee.editedFields ?? [];
    const fields = REFRESHED_FIELDS.filter((field) => !edited.includes(field) && mapped[field] && mapped[field] !== attendee[field]);
    return Object.fromEntries(fields.map((field) => [field, mapped[field]]));
  };

  for (const { main: item, companions } of groupTickets(items).sort((a, b) => Number(a.main.id) - Number(b.main.id))) {
    const mapped = mapItem(item, fieldMap);
    // An Attendee created earlier from a companion ticket (the cocktail one) is the same person: it moves to the main ticket.
    const viaCompanion = known.has(mapped.helloassoItemId) ? null : companions.map((companion) => known.get(String(companion.id))).find(Boolean);
    const attendee = known.get(mapped.helloassoItemId) ?? viaCompanion;
    const fail = (code, extra) => plan.errors.push({ itemId: mapped.helloassoItemId, code, ...extra });

    if (viaCompanion && mapped.decision === 'active') {
      const changes = { helloassoItemId: mapped.helloassoItemId, helloassoOrderId: mapped.helloassoOrderId, ...refreshed(viaCompanion, mapped) };
      if (viaCompanion.status === 'cancelled' && !viaCompanion.statusLockedAt) changes.status = 'active';
      plan.update.push({ documentId: viaCompanion.documentId, changes });
    } else if (mapped.decision === 'ignored') fail(mapped.reason);
    else if (mapped.decision === 'cancelled') {
      if (attendee && attendee.status !== 'cancelled' && !attendee.statusLockedAt) plan.cancel.push(attendee.documentId);
    } else if (attendee) {
      const changes = refreshed(attendee, mapped);
      if (attendee.status === 'cancelled' && !attendee.statusLockedAt) {
        changes.status = 'active';
        returning.delete(normalizeEmail(attendee.email));
      }
      if (Object.keys(changes).length) plan.update.push({ documentId: attendee.documentId, changes });
    } else if (!mapped.email) fail('INVALID_EMAIL');
    else if (isErased(mapped.email)) fail('ERASED');
    else if (returning.has(mapped.email)) {
      const buyer = returning.get(mapped.email);
      returning.delete(mapped.email);
      known.delete(String(buyer.helloassoItemId));
      const { helloassoItemId, helloassoOrderId } = mapped;
      plan.update.push({ documentId: buyer.documentId, changes: { helloassoItemId, helloassoOrderId, status: 'active', ...refreshed(buyer, mapped) } });
    } else if (manual.has(mapped.email)) {
      // R-96: the ticket joins the existing account ; its roles and its fields stay as the organizer set them.
      const person = manual.get(mapped.email);
      manual.delete(mapped.email);
      plan.update.push({ documentId: person.documentId, changes: { helloassoItemId: mapped.helloassoItemId, helloassoOrderId: mapped.helloassoOrderId } });
    } else if (taken.has(mapped.email)) fail('DUPLICATE_EMAIL', { email: mapped.email });
    else {
      taken.add(mapped.email);
      plan.create.push(mapped);
    }
  }
  return plan;
}

module.exports = { normalizeEmail, mapItem, planSync, groupTickets };
