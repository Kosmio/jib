'use strict';

/**
 * Erasure, individual export and retention of the participant space (F-33, R-44, NF-12, NF-13). Pure functions: no Strapi, no network.
 * Erasure keeps the row of the Attendee (messages and meetings still point at it) but removes everything that identifies the person.
 */

const { createHash, createHmac } = require('node:crypto');
const { normalizeEmail } = require('./import');

// RFC 2606: a name under `.invalid` never resolves, so no e-mail can reach the address.
const TECHNICAL_DOMAIN = 'erased.invalid';
const ERASED_FIRST_NAME = 'Participant';
const ERASED_LAST_NAME = 'supprimé';
const RETENTION_MONTHS = 12;

/** Salt of the e-mail fingerprints, derived from a server secret (the first of APP_KEYS): never stored, never sent. */
const saltOf = (secret) => createHmac('sha256', String(secret)).update('jib-espace-erased-email').digest('hex');

/**
 * R-44: SHA-256 (hexadecimal) of the lower case address, salted by a key derived from `secret`. Null when `email` is not a valid
 * address. The same address gives the same fingerprint in every edition: the type stores it with its edition.
 */
function emailHash(email, secret) {
  const normalized = normalizeEmail(email);
  return normalized ? createHash('sha256').update(`${saltOf(secret)}:${normalized}`).digest('hex') : null;
}

/** Address that replaces the e-mail of an erased Attendee: unique (documentId) and not routable. */
const technicalEmail = (documentId) => `erased-${String(documentId).toLowerCase()}@${TECHNICAL_DOMAIN}`;

/** True for the address of an erased Attendee. */
const isErasedEmail = (email) => typeof email === 'string' && email.toLowerCase().endsWith(`@${TECHNICAL_DOMAIN}`);

/**
 * F-33, R-44: the scalar changes of an erasure. `attendee.documentId` builds the technical address. The status is locked
 * (`statusLockedAt`, R-89) so that no synchronization reactivates the row, and the ticket ids are dropped.
 * Relations (photo, topics, speaker, exhibitor) are listed in `ERASED_RELATIONS`.
 */
function erasedFields({ documentId }, now = new Date()) {
  return {
    firstName: ERASED_FIRST_NAME,
    lastName: ERASED_LAST_NAME,
    email: technicalEmail(documentId),
    jobTitle: null,
    company: null,
    bio: null,
    linkedinUrl: null,
    hostedTableNumber: null,
    directoryOptIn: false,
    meetingsOptIn: false,
    newsOptIn: false,
    consentAt: null,
    activatedAt: null,
    lastSeenAt: null,
    emailPrefs: { meetingRequests: false, messages: false, reminders: false },
    unavailableSessions: [],
    editedFields: [],
    status: 'cancelled',
    statusLockedAt: now,
    helloassoItemId: null,
    helloassoOrderId: null,
    cardTokenHash: null,
    cardTokenCreatedAt: null,
  };
}

/** Relations emptied by an erasure, written by the query engine (a relation set to null or to an empty list). */
const ERASED_RELATIONS = { photo: null, speaker: null, exhibitor: null, topics: [] };

/** Instant `months` calendar months before `now` (UTC). */
function monthsBefore(now, months) {
  const date = new Date(now.getTime());
  date.setUTCMonth(date.getUTCMonth() - months);
  return date;
}

/** NF-13: logs (EmailLog, SyncRun) older than this instant are deleted. */
const logCutoff = (now = new Date()) => monthsBefore(now, RETENTION_MONTHS);

/**
 * R-44: the space of an edition is purged once its date is past by more than 12 months. An edition without a valid date is never purged.
 * `edition.date` is a calendar day: it counts from its midnight, UTC.
 */
function isPurgeable(edition, now = new Date()) {
  if (!edition?.date) return false;
  const date = new Date(edition.date);
  if (Number.isNaN(date.getTime())) return false;
  date.setUTCMonth(date.getUTCMonth() + RETENTION_MONTHS);
  return date.getTime() < now.getTime();
}

const counterpartOf = (attendee) => (attendee ? { firstName: attendee.firstName, lastName: attendee.lastName, company: attendee.company ?? null } : null);

/**
 * NF-12: the JSON file of the individual export. Inputs:
 *   attendee (populated with photo and topics), edition ({ slug, title }),
 *   meetings (populated with slot, requester, targetAttendee, targetExhibitor.organisation),
 *   messages (sent by the person, populated with conversation.participants).
 * Of the other participants only first name, last name and company leave (acceptance criterion 4).
 */
function buildExport({ attendee, edition, meetings, messages, now = new Date() }) {
  const self = attendee.documentId;
  return {
    exportedAt: now.toISOString(),
    edition: { slug: edition.slug, title: edition.title },
    profile: {
      firstName: attendee.firstName,
      lastName: attendee.lastName,
      email: attendee.email,
      jobTitle: attendee.jobTitle ?? null,
      company: attendee.company ?? null,
      linkedinUrl: attendee.linkedinUrl ?? null,
      bio: attendee.bio ?? null,
      role: attendee.role,
      photoUrl: attendee.photo?.url ?? null,
      topics: (attendee.topics ?? []).map(({ name }) => name),
      unavailableSessions: attendee.unavailableSessions ?? [],
      importedAt: attendee.createdAt ?? null,
      activatedAt: attendee.activatedAt ?? null,
      lastSeenAt: attendee.lastSeenAt ?? null,
    },
    preferences: {
      directoryOptIn: Boolean(attendee.directoryOptIn),
      meetingsOptIn: Boolean(attendee.meetingsOptIn),
      newsOptIn: Boolean(attendee.newsOptIn),
      consentAt: attendee.consentAt ?? null,
      emailPrefs: {
        meetingRequests: attendee.emailPrefs?.meetingRequests !== false,
        messages: attendee.emailPrefs?.messages !== false,
        reminders: attendee.emailPrefs?.reminders !== false,
      },
    },
    meetings: meetings.map((meeting) => {
      const requested = meeting.requester?.documentId === self;
      return {
        id: meeting.documentId,
        status: meeting.status,
        direction: requested ? 'sent' : 'received',
        counterpart: requested
          ? meeting.targetAttendee
            ? counterpartOf(meeting.targetAttendee)
            : { exhibitor: meeting.targetExhibitor?.organisation?.name ?? null }
          : counterpartOf(meeting.requester),
        slot: meeting.slot ? { startsAt: meeting.slot.startsAt, endsAt: meeting.slot.endsAt, label: meeting.slot.label ?? null } : null,
        tableNumber: meeting.tableNumber ?? null,
        location: meeting.location ?? null,
        // The request message is the text of its requester: only given back to the requester.
        message: requested ? (meeting.message ?? null) : null,
        cancelledAt: meeting.cancelledAt ?? null,
      };
    }),
    messages: messages.map((message) => ({
      id: message.documentId,
      conversationId: message.conversation?.documentId ?? null,
      counterpart: counterpartOf((message.conversation?.participants ?? []).find(({ documentId }) => documentId !== self)),
      body: message.body,
      sentAt: message.createdAt,
    })),
  };
}

module.exports = {
  ERASED_RELATIONS,
  buildExport,
  emailHash,
  erasedFields,
  isErasedEmail,
  isPurgeable,
  logCutoff,
  technicalEmail,
};
