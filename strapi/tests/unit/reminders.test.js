'use strict';

/**
 * Relances, fonctions pures de `lib/reminders.js` (lot V3-A : R-70, R-71, R-72, R-87, R-17, I-39, T-33, T-34).
 * L'horloge est toujours un paramètre. Édition du 3 décembre 2026 (Paris, UTC+1 en hiver) : J-6 = 27 novembre, 9h30 = 08:30 UTC ;
 * la veille 16h00 = 2 décembre 15:00 UTC ; la veille ne part plus après 9h00 le jour J = 3 décembre 08:00 UTC.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const R = require('../../src/api/espace/lib/reminders');

const EDITION = { date: '2026-12-03', participantSpaceEnabled: true, welcomeStartedAt: '2026-11-20T10:00:00.000Z' };
const SECRET = 'secret-de-test';
const iso = (date) => date.toISOString();

/** Participant actif, activé, profil à 40 %, sans rendez-vous. */
const attendee = (fields = {}) => ({
  documentId: 'att1',
  status: 'active',
  role: 'participant',
  activatedAt: '2026-11-18T10:00:00.000Z',
  createdAt: '2026-11-10T10:00:00.000Z',
  emailPrefs: {},
  completion: 40,
  engaged: 0,
  accepted: 0,
  ...fields,
});

describe('inSendingHours : rien avant 8h00 ni à partir de 20h00, heure de Paris (R-72, T-34)', () => {
  const at = (value) => R.inSendingHours(new Date(value));

  it('hiver : 7h59 refusé, 8h00 admis, 19h59 admis, 20h00 refusé', () => {
    assert.equal(at('2026-11-27T06:59:00Z'), false);
    assert.equal(at('2026-11-27T07:00:00Z'), true);
    assert.equal(at('2026-11-27T18:59:00Z'), true);
    assert.equal(at('2026-11-27T19:00:00Z'), false);
  });

  it('été (UTC+2) : mêmes bornes en heure de Paris', () => {
    assert.equal(at('2026-07-01T05:59:00Z'), false);
    assert.equal(at('2026-07-01T06:00:00Z'), true);
    assert.equal(at('2026-07-01T17:59:00Z'), true);
    assert.equal(at('2026-07-01T18:00:00Z'), false);
  });

  it('21h00 et minuit sont refusés', () => {
    assert.equal(at('2026-11-27T20:00:00Z'), false);
    assert.equal(at('2026-11-27T23:00:00Z'), false);
  });
});

