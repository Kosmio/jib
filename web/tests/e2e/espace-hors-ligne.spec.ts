import type { BrowserContext, Page } from '@playwright/test';
import { ESPACE, EDITION, expect, openSpace, test } from './espace';
import { STRAPI_URL } from './fixtures';

/**
 * Consultation hors connexion (V3-C : NF-24 complet, F-131).
 *
 * - Service worker autorisé (le reste de la suite le bloque). Il ne sert une page qu'après avoir pris le contrôle : chaque test charge une
 *   page, attend `serviceWorker.ready`, recharge, puis visite les pages à garder ; la copie est faite en arrière-plan, le test attend
 *   qu'elle existe dans Cache Storage avant de couper le réseau.
 * - Réseau coupé : `context.setOffline(true)`. Latence : `context.route` sur la page, ce qui ne voit les requêtes du service worker que
 *   si `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1` (posé ici, avant le lancement du navigateur).
 * - Session : un lien de connexion par adresse (NF-03 : 5 par 15 minutes), le cookie est repris d'un test à l'autre. Mode `serial` : le
 *   test de déconnexion, qui ferme la session de LEA, passe en dernier et sur sa propre adresse.
 * - Non couvert ici : l'expiration à 48 h après la date de l'événement. La balise `espace-date` n'est relayée par AppShell qu'après
 *   l'intégration de V2-D ; à vérifier après intégration (sans la balise, la copie vit 14 jours).
 */

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

test.use({ serviceWorkers: 'allow' });
test.describe.configure({ mode: 'serial' });

const INES = 'ines.castaing@example.org';
const LEA = 'lea.ducasse@example.org';
const PAGES = [`${ESPACE}/`, `${ESPACE}/agenda`, `${ESPACE}/programme`, `${ESPACE}/messages`];
const CACHE_STATIC = 'jib-espace-v2-statique';
const CACHE_EDITION = `jib-espace-v2-ed-${EDITION}`;

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

const normalise = (path: string) => (path.length > 1 ? path.replace(/\/$/, '') : path);

type Snapshot = Record<string, { path: string; origin: string; copie: string | null; expire: string | null }[]>;

const snapshot = (page: Page): Promise<Snapshot> =>
  page.evaluate(async () => {
    const result: Snapshot = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      result[name] = await Promise.all(
        (await cache.keys()).map(async (request) => {
          const response = await cache.match(request);
          const url = new URL(request.url);
          return { path: url.pathname, origin: url.origin, copie: response?.headers.get('X-Espace-Copie') ?? null, expire: response?.headers.get('X-Espace-Expire') ?? null };
        }),
      );
    }
    return result;
  });

/** Prend le contrôle du service worker, puis visite chaque page et attend sa copie dans Cache Storage. */
async function prime(page: Page, paths = PAGES) {
  await page.goto(`${ESPACE}/agenda`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  for (const path of paths) {
    await page.goto(path);
    await expect
      .poll(async () => ((await snapshot(page))[CACHE_EDITION] ?? []).map((entry) => normalise(entry.path)), { message: `copie de ${path}` })
      .toContain(normalise(path));
  }
}

/** Heure de Paris au format du bandeau, pour un horodatage en millisecondes. */
const parisTime = (ms: number) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
  );
  return `${parts.hour} h ${parts.minute}`;
};

async function offline(context: BrowserContext, run: () => Promise<void>) {
  await context.setOffline(true);
  try {
    await run();
  } finally {
    await context.setOffline(false);
  }
}

