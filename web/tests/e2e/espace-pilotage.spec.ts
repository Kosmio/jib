import { readFileSync } from 'node:fs';
import type { BrowserContext, Page, Route } from '@playwright/test';
import { ESPACE, EDITION, expect, hydrated, openSpace, psql, tab, test, watchConsole } from './espace';
import { STRAPI_URL } from './fixtures';

/**
 * Pilotage lisible, lot V2-D (F-119 à F-125) :
 *   - F-119 : « Pilotage » dans la barre d'onglets à 375 px pour un organisateur, pas pour un participant ;
 *   - F-120 : titre rouge d'une synchronisation en échec, avertissement quand la dernière réussite a plus d'une heure ;
 *   - F-121 : erreurs listées par ligne (billet, adresse, motif, action), cas attendus repliés ;
 *   - F-122 : confirmation de la régénération des créneaux, avec les nombres de la simulation ;
 *   - F-123 : exports téléchargés (nom, colonnes, annulés en fin), lien d'export sans session renvoyé à la connexion ;
 *   - F-124 : l'organisateur qui n'a jamais passé la bienvenue entre directement au pilotage ;
 *   - F-125 : libellé des profils complets, totaux par rôle sans les annulés, rechargement toutes les 60 s onglet visible.
 *
 * Le seed ne contient aucune synchronisation : les états de synchronisation (échec, doublon d'adresse, tâches planifiées actives) sont
 * joués en réécrivant la réponse de l'API dans le navigateur, le serveur restant celui du seed. La détection côté serveur de ces cas est
 * dans strapi/tests/integration/espace-pilotage.test.js. Aucun appel à Docker : ce fichier n'écrit pas dans la base.
 */

const ORGANIZER = 'organisation@example.org';
const LEA = 'lea.ducasse@example.org';
const MINUTE = 60_000;

type Json = Record<string, any>;

/** Réécrit la réponse JSON d'un appel de l'API (en-têtes CORS conservés, d'où `route.fetch`). Autres méthodes : intactes. */
async function patchApi(page: Page, glob: string, patch: (body: any) => any, method = 'GET') {
  await page.route(glob, async (route: Route) => {
    if (route.request().method() !== method) return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, json: patch(await response.json()) });
  });
}

const failedRun = (endedMinutesAgo: number, errors: Json[] = [{ code: 'FETCH_FAILED', status: 500 }]) => ({
  id: 'run-echec',
  startedAt: new Date(Date.now() - (endedMinutesAgo + 1.5) * MINUTE).toISOString(),
  // Une demi-minute de marge : le libellé arrondit à la minute inférieure, la lecture se fait quelques instants après.
  endedAt: new Date(Date.now() - (endedMinutesAgo + 0.5) * MINUTE).toISOString(),
  created: 0,
  updated: 0,
  cancelled: 0,
  errors,
});

const indicator = (page: Page, label: string) => page.getByRole('heading', { level: 3, name: label }).locator('xpath=ancestor::li[1]');
const syncCard = (page: Page) => page.locator('section[aria-labelledby="synchronisation"]');

