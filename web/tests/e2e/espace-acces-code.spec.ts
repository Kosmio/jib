import { randomInt } from 'node:crypto';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { ACCESS_LINK_SUBJECT, ESPACE, expect, linkOf, mailsTo, nextMail, requestLink, test } from './espace';

/**
 * Connexion par code à six chiffres dans le navigateur (lot V3-G) : I-44, F-142.
 *
 * Critère 1 : un second contexte de navigateur, sans aucun cookie du premier, saisit le code de l'e-mail et obtient la session.
 * Autres : champ et libellés, erreur, sixième essai refusé, lien et code qui s'invalident, parcours sans JavaScript, code absent de l'URL.
 *
 * Données : des inscrits activés du seed de recette (consentement donné), chacun pris par un seul test pour que les limites par adresse
 * (5 demandes, 10 essais de code par 15 minutes) ne lient pas les tests entre eux. Tom (non activé) sert au parcours vers /bienvenue.
 */

const HELENE = 'helene.marques@example.org';
const BENOIT = 'benoit.tastet@example.org';
const MARION = 'marion.lacoste@example.org';
const PIERRE = 'pierre.haurie@example.org';
const ANTOINE = 'antoine.vergnes@example.org';
const TOM = 'tom.laffitte@example.org';

const CODE_LABEL = 'Code reçu par e-mail';
const SUBMIT = 'Valider le code';
const CODE_ERROR = 'Ce code n’est pas valable. Vérifiez-le ou demandez un nouveau lien.';
const SENT_URL = /\?envoye=1(&|$)/;

const randomIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

/** Un contexte de navigateur neuf : aucun cookie de la page du test, sa propre adresse IP. */
async function freshContext(browser: Browser, baseURL: string | undefined, options: { javaScriptEnabled?: boolean } = {}): Promise<BrowserContext> {
  return browser.newContext({ baseURL, extraHTTPHeaders: { 'X-Forwarded-For': randomIp() }, ...options });
}

/** Demande un lien depuis E0 : l'e-mail est lu dans la boîte de sortie, qui rend le code et le lien. */
async function receive(page: Page, email: string): Promise<{ code: string; link: string }> {
  const already = mailsTo(email, ACCESS_LINK_SUBJECT).length;
  await requestLink(page, email);
  await expect(page).toHaveURL(SENT_URL);
  const mail = await nextMail(email, already);
  const match = mail.text.match(/(?<!\d)(\d) (\d) (\d) (\d) (\d) (\d)(?!\d)/);
  if (!match) throw new Error(`Aucun code à six chiffres dans l’e-mail :\n${mail.text}`);
  return { code: match.slice(1, 7).join(''), link: linkOf(mail) };
}

const wrongOf = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

/** Saisit un code dans la page « Lien envoyé » et valide. */
async function submitCode(page: Page, code: string) {
  await page.getByLabel(CODE_LABEL).fill(code);
  await page.getByRole('button', { name: SUBMIT }).click();
}

/** Toutes les adresses visitées par la page (navigations et redirections), pour vérifier que ni le code ni l'adresse e-mail n'y figurent. */
function watchUrls(page: Page, secrets: string[]) {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  return {
    expectClean: () => {
      for (const url of urls) for (const secret of secrets) expect(decodeURIComponent(url), `« ${secret} » dans ${url}`).not.toContain(secret);
    },
  };
}

