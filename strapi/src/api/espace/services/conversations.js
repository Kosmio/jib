'use strict';

const { EspaceError } = require('../lib/errors');
const { ATTENDEE_CARD_POPULATE, attendeeCard } = require('../lib/cards');
const { profileVisibility } = require('../lib/directory');
const { hostedTables } = require('../lib/meetings');
const {
  MESSAGE_LIMIT,
  MESSAGE_WINDOW_MS,
  QUIET_DELAY_MS,
  canonicalPair,
  excerpt,
  notificationsDue,
  pairKey,
  validateBody,
} = require('../lib/messages');
const { formatTimeLabel } = require('../lib/time');
const { linkUrl } = require('../lib/tokens');

const ATTENDEE = 'api::espace.attendee';
const CONVERSATION = 'api::espace.conversation';
const MESSAGE = 'api::espace.message';
const MEETING = 'api::espace.meeting';
const EDITION = 'api::edition.edition';
const LIMIT = 5000;
const DEFAULT_TABLES = 20;
const ACTION_LINK_MINUTES = 72 * 60;
const LIST_EXCERPT_LENGTH = 140;
const TARGET_PATTERN = /^p:([A-Za-z0-9_-]{1,64})$/;
const dayFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' });

/** "jeudi 3 décembre à 10h45" */
const slotLabelOf = (startsAt) => `${dayFormat.format(new Date(startsAt))} à ${formatTimeLabel(new Date(startsAt))}`;

const link = ({ documentId }) => ({ documentId });
const conversationNotFound = () => new EspaceError(404, 'CONVERSATION_NOT_FOUND', 'Conversation introuvable.');
const targetNotFound = () => new EspaceError(404, 'TARGET_NOT_FOUND', 'Cette personne est introuvable.');

