import { ESPACE, expect, hydrated, openSpace, test } from './espace';

/**
 * Finitions V2-E (F-126, F-129). Les e-mails (F-127) sont couverts par les unitaires des gabarits, le manifeste et theme-color (F-130)
 * par espace-pwa.spec.ts. Non couverts ici : le contraste du bouton d'entrée (F-128, page publique, vu au test visuel) et l'alerte
 * d'indisponibilité du programme, que le navigateur ne peut pas provoquer (le rendu serveur appelle Strapi lui-même).
 */

const CLARA = 'clara.dubourdieu@example.org';

test('F-126 : « Accès réservé » garde ses accents, Azonix ne dessine que les caractères qu’il possède', async ({ page, context }) => {
  await openSpace(page, CLARA);
  await page.goto(`${ESPACE}/organisateur`);
  const title = page.getByRole('heading', { level: 1 });
  await expect(title).toHaveText('Accès réservé');

  // La police déclarée pour l'espace est « Azonix Espace », limitée aux caractères sans accent.
  const families = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].map((face) => face.family.replaceAll('"', ''));
  });
  expect(families).toContain('Azonix Espace');
  expect(await title.evaluate((node) => getComputedStyle(node).fontFamily)).toContain('Azonix Espace');

  // Polices réellement utilisées pour le texte du titre, glyphe par glyphe (protocole DevTools).
  const client = await context.newCDPSession(page);
  await client.send('DOM.enable');
  await client.send('CSS.enable');
  const { root } = await client.send('DOM.getDocument');
  const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'h1' });
  const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
  const glyphs = (name: RegExp) => fonts.filter((font) => name.test(font.familyName)).reduce((sum, font) => sum + font.glyphCount, 0);
  const total = fonts.reduce((sum, font) => sum + font.glyphCount, 0);
  const azonix = glyphs(/azonix/i);
  const ascii = 'Accès réservé'.replace(/[^\x20-\x7e]/g, '').length; // 10 : 9 lettres et l'espace
  expect(total, 'glyphes du titre').toBe('Accès réservé'.length);
  expect(azonix, 'glyphes dessinés par Azonix : l’ASCII seulement').toBe(ascii);
  expect(total - azonix, 'les trois accentuées retombent sur une autre police').toBe(3);
});

test('F-129 : onglet actif exposé par aria-current, liens d’intervenants de 44 px, alerte et état vide absents du programme publié', async ({ page }) => {
  await openSpace(page, CLARA);
  await page.goto(`${ESPACE}/programme`);
  await hydrated(page);
  const sections = page.getByRole('navigation', { name: 'Sections du programme' });
  const current = sections.locator('[aria-current]');
  const lengthBefore = await page.evaluate(() => history.length);

  await test.step('aria-current suit l’ancre, un seul onglet à la fois', async () => {
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText('Journée');
    await sections.getByRole('link', { name: 'Intervenants' }).click();
    await expect(page).toHaveURL(/#intervenants$/);
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText('Intervenants');
    await sections.getByRole('link', { name: 'Infos pratiques' }).click();
    await expect(current).toHaveText('Infos pratiques');
    await sections.getByRole('link', { name: 'Journée' }).click();
    await expect(current).toHaveText('Journée');
    // F-152 : les onglets remplacent l'entrée d'historique, ils n'en ajoutent pas.
    expect(await page.evaluate(() => history.length)).toBe(lengthBefore);
  });

  await test.step('ouverture directe sur une ancre : l’onglet de l’ancre est l’onglet actif', async () => {
    await page.goto(`${ESPACE}/programme#infos`);
    await expect(sections.locator('[aria-current]')).toHaveText('Infos pratiques');
  });

  await test.step('liens d’intervenants d’au moins 44 px de haut', async () => {
    await page.goto(`${ESPACE}/programme`);
    const links = page.getByRole('link', { name: /Hélène Marquès/ });
    expect(await links.count()).toBeGreaterThan(0);
    for (const link of await links.all()) {
      const box = await link.boundingBox();
      if (box) expect(box.height, 'hauteur du lien (px)').toBeGreaterThanOrEqual(44);
    }
    const sessionLink = page.locator('#journee').getByRole('link', { name: /Hélène Marquès/ }).first();
    await expect(sessionLink).toBeVisible();
    expect((await sessionLink.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  await test.step('programme publié : ni alerte d’indisponibilité ni état vide', async () => {
    await expect(page.getByText('Le programme n’est pas disponible pour le moment')).toHaveCount(0);
    await expect(page.getByText('Le programme sera publié bientôt')).toHaveCount(0);
    await expect(page.getByText('Les intervenants seront annoncés bientôt')).toHaveCount(0);
    await expect(page.getByText('Les informations pratiques seront publiées bientôt')).toHaveCount(0);
  });
});