test.describe('F-142 : le champ « Code reçu par e-mail » de l’état « Lien envoyé » (V3-G)', () => {
  test('avec le cookie d’adresse : champ numérique à un code, bouton « Valider le code », pas de champ d’adresse', async ({ page }) => {
    await receive(page, HELENE);
    const code = page.getByLabel(CODE_LABEL);
    await expect(code).toBeVisible();
    await expect(code).toHaveAttribute('inputmode', 'numeric');
    await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(code).toHaveAttribute('pattern', '[0-9 -]{6,11}');
    await expect(code).toHaveAttribute('required', '');
    await expect(page.locator('#code-form')).toBeVisible();
    await expect(page.locator('#code')).toHaveCount(1);
    await expect(page.locator('#code-email')).toHaveCount(0);
    await expect(page.getByRole('button', { name: SUBMIT })).toBeVisible();
  });

  test('sans le cookie d’adresse : un champ d’adresse #code-email apparaît dans le formulaire du code', async ({ browser, baseURL }) => {
    const context = await freshContext(browser, baseURL);
    try {
      const page = await context.newPage();
      await page.goto(`${ESPACE}/connexion?envoye=1`);
      await expect(page.locator('#code-email')).toBeVisible();
      await expect(page.locator('#code-email')).toHaveAttribute('type', 'email');
      await expect(page.locator('#code-email')).toHaveAttribute('required', '');
      await expect(page.locator('#code-form').getByLabel(CODE_LABEL)).toBeVisible();
    } finally {
      await context.close();
    }
  });
});

test.describe('critère 1 : le code ouvre la session dans un autre navigateur (V3-G)', () => {
  test('deux contextes : le premier demande le lien, le second, sans aucun cookie du premier, saisit adresse et code et entre', async ({ page, browser, baseURL }) => {
    const { code } = await receive(page, BENOIT);

    const other = await freshContext(browser, baseURL);
    try {
      expect(await other.cookies(), 'le second contexte part sans cookie').toEqual([]);
      const second = await other.newPage();
      const urls = watchUrls(second, [code, BENOIT]);
      await second.goto(`${ESPACE}/connexion?envoye=1`);
      await second.locator('#code-email').fill(BENOIT);
      await submitCode(second, code);
      await expect(second).toHaveURL(`${baseURL}${ESPACE}/`);
      await expect(second.getByRole('navigation', { name: 'Espace participant' })).toBeVisible();
      expect((await other.cookies()).some((cookie) => cookie.name === 'jib_espace' && cookie.value)).toBe(true);
      urls.expectClean();
    } finally {
      await other.close();
    }
    // Le premier contexte n'a pas de session : il n'a fait que demander le lien.
    expect((await page.context().cookies()).some((cookie) => cookie.name === 'jib_espace' && cookie.value)).toBe(false);
  });

  test('même navigateur : le code saisi dans la page « Lien envoyé » ouvre l’espace, l’URL n’a jamais porté le code ni l’adresse', async ({ page, baseURL }) => {
    const addressUrls = watchUrls(page, [MARION]);
    const { code } = await receive(page, MARION);
    const codeUrls = watchUrls(page, [code]);
    await submitCode(page, code);
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/`);
    codeUrls.expectClean();
    addressUrls.expectClean();
  });

  test('un inscrit qui n’a pas encore donné son consentement arrive sur /bienvenue', async ({ page }) => {
    const { code } = await receive(page, TOM);
    await submitCode(page, code);
    await expect(page).toHaveURL(new RegExp(`${ESPACE}/bienvenue$`));
  });

  test('un code saisi avec un espace au milieu est accepté (copié depuis l’e-mail « 1 2 3 4 5 6 »)', async ({ page, baseURL }) => {
    const { code } = await receive(page, PIERRE);
    await submitCode(page, `${code.slice(0, 3)} ${code.slice(3)}`);
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/`, { timeout: 3000 });
  });
});

test.describe('erreurs et limite de cinq essais (V3-G)', () => {
  test('un code faux : retour sur l’état « Lien envoyé » avec l’erreur, champ marqué invalide, adresse et code absents de l’URL, le bon code passe ensuite', async ({ page, baseURL }) => {
    const { code } = await receive(page, ANTOINE);
    const urls = watchUrls(page, [wrongOf(code), code, ANTOINE]);
    await submitCode(page, wrongOf(code));
    await expect(page).toHaveURL(new RegExp(`${ESPACE}/connexion\\?envoye=1&erreur=code$`));
    await expect(page.getByRole('alert')).toHaveText(CODE_ERROR);
    await expect(page.getByLabel(CODE_LABEL)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#code-email')).toHaveCount(0);
    await submitCode(page, code);
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/`);
    urls.expectClean();
  });

  test('cinq codes faux, puis le bon : refusé ; le lien de l’e-mail ouvre toujours l’espace', async ({ page, baseURL }) => {
    const { code, link } = await receive(page, 'ines.castaing@example.org');
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await submitCode(page, wrongOf(code));
      await expect(page.getByRole('alert'), `essai ${attempt}`).toHaveText(CODE_ERROR);
    }
    await submitCode(page, code);
    await expect(page).toHaveURL(new RegExp(`${ESPACE}/connexion\\?envoye=1&erreur=code$`));
    await expect(page.getByRole('alert')).toHaveText(CODE_ERROR);
    await page.goto(link);
    await page.getByRole('button', { name: 'Ouvrir mon espace' }).click();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/`);
  });
});

