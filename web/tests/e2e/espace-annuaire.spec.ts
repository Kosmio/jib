import type { BrowserContext, Page } from '@playwright/test';
import { ESPACE, expect, hydrated, openSpace, test } from './espace';

/**
 * Annuaire V4-A (F-45, F-143, F-144, F-145), sur le seed de recette, Léa connectée (sujets : Construction bois, Process, data et IA).
 *
 *   - filtre « Exposants » et recherche « bois » dans l'URL ; ouverture d'une fiche ; retour par le lien de la fiche ou par le navigateur :
 *     mêmes filtres, même liste, même position de défilement ;
 *   - l'URL copiée dans un autre onglet donne la même liste ; un paramètre invalide est ignoré ;
 *   - sujets sur les cartes, sujets communs d'abord (F-143) ;
 *   - le visiteur n'est pas dans sa propre liste (F-144) ;
 *   - échec simulé de la page suivante (page.route) : pages chargées gardées, pas de boucle, « Réessayer » reprend (F-145) ;
 *   - aucun débordement horizontal à 360 px.
 */

const LEA = 'lea.ducasse@example.org';
const SEARCH = /Rechercher un profil/;
const PAGE_ERROR = 'Les profils suivants n’ont pas pu être chargés. Vérifiez votre connexion et réessayez.';

const search = (page: Page) => page.getByRole('searchbox', { name: SEARCH });
const cards = (page: Page) => page.locator('ul[aria-busy] > li');
const names = (page: Page) => cards(page).locator('a').evaluateAll((nodes) => nodes.map((node) => node.querySelector('span.text-ink')?.textContent ?? ''));
// Le compteur de l'annuaire : la zone d'annonce de la coquille (badges, F-132) est aussi un role=status, en tête du document.
const counterOf = (page: Page) => page.locator('#main-content').getByRole('status').first();
const settled = (page: Page) => expect(counterOf(page)).toHaveText(/profils?$/);
const query = (page: Page) => new URL(page.url()).search;

// Strapi limite les liens de connexion à 5 par adresse et par 15 minutes (NF-03) : le premier test ouvre la session, les suivants en reprennent le cookie.
let session: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;

