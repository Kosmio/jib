'use strict';

/**
 * Mapping and planning of the HelloAsso import (I-11, I-12, I-14, Q-03, Q-15, R-18, R-31, NF-11, A-22, A-23). Pure functions:
 * no Strapi, no network. Only the fields of the Attendee leave this module: no phone number, postal code or payment.
 * `normalizeEmail` is the only rule of e-mail address of the participant space (A-23). A cancelled Attendee who buys a new
 * ticket with the same address takes it over and is reactivated, profile and consents kept (A-22).
 */

const EMAIL_PATTERN = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const ACTIVE_STATES = ['Processed', 'Registered'];
const CANCELLED_STATES = ['Canceled', 'Refused', 'Deleted', 'Abandoned'];
// Imported fields that a synchronization may refresh, unless the participant edited them (R-31).
const REFRESHED_FIELDS = ['firstName', 'lastName', 'jobTitle', 'company'];

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
    proposedRole: /exposant/i.test(tariff) ? 'exhibitor_rep' : /intervenant/i.test(tariff) ? 'speaker' : null,
    ...decide(item),
  };
}

/**
 * What a synchronization must do, from the tickets and the Attendees already stored (keys: documentId, helloassoItemId, email,
 * firstName, lastName, jobTitle, company, status, editedFields).
 *   create: mapItem results to create ; update: [{ documentId, changes }] ; cancel: [documentId]
 *   errors: [{ itemId, code, email? }] with the codes DUPLICATE_EMAIL (I-14), INVALID_EMAIL, WAITING, UNKNOWN
 * Tickets are handled by ascending id, so the first ticket of an e-mail address wins. Role, links and consents are never touched.
 * A-22: an active unknown ticket whose address is that of an Attendee already `cancelled` when the synchronization starts is
 * attached to this Attendee (ticket ids, status `active`, imported fields not edited). An Attendee is attached once per run:
 * a second active ticket at the same address stays in DUPLICATE_EMAIL.
 */
function planSync({ items, attendees, fieldMap }) {
  const known = new Map(attendees.filter((attendee) => attendee.helloassoItemId != null).map((attendee) => [String(attendee.helloassoItemId), attendee]));
  const taken = new Set(attendees.map((attendee) => normalizeEmail(attendee.email)));
  const returning = new Map(attendees.filter(({ status }) => status === 'cancelled').map((attendee) => [normalizeEmail(attendee.email), attendee]));
  const plan = { create: [], update: [], cancel: [], errors: [] };

  /** Imported fields that changed and that the participant did not edit (R-31) ; a blank value never empties a field. */
  const refreshed = (attendee, mapped) => {
    const edited = attendee.editedFields ?? [];
    const fields = REFRESHED_FIELDS.filter((field) => !edited.includes(field) && mapped[field] && mapped[field] !== attendee[field]);
    return Object.fromEntries(fields.map((field) => [field, mapped[field]]));
  };

  for (const item of [...items].sort((a, b) => Number(a.id) - Number(b.id))) {
    const mapped = mapItem(item, fieldMap);
    const attendee = known.get(mapped.helloassoItemId);
    const fail = (code, extra) => plan.errors.push({ itemId: mapped.helloassoItemId, code, ...extra });

    if (mapped.decision === 'ignored') fail(mapped.reason);
    else if (mapped.decision === 'cancelled') {
      if (attendee && attendee.status !== 'cancelled') plan.cancel.push(attendee.documentId);
    } else if (attendee) {
      const changes = refreshed(attendee, mapped);
      if (attendee.status === 'cancelled') {
        changes.status = 'active';
        returning.delete(normalizeEmail(attendee.email));
      }
      if (Object.keys(changes).length) plan.update.push({ documentId: attendee.documentId, changes });
    } else if (!mapped.email) fail('INVALID_EMAIL');
    else if (returning.has(mapped.email)) {
      const buyer = returning.get(mapped.email);
      returning.delete(mapped.email);
      known.delete(String(buyer.helloassoItemId));
      const { helloassoItemId, helloassoOrderId } = mapped;
      plan.update.push({ documentId: buyer.documentId, changes: { helloassoItemId, helloassoOrderId, status: 'active', ...refreshed(buyer, mapped) } });
    } else if (taken.has(mapped.email)) fail('DUPLICATE_EMAIL', { email: mapped.email });
    else {
      taken.add(mapped.email);
      plan.create.push(mapped);
    }
  }
  return plan;
}

module.exports = { normalizeEmail, mapItem, planSync };
