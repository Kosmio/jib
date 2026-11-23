'use strict';

/**
 * Brevo transactional provider. Reuses the BrevoClient and the API key of the site.
 * `client` is injectable to test without network. Receives messages already
 * normalized by createMailProvider().
 */
function createBrevoProvider({
  apiKey,
  from,
  client = new (require('@getbrevo/brevo').BrevoClient)({ apiKey }),
}) {
  return {
    async send({ to, subject, html, text, attachments, headers }) {
      const response = await client.transactionalEmails.sendTransacEmail({
        sender: from,
        to: [to],
        subject,
        htmlContent: html,
        textContent: text,
        ...(attachments.length && { attachment: attachments.map(({ filename, content }) => ({ name: filename, content })) }),
        ...(Object.keys(headers).length && { headers }),
      });
      return { messageId: response.messageId };
    },
  };
}

module.exports = { createBrevoProvider };
