'use strict';

/**
 * Rendu des e-mails de l'espace (I-30, I-31, NF-05, NF-30) : lib/mail/layout.js (escapeHtml), lib/mail/render.js
 * (renderEmail) et un gabarit par fichier dans lib/mail/templates/.
 *
 *   - socle (lot 2) : échappement HTML, contrôle du nom de gabarit ;
 *   - gabarits `welcome` et `meeting-cancelled` (lot 4), `access-link` (lot 5) : lien présent en HTML et en texte,
 *     échappement d'un nom contenant `<script>`, couleur d'édition, enveloppe commune (600 px, logo, pied), aucun tiret
 *     cadratin, apostrophes typographiques ;
 *   - lien « Gérer mes notifications » : présent dans l'enveloppe commune, absent d'`access-link` (`manage: false`, design Q5) ;
 *   - `meeting-cancelled` : le motif (`reason`) n'est affiché que s'il est donné (section 11 du plan de la phase 1, point 6).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const MAIL = '../../src/api/espace/lib/mail';
const render = () => require(`${MAIL}/render`);
const escapeHtml = (value) => {
  const layout = require(`${MAIL}/layout`);
  return (layout.escapeHtml ?? render().escapeHtml)(value);
};
const renderEmail = (name, data) => render().renderEmail(name, data);

// Motifs assemblés : ce fichier ne contient lui-même aucune des écritures du tiret cadratin (conventions.test.js).
const EM_DASH = new RegExp([String.fromCharCode(0x2014), ['&', 'mdash;'].join(''), ['&#', '8212;'].join(''), ['&#x', '2014;'].join('')].join('|'), 'i');
const EDITION = { slug: 'nouvelle-aquitaine-test', title: 'Nouvelle-Aquitaine (test)', themeColor: '#600e24' };
const PUBLIC_URL = 'https://journees.example.org';
const ACTION_URL = `${PUBLIC_URL}/espace/verifier?token=abc-_123&next=%2Fespace%2Fnouvelle-aquitaine-test%2F`;
const HOSTILE = '<script>alert("x")</script>';

describe('escapeHtml (NF-05)', () => {
  it('neutralise les caractères du HTML', () => {
    const escaped = escapeHtml(`${HOSTILE} & l'été`);
    for (const forbidden of ['<', '>', '"', "'"]) assert.ok(!escaped.includes(forbidden), `« ${forbidden} » subsiste dans ${escaped}`);
    assert.ok(escaped.includes('&lt;script&gt;'));
    assert.ok(escaped.includes('&amp;'));
  });

  it('laisse le texte français et les accents intacts', () => {
    assert.equal(escapeHtml('Hélène Marquès, Économie circulaire'), 'Hélène Marquès, Économie circulaire');
  });

  it('échappe l’esperluette une seule fois', () => {
    assert.equal(escapeHtml('a & b'), 'a &amp; b');
  });
});

describe('renderEmail : nom de gabarit contrôlé (^[a-z-]+$)', () => {
  for (const name of ['../x', '../../config/server', 'Access-Link', 'access_link', 'access link', 'access-link.js', 'a/b', '', 'welcome\0', '1']) {
    it(`refuse le nom ${JSON.stringify(name)} avant de charger quoi que ce soit`, async () => {
      assert.equal(typeof render().renderEmail, 'function');
      await assert.rejects(async () => renderEmail(name, { edition: EDITION, publicUrl: PUBLIC_URL }), (error) => {
        assert.notEqual(error.code, 'MODULE_NOT_FOUND', 'le nom doit être refusé par le contrôle ^[a-z-]+$, pas par un échec de chargement');
        return true;
      });
    });
  }

  it('refuse un nom valide sans gabarit correspondant', async () => {
    assert.equal(typeof render().renderEmail, 'function');
    await assert.rejects(async () => renderEmail('gabarit-inexistant', { edition: EDITION, publicUrl: PUBLIC_URL }));
  });
});

/**
 * Assertions communes à tout gabarit : enveloppe, couleur, échappement, typographie. `manage` : le gabarit porte le lien
 * « Gérer mes notifications » de l'enveloppe commune (faux pour `access-link`, `manage: false`).
 */
