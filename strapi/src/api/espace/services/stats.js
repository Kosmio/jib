'use strict';

const { hostedTables } = require('../lib/meetings');
const { profileCompletion } = require('../lib/profile');

const ATTENDEE = 'api::espace.attendee';
const MEETING = 'api::espace.meeting';
const MESSAGE = 'api::espace.message';
const SLOT = 'api::espace.slot';
const EXHIBITOR = 'api::espace.exhibitor';
const SYNC_RUN = 'api::espace.sync-run';
const LIMIT = 10000;
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

module.exports = ({ strapi }) => {
  const documents = (uid) => strapi.documents(uid);

  return {
    /**
     * GET /admin/:edition/stats (F-90, A-29): the indicators of E9, computed on the fly. Counts only, never a text (R-63).
     * The organizers are not registrants: they are left out of every count. Each count is taken over the active registrants,
     * except `attendees` which also gives the cancelled ones. A meeting counts in the slot it is booked on, whoever its target.
     */
    async compute(edition) {
      const ofEdition = { edition: { documentId: edition.documentId } };
      const tablesCount = edition.tablesCount ?? DEFAULT_TABLES;

      const [everyone, meetings, slots, exhibitors, messageCount, [lastRun]] = await Promise.all([
        documents(ATTENDEE).findMany({
          filters: ofEdition,
          populate: { photo: { fields: ['documentId'] }, topics: { fields: ['documentId'] } },
          limit: LIMIT,
        }),
        documents(MEETING).findMany({
          filters: ofEdition,
          fields: ['status'],
          populate: { slot: { fields: ['documentId'] }, targetExhibitor: { fields: ['documentId'] } },
          limit: LIMIT,
        }),
        documents(SLOT).findMany({ filters: ofEdition, populate: { session: { fields: ['title'] } }, sort: 'startsAt:asc', limit: LIMIT }),
        documents(EXHIBITOR).findMany({ filters: ofEdition, populate: { organisation: { fields: ['name'] } }, limit: LIMIT }),
        documents(MESSAGE).count({ filters: { conversation: ofEdition } }),
        documents(SYNC_RUN).findMany({ filters: ofEdition, sort: 'startedAt:desc', limit: 1 }),
      ]);

      const people = everyone.filter(({ role }) => role !== 'organizer');
      const active = people.filter(({ status }) => status === 'active');

      const byRole = Object.fromEntries(ROLES.map((role) => [role, 0]));
      for (const { role } of people) byRole[role] = (byRole[role] ?? 0) + 1;

      const byStatus = Object.fromEntries(STATUSES.map((status) => [status, 0]));
      for (const { status } of meetings) byStatus[status] += 1;

      const fill = new Map();
      for (const { slot, status } of meetings) {
        if (!slot || !['accepted', 'pending'].includes(status)) continue;
        const counts = fill.get(slot.documentId) ?? { accepted: 0, pending: 0 };
        counts[status] += 1;
        fill.set(slot.documentId, counts);
      }

      const requests = new Map();
      for (const { targetExhibitor } of meetings) if (targetExhibitor) requests.set(targetExhibitor.documentId, (requests.get(targetExhibitor.documentId) ?? 0) + 1);
      const topExhibitors = exhibitors
        .filter(({ documentId, organisation }) => requests.has(documentId) && organisation)
        .map(({ documentId, organisation, standNumber }) => ({ id: documentId, name: organisation.name, requests: requests.get(documentId), standNumber: standNumber ?? null }))
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
          accepted: fill.get(slot.documentId)?.accepted ?? 0,
          pending: fill.get(slot.documentId)?.pending ?? 0,
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
              errors: lastRun.errors ?? [],
            }
          : null,
      };
    },
  };
};
