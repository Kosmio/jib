'use strict';

/**
 * lib/cards.js (lot 9, tests d'abord ; R-42, R-43, A-29, A-34, A-36) : `initials`, `attendeeCard`, `exhibitorCard`,
 * `ATTENDEE_CARD_POPULATE`, `EXHIBITOR_CARD_POPULATE`. Une CarteProfil est
 * `{ kind, id, displayName, subtitle, photoUrl, initials, tag, topics: [{ id, name }], standNumber?, hostedTableNumber? }`.
 * Entrées : les lignes que le Document Service rend avec les `populate` du module (photo, sujets, exposant et son organisation,
 * intervenant et son organisation). Aucun e-mail, aucun identifiant HelloAsso ne sort d'une carte (R-42, NF-11).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');


const cards = () => require('../../src/api/espace/lib/cards');
const CARD_KEYS = ['kind', 'id', 'displayName', 'subtitle', 'photoUrl', 'initials', 'tag', 'topics', 'standNumber', 'hostedTableNumber'];

const TOPICS = [
  { id: 4, documentId: 'topic-eco', name: 'Économie circulaire' },
  { id: 5, documentId: 'topic-bois', name: 'Construction bois' },
];
const lea = (fields = {}) => ({
  id: 12,
  documentId: 'doc-lea',
  email: 'lea.ducasse@example.org',
  helloassoItemId: '9001',
  helloassoOrderId: '8001',
  firstName: 'Léa',
  lastName: 'Ducasse',
  jobTitle: 'Cheffe de projet',
  company: 'Atelier Fictif',
  role: 'participant',
  bio: 'Je cherche des partenaires pour la construction bois.',
  hostedTableNumber: null,
  photo: { id: 3, url: '/uploads/lea_abc123.webp' },
  topics: TOPICS,
  exhibitor: null,
  speaker: null,
  ...fields,
});

describe('initials', () => {
  const initials = (name) => cards().initials(name);

  it('prénom et nom : « Léa Ducasse » donne « LD »', () => {
    assert.equal(initials('Léa Ducasse'), 'LD');
  });

  it('met en majuscules', () => {
    assert.equal(initials('léa ducasse'), 'LD');
  });

  it('ignore les espaces en trop', () => {
    assert.equal(initials('  Léa    Ducasse  '), 'LD');
  });

  it('un prénom composé compte pour un mot : « Jean-Pierre Martin » donne « JM »', () => {
    assert.equal(initials('Jean-Pierre Martin'), 'JM');
  });

  it('au plus deux lettres, la première étant celle du premier mot', () => {
    const result = initials('Marie de la Tour');
    assert.ok(result.length >= 1 && result.length <= 2, result);
    assert.equal(result[0], 'M');
  });

  it('un seul mot donne au plus deux lettres, commençant par la première', () => {
    const result = initials('Sylvadour');
    assert.ok(result.length >= 1 && result.length <= 2, result);
    assert.equal(result[0], 'S');
  });

  it('une initiale accentuée reste une lettre majuscule', () => {
    assert.match(initials('Éva Cazaux'), /^[ÉE]C$/);
  });

  it('un nom vide donne un texte vide', () => {
    assert.equal(initials(''), '');
    assert.equal(initials('   '), '');
  });
});

describe('attendeeCard : carte d’un participant', () => {
  const card = (attendee = lea(), options) => cards().attendeeCard(attendee, options);

  it('porte les champs de la CarteProfil et rien d’autre', () => {
    const result = card();
    for (const key of Object.keys(result)) assert.ok(CARD_KEYS.includes(key), `champ inattendu : ${key}`);
    for (const key of ['kind', 'id', 'displayName', 'subtitle', 'photoUrl', 'initials', 'tag', 'topics']) assert.ok(key in result, `champ manquant : ${key}`);
  });

  it('kind « attendee », id = documentId, nom complet et initiales', () => {
    const result = card();
    assert.equal(result.kind, 'attendee');
    assert.equal(result.id, 'doc-lea');
    assert.equal(result.displayName, 'Léa Ducasse');
    assert.equal(result.initials, 'LD');
  });

  it('sous-titre : fonction et entreprise', () => {
    const { subtitle } = card();
    assert.ok(subtitle.includes('Cheffe de projet'), subtitle);
    assert.ok(subtitle.includes('Atelier Fictif'), subtitle);
  });

  it('sous-titre : l’entreprise seule quand la fonction manque', () => {
    for (const jobTitle of [null, '', undefined]) {
      const { subtitle } = card(lea({ jobTitle }));
      assert.ok(subtitle.includes('Atelier Fictif'));
      assert.doesNotMatch(subtitle, /null|undefined|^,|,\s*$/);
    }
  });

  it('sous-titre : texte vide quand la fonction et l’entreprise manquent', () => {
    assert.equal(card(lea({ jobTitle: null, company: null })).subtitle, '');
  });

  it('photoUrl : le chemin renvoyé par Upload, tel quel (A-35)', () => {
    assert.equal(card().photoUrl, '/uploads/lea_abc123.webp');
  });

  it('photoUrl : null sans photo', () => {
    assert.equal(card(lea({ photo: null })).photoUrl, null);
    assert.equal(card(lea({ photo: undefined })).photoUrl, null);
  });

  it('sujets : [{ id: documentId, name }] dans l’ordre reçu', () => {
    assert.deepEqual(card().topics, [
      { id: 'topic-eco', name: 'Économie circulaire' },
      { id: 'topic-bois', name: 'Construction bois' },
    ]);
  });

  it('sujets : liste vide sans sujet', () => {
    assert.deepEqual(card(lea({ topics: [] })).topics, []);
    assert.deepEqual(card(lea({ topics: undefined })).topics, []);
  });

  describe('étiquette (tag) d’après le rôle', () => {
    it('participant', () => assert.equal(card(lea({ role: 'participant' })).tag, 'participant'));
    it('intervenant', () => assert.equal(card(lea({ role: 'speaker' })).tag, 'speaker'));
    it('représentant d’exposant', () => assert.equal(card(lea({ role: 'exhibitor_rep' })).tag, 'exhibitor_rep'));
  });

  describe('numéro de stand et de table dédiée', () => {
    it('un représentant porte le numéro de stand de son exposant', () => {
      const rep = lea({ role: 'exhibitor_rep', exhibitor: { documentId: 'x1', standNumber: '4', organisation: { name: 'Sylvadour' } } });
      assert.equal(card(rep).standNumber, '4');
    });

    it('un participant sans exposant n’en porte pas', () => {
      assert.equal(card().standNumber ?? null, null);
    });

    it('un intervenant à table dédiée porte son numéro de table', () => {
      assert.equal(card(lea({ role: 'speaker', hostedTableNumber: 2 })).hostedTableNumber, 2);
    });

    it('un participant n’en porte pas', () => {
      assert.equal(card().hostedTableNumber ?? null, null);
    });
  });

  describe('R-42 : aucune donnée sensible dans la carte', () => {
    it('ni e-mail, ni identifiant HelloAsso, ni présentation, ni identifiant numérique', () => {
      const text = JSON.stringify(card());
      assert.doesNotMatch(text, /@example\.org|email|helloasso|9001|8001/i);
      assert.ok(!text.includes('Je cherche des partenaires'), 'la présentation (bio) n’est pas dans la carte');
      assert.ok(!('bio' in card()));
    });
  });

  it('ne modifie pas l’Attendee reçu', () => {
    const attendee = lea();
    const copy = structuredClone(attendee);
    card(attendee);
    assert.deepEqual(attendee, copy);
  });

  describe('publicOnly : intervenant à table dédiée sans directoryOptIn, données publiques du programme seulement (A-29, R-43)', () => {
    const speaker = (fields = {}) =>
      lea({
        role: 'speaker',
        hostedTableNumber: 2,
        jobTitle: 'POSTE-PERSONNEL',
        company: 'ENTREPRISE-PERSONNELLE',
        bio: 'BIO-PERSONNELLE',
        photo: { url: '/uploads/perso.webp' },
        topics: [{ documentId: 'topic-secret', name: 'SUJET-PERSONNEL' }],
        speaker: {
          documentId: 'iv-antoine',
          name: 'Antoine Vergnes',
          title: 'Directeur de la recherche',
          photo: { url: '/uploads/antoine_public.webp' },
          organisation: { name: 'Institut du Bois Fictif' },
        },
        ...fields,
      });
    const publicCard = (attendee = speaker()) => card(attendee, { publicOnly: true });

    it('le nom, la fonction et la structure viennent de l’intervenant', () => {
      const result = publicCard();
      assert.equal(result.displayName, 'Antoine Vergnes');
      assert.ok(result.subtitle.includes('Directeur de la recherche'), result.subtitle);
      assert.ok(result.subtitle.includes('Institut du Bois Fictif'), result.subtitle);
    });

    it('la photo est celle de l’intervenant', () => {
      assert.equal(publicCard().photoUrl, '/uploads/antoine_public.webp');
    });

    it('sans photo d’intervenant, la carte n’emprunte pas la photo personnelle', () => {
      const result = publicCard(speaker({ speaker: { ...speaker().speaker, photo: null } }));
      assert.equal(result.photoUrl, null);
    });

    it('aucune donnée du profil personnel ne sort : ni fonction, ni entreprise, ni présentation, ni photo, ni sujets', () => {
      const result = publicCard();
      assert.doesNotMatch(JSON.stringify(result), /PERSONNEL|perso\.webp/);
      assert.deepEqual(result.topics, []);
    });

    it('l’étiquette est « speaker » et le numéro de table est conservé', () => {
      const result = publicCard();
      assert.equal(result.tag, 'speaker');
      assert.equal(result.hostedTableNumber, 2);
      assert.equal(result.kind, 'attendee');
      assert.equal(result.id, 'doc-lea');
    });

    it('les initiales suivent le nom public', () => {
      assert.equal(publicCard().initials, 'AV');
    });

    it('sans publicOnly (défaut), la carte montre le profil personnel', () => {
      const result = card(speaker());
      assert.equal(result.displayName, 'Léa Ducasse');
      assert.ok(result.subtitle.includes('POSTE-PERSONNEL'));
      assert.equal(result.photoUrl, '/uploads/perso.webp');
      assert.deepEqual(result.topics, [{ id: 'topic-secret', name: 'SUJET-PERSONNEL' }]);
    });
  });
});

describe('exhibitorCard : carte d’un exposant', () => {
  const exhibitor = (fields = {}) => ({
    id: 7,
    documentId: 'doc-sylvadour',
    standNumber: '4',
    organisation: { name: 'Sylvadour', description: 'Scierie fictive du Sud-Ouest.', logo: { url: '/uploads/sylvadour_logo.png' }, website: 'https://sylvadour.example.org' },
    topics: TOPICS,
    ...fields,
  });
  const card = (fields) => cards().exhibitorCard(exhibitor(fields));

  it('kind « exhibitor », id = documentId, nom de l’organisation, étiquette « exhibitor »', () => {
    const result = card();
    assert.equal(result.kind, 'exhibitor');
    assert.equal(result.id, 'doc-sylvadour');
    assert.equal(result.displayName, 'Sylvadour');
    assert.equal(result.tag, 'exhibitor');
  });

  it('porte le numéro de stand', () => {
    assert.equal(card().standNumber, '4');
  });

  it('photoUrl : le logo de l’organisation', () => {
    assert.equal(card().photoUrl, '/uploads/sylvadour_logo.png');
  });

  it('photoUrl : null sans logo', () => {
    assert.equal(card({ organisation: { name: 'Sylvadour', logo: null } }).photoUrl, null);
  });

  it('sujets : [{ id: documentId, name }]', () => {
    assert.deepEqual(card().topics, [
      { id: 'topic-eco', name: 'Économie circulaire' },
      { id: 'topic-bois', name: 'Construction bois' },
    ]);
  });

  it('sous-titre texte, initiales sur deux lettres au plus', () => {
    const result = card();
    assert.equal(typeof result.subtitle, 'string');
    assert.ok(result.initials.length >= 1 && result.initials.length <= 2);
    assert.equal(result.initials[0], 'S');
  });

  it('porte les champs de la CarteProfil et rien d’autre', () => {
    for (const key of Object.keys(card())) assert.ok(CARD_KEYS.includes(key), `champ inattendu : ${key}`);
  });

  it('une carte d’exposant ne porte pas de numéro de table dédiée', () => {
    assert.equal(card().hostedTableNumber ?? null, null);
  });

  it('ne modifie pas l’exposant reçu', () => {
    const value = exhibitor();
    const copy = structuredClone(value);
    cards().exhibitorCard(value);
    assert.deepEqual(value, copy);
  });
});

describe('ATTENDEE_CARD_POPULATE et EXHIBITOR_CARD_POPULATE : objets `populate` du Document Service (A-36)', () => {
  it('sont des objets simples', () => {
    for (const populate of [cards().ATTENDEE_CARD_POPULATE, cards().EXHIBITOR_CARD_POPULATE]) {
      assert.equal(typeof populate, 'object');
      assert.ok(populate !== null && !Array.isArray(populate));
    }
  });

  it('participant : photo, sujets, exposant et intervenant, avec leur organisation', () => {
    const populate = cards().ATTENDEE_CARD_POPULATE;
    for (const key of ['photo', 'topics', 'exhibitor', 'speaker']) assert.ok(populate[key], `relation « ${key} » non chargée`);
    assert.match(JSON.stringify(populate), /organisation/);
  });

  it('exposant : organisation (nom, logo) et sujets', () => {
    const populate = cards().EXHIBITOR_CARD_POPULATE;
    for (const key of ['organisation', 'topics']) assert.ok(populate[key], `relation « ${key} » non chargée`);
  });

  it('ne demandent aucune relation vers des conversations, des messages ou des rendez-vous', () => {
    assert.doesNotMatch(JSON.stringify([cards().ATTENDEE_CARD_POPULATE, cards().EXHIBITOR_CARD_POPULATE]), /message|conversation|meeting/i);
  });
});
