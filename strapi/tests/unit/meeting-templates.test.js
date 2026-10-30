'use strict';

/**
 * Gabarits d'e-mail des rendez-vous (lot 8, tests d'abord ; I-31, I-41, A-33, F-52, F-60, F-61, NF-05) : `meeting-request`,
 * `meeting-accepted`, `meeting-declined`. Données communes `{ edition, publicUrl, firstName }`, données propres : section 3.3 du plan
 * des phases 2 et 3 (`venue` : texte, le nom du lieu de l’édition, ou vide ; interprétation consignée dans tests/SPEC.md). Même enveloppe que les gabarits de la phase 1 (tests/unit/mail-templates.test.js) : 600 px, logo, pied
 * Xylofutur, lien « Gérer mes notifications », objet sur une ligne avec espace insécable avant les deux-points.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');


const MAIL = '../../src/api/espace/lib/mail';
const renderEmail = (name, data) => require(`${MAIL}/render`).renderEmail(name, data);

// Motifs assemblés : ce fichier ne contient lui-même aucune écriture du tiret cadratin (conventions.test.js).
const EM_DASH = new RegExp([String.fromCharCode(0x2014), ['&', 'mdash;'].join(''), ['&#', '8212;'].join(''), ['&#x', '2014;'].join('')].join('|'), 'i');
const NBSP = String.fromCharCode(0xa0);
const EDITION = { slug: 'nouvelle-aquitaine-test', title: 'Nouvelle-Aquitaine (test)', themeColor: '#600e24' };
const PUBLIC_URL = 'https://journees.example.org';
const HOSTILE = '<script>alert("x")</script>';
const SLOT_LABEL = 'jeudi 3 décembre à 13h00';
const link = (path) => `${PUBLIC_URL}/espace/verifier?token=${path}-_123&next=%2Fespace%2F${EDITION.slug}%2Fagenda%3Fdemande%3Dabc123`;

/** Assertions communes à tout gabarit de rendez-vous. */
function describeTemplate(name, { data, urls, mustContain, hostile, defects = {} }) {
  describe(`gabarit ${name}`, () => {
    const rendered = (overrides = {}) => renderEmail(name, { ...data, ...overrides });

    it('renvoie objet, HTML et texte non vides, l’objet sur une ligne', () => {
      const { subject, html, text } = rendered();
      for (const [key, value] of Object.entries({ subject, html, text })) assert.ok(typeof value === 'string' && value.trim(), `${key} vide`);
      assert.ok(!/[\r\n]/.test(subject), 'objet sur plusieurs lignes');
    });

    it('espace insécable avant les deux-points de l’objet, jamais une espace ordinaire', defects.nbsp ? { todo: defects.nbsp } : {}, () => {
      const { subject } = rendered();
      assert.doesNotMatch(subject, / :/, `espace ordinaire avant « : » dans ${subject}`);
      if (subject.includes(':')) assert.ok(subject.includes(`${NBSP}:`), subject);
    });

    it('place chaque lien d’action dans le HTML (href) et dans le texte', () => {
      const { html, text } = rendered();
      for (const url of urls) {
        assert.ok(text.includes(url), `lien absent du texte : ${url}`);
        assert.ok(html.includes(url.replaceAll('&', '&amp;')) || html.includes(url), `lien absent du HTML : ${url}`);
      }
    });

    it('porte les informations du rendez-vous, en HTML et en texte', () => {
      const { html, text } = rendered();
      for (const expected of mustContain) {
        assert.ok(text.includes(expected), `« ${expected} » absent du texte`);
        assert.ok(html.includes(expected), `« ${expected} » absent du HTML`);
      }
    });

    it('échappe le HTML des noms, libellés et textes libres (NF-05)', () => {
      const { html } = rendered(Object.fromEntries(hostile.map((key) => [key, HOSTILE])));
      assert.ok(!html.includes('<script'), 'balise script non échappée');
      assert.ok(html.includes('&lt;script&gt;'), 'le texte hostile doit apparaître échappé');
    });

    it('colore l’en-tête avec la couleur de l’édition', () => {
      assert.match(rendered({ edition: { ...EDITION, themeColor: '#123abc' } }).html, /#123abc/i);
    });

    it('enveloppe commune : 600 px, logo blanc, pied Xylofutur', () => {
      const { html } = rendered();
      assert.match(html, /600/);
      assert.ok(html.includes(`${PUBLIC_URL}/assets/logo-jib-blanc.png`));
      assert.match(html, /Xylofutur/);
    });

    it('porte le lien « Gérer mes notifications » vers /espace/{édition}/profil', () => {
      const { html } = rendered();
      assert.match(html, /Gérer mes notifications/);
      assert.ok(html.includes(`${PUBLIC_URL}/espace/${EDITION.slug}/profil`));
    });

    it('ne contient aucun tiret cadratin', () => {
      const { subject, html, text } = rendered();
      for (const [key, value] of Object.entries({ subject, html, text })) assert.ok(!EM_DASH.test(value), `tiret cadratin dans ${key}`);
    });

    it('emploie l’apostrophe typographique dans l’objet et le texte', () => {
      const { subject, text } = rendered();
      assert.ok(!subject.includes("'"), `apostrophe droite dans l’objet : ${subject}`);
      assert.ok(!text.includes("'"), 'apostrophe droite dans le texte');
    });

    it('est déterministe et ne modifie pas ses données', () => {
      const copy = structuredClone(data);
      const first = rendered();
      assert.deepEqual(data, copy);
      assert.deepEqual(rendered(), first);
    });

    it('ne laisse apparaître ni « undefined » ni « null » ni « [object Object] »', () => {
      const { subject, html, text } = rendered();
      for (const content of [subject, html, text]) assert.doesNotMatch(content, /undefined|\bnull\b|\[object Object\]/);
    });
  });
}

const REQUEST = {
  edition: EDITION,
  publicUrl: PUBLIC_URL,
  firstName: 'Léa',
  requesterName: 'Inès Castaing',
  requesterSubtitle: 'Cheffe de projet, Atelier Fictif',
  slotLabel: SLOT_LABEL,
  sessionTitle: 'Cocktail déjeunatoire et B2B',
  message: 'Bonjour Léa, échangeons sur la construction bois.',
  counter: null,
  acceptUrl: link('accepter'),
  viewUrl: link('voir'),
};

describeTemplate('meeting-request', {
  data: REQUEST,
  urls: [REQUEST.acceptUrl, REQUEST.viewUrl],
  mustContain: ['Léa', 'Inès Castaing', 'Cheffe de projet, Atelier Fictif', SLOT_LABEL, 'Cocktail déjeunatoire et B2B', 'Bonjour Léa, échangeons sur la construction bois.'],
  hostile: ['firstName', 'requesterName', 'requesterSubtitle', 'sessionTitle', 'message'],
});

describe('meeting-request : boutons, message et nouvelle proposition (F-52, A-31, A-33)', () => {
  const rendered = (overrides = {}) => renderEmail('meeting-request', { ...REQUEST, ...overrides });
  const everything = (result) => `${result.subject}\n${result.html}\n${result.text}`;

  it('le bouton « Accepter » mène au lien d’action d’acceptation, « Voir la demande » au lien de consultation', () => {
    const { html } = rendered();
    const hrefOf = (label) => html.match(new RegExp(`<a href="([^"]+)"[^>]*>${label}</a>`))?.[1];
    assert.equal(hrefOf('Accepter')?.replaceAll('&amp;', '&'), REQUEST.acceptUrl);
    assert.equal(hrefOf('Voir la demande')?.replaceAll('&amp;', '&'), REQUEST.viewUrl);
  });

  it('les deux liens sont distincts : chaque bouton porte son propre lien d’action (A-33)', () => {
    assert.notEqual(REQUEST.acceptUrl, REQUEST.viewUrl);
    const { text } = rendered();
    assert.ok(text.includes(REQUEST.acceptUrl) && text.includes(REQUEST.viewUrl));
  });

  it('l’objet nomme le demandeur ou le créneau', () => {
    const { subject } = rendered();
    assert.ok(subject.includes('Inès Castaing') || subject.includes(SLOT_LABEL), subject);
  });

  for (const message of [null, undefined, '']) {
    it(`sans message (${JSON.stringify(message) ?? 'undefined'}) : aucun bloc de message vide`, () => {
      const result = rendered({ message });
      assert.doesNotMatch(everything(result), /undefined|\bnull\b/);
      assert.ok(!result.html.includes('<blockquote></blockquote>'));
    });
  }

  it('le message du demandeur est affiché tel quel, apostrophes comprises', () => {
    const { html, text } = rendered({ message: 'À l’heure du déjeuner ? Je viens de Pau.' });
    assert.ok(text.includes('À l’heure du déjeuner ? Je viens de Pau.'));
    assert.ok(html.includes('À l’heure du déjeuner ? Je viens de Pau.'));
  });

  it('variante « nouvelle proposition » : le créneau précédent est rappelé', () => {
    const result = rendered({ counter: { previousSlotLabel: 'jeudi 3 décembre à 10h45' } });
    assert.ok(result.html.includes('jeudi 3 décembre à 10h45'));
    assert.ok(result.text.includes('jeudi 3 décembre à 10h45'));
    assert.match(everything(result), /nouvelle proposition/i);
  });

  it('sans contre-proposition, aucune mention de « nouvelle proposition »', () => {
    assert.doesNotMatch(everything(rendered({ counter: null })), /nouvelle proposition/i);
  });

  it('la variante échappe aussi le créneau précédent', () => {
    const { html } = rendered({ counter: { previousSlotLabel: HOSTILE } });
    assert.ok(!html.includes('<script'));
  });
});

const ACCEPTED = {
  edition: EDITION,
  publicUrl: PUBLIC_URL,
  firstName: 'Inès',
  counterpartName: 'Léa Ducasse',
  slotLabel: SLOT_LABEL,
  location: 'Table 1',
  venue: 'Salle de recette (lieu fictif)',
  agendaUrl: link('agenda'),
  booking: false,
};

describeTemplate('meeting-accepted', {
  data: ACCEPTED,
  urls: [ACCEPTED.agendaUrl],
  mustContain: ['Inès', 'Léa Ducasse', SLOT_LABEL, 'Table 1', 'Salle de recette (lieu fictif)'],
  hostile: ['firstName', 'counterpartName', 'location', 'venue'],
});

describe('meeting-accepted : lieu, réservation et pièce jointe (A-33, I-41, R-19)', () => {
  const rendered = (overrides = {}) => renderEmail('meeting-accepted', { ...ACCEPTED, ...overrides });

  it('donne le nom du lieu de l’édition à côté de la table', () => {
    const { html, text } = rendered();
    assert.ok(text.includes('Table 1') && text.includes('Salle de recette (lieu fictif)'));
    assert.ok(html.includes('Salle de recette (lieu fictif)'));
  });

  it('un rendez-vous à un stand affiche « Stand 12 »', () => {
    const { html, text } = rendered({ location: 'Stand 12' });
    assert.ok(html.includes('Stand 12') && text.includes('Stand 12'));
  });

  it('sans lieu d’édition (venue nul), le message reste correct', () => {
    const { subject, html, text } = rendered({ venue: null });
    for (const content of [subject, html, text]) assert.doesNotMatch(content, /undefined|\bnull\b|\[object Object\]/);
    assert.ok(html.includes('Table 1'));
  });

  it('une réservation de table dédiée (booking) se distingue d’une acceptation', () => {
    const accepted = rendered({ booking: false });
    const booked = rendered({ booking: true });
    assert.notEqual(booked.html, accepted.html);
    for (const result of [accepted, booked]) {
      assert.ok(result.html.includes('Table 1') && result.html.includes('Léa Ducasse') && result.html.includes(SLOT_LABEL));
    }
  });

  it('échappe le nom du lieu', () => {
    const { html } = rendered({ venue: HOSTILE });
    assert.ok(!html.includes('<script'));
  });
});

const DECLINED = {
  edition: EDITION,
  publicUrl: PUBLIC_URL,
  firstName: 'Inès',
  counterpartName: 'Léa Ducasse',
  slotLabel: SLOT_LABEL,
  reason: 'Le créneau n’est plus disponible.',
  directoryUrl: link('annuaire'),
};

describeTemplate('meeting-declined', {
  data: DECLINED,
  urls: [DECLINED.directoryUrl],
  mustContain: ['Inès', 'Léa Ducasse', SLOT_LABEL, 'Le créneau n’est plus disponible.'],
  hostile: ['firstName', 'counterpartName', 'reason'],
});

describe('meeting-declined : motif facultatif et invitation à choisir un autre créneau (F-61, R-15, A-30)', () => {
  const rendered = (overrides = {}) => renderEmail('meeting-declined', { ...DECLINED, ...overrides });

  it('affiche le motif quand il est donné', () => {
    const { html, text } = rendered({ reason: 'Je suis en réunion à cette heure.' });
    assert.ok(html.includes('Je suis en réunion à cette heure.') && text.includes('Je suis en réunion à cette heure.'));
  });

  for (const reason of [undefined, null, '']) {
    it(`sans motif (${JSON.stringify(reason) ?? 'undefined'}) : rien d’affiché à la place`, () => {
      const { html, text } = rendered({ reason });
      for (const content of [html, text]) assert.doesNotMatch(content, /undefined|\bnull\b/);
      assert.ok(!html.includes('Le créneau n’est plus disponible.'));
    });
  }

  it('invite à choisir un autre créneau depuis l’annuaire', () => {
    const { text } = rendered();
    assert.match(text, /annuaire|autre créneau|autre rendez-vous/i);
    assert.ok(text.includes(DECLINED.directoryUrl));
  });
});

// Lot 14 : `new-message` (R-62, F-73). Même enveloppe que les gabarits de rendez-vous, mêmes contrôles.
const NEW_MESSAGE = {
  edition: EDITION,
  publicUrl: PUBLIC_URL,
  firstName: 'Léa',
  authorName: 'Mathis Lagrange',
  excerpt: 'J’apporterai nos échantillons de panneaux.',
  threadUrl: link('fil'),
};

// D4 (mineur, ouvert) : `lib/mail/templates/new-message.js` définit `const NBSP = ' '` avec une espace ordinaire (U+0020), pas U+00A0 :
// l'objet « Nouveau message : Mathis Lagrange » et les guillemets du corps n'ont pas d'espace insécable (convention du plan, section 3.3).
// Reproduction : renderEmail('new-message', données).subject contient ' :' (U+0020). Les tests concernés sont `todo` jusqu'à la correction.
const D4 = 'D4 : new-message.js emploie une espace ordinaire à la place de l’espace insécable';

describeTemplate('new-message', {
  data: NEW_MESSAGE,
  urls: [NEW_MESSAGE.threadUrl],
  mustContain: ['Léa', 'Mathis Lagrange', 'J’apporterai nos échantillons de panneaux.'],
  hostile: ['firstName', 'authorName', 'excerpt'],
  defects: { nbsp: D4 },
});

describe('new-message : objet, bouton et contenu limité à l’extrait (R-62, R-63, F-73)', () => {
  const rendered = (overrides = {}) => renderEmail('new-message', { ...NEW_MESSAGE, ...overrides });

  it('objet « Nouveau message : {auteur} » avec espace insécable', { todo: D4 }, () => {
    assert.equal(rendered().subject, `Nouveau message${NBSP}: Mathis Lagrange`);
  });

  it('un bouton « Lire et répondre » vers le fil', () => {
    const { html, text } = rendered();
    assert.match(html, /Lire et répondre/);
    assert.match(text, /Lire et répondre/);
  });

  it('l’extrait est entre guillemets français, avec espaces insécables', { todo: D4 }, () => {
    assert.ok(rendered().text.includes(`«${NBSP}J’apporterai nos échantillons de panneaux.${NBSP}»`));
  });

  it('ne porte que l’extrait donné : rien du reste du message (R-63)', () => {
    const { html, text } = rendered({ excerpt: 'Début du message…' });
    assert.ok(!html.includes('échantillons') && !text.includes('échantillons'));
  });

  it('sans prénom : « Bonjour, »', () => {
    assert.match(rendered({ firstName: '' }).text, /Bonjour,/);
  });

  it('ne parle pas de la gestion des messages d’un autre destinataire', () => {
    assert.doesNotMatch(rendered().text, /Léa Ducasse/);
  });
});
