import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { ESPACE, expect, test } from './espace';

/**
 * Erreurs lisibles (V1-E : F-107, NF-50, F-108).
 *
 * « Strapi arrêté » : le test construit un second front (`dist-e2e/<port>-sans-strapi`, une dizaine de secondes) dont STRAPI_URL vise
 * un port où rien n'écoute (Astro fige STRAPI_URL à la construction, un simple changement d'environnement au lancement ne suffit
 * pas), puis le sert sur un port libre et l'arrête en fin de fichier. Le Strapi de test et la configuration partagée restent
 * intacts.
 */

const WEB_PORT = process.env.E2E_WEB_PORT ?? '4332';
const OUT_DIR = `dist-e2e/${WEB_PORT}-sans-strapi`;
const ENTRY = path.resolve(process.cwd(), OUT_DIR, 'server/entry.mjs');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

let child: ChildProcess;
let DEAD: string;
let logs = '';

test.beforeAll(async () => {
  test.setTimeout(180_000);
  const webPort = await freePort();
  const closedStrapiPort = await freePort();
  const closedStrapi = `http://127.0.0.1:${closedStrapiPort}`;
  const build = spawnSync('node', ['./node_modules/astro/bin/astro.mjs', 'build', '--outDir', OUT_DIR], {
    env: { ...process.env, STRAPI_URL: closedStrapi, REACT_STRAPI_URL: closedStrapi, PUBLIC_COOKIE_CONSENT: 'false', PUBLIC_MATOMO_URL: '', PUBLIC_MATOMO_SITE_ID: '' },
    encoding: 'utf8',
  });
  expect(build.status, `build du front sans Strapi : ${build.stderr}`).toBe(0);
  expect(existsSync(ENTRY), `build absent : ${ENTRY}`).toBe(true);
  DEAD = `http://127.0.0.1:${webPort}`;
  child = spawn('node', [ENTRY], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(webPort),
      STRAPI_URL: closedStrapi,
      REACT_STRAPI_URL: closedStrapi,
      PUBLIC_COOKIE_CONSENT: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => (logs += chunk));
  child.stderr?.on('data', (chunk) => (logs += chunk));
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      await fetch(`${DEAD}/espace/introuvable`);
      break;
    } catch {
      if (Date.now() > deadline) throw new Error(`serveur front sans Strapi non démarré : ${logs}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
});

test.afterAll(async () => {
  if (!child) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 300));
});

const TITLE = 'Un incident empêche d’afficher cette page';
const SECURITY_HEADERS = ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'cache-control'] as const;

test.describe('F-107 : Strapi arrêté, une page de l’espace donne la page d’erreur', () => {
  test('critère 1 : /agenda répond 503 avec le titre, le rappel des e-mails et le lien vers l’accueil de l’édition', async ({ page }) => {
    const response = await page.goto(`${DEAD}${ESPACE}/agenda`);
    expect(response?.status()).toBe(503);
    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
    await expect(page.getByText('e-mails de confirmation')).toContainText('l’heure et la table');
    await expect(page.getByRole('link', { name: 'Retour à l’accueil de l’espace' })).toHaveAttribute('href', `${ESPACE}/`);
  });

  test('le bouton « Réessayer » recharge la page (nouvelle requête vers le serveur)', async ({ page }) => {
    await page.goto(`${DEAD}${ESPACE}/agenda`);
    const reload = page.waitForRequest((request) => request.url().endsWith(`${ESPACE}/agenda`) && request.isNavigationRequest());
    await page.getByRole('button', { name: 'Réessayer' }).click();
    await reload;
    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
  });

  test('critère 1 : aucune trace technique dans la page (pile, chemin, ECONNREFUSED, port de Strapi)', async ({ request }) => {
    const response = await request.get(`${DEAD}${ESPACE}/agenda`);
    const html = await response.text();
    expect(html).not.toMatch(/ECONNREFUSED|fetch failed|TypeError|at .*\(.*:\d+:\d+\)|node_modules|\/dist-e2e\/|stack/i);
    expect(html).not.toContain('127.0.0.1:' + new URL(DEAD).port + '/api');
  });

  test('le HTML de la page d’erreur est propre : le document commence par le doctype puis <html>, sans texte parasite', async ({ request }) => {
    const html = await (await request.get(`${DEAD}${ESPACE}/agenda`)).text();
    expect(html.trimStart()).toMatch(/^<!DOCTYPE html>\s*<html/i);
    expect(html).not.toContain('---');
  });

  test('l’identifiant de requête de 8 caractères est affiché et se retrouve dans le journal du serveur', async ({ page }) => {
    await page.goto(`${DEAD}${ESPACE}/agenda`);
    const text = (await page.getByText('Identifiant de l’incident').textContent()) ?? '';
    const id = text.split(':')[1]?.trim();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    await expect.poll(() => logs, 'journal du serveur').toContain(`"requestId":"${id}"`);
  });

  test('chaque requête en échec porte son propre identifiant', async ({ request }) => {
    const ids = new Set<string>();
    for (let i = 0; i < 2; i++) {
      const html = await (await request.get(`${DEAD}${ESPACE}/agenda`)).text();
      ids.add(html.match(/Identifiant de l’incident : ([0-9a-f]{8})/)?.[1] ?? '');
    }
    expect(ids.has('')).toBe(false);
    expect(ids.size).toBe(2);
  });

  test('la barre d’onglets de l’édition est présente quand l’édition est connue de l’URL', async ({ page }) => {
    await page.goto(`${DEAD}${ESPACE}/agenda`);
    // Le premier lien de la navigation est l'avatar du profil (masqué dès 1024 px) : on cherche l'onglet.
    await expect(page.getByRole('navigation', { name: 'Espace participant' }).getByRole('link', { name: 'Accueil' })).toBeVisible();
  });

  test('sans édition connue (/espace/introuvable réécrit vers l’erreur n’existe pas) : pas de lien d’accueil vers une édition inventée', async ({ page }) => {
    // /espace/verifier appelle Strapi sans édition dans l’URL : la page d’erreur ne propose alors aucun retour à une édition.
    const response = await page.goto(`${DEAD}/espace/verifier?token=jeton`);
    if (response?.status() === 503) {
      await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Retour à l’accueil de l’espace' })).toHaveCount(0);
    } else {
      test.info().annotations.push({ type: 'note', description: `verifier répond ${response?.status()} sans passer par la page d’erreur` });
    }
  });

  test('l’accès direct à /espace/erreur ne fuit rien : statut 500 par défaut, aucun appel à Strapi', async ({ request }) => {
    const response = await request.get(`${DEAD}/espace/erreur`);
    expect(response.status()).toBe(500);
    expect(await response.text()).toContain(TITLE);
  });
});

test.describe('critère 2 : en-têtes de sécurité sur la page d’erreur', () => {
  test('CSP sans origine tierce, nosniff, Referrer-Policy, private no-store (mêmes valeurs que espace-securite.spec.ts)', async ({ request }) => {
    const response = await request.get(`${DEAD}${ESPACE}/agenda`);
    expect(response.status()).toBe(503);
    const headers = response.headers();
    for (const name of SECURITY_HEADERS) expect(headers[name], name).toBeTruthy();
    const csp = headers['content-security-policy'];
    const origins = new Set(csp.match(/https?:\/\/[^\s;]+/g) ?? []);
    expect([...origins].length).toBeLessThanOrEqual(1);
    expect(csp).not.toMatch(/\*|google|matomo|gstatic|cdn/i);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['cache-control']).toBe('private, no-store');
  });

  test('la page d’erreur est noindex et ne sort pas du site (NF-23)', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));
    await page.goto(`${DEAD}${ESPACE}/agenda`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    const outside = requested.filter((url) => new URL(url).origin !== DEAD);
    expect(outside).toEqual([]);
  });
});

test.describe('critère 3 : une page publique en erreur garde son comportement', () => {
  test('page publique avec Strapi arrêté : ni page d’erreur de l’espace, ni en-têtes de sécurité de l’espace', async ({ request }) => {
    const response = await request.get(`${DEAD}/editions`);
    const headers = response.headers();
    expect(headers['content-security-policy']).toBeUndefined();
    expect(headers['x-content-type-options']).toBeUndefined();
    expect(headers['referrer-policy']).toBeUndefined();
    expect(headers['cache-control'] ?? '').not.toMatch(/no-store|private/);
    expect(await response.text()).not.toContain(TITLE);
  });
});

test.describe('F-108 : « Retour à l’accueil de l’espace » sur la page introuvable', () => {
  test('édition inconnue dans l’URL : bouton vers l’accueil de cette édition, plus le lien vers le site', async ({ page }) => {
    const response = await page.goto('/espace/edition-inconnue/connexion');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('link', { name: 'Retour à l’accueil de l’espace' })).toHaveAttribute('href', '/espace/edition-inconnue/');
    await expect(page.getByRole('link', { name: 'Retour au site des Journées' })).toHaveAttribute('href', '/');
  });

  test('accès direct à /espace/introuvable : aucune édition connue, donc pas de bouton d’accueil, lien vers le site seulement', async ({ page }) => {
    const response = await page.goto('/espace/introuvable');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('link', { name: 'Retour à l’accueil de l’espace' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Retour au site des Journées' })).toBeVisible();
  });

  test('l’édition de l’URL est ré-encodée dans le lien (pas d’injection)', async ({ page }) => {
    await page.goto('/espace/%22%3E%3Cb%3Ex/connexion');
    const href = await page.getByRole('link', { name: 'Retour à l’accueil de l’espace' }).getAttribute('href');
    expect(href).toBe('/espace/%22%3E%3Cb%3Ex/');
  });
});
