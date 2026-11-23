import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { ESPACE, EDITION, expect, hydrated, openSpace, test } from './espace';

/**
 * Plusieurs éditions dans le pilotage, lot V5-C (E9) :
 *   - sans seconde édition publiée, aucun sélecteur ; la carte « Dupliquer cette édition » est là ;
 *   - la duplication refuse les champs invalides et un identifiant déjà pris, puis crée une édition en brouillon (texte de succès) ;
 *   - une fois la copie publiée, le sélecteur apparaît et la bascule marche SANS JavaScript (formulaire POST, 303) ;
 *   - typographie : l'apostrophe typographique (’) dans les textes de l'interface.
 *
 * Le navigateur n'a aucune route pour publier une édition (l'admin de Strapi n'est pas construit en e2e) : l'aide `publishEdition` charge
 * Strapi sans serveur HTTP dans un sous-processus, comme `programme.ts`, et publie (ou supprime) l'édition copiée sur la base e2e.
 * La copie est supprimée à la fin pour ne pas laisser une seconde édition aux autres fichiers du e2e.
 */

const { STRAPI_DIR, buildTestEnv, e2eDatabaseName } = createRequire(import.meta.url)('../../../strapi/tests/helpers/env.js');

const ORGANIZER = 'organisation@example.org';
const COPY_SLUG = 'copie-v5-c';
const COPY_TITLE = 'Copie V5-C';

/** Publie ou supprime (toutes versions, avec l'Attendee organisateur créé par la bascule) l'édition de slug COPY_SLUG sur la base e2e. */
function editCopy(action: 'publish' | 'remove'): void {
  const script = `
    const { compileStrapi, createStrapi } = require('@strapi/strapi');
    (async () => {
      const app = createStrapi(await compileStrapi());
      if (!app.config.get('database.connection.connection.database').endsWith('_e2e')) throw new Error('base e2e seulement');
      app.log.level = 'error';
      await app.load();
      try {
        const [edition] = await app.documents('api::edition.edition').findMany({ filters: { slug: ${JSON.stringify(COPY_SLUG)} }, status: 'draft', limit: 1 });
        if (${JSON.stringify(action)} === 'publish') {
          if (!edition) throw new Error('copie introuvable');
          await app.documents('api::edition.edition').publish({ documentId: edition.documentId });
        } else if (edition) {
          const attendees = await app.documents('api::espace.attendee').findMany({ filters: { edition: { documentId: edition.documentId } }, limit: 100 });
          for (const row of attendees) {
            for (const token of await app.documents('api::espace.magic-token').findMany({ filters: { attendee: { documentId: row.documentId } }, limit: 100 })) {
              await app.documents('api::espace.magic-token').delete({ documentId: token.documentId });
            }
            await app.documents('api::espace.attendee').delete({ documentId: row.documentId });
          }
          for (const uid of ['api::sequence.sequence', 'api::espace.topic']) {
            for (const row of await app.documents(uid).findMany({ filters: { edition: { documentId: edition.documentId } }, limit: 500 })) await app.documents(uid).delete({ documentId: row.documentId });
          }
          await app.documents('api::edition.edition').delete({ documentId: edition.documentId });
        }
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 750));
        await app.destroy();
      }
    })().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
  `;
  const env = buildTestEnv({ database: e2eDatabaseName() });
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: STRAPI_DIR,
    env: { ...env, NODE_OPTIONS: `--require=${path.join(STRAPI_DIR, 'tests/helpers/no-network.js')}` },
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.status !== 0) throw new Error(`Édition « ${COPY_SLUG} » (${action}) : code ${result.status}\n${result.stdout}\n${result.stderr}`);
}

const duplicateCard = (page: Page) => page.locator('section', { has: page.getByRole('heading', { name: 'Dupliquer cette édition' }) });
const switcher = (page: Page) => page.getByRole('navigation', { name: 'Éditions que vous pilotez' });

