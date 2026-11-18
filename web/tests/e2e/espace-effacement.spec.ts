import { readFileSync } from 'node:fs';
import type { BrowserContext, Page } from '@playwright/test';
import { STRAPI_URL } from './fixtures';
import { ACCESS_LINK_SUBJECT, EDITION, ESPACE, expect, hydrated, mailsTo, openSpace, psql, test } from './espace';

/**
 * Effacement et export individuel, lot V5-A (F-33, R-44, NF-12) : depuis son profil, une personne télécharge ses données puis les supprime ;
 * son interlocuteur voit ses messages sous « Participant supprimé » ; l'organisation anonymise un autre inscrit depuis sa fiche.
 *
 * Données : trois invités créés à la main par l'organisation, avec des adresses propres à l'exécution (le seed de recette n'est pas
 * touché : Léa, Mathis et les autres servent encore aux fichiers suivants). A efface ses données, B est son interlocuteur, C est anonymisé
 * par le pilotage. Les tests se suivent ; la base e2e est vidée à la suite suivante.
 */

const ORGANIZER = 'organisation@example.org';
const STAMP = Date.now();
const GUESTS = {
  A: { firstName: 'Aurelien', lastName: `Effacable${STAMP}`, email: `effacable.${STAMP}@example.org`, company: `Scierie ZXQ${STAMP}`, jobTitle: 'Directeur' },
  B: { firstName: 'Brigitte', lastName: `Interlocutrice${STAMP}`, email: `interlocutrice.${STAMP}@example.org`, company: 'Menuiserie Bleue', jobTitle: 'Gérante' },
  C: { firstName: 'Corentin', lastName: `Anonymisable${STAMP}`, email: `anonymisable.${STAMP}@example.org`, company: 'Charpente Verte', jobTitle: 'Chef de projet' },
};
type Key = keyof typeof GUESTS;
const name = (key: Key) => `${GUESTS[key].firstName} ${GUESTS[key].lastName}`;
const MESSAGE_FROM_A = `Bonjour Brigitte, MESSAGE-A-${STAMP}`;
const MESSAGE_FROM_B = `Merci pour votre message, MESSAGE-B-${STAMP}`;
const DELETED = 'Participant supprimé';

test.describe.configure({ mode: 'serial' });

// Les invités de ce fichier (et les fiches anonymisées qu'ils laissent) fausseraient les comptes du seed (inscrits actifs et annulés, intervenants)
// que les fichiers suivants relisent : ils sont supprimés à la fin.
test.afterAll(() => {
  psql(`delete from espace_attendees where email like '%.${STAMP}@example.org' or email like 'erased-%@erased.invalid'`);
});

// La demande de lien est limitée par adresse (NF-03) : chaque personne ouvre sa session une fois, ses cookies sont repris ensuite.
const sessions = new Map<string, Awaited<ReturnType<BrowserContext['cookies']>>>();
const ids = new Map<Key, string>();