async function openDirectory(page: Page, search = '') {
  if (session) await page.context().addCookies(session);
  else {
    await openSpace(page, LEA);
    session = await page.context().cookies();
  }
  await page.goto(`${ESPACE}/annuaire${search}`);
  await hydrated(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Annuaire');
}

test('F-45 : Exposants + « bois », fiche, retour par le lien : mêmes filtres, même liste', async ({ page }) => {
  await openDirectory(page);
  await page.getByRole('radio', { name: 'Exposants' }).check();
  await search(page).fill('bois');
  await expect(page).toHaveURL(/\?q=bois&type=exhibitor$/);
  await expect(page.getByRole('link', { name: /^Sylvadour/ })).toBeVisible();
  await settled(page);
  const before = await names(page);
  expect(before.length).toBeGreaterThan(0);
  const counter = await counterOf(page).textContent();

  await page.getByRole('link', { name: /^Sylvadour/ }).click();
  await expect(page).toHaveURL(new RegExp(`${ESPACE}/annuaire/x/[^/?]+\\?q=bois&type=exhibitor$`));
  await hydrated(page);
  const back = page.locator('a.font-heading', { hasText: 'Annuaire' });
  await expect(back).toHaveAttribute('href', `${ESPACE}/annuaire?q=bois&type=exhibitor`);
  await back.click();

  await expect(page).toHaveURL(new RegExp(`${ESPACE}/annuaire\\?q=bois&type=exhibitor$`));
  await hydrated(page);
  await expect(page.getByRole('radio', { name: 'Exposants' })).toBeChecked();
  await expect(search(page)).toHaveValue('bois');
  expect(await names(page)).toEqual(before);
  await expect(counterOf(page)).toHaveText(counter ?? '');
});

test('F-45 : retour par le navigateur, mêmes filtres et sujets', async ({ page }) => {
  await openDirectory(page);
  await page.getByRole('radio', { name: 'Exposants' }).check();
  await page.getByRole('checkbox', { name: 'Construction bois' }).check();
  await expect(page).toHaveURL(/\?type=exhibitor&topics=[^&]+$/);
  await expect(cards(page)).toHaveCount(1);
  const url = page.url();
  const before = await names(page);
  await page.getByRole('link', { name: /^Sylvadour/ }).click();
  await expect(page).toHaveURL(/\/annuaire\/x\//);
  await page.goBack();
  await hydrated(page);
  expect(page.url()).toBe(url);
  await expect(page.getByRole('checkbox', { name: 'Construction bois' })).toBeChecked();
  expect(await names(page)).toEqual(before);
});

test('F-45 : les filtres ne remplissent pas l’historique (replaceState)', async ({ page }) => {
  await openDirectory(page);
  const length = await page.evaluate(() => window.history.length);
  await page.getByRole('radio', { name: 'Exposants' }).check();
  await search(page).fill('bois');
  await expect(page).toHaveURL(/\?q=bois&type=exhibitor$/);
  expect(await page.evaluate(() => window.history.length)).toBe(length);
});

test('F-45 : la position de défilement revient avec la fiche (360 x 480)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 480 });
  await openDirectory(page);
  const target = cards(page).nth(10);
  // Position relevée au clic même (le bandeau collant peut obliger Playwright à décaler la carte avant de cliquer).
  await page.evaluate(() => window.addEventListener('click', () => sessionStorage.setItem('test-y', String(Math.round(window.scrollY))), true));
  await target.scrollIntoViewIfNeeded();
  const name = (await names(page))[10];
  await target.locator('a').click();
  await expect(page).toHaveURL(/\/annuaire\/[a-z]\//);
  const y = Number(await page.evaluate(() => sessionStorage.getItem('test-y')));
  expect(y).toBeGreaterThan(300);
  await page.locator('a.font-heading', { hasText: 'Annuaire' }).click();
  await expect(page).toHaveURL(new RegExp(`${ESPACE}/annuaire$`));
  await hydrated(page);
  await expect.poll(() => page.evaluate(() => window.scrollY), { message: 'position de défilement rétablie' }).toBeGreaterThanOrEqual(y - 2);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(y + 2);
  expect((await names(page))[10]).toBe(name);
});

test('F-45 : une arrivée sans position retenue ouvre l’annuaire en haut', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 480 });
  await openDirectory(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('F-45 : l’URL copiée dans un autre onglet donne la même liste', async ({ page, context }) => {
  await openDirectory(page);
  await page.getByRole('radio', { name: 'Exposants' }).check();
  await page.getByRole('checkbox', { name: 'Construction bois' }).check();
  await search(page).fill('bois');
  await expect(page).toHaveURL(/\?q=bois&type=exhibitor&topics=[^&]+$/);
  await expect(page.getByRole('link', { name: /^Sylvadour/ })).toBeVisible();
  const url = page.url();
  await settled(page);
  const names1 = await names(page);
  const counter = await counterOf(page).textContent();

  const other = await context.newPage();
  await other.goto(url);
  await hydrated(other);
  expect(await names(other)).toEqual(names1);
  await expect(counterOf(other)).toHaveText(counter ?? '');
  await expect(other.getByRole('radio', { name: 'Exposants' })).toBeChecked();
  await expect(other.getByRole('checkbox', { name: 'Construction bois' })).toBeChecked();
  await expect(search(other)).toHaveValue('bois');
  expect(other.url()).toBe(url);
});

test('F-45 : un paramètre invalide est ignoré (type inconnu, sujet inconnu), sans erreur', async ({ page }) => {
  await openDirectory(page, '?type=inconnu&topics=zzz');
  await expect(page.getByRole('radio', { name: 'Tous' })).toBeChecked();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await cards(page).count()).toBeGreaterThan(5);
  await expect.poll(() => query(page), { message: 'URL ramenée aux filtres valides' }).toBe('');
});

test('F-45 : un type valide et un sujet inconnu : le type seul reste', async ({ page }) => {
  await openDirectory(page, '?type=speaker&topics=zzz');
  await expect(page.getByRole('radio', { name: 'Intervenants' })).toBeChecked();
  await expect(page.getByText('2 profils', { exact: true })).toBeVisible();
  await expect.poll(() => query(page)).toBe('?type=speaker');
});

test('F-45 : « Effacer les filtres » vide l’URL', async ({ page }) => {
  await openDirectory(page, '?q=zzzzz&type=exhibitor');
  await page.getByRole('button', { name: 'Effacer les filtres' }).click();
  await expect.poll(() => query(page)).toBe('');
  await expect(page.getByRole('radio', { name: 'Tous' })).toBeChecked();
});

test('F-143 : sujets sur les cartes, les sujets communs d’abord, annoncés par un mot', async ({ page }) => {
  await openDirectory(page);
  // Inès : Construction bois (commun avec Léa) et Territoires résilients.
  const ines = cards(page).filter({ hasText: 'Inès Castaing' });
  await expect(ines).toHaveCount(1);
  await expect(ines).toContainText('Sujets :');
  await expect(ines).toContainText('En commun :');
  const text = (await ines.textContent()) ?? '';
  expect(text.indexOf('Construction bois')).toBeGreaterThan(text.indexOf('En commun'));
  expect(text.indexOf('Territoires résilients')).toBeGreaterThan(text.indexOf('Construction bois'));
  // Hugo : Forêt et adaptation, Territoires résilients, rien en commun.
  const hugo = cards(page).filter({ hasText: 'Hugo Peyrat' });
  await expect(hugo).toContainText('Forêt et adaptation');
  await expect(hugo).not.toContainText('En commun');
});

test('F-144 : Léa n’est pas dans sa propre liste, ni en la cherchant par son nom', async ({ page }) => {
  await openDirectory(page);
  await expect(cards(page).filter({ hasText: 'Léa Ducasse' })).toHaveCount(0);
  await search(page).fill('Ducasse');
  await expect(page.getByText('Aucun profil ne correspond. Essayez un autre sujet ou effacez la recherche.')).toBeVisible();
  await expect(cards(page).filter({ hasText: 'Léa Ducasse' })).toHaveCount(0);
});

test('F-145 : échec de la page suivante, pages gardées, pas de boucle, « Réessayer » reprend la page manquante', async ({ page }) => {
  test.setTimeout(90_000);
  await openDirectory(page);
  const real = (await names(page)).length;
  expect(real).toBeGreaterThan(5);

  let withoutCursor = 0;
  let withCursor = 0;
  let failuresLeft = 2;
  await page.route('**/api/espace/directory?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('cursor')) {
      withCursor += 1;
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        return route.abort('failed');
      }
      const response = await route.fetch({ url: route.request().url().replace(/&?cursor=[^&]*/, '') });
      const body = await response.json();
      const items = body.items.slice(0, 3).map((item: { id: string }, index: number) => ({ ...item, id: `${item.id}-p2-${index}` }));
      return route.fulfill({ response, json: { items, nextCursor: null, total: 33 } });
    }
    withoutCursor += 1;
    const response = await route.fetch();
    const body = await response.json();
    // Trente cartes sur la première page et un curseur : la page 2 est celle qui échoue.
    const items = Array.from({ length: 30 }, (_, index) => ({ ...body.items[index % body.items.length], id: `${body.items[index % body.items.length].id}-p1-${index}` }));
    return route.fulfill({ response, json: { items, nextCursor: 'page2', total: 33 } });
  });

  // Un changement de filtre relance la liste par le client : c'est la première réponse simulée.
  await page.getByRole('radio', { name: 'Participants' }).check();
  await expect(cards(page)).toHaveCount(30);
  expect(withoutCursor).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Réessayer' }).or(page.getByRole('alert')).first().waitFor({ state: 'visible', timeout: 15_000 }).catch(async () => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  });
  const alert = page.getByRole('alert');
  await expect(alert).toContainText(PAGE_ERROR);
  await expect(cards(page)).toHaveCount(30);

  // Pas de boucle : le défilement ne relance pas la demande tant qu'on n'a pas cliqué.
  const seen = withCursor;
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);
  expect(withCursor).toBe(seen);
  await expect(alert).toBeVisible();

  // Première reprise : échoue encore, le message reste, les 30 cartes aussi.
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await expect.poll(() => withCursor).toBe(seen + 1);
  await expect(alert).toContainText(PAGE_ERROR);
  await expect(cards(page)).toHaveCount(30);

  // Seconde reprise : la page manquante arrive, à la suite des 30.
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await expect(cards(page)).toHaveCount(33);
  await expect(alert).toHaveCount(0);
  expect(withCursor).toBe(seen + 2);
});

