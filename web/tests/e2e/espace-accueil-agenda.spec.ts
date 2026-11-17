import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer } from 'node:net';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { ESPACE, expect, hydrated, openSpace, tab, test } from './espace';
import { STRAPI_URL } from './fixtures';

/**
 * Accueil et agenda actionnables (V2-A : F-109 à F-115, F-117).
 *
 * Les tests se suivent (mode `serial`) sur le seed de recette : ceux qui lisent la demande d'Inès à Léa passent avant celui où Léa l'accepte.
 *
 * - Contextes supplémentaires (`browser.newContext`) : `extraHTTPHeaders: {}`, sinon l'en-tête X-Forwarded-For du `test` de l'espace fait refuser par CORS
 *   les appels de l'îlot à Strapi (« x-forwarded-for is not allowed by Access-Control-Allow-Headers »).
 * - Temps : `page.clock` avance l'horloge de la page (relecture de 60 s, classement du jour J) sans attendre ; les appels réseau restent réels.
 * - Fenêtre de demandes (F-111) : l'édition de recette est modifiée par SQL (`docker exec jib-postgres psql`) sur la base e2e de l'exécution,
 *   puis remise en l'état par `afterAll`. Aucune route ni aide partagée ne le permet.
 * - Lecture des rendez-vous en échec (F-110) : l'accueil lit `/meetings` côté serveur, hors de portée de `page.route`. Le test construit un
 *   second front (`dist-e2e/<port>-meetings-ko`) dont STRAPI_URL vise un relais local qui répond 500 à `/meetings` et transmet le reste au
 *   Strapi de test ; REACT_STRAPI_URL reste celui du Strapi de test. La configuration partagée n'est pas touchée.
 */

test.describe.configure({ mode: 'serial' });

const LEA = 'lea.ducasse@example.org';
const INES = 'ines.castaing@example.org';
const NATHAN = 'nathan.lasserre@example.org';
const CLARA = 'clara.dubourdieu@example.org'; // annuaire décoché
const ALICE = 'alice.fourcade@example.org';
const EVA = 'eva.cazaux@example.org';
const JULES = 'jules.mazeres@example.org';

const DATABASE = process.env.E2E_DATABASE ?? 'strapi_e2e';
const SEED_OPEN_AT = '2026-10-01 08:00:00';
const SEED_CLOSE_AT = '2026-12-02 17:00:00';

// Strapi limite les liens de connexion à 5 par adresse et par 15 minutes (NF-03) : le premier test d'une adresse ouvre la session, les
// suivants en reprennent le cookie.
const sessions = new Map<string, Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>>>();

async function signIn(page: Page, email: string) {
  const known = sessions.get(email);
  if (known) {
    await page.context().addCookies(known);
    return;
  }
  await openSpace(page, email);
  sessions.set(email, await page.context().cookies());
}

async function openHome(page: Page, email: string) {
  await signIn(page, email);
  await page.goto(`${ESPACE}/`);
  await hydrated(page);
}

async function openAgenda(page: Page, email: string) {
  await signIn(page, email);
  await page.goto(`${ESPACE}/agenda`);
  await hydrated(page);
}

/** Ouvre la fiche d'une personne depuis l'annuaire (recherche puis clic), comme la recette. */
async function openProfile(page: Page, email: string, search: string, name: RegExp) {
  await signIn(page, email);
  await page.goto(`${ESPACE}/annuaire`);
  await hydrated(page);
  await page.getByRole('searchbox', { name: /Rechercher un profil/ }).fill(search);
  await page.getByRole('link', { name }).click();
  await hydrated(page);
}

const slotButton = (page: Page, time: string) => page.getByRole('button', { name: new RegExp(`^${time}`) });