describe('plannedSends : calendrier calculé depuis la date de l’édition (R-87)', () => {
  const planned = (scenario, fields, edition = EDITION) => R.plannedSends(scenario, edition, attendee(fields)).map(({ date, at }) => [date, iso(at)]);

  it('b : à J-6 à 9h30 seulement', () => {
    assert.deepEqual(planned('no-meeting'), [['2026-11-27', '2026-11-27T08:30:00.000Z']]);
  });

  it('a : à J-6 9h30 et à J+2 de l’activation à 9h30', () => {
    assert.deepEqual(planned('profile', { activatedAt: '2026-11-20T15:00:00.000Z' }), [
      ['2026-11-27', '2026-11-27T08:30:00.000Z'],
      ['2026-11-22', '2026-11-22T08:30:00.000Z'],
    ]);
  });

  it('a : une activation trop tardive (J+2 au jour J ou après) ne planifie que J-6', () => {
    assert.deepEqual(planned('profile', { activatedAt: '2026-12-01T10:00:00.000Z' }), [['2026-11-27', '2026-11-27T08:30:00.000Z']]);
    assert.deepEqual(planned('profile', { activatedAt: '2026-12-02T10:00:00.000Z' }), [['2026-11-27', '2026-11-27T08:30:00.000Z']]);
  });

  it('welcome : à J+3 de l’import à 9h30 et à J-6', () => {
    assert.deepEqual(planned('welcome', { activatedAt: null, createdAt: '2026-11-18T10:00:00.000Z' }), [
      ['2026-11-27', '2026-11-27T08:30:00.000Z'],
      ['2026-11-21', '2026-11-21T08:30:00.000Z'],
    ]);
  });

  it('c : la veille à 16h00 (15:00 UTC)', () => {
    assert.deepEqual(planned('eve'), [['2026-12-02', '2026-12-02T15:00:00.000Z']]);
  });

  it('suit la date de l’édition : jamais de date en dur', () => {
    assert.deepEqual(planned('no-meeting', {}, { date: '2026-12-10' }), [['2026-12-04', '2026-12-04T08:30:00.000Z']]);
    assert.deepEqual(planned('eve', {}, { date: '2026-12-10' }), [['2026-12-09', '2026-12-09T15:00:00.000Z']]);
  });

  it('été : 9h30 et 16h00 de Paris valent 07:30 et 14:00 UTC', () => {
    assert.deepEqual(planned('no-meeting', {}, { date: '2026-07-10' }), [['2026-07-04', '2026-07-04T07:30:00.000Z']]);
    assert.deepEqual(planned('eve', {}, { date: '2026-07-10' }), [['2026-07-09', '2026-07-09T14:00:00.000Z']]);
  });

  it('le changement d’heure d’automne (25 octobre 2026) est suivi : J-6 le 24 octobre = UTC+2, le 31 = UTC+1', () => {
    assert.deepEqual(planned('no-meeting', {}, { date: '2026-10-30' }), [['2026-10-24', '2026-10-24T07:30:00.000Z']]);
    assert.deepEqual(planned('no-meeting', {}, { date: '2026-11-06' }), [['2026-10-31', '2026-10-31T08:30:00.000Z']]);
  });

  it('une édition sans date ne planifie rien pour b et c', () => {
    assert.deepEqual(planned('no-meeting', {}, {}), []);
    assert.deepEqual(planned('eve', {}, {}), []);
  });

  it('une date d’édition à l’heure (ISO complet) est lue par son jour', () => {
    assert.deepEqual(planned('no-meeting', {}, { date: '2026-12-03T00:00:00.000Z' }), [['2026-11-27', '2026-11-27T08:30:00.000Z']]);
  });
});

describe('dueKey : la clé de l’envoi dû à l’instant donné (R-71, R-87, T-34)', () => {
  const key = (scenario, now, fields) => R.dueKey(scenario, EDITION, attendee(fields), new Date(now));

  it('b : rien avant 9h30 le 27, `no-meeting:2026-11-27` à 9h30 pile', () => {
    assert.equal(key('no-meeting', '2026-11-27T08:29:59Z'), null);
    assert.equal(key('no-meeting', '2026-11-27T08:30:00Z'), 'no-meeting:2026-11-27');
  });

  it('fenêtre de validité de 24 h : encore dû à 8h00 le lendemain (rattrapage de la nuit), plus à 9h30', () => {
    assert.equal(key('no-meeting', '2026-11-28T07:00:00Z'), 'no-meeting:2026-11-27');
    assert.equal(key('no-meeting', '2026-11-28T08:29:59Z'), 'no-meeting:2026-11-27');
    assert.equal(key('no-meeting', '2026-11-28T08:30:00Z'), null);
  });

  it('a : la clé de l’activation (J+2) puis celle de J-6', () => {
    const fields = { activatedAt: '2026-11-20T15:00:00.000Z' };
    assert.equal(key('profile', '2026-11-22T09:00:00Z', fields), 'profile:2026-11-22');
    assert.equal(key('profile', '2026-11-24T09:00:00Z', fields), null);
    assert.equal(key('profile', '2026-11-27T09:00:00Z', fields), 'profile:2026-11-27');
  });

  it('welcome : la clé J+3 de l’import puis celle de J-6', () => {
    const fields = { activatedAt: null, createdAt: '2026-11-18T10:00:00.000Z' };
    assert.equal(key('welcome', '2026-11-21T09:00:00Z', fields), 'welcome:2026-11-21');
    assert.equal(key('welcome', '2026-11-27T09:00:00Z', fields), 'welcome:2026-11-27');
  });

  it('c : dû la veille à 16h00, rattrapable jusqu’à 9h00 le jour J, jamais après', () => {
    assert.equal(key('eve', '2026-12-02T14:59:59Z'), null);
    assert.equal(key('eve', '2026-12-02T15:00:00Z'), 'eve:2026-12-02');
    assert.equal(key('eve', '2026-12-03T07:59:00Z'), 'eve:2026-12-02');
    assert.equal(key('eve', '2026-12-03T08:00:00Z'), null);
    assert.equal(key('eve', '2026-12-03T10:00:00Z'), null);
  });

  it('rien le jour J pour a, b et welcome, ni après', () => {
    for (const scenario of ['profile', 'no-meeting']) assert.equal(key(scenario, '2026-12-03T10:00:00Z'), null, scenario);
    assert.equal(key('welcome', '2026-12-03T10:00:00Z', { activatedAt: null }), null);
  });

  it('accepte un nombre ou une chaîne comme instant', () => {
    assert.equal(R.dueKey('no-meeting', EDITION, attendee(), Date.parse('2026-11-27T09:00:00Z')), 'no-meeting:2026-11-27');
  });
});

