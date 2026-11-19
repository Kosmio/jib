import { expect, test, type Page } from '@playwright/test';

/**
 * Non-régression visuelle des pages publiques (phase 0, lot A ; porte de la phase 0, NF-40).
 *
 * Quatre références : 2 pages x 2 largeurs, page entière, Chromium, macOS.
 * Prérequis (voir docs/espace/CLAUDE.md) : Strapi sur strapi_espace (port 1337) et
 * front construit puis servi par `preview` (port 4321). Le serveur `dev` est refusé :
 * sa barre d'outils apparaîtrait dans les captures.
 *
 * Les dates affichées par le site dépendent du fuseau du serveur du front : lancer
 * `preview` avec le fuseau de la machine (Europe/Paris), comme pour la prise des références.
 */

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

const PAGES = [
  { name: 'accueil', path: '/' },
  { name: 'edition-nouvelle-aquitaine', path: '/editions/nouvelle-aquitaine' },
] as const;

/**
 * Tolérance : au plus 0,01 % des pixels de la page peuvent différer (soit 270 à 640
 * pixels selon la page), chaque pixel étant comparé avec le seuil colorimétrique par
 * défaut de Playwright (0,2). Le bruit mesuré sur cette machine est de 0 pixel ; la marge
 * ne couvre que l'anti-crénelage. Calibrage : repeindre en rouge les liens du pied de page
 * (environ 1 130 pixels) fait échouer les quatre captures, un seuil de 0,1 % les laisserait passer.
 */
const MAX_DIFF_PIXEL_RATIO = 0.0001;

/**
 * Éléments masqués (ce qui varie sans que le code change) :
 * - la ligne de droits d'auteur du pied de page, dont l'année est celle de l'horloge.
 */
const masks = (page: Page) => [page.locator('footer p', { hasText: '©' })];

/** Attend que la page ait fini de se peindre et échoue clairement si l'environnement est incomplet. */
async function settle(page: Page) {
  // Les images différées ne chargent qu'au défilement : les charger toutes avant la capture.
  await page.evaluate(() => {
    document.querySelectorAll('img[loading="lazy"]').forEach((img) => img.setAttribute('loading', 'eager'));
  });
  await page.waitForLoadState('networkidle');

  const state = await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images).map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
            }),
      ),
    );
    const faces = Array.from(document.fonts);
    return {
      brokenImages: Array.from(document.images)
        .filter((img) => img.naturalWidth === 0)
        .map((img) => img.currentSrc || img.src),
      fontsInError: faces.filter((f) => f.status === 'error').map((f) => f.family),
      bodyFontLoaded: faces.some((f) => f.family.includes('Source Sans 3') && f.status === 'loaded'),
      displayFontLoaded: faces.some((f) => f.family.includes('Azonix') && f.status === 'loaded'),
    };
  });

  expect(state.brokenImages, 'images non chargées : Strapi (port 1337) est-il lancé sur strapi_espace ?').toEqual([]);
  expect(state.fontsInError, 'polices en erreur').toEqual([]);
  expect(state.bodyFontLoaded, 'police Source Sans 3 absente : les polices Google sont-elles joignables (Q-14) ?').toBe(true);
  expect(state.displayFontLoaded, 'police Azonix absente').toBe(true);
}

test.beforeAll(async () => {
  const strapiReachable = await fetch('http://localhost:1337/api/editions?pagination[pageSize]=1').then(
    (res) => res.ok,
    () => false,
  );
  expect(strapiReachable, 'Strapi injoignable sur http://localhost:1337 : le lancer sur strapi_espace').toBe(true);
});

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const { name, path } of PAGES) {
      test(`${name}`, async ({ page }) => {
        const response = await page.goto(path, { waitUntil: 'load' });
        expect(response?.status(), `${path} doit répondre 200`).toBe(200);

        const html = (await response?.text()) ?? '';
        expect(html, 'le front doit être construit (build puis preview), pas lancé en dev').not.toContain('/@vite/client');

        await settle(page);

        await expect(page).toHaveScreenshot(`${name}-${viewport.name}.png`, {
          fullPage: true,
          animations: 'disabled',
          caret: 'hide',
          mask: masks(page),
          maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
        });
      });
    }
  });
}
