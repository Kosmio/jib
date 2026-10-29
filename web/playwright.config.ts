import { defineConfig, devices } from '@playwright/test';

/**
 * Configuration Playwright du site web.
 *
 * Projet `visual` (lot A de la phase 0, NF-40) : non-régression visuelle des pages
 * publiques, en local seulement. Il lit la base `strapi_espace` par l'intermédiaire
 * de Strapi (port 1337) et du front construit puis servi (port 4321). Il est exclu
 * de la CI : pas de données de production en CI, et les références sont propres à macOS.
 *
 * Les serveurs ne sont pas démarrés par Playwright : voir docs/espace/CLAUDE.md.
 * Chromium seulement.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    {
      name: 'visual',
      testDir: './tests/visual',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4321',
        locale: 'fr-FR',
        timezoneId: 'Europe/Paris',
        colorScheme: 'light',
        deviceScaleFactor: 1,
      },
    },
  ],
});
