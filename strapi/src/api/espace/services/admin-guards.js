'use strict';

// @strapi/utils is not a direct dependency (pnpm): resolved from @strapi/strapi, the same copy Strapi's error handler checks against.
const { ApplicationError } = require(require.resolve('@strapi/utils', { paths: [require.resolve('@strapi/strapi')] })).errors;
const { ACTIVE_STATUSES, EDITION_GUARDED_FIELDS, REMOVALS, removalRefusal, editionRefusal } = require('../lib/admin-guards');

const MEETING = 'api::espace.meeting';
const ATTENDEE = 'api::espace.attendee';
const EDITION = 'api::edition.edition';
const SEQUENCE = 'api::sequence.sequence';

/** Guards of the admin (NF-63 to NF-65), called by the Document Service middleware of src/index.js. Throws an ApplicationError in French. */
module.exports = ({ strapi }) => {
  const active = { status: { $in: ACTIVE_STATUSES } };
  const countMeetings = (filters) => strapi.documents(MEETING).count({ filters: { ...active, ...filters } });
  const self = (documentId) => ({ documentId });

  /** What hangs on the document `documentId` of `uid` and forbids to remove it. */
  async function blockedBy(uid, documentId) {
    switch (uid) {
      case ATTENDEE:
        return countMeetings({ $or: [{ requester: self(documentId) }, { targetAttendee: self(documentId) }] });
      case 'api::espace.exhibitor':
        return countMeetings({ targetExhibitor: self(documentId) });
      case 'api::espace.slot':
        return countMeetings({ slot: self(documentId) });
      case SEQUENCE:
        return (await strapi.db.query(SEQUENCE).count({ where: { documentId, kind: 'b2b_break' } })) ? countMeetings({ slot: { session: self(documentId) } }) : 0;
      case EDITION:
        return strapi.documents(ATTENDEE).count({ filters: { edition: self(documentId) } });
      default:
        return 0;
    }
  }

  async function checkEdition({ documentId, data }, now) {
    if (!data || !EDITION_GUARDED_FIELDS.some((field) => data[field] !== undefined)) return;
    const edition = documentId ? { edition: self(documentId) } : null;
    const current = documentId ? await strapi.documents(EDITION).findOne({ documentId }) : null;
    const count = (filters) => (edition ? countMeetings({ ...edition, ...filters }) : 0);
    const [accepted] = edition ? await strapi.documents(MEETING).findMany({ filters: { ...edition, status: 'accepted', tableNumber: { $notNull: true } }, sort: ['tableNumber:desc'], limit: 1 }) : [];
    const message = editionRefusal({
      current,
      data,
      now,
      attendees: edition ? await strapi.documents(ATTENDEE).count({ filters: edition }) : 0,
      meetings: edition ? await strapi.documents(MEETING).count({ filters: edition }) : 0,
      pending: await count({ status: 'pending' }),
      maxTable: accepted?.tableNumber ?? 0,
    });
    if (message) throw new ApplicationError(message);
  }

  return {
    /** Throws when the Document Service call `{ uid, action, params }` is refused. */
    async check({ uid, action, params }, { now = new Date() } = {}) {
      if ((action === 'delete' || action === 'unpublish') && REMOVALS[uid] && params?.documentId) {
        const message = removalRefusal(uid, action, await blockedBy(uid, params.documentId));
        if (message) throw new ApplicationError(message);
      } else if (uid === EDITION && (action === 'update' || action === 'create')) {
        await checkEdition(params ?? {}, now);
      }
    },
  };
};
