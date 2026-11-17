import { readFileSync } from 'node:fs';
import type { BrowserContext, Download, Page } from '@playwright/test';
import { STRAPI_URL } from './fixtures';
import { EDITION, ESPACE, expect, hydrated, openSpace, test, watchConsole } from './espace';

/**
 * Pilotage de l'édition, lot V4-D2 (F-97, F-98) : carte « Badges » (types, tri, compte rendu, téléchargement du PDF), badge à l'unité et
 * « Régénérer le jeton » dans la fiche d'un inscrit.
 *
 * Le PDF est reçu comme téléchargement (jamais ouvert dans l'onglet) ; son nombre de pages est lu dans le fichier reçu (`/Type /Page`), le
 * jeton du QR dans l'annotation /URI. Les comptes attendus viennent de l'API de liste des inscrits, pas de valeurs écrites en dur.
 * Données : le seed de recette. Le test de régénération change le jeton de Clara Dubourdieu (base e2e vidée à la suite suivante).
 */

const ORGANIZER = 'organisation@example.org';
const ADMIN = `${STRAPI_URL}/api/espace/admin/${EDITION}`;
const BADGES_URL = `**/api/espace/admin/${EDITION}/badges`;
const FAILED = 'Les badges n’ont pas pu être générés. Vérifiez votre connexion et réessayez.';
const TYPES = ['Participant', 'Intervenant', 'Représentant d’exposant', 'Organisateur'];

test.describe.configure({ mode: 'serial' });

let session: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;

