'use strict';

/**
 * Conventions du projet (docs/espace/CLAUDE.md) vérifiées sur les fichiers de l'espace :
 * jamais de tiret cadratin (U+2014), ni son entité HTML.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../../..');

// Dossiers et fichiers de l'espace. Jamais les pages publiques ni les contenus saisis dans Strapi, qui en contiennent
// déjà (docs/espace/CLAUDE.md, « Tirets cadratins déjà présents ») : `Layout.astro`, `Header.astro`, `Footer.astro`,
// `app.css`, `strapi/src/index.js`. Les cibles qui n'existent pas encore sont ignorées (listFiles) : elles sont
// contrôlées dès leur création, au fil des lots 2 à 6 de la phase 1.
const TARGETS = [
  // Strapi
  'strapi/src/api/espace',
  'strapi/scripts/espace',
  'strapi/tests',
  'strapi/config/server.js',
  'strapi/config/middlewares.js',
  'strapi/config/cron-tasks.js',
  'strapi/.env.example',
  // Web (phase 1, lot 6)
  'web/src/layouts/EspaceLayout.astro',
  'web/src/styles/espace.css',
  'web/src/components/espace',
  'web/src/pages/espace',
  'web/src/react-components/espace',
  'web/src/lib/espace',
  'web/src/middleware.ts',
  'web/tests/e2e',
  'web/playwright.config.ts',
  // Intégration continue et documentation
  '.github/workflows/tests.yml',
  'docs/espace',
];

const EM_DASH = new RegExp(`${String.fromCharCode(0x2014)}|&mdash;|&#8212;|&#x2014;`, 'i');

function listFiles(target) {
  const absolute = path.join(REPO, target);
  if (!fs.existsSync(absolute)) return [];
  if (fs.statSync(absolute).isFile()) return [absolute];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === '.tmp') return [];
    const child = path.join(target, entry.name);
    return entry.isDirectory() ? listFiles(child) : [path.join(REPO, child)];
  });
}

describe('conventions : aucun tiret cadratin', () => {
  for (const target of TARGETS) {
    it(`${target}`, () => {
      const offenders = listFiles(target)
        .filter((file) => file !== __filename) // ce fichier cite les motifs recherchés
        .filter((file) => !/\.(png|jpg|jpeg|webp|ico)$/i.test(file))
        .filter((file) => EM_DASH.test(fs.readFileSync(file, 'utf8')))
        .map((file) => path.relative(REPO, file));
      assert.deepEqual(offenders, []);
    });
  }
});

describe('conventions : les fichiers des badges sont contrôlés (V4-D1, T-69)', () => {
  const checked = new Set(TARGETS.flatMap(listFiles).map((file) => path.relative(REPO, file)));
  const BADGE_FILES = [
    'strapi/src/api/espace/lib/badges/index.js',
    'strapi/src/api/espace/lib/badges/colors.js',
    'strapi/src/api/espace/lib/badges/layout.js',
    'strapi/src/api/espace/lib/badges/program.js',
    'strapi/src/api/espace/lib/badges/qr.js',
    'strapi/src/api/espace/lib/badges/text.js',
    'strapi/src/api/espace/lib/badges/token.js',
    'strapi/src/api/espace/lib/badges/types.js',
    'strapi/src/api/espace/services/badges.js',
    'strapi/src/api/espace/services/cards.js',
    'strapi/src/api/espace/controllers/badges.js',
    'strapi/src/api/espace/controllers/cards.js',
    'strapi/src/api/espace/routes/badges.js',
    'strapi/src/api/espace/routes/cards.js',
    'strapi/src/api/espace/content-types/badge-setting/schema.json',
    'strapi/src/api/espace/content-types/attendee/schema.json',
    'web/src/pages/espace/[edition]/carte/[token].astro',
    'strapi/tests/unit/badges.test.js',
    'strapi/tests/integration/espace-badges.test.js',
    'web/tests/e2e/espace-carte.spec.ts',
  ];

  for (const file of BADGE_FILES) {
    it(`${file} existe, est sous une cible contrôlée et ne contient aucun tiret cadratin`, () => {
      assert.ok(fs.existsSync(path.join(REPO, file)), 'fichier absent');
      assert.ok(checked.has(file), 'fichier hors des cibles de conventions.test.js');
      assert.ok(!EM_DASH.test(fs.readFileSync(path.join(REPO, file), 'utf8')), 'tiret cadratin');
    });
  }

  it('le texte écrit sur le badge (le PDF) n’en reçoit jamais : printable remplace le tiret long par un trait d’union', () => {
    const { printable } = require('../../src/api/espace/lib/badges');
    for (const dash of [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212]) assert.ok(!EM_DASH.test(printable(`a${String.fromCharCode(dash)}b`)), dash.toString(16));
  });

  it('les polices et le logo des badges sont des fichiers du dépôt, sans appel à une adresse externe dans le code du lot', () => {
    const dir = path.join(REPO, 'strapi/src/api/espace/lib/badges');
    for (const asset of ['assets/Azonix.otf', 'assets/logo-jib.png']) assert.ok(fs.existsSync(path.join(dir, asset)), asset);
    const code = listFiles('strapi/src/api/espace/lib/badges').filter((file) => file.endsWith('.js')).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    assert.ok(!/https?:\/\/(?!localhost)/.test(code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'adresse externe dans le code des badges');
  });
});

describe('conventions : les gabarits des relances sont contrôlés (V3-A, critère 6)', () => {
  const checked = new Set(TARGETS.flatMap(listFiles).map((file) => path.relative(REPO, file)));
  const NEW_FILES = [
    'strapi/src/api/espace/lib/mail/templates/reminder-profile.js',
    'strapi/src/api/espace/lib/mail/templates/reminder-no-meeting.js',
    'strapi/src/api/espace/lib/mail/templates/reminder-eve.js',
    'strapi/src/api/espace/lib/reminders.js',
    'strapi/src/api/espace/services/reminders.js',
    'strapi/src/api/espace/controllers/reminders.js',
    'strapi/src/api/espace/routes/reminders.js',
    'strapi/tests/unit/reminder-templates.test.js',
    'strapi/tests/integration/espace-relances.test.js',
  ];

  for (const file of NEW_FILES) {
    it(`${file} est sous une cible contrôlée`, () => {
      assert.ok(fs.existsSync(path.join(REPO, file)), 'fichier absent');
      assert.ok(checked.has(file), 'fichier hors des cibles de conventions.test.js');
    });
  }
});
