'use strict';

/**
 * Socle de l'API de l'espace, lot 2 de la phase 1 (tests d'abord) : édition publique (`GET /editions/:slug`), exposition de
 * l'API publique du site, contrôle de l'en-tête Origin des écritures (NF-04, A-05), CORS restreint, erreurs au format de
 * 06-api.md (NF-50), configuration câblée dans Strapi démarré.
 *
 * Strapi démarre une fois sur TEST_DATABASE (défaut strapi_test), avec CORS_ORIGINS à deux origines pour vérifier la liste.
 * Aucun e-mail réel, aucun réseau hors localhost.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createAttendee, createEdition, createProgram, UID } = require('../helpers/espace-data');
const { useEspace } = require('../helpers/espace');
const { pending } = require('../helpers/pending');

const FRONT = 'http://localhost:4321';
const SECOND_FRONT = 'https://journees.example.org';
const PRIVATE_FIELDS = [
  'participantSpaceEnabled',
  'helloassoOrgSlug',
  'helloassoFormType',
  'helloassoFormSlug',
  'helloassoFieldMap',
  'slotDurationMinutes',
  'tablesCount',
  'meetingRequestsOpenAt',
  'meetingRequestsCloseAt',
];
const PUBLIC_EDITION_KEYS = ['city', 'date', 'meetingRequestsCloseAt', 'meetingRequestsOpenAt', 'participantSpaceEnabled', 'slug', 'themeColor', 'title', 'venue'];

describe('socle de l’espace (lot 2)', { timeout: 180_000 }, () => {
  const espace = useEspace({ overrides: { CORS_ORIGINS: `${FRONT},${SECOND_FRONT}` } });

  describe('GET /api/espace/editions/:slug (06-api.md, plan 4.2)', pending('lot 2'), () => {
    it('renvoie l’édition publiée avec les champs publics seulement', async () => {
      const { app, request } = espace();
      const edition = await createEdition(app, { slug: 'edition-publique', title: 'Édition publique' });
      const response = await request('/api/espace/editions/edition-publique');
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^application\/json/);
      assert.deepEqual(Object.keys(response.json).sort(), PUBLIC_EDITION_KEYS);
      assert.equal(response.json.slug, 'edition-publique');
      assert.equal(response.json.title, 'Édition publique');
      assert.equal(response.json.date, '2026-12-03');
      assert.equal(response.json.city, 'Bordeaux');
      assert.equal(response.json.themeColor, '#600e24');
      assert.equal(response.json.participantSpaceEnabled, true);
      assert.equal(new Date(response.json.meetingRequestsOpenAt).toISOString(), '2026-10-01T08:00:00.000Z');
      assert.equal(new Date(response.json.meetingRequestsCloseAt).toISOString(), '2026-12-02T17:00:00.000Z');
      assert.ok(edition.documentId);
    });

    it('donne le premier lieu de l’édition : { name, address }', async () => {
      const { app, request } = espace();
      await createEdition(app, { slug: 'edition-avec-lieu' });
      const { venue } = (await request('/api/espace/editions/edition-avec-lieu')).json;
      assert.deepEqual(venue, { name: 'Salle de recette (lieu fictif)', address: '1 rue de l’Exemple\n33000 Bordeaux' });
    });

    it('donne venue null quand l’édition n’a aucun lieu', async () => {
      const { app, request } = espace();
      await createEdition(app, { slug: 'edition-sans-lieu', settings: { lieux: [] } });
      assert.equal((await request('/api/espace/editions/edition-sans-lieu')).json.venue, null);
    });

    it('reste lisible quand l’espace est fermé, et le dit (participantSpaceEnabled false, NF-52)', async () => {
      const { app, request } = espace();
      await createEdition(app, { slug: 'edition-fermee', enabled: false });
      const response = await request('/api/espace/editions/edition-fermee');
      assert.equal(response.status, 200);
      assert.equal(response.json.participantSpaceEnabled, false);
    });

    it('n’expose aucun réglage privé : ni HelloAsso, ni tables, ni durée de créneau', async () => {
      const { app, request } = espace();
      await createEdition(app, { slug: 'edition-reglages' });
      const { text, status } = await request('/api/espace/editions/edition-reglages');
      assert.equal(status, 200);
      for (const field of ['helloassoOrgSlug', 'helloassoFormSlug', 'helloassoFieldMap', 'slotDurationMinutes', 'tablesCount', 'xylofutur-test']) {
        assert.ok(!text.includes(field), `« ${field} » exposé`);
      }
    });

    it('répond 404 EDITION_NOT_FOUND pour une édition inconnue, avec un message en français', async () => {
      const { request } = espace();
      const response = await request('/api/espace/editions/edition-inconnue');
      assert.equal(response.status, 404);
      assert.equal(response.json.error.code, 'EDITION_NOT_FOUND');
      assert.ok(response.json.error.message.length > 0);
    });

    it('répond 404 pour une édition qui n’est pas publiée (brouillon seulement)', async () => {
      const { app, request } = espace();
      await createEdition(app, { slug: 'edition-brouillon', draft: true });
      const response = await request('/api/espace/editions/edition-brouillon');
      assert.equal(response.status, 404);
      assert.equal(response.json.error.code, 'EDITION_NOT_FOUND');
    });

    it('répond 404, jamais 500, pour un identifiant au contenu hostile', async () => {
      const { app, request } = espace();
      await createEdition(app, { slug: 'edition-pour-hostiles' });
      assert.equal((await request('/api/espace/editions/edition-pour-hostiles')).status, 200, 'la route doit exister');
      for (const slug of ["'%20OR%201=1--", '%3Cscript%3E', '..%2F..%2Fetc', 'a'.repeat(300)]) {
        const response = await request(`/api/espace/editions/${slug}`);
        assert.equal(response.status, 404, slug);
      }
    });

    it('ne demande ni session ni Origin pour une lecture (GET)', async () => {
      const { app, request } = espace();
      await createEdition(app, { slug: 'edition-lecture' });
      assert.equal((await request('/api/espace/editions/edition-lecture', { origin: null })).status, 200);
    });
  });

  describe('API publique du site : aucun champ de l’espace n’y apparaît (critère 3 du lot 2)', pending('lot 2'), () => {
    const hasPrivateFields = (app) => PRIVATE_FIELDS.filter((field) => app.contentTypes['api::edition.edition'].attributes[field]?.private === true);

    it('/api/editions n’expose aucun des 9 champs ajoutés à edition', async () => {
      const { app, request } = espace();
      assert.deepEqual(hasPrivateFields(app), PRIVATE_FIELDS, 'les 9 champs doivent exister et être privés');
      await createEdition(app, { slug: 'edition-site-public' });
      const response = await request('/api/editions?populate=*&pagination[pageSize]=100');
      assert.equal(response.status, 200);
      const edition = response.json.data.find((candidate) => candidate.slug === 'edition-site-public');
      assert.ok(edition, 'édition créée absente de la liste publique');
      assert.deepEqual(PRIVATE_FIELDS.filter((field) => field in edition), []);
    });

    it('/api/editions/:documentId n’expose pas non plus ces champs', async () => {
      const { app, request } = espace();
      assert.deepEqual(hasPrivateFields(app), PRIVATE_FIELDS, 'les 9 champs doivent exister et être privés');
      const edition = await createEdition(app, { slug: 'edition-site-public-2' });
      const response = await request(`/api/editions/${edition.documentId}`);
      assert.equal(response.status, 200);
      assert.deepEqual(PRIVATE_FIELDS.filter((field) => field in response.json.data), []);
    });

    it('/api/sequences expose kind', async () => {
      const { app, request } = espace();
      const edition = await createEdition(app, { slug: 'edition-sequences' });
      await createProgram(app, edition);
      const response = await request('/api/sequences?filters[edition][slug][$eq]=edition-sequences&pagination[pageSize]=100');
      assert.equal(response.status, 200);
      assert.equal(response.json.data.length, 9);
      assert.deepEqual(response.json.data.map((sequence) => sequence.kind).filter((kind) => kind === 'b2b_break').length, 3);
    });
  });

  describe('contrôle de l’en-tête Origin des écritures (NF-04, A-05)', pending('lot 2'), () => {
    // Route d’écriture livrée par le lot 2. Le contrôle précède la session : une origine refusée donne 403 avant tout 401.
    const WRITE = '/api/espace/admin/edition-origine/slots/regenerate';

    it('sans Origin : 403 ORIGIN_REFUSED', async () => {
      const response = await espace().request(WRITE, { method: 'POST', origin: null });
      assert.equal(response.status, 403);
      assert.equal(response.json.error.code, 'ORIGIN_REFUSED');
      assert.ok(response.json.error.message.length > 0);
    });

    for (const origin of ['https://evil.example.org', 'null', `${FRONT}.evil.example.org`, 'http://localhost:43210', 'http://localhost:4322', 'https://journees.example.org:8443']) {
      it(`Origin ${origin} : 403 ORIGIN_REFUSED`, async () => {
        const response = await espace().request(WRITE, { method: 'POST', origin });
        assert.equal(response.status, 403);
        assert.equal(response.json.error.code, 'ORIGIN_REFUSED');
      });
    }

    for (const origin of [FRONT, SECOND_FRONT]) {
      it(`Origin ${origin} (dans CORS_ORIGINS) : le contrôle passe, la route demande ensuite une session (401)`, async () => {
        const response = await espace().request(WRITE, { method: 'POST', origin });
        assert.equal(response.status, 401);
        assert.equal(response.json.error.code, 'UNAUTHENTICATED');
      });
    }

    it('vaut pour toute méthode d’écriture, formulaire HTML compris', async () => {
      const { request } = espace();
      const form = await request(WRITE, { method: 'POST', origin: null, form: { x: '1' } });
      assert.equal(form.status, 403);
      assert.equal(form.json.error.code, 'ORIGIN_REFUSED');
    });

    it('ne s’applique pas aux lectures : GET sans Origin sur une route du lot 2', async () => {
      const { app, request } = espace();
      await createEdition(app, { slug: 'edition-lecture-sans-origin' });
      assert.equal((await request('/api/espace/editions/edition-lecture-sans-origin', { origin: null })).status, 200);
      assert.equal((await request('/api/espace/health', { origin: null })).status, 200);
    });

    it('n’écrit rien quand l’origine est refusée', async () => {
      const { app, request } = espace();
      const before = await app.documents(UID.slot).count({});
      await request(WRITE, { method: 'POST', origin: 'https://evil.example.org' });
      assert.equal(await app.documents(UID.slot).count({}), before);
    });
  });

  describe('CORS restreint aux origines du front, avec cookies (A-05, critère 7 du lot 2)', pending('lot 2'), () => {
    const preflight = (path, origin, method = 'POST') =>
      espace().request(path, { method: 'OPTIONS', origin, headers: { 'access-control-request-method': method, 'access-control-request-headers': 'content-type' } });

    for (const origin of ['https://evil.example.org', 'http://localhost:4322', 'null']) {
      it(`refuse le préflight de ${origin} : l’origine n’est pas renvoyée`, async () => {
        const response = await preflight('/api/espace/auth/request-link', origin);
        const allowed = response.headers.get('access-control-allow-origin');
        assert.ok(allowed !== origin && allowed !== '*', `access-control-allow-origin : ${allowed}`);
      });
    }

    it('ne renvoie aucune autorisation CORS à une lecture venue d’un autre site', async () => {
      const response = await espace().request('/api/espace/health', { origin: 'https://evil.example.org' });
      const allowed = response.headers.get('access-control-allow-origin');
      assert.ok(allowed !== 'https://evil.example.org' && allowed !== '*', `access-control-allow-origin : ${allowed}`);
    });
  });

  // Acquis déjà vrais (Strapi renvoie l'origine reçue) qui doivent le rester quand le lot 2 restreint CORS : tests actifs.
  describe('CORS : les origines du front restent admises, avec cookies (A-05, critère 7 du lot 2)', () => {
    const preflight = (path, origin, method = 'POST') =>
      espace().request(path, { method: 'OPTIONS', origin, headers: { 'access-control-request-method': method, 'access-control-request-headers': 'content-type' } });

    for (const origin of [FRONT, SECOND_FRONT]) {
      it(`accepte le préflight de ${origin} avec credentials`, async () => {
        const response = await preflight('/api/espace/auth/request-link', origin);
        assert.ok([200, 204].includes(response.status), `statut ${response.status}`);
        assert.equal(response.headers.get('access-control-allow-origin'), origin);
        assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
      });
    }

    it('renvoie l’origine admise, avec credentials, sur une lecture', async () => {
      const response = await espace().request('/api/espace/health', { origin: FRONT });
      assert.equal(response.headers.get('access-control-allow-origin'), FRONT);
      assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    });

    it('le formulaire de contact du site (même origine, localhost:4321) garde son préflight', async () => {
      const response = await preflight('/api/contact/send', FRONT);
      assert.equal(response.headers.get('access-control-allow-origin'), FRONT);
    });

    it('la newsletter du site garde aussi son préflight depuis le front local', async () => {
      const response = await preflight('/api/newsletter/subscribe', FRONT);
      assert.equal(response.headers.get('access-control-allow-origin'), FRONT);
    });
  });

  describe('erreurs : format de 06-api.md et journal structuré (NF-50, critère 6 du lot 2)', pending('lot 2'), () => {
    /** Coupe l'accès à la base le temps de `fn`, pour provoquer une erreur inattendue (500) sans toucher au code de l'espace. */
    async function withBrokenDatabase(app, fn) {
      const client = app.db.connection.client;
      client.acquireConnection = () => Promise.reject(new Error('connexion coupée par le test'));
      try {
        return await fn();
      } finally {
        delete client.acquireConnection;
      }
    }

    /** Remplace les méthodes du journal par un enregistreur pendant `fn`, puis les rétablit. */
    async function captureLog(app, fn) {
      const lines = [];
      const flatten = (argument) => {
        if (argument instanceof Error) return `${argument.message}\n${argument.stack}`;
        if (typeof argument === 'object') return JSON.stringify(argument, (_, value) => (value instanceof Error ? `${value.message}\n${value.stack}` : value));
        return String(argument);
      };
      const saved = {};
      for (const level of ['error', 'warn', 'info', 'http', 'debug']) {
        saved[level] = { own: Object.hasOwn(app.log, level), value: app.log[level] };
        app.log[level] = (...args) => lines.push({ level, text: args.map(flatten).join(' ') });
      }
      try {
        return { result: await fn(), lines };
      } finally {
        for (const [level, { own, value }] of Object.entries(saved)) {
          if (own) app.log[level] = value;
          else delete app.log[level];
        }
      }
    }

    it('une erreur inattendue donne 500 { error: { code: INTERNAL, message, requestId } }', async () => {
      const { app, request } = espace();
      const response = await withBrokenDatabase(app, () => request('/api/espace/editions/une-edition'));
      assert.equal(response.status, 500);
      assert.equal(response.json.error.code, 'INTERNAL');
      assert.ok(typeof response.json.error.message === 'string' && response.json.error.message.length > 0, 'message affichable');
      assert.ok(typeof response.json.error.requestId === 'string' && response.json.error.requestId.length >= 8, 'identifiant de requête');
    });

    it('ne divulgue ni la cause interne ni la pile dans la réponse', async () => {
      const { app, request } = espace();
      const response = await withBrokenDatabase(app, () => request('/api/espace/editions/une-edition'));
      assert.equal(response.status, 500);
      assert.ok(!response.text.includes('connexion coupée par le test'), 'cause interne exposée');
      assert.ok(!/\bat\s+\S+\s+\(.*:\d+:\d+\)/.test(response.text), 'pile exposée');
    });

    it('donne un identifiant de requête différent à chaque erreur', async () => {
      const { app, request } = espace();
      const [first, second] = await withBrokenDatabase(app, () => Promise.all([request('/api/espace/editions/a'), request('/api/espace/editions/b')]));
      assert.notEqual(first.json.error.requestId, second.json.error.requestId);
    });

    it('écrit une ligne de journal qui porte l’identifiant de requête et la cause', async () => {
      const { app, request } = espace();
      const { result, lines } = await captureLog(app, () => withBrokenDatabase(app, () => request('/api/espace/editions/une-edition')));
      const { requestId } = result.json.error;
      const line = lines.find((entry) => entry.text.includes(requestId));
      assert.ok(line, `aucune ligne de journal ne porte ${requestId} : ${JSON.stringify(lines)}`);
      assert.ok(['error', 'warn'].includes(line.level), `niveau ${line.level}`);
      assert.ok(line.text.includes('connexion coupée par le test'), 'la cause doit figurer dans le journal, pas dans la réponse');
    });

    it('ne consigne aucun cookie ni jeton dans le journal des erreurs (NF-06)', async () => {
      const { app, request } = espace();
      const { result, lines } = await captureLog(app, () =>
        withBrokenDatabase(app, () => request('/api/espace/editions/une-edition', { cookie: 'jib_espace=SECRET-DE-SESSION; jib_espace.sig=SIGNATURE-SECRETE' }))
      );
      assert.equal(result.status, 500);
      assert.ok(lines.length > 0, 'l’erreur doit être journalisée');
      assert.ok(!lines.some((entry) => /SECRET-DE-SESSION|SIGNATURE-SECRETE/.test(entry.text)));
    });

    it('une erreur prévue garde son propre statut et son code : jamais INTERNAL', async () => {
      const { request } = espace();
      const missing = await request('/api/espace/editions/introuvable');
      assert.equal(missing.status, 404);
      assert.notEqual(missing.json.error.code, 'INTERNAL');
      const anonymous = await request('/api/espace/admin/x/slots/regenerate', { method: 'POST' });
      assert.equal(anonymous.status, 401);
      assert.equal(anonymous.json.error.code, 'UNAUTHENTICATED');
    });

    it('toute erreur de l’espace suit { error: { code, message } } avec un code en majuscules', async () => {
      const { request } = espace();
      for (const response of [await request('/api/espace/editions/introuvable'), await request('/api/espace/admin/x/slots/regenerate', { method: 'POST', origin: null })]) {
        assert.deepEqual(Object.keys(response.json), ['error']);
        assert.match(response.json.error.code, /^[A-Z_]+$/);
        assert.equal(typeof response.json.error.message, 'string');
      }
    });
  });

  describe('configuration câblée dans Strapi démarré (A-04, A-05, A-08, I-23)', pending('lot 2'), () => {
    it('lit PUBLIC_URL, ORGANIZER_EMAILS et CORS_ORIGINS de l’environnement', () => {
      const { app, env } = espace();
      assert.equal(app.config.get('server.espace.publicUrl'), env.PUBLIC_URL);
      assert.deepEqual(app.config.get('server.espace.organizerEmails'), ['organisation@example.org']);
      assert.deepEqual(app.config.get('server.espace.corsOrigins'), [FRONT, SECOND_FRONT]);
    });

    it('lit l’IP du client dans X-Forwarded-For (IS_PROXIED=true), la dernière entrée seulement', () => {
      const { app } = espace();
      assert.equal(app.config.get('server.proxy.koa'), true);
      assert.equal(app.config.get('server.proxy.maxIpsCount'), 1);
    });

    it('n’a aucun identifiant HelloAsso : HELLOASSO_* sont vides dans les tests sans faux', () => {
      const { app } = espace();
      const helloasso = app.config.get('server.helloasso');
      assert.ok(helloasso, 'section server.helloasso absente');
      assert.ok(!helloasso.apiBase && !helloasso.clientId && !helloasso.clientSecret);
    });
  });

  // Déjà vrai (Strapi coupe `cron` par défaut) et à conserver quand le lot 4 y branche les tâches de l'espace : test actif.
  describe('tâches planifiées de l’espace : coupées avec CRON_ENABLED=false (A-08)', () => {
    it('n’enregistre aucune tâche planifiée de l’espace avec CRON_ENABLED=false', () => {
      const { app } = espace();
      assert.equal(app.config.get('server.cron.enabled'), false);
      // Strapi enregistre ses propres tâches (métriques) même cron coupé : seules celles de l'espace comptent.
      const rules = app.cron.jobs.map(({ options }) => (typeof options === 'string' ? options : options?.rule));
      assert.ok(!rules.includes('*/15 * * * *') && !rules.includes('0 4 * * *'), `tâches de l’espace enregistrées : ${rules}`);
    });
  });

  describe('socle partagé : services du lot 2 (A-20)', pending('lot 2'), () => {
    it('expose les services editions, tokens et mailer', () => {
      const { app } = espace();
      for (const name of ['editions', 'tokens', 'mailer']) assert.ok(app.service(`api::espace.${name}`), `api::espace.${name}`);
    });

    it('editions.findPublished rend l’édition publiée avec ses champs privés, null pour une absente ou un brouillon', async () => {
      const { app } = espace();
      await createEdition(app, { slug: 'edition-service' });
      await createEdition(app, { slug: 'edition-service-brouillon', draft: true });
      const service = app.service('api::espace.editions');
      const found = await service.findPublished('edition-service');
      assert.equal(found.slug, 'edition-service');
      assert.equal(found.helloassoOrgSlug, 'xylofutur-test');
      assert.equal(found.participantSpaceEnabled, true);
      assert.ok(!(await service.findPublished('edition-service-brouillon')));
      assert.ok(!(await service.findPublished('edition-inexistante')));
    });

    it('tokens.issueLink ne stocke que l’empreinte SHA-256 du jeton et rend le jeton en clair (I-20)', async () => {
      const { app } = espace();
      const edition = await createEdition(app, { slug: 'edition-jetons' });
      const attendee = await createAttendee(app, edition);
      const now = new Date('2026-10-29T10:00:00.000Z');
      const token = await app.service('api::espace.tokens').issueLink(attendee.documentId, { ttlMinutes: 30, ip: '10.9.9.9', now });
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
      const rows = await app.db.query(UID.magicToken).findMany({ where: { attendee: { documentId: attendee.documentId } } });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].kind, 'link');
      assert.equal(rows[0].tokenHash, require('node:crypto').createHash('sha256').update(token).digest('hex'));
      assert.equal(new Date(rows[0].expiresAt).toISOString(), '2026-10-29T10:30:00.000Z');
      assert.ok(!JSON.stringify(rows).includes(token), 'jeton en clair stocké');
    });
  });
});
