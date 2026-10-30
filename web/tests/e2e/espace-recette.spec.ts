import {
  capture,
  ESPACE,
  expect,
  hydrated,
  NBSP,
  openSpace,
  readOutbox,
  tab,
  test,
  waitForMails,
  watchConsole,
} from './espace';
import { STRAPI_URL } from './fixtures';

/**
 * Recette du soir (lot 16 des phases 2 et 3) : le parcours que Mathieu rejoue à la main sur `strapi_demo_e2e`, joué ici sur le seed de
 * recette (`strapi_e2e`) dans un vrai navigateur.
 *
 *   - Léa passe E1, E3, E4, E5, E6, E7 et E8 sans erreur de console, sur les données du seed (lot 12) ;
 *   - Léa accepte la demande d'Inès (F-60, T-15) : e-mail `meeting-accepted` avec .ics ; Inès voit le rendez-vous confirmé ;
 *   - un participant réserve un créneau libre de la table 2 d'Antoine (R-19, A-29) ; un autre la voit prise (T-25) ;
 *   - Manon envoie une demande puis l'annule (F-52, F-63) ;
 *   - Léa écrit à Mathis, Mathis le reçoit (F-70, F-72, A-37) ;
 *   - l'organisateur ouvre E9 (F-90, R-63), synchronise sur le faux HelloAsso (0, 0, 0) ; un participant reçoit 403 (T-42).
 *
 * Les tests se suivent (mode `serial`) et partagent la base : chacun a ses personnes, mais certains lisent ce que le précédent a écrit
 * (Léa accepte avant qu'Inès ne vérifie, Léa écrit avant que Mathis ne lise). Le seed a des dates fixes (fenêtre de rendez-vous ouverte
 * jusqu'au 2 décembre 2026, jour J le 3) : ces tests valent jusqu'à cette date.
 */

test.describe.configure({ mode: 'serial' });

const EDITION_TITLE = 'Nouvelle-Aquitaine (test)';
const LEA = 'lea.ducasse@example.org';
const INES = 'ines.castaing@example.org';
const MATHIS = 'mathis.lagrange@example.org';
const NATHAN = 'nathan.lasserre@example.org';
const MANON = 'manon.bordenave@example.org';
const ANTOINE = 'antoine.vergnes@example.org';
const CLARA = 'clara.dubourdieu@example.org';
const ORGANIZER = 'organisation@example.org';

