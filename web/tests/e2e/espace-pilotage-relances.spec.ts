import type { BrowserContext, Page, Request } from '@playwright/test';
import { ESPACE, expect, hydrated, openSpace, test, watchConsole } from './espace';

/**
 * Pilotage de l'édition, lot V3-B (F-92, R-71, R-72) : carte « Relances ».
 *
 * Aperçu : le contenu réel du seed varie (profils complets ou non, refus de rappels) ; les cas d'interface qui exigent un bouton actif
 * interceptent donc la réponse de `preview` (nombre et exclus fixes). L'envoi est réel seulement pour le critère 1, et seulement entre
 * 8h et 20h (Paris) : le serveur lit son horloge et refuse sinon (409). Hors plage, le test est ignoré.
 * Heure du navigateur : `page.clock.install` puis `setFixedTime` (la carte lit `new Date()` au montage).
 */

const ORGANIZER = 'organisation@example.org';
const PREVIEW = '**/api/espace/admin/*/reminders/preview';
const SEND = '**/api/espace/admin/*/reminders/send';
const OUTSIDE = 'Les relances partent entre 8h00 et 20h00, heure de Paris.';

const parisHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
// Novembre : Paris est en UTC+1.
const parisClock = (hhmm: string) => new Date(`2026-11-20T${hhmm}:00+01:00`);

const fakePreview = (recipients = 3) => ({ recipients, skipped: { alreadySent: 1, optedOut: 2 }, sampleHtml: '<p>Bonjour Léa</p>' });

