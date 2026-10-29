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
