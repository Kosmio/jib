'use strict';

/**
 * Relances, lot V3-A (docs/espace/specs/14-lots-finalisation.md) : R-70, R-71, R-72, R-87, R-17, I-39, T-33, T-34.
 * Livré et actif.
 *
 * Service `api::espace.reminders` : preview, send (409 OUTSIDE_SENDING_HOURS), runDue (tâche `espaceReminders`, toutes les 15 min), unsubscribe.
 * Routes (organisateur de l'édition, 403 sinon) :
 *   POST /api/espace/admin/:edition/reminders/preview  { scenario } -> { recipients, skipped: { alreadySent, optedOut }, sampleHtml }
 *   POST /api/espace/admin/:edition/reminders/send     { scenario } -> { sent, skipped, failed } ou 409 OUTSIDE_SENDING_HOURS
 *   GET  /api/espace/reminders/unsubscribe?token=      page sans effet (les analyseurs de liens l'ouvrent)
 *   POST /api/espace/reminders/unsubscribe?token=      coupe `reminders` (formulaire de la page, ou un clic RFC 8058)
 *
 * Critères d'acceptation : 1 (T-33 : deux exécutions de la tâche et un envoi manuel, un seul e-mail), 2 (T-34 : rien entre 20h00 et 8h00,
 * rattrapage à l'exécution suivante), 3 (J-6 9h30 : a et b), 4 (la veille 16h00 : reminder-eve), 5 (lien de désabonnement sans connexion,
 * propre à son destinataire). Le critère 6 est dans unit/conventions.test.js.
 *
 * Heure : le service prend `now` en paramètre (appel direct). Les routes lisent l'horloge du processus : le test fige `Date` (mock.timers)
 * le temps d'une requête, le lendemain de l'exécution (les sessions restent valables). Édition du 3 décembre 2026 : J-6 = 27 novembre,
 * 9h30 Paris = 08:30 UTC ; la veille 16h00 = 2 décembre 15:00 UTC. Un échec d'envoi est provoqué en remplaçant le fichier de la boîte de
 * sortie par un dossier. Chaque test a sa propre édition, fermée à la fin : la tâche parcourt toutes les éditions ouvertes.
 */

const { afterEach, describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { sleep, useEspace } = require('../helpers/espace');
const { UID, createAttendee } = require('../helpers/espace-data');
const { createMeetingEdition, seedMeeting } = require('../helpers/meetings-world');

const EM_DASH = String.fromCharCode(0x2014);
const NOW_J6 = new Date('2026-11-27T08:30:00Z'); // J-6 9h30, Paris
const EVE_16H = new Date('2026-12-02T15:00:00Z'); // la veille 16h00, Paris
const at = (value) => new Date(value);

/** Instant du lendemain dont l'heure de Paris vaut `hour` h `minute` (hiver ou été). */
function parisInstant(hour, minute = 0, dayOffset = 1) {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + dayOffset);
  const parisHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' });
  for (let utc = 0; utc < 24; utc += 1) {
    const candidate = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), utc, minute));
    if (Number(parisHour.format(candidate)) === hour) return candidate;
  }
  throw new Error(`Aucune heure de Paris ${hour}h`);
}

async function frozenAt(instant, action) {
  mock.timers.enable({ apis: ['Date'], now: instant });
  try {
    return await action();
  } finally {
    mock.timers.reset();
  }
}

async function withBrokenOutbox(espace, action) {
  const { outboxFile } = espace();
  fs.rmSync(outboxFile, { force: true });
  fs.mkdirSync(outboxFile, { recursive: true });
  try {
    return await action();
  } finally {
    fs.rmSync(outboxFile, { recursive: true, force: true });
  }
}

