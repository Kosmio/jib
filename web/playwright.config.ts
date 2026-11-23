import { defineConfig, devices } from '@playwright/test';

/**
 * Configuration Playwright du site web. Chromium seulement.
 *
 * Projet `visual` (lot A de la phase 0, NF-40) : non-régression visuelle des pages
 * publiques, en local seulement. Il lit la base `strapi_espace` par l'intermédiaire
 * de Strapi (port 1337) et du front construit puis servi (port 4321). Il est exclu
 * de la CI : pas de données de production en CI, et les références sont propres à macOS.
 * Les serveurs ne sont pas démarrés par Playwright : voir docs/espace/CLAUDE.md.
 *
 * Projet `e2e` (lot C de la phase 0, A-14) : tests de bout en bout sur la base e2e (E2E_DATABASE, défaut
 * `strapi_e2e`), remplie par le seed de recette. `pnpm test:e2e` pose PLAYWRIGHT_E2E=1, ce qui fait démarrer par
 * Playwright, et lui seul, les deux serveurs ci-dessous (le projet `visual` n'en a pas besoin) :
 *   - Strapi des tests (strapi/tests/e2e-server.js) : vide la base e2e, y lance le seed, puis écoute
 *     sur 127.0.0.1:E2E_STRAPI_PORT (défaut 1348). L'admin n'est pas construit.
 *   - le front construit dans dist-e2e/<port> (le `dist` du projet `visual` reste intact) et servi sur
 *     127.0.0.1:E2E_WEB_PORT (défaut 4332), branché sur ce Strapi.
 * Les ports sont distincts de ceux du développement (1337, 4321) pour laisser tourner les serveurs
 * de développement ; ils se changent par les deux variables si un autre projet les occupe.
 * Aucun serveur existant n'est réutilisé : les données doivent être celles du seed.
 *
 * Exécutions simultanées (plusieurs agents, un même poste) : chacune prend ses propres E2E_STRAPI_PORT,
 * E2E_WEB_PORT et E2E_DATABASE, par exemple
 *   E2E_DATABASE=strapi_dev_e2e E2E_STRAPI_PORT=1358 E2E_WEB_PORT=4342 pnpm test:e2e
 * et ses dossiers de sortie, tous nommés d'après le port web (dist-e2e/<port>, test-results/e2e-<port>,
 * playwright-report/e2e-<port>) : Playwright vide son dossier de sortie au départ, deux exécutions ne
 * doivent donc jamais partager le leur.
 */

const STRAPI_PORT = process.env.E2E_STRAPI_PORT ?? '1348';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '4332';
const STRAPI_URL = `http://127.0.0.1:${STRAPI_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

// Lus par les tests (le fichier de configuration est évalué dans chaque processus).
process.env.E2E_STRAPI_URL = STRAPI_URL;

const startServers = process.env.PLAYWRIGHT_E2E === '1';

// Dossiers de sortie propres à l'exécution : voir l'en-tête.
const RUN = startServers ? `e2e-${WEB_PORT}` : 'visual';
const WEB_BUILD_DIR = `dist-e2e/${WEB_PORT}`;

export default defineConfig({
  testDir: './tests',
  outputDir: `./test-results/${RUN}`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never', outputFolder: `playwright-report/${RUN}` }]],
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
    {
      name: 'e2e',
      testDir: './tests/e2e',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: WEB_URL,
        locale: 'fr-FR',
        timezoneId: 'Europe/Paris',
        colorScheme: 'light',
        trace: 'retain-on-failure',
        // Le service worker de /espace/ (PWA, F-05) intercepte les navigations : bloqué par défaut pour que les tests qui lisent ou
        // coupent le réseau restent déterministes. Le test dédié (espace-pwa.spec.ts) le réautorise.
        serviceWorkers: 'block',
      },
    },
  ],
  webServer: startServers
    ? [
        {
          name: 'strapi-e2e',
          command: 'node --require ./tests/helpers/no-network.js tests/e2e-server.js',
          cwd: '../strapi',
          env: { E2E_STRAPI_PORT: STRAPI_PORT },
          // `port` plutôt que `url` : si le port est déjà occupé (par exemple par le serveur de développement
          // d'un autre projet), Playwright échoue aussitôt avec un message clair au lieu d'attendre 180 s.
          port: Number(STRAPI_PORT),
          reuseExistingServer: false,
          timeout: 180_000,
          gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
          stdout: 'pipe',
          stderr: 'pipe',
        },
        {
          name: 'web-e2e',
          command: `node ./node_modules/astro/bin/astro.mjs build --outDir ${WEB_BUILD_DIR} && node ${WEB_BUILD_DIR}/server/entry.mjs`,
          env: {
            HOST: '127.0.0.1',
            PORT: WEB_PORT,
            STRAPI_URL,
            REACT_STRAPI_URL: STRAPI_URL,
            // Aucun traqueur ni bandeau de cookies dans les tests, même si web/.env en définit.
            PUBLIC_COOKIE_CONSENT: 'false',
            PUBLIC_MATOMO_URL: '',
            PUBLIC_MATOMO_SITE_ID: '',
          },
          port: Number(WEB_PORT),
          reuseExistingServer: false,
          timeout: 180_000,
          gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      ]
    : undefined,
});
