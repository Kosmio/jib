import { ESPACE, expect, hydrated, openSpace, test } from './espace';

/**
 * Consentement compris (V2-B, F-116, F-118) : conséquence de chaque case de E2, confirmation en ligne quand l'annuaire est décoché,
 * échec précis du second enregistrement, effets affichés sur le profil (E3).
 *
 * Chaque test prend un inscrit déjà activé que les autres fichiers n'utilisent pas (alice, jules) et ouvre E2 par son adresse : E2 reste
 * accessible après activation. Les enregistrements qui modifient un choix le remettent en l'état avant la fin du test.
 */

const ALICE = 'alice.fourcade@example.org'; // annuaire, rendez-vous : cochés ; nouvelles : décochée
const JULES = 'jules.mazeres@example.org'; // idem

const DIRECTORY = 'Apparaître dans l’annuaire des participants';
const MEETINGS = 'Recevoir des demandes de rendez-vous et des messages';
const NEWS = 'Recevoir des nouvelles des prochaines éditions';
const DIRECTORY_EFFECT = 'Vous ne serez pas visible et ne recevrez aucune demande.';
const MEETINGS_EFFECT = 'Vous pourrez proposer des rendez-vous, pas en recevoir.';

// La session de chaque inscrit est ouverte une fois pour toute la suite par `openSpace` (cinq demandes de lien par adresse et par 15 minutes, NF-03).
const signIn = openSpace;

async function openWelcome(page: import('@playwright/test').Page, email: string) {
  await signIn(page, email);
  await page.goto(`${ESPACE}/bienvenue`);
  await hydrated(page);
}

