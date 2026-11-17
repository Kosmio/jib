import { createRequire } from 'node:module';
import type { BrowserContext, Page } from '@playwright/test';
import { ACCESS_LINK_SUBJECT, ESPACE, EDITION, expect, hydrated, linkOf, mailsTo, nextMail, readOutbox, receiveLink, requestLink, test } from './espace';

/**
 * Accès robustes dans le navigateur (lot V1-B, tests d'abord, `test.fixme` jusqu'à la livraison) : F-100, F-101, F-102, F-103, F-104
 * et l'état « Lien envoyé » qui rappelle l'adresse saisie.
 *
 * Données : le seed de recette, uniquement des inscrits activés (consentement donné, pas de détour par /bienvenue) : Jules (F-100, F-103, F-104),
 * Alice (F-101), Manon et Clara (F-102, sans JavaScript). Organisateur : organisation@example.org (ORGANIZER_EMAILS du serveur e2e).
 */

const JULES = 'jules.mazeres@example.org';
const ALICE = 'alice.fourcade@example.org';
const MANON = 'manon.bordenave@example.org';
const CLARA = 'clara.dubourdieu@example.org';
const ORGANIZER = 'organisation@example.org';
const INVALID_STATE = 'Ce lien n’est plus valable';
const MARKER = 'V1-B';

/** Ouvre une session par le parcours réel (E0, e-mail, « Ouvrir mon espace ») pour un inscrit déjà consentant. */
async function signIn(page: Page, email: string) {
  const link = await receiveLink(page, email);
  await page.goto(link);
  await page.getByRole('button', { name: 'Ouvrir mon espace' }).click();
  await expect(page).toHaveURL(new RegExp(`${ESPACE}/`));
  return link;
}

/** GET sans suivre la redirection, avec les cookies de la page : statut et chemin de `Location`. */
async function redirectOf(page: Page, path: string, baseURL: string | undefined) {
  const response = await page.request.get(path, { maxRedirects: 0 });
  const location = response.headers()['location'];
  return { status: response.status(), path: location ? new URL(location, baseURL).pathname : null, location };
}

