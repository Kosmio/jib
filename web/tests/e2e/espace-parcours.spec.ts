import { gzipSync } from 'node:zlib';
import { capture, ESPACE, expect, receiveLink, test } from './espace';

/**
 * Parcours complet de la phase 1 dans le navigateur (lot 7, critère 1 du lot 6) avec Tom Laffitte, l'inscrit de la recette qui n'a
 * encore ni activé son espace ni donné son consentement :
 *   E0, message d'envoi, lien lu dans la boîte de sortie, bouton « Ouvrir mon espace », E2 (F-10 à F-12), « Continuer », E1, déconnexion, E0.
 * Comprend l'îlot d'E2 contre Strapi sur une autre origine (CORS avec cookie, NF-04) et son poids (NF-20).
 *
 * Un seul test à étapes : chaque étape dépend de la précédente, et le lien comme le consentement ne se refont pas.
 */

const TOM = 'tom.laffitte@example.org';
const NOTE_F11 = 'Sans apparaître dans l’annuaire, seules les personnes à qui vous écrivez pourront vous proposer un rendez-vous.';
const ISLAND_BUDGET_BYTES = 80 * 1024; // NF-20 : JavaScript d'îlot, compressé

test('Tom : E0, lien, vérification, E2, E1, déconnexion, E0', async ({ page, context, baseURL }) => {
  const scripts: { url: string; gzipped: number }[] = [];
  page.on('response', async (response) => {
    if (response.request().resourceType() !== 'script') return;
    const body = await response.body().catch(() => Buffer.alloc(0));
    scripts.push({ url: response.url(), gzipped: gzipSync(body).length });
  });
  const sessionCookie = async () => (await context.cookies()).find((cookie) => cookie.name === 'jib_espace');

  let link = '';
  await test.step('E0 : demande du lien', async () => {
    link = await receiveLink(page, TOM);
    await expect(page.getByRole('status')).toHaveText('Si cette adresse est inscrite, un lien vient de vous être envoyé.');
    expect(await sessionCookie(), 'aucune session avant le lien').toBeUndefined();
    expect(scripts, 'E0 sans JavaScript').toEqual([]);
  });

  await test.step('vérification : « Ouvrir mon espace » mène à E2 (aucun consentement enregistré)', async () => {
    await page.goto(link);
    await page.getByRole('button', { name: 'Ouvrir mon espace' }).click();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/bienvenue`);

    const cookie = await sessionCookie();
    expect(cookie, 'cookie de session jib_espace').toBeDefined();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', secure: false, path: '/' });
    expect(cookie!.expires).toBeGreaterThan(Date.now() / 1000 + 29 * 24 * 3600); // 30 jours (I-22)
  });

  // Conteneur de la note F-11 : toujours présent, vide donc masqué (`empty:hidden`) tant qu'il n'y a rien à dire, ce que getByRole ne voit pas.
  const note = page.locator('form [role="status"]');

  await test.step('E2 : valeurs importées modifiables, trois cases décochées (F-10)', async () => {
    await expect(page).toHaveTitle(/^Vos informations \| /);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bienvenue, Tom');
    await expect(page.getByLabel('Prénom')).toHaveValue('Tom');
    await expect(page.getByLabel('Nom', { exact: true })).toHaveValue('Laffitte');
    await expect(page.getByLabel('Entreprise')).not.toHaveValue('');
    await expect(page.getByLabel('Fonction (facultatif)')).toBeVisible();
    for (const name of [
      'Apparaître dans l’annuaire des participants',
      'Recevoir des demandes de rendez-vous et des messages',
      'Recevoir des nouvelles des prochaines éditions',
    ]) {
      await expect(page.getByRole('checkbox', { name }), name).not.toBeChecked();
    }
    await expect(note).toBeEmpty();
    await expect(page.getByRole('button', { name: 'Continuer' })).toBeEnabled();

    expect(scripts.length, 'E2 charge l’îlot').toBeGreaterThan(0);
    const total = scripts.reduce((sum, script) => sum + script.gzipped, 0);
    expect(total, `JavaScript d’îlot de E2 compressé : ${total} octets`).toBeLessThanOrEqual(ISLAND_BUDGET_BYTES);
    await capture(page, 'E2-initial');
  });

  await test.step('E2 : note F-11 quand les rendez-vous sont acceptés sans annuaire', async () => {
    const directory = page.getByRole('checkbox', { name: 'Apparaître dans l’annuaire des participants' });
    await page.getByRole('checkbox', { name: 'Recevoir des demandes de rendez-vous et des messages' }).check();
    await expect(note).toHaveText(NOTE_F11);
    await expect(note).toBeVisible();
    await capture(page, 'E2-note-F11');

    await directory.check();
    await expect(note).toBeEmpty();
    await directory.uncheck();
    await expect(note).toHaveText(NOTE_F11);
  });

  await test.step('E2 : champs obligatoires vides, erreurs sous les champs, rien d’enregistré', async () => {
    await page.getByLabel('Prénom').fill('');
    await page.getByLabel('Entreprise').fill('');
    await page.getByRole('button', { name: 'Continuer' }).click();

    await expect(page.getByRole('alert')).toHaveText('Corrigez les champs signalés pour continuer.');
    for (const [field, label] of [
      ['firstName', 'Prénom'],
      ['company', 'Entreprise'],
    ]) {
      await expect(page.getByLabel(label), label).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByLabel(label), label).toHaveAttribute('aria-describedby', `${field}-erreur`);
      await expect(page.locator(`#${field}-erreur`), label).toBeVisible();
    }
    await expect(page.getByLabel('Nom', { exact: true })).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Prénom'), 'le focus passe au premier champ en erreur').toBeFocused();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/bienvenue`);
    await capture(page, 'E2-erreurs');
  });

  await test.step('E2 : Continuer enregistre le profil et le consentement, puis ouvre E1', async () => {
    await page.getByLabel('Prénom').fill('Thomas');
    await page.getByLabel('Entreprise').fill('Entreprise de recette');
    await page.getByRole('checkbox', { name: 'Apparaître dans l’annuaire des participants' }).check();
    await page.getByRole('button', { name: 'Continuer' }).click();

    await expect(page).toHaveURL(`${baseURL}${ESPACE}/`);
    await expect(page).toHaveTitle(/^Accueil \| /);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bonjour Thomas');
    await expect(page.getByText('Jeudi 3 décembre 2026 à Bordeaux')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Connexion réussie');
    await capture(page, 'E1-provisoire');

    // Le consentement est enregistré : E1 ne renvoie plus vers E2, et la session survit au rechargement.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bonjour Thomas');
    await page.goto(`${ESPACE}/bienvenue`);
    await expect(page.getByRole('checkbox', { name: 'Apparaître dans l’annuaire des participants' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Recevoir des demandes de rendez-vous et des messages' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Recevoir des nouvelles des prochaines éditions' })).not.toBeChecked();
    await expect(page.getByLabel('Prénom')).toHaveValue('Thomas');
    await page.goto(`${ESPACE}/`);
  });

  await test.step('déconnexion : retour à E0, session fermée', async () => {
    await page.getByRole('button', { name: 'Me déconnecter' }).click();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/connexion?deconnecte=1`);
    await expect(page.getByRole('status')).toHaveText('Déconnexion effectuée.');
    await expect(page.getByLabel('Adresse e-mail utilisée pour l’inscription')).toBeVisible();
    expect(await sessionCookie(), 'cookie effacé').toBeUndefined();
    await capture(page, 'E0-deconnecte');

    // Sans session, E1 et E2 renvoient vers E0 (F-03).
    for (const path of ['/', '/bienvenue']) {
      await page.goto(`${ESPACE}${path}`);
      await expect(page, path).toHaveURL(`${baseURL}${ESPACE}/connexion`);
    }
  });

  await test.step('le lien consommé ne rouvre pas de session', async () => {
    await page.goto(link);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Ce lien n’est plus valable');
    await expect(page.getByLabel('Adresse e-mail utilisée pour l’inscription')).toHaveValue(TOM);
  });
});
