'use strict';

module.exports = {
  register(/*{ strapi }*/) {},

  async bootstrap({ strapi }) {
    // Set French as default locale if not already configured
    const localeService = strapi.plugin('i18n').service('locales');
    const existingLocales = await localeService.find();
    const hasFrench = existingLocales.some((l) => l.code === 'fr');

    if (!hasFrench) {
      await localeService.create({ code: 'fr', name: 'French (fr)' });
    }

    const frLocale = (await localeService.find()).find((l) => l.code === 'fr');
    if (frLocale && !frLocale.isDefault) {
      await localeService.setIsDefault(frLocale.id);
    }

    // Set public permissions for API endpoints
    await setPublicPermissions(strapi, [
      { api: 'captcha', actions: ['challenge'] },
      { api: 'contact', actions: ['send'] },
      { api: 'newsletter', actions: ['subscribe'] },
    ]);
  },
};

async function setPublicPermissions(strapi, endpoints) {
  const publicRole = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: 'public' },
  });

  if (!publicRole) return;

  for (const { api, actions } of endpoints) {
    for (const action of actions) {
      const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
        where: {
          role: publicRole.id,
          action: `api::${api}.${api}.${action}`,
        },
      });

      if (!existing) {
        await strapi.db.query('plugin::users-permissions.permission').create({
          data: {
            role: publicRole.id,
            action: `api::${api}.${api}.${action}`,
          },
        });
        strapi.log.info(`Granted public permission: ${api}.${action}`);
      }
    }
  }
}
