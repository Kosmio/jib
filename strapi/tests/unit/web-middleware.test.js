'use strict';

/**
 * web/src/middleware.ts (NF-07, A-24) : en-têtes de sécurité des pages de l'espace, et d'elles seules.
 *
 * Le middleware est un module TypeScript d'Astro (`astro:middleware`, `lib/espace/api`). Il est chargé tel quel par Node
 * (suppression des types), les deux importations propres à Astro étant remplacées par des modules d'essai : aucun serveur,
 * aucun navigateur. Le parcours complet dans un navigateur (POST du formulaire de vérification accepté) est un test e2e du lot 7.
 *
 *   - NF-07 : CSP sans origine tierce, `nosniff`, `Cache-Control: private, no-store` sous `/espace`, rien ailleurs ;
 *   - F-107, NF-50 (V1-E) : une exception levée par `next()` sous `/espace` est réécrite vers `/espace/erreur` (503 pour un délai ou une
 *     erreur réseau, 500 sinon), avec identifiant de requête et édition de l'URL dans `locals` ; en-têtes de sécurité conservés ;
 *     hors `/espace`, l'exception remonte inchangée ; F-108 : `locals.espaceEdition` ;
 *   - A-24 : `/espace/verifier` répond `Referrer-Policy: strict-origin` (l'URL porte le jeton du lien), les autres pages de
 *     `/espace` gardent `strict-origin-when-cross-origin`, et jamais `no-referrer` : le navigateur enverrait `Origin: null`
 *     avec le POST du formulaire, que Strapi refuse (`ORIGIN_REFUSED`).
 */

const { before, describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const module_ = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MIDDLEWARE = path.resolve(__dirname, '../../../web/src/middleware.ts');
const SITE = 'https://journees.example.org';
const STRAPI = 'https://strapi.example.org';

const STUBS = {
  'stub:astro-middleware': 'export const defineMiddleware = (handler) => handler;',
  'stub:espace-api': `export const publicStrapiUrl = '${STRAPI}/strapi';`,
};

let onRequest;

before(async () => {
  module_.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'astro:middleware') return { url: 'stub:astro-middleware', format: 'module', shortCircuit: true };
      if (/lib\/espace\/api(\.ts)?$/.test(specifier)) return { url: 'stub:espace-api', format: 'module', shortCircuit: true };
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (STUBS[url]) return { format: 'module', source: STUBS[url], shortCircuit: true };
      return nextLoad(url, context);
    },
  });
  ({ onRequest } = await import(pathToFileURL(MIDDLEWARE).href));
});

/** Contexte d'Astro : `rewrite` rend la page d'erreur avec le statut posé dans `locals.espaceError`, comme erreur.astro. */
function contextFor(pathname, { rewrite } = {}) {
  const context = { url: new URL(`${SITE}${pathname}`), request: { method: 'GET' }, locals: {}, rewritten: [] };
  context.rewrite = rewrite ?? (async (target) => {
    context.rewritten.push(target);
    return new Response('<html>erreur</html>', { status: context.locals.espaceError?.status ?? 200, headers: { 'content-type': 'text/html' } });
  });
  return context;
}

/** Réponse du middleware pour `pathname` ; `next()` rend une réponse neuve, comme Astro. */
async function respond(pathname) {
  const response = new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
  const result = await onRequest(contextFor(pathname), async () => response);
  return { result, response };
}

/** Le rendu de la page lève `error` : réponse du middleware, contexte et lignes de journal. */
async function respondToFailure(pathname, error, options) {
  const context = contextFor(pathname, options);
  const logged = [];
  const spy = mock.method(console, 'error', (line) => logged.push(line));
  try {
    const result = await onRequest(context, async () => {
      throw error;
    });
    return { result, context, logged };
  } finally {
    spy.mock.restore();
  }
}
const header = async (pathname, name) => (await respond(pathname)).result.headers.get(name);

describe('web/src/middleware.ts : en-têtes de l’espace (NF-07)', () => {
  it('se charge tel quel avec Node et exporte onRequest', () => {
    assert.equal(typeof onRequest, 'function');
  });

  for (const pathname of ['/espace', '/espace/', '/espace/nouvelle-aquitaine/connexion', '/espace/nouvelle-aquitaine/', '/espace/verifier?token=abc']) {
    describe(pathname, () => {
      it('pose nosniff et Cache-Control private, no-store', async () => {
        assert.equal(await header(pathname, 'X-Content-Type-Options'), 'nosniff');
        assert.equal(await header(pathname, 'Cache-Control'), 'private, no-store');
      });

      it('pose une CSP sans origine tierce : default-src et font-src \'self\', pas de cadre, Strapi seulement en connect-src et form-action', async () => {
        const csp = await header(pathname, 'Content-Security-Policy');
        assert.match(csp, /default-src 'self'/);
        assert.match(csp, /font-src 'self'/);
        assert.match(csp, /frame-ancestors 'none'/);
        assert.match(csp, new RegExp(`form-action 'self' ${STRAPI}`));
        assert.match(csp, new RegExp(`connect-src 'self' ${STRAPI}`));
        const origins = csp.match(/https?:\/\/[^\s;]+/g) ?? [];
        assert.deepEqual([...new Set(origins)], [STRAPI], `origines de la CSP : ${origins.join(', ')}`);
        assert.doesNotMatch(csp, /google|matomo/i);
      });
    });
  }

  for (const pathname of ['/', '/editions/nouvelle-aquitaine', '/contact', '/espaces', '/espace-public/x', '/api/espace/health']) {
    it(`${pathname} : hors de /espace, la réponse passe sans qu’aucun en-tête de sécurité soit posé`, async () => {
      const { result, response } = await respond(pathname);
      assert.equal(result, response);
      for (const name of ['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy', 'Cache-Control']) {
        assert.equal(result.headers.get(name), null, name);
      }
    });
  }
});