test('agenda ouvert, réseau coupé, rechargement : l’agenda s’affiche avec le bandeau et l’heure de la copie (NF-24, F-131)', async ({ page, context }) => {
  await signIn(page, INES);
  await prime(page);
  await page.goto(`${ESPACE}/agenda`);
  await expect(page.locator('#hors-ligne')).toBeHidden();
  const copie = (await snapshot(page))[CACHE_EDITION].find((entry) => normalise(entry.path) === `${ESPACE}/agenda`)!;
  expect(copie.copie, 'en-tête X-Espace-Copie').toMatch(/^\d+$/);
  expect(copie.expire, 'en-tête X-Espace-Expire').toMatch(/^\d+$/);
  expect(Number(copie.expire)).toBeGreaterThan(Date.now());

  await offline(context, async () => {
    await page.reload();
    await expect(page).toHaveTitle(/Mon agenda/);
    await expect(page.locator('html')).toHaveAttribute('data-hors-ligne', /^\d{4}-\d{2}-\d{2}T/);
    await expect(page.locator('#hors-ligne')).toBeVisible();
    await expect(page.locator('#hors-ligne')).toHaveText(`Hors connexion : contenu enregistré à ${parisTime(Number(copie.copie))}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Vous êtes hors connexion' })).toHaveCount(0);
  });
});

test('les quatre pages gardées (accueil, agenda, programme, messages) se rouvrent hors connexion avec le bandeau', async ({ page, context }) => {
  await signIn(page, INES);
  await prime(page);
  const titles = [/Accueil/, /Mon agenda/, /Programme/, /Messages/];
  await offline(context, async () => {
    for (const [index, path] of PAGES.entries()) {
      await page.goto(path);
      await expect(page, path).toHaveTitle(titles[index]);
      await expect(page.locator('#hors-ligne'), path).toBeVisible();
    }
  });
});

test('F-131 : hors connexion, les boutons et champs de la page sont désactivés', async ({ page, context }) => {
  await signIn(page, INES);
  await prime(page);
  const controls = 'button, input, textarea, select';
  let enabledOnline = 0;
  for (const path of PAGES) {
    await page.goto(path);
    enabledOnline += await page.locator(`#main-content :is(${controls}):not([disabled])`).count();
  }
  expect(enabledOnline, 'actions qui écrivent présentes en ligne sur les quatre pages').toBeGreaterThan(0);

  await offline(context, async () => {
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.locator('#hors-ligne'), path).toBeVisible();
      await expect(page.locator(`#main-content :is(${controls}):not([disabled])`), path).toHaveCount(0);
    }
  });
});

test('F-131 : la page hors connexion liste les pages enregistrées', async ({ page, context }) => {
  await signIn(page, INES);
  await prime(page);
  await offline(context, async () => {
    await page.goto('/espace/hors-ligne.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vous êtes hors connexion');
    const section = page.locator('#enregistrees');
    await expect(section).toBeVisible();
    await expect(section.getByRole('link')).toHaveText(['Accueil', 'Agenda', 'Messages', 'Programme']);
    const hrefs = await section.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(hrefs.map((href) => normalise(href!))).toEqual([`${ESPACE}`, `${ESPACE}/agenda`, `${ESPACE}/messages`, `${ESPACE}/programme`]);
    // Un lien de la liste ouvre bien la copie.
    await section.getByRole('link', { name: 'Agenda' }).click();
    await expect(page).toHaveTitle(/Mon agenda/);
    await expect(page.locator('#hors-ligne')).toBeVisible();
  });
});

test('une page jamais visitée n’a pas de copie : page hors connexion, sans lien vers elle', async ({ page, context }) => {
  await signIn(page, INES);
  await prime(page, [`${ESPACE}/agenda`]);
  await offline(context, async () => {
    await page.goto(`${ESPACE}/programme`).catch(() => null);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vous êtes hors connexion');
    await page.goto('/espace/hors-ligne.html');
    await expect(page.locator('#enregistrees').getByRole('link')).toHaveText(['Agenda']);
  });
});

test('réseau à 10 s de latence : la copie arrive en moins de 5 s (NF-24)', async ({ page, context }) => {
  test.setTimeout(60_000);
  await signIn(page, INES);
  await prime(page);

  let delayed = 0;
  await context.route(`**${ESPACE}/agenda`, async (route) => {
    delayed += 1;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    await route.continue().catch(() => {});
  });
  try {
    const start = Date.now();
    await page.goto(`${ESPACE}/agenda`);
    const elapsed = Date.now() - start;
    expect(delayed, 'la requête du service worker a bien été retardée').toBeGreaterThan(0);
    await expect(page.locator('#hors-ligne')).toBeVisible();
    expect(elapsed, `copie servie en ${elapsed} ms`).toBeLessThan(5000);
    expect(elapsed, 'pas avant le délai de 4 s').toBeGreaterThanOrEqual(3500);
  } finally {
    await context.unroute(`**${ESPACE}/agenda`);
  }
});

