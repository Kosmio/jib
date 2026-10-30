import { randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { expect, test as base } from './fixtures';

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

export type Mail = { to: { email: string; name?: string }; subject: string; html: string; text: string; sentAt: string };

export function readOutbox(): Mail[] {
  if (!existsSync(OUTBOX_FILE)) return [];
  return readFileSync(OUTBOX_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export const mailsTo = (email: string, subject?: string) =>
  readOutbox().filter((mail) => mail.to.email === email && (subject === undefined || mail.subject === subject));

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
