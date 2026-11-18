import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { STRAPI_URL } from './fixtures';
import { ACCESS_LINK_SUBJECT, EDITION, ESPACE, expect, hydrated, linkOf, mailsTo, nextMail, tab, test } from './espace';

/**
 * Audits d'accessibilité de l'espace participant (V2-Q, T-70, NF-30, T-43).
 *
 *   - axe-core (règles WCAG 2.0 et 2.1, niveaux A et AA) en 390 px et en 1280 px, avec trois sessions des personas du seed : Léa
 *     (participant, E0 à E8 et « Mes données »), l'organisateur (E9 : pilotage et cartes, relances, fiche d'un participant). Écrans publics :
 *     E0 et ses états, carte publique de badge (jeton réel, jeton périmé), page d'erreur, page introuvable. E10 (e-mails) : le HTML du
 *     message de connexion reçu dans la boîte de sortie. Toute violation `critical` ou `serious` fait échouer le test, sauf si elle figure
 *     dans KNOWN_VIOLATIONS (règle + écran) : le défaut est alors tracé, la suite reste verte, et la ligne se retire quand le lot
 *     propriétaire corrige.
 *   - Parcours clavier seul : connexion par code à six chiffres, demande de rendez-vous, acceptation, envoi d'un message. Chaque cible est
 *     atteinte à la touche Tab (échec sur un piège clavier ou un élément hors de l'ordre de tabulation) et activée par Entrée ou Espace.
 *
 * Chaque session est ouverte une seule fois pour le fichier (limites de demande de lien en mémoire : 5 par adresse et par 15 minutes) :
 * les cookies sont gardés dans un fichier temporaire, validés à chaque réutilisation, et la session est rouverte si elle ne vaut plus.
 *
 * `AXE_DUMP=<fichier>` ajoute au fichier une ligne JSON par violation (toutes gravités), pour le rapport daté de reports/quality/.
 */

const LEA = 'lea.ducasse@example.org';
const MANON = 'manon.bordenave@example.org';
const ORGANIZER = 'organisation@example.org';
const INES_REQUEST = 'Inès Castaing';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['critical', 'serious']);

/** Défauts constatés et non corrigés : `<règle> | <écran>`. Retirer la ligne quand le défaut est corrigé. */
const KNOWN_VIOLATIONS: Record<string, string> = {};

type Finding = { screen: string; width: number; rule: string; impact: string; nodes: string[]; help: string };
type Cookies = Awaited<ReturnType<BrowserContext['cookies']>>;

const SESSIONS_FILE = join(tmpdir(), `jib-a11y-sessions-${process.env.E2E_WEB_PORT ?? '4332'}.json`);
const readSessions = (): Record<string, Cookies> => (existsSync(SESSIONS_FILE) ? JSON.parse(readFileSync(SESSIONS_FILE, 'utf8')) : {});

/** Passe l'écran de consentement d'un compte qui arrive sur E2. */
async function passWelcome(page: Page) {
  if (!page.url().endsWith('/bienvenue')) return;
  await hydrated(page);
  await page.getByRole('button', { name: 'Continuer' }).click();
  const decline = page.getByRole('button', { name: 'Continuer sans apparaître' });
  await expect(decline.or(page.getByRole('navigation', { name: 'Espace participant' }))).toBeVisible();
  if (await decline.isVisible()) await decline.click();
  await expect(page).toHaveURL(`${new URL(page.url()).origin}${ESPACE}/`);
}

/** Ouvre une session par le parcours réel (E0, e-mail, lien, bouton), une seule fois par adresse pour tout le fichier. */
async function openSession(page: Page, email: string) {
  const known = readSessions()[email];
  if (known) {
    await page.context().clearCookies();
    await page.context().addCookies(known);
    await page.goto(`${ESPACE}/`);
    if (!page.url().includes('/connexion')) return;
  }
  await page.context().clearCookies();
  const already = mailsTo(email, ACCESS_LINK_SUBJECT).length;
  await page.goto(`${ESPACE}/connexion`);
  await page.getByLabel('Adresse e-mail utilisée pour l’inscription').fill(email);
  await page.getByRole('button', { name: 'Recevoir mon lien' }).click();
  await expect(page).toHaveURL(/\?envoye=1$/);
  await page.goto(linkOf(await nextMail(email, already)));
  await page.getByRole('button', { name: 'Ouvrir mon espace' }).click();
  await expect(page).toHaveURL(new RegExp(`${ESPACE}/(bienvenue)?$`));
  await passWelcome(page);
  writeFileSync(SESSIONS_FILE, JSON.stringify({ ...readSessions(), [email]: await page.context().cookies() }));
}

