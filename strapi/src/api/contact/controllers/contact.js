'use strict';

const { createMailProvider } = require('../../espace/lib/mail');
const { contactMessage } = require('../lib/message');

/**
 * POST /api/contact/send (public): the contact form of the site.
 * The message goes through the mail provider of the space (brevo in prod, smtp in preprod, console elsewhere),
 * from EMAIL_FROM to EMAIL_CONTACT_TO, with the visitor as Reply-To. No Brevo template.
 */
module.exports = {
  send: async (ctx) => {
    const { email, message, name, subject, captchaToken, newsletterConsent } = ctx.request.body ?? {};

    const mail = contactMessage({ name, email, subject, message });
    if (mail.error) {
      return ctx.send({ message: mail.error }, 400);
    }

    // Verify captcha (provider-agnostic)
    const captchaService = require('../../captcha/services/captcha');
    const isHuman = await captchaService.verify(captchaToken, 'contactForm');

    if (!isHuman) {
      return ctx.send({ message: 'Captcha verification failed' }, 403);
    }

    const settings = strapi.config.get('server.email') ?? {};

    try {
      if (!settings.contact?.to) throw new Error('EMAIL_CONTACT_TO is empty');
      const provider = createMailProvider({ ...settings, nodeEnv: process.env.NODE_ENV, logger: strapi.log });
      await provider.send({ to: settings.contact.to, ...mail });
    } catch (error) {
      strapi.log.error(`[contact] message not sent: ${String(error?.message).split('\n')[0].slice(0, 300)}`);
      return ctx.send({ message: 'error' }, 500);
    }

    // Subscribe to the newsletter if consent was given (Brevo contact list; never fails the contact form)
    if (newsletterConsent && settings.apiKey && settings.listId) {
      try {
        const { BrevoClient } = require('@getbrevo/brevo');
        await new BrevoClient({ apiKey: settings.apiKey }).contacts.createContact({
          email: mail.replyTo.email,
          attributes: { PRENOM: mail.replyTo.name || '' },
          listIds: [parseInt(settings.listId)],
        });
      } catch (error) {
        strapi.log.warn(`[contact] newsletter subscription failed: ${String(error?.message).split('\n')[0].slice(0, 300)}`);
      }
    }

    return ctx.send({ message: 'success' }, 200);
  },
};
