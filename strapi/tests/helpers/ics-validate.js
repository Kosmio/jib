'use strict';

/**
 * Lecteur et validateur minimal de RFC 5545 pour les tests de l'export .ics (I-40, T-23). Aucune dépendance : il couvre ce que
 * l'espace produit (VCALENDAR, VTIMEZONE, VEVENT, propriétés texte, dates locales avec TZID, dates UTC) et signale tout écart
 * de forme : fins de ligne, longueur de 75 octets, pliage, imbrication, propriétés obligatoires, échappements du texte.
 */

const TEXT_PROPERTIES = new Set(['SUMMARY', 'DESCRIPTION', 'LOCATION', 'X-WR-CALNAME', 'COMMENT', 'CATEGORIES']);
const LOCAL_DATE_TIME = /^\d{8}T\d{6}$/;
const UTC_DATE_TIME = /^\d{8}T\d{6}Z$/;
const CONTENT_LINE = /^([A-Za-z0-9-]+)((?:;[A-Za-z0-9-]+=(?:"[^"]*"|[^";:,]*)(?:,(?:"[^"]*"|[^";:,]*))*)*):(.*)$/s;

/** Texte déplié : une ligne qui commence par une espace ou une tabulation prolonge la précédente. */
const unfold = (text) => text.replace(/\r\n[ \t]/g, '');

/** Lignes de contenu dépliées, sans la fin de ligne finale. */
const contentLines = (text) => unfold(text).split('\r\n').filter((line, index, all) => !(index === all.length - 1 && line === ''));