test('les appels à l’API ne sont jamais mis en cache ; les en-têtes no-store des pages sont inchangés (NF-24)', async ({ page }) => {
  await signIn(page, INES);
  const apiCalls: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url());
  });
  await prime(page);
  await page.goto(`${ESPACE}/agenda`);
  await page.goto(`${ESPACE}/messages`);
  await page.waitForLoadState('networkidle');
  // Les pages de ces écrans ne lisent l'API que côté serveur : on provoque un appel du navigateur, sous contrôle du service worker, vers l'API de Strapi.
  const apiUrl = `${STRAPI_URL}/api/espace/me?editionSlug=${EDITION}`;
  const apiStatus = await page.evaluate(async (url) => (await fetch(url, { credentials: 'include' })).status, apiUrl);
  expect(apiStatus, 'l’appel à l’API a eu une réponse').toBeLessThan(500);

  const caches = await snapshot(page);
  const entries = Object.entries(caches).flatMap(([name, list]) => list.map((entry) => ({ name, ...entry })));
  expect(Object.keys(caches).sort()).toEqual([CACHE_EDITION, CACHE_STATIC].sort());
  expect(entries.filter((entry) => entry.path.startsWith('/api/') || entry.origin !== new URL(page.url()).origin), 'entrées d’API ou d’autre origine').toEqual([]);
  expect(apiCalls.filter((url) => url.startsWith(STRAPI_URL)), 'l’appel à l’API est bien parti').not.toEqual([]);
  expect(entries.filter((entry) => entry.name === CACHE_EDITION).map((entry) => normalise(entry.path)).sort()).toEqual(PAGES.map(normalise).sort());
  expect(entries.filter((entry) => entry.name === CACHE_STATIC).map((entry) => entry.path)).toContain('/espace/hors-ligne.html');

  // En-têtes de la réponse du serveur, vue par la page sous contrôle du service worker, et par une requête directe.
  const viaPage = await page.evaluate(async (path) => (await fetch(path, { cache: 'no-store' })).headers.get('cache-control'), `${ESPACE}/agenda`);
  expect(viaPage).toBe('private, no-store');
  const direct = await page.request.get(`${ESPACE}/agenda`);
  expect(direct.headers()['cache-control']).toBe('private, no-store');
});

test('en ligne, une page gardée garde son contenu à jour et sans bandeau (réseau d’abord)', async ({ page }) => {
  await signIn(page, INES);
  await prime(page);
  await page.goto(`${ESPACE}/agenda`);
  await expect(page.locator('html')).not.toHaveAttribute('data-hors-ligne', /.*/);
  await expect(page.locator('#hors-ligne')).toBeHidden();
});

test('après la déconnexion puis la coupure du réseau, aucune page de l’espace n’est lisible (NF-24)', async ({ page, context }) => {
  await signIn(page, LEA);
  await prime(page);
  expect(Object.keys(await snapshot(page))).toContain(CACHE_EDITION);

  await page.goto(`${ESPACE}/profil`);
  await page.getByRole('button', { name: 'Me déconnecter' }).click();
  await page.locator('dialog#confirmation-deconnexion [data-deconnexion-confirmer]').click(); // V4-B, F-148 : confirmation
  await page.waitForURL(/\/espace\/.*connexion|\/espace\/?$/);
  const left = await snapshot(page);
  expect(Object.keys(left).filter((name) => name.startsWith('jib-espace-v2-ed-')).flatMap((name) => left[name]), 'copies de pages restantes').toEqual([]);

  await offline(context, async () => {
    for (const path of PAGES) {
      await page.goto(path).catch(() => null);
      await expect(page.getByRole('heading', { level: 1 }), path).toHaveText('Vous êtes hors connexion');
      await expect(page.locator('#hors-ligne'), path).toBeHidden();
    }
    await page.goto('/espace/hors-ligne.html');
    await expect(page.locator('#enregistrees')).toBeHidden();
  });
});