async function scan(page: Page, screen: string, findings: Finding[]) {
  await hydrated(page);
  await page.evaluate(() => document.fonts.ready);
  const width = page.viewportSize()!.width;
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const violation of violations) {
    const finding: Finding = {
      screen,
      width,
      rule: violation.id,
      impact: violation.impact ?? 'minor',
      help: violation.help,
      nodes: violation.nodes.map((node) => node.target.join(' ')),
    };
    findings.push(finding);
    if (process.env.AXE_DUMP) appendFileSync(process.env.AXE_DUMP, `${JSON.stringify(finding)}\n`);
  }
}

function judge(findings: Finding[]) {
  const blocking = findings.filter((finding) => BLOCKING.has(finding.impact));
  const unexpected = blocking.filter((finding) => !(`${finding.rule} | ${finding.screen}` in KNOWN_VIOLATIONS));
  test.info().annotations.push(...blocking.map((finding) => ({ type: `axe ${finding.impact}`, description: `${finding.screen} ${finding.rule}` })));
  expect(
    unexpected.map((finding) => `${finding.screen} (${finding.width}px) ${finding.impact} ${finding.rule} : ${finding.nodes.slice(0, 3).join(' ; ')}`),
    'violations axe critical ou serious non répertoriées',
  ).toEqual([]);
}

async function visit(page: Page, findings: Finding[], screen: string, path: string) {
  await test.step(screen, async () => {
    await page.goto(`${ESPACE}${path}`);
    await scan(page, screen, findings);
  });
}

/** Jeton réel de la carte de Léa : le badge à l'unité demandé par l'organisateur, adresse lue dans l'annotation /URI du PDF. */
async function leaCardToken(page: Page): Promise<string> {
  const api = page.context().request;
  const list = await api.get(`${STRAPI_URL}/api/espace/admin/${EDITION}/attendees?q=${encodeURIComponent('ducasse')}`);
  expect(list.status()).toBe(200);
  const { items } = (await list.json()) as { items: { id: string }[] };
  const badge = await api.get(`${STRAPI_URL}/api/espace/admin/${EDITION}/attendees/${items[0].id}/badge`);
  expect(badge.status(), 'badge à l’unité').toBe(200);
  const uri = /\/URI \((https?:[^)]+)\)/.exec((await badge.body()).toString('latin1'))?.[1];
  expect(uri, 'annotation /URI du QR').toBeTruthy();
  return uri!.split('/').pop()!;
}

