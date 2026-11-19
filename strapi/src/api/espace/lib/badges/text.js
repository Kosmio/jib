'use strict';

// Characters the built-in Helvetica (WinAnsi) can print, besides U+0020-U+007E and U+00A0-U+00FF.
const WIN_ANSI_EXTRA = new Set([0x152, 0x153, 0x160, 0x161, 0x178, 0x17d, 0x17e, 0x192, 0x2c6, 0x2dc, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203a, 0x20ac]);
// Dashes and the like print as a hyphen ; a few letters have no accent to strip.
const REPLACEMENTS = new Map([
  [0x2010, '-'], [0x2011, '-'], [0x2012, '-'], [0x2013, '-'], [0x2014, '-'], [0x2015, '-'], [0x2212, '-'],
  [0x141, 'L'], [0x142, 'l'], [0x110, 'D'], [0x111, 'd'], [0x131, 'i'], [0x18f, 'E'], [0x259, 'e'],
]);
const ELLIPSIS = '…';

const printableCode = (code) => (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(code);

/** Text a standard PDF font can print: other characters lose their accent, or become "?". Spaces are collapsed. */
function printable(value) {
  let out = '';
  for (const char of String(value ?? '').normalize('NFC')) {
    const code = char.codePointAt(0);
    if (printableCode(code)) out += char;
    else if (REPLACEMENTS.has(code)) out += REPLACEMENTS.get(code);
    else {
      const base = char.normalize('NFD').replace(/\p{M}/gu, '');
      out += base && [...base].every((part) => printableCode(part.codePointAt(0))) ? base : /\s/.test(char) ? ' ' : '?';
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** `text` cut to `maxChars` characters at most, ending with "…" when something was cut. */
function clip(text, maxChars) {
  const chars = [...text];
  return chars.length > maxChars ? `${chars.slice(0, Math.max(0, maxChars - 1)).join('').trimEnd()}${ELLIPSIS}` : text;
}

/** The line cut at the end until `line + "…"` fits `width`. */
function ellipsize(line, width, measure, size) {
  let chars = [...line.replace(new RegExp(`${ELLIPSIS}$`), '')];
  while (chars.length && measure(`${chars.join('').trimEnd()}${ELLIPSIS}`, size) > width) chars.pop();
  return `${chars.join('').trimEnd()}${ELLIPSIS}`;
}

/** Greedy word wrap at `width`; a word wider than a line is broken between characters. */
function wrap(text, size, width, measure) {
  const lines = [];
  let current = '';
  const push = (line) => lines.push(line);
  for (const word of text.split(' ').filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate, size) <= width) {
      current = candidate;
      continue;
    }
    if (current) push(current);
    current = '';
    let rest = [...word];
    while (rest.length && measure(rest.join(''), size) > width) {
      let cut = rest.length - 1;
      while (cut > 1 && measure(rest.slice(0, cut).join(''), size) > width) cut -= 1;
      push(rest.slice(0, cut).join(''));
      rest = rest.slice(cut);
    }
    current = rest.join('');
  }
  if (current) push(current);
  return lines;
}

/**
 * Fits `text` in a column: the largest of `sizes` (descending) at which it wraps in at most `maxLines` lines of `width`;
 * past the smallest size the last line is cut with "…" (T-66). `measure(text, size)` is the width of a text in points.
 * Pure: the PDF library only provides `measure`. -> { size, lines, truncated }
 */
function fitText({ text, measure, sizes, width, maxLines, maxChars = Infinity }) {
  const clean = clip(printable(text), maxChars);
  if (!clean) return { size: sizes[0], lines: [], truncated: false };
  for (const size of sizes) {
    const lines = wrap(clean, size, width, measure);
    if (lines.length <= maxLines) return { size, lines, truncated: clean !== printable(text) };
  }
  const size = sizes[sizes.length - 1];
  const lines = wrap(clean, size, width, measure).slice(0, maxLines);
  lines[maxLines - 1] = ellipsize(`${lines[maxLines - 1]}${ELLIPSIS}`, width, measure, size);
  return { size, lines, truncated: true };
}

module.exports = { ELLIPSIS, clip, fitText, printable, wrap };
