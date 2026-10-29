'use strict';

const { createMailProvider } = require('../lib/mail');
const { renderEmail } = require('../lib/mail/render');

module.exports = ({ strapi }) => {
  let provider;

  return {
    /**
     * Renders the template, sends it through the provider chosen by server.email (console or brevo, NF-53)
     * and writes the EmailLog. A failure never throws: the EmailLog gets the status "failed" and the error is logged.
     * -> { status: 'sent' | 'failed', messageId }
     */
    async send({ attendee, template, data, scenarioKey, now = new Date() }) {
      let status = 'sent';
      let messageId;
      try {
        provider ??= createMailProvider({ ...strapi.config.get('server.email'), nodeEnv: process.env.NODE_ENV, logger: strapi.log });
        const { subject, html, text } = renderEmail(template, data);
        const name = [attendee.firstName, attendee.lastName].filter(Boolean).join(' ');
        ({ messageId } = await provider.send({ to: { email: attendee.email, name }, subject, html, text }));
      } catch (error) {
        status = 'failed';
        strapi.log.error(`[mail] ${template} for attendee ${attendee.documentId} not sent: ${error.message.split('\n')[0]}`);
      }

      await strapi.documents('api::espace.email-log').create({
        data: { attendee: { documentId: attendee.documentId }, template, scenarioKey, sentAt: now, providerMessageId: messageId, status },
      });
      return { status, messageId };
    },
  };
};