for (const width of [390, 1280]) {
  test.describe(`axe, ${width} px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 800 } });

    test(`écrans publics : E0 et ses états, page d’erreur, introuvable (${width} px)`, async ({ page }) => {
      test.setTimeout(120_000);
      const findings: Finding[] = [];
      await page.context().clearCookies();
      await visit(page, findings, 'E0', '/connexion');
      await visit(page, findings, 'E0 envoyé', '/connexion?envoye=1');
      await test.step('E0 lien invalide', async () => {
        await page.goto('/espace/verifier?token=jeton-inconnu');
        await scan(page, 'E0 lien invalide', findings);
      });
      await test.step('Erreur', async () => {
        await page.goto('/espace/erreur');
        await scan(page, 'Erreur', findings);
      });
      await test.step('Introuvable', async () => {
        await page.goto('/espace/introuvable');
        await scan(page, 'Introuvable', findings);
      });
      await visit(page, findings, 'Carte invalide', '/carte/jeton-inconnu');
      judge(findings);
    });

    test(`E1 à E8 et « Mes données » avec Léa, e-mail de connexion (E10) (${width} px)`, async ({ page }) => {
      test.setTimeout(180_000);
      const findings: Finding[] = [];
      await openSession(page, LEA);
      await test.step('E1', async () => {
        await page.goto(`${ESPACE}/`);
        await scan(page, 'E1', findings);
      });
      await visit(page, findings, 'E2', '/bienvenue');
      await visit(page, findings, 'E3', '/profil');
      await test.step('E3 Mes données', async () => {
        await expect(page.getByRole('heading', { name: 'Mes données' })).toBeVisible();
        await page.getByRole('button', { name: 'Supprimer mes données' }).click();
        await expect(page.getByRole('alertdialog')).toBeVisible();
        await scan(page, 'E3 Mes données', findings);
      });
      await visit(page, findings, 'E4', '/annuaire');
      await test.step('E5', async () => {
        await page.getByRole('link', { name: /Mathis Lagrange/ }).click();
        await expect(page).toHaveURL(new RegExp(`${ESPACE}/annuaire/p/`));
        await scan(page, 'E5', findings);
      });
      await visit(page, findings, 'E6', '/agenda');
      await visit(page, findings, 'E7', '/messages');
      await test.step('E7 fil', async () => {
        await page.getByRole('main').getByRole('listitem').first().getByRole('link').click();
        await expect(page).toHaveURL(new RegExp(`${ESPACE}/messages/.+`));
        await scan(page, 'E7 fil', findings);
      });
      await visit(page, findings, 'E8', '/programme');
      await test.step('E10 e-mail de connexion', async () => {
        const mail = mailsTo(LEA, ACCESS_LINK_SUBJECT).at(-1);
        expect(mail, 'e-mail de connexion de Léa').toBeTruthy();
        await page.setContent(mail!.html);
        const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        for (const violation of violations) {
          findings.push({ screen: 'E10 e-mail', width, rule: violation.id, impact: violation.impact ?? 'minor', help: violation.help, nodes: violation.nodes.map((node) => node.target.join(' ')) });
          if (process.env.AXE_DUMP) appendFileSync(process.env.AXE_DUMP, `${JSON.stringify(findings.at(-1))}\n`);
        }
      });
      judge(findings);
    });

    test(`E9 avec l’organisateur : pilotage, relances, fiche d’un participant, carte publique de badge (${width} px)`, async ({ page }) => {
      test.setTimeout(180_000);
      const findings: Finding[] = [];
      await openSession(page, ORGANIZER);
      await test.step('E9', async () => {
        await page.goto(`${ESPACE}/organisateur`);
        await expect(page.getByRole('heading', { level: 1, name: 'Pilotage de l’édition' })).toBeVisible();
        await expect(page.getByRole('heading', { level: 2, name: 'Relances' })).toBeVisible();
        await expect(page.getByRole('heading', { level: 2, name: 'Participants' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Ouvrir la fiche de Léa Ducasse' })).toBeVisible();
        await scan(page, 'E9', findings);
      });
      await test.step('E9 relances', async () => {
        const reminders = page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name: 'Relances' }) });
        await reminders.getByText('Voir l’aperçu de l’e-mail').click();
        const send = reminders.getByRole('button', { name: /^Envoyer à / });
        await expect(send).toBeVisible();
        if (await send.isEnabled()) await send.click();
        await scan(page, 'E9 relances', findings);
        const cancel = reminders.getByRole('button', { name: 'Annuler' });
        if (await cancel.isVisible()) await cancel.click();
      });
      await test.step('E9 fiche participant', async () => {
        await page.getByRole('button', { name: 'Ouvrir la fiche de Léa Ducasse' }).click();
        await expect(page.getByRole('button', { name: 'Retour à la liste' })).toBeVisible();
        await scan(page, 'E9 fiche participant', findings);
      });
      const token = await leaCardToken(page);
      await context(page).clearCookies();
      await visit(page, findings, 'Carte', `/carte/${token}`);
      judge(findings);
    });
  });
}

const context = (page: Page) => page.context();

/** Tab jusqu'à ce que la cible ait le focus ; échoue sur un piège ou un élément hors de l'ordre de tabulation. */
async function tabTo(page: Page, target: Locator, description: string, max = 90) {
  for (let step = 0; step < max; step++) {
    if (await target.evaluate((node) => node === document.activeElement).catch(() => false)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Cible non atteinte au clavier en ${max} tabulations : ${description}`);
}

