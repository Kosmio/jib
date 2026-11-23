'use strict';

/**
 * lib/tokens.js (I-20, I-21, NF-02, A-04) : jeton de 32 octets en base64url, empreinte SHA-256 en hexadécimal,
 * URL du lien de connexion. Tests d'abord du lot 2 : le module est requis dans chaque test.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');


const tokens = () => require('../../src/api/espace/lib/tokens');

describe('generateToken (I-20)', () => {
  it('renvoie 43 caractères base64url (32 octets, sans remplissage)', () => {
    assert.match(tokens().generateToken(), /^[A-Za-z0-9_-]{43}$/);
  });

  it('décode en 32 octets', () => {
    assert.equal(Buffer.from(tokens().generateToken(), 'base64url').length, 32);
  });

  it('ne se répète pas : 2 000 jetons distincts', () => {
    const seen = new Set(Array.from({ length: 2000 }, () => tokens().generateToken()));
    assert.equal(seen.size, 2000);
  });
});

describe('hashToken (I-20, NF-02)', () => {
  it('donne le SHA-256 du jeton en hexadécimal minuscule (vecteur de référence « abc »)', () => {
    assert.equal(tokens().hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('s’applique au jeton tel qu’il circule dans le lien (la chaîne), et non à ses octets décodés', () => {
    const token = tokens().generateToken();
    assert.equal(tokens().hashToken(token), crypto.createHash('sha256').update(token).digest('hex'));
  });

  it('est déterministe et sensible à chaque caractère', () => {
    const token = tokens().generateToken();
    assert.equal(tokens().hashToken(token), tokens().hashToken(token));
    assert.notEqual(tokens().hashToken(token), tokens().hashToken(`${token}A`));
  });

  it('ne contient pas le jeton en clair', () => {
    const token = tokens().generateToken();
    assert.ok(!tokens().hashToken(token).includes(token));
  });
});

describe('linkUrl (I-20, I-21)', () => {
  const parse = (options) => new URL(tokens().linkUrl(options));

  it('construit {publicUrl}/espace/verifier?token=…&next=…', () => {
    const url = parse({ publicUrl: 'https://journees.example.org', token: 'abc-_123', next: '/espace/nouvelle-aquitaine/' });
    assert.equal(url.origin, 'https://journees.example.org');
    assert.equal(url.pathname, '/espace/verifier');
    assert.equal(url.searchParams.get('token'), 'abc-_123');
    assert.equal(url.searchParams.get('next'), '/espace/nouvelle-aquitaine/');
  });

  it('garde intact un chemin `next` qui porte lui-même une requête', () => {
    const next = '/espace/nouvelle-aquitaine/rendez-vous?onglet=recus&a=b';
    assert.equal(parse({ publicUrl: 'http://localhost:4321', token: 't', next }).searchParams.get('next'), next);
  });

  it('s’appuie sur publicUrl, jamais sur une adresse en dur', () => {
    assert.equal(parse({ publicUrl: 'http://localhost:4321', token: 't', next: '/espace/x/' }).origin, 'http://localhost:4321');
  });

  it('commence par la chaîne publicUrl, sans double barre', () => {
    const link = tokens().linkUrl({ publicUrl: 'https://journees.example.org', token: 't', next: '/espace/x/' });
    assert.ok(link.startsWith('https://journees.example.org/espace/verifier?'), link);
  });
});