function sql(statement: string): string {
  expect(DATABASE.endsWith('_e2e'), `base e2e attendue, reçu ${DATABASE}`).toBe(true);
  const result = spawnSync('docker', ['exec', 'jib-postgres', 'psql', '-U', 'strapi', '-d', DATABASE, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', statement], { encoding: 'utf8' });
  expect(result.status, `SQL « ${statement} » : ${result.stderr}`).toBe(0);
  return result.stdout.trim();
}

/** Plus grand identifiant de rendez-vous au départ du fichier : ceux que les tests créent ensuite sont supprimés par `afterAll`. */
let lastSeedMeetingId: number | null = null;
test.beforeAll(() => {
  lastSeedMeetingId = Number(sql('select coalesce(max(id), 0) from espace_meetings'));
});

const setWindow = (openAt: string, closeAt: string) =>
  sql(`update editions set meeting_requests_open_at = '${openAt}', meeting_requests_close_at = '${closeAt}' where slug = 'nouvelle-aquitaine-test'`);

/**
 * Remet le seed de recette tel quel pour les autres fichiers : la demande d'Inès à Léa redevient en attente (le test du critère 4 l'accepte)
 * les rendez-vous créés par les tests sont supprimés, et le message d'Inès à Léa redevient non lu (le lien « Écrire à Inès » ouvre le fil et le lit).
 */
const restoreInesRequest = () => {
  sql(`
    update espace_messages set read_at = null where id in (
      select l.message_id from espace_messages_author_lnk l
      join espace_attendees a on a.id = l.attendee_id and a.email = '${INES}'
      join espace_messages_conversation_lnk c on c.message_id = l.message_id
      join espace_conversations_participants_lnk p on p.conversation_id = c.conversation_id
      join espace_attendees b on b.id = p.attendee_id and b.email = '${LEA}')`);
  sql(`
    with m as (
      select r.meeting_id as id from espace_meetings_requester_lnk r
      join espace_attendees a on a.id = r.attendee_id and a.email = '${INES}'
      join espace_meetings_target_attendee_lnk t on t.meeting_id = r.meeting_id
      join espace_attendees b on b.id = t.attendee_id and b.email = '${LEA}'
    ), gone as (delete from espace_meetings_answered_by_lnk where meeting_id in (select id from m))
    update espace_meetings set status = 'pending', location = null, table_number = null, table_key = null, answered_at = null
    where id in (select id from m) and status = 'accepted'`);
};

const deleteCreatedMeetings = () => {
  if (lastSeedMeetingId === null) return;
  for (const link of ['edition', 'slot', 'requester', 'target_attendee', 'target_exhibitor', 'answered_by']) {
    sql(`delete from espace_meetings_${link}_lnk where meeting_id > ${lastSeedMeetingId}`);
  }
  sql(`delete from espace_meetings where id > ${lastSeedMeetingId}`);
};

test.afterAll(() => {
  if (sessions.size > 0) {
    deleteCreatedMeetings();
    restoreInesRequest();
    setWindow(SEED_OPEN_AT, SEED_CLOSE_AT);
  }
});

/** Place `document.visibilityState` : le navigateur de test est toujours visible, l'onglet masqué se simule. */
const setVisibility = (page: Page, state: 'visible' | 'hidden') =>
  page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  }, state);

const isMeetingsRead = (url: string, method: string) => method === 'GET' && /\/api\/espace\/meetings(\?|$)/.test(url);

// ---------------------------------------------------------------------------------------------------------------------------------------
// Accueil : demandes à traiter (F-109, critère 1), sans JavaScript (critère 6), annuaire (F-117)
// ---------------------------------------------------------------------------------------------------------------------------------------

