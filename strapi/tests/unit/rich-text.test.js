'use strict';

/** Texte riche de l'éditeur du programme (15-administration.md, D-23, NF-72, T-80). */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { cleanRichText } = require('../../src/api/espace/lib/rich-text');

describe('nettoyage du texte riche (NF-72)', () => {
  it('garde gras, italique, listes, liens et intertitres', () => {
    assert.equal(cleanRichText('<h2>Titre</h2><p><b>Gras</b> et <i>italique</i></p><ol><li>un<li>deux</ol>'), '<h3>Titre</h3><p><strong>Gras</strong> et <em>italique</em></p><ol><li>un</li><li>deux</li></ol>');
    assert.equal(cleanRichText('<a href="https://example.org/?a=1&b=2" target="_blank">lien</a>'), '<a href="https://example.org/?a=1&amp;b=2">lien</a>');
  });
  it('retire scripts, gestionnaires d’événement, styles et liens javascript:, même déguisés', () => {
    assert.equal(cleanRichText('<p onclick="x()">a</p><script>alert(1)</script><style>p{}</style>'), '<p>a</p>');
    assert.equal(cleanRichText('<a href="javascript:alert(1)">x</a><a href=" java&#115;cript:1">y</a><img src=x onerror=alert(1)>'), 'xy');
    assert.equal(cleanRichText('<iframe src="https://example.org"></iframe>texte'), 'texte');
  });
  it('échappe le texte et rend null quand il ne reste rien', () => {
    assert.equal(cleanRichText('3 < 4 & 5 > 2'), '3 &lt; 4 &amp; 5 &gt; 2');
    assert.equal(cleanRichText('<p> </p><br>'), null);
    assert.equal(cleanRichText(null), null);
  });
});
