'use strict';

/**
 * A set of functions called "actions" for `newsletter`
 */
const { RecaptchaEnterpriseServiceClient } = require('@google-cloud/recaptcha-enterprise');
const brevo = require('@getbrevo/brevo');

module.exports = {
  subscribe: async (ctx) => {
    try {
      const { email, recaptchaToken } = ctx.request.body;

      if (!email || !recaptchaToken) {
        return ctx.send({ message: 'Invalid request, missing parameters' }, 400);
      }

      const projectId = strapi.config.get('server.recaptcha.projectId');
      const recaptchaKey = strapi.config.get('server.recaptcha.siteKey');
      const recaptchaApiKey = strapi.config.get('server.recaptcha.apiKey');
      const recaptchaAction = 'newsletterSubscribe';

      const recaptchaScore = await createAssessment(recaptchaToken, recaptchaAction, projectId, recaptchaKey, recaptchaApiKey);

      if (recaptchaScore === null || recaptchaScore < 0.5) {
        return ctx.send({ message: 'Recaptcha verification failed, potential bot detected' }, 403);
      }

      const apiInstance = new brevo.ContactsApi();
      apiInstance.setApiKey(brevo.ContactsApiApiKeys.apiKey, strapi.config.get('server.email.apiKey'));

      const listId = parseInt(strapi.config.get('server.email.listId'));
      const createContact = new brevo.CreateContact();
      createContact.email = email;
      createContact.listIds = [listId];

      await apiInstance.createContact(createContact);

      return ctx.send({ message: 'success' }, 200);
    } catch (error) {
      console.error('Error in subscribe function:', error);
      return ctx.send({ message: 'Internal server error' }, 500);
    }
  },
};

async function createAssessment(token, recaptchaAction, projectID, recaptchaKey, apiKey) {
  try {
    const client = new RecaptchaEnterpriseServiceClient({ apiKey });
    const projectPath = client.projectPath(projectID);

    const request = {
      assessment: {
        event: {
          token: token,
          siteKey: recaptchaKey,
        },
      },
      parent: projectPath,
    };

    const [response] = await client.createAssessment(request);

    if (!response.tokenProperties.valid) {
      console.log(`reCAPTCHA token invalid: ${response.tokenProperties.invalidReason}`);
      return null;
    }

    if (response.tokenProperties.action !== recaptchaAction) {
      console.log('The reCAPTCHA action does not match the expected action.');
      return null;
    }

    console.log(`reCAPTCHA Score: ${response.riskAnalysis.score}`);
    return response.riskAnalysis.score;
  } catch (error) {
    console.error('Error in createAssessment:', error);
    return null;
  }
}
