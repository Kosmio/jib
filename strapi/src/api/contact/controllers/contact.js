'use strict';

/**
 * A set of functions called "actions" for `contact`
 */
module.exports = {
  send: async (ctx) => {
    const { BrevoClient } = require('@getbrevo/brevo');
    const client = new BrevoClient({ apiKey: strapi.config.get('server.email.apiKey') });

    const templateId = parseInt(strapi.config.get('server.email.contact.templateId'));
    const contactTo = strapi.config.get('server.email.contact.to');

    if (ctx.request.body.email && ctx.request.body.message) {
      try {
        await client.transactionalEmails.sendTransacEmail({
          templateId,
          to: [{ email: contactTo, name: 'Contact' }],
          replyTo: {
            email: ctx.request.body.email,
            name: ctx.request.body.name || 'Unknown',
          },
          params: {
            name: ctx.request.body.name,
            email: ctx.request.body.email,
            subject: ctx.request.body.subject,
            message: ctx.request.body.message,
          },
        });
        ctx.send({ message: 'success' }, 200);
      } catch {
        ctx.send({ message: 'error' }, 500);
      }
    } else {
      return ctx.send({ message: 'invalid content' }, 400);
    }
  },
};