/** Connexion au clavier seul par le code à six chiffres : adresse saisie, Entrée, code de l'e-mail saisi, « Valider le code » à Entrée. */
async function keyboardLogin(page: Page, email: string) {
  const already = mailsTo(email, ACCESS_LINK_SUBJECT).length;
  await page.context().clearCookies();
  await page.goto(`${ESPACE}/connexion`);
  await tabTo(page, page.getByLabel('Adresse e-mail utilisée pour l’inscription'), 'champ e-mail d’E0');
  await page.keyboard.type(email);
  await tabTo(page, page.getByRole('button', { name: 'Recevoir mon lien' }), 'bouton « Recevoir mon lien »');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\?envoye=1(&|$)/);
  const mail = await nextMail(email, already);
  const match = mail.text.match(/(?<!\d)(\d) (\d) (\d) (\d) (\d) (\d)(?!\d)/);
  if (!match) throw new Error(`Aucun code à six chiffres dans l’e-mail :\n${mail.text}`);
  await tabTo(page, page.getByLabel('Code reçu par e-mail'), 'champ « Code reçu par e-mail »');
  await page.keyboard.type(match.slice(1, 7).join(''));
  await tabTo(page, page.getByRole('button', { name: 'Valider le code' }), 'bouton « Valider le code »');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`${ESPACE}/(bienvenue)?$`));
  await passWelcome(page);
  writeFileSync(SESSIONS_FILE, JSON.stringify({ ...readSessions(), [email]: await page.context().cookies() }));
}

test.describe('parcours clavier seul (T-43)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Manon : connexion par code à six chiffres, demande de rendez-vous à Mathis', async ({ page }) => {
    test.setTimeout(120_000);
    await keyboardLogin(page, MANON);
    await hydrated(page);

    await page.goto(`${ESPACE}/annuaire`);
    await hydrated(page);
    const profile = page.getByRole('link', { name: /Mathis Lagrange/ });
    await tabTo(page, profile, 'fiche de Mathis dans l’annuaire');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${ESPACE}/annuaire/p/`));
    await hydrated(page);

    await tabTo(page, page.getByRole('button', { name: /^13h30/ }), 'créneau 13h30');
    await page.keyboard.press('Space');
    await tabTo(page, page.getByLabel(/Un mot pour présenter votre demande/), 'champ « Un mot pour présenter votre demande »');
    await page.keyboard.type('Bonjour Mathis, un point au clavier ?');
    await tabTo(page, page.getByRole('button', { name: 'Envoyer la demande pour 13h30' }), 'bouton d’envoi de la demande');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Demande envoyée à Mathis' })).toBeVisible();
  });

  test('Léa : acceptation de la demande d’Inès, message à Mathis', async ({ page }) => {
    test.setTimeout(120_000);
    await openSession(page, LEA);
    await hydrated(page);

    await page.goto(`${ESPACE}/agenda`);
    await hydrated(page);
    const received = page.getByRole('region', { name: 'Demandes reçues' });
    await expect(received).toContainText(INES_REQUEST);
    await tabTo(page, received.getByRole('button', { name: /^Accepter/ }), 'bouton « Accepter »');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Rendez-vous confirmé' })).toContainText(INES_REQUEST);

    await page.goto(`${ESPACE}/messages`);
    await tabTo(page, page.getByRole('main').getByRole('listitem').filter({ hasText: 'Mathis Lagrange' }).getByRole('link'), 'conversation avec Mathis');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${ESPACE}/messages/.+`));
    await hydrated(page);
    await tabTo(page, page.getByRole('textbox', { name: 'Votre message' }), 'champ « Votre message »');
    await page.keyboard.type('Message envoyé au clavier seul.');
    await tabTo(page, page.getByRole('button', { name: 'Envoyer' }), 'bouton « Envoyer »');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('log', { name: 'Messages' }).getByRole('listitem').filter({ hasText: 'Message envoyé au clavier seul.' })).toContainText('Envoyé');
    // Le focus reste dans la page, sur un élément (pas perdu sur <body>) : l'onglet Accueil reste atteignable.
    await tabTo(page, tab(page, 'Accueil'), 'onglet « Accueil »');
  });
});
