'use strict';

const { EspaceError } = require('../lib/errors');
const { computeSlots, planSlots } = require('../lib/slots');

const SLOT = 'api::espace.slot';

module.exports = ({ strapi }) => ({
  /**
   * Regenerates the slots of a published edition from its b2b_break sequences (R-01), under a lock (A-16).
   * Idempotent (R-02): a slot that still has pending or accepted meetings is never removed, it is reported in `orphans`.
   * -> { created, kept, removed, orphans: [{ id, label, activeMeetings }], warnings }
   */
  regenerate: (editionDocumentId) =>
    strapi.service('api::espace.locks').withLock(`slots:${editionDocumentId}`, async () => {
      const edition = await strapi.documents('api::edition.edition').findOne({ documentId: editionDocumentId, status: 'published' });
      if (!edition?.date) throw new EspaceError(409, 'EDITION_DATE_MISSING', 'L’édition publiée n’a pas de date.');

      const filters = { edition: { documentId: editionDocumentId } };
      const sessions = await strapi.documents('api::sequence.sequence').findMany({
        filters: { ...filters, kind: 'b2b_break' },
        status: 'published',
        limit: 1000,
      });
      const slots = await strapi.documents(SLOT).findMany({ filters, populate: { session: { fields: ['documentId'] } }, limit: 1000 });
      const meetings = await strapi.documents('api::espace.meeting').findMany({
        filters: { ...filters, status: { $in: ['pending', 'accepted'] } },
        populate: { slot: { fields: ['documentId'] } },
        limit: 10000,
      });

      const activeMeetings = {};
      for (const { slot } of meetings) activeMeetings[slot?.documentId] = (activeMeetings[slot?.documentId] ?? 0) + 1;

      const { slots: wanted, warnings } = computeSlots({ date: edition.date, durationMinutes: edition.slotDurationMinutes ?? 15, sessions });
      const plan = planSlots({
        wanted,
        existing: slots.map((slot) => ({
          documentId: slot.documentId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          label: slot.label,
          sessionDocumentId: slot.session?.documentId,
          activeMeetings: activeMeetings[slot.documentId] ?? 0,
        })),
      });

      for (const { documentId } of plan.remove) await strapi.documents(SLOT).delete({ documentId });
      for (const { sessionDocumentId, startsAt, endsAt, label } of plan.create) {
        await strapi.documents(SLOT).create({
          data: { startsAt, endsAt, label, edition: { documentId: editionDocumentId }, session: { documentId: sessionDocumentId } },
        });
      }

      return {
        created: plan.create.length,
        kept: plan.keep.length,
        removed: plan.remove.length,
        orphans: plan.orphans.map(({ documentId, label, activeMeetings }) => ({ id: documentId, label, activeMeetings })),
        warnings,
      };
    }),
});
