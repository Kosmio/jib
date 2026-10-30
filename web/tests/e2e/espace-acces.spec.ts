import {
  ACCESS_LINK_SUBJECT,
  capture,
  ESPACE,
  expect,
  expectOnlyServiceWorkerScript,
  linkOf,
  mailsTo,
  nextMail,
  readOutbox,
  receiveLink,
  requestLink,
  test,
} from './espace';

/**
 * Accès à l'espace participant dans le navigateur (lot 7, phase 1) : T-01 à T-04, états d'E0 et de la vérification,
 * parcours sans JavaScript (NF-31), formulaire de vérification sous `Referrer-Policy: strict-origin` (A-24, Q-13).
 *
 * Données : le seed de recette (strapi/scripts/espace/seed.js), adresses en @example.org. Chaque test a ses personnes, parce que
 * la base n'est pas remise à zéro entre les tests et qu'un lien se consomme : Léa (T-01), Eva (T-03), Hugo (T-04), Mathis (sans JavaScript).
 * Tom Laffitte, seul inscrit sans consentement, est réservé au parcours complet (espace-parcours.spec.ts).
 */

const EDITION_TITLE = 'Nouvelle-Aquitaine (test)';
const SENT = 'Si cette adresse est inscrite, un lien vient de vous être envoyé.';
const TITLE_SUFFIX = 'Espace participant, Journées de l’Innovation Filière Bois';

