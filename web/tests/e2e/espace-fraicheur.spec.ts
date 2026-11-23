import { gzipSync } from 'node:zlib';
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import { ESPACE, expect, hydrated, openSpace, tab, test } from './espace';
import { STRAPI_URL } from './fixtures';

/**
 * Fraîcheur (V3-D : F-132, F-133, R-88).
 *
 * Les tests se suivent (mode `serial`) sur le seed de recette : Manon écrit à Nathan, qui n'a ni message ni demande en attente au départ.
 * Chaque message envoyé reste en base ; les autres suites n'y lisent ni Nathan ni Manon avant la recette, qui n'exige que « au moins » 5 messages.
 *
 * - Temps : `page.clock` avance l'horloge de la page (60 s, 20 s) sans attendre ; les appels réseau restent réels.
 * - Onglet masqué : le navigateur de test est toujours visible, `visibilityState` est redéfini par script.
 * - Expéditeur : Manon a son propre contexte (cookie ouvert par le parcours réel), qui écrit par l'API ; l'en-tête `Origin` est celui du front,
 *   que Strapi exige pour une écriture (A-05).
 * - Demande de rendez-vous nouvelle : la réponse de `GET /me` est réécrite par `page.route` (compteur + 1), sans toucher aux rendez-vous du seed.
 */

test.describe.configure({ mode: 'serial' });

const NATHAN = 'nathan.lasserre@example.org';
const MANON = 'manon.bordenave@example.org';

const ME_URL = /\/api\/espace\/me(\?|$)/;
const CONVERSATIONS_URL = /\/api\/espace\/conversations(\?|$)/;
const THREAD_URL = /\/api\/espace\/conversations\/[^/]+\/messages(\?|$)/;

// Strapi limite les liens de connexion à 5 par adresse et par 15 minutes (NF-03) : une connexion par adresse, cookie repris ensuite.
const sessions = new Map<string, Awaited<ReturnType<BrowserContext['cookies']>>>();

async function signIn(page: Page, email: string) {
  const known = sessions.get(email);
  if (known) {
    await page.context().addCookies(known);
    return;
  }
  await openSpace(page, email);
  sessions.set(email, await page.context().cookies());
}

async function open(page: Page, email: string, path: string) {
  await signIn(page, email);
  await page.goto(`${ESPACE}${path}`);
  await hydrated(page);
}

/** Place `document.visibilityState` : le navigateur de test est toujours visible, l'onglet masqué se simule. */
const setVisibility = (page: Page, state: 'visible' | 'hidden') =>
  page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value === 'hidden' });
  }, state);

const comeBack = async (page: Page) => {
  await setVisibility(page, 'visible');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
};

/** Les requêtes GET de la page vers une route de l'API, comptées à partir de l'appel. */
function countRequests(page: Page, pattern: RegExp) {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'GET' && pattern.test(request.url())) seen.push(request.url());
  });
  return seen;
}

const badge = (page: Page, key: 'pendingReceived' | 'unreadMessages') => page.locator(`[data-live-badge="${key}"]`);
const screenReader = (page: Page, key: 'pendingReceived' | 'unreadMessages') => page.locator(`[data-live-sr="${key}"]`);
const announcement = (page: Page) => page.locator('[data-live-announce]');

/** Compte les écritures dans la zone d'annonce : une annonce lue une seule fois = une seule écriture. */
async function watchAnnouncements(page: Page) {
  await page.evaluate(() => {
    const target = document.querySelector('[data-live-announce]')!;
    const w = window as unknown as { __announced: string[] };
    w.__announced = [];
    new MutationObserver(() => w.__announced.push(target.textContent ?? '')).observe(target, { childList: true, characterData: true, subtree: true });
  });
}
const announced = (page: Page) => page.evaluate(() => (window as unknown as { __announced: string[] }).__announced);

// Expéditeur ---------------------------------------------------------------------------------------------------------------------------