describe('web/src/middleware.ts : Referrer-Policy (A-24)', () => {
  it('/espace/verifier répond strict-origin : le jeton de l’URL ne part pas en Referer', async () => {
    assert.equal(await header('/espace/verifier', 'Referrer-Policy'), 'strict-origin');
  });

  it('/espace/verifier?token=… et /espace/verifier/ répondent aussi strict-origin', async () => {
    assert.equal(await header('/espace/verifier?token=Zm9v&next=%2Fespace%2Fna%2F', 'Referrer-Policy'), 'strict-origin');
    assert.equal(await header('/espace/verifier/', 'Referrer-Policy'), 'strict-origin');
  });

  for (const pathname of ['/espace', '/espace/', '/espace/nouvelle-aquitaine/connexion', '/espace/nouvelle-aquitaine/bienvenue', '/espace/nouvelle-aquitaine/', '/espace/nouvelle-aquitaine/verifier']) {
    it(`${pathname} garde strict-origin-when-cross-origin`, async () => {
      assert.equal(await header(pathname, 'Referrer-Policy'), 'strict-origin-when-cross-origin');
    });
  }

  it('aucune page de l’espace ne répond no-referrer ni same-origin : le POST du formulaire enverrait Origin: null (ORIGIN_REFUSED)', async () => {
    for (const pathname of ['/espace', '/espace/verifier', '/espace/verifier/', '/espace/x/connexion', '/espace/x/bienvenue', '/espace/x/']) {
      const policy = await header(pathname, 'Referrer-Policy');
      assert.ok(policy && !['no-referrer', 'same-origin'].includes(policy), `${pathname} : ${policy}`);
    }
  });

  it('la politique de /espace/verifier envoie au moins l’origine : le contrôle Origin de Strapi voit une origine, jamais null', async () => {
    const policy = await header('/espace/verifier', 'Referrer-Policy');
    assert.ok(['strict-origin', 'strict-origin-when-cross-origin', 'origin', 'origin-when-cross-origin'].includes(policy), String(policy));
  });
});

const ERREUR = '/espace/nouvelle-aquitaine/agenda';
const networkError = (code) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect'), { code }) });

