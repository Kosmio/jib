'use strict';

/**
 * lib/erase.js, lot V5-A (docs/espace/specs/14-lots-finalisation.md) : F-33, R-44, NF-12, NF-13. Fonctions pures, sans Strapi.
 * Empreinte de l'e-mail, adresse technique, champs de l'effacement, échéance de purge (date + 12 mois strictement dépassés),
 * seuil des journaux, forme de l'export individuel (aucune donnée d'un tiers hors prénom, nom, entreprise).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const erase = () => require('../../src/api/espace/lib/erase');

describe('emailHash (R-44)', () => {
  it('est un sha256 hexadécimal de 64 caractères', () => {
    assert.match(erase().emailHash('lea@example.org', 'cle-1'), /^[0-9a-f]{64}$/);
  });

  it('ignore la casse et les espaces autour de l’adresse', () => {
    assert.equal(erase().emailHash('  Lea.Ducasse@Example.ORG ', 'cle-1'), erase().emailHash('lea.ducasse@example.org', 'cle-1'));
  });

  it('est salé : une autre clé donne une autre empreinte, et l’adresse seule (sha256 nu) ne la retrouve pas', () => {
    const { createHash } = require('node:crypto');
    assert.notEqual(erase().emailHash('lea@example.org', 'cle-1'), erase().emailHash('lea@example.org', 'cle-2'));
    assert.notEqual(erase().emailHash('lea@example.org', 'cle-1'), createHash('sha256').update('lea@example.org').digest('hex'));
  });

  it('distingue deux adresses', () => {
    assert.notEqual(erase().emailHash('lea@example.org', 'cle-1'), erase().emailHash('paul@example.org', 'cle-1'));
  });

  it('ne contient pas l’adresse', () => {
    assert.ok(!erase().emailHash('lea@example.org', 'cle-1').includes('lea'));
  });

  for (const invalid of ['', 'pas-une-adresse', null, undefined, 42]) {
    it(`rend null pour ${JSON.stringify(invalid)}`, () => {
      assert.equal(erase().emailHash(invalid, 'cle-1'), null);
    });
  }
});

describe('adresse technique (F-33)', () => {
  it('est erased-<documentId>@erased.invalid, en minuscules', () => {
    assert.equal(erase().technicalEmail('AbC123'), 'erased-abc123@erased.invalid');
  });

  it('est unique par documentId', () => {
    assert.notEqual(erase().technicalEmail('a1'), erase().technicalEmail('b2'));
  });

  it('est reconnue par isErasedEmail, sans tenir compte de la casse', () => {
    assert.equal(erase().isErasedEmail(erase().technicalEmail('abc')), true);
    assert.equal(erase().isErasedEmail('ERASED-ABC@ERASED.INVALID'), true);
  });

  it('une adresse ordinaire, vide ou non textuelle n’est pas effacée', () => {
    for (const value of ['lea@example.org', 'erased@example.org', '', null, undefined, 3]) assert.equal(erase().isErasedEmail(value), false, String(value));
  });
});

describe('erasedFields (F-33, R-44)', () => {
  const now = new Date('2026-12-10T10:00:00.000Z');
  const fields = () => erase().erasedFields({ documentId: 'doc1' }, now);

  it('prénom « Participant » et nom « supprimé »', () => {
    assert.equal(fields().firstName, 'Participant');
    assert.equal(fields().lastName, 'supprimé');
  });

  it('remplace l’e-mail par l’adresse technique', () => {
    assert.equal(fields().email, erase().technicalEmail('doc1'));
  });

  it('vide entreprise, fonction, présentation, LinkedIn et table accueillie', () => {
    for (const key of ['company', 'jobTitle', 'bio', 'linkedinUrl', 'hostedTableNumber']) assert.equal(fields()[key], null, key);
  });

  it('met annuaire, rendez-vous et actualités à faux', () => {
    for (const key of ['directoryOptIn', 'meetingsOptIn', 'newsOptIn']) assert.equal(fields()[key], false, key);
  });

  it('coupe toutes les préférences d’e-mail', () => {
    assert.deepEqual(fields().emailPrefs, { meetingRequests: false, messages: false, reminders: false });
  });

  it('passe en cancelled et verrouille le statut à l’instant donné (aucune synchronisation ne le réactive)', () => {
    assert.equal(fields().status, 'cancelled');
    assert.equal(fields().statusLockedAt, now);
  });

  it('oublie les identifiants de billet, le jeton de carte, le consentement et les dates d’usage', () => {
    for (const key of ['helloassoItemId', 'helloassoOrderId', 'cardTokenHash', 'cardTokenCreatedAt', 'consentAt', 'activatedAt', 'lastSeenAt']) {
      assert.equal(fields()[key], null, key);
    }
  });

  it('vide les indisponibilités et les champs édités', () => {
    assert.deepEqual(fields().unavailableSessions, []);
    assert.deepEqual(fields().editedFields, []);
  });

  it('ne contient aucune donnée d’origine (aucune valeur issue de l’Attendee fourni)', () => {
    const result = erase().erasedFields({ documentId: 'doc1', firstName: 'Léa', email: 'lea@example.org', company: 'Scierie' }, now);
    assert.ok(!JSON.stringify(result).includes('Léa') && !JSON.stringify(result).includes('lea@example.org') && !JSON.stringify(result).includes('Scierie'));
  });

  it('les relations vidées sont photo, speaker, exhibitor (null) et topics ([])', () => {
    assert.deepEqual(erase().ERASED_RELATIONS, { photo: null, speaker: null, exhibitor: null, topics: [] });
  });
});

describe('isPurgeable (R-44) : date de l’édition + 12 mois strictement dépassés', () => {
  const edition = { date: '2026-12-03' };
  const purgeable = (now, candidate = edition) => erase().isPurgeable(candidate, new Date(now));

  it('l’édition du jour, ou passée depuis quelques mois, n’est pas purgée', () => {
    assert.equal(purgeable('2026-12-03T10:00:00Z'), false);
    assert.equal(purgeable('2027-06-01T00:00:00Z'), false);
  });

  it('à date + 12 mois pile (minuit UTC) rien n’est purgé', () => {
    assert.equal(purgeable('2027-12-03T00:00:00.000Z'), false);
  });

  it('une milliseconde après, c’est purgeable', () => {
    assert.equal(purgeable('2027-12-03T00:00:00.001Z'), true);
  });

  it('à date + 12 mois et un jour, c’est purgeable', () => {
    assert.equal(purgeable('2027-12-04T04:00:00Z'), true);
  });

  it('une édition sans date, ou à la date invalide, n’est jamais purgée', () => {
    for (const candidate of [{}, { date: null }, { date: 'pas une date' }, undefined, null]) assert.equal(erase().isPurgeable(candidate, new Date('2040-01-01T00:00:00Z')), false, String(candidate?.date));
  });

  it('une édition à venir n’est pas purgée', () => {
    assert.equal(purgeable('2026-11-18T00:00:00Z', { date: '2027-05-01' }), false);
  });
});

describe('logCutoff (NF-13) : 12 mois avant maintenant', () => {
  it('rend le même instant un an plus tôt', () => {
    assert.equal(erase().logCutoff(new Date('2027-12-03T04:00:00.000Z')).toISOString(), '2026-12-03T04:00:00.000Z');
  });

  it('passe l’année bissextile', () => {
    assert.equal(erase().logCutoff(new Date('2028-03-01T00:00:00.000Z')).toISOString(), '2027-03-01T00:00:00.000Z');
  });
});

describe('buildExport (NF-12) : l’export individuel', () => {
  const now = new Date('2026-12-10T10:00:00.000Z');
  const SELF = {
    documentId: 'self',
    firstName: 'Léa',
    lastName: 'Ducasse',
    email: 'lea.ducasse@example.org',
    jobTitle: 'Responsable',
    company: 'Charpentes du Pibal',
    linkedinUrl: 'https://www.linkedin.com/in/lea',
    bio: 'Présentation.',
    role: 'participant',
    photo: { url: '/uploads/lea.png', hash: 'secret-hash' },
    topics: [{ name: 'Construction bois', id: 7 }],
    unavailableSessions: [3],
    directoryOptIn: true,
    meetingsOptIn: true,
    newsOptIn: false,
    consentAt: '2026-11-01T00:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    activatedAt: '2026-11-02T00:00:00.000Z',
    lastSeenAt: '2026-11-03T00:00:00.000Z',
    emailPrefs: { reminders: false },
    cardTokenHash: 'CARD-HASH-SECRET',
  };
  const PAUL = {
    documentId: 'paul',
    firstName: 'Paul',
    lastName: 'Durand',
    company: 'Dubreuil Bois',
    email: 'paul.durand@example.org',
    jobTitle: 'Directeur',
    bio: 'BIO-DE-PAUL',
    linkedinUrl: 'https://www.linkedin.com/in/paul',
    phone: '0600000000',
    photo: { url: '/uploads/paul.png' },
  };
  const slot = { startsAt: '2026-12-03T10:00:00.000Z', endsAt: '2026-12-03T10:15:00.000Z', label: '11h00', id: 99 };
  const meetings = [
    { documentId: 'm1', status: 'accepted', requester: SELF, targetAttendee: PAUL, slot, tableNumber: 2, location: 'Table 2', message: 'Bonjour Paul', cancelledAt: null },
    { documentId: 'm2', status: 'pending', requester: PAUL, targetAttendee: SELF, slot, message: 'MESSAGE-DE-DEMANDE-DE-PAUL' },
    {
      documentId: 'm3',
      status: 'pending',
      requester: SELF,
      targetExhibitor: { standNumber: '4', organisation: { name: 'Exposant Fictif' } },
      slot,
    },
  ];
  const messages = [{ documentId: 'msg1', body: 'Bonjour', createdAt: '2026-12-01T09:00:00.000Z', conversation: { documentId: 'c1', participants: [SELF, PAUL] } }];
  const built = () => erase().buildExport({ attendee: SELF, edition: { slug: 'ed', title: 'Édition', id: 5 }, meetings, messages, now });

  it('a la forme attendue : exportedAt, edition, profile, preferences, meetings, messages', () => {
    assert.deepEqual(Object.keys(built()), ['exportedAt', 'edition', 'profile', 'preferences', 'meetings', 'messages']);
    assert.equal(built().exportedAt, now.toISOString());
    assert.deepEqual(built().edition, { slug: 'ed', title: 'Édition' });
  });

  it('le profil porte les données de la personne, sujets en noms et photo en URL', () => {
    const { profile } = built();
    assert.equal(profile.email, 'lea.ducasse@example.org');
    assert.equal(profile.company, 'Charpentes du Pibal');
    assert.equal(profile.photoUrl, '/uploads/lea.png');
    assert.deepEqual(profile.topics, ['Construction bois']);
  });

  it('les préférences : consentements et e-mails (vrai par défaut sauf refus explicite)', () => {
    const { preferences } = built();
    assert.equal(preferences.directoryOptIn, true);
    assert.equal(preferences.newsOptIn, false);
    assert.deepEqual(preferences.emailPrefs, { meetingRequests: true, messages: true, reminders: false });
  });

  it('ne fait pas sortir le jeton de carte ni le hash du fichier', () => {
    const text = JSON.stringify(built());
    assert.ok(!text.includes('CARD-HASH-SECRET'));
    assert.ok(!text.includes('secret-hash'));
  });

  it('un rendez-vous envoyé : interlocuteur réduit à prénom, nom, entreprise ; créneau, table et message', () => {
    const sent = built().meetings.find(({ id }) => id === 'm1');
    assert.equal(sent.direction, 'sent');
    assert.deepEqual(sent.counterpart, { firstName: 'Paul', lastName: 'Durand', company: 'Dubreuil Bois' });
    assert.deepEqual(sent.slot, { startsAt: slot.startsAt, endsAt: slot.endsAt, label: '11h00' });
    assert.equal(sent.tableNumber, 2);
    assert.equal(sent.message, 'Bonjour Paul');
  });

  it('un rendez-vous reçu : le message de demande de l’autre n’est pas rendu', () => {
    const received = built().meetings.find(({ id }) => id === 'm2');
    assert.equal(received.direction, 'received');
    assert.equal(received.message, null);
    assert.deepEqual(received.counterpart, { firstName: 'Paul', lastName: 'Durand', company: 'Dubreuil Bois' });
  });

  it('un rendez-vous avec un exposant : le nom de l’organisation', () => {
    assert.deepEqual(built().meetings.find(({ id }) => id === 'm3').counterpart, { exhibitor: 'Exposant Fictif' });
  });

  it('un message : texte, conversation et interlocuteur réduit à prénom, nom, entreprise', () => {
    const [message] = built().messages;
    assert.equal(message.body, 'Bonjour');
    assert.equal(message.conversationId, 'c1');
    assert.equal(message.sentAt, '2026-12-01T09:00:00.000Z');
    assert.deepEqual(message.counterpart, { firstName: 'Paul', lastName: 'Durand', company: 'Dubreuil Bois' });
  });

  it('critère 4 : rien d’autre d’un tiers (e-mail, fonction, présentation, LinkedIn, téléphone, photo, identifiant)', () => {
    const text = JSON.stringify({ meetings: built().meetings, messages: built().messages });
    for (const forbidden of ['paul.durand@example.org', 'Directeur', 'BIO-DE-PAUL', 'linkedin.com/in/paul', '0600000000', 'paul.png', '"paul"', 'MESSAGE-DE-DEMANDE-DE-PAUL']) {
      assert.ok(!text.includes(forbidden), `${forbidden} ne doit pas sortir`);
    }
  });

  it('sans rendez-vous ni message : listes vides', () => {
    const empty = erase().buildExport({ attendee: SELF, edition: { slug: 'ed', title: 'E' }, meetings: [], messages: [], now });
    assert.deepEqual(empty.meetings, []);
    assert.deepEqual(empty.messages, []);
  });

  it('un message sans interlocuteur trouvé : counterpart null', () => {
    const lonely = erase().buildExport({ attendee: SELF, edition: { slug: 'ed', title: 'E' }, meetings: [], messages: [{ ...messages[0], conversation: { documentId: 'c9', participants: [SELF] } }], now });
    assert.equal(lonely.messages[0].counterpart, null);
  });
});
