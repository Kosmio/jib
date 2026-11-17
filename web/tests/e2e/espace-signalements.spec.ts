import type { BrowserContext, Page } from '@playwright/test';
import { STRAPI_URL } from './fixtures';
import { EDITION, ESPACE, expect, hydrated, mailsTo, openSpace, test, watchConsole } from './espace';

/**
 * Signalement d'un message, lot V5-B (F-75, R-63) : Léa Ducasse signale un message de Mathis Lagrange depuis le fil ; l'organisation reçoit
 * l'e-mail sans contenu, lit dans le pilotage ce seul message, le marque comme traité.
 *
 * Données : la conversation Léa et Mathis du seed de recette (trois messages ; Léa reçoit le premier et le troisième de Mathis). Les tests
 * se suivent : le signalement du premier alimente le pilotage du dernier. Base e2e vidée à la suite suivante.
 */

const LEA = 'lea.ducasse@example.org';
const ORGANIZER = 'organisation@example.org';
const RECEIVED_FIRST = 'Bonjour Léa, j’ai accepté votre demande pour 10h45. Quels panneaux vous intéressent ?';
const RECEIVED_LAST = 'J’apporterai nos échantillons de panneaux.';
const OWN = 'Bonjour Mathis, merci. Je pense surtout aux panneaux pour les cloisons intérieures.';
const REASON = 'Propos hors sujet et insistants.';
const SENT = 'Signalement transmis à l’organisation';
const MAIL_SUBJECT = 'Un message a été signalé';

test.describe.configure({ mode: 'serial' });

// La demande de lien est limitée par adresse (NF-03) : la session de chaque personne est ouverte une fois, puis réutilisée.
const sessions = new Map<string, Awaited<ReturnType<BrowserContext['cookies']>>>();

async function signIn(page: Page, baseURL: string | undefined, email: string) {
  const known = sessions.get(email);
  if (known) {
    await page.context().addCookies(known);
    return;
  }
  await openSpace(page, email);
  await welcomeIfNeeded(page, baseURL);
  sessions.set(email, await page.context().cookies());
}

