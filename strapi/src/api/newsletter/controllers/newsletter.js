'use strict';

module.exports = {
  subscribe: async (ctx) => {
    try {
      const { email, captchaToken } = ctx.request.body;

      if (!email) {
        return ctx.send({ message: 'Email is required' }, 400);
      }

      // Verify captcha (provider-agnostic)
      const captchaService = require('../../captcha/services/captcha');
      const isHuman = await captchaService.verify(captchaToken, 'newsletterSubscribe');

      if (!isHuman) {
        return ctx.send({ message: 'Captcha verification failed' }, 403);
      }

      // Subscribe via Brevo
      const { BrevoClient } = require('@getbrevo/brevo');
      const client = new BrevoClient({ apiKey: strapi.config.get('server.email.apiKey') });

      const listId = parseInt(strapi.config.get('server.email.listId'));

      await client.contacts.createContact({
        email,
        listIds: [listId],
      });

      return ctx.send({ message: 'success' }, 200);
    } catch (error) {
      console.error('Error in subscribe function:', error);
      return ctx.send({ message: 'Internal server error' }, 500);
    }
  },
};