describe('relances : calendrier, idempotence, plage horaire, désabonnement (V3-A : R-70 à R-72, R-87, I-39, T-33, T-34)', { timeout: 900_000 }, () => {
  const espace = useEspace();
  const created = [];
  let counter = 0;

  // La tâche parcourt toutes les éditions ouvertes : celles des tests précédents sont fermées (même lignes publiée et brouillon).
  afterEach(async () => {
    for (const edition of created.splice(0)) await espace().query(UID.edition).updateMany({ where: { documentId: edition.documentId }, data: { participantSpaceEnabled: false } });
  });

  const reminders = () => espace().app.service('api::espace.reminders');
  const route = (edition, name) => `/api/espace/admin/${edition.slug}/reminders/${name}`;
  const post = (edition, name, cookie, json) => espace().request(route(edition, name), { method: 'POST', cookie, json });
  const mails = (since, people) => espace().mailsSince(since, { settleMs: 50, to: people.map(({ email }) => email) });
  const logsOf = (edition, template) =>
    espace().query(UID.emailLog).findMany({ where: { template, attendee: { edition: { documentId: edition.documentId } } }, populate: ['attendee'] });
  const emailsOf = (logs) => logs.map((log) => log.attendee.email).sort();
  const emails = (people) => people.map(({ email }) => email).sort();
  const refreshed = (attendee) => espace().app.documents(UID.attendee).findOne({ documentId: attendee.documentId });

  /** Édition du 3 décembre 2026 avec son programme et ses créneaux. */
  async function newEdition(settings = {}) {
    counter += 1;
    const { edition, slotList } = await createMeetingEdition(espace().app, { slug: `relances-${counter}`, title: `Relances ${counter}`, settings: { date: '2026-12-03', ...settings } });
    created.push(edition);
    return { edition, slots: slotList };
  }

  let personCounter = 0;
  const person = (edition, fields = {}) => {
    personCounter += 1;
    return createAttendee(espace().app, edition, {
      firstName: `Prénom${personCounter}`,
      lastName: `Famille${personCounter}`,
      consentAt: new Date().toISOString(),
      activatedAt: '2026-11-18T10:00:00.000Z',
      ...fields,
    });
  };
  const organizerOf = async (edition) => {
    const attendee = await person(edition, { role: 'organizer' });
    return { attendee, ...(await espace().signIn(edition.slug, attendee.email)) };
  };
  const meeting = (edition, slot, requester, target, status, location) => seedMeeting(espace().app, { edition, slot, requester, target, status, location });

  /**
   * Monde du critère 3. Profil à 55 % sans présentation (a), à 70 % avec ; `busy` a une demande en attente avec `partner`.
   * a (activés, moins de 70 %) : low, busy. b (activés, sans rendez-vous) : low, high. `refuse` est concerné par a et b mais refuse.
   */
  async function population(edition, slots) {
    const low = await person(edition, {});
    const high = await person(edition, { bio: 'Présentation' });
    const busy = await person(edition, {});
    const partner = await person(edition, { bio: 'Présentation' });
    const refuse = await person(edition, { emailPrefs: { meetingRequests: true, messages: true, reminders: false } });
    const fresh = await person(edition, { activatedAt: null });
    const cancelled = await person(edition, { status: 'cancelled' });
    const organizer = await person(edition, { role: 'organizer' });
    await meeting(edition, slots[0], busy, partner, 'pending');
    return { low, high, busy, partner, refuse, fresh, cancelled, organizer, everybody: [low, high, busy, partner, refuse, fresh, cancelled, organizer] };
  }

  describe('critère 3 (R-87) : horloge fixée à J-6 9h30, a part aux actifs sous 70 % et b aux actifs sans rendez-vous, hors refus', () => {
    it('la tâche envoie a et b aux bons destinataires, sous la clé `<scénario>:2026-11-27`', async () => {
      const { edition, slots } = await newEdition();
      const world = await population(edition, slots);
      const since = espace().outbox().length;
      const result = await reminders().runDue({ now: NOW_J6 });
      assert.deepEqual(result, { sent: 4, failed: 0 });

      const profile = await logsOf(edition, 'reminder-profile');
      const noMeeting = await logsOf(edition, 'reminder-no-meeting');
      assert.deepEqual(emailsOf(profile), emails([world.low, world.busy]));
      assert.deepEqual(emailsOf(noMeeting), emails([world.low, world.high]));
      for (const log of [...profile, ...noMeeting]) {
        assert.equal(log.status, 'sent');
        assert.match(log.scenarioKey, /^(profile|no-meeting):2026-11-27$/);
      }
      assert.deepEqual(await logsOf(edition, 'reminder-eve'), []);
      assert.equal((await mails(since, world.everybody)).length, 4);
    });

    it('rien avant 9h30, rien pour une édition fermée (NF-52)', async () => {
      const { edition, slots } = await newEdition();
      await population(edition, slots);
      const since = espace().outbox().length;
      assert.deepEqual(await reminders().runDue({ now: at('2026-11-27T08:29:00Z') }), { sent: 0, failed: 0 });
      await espace().query(UID.edition).updateMany({ where: { documentId: edition.documentId }, data: { participantSpaceEnabled: false } });
      assert.deepEqual(await reminders().runDue({ now: NOW_J6 }), { sent: 0, failed: 0 });
      await sleep(100);
      assert.equal(espace().outbox().length, since, 'aucun e-mail');
      assert.deepEqual(await logsOf(edition, 'reminder-profile'), []);
    });

    it('chaque e-mail porte les en-têtes List-Unsubscribe et List-Unsubscribe-Post vers le lien d’action (I-39)', async () => {
      const { edition, slots } = await newEdition();
      const world = await population(edition, slots);
      const since = espace().outbox().length;
      await reminders().runDue({ now: NOW_J6 });
      const sent = await mails(since, world.everybody);
      assert.equal(sent.length, 4);
      for (const mail of sent) {
        assert.match(mail.headers['List-Unsubscribe'], /^<https?:\/\/[^>]+\/api\/espace\/reminders\/unsubscribe\?token=[^>\s]+>$/);
        assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
        assert.ok(!mail.subject.includes(EM_DASH) && !mail.html.includes(EM_DASH) && !mail.text.includes(EM_DASH));
        assert.match(mail.text, /Gérer mes notifications/);
      }
    });

    it('le lien de désabonnement est celui du destinataire : un jeton par personne', async () => {
      const { edition, slots } = await newEdition();
      const world = await population(edition, slots);
      const since = espace().outbox().length;
      await reminders().runDue({ now: NOW_J6 });
      const sent = await mails(since, [world.low, world.high]);
      const tokenOf = (mail) => new URL(mail.headers['List-Unsubscribe'].slice(1, -1)).searchParams.get('token');
      const lows = sent.filter((mail) => mail.to.email === world.low.email).map(tokenOf);
      assert.equal(lows.length, 2, 'low reçoit a et b');
      assert.equal(lows[0], lows[1], 'un seul jeton par personne');
      assert.ok(lows[0].startsWith(`${world.low.documentId}.`));
      assert.ok(tokenOf(sent.find((mail) => mail.to.email === world.high.email)).startsWith(`${world.high.documentId}.`));
    });
  });

  describe('critère 1 (T-33, R-71) : deux exécutions de la tâche et un envoi manuel le même jour, un seul e-mail par destinataire et par scénario', () => {
    it('tâche, tâche, envoi manuel de b et de a : un EmailLog et un e-mail par destinataire et par scénario', async () => {
      const { edition, slots } = await newEdition();
      const world = await population(edition, slots);
      const since = espace().outbox().length;
      assert.equal((await reminders().runDue({ now: NOW_J6 })).sent, 4);
      assert.deepEqual(await reminders().runDue({ now: at('2026-11-27T08:45:00Z') }), { sent: 0, failed: 0 });
      const noMeeting = await reminders().send(edition, 'no-meeting', { now: at('2026-11-27T09:00:00Z') });
      const profile = await reminders().send(edition, 'profile', { now: at('2026-11-27T09:00:00Z') });
      assert.deepEqual(noMeeting, { sent: 0, skipped: 3, failed: 0 }, 'low et high déjà relancés, refuse exclu');
      assert.deepEqual(profile, { sent: 0, skipped: 3, failed: 0 }, 'low et busy déjà relancés, refuse exclu');

      assert.equal((await logsOf(edition, 'reminder-profile')).length, 2);
      assert.equal((await logsOf(edition, 'reminder-no-meeting')).length, 2);
      assert.equal((await mails(since, world.everybody)).length, 4);
    });

    it('envoi manuel d’abord, puis la tâche le même jour : pas de doublon', async () => {
      const { edition, slots } = await newEdition();
      const world = await population(edition, slots);
      const since = espace().outbox().length;
      const manual = await reminders().send(edition, 'no-meeting', { now: at('2026-11-27T08:00:00Z') });
      assert.deepEqual(manual, { sent: 2, skipped: 1, failed: 0 });
      await reminders().runDue({ now: NOW_J6 });
      assert.equal((await logsOf(edition, 'reminder-no-meeting')).length, 2);
      const sent = await mails(since, [world.low, world.high]);
      assert.equal(sent.filter((mail) => /prenez rendez-vous/.test(mail.subject)).length, 2);
    });

    it('un envoi manuel hors calendrier prend la date du jour pour clé et ne gêne pas l’envoi planifié', async () => {
      const { edition, slots } = await newEdition();
      await population(edition, slots);
      const manual = await reminders().send(edition, 'no-meeting', { now: at('2026-11-23T10:00:00Z') });
      assert.equal(manual.sent, 2);
      assert.deepEqual(new Set((await logsOf(edition, 'reminder-no-meeting')).map(({ scenarioKey }) => scenarioKey)), new Set(['no-meeting:2026-11-23']));
      const planned = await reminders().runDue({ now: NOW_J6 });
      assert.equal(planned.sent, 4, 'a (2) et b (2) partent à J-6, la clé du 23 n’est pas celle du 27');
    });

    it('un second envoi manuel le même jour par la route rend sent 0 et le nombre de déjà relancés', async () => {
      const { edition, slots } = await newEdition();
      await population(edition, slots);
      const organizer = await organizerOf(edition);
      const first = await frozenAt(parisInstant(14), () => post(edition, 'send', organizer.cookie, { scenario: 'no-meeting' }));
      assert.deepEqual(first.json, { sent: 2, skipped: 1, failed: 0 });
      const second = await frozenAt(parisInstant(15), () => post(edition, 'send', organizer.cookie, { scenario: 'no-meeting' }));
      assert.deepEqual(second.json, { sent: 0, skipped: 3, failed: 0 });
      const preview = await frozenAt(parisInstant(16), () => post(edition, 'preview', organizer.cookie, { scenario: 'no-meeting' }));
      assert.deepEqual(preview.json.skipped, { alreadySent: 2, optedOut: 1 });
      assert.equal(preview.json.recipients, 0);
    });
  });

  describe('critère 2 (T-34, R-72) : rien entre 20h00 et 8h00 heure de Paris, le dû part à l’exécution suivante dans la plage', () => {
    it('à 20h00, 21h00 et 7h59 la tâche ne fait rien ; à 8h00 elle envoie ce qui était dû à 9h30 la veille, une seule fois', async () => {
      const { edition, slots } = await newEdition();
      const world = await population(edition, slots);
      const since = espace().outbox().length;
      for (const instant of ['2026-11-27T19:00:00Z', '2026-11-27T20:00:00Z', '2026-11-27T23:45:00Z', '2026-11-28T06:59:00Z']) {
        assert.deepEqual(await reminders().runDue({ now: at(instant) }), { sent: 0, failed: 0 }, instant);
      }
      assert.deepEqual((await mails(since, world.everybody)).length, 0);
      assert.deepEqual(await logsOf(edition, 'reminder-no-meeting'), []);

      assert.deepEqual(await reminders().runDue({ now: at('2026-11-28T07:00:00Z') }), { sent: 4, failed: 0 });
      assert.deepEqual(await reminders().runDue({ now: at('2026-11-28T07:15:00Z') }), { sent: 0, failed: 0 });
      assert.equal((await logsOf(edition, 'reminder-no-meeting')).length, 2);
      assert.ok((await logsOf(edition, 'reminder-no-meeting')).every(({ scenarioKey }) => scenarioKey === 'no-meeting:2026-11-27'));
    });

    it('un envoi dû depuis plus de 24 h est abandonné (restart tardif)', async () => {
      const { edition, slots } = await newEdition();
      await population(edition, slots);
      assert.deepEqual(await reminders().runDue({ now: at('2026-11-28T09:00:00Z') }), { sent: 0, failed: 0 });
      assert.deepEqual(await logsOf(edition, 'reminder-no-meeting'), []);
    });

    it('l’envoi manuel par la route : 409 OUTSIDE_SENDING_HOURS à 7h59, 20h00 et 22h00, rien d’envoyé ; 8h00 passe', async () => {
      const { edition, slots } = await newEdition();
      const world = await population(edition, slots);
      const organizer = await organizerOf(edition);
      const since = espace().outbox().length;
      for (const [hour, minute] of [[22, 0], [7, 59], [20, 0]]) {
        const response = await frozenAt(parisInstant(hour, minute), () => post(edition, 'send', organizer.cookie, { scenario: 'no-meeting' }));
        assert.equal(response.status, 409, `${hour}h${minute}`);
        assert.equal(response.json.error.code, 'OUTSIDE_SENDING_HOURS');
      }
      assert.equal((await mails(since, world.everybody)).length, 0);
      const open = await frozenAt(parisInstant(8, 0), () => post(edition, 'send', organizer.cookie, { scenario: 'no-meeting' }));
      assert.equal(open.status, 200);
      assert.equal(open.json.sent, 2);
    });

    it('l’aperçu reste possible hors plage horaire et n’envoie rien', async () => {
      const { edition, slots } = await newEdition();
      const world = await population(edition, slots);
      const organizer = await organizerOf(edition);
      const since = espace().outbox().length;
      const response = await frozenAt(parisInstant(22, 0), () => post(edition, 'preview', organizer.cookie, { scenario: 'no-meeting' }));
      assert.equal(response.status, 200);
      assert.equal((await mails(since, world.everybody)).length, 0);
    });
  });

  describe('critère 4 (R-70 c, R-17) : la veille à 16h00, chaque actif concerné reçoit reminder-eve avec ses rendez-vous du lendemain et ses demandes expirées', () => {
    async function eveWorld() {
      const { edition, slots } = await newEdition();
      const [s0, s1, s2] = slots;
      const alice = await person(edition, { firstName: 'Alice', lastName: 'Aubry' });
      const bruno = await person(edition, { firstName: 'Bruno', lastName: 'Bernard' });
      const claire = await person(edition, { firstName: 'Claire', lastName: 'Cazaux' });
      const didier = await person(edition, { firstName: 'Didier', lastName: 'Dupin' });
      const eva = await person(edition, { emailPrefs: { meetingRequests: true, messages: true, reminders: false } });
      const fanny = await person(edition, { emailPrefs: { meetingRequests: true, messages: true, reminders: false } });
      const gilles = await person(edition, {});
      const hugo = await person(edition, { activatedAt: null });
      const cancelled = await person(edition, { status: 'cancelled' });
      const organizer = await person(edition, { role: 'organizer' });
      await meeting(edition, s0, alice, bruno, 'accepted', 'Table 3');
      await meeting(edition, s1, alice, claire, 'expired');
      await meeting(edition, s2, fanny, gilles, 'accepted', 'Table 2');
      return { edition, slots, alice, bruno, claire, didier, eva, fanny, gilles, hugo, cancelled, organizer, concerned: [alice, bruno, claire, didier, fanny, gilles, hugo], everybody: [alice, bruno, claire, didier, eva, fanny, gilles, hugo, cancelled, organizer] };
    }

    it('reçoivent la veille : acceptés, expirés, sans rendez-vous, non activés, refus avec rendez-vous accepté ; pas : refus sans rendez-vous, annulé, organisateur', async () => {
      const world = await eveWorld();
      const since = espace().outbox().length;
      const result = await reminders().runDue({ now: EVE_16H });
      assert.deepEqual(result, { sent: 7, failed: 0 });
      const logs = await logsOf(world.edition, 'reminder-eve');
      assert.deepEqual(emailsOf(logs), emails(world.concerned));
      assert.ok(logs.every(({ scenarioKey, status }) => scenarioKey === 'eve:2026-12-02' && status === 'sent'));
      assert.equal((await mails(since, world.everybody)).length, 7);
    });

    it('l’e-mail d’Alice : heure, interlocuteur, table, demande expirée, lieu, .ics joint et en-têtes de désabonnement', async () => {
      const world = await eveWorld();
      const since = espace().outbox().length;
      await reminders().runDue({ now: EVE_16H });
      const [mail] = await mails(since, [world.alice]);
      const [first, second] = world.slots;
      assert.match(mail.subject, /^Prénom\d+, votre rendez-vous du jeudi 3 décembre$|^Alice, votre rendez-vous du jeudi 3 décembre$/);
      assert.ok(mail.text.includes(`${first.label}`), 'heure du rendez-vous accepté');
      assert.ok(mail.text.includes('Bruno Bernard, Table 3'));
      assert.match(mail.text, /n’ont pas reçu de réponse/);
      assert.ok(mail.text.includes(`${second.label}`) && mail.text.includes('Claire Cazaux'), 'demande expirée');
      assert.match(mail.text, /Lieu/);
      assert.equal(mail.attachments.length, 1);
      assert.equal(mail.attachments[0].filename, 'rendez-vous.ics');
      const ics = Buffer.from(mail.attachments[0].content, 'base64').toString('utf8');
      assert.match(ics, /BEGIN:VCALENDAR/);
      assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 1, 'seuls les rendez-vous acceptés sont dans le .ics');
      assert.match(mail.headers['List-Unsubscribe'], /reminders\/unsubscribe\?token=/);
      assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
      assert.ok(!mail.html.includes(EM_DASH) && !mail.text.includes(EM_DASH));
    });

    it('l’interlocuteur voit le rendez-vous avec le nom du demandeur ; la demande expirée vue de la cible', async () => {
      const world = await eveWorld();
      const since = espace().outbox().length;
      await reminders().runDue({ now: EVE_16H });
      const [bruno] = await mails(since, [world.bruno]);
      assert.ok(bruno.text.includes('Alice Aubry, Table 3'));
      assert.equal(bruno.attachments.length, 1);
      const [claire] = await mails(since, [world.claire]);
      assert.match(claire.text, /n’ont pas reçu de réponse/);
      assert.ok(claire.text.includes('Alice Aubry'));
      assert.equal(claire.attachments.length, 0, 'aucun rendez-vous accepté : pas de .ics');
    });

    it('sans rendez-vous : la forme courte part quand même, sans .ics', async () => {
      const world = await eveWorld();
      const since = espace().outbox().length;
      await reminders().runDue({ now: EVE_16H });
      const [mail] = await mails(since, [world.didier]);
      assert.match(mail.subject, /les Journées, c’est le jeudi 3 décembre/);
      assert.match(mail.text, /pas de rendez-vous prévu/);
      assert.equal(mail.attachments.length, 0);
    });

    it('rattrapage jusqu’à 9h00 le jour J, jamais après ; jamais deux fois', async () => {
      const world = await eveWorld();
      assert.deepEqual(await reminders().runDue({ now: at('2026-12-02T14:59:00Z') }), { sent: 0, failed: 0 });
      assert.deepEqual(await reminders().runDue({ now: at('2026-12-03T08:00:00Z') }), { sent: 0, failed: 0 }, '9h00 le jour J : plus dû');
      assert.equal((await logsOf(world.edition, 'reminder-eve')).length, 0);
      assert.equal((await reminders().runDue({ now: at('2026-12-03T07:30:00Z') })).sent, 7, '8h30 le jour J : rattrapé');
      assert.deepEqual(await reminders().runDue({ now: EVE_16H }), { sent: 0, failed: 0 });
    });

    it('la veille n’est pas envoyée par la tâche entre 20h00 et 8h00 (21h00 la veille : rien)', async () => {
      const world = await eveWorld();
      assert.deepEqual(await reminders().runDue({ now: at('2026-12-02T20:00:00Z') }), { sent: 0, failed: 0 });
      assert.equal((await logsOf(world.edition, 'reminder-eve')).length, 0);
    });

    it('le désabonné sans rendez-vous accepté est exclu, avec un rendez-vous accepté il reçoit la veille', async () => {
      const world = await eveWorld();
      const preview = await reminders().preview(world.edition, 'eve', { now: EVE_16H });
      assert.equal(preview.recipients, 7);
      assert.deepEqual(preview.skipped, { alreadySent: 0, optedOut: 1 });
    });
  });

  describe('rappel welcome (R-85, R-87) : les non activés, jamais avant welcomeStartedAt', () => {
    it('sans welcomeStartedAt : rien, ni par la tâche ni en manuel', async () => {
      const { edition } = await newEdition();
      const fresh = await person(edition, { activatedAt: null });
      const since = espace().outbox().length;
      assert.deepEqual(await reminders().runDue({ now: NOW_J6 }), { sent: 0, failed: 0 });
      assert.deepEqual(await reminders().send(edition, 'welcome', { now: NOW_J6 }), { sent: 0, skipped: 0, failed: 0 });
      assert.equal((await mails(since, [fresh])).length, 0);
    });

    it('après welcomeStartedAt : à J-6 le non activé reçoit `welcome` sous la clé `welcome:2026-11-27`, avec lien de connexion et en-têtes', async () => {
      const { edition } = await newEdition({ welcomeStartedAt: '2026-11-20T10:00:00.000Z' });
      const fresh = await person(edition, { activatedAt: null });
      const active = await person(edition, { bio: 'Présentation' });
      const refuse = await person(edition, { activatedAt: null, emailPrefs: { meetingRequests: true, messages: true, reminders: false } });
      const since = espace().outbox().length;
      await reminders().runDue({ now: NOW_J6 });
      const logs = await logsOf(edition, 'welcome');
      assert.deepEqual(emailsOf(logs), emails([fresh]));
      assert.equal(logs[0].scenarioKey, 'welcome:2026-11-27');
      const [mail] = await mails(since, [fresh]);
      assert.match(mail.text, /\/espace\/verifier\?token=/);
      assert.match(mail.headers['List-Unsubscribe'], /reminders\/unsubscribe\?token=/);
      assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
      assert.equal((await mails(since, [refuse])).length, 0, 'reminders=false exclut aussi le rappel welcome');
      assert.equal((await mails(since, [active])).filter((candidate) => /\/espace\/verifier/.test(candidate.text) && /Bienvenue|bienvenue/.test(candidate.subject)).length, 0);
    });

    it('un second passage de la tâche et un envoi manuel le même jour ne renvoient rien (T-33)', async () => {
      const { edition } = await newEdition({ welcomeStartedAt: '2026-11-20T10:00:00.000Z' });
      await person(edition, { activatedAt: null });
      assert.equal((await reminders().runDue({ now: NOW_J6 })).sent, 1);
      assert.deepEqual(await reminders().runDue({ now: at('2026-11-27T09:00:00Z') }), { sent: 0, failed: 0 });
      assert.deepEqual(await reminders().send(edition, 'welcome', { now: at('2026-11-27T10:00:00Z') }), { sent: 0, skipped: 1, failed: 0 });
    });
  });

  describe('échecs : au plus trois essais par clé et destinataire (R-85, NF-62)', () => {
    it('trois échecs consécutifs, puis plus de nouvel essai quand la boîte de sortie répond de nouveau', async () => {
      const { edition } = await newEdition();
      const low = await person(edition, {});
      const logs = () => logsOf(edition, 'reminder-no-meeting');
      await withBrokenOutbox(espace, async () => {
        assert.deepEqual(await reminders().runDue({ now: NOW_J6 }), { sent: 0, failed: 2 }, 'a et b échouent');
        assert.deepEqual(await reminders().runDue({ now: at('2026-11-27T08:45:00Z') }), { sent: 0, failed: 2 });
        assert.deepEqual(await reminders().runDue({ now: at('2026-11-27T09:00:00Z') }), { sent: 0, failed: 2 });
      });
      const failed = await logs();
      assert.equal(failed.length, 3);
      assert.ok(failed.every(({ status, scenarioKey, error }) => status === 'failed' && scenarioKey === 'no-meeting:2026-11-27' && error));

      const since = espace().outbox().length;
      assert.deepEqual(await reminders().runDue({ now: at('2026-11-27T09:15:00Z') }), { sent: 0, failed: 0 });
      assert.equal((await mails(since, [low])).length, 0);
      assert.equal((await logs()).length, 3, 'aucun quatrième essai');
    });

    it('un échec isolé est retenté à l’exécution suivante, puis journalisé « sent »', async () => {
      const { edition } = await newEdition();
      const low = await person(edition, {});
      await withBrokenOutbox(espace, async () => {
        assert.deepEqual(await reminders().runDue({ now: NOW_J6 }), { sent: 0, failed: 2 });
      });
      const since = espace().outbox().length;
      assert.deepEqual(await reminders().runDue({ now: at('2026-11-27T08:45:00Z') }), { sent: 2, failed: 0 });
      assert.equal((await mails(since, [low])).length, 2);
      const statuses = (await logsOf(edition, 'reminder-no-meeting')).map(({ status }) => status).sort();
      assert.deepEqual(statuses, ['failed', 'sent']);
    });

    it('un échec en envoi manuel est compté dans `failed`, sans lever', async () => {
      const { edition } = await newEdition();
      await person(edition, {});
      const result = await withBrokenOutbox(espace, () => reminders().send(edition, 'no-meeting', { now: at('2026-11-23T10:00:00Z') }));
      assert.deepEqual(result, { sent: 0, skipped: 0, failed: 1 });
    });
  });

  describe('routes preview et send : contrat figé pour V3-B (F-92)', () => {
    it('preview rend exactement { recipients, skipped: { alreadySent, optedOut }, sampleHtml } et n’envoie rien', async () => {
      const { edition, slots } = await newEdition();
      const world = await population(edition, slots);
      const organizer = await organizerOf(edition);
      const since = espace().outbox().length;
      const response = await post(edition, 'preview', organizer.cookie, { scenario: 'profile' });
      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(response.json).sort(), ['recipients', 'sampleHtml', 'skipped']);
      assert.deepEqual(Object.keys(response.json.skipped).sort(), ['alreadySent', 'optedOut']);
      assert.equal(response.json.recipients, 2);
      assert.deepEqual(response.json.skipped, { alreadySent: 0, optedOut: 1 });
      assert.equal(typeof response.json.sampleHtml, 'string');
      assert.match(response.json.sampleHtml, /<html/);
      assert.ok(!response.json.sampleHtml.includes(EM_DASH));
      assert.equal((await mails(since, world.everybody)).length, 0, 'aucun envoi');
      assert.deepEqual(await logsOf(edition, 'reminder-profile'), [], 'aucun EmailLog');
    });

    it('preview : un aperçu pour chaque scénario, avec des données fictives', async () => {
      const { edition } = await newEdition();
      const organizer = await organizerOf(edition);
      for (const scenario of ['profile', 'no-meeting', 'eve', 'welcome']) {
        const response = await post(edition, 'preview', organizer.cookie, { scenario });
        assert.equal(response.status, 200, scenario);
        assert.ok(response.json.sampleHtml.length > 500, scenario);
        assert.match(response.json.sampleHtml, /Camille/, scenario);
      }
    });

    it('preview compte exactement ce que send enverra, puis send rend { sent, skipped, failed }', async () => {
      const { edition, slots } = await newEdition();
      const world = await population(edition, slots);
      const organizer = await organizerOf(edition);
      const since = espace().outbox().length;
      const preview = await post(edition, 'preview', organizer.cookie, { scenario: 'no-meeting' });
      const sent = await frozenAt(parisInstant(14), () => post(edition, 'send', organizer.cookie, { scenario: 'no-meeting' }));
      assert.equal(sent.status, 200, sent.text);
      assert.deepEqual(Object.keys(sent.json).sort(), ['failed', 'sent', 'skipped']);
      assert.equal(sent.json.sent, preview.json.recipients);
      assert.equal(sent.json.skipped, preview.json.skipped.alreadySent + preview.json.skipped.optedOut);
      assert.equal(sent.json.failed, 0);
      assert.deepEqual(emailsOf(await logsOf(edition, 'reminder-no-meeting')), emails([world.low, world.high]));
      assert.equal((await mails(since, world.everybody)).filter((mail) => /prenez rendez-vous/.test(mail.subject)).length, 2);
    });

    it('un scénario inconnu ou absent : 400 VALIDATION, rien d’envoyé', async () => {
      const { edition } = await newEdition();
      const organizer = await organizerOf(edition);
      for (const name of ['preview', 'send']) {
        for (const scenario of ['inconnu', undefined, 42]) {
          const response = await frozenAt(parisInstant(14), () => post(edition, name, organizer.cookie, scenario === undefined ? {} : { scenario }));
          assert.equal(response.status, 400, `${name} ${scenario}`);
          assert.equal(response.json.error.code, 'VALIDATION');
        }
      }
    });

    it('403 FORBIDDEN pour un participant, 401 sans session, 403 pour l’organisateur d’une autre édition', async () => {
      const { edition } = await newEdition();
      const other = (await newEdition()).edition;
      const participant = await person(edition, { role: 'participant' });
      const { cookie } = await espace().signIn(edition.slug, participant.email);
      const stranger = await organizerOf(other);
      const since = espace().outbox().length;
      for (const name of ['preview', 'send']) {
        const denied = await frozenAt(parisInstant(14), () => post(edition, name, cookie, { scenario: 'no-meeting' }));
        assert.equal(denied.status, 403, name);
        assert.equal(denied.json.error.code, 'FORBIDDEN');
        assert.equal((await post(edition, name, undefined, { scenario: 'no-meeting' })).status, 401, name);
        assert.equal((await post(edition, name, stranger.cookie, { scenario: 'no-meeting' })).status, 403, name);
      }
      assert.equal((await mails(since, [participant])).filter((mail) => /prenez rendez-vous/.test(mail.subject)).length, 0);
    });

    it('un organisateur n’est jamais destinataire', async () => {
      const { edition } = await newEdition();
      const organizer = await organizerOf(edition);
      const preview = await post(edition, 'preview', organizer.cookie, { scenario: 'eve' });
      assert.equal(preview.json.recipients, 0);
    });
  });

  describe('critère 5 (I-39) : le lien de désabonnement coupe `reminders` sans connexion et ne vaut que pour son destinataire', () => {
    const PREFS = { meetingRequests: true, messages: true, reminders: true };
    const urlOf = (mail) => new URL(mail.headers['List-Unsubscribe'].slice(1, -1));
    const pathOf = (url) => `${url.pathname}${url.search}`;

    /** Deux destinataires, A et B, et le lien de A lu dans son e-mail. */
    async function pair() {
      const { edition } = await newEdition();
      const a = await person(edition, { emailPrefs: PREFS });
      const b = await person(edition, { emailPrefs: PREFS });
      const since = espace().outbox().length;
      await reminders().send(edition, 'no-meeting', { now: at('2026-11-23T10:00:00Z') });
      const [mailA] = (await mails(since, [a])).filter((mail) => /prenez rendez-vous/.test(mail.subject));
      const [mailB] = (await mails(since, [b])).filter((mail) => /prenez rendez-vous/.test(mail.subject));
      return { edition, a, b, linkA: urlOf(mailA), linkB: urlOf(mailB) };
    }
    const request = (path, options) => espace().request(path, { origin: null, ...options });

    it('GET : page de confirmation, aucun effet sur les préférences, aucun cookie, Referrer-Policy no-referrer', async () => {
      const { a, linkA } = await pair();
      const response = await request(pathOf(linkA));
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.match(response.text, /<form method="post"/);
      assert.match(response.text, /Ne plus recevoir les rappels/);
      assert.deepEqual(response.setCookies, []);
      assert.equal((await refreshed(a)).emailPrefs.reminders, true, 'un GET ne change rien');
    });

    it('GET répété : toujours sans effet', async () => {
      const { a, linkA } = await pair();
      for (let i = 0; i < 3; i += 1) assert.equal((await request(pathOf(linkA))).status, 200);
      assert.equal((await refreshed(a)).emailPrefs.reminders, true);
    });

    it('POST du formulaire de la page : coupe `reminders` sans connexion, garde les autres préférences, répond par une page HTML', async () => {
      const { a, b, linkA } = await pair();
      const response = await request(pathOf(linkA), { method: 'POST', form: {} });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.match(response.text, /Vous ne recevrez plus de rappels/);
      assert.deepEqual((await refreshed(a)).emailPrefs, { meetingRequests: true, messages: true, reminders: false });
      assert.equal((await refreshed(b)).emailPrefs.reminders, true, 'l’autre destinataire n’est pas touché');
    });

    it('POST en un clic (RFC 8058, sans Origin ni session) : 200 { status: "unsubscribed" } et `reminders` coupé', async () => {
      const { a, linkA } = await pair();
      const response = await request(pathOf(linkA), { method: 'POST', form: { 'List-Unsubscribe': 'One-Click' } });
      assert.equal(response.status, 200);
      assert.deepEqual(response.json, { status: 'unsubscribed' });
      assert.equal((await refreshed(a)).emailPrefs.reminders, false);
      const again = await request(pathOf(linkA), { method: 'POST', form: { 'List-Unsubscribe': 'One-Click' } });
      assert.equal(again.status, 200, 'répété : sans erreur');
    });

    it('le jeton de A ne coupe pas B ; la signature de A collée à l’identifiant de B est refusée', async () => {
      const { a, b, linkA } = await pair();
      const signatureOfA = linkA.searchParams.get('token').split('.')[1];
      const forged = `/api/espace/reminders/unsubscribe?token=${b.documentId}.${signatureOfA}`;
      for (const method of ['GET', 'POST']) {
        const response = await request(forged, { method, ...(method === 'POST' && { form: { 'List-Unsubscribe': 'One-Click' } }) });
        assert.equal(response.status, 400, method);
      }
      const html = await request(forged, { method: 'POST', form: {} });
      assert.equal(html.status, 400);
      assert.match(html.text, /Lien invalide/);
      assert.equal((await refreshed(b)).emailPrefs.reminders, true);
      assert.equal((await refreshed(a)).emailPrefs.reminders, true);
    });

    it('jeton absent, vide, altéré ou d’un inconnu : 400, une page « Lien invalide » ou TOKEN_INVALID en un clic, aucun effet', async () => {
      const { a, linkA } = await pair();
      const good = linkA.searchParams.get('token');
      const bad = ['', 'inconnu.abc', `${good}x`, `${good.slice(0, -2)}AA`, 'sans-point', 'unknownid.' + good.split('.')[1]];
      for (const token of bad) {
        const page = await request(`/api/espace/reminders/unsubscribe?token=${encodeURIComponent(token)}`);
        assert.equal(page.status, 400, JSON.stringify(token));
        assert.match(page.text, /Lien invalide/);
        const oneClick = await request(`/api/espace/reminders/unsubscribe?token=${encodeURIComponent(token)}`, { method: 'POST', form: { 'List-Unsubscribe': 'One-Click' } });
        assert.equal(oneClick.status, 400, JSON.stringify(token));
        assert.equal(oneClick.json.error.code, 'TOKEN_INVALID');
      }
      const noToken = await request('/api/espace/reminders/unsubscribe');
      assert.equal(noToken.status, 400);
      assert.equal((await refreshed(a)).emailPrefs.reminders, true);
    });

    it('après désabonnement : plus de a, b ni welcome, mais la veille part s’il y a un rendez-vous accepté', async () => {
      const { edition, slots } = await newEdition({ welcomeStartedAt: '2026-11-20T10:00:00.000Z' });
      const a = await person(edition, { emailPrefs: PREFS });
      const b = await person(edition, { emailPrefs: PREFS });
      await meeting(edition, slots[0], a, b, 'accepted', 'Table 1');
      const since = espace().outbox().length;
      await reminders().send(edition, 'profile', { now: at('2026-11-23T10:00:00Z') });
      const [mail] = (await mails(since, [a])).filter((candidate) => candidate.headers['List-Unsubscribe']);
      const response = await request(pathOf(urlOf(mail)), { method: 'POST', form: { 'List-Unsubscribe': 'One-Click' } });
      assert.equal(response.status, 200);

      const preview = await reminders().preview(edition, 'profile', { now: at('2026-11-24T10:00:00Z') });
      assert.equal(preview.skipped.optedOut, 1, 'a est exclu de a');
      const after = espace().outbox().length;
      await reminders().runDue({ now: NOW_J6 });
      const profileLogs = await logsOf(edition, 'reminder-profile');
      assert.ok(!emailsOf(profileLogs.filter(({ scenarioKey }) => scenarioKey === 'profile:2026-11-27')).includes(a.email), 'rien de plus pour a à J-6');
      assert.equal((await mails(after, [a])).length, 0);

      await reminders().runDue({ now: EVE_16H });
      assert.equal((await logsOf(edition, 'reminder-eve')).filter((log) => log.attendee.email === a.email).length, 1, 'e-mail de service : la veille part');
    });
  });
});
