'use strict';

const { createHmac } = require('node:crypto');
const { hashToken } = require('../tokens');

/** A card token is 32 bytes in base64url: 43 characters (R-80). */
const CARD_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Instant as a stable ISO string, whatever the driver gave back (Date or text). null when it is not a date. */
function isoOf(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

/**
 * R-80, NF-55: card token derived from a server secret, so that a badge printed again keeps its QR code.
 * token = base64url(HMAC-SHA256(key, documentId + ":" + cardTokenCreatedAt)), key derived from the first application key.
 * Changing `createdAt` changes the token: that is how an organizer regenerates it. Only hashToken(token) is stored.
 */
function deriveCardToken({ secret, documentId, createdAt }) {
  const iso = isoOf(createdAt);
  if (!secret || !documentId || !iso) throw new Error('deriveCardToken: secret, documentId and createdAt are required');
  const key = createHmac('sha256', String(secret)).update('jib-espace-card-token').digest();
  return createHmac('sha256', key).update(`${documentId}:${iso}`).digest('base64url');
}

/** {publicUrl}/espace/{edition}/carte/{token}: the address written in the QR code (I-43). */
const cardUrl = ({ publicUrl, slug, token }) => `${String(publicUrl).replace(/\/+$/, '')}/espace/${encodeURIComponent(slug)}/carte/${token}`;

module.exports = { CARD_TOKEN_PATTERN, deriveCardToken, cardUrl, hashCardToken: hashToken, isoOf };