describe('web/src/middleware.ts : page d’erreur de l’espace (F-107, NF-50)', () => {
  const unavailable = {
    'TimeoutError (AbortSignal.timeout)': Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }),
    'AbortError': Object.assign(new Error('aborted'), { name: 'AbortError' }),
    'TypeError « fetch failed » (Strapi arrêté)': networkError('ECONNREFUSED'),
    'TypeError « fetch failed » sans code': new TypeError('fetch failed'),
    'code ECONNREFUSED porté par l’erreur': Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    'code ENOTFOUND dans cause': Object.assign(new Error('x'), { cause: { code: 'ENOTFOUND' } }),
    'code UND_ERR_CONNECT_TIMEOUT dans cause': Object.assign(new Error('x'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }),
    'message d’api.ts « : 502 »': new Error('GET /editions/na : 502'),
    'message d’api.ts « : 503 »': new Error('GET /editions/na : 503'),
    'message d’api.ts « : 504 »': new Error('GET /editions/na : 504'),
  };
  for (const [label, error] of Object.entries(unavailable)) {
    it(`${label} : réécriture vers /espace/erreur, statut 503`, async () => {
      const { result, context } = await respondToFailure(ERREUR, error);
      assert.deepEqual(context.rewritten, ['/espace/erreur']);
      assert.equal(context.locals.espaceError.status, 503);
      assert.equal(result.status, 503);
    });
  }

  const internal = {
    'Error quelconque': new Error('boom'),
    'TypeError ordinaire': new TypeError('Cannot read properties of undefined'),
    'message d’api.ts « : 500 »': new Error('GET /editions/na : 500'),
    'message d’api.ts « : 404 »': new Error('GET /editions/na : 404'),
    'message qui contient 502 sans finir dessus': new Error('GET /x : 502 puis autre chose'),
    'chaîne levée': 'boom',
    'null levé': null,
    'undefined levé': undefined,
  };
  for (const [label, error] of Object.entries(internal)) {
    it(`${label} : statut 500`, async () => {
      const { result, context } = await respondToFailure(ERREUR, error);
      assert.deepEqual(context.rewritten, ['/espace/erreur']);
      assert.equal(context.locals.espaceError.status, 500);
      assert.equal(result.status, 500);
    });
  }

  it('l’identifiant de requête fait 8 caractères hexadécimaux et change à chaque incident', async () => {
    const first = (await respondToFailure(ERREUR, new Error('a'))).context.locals.espaceError.requestId;
    const second = (await respondToFailure(ERREUR, new Error('a'))).context.locals.espaceError.requestId;
    assert.match(first, /^[0-9a-f]{8}$/);
    assert.notEqual(first, second);
  });

  it('l’édition de l’URL voyage dans espaceError, décodée', async () => {
    const { context } = await respondToFailure('/espace/nouvelle-aquitaine/agenda', new Error('x'));
    assert.equal(context.locals.espaceError.edition, 'nouvelle-aquitaine');
    assert.equal(context.locals.espaceEdition, 'nouvelle-aquitaine');
  });

  it('une exception sur /espace/verifier (sans édition) donne espaceError.edition = null', async () => {
    const { context } = await respondToFailure('/espace/verifier', new Error('x'));
    assert.equal(context.locals.espaceError.edition, null);
  });

  it('la réponse d’erreur garde les en-têtes de sécurité et le no-store', async () => {
    const { result } = await respondToFailure(ERREUR, networkError('ECONNREFUSED'));
    assert.equal(result.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(result.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
    assert.match(result.headers.get('Content-Security-Policy'), /default-src 'self'/);
  });

  it('journalise une ligne JSON avec identifiant, statut, méthode, chemin et message', async () => {
    const { logged, context } = await respondToFailure(ERREUR, new Error('boom'));
    assert.equal(logged.length, 1);
    const entry = JSON.parse(logged[0]);
    assert.equal(entry.requestId, context.locals.espaceError.requestId);
    assert.equal(entry.status, 500);
    assert.equal(entry.method, 'GET');
    assert.equal(entry.path, ERREUR);
    assert.equal(entry.error, 'boom');
  });

  it('si la page d’erreur échoue aussi : texte brut minimal avec identifiant, statut conservé, sans trace, en-têtes de sécurité', async () => {
    const failing = async () => {
      throw new Error('la page d’erreur casse aussi');
    };
    const { result } = await respondToFailure(ERREUR, networkError('ECONNREFUSED'), { rewrite: failing });
    assert.equal(result.status, 503);
    assert.match(result.headers.get('content-type'), /^text\/plain/);
    const body = await result.text();
    assert.match(body, /Identifiant : [0-9a-f]{8}$/);
    assert.doesNotMatch(body, /ECONNREFUSED|casse|at .*:\d+/);
    assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(result.headers.get('X-Content-Type-Options'), 'nosniff');
  });

  it('une exception hors de /espace remonte telle quelle : pas de réécriture, pas de journal, locals intacts (critère 3)', async () => {
    for (const pathname of ['/', '/editions/nouvelle-aquitaine', '/contact', '/espaces', '/espace-public/x']) {
      const context = contextFor(pathname);
      const error = new Error('page publique en erreur');
      const spy = mock.method(console, 'error', () => {});
      try {
        await assert.rejects(onRequest(context, async () => { throw error; }), (thrown) => thrown === error);
        assert.equal(spy.mock.callCount(), 0, pathname);
      } finally {
        spy.mock.restore();
      }
      assert.deepEqual(context.rewritten, [], pathname);
      assert.deepEqual(context.locals, {}, pathname);
    }
  });

  it('sans exception, la réponse de next() passe et aucune réécriture n’a lieu', async () => {
    const context = contextFor(ERREUR);
    const response = new Response('ok');
    const result = await onRequest(context, async () => response);
    assert.equal(result, response);
    assert.deepEqual(context.rewritten, []);
    assert.equal(context.locals.espaceError, undefined);
  });
});

describe('web/src/middleware.ts : édition de l’URL dans locals (F-108)', () => {
  const cases = [
    ['/espace/nouvelle-aquitaine/connexion', 'nouvelle-aquitaine'],
    ['/espace/nouvelle-aquitaine', 'nouvelle-aquitaine'],
    ['/espace/nouvelle-aquitaine/', 'nouvelle-aquitaine'],
    ['/espace/%C3%A9dition/agenda', 'édition'],
    ['/espace/verifier', null],
    ['/espace/introuvable', null],
    ['/espace/erreur', null],
    ['/espace', null],
    ['/espace/', null],
    ['/espace/%E0%A4%A/agenda', null],
  ];
  for (const [pathname, expected] of cases) {
    it(`${pathname} : espaceEdition = ${JSON.stringify(expected)}`, async () => {
      const context = contextFor(pathname);
      await onRequest(context, async () => new Response('ok'));
      assert.equal(context.locals.espaceEdition, expected);
    });
  }
});