test.describe('pilotage : carte Relances (V3-B, F-92)', () => {
  // Strapi limite les liens de connexion à 5 par adresse et par 15 minutes (NF-03) : une seule connexion, cookie repris ensuite.
  let session: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;

  async function openPilotage(page: Page, baseURL: string | undefined, hhmm?: string) {
    if (session) {
      await page.context().addCookies(session);
    } else {
      await openSpace(page, ORGANIZER);
      if (page.url().endsWith('/bienvenue')) {
        await hydrated(page);
        await page.getByRole('button', { name: 'Continuer' }).click();
        await page.getByRole('button', { name: 'Continuer sans apparaître' }).click(); // V2-B : confirmation, annuaire décoché
        await expect(page).toHaveURL(`${baseURL}${ESPACE}/`);
      }
      session = await page.context().cookies();
    }
    // L'horloge n'est fixée qu'après la connexion : un temps figé fausse la validation du consentement.
    if (hhmm) await page.clock.install({ time: parisClock(hhmm) }); // installée avant la navigation : persiste au rechargement
    await page.goto(`${ESPACE}/organisateur`);
    await hydrated(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pilotage de l’édition');
  }

  const cardOf = (page: Page) => page.locator('section, div').filter({ has: page.getByRole('heading', { level: 2, name: 'Relances' }) }).last();

  /** Ouvre le pilotage avec un aperçu simulé et une heure du navigateur donnée (Paris). */
  async function openWithFakePreview(page: Page, baseURL: string | undefined, hhmm: string, recipients = 3) {
    await page.route(PREVIEW, (route) => route.fulfill({ status: 200, contentType: 'application/json', json: fakePreview(recipients) }));
    await openPilotage(page, baseURL, hhmm);
    await expect(cardOf(page).getByText(/destinataires? pour/)).toBeVisible();
  }

  const sendRequests = (page: Page) => {
    const seen: Request[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/reminders\/send$/.test(request.url())) seen.push(request);
    });
    return seen;
  };

  test('la carte : titre, scénarios, destinataires, exclus avec leur raison, aperçu isolé, bouton', async ({ page, baseURL }) => {
    const consoleWatch = watchConsole(page);
    await openWithFakePreview(page, baseURL, '10:00');
    const card = cardOf(page);

    await expect(card.getByRole('heading', { level: 2, name: 'Relances' })).toBeVisible();
    const select = card.getByLabel('Scénario');
    await expect(select.getByRole('option')).toHaveText(['Profil incomplet', 'Sans rendez-vous', 'Veille de l’événement', 'Rappel d’activation']);
    await expect(card).toContainText(/3\s+destinataires pour «\s+Profil incomplet\s+»/);
    await expect(card.getByRole('listitem').filter({ hasText: /1\s+exclu, déjà relancé/ })).toBeVisible();
    await expect(card.getByRole('listitem').filter({ hasText: /2\s+exclus, ont refusé les rappels/ })).toBeVisible();

    const details = card.locator('details').filter({ hasText: 'Voir l’aperçu de l’e-mail' });
    await details.getByText('Voir l’aperçu de l’e-mail').click();
    const frame = details.locator('iframe');
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute('csp', "script-src 'none'");
    await expect(page.frameLocator('iframe[title="Aperçu de l’e-mail « Profil incomplet »"]').getByText('Bonjour Léa')).toBeVisible();

    await expect(card.getByRole('button', { name: 'Envoyer à 3 destinataires' })).toBeEnabled();
    consoleWatch.expectClean();
  });

  test('changer de scénario recharge l’aperçu pour ce scénario', async ({ page, baseURL }) => {
    await openWithFakePreview(page, baseURL, '10:00');
    const card = cardOf(page);
    const asked: string[] = [];
    page.on('request', (request) => {
      if (/\/reminders\/preview$/.test(request.url())) asked.push(request.postData() ?? '');
    });
    await card.getByLabel('Scénario').selectOption({ label: 'Veille de l’événement' });
    await expect(card).toContainText(/destinataires pour «\s+Veille de l’événement\s+»/);
    expect(asked.some((body) => body.includes('"eve"'))).toBe(true);
  });

  test('critère 2 : annuler la confirmation n’appelle pas send (observé sur les requêtes), puis le bouton revient', async ({ page, baseURL }) => {
    await openWithFakePreview(page, baseURL, '10:00');
    const seen = sendRequests(page);
    const card = cardOf(page);

    await card.getByRole('button', { name: 'Envoyer à 3 destinataires' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Confirmer l’envoi à 3 destinataires');
    await dialog.getByRole('button', { name: 'Annuler' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Envoyer à 3 destinataires' })).toBeEnabled();
    await page.waitForTimeout(500);
    expect(seen).toHaveLength(0);
  });

  test('critère 3 : le résultat est annoncé par role="status" après confirmation, un seul appel send avec le scénario choisi', async ({ page, baseURL }) => {
    await openWithFakePreview(page, baseURL, '10:00');
    const bodies: string[] = [];
    await page.route(SEND, (route) => {
      bodies.push(route.request().postData() ?? '');
      return route.fulfill({ status: 200, contentType: 'application/json', json: { sent: 2, skipped: 1, failed: 0 } });
    });
    const card = cardOf(page);
    await card.getByLabel('Scénario').selectOption({ label: 'Sans rendez-vous' });
    await card.getByRole('button', { name: 'Envoyer à 3 destinataires' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirmer l’envoi à 3 destinataires' }).click();

    await expect(page.getByRole('status').filter({ hasText: /2\s+envoyés, 1\s+déjà relancé, 0\s+en échec\./ })).toBeVisible();
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0])).toEqual({ scenario: 'no-meeting' });
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('critère 3 : un envoi avec des échecs est annoncé par role="alert"', async ({ page, baseURL }) => {
    await openWithFakePreview(page, baseURL, '10:00');
    await page.route(SEND, (route) => route.fulfill({ status: 200, contentType: 'application/json', json: { sent: 1, skipped: 0, failed: 2 } }));
    const card = cardOf(page);
    await card.getByRole('button', { name: 'Envoyer à 3 destinataires' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: /Confirmer/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: /1\s+envoyé, 0\s+déjà relancé, 2\s+en échec\./ })).toBeVisible();
  });

  test('hors plage (navigateur à 20h30 Paris) : bouton inactif et raison affichée, rien n’est appelé', async ({ page, baseURL }) => {
    await openWithFakePreview(page, baseURL, '20:30');
    const seen = sendRequests(page);
    const card = cardOf(page);
    const button = card.getByRole('button', { name: 'Envoyer à 3 destinataires' });
    await expect(button).toBeDisabled();
    await expect(card.getByText(OUTSIDE)).toBeVisible();
    await expect(button).toHaveAccessibleDescription(OUTSIDE);
    expect(seen).toHaveLength(0);
  });

  test('hors plage (navigateur à 7h59 Paris) : bouton inactif', async ({ page, baseURL }) => {
    await openWithFakePreview(page, baseURL, '07:59');
    await expect(cardOf(page).getByRole('button', { name: 'Envoyer à 3 destinataires' })).toBeDisabled();
    await expect(cardOf(page).getByText(OUTSIDE)).toBeVisible();
  });

  test('bornes de la plage : actif à 8h00 et à 19h59 Paris, inactif à 20h00', async ({ page, baseURL }) => {
    await openWithFakePreview(page, baseURL, '08:00');
    const button = () => cardOf(page).getByRole('button', { name: 'Envoyer à 3 destinataires' });
    await expect(button()).toBeEnabled();
    await page.clock.setFixedTime(parisClock('19:59'));
    await page.reload();
    await hydrated(page);
    await expect(button()).toBeEnabled();
    await page.clock.setFixedTime(parisClock('20:00'));
    await page.reload();
    await hydrated(page);
    await expect(button()).toBeDisabled();
  });

  test('aucun destinataire : bouton « Envoyer à 0 destinataire » inactif même dans la plage', async ({ page, baseURL }) => {
    await openWithFakePreview(page, baseURL, '10:00', 0);
    await expect(cardOf(page).getByRole('button', { name: 'Envoyer à 0 destinataire' })).toBeDisabled();
  });

  test('le serveur refuse hors plage (409 OUTSIDE_SENDING_HOURS) : message affiché en alerte, bouton inactif ensuite', async ({ page, baseURL }) => {
    await openWithFakePreview(page, baseURL, '10:00');
    await page.route(SEND, (route) =>
      route.fulfill({ status: 409, contentType: 'application/json', json: { error: { code: 'OUTSIDE_SENDING_HOURS', message: 'Hors plage.' } } }),
    );
    const card = cardOf(page);
    await card.getByRole('button', { name: 'Envoyer à 3 destinataires' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: /Confirmer/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: OUTSIDE })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Envoyer à 3 destinataires' })).toBeDisabled();
  });

  test('critère 1 : second envoi du même scénario le même jour, « 0 envoyé, 3 déjà relancés » (réponses simulées)', async ({ page, baseURL }) => {
    await openWithFakePreview(page, baseURL, '10:00', 3);
    let calls = 0;
    await page.route(SEND, (route) => {
      calls += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', json: calls === 1 ? { sent: 3, skipped: 0, failed: 0 } : { sent: 0, skipped: 3, failed: 0 } });
    });
    const card = cardOf(page);
    const sendOnce = async () => {
      await card.getByRole('button', { name: 'Envoyer à 3 destinataires' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Confirmer l’envoi à 3 destinataires' }).click();
    };
    await sendOnce();
    await expect(page.getByRole('status').filter({ hasText: /3\s+envoyés, 0\s+déjà relancé, 0\s+en échec\./ })).toBeVisible();
    await sendOnce();
    await expect(page.getByRole('status').filter({ hasText: /0\s+envoyé, 3\s+déjà relancés, 0\s+en échec\./ })).toBeVisible();
    expect(calls).toBe(2);
  });

  test('critère 1 : second envoi du même scénario le même jour, « 0 envoyé, N déjà relancés » (serveur réel)', async ({ page, baseURL }) => {
    test.skip(parisHour() < 8 || parisHour() >= 20, 'envoi réel : hors de 8h à 20h (Paris), le serveur le refuse (409)');
    await openPilotage(page, baseURL, '10:00');
    const card = cardOf(page);
    await card.getByLabel('Scénario').selectOption({ label: 'Rappel d’activation' });
    await expect(card.getByText(/destinataires? pour «\s+Rappel d’activation\s+»/)).toBeVisible();
    const real = await card.textContent();
    const planned = Number(real?.match(/(\d+)\s+destinataires?\s+pour/)?.[1] ?? 0);

    const confirmSend = async () => {
      await card.getByRole('button', { name: /^Envoyer à / }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: /^Confirmer l’envoi/ }).click();
    };

    // Premier envoi réel (s'il y a des destinataires), sinon le scénario a déjà été joué : le second le sera aussi.
    if (planned > 0) {
      await confirmSend();
      await expect(page.getByRole('status').filter({ hasText: /envoy/ })).toContainText(new RegExp(`${planned}\\s+envoy`));
    }

    // Le bouton est inactif à 0 destinataire : l'aperçu est simulé pour rejouer l'envoi, la réponse de send est celle du serveur.
    await page.route(PREVIEW, (route) => route.fulfill({ status: 200, contentType: 'application/json', json: fakePreview(3) }));
    await card.getByLabel('Scénario').selectOption({ label: 'Profil incomplet' });
    await card.getByLabel('Scénario').selectOption({ label: 'Rappel d’activation' });
    await expect(card.getByRole('button', { name: 'Envoyer à 3 destinataires' })).toBeEnabled();
    await confirmSend();

    const status = page.getByRole('status').filter({ hasText: /envoy/ });
    await expect(status).toContainText(/0\s+envoyé,/);
    await expect(status).toContainText(/\d+\s+déjà relancés?, 0\s+en échec\./);
    const skipped = Number((await status.textContent())?.match(/(\d+)\s+déjà relancé/)?.[1] ?? 0);
    expect(skipped).toBeGreaterThanOrEqual(planned);
    expect(skipped).toBeGreaterThan(0);
  });
});
