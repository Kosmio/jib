'use strict';

/**
 * lib/session.js (I-21, I-22, A-04, NF-04) : chemin de redirection `next` limité à l'édition (aucune redirection
 * ouverte) et options du cookie de session. Tests d'abord du lot 5 : le module est requis dans chaque test.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');


const session = () => require('../../src/api/espace/lib/session');

const SLUG = 'nouvelle-aquitaine-test';
const HOME = `/espace/${SLUG}/`;

describe('safeNextPath : aucune redirection ouverte (I-21, A-04)', () => {
  const safe = (next, slug = SLUG) => session().safeNextPath(next, slug);

  for (const next of [HOME, `/espace/${SLUG}/profil`, `/espace/${SLUG}/rendez-vous`, `/espace/${SLUG}/rendez-vous?onglet=recus`, `/espace/${SLUG}/annuaire/p/abc123`]) {
    it(`garde le chemin de l’édition ${next}`, () => {
      assert.equal(safe(next), next);
    });
  }

  for (const [label, next] of [
    ['une URL absolue https', 'https://evil.example.org/espace/nouvelle-aquitaine-test/'],
    ['une URL absolue http', 'http://evil.example.org/'],
    ['une URL sans schéma (//hôte)', '//evil.example.org'],
    ['une URL sans schéma suivie du chemin de l’édition', `//evil.example.org/espace/${SLUG}/`],
    ['une barre oblique inverse (/\\hôte)', '/\\evil.example.org'],
    ['une barre oblique inverse dans le chemin', `/espace/${SLUG}/\\evil`],
    ['une remontée (..)', `/espace/${SLUG}/../../admin`],
    ['une remontée au milieu du chemin', `/espace/${SLUG}/a/../b`],
    ['un double slash dans le chemin', `/espace/${SLUG}/a//b`],
    ['une URL cachée dans la requête', `/espace/${SLUG}/?retour=https://evil.example.org`],
    ['un schéma javascript', 'javascript:alert(1)'],
    ['un schéma data', 'data:text/html,<script>alert(1)</script>'],
    ['une autre édition', '/espace/bretagne-test/'],
    ['un préfixe de l’édition sans barre finale', `/espace/${SLUG}`],
    ['un nom d’édition qui prolonge celui de l’édition', `/espace/${SLUG}x/`],
    ['la racine du site', '/'],
    ['une page publique', '/editions/nouvelle-aquitaine'],
    ['l’administration de Strapi', '/strapi/admin'],
    ['un chemin relatif', `espace/${SLUG}/`],
    ['une chaîne vide', ''],
    ['null', null],
    ['undefined', undefined],
    ['un nombre', 42],
  ]) {
    it(`retombe sur l’accueil de l’édition pour ${label}`, () => {
      assert.equal(safe(next), HOME);
    });
  }

  it('suit l’édition demandée : le même chemin est refusé pour une autre édition', () => {
    assert.equal(safe(`/espace/${SLUG}/profil`, 'bretagne-test'), '/espace/bretagne-test/');
  });
});

describe('sessionCookieOptions : cookie jib_espace (I-22)', () => {
  const THIRTY_DAYS = 30 * 24 * 3600 * 1000;
  const options = (publicUrl, maxAgeMs = THIRTY_DAYS) => session().sessionCookieOptions({ publicUrl, maxAgeMs });

  it('est HttpOnly, SameSite=Lax, sur /, signé, et remplace un cookie précédent', () => {
    const cookie = options('https://journees.example.org');
    assert.equal(cookie.httpOnly, true);
    assert.match(cookie.sameSite, /^lax$/i);
    assert.equal(cookie.path, '/');
    assert.equal(cookie.signed, true);
    assert.equal(cookie.overwrite, true);
  });

  it('est Secure quand PUBLIC_URL est en https', () => {
    assert.equal(options('https://journees.example.org').secure, true);
  });

  it('n’est pas Secure en http local : le navigateur le refuserait sinon', () => {
    assert.ok(!options('http://localhost:4321').secure);
  });

  it('porte la durée demandée (30 jours)', () => {
    assert.equal(options('http://localhost:4321').maxAge, THIRTY_DAYS);
    assert.equal(options('http://localhost:4321', 60_000).maxAge, 60_000);
  });
});
