'use strict';

/** Écran « Personnes » (15-administration.md, AD-2) : D-20, F-169, T-83. */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { nameKey, primaryRole, readOrganisation, rolesOf, similarOrganisations, uniqueSlug } = require('../../src/api/espace/lib/people');

describe('organisations proches (F-169, T-83)', () => {
  const existing = [
    { documentId: 'a', name: 'Wood & Co' },
    { documentId: 'b', name: 'Fibois Nouvelle-Aquitaine' },
    { documentId: 'c', name: 'Xylofutur' },
  ];
  it('ramène « wood&co », « Wood and Co » et « WOOD ET CO » à la même clé', () => {
    assert.equal(nameKey('wood&co'), nameKey('Wood & Co'));
    assert.equal(nameKey('Wood and Co'), 'woodco');
    assert.equal(nameKey('WOOD ET CO'), 'woodco');
  });
  it('propose les noms identiques, contenus ou à une lettre près', () => {
    assert.deepEqual(similarOrganisations('wood&co', existing).map(({ documentId }) => documentId), ['a']);
    assert.deepEqual(similarOrganisations('Fibois', existing).map(({ documentId }) => documentId), ['b']);
    assert.deepEqual(similarOrganisations('Xylofutr', existing).map(({ documentId }) => documentId), ['c']);
    assert.deepEqual(similarOrganisations('Kosmio', existing), []);
  });
});

describe('rôles cumulés (D-20)', () => {
  it('donne le type principal dans l’ordre organisateur, intervenant, exposant, participant', () => {
    assert.equal(primaryRole({ organizer: true, speaker: true }), 'organizer');
    assert.equal(primaryRole({ organizer: true, listedOrganizer: true, speaker: true }), 'speaker');
    assert.equal(primaryRole({ speaker: true, exhibitor: true }), 'speaker');
    assert.equal(primaryRole({ exhibitor: true }), 'exhibitor_rep');
    assert.equal(primaryRole({}), 'participant');
  });
  it('lit chaque rôle sur les liens de la personne', () => {
    assert.deepEqual(rolesOf({ status: 'active', role: 'speaker', exhibitor: { documentId: 'x' } }), {
      participant: true,
      speaker: true,
      exhibitor: true,
      organizer: false,
      listedOrganizer: false,
    });
  });
});

describe('fiche d’organisation', () => {
  it('valide le nom et les adresses', () => {
    assert.deepEqual(Object.keys(readOrganisation({ name: ' ', website: 'ftp://x' }).errors).sort(), ['name', 'website']);
    assert.deepEqual(readOrganisation({ name: 'Bois', linkedinUrl: 'https://www.linkedin.com/company/bois' }).data, { name: 'Bois', linkedin_url: 'https://www.linkedin.com/company/bois' });
  });
  it('fabrique un identifiant d’adresse unique', () => {
    assert.equal(uniqueSlug('Wood & Co', new Set()), 'wood-et-co');
    assert.equal(uniqueSlug('Wood & Co', new Set(['wood-et-co'])), 'wood-et-co-2');
  });
});

describe('organizerProfile : nom d’un organisateur créé depuis ORGANIZER_EMAILS', () => {
  const { organizerProfile } = require('../../src/api/espace/lib/people');
  const name = (email) => {
    const { firstName, lastName } = organizerProfile(email);
    return `${firstName} ${lastName}`;
  };

  it('prend le prénom et le nom d’une adresse prenom.nom@', () => {
    assert.deepEqual(organizerProfile('apolline.oswald@xylofutur.fr'), { firstName: 'Apolline', lastName: 'Oswald', company: 'Xylofutur' });
    assert.equal(name('Charlotte.Perrier@xylofutur.fr'), 'Charlotte Perrier');
    assert.equal(name('jean-marc.du-pont@example.org'), 'Jean-Marc Du-Pont');
    assert.equal(name('lea_martin@example.org'), 'Lea Martin');
    assert.equal(name('anne.de.villiers@example.org'), 'Anne De Villiers');
  });

  it('garde « Organisateur JIB » quand l’adresse ne donne pas de nom', () => {
    for (const email of ['apollineoswald@xylofutur.fr', 'contact@xylofutur.fr', 'mathieu@kosm.io', 'jean.2@example.org', '', null]) {
      assert.equal(name(email), 'Organisateur JIB', String(email));
    }
  });
});