test('NF-36 : aucun débordement horizontal à 360 px, liste, sujets et fiche', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openDirectory(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow(), 'liste').toBeLessThanOrEqual(0);
  await page.getByRole('checkbox', { name: 'Construction bois' }).check();
  expect(await overflow(), 'liste filtrée').toBeLessThanOrEqual(0);
  await page.getByRole('link', { name: /^Sylvadour/ }).click();
  await hydrated(page);
  expect(await overflow(), 'fiche').toBeLessThanOrEqual(0);
});

test('F-143 : la rangée de sujets défile horizontalement à 360 px, sans faire défiler la page', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openDirectory(page);
  const row = page.getByRole('checkbox', { name: 'Construction bois' }).locator('xpath=ancestor::div[contains(@class,"overflow-x-auto")][1]');
  const sizes = await row.evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }));
  expect(sizes.scroll).toBeGreaterThan(sizes.client);
  // Indice de défilement : un masque en fondu tant qu'il reste des sujets à découvrir.
  expect(await row.evaluate((node) => getComputedStyle(node).maskImage)).toContain('linear-gradient');
  await row.evaluate((node) => node.scrollTo(node.scrollWidth, 0));
  await expect.poll(() => row.evaluate((node) => getComputedStyle(node).maskImage)).toBe('none');
});