/** Libellé du compte à rebours d'E1 pour aujourd'hui (F-20) : « J-34 », « Aujourd’hui », puis « Merci de votre participation ». */
function countdownLabel(): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const days = Math.round((Date.parse('2026-12-03T00:00:00Z') - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days > 0 ? `J-${days}` : days === 0 ? 'Aujourd’hui' : 'Merci de votre participation';
}

const slotButton = (page: import('@playwright/test').Page, time: string) => page.getByRole('button', { name: new RegExp(`^${time}`) });

test('Léa : E1, E3, E4, E5, E6, E7 et E8 sur le seed, sans erreur de console', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const consoleWatch = watchConsole(page);
  await openSpace(page, LEA);

  await test.step('E1 : édition, compte à rebours, profil à 85 %, prochain rendez-vous, suggestions, badges (F-20 à F-24, R-50)', async () => {
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(EDITION_TITLE);
    await expect(page.getByText('Jeudi 3 décembre 2026 à Bordeaux')).toBeVisible();
    await expect(page.getByText(countdownLabel(), { exact: true })).toBeVisible();

    // Profil : nom, entreprise, fonction, présentation et sujets donnent 85 % (R-30), il manque la photo (F-21).
    const profile = page.getByRole('region', { name: 'Votre profil' });
    await expect(profile).toContainText(/85\s*%/);
    await expect(profile.getByText('Ajoutez une photo pour compléter votre profil.')).toBeVisible();
    await expect(profile.getByRole('link', { name: 'Compléter mon profil' })).toHaveAttribute('href', `${ESPACE}/profil`);

    // Prochain rendez-vous (F-22) : celui de 10h45 avec Mathis, à la table 1 ; 4 éléments dans l'agenda (3 rendez-vous et 1 demande reçue).
    const next = page.getByRole('region', { name: 'Prochain rendez-vous' });
    await expect(next).toContainText('10h45');
    await expect(next).toContainText('Table 1');
    await expect(next).toContainText('Mathis Lagrange');
    await expect(next).toContainText('Confirmé');
    await expect(next.getByRole('link', { name: /^Mon agenda\s*\(4\)$/ })).toHaveAttribute('href', `${ESPACE}/agenda`);

    // Suggestions (R-50) : de 1 à 3 cartes, une action « Rencontrer » chacune.
    const suggestions = page.getByRole('region', { name: 'Ils partagent vos sujets' });
    const count = await suggestions.getByRole('listitem').count();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(3);
    await expect(suggestions.getByRole('link', { name: /Rencontrer/ })).toHaveCount(count);

    // Badges (F-24) : une demande reçue à traiter, deux messages non lus.
    await expect(tab(page, 'Agenda')).toHaveAccessibleName(/^Agenda\s*,\s*1 demande reçue en attente$/);
    await expect(tab(page, 'Messages')).toHaveAccessibleName(/^Messages\s*,\s*2 messages non lus$/);
    await expect(tab(page, 'Accueil')).toHaveAttribute('aria-current', 'page');
    await capture(page, 'E1');
  });

  await test.step('E3 : mon profil, champs du seed, déconnexion (F-30 à F-32)', async () => {
    await page.getByRole('link', { name: /^Mon profil Léa Ducasse$/ }).click();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/profil`);
    await hydrated(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mon profil');
    await expect(page.getByLabel('Prénom')).toHaveValue('Léa');
    await expect(page.getByLabel('Nom', { exact: true })).toHaveValue('Ducasse');
    await expect(page.getByLabel('Présentation (facultatif)')).toHaveValue(/Charpentes du Pibal/);
    await expect(page.getByRole('button', { name: 'Me déconnecter' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tableau de bord organisateur' })).toHaveCount(0);
    await capture(page, 'E3');
  });

  await test.step('E4 : annuaire, types, recherche sans accents, état vide (F-40 à F-44)', async () => {
    await tab(page, 'Annuaire').click();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/annuaire`);
    await hydrated(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Annuaire');
    await expect(page.getByText(/^\d+\s+profils$/)).toBeVisible();
    await expect(page.getByRole('link', { name: /^Sylvadour/ })).toBeVisible();
    await capture(page, 'E4');

    await page.getByRole('radio', { name: 'Intervenants' }).check();
    await expect(page.getByText('2 profils', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Antoine Vergnes/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Hélène Marquès/ })).toBeVisible();

    await page.getByRole('radio', { name: 'Exposants' }).check();
    await expect(page.getByText('2 profils', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Résinéo/ })).toBeVisible();

    await page.getByRole('radio', { name: 'Tous' }).check();
    await page.getByRole('searchbox', { name: /Rechercher un profil/ }).fill('econ');
    await expect(page.getByRole('link', { name: /Mathis Lagrange/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Clara Dubourdieu/ })).toHaveCount(0);

    await page.getByRole('searchbox', { name: /Rechercher un profil/ }).fill('zzzzz');
    await expect(page.getByText('Aucun profil ne correspond. Essayez un autre sujet ou effacez la recherche.')).toBeVisible();
    await page.getByRole('button', { name: 'Effacer les filtres' }).click();
    await expect(page.getByRole('searchbox', { name: /Rechercher un profil/ })).toHaveValue('');
    await expect(page.getByRole('link', { name: /Mathis Lagrange/ })).toBeVisible();
  });

  await test.step('E5 : fiche de Mathis, rendez-vous confirmé de 10h45, aucun créneau présélectionné (F-50, F-51, F-54)', async () => {
    await page.getByRole('link', { name: /Mathis Lagrange/ }).click();
    await expect(page).toHaveURL(new RegExp(`${ESPACE}/annuaire/p/`));
    await hydrated(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mathis Lagrange');
    await expect(page.getByRole('heading', { level: 2, name: /^Proposer un rendez-vous, jeudi 3 décembre$/ })).toBeVisible();
    const confirmed = slotButton(page, '10h45');
    await expect(confirmed).toContainText('Confirmé');
    await expect(confirmed).toHaveAttribute('aria-disabled', 'true');
    const submit = page.getByRole('button', { name: 'Choisissez un créneau' });
    await expect(submit).toBeDisabled();
    await slotButton(page, '13h30').click();
    await expect(page.getByRole('button', { name: 'Envoyer la demande pour 13h30' })).toBeEnabled();
    await capture(page, 'E5-personne');
    await expect(page.getByRole('link', { name: /Écrire un message/ })).toBeVisible();
  });

  await test.step('E5 : fiche d’Hélène, demande déjà envoyée (F-52) ; fiche de Sylvadour, rendez-vous au stand (F-57)', async () => {
    await tab(page, 'Annuaire').click();
    await hydrated(page);
    await page.getByRole('searchbox', { name: /Rechercher un profil/ }).fill('Marquès');
    await page.getByRole('link', { name: /Hélène Marquès/ }).click();
    await hydrated(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hélène Marquès');
    await expect(page.getByText(/Demande envoyée pour .*15h30, Hélène n’a pas encore répondu\./)).toBeVisible();

    await tab(page, 'Annuaire').click();
    await hydrated(page);
    await page.getByRole('searchbox', { name: /Rechercher un profil/ }).fill('Sylvadour');
    await page.getByRole('link', { name: /^Sylvadour/ }).click();
    await expect(page).toHaveURL(new RegExp(`${ESPACE}/annuaire/x/`));
    await hydrated(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sylvadour');
    await expect(page.getByRole('heading', { level: 2, name: /^Demander un rendez-vous au stand, jeudi 3 décembre$/ })).toBeVisible();
    await expect(slotButton(page, '12h30')).toContainText('Confirmé');
    await expect(page.getByRole('heading', { level: 2, name: 'Représentants' })).toBeVisible();
    await capture(page, 'E5-exposant');
  });

  await test.step('E6 : agenda, demandes reçues et envoyées, frise de la journée, historique (F-60 à F-66)', async () => {
    await tab(page, 'Agenda').click();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/agenda`);
    await hydrated(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mon agenda');
    await expect(page.getByRole('link', { name: 'Calendrier' })).toHaveAttribute('href', /\/api\/espace\/meetings\.ics$/);

    const received = page.getByRole('region', { name: 'Demandes reçues' });
    await expect(received).toContainText('Inès Castaing');
    await expect(received).toContainText('Propose 13h00');
    await expect(received).toContainText('« Bonjour Léa, échangeons sur la construction bois. »');
    await expect(received.getByRole('button', { name: /^Accepter/ })).toBeVisible();
    await expect(received.getByRole('button', { name: /^Proposer un autre créneau/ })).toBeVisible();
    await expect(received.getByRole('button', { name: /^Refuser/ })).toBeVisible();

    const day = page.getByRole('region', { name: /^Ma journée, jeudi 3 décembre$/ });
    await expect(day).toContainText('Accueil et ouverture');
    await expect(day).toContainText('Mathis Lagrange');
    await expect(day).toContainText('Table 1');
    await expect(day).toContainText('Sylvadour');
    await expect(day).toContainText('Stand 4');
    await expect(day).toContainText('Confirmé par Benoît Tastet');
    await expect(day).toContainText('Hélène Marquès');
    await expect(day).toContainText('En attente de réponse');

    const sent = page.getByRole('region', { name: 'Demandes envoyées' });
    await expect(sent).toContainText('Hélène Marquès');
    await expect(sent.getByRole('button', { name: /^Annuler la demande/ })).toBeVisible();

    const history = page.locator('details').filter({ hasText: 'Historique (1)' });
    await history.locator('summary').click();
    await expect(history).toContainText('Jules Mazères');
    await expect(history).toContainText('Refusé');
    await capture(page, 'E6');
  });

  await test.step('E7 : liste des conversations avec les non lus, puis le fil avec le rendez-vous lié (F-70, A-37)', async () => {
    await tab(page, 'Messages').click();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/messages`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Messages');
    const rows = page.getByRole('main').getByRole('listitem');
    await expect(rows.nth(0)).toContainText('Mathis Lagrange');
    await expect(rows.nth(0)).toContainText('J’apporterai nos échantillons de panneaux.');
    await expect(rows.nth(0)).toContainText('1 message non lu');
    await expect(rows.nth(1)).toContainText('Inès Castaing');
    await expect(rows.nth(1)).toContainText('1 message non lu');
    await capture(page, 'E7-liste');

    await rows.nth(0).getByRole('link').click();
    await hydrated(page);
    const log = page.getByRole('log', { name: 'Messages' });
    await expect(log.getByRole('listitem').filter({ hasText: 'Quels panneaux vous intéressent ?' })).toBeVisible();
    await expect(log.getByRole('listitem').filter({ hasText: 'pour les cloisons intérieures' })).toBeVisible();
    await expect(log.getByRole('listitem').filter({ hasText: 'J’apporterai nos échantillons de panneaux.' })).toBeVisible();
    await expect(page.getByText(/Rendez-vous confirmé, jeudi 3 décembre à 10h45, table 1/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Voir l’agenda' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
    await capture(page, 'E7-fil');
  });

  await test.step('E8 : programme avec session, onglets par ancres, Prendre RDV, intervenants avec lien (F-80, F-81)', async () => {
    await tab(page, 'Programme').click();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/programme`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Programme');
    await expect(page.getByRole('heading', { level: 3, name: 'Accueil et ouverture' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Prendre RDV' }).first()).toHaveAttribute('href', `${ESPACE}/annuaire`);
    await capture(page, 'E8');

    const sections = page.getByRole('navigation', { name: 'Sections du programme' });
    await sections.getByRole('link', { name: 'Intervenants' }).click();
    await expect(page).toHaveURL(/#intervenants$/);
    await expect(page.getByRole('link', { name: /Hélène Marquès/ })).toHaveAttribute('href', new RegExp(`${ESPACE}/annuaire/p/`));
    await sections.getByRole('link', { name: 'Infos pratiques' }).click();
    await expect(page.getByRole('heading', { level: 3, name: 'Salle de recette (lieu fictif)' })).toBeVisible();
  });

  consoleWatch.expectClean();
});

test('Léa accepte la demande d’Inès : e-mail meeting-accepted avec .ics, rendez-vous confirmé à la table 1 (F-60, T-15, I-41, A-33)', async ({ page }) => {
  await openSpace(page, LEA);
  await expect(tab(page, 'Agenda')).toHaveAccessibleName(/1 demande reçue en attente/);

  await tab(page, 'Agenda').click();
  await hydrated(page);
  const received = page.getByRole('region', { name: 'Demandes reçues' });
  await expect(received).toContainText('Inès Castaing');
  const before = readOutbox().length;
  await received.getByRole('button', { name: /^Accepter/ }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Rendez-vous confirmé' })).toHaveText('Rendez-vous confirmé avec Inès Castaing, Table 1, 13h00.');
  await expect(page.getByRole('region', { name: 'Demandes reçues' })).toHaveCount(0);
  const day = page.getByRole('region', { name: /^Ma journée/ });
  await expect(day).toContainText('Inès Castaing');
  await expect(day.locator('div', { hasText: /^Inès Castaing/ }).last()).toContainText('Table 1');
  await capture(page, 'E6-apres-acceptation');

  // L'e-mail part après la transaction, avec le .ics en pièce jointe (I-41) ; Léa, qui a répondu, n'en reçoit pas.
  const [mail] = await waitForMails(INES, `Rendez-vous confirmé${NBSP}:`);
  expect(mail.subject).toBe(`Rendez-vous confirmé${NBSP}: jeudi 3 décembre à 13h00`);
  expect(mail.attachments, 'une seule pièce jointe').toHaveLength(1);
  expect(mail.attachments![0].filename).toBe('rendez-vous.ics');
  const ics = Buffer.from(mail.attachments![0].content, 'base64').toString('utf8');
  expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  expect(ics).toContain('DTSTART;TZID=Europe/Paris:20261203T130000');
  expect(ics).toContain('LOCATION:Table 1');
  expect(ics).not.toMatch(/@example\.org/);
  expect(readOutbox().slice(before).filter((sent) => sent.to.email === LEA && sent.subject.startsWith('Rendez-vous confirmé'))).toEqual([]);

  // Le fichier .ics de Léa (bouton « Calendrier ») contient ses rendez-vous acceptés, dont celui-ci.
  const calendar = await page.request.get(await page.getByRole('link', { name: 'Calendrier' }).getAttribute('href') as string);
  expect(calendar.status()).toBe(200);
  expect(calendar.headers()['content-type']).toContain('text/calendar');
  expect(await calendar.text()).toContain('DTSTART;TZID=Europe/Paris:20261203T130000');
});

test('Inès retrouve le rendez-vous accepté dans son agenda et sur son accueil (F-22, F-64)', async ({ page }) => {
  await openSpace(page, INES);
  const next = page.getByRole('region', { name: 'Prochain rendez-vous' });
  await expect(next).toContainText('13h00');
  await expect(next).toContainText('Table 1');
  await expect(next).toContainText('Léa Ducasse');
  await expect(next).toContainText('Confirmé');

  await tab(page, 'Agenda').click();
  await hydrated(page);
  await expect(page.getByRole('region', { name: 'Demandes envoyées' })).toHaveCount(0);
  const day = page.getByRole('region', { name: /^Ma journée/ });
  await expect(day).toContainText('Léa Ducasse');
  await expect(day).toContainText('Confirmé');
  await expect(day.getByRole('button', { name: /^Annuler le rendez-vous/ })).toBeVisible();
});

test('un participant réserve un créneau libre de la table 2 d’Antoine, confirmée d’emblée, avec e-mails aux deux (R-19, A-29, A-33)', async ({ page }) => {
  await openSpace(page, NATHAN);
  await tab(page, 'Annuaire').click();
  await hydrated(page);
  await page.getByRole('searchbox', { name: /Rechercher un profil/ }).fill('Vergnes');
  await page.getByRole('link', { name: /Antoine Vergnes/ }).click();
  await hydrated(page);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Antoine Vergnes');
  await expect(page.getByRole('heading', { level: 2, name: /^Réserver un créneau, jeudi 3 décembre$/ })).toBeVisible();
  await expect(page.getByText('Table 2, confirmée dès la réservation')).toBeVisible();
  await expect(page.getByLabel(/Un mot pour présenter votre demande/)).toHaveCount(0);

  // Hugo a déjà réservé 10h45 (seed) : le créneau est barré et annoncé « indisponible » (F-50).
  const taken = slotButton(page, '10h45');
  await expect(taken).toHaveAttribute('aria-disabled', 'true');
  await expect(taken).toContainText('indisponible');
  await capture(page, 'E5-table-dediee');

  await slotButton(page, '11h00').click();
  const before = readOutbox().length;
  await page.getByRole('button', { name: 'Réserver 11h00' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Réservation confirmée' })).toContainText('Réservation confirmée : Table 2, 11h00.');
  await expect(slotButton(page, '11h00')).toContainText('Confirmé');

  // Les deux parties reçoivent `meeting-accepted` (A-33) ; celui du demandeur porte le .ics.
  const [forNathan] = await waitForMails(NATHAN, `Rendez-vous confirmé${NBSP}:`);
  expect(forNathan.attachments?.[0]?.filename).toBe('rendez-vous.ics');
  const [forAntoine] = await waitForMails(ANTOINE, `Rendez-vous confirmé${NBSP}:`);
  expect(forAntoine.subject).toContain('11h00');
  expect(readOutbox().length).toBeGreaterThan(before);

  await tab(page, 'Agenda').click();
  await hydrated(page);
  const card = page.getByRole('region', { name: /^Ma journée/ }).locator('div', { hasText: /^Antoine Vergnes/ }).last();
  await expect(card).toContainText('Table 2');
  await expect(card).toContainText('Confirmé');
});

test('un second participant voit le créneau réservé de la table 2 barré (T-25)', async ({ page }) => {
  await openSpace(page, MANON);
  await tab(page, 'Annuaire').click();
  await hydrated(page);
  await page.getByRole('searchbox', { name: /Rechercher un profil/ }).fill('Vergnes');
  await page.getByRole('link', { name: /Antoine Vergnes/ }).click();
  await hydrated(page);
  for (const time of ['10h45', '11h00']) {
    await expect(slotButton(page, time)).toHaveAttribute('aria-disabled', 'true');
    await expect(slotButton(page, time)).toContainText('indisponible');
  }
  await expect(page.getByRole('button', { name: 'Choisissez un créneau' })).toBeDisabled();
});

test('Manon envoie une demande à Mathis puis l’annule (F-52, F-63, I-31)', async ({ page }) => {
  await openSpace(page, MANON);
  await tab(page, 'Annuaire').click();
  await hydrated(page);
  await page.getByRole('searchbox', { name: /Rechercher un profil/ }).fill('Lagrange');
  await page.getByRole('link', { name: /Mathis Lagrange/ }).click();
  await hydrated(page);

  await slotButton(page, '13h30').click();
  await page.getByLabel(/Un mot pour présenter votre demande/).fill('Bonjour Mathis, un point sur vos panneaux ?');
  await page.getByRole('button', { name: 'Envoyer la demande pour 13h30' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Demande envoyée à Mathis' })).toContainText('Demande envoyée à Mathis');
  await expect(slotButton(page, '13h30')).toContainText('Demande envoyée');

  const [mail] = await waitForMails(MATHIS, `Demande de rendez-vous${NBSP}:`);
  expect(mail.subject).toBe(`Demande de rendez-vous${NBSP}: Manon Bordenave`);
  expect(mail.text).toContain('Bonjour Mathis, un point sur vos panneaux ?');
  expect(mail.text.match(/https?:\/\/[^\s"'<>)]+\/espace\/verifier\?[^\s"'<>)]+/g)).toHaveLength(2);

  await tab(page, 'Agenda').click();
  await hydrated(page);
  const sent = page.getByRole('region', { name: 'Demandes envoyées' });
  await expect(sent).toContainText('Mathis Lagrange');
  await expect(sent).toContainText('En attente de réponse');
  await sent.getByRole('button', { name: /^Annuler la demande/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Annuler cette demande ?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Oui, annuler la demande' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'annulée' })).toHaveText('Demande à Mathis Lagrange annulée.');
  await expect(page.getByRole('region', { name: 'Demandes envoyées' })).toHaveCount(0);
  await expect(page.locator('details').filter({ hasText: 'Historique (1)' })).toContainText('Annulé');
});

test('Léa écrit à Mathis : le message apparaît dans le fil et dans la liste (F-70, F-72)', async ({ page }) => {
  await openSpace(page, LEA);
  await tab(page, 'Messages').click();
  await page.getByRole('main').getByRole('listitem').filter({ hasText: 'Mathis Lagrange' }).getByRole('link').click();
  await hydrated(page);

  const log = page.getByRole('log', { name: 'Messages' });
  await expect(log.getByRole('listitem').filter({ hasText: 'J’apporterai nos échantillons de panneaux.' })).toBeVisible();
  const draft = page.getByRole('textbox', { name: 'Votre message' });
  await draft.fill('Merci Mathis, j’apporte les plans à 10h45.');
  await page.getByRole('button', { name: 'Envoyer' }).click();

  await expect(log.getByRole('listitem').filter({ hasText: 'Merci Mathis, j’apporte les plans à 10h45.' })).toContainText('Envoyé');
  await expect(draft).toHaveValue('');
  await page.reload();
  await expect(page.getByRole('log', { name: 'Messages' }).getByRole('listitem').filter({ hasText: 'Merci Mathis, j’apporte les plans à 10h45.' })).toBeVisible();

  await tab(page, 'Messages').click();
  const first = page.getByRole('main').getByRole('listitem').first();
  await expect(first).toContainText('Mathis Lagrange');
  await expect(first).toContainText(`Vous${NBSP}: Merci Mathis, j’apporte les plans à 10h45.`);
});

test('Mathis reçoit le message de Léa, avec le badge de l’onglet Messages (F-24, F-70)', async ({ page }) => {
  await openSpace(page, MATHIS);
  await expect(tab(page, 'Messages')).toHaveAccessibleName(/^Messages\s*,\s*1 message non lu$/);
  await tab(page, 'Messages').click();
  const row = page.getByRole('main').getByRole('listitem').first();
  await expect(row).toContainText('Léa Ducasse');
  await expect(row).toContainText('Merci Mathis, j’apporte les plans à 10h45.');
  await row.getByRole('link').click();
  await hydrated(page);
  await expect(page.getByRole('log', { name: 'Messages' }).getByRole('listitem').filter({ hasText: 'Merci Mathis, j’apporte les plans à 10h45.' })).toBeVisible();
  await tab(page, 'Accueil').click();
  await expect(tab(page, 'Messages')).toHaveAccessibleName('Messages');
});

test('l’organisateur ouvre E9 : indicateurs égaux aux comptes de l’API, aucun contenu de message, synchronisation sur le faux (F-90, R-63, I-12)', async ({ page, baseURL }) => {
  const consoleWatch = watchConsole(page);
  await openSpace(page, ORGANIZER);

  // Première connexion de l'organisateur : E2 (A-26). Le profil provisoire suffit, on valide les choix tels quels.
  if (page.url().endsWith('/bienvenue')) {
    await hydrated(page);
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page).toHaveURL(`${baseURL}${ESPACE}/`);
  }
  await page.getByRole('link', { name: 'Organisation' }).click();
  await expect(page).toHaveURL(`${baseURL}${ESPACE}/organisateur`);
  await hydrated(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pilotage de l’édition');
  await expect(page.getByText('Jeudi 3 décembre 2026 à Bordeaux')).toBeVisible();

  // Les mêmes chiffres que l'API (comptes en base) : participants, rendez-vous, messages.
  const stats = await (await page.request.get(`${STRAPI_URL}/api/espace/admin/nouvelle-aquitaine-test/stats`)).json();
  const indicator = (label: string) => page.getByRole('heading', { level: 3, name: label }).locator('xpath=ancestor::li[1]');
  await expect(indicator('Inscrits importés')).toContainText(String(stats.attendees.active));
  await expect(indicator('Inscrits importés')).toContainText('inscription annulée');
  expect(stats.attendees.active).toBe(16);
  expect(stats.attendees.cancelled).toBe(1);
  await expect(indicator('Annuaire')).toContainText(String(stats.directoryOptIn));
  await expect(indicator('Rendez-vous')).toContainText(String(stats.meetings.accepted + stats.meetings.pending));
  await expect(indicator('Messages')).toContainText(String(stats.messages));
  expect(stats.messages).toBeGreaterThanOrEqual(5);
  expect(stats.meetings.accepted).toBeGreaterThanOrEqual(5);
  await expect(page.getByRole('heading', { level: 2, name: 'Exposants les plus sollicités' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Avertissements' }).or(page.getByText('Aucun avertissement.'))).toBeVisible();
  await capture(page, 'E9');

  // R-63 : ni la page ni les statistiques ne contiennent le texte d'un message.
  const page_text = await page.locator('main').innerText();
  expect(page_text).not.toContain('échantillons');
  expect(page_text).not.toContain('plans à 10h45');
  expect(JSON.stringify(stats)).not.toContain('échantillons');

  // Synchronisation sur le faux HelloAsso (démarré par le serveur e2e) : rien à créer, rien à mettre à jour, rien à annuler.
  await page.getByRole('button', { name: 'Synchroniser maintenant' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Synchronisation terminée' })).toHaveText(/Synchronisation terminée\s*:\s*0\s+inscrit\s+créé,\s*0\s+mis\s+à\s+jour,\s*0\s+annulé\./);
  const history = page.locator('details').filter({ hasText: 'Historique des synchronisations' });
  await expect(history.locator('summary')).toContainText('Historique des synchronisations (1)');
  await history.locator('summary').click();
  await expect(history.getByRole('table').locator('tbody tr').first().locator('td')).toHaveText(['0', '0', '0', '0']);
  consoleWatch.expectClean();
});

test('T-42 : un participant sur /organisateur reçoit 403 « Accès réservé » ; l’API des statistiques aussi', async ({ page }) => {
  await openSpace(page, CLARA);
  const response = await page.goto(`${ESPACE}/organisateur`);
  expect(response?.status()).toBe(403);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Accès réservé');
  await expect(page.getByText('Le tableau de bord est réservé aux organisateurs de l’édition.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Organisation' })).toHaveCount(0);
  await expect(page.getByText('Inscrits importés')).toHaveCount(0);

  const api = await page.request.get(`${STRAPI_URL}/api/espace/admin/nouvelle-aquitaine-test/stats`);
  expect(api.status()).toBe(403);
});

test('E8 est public : programme sans session, sans JavaScript, « Prendre RDV » vers E0, intervenants sans lien (F-80, F-81, NF-31)', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    await context.route((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (route) => route.abort());
    const page = await context.newPage();
    const response = await page.goto(`${ESPACE}/programme`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Programme');
    await expect(page.getByRole('navigation', { name: 'Espace participant' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 3, name: 'Forêt et adaptation' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Prendre RDV' }).first()).toHaveAttribute('href', `${ESPACE}/connexion`);

    await page.getByRole('navigation', { name: 'Sections du programme' }).getByRole('link', { name: 'Intervenants' }).click();
    await expect(page).toHaveURL(/#intervenants$/);
    await expect(page.locator('#intervenants').getByText('Hélène Marquès')).toBeVisible();
    await expect(page.getByRole('link', { name: /Hélène Marquès/ })).toHaveCount(0);
    const html = await (await page.request.get(`${ESPACE}/programme`)).text();
    expect(html).not.toMatch(/@example\.org/);
  } finally {
    await context.close();
  }
});