let sender: { context: BrowserContext; api: APIRequestContext; origin: string } | undefined;

async function senderApi(browser: Browser, baseURL: string) {
  if (sender) return sender;
  const context = await browser.newContext({ baseURL, locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block', extraHTTPHeaders: { 'X-Forwarded-For': '10.231.7.9' } });
  const page = await context.newPage();
  await openSpace(page, MANON);
  await page.close();
  sender = { context, api: context.request, origin: new URL(baseURL).origin };
  return sender;
}

let conversationId: string | undefined;

/** Manon écrit à Nathan (ouvre la conversation au premier appel) ; rend l'identifiant de la conversation. */
async function manonWrites(browser: Browser, baseURL: string, body: string): Promise<string> {
  const { api, origin } = await senderApi(browser, baseURL);
  const headers = { Origin: origin };
  if (!conversationId) {
    const found = await api.get(`${STRAPI_URL}/api/espace/directory?q=Lasserre&type=participant`);
    expect(found.status(), await found.text()).toBe(200);
    const payload = (await found.json()) as Record<string, unknown>;
    const cards = (Object.values(payload).find(Array.isArray) ?? []) as { id: string; displayName: string }[];
    const nathan = cards.find((card) => card.displayName.includes('Nathan'));
    expect(nathan, `Nathan dans l'annuaire : ${JSON.stringify(payload).slice(0, 300)}`).toBeTruthy();
    const opened = await api.post(`${STRAPI_URL}/api/espace/conversations`, { headers, data: { with: `p:${nathan!.id}` } });
    expect([200, 201], await opened.text()).toContain(opened.status());
    conversationId = ((await opened.json()) as { id: string }).id;
  }
  const sent = await api.post(`${STRAPI_URL}/api/espace/conversations/${conversationId}/messages`, { headers, data: { body } });
  expect(sent.status(), await sent.text()).toBe(201);
  return conversationId;
}

test.afterAll(async () => {
  await sender?.context.close();
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// Critère 1 et annonce : un message reçu fait passer le badge de 0 à 1 en moins de 60 s, sans rechargement (F-132)
// ---------------------------------------------------------------------------------------------------------------------------------------

test('critère 1, F-132 : le badge Messages passe de 0 à 1 en 60 s sans rechargement, et l’annonce est lue une seule fois', async ({ page, browser, baseURL }) => {
  await signIn(page, NATHAN);
  await page.clock.install();
  await page.goto(`${ESPACE}/`);
  await hydrated(page);

  await expect(badge(page, 'unreadMessages')).toHaveAttribute('data-count', '0');
  await expect(badge(page, 'unreadMessages')).toBeHidden();
  await expect(tab(page, 'Messages')).toHaveAccessibleName('Messages');
  await expect(announcement(page)).toHaveAttribute('role', 'status');
  await expect(announcement(page)).toHaveAttribute('aria-live', 'polite');
  await expect(announcement(page)).toHaveText('');

  await page.evaluate(() => ((window as unknown as { __marker: string }).__marker = 'avant'));
  await watchAnnouncements(page);
  const reads = countRequests(page, ME_URL);

  await manonWrites(browser, baseURL!, 'Bonjour Nathan, avez-vous une minute pour parler de données forestières ?');
  await page.clock.runFor(60_000);

  await expect(badge(page, 'unreadMessages')).toBeVisible();
  await expect(badge(page, 'unreadMessages')).toHaveText('1');
  await expect(badge(page, 'unreadMessages')).toHaveAttribute('data-count', '1');
  await expect(screenReader(page, 'unreadMessages')).toHaveText(', 1 message non lu');
  await expect(tab(page, 'Messages')).toHaveAccessibleName(/^Messages\s*,\s*1 message non lu$/);
  await expect(announcement(page)).toHaveText('Nouveau message, 1 message non lu.');
  expect(await page.evaluate(() => (window as unknown as { __marker?: string }).__marker), 'la page n’a pas été rechargée').toBe('avant');

  // Aucun nouveau message : trois relectures de plus, la même annonce n’est pas réécrite.
  // Une minute à la fois, en attendant chaque réponse : une relecture encore en vol fait sauter la suivante (réponse réelle, horloge simulée).
  for (let minute = 2; minute <= 4; minute += 1) {
    const read = page.waitForResponse((response) => ME_URL.test(response.url()));
    await page.clock.runFor(60_000);
    await read;
    expect(reads, `relectures de /me après ${minute} minutes`).toHaveLength(minute);
  }
  await expect(announcement(page)).toHaveText('Nouveau message, 1 message non lu.');
  expect(await announced(page), 'écritures dans la zone d’annonce').toEqual(['Nouveau message, 1 message non lu.']);
});

test('F-132 : une nouvelle demande de rendez-vous reçue allume le badge Agenda et est annoncée une fois', async ({ page }) => {
  await signIn(page, NATHAN);
  let bump = 0;
  await page.route(ME_URL, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.counts = { ...body.counts, pendingReceived: (body.counts?.pendingReceived ?? 0) + bump };
    await route.fulfill({ response, json: body });
  });
  await page.clock.install();
  await page.goto(`${ESPACE}/`);
  await hydrated(page);

  await expect(badge(page, 'pendingReceived')).toHaveAttribute('data-count', '0');
  await expect(badge(page, 'pendingReceived')).toBeHidden();
  await watchAnnouncements(page);

  bump = 1;
  await page.clock.runFor(60_000);
  await expect(badge(page, 'pendingReceived')).toBeVisible();
  await expect(badge(page, 'pendingReceived')).toHaveText('1');
  await expect(screenReader(page, 'pendingReceived')).toHaveText(', 1 demande reçue en attente');
  await expect(tab(page, 'Agenda')).toHaveAccessibleName(/^Agenda\s*,\s*1 demande reçue en attente$/);
  await expect(announcement(page)).toHaveText('Nouvelle demande de rendez-vous, 1 demande reçue en attente.');

  await page.clock.runFor(60_000);
  expect(await announced(page), 'écritures dans la zone d’annonce').toHaveLength(1);

  // La demande est traitée : le badge s’éteint sans annonce.
  bump = 0;
  await page.clock.runFor(60_000);
  await expect(badge(page, 'pendingReceived')).toBeHidden();
  await expect(badge(page, 'pendingReceived')).toHaveAttribute('data-count', '0');
  await expect(screenReader(page, 'pendingReceived')).toHaveText('');
  expect(await announced(page), 'écritures dans la zone d’annonce').toHaveLength(1);
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// Critère 2 : onglet masqué, aucune requête ; retour au premier plan, une relecture
// ---------------------------------------------------------------------------------------------------------------------------------------

test('critère 2, F-132 : onglet masqué, aucune requête à /me ; au retour au premier plan, une relecture', async ({ page }) => {
  await signIn(page, NATHAN);
  await page.clock.install();
  await page.goto(`${ESPACE}/`);
  await hydrated(page);

  const reads = countRequests(page, ME_URL);
  await setVisibility(page, 'hidden');
  await page.clock.runFor(180_000);
  await page.waitForTimeout(500);
  expect(reads, 'requêtes à /me pendant que l’onglet est masqué').toEqual([]);

  const back = page.waitForRequest((request) => request.method() === 'GET' && ME_URL.test(request.url()));
  await comeBack(page);
  await back;
  expect(reads).toHaveLength(1);
});

test('critère 2, F-133 : onglet masqué, la liste des messages ne relit pas /conversations ; au retour, une relecture', async ({ page }) => {
  await signIn(page, NATHAN);
  await page.clock.install();
  await page.goto(`${ESPACE}/messages`);
  await hydrated(page);

  const lists = countRequests(page, CONVERSATIONS_URL);
  const reads = countRequests(page, ME_URL);
  await setVisibility(page, 'hidden');
  await page.clock.runFor(180_000);
  await page.waitForTimeout(500);
  expect(lists, 'requêtes à /conversations pendant que l’onglet est masqué').toEqual([]);
  expect(reads, 'requêtes à /me pendant que l’onglet est masqué').toEqual([]);

  const back = page.waitForRequest((request) => request.method() === 'GET' && CONVERSATIONS_URL.test(request.url()));
  await comeBack(page);
  await back;
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// F-133 : la liste des messages se recharge toutes les 60 s
// ---------------------------------------------------------------------------------------------------------------------------------------

test('F-133 : la liste des messages gagne le message suivant en 60 s, sans rechargement, avec son non-lu et l’annonce', async ({ page, browser, baseURL }) => {
  await signIn(page, NATHAN);
  await page.clock.install();
  await page.goto(`${ESPACE}/messages`);
  await hydrated(page);

  const row = page.getByRole('main').getByRole('listitem').filter({ hasText: 'Manon' });
  await expect(row).toContainText('1 message non lu');
  await expect(row).toContainText('avez-vous une minute');
  await page.evaluate(() => ((window as unknown as { __marker: string }).__marker = 'avant'));
  await watchAnnouncements(page);

  await manonWrites(browser, baseURL!, 'Je reviens vers vous : plutôt jeudi matin ?');
  await page.clock.runFor(60_000);

  await expect(row).toContainText('2 messages non lus');
  await expect(row).toContainText('plutôt jeudi matin');
  await expect(badge(page, 'unreadMessages')).toHaveText('2');
  await expect(announcement(page)).toHaveText('Nouveau message, 2 messages non lus.');
  expect(await announced(page), 'écritures dans la zone d’annonce').toEqual(['Nouveau message, 2 messages non lus.']);
  expect(await page.evaluate(() => (window as unknown as { __marker?: string }).__marker), 'la page n’a pas été rechargée').toBe('avant');
});

test('F-133 : un échec de la relecture de la liste garde la liste affichée', async ({ page }) => {
  await signIn(page, NATHAN);
  await page.clock.install();
  await page.goto(`${ESPACE}/messages`);
  await hydrated(page);

  const row = page.getByRole('main').getByRole('listitem').filter({ hasText: 'Manon' });
  await expect(row).toBeVisible();
  await page.route(CONVERSATIONS_URL, (route) => route.abort('connectionrefused'));
  const failed = page.waitForEvent('requestfailed', (request) => CONVERSATIONS_URL.test(request.url()));
  await page.clock.runFor(60_000);
  await failed;
  await expect(row).toContainText('plutôt jeudi matin');
  await expect(page.getByText('Aucun message pour l’instant')).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// Critère 3 : poids de l'îlot de badges
// ---------------------------------------------------------------------------------------------------------------------------------------

test('critère 3, F-132 : l’îlot de badges, lu dans le HTML de la page, pèse moins de 5 Ko compressés et ne charge aucun fichier', async ({ page }) => {
  await signIn(page, NATHAN);
  const response = await page.request.get(`${ESPACE}/`);
  expect(response.status()).toBe(200);
  const html = await response.text();

  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map(([, attributes, text]) => ({ attributes, text }));
  const island = scripts.filter(({ text }) => text.includes('data-live-nav'));
  expect(island, 'script en ligne qui porte l’îlot de badges').toHaveLength(1);
  expect(island[0].attributes, 'îlot inliné, sans fichier à charger').not.toMatch(/\bsrc=/);
  expect(html).not.toMatch(/<script[^>]+src="[^"]*LiveBadges/);

  const bytes = gzipSync(Buffer.from(island[0].text, 'utf8'), { level: 9 }).length;
  expect(bytes, `îlot de badges : ${bytes} o compressés`).toBeGreaterThan(0);
  expect(bytes, `îlot de badges : ${bytes} o compressés`).toBeLessThan(5 * 1024);
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// Fil : « Hors connexion, nouvelle tentative… » et ligne d'aide
// ---------------------------------------------------------------------------------------------------------------------------------------

test('F-71, V3-D : dans un fil, un échec de l’interrogation affiche « Hors connexion, nouvelle tentative… », la reprise l’efface', async ({ page }) => {
  await signIn(page, NATHAN);
  await page.clock.install();
  await page.goto(`${ESPACE}/messages`);
  await hydrated(page);
  await page.getByRole('main').getByRole('listitem').filter({ hasText: 'Manon' }).getByRole('link').click();
  await hydrated(page);

  const log = page.getByRole('log', { name: 'Messages' });
  await expect(log).toContainText('avez-vous une minute');
  const offline = page.getByRole('status').filter({ hasText: 'Hors connexion, nouvelle tentative…' });
  await expect(offline).toHaveCount(0);

  await page.route(THREAD_URL, (route) => route.abort('connectionrefused'));
  const failed = page.waitForEvent('requestfailed', (request) => THREAD_URL.test(request.url()));
  await page.clock.runFor(20_000);
  await failed;
  await expect(offline).toBeVisible();
  await expect(offline).toHaveText('Hors connexion, nouvelle tentative…');
  await expect(log, 'le fil affiché reste').toContainText('avez-vous une minute');

  await page.unroute(THREAD_URL);
  await page.clock.runFor(20_000);
  await expect(offline).toHaveCount(0);
});

test('V3-D : le fil indique que Ctrl ou Cmd + Entrée envoie, lié au champ, et Ctrl + Entrée envoie', async ({ page }) => {
  await signIn(page, NATHAN);
  await page.goto(`${ESPACE}/messages`);
  await hydrated(page);
  await page.getByRole('main').getByRole('listitem').filter({ hasText: 'Manon' }).getByRole('link').click();
  await hydrated(page);

  await expect(page.locator('#message-aide')).toHaveText('Ctrl ou Cmd + Entrée pour envoyer');
  const field = page.getByRole('textbox');
  await expect(field).toHaveAttribute('aria-describedby', /(^|\s)message-aide(\s|$)/);
  await expect(field).toHaveAccessibleDescription('Ctrl ou Cmd + Entrée pour envoyer');

  await field.fill('Jeudi matin me convient, 10h ?');
  await field.press('Control+Enter');
  await expect(page.getByRole('log', { name: 'Messages' })).toContainText('Jeudi matin me convient, 10h ?');
  await expect(field).toHaveValue('');
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// Retour : le badge disparaît quand le fil a été lu (la relecture suivante le constate)
// ---------------------------------------------------------------------------------------------------------------------------------------

test('F-132 : une fois le fil lu, le badge Messages s’éteint à la relecture suivante, sans annonce', async ({ page, browser, baseURL }) => {
  await manonWrites(browser, baseURL!, 'Parfait, à jeudi.');
  await signIn(page, NATHAN);
  await page.clock.install();
  await page.goto(`${ESPACE}/messages`);
  await hydrated(page);
  await watchAnnouncements(page);
  await expect(badge(page, 'unreadMessages')).toBeVisible();

  // Le fil, ouvert dans un autre onglet, marque les messages lus ; cet onglet-ci les constate en 60 s.
  const other = await page.context().newPage();
  await other.goto(`${ESPACE}/messages`);
  await hydrated(other);
  await other.getByRole('main').getByRole('listitem').filter({ hasText: 'Manon' }).getByRole('link').click();
  await expect(other.getByRole('log', { name: 'Messages' })).toContainText('Parfait, à jeudi.');
  await other.close();

  await page.clock.runFor(60_000);
  await expect(badge(page, 'unreadMessages')).toBeHidden();
  await expect(badge(page, 'unreadMessages')).toHaveAttribute('data-count', '0');
  await expect(screenReader(page, 'unreadMessages')).toHaveText('');
  expect(await announced(page), 'aucune annonce pour une baisse').toEqual([]);
});
