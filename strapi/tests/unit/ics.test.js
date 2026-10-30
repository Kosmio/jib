'use strict';

/**
 * lib/ics.js (lot 8, tests d'abord ; I-40, I-41, T-23) : `buildCalendar({ name, events, now })` produit un texte RFC 5545 :
 * fins de ligne CRLF, pliage à 75 octets, échappement de `\ ; , \n`, bloc VTIMEZONE Europe/Paris fixe, DTSTART;TZID=Europe/Paris,
 * UID stable. Le premier groupe vérifie le validateur des tests (helpers/ics-validate.js) sur des fichiers écrits à la main,
 * pour qu'un fichier jugé valable le soit vraiment ; il est actif.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { contentLines, eventsOf, firstProp, parseIcs, propsNamed, unescapeText, unfold, validateIcs } = require('../helpers/ics-validate');

const VALID = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Kosmio//JIB//FR',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Paris',
  'BEGIN:STANDARD',
  'DTSTART:19701025T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:19700329T020000',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:meeting-abc@jib',
  'DTSTAMP:20261030T101500Z',
  'DTSTART;TZID=Europe/Paris:20261203T104500',
  'DTEND;TZID=Europe/Paris:20261203T110000',
  'SUMMARY:Rendez-vous avec Léa',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

describe('validateIcs (helper des tests) : accepte un fichier valable, refuse les écarts de forme', () => {
  it('accepte un calendrier valable', () => {
    assert.deepEqual(validateIcs(VALID), []);
  });

  it('refuse un fichier sans CRLF final, avec des LF seuls, une ligne de plus de 75 octets', () => {
    assert.ok(validateIcs(VALID.trimEnd()).length > 0);
    assert.ok(validateIcs(VALID.replace(/\r\n/g, '\n')).length > 0);
    assert.ok(validateIcs(VALID.replace('SUMMARY:Rendez-vous avec Léa', `SUMMARY:${'x'.repeat(100)}`)).some((problem) => /75 octets/.test(problem)));
  });

  it('accepte une ligne pliée (CRLF suivi d’une espace)', () => {
    const folded = VALID.replace('SUMMARY:Rendez-vous avec Léa', 'SUMMARY:Rendez-vous\r\n  avec Léa');
    assert.deepEqual(validateIcs(folded), []);
    assert.equal(firstProp(eventsOf(folded)[0], 'SUMMARY').value, 'Rendez-vous avec Léa');
  });

  it('refuse un VEVENT sans UID, un TZID sans VTIMEZONE, une virgule non échappée, un composant non fermé', () => {
    assert.ok(validateIcs(VALID.replace('UID:meeting-abc@jib\r\n', '')).some((problem) => /UID/.test(problem)));
    assert.ok(validateIcs(VALID.replace(/DTSTART;TZID=Europe\/Paris/, 'DTSTART;TZID=Asia/Tokyo')).some((problem) => /Tokyo/.test(problem)));
    assert.ok(validateIcs(VALID.replace('SUMMARY:Rendez-vous avec Léa', 'SUMMARY:a, b')).some((problem) => /échappé/.test(problem)));
    assert.ok(validateIcs(VALID.replace('END:VEVENT\r\n', '')).length > 0);
  });

  it('refuse une fin qui n’est pas après le début', () => {
    assert.ok(validateIcs(VALID.replace('DTEND;TZID=Europe/Paris:20261203T110000', 'DTEND;TZID=Europe/Paris:20261203T104500')).some((problem) => /DTEND/.test(problem)));
  });

  it('désérialise le texte échappé', () => {
    assert.equal(unescapeText('a\\, b\\; c\\\\ d\\ne'), 'a, b; c\\ d\ne');
  });
});

describe('buildCalendar : forme du fichier (RFC 5545, T-23)', () => {
  const NOW = new Date('2026-10-30T10:15:00.000Z');
  const EVENT = {
    uid: 'meeting-k3j9d0sfn2l8m1q7r6t5y4uw@jib',
    start: new Date('2026-12-03T09:45:00.000Z'),
    end: new Date('2026-12-03T10:00:00.000Z'),
    summary: 'Rendez-vous avec Mathis Lagrange',
    location: 'Table 1',
    description: 'Journée de l’Innovation de la Filière Bois',
    url: 'https://journees.example.org/espace/nouvelle-aquitaine-test/agenda',
  };
  const build = (overrides = {}) => require('../../src/api/espace/lib/ics').buildCalendar({ name: 'JIB Nouvelle-Aquitaine', events: [EVENT], now: NOW, ...overrides });
  const event = (text) => eventsOf(text)[0];
  const value = (text, name) => firstProp(event(text), name)?.value;

  it('est un fichier iCalendar valable', () => {
    assert.deepEqual(validateIcs(build()), []);
  });

  it('est un texte, de bout en bout en CRLF, qui se termine par une fin de ligne', () => {
    const text = build();
    assert.equal(typeof text, 'string');
    assert.ok(text.endsWith('\r\n'));
    assert.ok(!/(?<!\r)\n/.test(text), 'LF sans CR');
  });

  it('commence par BEGIN:VCALENDAR et finit par END:VCALENDAR, VERSION:2.0 et PRODID présents', () => {
    const text = build();
    assert.ok(text.startsWith('BEGIN:VCALENDAR\r\n'));
    assert.ok(text.endsWith('END:VCALENDAR\r\n'));
    assert.ok(propsNamed(parseIcs(text), 'VERSION').some((prop) => prop.value === '2.0'));
    assert.ok(propsNamed(parseIcs(text), 'PRODID').length === 1);
  });

  it('porte le nom du calendrier', () => {
    assert.ok(unfold(build()).includes('JIB Nouvelle-Aquitaine'));
  });

  it('conserve les accents en UTF-8, sans les échapper', () => {
    const text = build({ events: [{ ...EVENT, summary: 'Café avec Hélène Marquès' }] });
    assert.equal(unescapeText(value(text, 'SUMMARY')), 'Café avec Hélène Marquès');
  });

  describe('dates (I-40, fuseau Europe/Paris)', () => {
    it('DTSTART;TZID=Europe/Paris en heure locale : 09h45 UTC en décembre est 10h45', () => {
      const start = firstProp(event(build()), 'DTSTART');
      assert.equal(start.params.TZID, 'Europe/Paris');
      assert.equal(start.value, '20261203T104500');
    });

    it('DTEND;TZID=Europe/Paris en heure locale', () => {
      const end = firstProp(event(build()), 'DTEND');
      assert.equal(end.params.TZID, 'Europe/Paris');
      assert.equal(end.value, '20261203T110000');
    });

    it('heure d’été : 08h00 UTC le 30 juin est 10h00', () => {
      const text = build({ events: [{ ...EVENT, start: new Date('2026-06-30T08:00:00.000Z'), end: new Date('2026-06-30T08:15:00.000Z') }] });
      assert.equal(value(text, 'DTSTART'), '20260630T100000');
      assert.equal(value(text, 'DTEND'), '20260630T101500');
    });

    it('accepte des instants en texte ISO comme en Date', () => {
      const text = build({ events: [{ ...EVENT, start: '2026-12-03T09:45:00.000Z', end: '2026-12-03T10:00:00.000Z' }] });
      assert.equal(value(text, 'DTSTART'), '20261203T104500');
      assert.equal(value(text, 'DTEND'), '20261203T110000');
    });

    it('un rendez-vous à minuit UTC passe au jour suivant à Paris', () => {
      const text = build({ events: [{ ...EVENT, start: new Date('2026-12-03T23:30:00.000Z'), end: new Date('2026-12-04T00:00:00.000Z') }] });
      assert.equal(value(text, 'DTSTART'), '20261204T003000');
    });

    it('DTSTAMP est l’instant `now` en UTC', () => {
      assert.equal(value(build(), 'DTSTAMP'), '20261030T101500Z');
    });

    it('le fichier ne dépend que de ses arguments : mêmes entrées, même texte', () => {
      assert.equal(build(), build());
    });
  });

  describe('VTIMEZONE Europe/Paris fixe', () => {
    const zone = (text) => parseIcs(text).children.find((child) => child.name === 'VTIMEZONE');

    it('un seul bloc, TZID:Europe/Paris', () => {
      const zones = parseIcs(build()).children.filter((child) => child.name === 'VTIMEZONE');
      assert.equal(zones.length, 1);
      assert.equal(firstProp(zones[0], 'TZID').value, 'Europe/Paris');
    });

    it('heure d’hiver : STANDARD, de +0200 à +0100, dernier dimanche d’octobre', () => {
      const standard = zone(build()).children.find((child) => child.name === 'STANDARD');
      assert.equal(firstProp(standard, 'TZOFFSETFROM').value, '+0200');
      assert.equal(firstProp(standard, 'TZOFFSETTO').value, '+0100');
      assert.match(firstProp(standard, 'RRULE').value, /FREQ=YEARLY/);
      assert.match(firstProp(standard, 'RRULE').value, /BYMONTH=10/);
      assert.match(firstProp(standard, 'RRULE').value, /BYDAY=-1SU/);
    });

    it('heure d’été : DAYLIGHT, de +0100 à +0200, dernier dimanche de mars', () => {
      const daylight = zone(build()).children.find((child) => child.name === 'DAYLIGHT');
      assert.equal(firstProp(daylight, 'TZOFFSETFROM').value, '+0100');
      assert.equal(firstProp(daylight, 'TZOFFSETTO').value, '+0200');
      assert.match(firstProp(daylight, 'RRULE').value, /BYMONTH=3/);
      assert.match(firstProp(daylight, 'RRULE').value, /BYDAY=-1SU/);
    });

    it('le bloc ne change pas d’un appel à l’autre ni selon les événements', () => {
      const lines = (text) => contentLines(text).slice(contentLines(text).indexOf('BEGIN:VTIMEZONE'), contentLines(text).indexOf('END:VTIMEZONE') + 1);
      assert.deepEqual(lines(build()), lines(build({ events: [EVENT, { ...EVENT, uid: 'session-x@jib' }], now: new Date('2027-01-01T00:00:00.000Z') })));
    });
  });

  describe('UID stable (I-40)', () => {
    it('reprend l’uid de l’événement tel quel', () => {
      assert.equal(value(build(), 'UID'), 'meeting-k3j9d0sfn2l8m1q7r6t5y4uw@jib');
    });

    it('reste identique d’un export à l’autre, même si l’instant de l’export change', () => {
      const first = build({ now: new Date('2026-10-30T10:15:00.000Z') });
      const second = build({ now: new Date('2026-11-18T08:00:00.000Z') });
      assert.equal(value(first, 'UID'), value(second, 'UID'));
      assert.notEqual(value(first, 'DTSTAMP'), value(second, 'DTSTAMP'));
    });

    it('chaque événement garde le sien, dans l’ordre donné', () => {
      const text = build({ events: [EVENT, { ...EVENT, uid: 'session-abc@jib', summary: 'Table ronde' }, { ...EVENT, uid: 'meeting-zzz@jib', summary: 'Autre' }] });
      assert.deepEqual(eventsOf(text).map((item) => firstProp(item, 'UID').value), ['meeting-k3j9d0sfn2l8m1q7r6t5y4uw@jib', 'session-abc@jib', 'meeting-zzz@jib']);
      assert.deepEqual(validateIcs(text), []);
    });
  });

  describe('champs facultatifs', () => {
    it('lieu, description et lien figurent quand ils sont donnés', () => {
      const item = event(build());
      assert.equal(unescapeText(firstProp(item, 'LOCATION').value), 'Table 1');
      assert.equal(unescapeText(firstProp(item, 'DESCRIPTION').value), 'Journée de l’Innovation de la Filière Bois');
      assert.equal(firstProp(item, 'URL').value, 'https://journees.example.org/espace/nouvelle-aquitaine-test/agenda');
    });

    for (const absent of [undefined, null, '']) {
      it(`n’émet ni LOCATION, ni DESCRIPTION, ni URL quand ils valent ${JSON.stringify(absent) ?? 'undefined'}`, () => {
        const text = build({ events: [{ ...EVENT, location: absent, description: absent, url: absent }] });
        const item = event(text);
        for (const name of ['LOCATION', 'DESCRIPTION', 'URL']) assert.equal(firstProp(item, name), undefined, name);
        assert.deepEqual(validateIcs(text), []);
      });
    }
  });

  describe('échappement du texte (\\ ; , et saut de ligne)', () => {
    const summaryOf = (summary) => unfold(build({ events: [{ ...EVENT, summary }] })).split('\r\n').find((line) => line.startsWith('SUMMARY'));

    it('point-virgule', () => assert.equal(summaryOf('a;b'), 'SUMMARY:a\\;b'));
    it('virgule', () => assert.equal(summaryOf('a,b'), 'SUMMARY:a\\,b'));
    it('barre oblique inverse', () => assert.equal(summaryOf('a\\b'), 'SUMMARY:a\\\\b'));
    it('saut de ligne', () => assert.equal(summaryOf('a\nb'), 'SUMMARY:a\\nb'));
    it('CRLF compte pour un seul saut de ligne', () => assert.equal(summaryOf('a\r\nb'), 'SUMMARY:a\\nb'));
    it('tous ensemble, puis relus à l’identique', () => {
      const original = 'Atelier; budget, planning\\ et suite\nde la journée';
      const text = build({ events: [{ ...EVENT, summary: original }] });
      assert.deepEqual(validateIcs(text), []);
      assert.equal(unescapeText(value(text, 'SUMMARY')), original);
    });

    it('le lieu et la description sont échappés de même', () => {
      const text = build({ events: [{ ...EVENT, location: 'Salle A, bâtiment 2; étage 3', description: 'Ligne 1\nLigne 2' }] });
      assert.deepEqual(validateIcs(text), []);
      assert.equal(unescapeText(value(text, 'LOCATION')), 'Salle A, bâtiment 2; étage 3');
      assert.equal(unescapeText(value(text, 'DESCRIPTION')), 'Ligne 1\nLigne 2');
    });

    it('un texte hostile ne crée aucune propriété ni composant en plus (injection de lignes)', () => {
      const text = build({ events: [{ ...EVENT, summary: 'x\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:pirate@jib', description: 'a\nATTENDEE:mailto:x@example.org' }] });
      assert.equal(eventsOf(text).length, 1);
      assert.equal(propsNamed(event(text), 'ATTENDEE').length, 0);
      assert.deepEqual(validateIcs(text), []);
    });
  });

  describe('pliage à 75 octets', () => {
    const longSummary = `Rencontre ${'très longue, '.repeat(30)}fin`;

    it('aucune ligne physique ne dépasse 75 octets (CRLF exclu)', () => {
      const text = build({ events: [{ ...EVENT, summary: longSummary, description: longSummary, location: longSummary }] });
      for (const line of text.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `${Buffer.byteLength(line, 'utf8')} octets : ${line.slice(0, 40)}`);
    });

    it('chaque suite de ligne commence par une espace, et le dépliage rend la valeur entière', () => {
      const text = build({ events: [{ ...EVENT, summary: longSummary }] });
      assert.match(text, /\r\n [^\r\n]/);
      assert.equal(unescapeText(value(text, 'SUMMARY')), longSummary);
    });

    it('les caractères sur plusieurs octets ne sont pas coupés en deux : 100 « é » (200 octets)', () => {
      const summary = 'é'.repeat(100);
      const text = build({ events: [{ ...EVENT, summary }] });
      for (const line of text.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `${Buffer.byteLength(line, 'utf8')} octets`);
      assert.equal(value(text, 'SUMMARY'), summary);
      assert.ok(!text.includes('�'));
    });

    it('un texte de 74 octets ne se plie pas : « SUMMARY: » plus 66 caractères', () => {
      const text = build({ events: [{ ...EVENT, summary: 'a'.repeat(66) }] });
      assert.ok(text.includes(`SUMMARY:${'a'.repeat(66)}\r\n`), 'ligne de 74 octets pliée sans raison');
    });

    it('une ligne de 75 octets tient telle quelle : « SUMMARY: » plus 67 caractères', () => {
      const text = build({ events: [{ ...EVENT, summary: 'a'.repeat(67) }] });
      assert.ok(text.includes(`SUMMARY:${'a'.repeat(67)}\r\n`), 'ligne de 75 octets pliée alors qu’elle tient');
    });

    it('un texte de 76 octets se plie', () => {
      const text = build({ events: [{ ...EVENT, summary: 'a'.repeat(68) }] });
      assert.ok(!text.includes(`SUMMARY:${'a'.repeat(68)}\r\n`));
      assert.equal(value(text, 'SUMMARY'), 'a'.repeat(68));
    });
  });

  it('sans événement : un calendrier valable et vide', () => {
    const text = build({ events: [] });
    assert.deepEqual(validateIcs(text), []);
    assert.equal(eventsOf(text).length, 0);
  });

  it('ne modifie pas les événements reçus', () => {
    const events = [structuredClone(EVENT)];
    const copy = structuredClone(events);
    build({ events });
    assert.deepEqual(events, copy);
  });

  it('un fichier de 200 événements reste valable (export d’un participant très occupé)', () => {
    const events = Array.from({ length: 200 }, (_, index) => ({ ...EVENT, uid: `meeting-${index}@jib`, summary: `Rendez-vous ${index}, avec un nom assez long pour provoquer un pliage de ligne ici` }));
    assert.deepEqual(validateIcs(build({ events })), []);
  });
});
