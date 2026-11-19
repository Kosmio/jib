'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// strapi/ (this file is strapi/src/api/espace/lib/mail/console.js)
const STRAPI_DIR = path.resolve(__dirname, '../../../../..');

/**
 * Development and test provider: no network. Appends each message as one JSON
 * line (attachments in base64) to the outbox file and logs recipient, subject and links.
 * Receives messages already normalized by createMailProvider().
 */
function createConsoleProvider({ outboxFile = '.tmp/mail-outbox.jsonl', logger = console, from } = {}) {
  const file = path.resolve(STRAPI_DIR, outboxFile);

  return {
    async send(message) {
      const messageId = `console-${randomUUID()}`;
      const record = { messageId, sentAt: new Date().toISOString(), from, ...message };

      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.appendFile(file, `${JSON.stringify(record)}\n`);

      const links = [...new Set(message.text.match(/https?:\/\/[^\s"'<>)]+/g) || [])];
      logger.info(`[mail:console] to=${message.to.email} subject="${message.subject}" links=${links.join(' ') || '-'}`);

      return { messageId };
    },
  };
}

module.exports = { createConsoleProvider };
