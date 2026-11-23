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

// Lot 12 (phases 2 et 3, plan section 4) : rendez-vous, conversations et présentations de la recette. Vérifié contre les règles pures de
// lib/meetings.js (tables dédiées A-29) et lib/slots.js (libellés de créneaux), sans Strapi : le seed charge ce fichier tel quel.
describe('recette.json : rendez-vous, conversations et tables dédiées (lot 12, R-19, A-27, A-29, A-37, A-38)', () => {
  const { computeSlots } = require('../../src/api/espace/lib/slots');
  const { hostedTables } = require('../../src/api/espace/lib/meetings');

  const { meetings, conversations } = recette;
  const labels = computeSlots({
    date: recette.edition.date,
    durationMinutes: recette.editionSettings.slotDurationMinutes,
    sessions: recette.sequences.map((sequence, index) => ({ ...sequence, documentId: `s${index}` })),
  }).slots.map((slot) => slot.label);
  const tablesCount = recette.editionSettings.tablesCount;
  const exhibitorSlugs = recette.exhibitors.map((exhibitor) => exhibitor.organisation);
  const people = new Set(Object.keys(recette.attendees));
  const describeMeeting = (meeting) => `${meeting.requester} -> ${meeting.target ?? meeting.targetExhibitor} (${meeting.slot})`;

  it('compte 8 rendez-vous : 3 acceptés, 3 en attente, 1 refusé, 1 annulé', () => {
    assert.equal(meetings.length, 8);
    const count = (status) => meetings.filter((meeting) => meeting.status === status).length;
    assert.deepEqual([count('accepted'), count('pending'), count('declined'), count('cancelled')], [3, 3, 1, 1]);
  });

  it('chaque rendez-vous vise exactement une cible, une personne ou un exposant de la recette', () => {
    for (const meeting of meetings) {
      assert.ok(people.has(meeting.requester), `demandeur inconnu : ${describeMeeting(meeting)}`);
      assert.ok(Boolean(meeting.target) !== Boolean(meeting.targetExhibitor), `une seule cible : ${describeMeeting(meeting)}`);
      if (meeting.target) assert.ok(people.has(meeting.target), `cible inconnue : ${describeMeeting(meeting)}`);
      if (meeting.targetExhibitor) assert.ok(exhibitorSlugs.includes(meeting.targetExhibitor), `exposant inconnu : ${describeMeeting(meeting)}`);
      if (meeting.answeredBy) assert.ok(people.has(meeting.answeredBy), `répondant inconnu : ${describeMeeting(meeting)}`);
    }
  });

  it('personne ne se demande soi-même, et aucun demandeur n’est annulé', () => {
    for (const meeting of meetings) {
      assert.notEqual(meeting.requester, meeting.target, describeMeeting(meeting));
      assert.notEqual(recette.attendees[meeting.requester].status, 'cancelled', describeMeeting(meeting));
    }
  });

  it('chaque créneau est un des 10 créneaux des pauses B2B de la recette', () => {
    assert.equal(labels.length, 10);
    for (const meeting of meetings) assert.ok(labels.includes(meeting.slot), `créneau inexistant « ${meeting.slot} » : ${describeMeeting(meeting)}`);
  });

  it('statuts valables, et les dates vont dans l’ordre : demande, réponse, annulation', () => {
    for (const meeting of meetings) {
      assert.ok(['pending', 'accepted', 'declined', 'cancelled'].includes(meeting.status), describeMeeting(meeting));
      if (meeting.answeredAt) assert.ok(meeting.answeredAt >= meeting.createdAt, `réponse avant la demande : ${describeMeeting(meeting)}`);
      if (meeting.cancelledAt) assert.ok(meeting.cancelledAt >= meeting.createdAt, describeMeeting(meeting));
      if (meeting.status === 'pending') assert.ok(!meeting.answeredAt && !meeting.answeredBy, `une demande en attente n’a pas de réponse : ${describeMeeting(meeting)}`);
    }
  });

  it('les demandes sont écrites dans la fenêtre de prise de rendez-vous, avant sa fermeture', () => {
    const { meetingRequestsOpenAt, meetingRequestsCloseAt } = recette.editionSettings;
    for (const meeting of meetings) {
      assert.ok(meeting.createdAt >= meetingRequestsOpenAt, describeMeeting(meeting));
      assert.ok(meeting.createdAt < meetingRequestsCloseAt, describeMeeting(meeting));
    }
  });

  it('dates fixes : aucune ne dépend de l’horloge du poste (deux passages du seed donnent les mêmes comptes)', () => {
    for (const meeting of meetings) for (const key of ['createdAt', 'answeredAt', 'cancelledAt']) if (meeting[key]) assert.match(meeting[key], /^2026-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });

  it('les tables : un rendez-vous accepté à table a un numéro entre 1 et tablesCount, et deux ne partagent jamais créneau et table (A-27)', () => {
    const taken = new Set();
    for (const meeting of meetings.filter((item) => item.status === 'accepted' && item.tableNumber)) {
      assert.ok(Number.isInteger(meeting.tableNumber) && meeting.tableNumber >= 1 && meeting.tableNumber <= tablesCount, describeMeeting(meeting));
      const key = `${meeting.slot}:${meeting.tableNumber}`;
      assert.ok(!taken.has(key), `table en double : ${key}`);
      taken.add(key);
    }
  });

  it('la recette n’a qu’une table dédiée : Antoine Vergnes, intervenant, table 2 (lot commun : tables 1 et 3)', () => {
    const withTable = attendees.filter(([, a]) => a.hostedTableNumber !== undefined);
    assert.deepEqual(withTable.map(([email]) => email), ['antoine.vergnes@example.org']);
    const [[, antoine]] = withTable;
    assert.equal(antoine.role, 'speaker');
    assert.equal(antoine.hostedTableNumber, 2);

    const rows = attendees.map(([email, a], index) => ({ id: index + 1, documentId: email, role: a.role, status: a.status, hostedTableNumber: a.hostedTableNumber ?? null }));
    const { hosted, warnings } = hostedTables(rows, tablesCount);
    assert.deepEqual([...hosted], [['antoine.vergnes@example.org', 2]]);
    assert.deepEqual(warnings, [], 'aucun conflit ni numéro invalide dans la recette');
  });

  it('R-19 : la réservation de la table d’Antoine (Hugo, 10h45) est acceptée d’emblée à la table 2, sans répondant', () => {
    const booking = meetings.find((meeting) => meeting.target === 'antoine.vergnes@example.org');
    assert.equal(booking.requester, 'hugo.peyrat@example.org');
    assert.equal(booking.slot, '10h45');
    assert.equal(booking.status, 'accepted');
    assert.equal(booking.tableNumber, 2);
    assert.ok(!booking.answeredBy, 'answeredBy vide pour une réservation');
    assert.ok(booking.answeredAt, 'answeredAt renseigné');
    assert.equal(meetings.filter((meeting) => meeting.target === 'antoine.vergnes@example.org').length, 1, 'une seule réservation pour le créneau d’essai du soir');
  });

  it('un rendez-vous entre deux personnes n’emploie jamais la table dédiée, et le lot commun suffit', () => {
    const hostedNumber = recette.attendees['antoine.vergnes@example.org'].hostedTableNumber;
    for (const meeting of meetings.filter((item) => item.status === 'accepted' && item.tableNumber && item.target !== 'antoine.vergnes@example.org')) {
      assert.notEqual(meeting.tableNumber, hostedNumber, describeMeeting(meeting));
    }
  });

  it('la cible d’un rendez-vous accepte les rendez-vous (meetingsOptIn), hors table dédiée', () => {
    for (const meeting of meetings.filter((item) => item.target && item.target !== 'antoine.vergnes@example.org')) {
      assert.equal(recette.attendees[meeting.target].meetingsOptIn, true, describeMeeting(meeting));
    }
  });

  it('R-11.5 et R-11.6 : personne n’a deux rendez-vous acceptés sur le même créneau', () => {
    const busy = new Set();
    for (const meeting of meetings.filter((item) => item.status === 'accepted')) {
      for (const person of [meeting.requester, meeting.target].filter(Boolean)) {
        const key = `${person}@${meeting.slot}`;
        assert.ok(!busy.has(key), `${person} a deux rendez-vous acceptés à ${meeting.slot}`);
        busy.add(key);
      }
    }
  });

  it('R-11.7 : pas deux demandes actives entre les mêmes personnes, dans un sens ou dans l’autre', () => {
    const active = meetings.filter((meeting) => ['pending', 'accepted'].includes(meeting.status));
    const pairs = active.map((meeting) => [meeting.requester, meeting.target ?? `x:${meeting.targetExhibitor}`].sort().join('|'));
    assert.equal(new Set(pairs).size, pairs.length, `paire en double : ${pairs.join(' ; ')}`);
  });

  it('R-11.9 : aucun demandeur n’a plus de 9 demandes en attente', () => {
    const pending = Object.groupBy(meetings.filter((meeting) => meeting.status === 'pending'), (meeting) => meeting.requester);
    for (const [person, list] of Object.entries(pending)) assert.ok(list.length < 10, `${person} : ${list.length}`);
  });

  it('un rendez-vous accepté à un stand est confirmé par un représentant de cet exposant', () => {
    for (const meeting of meetings.filter((item) => item.targetExhibitor && item.status === 'accepted')) {
      const answerer = recette.attendees[meeting.answeredBy];
      assert.equal(answerer.role, 'exhibitor_rep', describeMeeting(meeting));
      assert.equal(answerer.exhibitor, meeting.targetExhibitor, describeMeeting(meeting));
    }
  });

  it('parcours du soir : la demande d’Inès à Léa (13h00) attend sa réponse, avec son message, et celle de Jules (13h15) est refusée par Léa', () => {
    const ines = meetings.find((meeting) => meeting.requester === 'ines.castaing@example.org' && meeting.target === 'lea.ducasse@example.org');
    assert.equal(ines.status, 'pending');
    assert.equal(ines.slot, '13h00');
    assert.equal(ines.message, 'Bonjour Léa, échangeons sur la construction bois.');
    const jules = meetings.find((meeting) => meeting.requester === 'jules.mazeres@example.org');
    assert.deepEqual([jules.status, jules.slot, jules.answeredBy], ['declined', '13h15', 'lea.ducasse@example.org']);
  });

  it('parcours du soir : Léa a un rendez-vous accepté avec Mathis (10h45, table 1), avec Sylvadour (12h30, stand 4) et une demande à Hélène (15h30)', () => {
    const lea = meetings.filter((meeting) => meeting.requester === 'lea.ducasse@example.org');
    const summary = (status) => lea.filter((meeting) => meeting.status === status).map((meeting) => `${meeting.target ?? meeting.targetExhibitor}@${meeting.slot}`).sort();
    assert.deepEqual(summary('accepted'), ['mathis.lagrange@example.org@10h45', 'test-sylvadour@12h30']);
    assert.deepEqual(summary('pending'), ['helene.marques@example.org@15h30']);
  });

  it('la demande d’Alice à Résinéo (15h45) est en attente : de quoi tester la réponse au nom du stand', () => {
    const alice = meetings.find((meeting) => meeting.requester === 'alice.fourcade@example.org');
    assert.deepEqual([alice.targetExhibitor, alice.slot, alice.status], ['test-resineo', '15h45', 'pending']);
  });

  it('une demande annulée porte son motif et sa date', () => {
    const cancelled = meetings.find((meeting) => meeting.status === 'cancelled');
    assert.ok(cancelled.cancelledAt && cancelled.cancelReason);
  });

  it('conversations : Léa et Mathis (3 messages), Inès et Léa (1 message)', () => {
    assert.equal(conversations.length, 2);
    const sizes = conversations.map(({ participants, messages }) => [participants.slice().sort().join(' + '), messages.length]);
    assert.deepEqual(sizes, [
      ['lea.ducasse@example.org + mathis.lagrange@example.org', 3],
      ['ines.castaing@example.org + lea.ducasse@example.org', 1],
    ]);
  });

  it('chaque message est écrit par un des deux participants, du plus ancien au plus récent, lu après son envoi', () => {
    for (const { participants, messages } of conversations) {
      assert.equal(participants.length, 2);
      let last = '';
      for (const message of messages) {
        assert.ok(participants.includes(message.author), `auteur étranger à la conversation : ${message.author}`);
        assert.ok(message.at >= last, 'messages dans l’ordre du temps');
        last = message.at;
        if (message.readAt) assert.ok(message.readAt >= message.at, 'lu avant d’être envoyé');
      }
      for (const person of participants) assert.ok(people.has(person) && recette.attendees[person].status === 'active');
    }
  });

  it('A-37 : Léa a deux messages non lus, un de Mathis (« J’apporterai nos échantillons de panneaux. ») et un d’Inès', () => {
    const unread = conversations.flatMap(({ messages }) => messages).filter((message) => !message.readAt && message.author !== 'lea.ducasse@example.org');
    assert.equal(unread.length, 2);
    assert.ok(unread.some((message) => message.author === 'mathis.lagrange@example.org' && message.body === 'J’apporterai nos échantillons de panneaux.'));
    assert.ok(unread.some((message) => message.author === 'ines.castaing@example.org'));
  });

  it('les messages de Mathis et de Léa se répondent : Mathis, Léa, puis Mathis', () => {
    const [{ messages }] = conversations;
    assert.deepEqual(messages.map((message) => message.author), ['mathis.lagrange@example.org', 'lea.ducasse@example.org', 'mathis.lagrange@example.org']);
    assert.deepEqual(messages.map((message) => Boolean(message.readAt)), [true, true, false]);
  });

  it('présentations (bio) de Léa, Mathis, Inès, Antoine et Benoît : 1 à 2 phrases, 280 caractères au plus (F-30, R-30)', () => {
    const who = ['lea.ducasse', 'mathis.lagrange', 'ines.castaing', 'antoine.vergnes', 'benoit.tastet'].map((name) => `${name}@example.org`);
    for (const email of who) {
      const { bio } = recette.attendees[email];
      assert.ok(bio && bio.trim(), `présentation absente : ${email}`);
      assert.ok(bio.length <= 280, `${email} : ${bio.length} caractères`);
      const sentences = bio.split(/(?<=[.!?])\s+/).filter(Boolean);
      assert.ok(sentences.length >= 1 && sentences.length <= 2, `${email} : ${sentences.length} phrases`);
    }
  });

  it('aucune autre fiche n’a de présentation : les profils incomplets du soir le restent', () => {
    const withBio = attendees.filter(([, a]) => a.bio).map(([email]) => email).sort();
    assert.deepEqual(withBio, ['antoine.vergnes@example.org', 'benoit.tastet@example.org', 'ines.castaing@example.org', 'lea.ducasse@example.org', 'mathis.lagrange@example.org']);
  });

  it('les textes ne contiennent ni tiret cadratin ni adresse hors example.org', () => {
    const text = JSON.stringify({ meetings, conversations, attendees: recette.attendees });
    assert.ok(!text.includes(String.fromCharCode(0x2014)));
    const hosts = [...text.matchAll(/@([a-z0-9.-]+)/gi)].map((match) => match[1].toLowerCase());
    assert.ok(hosts.every((host) => host === 'example.org'), [...new Set(hosts)].join(', '));
  });
});
