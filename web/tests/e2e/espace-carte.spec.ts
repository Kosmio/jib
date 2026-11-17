import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { STRAPI_URL } from './fixtures';
import { ACCESS_LINK_SUBJECT, EDITION, ESPACE, expect, expectOnlyServiceWorkerScript, hydrated, linkOf, mailsTo, nextMail, openSpace, test } from './espace';

/**
 * Carte publique ouverte par le QR code d'un badge, lot V4-D1 (12-badges.md) : F-95, F-96, R-80 à R-84, NF-54, NF-57, T-60, T-61, T-63, T-67.
 *
 * Les jetons viennent du vrai parcours : l'organisateur ouvre sa session (une seule connexion pour tout le fichier), demande le badge à
 * l'unité d'un inscrit du seed de recette, et l'adresse lue dans l'annotation /URI du PDF est celle que le QR porte. Ensuite la page est ouverte
 * comme le fait un scanneur : sans session, sans JavaScript pour lire la carte.
 *
 * Données du seed : Léa Ducasse (profil visible, présentation, deux sujets), Tom Laffitte (profil masqué, jamais connecté : R-84),
 * Clara Dubourdieu (profil masqué). Scanneurs : Hugo Peyrat et Manon Bordenave, qui ouvrent une session par le lien de l'e-mail.
 * Le dernier test est le seul qui dépasse 30 lectures de carte en une minute (NF-54) : il passe en dernier.
 */

const ORGANIZER = 'organisation@example.org';
const HUGO = 'hugo.peyrat@example.org';
const MANON = 'manon.bordenave@example.org';
const NOT_VALID = 'Cette carte n’est plus valable';
const LOGIN_BUTTON = 'Se connecter pour proposer un rendez-vous';

type Person = { id: string; token: string };
type Tokens = { lea: Person; tom: Person; clara: Person };

let tokens: Tokens | undefined;
let organizerSession: Awaited<ReturnType<BrowserContext['cookies']>> = [];

async function badgeToken(api: APIRequestContext, id: string): Promise<string> {
  const response = await api.get(`${STRAPI_URL}/api/espace/admin/${EDITION}/attendees/${id}/badge`);
  expect(response.status(), 'badge à l’unité').toBe(200);
  expect(response.headers()['content-type']).toBe('application/pdf');
  const uri = /\/URI \((https?:[^)]+)\)/.exec((await response.body()).toString('latin1'))?.[1];
  expect(uri, 'annotation /URI du QR').toBeTruthy();
  const token = uri!.split('/').pop()!;
  expect(uri).toBe(`${new URL(uri!).origin}${cardPath(token)}`);
  return token;
}

const cardPath = (token: string) => `${ESPACE}/carte/${token}`;

