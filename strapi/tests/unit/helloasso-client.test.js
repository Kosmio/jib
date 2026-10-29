'use strict';

/**
 * lib/helloasso.js (I-10, I-11, I-13, NF-06) : client de l'API HelloAsso v5 contre le faux HelloAsso démarré en module
 * (localhost, port libre). Jeton gardé jusqu'à expires_in - 60 s, un seul nouvel essai sur 401, pagination par jeton de
 * continuation jusqu'à `data: []` (50 pages au plus, 100 billets par page), erreurs sans secret ni jeton.
 *
 * `listFormItems` renvoie le tableau des billets. Les requêtes passent par un `fetch` enregistreur injecté.
 * Tests d'abord du lot 4 : le module est requis dans chaque test.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { startFakeHelloAsso, buildEdgeCaseItems, FORM } = require('../../scripts/espace/fake-helloasso');
const defaultItems = require('../../scripts/espace/fixtures/helloasso-items.json');
const { pending } = require('../helpers/pending');

const lib = () => require('../../src/api/espace/lib/helloasso');

const CLIENT_ID = 'id-client-essai';
const CLIENT_SECRET = 's3cret-client-essai';
const FORM_ARGS = { organizationSlug: FORM.organizationSlug, formType: FORM.formType, formSlug: FORM.formSlug };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const urlOf = (input) => (input instanceof Request ? input.url : String(input));

/** `fetch` enregistreur : `override(url, init, nth)` peut renvoyer une Response de substitution, sinon la requête part vers le faux. */
function recordingFetch(override) {
  const calls = [];
  const wrapped = async (input, init) => {
    const url = new URL(urlOf(input));
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    calls.push({ url, method: init?.method ?? 'GET', headers, body: init?.body === undefined ? undefined : String(init.body) });
    const replaced = override?.(url, calls.length);
    return replaced ?? fetch(input, init);
  };
  wrapped.calls = calls;
  wrapped.items = () => calls.filter((call) => call.url.pathname.endsWith('/items'));
  wrapped.tokens = () => calls.filter((call) => call.url.pathname.endsWith('/oauth2/token'));
  return wrapped;
}

