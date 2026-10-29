import { expect, STRAPI_URL, test } from './fixtures';

/**
 * Test de fumée de bout en bout (phase 0, lot C, C3, A-14).
 *
 * Prérequis, assurés par le `webServer` de playwright.config.ts : Strapi sur strapi_e2e avec le seed de
 * recette (édition « Nouvelle-Aquitaine (test) »), front construit et branché sur ce Strapi.
 * Aucun e-mail, aucun appel hors localhost (voir fixtures.ts).
 */

const EDITION_TITLE = 'Nouvelle-Aquitaine (test)';
const EDITION_PATH = '/editions/nouvelle-aquitaine-test';

const PROGRAMME = [
  'Accueil et ouverture',
  'Forêt et adaptation',
  'Pause et B2B',
  'Process, data et IA',
  'Cocktail déjeunatoire & B2B',
  'Économie circulaire',
  'Territoires résilients',
  'Pause et B2B',
  'Construction bois',
];

test.describe('API de l’espace', () => {
  test('GET /api/espace/health répond 200 {"status":"ok"}', async ({ request }) => {
    const response = await request.get(`${STRAPI_URL}/api/espace/health`);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  test('POST /api/espace/health répond 405', async ({ request }) => {
    const response = await request.post(`${STRAPI_URL}/api/espace/health`, { data: {} });
    expect(response.status()).toBe(405);
  });

  test('aucune route CRUD n’est servie sous /api/espace', async ({ request }) => {
    for (const path of ['/api/espace', '/api/espace/attendees', '/api/espace/editions']) {
      expect((await request.get(`${STRAPI_URL}${path}`)).status(), path).toBe(404);
    }
  });
});

test.describe('pages publiques avec l’édition de recette', () => {
  test('l’accueil s’affiche et présente l’édition de recette', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Journées de l.Innovation Filière Bois/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Journée de l.Innovation de la Filière Bois/);

    const card = page.getByRole('link', { name: new RegExp(EDITION_TITLE.replace(/[()]/g, '\\$&')) }).first();
    await expect(card).toBeVisible();
    await expect(card).toContainText(/3 décembre 2026\s+\S+\s+Bordeaux/);
  });

  test('la liste des éditions contient l’édition de recette', async ({ page }) => {
    const response = await page.goto('/editions');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('link', { name: new RegExp(EDITION_TITLE.replace(/[()]/g, '\\$&')) }).first()).toBeVisible();
  });

  test('de l’accueil à la page d’édition : programme complet, lieu et intervenants du seed', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: new RegExp(EDITION_TITLE.replace(/[()]/g, '\\$&')) }).first().click();
    await expect(page).toHaveURL(new RegExp(`${EDITION_PATH}$`));
    await expect(page.getByRole('heading', { level: 1, name: EDITION_TITLE })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Programme' })).toBeVisible();
    for (const title of new Set(PROGRAMME)) {
      const expected = PROGRAMME.filter((t) => t === title).length;
      await expect(page.getByRole('heading', { name: title, exact: true }), title).toHaveCount(expected);
    }

    await expect(page.getByText('Salle de recette (lieu fictif)')).toBeVisible();
    await expect(page.getByRole('link', { name: /Hélène Marquès/ }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Antoine Vergnes/ }).first()).toBeVisible();
  });

  test('la fiche d’un intervenant du seed s’ouvre depuis la page d’édition', async ({ page }) => {
    await page.goto(EDITION_PATH);
    await page.getByRole('link', { name: /Hélène Marquès/ }).first().click();
    await expect(page).toHaveURL(/\/intervenants\/test-helene-marques$/);
    await expect(page.getByRole('heading', { name: 'Hélène Marquès' })).toBeVisible();
  });

  test('la fiche d’une organisation du seed s’ouvre', async ({ page }) => {
    const response = await page.goto('/organisations/test-institut-lignea');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Institut Lignéa' })).toBeVisible();
  });

  test('une page inconnue affiche la page 404', async ({ page }) => {
    const response = await page.goto('/page-inexistante');
    expect(response?.status()).toBe(404);
  });

  test('une édition inconnue renvoie vers la page 404', async ({ page }) => {
    const response = await page.goto('/editions/edition-inconnue');
    expect(page.url()).toMatch(/\/404$/);
    expect(response?.status()).toBe(404);
  });
});
