import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { BrowserContext, Page } from '@playwright/test';
import { STRAPI_URL, expect, test as base } from './fixtures';

/**
 * Aides des tests de bout en bout de l'espace participant (lot 7, phase 1).
 *
 * - Réseau strict : les pages de l'espace n'appellent aucun hôte hors localhost, polices Google comprises (NF-23). La tolérance de
 *   `fixtures.ts` ne vaut que pour les pages publiques ; tout test écrit avec ce `test` échoue à la première sortie.
 * - IP : chaque test prend la sienne (`X-Forwarded-For`, lu par Strapi derrière un proxy), pour que la limitation de débit de la demande
 *   de lien (5 par 15 minutes et par IP, NF-03) ne lie pas les tests entre eux.
 * - Boîte de sortie : le fichier JSONL du fournisseur `console`, supprimé au démarrage de Strapi (strapi/tests/e2e-server.js).
 * - Captures : sans `E2E_CAPTURES_DIR`, `capture` ne fait rien. Avec, elle enregistre l'écran à 390 et 1280 px (revue du designer).
 */

// Même formule que le serveur e2e : un fichier par base, dans le dossier temporaire du système.
const { buildTestEnv, e2eDatabaseName } = createRequire(import.meta.url)('../../../strapi/tests/helpers/env.js');
export const OUTBOX_FILE: string = buildTestEnv({ database: e2eDatabaseName() }).EMAIL_OUTBOX_FILE;

/** Requête SQL sur la base e2e (conteneur jib-postgres) : le résultat en lignes, colonnes séparées par « | ». Pour poser ou restaurer un état de départ. */
export function psql(sql: string): string[] {
  const result = spawnSync('docker', ['exec', 'jib-postgres', 'psql', '-U', 'strapi', '-d', e2eDatabaseName(), '-At', '-c', sql], { encoding: 'utf8', timeout: 60_000 });
  if (result.status !== 0) throw new Error(`psql a échoué : ${result.stderr}`);
  return result.stdout.split('\n').filter(Boolean);
}

export const EDITION = 'nouvelle-aquitaine-test';
export const ESPACE = `/espace/${EDITION}`;
export const ACCESS_LINK_SUBJECT = 'Votre lien de connexion à l’espace participant';