/** Ouvre la session de l'organisateur une seule fois pour le fichier (cinq demandes de lien par adresse et par quinze minutes). */
async function loadTokens(page: Page, baseURL: string | undefined): Promise<Tokens> {
  if (tokens) return tokens;
  await openSpace(page, ORGANIZER);
  if (page.url().endsWith('/bienvenue')) {
    await hydrated(page);
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('button', { name: 'Continuer sans apparaître' }).click();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/`);
  }
  organizerSession = await page.context().cookies();
  const api = page.context().request;
  const idOf = async (query: string): Promise<string> => {
    const list = await api.get(`${STRAPI_URL}/api/espace/admin/${EDITION}/attendees?q=${encodeURIComponent(query)}`);
    expect(list.status()).toBe(200);
    const { items } = (await list.json()) as { items: { id: string }[] };
    expect(items, `un seul inscrit pour « ${query} »`).toHaveLength(1);
    return items[0].id;
  };
  const make = async (query: string): Promise<Person> => {
    const id = await idOf(query);
    return { id, token: await badgeToken(api, id) };
  };
  tokens = { lea: await make('ducasse'), tom: await make('laffitte'), clara: await make('dubourdieu') };
  return tokens;
}

/** Une session déjà ouverte sur l'espace par le lien de l'e-mail, depuis la page de connexion que le bouton de la carte atteint. */
async function signInFromLoginPage(page: Page, email: string): Promise<void> {
  const already = mailsTo(email, ACCESS_LINK_SUBJECT).length;
  await page.getByLabel('Adresse e-mail utilisée pour l’inscription').fill(email);
  await page.getByRole('button', { name: 'Recevoir mon lien' }).click();
  await expect(page).toHaveURL(/\?envoye=1(&|$)/);
  await page.goto(linkOf(await nextMail(email, already)));
  await page.getByRole('button', { name: 'Ouvrir mon espace' }).click();
}

test.describe.configure({ mode: 'serial' });

test('préparation : l’organisateur demande le badge à l’unité de trois inscrits de la recette, l’adresse du QR est lue dans le PDF', async ({ page, baseURL }) => {
  const ready = await loadTokens(page, baseURL);
  for (const { token } of Object.values(ready)) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(new Set(Object.values(ready).map(({ token }) => token)).size, 'un jeton par inscrit').toBe(3);
});

test.describe('carte publique : contenu, en-têtes, sans session ni JavaScript (T-60, T-61, F-95, NF-57)', () => {
  test.use({ javaScriptEnabled: false });

  test('T-60 : profil visible, sans session et sans JavaScript : la fiche de R-42, un bouton de connexion, jamais l’e-mail', async ({ page }) => {
    const response = await page.goto(cardPath(tokens!.lea.token));
    expect(response!.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Léa Ducasse' })).toBeVisible();
    await expect(page.getByText('Responsable bureau d’études', { exact: true })).toBeVisible();
    await expect(page.getByText('Charpentes du Pibal', { exact: true })).toBeVisible();
    await expect(page.getByText('Participant', { exact: true })).toBeVisible();
    await expect(page.getByText('Responsable du bureau d’études de Charpentes du Pibal.', { exact: false })).toBeVisible();
    const topics = page.getByRole('list', { name: 'Sujets' }).getByRole('listitem');
    await expect(topics).toHaveText(['Construction bois', 'Process, data et IA']);
    await expect(page.getByRole('link', { name: LOGIN_BUTTON })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Espace participant' }), 'aucune navigation de l’espace sans session').toHaveCount(0);

    const html = await response!.text();
    for (const forbidden of ['lea.ducasse@example.org', '@example.org', 'mailto:', 'tel:']) expect(html, forbidden).not.toContain(forbidden);
    expect(html, 'le jeton ne figure pas dans la page rendue').not.toContain(tokens!.lea.token);
    await expectOnlyServiceWorkerScript(page);
  });

  test('F-95, NF-57 : en-têtes de la page (private no-store, strict-origin, noindex), aucun cookie posé', async ({ page }) => {
    const response = await page.goto(cardPath(tokens!.lea.token));
    const headers = response!.headers();
    expect(headers['cache-control']).toBe('private, no-store');
    expect(headers['referrer-policy']).toBe('strict-origin');
    expect(headers['x-robots-tag']).toContain('noindex');
    expect(headers['set-cookie']).toBeUndefined();
    expect(await page.context().cookies()).toEqual([]);
    const csp = headers['content-security-policy'] ?? '';
    expect(csp).not.toMatch(/https?:\/\/(?!localhost|127\.0\.0\.1)/);
  });

  test('T-61, R-84 : profil masqué, jamais connecté : seulement nom, fonction, entreprise et type, ni photo, ni présentation, ni sujets', async ({ page }) => {
    const response = await page.goto(cardPath(tokens!.tom.token));
    expect(response!.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Tom Laffitte' })).toBeVisible();
    await expect(page.getByText('Gérant', { exact: true })).toBeVisible();
    await expect(page.getByText('Menuiseries Laffitte', { exact: true })).toBeVisible();
    await expect(page.getByText('Participant', { exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Sujets' })).toHaveCount(0);
    await expect(page.locator('img[alt=""]'), 'aucune photo de profil (l’avatar a un alt vide ; le bandeau porte les logos)').toHaveCount(0);
    await expect(page.getByRole('link', { name: LOGIN_BUTTON })).toBeVisible();
    const html = await response!.text();
    for (const forbidden of ['laffitte@example', '@example.org', '/uploads/', 'aria-label="Sujets"']) expect(html, forbidden).not.toContain(forbidden);
  });

  test('profil masqué par choix (Clara) : même carte réduite, aucune présentation ni sujet dans le HTML', async ({ page }) => {
    const response = await page.goto(cardPath(tokens!.clara.token));
    expect(response!.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Clara Dubourdieu' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Sujets' })).toHaveCount(0);
    const html = await response!.text();
    expect(html).not.toContain('clara.dubourdieu@example.org');
    expect(html).not.toContain('/uploads/');
  });

  test('T-63 : jeton inconnu, jeton d’une autre édition, jeton mal formé : la même page « Cette carte n’est plus valable », 404', async ({ page }) => {
    const unknown = tokens!.lea.token.replace(/.$/, (last) => (last === 'A' ? 'B' : 'A'));
    const cases = [
      `${ESPACE}/carte/${unknown}`,
      `/espace/autre-edition-inconnue/carte/${tokens!.lea.token}`,
      `${ESPACE}/carte/trop-court`,
    ];
    let reference = '';
    for (const path of cases) {
      const response = await page.goto(path);
      expect(response!.status(), path).toBe(404);
      await expect(page.getByRole('heading', { name: NOT_VALID }), path).toBeVisible();
      expect(response!.headers()['cache-control'], path).toBe('private, no-store');
      expect(response!.headers()['referrer-policy'], path).toBe('strict-origin');
      const html = await response!.text();
      expect(html).not.toContain('Léa');
      const body = (await page.locator('main').innerText()).trim();
      reference ||= body;
      expect(body, path).toBe(reference);
    }
  });
});

test.describe('carte publique : régénération du jeton (T-64) et retour après connexion (T-67, F-96)', () => {
  test('T-64 : après « Régénérer », l’ancienne adresse du QR répond « plus valable » et la nouvelle ouvre la carte', async ({ page, baseURL }) => {
    const old = tokens!.tom.token;
    expect((await page.goto(cardPath(old)))!.status()).toBe(200);

    // L'organisateur régénère le jeton de Tom (session reprise du premier parcours, Origin du site) puis réimprime son badge.
    await page.context().addCookies(organizerSession);
    const api = page.context().request;
    const regenerated = await api.post(`${STRAPI_URL}/api/espace/admin/${EDITION}/attendees/${tokens!.tom.id}/card-token/regenerate`, { headers: { Origin: baseURL! }, data: {} });
    expect(regenerated.status()).toBe(200);
    expect(Object.keys(await regenerated.json())).toEqual(['regeneratedAt']);
    const fresh = await badgeToken(api, tokens!.tom.id);
    expect(fresh).not.toBe(old);
    tokens!.tom.token = fresh;

    await page.context().clearCookies();
    const refused = await page.goto(cardPath(old));
    expect(refused!.status()).toBe(404);
    await expect(page.getByRole('heading', { name: NOT_VALID })).toBeVisible();
    const opened = await page.goto(cardPath(fresh));
    expect(opened!.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Tom Laffitte' })).toBeVisible();
  });

  test('T-67 : scan sans session, « Se connecter », connexion par le lien de l’e-mail : retour sur la fiche visée de l’annuaire', async ({ page, baseURL }) => {
    await page.goto(cardPath(tokens!.lea.token));
    await page.getByRole('link', { name: LOGIN_BUTTON }).click();
    await expect(page).toHaveURL(new RegExp(`${ESPACE}/connexion\\?next=`));
    expect(new URL(page.url()).searchParams.get('next')).toBe(`${ESPACE}/annuaire/p/${tokens!.lea.id}`);
    await signInFromLoginPage(page, HUGO);
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/annuaire/p/${tokens!.lea.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Léa Ducasse');

    // F-96 : un scanneur déjà connecté est envoyé directement à la fiche ; la carte d'un profil masqué reste sur la carte (R-41).
    const direct = await page.goto(cardPath(tokens!.lea.token));
    expect(direct!.status()).toBe(200);
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/annuaire/p/${tokens!.lea.id}`);
    await page.goto(cardPath(tokens!.clara.token));
    await expect(page).toHaveURL(`${baseURL}${cardPath(tokens!.clara.token)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Clara Dubourdieu' })).toBeVisible();
  });

  test('F-96 : après connexion, si R-41 masque la fiche visée, le scanneur arrive sur l’accueil (E1) et non sur une page d’erreur', async ({ page, baseURL }) => {
    test.fail(true, 'défaut : le bouton de la carte mène à next=/annuaire/p/{id} sans condition, la connexion y renvoie, et la fiche masquée répond 404 au lieu d’amener sur E1 (F-96)');
    await page.goto(cardPath(tokens!.clara.token));
    await page.getByRole('link', { name: LOGIN_BUTTON }).click();
    await signInFromLoginPage(page, MANON);
    await expect(page).toHaveURL(new RegExp(`${ESPACE}/(bienvenue)?$`));
    await expect(page.getByRole('heading', { name: NOT_VALID })).toHaveCount(0);
  });
});

test.describe('NF-54 : limitation de débit', () => {
  test('la page de la carte lit Strapi avec l’adresse du visiteur : 35 visiteurs différents en une minute ne sont pas limités ensemble', async ({ page, baseURL }) => {
    test.fail(true, 'le rendu serveur appelle Strapi sans X-Forwarded-For : tous les scans partagent l’IP du serveur web, donc 30 scans par minute pour tout le monde');
    await loadTokens(page, baseURL);
    const statuses: number[] = [];
    for (let visitor = 1; visitor <= 35; visitor += 1) {
      const response = await page.context().request.get(`${baseURL}${cardPath(tokens!.lea.token)}`, { headers: { 'X-Forwarded-For': `10.88.0.${visitor}` }, maxRedirects: 0 });
      statuses.push(response.status());
    }
    expect(statuses.filter((status) => status === 429)).toEqual([]);
  });
});