module.exports = ({ strapi }) => {
  const documents = (uid) => strapi.documents(uid);
  const organizerEmails = () => strapi.config.get('server.espace').organizerEmails.map((email) => email.trim().toLowerCase());
  const isOrganizer = (attendee) => attendee.role === 'organizer' || organizerEmails().includes(String(attendee.email).toLowerCase());

  /**
   * The people the viewer has a meeting (any status) or a conversation with, as a Set of documentIds (R-41, A-34) ;
   * the representatives of an exhibitor also know the people who asked for their stand.
   */
  async function relatedAttendeeIds(viewerId) {
    const viewer = await documents(ATTENDEE).findOne({ documentId: viewerId, populate: { exhibitor: { fields: ['documentId'] } } });
    const exhibitorId = viewer?.exhibitor?.documentId;
    const [meetings, conversations] = await Promise.all([
      documents(MEETING).findMany({
        filters: {
          $or: [{ requester: { documentId: viewerId } }, { targetAttendee: { documentId: viewerId } }, ...(exhibitorId ? [{ targetExhibitor: { documentId: exhibitorId } }] : [])],
        },
        populate: { requester: { fields: ['documentId'] }, targetAttendee: { fields: ['documentId'] }, answeredBy: { fields: ['documentId'] } },
        limit: LIMIT,
      }),
      documents(CONVERSATION).findMany({ filters: { participants: { documentId: viewerId } }, populate: { participants: { fields: ['documentId'] } }, limit: LIMIT }),
    ]);

    const related = new Set();
    for (const { requester, targetAttendee, answeredBy } of meetings) for (const person of [requester, targetAttendee, answeredBy]) if (person) related.add(person.documentId);
    for (const { participants } of conversations) for (const person of participants) related.add(person.documentId);
    related.delete(viewerId);
    return related;
  }

  /** A-29: Map(documentId -> table number) of the dedicated tables of an edition, as the meetings see them. */
  async function hostedOwners(edition) {
    const speakers = await documents(ATTENDEE).findMany({
      filters: { edition: { documentId: edition.documentId }, role: 'speaker', status: 'active', hostedTableNumber: { $notNull: true } },
      fields: ['role', 'status', 'hostedTableNumber'],
      limit: LIMIT,
    });
    return hostedTables(speakers, edition.tablesCount ?? DEFAULT_TABLES).hosted;
  }

  /** The conversation of the viewer, or 404 CONVERSATION_NOT_FOUND for a stranger, another edition or an unknown id (NF-01, R-63). */
  async function findConversation(session, id) {
    const me = session.attendee.documentId;
    const conversation = await documents(CONVERSATION).findOne({
      documentId: String(id),
      populate: { edition: { fields: ['documentId'] }, participants: { populate: ATTENDEE_CARD_POPULATE } },
    });
    if (!conversation || conversation.edition?.documentId !== session.edition.documentId) throw conversationNotFound();
    const other = conversation.participants.find(({ documentId }) => documentId !== me);
    if (!other || conversation.participants.length !== 2 || !conversation.participants.some(({ documentId }) => documentId === me)) throw conversationNotFound();
    return { conversation, other };
  }

  /** The conversation of a pair of attendees in an edition, or null. */
  const findPair = (edition, firstId, secondId) =>
    documents(CONVERSATION).findFirst({
      filters: { edition: { documentId: edition.documentId }, $and: [{ participants: { documentId: firstId } }, { participants: { documentId: secondId } }] },
    });

  /** Card of the counterpart: the full card, a conversation gives access to the profile (R-41), the dedicated table only when it counts (A-29). */
  async function counterpartCard(edition, other) {
    const hosted = await hostedOwners(edition);
    return attendeeCard({ ...other, hostedTableNumber: hosted.get(other.documentId) ?? null });
  }

  /**
   * Next accepted meeting of each pair with the viewer, calculated (A-37): Map(counterpart documentId -> { id, slotLabel, location }).
   * A meeting at an exhibitor's stand has no counterpart person. A past slot is no longer "next".
   */
  async function nextMeetings(viewerId, now) {
    const meetings = await documents(MEETING).findMany({
      filters: { status: 'accepted', $or: [{ requester: { documentId: viewerId } }, { targetAttendee: { documentId: viewerId } }] },
      populate: { slot: true, requester: { fields: ['documentId'] }, targetAttendee: { fields: ['documentId'] } },
      limit: LIMIT,
    });
    const next = new Map();
    for (const meeting of meetings) {
      const counterpart = meeting.requester?.documentId === viewerId ? meeting.targetAttendee : meeting.requester;
      if (!counterpart || !meeting.slot || new Date(meeting.slot.endsAt) <= now) continue;
      const known = next.get(counterpart.documentId);
      if (!known || new Date(meeting.slot.startsAt) < new Date(known.startsAt)) {
        next.set(counterpart.documentId, { startsAt: meeting.slot.startsAt, id: meeting.documentId, slotLabel: slotLabelOf(meeting.slot.startsAt), location: meeting.location ?? null });
      }
    }
    return new Map([...next].map(([id, { startsAt, ...meeting }]) => [id, meeting]));
  }

  /** R-62: the e-mails `new-message` due in an open edition. -> number sent */
  async function notifyEdition(edition, now) {
    const unread = await documents(MESSAGE).findMany({
      filters: {
        readAt: { $null: true },
        emailNotifiedAt: { $null: true },
        createdAt: { $lte: new Date(now.getTime() - 5 * 60 * 1000) },
        conversation: { edition: { documentId: edition.documentId } },
      },
      populate: { author: { fields: ['documentId'] }, conversation: { fields: ['documentId'], populate: { participants: true } } },
      sort: ['createdAt:asc', 'id:asc'],
      limit: LIMIT,
    });
    if (!unread.length) return 0;

    // The recipient is the participant who is not the author ; a cancelled attendee receives nothing.
    const messageById = new Map();
    const recipientById = new Map();
    const messages = [];
    for (const message of unread) {
      const recipient = message.conversation.participants.find(({ documentId }) => documentId !== message.author?.documentId);
      if (!recipient || recipient.status !== 'active') continue;
      messageById.set(message.documentId, message);
      recipientById.set(recipient.documentId, recipient);
      messages.push({ id: message.documentId, conversationId: message.conversation.documentId, recipientId: recipient.documentId, createdAt: message.createdAt, readAt: null, emailNotifiedAt: null });
    }

    // Last e-mail of each pair within the quiet delay.
    const recent = await documents(MESSAGE).findMany({
      filters: { emailNotifiedAt: { $gt: new Date(now.getTime() - QUIET_DELAY_MS) }, conversation: { edition: { documentId: edition.documentId } } },
      populate: { author: { fields: ['documentId'] }, conversation: { fields: ['documentId'], populate: { participants: { fields: ['documentId'] } } } },
      limit: LIMIT,
    });
    const notifiedAt = new Map();
    for (const message of recent) {
      const recipient = message.conversation.participants.find(({ documentId }) => documentId !== message.author?.documentId);
      if (!recipient) continue;
      const key = pairKey(message.conversation.documentId, recipient.documentId);
      if (!notifiedAt.has(key) || new Date(message.emailNotifiedAt) > new Date(notifiedAt.get(key))) notifiedAt.set(key, message.emailNotifiedAt);
    }

    const prefs = new Map([...recipientById].map(([id, recipient]) => [id, recipient.emailPrefs]));
    const publicUrl = strapi.config.get('server.espace.publicUrl');
    let sent = 0;
    for (const { conversationId, recipientId, messageIds } of notificationsDue({ messages, notifiedAt, prefs, now })) {
      const recipient = recipientById.get(recipientId);
      const last = messageById.get(messageIds.at(-1));
      const author = last.conversation.participants.find(({ documentId }) => documentId !== recipientId);
      const token = await strapi.service('api::espace.tokens').issueLink(recipientId, { ttlMinutes: ACTION_LINK_MINUTES, now });
      const { status } = await strapi.service('api::espace.mailer').send({
        attendee: recipient,
        template: 'new-message',
        scenarioKey: `new-message:${conversationId}:${last.documentId}`,
        now,
        data: {
          edition: { slug: edition.slug, title: edition.title, themeColor: edition.hero_bg_color },
          publicUrl,
          firstName: recipient.firstName,
          authorName: [author?.firstName, author?.lastName].filter(Boolean).join(' '),
          excerpt: excerpt(last.body),
          threadUrl: linkUrl({ publicUrl, token, next: `/espace/${edition.slug}/messages/${conversationId}` }),
        },
      });
      // A failed sending stays due: the next run tries again.
      if (status !== 'sent') continue;
      await strapi.db.query(MESSAGE).updateMany({ where: { documentId: { $in: messageIds } }, data: { emailNotifiedAt: now } });
      sent += 1;
    }
    return sent;
  }

  return {
    relatedAttendeeIds,

    /** GET /conversations (F-70): the conversations of the viewer that hold a message, the latest first. */
    async list(session, { now = new Date() } = {}) {
      const { edition } = session;
      const me = session.attendee.documentId;
      const conversations = await documents(CONVERSATION).findMany({
        filters: { edition: { documentId: edition.documentId }, participants: { documentId: me } },
        populate: { participants: { populate: ATTENDEE_CARD_POPULATE } },
        limit: LIMIT,
      });
      const [hosted, meetings] = await Promise.all([hostedOwners(edition), nextMeetings(me, now)]);

      const rows = await Promise.all(
        conversations.map(async (conversation) => {
          const other = conversation.participants.find(({ documentId }) => documentId !== me);
          const [last] = await documents(MESSAGE).findMany({
            filters: { conversation: { documentId: conversation.documentId } },
            populate: { author: { fields: ['documentId'] } },
            sort: ['createdAt:desc', 'id:desc'],
            limit: 1,
          });
          if (!other || !last) return null;
          const unread = await documents(MESSAGE).count({
            filters: { conversation: { documentId: conversation.documentId }, readAt: { $null: true }, author: { documentId: { $ne: me } } },
          });
          return {
            id: conversation.documentId,
            counterpart: attendeeCard({ ...other, hostedTableNumber: hosted.get(other.documentId) ?? null }),
            lastMessage: { excerpt: excerpt(last.body, LIST_EXCERPT_LENGTH), at: last.createdAt, mine: last.author?.documentId === me },
            unread,
            meeting: meetings.get(other.documentId) ?? null,
          };
        })
      );
      return rows.filter(Boolean).sort((a, b) => new Date(b.lastMessage.at) - new Date(a.lastMessage.at));
    },

    /**
     * POST /conversations (R-61, A-37): the conversation of the pair, created under the edition lock. -> { id, created }.
     * With no conversation yet: 403 TARGET_UNAVAILABLE when the target does not take messages (no `meetingsOptIn`, cancelled,
     * or oneself), then 404 TARGET_NOT_FOUND when the target is not visible to the viewer (A-34).
     */
    async open(session, body) {
      const match = TARGET_PATTERN.exec(typeof body?.with === 'string' ? body.with : '');
      if (!match) throw new EspaceError(400, 'VALIDATION', 'Corrigez les champs signalés.', { fields: { with: 'Destinataire non valable.' } });

      const { edition, attendee: me } = session;
      if (match[1] === me.documentId) throw new EspaceError(403, 'TARGET_UNAVAILABLE', 'Vous ne pouvez pas vous écrire à vous-même.');
      const target = await documents(ATTENDEE).findOne({ documentId: match[1], populate: { edition: { fields: ['documentId'] } } });
      if (!target || target.edition?.documentId !== edition.documentId) throw targetNotFound();

      return strapi.service('api::espace.locks').withLock(`conversation:${edition.documentId}`, async () => {
        const existing = await findPair(edition, me.documentId, target.documentId);
        if (existing) return { id: existing.documentId, created: false };

        if (target.status !== 'active' || !target.meetingsOptIn) {
          throw new EspaceError(403, 'TARGET_UNAVAILABLE', 'Cette personne ne souhaite pas recevoir de message pour le moment.');
        }
        const [hosted, related] = await Promise.all([hostedOwners(edition), relatedAttendeeIds(me.documentId)]);
        if (!profileVisibility({ viewerId: me.documentId, attendee: target, isOrganizer: isOrganizer(target), related, hosted })) throw targetNotFound();

        const created = await documents(CONVERSATION).create({
          data: { edition: link(edition), participants: canonicalPair(me, target).map(link) },
        });
        return { id: created.documentId, created: true };
      });
    },

    /**
     * GET /conversations/:id/messages?after= (F-70, F-71): the thread, oldest first ; the messages received become read by this call.
     * `after` (ISO date) keeps the messages sent later only.
     */
    async thread(session, id, { after, now = new Date() } = {}) {
      const { conversation, other } = await findConversation(session, id);
      const me = session.attendee.documentId;
      const all = await documents(MESSAGE).findMany({
        filters: { conversation: { documentId: conversation.documentId } },
        populate: { author: { fields: ['documentId'] } },
        sort: ['createdAt:asc', 'id:asc'],
        limit: LIMIT,
      });

      const received = all.filter(({ author, readAt }) => author?.documentId !== me && !readAt);
      if (received.length) await strapi.db.query(MESSAGE).updateMany({ where: { id: { $in: received.map(({ id: rowId }) => rowId) } }, data: { readAt: now } });
      const readNow = new Set(received.map(({ documentId }) => documentId));

      const since = typeof after === 'string' ? Date.parse(after) : Number.NaN;
      const messages = all
        .filter(({ createdAt }) => Number.isNaN(since) || new Date(createdAt).getTime() > since)
        .map((message) => ({
          id: message.documentId,
          body: message.body,
          at: message.createdAt,
          mine: message.author?.documentId === me,
          readAt: readNow.has(message.documentId) ? now.toISOString() : (message.readAt ?? null),
        }));

      const meetings = await nextMeetings(me, now);
      return {
        conversation: {
          id: conversation.documentId,
          counterpart: await counterpartCard(session.edition, other),
          meeting: meetings.get(other.documentId) ?? null,
          counterpartGetsEmail: other.status === 'active' && other.emailPrefs?.messages !== false,
        },
        messages,
      };
    },

    /**
     * POST /conversations/:id/messages (F-72, R-64): 400 VALIDATION for an empty message or one over 2 000 characters,
     * 429 RATE_LIMITED at the 31st message of the hour of the author, counted in the database under a lock per author.
     */
    async send(session, id, body, { now = new Date() } = {}) {
      const { conversation } = await findConversation(session, id);
      const text = validateBody(body?.body);
      const me = session.attendee;

      return strapi.service('api::espace.locks').withLock(`message:${me.documentId}`, async () => {
        const recent = await documents(MESSAGE).count({
          filters: { author: { documentId: me.documentId }, createdAt: { $gt: new Date(now.getTime() - MESSAGE_WINDOW_MS) } },
        });
        if (recent >= MESSAGE_LIMIT) {
          throw new EspaceError(429, 'RATE_LIMITED', 'Vous avez envoyé beaucoup de messages. Réessayez dans quelques minutes.');
        }
        const message = await documents(MESSAGE).create({ data: { conversation: link(conversation), author: link(me), body: text } });
        await documents(CONVERSATION).update({ documentId: conversation.documentId, data: { lastMessageAt: message.createdAt } });
        return { id: message.documentId, body: message.body, at: message.createdAt, mine: true, readAt: null };
      });
    },

    /**
     * R-62, F-73, T-31 (scheduled task `espaceMessageNotify`, every 5 minutes): one e-mail `new-message` per conversation and
     * recipient for the messages still unread after 5 minutes, at most one every 30 minutes, if the preference `messages` is on.
     * Editions whose space is closed send nothing (NF-52). -> { sent }
     */
    async notifyMessages({ now = new Date() } = {}) {
      const editions = await documents(EDITION).findMany({ status: 'published', limit: 1000 });
      let sent = 0;
      for (const edition of editions.filter(({ participantSpaceEnabled }) => participantSpaceEnabled)) sent += await notifyEdition(edition, now);
      return { sent };
    },
  };
};
