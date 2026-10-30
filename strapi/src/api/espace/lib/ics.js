'use strict';

/**
 * Calendar export (I-40, I-41, RFC 5545). Pure: events in, text out.
 *   buildCalendar({ name, events: [{ uid, start, end, summary, location, description, url }], now }) -> text
 * Lines end with CRLF and are folded at 75 octets ; TEXT values escape \ ; , and line breaks ; the times are written
 * in Europe/Paris with a fixed VTIMEZONE block (DTSTART;TZID=Europe/Paris). The caller gives a stable `uid`
 * ("{type}-{documentId}@jib"), so that an agenda updates an event it already knows instead of duplicating it.
 */

const TIME_ZONE = 'Europe/Paris';
const CRLF = '\r\n';
const FOLD_OCTETS = 75;
const PRODUCT_ID = '-//Xylofutur//JIB espace participant//FR';

// Europe/Paris since 1996: summer time from the last Sunday of March (02:00), winter time from the last Sunday of October (03:00).
const TIME_ZONE_BLOCK = [
  'BEGIN:VTIMEZONE',
  `TZID:${TIME_ZONE}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

const parisClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Wall time of an instant in Paris, "20261203T104500". */
function parisStamp(instant) {
  const parts = Object.fromEntries(parisClock.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`;
}

/** UTC time of an instant, "20261030T120000Z". */
const utcStamp = (instant) => new Date(instant).toISOString().replace(/[-:]|\.\d{3}/g, '');

/** TEXT value (3.3.11): backslash, semicolon, comma and line breaks. */
const escapeText = (value) =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');

/** A content line cut at 75 octets (3.1) ; a character is never split, the next line starts with one space. */
function fold(line) {
  const lines = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const octets = Buffer.byteLength(char);
    if (size + octets > FOLD_OCTETS) {
      lines.push(current);
      current = ' ';
      size = 1;
    }
    current += char;
    size += octets;
  }
  lines.push(current);
  return lines.join(CRLF);
}

function eventLines({ uid, start, end, summary, location, description, url }, now) {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART;TZID=${TIME_ZONE}:${parisStamp(start)}`,
    `DTEND;TZID=${TIME_ZONE}:${parisStamp(end)}`,
    `SUMMARY:${escapeText(summary)}`,
    ...(location ? [`LOCATION:${escapeText(location)}`] : []),
    ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []),
    ...(url ? [`URL:${url}`] : []),
    'END:VEVENT',
  ];
}

function buildCalendar({ name, events = [], now = new Date() }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODUCT_ID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...(name ? [`X-WR-CALNAME:${escapeText(name)}`] : []),
    `X-WR-TIMEZONE:${TIME_ZONE}`,
    ...TIME_ZONE_BLOCK,
    ...events.flatMap((event) => eventLines(event, now)),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join(CRLF) + CRLF;
}

module.exports = { buildCalendar };
