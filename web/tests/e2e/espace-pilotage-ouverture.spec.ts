import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import type { BrowserContext, Page } from '@playwright/test';
import { ESPACE, expect, hydrated, openSpace, readOutbox, test, watchConsole } from './espace';

/**
 * Pilotage de l'édition, lot V1-C (A-39, F-105, R-85, F-106) : carte « État du service » en tête, carte « E-mail de bienvenue »,
 * cartes existantes inchangées après la découpe en composants (critère 7).
 *
 * Données : le seed pose un EmailLog `welcome` à chaque inscrit. Pour avoir des inscrits jamais invités, le test supprime ces lignes
 * pour trois participants de la base e2e (`psql` dans le conteneur jib-postgres), à l'état de départ de chaque test qui en a besoin.
 * Heure : le serveur lit son horloge ; un envoi réel n'est joué qu'entre 8h et 20h (Paris), sinon le test est ignoré. Le message de
 * refus hors plage est joué en interceptant la réponse du navigateur.
 */

const ORGANIZER = 'organisation@example.org';
const GUESTS = ['lea.ducasse@example.org', 'mathis.lagrange@example.org', 'ines.castaing@example.org'];
const { e2eDatabaseName } = createRequire(import.meta.url)('../../../strapi/tests/helpers/env.js');

/** Rend jamais invités les trois participants : supprime leurs EmailLog welcome. */
function forgetWelcomes(): void {
  const list = GUESTS.map((email) => `'${email}'`).join(',');
  const sql = `delete from espace_email_logs where template = 'welcome' and id in (select l.email_log_id from espace_email_logs_attendee_lnk l join espace_attendees a on a.id = l.attendee_id where a.email in (${list}))`;
  const result = spawnSync('docker', ['exec', 'jib-postgres', 'psql', '-U', 'strapi', '-d', e2eDatabaseName(), '-c', sql], { encoding: 'utf8', timeout: 60_000 });
  if (result.status !== 0) throw new Error(`psql a échoué : ${result.stderr}`);
}

const parisHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
const welcomeMailsTo = (emails: string[]) => readOutbox().filter((mail) => emails.includes(mail.to.email) && /\/espace\/verifier/.test(mail.text));

