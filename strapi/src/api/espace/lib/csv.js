'use strict';

/**
 * CSV of the organizer exports (F-91): UTF-8 with BOM, semicolon, CRLF, as Excel in French opens it. Pure.
 * A cell that a spreadsheet would read as a formula (it starts with = + - @, a tab or a carriage return) gets a leading
 * apostrophe: the text comes from the participants (names, companies) and must never run in the organizer's spreadsheet.
 */

const BOM = '﻿';

function cell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value).replace(/\r\n?/g, '\n');
  if (/^[=+\-@\t]/.test(text)) text = `'${text}`;
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** -> the text of the file: one line of headers, then one line per row (arrays of cells). */
function toCsv(headers, rows) {
  return BOM + [headers, ...rows].map((row) => row.map(cell).join(';')).join('\r\n') + '\r\n';
}

module.exports = { toCsv, cell };
