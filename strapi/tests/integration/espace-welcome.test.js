'use strict';

/**
 * Ouverture contrôlée et état du service, lot V1-C (docs/espace/specs/14-lots-finalisation.md) : F-105, R-85, NF-62, F-106.
 * Tests d'abord : chaque groupe porte `pending('V1-C')`, à retirer à la livraison du lot.
 *
 * Routes (organisateur de l'édition, 403 sinon) :
 *   POST /api/espace/admin/:edition/welcome/preview  -> { recipients, sampleHtml }
 *   POST /api/espace/admin/:edition/welcome/send     -> { sent, failed, startedAt } ou 409 OUTSIDE_SENDING_HOURS
 *   GET  /api/espace/admin/:edition/service          -> { mail, helloasso, cron, space } (forme de F-106)
 *
 * Critères d'acceptation couverts : 1 (aucun envoi tant que welcomeStartedAt est vide), 2 (aperçu exact, envoi unique),
 * 3 (nouveaux inscrits invités entre 8h et 20h, heure de Paris), 4 (trois échecs, plus de nouvel essai), 5 (expéditeur absent),
 * 6 (403 pour un participant). Le critère 7 (captures de bout en bout) est dans web/tests/e2e/espace-pilotage-ouverture.spec.ts.
 *
 * Heure : la synchronisation prend `now` en paramètre (A-19). Les routes lisent l'horloge du processus : le test fige `Date`
 * (mock.timers) le temps d'une requête, à une heure de Paris choisie, le lendemain de l'exécution (les sessions restent valables).
 * Un échec d'envoi est provoqué en remplaçant le fichier de la boîte de sortie par un dossier (le fournisseur console échoue).
 * Pas testé ici : la ligne d'erreur de journal au démarrage pour un expéditeur absent avec brevo ou smtp (ces fournisseurs sont
 * refusés sous NODE_ENV=test) ; elle se vérifie en revue ou par un test unitaire de l'amorçage.
 */

const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const defaultItems = require('../../scripts/espace/fixtures/helloasso-items.json');
const { pending } = require('../helpers/pending');
const { sleep, useEspace } = require('../helpers/espace');
const { UID, createAttendee, createEdition, link } = require('../helpers/espace-data');

const clone = (value) => structuredClone(value);
const itemFrom = (id) => clone(defaultItems.find((item) => item.id === id));
const isWelcome = (mail) => /\/espace\/verifier/.test(mail.text);
const EM_DASH = String.fromCharCode(0x2014);

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

/** Exécute `action` avec l'horloge du processus figée à `instant`, puis la rend. */
async function frozenAt(instant, action) {
  mock.timers.enable({ apis: ['Date'], now: instant });
  try {
    return await action();
  } finally {
    mock.timers.reset();
  }
}

/** Les envois échouent le temps de `action` : le fichier de la boîte de sortie devient un dossier. */
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

