import type { BrowserContext, Page } from '@playwright/test';
import { ACCESS_LINK_SUBJECT, ESPACE, expect, hydrated, mailsTo, openSpace, test, watchConsole } from './espace';

/**
 * Pilotage de l'édition, lot V3-E (F-134 à F-138, R-89) : carte « Participants » (liste, recherche, filtres), fiche d'un inscrit
 * (lecture, correction, lien de connexion limité à 3 par heure, désinscription et réinscription), « Ajouter un invité ».
 *
 * Données : le seed de recette. Les tests qui écrivent (ajout, correction, lien, désinscription) travaillent sur un invité créé à
 * la main avec une adresse propre à l'exécution ; la base e2e est vidée au démarrage de la suite suivante. Le contenu de message
 * n'apparaît nulle part : la page ne porte ni « conversation » ni corps de message.
 */

const ORGANIZER = 'organisation@example.org';
const STAMP = Date.now();
const GUEST = { firstName: 'Camille', lastName: `Invitée${STAMP}`, email: `invitee.${STAMP}@example.org`, company: 'Scierie du Lot', jobTitle: 'Directrice' };
const GUEST_NAME = `${GUEST.firstName} ${GUEST.lastName}`;

test.describe('pilotage : participants (V3-E)', () => {
  test.describe.configure({ mode: 'serial' });

  // Une seule connexion (NF-03) : le cookie est repris ensuite.
  let session: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;

  async function openPilotage(page: Page, baseURL: string | undefined) {
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
    await page.goto(`${ESPACE}/organisateur`);
    await hydrated(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pilotage de l’édition');
  }

  const search = (page: Page, text: string) => page.getByLabel('Rechercher un inscrit').fill(text);
  const openSheet = async (page: Page, name: string) => {
    await page.getByRole('button', { name: `Ouvrir la fiche de ${name}` }).click();
    await expect(page.getByRole('button', { name: 'Retour à la liste' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name })).toBeVisible();
  };

  test('F-134 : la liste, la recherche « ducasse » et son message d’absence de résultat', async ({ page, baseURL }) => {
    const consoleWatch = watchConsole(page);
    await openPilotage(page, baseURL);

    await expect(page.getByRole('heading', { level: 2, name: 'Participants' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /\d+\sinscrits?, page 1 sur \d+\./ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ouvrir la fiche de Léa Ducasse' })).toBeVisible();

    await search(page, 'ducasse');
    await expect(page.getByRole('status').filter({ hasText: /^1\sinscrit, page 1 sur 1\.$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Ouvrir la fiche de / })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Ouvrir la fiche de Léa Ducasse' })).toBeVisible();

    await search(page, 'personne-ne-porte-ce-nom');
    await expect(page.getByText('Aucun inscrit ne correspond.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Ouvrir la fiche de / })).toHaveCount(0);
    consoleWatch.expectClean();
  });

  test('F-134 : le filtre « Désinscrits » ne montre aucun inscrit actif et « Retour à la liste » ramène la liste', async ({ page, baseURL }) => {
    await openPilotage(page, baseURL);
    await page.getByLabel('Inscription').selectOption('cancelled');
    await expect(page.getByRole('button', { name: 'Ouvrir la fiche de Léa Ducasse' })).toHaveCount(0);
    await page.getByLabel('Inscription').selectOption('active');
    await expect(page.getByRole('button', { name: 'Ouvrir la fiche de Léa Ducasse' })).toBeVisible();
    await page.getByLabel('Rôle').selectOption('organizer');
    await expect(page.getByRole('button', { name: 'Ouvrir la fiche de Léa Ducasse' })).toHaveCount(0);
    await page.getByLabel('Rôle').selectOption('');

    await openSheet(page, 'Léa Ducasse');
    await page.getByRole('button', { name: 'Retour à la liste' }).click();
    await expect(page.getByLabel('Rechercher un inscrit')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ouvrir la fiche de Léa Ducasse' })).toBeVisible();
  });

  test('F-135 : la fiche montre l’identité, l’e-mail, l’origine, les dates, les rendez-vous et les derniers e-mails, sans contenu de message', async ({ page, baseURL }) => {
    const consoleWatch = watchConsole(page);
    await openPilotage(page, baseURL);
    await search(page, 'ducasse');
    await openSheet(page, 'Léa Ducasse');

    await expect(page.getByText('lea.ducasse@example.org', { exact: true }).first()).toBeVisible();
    for (const term of ['Rôle', 'Statut', 'Origine', 'Importé le', 'Espace activé le', 'Dernière connexion', 'Annuaire', 'Rendez-vous']) {
      await expect(page.getByRole('term').filter({ hasText: new RegExp(`^${term}$`) })).toBeVisible();
    }
    await expect(page.getByText('Importé de HelloAsso')).toBeVisible();
    await expect(page.getByRole('heading', { level: 4, name: 'Derniers e-mails' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Renvoyer un lien de connexion' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Désinscrire' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enregistrer les corrections' })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/conversation|messagerie/i);
    consoleWatch.expectClean();
  });

  test('F-136 : « Ajouter un invité » refuse un formulaire vide, une adresse déjà prise, puis ajoute l’invité', async ({ page, baseURL }) => {
    const consoleWatch = watchConsole(page);
    await openPilotage(page, baseURL);
    await page.getByRole('button', { name: 'Ajouter un invité' }).click();
    const form = page.locator('form[aria-labelledby="invite-titre"]');
    await expect(form).toBeVisible();

    await form.getByRole('button', { name: 'Ajouter l’invité' }).click();
    await expect(form.getByText('Le prénom est obligatoire.')).toBeVisible();
    await expect(form.getByText('Le nom est obligatoire.')).toBeVisible();
    await expect(form.getByText('Saisissez une adresse e-mail valide.')).toBeVisible();
    await expect(form.getByLabel('Prénom')).toHaveAttribute('aria-invalid', 'true');

    await form.getByLabel('Prénom').fill('Doublon');
    await form.getByLabel('Nom', { exact: true }).fill('Ducasse');
    await form.getByLabel('Adresse e-mail').fill('LEA.Ducasse@example.org');
    await form.getByRole('button', { name: 'Ajouter l’invité' }).click();
    await expect(form.getByText('Adresse déjà utilisée.')).toBeVisible();

    await form.getByLabel('Prénom').fill(GUEST.firstName);
    await form.getByLabel('Nom', { exact: true }).fill(GUEST.lastName);
    await form.getByLabel('Adresse e-mail').fill(GUEST.email.toUpperCase());
    await form.getByLabel('Entreprise').fill(GUEST.company);
    await form.getByLabel('Fonction').fill(GUEST.jobTitle);
    await form.getByLabel('Rôle').selectOption('speaker');
    await form.getByRole('button', { name: 'Ajouter l’invité' }).click();
    await expect(page.getByText(`${GUEST_NAME} est ajouté.`)).toBeVisible();
    await expect(form).toHaveCount(0);

    await search(page, GUEST.lastName);
    const row = page.getByRole('button', { name: `Ouvrir la fiche de ${GUEST_NAME}` });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Invité');
    await expect(row).toContainText('Intervenant');
    await expect(row).toContainText(GUEST.email);
    expect(consoleWatch.problems.filter((problem) => !/status of (400|409)|^(400|409) /.test(problem)), "hors les refus 400 et 409 attendus").toEqual([]);
  });

  test('F-137, R-89 : corriger la fonction et le nom d’un inscrit, enregistré et relu depuis le serveur', async ({ page, baseURL }) => {
    const consoleWatch = watchConsole(page);
    await openPilotage(page, baseURL);
    await search(page, GUEST.lastName);
    await openSheet(page, GUEST_NAME);
    await expect(page.getByText('Ajouté à la main')).toBeVisible();

    await page.getByLabel('Fonction').fill('Directrice générale');
    await page.getByLabel('Prénom').fill('Camille-Anne');
    await page.getByRole('button', { name: 'Enregistrer les corrections' }).click();
    await expect(page.getByText('Les corrections sont enregistrées.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: `Camille-Anne ${GUEST.lastName}` })).toBeVisible();

    // Une adresse invalide est refusée avec son message, sans rien écrire.
    await page.getByLabel('Adresse e-mail').fill('pas-une-adresse');
    await page.getByRole('button', { name: 'Enregistrer les corrections' }).click();
    await expect(page.getByText('Saisissez une adresse e-mail valide.')).toBeVisible();

    await page.reload();
    await hydrated(page);
    await search(page, GUEST.lastName);
    await expect(page.getByRole('button', { name: `Ouvrir la fiche de Camille-Anne ${GUEST.lastName}` })).toBeVisible();
    expect(consoleWatch.problems.filter((problem) => !/status of (400|409)|^(400|409) /.test(problem)), "hors les refus 400 et 409 attendus").toEqual([]);
  });

  test('F-135 : « Renvoyer un lien de connexion » envoie l’e-mail, annonce les envois restants, puis le quatrième est refusé (3 par heure)', async ({ page, baseURL }) => {
    await openPilotage(page, baseURL);
    await search(page, GUEST.lastName);
    await openSheet(page, `Camille-Anne ${GUEST.lastName}`);
    const before = mailsTo(GUEST.email.toLowerCase(), ACCESS_LINK_SUBJECT).length;
    const button = page.getByRole('button', { name: 'Renvoyer un lien de connexion' });

    for (const remaining of ['2\\senvois\\srestants', '1\\senvoi\\srestant', '0\\senvoi\\srestant']) {
      await button.click();
      await expect(page.getByText(new RegExp(`Lien envoyé à ${GUEST.email.toLowerCase().replaceAll('.', '\\.')}\\.\\s${remaining}`))).toBeVisible();
      await expect(button).toBeEnabled();
    }
    await expect.poll(() => mailsTo(GUEST.email.toLowerCase(), ACCESS_LINK_SUBJECT).length - before, { timeout: 15_000 }).toBe(3);

    await button.click();
    await expect(page.getByRole('alert').filter({ hasText: 'Trois liens par heure' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(mailsTo(GUEST.email.toLowerCase(), ACCESS_LINK_SUBJECT).length - before).toBe(3);
  });

  test('F-138 : « Désinscrire » demande confirmation, « Annuler » ne change rien, « Confirmer la désinscription » désinscrit, « Réinscrire » inverse', async ({ page, baseURL }) => {
    const consoleWatch = watchConsole(page);
    await openPilotage(page, baseURL);
    await search(page, GUEST.lastName);
    await openSheet(page, `Camille-Anne ${GUEST.lastName}`);

    await page.getByRole('button', { name: 'Désinscrire' }).click();
    const confirmation = page.getByRole('alertdialog');
    await expect(confirmation).toContainText(`Désinscrire Camille-Anne ${GUEST.lastName} ?`);
    await confirmation.getByRole('button', { name: 'Annuler' }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Désinscrire' })).toBeVisible();

    await page.getByRole('button', { name: 'Désinscrire' }).click();
    await confirmation.getByRole('button', { name: 'Confirmer la désinscription' }).click();
    await expect(page.getByText('Inscrit désinscrit.')).toBeVisible();
    await expect(page.getByText('Désinscrit', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Réinscrire' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Désinscrire' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Renvoyer un lien de connexion' })).toBeDisabled();

    // Dans la liste, l'inscrit est marqué « Désinscrit » et apparaît sous le filtre « Désinscrits ».
    await page.getByRole('button', { name: 'Retour à la liste' }).click();
    await search(page, GUEST.lastName);
    await expect(page.getByRole('button', { name: `Ouvrir la fiche de Camille-Anne ${GUEST.lastName}` })).toContainText('Désinscrit');
    await page.getByLabel('Inscription').selectOption('cancelled');
    await expect(page.getByRole('button', { name: `Ouvrir la fiche de Camille-Anne ${GUEST.lastName}` })).toBeVisible();
    await page.getByLabel('Inscription').selectOption('');

    await openSheet(page, `Camille-Anne ${GUEST.lastName}`);
    await page.getByRole('button', { name: 'Réinscrire' }).click();
    await expect(page.getByText('Inscrit réinscrit.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Désinscrire' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Renvoyer un lien de connexion' })).toBeEnabled();
    consoleWatch.expectClean();
  });

  test('mise en page : à 390 px, la liste et la fiche ne débordent pas de l’écran et les boutons mesurent au moins 44 px', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPilotage(page, baseURL);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await search(page, 'ducasse');
    await expect(page.getByRole('button', { name: 'Ouvrir la fiche de Léa Ducasse' })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await openSheet(page, 'Léa Ducasse');
    expect(await overflow()).toBeLessThanOrEqual(0);
    for (const name of ['Retour à la liste', 'Enregistrer les corrections', 'Renvoyer un lien de connexion', 'Désinscrire']) {
      const box = await page.getByRole('button', { name }).boundingBox();
      expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(44);
    }
  });
});
