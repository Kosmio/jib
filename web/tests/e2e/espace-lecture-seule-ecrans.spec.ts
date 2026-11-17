import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { ESPACE, expect, hydrated, openSpace, receiveLink, test } from './espace';

/**
 * Lecture seule visible sur les écrans (V4-F2 et V4-F3, NF-70).
 *
 * Édition terminée : bandeau « L’édition est terminée, votre espace reste consultable. » sur les neuf écrans à onglets, actions d'écriture
 * désactivées (demande de rendez-vous, message, profil), préférences e-mail enregistrables (PATCH /me limité à `emailPrefs`), déconnexion,
 * exports et pilotage intacts, droits RGPD (V5-A : « Télécharger mes données », « Supprimer mes données ») utilisables. Édition ouverte :
 * rien de désactivé, champs de V5-D préremplis par la page sans appel supplémentaire à GET /me.
 *
 * - L'édition de recette est modifiée par SQL (`docker exec jib-postgres psql`) sur la base e2e de l'exécution : `read_only_at` dans le passé
 *   sur les lignes brouillon et publiée, puis remis tel quel par `afterAll`. Les champs B2B de Nathan, posés pour le test de l'édition
 *   ouverte, sont remis de même. Aucune route ni aide partagée ne le permet.
 * - Une session par adresse (limite de 5 liens par 15 minutes, NF-03), ouverte pendant la phase « édition ouverte » ; Alice se connecte
 *   pendant la lecture seule (parcours E0, verifier, déconnexion).
 * - « Supprimer mes données » n'est jamais confirmé : le test s'arrête à la boîte de confirmation, annulée.
 */

const DATABASE = process.env.E2E_DATABASE ?? 'strapi_e2e';
const SLUG = 'nouvelle-aquitaine-test';
const BANDEAU = 'L’édition est terminée, votre espace reste consultable.';

const LEA = 'lea.ducasse@example.org';
const NATHAN = 'nathan.lasserre@example.org';
const ALICE = 'alice.fourcade@example.org';
const ORGANIZER = 'organisation@example.org';

function sql(statement: string): string {
  expect(DATABASE.endsWith('_e2e'), `base e2e attendue, reçu ${DATABASE}`).toBe(true);
  const result = spawnSync('docker', ['exec', 'jib-postgres', 'psql', '-U', 'strapi', '-d', DATABASE, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', statement], { encoding: 'utf8' });
  expect(result.status, `SQL « ${statement} » : ${result.stderr}`).toBe(0);
  return result.stdout.trim();
}

type Row = { id: string; readOnlyAt: string };
type Backup = { rows: Row[]; attendee: { lookingFor: string; offering: string; phone: string } };
// L'état d'origine est aussi écrit dans un fichier : après un test en échec, Playwright relance un worker, qui n'a plus la mémoire du premier.
const BACKUP_FILE = path.join(tmpdir(), `lecture-seule-ecrans-${DATABASE}.json`);

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

async function visit(page: Page, email: string, path: string) {
  await signIn(page, email);
  await page.goto(path.startsWith('/espace/') ? path : `${ESPACE}${path}`);
  await hydrated(page);
}

const bandeau = (page: Page) => page.locator('[data-lecture-seule-bandeau]');

/** Champs de <main> encore actifs, hors ce que la lecture seule permet (préférences e-mail, déconnexion) et hors droits RGPD (testés à part). */
const activeFields = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#main-content button, #main-content input, #main-content textarea, #main-content select')]
      .filter((el) => !el.hasAttribute('disabled') && !el.closest('[data-permis-lecture-seule], [data-espace-deconnexion]'))
      .filter((el) => !/^(Télécharger mes données|Supprimer mes données)/.test(el.textContent?.trim() ?? ''))
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} « ${(el.textContent || el.getAttribute('aria-label') || el.getAttribute('name') || '').trim().slice(0, 40)} »`),
  );

const disabledFields = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#main-content button, #main-content input, #main-content textarea, #main-content select')]
      .filter((el) => el.hasAttribute('disabled'))
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}`),
  );

let fichePath = '';
let nouveauPath = '';
let threadPath = '';