describe('manualKey : l’envoi manuel prend la date du jour à Paris (R-71)', () => {
  it('date du jour de Paris, pas celle d’UTC', () => {
    assert.equal(R.manualKey('profile', new Date('2026-11-27T10:00:00Z')), 'profile:2026-11-27');
    assert.equal(R.manualKey('profile', new Date('2026-11-27T23:30:00Z')), 'profile:2026-11-28');
  });

  it('T-33 : à J-6 la clé manuelle est la clé planifiée, donc un envoi manuel après la tâche (ou l’inverse) ne double pas', () => {
    const now = new Date('2026-11-27T09:00:00Z');
    assert.equal(R.manualKey('no-meeting', now), R.dueKey('no-meeting', EDITION, attendee(), now));
    assert.equal(R.manualKey('eve', new Date('2026-12-02T15:30:00Z')), R.dueKey('eve', EDITION, attendee(), new Date('2026-12-02T15:30:00Z')));
  });
});

describe('audience : qui est concerné et comment (R-70, R-72, lot V3-A)', () => {
  const verdict = (scenario, fields) => R.audience(scenario, attendee(fields));

  it('a : activé et sous 70 % ; 70 % exactement n’est pas concerné', () => {
    assert.equal(verdict('profile', { completion: 69 }), 'send');
    assert.equal(verdict('profile', { completion: 70 }), null);
    assert.equal(verdict('profile', { completion: 100 }), null);
  });

  it('b : activé et sans rendez-vous en attente ni accepté', () => {
    assert.equal(verdict('no-meeting', { engaged: 0 }), 'send');
    assert.equal(verdict('no-meeting', { engaged: 1 }), null);
  });

  it('welcome : seulement les actifs jamais activés', () => {
    assert.equal(verdict('welcome', { activatedAt: null }), 'send');
    assert.equal(verdict('welcome', { activatedAt: '2026-11-18T10:00:00Z' }), null);
  });

  it('a et b visent les actifs activés : un non activé n’est pas concerné', () => {
    assert.equal(verdict('profile', { activatedAt: null }), null);
    assert.equal(verdict('no-meeting', { activatedAt: null }), null);
  });

  it('annulé, en attente ou organisateur : jamais, quel que soit le scénario', () => {
    for (const scenario of R.SCENARIOS) {
      assert.equal(verdict(scenario, { status: 'cancelled', accepted: 1 }), null, `cancelled ${scenario}`);
      assert.equal(verdict(scenario, { role: 'organizer', accepted: 1 }), null, `organizer ${scenario}`);
    }
  });

  it('reminders = false : a, b et welcome sont « optedOut » (le rappel welcome aussi)', () => {
    const emailPrefs = { reminders: false };
    assert.equal(verdict('profile', { emailPrefs }), 'optedOut');
    assert.equal(verdict('no-meeting', { emailPrefs }), 'optedOut');
    assert.equal(verdict('welcome', { activatedAt: null, emailPrefs }), 'optedOut');
  });

  it('reminders absent ou vrai : envoi', () => {
    assert.equal(verdict('profile', { emailPrefs: { reminders: true } }), 'send');
    assert.equal(verdict('profile', { emailPrefs: null }), 'send');
  });

  it('un non concerné qui refuse les rappels reste non concerné (pas compté en exclu)', () => {
    assert.equal(verdict('profile', { completion: 90, emailPrefs: { reminders: false } }), null);
  });

  it('c : e-mail de service, envoyé même sans rendez-vous si les rappels sont acceptés', () => {
    assert.equal(verdict('eve', { accepted: 0 }), 'send');
    assert.equal(verdict('eve', { accepted: 2 }), 'send');
  });

  it('c : reminders = false mais un rendez-vous accepté : envoi', () => {
    assert.equal(verdict('eve', { accepted: 1, emailPrefs: { reminders: false } }), 'send');
  });

  it('c : reminders = false et aucun rendez-vous accepté : exclu', () => {
    assert.equal(verdict('eve', { accepted: 0, emailPrefs: { reminders: false } }), 'optedOut');
  });

  it('c : un non activé avec un rendez-vous accepté est concerné', () => {
    assert.equal(verdict('eve', { activatedAt: null, accepted: 1 }), 'send');
  });
});

