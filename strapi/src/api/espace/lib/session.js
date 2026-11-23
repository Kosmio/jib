'use strict';

const COOKIE_NAME = 'jib_espace';

/**
 * Redirection target after a login (I-21, A-04): `next` when it stays inside the edition, otherwise the edition home.
 * Refused: `//`, a backslash, `..`, a control character, and the same sequences percent-encoded (browsers read %2e%2e as `..`).
 */
function safeNextPath(next, editionSlug) {
  const home = `/espace/${editionSlug}/`;
  if (typeof next !== 'string' || !next.startsWith(home)) return home;

  let decoded;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return home;
  }
  return [next, decoded].some((path) => /\/\/|\\|\.\.|[\u0000-\u001f]/.test(path)) ? home : next;
}

/** Options of the signed `jib_espace` cookie (I-22). Secure only over https: a browser drops it over plain http. */
const sessionCookieOptions = ({ publicUrl, maxAgeMs }) => ({
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  signed: true,
  overwrite: true,
  secure: String(publicUrl).startsWith('https://'),
  maxAge: maxAgeMs,
});

module.exports = { COOKIE_NAME, safeNextPath, sessionCookieOptions };
