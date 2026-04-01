'use strict';

module.exports = {
  send: async (ctx) => {
    const { email, message, name, subject, captchaToken, newsletterConsent } = ctx.request.body;

    if (!email || !message) {
      return ctx.send({ message: 'invalid content' }, 400);
    }

    // Verify captcha (provider-agnostic)
    const captchaService = require('../../captcha/services/captcha');
    const isHuman = await captchaService.verify(captchaToken, 'contactForm');

    if (!isHuman) {
      return ctx.send({ message: 'Captcha verification failed' }, 403);
    }

    // Send via Brevo
    const { BrevoClient } = require('@getbrevo/brevo');
    const client = new BrevoClient({ apiKey: strapi.config.get('server.email.apiKey') });

    const templateId = parseInt(strapi.config.get('server.email.contact.templateId'));
    const contactTo = strapi.config.get('server.email.contact.to');

    try {
      await client.transactionalEmails.sendTransacEmail({
        templateId,
        to: [{ email: contactTo, name: 'Contact' }],
        replyTo: { email, name: name || 'Unknown' },
        params: { name, email, subject, message },
      });

      // Subscribe to newsletter if consent was given
      if (newsletterConsent) {
        try {
          const listId = parseInt(strapi.config.get('server.email.listId'));
          await client.contacts.createContact({
            email,
            attributes: { PRENOM: name || '' },
            listIds: [listId],
          });
        } catch (err) {
          // Don't fail the contact form if newsletter subscription fails
          console.warn('Newsletter subscription failed for', email, err?.message);
        }
      }

      ctx.send({ message: 'success' }, 200);
    } catch {
      ctx.send({ message: 'error' }, 500);
    }
  },
};
