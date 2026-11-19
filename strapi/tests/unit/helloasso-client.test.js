'use strict';

/**
 * lib/helloasso.js (I-10, I-11, I-13, NF-06) : client de l'API HelloAsso v5 contre le faux HelloAsso démarré en module
 * (localhost, port libre). Jeton gardé jusqu'à expires_in - 60 s, un seul nouvel essai sur 401, pagination par jeton de
 * continuation jusqu'à `data: []` (50 pages au plus, 100 billets par page), erreurs sans secret ni jeton.
 *
 * `listFormItems` renvoie le tableau des billets. Les requêtes passent par un `fetch` enregistreur injecté.
 * Délai de réponse (`timeoutMs`, défaut 20 s, lot 6b) : chaque requête, jeton compris, est abandonnée au bout du délai et
 * donne une HelloAssoError sans `status`, comme un HelloAsso injoignable. Ces tests n'ouvrent aucune connexion : le `fetch` est simulé.
 */

const { after, afterEach, before, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { startFakeHelloAsso, buildEdgeCaseItems, FORM } = require('../../scripts/espace/fake-helloasso');
const defaultItems = require('../../scripts/espace/fixtures/helloasso-items.json');

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

describe('client HelloAsso contre le faux (I-10, I-11)', { timeout: 60_000 }, () => {
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

/** `fetch` qui ne répond jamais, sauf par l'abandon de la requête : il rejette alors avec la raison du signal. Sans signal, il reste suspendu. */
function hangingFetch({ token = false } = {}) {
  const calls = [];
  const wrapped = (input, init) => {
    const url = new URL(urlOf(input));
    calls.push({ url, init });
    if (token && url.pathname.endsWith('/oauth2/token')) return Promise.resolve(jsonResponse(200, { access_token: 'jeton-factice-0123456789abcdef', expires_in: 1800, token_type: 'bearer' }));
    return new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  };
  wrapped.calls = calls;
  return wrapped;
}

/** La promesse, ou une erreur claire si elle reste suspendue au-delà de `ms` (requête jamais abandonnée). */
async function within(promise, ms = 3000) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`requête non abandonnée après ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
}

describe('délai de réponse : chaque requête est abandonnée après timeoutMs (lot 6b, section 11 du plan, point 7)', { timeout: 20_000 }, () => {
  // `AbortSignal.timeout` n'a qu'un minuteur non retenant : avec un `fetch` simulé suspendu, rien d'autre ne garderait la boucle
  // d'événements active et le processus sortirait sans rien afficher. Ce minuteur la garde active pendant le groupe.
  let keepAlive;
  before(() => {
    keepAlive = setInterval(() => {}, 1000);
  });
  after(() => clearInterval(keepAlive));

  const APIBASE = 'http://localhost:9/v5';
  const make = (fetchImpl, options = {}) => lib().createHelloAssoClient({ apiBase: APIBASE, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, fetch: fetchImpl, ...options });
  const unreachable = (error) => {
    assert.ok([error.name, error.constructor.name].includes('HelloAssoError'), `${error.name} / ${error.constructor.name}`);
    assert.equal(error.status, undefined, 'un dépassement de délai n’a pas de statut HTTP');
    assert.ok(!error.message.includes(CLIENT_SECRET), 'secret du client dans le message');
    return true;
  };

  it('jeton qui ne répond pas : HelloAssoError sans status après timeoutMs', async () => {
    await assert.rejects(within(make(hangingFetch(), { timeoutMs: 80 }).listFormItems(FORM_ARGS)), unreachable);
  });

  it('billets qui ne répondent pas alors que le jeton est obtenu : HelloAssoError sans status', async () => {
    const fetchImpl = hangingFetch({ token: true });
    await assert.rejects(within(make(fetchImpl, { timeoutMs: 80 }).listFormItems(FORM_ARGS)), unreachable);
    assert.equal(fetchImpl.calls.length, 2, 'une demande de jeton, puis une demande de billets');
  });

  it('commande qui ne répond pas (getOrder) : HelloAssoError sans status', async () => {
    await assert.rejects(within(make(hangingFetch({ token: true }), { timeoutMs: 80 }).getOrder(123)), unreachable);
  });

  it('la demande de jeton et celle des billets reçoivent chacune un signal d’abandon', async () => {
    const fetchImpl = hangingFetch({ token: true });
    await within(make(fetchImpl, { timeoutMs: 50 }).listFormItems(FORM_ARGS)).catch(() => undefined);
    assert.equal(fetchImpl.calls.length, 2);
    for (const { url, init } of fetchImpl.calls) assert.ok(init?.signal instanceof AbortSignal, `aucun signal sur ${url.pathname}`);
  });

  it('sans timeoutMs, un délai par défaut s’applique tout de même : signal fourni, pas encore abandonné', async () => {
    const fetchImpl = hangingFetch({ token: true });
    const pendingCall = make(fetchImpl).listFormItems(FORM_ARGS).catch(() => undefined);
    await sleep(50);
    const [first] = fetchImpl.calls;
    assert.ok(first.init?.signal instanceof AbortSignal, 'aucun signal par défaut');
    assert.equal(first.init.signal.aborted, false);
    for (const { init } of fetchImpl.calls) init?.signal?.dispatchEvent?.(new Event('abort')); // libère la promesse suspendue
    await Promise.race([pendingCall, sleep(100)]);
  });

  it('une réponse plus rapide que le délai n’est pas abandonnée', async () => {
    const quick = (input) => {
      const url = new URL(urlOf(input));
      return sleep(20).then(() => (url.pathname.endsWith('/oauth2/token') ? jsonResponse(200, { access_token: 'jeton-factice-0123456789abcdef', expires_in: 1800 }) : jsonResponse(200, { data: [] })));
    };
    assert.deepEqual(await make(quick, { timeoutMs: 2000 }).listFormItems(FORM_ARGS), []);
  });

  it('un HelloAsso qui refuse la connexion donne aussi une HelloAssoError sans status (régression : injoignable)', async () => {
    const refusing = () => Promise.reject(new TypeError('fetch failed'));
    await assert.rejects(make(refusing).listFormItems(FORM_ARGS), unreachable);
  });
});