describe('planReminders : destinataires et exclus (R-71, R-72, R-85, NF-52)', () => {
  const NOW = new Date('2026-11-27T09:00:00Z');
  const plan = (options) => R.planReminders({ edition: EDITION, now: NOW, ...options });
  const ids = (result) => result.recipients.map(({ attendee: { documentId } }) => documentId);

  it('critère 3 : à J-6 9h30, a part aux actifs activés sous 70 %, hors refus de rappels', () => {
    const attendees = [
      attendee({ documentId: 'low', completion: 40 }),
      attendee({ documentId: 'high', completion: 80 }),
      attendee({ documentId: 'refuse', completion: 40, emailPrefs: { reminders: false } }),
      attendee({ documentId: 'fresh', completion: 40, activatedAt: null }),
      attendee({ documentId: 'off', completion: 40, status: 'cancelled' }),
    ];
    const result = plan({ scenario: 'profile', attendees });
    assert.deepEqual(ids(result), ['low']);
    assert.deepEqual(result.skipped, { alreadySent: 0, optedOut: 1 });
    assert.equal(result.recipients[0].scenarioKey, 'profile:2026-11-27');
  });

  it('critère 3 : à J-6 9h30, b part aux actifs sans rendez-vous, hors refus de rappels', () => {
    const attendees = [
      attendee({ documentId: 'alone' }),
      attendee({ documentId: 'busy', engaged: 2 }),
      attendee({ documentId: 'refuse', emailPrefs: { reminders: false } }),
    ];
    const result = plan({ scenario: 'no-meeting', attendees });
    assert.deepEqual(ids(result), ['alone']);
    assert.deepEqual(result.skipped, { alreadySent: 0, optedOut: 1 });
  });

  it('avant l’heure prévue : personne', () => {
    const result = plan({ scenario: 'no-meeting', attendees: [attendee()], now: new Date('2026-11-27T08:00:00Z') });
    assert.deepEqual(result, { recipients: [], skipped: { alreadySent: 0, optedOut: 0 } });
  });

  it('R-71 : une clé déjà journalisée est comptée « alreadySent » et n’est pas renvoyée', () => {
    const result = plan({ scenario: 'no-meeting', attendees: [attendee({ documentId: 'a1' }), attendee({ documentId: 'a2' })], sentKeys: new Set(['a1|no-meeting:2026-11-27']) });
    assert.deepEqual(ids(result), ['a2']);
    assert.equal(result.skipped.alreadySent, 1);
  });

  it('une clé d’un autre jour ou d’un autre scénario ne compte pas comme envoyée', () => {
    const sentKeys = new Set(['a1|no-meeting:2026-11-20', 'a1|profile:2026-11-27']);
    assert.deepEqual(ids(plan({ scenario: 'no-meeting', attendees: [attendee({ documentId: 'a1' })], sentKeys })), ['a1']);
  });

  it('déjà envoyé l’emporte sur « optedOut » (un refus a pu venir après l’envoi)', () => {
    const result = plan({ scenario: 'no-meeting', attendees: [attendee({ documentId: 'a1', emailPrefs: { reminders: false } })], sentKeys: new Set(['a1|no-meeting:2026-11-27']) });
    assert.deepEqual(result.skipped, { alreadySent: 1, optedOut: 0 });
  });

  it('au plus 3 échecs par clé et destinataire : 2 échecs retentés, 3 abandonnés', () => {
    const attendees = [attendee({ documentId: 'a1' }), attendee({ documentId: 'a2' })];
    const failures = new Map([['a1|no-meeting:2026-11-27', 2], ['a2|no-meeting:2026-11-27', 3]]);
    assert.equal(R.MAX_FAILURES, 3);
    assert.deepEqual(ids(plan({ scenario: 'no-meeting', attendees, failures })), ['a1']);
  });

  it('les échecs d’une autre clé ne bloquent pas', () => {
    const failures = new Map([['a1|no-meeting:2026-11-20', 3]]);
    assert.deepEqual(ids(plan({ scenario: 'no-meeting', attendees: [attendee({ documentId: 'a1' })], failures })), ['a1']);
  });

  it('NF-52 : espace fermé, rien ne part, quel que soit le scénario et même en manuel', () => {
    const closed = { ...EDITION, participantSpaceEnabled: false };
    for (const scenario of R.SCENARIOS) {
      for (const manual of [false, true]) {
        const result = R.planReminders({ scenario, edition: closed, attendees: [attendee({ activatedAt: null, accepted: 1 })], now: NOW, manual });
        assert.deepEqual(result.recipients, [], `${scenario} manual=${manual}`);
      }
    }
  });

  it('R-85 : welcome sans welcomeStartedAt, rien (même en manuel)', () => {
    const edition = { ...EDITION, welcomeStartedAt: null };
    const attendees = [attendee({ activatedAt: null })];
    assert.deepEqual(R.planReminders({ scenario: 'welcome', edition, attendees, now: NOW }).recipients, []);
    assert.deepEqual(R.planReminders({ scenario: 'welcome', edition, attendees, now: NOW, manual: true }).recipients, []);
  });

  it('welcome après welcomeStartedAt : les non activés reçoivent le rappel `welcome:<date>`', () => {
    const result = plan({ scenario: 'welcome', attendees: [attendee({ documentId: 'new', activatedAt: null }), attendee({ documentId: 'done' })] });
    assert.deepEqual(ids(result), ['new']);
    assert.equal(result.recipients[0].scenarioKey, 'welcome:2026-11-27');
  });

  it('manuel : la clé est la date du jour, tous les concernés comptent même sans échéance', () => {
    const now = new Date('2026-11-23T12:00:00Z');
    const result = plan({ scenario: 'profile', attendees: [attendee({ documentId: 'a1' })], now, manual: true });
    assert.deepEqual(ids(result), ['a1']);
    assert.equal(result.recipients[0].scenarioKey, 'profile:2026-11-23');
  });

  it('manuel : deux fois le même jour, le second est « alreadySent » (T-33)', () => {
    const now = new Date('2026-11-23T12:00:00Z');
    const attendees = [attendee({ documentId: 'a1' })];
    const sentKeys = new Set(['a1|profile:2026-11-23']);
    const second = plan({ scenario: 'profile', attendees, now, manual: true, sentKeys });
    assert.deepEqual(second.recipients, []);
    assert.equal(second.skipped.alreadySent, 1);
  });

  it('manuel : un refus de rappels est compté « optedOut »', () => {
    const result = plan({ scenario: 'profile', attendees: [attendee({ emailPrefs: { reminders: false } })], manual: true });
    assert.deepEqual(result, { recipients: [], skipped: { alreadySent: 0, optedOut: 1 } });
  });

  it('critère 4 : la veille à 16h00, c part à chaque actif concerné et seulement à lui', () => {
    const attendees = [
      attendee({ documentId: 'with', accepted: 1, emailPrefs: { reminders: false } }),
      attendee({ documentId: 'without' }),
      attendee({ documentId: 'refuse' , emailPrefs: { reminders: false } }),
      attendee({ documentId: 'org', role: 'organizer', accepted: 3 }),
    ];
    const result = plan({ scenario: 'eve', attendees, now: new Date('2026-12-02T15:00:00Z') });
    assert.deepEqual(ids(result), ['with', 'without']);
    assert.deepEqual(result.skipped, { alreadySent: 0, optedOut: 1 });
    assert.equal(result.recipients[0].scenarioKey, 'eve:2026-12-02');
  });

  it('c n’est plus planifié après 9h00 le jour J', () => {
    assert.deepEqual(plan({ scenario: 'eve', attendees: [attendee()], now: new Date('2026-12-03T08:00:00Z') }).recipients, []);
  });

  it('ne modifie pas ses entrées', () => {
    const attendees = [attendee()];
    const sentKeys = new Set();
    const copy = structuredClone({ attendees, EDITION });
    plan({ scenario: 'no-meeting', attendees, sentKeys });
    assert.deepEqual({ attendees, EDITION }, copy);
    assert.equal(sentKeys.size, 0);
  });
});