test.describe('pilotage : ouverture contrôlée et état du service (V1-C)', () => {
  test.describe.configure({ mode: 'serial' });

  // Strapi limite les liens de connexion à 5 par adresse et par 15 minutes (NF-03) : une seule connexion, cookie repris ensuite.
  let session: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;

  async function openPilotage(page: Page, baseURL: string | undefined) {
    if (session) {
      await page.context().addCookies(session);
    } else {
      await openSpace(page, ORGANIZER);
      // F-124 (V2-D) : l'organisateur de ORGANIZER_EMAILS n'a pas à passer la bienvenue (V2-B y intercale une confirmation) : il va droit au pilotage.
      session = await page.context().cookies();
    }
    await page.goto(`${ESPACE}/organisateur`);
    await hydrated(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pilotage de l’édition');
  }

  test('critère 7 : les cartes existantes sont toujours là après la découpe, et « État du service » ouvre la page (A-39, F-106)', async ({ page, baseURL }) => {
    const consoleWatch = watchConsole(page);
    await openPilotage(page, baseURL);

    const headings = await page.getByRole('heading', { level: 2 }).allInnerTexts();
    for (const name of ['État du service', 'E-mail de bienvenue', 'Rendez-vous par pause B2B', 'Exposants les plus sollicités', 'Exports', 'Avertissements']) {
      expect(headings.map((text) => text.trim()), name).toContain(name);
    }
    expect(headings[0].trim(), 'la carte « État du service » est en tête du pilotage').toBe('État du service');
    await expect(page.getByRole('button', { name: 'Synchroniser maintenant' })).toBeVisible();
    await expect(page.locator('details').filter({ hasText: 'Historique des synchronisations' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Régénérer les créneaux/ })).toBeVisible();
    consoleWatch.expectClean();
  });

  test('F-106 : la carte « État du service » d’une recette bien réglée ne montre aucune anomalie d’e-mail ni de HelloAsso (fournisseur console, expéditeur et HelloAsso réglés)', async ({ page, baseURL }) => {
    await openPilotage(page, baseURL);
    const card = page.getByRole('region', { name: 'État du service' }).or(page.locator('section, div').filter({ has: page.getByRole('heading', { level: 2, name: 'État du service' }) }).last());
    await expect(card).toBeVisible();
    await expect(card.getByRole('listitem').filter({ hasText: /expéditeur|e-mail|HelloAsso/i })).toHaveCount(0);
    await expect(card).toContainText('Espace participant ouvert');
    await expect(card).not.toContainText(/expédition|HelloAsso n’est pas|échec/i);
  });

  test('F-105 : l’aperçu, le bouton « Envoyer à 3 inscrits », la confirmation qui répète 3, puis le résultat (R-85)', async ({ page, baseURL }) => {
    test.skip(parisHour() < 8 || parisHour() >= 20, 'envoi réel : hors de 8h à 20h (Paris), le serveur le refuse (409)');
    forgetWelcomes();
    const consoleWatch = watchConsole(page);
    await openPilotage(page, baseURL);

    const card = page.locator('section, div').filter({ has: page.getByRole('heading', { level: 2, name: 'E-mail de bienvenue' }) }).last();
    await expect(card).toContainText('3');
    await expect(card.getByText(/Aperçu/i).first()).toBeVisible();
    const send = card.getByRole('button', { name: /Envoyer à 3 inscrits/ });
    await expect(send).toBeEnabled();

    // La confirmation répète le nombre ; annuler n'envoie rien.
    const before = welcomeMailsTo(GUESTS).length;
    await send.click();
    const confirmation = page.getByRole('dialog').or(page.getByRole('alertdialog'));
    await expect(confirmation).toContainText('3');
    await confirmation.getByRole('button', { name: /Annuler|Retour/ }).click();
    expect(welcomeMailsTo(GUESTS).length).toBe(before);

    await send.click();
    await confirmation.getByRole('button', { name: /Envoyer|Confirmer/ }).click();
    await expect(card.getByRole('status')).toContainText(/3\s+envoy/);
    await expect(card.getByRole('status')).toContainText(/0\s+en\s+échec/);
    await expect.poll(() => welcomeMailsTo(GUESTS).length - before, { timeout: 15_000 }).toBe(3);

    // Plus personne à inviter : le bouton disparaît ou se désactive.
    await expect(card.getByRole('button', { name: /Envoyer à/ })).toHaveCount(0);
    consoleWatch.expectClean();
  });

  test('F-105 : hors de la plage d’envoi, le message du serveur (409 OUTSIDE_SENDING_HOURS) s’affiche et rien ne part', async ({ page, baseURL }) => {
    forgetWelcomes();
    await openPilotage(page, baseURL);
    await page.route('**/api/espace/admin/*/welcome/send', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'OUTSIDE_SENDING_HOURS', message: 'Les envois ne partent qu’entre 8h00 et 20h00, heure de Paris.' } }),
      }),
    );
    const card = page.locator('section, div').filter({ has: page.getByRole('heading', { level: 2, name: 'E-mail de bienvenue' }) }).last();
    const before = welcomeMailsTo(GUESTS).length;
    await card.getByRole('button', { name: /Envoyer à 3 inscrits/ }).click();
    await page.getByRole('dialog').or(page.getByRole('alertdialog')).getByRole('button', { name: /Envoyer|Confirmer/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: '8h00' })).toBeVisible();
    expect(welcomeMailsTo(GUESTS).length).toBe(before);
    await expect(card.getByRole('button', { name: /Envoyer à 3 inscrits/ })).toBeEnabled();
  });

  test('F-106 : une ligne rouge dit ce qu’il faut faire quand le service signale une anomalie (expéditeur absent)', async ({ page, baseURL }) => {
    await openPilotage(page, baseURL);
    await page.unroute('**/api/espace/admin/*/service').catch(() => undefined);
    await page.route('**/api/espace/admin/*/service', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.mail = { ...body.mail, provider: 'brevo', senderConfigured: false };
      await route.fulfill({ response, json: body });
    });
    await page.reload();
    await hydrated(page);
    const card = page.locator('section, div').filter({ has: page.getByRole('heading', { level: 2, name: 'État du service' }) }).last();
    await expect(card.getByRole('listitem').filter({ hasText: /expédition/i })).toContainText(/EMAIL_FROM/);
  });
});

