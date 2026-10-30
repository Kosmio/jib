'use strict';

const { EspaceError } = require('./errors');

const MINUTE_MS = 60 * 1000;

// R-62: an e-mail goes out for a message still unread 5 minutes after it was sent, at most one per conversation and recipient every 30 minutes.
const UNREAD_DELAY_MS = 5 * MINUTE_MS;
const QUIET_DELAY_MS = 30 * MINUTE_MS;
// R-64: 30 messages per hour and per author.
const MESSAGE_LIMIT = 30;
const MESSAGE_WINDOW_MS = 60 * MINUTE_MS;
// F-72: 2 000 characters at most ; the e-mail quotes the first 200.
const BODY_MAX_LENGTH = 2000;
const EXCERPT_LENGTH = 200;

/** Value of a Map or of a plain object. */
const lookup = (collection, key) => (collection instanceof Map ? collection.get(key) : collection?.[key]);

/** The `messages` e-mail preference (all three are on by default) of a recipient: a boolean, or an `emailPrefs` object. */
function wantsMessageEmails(prefs) {
  if (typeof prefs === 'boolean') return prefs;
  return prefs?.messages !== false;
}

/** Key of a conversation and recipient pair, as used by `notifiedAt`. */
const pairKey = (conversationId, recipientId) => `${conversationId}:${recipientId}`;

/**
 * R-62: the e-mails `new-message` to send now.
 *  - `messages`: `[{ id, conversationId, recipientId, createdAt, readAt, emailNotifiedAt }]`, any message of the edition ;
 *    `recipientId` is the participant who is not the author.
 *  - `notifiedAt`: Map (or object) `"{conversationId}:{recipientId}"` -> instant of the last e-mail for that pair.
 *  - `prefs`: Map (or object) `recipientId` -> `emailPrefs` ({ messages }) ; an unknown recipient wants the e-mails.
 * A message is due when it is unread for 5 minutes and was never notified. A pair that got an e-mail within 30 minutes waits ;
 * its messages stay due and are taken by a later run. -> `[{ conversationId, recipientId, messageIds }]`, messageIds oldest first.
 */
function notificationsDue({ messages, notifiedAt = new Map(), prefs = new Map(), now = new Date() }) {
  const current = new Date(now).getTime();
  const groups = new Map();

  const due = messages
    .filter((message) => !message.readAt && !message.emailNotifiedAt && current - new Date(message.createdAt).getTime() >= UNREAD_DELAY_MS)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || String(a.id).localeCompare(String(b.id)));

  for (const { id, conversationId, recipientId } of due) {
    const key = pairKey(conversationId, recipientId);
    const last = lookup(notifiedAt, key);
    if (last && current - new Date(last).getTime() < QUIET_DELAY_MS) continue;
    if (!wantsMessageEmails(lookup(prefs, recipientId))) continue;
    if (!groups.has(key)) groups.set(key, { conversationId, recipientId, messageIds: [] });
    groups.get(key).messageIds.push(id);
  }
  return [...groups.values()];
}

/** The text of a message cut for an e-mail or a list: white space collapsed, `max` characters at most, an ellipsis when cut. */
function excerpt(body, max = EXCERPT_LENGTH) {
  const text = String(body ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** F-72: the body of a message to send -> trimmed text ; 400 VALIDATION with `fields.body` when it is not a text, empty or over 2 000 characters. */
function validateBody(body) {
  const text = typeof body === 'string' ? body.trim() : '';
  const problem = !text ? 'Écrivez votre message.' : text.length > BODY_MAX_LENGTH ? `${BODY_MAX_LENGTH} caractères au plus.` : null;
  if (problem) throw new EspaceError(400, 'VALIDATION', 'Corrigez les champs signalés.', { fields: { body: problem } });
  return text;
}

/** R-61: the two participants of a conversation, in the order of their ids (A-37). `people` carry a numeric `id`. */
const canonicalPair = (a, b) => (a.id <= b.id ? [a, b] : [b, a]);

module.exports = {
  UNREAD_DELAY_MS,
  QUIET_DELAY_MS,
  MESSAGE_LIMIT,
  MESSAGE_WINDOW_MS,
  BODY_MAX_LENGTH,
  EXCERPT_LENGTH,
  pairKey,
  notificationsDue,
  excerpt,
  validateBody,
  canonicalPair,
};