describe('agendaOf : l’agenda de la veille d’un participant (R-70 c, R-17)', () => {
  const meeting = (fields) => ({
    id: 'm',
    status: 'accepted',
    startsAt: '2026-12-03T09:45:00.000Z',
    endsAt: '2026-12-03T10:00:00.000Z',
    location: 'Table 3',
    requesterId: 'me',
    requesterName: 'Moi Même',
    targetAttendeeId: 'other',
    targetName: 'Autre Personne',
    targetRepIds: [],
    ...fields,
  });

  it('demandeur : l’interlocuteur est la cible', () => {
    const { accepted } = R.agendaOf('me', [meeting({ id: 'm1' })]);
    assert.deepEqual(accepted, [{ id: 'm1', startsAt: '2026-12-03T09:45:00.000Z', endsAt: '2026-12-03T10:00:00.000Z', location: 'Table 3', counterpartName: 'Autre Personne' }]);
  });

  it('cible : l’interlocuteur est le demandeur', () => {
    assert.equal(R.agendaOf('other', [meeting()]).accepted[0].counterpartName, 'Moi Même');
  });

  it('représentant d’un stand ciblé : voit le rendez-vous, l’interlocuteur est le demandeur', () => {
    const exhibitor = meeting({ targetAttendeeId: undefined, targetName: 'Lignum Data', targetRepIds: ['rep1', 'rep2'] });
    assert.equal(R.agendaOf('rep2', [exhibitor]).accepted[0].counterpartName, 'Moi Même');
    assert.equal(R.agendaOf('me', [exhibitor]).accepted[0].counterpartName, 'Lignum Data');
  });

  it('classe les acceptés et les expirés séparément ; ni en attente, ni refusé, ni annulé', () => {
    const result = R.agendaOf('me', [
      meeting({ id: 'ok' }),
      meeting({ id: 'late', status: 'expired' }),
      meeting({ id: 'wait', status: 'pending' }),
      meeting({ id: 'no', status: 'declined' }),
      meeting({ id: 'bye', status: 'cancelled' }),
    ]);
    assert.deepEqual(result.accepted.map(({ id }) => id), ['ok']);
    assert.deepEqual(result.expired.map(({ id }) => id), ['late']);
  });

  it('trie par heure de début', () => {
    const result = R.agendaOf('me', [meeting({ id: 'pm', startsAt: '2026-12-03T14:00:00.000Z' }), meeting({ id: 'am', startsAt: '2026-12-03T08:00:00.000Z' })]);
    assert.deepEqual(result.accepted.map(({ id }) => id), ['am', 'pm']);
  });

  it('ignore les rendez-vous des autres ; lieu absent donne null', () => {
    const result = R.agendaOf('me', [meeting({ id: 'x', requesterId: 'u1', targetAttendeeId: 'u2' }), meeting({ id: 'y', location: undefined })]);
    assert.deepEqual(result.accepted.map(({ id, location }) => ({ id, location })), [{ id: 'y', location: null }]);
  });

  it('aucun rendez-vous : deux listes vides', () => {
    assert.deepEqual(R.agendaOf('me', []), { accepted: [], expired: [] });
  });
});

