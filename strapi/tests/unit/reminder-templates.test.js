'use strict';

/**
 * Gabarits des relances (lot V3-A : R-70, R-17, I-39, NF-05, maquette 08-relance) : `reminder-profile` (a), `reminder-no-meeting` (b),
 * `reminder-eve` (c). Même enveloppe que les autres gabarits (600 px, logo, pied Xylofutur, « Gérer mes notifications »).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { renderEmail } = require('../../src/api/espace/lib/mail/render');

// Motifs assemblés : ce fichier ne contient lui-même aucune écriture du tiret cadratin (conventions.test.js).
const EM_DASH = new RegExp([String.fromCharCode(0x2014), ['&', 'mdash;'].join(''), ['&#', '8212;'].join(''), ['&#x', '2014;'].join('')].join('|'), 'i');
const NBSP = String.fromCharCode(0xa0);
const EDITION = { slug: 'nouvelle-aquitaine-test', title: 'Nouvelle-Aquitaine (test)', themeColor: '#600e24' };
const PUBLIC_URL = 'https://journees.example.org';
const HOSTILE = '<script>alert("x")</script>';
const action = (name) => `${PUBLIC_URL}/espace/verifier?token=${name}-_123&next=%2Fespace%2F${EDITION.slug}%2F${name}`;
const MANAGE = action('profil');

const PEOPLE = [
  { displayName: 'Julien Roche', subtitle: 'Intervenant, Process, data et IA', initials: 'JR' },
  { displayName: 'Sofia Vidal, Lignum Data', subtitle: 'Exposante, stand 4', initials: 'SV' },
];
const VENUE = { name: 'Salle de recette', address: '1 rue de l’Exemple\n33000 Bordeaux', mapUrl: 'https://maps.example.org/salle', description: 'Entrée par la rue latérale,\nbadge à retirer à l’accueil.' };

const COMMON = { edition: EDITION, publicUrl: PUBLIC_URL, manageUrl: MANAGE, firstName: 'Léa' };
const PROFILE = { ...COMMON, completion: 40, missing: ['votre photo', 'vos sujets d’intérêt'], suggestions: PEOPLE, daysLeft: 6, city: 'Bordeaux', pauses: ['10h45', '12h30', '15h30'], profileUrl: action('profil') };
const NO_MEETING = { ...COMMON, suggestions: PEOPLE, daysLeft: 6, pauses: ['10h45', '15h30'], directoryUrl: action('annuaire') };
const EVE = {
  ...COMMON,
  dayLabel: 'jeudi 3 décembre',
  meetings: [{ time: '10h45', counterpartName: 'Julien Roche', location: 'Table 3' }, { time: '15h30', counterpartName: 'Sofia Vidal', location: null }],
  expired: [{ time: '12h30', counterpartName: 'Thomas Lafitte' }],
  venue: VENUE,
  agendaUrl: action('agenda'),
};

const TEMPLATES = [
  ['reminder-profile', PROFILE, [PROFILE.profileUrl], ['firstName', 'city']],
  ['reminder-no-meeting', NO_MEETING, [NO_MEETING.directoryUrl], ['firstName']],
  ['reminder-eve', EVE, [EVE.agendaUrl], ['firstName', 'dayLabel']],
];

const decode = (html) => html.replaceAll('&amp;', '&');

for (const [name, data, urls, hostile] of TEMPLATES) {
  describe(`gabarit ${name} : enveloppe commune`, () => {
    const rendered = (overrides = {}) => renderEmail(name, { ...data, ...overrides });

    it('renvoie objet, HTML et texte non vides, l’objet sur une ligne', () => {
      const { subject, html, text } = rendered();
      for (const [key, value] of Object.entries({ subject, html, text })) assert.ok(typeof value === 'string' && value.trim(), `${key} vide`);
      assert.ok(!/[\r\n]/.test(subject));
    });

    it('espace insécable avant les deux-points de l’objet, jamais une espace ordinaire', () => {
      const { subject } = rendered();
      assert.doesNotMatch(subject, / :/);
    });

    it('place le lien d’action dans le HTML (href) et dans le texte', () => {
      const { html, text } = rendered();
      for (const url of urls) {
        assert.ok(text.includes(url), `lien absent du texte : ${url}`);
        assert.ok(decode(html).includes(`href="${url}"`), `lien absent du HTML : ${url}`);
      }
    });

    it('« Gérer mes notifications » pointe vers le lien d’action de `manageUrl`', () => {
      const { html, text } = rendered();
      assert.match(html, /Gérer mes notifications/);
      assert.ok(decode(html).includes(`href="${MANAGE}"`));
      assert.ok(text.includes(MANAGE));
    });

    it('sans `manageUrl`, repli sur /espace/{édition}/profil', () => {
      const { html } = rendered({ manageUrl: undefined });
      assert.ok(html.includes(`${PUBLIC_URL}/espace/${EDITION.slug}/profil`));
    });

    it('échappe le HTML des noms et textes libres (NF-05)', () => {
      const { html } = rendered(Object.fromEntries(hostile.map((key) => [key, HOSTILE])));
      assert.ok(!html.includes('<script'), 'balise script non échappée');
      assert.ok(html.includes('&lt;script&gt;'));
    });

    it('colore l’en-tête avec la couleur de l’édition, 600 px, logo blanc, pied Xylofutur', () => {
      const { html } = rendered({ edition: { ...EDITION, themeColor: '#123abc' } });
      assert.match(html, /#123abc/i);
      assert.match(html, /600/);
      assert.ok(html.includes(`${PUBLIC_URL}/assets/logo-jib-blanc.png`));
      assert.match(html, /Xylofutur/);
    });

    it('aucun tiret cadratin, apostrophes typographiques seulement dans l’objet et le texte', () => {
      const { subject, html, text } = rendered();
      for (const [key, value] of Object.entries({ subject, html, text })) assert.ok(!EM_DASH.test(value), `tiret cadratin dans ${key}`);
      assert.ok(!subject.includes("'"));
      assert.ok(!text.includes("'"));
    });

    it('déterministe et sans modifier ses données', () => {
      const copy = structuredClone(data);
      const first = rendered();
      assert.deepEqual(data, copy);
      assert.deepEqual(rendered(), first);
    });

    it('ne laisse apparaître ni « undefined » ni « null » ni « [object Object] »', () => {
      const { subject, html, text } = rendered();
      for (const content of [subject, html, text]) assert.doesNotMatch(content, /undefined|\bnull\b|\[object Object\]/);
    });

    it('sans prénom : « Bonjour, » et un objet sans prénom vide', () => {
      const { subject, text } = rendered({ firstName: undefined });
      assert.match(text, /Bonjour,/);
      assert.doesNotMatch(subject, /^,|undefined/);
    });
  });
}

describe('reminder-profile (a)', () => {
  const rendered = (overrides = {}) => renderEmail('reminder-profile', { ...PROFILE, ...overrides });

  it('dit le pourcentage avec une espace insécable et ce qui manque, en phrase', () => {
    const { text } = rendered();
    assert.ok(text.includes(`Votre profil est complet à 40${NBSP}%.`));
    assert.ok(text.includes('Il manque votre photo et vos sujets d’intérêt'));
  });

  it('objet avec les suggestions : nombre de rencontres et ville ; sans suggestion : invitation à compléter', () => {
    assert.equal(rendered().subject, 'Léa, 2 rencontres vous attendent à Bordeaux');
    assert.equal(rendered({ suggestions: [PEOPLE[0]] }).subject, 'Léa, 1 rencontre vous attend à Bordeaux');
    assert.equal(rendered({ suggestions: [] }).subject, 'Léa, complétez votre profil avant les Journées');
  });

  it('compte à rebours dans le titre, selon les jours restants', () => {
    assert.match(rendered({ daysLeft: 6 }).html, /Plus que 6 jours/);
    assert.match(rendered({ daysLeft: 1 }).html, /Plus qu’un jour/);
    assert.match(rendered({ daysLeft: 0 }).html, /Les Journées approchent/);
  });

  it('liste les suggestions avec leurs initiales et leur légende', () => {
    const { html, text } = rendered();
    for (const person of PEOPLE) {
      assert.ok(html.includes(person.displayName) && text.includes(person.displayName), person.displayName);
      assert.ok(html.includes(person.subtitle));
      assert.ok(html.includes(`>${person.initials}<`));
    }
  });

  it('sans suggestion : pas de bloc de personnes', () => {
    assert.doesNotMatch(rendered({ suggestions: [] }).html, /Ils partagent vos sujets/);
  });

  it('nomme les pauses B2B ; sans pause, la ligne disparaît', () => {
    assert.match(rendered().text, /pauses B2B de 10h45, 12h30 et 15h30/);
    assert.doesNotMatch(rendered({ pauses: [] }).text, /pauses B2B/);
  });

  it('un seul élément manquant : « avec lui »', () => {
    assert.match(rendered({ missing: ['votre photo'] }).text, /Il manque votre photo.*avec lui/);
  });

  it('rien ne manque : pas de phrase « Il manque »', () => {
    assert.doesNotMatch(rendered({ missing: [] }).text, /Il manque/);
  });

  it('un seul bouton principal, vers le profil', () => {
    const buttons = [...decode(rendered().html).matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].filter(([, , label]) => label !== 'Gérer mes notifications');
    assert.deepEqual(buttons.map(([, href, label]) => [href, label]), [[PROFILE.profileUrl, 'Compléter mon profil et prendre rendez-vous']]);
  });
});

describe('reminder-no-meeting (b)', () => {
  const rendered = (overrides = {}) => renderEmail('reminder-no-meeting', { ...NO_MEETING, ...overrides });

  it('objet et bouton vers l’annuaire', () => {
    assert.equal(rendered().subject, 'Léa, prenez rendez-vous avant les Journées');
    assert.match(decode(rendered().html), /<a href="[^"]*annuaire"[^>]*>Parcourir l’annuaire<\/a>/);
  });

  it('titre selon les jours restants', () => {
    assert.match(rendered({ daysLeft: 6 }).html, /Plus que 6 jours/);
    assert.match(rendered({ daysLeft: 1 }).html, /Les Journées approchent/);
  });

  it('dit qu’il n’y a pas encore de rendez-vous et liste les suggestions', () => {
    const { text } = rendered();
    assert.match(text, /pas encore de rendez-vous/);
    assert.ok(text.includes('Julien Roche'));
  });

  it('pauses : deux pauses « X et Y », sans pause la ligne disparaît', () => {
    assert.match(rendered().text, /pauses B2B de 10h45 et 15h30/);
    assert.doesNotMatch(rendered({ pauses: [] }).text, /créneaux de rendez-vous se tiennent/);
  });
});

describe('reminder-eve (c) : agenda de la veille (R-70 c, R-17)', () => {
  const rendered = (overrides = {}) => renderEmail('reminder-eve', { ...EVE, ...overrides });
  const SHORT = { meetings: [], expired: [] };

  it('liste les rendez-vous acceptés : heure, interlocuteur, table ou stand', () => {
    const { html, text } = rendered();
    for (const line of [`10h45${NBSP}: Julien Roche, Table 3`, `15h30${NBSP}: Sofia Vidal`]) {
      assert.ok(text.includes(line), line);
      assert.ok(html.includes(line), line);
    }
  });

  it('liste les demandes expirées à part, avec une phrase qui les introduit', () => {
    const { text } = rendered();
    assert.match(text, /n’ont pas reçu de réponse/);
    assert.ok(text.includes(`12h30${NBSP}: Thomas Lafitte`));
  });

  it('sans demande expirée : pas de bloc d’expirées', () => {
    assert.doesNotMatch(rendered({ expired: [] }).text, /n’ont pas reçu de réponse/);
  });

  it('porte le lieu, l’accès (retours à la ligne aplatis) et le lien du plan', () => {
    const { text, html } = rendered();
    assert.ok(text.includes(`Lieu${NBSP}: Salle de recette, 1 rue de l’Exemple, 33000 Bordeaux`));
    assert.ok(text.includes(`Accès${NBSP}: Entrée par la rue latérale, badge à retirer à l’accueil.`));
    assert.ok(text.includes(VENUE.mapUrl));
    assert.ok(html.includes('Lieu et accès'));
  });

  it('objet : un rendez-vous, plusieurs, ou aucun', () => {
    assert.equal(rendered().subject, 'Léa, vos 2 rendez-vous du jeudi 3 décembre');
    assert.equal(rendered({ meetings: [EVE.meetings[0]] }).subject, 'Léa, votre rendez-vous du jeudi 3 décembre');
    assert.equal(rendered(SHORT).subject, 'Léa, les Journées, c’est le jeudi 3 décembre');
  });

  it('mentionne la pièce jointe .ics seulement s’il y a des rendez-vous', () => {
    assert.match(rendered().text, /\.ics/);
    assert.doesNotMatch(rendered(SHORT).text, /\.ics/);
  });

  it('forme courte sans rendez-vous : part quand même, dit qu’il n’y en a pas, garde lieu et accès et le bouton agenda', () => {
    const { text, html, subject } = rendered(SHORT);
    assert.ok(subject && html && text);
    assert.match(text, /pas de rendez-vous prévu/);
    assert.match(text, /Lieu/);
    assert.ok(text.includes(EVE.agendaUrl));
    assert.doesNotMatch(text, /Vos rendez-vous acceptés/);
  });

  it('sans lieu (venue vide) : ni « Lieu » ni plan, et aucune erreur', () => {
    const { text } = rendered({ venue: null });
    assert.doesNotMatch(text, /Lieu et accès|Lieu\s*:/);
    assert.doesNotMatch(text, /maps\.example/);
  });

  it('lieu sans plan ni description : seulement le lieu', () => {
    const { text } = rendered({ venue: { name: 'Salle seule' } });
    assert.ok(text.includes(`Lieu${NBSP}: Salle seule`));
    assert.doesNotMatch(text, /Accès/);
  });

  it('échappe les noms d’interlocuteurs, les lieux et le lieu de l’édition (NF-05)', () => {
    const { html } = rendered({
      meetings: [{ time: '10h45', counterpartName: HOSTILE, location: HOSTILE }],
      expired: [{ time: '12h30', counterpartName: HOSTILE }],
      venue: { name: HOSTILE, address: HOSTILE, description: HOSTILE, mapUrl: 'https://maps.example.org/x' },
    });
    assert.ok(!html.includes('<script'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('un seul bouton principal : « Voir mon agenda »', () => {
    const buttons = [...decode(rendered().html).matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].filter(([, , label]) => label !== 'Gérer mes notifications' && label.startsWith('Voir'));
    assert.deepEqual(buttons.map(([, href, label]) => [href, label]), [[EVE.agendaUrl, 'Voir mon agenda']]);
  });
});