describe('ouverture contrôlée : e-mail de bienvenue et état du service (V1-C : F-105, R-85, NF-62, F-106)', pending('V1-C', { timeout: 600_000 }), () => {
  const espace = useEspace({ fake: true });
  let counter = 0;

  const newEdition = (options = {}) => {
    counter += 1;
    return createEdition(espace().app, { slug: `ouverture-${counter}`, title: `Ouverture ${counter}`, ...options });
  };
  const useItems = (items) => espace().fake.setItems(items);
  const run = (edition, options) => espace().app.service('api::espace.sync').run(edition.documentId, options);
  const logsOf = (edition, template = 'welcome') =>
    espace().query(UID.emailLog).findMany({ where: { template, attendee: { edition: { documentId: edition.documentId } } }, populate: ['attendee'] });
  const editionNow = (edition) => espace().app.documents(UID.edition).findOne({ documentId: edition.documentId, status: 'published' });
  const route = (edition, name) => `/api/espace/admin/${edition.slug}/${name}`;
  const post = (edition, name, cookie, options) => espace().request(route(edition, name), { method: 'POST', cookie, ...options });
  const get = (edition, name, cookie) => espace().request(route(edition, name), { cookie });

  async function person(edition, fields = {}) {
    const { app, signIn } = espace();
    const attendee = await createAttendee(app, edition, { consentAt: new Date().toISOString(), ...fields });
    return { attendee, ...(await signIn(edition.slug, attendee.email)) };
  }
  const organizerOf = (edition) => person(edition, { role: 'organizer' });
  const mailsTo = (since, attendees) => espace().mailsSince(since, { to: attendees.map((attendee) => attendee.email) });

  /** Édition ouverte avec A, B, C jamais invités, D (un échec seulement), E (déjà invité), F (annulé) et un organisateur. */
  async function populated() {
    const { app } = espace();
    const edition = await newEdition();
    const made = [];
    for (const [index, fields] of [{}, {}, {}, {}, {}, { status: 'cancelled' }].entries()) {
      made.push(await createAttendee(app, edition, { email: `invite.${counter}.${index}@example.org`, ...fields }));
    }
    const [a, b, c, d, e, f] = made;
    const log = (attendee, status) => app.documents(UID.emailLog).create({ data: { attendee: link(attendee), template: 'welcome', scenarioKey: 'welcome', status, sentAt: new Date().toISOString() } });
    await log(d, 'failed');
    await log(e, 'sent');
    const organizer = await organizerOf(edition);
    return { edition, organizer, expected: [a, b, c, d], welcomed: e, cancelled: f };
  }

  describe('critère 1 (R-85) : tant que welcomeStartedAt est vide, la synchronisation n’envoie aucun welcome', () => {
    it('dix synchronisations sur une édition ouverte : aucun e-mail, aucun EmailLog welcome, welcomeStartedAt vide', async () => {
      useItems(defaultItems);
      const edition = await newEdition();
      const since = espace().outbox().length;
      for (let i = 0; i < 10; i += 1) await run(edition, { now: parisInstant(14) });
      const attendees = await espace().app.documents(UID.attendee).findMany({ filters: { edition: { documentId: edition.documentId } }, limit: 100 });
      assert.equal(attendees.length, 16, 'les inscrits sont bien importés');
      assert.deepEqual(await mailsTo(since, attendees), []);
      assert.equal((await logsOf(edition)).length, 0);
      assert.equal((await editionNow(edition)).welcomeStartedAt ?? null, null);
    });
  });

  describe('critère 2 (F-105) : aperçu exact, envoi unique', () => {
    it('preview renvoie le nombre exact d’actifs sans welcome envoyé (organisateur, annulé et déjà invité exclus) et un aperçu HTML', async () => {
      const { edition, organizer, expected } = await populated();
      const since = espace().outbox().length;
      const response = await post(edition, 'welcome/preview', organizer.cookie);
      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(response.json).sort(), ['recipients', 'sampleHtml']);
      assert.equal(response.json.recipients, expected.length);
      assert.equal(typeof response.json.sampleHtml, 'string');
      assert.ok(response.json.sampleHtml.length > 0);
      assert.ok(!response.json.sampleHtml.includes(EM_DASH), 'aucun tiret cadratin dans l’aperçu');
      assert.deepEqual(await mailsTo(since, expected), [], 'l’aperçu n’envoie rien');
      assert.equal((await editionNow(edition)).welcomeStartedAt ?? null, null, 'l’aperçu ne pose pas welcomeStartedAt');
    });

    it('send envoie à chacun une fois, rend { sent, failed, startedAt } et pose welcomeStartedAt', async () => {
      const { edition, organizer, expected, welcomed, cancelled } = await populated();
      const since = espace().outbox().length;
      const response = await frozenAt(parisInstant(14), () => post(edition, 'welcome/send', organizer.cookie));
      assert.equal(response.status, 200, response.text);
      assert.deepEqual(Object.keys(response.json).sort(), ['failed', 'sent', 'startedAt']);
      assert.equal(response.json.sent, expected.length);
      assert.equal(response.json.failed, 0);
      assert.ok(!Number.isNaN(Date.parse(response.json.startedAt)));

      const mails = (await mailsTo(since, [...expected, welcomed, cancelled, organizer.attendee])).filter(isWelcome);
      assert.deepEqual(mails.map((mail) => mail.to.email).sort(), expected.map((attendee) => attendee.email).sort());
      assert.equal(new Date((await editionNow(edition)).welcomeStartedAt).toISOString(), new Date(response.json.startedAt).toISOString());
    });

    it('un second send renvoie sent 0, n’envoie rien de plus et ne déplace pas welcomeStartedAt', async () => {
      const { edition, organizer, expected } = await populated();
      const first = await frozenAt(parisInstant(14), () => post(edition, 'welcome/send', organizer.cookie));
      assert.equal(first.json.sent, expected.length);
      await sleep(400);
      const since = espace().outbox().length;
      const second = await frozenAt(parisInstant(15), () => post(edition, 'welcome/send', organizer.cookie));
      assert.equal(second.status, 200);
      assert.equal(second.json.sent, 0);
      assert.equal(second.json.failed, 0);
      assert.deepEqual(await mailsTo(since, expected), []);
      assert.equal(new Date((await editionNow(edition)).welcomeStartedAt).toISOString(), new Date(first.json.startedAt).toISOString());
      const preview = await post(edition, 'welcome/preview', organizer.cookie);
      assert.equal(preview.json.recipients, 0);
    });

    it('hors de 8h00 à 20h00 (Paris) : 409 OUTSIDE_SENDING_HOURS, rien d’envoyé, welcomeStartedAt toujours vide', async () => {
      const { edition, organizer, expected } = await populated();
      const since = espace().outbox().length;
      for (const [hour, minute] of [[22, 0], [7, 59], [20, 0]]) {
        const response = await frozenAt(parisInstant(hour, minute), () => post(edition, 'welcome/send', organizer.cookie));
        assert.equal(response.status, 409, `${hour}h${minute}`);
        assert.equal(response.json.error.code, 'OUTSIDE_SENDING_HOURS');
      }
      assert.deepEqual(await mailsTo(since, expected), []);
      assert.equal((await editionNow(edition)).welcomeStartedAt ?? null, null);
    });

    it('8h00 pile est dans la plage', async () => {
      const { edition, organizer, expected } = await populated();
      const response = await frozenAt(parisInstant(8, 0), () => post(edition, 'welcome/send', organizer.cookie));
      assert.equal(response.status, 200);
      assert.equal(response.json.sent, expected.length);
    });
  });

  describe('critère 3 (R-85) : après le premier envoi, la synchronisation invite seule les nouveaux inscrits entre 8h et 20h', () => {
    const NINA = 'nina.nouvelle@example.org';
    const newcomer = () => {
      const added = itemFrom(100001);
      Object.assign(added, { id: 100099 });
      added.order = { ...added.order, id: 200099 };
      added.user = { firstName: 'Nina', lastName: 'Nouvelle' };
      added.customFields.find((field) => field.name === 'Email').answer = NINA;
      return added;
    };
    const ninaMails = async (since) => (await espace().mailsSince(since, { to: NINA })).filter(isWelcome);

    /** Édition dont le premier envoi a eu lieu (champ posé) et dont les 16 inscrits sont invités ; Nina arrive ensuite. */
    async function opened() {
      useItems(defaultItems);
      const edition = await newEdition({ settings: { welcomeStartedAt: parisInstant(10, 0, 0).toISOString() } });
      const { app } = espace();
      await run(edition, { now: parisInstant(10) }); // importe les 16 billets : welcomeStartedAt est posé, ils sont invités
      await sleep(500);
      const logs = await logsOf(edition);
      assert.equal(logs.length, 16, 'avec welcomeStartedAt posé, la synchronisation invite les inscrits');
      useItems([...defaultItems, newcomer()]);
      return { edition, app };
    }

    it('importé à 14h00 : invité à la synchronisation qui l’importe', async () => {
      const { edition } = await opened();
      const since = espace().outbox().length;
      const result = await run(edition, { now: parisInstant(14) });
      assert.equal(result.created, 1);
      assert.equal((await ninaMails(since)).length, 1);
    });

    it('importé à 22h00 : pas d’e-mail ; invité à la synchronisation suivante après 8h00', async () => {
      const { edition } = await opened();
      const since = espace().outbox().length;
      await run(edition, { now: parisInstant(22) });
      assert.equal((await ninaMails(since)).length, 0, 'rien à 22h00');
      await run(edition, { now: parisInstant(23) });
      assert.equal((await ninaMails(since)).length, 0, 'rien non plus à 23h00');
      await run(edition, { now: parisInstant(8, 5, 2) });
      assert.equal((await ninaMails(since)).length, 1, 'invité après 8h00');
      await run(edition, { now: parisInstant(9, 0, 2) });
      assert.equal((await ninaMails(since)).length, 1, 'une seule fois');
    });
  });

  describe('critère 4 (R-85, NF-62) : trois échecs consécutifs, plus de nouvel essai', () => {
    it('le destinataire n’est plus retenté après trois échecs et l’état du service montre les échecs', async () => {
      useItems([itemFrom(100001)]);
      const edition = await newEdition({ settings: { welcomeStartedAt: parisInstant(10, 0, 0).toISOString() } });
      const organizer = await organizerOf(edition);
      const failing = async () => {
        await run(edition, { now: parisInstant(14) });
        await sleep(300);
      };
      await withBrokenOutbox(espace, async () => {
        for (let i = 0; i < 3; i += 1) await failing();
      });
      const failed = (await logsOf(edition)).filter((log) => log.status === 'failed');
      assert.equal(failed.length, 3, 'un EmailLog failed par essai');

      // La boîte de sortie fonctionne de nouveau : le destinataire abandonné n'est pas retenté.
      const since = espace().outbox().length;
      await failing();
      await failing();
      assert.deepEqual((await mailsTo(since, [{ email: 'lea.ducasse@example.org' }])).filter(isWelcome), []);
      assert.equal((await logsOf(edition)).length, 3, 'aucun quatrième essai');

      const service = await get(edition, 'service', organizer.cookie);
      assert.equal(service.status, 200);
      assert.ok(service.json.mail.failedLast24h >= 3, `failedLast24h ${service.json.mail.failedLast24h}`);
      assert.equal(typeof service.json.mail.lastError, 'string');
      assert.ok(service.json.mail.lastError.length > 0);
    });

    it('un échec isolé est retenté à la synchronisation suivante', async () => {
      useItems([itemFrom(100001)]);
      const edition = await newEdition({ settings: { welcomeStartedAt: parisInstant(10, 0, 0).toISOString() } });
      await withBrokenOutbox(espace, async () => {
        await run(edition, { now: parisInstant(14) });
        await sleep(300);
      });
      assert.equal((await logsOf(edition)).filter((log) => log.status === 'failed').length, 1);
      await run(edition, { now: parisInstant(14, 15) });
      await sleep(300);
      assert.equal((await logsOf(edition)).filter((log) => log.status === 'sent').length, 1);
    });
  });

  describe('NF-62 : EmailLog.error', () => {
    it('un envoi en échec renseigne error : une ligne, 300 caractères au plus ; un envoi réussi la laisse vide', async () => {
      const { edition, organizer, expected } = await populated();
      const response = await withBrokenOutbox(espace, () => frozenAt(parisInstant(14), () => post(edition, 'welcome/send', organizer.cookie)));
      assert.equal(response.status, 200);
      assert.equal(response.json.failed, expected.length);
      assert.equal(response.json.sent, 0);
      // Le quatrième destinataire attendu (D) porte déjà un échec posé à la main, sans motif : on ne juge que les nouveaux échecs.
      const fresh = expected.slice(0, 3);
      const failed = (await logsOf(edition)).filter((log) => log.status === 'failed' && fresh.some((attendee) => attendee.documentId === log.attendee.documentId));
      assert.equal(failed.length, fresh.length);
      for (const log of failed.filter((entry) => entry.error)) {
        assert.ok(log.error.length <= 300);
        assert.ok(!log.error.includes('\n'), 'première ligne seulement');
      }
      assert.ok(failed.every((log) => typeof log.error === 'string' && log.error.length > 0), 'chaque échec porte son motif');

      const retry = await frozenAt(parisInstant(15), () => post(edition, 'welcome/send', organizer.cookie));
      assert.equal(retry.json.sent, expected.length);
      const sent = (await logsOf(edition)).filter((log) => log.status === 'sent');
      assert.ok(sent.every((log) => !log.error), 'aucun motif sur un envoi réussi');
    });
  });

  describe('F-106 : GET /service', () => {
    it('rend la forme { mail, helloasso, cron, space } d’une édition ouverte et bien réglée', async () => {
      useItems(defaultItems);
      const edition = await newEdition();
      const organizer = await organizerOf(edition);
      await post(edition, 'sync', organizer.cookie);
      const response = await get(edition, 'service', organizer.cookie);
      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(response.json).sort(), ['cron', 'helloasso', 'mail', 'space']);
      const { mail, helloasso, cron, space } = response.json;
      for (const key of ['failedLast24h', 'lastError', 'provider', 'senderConfigured']) assert.ok(key in mail, `mail.${key}`);
      assert.equal(mail.provider, 'console');
      assert.equal(mail.senderConfigured, true);
      assert.equal(mail.failedLast24h, 0);
      assert.equal(mail.lastError ?? null, null);
      assert.deepEqual(Object.keys(helloasso).sort(), ['configured', 'lastRunAt', 'lastRunStatus']);
      assert.equal(helloasso.configured, true);
      assert.ok(helloasso.lastRunAt, 'la synchronisation vient d’avoir lieu');
      assert.equal(typeof helloasso.lastRunStatus, 'string');
      assert.deepEqual(cron, { enabled: false });
      assert.deepEqual(Object.keys(space).sort(), ['enabled', 'welcomeStartedAt']);
      assert.equal(space.enabled, true);
      assert.equal(space.welcomeStartedAt ?? null, null);
    });

    it('space.welcomeStartedAt suit le premier envoi', async () => {
      const { edition, organizer } = await populated();
      const sent = await frozenAt(parisInstant(14), () => post(edition, 'welcome/send', organizer.cookie));
      const { space } = (await get(edition, 'service', organizer.cookie)).json;
      assert.equal(new Date(space.welcomeStartedAt).toISOString(), new Date(sent.json.startedAt).toISOString());
    });

    it('space.enabled est faux sur une édition fermée', async () => {
      const { app } = espace();
      const edition = await newEdition();
      const organizer = await organizerOf(edition);
      await app.documents(UID.edition).update({ documentId: edition.documentId, data: { participantSpaceEnabled: false } });
      await app.documents(UID.edition).publish({ documentId: edition.documentId });
      const response = await get(edition, 'service', organizer.cookie);
      // NF-52 peut refuser la session d'une édition fermée : le contrat porte alors sur une édition ouverte seulement.
      if (response.status === 200) assert.equal(response.json.space.enabled, false);
      else assert.ok([401, 403].includes(response.status), `statut ${response.status}`);
    });
  });

  describe('critère 6 : participant non organisateur, 403 sur les trois routes', () => {
    const routes = [
      ['POST', 'welcome/preview'],
      ['POST', 'welcome/send'],
      ['GET', 'service'],
    ];

    for (const [method, name] of routes) {
      it(`${method} ${name} : 403 FORBIDDEN pour un participant, 401 sans session`, async () => {
        const edition = await newEdition();
        const participant = await person(edition, { role: 'participant' });
        const since = espace().outbox().length;
        const denied = await frozenAt(parisInstant(14), () => espace().request(route(edition, name), { method, cookie: participant.cookie }));
        assert.equal(denied.status, 403);
        assert.equal(denied.json.error.code, 'FORBIDDEN');
        const anonymous = await espace().request(route(edition, name), { method });
        assert.equal(anonymous.status, 401);
        assert.deepEqual((await mailsTo(since, [participant.attendee])).filter(isWelcome), []);
      });
    }

    it('l’organisateur d’une autre édition reçoit 403 aussi', async () => {
      const edition = await newEdition();
      const other = await newEdition();
      const stranger = await organizerOf(other);
      for (const [method, name] of routes) {
        const response = await espace().request(route(edition, name), { method, cookie: stranger.cookie });
        assert.equal(response.status, 403, `${method} ${name}`);
      }
    });
  });
});