describe('signUnsubscribe, verifyUnsubscribe : lien signé propre à son destinataire (I-39, critère 5)', () => {
  it('aller-retour : le jeton rend l’identifiant', () => {
    assert.equal(R.verifyUnsubscribe(SECRET, R.signUnsubscribe(SECRET, 'abc123')), 'abc123');
  });

  it('le jeton commence par l’identifiant et ne contient aucun caractère à échapper dans une adresse', () => {
    const token = R.signUnsubscribe(SECRET, 'abc123');
    assert.match(token, /^abc123\.[A-Za-z0-9_-]+$/);
  });

  it('déterministe, sans expiration', () => {
    assert.equal(R.signUnsubscribe(SECRET, 'abc'), R.signUnsubscribe(SECRET, 'abc'));
  });

  it('deux destinataires, deux jetons', () => {
    assert.notEqual(R.signUnsubscribe(SECRET, 'abc'), R.signUnsubscribe(SECRET, 'abd'));
  });

  it('la signature d’un destinataire accolée à l’identifiant d’un autre est refusée', () => {
    const signatureOfA = R.signUnsubscribe(SECRET, 'idA').split('.')[1];
    assert.equal(R.verifyUnsubscribe(SECRET, `idB.${signatureOfA}`), null);
  });

  it('un autre secret refuse le jeton', () => {
    assert.equal(R.verifyUnsubscribe('autre-secret', R.signUnsubscribe(SECRET, 'abc')), null);
  });

  it('jeton altéré, tronqué, rallongé, vide ou sans point : refusé', () => {
    const token = R.signUnsubscribe(SECRET, 'abc');
    for (const bad of [`${token}x`, token.slice(0, -1), `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`, '', 'abc', 'abc.', '.abc', '.', `${token}.${token}`]) {
      assert.equal(R.verifyUnsubscribe(SECRET, bad), null, JSON.stringify(bad));
    }
  });

  it('valeur qui n’est pas une chaîne : refusée sans lever', () => {
    for (const bad of [undefined, null, 42, {}, ['abc.def']]) assert.equal(R.verifyUnsubscribe(SECRET, bad), null);
  });

  it('le jeton d’une autre finalité (même identifiant, autre construction) n’est pas accepté', () => {
    const other = `abc.${require('node:crypto').createHmac('sha256', SECRET).update('abc').digest('base64url')}`;
    assert.equal(R.verifyUnsubscribe(SECRET, other), null);
  });
});

