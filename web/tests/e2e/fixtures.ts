import { expect, test as base } from '@playwright/test';

/**
 * Fixtures communes des tests de bout en bout (C3).
 *
 * - Réseau fermé : toute requête du navigateur hors localhost est coupée et enregistrée. Seules
 *   les polices Google que charge le site (Q-14) sont tolérées ; toute autre sortie fait échouer le test.
 * - Erreurs JavaScript : une exception non rattrapée dans la page fait échouer le test.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const TOLERATED_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

export const STRAPI_URL = process.env.E2E_STRAPI_URL ?? 'http://127.0.0.1:1338';

export const test = base.extend<{ network: { blockedHosts: string[]; pageErrors: string[] } }>({
  network: [
    async ({ page, context }, use) => {
      const blockedHosts: string[] = [];
      const pageErrors: string[] = [];

      await context.route(
        (url) => !LOCAL_HOSTS.has(url.hostname),
        (route) => {
          blockedHosts.push(new URL(route.request().url()).hostname);
          return route.abort('blockedbyclient');
        },
      );
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await use({ blockedHosts, pageErrors });

      const unexpected = [...new Set(blockedHosts)].filter((host) => !TOLERATED_HOSTS.has(host));
      expect(unexpected, 'requêtes sortantes hors localhost (hors polices Google)').toEqual([]);
      expect(pageErrors, 'erreurs JavaScript dans la page').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