test.describe('pilotage lisible (V2-D)', () => {
  test.describe.configure({ mode: 'serial' });

  // Strapi limite les liens de connexion à 5 par adresse et par 15 minutes (NF-03) : une seule connexion, cookie repris ensuite.
  let session: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;

  async function openPilotage(page: Page) {
    if (!session) throw new Error('La session de l’organisateur est ouverte par le premier test (F-124)');
    await page.context().addCookies(session);
    await page.goto(`${ESPACE}/organisateur`);
    await hydrated(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pilotage de l’édition');
  }

  test('F-124 : un organisateur de ORGANIZER_EMAILS qui n’a jamais passé la bienvenue arrive directement au pilotage', async ({ page, baseURL }) => {
    // L'organisateur a pu passer la bienvenue dans un autre fichier (la suite partage sa session) : le test pose son état de départ, puis le restaure.
    const [saved] = psql(`select consent_at from espace_attendees where email = '${ORGANIZER}'`);
    psql(`update espace_attendees set consent_at = null where email = '${ORGANIZER}'`);
    try {
      await openSpace(page, ORGANIZER);
      expect(page.url(), 'première connexion : la page d’arrivée est l’écran de bienvenue').toMatch(/\/bienvenue$/);
      session = await page.context().cookies();

      await page.goto(`${ESPACE}/organisateur`);
      await expect(page).toHaveURL(`${baseURL}${ESPACE}/organisateur`);
      await hydrated(page);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pilotage de l’édition');

      // Les écrans du participant exigent toujours la bienvenue : seule la page de pilotage fait exception.
      await page.goto(`${ESPACE}/`);
      await expect(page).toHaveURL(`${baseURL}${ESPACE}/bienvenue`);
    } finally {
      if (saved) psql(`update espace_attendees set consent_at = '${saved}' where email = '${ORGANIZER}'`);
    }
  });

  test('F-119, critère 1 : à 375 px, l’organisateur voit « Pilotage » dans la barre, sans débordement ; à 1280 px il reste « Organisation » dans la colonne', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openPilotage(page);
    const link = tab(page, 'Pilotage');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', `${ESPACE}/organisateur`);
    await expect(link).toHaveAttribute('aria-current', 'page');
    const box = await link.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'aucun défilement horizontal').toBeLessThanOrEqual(375);
    for (const name of ['Accueil', 'Annuaire', 'Agenda', 'Messages', 'Programme']) await expect(tab(page, name), name).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(link).toBeHidden();
    await expect(tab(page, 'Organisation')).toBeVisible();
  });

  test('F-119, critère 1 : un participant ne voit pas « Pilotage »', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openSpace(page, LEA);
    await expect(tab(page, 'Accueil')).toBeVisible();
    await expect(tab(page, 'Pilotage')).toHaveCount(0);
    await expect(tab(page, 'Organisation')).toHaveCount(0);
  });

  test('F-120, critère 2 : une dernière exécution en FETCH_FAILED donne un titre rouge « Dernière synchronisation en échec il y a 12 min »', async ({ page }) => {
    const consoleWatch = watchConsole(page);
    await openPilotage(page);
    await patchApi(page, '**/api/espace/admin/*/stats', (stats) => ({ ...stats, lastSync: failedRun(12) }));
    await page.getByRole('button', { name: 'Synchroniser maintenant' }).click();
    const title = syncCard(page).getByRole('heading', { level: 2 });
    await expect(title).toHaveText(/^Dernière synchronisation en échec il y a\s+12\s+min$/);
    await expect(title).toHaveClass(/text-danger/);
    consoleWatch.expectClean();
  });

  test('F-120 : une synchronisation réussie garde son titre neutre', async ({ page }) => {
    await openPilotage(page);
    await patchApi(page, '**/api/espace/admin/*/stats', (stats) => ({ ...stats, lastSync: failedRun(3, []) }));
    await page.getByRole('button', { name: 'Synchroniser maintenant' }).click();
    const title = syncCard(page).getByRole('heading', { level: 2 });
    await expect(title).toHaveText(/^HelloAsso synchronisé il y a\s+3\s+min$/);
    await expect(title).not.toHaveClass(/text-danger/);
  });

  /** Tâches planifiées actives ou non, dernière réussite il y a `successMinutesAgo` minutes, parmi les exécutions lues par la carte. */
  async function openWithRuns(page: Page, cron: boolean, successMinutesAgo: number) {
    const runs = [failedRun(5), { ...failedRun(successMinutesAgo, []), id: 'run-ok' }];
    await patchApi(page, '**/api/espace/admin/*/service', (service) => ({ ...service, cron: { ...service.cron, enabled: cron } }));
    await patchApi(page, '**/api/espace/admin/*/sync-runs', () => runs);
    const loaded = Promise.all([page.waitForResponse(/\/admin\/[^/]+\/service/), page.waitForResponse(/\/admin\/[^/]+\/sync-runs/)]);
    await openPilotage(page);
    await loaded;
    await page.waitForTimeout(300);
  }

  test('F-120 : tâches planifiées actives et dernière réussite il y a 90 min : avertissement sync-stale', async ({ page }) => {
    await openWithRuns(page, true, 90);
    const stale = page.getByTestId('sync-stale');
    await expect(stale).toBeVisible();
    await expect(stale).toContainText('Dernière synchronisation réussie');
    await expect(stale).toContainText(/il y a\s+1\s+h/);
  });

  test('F-120 : dernière réussite il y a 10 min, ou tâches planifiées inactives : pas d’avertissement', async ({ page }) => {
    await openWithRuns(page, true, 10);
    await expect(page.getByTestId('sync-stale')).toHaveCount(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await openWithRuns(page, false, 90);
    await expect(page.getByTestId('sync-stale')).toHaveCount(0);
  });

  test('F-121, critère 3 : un doublon d’e-mail s’affiche en rouge avec son billet, son adresse, qui la tient, le motif et l’action ; WAITING et UNKNOWN sont repliés', async ({ page }) => {
    await openPilotage(page);
    const errors = [
      { itemId: '910002', code: 'DUPLICATE_EMAIL', email: 'groupe@example.org', holderName: 'Agathe Lavigne' },
      { itemId: '910006', code: 'WAITING' },
      { itemId: '910010', code: 'UNKNOWN' },
    ];
    await patchApi(page, '**/api/espace/admin/*/stats', (stats) => ({ ...stats, lastSync: { ...failedRun(1, errors), id: 'run-doublon' } }));
    await page.getByRole('button', { name: 'Synchroniser maintenant' }).click();

    const card = syncCard(page);
    await expect(card.getByRole('heading', { level: 3, name: 'Erreurs de la dernière synchronisation (1)' })).toBeVisible();
    const row = card.getByRole('listitem').filter({ hasText: 'groupe@example.org' });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/Billet n°\s*910002/);
    await expect(row).toContainText('Adresse e-mail déjà utilisée par Agathe Lavigne.');
    await expect(row).toContainText(/À faire\s*:/);
    await expect(row).toHaveClass(/border-danger/);
    // La synchronisation dont seuls WAITING et UNKNOWN sont attendus n'est pas une erreur : ni dans les lignes rouges, ni dans le titre.
    await expect(card.getByRole('listitem').filter({ hasText: /910006|910010/ }).filter({ has: page.locator('.border-danger') })).toHaveCount(0);

    const infos = card.locator('details').filter({ hasText: 'Informations (2)' });
    await expect(infos).not.toHaveAttribute('open', '');
    await expect(infos.getByText(/billet en attente, ignoré/)).toBeHidden();
    await infos.locator('summary').click();
    await expect(infos.getByText(/billet en attente, ignoré \(n°\s*910006\)/)).toBeVisible();
    await expect(infos.getByText(/billet à l’état inconnu, ignoré \(n°\s*910010\)/)).toBeVisible();
  });

  test('F-121 : seuls WAITING et UNKNOWN : aucune ligne rouge, un bloc « Informations » replié', async ({ page }) => {
    await openPilotage(page);
    await patchApi(page, '**/api/espace/admin/*/stats', (stats) => ({ ...stats, lastSync: { ...failedRun(1, [{ itemId: '910006', code: 'WAITING' }]), id: 'run-attente' } }));
    await page.getByRole('button', { name: 'Synchroniser maintenant' }).click();
    const card = syncCard(page);
    await expect(card.locator('details').filter({ hasText: 'Informations (1)' })).toBeVisible();
    await expect(card.getByRole('heading', { level: 3, name: /^Erreurs de la dernière synchronisation/ })).toHaveCount(0);
    await expect(card.getByRole('heading', { level: 2 })).toHaveText(/^HelloAsso synchronisé/);
  });

  test('F-122 : la régénération demande confirmation avec les nombres de la simulation ; Annuler n’écrit rien', async ({ page }) => {
    await openPilotage(page);
    await patchApi(page, '**/slots/regenerate?dryRun=true', () => ({ dryRun: true, created: 2, kept: 8, removed: 1, orphans: [], warnings: [] }), 'POST');
    const posts: string[] = [];
    page.on('request', (request) => request.method() === 'POST' && /slots\/regenerate/.test(request.url()) && posts.push(request.url()));

    await page.getByRole('button', { name: 'Régénérer les créneaux' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/créer\s+2\s+créneaux\s+et\s+supprimer\s+1\s+créneau\s/);
    await expect(dialog).toContainText(/8\s+conservés?/);
    await expect(dialog.getByRole('button', { name: 'Confirmer la régénération' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Régénérer les créneaux' })).toBeVisible();
    expect(posts.every((url) => url.includes('dryRun=true')), 'seule la simulation est partie').toBe(true);
    expect(posts).toHaveLength(1);
  });

  test('F-122 : « Confirmer la régénération » lance la vraie régénération, une seule fois, après la simulation', async ({ page }) => {
    await openPilotage(page);
    await patchApi(page, '**/slots/regenerate?dryRun=true', () => ({ dryRun: true, created: 2, kept: 8, removed: 1, orphans: [], warnings: [] }), 'POST');
    const posts: string[] = [];
    page.on('request', (request) => request.method() === 'POST' && /slots\/regenerate/.test(request.url()) && posts.push(request.url()));

    await page.getByRole('button', { name: 'Régénérer les créneaux' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirmer la régénération' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByText(/Créneaux régénérés/)).toBeVisible();
    expect(posts.map((url) => url.includes('dryRun=true'))).toEqual([true, false]);
  });

  test('F-122 : rien à créer ni à supprimer (programme du seed) : pas de dialogue, la régénération part après sa simulation', async ({ page }) => {
    await openPilotage(page);
    const posts: string[] = [];
    page.on('request', (request) => request.method() === 'POST' && /slots\/regenerate/.test(request.url()) && posts.push(request.url()));
    await page.getByRole('button', { name: 'Régénérer les créneaux' }).click();
    await expect(page.getByText(/Créneaux régénérés/)).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(posts.map((url) => url.includes('dryRun=true'))).toEqual([true, false]);
  });

  test('F-125 : « N profils à 70 % et plus, sur M », totaux par rôle sans les annulés', async ({ page }) => {
    await openPilotage(page);
    const stats = await (await page.request.get(`${STRAPI_URL}/api/espace/admin/${EDITION}/stats`)).json();
    const { byRole } = stats.attendees;
    expect(Object.values<number>(byRole).reduce((sum, count) => sum + count, 0), 'la somme par rôle égale les inscrits actifs').toBe(stats.attendees.active);
    await expect(indicator(page, 'Profils complets')).toContainText(new RegExp(`profils?\\s+à\\s+70\\s%\\s+et\\s+plus,\\s+sur\\s+${stats.attendees.active}`));
    await expect(indicator(page, 'Inscrits importés')).toContainText(`${byRole.exhibitor_rep} représentant`);
    await expect(indicator(page, 'Inscrits importés')).toContainText(new RegExp(`${byRole.speaker}\\s+intervenants?`));
    await expect(indicator(page, 'Inscrits importés')).toContainText(`${stats.attendees.cancelled} inscription${stats.attendees.cancelled > 1 ? 's' : ''} annulée${stats.attendees.cancelled > 1 ? 's' : ''}`);
  });

  test('F-125 : les chiffres se rechargent toutes les 60 s quand l’onglet est visible, jamais onglet masqué', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => ((window as any).__hidden ? 'hidden' : 'visible') });
    });
    await page.clock.install();
    let reads = 0;
    let messages: number | undefined;
    await patchApi(page, '**/api/espace/admin/*/stats', (stats) => {
      reads += 1;
      return messages === undefined ? stats : { ...stats, messages };
    });
    await openPilotage(page);
    const baseline = reads;

    await page.evaluate(() => ((window as any).__hidden = true));
    await page.clock.runFor(130_000);
    await page.waitForTimeout(500);
    expect(reads, 'onglet masqué : aucune requête').toBe(baseline);

    messages = 999;
    await page.evaluate(() => ((window as any).__hidden = false));
    await page.clock.runFor(61_000);
    await expect(indicator(page, 'Messages')).toContainText('999');
    expect(reads).toBeGreaterThan(baseline);
  });

  test('F-123 : l’export des participants se télécharge avec l’édition et la date dans son nom, les nouvelles colonnes et les annulés en fin', async ({ page }) => {
    await openPilotage(page);
    const { cancelled } = (await (await page.request.get(`${STRAPI_URL}/api/espace/admin/${EDITION}/stats`)).json()).attendees;
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /^Participants/ }).click()]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`^participants-${EDITION}-\\d{4}-\\d{2}-\\d{2}\\.csv$`));
    const text = readFileSync((await download.path())!, 'utf8').replace(/^﻿/, '');
    const rows = text.trimEnd().split('\r\n').map((row) => row.split(';'));
    const header = rows[0];
    expect(header).toContain('Prénom');
    expect(header.slice(header.indexOf('Statut'), header.indexOf('Statut') + 4)).toEqual(['Statut', 'Espace activé', 'Activé le', 'Dernière connexion']);
    expect(header).toContain('Actualités des prochaines éditions');
    expect(header).not.toContain('Inscription');
    const statuses = rows.slice(1).map((row) => row[header.indexOf('Statut')]);
    expect(statuses.at(-1), 'le seed a une inscription annulée : elle ferme le fichier').toBe('Annulé');
    expect(statuses.filter((status) => status === 'Annulé')).toHaveLength(cancelled);
    expect(statuses.slice(0, -1).every((status) => status === 'Actif')).toBe(true);
  });

  test('F-123 : un lien d’export ouvert sans session renvoie à la connexion, avec le message de session expirée, jamais du JSON', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await page.goto(`${STRAPI_URL}/api/espace/admin/${EDITION}/export/participants.csv`);
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/connexion?next=${encodeURIComponent(`${ESPACE}/organisateur`)}&expire=1`);
    await expect(page.getByText('Votre session a expiré, demandez un nouveau lien.')).toBeVisible();
    await context.close();
  });
});