test.describe('F-100 : /connexion avec une session valable redirige (V1-B)', () => {
  test.fixme(true, MARKER);

  test('sans `next` : 303 vers l’accueil de l’édition ; avec un `next` interne : 303 vers ce chemin ; `next` externe ou d’une autre édition : accueil', async ({ page, baseURL }) => {
    await signIn(page, JULES);
    const mailsBefore = readOutbox().length;

    const home = await redirectOf(page, `${ESPACE}/connexion`, baseURL);
    expect(home.status).toBe(303);
    expect(home.path).toBe(`${ESPACE}/`);

    const agenda = await redirectOf(page, `${ESPACE}/connexion?next=${encodeURIComponent(`${ESPACE}/agenda`)}`, baseURL);
    expect(agenda.status).toBe(303);
    expect(agenda.path).toBe(`${ESPACE}/agenda`);

    for (const next of ['https://exemple.org', '//exemple.org', '/espace/autre-edition/agenda']) {
      const refused = await redirectOf(page, `${ESPACE}/connexion?next=${encodeURIComponent(next)}`, baseURL);
      expect(refused.status, next).toBe(303);
      expect(refused.path, next).toBe(`${ESPACE}/`);
    }
    expect(readOutbox().length, 'aucun lien émis').toBe(mailsBefore);
  });

  test('dans le navigateur : la page de connexion mène à l’agenda avec `next`', async ({ page, baseURL }) => {
    await signIn(page, JULES);
    await page.goto(`${ESPACE}/connexion?next=${encodeURIComponent(`${ESPACE}/agenda`)}`);
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/agenda`);
  });
});

test.describe('F-101 : /verifier avec un jeton inutilisable et une session valable (V1-B)', () => {
  test.fixme(true, MARKER);

  test('jeton déjà utilisé et session active : 303 vers `next` ; jeton inconnu : idem', async ({ page, baseURL }) => {
    const link = await signIn(page, ALICE);
    const next = encodeURIComponent(`${ESPACE}/agenda`);

    const used = await redirectOf(page, `${link}&next=${next}`, baseURL);
    expect(used.status).toBe(303);
    expect(used.path).toBe(`${ESPACE}/agenda`);

    const unknown = await redirectOf(page, `/espace/verifier?token=jeton-inconnu&next=${next}`, baseURL);
    expect(unknown.status).toBe(303);
    expect(unknown.path).toBe(`${ESPACE}/agenda`);
  });

  test('sans session : l’écran « Ce lien n’est plus valable » et son formulaire restent', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, extraHTTPHeaders: { 'X-Forwarded-For': '10.201.0.1' } });
    try {
      const page = await context.newPage();
      await page.goto(`/espace/verifier?token=jeton-inconnu&next=${encodeURIComponent(`${ESPACE}/agenda`)}`);
      await expect(page.getByRole('heading', { level: 2 })).toHaveText(INVALID_STATE);
      await expect(page.getByRole('button', { name: 'Recevoir un nouveau lien' })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('session d’une autre édition ou sans `next` : l’écran « plus valable » reste', async ({ page }) => {
    await signIn(page, ALICE);
    await page.goto('/espace/verifier?token=jeton-inconnu');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(INVALID_STATE);
  });
});

test.describe('F-102 : `next` survit à une nouvelle demande de lien (V1-B)', () => {
  test.fixme(true, MARKER);

  test('depuis « plus valable » : le formulaire transmet `next`, l’e-mail porte le même `next`, le lien ouvre ce chemin (critère 4)', async ({ page, browser, baseURL }) => {
    const first = await receiveLink(page, MANON);
    await page.goto(first);
    await page.getByRole('button', { name: 'Ouvrir mon espace' }).click();
    await expect(page).toHaveURL(new RegExp(`${ESPACE}/`));

    const next = `${ESPACE}/agenda`;
    const context = await browser.newContext({ baseURL, extraHTTPHeaders: { 'X-Forwarded-For': '10.201.0.2' } });
    try {
      const other = await context.newPage();
      await other.goto(`${first}&next=${encodeURIComponent(next)}`);
      await expect(other.getByRole('heading', { level: 2 })).toHaveText(INVALID_STATE);
      const already = mailsTo(MANON, ACCESS_LINK_SUBJECT).length;
      await other.getByRole('button', { name: 'Recevoir un nouveau lien' }).click();
      await expect(other).toHaveURL(/\/connexion\?envoye=1/);

      const link = linkOf(await nextMail(MANON, already));
      expect(new URL(link).searchParams.get('next')).toBe(next);

      await other.goto(link);
      await other.getByRole('button', { name: 'Ouvrir mon espace' }).click();
      await expect(other).toHaveURL(`${baseURL}${next}`);
    } finally {
      await context.close();
    }
  });

  test('un `next` externe dans l’adresse de la page de connexion ne passe pas dans le lien', async ({ page }) => {
    const already = mailsTo(CLARA, ACCESS_LINK_SUBJECT).length;
    await page.goto(`${ESPACE}/connexion?next=${encodeURIComponent('https://exemple.org')}`);
    await page.getByLabel('Adresse e-mail utilisée pour l’inscription').fill(CLARA);
    await page.getByRole('button', { name: 'Recevoir mon lien' }).click();
    await expect(page).toHaveURL(/\?envoye=1/);
    expect(new URL(linkOf(await nextMail(CLARA, already))).searchParams.get('next')).toBeNull();
  });
});

test.describe('« Lien envoyé » rappelle l’adresse saisie (V1-B)', () => {
  test.fixme(true, MARKER);

  test('l’état affiche l’adresse, échappée ; « Demander un nouveau lien » la préremplit', async ({ page }) => {
    const address = 'rappel&test@example.org';
    await requestLink(page, address);
    await expect(page).toHaveURL(/\?envoye=1/);
    await expect(page.getByRole('status')).toContainText(address);

    await page.getByRole('link', { name: 'Demander un nouveau lien' }).click();
    await expect(page.getByLabel('Adresse e-mail utilisée pour l’inscription')).toHaveValue(address);
  });
});

test.describe('F-104 : une session expirée en cours de route renvoie à la connexion (V1-B)', () => {
  test.fixme(true, MARKER);

  test('réponse 401 reçue par un îlot : redirection vers /connexion?next=<page>&expire=1 et message dédié', async ({ page, baseURL }) => {
    await signIn(page, JULES);
    await page.goto(`${ESPACE}/profil`);
    await hydrated(page);

    // La session disparaît côté navigateur : le prochain appel de l'îlot reçoit 401.
    await page.context().clearCookies();
    await page.getByLabel('Fonction (facultatif)').fill('Responsable');
    await page.getByRole('button', { name: /Enregistrer/ }).click();

    await expect(page).toHaveURL(`${baseURL}${ESPACE}/connexion?next=${encodeURIComponent(`${ESPACE}/profil`)}&expire=1`);
    await expect(page.getByText('Votre session a expiré, demandez un nouveau lien')).toBeVisible();
  });

  test('la page de connexion sans `expire` n’affiche pas ce message', async ({ page }) => {
    await page.goto(`${ESPACE}/connexion`);
    await expect(page.getByText('Votre session a expiré')).toHaveCount(0);
  });
});

test.describe('F-103 : un organisateur atteint le pilotage quand l’espace est fermé (V1-B)', () => {
  test.fixme(true, MARKER);

  // Le serveur e2e n'offre aucune route pour fermer l'édition : la colonne est basculée dans la base e2e, puis rétablie.
  const requireFromStrapi = createRequire(import.meta.url);
  const { e2eDatabaseName, DB_SERVER } = requireFromStrapi('../../../strapi/tests/helpers/env.js');
  const { Client } = createRequire(requireFromStrapi.resolve('../../../strapi/package.json'))('pg');

  async function setEnabled(enabled: boolean) {
    const client = new Client({ host: DB_SERVER.host, port: DB_SERVER.port, user: DB_SERVER.user, password: DB_SERVER.password, database: e2eDatabaseName() });
    await client.connect();
    try {
      await client.query('update editions set participant_space_enabled = $1 where slug = $2', [enabled, EDITION]);
    } finally {
      await client.end();
    }
  }

  test.beforeAll(() => setEnabled(false));
  test.afterAll(() => setEnabled(true));

  test('l’organisateur demande un lien, se connecte et ouvre le pilotage ; les autres écrans lui renvoient vers le pilotage', async ({ page, baseURL }) => {
    const link = await receiveLink(page, ORGANIZER);
    await page.goto(link);
    await page.getByRole('button', { name: 'Ouvrir mon espace' }).click();

    await page.goto(`${ESPACE}/organisateur`);
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/organisateur`);
    await hydrated(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Rendez-vous par pause B2B' })).toBeVisible();

    await page.goto(`${ESPACE}/agenda`);
    await expect(page.getByRole('link', { name: /pilotage/i }).first()).toBeVisible();
  });

  test('un participant ne reçoit aucun lien et ne passe pas', async ({ page }) => {
    const already = readOutbox().filter((mail) => mail.to.email === JULES).length;
    await requestLink(page, JULES);
    await page.waitForTimeout(800);
    expect(readOutbox().filter((mail) => mail.to.email === JULES).length).toBe(already);
  });
});

test.describe('sans JavaScript (V1-B)', () => {
  test.fixme(true, MARKER);
  test.use({ javaScriptEnabled: false });

  test('F-100 : /connexion avec une session redirige vers l’accueil', async ({ page, baseURL, context }) => {
    // Session ouverte avec JavaScript dans un contexte voisin, cookies repris ici.
    const helper: BrowserContext = await page.context().browser()!.newContext({ baseURL, extraHTTPHeaders: { 'X-Forwarded-For': '10.201.0.3' } });
    try {
      const withJs = await helper.newPage();
      await signIn(withJs, CLARA);
      await context.addCookies(await helper.cookies());
    } finally {
      await helper.close();
    }
    await page.goto(`${ESPACE}/connexion`);
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/`);
  });
});
