'use strict';

/**
 * Jeux de données de recette (A-13, B2, B3, 10-recette.md, Q-17) : cohérence entre
 * fixtures/recette.json (programme, sujets, personnes) et fixtures/helloasso-items.json (billets).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const recette = require('../../scripts/espace/fixtures/recette.json');
const items = require('../../scripts/espace/fixtures/helloasso-items.json');
const { FORM } = require('../../scripts/espace/fake-helloasso');

/** Adresse d'un billet telle que l'import la lira : champ Email, sinon e-mail du payeur (I-11). */
const ticketEmail = (item) =>
  (item.customFields.find((f) => f.name === 'Email')?.answer || item.payer.email).trim().toLowerCase();

const attendees = Object.entries(recette.attendees);

describe('recette.json : édition (10-recette.md)', () => {
  it('décrit l’édition « nouvelle-aquitaine-test » du 3 décembre 2026 à Bordeaux', () => {
    const { edition } = recette;
    assert.equal(edition.slug, 'nouvelle-aquitaine-test');
    assert.equal(edition.title, 'Nouvelle-Aquitaine (test)');
    assert.equal(edition.year, 2026);
    assert.equal(edition.region, 'nouvelle-aquitaine');
    assert.equal(edition.date, '2026-12-03');
    assert.equal(edition.city, 'Bordeaux');
    assert.equal(edition.edition_status, 'inscriptions-ouvertes');
    assert.equal(edition.hero_bg_color, '#600e24');
    assert.equal(edition.lieux.length, 1);
  });

  it('pointe le formulaire HelloAsso du faux (organisation, type, slug)', () => {
    assert.equal(recette.editionSettings.helloassoOrgSlug, FORM.organizationSlug);
    assert.equal(recette.editionSettings.helloassoFormType, FORM.formType);
    assert.equal(recette.editionSettings.helloassoFormSlug, FORM.formSlug);
  });

  it('paramètre la correspondance des champs d’import selon Q-03 : Email, Organisation, Poste', () => {
    assert.deepEqual(recette.editionSettings.helloassoFieldMap, { email: 'Email', company: 'Organisation', jobTitle: 'Poste' });
  });

  it('règle 3 tables, des créneaux de 15 minutes et une fenêtre de rendez-vous ouverte', () => {
    const { tablesCount, slotDurationMinutes, meetingRequestsOpenAt, meetingRequestsCloseAt } = recette.editionSettings;
    assert.equal(tablesCount, 3);
    assert.equal(slotDurationMinutes, 15);
    assert.ok(Date.parse(meetingRequestsOpenAt) < Date.parse('2026-10-29T12:00:00Z'), 'ouverte à la date de la recette');
    assert.ok(Date.parse(meetingRequestsCloseAt) > Date.parse(meetingRequestsOpenAt));
    assert.ok(Date.parse(meetingRequestsCloseAt) < Date.parse('2026-12-03T00:00:00Z'), 'fermée avant le jour J');
  });
});

describe('recette.json : programme et sujets', () => {
  it('compte 9 séquences', () => {
    assert.equal(recette.sequences.length, 9);
  });

  it('compte les trois pauses B2B : 10h45 à 11h15, 12h30 à 14h00, 15h30 à 16h00', () => {
    const breaks = recette.sequences.filter((s) => s.kind === 'b2b_break').map((s) => [s.start_time, s.end_time]);
    assert.deepEqual(breaks, [
      ['10h45', '11h15'],
      ['12h30', '14h00'],
      ['15h30', '16h00'],
    ]);
  });

  it('compte les 5 sujets de la recette', () => {
    assert.deepEqual(recette.topics, [
      'Forêt et adaptation',
      'Process, data et IA',
      'Économie circulaire',
      'Territoires résilients',
      'Construction bois',
    ]);
  });

  it('a une séquence « talk » par sujet', () => {
    const talks = recette.sequences.filter((s) => s.kind === 'talk');
    assert.deepEqual(talks.map((s) => s.topic), recette.topics);
    assert.deepEqual(talks.map((s) => s.title), recette.topics);
  });

  it('enchaîne les séquences sans chevauchement ni trou', () => {
    const minutes = (text) => {
      const [h, m] = text.split('h').map(Number);
      return h * 60 + m;
    };
    for (let i = 1; i < recette.sequences.length; i += 1) {
      assert.equal(recette.sequences[i].start_time, recette.sequences[i - 1].end_time, recette.sequences[i].title);
    }
    for (const s of recette.sequences) assert.ok(minutes(s.end_time) > minutes(s.start_time), s.title);
  });

  it('utilise des horaires au format « 9h15 » analysable par lib/time.js (A-09)', () => {
    for (const s of recette.sequences) {
      assert.match(s.start_time, /^\d{1,2}h\d{2}$/);
      assert.match(s.end_time, /^\d{1,2}h\d{2}$/);
    }
  });
});

