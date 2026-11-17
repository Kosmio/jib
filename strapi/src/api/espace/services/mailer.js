'use strict';

const { createMailProvider } = require('../lib/mail');
const { renderEmail } = require('../lib/mail/render');

module.exports = ({ strapi }) => {
  let provider;

  return {
    /**
     * Renders the template, sends it through the provider chosen by server.email (console or brevo, NF-53)
     * and writes the EmailLog. A failure never throws: the EmailLog gets the status "failed" and the error is logged.
     * `attachments` goes to the provider as it is: [{ filename, content, contentType }], e.g. the .ics of meeting-accepted (A-33, I-41).
     * NF-62: the EmailLog of a failure keeps the first line of the reason (300 characters at most) in `error`.
     * -> { status: 'sent' | 'failed', messageId, error }
     */
    async send({ attendee, template, data, scenarioKey, attachments, now = new Date() }) {
      let status = 'sent';
      let messageId;
      let error;
      try {
        provider ??= createMailProvider({ ...strapi.config.get('server.email'), nodeEnv: process.env.NODE_ENV, logger: strapi.log });
        const { subject, html, text } = renderEmail(template, data);
        const name = [attendee.firstName, attendee.lastName].filter(Boolean).join(' ');
        ({ messageId } = await provider.send({ to: { email: attendee.email, name }, subject, html, text, attachments }));
      } catch (failure) {
        status = 'failed';
        error = String(failure.message).split('\n')[0].slice(0, 300);
        strapi.log.error(`[mail] ${template} for attendee ${attendee.documentId} not sent: ${error}`);
      }

      await strapi.documents('api::espace.email-log').create({
        data: { attendee: { documentId: attendee.documentId }, template, scenarioKey, sentAt: now, providerMessageId: messageId, status, error },
      });
      return { status, messageId, error };
    },
  };
};