/** `NAME;P=V;P2=V2:value` -> { name, params: { P: 'V' }, value } ; null si la ligne n'a pas la forme d'une ligne de contenu. */
function parseLine(line) {
  const match = CONTENT_LINE.exec(line);
  if (!match) return null;
  const [, name, rawParams, value] = match;
  const params = {};
  for (const part of rawParams.split(';').filter(Boolean)) {
    const [key, ...rest] = part.split('=');
    params[key.toUpperCase()] = rest.join('=').replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

/** Arbre des composants : { name, props: [{ name, params, value }], children: [composants] }. */
function parseIcs(text) {
  const root = { name: 'ROOT', props: [], children: [] };
  const stack = [root];
  for (const line of contentLines(text)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    if (parsed.name === 'BEGIN') {
      const component = { name: parsed.value.toUpperCase(), props: [], children: [] };
      stack.at(-1).children.push(component);
      stack.push(component);
    } else if (parsed.name === 'END') {
      stack.pop();
    } else {
      stack.at(-1).props.push(parsed);
    }
  }
  return root.children[0];
}

const propsNamed = (component, name) => component.props.filter((prop) => prop.name === name);
const firstProp = (component, name) => propsNamed(component, name)[0];
const eventsOf = (text) => parseIcs(text).children.filter((child) => child.name === 'VEVENT');

/** Désérialise un texte iCalendar (`\n`, `\,`, `\;`, `\\`). */
const unescapeText = (value) => value.replace(/\\([\\;,nN])/g, (_, char) => (char === 'n' || char === 'N' ? '\n' : char));

/** Liste des écarts de forme au RFC 5545 ; un tableau vide vaut « fichier valable ». */
function validateIcs(text) {
  const problems = [];
  if (typeof text !== 'string' || !text) return ['fichier vide'];

  if (!text.endsWith('\r\n')) problems.push('le fichier ne se termine pas par CRLF');
  if (/(?<!\r)\n/.test(text)) problems.push('LF sans CR');
  if (/\r(?!\n)/.test(text)) problems.push('CR sans LF');

  const physical = text.split('\r\n');
  physical.forEach((line, index) => {
    if (Buffer.byteLength(line, 'utf8') > 75) problems.push(`ligne ${index + 1} de plus de 75 octets (${Buffer.byteLength(line, 'utf8')})`);
    if (/^[ \t]/.test(line) && index === 0) problems.push('première ligne repliée');
  });

  const lines = contentLines(text);
  if (lines[0] !== 'BEGIN:VCALENDAR') problems.push('le fichier ne commence pas par BEGIN:VCALENDAR');
  if (lines.at(-1) !== 'END:VCALENDAR') problems.push('le fichier ne se termine pas par END:VCALENDAR');

  const stack = [];
  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) {
      problems.push(`ligne de contenu mal formée : ${line.slice(0, 60)}`);
      continue;
    }
    if (parsed.name === 'BEGIN') stack.push(parsed.value);
    else if (parsed.name === 'END') {
      if (stack.pop() !== parsed.value) problems.push(`END:${parsed.value} sans BEGIN correspondant`);
    }
    if (TEXT_PROPERTIES.has(parsed.name)) {
      const rest = parsed.value.replace(/\\[\\;,nN]/g, ''); // les échappements valables retirés, il ne reste rien à signaler
      if (/[;,]/.test(rest)) problems.push(`${parsed.name} : « ; » ou « , » non échappé`);
      if (rest.includes('\\')) problems.push(`${parsed.name} : barre oblique inverse mal placée`);
    }
  }
  if (stack.length) problems.push(`composants non fermés : ${stack.join(', ')}`);
  if (problems.length) return problems;

  const calendar = parseIcs(text);
  if (calendar.name !== 'VCALENDAR') return ['composant racine différent de VCALENDAR'];
  if (firstProp(calendar, 'VERSION')?.value !== '2.0') problems.push('VERSION:2.0 absente');
  if (!firstProp(calendar, 'PRODID')) problems.push('PRODID absent');

  const zones = new Set();
  for (const zone of calendar.children.filter((child) => child.name === 'VTIMEZONE')) {
    const tzid = firstProp(zone, 'TZID')?.value;
    if (!tzid) problems.push('VTIMEZONE sans TZID');
    else zones.add(tzid);
    const observances = zone.children.filter((child) => ['STANDARD', 'DAYLIGHT'].includes(child.name));
    if (!observances.length) problems.push(`VTIMEZONE ${tzid} sans STANDARD ni DAYLIGHT`);
    for (const observance of observances) {
      for (const required of ['DTSTART', 'TZOFFSETFROM', 'TZOFFSETTO']) {
        if (!firstProp(observance, required)) problems.push(`${observance.name} de ${tzid} sans ${required}`);
      }
    }
  }

  const uids = new Set();
  for (const event of calendar.children.filter((child) => child.name === 'VEVENT')) {
    const uid = firstProp(event, 'UID')?.value;
    if (!uid) problems.push('VEVENT sans UID');
    else if (uids.has(uid)) problems.push(`UID en double : ${uid}`);
    else uids.add(uid);
    for (const required of ['DTSTAMP', 'DTSTART', 'SUMMARY']) if (!firstProp(event, required)) problems.push(`VEVENT ${uid} sans ${required}`);
    if (!firstProp(event, 'DTEND') && !firstProp(event, 'DURATION')) problems.push(`VEVENT ${uid} sans DTEND ni DURATION`);
    const stamp = firstProp(event, 'DTSTAMP');
    if (stamp && !UTC_DATE_TIME.test(stamp.value)) problems.push(`DTSTAMP de ${uid} pas en UTC : ${stamp.value}`);
    for (const name of ['DTSTART', 'DTEND']) {
      const prop = firstProp(event, name);
      if (!prop) continue;
      if (prop.params.TZID) {
        if (!zones.has(prop.params.TZID)) problems.push(`${name} de ${uid} : TZID ${prop.params.TZID} sans VTIMEZONE`);
        if (!LOCAL_DATE_TIME.test(prop.value)) problems.push(`${name} de ${uid} : date locale mal formée ${prop.value}`);
      } else if (!UTC_DATE_TIME.test(prop.value) && !/^\d{8}$/.test(prop.value)) {
        problems.push(`${name} de ${uid} : ni UTC ni TZID (${prop.value})`);
      }
    }
    const start = firstProp(event, 'DTSTART');
    const end = firstProp(event, 'DTEND');
    if (start && end && start.params.TZID === end.params.TZID && end.value <= start.value) problems.push(`VEVENT ${uid} : DTEND n'est pas après DTSTART`);
  }
  return problems;
}

module.exports = { contentLines, eventsOf, firstProp, parseIcs, parseLine, propsNamed, unescapeText, unfold, validateIcs };