test.describe('E0 : page de connexion (F-01)', () => {
  test('affiche le bandeau, le formulaire et la mention, sans JavaScript d’îlot (NF-20)', async ({ page }) => {
    const scripts: string[] = [];
    page.on('response', (response) => {
      if (response.request().resourceType() === 'script') scripts.push(response.url());
    });

    const response = await page.goto(`${ESPACE}/connexion`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`Connexion | ${TITLE_SUFFIX}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bienvenue dans votre espace participant');
    await expect(page.getByText('Préparez vos rencontres de la journée du jeudi 3 décembre à Bordeaux.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Recevoir mon lien de connexion');

    const email = page.getByLabel('Adresse e-mail utilisée pour l’inscription');
    await expect(email).toHaveAttribute('type', 'email');
    await expect(email).toHaveAttribute('required', '');
    await expect(email).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Recevoir mon lien' })).toBeVisible();
    await expect(page.getByText(/Pas de mot de passe\s*: un lien valable 30\s+minutes/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Confidentialité' })).toHaveAttribute('href', '/confidentialite');

    // F-05 : la page porte l'enregistrement du service worker (une balise en ligne), et rien d'autre : aucun fichier, aucun îlot.
    await expectOnlyServiceWorkerScript(page);
    expect(await page.locator('astro-island').count(), 'îlots dans E0').toBe(0);
    expect(scripts, 'fichiers JavaScript chargés par E0').toEqual([]);
    await capture(page, 'E0-initial');
  });

  test('?erreur=email : message sous le champ, marqué invalide', async ({ page }) => {
    await page.goto(`${ESPACE}/connexion?erreur=email`);
    await expect(page).toHaveTitle(`Adresse non valide | ${TITLE_SUFFIX}`);
    await expect(page.getByLabel('Adresse e-mail utilisée pour l’inscription')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Saisissez une adresse e-mail valide, par exemple prenom.nom@entreprise.fr.')).toBeVisible();
    await capture(page, 'E0-adresse-invalide');
  });

  test('une édition inconnue répond 404 sur la page introuvable de l’espace', async ({ page }) => {
    const response = await page.goto('/espace/edition-inconnue/connexion');
    expect(response?.status()).toBe(404);
    await expect(page).toHaveTitle(`Page introuvable | ${TITLE_SUFFIX}`);
    await expect(page.getByRole('link', { name: 'Retour au site des Journées' })).toHaveAttribute('href', '/');
  });
});

test.describe('T-01 : demande de lien pour un inscrit (F-01, F-02, I-20)', () => {
  const ADDRESS = 'lea.ducasse@example.org';

  test('la demande affiche l’état « Lien envoyé » et l’e-mail access-link arrive avec un lien valable', async ({ page, baseURL }) => {
    const already = mailsTo(ADDRESS, ACCESS_LINK_SUBJECT).length;
    await requestLink(page, ADDRESS);

    await expect(page).toHaveURL(`${baseURL}${ESPACE}/connexion?envoye=1`);
    await expect(page).toHaveTitle(`Lien envoyé | ${TITLE_SUFFIX}`);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Vérifiez votre messagerie');
    await expect(page.getByRole('status')).toHaveText(SENT);
    await expect(page.getByLabel('Adresse e-mail utilisée pour l’inscription')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Demander un nouveau lien' })).toHaveAttribute('href', `${ESPACE}/connexion`);
    await capture(page, 'E0-envoye');

    const mail = await nextMail(ADDRESS, already);
    expect(mail.text).toMatch(/30\s+minutes/);
    const link = linkOf(mail);
    expect(link).toContain(`${baseURL}/espace/verifier?token=`);

    await page.goto(link);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Votre lien est valable');
    await expect(page.getByRole('button', { name: 'Ouvrir mon espace' })).toBeVisible();
  });
});

test.describe('T-02 : demande de lien sans suite (F-02)', () => {
  test('une adresse inconnue et un inscrit annulé reçoivent le même message, et aucun e-mail ne part', async ({ page }) => {
    const unknown = 'inconnu.t02@example.org';
    const cancelled = 'lucas.darrigade@example.org';
    const known = 'clara.dubourdieu@example.org';
    const already = mailsTo(known, ACCESS_LINK_SUBJECT).length;

    for (const address of [unknown, cancelled]) {
      await requestLink(page, address);
      await expect(page).toHaveURL(/\?envoye=1$/);
      await expect(page.getByRole('status')).toHaveText(SENT);
    }

    // Une adresse connue demandée ensuite sert de témoin : son message est arrivé, pas ceux des deux premières.
    await requestLink(page, known);
    await expect(page.getByRole('status')).toHaveText(SENT);
    await nextMail(known, already);
    await page.waitForTimeout(500);
    expect(readOutbox().filter((mail) => [unknown, cancelled].includes(mail.to.email))).toEqual([]);
  });
});

test.describe('T-03 : lien réutilisé ou invalide (F-03, F-04, A-18)', () => {
  const ADDRESS = 'eva.cazaux@example.org';

  test('le lien se lit sans se consommer, s’utilise une fois, puis affiche « Ce lien n’est plus valable » avec l’adresse préremplie', async ({
    page,
    browser,
    baseURL,
  }) => {
    const link = await receiveLink(page, ADDRESS);

    await page.goto(link);
    await expect(page).toHaveTitle(`Ouvrir mon espace | ${TITLE_SUFFIX}`);
    await expect(page.getByText('Ce lien ne fonctionne qu’une seule fois.')).toBeVisible();
    await capture(page, 'verification-valable');
    await page.reload();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Votre lien est valable');

    // Le navigateur envoie le formulaire à Strapi sous `Referrer-Policy: strict-origin` : l'origine reste admise (pas d'`Origin: null`)
    // et le Referer, qui porte le jeton dans l'URL de la page, se réduit à l'origine (A-24).
    const post = page.waitForRequest((request) => request.method() === 'POST' && request.url().includes('/api/espace/auth/verify'));
    await page.getByRole('button', { name: 'Ouvrir mon espace' }).click();
    const headers = await (await post).allHeaders();
    expect(headers['origin']).toBe(new URL(baseURL!).origin);
    expect(headers['referer']).toBe(`${new URL(baseURL!).origin}/`);
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(EDITION_TITLE);
    await expect(page.getByRole('link', { name: /^Mon profil Eva Cazaux$/ })).toBeVisible();

    // Même lien dans un navigateur sans session : lien utilisé.
    const context = await browser.newContext({ baseURL, extraHTTPHeaders: { 'X-Forwarded-For': '10.200.0.3' } });
    try {
      const other = await context.newPage();
      await other.goto(link);
      await expect(other).toHaveTitle(`Lien non valable | ${TITLE_SUFFIX}`);
      await expect(other.getByRole('heading', { level: 2 })).toHaveText('Ce lien n’est plus valable');
      await expect(other.getByText('Il a expiré ou a déjà été utilisé.')).toBeVisible();
      await expect(other.getByLabel('Adresse e-mail utilisée pour l’inscription')).toHaveValue(ADDRESS);
      await capture(other, 'verification-lien-invalide');

      // Le formulaire prérempli envoie un nouveau lien.
      const already = mailsTo(ADDRESS, ACCESS_LINK_SUBJECT).length;
      await other.getByRole('button', { name: 'Recevoir un nouveau lien' }).click();
      await expect(other).toHaveURL(/\/connexion\?envoye=1$/);
      expect(linkOf(await nextMail(ADDRESS, already))).not.toBe(link);
    } finally {
      await context.close();
    }
  });

  test('un jeton inconnu donne le même état, sans adresse ; avec l’édition en `next`, le formulaire reste vide', async ({ page }) => {
    await page.goto('/espace/verifier?token=jeton-inconnu');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Ce lien n’est plus valable');
    await expect(page.getByLabel('Adresse e-mail utilisée pour l’inscription')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Retour au site des Journées' })).toHaveAttribute('href', '/');

    await page.goto(`/espace/verifier?token=jeton-inconnu&next=${encodeURIComponent(`${ESPACE}/`)}`);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Ce lien n’est plus valable');
    await expect(page.getByLabel('Adresse e-mail utilisée pour l’inscription')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Recevoir un nouveau lien' })).toBeVisible();
  });

  test('la page de vérification ne charge aucun JavaScript (NF-20)', async ({ page }) => {
    const scripts: string[] = [];
    page.on('response', (response) => {
      if (response.request().resourceType() === 'script') scripts.push(response.url());
    });
    await page.goto('/espace/verifier?token=jeton-inconnu');
    await expectOnlyServiceWorkerScript(page);
    expect(scripts, 'fichiers JavaScript chargés par la vérification').toEqual([]);
  });
});

test.describe('T-04 : limitation de débit (NF-03, F-02)', () => {
  test('la 6e demande en 15 minutes affiche « Trop de demandes », le formulaire reste et aucun e-mail de plus ne part', async ({ page }) => {
    const address = 'hugo.peyrat@example.org';
    const already = mailsTo(address, ACCESS_LINK_SUBJECT).length;

    for (let n = 1; n <= 5; n += 1) {
      await requestLink(page, address);
      await expect(page, `demande ${n}`).toHaveURL(/\?envoye=1$/);
    }
    await nextMail(address, already + 4);

    await requestLink(page, address);
    await expect(page).toHaveURL(/\/connexion\?erreur=trop$/);
    await expect(page).toHaveTitle(`Trop de demandes | ${TITLE_SUFFIX}`);
    await expect(page.getByRole('alert')).toHaveText('Trop de demandes, réessayez dans quelques minutes.');
    await expect(page.getByLabel('Adresse e-mail utilisée pour l’inscription')).toBeVisible();
    await capture(page, 'E0-429');

    await page.waitForTimeout(500);
    expect(mailsTo(address, ACCESS_LINK_SUBJECT).length).toBe(already + 5);
  });
});

test.describe('sans JavaScript (NF-31, Q-13)', () => {
  test.use({ javaScriptEnabled: false });

  test('E0 et la vérification fonctionnent : demande, lien, « Ouvrir mon espace », E1, déconnexion', async ({ page }) => {
    const address = 'mathis.lagrange@example.org';
    const link = await receiveLink(page, address);
    await expect(page.getByRole('status')).toHaveText(SENT);

    await page.goto(link);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Votre lien est valable');
    await page.getByRole('button', { name: 'Ouvrir mon espace' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(EDITION_TITLE);
    await expect(page.getByRole('link', { name: /^Mon profil Mathis Lagrange$/ })).toBeVisible();

    // E2 est le seul écran qui demande JavaScript : le message de repli est dans le HTML servi. Playwright, qui coupe JavaScript par
    // l'émulation du protocole, n'affiche pas le contenu de <noscript> ; on lit donc la page telle qu'elle est envoyée.
    const html = await (await page.request.get(`${ESPACE}/bienvenue`)).text();
    expect(html).toMatch(/<noscript>\s*<p[^>]*>Cette étape demande JavaScript\. Activez-le ou utilisez un autre navigateur\.<\/p>\s*<\/noscript>/);

    // Preuve que JavaScript est bien coupé : l'îlot d'E2 ne s'hydrate pas, donc la note F-11 n'apparaît pas quand on décoche l'annuaire.
    await page.goto(`${ESPACE}/bienvenue`);
    await expect(page.getByRole('checkbox', { name: 'Recevoir des demandes de rendez-vous et des messages' })).toBeChecked();
    await page.getByRole('checkbox', { name: 'Apparaître dans l’annuaire des participants' }).uncheck();
    await expect(page.locator('form [role="status"]')).toBeEmpty();

    // La déconnexion est dans E3 depuis le vrai E1 : un formulaire HTML qui poste à Strapi, qui répond 303 vers E0.
    await page.goto(`${ESPACE}/profil`);
    await page.getByRole('button', { name: 'Me déconnecter' }).click();
    await expect(page).toHaveURL(/\/connexion\?deconnecte=1$/);
    await expect(page.getByRole('status')).toHaveText('Déconnexion effectuée.');
  });

  // D3 (corrigé au commit 1115b05, NF-07) : le formulaire d'E2, rendu côté serveur, partait en GET sur la page avec prénom, nom, fonction
  // et entreprise dans l'URL (journalisée par Traefik). Sans JavaScript, « Continuer » ne doit plus rien mettre dans l'URL.
  test('D3 : « Continuer » d’E2 sans JavaScript ne met aucune donnée personnelle dans l’URL', async ({ page }) => {
    await page.goto(await receiveLink(page, 'nathan.lasserre@example.org'));
    await page.getByRole('button', { name: 'Ouvrir mon espace' }).click();
    await page.goto(`${ESPACE}/bienvenue`);
    await page.getByRole('button', { name: 'Continuer' }).click();
    expect(new URL(page.url()).search).toBe('');
  });

  test('une demande refusée par la limitation s’affiche aussi sans JavaScript', async ({ page }) => {
    const address = 'sans-javascript.t04@example.org';
    for (let n = 1; n <= 5; n += 1) {
      await requestLink(page, address);
      await expect(page).toHaveURL(/\?envoye=1$/);
    }
    await requestLink(page, address);
    await expect(page.getByRole('alert')).toHaveText('Trop de demandes, réessayez dans quelques minutes.');
  });
});
