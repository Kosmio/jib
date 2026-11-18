import type { BrowserContext, Page } from '@playwright/test';
import { ESPACE, expect, hydrated, openSpace, test } from './espace';

/**
 * Profil V4-B (F-146 à F-149) : barre d'enregistrement collante, alerte de sortie, suppression de la photo, confirmation de
 * déconnexion, avatar mobile, ancre #visibilite.
 *
 * Un inscrit par sujet, pour que les tests ne se gênent pas et pour rester sous la limite de 5 liens par adresse et par 15 minutes (NF-03) :
 * Marion (barre sans enregistrement, avatar), Jules (enregistrements), Hélène (photo), Pierre (déconnexion, deux sessions), Clara (lien de l'accueil). Les sessions de Marion, Hélène et
 * Clara sont ouvertes une fois et leur cookie repris. Tout enregistrement de profil remet l'état de départ avant la fin du test.
 */

const MARION = 'marion.lacoste@example.org'; // entreprise vide dans le seed : enregistrer son profil est impossible, elle sert aux tests sans enregistrement
const JULES = 'jules.mazeres@example.org';
const HELENE = 'helene.marques@example.org';
const PIERRE = 'pierre.haurie@example.org';
const CLARA = 'clara.dubourdieu@example.org';

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

async function openProfile(page: Page, email: string) {
  await signIn(page, email);
  await page.goto(`${ESPACE}/profil`);
  await hydrated(page);
}

const bar = (page: Page) => page.locator('[data-barre-enregistrement]');
const PRESENTATION = /^Présentation/;