const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('client HelloAsso contre le faux (I-10, I-11)', pending('lot 4', { timeout: 60_000 }), () => {
  let fake;
  const make = (fetchImpl, options = {}) =>
    lib().createHelloAssoClient({ apiBase: fake.apiBase, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, fetch: fetchImpl, ...options });

  afterEach(async () => {
    await fake?.close();
    fake = undefined;
  });

  describe('jeton (I-10)', () => {
    beforeEach(async () => {
      fake = await startFakeHelloAsso();
    });

    it('demande le jeton sur {origine de apiBase}/oauth2/token en client_credentials, puis l’envoie en Bearer', async () => {
      const spy = recordingFetch();
      await make(spy).listFormItems(FORM_ARGS);
      const [tokenCall] = spy.tokens();
      assert.equal(tokenCall.method, 'POST');
      assert.equal(tokenCall.url.origin, fake.origin);
      assert.equal(tokenCall.url.pathname, '/oauth2/token');
      const form = new URLSearchParams(tokenCall.body);
      assert.equal(form.get('grant_type'), 'client_credentials');
      assert.equal(form.get('client_id'), CLIENT_ID);
      assert.equal(form.get('client_secret'), CLIENT_SECRET);
      assert.match(spy.items()[0].headers.get('authorization'), /^Bearer [0-9a-f]{20,}$/i);
    });

    it('garde le jeton entre deux appels : une seule demande de jeton', async () => {
      const client = make(recordingFetch());
      await client.listFormItems(FORM_ARGS);
      await client.listFormItems(FORM_ARGS);
      await client.getOrder(defaultItems[0].order.id);
      assert.equal(fake.stats().tokenRequests, 1);
    });

    it('garde le jeton jusqu’à expires_in moins 60 s : un jeton de 30 minutes survit à 1,2 s', async () => {
      const client = make(recordingFetch());
      await client.listFormItems(FORM_ARGS);
      await sleep(1200);
      await client.listFormItems(FORM_ARGS);
      assert.equal(fake.stats().tokenRequests, 1);
    });

    it('redemande un jeton quand le cache expire : expires_in 61 s ramène le cache à 1 s', async () => {
      await fake.close();
      fake = await startFakeHelloAsso({ tokenTtlSeconds: 61 });
      const client = make(recordingFetch());
      await client.listFormItems(FORM_ARGS);
      assert.equal(fake.stats().tokenRequests, 1);
      await sleep(1200);
      await client.listFormItems(FORM_ARGS);
      assert.equal(fake.stats().tokenRequests, 2);
    });

    it('sur une réponse 401, renouvelle le jeton et réessaie une fois : la liste est rendue', async () => {
      const spy = recordingFetch((url) => (url.pathname.endsWith('/items') && spy.items().length === 1 ? jsonResponse(401, { message: 'Authorization has been denied for this request.' }) : undefined));
      const items = await make(spy).listFormItems(FORM_ARGS);
      assert.equal(items.length, defaultItems.length);
      assert.equal(fake.stats().tokenRequests, 2);
    });

    it('ne réessaie qu’une fois : deux 401 de suite donnent HelloAssoError 401', async () => {
      const spy = recordingFetch((url) => (url.pathname.endsWith('/items') ? jsonResponse(401, { message: 'refusé' }) : undefined));
      await assert.rejects(make(spy).listFormItems(FORM_ARGS), (error) => {
        assert.equal(error.status, 401);
        assert.ok([error.name, error.constructor.name].includes('HelloAssoError'), `${error.name} / ${error.constructor.name}`);
        return true;
      });
      assert.equal(spy.items().length, 2, 'un essai plus un seul nouvel essai');
      assert.equal(fake.stats().tokenRequests, 2);
    });
  });

  describe('billets (I-11)', () => {
    beforeEach(async () => {
      fake = await startFakeHelloAsso();
    });

    it('renvoie les 17 billets du jeu de recette, avec leurs champs personnalisés (withDetails=true)', async () => {
      const items = await make(recordingFetch()).listFormItems(FORM_ARGS);
      assert.ok(Array.isArray(items));
      assert.deepEqual(items.map((item) => item.id).sort(), defaultItems.map((item) => item.id).sort());
      assert.ok(items.find((item) => item.id === 100001).customFields.some((field) => field.name === 'Email'));
    });

    it('demande les billets du bon formulaire avec withDetails=true et pageSize=100', async () => {
      const spy = recordingFetch();
      await make(spy).listFormItems(FORM_ARGS);
      const [first] = spy.items();
      assert.equal(first.url.pathname, `/v5/organizations/${FORM.organizationSlug}/forms/${FORM.formType}/${FORM.formSlug}/items`);
      assert.equal(first.url.searchParams.get('withDetails'), 'true');
      assert.equal(first.url.searchParams.get('pageSize'), '100');
      assert.equal(first.url.searchParams.get('continuationToken'), null);
    });

    it('lit toutes les pages : plus de 100 billets (buildEdgeCaseItems avec 120 de remplissage), sans doublon', async () => {
      fake.setItems(buildEdgeCaseItems({ padding: 120 }));
      const spy = recordingFetch();
      const items = await make(spy).listFormItems(FORM_ARGS);
      assert.equal(items.length, buildEdgeCaseItems({ padding: 120 }).length);
      assert.equal(new Set(items.map((item) => item.id)).size, items.length);
      const requests = spy.items();
      assert.ok(requests.length >= 2 && requests.length <= 3, `${requests.length} requêtes de billets`);
      assert.ok(requests.slice(1).every((call) => call.url.searchParams.get('continuationToken')), 'jeton de continuation sur les pages suivantes');
      assert.ok(requests.every((call) => call.url.searchParams.get('pageSize') === '100'));
    });

    it('s’arrête au bout de 50 pages même si le serveur en promet toujours une de plus', async () => {
      const endless = recordingFetch((url) =>
        url.pathname.endsWith('/items')
          ? jsonResponse(200, { data: [{ id: 1, order: { id: 1 }, user: {}, payer: {}, state: 'Processed', customFields: [] }], pagination: { continuationToken: `page-${Math.random()}` } })
          : undefined
      );
      await make(endless).listFormItems(FORM_ARGS).catch(() => undefined);
      assert.ok(endless.items().length <= 50, `${endless.items().length} pages demandées`);
      assert.ok(endless.items().length >= 2, 'doit au moins suivre le jeton de continuation');
    });

    it('rend une commande avec ses billets (getOrder, I-13)', async () => {
      const [item] = defaultItems;
      const order = await make(recordingFetch()).getOrder(item.order.id);
      assert.ok(order.items.some((candidate) => candidate.id === item.id));
    });
  });

  describe('erreurs : HelloAssoError, sans secret ni jeton (NF-06)', () => {
    beforeEach(async () => {
      fake = await startFakeHelloAsso();
    });

    it('formulaire inconnu : HelloAssoError 404', async () => {
      await assert.rejects(make(recordingFetch()).listFormItems({ ...FORM_ARGS, formSlug: 'formulaire-inconnu' }), (error) => {
        assert.equal(error.status, 404);
        assert.ok([error.name, error.constructor.name].includes('HelloAssoError'));
        return true;
      });
    });

    it('commande inconnue : HelloAssoError 404', async () => {
      await assert.rejects(make(recordingFetch()).getOrder(999999999), (error) => error.status === 404);
    });

    it('le message d’erreur ne contient ni le secret du client ni le jeton d’accès', async () => {
      const spy = recordingFetch();
      const client = make(spy);
      await client.listFormItems(FORM_ARGS);
      const token = spy.items()[0].headers.get('authorization').replace(/^Bearer /i, '');
      await assert.rejects(client.listFormItems({ ...FORM_ARGS, formSlug: 'formulaire-inconnu' }), (error) => {
        for (const secret of [CLIENT_SECRET, token]) {
          assert.ok(!error.message.includes(secret), 'secret dans le message');
          assert.ok(!String(error.stack).includes(secret), 'secret dans la pile');
        }
        return true;
      });
    });

    it('un refus du jeton (400) donne HelloAssoError sans le secret du client', async () => {
      const spy = recordingFetch((url) => (url.pathname.endsWith('/oauth2/token') ? jsonResponse(400, { error: 'invalid_client', error_description: `secret ${CLIENT_SECRET} refusé` }) : undefined));
      await assert.rejects(make(spy).listFormItems(FORM_ARGS), (error) => {
        assert.equal(error.status, 400);
        assert.ok(!error.message.includes(CLIENT_SECRET), `secret dans le message : ${error.message}`);
        return true;
      });
    });
  });
});
