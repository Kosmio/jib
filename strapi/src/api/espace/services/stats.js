'use strict';

const { hostedTables } = require('../lib/meetings');
const { profileCompletion } = require('../lib/profile');

const ATTENDEE = 'api::espace.attendee';
const MEETING = 'api::espace.meeting';
const MESSAGE = 'api::espace.message';
const SLOT = 'api::espace.slot';
const EDITION = 'api::edition.edition';
const EXHIBITOR = 'api::espace.exhibitor';
const SYNC_RUN = 'api::espace.sync-run';
const LIMIT = 10000;
// What the counts, the profile completion, the dedicated tables (A-29) and the holders of an address (F-121) read of an attendee.
const ATTENDEE_FIELDS = ['role', 'status', 'firstName', 'lastName', 'email', 'company', 'jobTitle', 'bio', 'hostedTableNumber', 'activatedAt', 'consentAt', 'directoryOptIn'];
const DEFAULT_TABLES = 20;
const TOP_EXHIBITORS = 5;
// R-70 a: below 70 % a profile gets a reminder, from 70 % it counts as complete.
const COMPLETE_FROM = 70;
const NBSP = '\u00a0';

const STATUSES = ['pending', 'accepted', 'declined', 'cancelled', 'expired'];
const ROLES = ['participant', 'speaker', 'exhibitor_rep'];

