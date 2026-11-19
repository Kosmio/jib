'use strict';

/** Pure decisions of the admin guards (NF-63 to NF-65): each returns the French message of the refusal, or null when the change is allowed. */

const ACTIVE_STATUSES = ['pending', 'accepted'];

/** Who is refused a removal: the subject of the message and the verb's pronoun (feminine or masculine). */
const REMOVALS = {
  'api::espace.attendee': { subject: 'Ce participant a des rendez-vous en attente ou acceptés', pronoun: 'le' },
  'api::espace.exhibitor': { subject: 'Cet exposant a des rendez-vous en attente ou acceptés', pronoun: 'le' },
  'api::espace.slot': { subject: 'Ce créneau porte des rendez-vous en attente ou acceptés', pronoun: 'le' },
  'api::sequence.sequence': { subject: 'Cette pause B2B a des créneaux qui portent des rendez-vous en attente ou acceptés', pronoun: 'la' },
  'api::edition.edition': { subject: 'Cette édition a des participants', pronoun: 'la' },
};

const EDITION_GUARDED_FIELDS = ['slug', 'slotDurationMinutes', 'tablesCount', 'meetingRequestsOpenAt', 'meetingRequestsCloseAt'];

const time = (value) => (value ? new Date(value).getTime() : null);

/**
 * Deleting or unpublishing a document. `blocked` = the number of active meetings that hang on it (for an edition: its attendees;
 * for a sequence: the active meetings of its slots, 0 when it is not a b2b_break). -> message or null.
 */
function removalRefusal(uid, action, blocked) {
  const rule = REMOVALS[uid];
  if (!rule || !blocked) return null;
  const verb = action === 'unpublish' ? 'dépublier' : 'supprimer';
  return `${rule.subject} : impossible de ${rule.pronoun} ${verb}. Annulez ou traitez d’abord ces éléments.`;
}

/**
 * Saving an edition (NF-64, NF-65). `current` = the stored draft (null on creation), `data` = what is written, `facts` = { now, attendees,
 * meetings, pending, maxTable }. Only a field of `data` is judged; the slug and the duration only when they change. -> message or null.
 */
function editionRefusal({ current, data, now, attendees = 0, meetings = 0, pending = 0, maxTable = 0 }) {
  if (data.slug !== undefined && current && data.slug !== current.slug && attendees > 0) {
    return 'L’identifiant URL ne peut plus changer : cette édition a des participants.';
  }
  const open = time(data.meetingRequestsOpenAt !== undefined ? data.meetingRequestsOpenAt : current?.meetingRequestsOpenAt);
  const close = time(data.meetingRequestsCloseAt !== undefined ? data.meetingRequestsCloseAt : current?.meetingRequestsCloseAt);
  if ((data.meetingRequestsOpenAt !== undefined || data.meetingRequestsCloseAt !== undefined) && open !== null && close !== null && open >= close) {
    return 'L’ouverture des demandes de rendez-vous doit précéder leur fermeture.';
  }
  if (time(data.meetingRequestsCloseAt) !== null && time(data.meetingRequestsCloseAt) <= now.getTime() && pending > 0) {
    return 'La date de fermeture des demandes est passée alors que des demandes de rendez-vous sont en attente. Traitez-les avant de fermer.';
  }
  if (Number.isInteger(data.tablesCount) && data.tablesCount < maxTable) {
    return `Des rendez-vous occupent déjà la table ${maxTable} : le nombre de tables ne peut pas descendre sous ${maxTable}.`;
  }
  if (data.slotDurationMinutes !== undefined && current && data.slotDurationMinutes !== current.slotDurationMinutes && meetings > 0) {
    return 'La durée des créneaux ne peut plus changer : des rendez-vous existent.';
  }
  return null;
}

module.exports = { ACTIVE_STATUSES, EDITION_GUARDED_FIELDS, REMOVALS, removalRefusal, editionRefusal };
