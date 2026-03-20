'use strict';

/**
 * A set of functions called "actions" for `contact`
 */
module.exports = {
  send: async (ctx) => {
    const brevo = require('@getbrevo/brevo');
    const apiInstance = new brevo.TransactionalEmailsApi();
    apiInstance.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, strapi.config.get('server.email.apiKey'));

    const templateId = parseInt(strapi.config.get('server.email.contact.templateId'));
    const contactTo = strapi.config.get('server.email.contact.to');

    if (ctx.request.body.email && ctx.request.body.message) {
      const sendSmtpEmail = new brevo.SendSmtpEmail();

      sendSmtpEmail.templateId = templateId;
      sendSmtpEmail.to = [{ email: contactTo, name: 'Contact' }];
      sendSmtpEmail.replyTo = {
        email: ctx.request.body.email,
        name: ctx.request.body.name || 'Unknown',
      };
      sendSmtpEmail.params = {
        name: ctx.request.body.name,
        email: ctx.request.body.email,
        subject: ctx.request.body.subject,
        message: ctx.request.body.message,
      };

      return apiInstance.sendTransacEmail(sendSmtpEmail).then(
        function () {
          ctx.send({ message: 'success' }, 200);
        },
        function () {
          ctx.send({ message: 'error' }, 500);
        }
      );
    } else {
      return ctx.send({ message: 'invalid content' }, 400);
    }
  },
};