// 1x1 PNG : le navigateur le recadre et le réduit lui-même avant l'envoi.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.describe('F-146 : barre d’enregistrement et alerte de sortie', () => {
  test('sans modification il n’y a pas de barre ; modifier un champ la fait apparaître avec « Annuler » et « Enregistrer »', async ({ page }) => {
    await openProfile(page, MARION);
    await expect(bar(page)).toHaveCount(0);
    await expect(page.getByText('Modifications non enregistrées')).toHaveCount(0);
    await expect(page.locator('#annuler')).toHaveCount(0);

    await page.getByLabel(PRESENTATION).fill('Texte modifié pour le test de la barre.');
    await expect(bar(page)).toBeVisible();
    await expect(bar(page).getByText('Modifications non enregistrées')).toBeVisible();
    await expect(bar(page).locator('#annuler')).toHaveText('Annuler');
    await expect(bar(page).locator('#enregistrer')).toHaveText('Enregistrer');
    expect(await bar(page).evaluate((node) => getComputedStyle(node).position), 'barre collante').toBe('sticky');
  });

  test('« Annuler » remet les valeurs d’origine et retire la barre ; remettre la valeur à la main la retire aussi', async ({ page }) => {
    await openProfile(page, MARION);
    const field = page.getByLabel(PRESENTATION);
    const original = await field.inputValue();
    await field.fill(`${original} (essai)`);
    await expect(bar(page)).toBeVisible();
    await page.locator('#annuler').click();
    await expect(field).toHaveValue(original);
    await expect(bar(page)).toHaveCount(0);

    await field.fill(`${original}!`);
    await expect(bar(page)).toBeVisible();
    await field.fill(original);
    await expect(bar(page)).toHaveCount(0);
  });

  test('« Enregistrer » : message « Profil enregistré » qui prend le focus, barre retirée, valeur conservée au rechargement', async ({ page }) => {
    await openProfile(page, JULES);
    const field = page.getByLabel(PRESENTATION);
    const original = await field.inputValue();
    const changed = `${original} Essai V4-B.`.trim();
    try {
      await field.fill(changed);
      await page.locator('#enregistrer').click();
      const done = page.getByText('Profil enregistré');
      await expect(done).toBeVisible();
      await expect(done).toBeFocused();
      await expect(bar(page)).toHaveCount(0);

      await page.reload();
      await hydrated(page);
      await expect(page.getByLabel(PRESENTATION)).toHaveValue(changed);
      await expect(bar(page)).toHaveCount(0);
    } finally {
      await page.getByLabel(PRESENTATION).fill(original);
      await page.locator('#enregistrer').click();
      await expect(page.getByText('Profil enregistré')).toBeVisible();
    }
  });

  test('modifier un champ puis changer d’onglet déclenche l’alerte du navigateur ; sans modification, aucune alerte', async ({ page }) => {
    await openProfile(page, MARION);
    const types: string[] = [];
    page.on('dialog', async (dialog) => {
      types.push(dialog.type());
      await dialog.dismiss();
    });

    await page.getByLabel(PRESENTATION).fill('Modification non enregistrée.');
    await expect(bar(page)).toBeVisible();
    await page.getByRole('navigation', { name: 'Espace participant' }).getByRole('link', { name: 'Annuaire' }).click();
    await expect.poll(() => types).toEqual(['beforeunload']);
    await expect(page).toHaveURL(`${ESPACE}/profil`);

    // Annuler retire l'alerte : le changement d'onglet part sans question.
    await page.locator('#annuler').click();
    await expect(bar(page)).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Espace participant' }).getByRole('link', { name: 'Annuaire' }).click();
    await expect(page).toHaveURL(new RegExp(`${ESPACE}/annuaire`));
    expect(types).toEqual(['beforeunload']);
  });

  test('après un enregistrement réussi, quitter la page n’affiche plus d’alerte', async ({ page }) => {
    await openProfile(page, JULES);
    const types: string[] = [];
    page.on('dialog', async (dialog) => {
      types.push(dialog.type());
      await dialog.accept();
    });
    const field = page.getByLabel(PRESENTATION);
    const original = await field.inputValue();
    try {
      await field.fill(`${original} V4-B`);
      await page.locator('#enregistrer').click();
      await expect(page.getByText('Profil enregistré')).toBeVisible();
      await page.getByRole('navigation', { name: 'Espace participant' }).getByRole('link', { name: 'Annuaire' }).click();
      await expect(page).toHaveURL(new RegExp(`${ESPACE}/annuaire`));
      expect(types).toEqual([]);
    } finally {
      await page.goto(`${ESPACE}/profil`);
      await hydrated(page);
      await page.getByLabel(PRESENTATION).fill(original);
      await page.locator('#enregistrer').click();
      await expect(page.getByText('Profil enregistré')).toBeVisible();
    }
  });

  test('la barre s’atteint au clavier et ne masque jamais le champ en cours (390 px de large)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await openProfile(page, MARION);
    await page.getByLabel('Prénom').fill('Marion');
    await page.getByLabel(PRESENTATION).fill('Modification pour le parcours au clavier.');
    await expect(bar(page)).toBeVisible();
    await page.getByLabel('Prénom').focus();

    const hidden: string[] = [];
    let reached = false;
    for (let step = 0; step < 80 && !reached; step += 1) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(250); // laisse finir un éventuel défilement
      const state = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        const barNode = document.querySelector('[data-barre-enregistrement]');
        if (!element || !barNode) return null;
        if (barNode.contains(element)) return { inBar: true, id: element.id, label: '' };
        const box = element.getBoundingClientRect();
        const barBox = barNode.getBoundingClientRect();
        const overlaps = box.width > 1 && box.height > 1 && box.bottom > barBox.top && box.top < barBox.bottom;
        const label = element.id || element.getAttribute('name') || element.tagName;
        return { inBar: false, id: element.id, label: overlaps ? label : '' };
      });
      if (!state) continue;
      if (state.inBar) reached = state.id === 'enregistrer';
      else if (state.label) hidden.push(state.label);
    }
    expect(reached, '« Enregistrer » atteint à la touche Tab').toBe(true);
    expect(hidden, 'champs recouverts par la barre au moment où ils prennent le focus').toEqual([]);
    await expect(page.locator('#annuler')).toBeVisible();
    await page.locator('#annuler').focus();
    await expect(page.locator('#annuler')).toBeFocused();
  });
});