describe('critère 5 (F-106, NF-62) : expéditeur absent', pending('V1-C', { timeout: 300_000 }), () => {
  const espace = useEspace({ fake: true, overrides: { EMAIL_FROM: '' } });

  it('service.mail.senderConfigured vaut false ; un envoi en échec renseigne EmailLog.error et apparaît dans service.mail', async () => {
    const { app, signIn, request } = espace();
    const edition = await createEdition(app, { slug: 'sans-expediteur', title: 'Sans expéditeur' });
    const organizerAttendee = await createAttendee(app, edition, { role: 'organizer', consentAt: new Date().toISOString() });
    const guest = await createAttendee(app, edition, {});
    const { cookie } = await signIn(edition.slug, organizerAttendee.email);

    const before = await request(`/api/espace/admin/${edition.slug}/service`, { cookie });
    assert.equal(before.status, 200);
    assert.equal(before.json.mail.senderConfigured, false);

    const sent = await withBrokenOutbox(espace, () =>
      frozenAt(parisInstant(14), () => request(`/api/espace/admin/${edition.slug}/welcome/send`, { method: 'POST', cookie }))
    );
    assert.equal(sent.status, 200);
    assert.equal(sent.json.failed, 1);

    const logs = await espace().query(UID.emailLog).findMany({ where: { template: 'welcome', attendee: { documentId: guest.documentId } } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, 'failed');
    assert.ok(typeof logs[0].error === 'string' && logs[0].error.length > 0 && logs[0].error.length <= 300);

    const after = await request(`/api/espace/admin/${edition.slug}/service`, { cookie });
    assert.equal(after.json.mail.senderConfigured, false);
    assert.ok(after.json.mail.failedLast24h >= 1);
    assert.ok(after.json.mail.lastError);
  });
});
