'use strict';

/**
 * web/src/middleware.ts (NF-07, A-24) : en-têtes de sécurité des pages de l'espace, et d'elles seules.
 *
 * Le middleware est un module TypeScript d'Astro (`astro:middleware`, `lib/espace/api`). Il est chargé tel quel par Node
 * (suppression des types), les deux importations propres à Astro étant remplacées par des modules d'essai : aucun serveur,
 * aucun navigateur. Le parcours complet dans un navigateur (POST du formulaire de vérification accepté) est un test e2e du lot 7.
 *
 *   - NF-07 : CSP sans origine tierce, `nosniff`, `Cache-Control: private, no-store` sous `/espace`, rien ailleurs ;
 *   - A-24 : `/espace/verifier` répond `Referrer-Policy: strict-origin` (l'URL porte le jeton du lien), les autres pages de
 *     `/espace` gardent `strict-origin-when-cross-origin`, et jamais `no-referrer` : le navigateur enverrait `Origin: null`
 *     avec le POST du formulaire, que Strapi refuse (`ORIGIN_REFUSED`).
 */

const { before, describe, it } = require('node:test');
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

/** Réponse du middleware pour `pathname` ; `next()` rend une réponse neuve, comme Astro. */
async function respond(pathname) {
  const response = new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
  const result = await onRequest({ url: new URL(`${SITE}${pathname}`) }, async () => response);
  return { result, response };
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