function describeTemplate(name, { data, mustContain, subjectPattern, manage = true }) {
  describe(`gabarit ${name}`, () => {
    const rendered = async (overrides = {}) => renderEmail(name, { ...data, ...overrides });

    it('renvoie un objet de rendu : objet, HTML et texte non vides, objet sur une ligne', async () => {
      const { subject, html, text } = await rendered();
      for (const [key, value] of Object.entries({ subject, html, text })) assert.ok(typeof value === 'string' && value.trim(), `${key} vide`);
      assert.ok(!/[\r\n]/.test(subject), 'objet sur plusieurs lignes');
      if (subjectPattern) assert.match(subject, subjectPattern);
    });

    it('place le lien dans le HTML (href) et dans le texte', async () => {
      const { html, text } = await rendered();
      const url = data.url ?? data.agendaUrl;
      assert.ok(text.includes(url), 'lien absent de la version texte');
      assert.ok(html.includes(url) || html.includes(escapeHtml(url)), 'lien absent de la version HTML');
      assert.match(html, /href="[^"]*espace[^"]*"/);
    });

    it('porte les informations propres au gabarit, en HTML et en texte', async () => {
      const { html, text } = await rendered();
      for (const expected of mustContain) {
        assert.ok(text.includes(expected), `« ${expected} » absent du texte`);
        assert.ok(html.includes(expected), `« ${expected} » absent du HTML`);
      }
    });

    it('échappe un prénom (et une contrepartie) contenant <script> dans le HTML', async () => {
      const { html } = await rendered({ firstName: HOSTILE, counterpartName: HOSTILE, reason: HOSTILE });
      assert.ok(!html.includes('<script'), 'balise script non échappée');
      assert.ok(!html.includes('alert("x")'), 'guillemets du script non échappés');
      assert.ok(html.includes('&lt;script&gt;'), 'le nom hostile doit apparaître échappé');
    });

    it('échappe le titre de l’édition', async () => {
      const { html } = await rendered({ edition: { ...EDITION, title: HOSTILE } });
      assert.ok(!html.includes('<script'));
    });

    it('colore l’en-tête avec la couleur de l’édition', async () => {
      const { html } = await rendered({ edition: { ...EDITION, themeColor: '#123abc' } });
      assert.match(html, /#123abc/i);
    });

    it('enveloppe le contenu dans le gabarit commun : 600 px, logo blanc, pied Xylofutur', async () => {
      const { html } = await rendered();
      assert.match(html, /600/);
      assert.ok(html.includes(`${PUBLIC_URL}/assets/logo-jib-blanc.png`), 'logo blanc absent');
      assert.match(html, /Xylofutur/);
    });

    if (manage) {
      it('porte le lien « Gérer mes notifications » vers /espace/{édition}/profil', async () => {
        const { html } = await rendered();
        assert.match(html, /Gérer mes notifications/);
        assert.ok(html.includes(`${PUBLIC_URL}/espace/${EDITION.slug}/profil`), 'lien de gestion des notifications absent');
      });
    } else {
      it('ne porte ni « Gérer mes notifications » ni lien vers le profil (manage: false, design Q5)', async () => {
        const { html, text } = await rendered();
        assert.doesNotMatch(html, /Gérer mes notifications/);
        assert.doesNotMatch(text, /Gérer mes notifications/);
        assert.ok(!html.includes(`/espace/${EDITION.slug}/profil`), 'lien vers le profil présent');
      });
    }

    it('ne contient aucun tiret cadratin', async () => {
      const { subject, html, text } = await rendered();
      for (const [key, value] of Object.entries({ subject, html, text })) assert.ok(!EM_DASH.test(value), `tiret cadratin dans ${key}`);
    });

    it('emploie l’apostrophe typographique dans l’objet et le texte (CLAUDE.md, conventions)', async () => {
      const { subject, text } = await rendered();
      assert.ok(!subject.includes("'"), `apostrophe droite dans l’objet : ${subject}`);
      assert.ok(!text.includes("'"), 'apostrophe droite dans le texte');
    });

    it('est déterministe et ne modifie pas ses données', async () => {
      const copy = structuredClone(data);
      const first = await rendered();
      assert.deepEqual(data, copy);
      assert.deepEqual(await rendered(), first);
    });
  });
}

describeTemplate('welcome', {
  data: { edition: EDITION, publicUrl: PUBLIC_URL, firstName: 'Léa', url: ACTION_URL, validityHours: 72 },
  mustContain: ['Léa', '72'],
});

describeTemplate('meeting-cancelled', {
  data: {
    edition: EDITION,
    publicUrl: PUBLIC_URL,
    firstName: 'Léa',
    slotLabel: '10h45',
    counterpartName: 'Mathis Lagrange',
    reason: 'Inscription annulée',
    agendaUrl: `${PUBLIC_URL}/espace/verifier?token=agenda-_123&next=%2Fespace%2Fnouvelle-aquitaine-test%2Frendez-vous`,
  },
  mustContain: ['Léa', '10h45', 'Mathis Lagrange'],
});

describeTemplate('access-link', {
  data: { edition: EDITION, publicUrl: PUBLIC_URL, firstName: 'Léa', url: ACTION_URL, validityMinutes: 30 },
  mustContain: ['Léa', '30'],
  manage: false,
});

describe('meeting-cancelled : motif facultatif (R-18, section 11 du plan, point 6)', () => {
  const DATA = {
    edition: EDITION,
    publicUrl: PUBLIC_URL,
    firstName: 'Léa',
    slotLabel: 'jeudi 3 décembre à 10h45',
    counterpartName: 'Mathis Lagrange',
    agendaUrl: `${PUBLIC_URL}/espace/verifier?token=agenda-_123&next=%2Fespace%2F${EDITION.slug}%2Frendez-vous`,
  };

  it('affiche le motif quand il est donné, en HTML et en texte', async () => {
    const { html, text } = await renderEmail('meeting-cancelled', { ...DATA, reason: 'Salle indisponible' });
    assert.ok(html.includes('Salle indisponible') && text.includes('Salle indisponible'));
  });

  for (const reason of [undefined, null, '']) {
    it(`n’affiche aucun motif quand reason vaut ${JSON.stringify(reason) ?? 'undefined'} : R-18 ne le donne pas, « Inscription annulée » se lirait comme celle du destinataire`, async () => {
      const { html, text } = await renderEmail('meeting-cancelled', { ...DATA, reason });
      for (const content of [html, text]) {
        assert.doesNotMatch(content, /Motif/);
        assert.doesNotMatch(content, /Inscription annulée/);
      }
    });
  }

  it('désigne le créneau par son libellé rédigé et l’autre partie par son nom', async () => {
    const { subject, text } = await renderEmail('meeting-cancelled', DATA);
    assert.ok(subject.includes('jeudi 3 décembre à 10h45'), subject);
    assert.ok(text.includes('Mathis Lagrange'));
  });
});
