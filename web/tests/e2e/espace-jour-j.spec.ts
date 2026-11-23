import type { Browser, Page } from '@playwright/test';
import { ESPACE, expect, hydrated, openSpace, test } from './espace';
import { STRAPI_URL } from './fixtures';

/**
 * Repères du jour J dans le programme (V4-C : F-150, F-151, F-152, NF-31).
 *
 * - Heure : `?now=<ISO>` sur la page programme (relayé à l'API, ignoré sous NODE_ENV=production). Le 3 décembre 2026, 11h20 à Paris = 10h20 UTC.
 * - Données : le seed de recette. Léa Ducasse a deux rendez-vous acceptés (10h45 avec Mathis Lagrange, table 1 ; 12h30 avec l'exposant Sylvadour),
 *   une demande en attente à 13h00 et une autre à 15h30 ; Nathan n'a que des rendez-vous annulés. La fenêtre de demandes de la recette
 *   ferme le 2 décembre à 17h00 UTC : le 20 novembre elle est ouverte, le 3 décembre elle est close.
 * - Sans JavaScript : contexte dédié (`javaScriptEnabled: false`), sans l'en-tête X-Forwarded-For du `test` de l'espace.
 */

test.describe.configure({ mode: 'serial' });

const LEA = 'lea.ducasse@example.org';
const NATHAN = 'nathan.lasserre@example.org';

const JOUR_J_1120 = '2026-12-03T10:20:00Z';
const JOUR_J_1000 = '2026-12-03T09:00:00Z'; // 10h00 à Paris : « Forêt et adaptation » en cours, la pause B2B à suivre
const FENETRE_OUVERTE = '2026-11-20T10:00:00Z';
const PROGRAMME = `${ESPACE}/programme`;
const programmeAt = (now: string) => `${PROGRAMME}?now=${encodeURIComponent(now)}`;

const TITRES = [
  'Accueil et ouverture',
  'Forêt et adaptation',
  'Pause et B2B',
  'Process, data et IA',
  'Cocktail déjeunatoire & B2B',
  'Économie circulaire',
  'Territoires résilients',
  'Construction bois',
];

// Strapi limite les liens de connexion à 5 par adresse et par 15 minutes (NF-03) : une seule ouverture de session par adresse.
const sessions = new Map<string, Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>>>();

async function signIn(page: Page, email: string) {
  const known = sessions.get(email);
  if (known) {
    await page.context().addCookies(known);
    return;
  }
  await openSpace(page, email);
  sessions.set(email, await page.context().cookies());
}

async function noScriptPage(browser: Browser, baseURL: string | undefined, email?: string) {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false, locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block', extraHTTPHeaders: {} });
  if (email) await context.addCookies(sessions.get(email)!);
  return { context, page: await context.newPage() };
}

const item = (page: Page, title: string) => page.locator('li[data-session-id]').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
const pauses = (page: Page) => page.locator('li[data-session-id]').filter({ has: page.getByRole('heading', { name: /B2B/ }) });

test('F-150, critère 1 : le 3 décembre à 11h20, « Process, data et IA » est En cours, le cocktail À suivre', async ({ page }) => {
  await page.goto(programmeAt(JOUR_J_1120));
  await hydrated(page);
  const current = item(page, 'Process, data et IA');
  await expect(current).toHaveAttribute('data-state', 'current');
  await expect(current.locator('[data-state-badge]')).toHaveText('En cours');
  await expect(current).toHaveAttribute('id', 'en-cours');
  const next = item(page, 'Cocktail déjeunatoire & B2B');
  await expect(next).toHaveAttribute('data-state', 'next');
  await expect(next.locator('[data-state-badge]')).toHaveText('À suivre');
  await expect(page.locator('li[data-state="current"]')).toHaveCount(1);
  await expect(page.locator('li[data-state="next"]')).toHaveCount(1);
  await expect(page.locator('[data-state-badge]:not([hidden])')).toHaveCount(2);
});

test('F-150 : le lien « Aller à la séquence en cours » mène à la séquence en cours', async ({ page }) => {
  await page.goto(programmeAt(JOUR_J_1120));
  await hydrated(page);
  const jump = page.locator('[data-jump-now]').getByRole('link', { name: 'Aller à la séquence en cours' });
  await expect(jump).toBeVisible();
  await expect(jump).toHaveAttribute('href', '#en-cours');
  await jump.click();
  await expect(page).toHaveURL(/#en-cours$/);
  await expect(page.locator('#en-cours')).toContainText('Process, data et IA');
});

test('F-150 : le programme s’ouvre sur la séquence en cours (défilement), sans ancre dans l’adresse', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto(programmeAt(JOUR_J_1120));
  await hydrated(page);
  await expect
    .poll(async () => page.locator('#en-cours').evaluate((element) => element.getBoundingClientRect().top >= 0 && element.getBoundingClientRect().bottom <= window.innerHeight), {
      message: 'la séquence en cours est visible sans défiler à la main',
    })
    .toBe(true);
});