async function openPilotage(page: Page, baseURL: string | undefined) {
  if (session) {
    await page.context().addCookies(session);
  } else {
    await openSpace(page, ORGANIZER);
    if (page.url().endsWith('/bienvenue')) {
      await hydrated(page);
      await page.getByRole('button', { name: 'Continuer' }).click();
      await page.getByRole('button', { name: 'Continuer sans apparaître' }).click();
      await expect(page).toHaveURL(`${baseURL}${ESPACE}/`);
    }
    session = await page.context().cookies();
  }
  await page.goto(`${ESPACE}/organisateur`);
  await hydrated(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pilotage de l’édition');
}

const typeBox = (page: Page, name: string) => page.getByRole('group', { name: 'Types de badges' }).getByLabel(name);
const generate = (page: Page) => page.getByRole('button', { name: 'Générer les badges' });
/** Le pilotage compte deux champs « Tri » (Participants et Badges) : celui de la carte Badges est ciblé par son identifiant. */
const sortSelect = (page: Page) => page.locator('#badges-tri');

/** Fichier reçu : contenu latin1 du PDF. */
async function readDownload(download: Download): Promise<string> {
  const path = await download.path();
  const text = readFileSync(path).toString('latin1');
  expect(text.startsWith('%PDF-'), 'PDF valide').toBe(true);
  expect(text.trimEnd().endsWith('%%EOF'), 'PDF terminé').toBe(true);
  return text;
}
const pageCount = (pdf: string) => (pdf.match(/\/Type \/Page(?![s\w])/g) ?? []).length;

async function activeCount(page: Page, role = ''): Promise<number> {
  const response = await page.context().request.get(`${ADMIN}/attendees?status=active&pageSize=1${role ? `&role=${role}` : ''}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { total: number }).total;
}

async function sheetOf(page: Page, name: string) {
  await page.getByLabel('Rechercher un inscrit').fill(name);
  await page.getByRole('button', { name: `Ouvrir la fiche de ${name}` }).click();
  await expect(page.getByRole('heading', { level: 3, name })).toBeVisible();
  return page.locator('[data-attendee-actions]');
}

test.describe('carte « Badges » (F-97)', () => {
  test('la carte propose quatre types cochés, un tri « Par nom » et le bouton de génération', async ({ page, baseURL }) => {
    await openPilotage(page, baseURL);
    await expect(page.getByRole('heading', { level: 2, name: 'Badges' })).toBeVisible();
    const group = page.getByRole('group', { name: 'Types de badges' });
    await expect(group.getByRole('checkbox')).toHaveCount(4);
    for (const name of TYPES) await expect(typeBox(page, name)).toBeChecked();
    await expect(sortSelect(page)).toHaveValue('name');
    await expect(sortSelect(page).locator('option')).toHaveText(['Par nom', 'Par entreprise']);
    await expect(generate(page)).toBeEnabled();
  });

  test('tous les types, tri par nom : téléchargement badges-<slug>-<date>.pdf, une page par badge, compte rendu et X-Badges-Count égaux', async ({ page, baseURL }) => {
    const watch = watchConsole(page);
    await openPilotage(page, baseURL);
    const total = await activeCount(page);
    expect(total).toBeGreaterThan(0);

    const downloadPromise = page.waitForEvent('download');
    const responsePromise = page.waitForResponse((response) => response.url().endsWith(`/admin/${EDITION}/badges`) && response.request().method() === 'POST');
    await generate(page).click();
    const download = await downloadPromise;
    const response = await responsePromise;

    expect(download.suggestedFilename()).toMatch(new RegExp(`^badges-${EDITION}-\\d{4}-\\d{2}-\\d{2}\\.pdf$`));
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('application/pdf');
    expect(response.headers()['content-disposition']).toMatch(/^attachment/);
    const headerCount = Number(response.headers()['x-badges-count']);
    const headerReduced = Number(response.headers()['x-badges-reduced']);
    expect(headerCount).toBe(total);
    expect(headerReduced).toBeLessThanOrEqual(headerCount);

    const pdf = await readDownload(download);
    expect(pageCount(pdf)).toBe(headerCount);

    const status = page.getByRole('status').filter({ hasText: /badges?, dont/ });
    const badgeWord = headerCount === 1 ? 'badge' : 'badges';
    await expect(status).toHaveText(`${headerCount} ${badgeWord}, dont ${headerReduced} en carte réduite (profil masqué).`);
    await expect(page.getByRole('alert')).toHaveCount(0);
    watch.expectClean();
  });

  test('le PDF se télécharge : aucun nouvel onglet, l’adresse de la page ne change pas', async ({ page, context, baseURL }) => {
    await openPilotage(page, baseURL);
    const before = page.url();
    let opened = 0;
    context.on('page', () => (opened += 1));
    const downloadPromise = page.waitForEvent('download');
    await generate(page).click();
    await downloadPromise;
    await expect(page.getByRole('status').filter({ hasText: /badges?, dont/ })).toBeVisible();
    expect(opened, 'onglets ouverts').toBe(0);
    expect(page.url()).toBe(before);
  });

  test('filtre par type : un seul type coché envoie ce type et le PDF compte les inscrits de ce rôle', async ({ page, baseURL }) => {
    await openPilotage(page, baseURL);
    const speakers = await activeCount(page, 'speaker');
    expect(speakers, 'le seed compte au moins un intervenant').toBeGreaterThan(0);
    for (const name of ['Participant', 'Représentant d’exposant', 'Organisateur']) await typeBox(page, name).uncheck();

    const requestPromise = page.waitForRequest((request) => request.url().endsWith(`/admin/${EDITION}/badges`) && request.method() === 'POST');
    const downloadPromise = page.waitForEvent('download');
    const responsePromise = page.waitForResponse((response) => response.url().endsWith(`/admin/${EDITION}/badges`));
    await generate(page).click();
    expect((await requestPromise).postDataJSON()).toEqual({ types: ['speaker'], sort: 'name' });
    const response = await responsePromise;
    expect(Number(response.headers()['x-badges-count'])).toBe(speakers);
    expect(pageCount(await readDownload(await downloadPromise))).toBe(speakers);
    await expect(page.getByRole('status').filter({ hasText: /badges?, dont/ })).toContainText(`${speakers} badge`);
  });

  test('plusieurs types cochés : le compte est la somme des rôles', async ({ page, baseURL }) => {
    await openPilotage(page, baseURL);
    const expected = (await activeCount(page, 'speaker')) + (await activeCount(page, 'organizer'));
    for (const name of ['Participant', 'Représentant d’exposant']) await typeBox(page, name).uncheck();
    const responsePromise = page.waitForResponse((response) => response.url().endsWith(`/admin/${EDITION}/badges`));
    const downloadPromise = page.waitForEvent('download');
    await generate(page).click();
    expect(Number((await responsePromise).headers()['x-badges-count'])).toBe(expected);
    expect(pageCount(await readDownload(await downloadPromise))).toBe(expected);
  });

  test('tri « Par entreprise » : le corps envoyé porte sort=company et le PDF garde le même nombre de pages', async ({ page, baseURL }) => {
    await openPilotage(page, baseURL);
    const total = await activeCount(page);
    await sortSelect(page).selectOption('company');
    const requestPromise = page.waitForRequest((request) => request.url().endsWith(`/admin/${EDITION}/badges`) && request.method() === 'POST');
    const downloadPromise = page.waitForEvent('download');
    await generate(page).click();
    expect((await requestPromise).postDataJSON().sort).toBe('company');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^badges-.+-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(pageCount(await readDownload(download))).toBe(total);
  });

  test('aucun type coché : le bouton est désactivé et la consigne « Cochez au moins un type de badge. » apparaît', async ({ page, baseURL }) => {
    await openPilotage(page, baseURL);
    for (const name of TYPES) await typeBox(page, name).uncheck();
    await expect(generate(page)).toBeDisabled();
    await expect(page.getByText('Cochez au moins un type de badge.')).toBeVisible();
    await typeBox(page, 'Participant').check();
    await expect(generate(page)).toBeEnabled();
  });
});

test.describe('erreurs de la génération (F-97)', () => {
  test('réponse 500 sans corps : message lisible en role="alert", aucun téléchargement, aucun compte rendu', async ({ page, baseURL }) => {
    await openPilotage(page, baseURL);
    await page.route(BADGES_URL, (route) => route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' }));
    let downloads = 0;
    page.on('download', () => (downloads += 1));
    await generate(page).click();
    await expect(page.getByRole('alert').filter({ hasText: FAILED })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /badges?, dont/ })).toHaveCount(0);
    await expect(generate(page)).toBeEnabled();
    expect(downloads).toBe(0);
  });

  test('réponse 500 avec un message du serveur : ce message est affiché', async ({ page, baseURL }) => {
    await openPilotage(page, baseURL);
    await page.route(BADGES_URL, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'BADGES_FAILED', message: 'Génération impossible pour le moment.' } }) }),
    );
    await generate(page).click();
    await expect(page.getByRole('alert')).toHaveText('Génération impossible pour le moment.');
  });

  test('serveur injoignable : même message lisible, le bouton redevient actif et un second essai réussit', async ({ page, baseURL }) => {
    await openPilotage(page, baseURL);
    await page.route(BADGES_URL, (route) => route.abort('failed'), { times: 1 });
    await generate(page).click();
    await expect(page.getByRole('alert').filter({ hasText: FAILED })).toBeVisible();
    await expect(generate(page)).toBeEnabled();
    const downloadPromise = page.waitForEvent('download');
    await generate(page).click();
    await downloadPromise;
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: /badges?, dont/ })).toBeVisible();
  });
});

test.describe('fiche d’un inscrit : badge à l’unité et régénération (F-98)', () => {
  test('« Badge à l’unité » télécharge badge-lea-ducasse.pdf, une page, sans ouvrir d’onglet', async ({ page, context, baseURL }) => {
    await openPilotage(page, baseURL);
    const actions = await sheetOf(page, 'Léa Ducasse');
    let opened = 0;
    context.on('page', () => (opened += 1));
    const downloadPromise = page.waitForEvent('download');
    await actions.getByRole('button', { name: 'Badge à l’unité' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('badge-lea-ducasse.pdf');
    const pdf = await readDownload(download);
    expect(pageCount(pdf)).toBe(1);
    expect(pdf).toMatch(/\/URI \(https?:[^)]+\/carte\/[A-Za-z0-9_-]{43}\)/);
    await expect(page.getByRole('status').filter({ hasText: 'Le badge est téléchargé.' })).toBeVisible();
    expect(opened).toBe(0);
  });

  test('badge à l’unité en erreur 500 : message lisible en role="alert"', async ({ page, baseURL }) => {
    await openPilotage(page, baseURL);
    const actions = await sheetOf(page, 'Léa Ducasse');
    await page.route(`**/api/espace/admin/${EDITION}/attendees/*/badge`, (route) => route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' }));
    await actions.getByRole('button', { name: 'Badge à l’unité' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Le badge n’a pas pu être généré. Réessayez.' })).toBeVisible();
  });

  test('« Régénérer le jeton » : la confirmation avertit, « Annuler » ferme sans appeler la route', async ({ page, baseURL }) => {
    await openPilotage(page, baseURL);
    const actions = await sheetOf(page, 'Clara Dubourdieu');
    let calls = 0;
    page.on('request', (request) => {
      if (request.url().includes('/card-token/regenerate')) calls += 1;
    });
    await actions.getByRole('button', { name: 'Régénérer le jeton' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('L’ancien badge ne fonctionnera plus, il faudra le réimprimer.');
    await expect(dialog.getByRole('button', { name: 'Confirmer la régénération' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(calls).toBe(0);
  });

  test('confirmer la régénération : le QR change, l’ancienne adresse de carte répond 404, la nouvelle 200', async ({ page, baseURL }) => {
    await openPilotage(page, baseURL);
    const api = page.context().request;
    const found = await api.get(`${ADMIN}/attendees?q=${encodeURIComponent('dubourdieu')}`);
    const { items } = (await found.json()) as { items: { id: string }[] };
    expect(items).toHaveLength(1);
    const tokenOf = async () => {
      const response = await api.get(`${ADMIN}/attendees/${items[0].id}/badge`);
      expect(response.status()).toBe(200);
      const uri = /\/URI \((https?:[^)]+)\)/.exec((await response.body()).toString('latin1'))?.[1];
      expect(uri, 'annotation /URI').toBeTruthy();
      return uri!.split('/').pop()!;
    };
    const oldToken = await tokenOf();
    expect((await api.get(`${baseURL}${ESPACE}/carte/${oldToken}`)).status()).toBe(200);

    const actions = await sheetOf(page, 'Clara Dubourdieu');
    await actions.getByRole('button', { name: 'Régénérer le jeton' }).click();
    const responsePromise = page.waitForResponse((response) => response.url().includes('/card-token/regenerate'));
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirmer la régénération' }).click();
    expect((await responsePromise).status()).toBe(200);
    await expect(page.getByRole('status').filter({ hasText: /^Jeton régénéré/ })).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);

    const newToken = await tokenOf();
    expect(newToken).not.toBe(oldToken);
    expect((await api.get(`${baseURL}${ESPACE}/carte/${oldToken}`, { maxRedirects: 0 })).status(), 'ancienne carte').toBe(404);
    expect((await api.get(`${baseURL}${ESPACE}/carte/${newToken}`, { maxRedirects: 0 })).status(), 'nouvelle carte').toBe(200);
  });

  test('régénération en erreur 500 : message lisible, la fiche reste utilisable', async ({ page, baseURL }) => {
    await openPilotage(page, baseURL);
    const actions = await sheetOf(page, 'Clara Dubourdieu');
    await page.route('**/card-token/regenerate', (route) => route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' }));
    await actions.getByRole('button', { name: 'Régénérer le jeton' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirmer la régénération' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Le jeton n’a pas pu être régénéré. Réessayez.' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Badge à l’unité' })).toBeEnabled();
  });
});
