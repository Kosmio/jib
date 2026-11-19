'use strict';

const { clip, printable, wrap } = require('./text');

const CUT_MENTION = 'Programme complet dans l’application';
const TITLE_MAX = 140;
// From the most comfortable to the smallest: the program shrinks first, then loses its speakers, then is cut (12-badges.md).
const LEVELS = [
  { size: 8, speakers: true },
  { size: 7.5, speakers: true },
  { size: 7, speakers: true },
  { size: 7, speakers: false },
  { size: 6.5, speakers: false },
];
const LEADING = 1.22;
const GAP = 0.55; // between two rows, in font sizes

/** Rows of the program: sessions by time, then the sequences without a readable time (notes). Names of speakers, no more. */
function programRows({ sessions = [], notes = [] }) {
  return [
    ...sessions.map((session) => ({
      time: printable(session.start ?? ''),
      title: printable(session.title),
      speakers: printable((session.speakers ?? []).map((speaker) => speaker.name).filter(Boolean).join(', ')),
    })),
    ...notes.map((title) => ({ time: '', title: printable(title), speakers: '' })),
  ].filter((row) => row.title);
}

/**
 * Lays the program out in a box of `width` x `height` points. `measure(text, size, bold)` is the width of a text in points.
 * Tries each level of LEVELS; when even the smallest overflows, rows are dropped from the end and CUT_MENTION closes the list.
 * -> { size, rows: [{ time, titleLines, speakerLines, height }], height, reduced, cut, mention }.
 * `height` is the height really used, never above the box.
 */
function layoutProgram({ sessions, notes, measure, width, height, timeWidth = 24 }) {
  const rows = programRows({ sessions, notes });
  const textWidth = width - timeWidth;

  const lay = ({ size, speakers }) =>
    rows.map((row) => {
      const titleLines = wrap(clip(row.title, TITLE_MAX), size, textWidth, (text, fontSize) => measure(text, fontSize, true));
      const speakerLines = speakers && row.speakers ? wrap(clip(row.speakers, TITLE_MAX), size, textWidth, (text, fontSize) => measure(text, fontSize, false)) : [];
      return { time: row.time, titleLines, speakerLines, height: (titleLines.length + speakerLines.length) * size * LEADING + size * GAP };
    });
  const total = (laid) => laid.reduce((sum, row) => sum + row.height, 0);

  for (const [index, level] of LEVELS.entries()) {
    const laid = lay(level);
    if (total(laid) <= height) return { size: level.size, rows: laid, height: total(laid), reduced: index > 0, cut: false, mention: null };
  }

  const level = LEVELS[LEVELS.length - 1];
  const laid = lay(level);
  const mentionLines = wrap(CUT_MENTION, level.size, width, (text, fontSize) => measure(text, fontSize, true));
  const mentionHeight = mentionLines.length * level.size * LEADING;
  const kept = [];
  let used = 0;
  for (const row of laid) {
    if (used + row.height + mentionHeight > height) break;
    kept.push(row);
    used += row.height;
  }
  return { size: level.size, rows: kept, height: used + mentionHeight, reduced: true, cut: true, mention: { lines: mentionLines, height: mentionHeight } };
}

module.exports = { CUT_MENTION, LEADING, LEVELS, layoutProgram, programRows };