test.describe('E2, écran de bienvenue (F-116)', () => {
  test('le bloc ne dit plus « facultatif » et ne coche rien lui-même', async ({ page }) => {
    await openWelcome(page, JULES);
    const block = page.getByRole('group', { name: 'Vos choix de visibilité' });
    await expect(block).toBeVisible();
    await expect(block).not.toContainText(/facultati/i);
    // Les cases reflètent la valeur du serveur (D-14) : cochées pour jules, la troisième non.
    await expect(page.getByRole('checkbox', { name: DIRECTORY })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: MEETINGS })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: NEWS })).not.toBeChecked();
    await expect(page.locator('#badge-consentement')).toContainText('QR code');
  });

  test('chaque case décochée dit sa conséquence, et l’effet disparaît quand on la recoche', async ({ page }) => {
    await openWelcome(page, JULES);
    await expect(page.locator('#directoryOptIn-effet')).toHaveCount(0);
    await expect(page.locator('#meetingsOptIn-effet')).toHaveCount(0);

    await page.getByRole('checkbox', { name: DIRECTORY }).uncheck();
    await expect(page.locator('#directoryOptIn-effet')).toHaveText(DIRECTORY_EFFECT);
    await expect(page.getByRole('checkbox', { name: DIRECTORY })).toHaveAccessibleDescription(new RegExp(DIRECTORY_EFFECT));

    await page.getByRole('checkbox', { name: MEETINGS }).uncheck();
    await expect(page.locator('#meetingsOptIn-effet')).toHaveText(MEETINGS_EFFECT);
    await expect(page.getByRole('checkbox', { name: MEETINGS })).toHaveAccessibleDescription(new RegExp(MEETINGS_EFFECT));

    await page.getByRole('checkbox', { name: DIRECTORY }).check();
    await page.getByRole('checkbox', { name: MEETINGS }).check();
    await expect(page.locator('#directoryOptIn-effet')).toHaveCount(0);
    await expect(page.locator('#meetingsOptIn-effet')).toHaveCount(0);
    // La case des nouvelles n'a pas d'effet à annoncer.
    await page.getByRole('checkbox', { name: NEWS }).uncheck();
    await expect(page.locator('#newsOptIn-effet')).toHaveCount(0);
  });

  test('valider sans l’annuaire affiche la confirmation, annoncée, avec le focus, sans rien enregistrer', async ({ page, baseURL }) => {
    await openWelcome(page, JULES);
    await page.getByRole('checkbox', { name: DIRECTORY }).uncheck();
    const saved = page.waitForRequest((request) => request.method() === 'PATCH' && request.url().includes('/me'), { timeout: 1500 }).then(
      () => true,
      () => false,
    );
    // Retour de recette du 18/11 : au moins un sujet à l’arrivée.
    if (!(await page.locator('input[id^="sujet-"]:checked').count()) && (await page.locator('input[id^="sujet-"]').count())) await page.locator('input[id^="sujet-"]').first().check();
    await page.getByRole('button', { name: 'Continuer', exact: true }).click();

    const confirmation = page.locator('#confirmation-annuaire');
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toHaveAttribute('role', 'alert');
    await expect(confirmation).toBeFocused();
    await expect(confirmation).toContainText('Vous n’apparaîtrez pas dans l’annuaire');
    await expect(confirmation.getByRole('button', { name: 'Continuer sans apparaître' })).toBeVisible();
    await expect(confirmation.getByRole('button', { name: 'Apparaître dans l’annuaire' })).toBeVisible();
    expect(await saved, 'aucun enregistrement avant le choix').toBe(false);
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/bienvenue`);
  });

  test('avec l’annuaire coché, aucune confirmation : Continuer enregistre et ouvre E1', async ({ page, baseURL }) => {
    await openWelcome(page, JULES);
    // Retour de recette du 18/11 : au moins un sujet à l’arrivée.
    if (!(await page.locator('input[id^="sujet-"]:checked').count()) && (await page.locator('input[id^="sujet-"]').count())) await page.locator('input[id^="sujet-"]').first().check();
    await page.getByRole('button', { name: 'Continuer', exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/`);
  });

  test('recocher l’annuaire retire la confirmation', async ({ page }) => {
    await openWelcome(page, JULES);
    await page.getByRole('checkbox', { name: DIRECTORY }).uncheck();
    // Retour de recette du 18/11 : au moins un sujet à l’arrivée.
    if (!(await page.locator('input[id^="sujet-"]:checked').count()) && (await page.locator('input[id^="sujet-"]').count())) await page.locator('input[id^="sujet-"]').first().check();
    await page.getByRole('button', { name: 'Continuer', exact: true }).click();
    await expect(page.locator('#confirmation-annuaire')).toBeVisible();
    await page.getByRole('checkbox', { name: DIRECTORY }).check();
    await expect(page.locator('#confirmation-annuaire')).toHaveCount(0);
  });

  test('« Continuer sans apparaître » enregistre l’annuaire décoché, « Apparaître dans l’annuaire » le coche et l’enregistre', async ({ page, baseURL }) => {
    await openWelcome(page, ALICE);
    await page.getByRole('checkbox', { name: DIRECTORY }).uncheck();
    // Retour de recette du 18/11 : au moins un sujet à l’arrivée.
    if (!(await page.locator('input[id^="sujet-"]:checked').count()) && (await page.locator('input[id^="sujet-"]').count())) await page.locator('input[id^="sujet-"]').first().check();
    await page.getByRole('button', { name: 'Continuer', exact: true }).click();
    await page.getByRole('button', { name: 'Continuer sans apparaître' }).click();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/`);

    await page.goto(`${ESPACE}/bienvenue`);
    await hydrated(page);
    await expect(page.getByRole('checkbox', { name: DIRECTORY })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: MEETINGS })).toBeChecked();

    // Même écran, autre choix : la confirmation coche la case et enregistre (l'état de départ est ainsi rétabli).
    // Retour de recette du 18/11 : au moins un sujet à l’arrivée.
    if (!(await page.locator('input[id^="sujet-"]:checked').count()) && (await page.locator('input[id^="sujet-"]').count())) await page.locator('input[id^="sujet-"]').first().check();
    await page.getByRole('button', { name: 'Continuer', exact: true }).click();
    await page.getByRole('button', { name: 'Apparaître dans l’annuaire' }).click();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/`);

    await page.goto(`${ESPACE}/bienvenue`);
    await hydrated(page);
    await expect(page.getByRole('checkbox', { name: DIRECTORY })).toBeChecked();
  });

  test('l’échec du second enregistrement dit ce qui est déjà enregistré, et le focus revient sur « Continuer »', async ({ page, baseURL }) => {
    await openWelcome(page, JULES);
    await page.route('**/me/consent', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"Erreur"}}' }));
    // Retour de recette du 18/11 : au moins un sujet à l’arrivée.
    if (!(await page.locator('input[id^="sujet-"]:checked').count()) && (await page.locator('input[id^="sujet-"]').count())) await page.locator('input[id^="sujet-"]').first().check();
    await page.getByRole('button', { name: 'Continuer', exact: true }).click();

    await expect(page.getByRole('alert')).toContainText('Vos informations sont enregistrées, mais pas vos choix de visibilité');
    await expect(page.getByRole('button', { name: 'Continuer', exact: true })).toBeFocused();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/bienvenue`);
  });

  test('l’échec du second enregistrement après la confirmation dit aussi ce qui est enregistré', async ({ page }) => {
    await openWelcome(page, JULES);
    await page.route('**/me/consent', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"Erreur"}}' }));
    await page.getByRole('checkbox', { name: DIRECTORY }).uncheck();
    // Retour de recette du 18/11 : au moins un sujet à l’arrivée.
    if (!(await page.locator('input[id^="sujet-"]:checked').count()) && (await page.locator('input[id^="sujet-"]').count())) await page.locator('input[id^="sujet-"]').first().check();
    await page.getByRole('button', { name: 'Continuer', exact: true }).click();
    await page.getByRole('button', { name: 'Continuer sans apparaître' }).click();
    await expect(page.getByRole('alert')).toContainText('Vos informations sont enregistrées, mais pas vos choix de visibilité');
    await expect(page.locator('#confirmation-annuaire')).toHaveCount(0);
  });

  test('retour de recette du 18/11 : sans sujet coché, « Continuer » le demande et n’enregistre rien', async ({ page }) => {
    await openWelcome(page, JULES);
    const topics = page.locator('input[id^="sujet-"]');
    test.skip((await topics.count()) === 0, 'édition de recette sans sujets');
    for (const box of await topics.all()) await box.setChecked(false);
    const saved = page.waitForRequest((request) => request.method() === 'PATCH' && request.url().includes('/me'), { timeout: 1500 }).then(
      () => true,
      () => false,
    );
    await page.getByRole('button', { name: 'Continuer', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Choisissez au moins un sujet' })).toBeVisible();
    await expect(topics.first()).toBeFocused();
    expect(await saved).toBe(false);
  });
});

test.describe('E3, profil (F-118)', () => {
  test('décocher « Recevoir des demandes » annonce l’effet sur les demandes en attente', async ({ page }) => {
    await signIn(page, JULES);
    await page.goto(`${ESPACE}/profil`);
    await hydrated(page);
    const meetings = page.getByRole('checkbox', { name: MEETINGS });
    await expect(page.getByText(/Vous ne recevrez plus de nouvelles demandes de rendez-vous/)).toHaveCount(0);
    await meetings.uncheck();
    await expect(page.getByText(/Vous ne recevrez plus de nouvelles demandes de rendez-vous\. Celles déjà en attente restent dans votre agenda/)).toBeVisible();
    await meetings.check();
    await expect(page.getByText(/Vous ne recevrez plus de nouvelles demandes/)).toHaveCount(0);
  });

  test('décocher une plage de disponibilité affiche l’effet, relié à la case', async ({ page }) => {
    await signIn(page, JULES);
    await page.goto(`${ESPACE}/profil`);
    await hydrated(page);
    const range = page.locator('#plage-0');
    await expect(range).toBeChecked();
    await expect(page.locator('#plage-0-effet')).toHaveCount(0);
    await range.uncheck();
    await expect(page.locator('#plage-0-effet')).toContainText('Aucun nouveau créneau ne sera proposé sur cette plage');
    await expect(page.locator('#plage-0-effet')).toContainText('les demandes en attente restent dans votre agenda');
    await expect(range).toHaveAccessibleDescription(/Aucun nouveau créneau/);
    await range.check();
    await expect(page.locator('#plage-0-effet')).toHaveCount(0);
  });
});