test.describe('F-147 : suppression de la photo', () => {
  test('ajouter une photo, la garder après refus, puis la supprimer : message, initiales, fichier retiré, rechargement sans photo', async ({ page, request }) => {
    await openProfile(page, HELENE);
    const photo = page.locator('img[src*="/uploads/"]');
    await expect(photo).toHaveCount(0);
    await expect(page.locator('#supprimer-photo')).toHaveCount(0);

    await page.locator('#photo').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
    await expect(photo).toBeVisible();
    const src = (await photo.getAttribute('src')) as string;
    expect((await request.get(src)).status(), 'le fichier téléversé se sert').toBe(200);
    await expect(bar(page)).toHaveCount(0);

    await test.step('Garder la photo : rien ne change, le focus revient sur « Supprimer la photo »', async () => {
      await page.locator('#supprimer-photo').click();
      await expect(page.locator('#confirmer-suppression-photo')).toHaveText('Oui, supprimer');
      await expect(page.locator('#confirmer-suppression-photo')).toBeFocused();
      await page.getByRole('button', { name: 'Garder la photo' }).click();
      await expect(page.locator('#confirmer-suppression-photo')).toHaveCount(0);
      await expect(page.locator('#supprimer-photo')).toBeFocused();
      await expect(photo).toBeVisible();
      expect((await request.get(src)).status()).toBe(200);
    });

    await test.step('Oui, supprimer : « Photo supprimée », la photo disparaît, le fichier aussi', async () => {
      await page.locator('#supprimer-photo').click();
      await page.locator('#confirmer-suppression-photo').click();
      await expect(page.getByText('Photo supprimée')).toBeVisible();
      await expect(photo).toHaveCount(0);
      await expect(page.locator('#supprimer-photo')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Oui, supprimer' })).toHaveCount(0);
      await expect(page.locator('label[for="photo"]')).toHaveText('Ajouter une photo');
      await expect(bar(page)).toHaveCount(0);
      expect((await request.get(src)).status(), 'le fichier est retiré du disque').toBe(404);
    });

    await page.reload();
    await hydrated(page);
    await expect(photo).toHaveCount(0);
    await expect(page.locator('#supprimer-photo')).toHaveCount(0);
  });

  test('un échec du serveur affiche un message précis, la photo reste et on peut recommencer', async ({ page }) => {
    await openProfile(page, HELENE);
    await page.locator('#photo').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
    const photo = page.locator('img[src*="/uploads/"]');
    await expect(photo).toBeVisible();

    await page.route('**/api/espace/me/photo', (route) => (route.request().method() === 'DELETE' ? route.abort('failed') : route.continue()));
    await page.locator('#supprimer-photo').click();
    await page.locator('#confirmer-suppression-photo').click();
    await expect(page.getByText('La suppression de la photo a échoué')).toBeVisible();
    await expect(photo).toBeVisible();

    await page.unroute('**/api/espace/me/photo');
    await page.locator('#supprimer-photo').click();
    await page.locator('#confirmer-suppression-photo').click();
    await expect(page.getByText('Photo supprimée')).toBeVisible();
    await expect(photo).toHaveCount(0);
  });
});

test.describe('F-148 : confirmation avant déconnexion', () => {
  test('sans JavaScript, le formulaire part tel quel : retour à E0, session fermée', async ({ browser, baseURL }) => {
    const first = await browser.newContext({ baseURL });
    const page = await first.newPage();
    await openSpace(page, PIERRE);
    const cookies = await first.cookies();
    await first.close();

    const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
    await context.addCookies(cookies);
    const bare = await context.newPage();
    await bare.goto(`${ESPACE}/profil`);
    await expect(bare.locator('dialog#confirmation-deconnexion')).toBeHidden();
    await bare.getByRole('button', { name: 'Me déconnecter' }).click();
    await expect(bare).toHaveURL(`${baseURL}${ESPACE}/connexion?deconnecte=1`);
    await bare.goto(`${ESPACE}/profil`);
    await expect(bare).toHaveURL(`${baseURL}${ESPACE}/connexion`);
    await context.close();
  });

  test('avec JavaScript : la fenêtre s’ouvre, « Rester connecté » (ou Échap) garde la session, « Me déconnecter » la ferme', async ({ page, baseURL }) => {
    await openSpace(page, PIERRE);
    await page.goto(`${ESPACE}/profil`);
    await hydrated(page);
    const dialog = page.locator('dialog#confirmation-deconnexion');
    await expect(dialog).toBeHidden();

    await page.locator('form[data-espace-deconnexion]').getByRole('button', { name: 'Me déconnecter' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Se déconnecter ?' })).toBeVisible();
    await expect(dialog).toContainText('nouveau lien de connexion ou un code');
    await expect(dialog.locator('[data-deconnexion-annuler]')).toHaveText('Rester connecté');
    await expect(dialog.locator('[data-deconnexion-annuler]')).toBeFocused();

    await dialog.locator('[data-deconnexion-annuler]').click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/profil`);

    await page.locator('form[data-espace-deconnexion]').getByRole('button', { name: 'Me déconnecter' }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/profil`);

    await page.locator('form[data-espace-deconnexion]').getByRole('button', { name: 'Me déconnecter' }).click();
    await dialog.locator('[data-deconnexion-confirmer]').click();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/connexion?deconnecte=1`);
    await page.goto(`${ESPACE}/profil`);
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/connexion`);
  });
});

test.describe('F-149 : avatar menant au profil sous 1024 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  const avatar = (page: Page) => page.locator('a[data-profil-avatar]');

  for (const [name, path] of [
    ['Annuaire', 'annuaire'],
    ['Agenda', 'agenda'],
    ['Messages', 'messages'],
    ['Programme', 'programme'],
    ['Mon profil', 'profil'],
  ] as const) {
    test(`${name} : l’avatar est visible, nommé « Mon profil, Prénom Nom », et mène au profil`, async ({ page }) => {
      await signIn(page, MARION);
      await page.goto(`${ESPACE}/${path}`);
      await expect(avatar(page)).toBeVisible();
      await expect(avatar(page)).toHaveAccessibleName('Mon profil, Marion Lacoste');
      await expect(avatar(page)).toHaveAttribute('href', `${ESPACE}/profil`);
      const box = await avatar(page).boundingBox();
      expect(box!.width, 'cible tactile de 44 px').toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    });
  }

  test('l’accueil n’en ajoute pas : il a déjà le sien', async ({ page }) => {
    await signIn(page, MARION);
    await page.goto(`${ESPACE}/`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(avatar(page)).toHaveCount(0);
  });

  test('un clic sur l’avatar ouvre le profil', async ({ page, baseURL }) => {
    await signIn(page, MARION);
    await page.goto(`${ESPACE}/annuaire`);
    await avatar(page).click();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/profil`);
  });

  test('à 1024 px et au-delà, l’avatar n’est plus affiché (la colonne latérale porte « Mon profil »)', async ({ page }) => {
    await signIn(page, MARION);
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(`${ESPACE}/annuaire`);
    await expect(avatar(page)).toBeHidden();
    await page.setViewportSize({ width: 1023, height: 800 });
    await expect(avatar(page)).toBeVisible();
  });
});

test.describe('Ancre #visibilite', () => {
  test('/profil#visibilite amène le bloc des choix de visibilité à l’écran', async ({ page }) => {
    await signIn(page, MARION);
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto(`${ESPACE}/profil#visibilite`);
    await hydrated(page);
    const block = page.locator('#visibilite');
    await expect(block).toContainText('Vos choix de visibilité');
    await expect(block).toBeInViewport();
    expect((await block.boundingBox())!.y, 'le bloc commence dans l’écran').toBeGreaterThanOrEqual(0);
  });

  test('le lien « Modifier ma visibilité » de l’accueil mène à /profil#visibilite', async ({ page, baseURL }) => {
    await signIn(page, CLARA);
    await page.goto(`${ESPACE}/`);
    const link = page.getByRole('link', { name: 'Modifier ma visibilité' });
    await expect(link).toHaveAttribute('href', `${ESPACE}/profil#visibilite`);
    await link.click();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/profil#visibilite`);
    await hydrated(page);
    await expect(page.locator('#visibilite')).toBeInViewport();
  });
});