test('F-150 : à 10h00, la séquence du matin est En cours et la pause B2B À suivre ; un autre jour, aucun repère', async ({ page }) => {
  await page.goto(programmeAt(JOUR_J_1000));
  await expect(item(page, 'Forêt et adaptation')).toHaveAttribute('data-state', 'current');
  await expect(pauses(page).first()).toHaveAttribute('data-state', 'next');
  await page.goto(programmeAt('2026-12-01T10:00:00Z'));
  await expect(page.locator('li[data-session-id]').first()).toBeVisible();
  await expect(page.locator('[data-state]')).toHaveCount(0);
  await expect(page.locator('[data-state-badge]')).toHaveCount(0);
  await expect(page.locator('[data-jump-now]')).toHaveCount(0);
  await expect(page.locator('#en-cours')).toHaveCount(0);
});

test('F-150 : la page se tient à jour à la minute (l’îlot avance l’heure simulée avec l’horloge du navigateur)', async ({ page }) => {
  await page.clock.install();
  await page.goto(programmeAt(JOUR_J_1120));
  await hydrated(page);
  await expect(item(page, 'Process, data et IA')).toHaveAttribute('data-state', 'current');
  await page.clock.fastForward('01:20:00'); // 12h40 : la séquence est finie, le cocktail (12h30 à 14h00) est en cours
  await expect(item(page, 'Cocktail déjeunatoire & B2B')).toHaveAttribute('data-state', 'current');
  await expect(item(page, 'Cocktail déjeunatoire & B2B').locator('[data-state-badge]')).toHaveText('En cours');
  await expect(item(page, 'Process, data et IA')).not.toHaveAttribute('data-state', /.+/);
  await expect(item(page, 'Process, data et IA').locator('[data-state-badge]')).toBeHidden();
  await expect(page.locator('#en-cours')).toContainText('Cocktail');
});