describe('unsubscribeHeaders : RFC 8058 (I-39)', () => {
  it('List-Unsubscribe entre chevrons et List-Unsubscribe-Post à « List-Unsubscribe=One-Click »', () => {
    assert.deepEqual(R.unsubscribeHeaders('https://exemple.org/api/espace/reminders/unsubscribe?token=abc.def'), {
      'List-Unsubscribe': '<https://exemple.org/api/espace/reminders/unsubscribe?token=abc.def>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });
});

describe('aides de date', () => {
  it('parisDate : jour de Paris', () => {
    assert.equal(R.parisDate(new Date('2026-11-27T23:30:00Z')), '2026-11-28');
    assert.equal(R.parisDate(new Date('2026-11-27T22:59:00Z')), '2026-11-27');
  });

  it('addDays traverse les fins de mois', () => {
    assert.equal(R.addDays('2026-11-27', 5), '2026-12-02');
    assert.equal(R.addDays('2026-12-03', -6), '2026-11-27');
  });

  it('daysUntil : jours calendaires de Paris', () => {
    assert.equal(R.daysUntil('2026-12-03', new Date('2026-11-27T09:00:00Z')), 6);
    assert.equal(R.daysUntil('2026-12-03', new Date('2026-12-03T09:00:00Z')), 0);
    assert.equal(R.daysUntil('2026-12-03', new Date('2026-12-04T09:00:00Z')), -1);
  });

  it('dayLabel : « jeudi 3 décembre »', () => {
    assert.equal(R.dayLabel('2026-12-03'), 'jeudi 3 décembre');
  });

  it('missingParts : ce qui manque au profil, en toutes lettres', () => {
    assert.deepEqual(R.missingParts({ jobTitle: 'Dir', photo: null, bio: '  ', topics: [] }), ['votre photo', 'votre présentation', 'vos sujets d’intérêt']);
    assert.deepEqual(R.missingParts({ jobTitle: 'Dir', photo: { id: 1 }, bio: 'x', topics: [{}] }), []);
  });
});