async function welcomeIfNeeded(page: Page, baseURL: string | undefined) {
  if (page.url().endsWith('/bienvenue')) {
    await hydrated(page);
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('button', { name: 'Continuer sans apparaître' }).click();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/`);
  }
}

async function openThread(page: Page, baseURL: string | undefined) {
  await signIn(page, baseURL, LEA);
  await page.goto(`${ESPACE}/messages`);
  await page.getByRole('link', { name: /Mathis Lagrange/ }).first().click();
  await hydrated(page);
  await expect(page.getByRole('log', { name: 'Messages' })).toBeVisible();
}

const messageOf = (page: Page, body: string) => page.getByRole('log', { name: 'Messages' }).getByRole('listitem').filter({ hasText: body });

// L'adresse de ORGANIZER_EMAILS n'a pas d'inscrit avant sa première connexion (seed) : l'e-mail ne part qu'aux Attendee actifs, la session
// de l'organisation est donc ouverte avant le premier signalement.
test('l’organisation ouvre sa session avant les signalements', async ({ page, baseURL }) => {
  await signIn(page, baseURL, ORGANIZER);
  await page.goto(`${ESPACE}/organisateur`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pilotage de l’édition');
});

test.describe('dans le fil (F-75)', () => {
  test('« Signaler » n’est proposé que sur les messages reçus, jamais sur les siens', async ({ page, baseURL }) => {
    await openThread(page, baseURL);
    await expect(messageOf(page, RECEIVED_FIRST).getByRole('button', { name: /Signaler/ })).toBeVisible();
    await expect(messageOf(page, RECEIVED_LAST).getByRole('button', { name: /Signaler/ })).toBeVisible();
    await expect(messageOf(page, OWN).getByRole('button', { name: /Signaler/ })).toHaveCount(0);
  });

  test('le motif est obligatoire, Annuler referme le formulaire sans rien envoyer', async ({ page, baseURL }) => {
    await openThread(page, baseURL);
    const message = messageOf(page, RECEIVED_LAST);
    await message.getByRole('button', { name: /Signaler/ }).click();
    await expect(message.getByLabel('Motif du signalement')).toBeVisible();
    await expect(message.getByRole('button', { name: 'Confirmer le signalement' })).toBeDisabled();
    await message.getByLabel('Motif du signalement').fill('   ');
    await expect(message.getByRole('button', { name: 'Confirmer le signalement' })).toBeDisabled();
    await message.getByRole('button', { name: 'Annuler' }).click();
    await expect(message.getByLabel('Motif du signalement')).toHaveCount(0);
    await expect(message.getByText(SENT)).toHaveCount(0);
    await expect(message.getByRole('button', { name: /Signaler/ })).toBeVisible();
  });

  test('le champ du motif est limité à 500 caractères et compte les caractères saisis', async ({ page, baseURL }) => {
    await openThread(page, baseURL);
    const message = messageOf(page, RECEIVED_LAST);
    await message.getByRole('button', { name: /Signaler/ }).click();
    await message.getByLabel('Motif du signalement').fill('a'.repeat(600));
    await expect(message.getByLabel('Motif du signalement')).toHaveValue('a'.repeat(500));
    await expect(message.getByText(/500 \/ 500/)).toBeVisible();
  });

  test('confirmer envoie le signalement : « Signalement transmis à l’organisation », plus de bouton sur ce message, l’autre reste signalable', async ({ page, baseURL }) => {
    const console_ = watchConsole(page);
    await openThread(page, baseURL);
    const message = messageOf(page, RECEIVED_LAST);
    await message.getByRole('button', { name: /Signaler/ }).click();
    await message.getByLabel('Motif du signalement').fill(REASON);
    await message.getByRole('button', { name: 'Confirmer le signalement' }).click();
    await expect(message.getByText(SENT)).toBeVisible();
    await expect(message.getByRole('button', { name: /Signaler/ })).toHaveCount(0);
    await expect(messageOf(page, RECEIVED_FIRST).getByRole('button', { name: /Signaler/ })).toBeVisible();
    console_.expectClean();
  });

  test('un second signalement du même message (après rechargement) est reçu comme transmis, sans erreur affichée (409)', async ({ page, baseURL }) => {
    await openThread(page, baseURL);
    const message = messageOf(page, RECEIVED_LAST);
    await message.getByRole('button', { name: /Signaler/ }).click();
    await message.getByLabel('Motif du signalement').fill('Autre motif');
    const answer = page.waitForResponse((response) => response.url().includes('/report') && response.request().method() === 'POST');
    await message.getByRole('button', { name: 'Confirmer le signalement' }).click();
    expect((await answer).status()).toBe(409);
    await expect(message.getByText(SENT)).toBeVisible();
    await expect(message.getByRole('alert')).toHaveCount(0);
  });

  test('une panne du réseau affiche l’erreur lisible et garde le motif saisi', async ({ page, baseURL }) => {
    await openThread(page, baseURL);
    await page.route('**/api/espace/conversations/*/messages/*/report', (route) => route.abort('failed'));
    const message = messageOf(page, RECEIVED_FIRST);
    await message.getByRole('button', { name: /Signaler/ }).click();
    await message.getByLabel('Motif du signalement').fill(REASON);
    await message.getByRole('button', { name: 'Confirmer le signalement' }).click();
    await expect(message.getByRole('alert')).toContainText('Le signalement n’a pas pu être envoyé');
    await expect(message.getByLabel('Motif du signalement')).toHaveValue(REASON);
  });
});

test.describe('côté organisation (F-75, R-63)', () => {
  test('l’e-mail « Un message a été signalé » est parti, sans le message, le motif ni les noms', async () => {
    await expect.poll(() => mailsTo(ORGANIZER, MAIL_SUBJECT).length, { timeout: 15_000 }).toBe(1);
    const [mail] = mailsTo(ORGANIZER, MAIL_SUBJECT);
    const everything = `${mail.subject}\n${mail.text}\n${mail.html}`;
    for (const forbidden of [RECEIVED_LAST, RECEIVED_FIRST, 'échantillons', REASON, 'Lagrange', 'Ducasse']) {
      expect(everything, `« ${forbidden} » ne doit pas figurer dans l’e-mail`).not.toContain(forbidden);
    }
    expect(mail.text).toContain(`/espace/${EDITION}/organisateur`);
  });

  test('un participant reçoit 403 sur la file des signalements', async ({ page, baseURL }) => {
    await signIn(page, baseURL, LEA);
    const response = await page.context().request.get(`${STRAPI_URL}/api/espace/admin/${EDITION}/reports`);
    expect(response.status()).toBe(403);
  });

  test('le pilotage montre le seul message signalé, puis « Marquer comme traité » le range dans les traités', async ({ page, baseURL }) => {
    const console_ = watchConsole(page);
    await signIn(page, baseURL, ORGANIZER);
    await page.goto(`${ESPACE}/organisateur`);
    await hydrated(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Messages signalés' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'À traiter (1)' })).toBeVisible();
    const item = page.getByRole('listitem').filter({ hasText: 'a signalé un message de' });
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('Léa Ducasse a signalé un message de Mathis Lagrange');
    await expect(item).toContainText(REASON);
    await expect(item.getByText(RECEIVED_LAST)).toBeVisible();
    const content = (await page.locator('main').innerText()) ?? '';
    for (const other of [RECEIVED_FIRST, OWN]) expect(content, 'aucun autre message de la conversation').not.toContain(other);

    await item.getByRole('button', { name: /Marquer comme traité/ }).click();
    await expect(page.getByText('Signalement marqué comme traité.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'À traiter (0)' })).toBeVisible();
    await expect(page.getByText('Aucun signalement à traiter.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Traités (1)' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Marquer comme traité/ })).toHaveCount(0);
    console_.expectClean();
  });
});