export const test = base.extend<{ clientIp: string; strictNetwork: void }>({
  clientIp: async ({}, use) => {
    await use(`10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`);
  },
  extraHTTPHeaders: async ({ clientIp }, use) => {
    await use({ 'X-Forwarded-For': clientIp });
  },
  strictNetwork: [
    async ({ network }, use) => {
      await use();
      expect([...new Set(network.blockedHosts)], 'requêtes sortantes de l’espace (aucune tolérée, polices Google comprises)').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export type Mail = {
  to: { email: string; name?: string };
  subject: string;
  html: string;
  text: string;
  sentAt: string;
  attachments?: { filename: string; content: string; contentType?: string }[];
};

export const NBSP = String.fromCharCode(0xa0);

export function readOutbox(): Mail[] {
  if (!existsSync(OUTBOX_FILE)) return [];
  return readFileSync(OUTBOX_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export const mailsTo = (email: string, subject?: string) =>
  readOutbox().filter((mail) => mail.to.email === email && (subject === undefined || mail.subject === subject));

/** Messages d'une adresse dont l'objet commence par `prefix` (l'objet porte une espace insécable avant les deux-points). */
export const mailsStartingWith = (email: string, prefix: string) => readOutbox().filter((mail) => mail.to.email === email && mail.subject.startsWith(prefix));

/** Attend qu'il y ait `count` messages à cette adresse dont l'objet commence par `prefix`, et les rend. */
export async function waitForMails(email: string, prefix: string, count = 1): Promise<Mail[]> {
  await expect
    .poll(() => mailsStartingWith(email, prefix).length, { message: `${count} e-mail(s) « ${prefix}… » pour ${email}`, timeout: 15_000 })
    .toBeGreaterThanOrEqual(count);
  return mailsStartingWith(email, prefix);
}

/** Attend le message qui suit les `already` déjà présents pour cette adresse (l'envoi est détaché de la réponse, A-19). */
export async function nextMail(email: string, already: number, subject = ACCESS_LINK_SUBJECT): Promise<Mail> {
  await expect.poll(() => mailsTo(email, subject).length, { message: `e-mail « ${subject} » pour ${email}`, timeout: 15_000 }).toBeGreaterThan(already);
  return mailsTo(email, subject)[already];
}

/** Adresse de vérification du message : l'URL de `…/espace/verifier?token=…` dans la version texte. */
export function linkOf(mail: Mail): string {
  const match = mail.text.match(/https?:\/\/[^\s"'<>)]+\/espace\/verifier\?[^\s"'<>)]+/);
  if (!match) throw new Error(`Aucun lien de vérification dans l’e-mail « ${mail.subject} »`);
  return match[0];
}

/** Ouvre E0, saisit l'adresse et envoie le formulaire (la page d'arrivée est à vérifier par l'appelant). */
export async function requestLink(page: Page, email: string) {
  await page.goto(`${ESPACE}/connexion`);
  await page.getByLabel('Adresse e-mail utilisée pour l’inscription').fill(email);
  await page.getByRole('button', { name: 'Recevoir mon lien' }).click();
}

/** Demande un lien depuis E0 puis lit l'e-mail reçu : l'adresse du lien. */
export async function receiveLink(page: Page, email: string): Promise<string> {
  const already = mailsTo(email, ACCESS_LINK_SUBJECT).length;
  await requestLink(page, email);
  await expect(page).toHaveURL(/\?envoye=1$/);
  return linkOf(await nextMail(email, already));
}

/**
 * Ouvre une session par le parcours réel : E0, e-mail, lien lu dans la boîte de sortie, « Ouvrir mon espace ». Chaque appel consomme une
 * demande de lien de l'adresse (5 par 15 minutes, NF-03) : à réserver aux tests qui vérifient ce parcours. Les autres appellent `openSpace`.
 */
export async function openSpaceByLink(page: Page, email: string): Promise<void> {
  await page.goto(await receiveLink(page, email));
  await page.getByRole('button', { name: 'Ouvrir mon espace' }).click();
  await expect(page).toHaveURL(new RegExp(`${ESPACE}/(bienvenue)?$`));
  rememberSession(email, await page.context().cookies());
}

type Cookies = Awaited<ReturnType<BrowserContext['cookies']>>;

// Sessions des personas, partagées par tous les fichiers de la suite : Strapi limite les liens à 5 par adresse et par 15 minutes (NF-03) et
// la suite entière tourne contre un seul Strapi. Le fichier survit au redémarrage du worker après un échec ; il est propre à la base e2e,
// et une session périmée (autre exécution, déconnexion, effacement) est détectée par GET /api/espace/me, puis remplacée.
const SESSIONS_FILE = `${OUTBOX_FILE}.sessions.json`;

function loadSessions(): Record<string, Cookies> {
  try {
    return JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function rememberSession(email: string, cookies: Cookies) {
  writeFileSync(SESSIONS_FILE, JSON.stringify({ ...loadSessions(), [email]: cookies }));
}

/**
 * Arrive sur l'accueil de l'espace (ou sur E2) avec la session de ce persona. La session déjà ouverte par un test précédent est reprise
 * (cookie) après vérification par GET /api/espace/me ; sinon, le parcours réel du lien est suivi (`openSpaceByLink`).
 */
export async function openSpace(page: Page, email: string): Promise<void> {
  const known = loadSessions()[email];
  if (known) {
    await page.context().addCookies(known);
    const response = await page.request.get(`${STRAPI_URL}/api/espace/me`, { failOnStatusCode: false });
    if (response.ok()) {
      await page.goto(`${ESPACE}/`);
      await expect(page).toHaveURL(new RegExp(`${ESPACE}/(bienvenue)?$`));
      return;
    }
    await page.context().clearCookies();
  }
  await openSpaceByLink(page, email);
}

/**
 * Erreurs de console et réponses en échec des sous-ressources (appels de l'API, scripts, feuilles de style, images, polices). Les erreurs de
 * script non rattrapées sont déjà vues par la fixture `network`. À appeler avant la navigation, puis `expectClean()` à la fin.
 */
export function watchConsole(page: Page) {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console : ${message.text()}`);
  });
  page.on('response', (response) => {
    const type = response.request().resourceType();
    if (type !== 'document' && response.status() >= 400) problems.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  return { problems, expectClean: () => expect(problems, 'erreurs de console et réponses en échec').toEqual([]) };
}

/** Attend que les îlots de la page soient hydratés : avant, un clic sur un bouton React ne fait rien. */
export const hydrated = (page: Page) => expect(page.locator('astro-island[ssr]')).toHaveCount(0);

/** Onglet de la coquille de l'espace (barre basse, latérale dès 1024 px) : « Accueil », « Annuaire », « Agenda », « Messages », « Programme ». */
export const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Espace participant' }).getByRole('link', { name });

/** Balises <script> de la page : l'adresse (`src`) ou le texte du script en ligne. */
export const scriptTags = (page: Page) =>
  page.locator('script').evaluateAll((nodes) => nodes.map((node) => ({ src: node.getAttribute('src'), text: node.textContent ?? '' })));

/**
 * La seule balise <script> d'une page sans îlot est l'enregistrement du service worker de /espace/ (F-05, NF-24) : en ligne, sans fichier à
 * charger, et rien d'autre.
 */
export async function expectOnlyServiceWorkerScript(page: Page) {
  const scripts = await scriptTags(page);
  expect(scripts.filter((script) => script.src), 'fichiers JavaScript référencés').toEqual([]);
  expect(scripts, 'balises <script> en ligne').toHaveLength(1);
  expect(scripts[0].text).toMatch(/serviceWorker\.register\(["']\/espace\/sw\.js["']/);
}

const CAPTURES_DIR = process.env.E2E_CAPTURES_DIR;
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];

/** Revue du designer : page entière à 390 et 1280 px, sous `E2E_CAPTURES_DIR/<nom>-<largeur>.png`. Sans la variable, ne fait rien. */
export async function capture(page: Page, name: string) {
  if (!CAPTURES_DIR) return;
  const original = page.viewportSize();
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: `${CAPTURES_DIR}/${name}-${viewport.width}.png`, fullPage: true });
  }
  if (original) await page.setViewportSize(original);
}
