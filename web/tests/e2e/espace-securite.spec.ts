import { ESPACE, expect, test } from './espace';
import { STRAPI_URL } from './fixtures';

/**
 * Sobriété et sécurité des pages de l'espace (lot 7, critère 4 du lot 6) : en-têtes de NF-07 sous /espace seulement, A-24 sur la
 * vérification, noindex, aucune requête sortante (polices Google comprises, NF-23), sitemap sans /espace/.
 * Les en-têtes se lisent sur de vraies réponses du front construit, pas sur le middleware isolé (unit/web-middleware.test.js).
 */

const ESPACE_PAGES: { path: string; label: string; referrer: string; redirect?: boolean }[] = [
  { path: `${ESPACE}/connexion`, label: 'E0', referrer: 'strict-origin-when-cross-origin' },
  { path: `${ESPACE}/connexion?envoye=1`, label: 'E0 envoyé', referrer: 'strict-origin-when-cross-origin' },
  { path: '/espace/verifier?token=jeton-inconnu', label: 'vérification', referrer: 'strict-origin' },
  { path: `${ESPACE}/`, label: 'E1 sans session, la redirection elle-même', referrer: 'strict-origin-when-cross-origin', redirect: true },
  { path: '/espace/edition-inconnue/connexion', label: '404 de l’espace', referrer: 'strict-origin-when-cross-origin' },
];

const PUBLIC_PAGES = ['/', '/editions', '/editions/nouvelle-aquitaine-test', '/contact', '/a-propos', '/page-inexistante'];

test.describe('NF-07 : en-têtes de sécurité sur /espace', () => {
  for (const { path, label, referrer, redirect } of ESPACE_PAGES) {
    test(`${label} : CSP sans origine tierce, nosniff, Referrer-Policy ${referrer}, jamais en cache`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(redirect ? 302 : path.includes('edition-inconnue') ? 404 : 200);
      const headers = response.headers();

      const csp = headers['content-security-policy'];
      expect(csp, 'Content-Security-Policy').toBeTruthy();
      // Les seules origines nommées sont celles de Strapi (formulaires et îlot d'E2) ; rien de tiers, aucun joker.
      const origins = new Set(csp.match(/https?:\/\/[^\s;]+/g) ?? []);
      expect([...origins]).toEqual([new URL(STRAPI_URL).origin]);
      expect(csp).not.toMatch(/\*|google|matomo|gstatic|cdn/i);
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain(`form-action 'self' ${new URL(STRAPI_URL).origin}`);

      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['referrer-policy']).toBe(referrer);
      expect(headers['cache-control']).toBe('private, no-store');
    });
  }

  test('le Referrer-Policy n’est jamais no-referrer : le POST du formulaire garde son Origin (A-24)', async ({ request }) => {
    for (const { path } of ESPACE_PAGES) {
      expect((await request.get(path, { maxRedirects: 0 })).headers()['referrer-policy'], path).not.toMatch(/no-referrer$/);
    }
  });
});

test.describe('NF-07 : aucun de ces en-têtes sur le site public', () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path}`, async ({ request }) => {
      const headers = (await request.get(path)).headers();
      expect(headers['content-security-policy'], 'Content-Security-Policy').toBeUndefined();
      expect(headers['x-content-type-options'], 'X-Content-Type-Options').toBeUndefined();
      expect(headers['referrer-policy'], 'Referrer-Policy').toBeUndefined();
      expect(headers['cache-control'] ?? '', 'Cache-Control').not.toMatch(/no-store|private/);
    });
  }
});

test.describe('pages privées : noindex, aucune requête sortante (NF-23)', () => {
  for (const { path, label } of ESPACE_PAGES.filter(({ redirect }) => !redirect)) {
    test(`${label} : noindex et uniquement des ressources locales`, async ({ page, network }) => {
      const requested: string[] = [];
      page.on('request', (request) => requested.push(request.url()));

      await page.goto(path);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
      const web = new URL(page.url()).origin;
      const outside = requested.filter((url) => ![web, new URL(STRAPI_URL).origin].includes(new URL(url).origin));
      expect(outside, 'requêtes hors du site et de Strapi').toEqual([]);
      expect(network.blockedHosts, 'requêtes coupées par le réseau fermé des tests').toEqual([]);
      expect(requested.filter((url) => /matomo|google|gstatic|analytics/i.test(url))).toEqual([]);
    });
  }

  test('les polices viennent du site (Q-14) : aucune feuille ni fonte Google, fonte locale préchargée', async ({ page }) => {
    const fonts: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'font') fonts.push(request.url());
    });
    await page.goto(`${ESPACE}/connexion`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]')).toHaveCount(0);
    await expect(page.locator('link[rel="preload"][as="font"]')).toHaveAttribute('href', /^\/fonts\/.*\.woff2$/);
    expect(fonts.length, 'fontes demandées').toBeGreaterThan(0);
    // Sora et Source Sans 3 en woff2, plus l'Azonix du site (app.css) : toutes servies par /fonts/.
    for (const url of fonts) expect(new URL(url).pathname, url).toMatch(/^\/fonts\//);
  });
});

test.describe('sitemap', () => {
  test('exclut /espace/ et garde les pages publiques', async ({ request }) => {
    const index = await request.get('/sitemap-index.xml');
    expect(index.status()).toBe(200);
    const sitemaps = [...(await index.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname);
    expect(sitemaps.length).toBeGreaterThan(0);

    const urls: string[] = [];
    for (const path of sitemaps) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      urls.push(...[...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]));
    }
    expect(urls.length, 'URL du sitemap').toBeGreaterThan(0);
    expect(urls.filter((url) => new URL(url).pathname.startsWith('/espace'))).toEqual([]);
    expect(urls.some((url) => new URL(url).pathname === '/contact/')).toBe(true);
  });
});
