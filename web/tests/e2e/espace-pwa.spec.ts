import { ESPACE, expect, test } from './espace';

/**
 * Application installable (commit 14072b8 ; F-05, NF-24, T-45 réduits) : manifeste de l'édition, icônes, service worker de `/espace/`
 * qui ne garde ni pages ni réponses d'API et ne sert qu'une page « hors connexion ». L'installation sur Android et iOS (T-45) reste à
 * faire à la main.
 *
 * Les autres tests bloquent les service workers (web/playwright.config.ts) : celui-ci les autorise.
 */

test.use({ serviceWorkers: 'allow' });

const STATIC_CACHE = 'jib-espace-v2-statique';

async function cachedPaths(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const result: Record<string, string[]> = {};
    for (const name of await caches.keys()) result[name] = (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname);
    return result;
  });
}

test('manifeste de l’édition et icônes (F-05, NF-24)', async ({ page }) => {
  await page.goto(`${ESPACE}/connexion`);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', `${ESPACE}/manifest.webmanifest`);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/assets/favicon-192.png');

  const response = await page.request.get(`${ESPACE}/manifest.webmanifest`);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/manifest+json');
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    id: `${ESPACE}/`,
    start_url: `${ESPACE}/`,
    scope: '/espace/',
    display: 'standalone',
    lang: 'fr',
    short_name: 'JIB',
  });
  expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  expect(manifest.icons.map((icon: { sizes: string; purpose: string }) => `${icon.sizes} ${icon.purpose}`).sort()).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
  for (const icon of manifest.icons) {
    const file = await page.request.get(icon.src);
    expect(file.status(), icon.src).toBe(200);
    expect(file.headers()['content-type'], icon.src).toContain('image/png');
  }
});

test('icône maskable 512 px : entrée du manifeste et fichier PNG de 512 x 512 servi (F-130)', async ({ page }) => {
  const manifest = await (await page.request.get(`${ESPACE}/manifest.webmanifest`)).json();
  const maskable = manifest.icons.filter((icon: { purpose: string }) => icon.purpose === 'maskable');
  expect(maskable).toHaveLength(1);
  expect(maskable[0]).toMatchObject({ src: '/espace/icon-maskable-512.png', sizes: '512x512', type: 'image/png' });

  const file = await page.request.get(maskable[0].src);
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toContain('image/png');
  const png = await file.body();
  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  expect([png.readUInt32BE(16), png.readUInt32BE(20)], 'dimensions du PNG').toEqual([512, 512]);
});

test('balise theme-color dans la mise en page, sur les pages de l’édition et sur la vérification du lien (F-130)', async ({ page }) => {
  for (const path of [`${ESPACE}/connexion`, `${ESPACE}/programme`, '/espace/verifier?token=jeton-inconnu']) {
    await page.goto(path);
    const meta = page.locator('meta[name="theme-color"]');
    await expect(meta, path).toHaveCount(1);
    await expect(meta, path).toHaveAttribute('content', /^#[0-9a-f]{6}$/i);
  }
});

test('une édition inconnue n’a pas de manifeste : 404', async ({ page }) => {
  expect((await page.request.get('/espace/edition-inconnue/manifest.webmanifest')).status()).toBe(404);
});

test('service worker de /espace/ : portée, aucun cache de page ni d’API, page hors connexion (NF-24)', async ({ page, baseURL }) => {
  await page.goto(`${ESPACE}/connexion`);
  const worker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return { scope: registration.scope, script: registration.active?.scriptURL };
  });
  expect(worker.scope).toBe(`${baseURL}/espace/`);
  expect(worker.script).toBe(`${baseURL}/espace/sw.js`);

  // Visiter des pages hors des quatre pages gardées (connexion, vérification) ne remplit aucun cache de page ni d'API : seul le cache
  // statique existe (page hors connexion, feuilles, polices, icônes), et aucun cache d'édition.
  await page.goto(`${ESPACE}/connexion?erreur=email`);
  await page.goto('/espace/verifier?token=jeton-inconnu');
  const cached = await cachedPaths(page);
  expect(Object.keys(cached)).toEqual([STATIC_CACHE]);
  expect(cached[STATIC_CACHE]).toContain('/espace/hors-ligne.html');
  for (const path of cached[STATIC_CACHE]) expect(path, 'entrée du cache statique').toMatch(/^(\/espace\/hors-ligne\.html|\/_astro\/|\/fonts\/|\/assets\/favicon-192\.png|\/favicon\.png|\/espace\/icon-)/);

  // Le site public n'est pas dans la portée.
  expect((await page.request.get('/espace/sw.js')).headers()['content-type']).toMatch(/javascript/);
});

test('sans réseau, une navigation dans l’espace affiche la page « hors connexion »', async ({ page, context }) => {
  await page.goto(`${ESPACE}/connexion`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Une première navigation sous le contrôle du service worker (il prend la main dès l'activation, clients.claim).
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  try {
    await page.goto(`${ESPACE}/connexion`).catch(() => null);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vous êtes hors connexion');
  } finally {
    await context.setOffline(false);
  }
});
