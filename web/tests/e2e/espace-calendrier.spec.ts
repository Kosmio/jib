import type { Page } from '@playwright/test';
import { ESPACE, expect, hydrated, openSpace, test, watchConsole } from './espace';

/**
 * Abonnement calendrier dans l'agenda, lot V5-E (I-42) : Léa Ducasse crée son abonnement, lit l'adresse affichée une seule fois, la copie,
 * en lit le flux, le régénère puis le révoque. Les tests se suivent (mode `serial`) sur le seed de recette.
 *
 * L'adresse affichée est en `webcal://` ; le test la relit en `http://` (même chemin) avec le client HTTP de Playwright.
 */

test.describe.configure({ mode: 'serial' });

const LEA = 'lea.ducasse@example.org';
const FEED_URL = /^webcal:\/\/[^/]+\/api\/espace\/calendar\/[A-Za-z0-9_-]{43}\.ics$/;

async function openAgenda(page: Page) {
  await openSpace(page, LEA);
  if (page.url().endsWith('/bienvenue')) {
    await hydrated(page);
    // Retour de recette du 18/11 : au moins un sujet à l’arrivée.
    if (!(await page.locator('input[id^="sujet-"]:checked').count()) && (await page.locator('input[id^="sujet-"]').count())) await page.locator('input[id^="sujet-"]').first().check();
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('button', { name: 'Continuer sans apparaître' }).click();
    await expect(page).toHaveURL(new RegExp(`${ESPACE}/$`));
  }
  await page.goto(`${ESPACE}/agenda`);
  await hydrated(page);
}

const httpUrl = (webcal: string) => webcal.replace(/^webcal:/, 'http:');
const feedField = (page: Page) => page.getByLabel('Adresse de l’abonnement');
let firstUrl = '';
let secondUrl = '';

test('« Afficher l’adresse de l’abonnement » affiche l’adresse webcal une seule fois, avec « Copier »', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const console_ = watchConsole(page);
  await openAgenda(page);
  await expect(page.getByRole('heading', { name: 'Agenda dans mon calendrier' })).toBeVisible();
  await expect(feedField(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Afficher l’adresse de l’abonnement' }).click();
  await expect(feedField(page)).toBeVisible();
  firstUrl = await feedField(page).inputValue();
  expect(firstUrl).toMatch(FEED_URL);
  await expect(page.getByRole('status').filter({ hasText: 'elle ne sera plus affichée' })).toBeVisible();

  await page.getByRole('button', { name: 'Copier' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Adresse copiée' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(firstUrl);

  // Rechargée, la page n'affiche plus l'adresse : le serveur n'en garde que l'empreinte.
  await page.reload();
  await hydrated(page);
  await expect(feedField(page)).toHaveCount(0);
  console_.expectClean();
});

test('l’adresse affichée sert un calendrier .ics à qui la connaît, sans session', async ({ playwright }) => {
  const anonymous = await playwright.request.newContext();
  const response = await anonymous.get(httpUrl(firstUrl));
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^text\/calendar/);
  expect(await response.text()).toContain('BEGIN:VCALENDAR');
  await anonymous.dispose();
});

test('« S’abonner » de nouveau remplace l’abonnement : l’ancienne adresse répond 404, la nouvelle 200', async ({ page, playwright }) => {
  await openAgenda(page);
  await page.getByRole('button', { name: 'Afficher l’adresse de l’abonnement' }).click();
  await expect(feedField(page)).toBeVisible();
  secondUrl = await feedField(page).inputValue();
  expect(secondUrl).toMatch(FEED_URL);
  expect(secondUrl).not.toBe(firstUrl);

  const anonymous = await playwright.request.newContext();
  expect((await anonymous.get(httpUrl(firstUrl))).status()).toBe(404);
  expect((await anonymous.get(httpUrl(secondUrl))).status()).toBe(200);
  await anonymous.dispose();
});

test('« Révoquer » masque l’adresse et le flux répond 404', async ({ page, playwright }) => {
  await openAgenda(page);
  await page.getByRole('button', { name: 'Afficher l’adresse de l’abonnement' }).click();
  await expect(feedField(page)).toBeVisible();
  const url = await feedField(page).inputValue();

  await page.getByRole('button', { name: 'Révoquer' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'L’abonnement est révoqué' })).toBeVisible();
  await expect(feedField(page)).toHaveCount(0);

  const anonymous = await playwright.request.newContext();
  const response = await anonymous.get(httpUrl(url));
  expect(response.status()).toBe(404);
  expect((await response.json()).error.code).toBe('FEED_NOT_FOUND');
  await anonymous.dispose();
});