describe('recette.json : organisations, intervenants, exposants', () => {
  const slugs = new Set(recette.organisations.map((o) => o.slug));

  it('préfixe tous les slugs d’organisation et d’intervenant par « test- » (repérage par le seed)', () => {
    for (const o of recette.organisations) assert.match(o.slug, /^test-/);
    for (const i of recette.intervenants) assert.match(i.slug, /^test-/);
  });

  it('compte 4 organisations, 2 exposants (stands 4 et 12) et 2 intervenants', () => {
    assert.equal(recette.organisations.length, 4);
    assert.deepEqual(recette.exhibitors.map((e) => e.standNumber), ['4', '12']);
    assert.equal(recette.intervenants.length, 2);
  });

  it('rattache chaque intervenant et chaque exposant à une organisation existante', () => {
    for (const i of recette.intervenants) assert.ok(slugs.has(i.organisation), i.slug);
    for (const e of recette.exhibitors) assert.ok(slugs.has(e.organisation), e.organisation);
  });

  it('rattache chaque intervenant à une séquence existante du programme', () => {
    const titles = new Set(recette.sequences.map((s) => s.title));
    for (const i of recette.intervenants) assert.ok(titles.has(i.sequence), i.sequence);
  });

  it('n’utilise que des sujets déclarés', () => {
    const topics = new Set(recette.topics);
    for (const e of recette.exhibitors) for (const t of e.topics) assert.ok(topics.has(t), t);
    for (const [email, a] of attendees) for (const t of a.topics) assert.ok(topics.has(t), `${email} : ${t}`);
    for (const i of recette.intervenants) assert.ok(topics.has(i.topic), i.slug);
  });

  it('ne cite que des sites en example.org', () => {
    for (const o of recette.organisations) assert.match(o.website, /^https:\/\/example\.org\//);
  });
});

describe('recette.json : personnes (Q-17, 10-recette.md)', () => {
  const byRole = (role) => attendees.filter(([, a]) => a.role === role);

  it('compte 17 personnes : 12 participants, 2 intervenants, 3 représentants d’exposants', () => {
    assert.equal(attendees.length, 17);
    assert.equal(byRole('participant').length, 12);
    assert.equal(byRole('speaker').length, 2);
    assert.equal(byRole('exhibitor_rep').length, 3);
  });

  it('compte 2 participants sans consentement annuaire et 1 participant annulé', () => {
    const participants = byRole('participant').map(([, a]) => a);
    assert.equal(participants.filter((a) => !a.directoryOptIn).length, 2);
    assert.equal(participants.filter((a) => a.status === 'cancelled').length, 1);
  });

  it('répartit les représentants : 2 pour le stand 4 (Sylvadour), 1 pour le stand 12 (Résinéo)', () => {
    const reps = byRole('exhibitor_rep').map(([, a]) => a.exhibitor);
    assert.equal(reps.filter((s) => s === 'test-sylvadour').length, 2);
    assert.equal(reps.filter((s) => s === 'test-resineo').length, 1);
  });

  it('lie chaque intervenant à un intervenant du programme', () => {
    const slugs = new Set(recette.intervenants.map((i) => i.slug));
    for (const [, a] of byRole('speaker')) assert.ok(slugs.has(a.speaker), a.speaker);
  });

  it('déclare un organisateur sans billet : organisation@example.org', () => {
    assert.deepEqual(recette.organizerEmails, ['organisation@example.org']);
    assert.ok(!items.some((item) => ticketEmail(item) === 'organisation@example.org'));
  });

  it('n’utilise que des adresses en @example.org', () => {
    for (const [email] of attendees) assert.match(email, /^[a-z0-9.\-]+@example\.org$/, email);
    for (const email of recette.organizerEmails) assert.match(email, /@example\.org$/);
  });

  it('est écrit en minuscules, sans espace (clés comparables à l’adresse normalisée de l’import, I-11)', () => {
    for (const [email] of attendees) assert.equal(email, email.trim().toLowerCase());
  });
});

describe('cohérence entre recette.json et helloasso-items.json (source unique des personnes, A-13)', () => {
  it('fait correspondre chaque personne de recette.json à un billet, et inversement', () => {
    const fromTickets = items.map(ticketEmail).sort();
    const fromRecette = attendees.map(([email]) => email).sort();
    assert.deepEqual(fromTickets, fromRecette);
  });

  it('ne compte aucune adresse en double parmi les billets', () => {
    const emails = items.map(ticketEmail);
    assert.equal(new Set(emails).size, emails.length);
  });

  it('accorde le statut « annulé » de recette.json au billet Canceled', () => {
    const cancelled = attendees.filter(([, a]) => a.status === 'cancelled').map(([email]) => email);
    const canceledTickets = items.filter((i) => i.state === 'Canceled').map(ticketEmail);
    assert.deepEqual(cancelled, canceledTickets);
  });

  it('accorde le tarif du billet au rôle : Intervenant pour speaker, Exposant pour exhibitor_rep', () => {
    const tariffOf = Object.fromEntries(items.map((i) => [ticketEmail(i), i.name]));
    for (const [email, a] of attendees) {
      if (a.role === 'speaker') assert.equal(tariffOf[email], 'Intervenant', email);
      if (a.role === 'exhibitor_rep') assert.equal(tariffOf[email], 'Exposant', email);
      if (a.role === 'participant') assert.match(tariffOf[email], /Nouvelle-Auitaine$/, email);
    }
  });

  it('accorde le nom des intervenants entre billets et programme', () => {
    for (const [email, a] of attendees.filter(([, x]) => x.role === 'speaker')) {
      const ticket = items.find((i) => ticketEmail(i) === email);
      const speaker = recette.intervenants.find((i) => i.slug === a.speaker);
      assert.equal(`${ticket.user.firstName} ${ticket.user.lastName}`, speaker.name);
    }
  });

  it('place tous les billets dans le formulaire de recette', () => {
    for (const item of items) {
      assert.equal(item.order.organizationSlug, FORM.organizationSlug);
      assert.equal(item.order.formType, FORM.formType);
      assert.equal(item.order.formSlug, FORM.formSlug);
    }
  });

  it('ne contient ni IBAN, ni numéro de carte, ni adresse postale (hygiène des données fictives)', () => {
    const text = JSON.stringify(items);
    assert.ok(!/iban|cardNumber|\bFR76\b/i.test(text));
    assert.ok(!/"address"|"street"|"city"/i.test(text));
  });
});