// ---------------------------------------------------------------------------------------------------------------------------------------
// Édition ouverte : rien n'est désactivé
// ---------------------------------------------------------------------------------------------------------------------------------------

// Remet l'édition et les champs de Nathan tels qu'ils étaient, quoi qu'il arrive aux tests.
test.afterAll(() => {
  if (!existsSync(BACKUP_FILE)) return;
  const { rows, attendee }: Backup = JSON.parse(readFileSync(BACKUP_FILE, 'utf8'));
  for (const row of rows) {
    sql(`update editions set read_only_at = ${row.readOnlyAt ? `'${row.readOnlyAt}'` : 'null'} where id = ${row.id}`);
  }
  sql(`update espace_attendees set looking_for = ${attendee.lookingFor}, offering = ${attendee.offering}, phone = ${attendee.phone} where email = '${NATHAN}'`);
});

test.describe('édition ouverte', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    const rows: Row[] = sql(`select id || '|' || coalesce(read_only_at::text, '') from editions where slug = '${SLUG}'`)
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [id, readOnlyAt] = line.split('|');
        return { id, readOnlyAt };
      });
    expect(rows.length, 'lignes brouillon et publiée de l’édition de recette').toBeGreaterThan(0);
    const one = (column: string) => sql(`select quote_nullable(${column}) from espace_attendees where email = '${NATHAN}'`);
    const backup: Backup = { rows, attendee: { lookingFor: one('looking_for'), offering: one('offering'), phone: one('phone') } };
    writeFileSync(BACKUP_FILE, JSON.stringify(backup));
    sql(`update espace_attendees set looking_for = 'Un scieur partenaire', offering = 'Du bois sec certifié', phone = '05 56 00 11 22' where email = '${NATHAN}'`);
  });

  test('aucun bandeau, aucun champ désactivé sur le profil, l’accueil et les messages', async ({ page }) => {
    for (const path of ['/profil', '/', '/messages']) {
      await visit(page, LEA, path);
      await expect(page.locator('html[data-lecture-seule]'), path).toHaveCount(0);
      await expect(bandeau(page), path).toHaveCount(0);
      expect(await disabledFields(page), `champs désactivés sur ${path}`).toEqual([]);
    }
    await expect(page.locator('#enregistrer-preferences')).toHaveCount(0);
  });

  test('V5-D : « Je cherche », « Je propose » et « Téléphone » sont préremplis sans requête GET /me du navigateur', async ({ page }) => {
    const meReads: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'GET' && /\/api\/espace\/me(\?|$)/.test(request.url())) meReads.push(request.url());
    });
    await visit(page, NATHAN, '/profil');
    await expect(page.getByLabel(/^Je cherche/)).toHaveValue('Un scieur partenaire');
    await expect(page.getByLabel(/^Je propose/)).toHaveValue('Du bois sec certifié');
    await expect(page.getByLabel(/^Téléphone/)).toHaveValue('05 56 00 11 22');
    expect(meReads, 'lectures de GET /me faites par le navigateur').toEqual([]);
  });

  test('collecte des adresses utilisées par les tests de lecture seule (fiche, nouveau message, fil)', async ({ page }) => {
    await visit(page, LEA, '/annuaire');
    await page.getByRole('searchbox', { name: /Rechercher un profil/ }).fill('Lagrange');
    const fiche = page.getByRole('link', { name: /Mathis Lagrange/ });
    fichePath = (await fiche.getAttribute('href'))!;
    expect(fichePath).toMatch(/\/annuaire\/p\//);
    await fiche.click();
    await hydrated(page);
    nouveauPath = (await page.getByRole('link', { name: /Écrire un message/ }).getAttribute('href'))!;
    expect(nouveauPath).toMatch(/\/messages\/nouveau\?avec=/);
    await page.goto(`${ESPACE}/messages`);
    await hydrated(page);
    const thread = page.locator('#main-content a[href*="/messages/"]').filter({ hasNot: page.locator('[href*="nouveau"]') }).first();
    threadPath = (await thread.getAttribute('href'))!;
    expect(threadPath).toMatch(/\/messages\/[a-z0-9]+$/);
  });

  test('session de l’organisateur ouverte avant la lecture seule', async ({ page }) => {
    await signIn(page, ORGANIZER);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// Édition terminée
// ---------------------------------------------------------------------------------------------------------------------------------------

test.describe('édition terminée', () => {
  test.beforeAll(() => {
    sql(`update editions set read_only_at = now() - interval '1 day' where slug = '${SLUG}'`);
  });

  test('connexion : bandeau « édition terminée » sous le titre de l’édition', async ({ page }) => {
    await page.goto(`${ESPACE}/connexion`);
    await expect(page.getByRole('status').filter({ hasText: BANDEAU })).toBeVisible();
  });

  test('verifier : la page du lien porte le bandeau, et « Ouvrir mon espace » ouvre encore la session (Alice)', async ({ page }) => {
    await page.goto(await receiveLink(page, ALICE));
    await expect(page.getByRole('status').filter({ hasText: BANDEAU })).toBeVisible();
    await page.getByRole('button', { name: 'Ouvrir mon espace' }).click();
    await expect(page).toHaveURL(new RegExp(`${ESPACE}/(bienvenue)?$`));
    sessions.set(ALICE, await page.context().cookies());
  });

  test('bienvenue : bandeau d’édition terminée', async ({ page }) => {
    await signIn(page, LEA);
    await page.goto(`${ESPACE}/bienvenue`);
    if (new URL(page.url()).pathname.endsWith('/bienvenue')) {
      await expect(page.getByRole('status').filter({ hasText: BANDEAU })).toBeVisible();
    } else {
      test.info().annotations.push({ type: 'note', description: 'Léa a déjà consenti : bienvenue redirige, bandeau non vérifié ici' });
    }
  });

  for (const [name, path] of [
    ['accueil', '/'],
    ['agenda', '/agenda'],
    ['annuaire', '/annuaire'],
    ['programme', '/programme'],
    ['messages', '/messages'],
    ['profil', '/profil'],
  ] as const) {
    test(`${name} : bandeau, <html data-lecture-seule>, aucun champ d’écriture actif`, async ({ page }) => {
      await visit(page, LEA, path);
      await expect(bandeau(page)).toHaveText(BANDEAU);
      await expect(bandeau(page)).toHaveAttribute('role', 'status');
      await expect(page.locator('html[data-lecture-seule]')).toHaveCount(1);
      await expect.poll(() => activeFields(page), { message: 'champs d’écriture encore actifs' }).toEqual([]);
    });
  }

  test('fiche d’une personne : bandeau, créneaux et envoi de la demande de rendez-vous désactivés', async ({ page }) => {
    await visit(page, LEA, fichePath);
    await expect(bandeau(page)).toHaveText(BANDEAU);
    await expect.poll(() => activeFields(page), { message: 'champs d’écriture encore actifs' }).toEqual([]);
    const slots = page.locator('#main-content button').filter({ hasText: /^\d{1,2}h\d{2}/ });
    expect(await slots.count(), 'créneaux affichés').toBeGreaterThan(0);
    for (const slot of await slots.all()) await expect(slot).toBeDisabled();
  });

  test('nouveau message : bandeau, zone de saisie et bouton d’envoi désactivés', async ({ page }) => {
    await visit(page, LEA, nouveauPath);
    await expect(bandeau(page)).toHaveText(BANDEAU);
    await expect.poll(() => activeFields(page), { message: 'champs d’écriture encore actifs' }).toEqual([]);
  });

  test('fil de messages : bandeau, saisie et envoi désactivés, Ctrl+Entrée n’envoie rien', async ({ page }) => {
    await visit(page, LEA, threadPath);
    await expect(bandeau(page)).toHaveText(BANDEAU);
    const sent: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/messages(\?|$)/.test(request.url())) sent.push(request.url());
    });
    const box = page.locator('#main-content textarea');
    await expect(box).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
    await box.dispatchEvent('keydown', { key: 'Enter', ctrlKey: true });
    expect(sent, 'envois de message').toEqual([]);
    expect(await activeFields(page)).toEqual([]);
  });

  test('profil : plus de barre d’enregistrement générale, champs du profil désactivés', async ({ page }) => {
    await visit(page, LEA, '/profil');
    await expect(page.locator('[data-barre-enregistrement]')).toHaveCount(0);
    await expect(page.locator('#enregistrer')).toHaveCount(0);
    await expect(page.getByLabel(/^Présentation/)).toBeDisabled();
    await expect(page.getByLabel(/^Je cherche/)).toBeDisabled();
  });

  test('profil : « Enregistrer mes préférences » inactif tant que rien n’a changé, puis PATCH /me avec { emailPrefs } seul, sans 409', async ({ page }) => {
    await visit(page, NATHAN, '/profil');
    const save = page.getByRole('button', { name: 'Enregistrer mes préférences' });
    const first = page.locator('#emailPrefs-0');
    await expect(first).toBeEnabled();
    await expect(save).toBeDisabled();

    const initial = await first.isChecked();
    const patches: { body: any; status: number }[] = [];
    page.on('response', async (response) => {
      const request = response.request();
      if (request.method() === 'PATCH' && /\/api\/espace\/me$/.test(response.url())) patches.push({ body: request.postDataJSON(), status: response.status() });
    });

    await first.setChecked(!initial);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText('Préférences enregistrées')).toBeVisible();
    await expect(save).toBeDisabled();
    expect(patches).toHaveLength(1);
    expect(Object.keys(patches[0].body)).toEqual(['emailPrefs']);
    expect(patches[0].status).toBe(200);

    // La valeur est conservée au rechargement ; on la remet ensuite dans son état d'origine.
    await page.reload();
    await hydrated(page);
    await expect(page.locator('#emailPrefs-0')).toBeChecked({ checked: !initial });
    await page.locator('#emailPrefs-0').setChecked(initial);
    await page.getByRole('button', { name: 'Enregistrer mes préférences' }).click();
    await expect(page.getByText('Préférences enregistrées')).toBeVisible();
    expect(patches.every((patch) => patch.status === 200)).toBe(true);
  });

  test('V5-A, F-33, R-44 : « Télécharger mes données » reste utilisable (droit RGPD)', async ({ page }) => {
    await visit(page, NATHAN, '/profil');
    const button = page.getByRole('button', { name: 'Télécharger mes données' });
    await expect(button, 'PrivacyActions.tsx : boutons sans data-permis-lecture-seule').toBeEnabled();
    const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
    expect(download.suggestedFilename()).not.toBe('');
  });

  test('V5-A, F-33, R-44 : « Supprimer mes données » reste utilisable, la confirmation s’ouvre (annulée ici)', async ({ page }) => {
    await visit(page, NATHAN, '/profil');
    const button = page.getByRole('button', { name: 'Supprimer mes données', exact: true });
    await expect(button, 'PrivacyActions.tsx : boutons sans data-permis-lecture-seule').toBeEnabled();
    await button.click();
    await expect(page.getByRole('heading', { name: 'Supprimer mes données ?' })).toBeVisible();
    await page.getByRole('button', { name: 'Annuler' }).click();
  });

  test('pilotage : ni bandeau ni champ désactivé, et l’export des participants se télécharge', async ({ page }) => {
    await visit(page, ORGANIZER, '/organisateur');
    await expect(page.locator('html[data-lecture-seule]')).toHaveCount(0);
    await expect(bandeau(page)).toHaveCount(0);
    expect(await disabledFields(page), 'champs désactivés sur le pilotage').toEqual([]);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /^Participants/ }).click()]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`^participants-${SLUG}-\\d{4}-\\d{2}-\\d{2}\\.csv$`));
  });

  test('profil : « Me déconnecter » reste possible, avec sa confirmation (Alice)', async ({ page }) => {
    await visit(page, ALICE, '/profil');
    await page.getByRole('button', { name: 'Me déconnecter' }).click();
    const dialog = page.getByRole('dialog', { name: 'Se déconnecter ?' });
    await expect(dialog).toBeVisible();
    const confirm = dialog.locator('[data-deconnexion-confirmer]');
    await expect(confirm, 'le bouton de confirmation de la déconnexion n’est pas désactivé').toBeEnabled();
    await confirm.click();
    await expect(page).toHaveURL(new RegExp(`${ESPACE}/connexion`));
  });
});
