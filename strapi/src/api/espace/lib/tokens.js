'use strict';

const { createHash, randomBytes } = require('node:crypto');

/** 32 random bytes in base64url (43 characters, I-20). Only the hash is ever stored. */
const generateToken = () => randomBytes(32).toString('base64url');

/** SHA-256 in hexadecimal (NF-02). */
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

/** {publicUrl}/espace/verifier?token=…&next=… ; the slashes of `next` stay readable, the other characters are escaped. */
function linkUrl({ publicUrl, token, next }) {
  const nextParam = next ? `&next=${next.split('/').map(encodeURIComponent).join('/')}` : '';
  return `${publicUrl.replace(/\/+$/, '')}/espace/verifier?token=${token}${nextParam}`;
}

module.exports = { generateToken, hashToken, linkUrl };
