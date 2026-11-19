'use strict';

/** lib/csv.js (F-91) : fichier lisible par Excel en français, et aucune cellule interprétée comme une formule. */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { toCsv, cell } = require('../../src/api/espace/lib/csv');

describe('toCsv (F-91)', () => {
  it('commence par le BOM UTF-8, sépare par des points-virgules et termine chaque ligne par CRLF', () => {
    assert.equal(toCsv(['Nom', 'Prénom'], [['Ducasse', 'Léa']]), '﻿Nom;Prénom\r\nDucasse;Léa\r\n');
  });

  it('met entre guillemets une cellule qui porte un point-virgule, un guillemet ou un saut de ligne', () => {
    assert.equal(cell('Bois; Forêt'), '"Bois; Forêt"');
    assert.equal(cell('dite "la scierie"'), '"dite ""la scierie"""');
    assert.equal(cell('13h00\r\n15h30'), '"13h00\n15h30"');
  });

  it('rend vide une valeur absente et écrit les nombres tels quels', () => {
    assert.deepEqual([cell(null), cell(undefined), cell(0), cell(12)], ['', '', '0', '12']);
  });

  it('neutralise par une apostrophe une cellule qu’un tableur lirait comme une formule', () => {
    for (const value of ['=1+1', '+33 6 00 00 00 00', '-2', '@SUM(A1)', '\tx']) assert.equal(cell(value).replace(/^"/, '')[0], "'", value);
    assert.equal(cell('=HYPERLINK("http://example.org";"x")'), '"\'=HYPERLINK(""http://example.org"";""x"")"');
  });
});
