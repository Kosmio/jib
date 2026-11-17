'use strict';

/**
 * lib/badges (lot V4-D1, 12-badges.md : F-97, F-98, R-80, R-81, R-84, I-43, NF-55 ; critères T-65, T-66, T-68).
 *
 * Fonctions pures : deriveCardToken, cardUrl, hashCardToken, CARD_TOKEN_PATTERN, fitText, printable, layoutProgram, accentColor,
 * contrastWithWhite, qrMatrix, qrRuns, parseTypes, sortAttendees, typeOf, isReduced. Puis le PDF (buildBadgesPdf), vérifié sur
 * le fichier produit et non sur le code qui le dessine : pdftotext donne la position de chaque mot, pdftoppm le rendu réel, et le
 * QR est relu sur ce rendu (aucun décodeur de QR n'est installé : la matrice lue sur l'image, module par module, doit être celle
 * de qrMatrix(url attendue), donc un lecteur en tirerait la même URL ; l'annotation /URI du fichier porte aussi cette URL).
 *
 * Écarts acceptés : Helvetica intégrée (pas de police incorporée) et Azonix.otf ; organisateurs en carte réduite.
 * Les tests du PDF sont ignorés (skip) si pdftoppm ou pdftotext (poppler) manquent sur le poste.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const badges = require('../../src/api/espace/lib/badges');
const { makePng } = require('../helpers/png');

const {
  CARD_TOKEN_PATTERN, accentColor, buildBadgesPdf, cardUrl, contrastWithWhite, deriveCardToken, fitText, hashCardToken, isReduced, layoutProgram,
  parseTypes, printable, qrMatrix, qrRuns, sortAttendees, typeOf,
} = badges;

// Largeur d'un texte : 0,5 em par caractère, de quoi raisonner sans police.
const measure = (text, size) => [...text].length * size * 0.5;

describe('jeton de carte (R-80, NF-55)', () => {
  const base = { secret: 'cle-de-test-0123456789', documentId: 'doc-attendee-1', createdAt: '2026-11-17T10:00:00.000Z' };

  it('deriveCardToken : 43 caractères URL-safe (256 bits), conforme à CARD_TOKEN_PATTERN', () => {
    const token = deriveCardToken(base);
    assert.equal(token.length, 43);
    assert.match(token, CARD_TOKEN_PATTERN);
    assert.equal(Buffer.from(token, 'base64url').length, 32);
  });

  it('deriveCardToken : déterministe, une Date et son ISO donnent le même jeton (le badge réimprimé garde son QR)', () => {
    assert.equal(deriveCardToken(base), deriveCardToken({ ...base }));
    assert.equal(deriveCardToken({ ...base, createdAt: new Date(base.createdAt) }), deriveCardToken(base));
  });

  it('deriveCardToken : change avec l’instant de création (c’est ainsi qu’on régénère), le documentId et le secret', () => {
    const token = deriveCardToken(base);
    assert.notEqual(deriveCardToken({ ...base, createdAt: '2026-11-17T10:00:00.001Z' }), token);
    assert.notEqual(deriveCardToken({ ...base, documentId: 'doc-attendee-2' }), token);
    assert.notEqual(deriveCardToken({ ...base, secret: 'autre-cle-0123456789' }), token);
  });

  it('deriveCardToken : 2 000 attendees donnent 2 000 jetons distincts, tous au bon format', () => {
    const seen = new Set();
    for (let index = 0; index < 2000; index += 1) {
      const token = deriveCardToken({ ...base, documentId: `doc-${index}` });
      assert.match(token, CARD_TOKEN_PATTERN);
      seen.add(token);
    }
    assert.equal(seen.size, 2000);
  });

  it('deriveCardToken : refuse un secret, un documentId ou un instant absent ou illisible', () => {
    for (const bad of [{ secret: '' }, { secret: undefined }, { documentId: '' }, { createdAt: null }, { createdAt: 'pas une date' }]) {
      assert.throws(() => deriveCardToken({ ...base, ...bad }), /required/);
    }
  });

  it('hashCardToken : empreinte SHA-256 hexadécimale du jeton, jamais le jeton lui-même', () => {
    const token = deriveCardToken(base);
    const hash = hashCardToken(token);
    assert.equal(hash, crypto.createHash('sha256').update(token).digest('hex'));
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.ok(!hash.includes(token));
  });

  it('CARD_TOKEN_PATTERN : refuse 42 et 44 caractères et tout caractère hors base64url', () => {
    const token = deriveCardToken(base);
    assert.ok(!CARD_TOKEN_PATTERN.test(token.slice(0, 42)));
    assert.ok(!CARD_TOKEN_PATTERN.test(`${token}A`));
    for (const char of ['+', '/', '=', ' ', '.', '%']) assert.ok(!CARD_TOKEN_PATTERN.test(`${token.slice(0, 42)}${char}`), JSON.stringify(char));
    assert.ok(!CARD_TOKEN_PATTERN.test(`${token}\n`), 'saut de ligne final');
  });

  it('cardUrl : PUBLIC_URL + /espace/{édition}/carte/{jeton}, sans double barre, édition encodée', () => {
    const token = deriveCardToken(base);
    assert.equal(cardUrl({ publicUrl: 'https://jib.example.org', slug: 'nouvelle-aquitaine', token }), `https://jib.example.org/espace/nouvelle-aquitaine/carte/${token}`);
    assert.equal(cardUrl({ publicUrl: 'https://jib.example.org///', slug: 'edition', token }), `https://jib.example.org/espace/edition/carte/${token}`);
    assert.equal(cardUrl({ publicUrl: 'http://localhost:4321', slug: 'a b/c', token }), `http://localhost:4321/espace/a%20b%2Fc/carte/${token}`);
  });
});

describe('type, visibilité, filtre et tri', () => {
  it('typeOf : le rôle donne le type ; un rôle inconnu compte pour participant', () => {
    assert.equal(typeOf({ role: 'participant', email: 'a@example.org' }), 'participant');
    assert.equal(typeOf({ role: 'speaker', email: 'a@example.org' }), 'speaker');
    assert.equal(typeOf({ role: 'exhibitor_rep', email: 'a@example.org' }), 'exhibitor_rep');
    assert.equal(typeOf({ role: 'astronaute', email: 'a@example.org' }), 'participant');
  });

  it('typeOf : un organisateur par le rôle ou par ORGANIZER_EMAILS (sans tenir compte de la casse) compte pour organisateur', () => {
    assert.equal(typeOf({ role: 'organizer', email: 'a@example.org' }), 'organizer');
    assert.equal(typeOf({ role: 'participant', email: 'Orga@Example.org' }, ['orga@example.org']), 'organizer');
    assert.equal(typeOf({ role: 'speaker', email: 'a@example.org' }, ['orga@example.org']), 'speaker');
  });

  it('isReduced (R-81, R-84) : fiche complète seulement pour un profil visible qui a donné son consentement', () => {
    assert.equal(isReduced({ directoryOptIn: true, consentAt: '2026-11-01T08:00:00Z' }, 'participant'), false);
    assert.equal(isReduced({ directoryOptIn: true, consentAt: null }, 'participant'), true, 'jamais connecté : carte réduite (R-84)');
    assert.equal(isReduced({ directoryOptIn: false, consentAt: '2026-11-01T08:00:00Z' }, 'participant'), true);
    assert.equal(isReduced({ directoryOptIn: true, consentAt: '2026-11-01T08:00:00Z' }, 'organizer'), true, 'organisateur : carte réduite');
  });

  it('parseTypes : rien ou liste vide, aucun filtre ; les quatre rôles de l’attendee sont acceptés ; doublons écartés', () => {
    assert.equal(parseTypes(undefined), null);
    assert.equal(parseTypes(null), null);
    assert.equal(parseTypes([]), null);
    assert.deepEqual(parseTypes(['exhibitor_rep']), ['exhibitor_rep']);
    assert.deepEqual(parseTypes(['speaker', 'speaker', 'participant']), ['speaker', 'participant']);
    assert.deepEqual(parseTypes(['organizer']), ['organizer']);
  });

  it('parseTypes : un type inconnu ou une valeur qui n’est pas une liste donne undefined (400 côté service)', () => {
    assert.equal(parseTypes(['visiteur']), undefined);
    assert.equal(parseTypes(['exhibitor']), undefined, 'exactement les rôles du schéma (be29214), pas d’alias');
    assert.equal(parseTypes(['participant', 'visiteur']), undefined);
    assert.equal(parseTypes('participant'), undefined);
    assert.equal(parseTypes({ 0: 'participant' }), undefined);
  });

  it('sortAttendees : nom puis prénom par défaut, sans tenir compte des accents ni de la casse ; l’entrée n’est pas modifiée', () => {
    const people = [
      { documentId: 'd', firstName: 'Zoé', lastName: 'Étienne', company: 'B' },
      { documentId: 'c', firstName: 'Eva', lastName: 'etienne', company: 'A' },
      { documentId: 'b', firstName: 'Léa', lastName: 'Ducasse', company: 'C' },
      { documentId: 'a', firstName: 'Anne', lastName: 'Zola', company: 'A' },
    ];
    const copy = structuredClone(people);
    assert.deepEqual(sortAttendees(people).map((p) => p.documentId), ['b', 'c', 'd', 'a']);
    assert.deepEqual(people, copy);
  });

  it('sortAttendees : « company » trie par entreprise puis par nom, une entreprise vide en premier, égalité tranchée par documentId', () => {
    const people = [
      { documentId: 'x2', firstName: 'A', lastName: 'Same', company: 'Beta' },
      { documentId: 'x1', firstName: 'A', lastName: 'Same', company: 'Beta' },
      { documentId: 'y', firstName: 'B', lastName: 'Aaa', company: 'Alpha' },
      { documentId: 'z', firstName: 'C', lastName: 'Zzz', company: null },
    ];
    assert.deepEqual(sortAttendees(people, 'company').map((p) => p.documentId), ['z', 'y', 'x1', 'x2']);
  });
});

describe('texte : printable et fitText (T-66)', () => {
  it('printable : un tiret long devient un trait d’union, jamais de tiret cadratin dans le PDF', () => {
    assert.equal(printable(`Anne${String.fromCharCode(0x2014)}Laure`), 'Anne-Laure');
    assert.equal(printable(`a${String.fromCharCode(0x2013)}b`), 'a-b');
  });

  it('printable : garde les accents de WinAnsi, retire l’accent d’une lettre absente, remplace le reste par « ? »', () => {
    assert.equal(printable('Léa Ducasse œuvre à Çà'), 'Léa Ducasse œuvre à Çà');
    assert.equal(printable('Łukasz'), 'Lukasz');
    assert.equal(printable('Ăn'), 'An');
    assert.equal(printable('a\u{1F332}b'), 'a?b');
  });

  it('printable : espaces réduites, bords nettoyés, vide et null donnent « » ; l’espace insécable devient une espace', () => {
    assert.equal(printable('  a   b\t\nc  '), 'a b c');
    assert.equal(printable('a b'), 'a b');
    assert.equal(printable(null), '');
    assert.equal(printable(undefined), '');
  });

  it('fitText : un texte court garde la plus grande taille, sur une ligne, sans troncature', () => {
    assert.deepEqual(fitText({ text: 'Léa Ducasse', measure, sizes: [30, 20, 12], width: 400, maxLines: 2 }), { size: 30, lines: ['Léa Ducasse'], truncated: false });
  });

  it('fitText : un nom de 40 caractères et une entreprise de 60 tiennent, à une taille réduite, dans la largeur et le nombre de lignes', () => {
    const name = 'Jean-Christophe Montgolfier-Delacroix XX'.slice(0, 40);
    assert.equal(name.length, 40);
    const company = 'Société Coopérative Régionale des Industries du Bois et de la Forêt'.slice(0, 60);
    assert.equal(company.length, 60);
    for (const [text, sizes, maxLines] of [[name, [34, 30, 26, 22, 18, 15], 2], [company, [18, 16, 14, 12, 10], 2]]) {
      const fit = fitText({ text, measure, sizes, width: 241, maxLines });
      assert.ok(fit.lines.length >= 1 && fit.lines.length <= maxLines, `${fit.lines.length} lignes`);
      for (const line of fit.lines) assert.ok(measure(line, fit.size) <= 241, `« ${line} » à ${fit.size} déborde`);
      assert.equal(fit.truncated, false, 'rien à tronquer à ces tailles');
      assert.equal(fit.lines.join(' '), text);
      assert.ok(fit.size < sizes[0], 'taille réduite par paliers');
    }
  });

  it('fitText : trop long pour la plus petite taille, la dernière ligne finit par « … » et reste dans la largeur', () => {
    const text = 'Mot '.repeat(60).trim();
    const fit = fitText({ text, measure, sizes: [20, 10], width: 120, maxLines: 2 });
    assert.equal(fit.size, 10);
    assert.equal(fit.lines.length, 2);
    assert.ok(fit.lines[1].endsWith('…'));
    assert.equal(fit.truncated, true);
    for (const line of fit.lines) assert.ok(measure(line, fit.size) <= 120);
  });

  it('fitText : maxChars coupe le texte avec « … » avant la mise en page', () => {
    const fit = fitText({ text: 'a'.repeat(200), measure, sizes: [10], width: 10_000, maxLines: 1, maxChars: 80 });
    assert.equal([...fit.lines[0]].length, 80);
    assert.ok(fit.lines[0].endsWith('…'));
    assert.equal(fit.truncated, true);
  });

  it('fitText : un mot plus large que la colonne est coupé entre deux caractères, aucune ligne ne déborde', () => {
    const fit = fitText({ text: 'x'.repeat(100), measure, sizes: [10], width: 100, maxLines: 10 });
    assert.ok(fit.lines.length > 1);
    for (const line of fit.lines) assert.ok(measure(line, 10) <= 100);
    assert.equal(fit.lines.join(''), 'x'.repeat(100));
  });

  it('fitText : texte vide ou absent, aucune ligne', () => {
    for (const text of ['', '   ', null, undefined]) assert.deepEqual(fitText({ text, measure, sizes: [14, 10], width: 200, maxLines: 2 }).lines, []);
  });

  it('fitText : le texte est rendu imprimable (tiret long, caractère hors police)', () => {
    const fit = fitText({ text: `Marie${String.fromCharCode(0x2014)}Pierre \u{1F332}`, measure, sizes: [14], width: 400, maxLines: 1 });
    assert.deepEqual(fit.lines, ['Marie-Pierre ?']);
  });
});

describe('programme du verso : layoutProgram (T-66)', () => {
  const sessions = (count, title = 'Intervention de recette sur la valorisation des coproduits de scierie') =>
    Array.from({ length: count }, (_, index) => ({ start: `${9 + Math.floor(index / 6)}h${String((index % 6) * 10).padStart(2, '0')}`, title: `${title} ${index + 1}`, speakers: [{ name: 'Léa Ducasse' }, { name: 'Mathis Lagrange' }] }));
  const lay = (input) => layoutProgram({ measure: (text, size) => measure(text, size), width: 240, height: 700, ...input });

  it('quelques séquences : taille nominale, rien de réduit ni de coupé, pas de mention', () => {
    const laid = lay({ sessions: sessions(4) });
    assert.equal(laid.size, 8);
    assert.equal(laid.reduced, false);
    assert.equal(laid.cut, false);
    assert.equal(laid.mention, null);
    assert.equal(laid.rows.length, 4);
  });

  it('30 interventions : la hauteur utilisée ne dépasse jamais la boîte et aucune ligne ne déborde de la largeur', () => {
    const laid = lay({ sessions: sessions(30) });
    assert.ok(laid.height <= 700, `hauteur ${laid.height}`);
    assert.equal(laid.reduced, true, 'le programme se réduit avant d’être coupé');
    for (const row of laid.rows) {
      for (const line of [...row.titleLines, ...row.speakerLines]) assert.ok(measure(line, laid.size) <= 240 - 24, `« ${line} » déborde`);
    }
  });

  it('une boîte trop petite : le programme est coupé et la mention « Programme complet dans l’application » le ferme', () => {
    const laid = lay({ sessions: sessions(30), height: 220 });
    assert.equal(laid.cut, true);
    assert.ok(laid.rows.length >= 1 && laid.rows.length < 30);
    assert.ok(laid.mention.lines.join(' ').includes('Programme complet dans l’application'));
    assert.ok(laid.height <= 220, `hauteur ${laid.height}`);
    for (const line of laid.mention.lines) assert.ok(measure(line, laid.size) <= 240);
  });

  it('les séquences sans horaire (notes) viennent après les séquences à l’heure ; un titre vide est écarté', () => {
    const laid = lay({ sessions: sessions(2), notes: ['Atelier sans horaire', ''] });
    assert.equal(laid.rows.length, 3);
    assert.equal(laid.rows[2].time, '');
    assert.deepEqual(laid.rows[2].titleLines, ['Atelier sans horaire']);
  });

  it('un titre démesuré est coupé à 140 caractères, un programme vide ne donne aucune ligne ni mention', () => {
    const laid = lay({ sessions: [{ start: '9h00', title: 'T'.repeat(500), speakers: [] }], width: 5000 });
    assert.ok(laid.rows[0].titleLines.join('').length <= 140);
    assert.ok(laid.rows[0].titleLines.join('').endsWith('…'));
    const empty = lay({});
    assert.deepEqual(empty.rows, []);
    assert.equal(empty.cut, false);
  });
});

describe('couleur d’accent (AA, tokens)', () => {
  it('contrastWithWhite : 21 pour le noir, 1 pour le blanc', () => {
    assert.ok(Math.abs(contrastWithWhite('#000000') - 21) < 0.01);
    assert.ok(Math.abs(contrastWithWhite('#ffffff') - 1) < 0.01);
  });

  it('accentColor : une couleur foncée valide est gardée, la première valide gagne', () => {
    assert.equal(accentColor('#600e24'), '#600e24');
    assert.equal(accentColor(null, undefined, 'pas une couleur', '#1a2b3c', '#600e24'), '#1a2b3c');
  });

  it('accentColor : une couleur trop claire, invalide ou absente retombe sur le bleu des titres', () => {
    for (const bad of ['#ffff00', '#ffffff', '#BA8748', 'rouge', '#fff', '', null, undefined, 12]) assert.equal(accentColor(bad), '#325062', String(bad));
    assert.equal(accentColor(), '#325062');
  });

  it('accentColor : le texte blanc sur le résultat atteint toujours 4,5:1 (AA), sur 3 000 couleurs', () => {
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let index = 0; index < 3000; index += 1) {
      const hex = `#${(next() % 0x1000000).toString(16).padStart(6, '0')}`;
      assert.ok(contrastWithWhite(accentColor(hex)) >= 4.5, `${hex} -> ${accentColor(hex)}`);
    }
  });
});

describe('QR code (I-43) : matrice, niveau M, rectangles', () => {
  const url = `http://localhost:4321/espace/nouvelle-aquitaine-test/carte/${deriveCardToken({ secret: 'cle', documentId: 'doc', createdAt: new Date().toISOString() })}`;

  it('qrMatrix : carrée, au niveau de correction M (celui de la bibliothèque), différente d’un autre niveau', () => {
    const matrix = qrMatrix(url);
    assert.equal(matrix.rows.length, matrix.size);
    for (const row of matrix.rows) assert.equal(row.length, matrix.size);
    const dark = (level) => {
      const { modules } = QRCode.create(url, { errorCorrectionLevel: level });
      return Array.from({ length: modules.size }, (_, r) => Array.from({ length: modules.size }, (_, c) => Boolean(modules.get(r, c))));
    };
    assert.deepEqual(matrix.rows, dark('M'));
    assert.notDeepEqual(matrix.rows, dark('H'));
  });

  it('qrMatrix : les trois repères de position (7 x 7) sont aux trois coins', () => {
    const { rows, size } = qrMatrix(url);
    const finder = (top, left) => {
      for (let r = 0; r < 7; r += 1) {
        for (let c = 0; c < 7; c += 1) {
          const edge = r === 0 || r === 6 || c === 0 || c === 6;
          const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          assert.equal(rows[top + r][left + c], edge || core, `repère ${top},${left} module ${r},${c}`);
        }
      }
    };
    finder(0, 0);
    finder(0, size - 7);
    finder(size - 7, 0);
  });

  it('qrRuns : les rectangles redessinent exactement la matrice, en moins de rectangles que de modules noirs', () => {
    const matrix = qrMatrix(url);
    const drawn = matrix.rows.map((row) => row.map(() => false));
    for (const { row, col, length } of qrRuns(matrix)) for (let k = 0; k < length; k += 1) drawn[row][col + k] = true;
    assert.deepEqual(drawn, matrix.rows);
    const darkCount = matrix.rows.flat().filter(Boolean).length;
    assert.ok(qrRuns(matrix).length < darkCount);
  });

  it('qrMatrix : deux URL différentes donnent deux matrices différentes', () => {
    assert.notDeepEqual(qrMatrix(`${url}a`).rows, qrMatrix(`${url}b`).rows);
  });
});

// --------------------------------------------------------------------------------------------------------------------------------------
// Le PDF
// --------------------------------------------------------------------------------------------------------------------------------------

const tool = (name) => ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'].map((dir) => path.join(dir, name)).find((file) => fs.existsSync(file));
const PDFTOPPM = tool('pdftoppm');
const PDFTOTEXT = tool('pdftotext');
const skip = PDFTOPPM && PDFTOTEXT ? false : 'poppler (pdftoppm, pdftotext) absent';

const MM = 72 / 25.4;
const A4 = { width: 595.28, height: 841.89 };
const MID = A4.width / 2;
const MARGIN = 10 * MM; // marges d'une imprimante de bureau (D-13)
const DPI = 150;

const EDITION = { title: 'Journées de l’Innovation Filière Bois', date: '2026-12-03', city: 'Bordeaux' };
const TOKEN = deriveCardToken({ secret: 'cle-de-test', documentId: 'doc', createdAt: '2026-11-17T10:00:00.000Z' });
const urlFor = (index) => cardUrl({ publicUrl: 'http://localhost:4321', slug: 'nouvelle-aquitaine-test', token: deriveCardToken({ secret: 'cle-de-test', documentId: `doc-${index}`, createdAt: '2026-11-17T10:00:00.000Z' }) });
const badge = (index, fields = {}) => ({ firstName: `Prénom${index}`, lastName: `Nom${index}`, jobTitle: 'Cheffe de projet', company: 'Atelier Fictif', type: 'participant', url: urlFor(index), ...fields });

/** Objets du PDF (les dictionnaires ne sont jamais compressés) : pages dans l'ordre, annotation /URI et /Rect de chacune. */
function pdfPages(buffer) {
  const text = buffer.toString('latin1');
  const objects = new Map([...text.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)].map((match) => [Number(match[1]), match[2]]));
  const refs = (source) => [...source.matchAll(/(\d+) 0 R/g)].map((match) => Number(match[1]));
  const tree = [...objects.values()].find((body) => /\/Type \/Pages/.test(body));
  return refs(/\/Kids \[([^\]]*)\]/.exec(tree)[1]).map((id) => {
    const page = objects.get(id);
    const annots = /\/Annots \[([^\]]*)\]/.exec(page);
    const annot = annots ? objects.get(refs(annots[1])[0]) : '';
    const action = /\/A (\d+) 0 R/.exec(annot)?.[1]; // le lien est un dictionnaire d'action, relié par référence
    return {
      mediaBox: /\/MediaBox \[([^\]]*)\]/.exec(page)?.[1].trim().split(/\s+/).map(Number),
      uri: /\/URI \(([^)]*)\)/.exec(`${annot}${action ? objects.get(Number(action)) : ''}`)?.[1],
      rect: /\/Rect \[([^\]]*)\]/.exec(annot)?.[1].trim().split(/\s+/).map(Number),
    };
  });
}

