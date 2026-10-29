'use strict';

/**
 * Mail providers of the participant space (I-30, NF-06, NF-53).
 *
 * createMailProvider() returns { name, send(message) } where
 *   message = { to, subject, html, text, attachments?, headers? }
 *   to      = "a@b.c" | "Name <a@b.c>" | { email, name? }
 *   attachments[].content = Buffer, or string (UTF-8 text, e.g. an .ics file)
 * and send() resolves with { messageId }.
 *
 * Never use strapi.plugin('email'): it is still on sendmail.
 */

const { createConsoleProvider } = require('./console');
const { createBrevoProvider } = require('./brevo');

const EMAIL_PATTERN = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/** "Name <a@b.c>", "a@b.c" or { email, name } -> { email, name? } */
function parseAddress(input) {
  let email;
  let name;

  if (typeof input === 'string') {
    const match = input.trim().match(/^(.*?)\s*<([^<>]*)>$/);
    email = (match ? match[2] : input).trim();
    name = match ? match[1].replace(/^"(.*)"$/, '$1').trim() : '';
  } else if (input && typeof input === 'object') {
    ({ email, name } = input);
    email = typeof email === 'string' ? email.trim() : email;
  }

  if (typeof email !== 'string' || !EMAIL_PATTERN.test(email)) {
    throw new Error(`Invalid e-mail address: ${JSON.stringify(input)}`);
  }
  return name ? { email, name } : { email };
}

/** Validates a message and gives the providers one shape: attachments in base64. */
function normalizeMessage({ to, subject, html, text, attachments = [], headers = {} } = {}) {
  for (const [key, value] of Object.entries({ subject, html, text })) {
    if (typeof value !== 'string' || !value) throw new Error(`Mail message needs a non-empty "${key}"`);
  }
  return {
    to: parseAddress(to),
    subject,
    html,
    text,
    attachments: attachments.map(({ filename, content, contentType }) => {
      if (!filename) throw new Error('Mail attachment needs a "filename"');
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ''));
      return { filename, contentType, content: buffer.toString('base64') };
    }),
    headers,
  };
}

function createMailProvider({ provider, apiKey, from, outboxFile, nodeEnv, logger = console, client } = {}) {
  const name = provider || (nodeEnv === 'production' ? 'brevo' : 'console');
  const sender = from ? parseAddress(from) : undefined;
  let impl;

  if (name === 'console') {
    impl = createConsoleProvider({ outboxFile, logger, from: sender });
  } else if (name === 'brevo') {
    if (nodeEnv === 'test') throw new Error('The brevo mail provider is refused when NODE_ENV=test');
    if (!apiKey) throw new Error('The brevo mail provider needs an API key (EMAIL_API_KEY)');
    if (!sender) throw new Error('The brevo mail provider needs a sender (EMAIL_FROM)');
    impl = createBrevoProvider({ apiKey, from: sender, client });
  } else {
    throw new Error(`Unknown mail provider "${name}" (expected "console" or "brevo")`);
  }

  return { name, send: async (message) => impl.send(normalizeMessage(message)) };
}

module.exports = { createMailProvider, parseAddress };
