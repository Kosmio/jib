'use strict';

// Gardes du workflow Deploy (V1-A, NF-58, NF-60) : présence, ordre et conditions des étapes.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', '..', '..', '.github', 'workflows', 'deploy.yml');
const text = fs.readFileSync(file, 'utf8');

// Découpe grossière en étapes : chaque « - name: » démarre un bloc.
const blocks = text.split(/^ {6}- name: /m).slice(1).map((b) => {
  const name = b.split('\n')[0].trim();
  const cond = /^ {8}if: (.*)$/m.exec(b);
  return { name, body: b, cond: cond ? cond[1] : '' };
});
const idx = (name) => blocks.findIndex((b) => b.name === name);
const get = (name) => blocks[idx(name)];

test('NF-58 : « Refuse reset on prod » existe, échoue, et précède toute étape SSH', () => {
  const i = idx('Refuse reset on prod');
  assert.ok(i >= 0);
  assert.match(get('Refuse reset on prod').cond, /environment == 'prod'.*reset_db/);
  assert.match(get('Refuse reset on prod').body, /exit 1/);
  assert.ok(i < idx('Setup SSH'));
  assert.ok(i < idx('Reset database'));
  assert.ok(i < idx('Copy infrastructure files to server'));
});

test('NF-60 : « Check prod variables » vise la prod, sans condition dry_run, avant SSH', () => {
  const b = get('Check prod variables');
  assert.ok(b);
  assert.match(b.cond, /environment == 'prod'/);
  assert.doesNotMatch(b.cond, /dry_run/);
  assert.match(b.body, /EMAIL_FROM/);
  assert.match(b.body, /ORGANIZER_EMAILS/);
  assert.ok(idx('Check prod variables') < idx('Setup SSH'));
});

test('NF-59 : « Backup prod » après le transfert, avant le déploiement, en prod seulement', () => {
  const b = get('Backup prod');
  assert.ok(b);
  assert.match(b.cond, /environment == 'prod'/);
  assert.match(b.cond, /!inputs\.dry_run/);
  assert.ok(idx('Backup prod') > idx('Copy infrastructure files to server'));
  assert.ok(idx('Backup prod') < idx('Pull latest images'));
  assert.ok(idx('Backup prod') < idx('Reset database'));
  assert.ok(idx('Backup prod') < idx('Deploy application'));
});

test('NF-60 : EMAIL_FROM, ORGANIZER_EMAILS et LINK_RATE_IP_MAX viennent de vars.*', () => {
  for (const name of ['EMAIL_FROM', 'ORGANIZER_EMAILS', 'LINK_RATE_IP_MAX']) {
    assert.match(text, new RegExp(`^ +${name}=\\$\\{\\{ vars\\.${name} \\}\\}$`, 'm'));
  }
});

test('NF-55 : Traefik sans journal d’accès, qui écrirait les jetons des URL en clair', () => {
  const compose = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'infra', 'deploy', 'base', 'docker-compose.base.yml'), 'utf8');
  const enabled = compose.split('\n').filter((line) => !line.trim().startsWith('#') && /--accesslog(=true|\b(?!\.))/.test(line));
  assert.deepEqual(enabled, []);
});