test('NF-31, critère 2 : sans JavaScript, le programme est complet et porte les repères du jour J', async ({ browser, baseURL }) => {
  const { context, page } = await noScriptPage(browser, baseURL);
  try {
    await page.goto(programmeAt(JOUR_J_1120));
    for (const title of TITRES) await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible();
    await expect(item(page, 'Process, data et IA').locator('[data-state-badge]')).toHaveText('En cours');
    await expect(item(page, 'Cocktail déjeunatoire & B2B').locator('[data-state-badge]')).toHaveText('À suivre');
    await expect(page.locator('#en-cours')).toContainText('Process, data et IA');
    await expect(page.getByRole('link', { name: 'Aller à la séquence en cours' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Sections du programme' }).getByRole('link')).toHaveCount(3);
  } finally {
    await context.close();
  }
});

test('critère 3 : un visiteur non connecté ne voit aucun rendez-vous, ni dans la page ni dans l’API', async ({ page, request }) => {
  await page.goto(programmeAt(FENETRE_OUVERTE));
  await expect(page.locator('li[data-session-id]').first()).toBeVisible();
  await expect(page.locator('[data-my-meetings]')).toHaveCount(0);
  await expect(page.locator('[data-meeting-count]')).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toContain('Mathis Lagrange');

  for (const now of [FENETRE_OUVERTE, JOUR_J_1120]) {
    const response = await request.get(`${STRAPI_URL}/api/espace/editions/nouvelle-aquitaine-test/program?now=${encodeURIComponent(now)}`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    const breaks = body.sessions.filter((session: { kind: string }) => session.kind === 'b2b_break');
    expect(breaks.length).toBeGreaterThan(0);
    for (const session of breaks) expect(session.meetings, session.title).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('Mathis');
    expect(JSON.stringify(body)).not.toContain('Table 1');
  }
});

test('F-151 : Léa voit ses rendez-vous acceptés à leur pause, avec la table ; ni demande en attente ni refus', async ({ page }) => {
  await signIn(page, LEA);
  await page.goto(programmeAt(JOUR_J_1120));
  await hydrated(page);
  const [first, cocktail, last] = [pauses(page).nth(0), pauses(page).nth(1), pauses(page).nth(2)];
  const list = first.locator('ul[data-my-meetings]');
  await expect(list).toHaveAccessibleName('Mes rendez-vous');
  await expect(list.locator('li')).toHaveCount(1);
  await expect(list.locator('li')).toHaveText('10h45 · Mathis Lagrange · Table 1');
  await expect(cocktail.locator('ul[data-my-meetings] li')).toHaveCount(1);
  await expect(cocktail.locator('ul[data-my-meetings] li')).toHaveText(/^\s*12h30\s+·\s+Sylvadour/);
  await expect(last.locator('[data-my-meetings]')).toHaveCount(0);
  await expect(page.locator('[data-my-meetings] li')).toHaveCount(2);
  expect((await page.locator('[data-my-meetings]').allTextContents()).join(' ')).not.toContain('Inès');
});

test('F-151 : la réponse de l’API de Léa porte ses rendez-vous sur la pause, et eux seuls', async ({ page }) => {
  await signIn(page, LEA);
  await page.goto(PROGRAMME);
  const response = await page.request.get(`${STRAPI_URL}/api/espace/editions/nouvelle-aquitaine-test/program?now=${encodeURIComponent(JOUR_J_1120)}`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.liveDay).toBe(true);
  expect(body.now).toBe('2026-12-03T10:20:00.000Z');
  const breaks = body.sessions.filter((session: { kind: string }) => session.kind === 'b2b_break');
  expect(breaks.map((session: { meetings: unknown[] }) => session.meetings.length)).toEqual([1, 1, 0]);
  expect(breaks[0].meetings[0]).toMatchObject({ start: '10h45', counterpart: 'Mathis Lagrange', location: 'Table 1' });
  expect(body.sessions.filter((session: { kind: string }) => session.kind !== 'b2b_break').every((session: object) => !('meetings' in session))).toBe(true);
});

test('F-152 : fenêtre ouverte, chaque pause propose « Prendre RDV » vers l’annuaire et n’affiche pas de nombre', async ({ page }) => {
  await signIn(page, LEA);
  await page.goto(programmeAt(FENETRE_OUVERTE));
  await hydrated(page);
  const links = page.getByRole('link', { name: 'Prendre RDV' });
  await expect(links).toHaveCount(3);
  for (const link of await links.all()) await expect(link).toHaveAttribute('href', `${ESPACE}/annuaire`);
  await expect(page.locator('[data-meeting-count]')).toHaveCount(0);
  await links.first().click();
  await expect(page).toHaveURL(new RegExp(`${ESPACE}/annuaire$`));
});

test('F-152 : fenêtre close, plus de « Prendre RDV » ; chaque pause dit le nombre de rendez-vous acceptés de Léa', async ({ page }) => {
  await signIn(page, LEA);
  await page.goto(programmeAt(JOUR_J_1120));
  await hydrated(page);
  await expect(page.getByRole('link', { name: 'Prendre RDV' })).toHaveCount(0);
  await expect(page.locator('[data-meeting-count]')).toHaveText(['1 rendez-vous', '1 rendez-vous', 'Aucun rendez-vous']);
});

test('F-152 : sans rendez-vous accepté, Nathan lit « Aucun rendez-vous » à chaque pause', async ({ page }) => {
  await signIn(page, NATHAN);
  await page.goto(programmeAt(JOUR_J_1120));
  await expect(page.locator('[data-meeting-count]')).toHaveText(['Aucun rendez-vous', 'Aucun rendez-vous', 'Aucun rendez-vous']);
  await expect(page.locator('[data-my-meetings]')).toHaveCount(0);
});

test('F-152 : un visiteur non connecté, fenêtre close, ne voit ni « Prendre RDV » ni nombre', async ({ page }) => {
  await page.goto(programmeAt(JOUR_J_1120));
  await expect(page.locator('li[data-session-id]').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Prendre RDV' })).toHaveCount(0);
  await expect(page.locator('[data-meeting-count]')).toHaveCount(0);
});

test('F-151, NF-31 : sans JavaScript, Léa voit ses rendez-vous à leur pause', async ({ browser, baseURL }) => {
  const { context, page } = await noScriptPage(browser, baseURL, LEA);
  try {
    await page.goto(programmeAt(JOUR_J_1120));
    await expect(pauses(page).first().locator('[data-my-meetings] li')).toHaveText('10h45 · Mathis Lagrange · Table 1');
    await expect(page.locator('[data-meeting-count]').first()).toHaveText('1 rendez-vous');
  } finally {
    await context.close();
  }
});

test('onglets du programme : un clic remplace l’entrée d’historique, il ne l’ajoute pas', async ({ page }) => {
  await page.goto(`${ESPACE}/connexion`);
  await page.goto(PROGRAMME);
  await hydrated(page);
  const sections = page.getByRole('navigation', { name: 'Sections du programme' });
  const before = await page.evaluate(() => history.length);
  await sections.getByRole('link', { name: 'Intervenants' }).click();
  await expect(page).toHaveURL(/#intervenants$/);
  await expect(sections.locator('[aria-current]')).toHaveText('Intervenants');
  await sections.getByRole('link', { name: 'Infos pratiques' }).click();
  await expect(page).toHaveURL(/#infos$/);
  await expect(sections.locator('[aria-current]')).toHaveText('Infos pratiques');
  await sections.getByRole('link', { name: 'Journée' }).click();
  await expect(sections.locator('[aria-current]')).toHaveText('Journée');
  expect(await page.evaluate(() => history.length), 'longueur de l’historique').toBe(before);
  await page.goBack();
  await expect(page).toHaveURL(/\/connexion/);
});

test('onglets du programme : sans JavaScript, l’ancre reste un lien ordinaire', async ({ browser, baseURL }) => {
  const { context, page } = await noScriptPage(browser, baseURL);
  try {
    await page.goto(PROGRAMME);
    await page.getByRole('navigation', { name: 'Sections du programme' }).getByRole('link', { name: 'Infos pratiques' }).click();
    await expect(page).toHaveURL(/#infos$/);
  } finally {
    await context.close();
  }
});