const fullName = ({ firstName, lastName }) => [firstName, lastName].filter(Boolean).join(' ');
const byName = (a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' });

/**
 * A-29: the dedicated tables that the meetings ignore (`hostedTables` of lib/meetings.js), told to the organizer who fixes them in Strapi.
 *  - HOSTED_TABLE_INVALID: an active attendee carries a number that cannot be used (not a speaker, or outside 1 to `tablesCount`) ;
 *  - HOSTED_TABLE_CONFLICT: two active speakers carry the same number, the one with the smallest id keeps it.
 */
function hostedTableWarnings(attendees, tablesCount) {
  const { hosted, warnings } = hostedTables(attendees, tablesCount);
  const byDocumentId = new Map(attendees.map((attendee) => [attendee.documentId, attendee]));
  const keeperOf = (number) => byDocumentId.get([...hosted].find(([, held]) => held === number)?.[0]);

  return warnings.map(({ code, attendeeId, hostedTableNumber }) => {
    const reason =
      code === 'HOSTED_TABLE_CONFLICT'
        ? `${fullName(keeperOf(hostedTableNumber) ?? {})} la tient déjà.`
        : `elle doit être réservée à un intervenant et comprise entre 1 et ${tablesCount}.`;
    return {
      code,
      attendeeId,
      tableNumber: hostedTableNumber,
      message: `La table ${hostedTableNumber} de ${fullName(byDocumentId.get(attendeeId) ?? {})} est ignorée${NBSP}: ${reason}`,
    };
  });
}

/** F-121: the errors that hold an address say who already uses it (`holderName`), as `GET /sync-runs` does. */
function withHolders(errors, attendees) {
  const byEmail = new Map(attendees.map((attendee) => [String(attendee.email).toLowerCase(), attendee]));
  const byId = new Map(attendees.map((attendee) => [attendee.documentId, attendee]));
  return errors.map((error) => {
    const holder = byId.get(error.attendeeDocumentId) ?? byEmail.get(String(error.email ?? '').toLowerCase());
    const holderName = fullName(holder ?? {});
    return holderName ? { ...error, holderName } : error;
  });
}

module.exports = ({ strapi }) => {
  const documents = (uid) => strapi.documents(uid);

  /** Table and join columns of a relation, as Strapi 5 names them (`espace_meetings_slot_lnk`, ...): read from its metadata. */
  const tableOf = (uid) => strapi.db.metadata.get(uid).tableName;
  const joinOf = (uid, attribute) => {
    const { name, joinColumn, inverseJoinColumn } = strapi.db.metadata.get(uid).attributes[attribute].joinTable;
    return { table: name, owner: joinColumn.name, target: inverseJoinColumn.name };
  };

  /**
   * F-125, T-40: the meetings booked on a slot, counted by the database (two grouped queries instead of a read of every meeting).
   * -> { byStatus: { status: n }, fill: Map(slot id -> { accepted, pending }), requests: Map(exhibitor id -> n) } ; the keys are row ids.
   */
  async function countMeetings(edition) {
    const knex = strapi.db.connection;
    const editionLink = joinOf(MEETING, 'edition');
    const slotLink = joinOf(MEETING, 'slot');
    const exhibitorLink = joinOf(MEETING, 'targetExhibitor');
    const booked = () =>
      knex(`${tableOf(MEETING)} as m`)
        .join(`${editionLink.table} as le`, 'le.' + editionLink.owner, 'm.id')
        .join(`${tableOf(EDITION)} as e`, 'e.id', 'le.' + editionLink.target)
        .join(`${slotLink.table} as ls`, 'ls.' + slotLink.owner, 'm.id')
        .where('e.document_id', edition.documentId);

    const bySlot = await booked().select('ls.' + slotLink.target + ' as slot', 'm.status').countDistinct('m.id as n').groupBy('ls.' + slotLink.target, 'm.status');
    const byExhibitor = await booked()
      .join(`${exhibitorLink.table} as lx`, 'lx.' + exhibitorLink.owner, 'm.id')
      .select('lx.' + exhibitorLink.target + ' as exhibitor')
      .countDistinct('m.id as n')
      .groupBy('lx.' + exhibitorLink.target);

    const byStatus = Object.fromEntries(STATUSES.map((status) => [status, 0]));
    const fill = new Map();
    for (const { slot, status, n } of bySlot) {
      byStatus[status] += Number(n);
      if (!['accepted', 'pending'].includes(status)) continue;
      const counts = fill.get(slot) ?? { accepted: 0, pending: 0 };
      counts[status] += Number(n);
      fill.set(slot, counts);
    }
    return { byStatus, fill, requests: new Map(byExhibitor.map(({ exhibitor, n }) => [exhibitor, Number(n)])) };
  }

  return {
    /**
     * GET /admin/:edition/stats (F-90, A-29): the indicators of E9, computed on the fly. Counts only, never a text (R-63).
     * The organizers are not registrants: they are left out of every count. Each count is taken over the active registrants,
     * except `attendees.total` and `attendees.cancelled`, which also give the cancelled ones (`byRole` leaves them out, F-125). A meeting counts in the slot it is booked on, whoever its target.
     */
    async compute(edition) {
      const ofEdition = { edition: { documentId: edition.documentId } };
      const tablesCount = edition.tablesCount ?? DEFAULT_TABLES;

      const [everyone, { byStatus, fill, requests }, slots, messageCount, [lastRun]] = await Promise.all([
        documents(ATTENDEE).findMany({
          filters: ofEdition,
          fields: ATTENDEE_FIELDS,
          populate: { photo: { fields: ['documentId'] }, topics: { fields: ['documentId'] } },
          limit: LIMIT,
        }),
        countMeetings(edition),
        documents(SLOT).findMany({ filters: ofEdition, populate: { session: { fields: ['title'] } }, sort: 'startsAt:asc', limit: LIMIT }),
        documents(MESSAGE).count({ filters: { conversation: ofEdition } }),
        documents(SYNC_RUN).findMany({ filters: ofEdition, sort: 'startedAt:desc', limit: 1 }),
      ]);
      const exhibitors = requests.size
        ? await documents(EXHIBITOR).findMany({ filters: { ...ofEdition, id: { $in: [...requests.keys()] } }, populate: { organisation: { fields: ['name'] } }, limit: LIMIT })
        : [];

      const people = everyone.filter(({ role }) => role !== 'organizer');
      const active = people.filter(({ status }) => status === 'active');

      const byRole = Object.fromEntries(ROLES.map((role) => [role, 0]));
      for (const { role } of active) byRole[role] = (byRole[role] ?? 0) + 1;

      const topExhibitors = exhibitors
        .filter(({ id, organisation }) => organisation && requests.has(id))
        .map(({ id, documentId, organisation, standNumber }) => ({ id: documentId, name: organisation.name, requests: requests.get(id), standNumber: standNumber ?? null }))
        .sort((a, b) => b.requests - a.requests || byName(a.name, b.name))
        .slice(0, TOP_EXHIBITORS);

      return {
        attendees: { total: people.length, active: active.length, cancelled: people.length - active.length, byRole },
        activated: active.filter(({ activatedAt }) => activatedAt).length,
        consented: active.filter(({ consentAt }) => consentAt).length,
        directoryOptIn: active.filter(({ directoryOptIn }) => directoryOptIn).length,
        profilesComplete: active.filter((attendee) => profileCompletion(attendee) >= COMPLETE_FROM).length,
        meetings: byStatus,
        messages: messageCount,
        slots: slots.map((slot) => ({
          sessionTitle: slot.session?.title ?? '',
          label: slot.label,
          accepted: fill.get(slot.id)?.accepted ?? 0,
          pending: fill.get(slot.id)?.pending ?? 0,
          tables: tablesCount,
        })),
        topExhibitors,
        warnings: hostedTableWarnings(everyone, tablesCount),
        lastSync: lastRun
          ? {
              id: lastRun.documentId,
              startedAt: lastRun.startedAt,
              endedAt: lastRun.endedAt,
              created: lastRun.created,
              updated: lastRun.updated,
              cancelled: lastRun.cancelled,
              errors: withHolders(lastRun.errors ?? [], everyone),
            }
          : null,
      };
    },
  };
};