test.describe('lien et code s’invalident l’un l’autre (V3-G)', () => {
  test('le lien ouvert dans un autre contexte invalide le code : saisi ensuite, il est refusé', async ({ page, browser, baseURL }) => {
    const { code, link } = await receive(page, 'hugo.peyrat@example.org');
    const other = await freshContext(browser, baseURL);
    try {
      const second = await other.newPage();
      await second.goto(link);
      await second.getByRole('button', { name: 'Ouvrir mon espace' }).click();
      await expect(second).toHaveURL(`${baseURL}${ESPACE}/`);
    } finally {
      await other.close();
    }
    await submitCode(page, code);
    await expect(page.getByRole('alert')).toHaveText(CODE_ERROR);
  });

  test('le code saisi invalide le lien : ouvert ensuite, il affiche « Ce lien n’est plus valable »', async ({ page, browser, baseURL }) => {
    const { code, link } = await receive(page, 'nathan.lasserre@example.org');
    await submitCode(page, code);
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/`);
    const other = await freshContext(browser, baseURL);
    try {
      const second = await other.newPage();
      await second.goto(link);
      await expect(second.getByRole('heading', { level: 2 })).toHaveText('Ce lien n’est plus valable');
    } finally {
      await other.close();
    }
  });

  test('usage unique : le même code, rejoué depuis un autre contexte, est refusé', async ({ page, browser, baseURL }) => {
    const { code } = await receive(page, 'eva.cazaux@example.org');
    await submitCode(page, code);
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/`);
    const other = await freshContext(browser, baseURL);
    try {
      const second = await other.newPage();
      await second.goto(`${ESPACE}/connexion?envoye=1`);
      await second.locator('#code-email').fill('eva.cazaux@example.org');
      await submitCode(second, code);
      await expect(second.getByRole('alert')).toHaveText(CODE_ERROR);
    } finally {
      await other.close();
    }
  });
});

test.describe('parcours sans JavaScript (NF-31, V3-G)', () => {
  test('demande du lien, saisie du code et entrée dans l’espace sans exécuter de script', async ({ browser, baseURL }) => {
    const context = await freshContext(browser, baseURL, { javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      const { code } = await receive(page, 'alice.fourcade@example.org');
      const urls = watchUrls(page, [code]);
      await submitCode(page, wrongOf(code));
      await expect(page.getByRole('alert')).toHaveText(CODE_ERROR);
      await submitCode(page, code);
      await expect(page).toHaveURL(`${baseURL}${ESPACE}/`);
      urls.expectClean();
    } finally {
      await context.close();
    }
  });
});

test.describe('critère 3 dans le navigateur : même écran pour une adresse inconnue (V3-G)', () => {
  test('adresse inconnue et code quelconque : la même erreur et la même adresse de page qu’avec un inscrit', async ({ browser, baseURL }) => {
    const context = await freshContext(browser, baseURL);
    try {
      const page = await context.newPage();
      await page.goto(`${ESPACE}/connexion?envoye=1`);
      await page.locator('#code-email').fill('inconnu.code@example.org');
      await submitCode(page, '123456');
      await expect(page).toHaveURL(new RegExp(`${ESPACE}/connexion\\?envoye=1&erreur=code$`));
      await expect(page.getByRole('alert')).toHaveText(CODE_ERROR);
    } finally {
      await context.close();
    }
  });
});