const pageCount = (buffer) => (buffer.toString('latin1').match(/\/Type \/Page(?![s\w])/g) ?? []).length;

/** Mots de chaque page avec leur boîte, d'après pdftotext -bbox : [[{ text, x0, y0, x1, y1 }]]. */
function pdfWords(file) {
  const run = spawnSync(PDFTOTEXT, ['-bbox', file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.split('<page ').slice(1).map((page) =>
    [...page.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((match) => ({
      x0: Number(match[1]), y0: Number(match[2]), x1: Number(match[3]), y1: Number(match[4]), text: match[5].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\''),
    })),
  );
}

/** Pages rendues en niveaux de gris : [{ width, height, data }]. */
function renderPages(file, directory) {
  const run = spawnSync(PDFTOPPM, ['-gray', '-r', String(DPI), file, path.join(directory, 'page')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return fs.readdirSync(directory).filter((name) => /^page-\d+\.pgm$/.test(name)).sort().map((name) => {
    const bytes = fs.readFileSync(path.join(directory, name));
    const header = /^P5\s+(\d+)\s+(\d+)\s+255\s/.exec(bytes.subarray(0, 40).toString('latin1'));
    return { width: Number(header[1]), height: Number(header[2]), data: bytes.subarray(header[0].length) };
  });
}

/** Matrice et zone de silence relues sur le rendu : le symbole est cherché à l'emplacement de son annotation. */
function readQr(image, rect, size) {
  const scale = DPI / 72;
  const [x0, y0, x1, y1] = rect; // repère du PDF (origine en bas à gauche)
  const side = x1 - x0;
  const module = side / size;
  const pixel = (x, topY) => image.data[Math.round(topY * scale) * image.width + Math.round(x * scale)];
  const top = A4.height - y1;
  const rows = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => pixel(x0 + (col + 0.5) * module, top + (row + 0.5) * module) < 128));
  const quiet = [];
  for (let step = 0.5; step < 4; step += 1) {
    for (let k = 0; k <= size; k += 4) {
      const along = k * module;
      quiet.push(pixel(x0 - step * module, top + along), pixel(x0 + side + step * module, top + along), pixel(x0 + along, top - step * module), pixel(x0 + along, top + side + step * module));
    }
  }
  return { rows, quiet, side };
}

/** Écrit le PDF dans un dossier temporaire, lance `check`, nettoie. */
async function withFiles(pdf, check) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jib-badges-'));
  try {
    const file = path.join(directory, 'badges.pdf');
    fs.writeFileSync(file, pdf);
    return await check({ file, directory });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const wordsOf = (page) => page.map((word) => word.text).join(' ');

describe('buildBadgesPdf : une page A4 par badge, QR relu sur le rendu (T-65, I-43)', { skip }, () => {
  const people = [
    badge(1, { firstName: 'Léa', lastName: 'Ducasse', type: 'participant' }),
    badge(2, { firstName: 'Hélène', lastName: 'Marques', type: 'speaker', company: 'Cabinet Verdelis' }),
    badge(3, { firstName: 'Benoît', lastName: 'Tastet', type: 'exhibitor_rep', company: 'Sylvadour' }),
    badge(4, { firstName: 'Odile', lastName: 'Organisatrice', type: 'organizer' }),
  ];
  let pdf;
  const built = async () => (pdf ??= await buildBadgesPdf({ badges: people, edition: EDITION, program: { sessions: [{ start: '9h00', title: 'Ouverture', speakers: [{ name: 'Léa Ducasse' }] }], notes: [] } }));

  it('autant de pages que de badges, toutes en A4 portrait', async () => {
    const buffer = await built();
    assert.equal(pageCount(buffer), 4);
    assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
    for (const page of pdfPages(buffer)) {
      assert.ok(Math.abs(page.mediaBox[2] - A4.width) < 0.1 && Math.abs(page.mediaBox[3] - A4.height) < 0.1, `MediaBox ${page.mediaBox}`);
    }
  });

  it('chaque page porte le prénom et le nom du badge de son rang, et le libellé de son type', async () => {
    await withFiles(await built(), ({ file }) => {
      const pages = pdfWords(file);
      assert.equal(pages.length, 4);
      const expected = [['Léa', 'Ducasse', 'PARTICIPANT'], ['Hélène', 'Marques', 'INTERVENANT'], ['Benoît', 'Tastet', 'EXPOSANT'], ['Odile', 'Organisatrice', 'ORGANISATEUR']];
      expected.forEach((words, index) => {
        // Le verso (demi-page gauche) est le programme, identique sur toutes les pages : seul le recto désigne la personne.
        const text = wordsOf(pages[index].filter((word) => word.x0 >= MID));
        for (const word of words) assert.ok(text.includes(word), `page ${index + 1} sans « ${word} » : ${text}`);
        for (const other of expected.filter((_, rank) => rank !== index)) assert.ok(!text.includes(other[1]), `page ${index + 1} porte « ${other[1]} »`);
      });
    });
  });

  it('chaque QR relu sur le rendu redonne la matrice de l’URL attendue ; l’annotation /URI porte cette URL ; 28 mm au moins', async () => {
    const buffer = await built();
    await withFiles(buffer, ({ file, directory }) => {
      const images = renderPages(file, directory);
      const pages = pdfPages(buffer);
      assert.equal(images.length, 4);
      people.forEach((person, index) => {
        assert.equal(pages[index].uri, person.url, `annotation de la page ${index + 1}`);
        const expected = qrMatrix(person.url);
        const read = readQr(images[index], pages[index].rect, expected.size);
        assert.deepEqual(read.rows, expected.rows, `QR de la page ${index + 1}`);
        assert.ok(read.side >= 28 * MM, `symbole de ${(read.side / MM).toFixed(1)} mm`);
        assert.ok(read.quiet.every((value) => value > 200), `zone de silence de 4 modules blanche, page ${index + 1}`);
      });
    });
  });

  it('contrôle négatif : le rendu de la page 1 ne correspond pas à la matrice de l’URL de la page 2 (la relecture distingue deux QR)', async () => {
    const buffer = await built();
    await withFiles(buffer, ({ file, directory }) => {
      const images = renderPages(file, directory);
      const pages = pdfPages(buffer);
      const read = readQr(images[0], pages[0].rect, qrMatrix(people[1].url).size);
      assert.notDeepEqual(read.rows, qrMatrix(people[1].url).rows);
      assert.deepEqual(read.rows, qrMatrix(people[0].url).rows);
    });
  });

  it('les QR de deux badges sont différents (une URL par personne)', async () => {
    const pages = pdfPages(await built());
    assert.equal(new Set(pages.map((page) => page.uri)).size, 4);
  });

  it('compress:false laisse les rectangles du QR lisibles (une opération « re » par rectangle) ; compressé, ils ne le sont pas', async () => {
    const options = { badges: [people[0]], edition: EDITION };
    const raw = (await buildBadgesPdf({ ...options, compress: false })).toString('latin1');
    const runs = qrRuns(qrMatrix(people[0].url)).length;
    assert.ok((raw.match(/ re\n/g) ?? []).length >= runs, `au moins ${runs} rectangles`);
    const packed = (await buildBadgesPdf(options)).toString('latin1');
    assert.ok((packed.match(/ re\n/g) ?? []).length < runs);
  });

  it('un badge seul donne une page', async () => {
    assert.equal(pageCount(await buildBadgesPdf({ badges: [people[0]], edition: EDITION })), 1);
  });
});

describe('buildBadgesPdf : rien ne déborde de sa colonne (T-66)', { skip }, () => {
  const bounds = (word) => ({ rectoLeft: word.x0 >= MID - 0.5, versoRight: word.x1 <= MID + 0.5 });

  function expectInsidePage(pages, label) {
    pages.forEach((words, index) => {
      for (const word of words) {
        assert.ok(word.x0 >= MARGIN - 0.5 && word.x1 <= A4.width - MARGIN + 0.5, `${label}, page ${index + 1}, « ${word.text} » hors des marges latérales (${word.x0.toFixed(1)} à ${word.x1.toFixed(1)})`);
        assert.ok(word.y0 >= MARGIN - 0.5 && word.y1 <= A4.height - MARGIN + 0.5, `${label}, page ${index + 1}, « ${word.text} » hors des marges verticales (${word.y0.toFixed(1)} à ${word.y1.toFixed(1)})`);
      }
    });
  }

  const interventions = (count) =>
    Array.from({ length: count }, (_, index) => ({
      start: `${8 + Math.floor(index / 6)}h${String((index % 6) * 10).padStart(2, '0')}`,
      title: `Intervention numéro ${index + 1} sur la valorisation des coproduits de scierie et des feuillus`,
      speakers: [{ name: 'Léa Ducasse' }, { name: 'Mathis Lagrange' }, { name: 'Inès Castaing' }],
    }));

  const longName = { firstName: 'Jean-Christophe', lastName: 'Montgolfier-Delacroix', jobTitle: 'Directeur général délégué aux affaires', company: 'Société Coopérative Régionale des Industries du Bois et des Forêts', type: 'participant' };

  it('un nom de 40 caractères, une entreprise de 60 : tout le texte du recto reste dans la demi-page droite et au-dessus du bandeau de type', async () => {
    const person = badge(1, { ...longName, firstName: 'Jean-Christophe', lastName: 'Montgolfier-Delacroix-XY' });
    assert.equal(`${person.firstName} ${person.lastName}`.length, 40);
    assert.equal(person.company.slice(0, 60).length, 60);
    const pdf = await buildBadgesPdf({ badges: [person], edition: EDITION, program: { sessions: [], notes: [] } });
    await withFiles(pdf, ({ file }) => {
      const [words] = pdfWords(file);
      expectInsidePage([words], 'recto');
      const band = words.find((word) => word.text === 'PARTICIPANT');
      assert.ok(band, 'libellé du bandeau lu');
      const recto = words.filter((word) => word.x0 >= MID);
      assert.ok(recto.some((word) => word.text.startsWith('Jean')), 'prénom présent');
      for (const word of recto.filter((candidate) => candidate.y0 < band.y0 - 5)) assert.ok(word.y1 <= band.y0 + 0.5, `« ${word.text} » recouvre le bandeau`);
      assert.ok(!recto.some((word) => word.x1 > A4.width - MARGIN + 0.5));
    });
  });

  it('un nom et une entreprise démesurés (300 caractères) sont tronqués avec « … » et restent dans la colonne', async () => {
    const person = badge(1, { firstName: 'Prénom'.repeat(20), lastName: 'Nom'.repeat(40), company: 'Entreprise '.repeat(30), jobTitle: 'Fonction '.repeat(30) });
    const pdf = await buildBadgesPdf({ badges: [person], edition: EDITION });
    await withFiles(pdf, ({ file }) => {
      const [words] = pdfWords(file);
      expectInsidePage([words], 'recto démesuré');
      const recto = words.filter((word) => word.x0 >= MID);
      assert.ok(recto.some((word) => word.text.endsWith('…')), 'troncature marquée par « … »');
      const band = words.find((word) => word.text === 'PARTICIPANT');
      for (const word of recto.filter((candidate) => candidate.y0 < band.y0 - 5)) assert.ok(word.y1 <= band.y0 + 0.5);
    });
  });

  it('un programme de 30 interventions : le verso reste dans la demi-page gauche, dans les marges, sur une seule page', async () => {
    const pdf = await buildBadgesPdf({ badges: [badge(1, longName)], edition: EDITION, program: { sessions: interventions(30), notes: [] } });
    assert.equal(pageCount(pdf), 1);
    await withFiles(pdf, ({ file }) => {
      const [words] = pdfWords(file);
      expectInsidePage([words], 'verso, 30 interventions');
      const verso = words.filter((word) => word.x0 < MID);
      assert.ok(verso.length > 50, 'programme lu');
      for (const word of verso) assert.ok(bounds(word).versoRight, `« ${word.text} » du verso passe dans la demi-page droite (${word.x1.toFixed(1)})`);
      for (const word of words.filter((candidate) => candidate.x0 >= MID)) assert.ok(bounds(word).rectoLeft);
    });
  });

  it('un programme impossible à loger est coupé par « Programme complet dans l’application », sans déborder', async () => {
    const pdf = await buildBadgesPdf({ badges: [badge(1)], edition: EDITION, program: { sessions: interventions(120), notes: [] } });
    await withFiles(pdf, ({ file }) => {
      const [words] = pdfWords(file);
      expectInsidePage([words], 'verso, 120 interventions');
      assert.ok(wordsOf(words).includes('Programme complet dans l’application'), wordsOf(words).slice(0, 400));
      assert.ok(!wordsOf(words).includes('numéro 120 '), 'la fin du programme est coupée');
    });
  });

  it('un programme vide : le verso ne porte que la mention qui renvoie à l’application', async () => {
    const pdf = await buildBadgesPdf({ badges: [badge(1)], edition: EDITION, program: null });
    await withFiles(pdf, ({ file }) => {
      const [words] = pdfWords(file);
      expectInsidePage([words], 'verso sans programme');
      assert.ok(wordsOf(words).includes('Programme complet dans l’application'));
    });
  });

  it('aucun tiret cadratin n’est écrit sur la page : un nom qui en contient reçoit un trait d’union', async () => {
    const person = badge(1, { firstName: `Anne${String.fromCharCode(0x2014)}Laure`, lastName: 'Durand' });
    const pdf = await buildBadgesPdf({ badges: [person], edition: EDITION });
    await withFiles(pdf, ({ file }) => {
      const text = wordsOf(pdfWords(file)[0]);
      assert.ok(text.includes('Anne-Laure'));
      assert.ok(!text.includes(String.fromCharCode(0x2014)));
    });
  });
});

describe('buildBadgesPdf : plan du lieu et verso (T-68, F-99)', { skip }, () => {
  const sessions = Array.from({ length: 6 }, (_, index) => ({ start: `${9 + index}h00`, title: `Table ronde ${index + 1} sur la forêt et la construction bois de demain en Nouvelle-Aquitaine`, speakers: [] }));
  const versoRight = (words) => Math.max(...words.filter((word) => word.x0 < MID && word.y0 > 90).map((word) => word.x1));

  it('sans plan : pas de zone « PLAN DU LIEU », le programme occupe toute la largeur du verso', async () => {
    const plan = makePng({ width: 200, height: 150 });
    const [without, withPlan] = await Promise.all([
      buildBadgesPdf({ badges: [badge(1)], edition: EDITION, program: { sessions, notes: [] } }),
      buildBadgesPdf({ badges: [badge(1)], edition: EDITION, program: { sessions, notes: [] }, plan }),
    ]);
    const right = {};
    await withFiles(without, ({ file }) => {
      const [words] = pdfWords(file);
      assert.ok(!wordsOf(words).includes('PLAN'), 'aucune zone de plan');
      right.without = versoRight(words);
      assert.ok(right.without > 200, `le programme s’étend sur la colonne (${right.without.toFixed(0)})`);
    });
    await withFiles(withPlan, ({ file }) => {
      const [words] = pdfWords(file);
      assert.ok(wordsOf(words).includes('PLAN DU LIEU'));
      const programWords = words.filter((word) => word.x0 < MID && word.y0 > 90 && word.text !== 'PLAN' && word.text !== 'DU' && word.text !== 'LIEU');
      assert.ok(programWords.length > 10);
      right.withPlan = Math.max(...programWords.filter((word) => word.x0 < 170).map((word) => word.x1));
    });
    assert.ok(right.without > right.withPlan + 20, `programme plus large sans plan (${right.without.toFixed(0)} contre ${right.withPlan.toFixed(0)})`);
  });

  it('avec un plan, l’image est dans la demi-page gauche et dans les marges', async () => {
    const plan = makePng({ width: 300, height: 200 });
    const pdf = await buildBadgesPdf({ badges: [badge(1)], edition: EDITION, program: { sessions, notes: [] }, plan, compress: false });
    const raw = pdf.toString('latin1');
    // Deux images : le logo (recto) et le plan (verso). Le plan est posé par `cm` dans la demi-page gauche.
    const placements = [...raw.matchAll(/q\n([\d.\-]+) 0 0 ([\d.\-]+) ([\d.\-]+) ([\d.\-]+) cm\n\/I\d+ Do\n/g)];
    assert.equal(placements.length, 2, 'logo et plan');
    const planBox = placements.map((m) => ({ w: Number(m[1]), h: Math.abs(Number(m[2])), x: Number(m[3]) })).find((box) => box.x < MID);
    assert.ok(planBox, 'plan à gauche');
    assert.ok(planBox.x + planBox.w <= MID + 0.5, 'plan dans la demi-page gauche');
    assert.ok(planBox.x >= MARGIN - 0.5);
  });

  it('couleur d’accent : le bandeau de type prend l’accent de l’édition s’il tient AA, sinon le bleu des titres', async () => {
    const colorOps = async (accent) => {
      const raw = (await buildBadgesPdf({ badges: [badge(1)], edition: EDITION, accent, compress: false })).toString('latin1');
      return [...raw.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) scn\n/g)].map((match) => match.slice(1, 4).map((value) => Math.round(Number(value) * 255)));
    };
    const has = (list, rgb) => list.some((color) => color.every((value, index) => Math.abs(value - rgb[index]) <= 1));
    assert.ok(has(await colorOps('#600e24'), [0x60, 0x0e, 0x24]), 'accent foncé utilisé');
    const light = await colorOps('#ffff00');
    assert.ok(!has(light, [0xff, 0xff, 0x00]), 'accent trop clair refusé');
    assert.ok(has(light, [0x32, 0x50, 0x62]), 'bleu des titres en repli');
  });
});

describe('buildBadgesPdf : dépendances et réseau (I-43)', () => {
  it('pdfkit fonctionne sans appel réseau (no-network préchargé) et rend un Buffer', async () => {
    const pdf = await buildBadgesPdf({ badges: [badge(1)], edition: EDITION });
    assert.ok(Buffer.isBuffer(pdf));
    assert.ok(pdf.length > 1000);
    assert.equal(typeof PDFDocument, 'function');
  });

  it('un jeton ne figure en clair que dans l’annotation et le QR de son badge, jamais dans les métadonnées', async () => {
    const pdf = (await buildBadgesPdf({ badges: [badge(1, { url: `http://localhost:4321/espace/e/carte/${TOKEN}` })], edition: EDITION, compress: false })).toString('latin1');
    const info = /\/Info \d+ 0 R/.test(pdf) ? pdf.slice(pdf.indexOf('/Title'), pdf.indexOf('/Title') + 200) : '';
    assert.ok(!info.includes(TOKEN));
    assert.equal(pdf.split(TOKEN).length - 1, 1, 'une seule occurrence : l’annotation /URI');
  });
});
