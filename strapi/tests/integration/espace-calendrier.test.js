'use strict';

/**
 * Abonnement calendrier, lot V5-E (I-42, NF-03, NF-52, NF-55, R-44) :
 *   POST   /api/espace/me/calendar-feed      (session) -> 201 { path, createdAt } ; régénère en révoquant l'ancien flux
 *   DELETE /api/espace/me/calendar-feed      (session) -> 200 { revoked }, idempotent
 *   GET    /api/espace/calendar/{jeton}.ics  (public)  -> même contenu que GET /meetings.ics ; 404 FEED_NOT_FOUND uniforme ; 429 au-delà de 30 par minute et par IP
 *
 * Critères d'acceptation : le flux ne contient que les rendez-vous acceptés de son propriétaire ; jeton révoqué ou régénéré : 404.
 * Le jeton n'est jamais en base (empreinte seule, NF-02) ni dans les journaux (NF-55).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { freshIp, sha256, useEspace } = require('../helpers/espace');
const { UID } = require('../helpers/espace-data');
const { eventsOf, firstProp, validateIcs } = require('../helpers/ics-validate');
const W = require('../helpers/meetings-world');

const FEED = 'api::espace.calendar-feed';
const FEED_PATH = /^\/api\/espace\/calendar\/([A-Za-z0-9_-]{43})\.ics$/;
const NOT_FOUND = { error: { code: 'FEED_NOT_FOUND', message: 'Ce flux n’est plus valable.' } };

/** Le calendrier sans son horodatage DTSTAMP, qui change d'une lecture à l'autre. */
const withoutStamp = (text) => text.split('\r\n').filter((line) => !line.startsWith('DTSTAMP')).join('\r\n');
const uidsOf = (text) => eventsOf(text).map((event) => firstProp(event, 'UID').value).sort();