async function signIn(page: Page, baseURL: string | undefined, email: string) {
  const known = sessions.get(email);
  if (known) {
    await page.context().addCookies(known);
    return;
  }
  await openSpace(page, email);
  if (page.url().endsWith('/bienvenue')) {
    await hydrated(page);
    if (email !== ORGANIZER) {
      // Un invité n'a rien consenti : annuaire et messages cochés pour qu'il soit visible de ses interlocuteurs.
      await page.getByRole('checkbox', { name: 'Apparaître dans l’annuaire des participants' }).check();
      await page.getByRole('checkbox', { name: 'Recevoir des demandes de rendez-vous et des messages' }).check();
    }
    await page.getByRole('button', { name: 'Continuer', exact: true }).click();
    // L'organisation n'est pas dans l'annuaire par défaut : confirmation avant de continuer.
    const skip = page.getByRole('button', { name: 'Continuer sans apparaître' });
    await Promise.race([skip.waitFor(), page.waitForURL(`${baseURL}${ESPACE}/`)]).catch(() => undefined);
    if (await skip.isVisible()) await skip.click();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/`);
  }
  sessions.set(email, await page.context().cookies());
}

/** Appel de l'API avec la session du contexte de la page, comme le ferait un îlot. */
async function call(page: Page, baseURL: string | undefined, method: 'GET' | 'POST', path: string, data?: unknown) {
  const response = await page.request.fetch(`${STRAPI_URL}/api/espace${path}`, { method, headers: { Origin: baseURL ?? '' }, data });
  return { status: response.status(), json: await response.json().catch(() => undefined) };
}

const openProfile = async (page: Page, baseURL: string | undefined, key: Key) => {
  await signIn(page, baseURL, GUESTS[key].email);
  await page.goto(`${ESPACE}/profil`);
  await hydrated(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Mes données' })).toBeVisible();
};

async function openPilotage(page: Page, baseURL: string | undefined) {
  await signIn(page, baseURL, ORGANIZER);
  await page.goto(`${ESPACE}/organisateur`);
  await hydrated(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pilotage de l’édition');
}

test('préparation : l’organisation ajoute trois invités, A écrit à B', async ({ page, baseURL }) => {
  await openPilotage(page, baseURL);
  for (const key of ['A', 'B', 'C'] as Key[]) {
    const { status, json } = await call(page, baseURL, 'POST', `/admin/${EDITION}/attendees`, { ...GUESTS[key], role: 'participant' });
    expect(status, `ajout de ${name(key)}`).toBe(201);
    ids.set(key, json.id);
  }
  // B ouvre sa session et donne son consentement (annuaire et messages cochés par défaut), puis A, qui écrit à B.
  await page.context().clearCookies();
  await signIn(page, baseURL, GUESTS.B.email);
  await page.context().clearCookies();
  await signIn(page, baseURL, GUESTS.A.email);
  const opened = await call(page, baseURL, 'POST', '/conversations', { with: `p:${ids.get('B')}` });
  expect([200, 201]).toContain(opened.status);
  expect((await call(page, baseURL, 'POST', `/conversations/${opened.json.id}/messages`, { body: MESSAGE_FROM_A })).status).toBe(201);
  await page.context().clearCookies();
  await signIn(page, baseURL, GUESTS.B.email);
  expect((await call(page, baseURL, 'POST', `/conversations/${opened.json.id}/messages`, { body: MESSAGE_FROM_B })).status).toBe(201);
});

test.describe('depuis le profil (F-33, NF-12)', () => {
  test('« Mes données » propose de télécharger et de supprimer', async ({ page, baseURL }) => {
    await openProfile(page, baseURL, 'A');
    await expect(page.getByRole('button', { name: 'Télécharger mes données' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Supprimer mes données' })).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('« Télécharger mes données » donne un fichier JSON nommé d’après l’édition, avec les données de la personne et rien d’un tiers', async ({ page, baseURL }) => {
    await openProfile(page, baseURL, 'A');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Télécharger mes données' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`mes-donnees-${EDITION}.json`);
    const text = readFileSync((await file.path()) as string, 'utf8');
    const data = JSON.parse(text);
    expect(Object.keys(data)).toEqual(['exportedAt', 'edition', 'profile', 'preferences', 'meetings', 'messages']);
    expect(data.profile.email).toBe(GUESTS.A.email);
    expect(data.profile.company).toBe(GUESTS.A.company);
    expect(data.messages.map((message: { body: string }) => message.body)).toEqual([MESSAGE_FROM_A]);
    expect(data.messages[0].counterpart).toEqual({ firstName: GUESTS.B.firstName, lastName: GUESTS.B.lastName, company: GUESTS.B.company });
    expect(text, 'rien de l’autre personne hors prénom, nom, entreprise').not.toContain(GUESTS.B.email);
    expect(text).not.toContain(MESSAGE_FROM_B);
    await expect(page.getByRole('status').filter({ hasText: 'Vos données sont téléchargées.' })).toBeVisible();
  });

  test('« Supprimer mes données » nomme les effets ; « Annuler » ne change rien', async ({ page, baseURL }) => {
    await openProfile(page, baseURL, 'A');
    await page.getByRole('button', { name: 'Supprimer mes données' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('rendez-vous à venir sont annulés');
    await expect(dialog).toContainText('interlocuteurs sont prévenus');
    await expect(dialog).toContainText(`« ${DELETED} »`);
    await expect(dialog).toContainText('ne pourrez plus vous reconnecter');
    await expect(dialog).toContainText('définitive');
    await expect(page.getByRole('button', { name: 'Supprimer définitivement mes données' })).toBeFocused();

    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect((await call(page, baseURL, 'GET', '/me')).status, 'la session reste ouverte').toBe(200);
  });

  test('un échec du serveur le dit et ne déconnecte pas', async ({ page, baseURL }) => {
    await openProfile(page, baseURL, 'A');
    await page.route('**/me/erase', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL","message":""}}' }));
    await page.getByRole('button', { name: 'Supprimer mes données' }).click();
    await page.getByRole('button', { name: 'Supprimer définitivement mes données' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'La suppression a échoué. Réessayez.' })).toBeVisible();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/profil`);
    await page.unroute('**/me/erase');
    expect((await call(page, baseURL, 'GET', '/me')).status).toBe(200);
  });

  test('confirmer supprime : retour à la connexion, plus de session, plus de lien pour cette adresse', async ({ page, baseURL }) => {
    await openProfile(page, baseURL, 'A');
    await page.getByRole('button', { name: 'Supprimer mes données' }).click();
    await page.getByRole('button', { name: 'Supprimer définitivement mes données' }).click();
    await expect(page).toHaveURL(new RegExp(`${ESPACE}/connexion\\?deconnecte=1$`));

    expect((await call(page, baseURL, 'GET', '/me')).status, 'session close').toBe(401);
    await page.goto(`${ESPACE}/profil`);
    await expect(page).toHaveURL(new RegExp(`${ESPACE}/connexion`));

    const before = mailsTo(GUESTS.A.email, ACCESS_LINK_SUBJECT).length;
    await page.goto(`${ESPACE}/connexion`);
    await page.getByLabel('Adresse e-mail utilisée pour l’inscription').fill(GUESTS.A.email);
    await page.getByRole('button', { name: 'Recevoir mon lien' }).click();
    await expect(page).toHaveURL(/\?envoye=1$/);
    await page.waitForTimeout(1500);
    expect(mailsTo(GUESTS.A.email, ACCESS_LINK_SUBJECT).length, 'aucun lien n’est envoyé').toBe(before);
    // L'ancien cookie de session, repris tel quel, ne rouvre rien.
    await page.context().addCookies(sessions.get(GUESTS.A.email) ?? []);
    expect((await call(page, baseURL, 'GET', '/me')).status).toBe(401);
  });
});