test('critère 1, F-109 : Léa voit « 1 demande à traiter » de Inès Castaing avant « Prochain rendez-vous », avec un bouton vers l’agenda', async ({ page, baseURL }) => {
  await openHome(page, LEA);
  const card = page.getByRole('region', { name: '1 demande à traiter' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('De Inès Castaing');
  await expect(card.getByRole('link', { name: 'Répondre dans mon agenda' })).toHaveAttribute('href', `${ESPACE}/agenda`);

  const next = page.getByRole('region', { name: 'Prochain rendez-vous' });
  const before = await card.evaluate((node, other) => Boolean(node.compareDocumentPosition(other as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await next.elementHandle());
  expect(before, 'la carte des demandes précède « Prochain rendez-vous »').toBe(true);

  await card.getByRole('link', { name: 'Répondre dans mon agenda' }).click();
  await expect(page).toHaveURL(`${baseURL}${ESPACE}/agenda`);
});

test('F-109 : sans demande reçue en attente, aucune carte « à traiter »', async ({ page }) => {
  await openHome(page, NATHAN);
  await expect(page.getByRole('heading', { level: 2, name: 'Prochain rendez-vous' })).toBeVisible();
  await expect(page.getByRole('region', { name: /à traiter/ })).toHaveCount(0);
});

test('critère 6 : sans JavaScript, l’accueil de Léa reste lisible (demande, prochain rendez-vous, liens)', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false, locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block', extraHTTPHeaders: {} });
  try {
    await context.addCookies(sessions.get(LEA) ?? []);
    await context.route((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (route) => route.abort());
    const page = await context.newPage();
    const response = await page.goto(`${ESPACE}/`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nouvelle-Aquitaine (test)');

    const card = page.getByRole('region', { name: '1 demande à traiter' });
    await expect(card).toContainText('De Inès Castaing');
    await expect(card.getByRole('link', { name: 'Répondre dans mon agenda' })).toHaveAttribute('href', `${ESPACE}/agenda`);

    const next = page.getByRole('region', { name: 'Prochain rendez-vous' });
    await expect(next).toContainText('10h45');
    await expect(next).toContainText('Mathis Lagrange');
    await expect(next.getByRole('link', { name: /^Mon agenda/ })).toHaveAttribute('href', `${ESPACE}/agenda`);
    await expect(page.getByRole('navigation', { name: 'Espace participant' })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('F-117 : annuaire décoché, le bandeau le dit et « Modifier ma visibilité » mène au profil', async ({ page, baseURL }) => {
  await openHome(page, CLARA);
  await expect(page.getByText('Vous n’apparaissez pas dans l’annuaire : personne ne peut vous proposer de rendez-vous.')).toBeVisible();
  const link = page.getByRole('link', { name: 'Modifier ma visibilité' });
  await expect(link).toHaveAttribute('href', `${ESPACE}/profil#visibilite`);
  await link.click();
  await expect(page).toHaveURL(`${baseURL}${ESPACE}/profil#visibilite`);
  await expect(page.getByRole('group', { name: 'Vos choix de visibilité' })).toBeVisible();
});

test('F-117 : annuaire coché, pas de bandeau', async ({ page }) => {
  await openHome(page, LEA);
  await expect(page.getByText(/Vous n’apparaissez pas dans l’annuaire/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Modifier ma visibilité' })).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// Agenda : liens de fiche et de conversation (F-112, critère 5), dialogue d'annulation (F-115)
// ---------------------------------------------------------------------------------------------------------------------------------------

test('critère 5, F-112 : chaque carte de l’agenda a un lien de fiche nommé d’après la personne, et « Écrire à » pour une personne', async ({ page, baseURL }) => {
  await openAgenda(page, LEA);

  const received = page.getByRole('region', { name: 'Demandes reçues' });
  await expect(received.getByRole('link', { name: 'Voir la fiche de Inès Castaing' })).toHaveAttribute('href', new RegExp(`^${ESPACE}/annuaire/p/[^/]+$`));
  await expect(received.getByRole('link', { name: 'Écrire à Inès' })).toHaveAttribute('href', /^\/espace\/nouvelle-aquitaine-test\/messages\/nouveau\?avec=p(:|%3A)[^&]+$/);

  const sent = page.getByRole('region', { name: 'Demandes envoyées' });
  await expect(sent.getByRole('link', { name: 'Voir la fiche de Hélène Marquès' })).toBeVisible();
  await expect(sent.getByRole('link', { name: 'Écrire à Hélène' })).toBeVisible();

  const day = page.getByRole('region', { name: /^Mes rendez-vous/ });
  await expect(day.getByRole('link', { name: 'Voir la fiche de Mathis Lagrange' })).toBeVisible();
  await expect(day.getByRole('link', { name: 'Écrire à Mathis' })).toBeVisible();
  // Un exposant a une fiche mais pas de conversation.
  await expect(day.getByRole('link', { name: /^Voir la fiche de Sylvadour/ })).toHaveAttribute('href', new RegExp(`^${ESPACE}/annuaire/x/`));
  await expect(day.getByRole('link', { name: /^Écrire à/ })).toHaveCount(1);

  // Une fiche par carte : 1 reçue, 1 envoyée, 2 rendez-vous.
  await expect(page.getByRole('link', { name: /^Voir la fiche de / })).toHaveCount(4);

  // Les liens aboutissent : la fiche s'ouvre, le formulaire de message s'ouvre.
  await received.getByRole('link', { name: 'Écrire à Inès' }).click();
  await expect(page).toHaveURL(/\/messages\/(nouveau\?avec=p(:|%3A)|[a-z0-9]+$)/); // la conversation existe déjà pour Inès : « nouveau » y redirige
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const profile = await page.goto(`${baseURL}${ESPACE}/agenda`);
  expect(profile?.status()).toBe(200);
  await hydrated(page);
  await page.getByRole('region', { name: 'Demandes reçues' }).getByRole('link', { name: 'Voir la fiche de Inès Castaing' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inès Castaing');
});

test('F-115 : « Non, le garder » ferme le dialogue d’annulation d’un rendez-vous sans l’annuler ; « Non, la garder » pour une demande', async ({ page }) => {
  await openAgenda(page, LEA);
  const day = page.getByRole('region', { name: /^Mes rendez-vous/ });
  await day.getByRole('button', { name: /^Annuler le rendez-vous avec Mathis Lagrange/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Annuler ce rendez-vous ?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Non, le garder' }).click();
  await expect(dialog).toBeHidden();
  await expect(day).toContainText('Mathis Lagrange');

  const sent = page.getByRole('region', { name: 'Demandes envoyées' });
  await sent.getByRole('button', { name: /^Annuler la demande/ }).click();
  const pending = page.getByRole('dialog', { name: 'Annuler cette demande ?' });
  await pending.getByRole('button', { name: 'Non, la garder' }).click();
  await expect(pending).toBeHidden();
  await expect(sent).toContainText('Hélène Marquès');
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// Rechargement de l'agenda (F-113, critère 4)
// ---------------------------------------------------------------------------------------------------------------------------------------

test('F-113 : la relecture de 60 s garde un panneau ouvert et une saisie', async ({ page }) => {
  await signIn(page, LEA);
  await page.clock.install();
  await page.goto(`${ESPACE}/agenda`);
  await hydrated(page);

  const received = page.getByRole('region', { name: 'Demandes reçues' });
  await received.getByRole('button', { name: /^Proposer un autre créneau/ }).click();
  const draft = page.getByLabel(/Un mot pour accompagner votre proposition/);
  await expect(draft).toBeVisible();
  await draft.fill('Plutôt en fin d’après-midi ?');
  const slot = received.locator('button[aria-pressed="false"]').first();
  await slot.click();
  await expect(received.locator('button[aria-pressed="true"]')).toHaveCount(1);

  const reread = page.waitForResponse((response) => isMeetingsRead(response.url(), response.request().method()));
  await page.clock.runFor(60_000);
  await reread;

  await expect(page.getByLabel(/Un mot pour accompagner votre proposition/)).toHaveValue('Plutôt en fin d’après-midi ?');
  await expect(received.locator('button[aria-pressed="true"]')).toHaveCount(1);
  await expect(received.getByRole('button', { name: /^Proposer un autre créneau/ })).toHaveAttribute('aria-expanded', 'true');
});

test('F-113 : onglet masqué, aucune relecture ; retour au premier plan, une relecture', async ({ page }) => {
  await signIn(page, LEA);
  await page.clock.install();
  await page.goto(`${ESPACE}/agenda`);
  await hydrated(page);

  let reads = 0;
  page.on('request', (request) => {
    if (isMeetingsRead(request.url(), request.method())) reads += 1;
  });
  await setVisibility(page, 'hidden');
  await page.clock.runFor(120_000);
  await page.waitForTimeout(500);
  expect(reads, 'relectures pendant que l’onglet est masqué').toBe(0);

  const back = page.waitForRequest((request) => isMeetingsRead(request.url(), request.method()));
  await setVisibility(page, 'visible');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await back;
});

test('critère 4, F-113 : la demande acceptée par Léa apparaît chez Inès en moins de 60 s, sans action de sa part', async ({ page, browser, baseURL }) => {
  await signIn(page, INES);
  await page.clock.install();
  await page.goto(`${ESPACE}/agenda`);
  await hydrated(page);

  const sent = page.getByRole('region', { name: 'Demandes envoyées' });
  await expect(sent).toContainText('Léa Ducasse');
  await expect(sent).toContainText('En attente de réponse');
  await expect(page.getByRole('region', { name: /^Mes rendez-vous/ })).not.toContainText('Léa Ducasse');

  // Léa accepte depuis son propre navigateur.
  const context = await browser.newContext({ baseURL, locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block', extraHTTPHeaders: {} });
  try {
    await context.addCookies(sessions.get(LEA) ?? []);
    const lea = await context.newPage();
    await lea.goto(`${ESPACE}/agenda`);
    await hydrated(lea);
    await lea.getByRole('region', { name: 'Demandes reçues' }).getByRole('button', { name: /^Accepter/ }).click();
    await expect(lea.getByRole('status').filter({ hasText: 'Rendez-vous confirmé' })).toBeVisible();
  } finally {
    await context.close();
  }

  // Inès ne fait rien : 60 s passent sur l'horloge de sa page.
  await page.clock.runFor(60_000);
  await expect(page.getByRole('region', { name: /^Mes rendez-vous/ })).toContainText('Léa Ducasse');
  await expect(page.getByRole('region', { name: 'Demandes envoyées' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: /^Mes rendez-vous/ }).getByText('Confirmé')).toBeVisible();
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// « Mes rendez-vous » : heure de fin, En cours, À venir, Passés (F-114)
// ---------------------------------------------------------------------------------------------------------------------------------------

test('F-114 : heure de fin affichée ; avant le jour J tout est « À venir »', async ({ page }) => {
  await openAgenda(page, LEA);
  const day = page.getByRole('region', { name: /^Mes rendez-vous/ });
  const mathis = day.getByRole('listitem').filter({ hasText: 'Mathis Lagrange' });
  await expect(mathis).toContainText('10h45');
  await expect(mathis).toContainText('à 11h00');
  await expect(day.getByRole('heading', { level: 3, name: 'À venir' })).toBeVisible();
  await expect(day.getByRole('heading', { level: 3, name: 'En cours' })).toHaveCount(0);
  await expect(day.getByRole('heading', { level: 3, name: 'Passés' })).toHaveCount(0);
});

test('F-114 : le jour J à 12h35, un rendez-vous passé, un en cours, un à venir, dans cet ordre', async ({ page }) => {
  await signIn(page, LEA);
  await page.clock.install();
  await page.goto(`${ESPACE}/agenda`);
  await hydrated(page);
  // Léa : 10h45 Mathis (jusqu’à 11h00), 12h30 Sylvadour (jusqu’à 12h45), 13h00 Inès (acceptée au test précédent).
  await page.clock.setSystemTime(new Date('2026-12-03T12:35:00+01:00'));
  const reread = page.waitForResponse((response) => isMeetingsRead(response.url(), response.request().method()));
  await page.clock.runFor(60_000);
  await reread;

  const day = page.getByRole('region', { name: /^Mes rendez-vous/ });
  const headings = day.getByRole('heading', { level: 3 });
  await expect(headings).toHaveText(['En cours', 'À venir', 'Passés']);
  const listAfter = (title: string) => day.getByRole('heading', { level: 3, name: title }).locator('xpath=following-sibling::ol[1]');
  await expect(listAfter('En cours')).toContainText('Sylvadour');
  await expect(listAfter('En cours')).toContainText('à 12h45');
  await expect(listAfter('À venir')).toContainText('Inès Castaing');
  await expect(listAfter('Passés')).toContainText('Mathis Lagrange');
  await expect(listAfter('Passés')).toContainText('à 11h00');
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// Fenêtre de demandes (F-111, critère 3)
// ---------------------------------------------------------------------------------------------------------------------------------------

test('critère 3, F-111 : fenêtre ouverte, « Trouver des interlocuteurs » et « Rencontrer » sont proposés', async ({ page }) => {
  await openHome(page, NATHAN);
  await expect(page.getByText('Aucun rendez-vous pour le moment.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Trouver des interlocuteurs' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ils partagent vos sujets' }).getByRole('link', { name: /Rencontrer/ }).first()).toBeVisible();
  await expect(page.getByText(/Les demandes (ouvrent|sont closes)/)).toHaveCount(0);
});

test('critère 3, F-111 : fenêtre fermée, aucune action de l’accueil ne mène à un formulaire de demande, et la fiche affiche la date de fermeture', async ({ page }) => {
  setWindow(SEED_OPEN_AT, '2026-11-10 08:00:00');
  await openHome(page, NATHAN);
  await expect(page.getByText('Les demandes sont closes depuis le mardi 10 novembre à 9h00.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Trouver des interlocuteurs' })).toHaveCount(0);
  const suggestions = page.getByRole('region', { name: 'Ils partagent vos sujets' });
  await expect(suggestions.getByRole('link', { name: /Rencontrer/ })).toHaveCount(0);
  const profile = suggestions.getByRole('link', { name: /Voir la fiche/ }).first();
  await expect(profile).toBeVisible();

  await profile.click();
  await hydrated(page);
  await expect(page.getByText('Les demandes sont closes depuis le mardi 10 novembre à 9h00.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Envoyer la demande|Choisissez un créneau/ })).toHaveCount(0);
  await expect(page.getByLabel(/Un mot pour présenter votre demande/)).toHaveCount(0);
});

test('F-111 : avant l’ouverture, « Les demandes ouvrent le … à … » sur l’accueil et sur la fiche', async ({ page }) => {
  setWindow('2026-11-25 08:00:00', SEED_CLOSE_AT);
  await openHome(page, NATHAN);
  await expect(page.getByText('Les demandes ouvrent le mercredi 25 novembre à 9h00.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Trouver des interlocuteurs' })).toHaveCount(0);
  const suggestions = page.getByRole('region', { name: 'Ils partagent vos sujets' });
  await expect(suggestions.getByRole('link', { name: /Rencontrer/ })).toHaveCount(0);

  await suggestions.getByRole('link', { name: /Voir la fiche/ }).first().click();
  await hydrated(page);
  await expect(page.getByText('Les demandes ouvrent le mercredi 25 novembre à 9h00.')).toBeVisible();
  await expect(page.getByLabel(/Un mot pour présenter votre demande/)).toHaveCount(0);
  setWindow(SEED_OPEN_AT, SEED_CLOSE_AT);
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// Demande de rendez-vous (F-115)
// ---------------------------------------------------------------------------------------------------------------------------------------

test('F-115 : sous le bouton inactif, la raison ; le compteur est relié au champ', async ({ page }) => {
  await openProfile(page, ALICE, 'Lagrange', /Mathis Lagrange/);
  const send = (time: string) => page.getByRole('button', { name: new RegExp(`^Envoyer la demande pour ${time}`) });
  const reason = page.locator('[id$="-raison"]');

  // Aucun créneau : le libellé du bouton est la raison.
  await expect(page.getByRole('button', { name: 'Choisissez un créneau' })).toBeDisabled();
  await expect(reason).toHaveCount(0);

  await slotButton(page, '13h30').click();
  await expect(send('13h30')).toBeDisabled();
  await expect(reason).toHaveText('Ajoutez un mot de présentation');
  await expect(send('13h30')).toHaveAccessibleDescription(/Ajoutez un mot de présentation/);

  const message = page.getByLabel(/Un mot pour présenter votre demande/);
  const counter = page.locator('[id$="-compteur"]');
  await expect(counter).toHaveText(/^0\/\d+$/);
  await message.fill('Bonjour');
  await expect(counter).toHaveText(/^7\/\d+$/);
  await expect(message).toHaveAccessibleDescription(/^7\/\d+$/);
  await expect(reason).toHaveCount(0);
  await expect(send('13h30')).toBeEnabled();

  await message.fill('   ');
  await expect(reason).toHaveText('Ajoutez un mot de présentation');
  await expect(send('13h30')).toBeDisabled();
});

test('F-115 : créneau pris entre-temps par une autre demande de la même personne, le message du serveur s’affiche tel quel ; le message envoyé figure dans « Demandes envoyées »', async ({ page, context }) => {
  await openProfile(page, ALICE, 'Lagrange', /Mathis Lagrange/);
  await slotButton(page, '13h30').click();
  await page.getByLabel(/Un mot pour présenter votre demande/).fill('Bonjour Mathis, une question sur vos panneaux.');

  // Dans un autre onglet, Alice demande le même créneau à Hugo.
  const other = await context.newPage();
  await other.goto(`${ESPACE}/annuaire`);
  await hydrated(other);
  await other.getByRole('searchbox', { name: /Rechercher un profil/ }).fill('Peyrat');
  await other.getByRole('link', { name: /Hugo Peyrat/ }).click();
  await hydrated(other);
  await slotButton(other, '13h30').click();
  await other.getByLabel(/Un mot pour présenter votre demande/).fill('Bonjour Hugo, un échange sur la forêt ?');
  await other.getByRole('button', { name: /^Envoyer la demande pour 13h30/ }).click();
  await expect(other.getByRole('status').filter({ hasText: 'Demande envoyée à Hugo' })).toBeVisible();
  await other.close();

  await page.getByRole('button', { name: /^Envoyer la demande pour 13h30/ }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Vous avez déjà un rendez-vous ou une demande en attente sur ce créneau.' });
  await expect(alert).toBeVisible();
  await expect(page.getByText('Ce créneau vient d’être pris')).toHaveCount(0);

  await page.goto(`${ESPACE}/agenda`);
  await hydrated(page);
  await expect(page.getByRole('region', { name: 'Demandes envoyées' })).toContainText('« Bonjour Hugo, un échange sur la forêt ? »');
});

test('F-115 : table dédiée réservée entre-temps par un autre, TARGET_BUSY garde « Ce créneau vient d’être pris, choisissez-en un autre. »', async ({ page, browser, baseURL }) => {
  await openProfile(page, EVA, 'Vergnes', /Antoine Vergnes/);
  await slotButton(page, '11h00').click();

  const context = await browser.newContext({ baseURL, locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block', extraHTTPHeaders: {} });
  try {
    const rival = await context.newPage();
    await signIn(rival, JULES);
    await rival.goto(`${ESPACE}/annuaire`);
    await hydrated(rival);
    await rival.getByRole('searchbox', { name: /Rechercher un profil/ }).fill('Vergnes');
    await rival.getByRole('link', { name: /Antoine Vergnes/ }).click();
    await hydrated(rival);
    await slotButton(rival, '11h00').click();
    await rival.getByRole('button', { name: 'Réserver 11h00' }).click();
    await expect(rival.getByRole('status').filter({ hasText: 'Réservation confirmée' })).toBeVisible();
  } finally {
    await context.close();
  }

  await page.getByRole('button', { name: 'Réserver 11h00' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Ce créneau vient d’être pris, choisissez-en un autre.' })).toBeVisible();
  await expect(slotButton(page, '11h00')).toHaveAttribute('aria-disabled', 'true');
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// Lecture des rendez-vous en échec (F-110, critère 2)
// ---------------------------------------------------------------------------------------------------------------------------------------

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

test('critère 2, F-110 : lecture des rendez-vous en échec, texte d’indisponibilité avec « Réessayer », jamais « Aucun rendez-vous »', async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, LEA);

  const webPort = Number(process.env.E2E_WEB_PORT ?? '4332');
  const outDir = `dist-e2e/${webPort}-meetings-ko`;
  const entry = path.resolve(process.cwd(), outDir, 'server/entry.mjs');
  const relayPort = await freePort();
  const frontPort = await freePort();
  let failing = true;
  let relay: Server | undefined;
  let front: ChildProcess | undefined;
  let logs = '';

  try {
    relay = createHttpServer(async (request, response) => {
      if (failing && request.method === 'GET' && request.url?.startsWith('/api/espace/meetings')) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { code: 'INTERNAL', message: 'Erreur simulée' } }));
        return;
      }
      try {
        const upstream = await fetch(`${STRAPI_URL}${request.url}`, { method: request.method, headers: { cookie: request.headers.cookie ?? '' } });
        response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
        response.end(Buffer.from(await upstream.arrayBuffer()));
      } catch {
        response.writeHead(502);
        response.end();
      }
    });
    await new Promise<void>((resolve) => relay!.listen(relayPort, '127.0.0.1', resolve));

    const relayUrl = `http://127.0.0.1:${relayPort}`;
    const build = spawnSync('node', ['./node_modules/astro/bin/astro.mjs', 'build', '--outDir', outDir], {
      env: { ...process.env, STRAPI_URL: relayUrl, REACT_STRAPI_URL: STRAPI_URL, PUBLIC_COOKIE_CONSENT: 'false', PUBLIC_MATOMO_URL: '', PUBLIC_MATOMO_SITE_ID: '' },
      encoding: 'utf8',
    });
    expect(build.status, `build du front à lecture en échec : ${build.stderr}`).toBe(0);
    expect(existsSync(entry), `build absent : ${entry}`).toBe(true);
    front = spawn('node', [entry], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(frontPort), STRAPI_URL: relayUrl, REACT_STRAPI_URL: STRAPI_URL, PUBLIC_COOKIE_CONSENT: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    front.stdout?.on('data', (chunk) => (logs += chunk));
    front.stderr?.on('data', (chunk) => (logs += chunk));
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        await fetch(`http://127.0.0.1:${frontPort}/espace/introuvable`);
        break;
      } catch {
        if (Date.now() > deadline) throw new Error(`front à lecture en échec non démarré : ${logs}`);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    await page.goto(`http://127.0.0.1:${frontPort}${ESPACE}/`);
    const card = page.getByRole('region', { name: 'Prochain rendez-vous' });
    await expect(card).toContainText('Vos rendez-vous sont momentanément indisponibles.');
    await expect(page.getByText('Aucun rendez-vous pour le moment.')).toHaveCount(0);
    await expect(card).not.toContainText('Mathis Lagrange');
    const retry = card.getByRole('link', { name: 'Réessayer' });
    await expect(retry).toBeVisible();

    failing = false;
    await retry.click();
    await expect(page.getByRole('region', { name: 'Prochain rendez-vous' })).toContainText('Mathis Lagrange');
    await expect(page.getByText('Vos rendez-vous sont momentanément indisponibles.')).toHaveCount(0);
  } finally {
    front?.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await new Promise<void>((resolve) => (relay ? relay.close(() => resolve()) : resolve()));
  }
});