describe('abonnement calendrier (V5-E, I-42)', { timeout: 600_000 }, () => {
  const espace = useEspace({ overrides: { ORGANIZER_EMAILS: 'organisation@example.org' } });
  const login = W.useLogin(espace);
  const api = W.useApi(espace);
  const app = () => espace().app;
  const del = (cookie) => espace().request('/api/espace/me/calendar-feed', { method: 'DELETE', cookie });
  const rows = (where = {}) => espace().query(FEED).findMany({ where, populate: ['attendee'] });

  async function scene(options = {}) {
    const world = await W.createMeetingEdition(app(), { slug: W.unique('cal'), title: 'Édition calendrier', ...options });
    const person = (fields) => W.createPerson(app(), world.edition, fields);
    const [lea, mathis, ines, jules] = [
      await person({ firstName: 'Léa', lastName: 'Ducasse' }),
      await person({ firstName: 'Mathis', lastName: 'Lagrange' }),
      await person({ firstName: 'Inès', lastName: 'Castaing' }),
      await person({ firstName: 'Jules', lastName: 'Mazères' }),
    ];
    const seed = (fields) => W.seedMeeting(app(), { edition: world.edition, ...fields });
    const m = {
      leaMathis: await seed({ slot: world.slots['10h45'], requester: lea, target: mathis, status: 'accepted', tableNumber: 1, answeredBy: mathis }),
      leaPending: await seed({ slot: world.slots['13h00'], requester: lea, target: jules }),
      inesMathis: await seed({ slot: world.slots['11h00'], requester: ines, target: mathis, status: 'accepted', tableNumber: 2, answeredBy: mathis }),
      inesJules: await seed({ slot: world.slots['12h30'], requester: ines, target: jules, status: 'accepted', tableNumber: 1, answeredBy: jules }),
    };
    const cookie = async (who) => login(world.edition, who);
    const subscribe = async (who) => {
      const response = await api(await cookie(who)).post('/me/calendar-feed');
      assert.equal(response.status, 201, response.text);
      return response.json;
    };
    const read = (path, ip) => espace().request(path, { ip });
    return { world, lea, mathis, ines, jules, m, cookie, subscribe, read };
  }

  describe('POST /me/calendar-feed : création', () => {
    it('sans session : 401 UNAUTHENTICATED', async () => {
      const response = await espace().request('/api/espace/me/calendar-feed', { method: 'POST', json: {} });
      assert.equal(response.status, 401);
      assert.equal(response.json.error.code, 'UNAUTHENTICATED');
    });

    it('d’une origine non admise : 403 ORIGIN_REFUSED, aucun flux créé', async () => {
      const { lea, cookie } = await scene();
      const response = await espace().request('/api/espace/me/calendar-feed', { method: 'POST', json: {}, cookie: await cookie(lea), origin: 'https://intrus.example.org' });
      assert.equal(response.status, 403);
      assert.equal(response.json.error.code, 'ORIGIN_REFUSED');
      assert.equal((await rows({ attendee: { documentId: lea.documentId } })).length, 0);
    });

    it('201 { path, createdAt } : un chemin /api/espace/calendar/{jeton de 43 caractères}.ics et une date ISO récente', async () => {
      const { lea, cookie } = await scene();
      const before = Date.now();
      const response = await api(await cookie(lea)).post('/me/calendar-feed');
      assert.equal(response.status, 201, response.text);
      assert.deepEqual(Object.keys(response.json).sort(), ['createdAt', 'path']);
      assert.match(response.json.path, FEED_PATH);
      assert.equal(new Date(response.json.createdAt).toISOString(), response.json.createdAt);
      assert.ok(Math.abs(new Date(response.json.createdAt) - before) < 10_000);
    });

    it('la réponse n’est pas mise en cache : Cache-Control private, no-store', async () => {
      const { lea, cookie } = await scene();
      const response = await api(await cookie(lea)).post('/me/calendar-feed');
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    });

    it('deux participants ont deux jetons distincts, chacun lié à son propriétaire', async () => {
      const { lea, mathis, subscribe } = await scene();
      const [first, second] = [await subscribe(lea), await subscribe(mathis)];
      assert.notEqual(first.path, second.path);
      const owners = await rows({ revokedAt: null });
      const ofLea = owners.filter((row) => row.attendee.documentId === lea.documentId);
      assert.equal(ofLea.length, 1);
    });
  });

  describe('GET /calendar/{jeton}.ics : contenu (I-42, critère 1)', () => {
    it('200 text/calendar sans session ni origine ; calendrier valable, en ligne, sans cache ni indexation', async () => {
      const { lea, subscribe, read } = await scene();
      const { path } = await subscribe(lea);
      const response = await read(path);
      assert.equal(response.status, 200, response.text);
      assert.match(response.headers.get('content-type'), /^text\/calendar;\s*charset=utf-8$/i);
      assert.match(response.headers.get('content-disposition'), /^inline; filename="jib-.+\.ics"$/);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(response.headers.get('x-robots-tag'), 'noindex');
      assert.deepEqual(validateIcs(response.text), []);
    });

    it('ne contient que les rendez-vous acceptés de son propriétaire : ni demande en attente, ni rendez-vous d’un tiers', async () => {
      const { lea, m, subscribe, read } = await scene();
      const uids = uidsOf((await read((await subscribe(lea)).path)).text).join('\n');
      assert.ok(uids.includes(m.leaMathis.documentId), 'rendez-vous accepté de Léa');
      for (const key of ['leaPending', 'inesMathis', 'inesJules']) assert.ok(!uids.includes(m[key].documentId), key);
    });

    it('le flux d’un autre participant ne contient pas les rendez-vous de Léa qui ne le concernent pas', async () => {
      const { mathis, jules, m, subscribe, read } = await scene();
      const ofMathis = uidsOf((await read((await subscribe(mathis)).path)).text).join('\n');
      assert.ok(ofMathis.includes(m.leaMathis.documentId) && ofMathis.includes(m.inesMathis.documentId));
      assert.ok(!ofMathis.includes(m.inesJules.documentId));
      const ofJules = uidsOf((await read((await subscribe(jules)).path)).text).join('\n');
      assert.ok(ofJules.includes(m.inesJules.documentId));
      assert.ok(!ofJules.includes(m.leaMathis.documentId) && !ofJules.includes(m.leaPending.documentId));
    });

    it('même contenu que GET /meetings.ics du propriétaire (hors horodatage)', async () => {
      const { lea, cookie, subscribe, read } = await scene();
      const feed = await read((await subscribe(lea)).path);
      const download = await espace().request('/api/espace/meetings.ics', { cookie: await cookie(lea) });
      assert.equal(download.status, 200);
      assert.equal(withoutStamp(feed.text), withoutStamp(download.text));
    });

    it('suit les rendez-vous : un rendez-vous accepté après l’abonnement apparaît, un rendez-vous annulé disparaît', async () => {
      const { world, lea, jules, m, subscribe, read } = await scene();
      const { path } = await subscribe(lea);
      assert.ok(!uidsOf((await read(path)).text).join('\n').includes(m.leaPending.documentId));
      await app().documents(UID.meeting).update({ documentId: m.leaPending.documentId, data: { status: 'accepted', tableNumber: 3, tableKey: `${world.slots['13h00'].documentId}:3`, location: 'Table 3', answeredBy: { documentId: jules.documentId } } });
      assert.ok(uidsOf((await read(path)).text).join('\n').includes(m.leaPending.documentId));
      await app().documents(UID.meeting).update({ documentId: m.leaMathis.documentId, data: { status: 'cancelled' } });
      assert.ok(!uidsOf((await read(path)).text).join('\n').includes(m.leaMathis.documentId));
    });
  });

  describe('jeton absent de la base et des journaux (NF-02, NF-55)', () => {
    it('la base ne contient que l’empreinte SHA-256 du jeton, jamais le jeton', async () => {
      const { lea, subscribe } = await scene();
      const { path } = await subscribe(lea);
      const token = FEED_PATH.exec(path)[1];
      const [stored] = await rows({ attendee: { documentId: lea.documentId } });
      assert.equal(stored.tokenHash, sha256(token));
      assert.ok(!JSON.stringify(await rows()).includes(token), 'jeton en clair dans CalendarFeed');
      assert.ok(!JSON.stringify(await espace().query(UID.magicToken).findMany({})).includes(token));
      assert.ok(!JSON.stringify(await espace().query(UID.attendee).findMany({})).includes(token));
    });

    it('aucun journal de Strapi ne contient le jeton, que le flux soit lu, révoqué, inconnu ou limité', async () => {
      const { lea, subscribe, read } = await scene();
      const chunks = [];
      const out = process.stdout.write;
      const err = process.stderr.write;
      const previousLevel = app().log.level;
      process.stdout.write = (chunk, ...rest) => (chunks.push(String(chunk)), out.call(process.stdout, chunk, ...rest));
      process.stderr.write = (chunk, ...rest) => (chunks.push(String(chunk)), err.call(process.stderr, chunk, ...rest));
      app().log.level = 'debug';
      let token;
      let unknown;
      try {
        const { path } = await subscribe(lea);
        token = FEED_PATH.exec(path)[1];
        unknown = crypto.randomBytes(32).toString('base64url');
        const ip = freshIp();
        await read(path, ip);
        await read(`/api/espace/calendar/${unknown}.ics`, ip);
        await subscribe(lea);
        await read(path, ip);
      } finally {
        app().log.level = previousLevel;
        process.stdout.write = out;
        process.stderr.write = err;
      }
      const log = chunks.join('');
      assert.ok(log.includes('/api/espace/calendar/'), 'le journal des requêtes était bien ouvert');
      assert.ok(!log.includes(token), 'jeton valable dans le journal');
      assert.ok(!log.includes(unknown), 'jeton inconnu dans le journal');
    });

    it('le jeton ne figure pas non plus dans le journal quand la limite de débit répond 429', async () => {
      const { lea, subscribe, read } = await scene();
      const { path } = await subscribe(lea);
      const token = FEED_PATH.exec(path)[1];
      const chunks = [];
      const out = process.stdout.write;
      const previousLevel = app().log.level;
      process.stdout.write = (chunk, ...rest) => (chunks.push(String(chunk)), out.call(process.stdout, chunk, ...rest));
      app().log.level = 'debug';
      try {
        const ip = freshIp();
        for (let i = 0; i < 31; i += 1) await read(path, ip);
      } finally {
        app().log.level = previousLevel;
        process.stdout.write = out;
      }
      assert.ok(!chunks.join('').includes(token), 'jeton dans le journal lors du 429');
    });
  });

  describe('révocation et régénération (I-42, critère 2)', () => {
    it('DELETE sans session : 401', async () => {
      const response = await espace().request('/api/espace/me/calendar-feed', { method: 'DELETE' });
      assert.equal(response.status, 401);
    });

    it('DELETE : 200 { revoked: true }, puis le flux répond 404 FEED_NOT_FOUND', async () => {
      const { lea, cookie, subscribe, read } = await scene();
      const { path } = await subscribe(lea);
      assert.equal((await read(path)).status, 200);
      const revoked = await del(await cookie(lea));
      assert.equal(revoked.status, 200, revoked.text);
      assert.deepEqual(revoked.json, { revoked: true });
      const after = await read(path);
      assert.equal(after.status, 404);
      assert.deepEqual(after.json, NOT_FOUND);
    });

    it('DELETE est idempotent : sans flux actif, 200 { revoked: false }', async () => {
      const { lea, cookie, subscribe } = await scene();
      assert.deepEqual((await del(await cookie(lea))).json, { revoked: false });
      await subscribe(lea);
      assert.deepEqual((await del(await cookie(lea))).json, { revoked: true });
      assert.deepEqual((await del(await cookie(lea))).json, { revoked: false });
    });

    it('DELETE ne révoque que le flux de la personne connectée', async () => {
      const { lea, mathis, cookie, subscribe, read } = await scene();
      const ofLea = await subscribe(lea);
      const ofMathis = await subscribe(mathis);
      await del(await cookie(lea));
      assert.equal((await read(ofLea.path)).status, 404);
      assert.equal((await read(ofMathis.path)).status, 200);
    });

    it('régénérer : l’ancien jeton répond 404, le nouveau 200 ; un seul flux actif', async () => {
      const { lea, subscribe, read } = await scene();
      const first = await subscribe(lea);
      const second = await subscribe(lea);
      assert.notEqual(first.path, second.path);
      assert.equal((await read(first.path)).status, 404);
      assert.equal((await read(second.path)).status, 200);
      const stored = await rows({ attendee: { documentId: lea.documentId } });
      assert.equal(stored.length, 2);
      assert.equal(stored.filter((row) => !row.revokedAt).length, 1);
    });

    it('trois régénérations d’affilée : seul le dernier jeton est valable', async () => {
      const { lea, subscribe, read } = await scene();
      const paths = [(await subscribe(lea)).path, (await subscribe(lea)).path, (await subscribe(lea)).path];
      assert.deepEqual(await Promise.all(paths.map(async (path) => (await read(path)).status)), [404, 404, 200]);
    });

    it('deux créations simultanées laissent au plus un flux actif', async () => {
      const { lea, cookie } = await scene();
      const as = api(await cookie(lea));
      const [a, b] = await Promise.all([as.post('/me/calendar-feed'), as.post('/me/calendar-feed')]);
      assert.deepEqual([a.status, b.status], [201, 201]);
      const active = (await rows({ attendee: { documentId: lea.documentId } })).filter((row) => !row.revokedAt);
      assert.equal(active.length, 1);
    });

    it('un flux révoqué reste révoqué après une nouvelle création', async () => {
      const { lea, cookie, subscribe, read } = await scene();
      const first = await subscribe(lea);
      await del(await cookie(lea));
      await subscribe(lea);
      assert.equal((await read(first.path)).status, 404);
    });
  });

  describe('404 uniforme (I-42)', () => {
    it('jeton inconnu, révoqué, malformé, sans extension .ics : même statut et même corps', async () => {
      const { lea, cookie, subscribe, read } = await scene();
      const revoked = await subscribe(lea);
      await del(await cookie(lea));
      const valid = FEED_PATH.exec((await subscribe(lea)).path)[1];
      const candidates = {
        inconnu: `/api/espace/calendar/${crypto.randomBytes(32).toString('base64url')}.ics`,
        révoqué: revoked.path,
        trop_court: '/api/espace/calendar/abc.ics',
        trop_long: `/api/espace/calendar/${valid}x.ics`,
        caractères_invalides: `/api/espace/calendar/${'é'.repeat(43)}.ics`,
        sans_extension: `/api/espace/calendar/${valid}`,
        mauvaise_extension: `/api/espace/calendar/${valid}.ical`,
        vide: '/api/espace/calendar/.ics',
      };
      for (const [name, path] of Object.entries(candidates)) {
        const response = await read(path);
        assert.equal(response.status, 404, name);
        assert.deepEqual(response.json, NOT_FOUND, name);
        assert.equal(response.headers.get('cache-control'), 'private, no-store', name);
      }
    });

    it('participant non actif (annulé) : 404, comme un jeton inconnu', async () => {
      const { lea, subscribe, read } = await scene();
      const { path } = await subscribe(lea);
      await app().documents(UID.attendee).update({ documentId: lea.documentId, data: { status: 'cancelled' } });
      const response = await read(path);
      assert.equal(response.status, 404);
      assert.deepEqual(response.json, NOT_FOUND);
    });

    it('édition dont l’espace est fermé (NF-52) : 404 ; rouverte, le même jeton répond de nouveau 200', async () => {
      const { world, lea, subscribe, read } = await scene();
      const { path } = await subscribe(lea);
      const set = (participantSpaceEnabled) => app().documents(UID.edition).update({ documentId: world.edition.documentId, data: { participantSpaceEnabled }, status: 'published' });
      await set(false);
      const closed = await read(path);
      assert.equal(closed.status, 404);
      assert.deepEqual(closed.json, NOT_FOUND);
      await set(true);
      assert.equal((await read(path)).status, 200);
    });
  });

  describe('limite de débit (NF-03)', () => {
    it('30 lectures par minute et par IP, la 31e répond 429 RATE_LIMITED ; une autre IP n’est pas touchée', async () => {
      const { lea, subscribe, read } = await scene();
      const { path } = await subscribe(lea);
      const ip = freshIp();
      const statuses = [];
      for (let i = 0; i < 31; i += 1) statuses.push((await read(path, ip)).status);
      assert.deepEqual(statuses.slice(0, 30), Array(30).fill(200));
      assert.equal(statuses[30], 429);
      const refused = await read(path, ip);
      assert.equal(refused.status, 429);
      assert.equal(refused.json.error.code, 'RATE_LIMITED');
      assert.equal((await read(path, freshIp())).status, 200);
    });

    it('les jetons inconnus comptent aussi : 31 essais au hasard depuis une IP, le dernier est refusé par 429 et non par 404', async () => {
      const { read } = await scene();
      const ip = freshIp();
      const statuses = [];
      for (let i = 0; i < 31; i += 1) statuses.push((await read(`/api/espace/calendar/${crypto.randomBytes(32).toString('base64url')}.ics`, ip)).status);
      assert.deepEqual(statuses.slice(0, 30), Array(30).fill(404));
      assert.equal(statuses[30], 429);
    });
  });

  // Dernier groupe : la purge supprime l'espace de toutes les éditions de la suite dont la date est passée de 12 mois à l'horloge donnée.
  describe('effacement et purge (R-44)', () => {
    it('« Supprimer mes données » supprime les flux de la personne ; l’adresse répond 404', async () => {
      const { lea, mathis, cookie, subscribe, read } = await scene();
      const ofLea = await subscribe(lea);
      const ofMathis = await subscribe(mathis);
      const erased = await api(await cookie(lea)).post('/me/erase', { confirm: true });
      assert.equal(erased.status, 200, erased.text);
      assert.equal((await read(ofLea.path)).status, 404);
      assert.equal((await rows({ attendee: { documentId: lea.documentId } })).length, 0, 'flux conservés après l’effacement');
      assert.equal((await read(ofMathis.path)).status, 200, 'le flux d’un autre participant est intact');
    });

    it('la purge d’une édition passée de 12 mois supprime ses flux', async () => {
      const { world, lea, subscribe } = await scene();
      await subscribe(lea);
      assert.equal((await rows({ attendee: { edition: { documentId: world.edition.documentId } } })).length, 1);
      const now = new Date(new Date(world.edition.date).getTime() + 366 * 86_400_000 + 3_600_000);
      await app().service('api::espace.privacy').purge({ now });
      assert.equal((await rows({ attendee: { edition: { documentId: world.edition.documentId } } })).length, 0);
    });
  });
});
