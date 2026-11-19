'use strict';

/** Écran « Édition » de l'interface organisation (15-administration.md, AD-1) : F-155, F-157, F-177, F-179, R-92. */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { changesForm, guessFieldMap, openingChecklist, parseHelloAssoUrl, validateSettings } = require('../../src/api/espace/lib/admin-settings');

describe('adresse HelloAsso collée (F-155)', () => {
  it('lit la page publique d’un événement', () => {
    assert.deepEqual(parseHelloAssoUrl('https://www.helloasso.com/associations/xylofutur/evenements/jib-nouvelle-aquitaine-2026'), {
      orgSlug: 'xylofutur',
      formType: 'Event',
      formSlug: 'jib-nouvelle-aquitaine-2026',
    });
  });

  it('lit l’adresse du back-office et ignore la suite du chemin et la requête', () => {
    assert.deepEqual(parseHelloAssoUrl('https://admin.helloasso.com/xylofutur/evenements/jib-na/statistiques?tab=1'), {
      orgSlug: 'xylofutur',
      formType: 'Event',
      formSlug: 'jib-na',
    });
  });

  it('reconnaît les autres types de formulaires', () => {
    assert.equal(parseHelloAssoUrl('https://www.helloasso.com/associations/asso/adhesions/adhesion-2026')?.formType, 'Membership');
    assert.equal(parseHelloAssoUrl('https://www.helloasso.com/associations/asso/boutiques/boutique')?.formType, 'Shop');
  });

  it('refuse une adresse qui n’est pas celle d’un formulaire HelloAsso', () => {
    assert.equal(parseHelloAssoUrl('https://example.org/associations/x/evenements/y'), null);
    assert.equal(parseHelloAssoUrl('https://www.helloasso.com/associations/xylofutur'), null);
    assert.equal(parseHelloAssoUrl('pas une adresse'), null);
    assert.equal(parseHelloAssoUrl(undefined), null);
  });
});

describe('correspondance des champs (F-157)', () => {
  it('reconnaît « Organisation », « Poste » et « Email » du vrai formulaire', () => {
    const fields = ['Accès PMR', 'Organisation', "Type d'organisation", 'Poste', 'N° de téléphone', 'Email', 'Code Postal'];
    assert.deepEqual(guessFieldMap(fields), { company: 'Organisation', jobTitle: 'Poste', email: 'Email' });
  });

  it('reconnaît les variantes sans casse ni accents, et ne propose rien pour un champ absent', () => {
    assert.deepEqual(guessFieldMap(['SOCIÉTÉ', 'Fonction occupée', 'Profil LinkedIn']), { company: 'SOCIÉTÉ', jobTitle: 'Fonction occupée', linkedin: 'Profil LinkedIn' });
    assert.deepEqual(guessFieldMap([]), {});
  });
});

describe('validation des réglages (F-168, F-179)', () => {
  it('n’écrit que les champs envoyés, avec les noms de l’édition', () => {
    const { data, errors } = validateSettings({ title: '  JIB 2027 ', inscriptionUrl: 'https://www.helloasso.com/x', tablesCount: '12' });
    assert.deepEqual(errors, {});
    assert.deepEqual(data, { title: 'JIB 2027', inscription_url: 'https://www.helloasso.com/x', tablesCount: 12 });
  });

  it('signale chaque champ à corriger', () => {
    const { errors } = validateSettings({
      title: ' ',
      date: '2026-13-45',
      inscriptionUrl: 'javascript:alert(1)',
      helloassoOrgSlug: 'avec espace',
      helloassoFormType: 'Inconnu',
      tablesCount: 0,
      slotDurationMinutes: 3,
      participantSpaceEnabled: 'oui',
    });
    assert.deepEqual(Object.keys(errors).sort(), ['date', 'helloassoFormType', 'helloassoOrgSlug', 'inscriptionUrl', 'participantSpaceEnabled', 'slotDurationMinutes', 'tablesCount', 'title']);
  });

  it('exige une fermeture des demandes après l’ouverture, et accepte une fermeture vide', () => {
    assert.ok(validateSettings({ meetingRequestsOpenAt: '2026-12-02T10:00:00Z', meetingRequestsCloseAt: '2026-12-01T10:00:00Z' }).errors.meetingRequestsCloseAt);
    assert.deepEqual(validateSettings({ meetingRequestsCloseAt: '' }).data, { meetingRequestsCloseAt: null });
  });

  it('ne garde de la correspondance que les clés lues par l’import', () => {
    assert.deepEqual(validateSettings({ helloassoFieldMap: { company: 'Organisation', autre: 'x', email: '' } }).data, { helloassoFieldMap: { company: 'Organisation' } });
  });
});

describe('changement de formulaire (R-92)', () => {
  it('voit un changement d’association, de formulaire ou de type, pas une valeur identique', () => {
    const current = { helloassoOrgSlug: 'xylofutur', helloassoFormSlug: 'jib', helloassoFormType: null };
    assert.equal(changesForm(current, { helloassoOrgSlug: 'xylofutur', helloassoFormType: 'Event' }), false);
    assert.equal(changesForm(current, { helloassoFormSlug: 'jib-2' }), true);
    assert.equal(changesForm(current, { helloassoFormType: 'Membership' }), true);
  });
});

describe('liste de contrôle d’ouverture (F-177)', () => {
  it('signale les points manquants sans rien bloquer', () => {
    const list = openingChecklist({ helloassoReady: true, synced: false, programPublished: true, breaks: 2, slots: 0 });
    assert.deepEqual(list.map(({ key, done }) => [key, done]), [['helloasso', true], ['sync', false], ['program', true], ['slots', false]]);
  });

  it('tient les créneaux pour faits quand le programme n’a pas de pause B2B', () => {
    assert.equal(openingChecklist({ breaks: 0, slots: 0 }).at(-1).done, true);
  });
});