test.describe('chez l’interlocuteur', () => {
  test('la liste des messages et le fil montrent « Participant supprimé », les deux messages restent, rien de la personne', async ({ page, baseURL }) => {
    await signIn(page, baseURL, GUESTS.B.email);
    await page.goto(`${ESPACE}/messages`);
    await hydrated(page);
    const row = page.getByRole('link', { name: new RegExp(DELETED) }).first();
    await expect(row).toBeVisible();
    await row.click();
    await hydrated(page);
    const log = page.getByRole('log', { name: 'Messages' });
    await expect(log).toContainText(MESSAGE_FROM_A);
    await expect(log).toContainText(MESSAGE_FROM_B);
    const body = await page.locator('body').innerText();
    for (const secret of [GUESTS.A.firstName, GUESTS.A.lastName, GUESTS.A.company, GUESTS.A.email]) expect(body, secret).not.toContain(secret);
    expect(body).toContain(DELETED);
  });

  test('l’annuaire ne trouve plus la personne', async ({ page, baseURL }) => {
    await signIn(page, baseURL, GUESTS.B.email);
    const found = await call(page, baseURL, 'GET', `/directory?q=${encodeURIComponent(GUESTS.A.lastName)}`);
    expect(found.status).toBe(200);
    expect(JSON.stringify(found.json)).not.toContain(GUESTS.A.lastName);
    const control = await call(page, baseURL, 'GET', `/directory?q=${encodeURIComponent('Ducasse')}`);
    expect(JSON.stringify(control.json), 'témoin : un participant non effacé se trouve').toContain('Ducasse');
  });
});

test.describe('depuis le pilotage (« Anonymiser »)', () => {
  const search = (page: Page, text: string) => page.getByLabel('Rechercher un inscrit').fill(text);

  test('la confirmation nomme les effets, « Annuler » ne change rien, « Confirmer l’anonymisation » anonymise la fiche', async ({ page, baseURL }) => {
    await openPilotage(page, baseURL);
    await search(page, GUESTS.C.lastName);
    await page.getByRole('button', { name: `Ouvrir la fiche de ${name('C')}` }).click();
    await expect(page.getByRole('heading', { level: 3, name: name('C') })).toBeVisible();

    await page.getByRole('button', { name: 'Anonymiser' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText(`Anonymiser ${name('C')} ?`);
    await expect(dialog).toContainText('rendez-vous à venir sont annulés');
    await expect(dialog).toContainText(`« ${DELETED} »`);
    await expect(dialog).toContainText('ne sera plus réimportée');

    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 3, name: name('C') })).toBeVisible();

    await page.getByRole('button', { name: 'Anonymiser' }).click();
    await page.getByRole('button', { name: 'Confirmer l’anonymisation' }).click();
    await expect(page.getByText('Données anonymisées.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: DELETED })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Anonymiser' })).toBeDisabled();
    const body = await page.locator('body').innerText();
    for (const secret of [GUESTS.C.firstName, GUESTS.C.lastName, GUESTS.C.company, GUESTS.C.email]) expect(body, secret).not.toContain(secret);
  });

  test('l’inscrit anonymisé n’est plus trouvé par son nom dans la liste', async ({ page, baseURL }) => {
    await openPilotage(page, baseURL);
    await search(page, GUESTS.C.lastName);
    await expect(page.getByRole('button', { name: /^Ouvrir la fiche de / })).toHaveCount(0);
    const list = await call(page, baseURL, 'GET', `/admin/${EDITION}/attendees?q=${encodeURIComponent(GUESTS.C.firstName)}`);
    expect(list.status).toBe(200);
    expect(list.json.items).toEqual([]);
  });

  test('l’organisation ne peut pas anonymiser son propre compte depuis le pilotage (409 SELF_FORBIDDEN)', async ({ page, baseURL }) => {
    await openPilotage(page, baseURL);
    const list = await call(page, baseURL, 'GET', `/admin/${EDITION}/attendees?q=${encodeURIComponent(ORGANIZER)}`);
    const row = list.json.items.find((item: { email: string }) => item.email === ORGANIZER);
    expect(row, 'l’organisation a une ligne d’inscrit après sa connexion').toBeTruthy();
    const refused = await call(page, baseURL, 'POST', `/admin/${EDITION}/attendees/${row.id}/erase`, {});
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe('SELF_FORBIDDEN');
    expect((await call(page, baseURL, 'GET', '/me')).status, 'rien n’a changé').toBe(200);
  });
});