test.describe('plusieurs éditions dans le pilotage (V5-C)', () => {
  test.describe.configure({ mode: 'serial' });

  let session: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;

  test.afterAll(() => {
    editCopy('remove');
  });

  async function openPilotage(page: Page, slug = EDITION) {
    if (!session) throw new Error('La session est ouverte par le premier test');
    await page.context().addCookies(session);
    await page.goto(`/espace/${slug}/organisateur`);
    await hydrated(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pilotage de l’édition');
  }

  test('une seule édition publiée : pas de sélecteur, la carte de duplication est affichée', async ({ page }) => {
    await openSpace(page, ORGANIZER);
    session = await page.context().cookies();
    await openPilotage(page);
    await expect(switcher(page)).toHaveCount(0);
    const card = duplicateCard(page);
    await expect(card).toBeVisible();
    await expect(card.getByLabel('Titre')).toBeVisible();
    await expect(card.getByLabel('Identifiant URL')).toBeVisible();
    await expect(card.getByLabel('Date de la journée')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Dupliquer l’édition' })).toBeVisible();
  });

  test('champs vides : les trois champs sont signalés et rien n’est créé', async ({ page }) => {
    await openPilotage(page);
    const card = duplicateCard(page);
    await card.getByRole('button', { name: 'Dupliquer l’édition' }).click();
    for (const id of ['duplicate-title', 'duplicate-slug', 'duplicate-date']) {
      await expect(page.locator(`#${id}`)).toHaveAttribute('aria-invalid', 'true');
    }
    await expect(card.getByText(/est créée en brouillon/)).toHaveCount(0);
  });

  test('l’identifiant URL est proposé d’après le titre, sans accents', async ({ page }) => {
    await openPilotage(page);
    await page.locator('#duplicate-title').fill('Édition Été 2027 : Bordeaux');
    await expect(page.locator('#duplicate-slug')).toHaveValue('edition-ete-2027-bordeaux');
  });

  test('un identifiant déjà pris est refusé (409) sur le champ Identifiant URL', async ({ page }) => {
    await openPilotage(page);
    await page.locator('#duplicate-title').fill('Doublon');
    await page.locator('#duplicate-slug').fill(EDITION);
    await page.locator('#duplicate-date').fill('2027-06-15');
    await duplicateCard(page).getByRole('button', { name: 'Dupliquer l’édition' }).click();
    await expect(page.locator('#duplicate-slug')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#duplicate-slug-erreur')).toContainText('déjà pris');
  });

  test('duplication réussie : texte de succès avec l’identifiant, formulaire vidé', async ({ page }) => {
    await openPilotage(page);
    await page.locator('#duplicate-title').fill(COPY_TITLE);
    await page.locator('#duplicate-slug').fill(COPY_SLUG);
    await page.locator('#duplicate-date').fill('2027-06-15');
    await duplicateCard(page).getByRole('button', { name: 'Dupliquer l’édition' }).click();
    const status = duplicateCard(page).getByRole('status');
    await expect(status).toContainText(`L’édition « ${COPY_SLUG} » est créée en brouillon`);
    await expect(page.locator('#duplicate-title')).toHaveValue('');
    // Brouillon : elle n’apparaît pas encore dans le sélecteur après rechargement.
    await openPilotage(page);
    await expect(switcher(page)).toHaveCount(0);
  });

  test('typographie : apostrophe typographique ’ dans les textes de la carte de duplication et du sélecteur', async ({ page }) => {
    await openPilotage(page);
    const text = await duplicateCard(page).innerText();
    expect(text, 'apostrophe droite dans la carte de duplication').not.toContain("'");
    expect(text).toContain('Dupliquer l’édition');
    expect(text).toContain('l’espace participant');
  });

  test('copie publiée : le sélecteur liste les deux éditions, la courante est marquée', async ({ page }) => {
    editCopy('publish');
    await openPilotage(page);
    const nav = switcher(page);
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('listitem')).toHaveCount(2);
    await expect(nav.locator('[aria-current="page"]')).toContainText('Nouvelle-Aquitaine (test)');
    await expect(nav.getByRole('button', { name: new RegExp(COPY_TITLE) })).toBeVisible();
    expect(await nav.innerText(), 'apostrophe droite dans le sélecteur').not.toContain("'");
  });

  test('sans JavaScript : un clic sur l’autre édition ouvre son pilotage, sans e-mail', async ({ browser, baseURL }) => {
    if (!session) throw new Error('session absente');
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false, extraHTTPHeaders: { 'X-Forwarded-For': '10.77.5.9' } });
    await context.addCookies(session);
    const page = await context.newPage();
    await page.goto(`${ESPACE}/organisateur`);
    await expect(switcher(page)).toBeVisible();
    await switcher(page).getByRole('button', { name: new RegExp(COPY_TITLE) }).click();
    await expect(page).toHaveURL(`${baseURL}/espace/${COPY_SLUG}/organisateur`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pilotage de l’édition');
    await expect(switcher(page).locator('[aria-current="page"]')).toContainText(COPY_TITLE);
    // Retour à l'édition d'origine par le même formulaire.
    await switcher(page).getByRole('button', { name: /Nouvelle-Aquitaine \(test\)/ }).click();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/organisateur`);
    await context.close();
  });
});
