'use strict';

const { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } = require('node:crypto');

/** 32 random bytes in base64url (43 characters, I-20). Only the hash is ever stored. */
const generateToken = () => randomBytes(32).toString('base64url');

/** SHA-256 in hexadecimal (NF-02). */
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

/** {publicUrl}/espace/verifier?token=…&next=… ; the slashes of `next` stay readable, the other characters are escaped. */
function linkUrl({ publicUrl, token, next }) {
  const nextParam = next ? `&next=${next.split('/').map(encodeURIComponent).join('/')}` : '';
  return `${publicUrl.replace(/\/+$/, '')}/espace/verifier?token=${token}${nextParam}`;
}

// I-44: a code row is a MagicToken of kind `link` whose tokenHash starts with this prefix (a SHA-256 in hexadecimal never does) and names the link it belongs to.
const CODE_PREFIX = 'c1:';

/** Six random digits, zeros kept (I-44). */
const generateCode = () => String(randomInt(0, 1000000)).padStart(6, '0');

/** The six digits typed by a person, spaces and dashes tolerated -> the digits, or '' when it is not a six-digit code. */
const normalizeCode = (value) => {
  const digits = typeof value === 'string' ? value.replace(/[\s\u00a0\u202f.-]/g, '') : '';
  return /^[0-9]{6}$/.test(digits) ? digits : '';
};

/**
 * I-44: stored form of a code, `c1:<link documentId>:<HMAC-SHA-256>`. The 10^6 values are not invertible from the database:
 * the HMAC key is derived from a server secret, and the link id salts each code.
 */
function hashCode(code, { linkDocumentId, secret }) {
  const key = createHmac('sha256', String(secret)).update('jib-espace-login-code').digest();
  return `${CODE_PREFIX}${linkDocumentId}:${createHmac('sha256', key).update(`${linkDocumentId}:${code}`).digest('hex')}`;
}

/** Constant-time comparison of two stored forms (NF-02). */
const sameHash = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** « 123456 » -> « 1 2 3 4 5 6 » for the e-mail. */
const spacedCode = (code) => code.split('').join(' ');

module.exports = { CODE_PREFIX, generateCode, generateToken, hashCode, hashToken, linkUrl, normalizeCode, sameHash, spacedCode };
