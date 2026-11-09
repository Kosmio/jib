'use strict';

/**
 * SMTP provider for test environments (preprod): points at a catch-all server such as Mailpit,
 * plain connection, no authentication. `transport` is injectable to test without network.
 * Receives messages already normalized by createMailProvider().
 */
function createSmtpProvider({
  host,
  port,
  from,
  transport = require('nodemailer').createTransport({ host, port, secure: false, ignoreTLS: true }),
}) {
  return {
    async send({ to, subject, html, text, attachments, headers }) {
      const info = await transport.sendMail({
        from: from.name ? { name: from.name, address: from.email } : from.email,
        to: to.name ? { name: to.name, address: to.email } : to.email,
        subject,
        html,
        text,
        attachments: attachments.map(({ filename, contentType, content }) => ({ filename, contentType, content, encoding: 'base64' })),
        headers,
      });
      return { messageId: info.messageId };
    },
  };
}

module.exports = { createSmtpProvider };
