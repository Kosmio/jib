'use strict';

const path = require('node:path');
const PDFDocument = require('pdfkit');
const { COLORS, accentColor } = require('./colors');
const { CUT_MENTION, LEADING, layoutProgram } = require('./program');
const { QUIET_MODULES, qrMatrix, qrRuns } = require('./qr');
const { fitText, printable } = require('./text');

const MM = 72 / 25.4;
// A4 portrait, folded in two columns: the verso on the left half, the recto on the right half (12-badges.md).
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 10 * MM; // printer margin of a desk printer (D-13)
const PAD = 14;
const MID = PAGE.width / 2;
const TRIM = { left: MARGIN, right: PAGE.width - MARGIN, top: MARGIN, bottom: PAGE.height - MARGIN };
const LEFT = { x: TRIM.left + PAD, width: MID - TRIM.left - 2 * PAD };
const RIGHT = { x: MID + PAD, width: TRIM.right - MID - 2 * PAD };
const QR_SIDE = 32 * MM; // symbol only, quiet zone excluded: above the 28 mm minimum
const NAME_MAX = 80;
const COMPANY_MAX = 120;
const JOB_MAX = 120;
const PROGRAM_GAP = 12;
const PLAN_SHARE = 0.38;

const ASSETS = path.join(__dirname, 'assets');
const LOGO = path.join(ASSETS, 'logo-jib.png');
const DISPLAY_FONT = path.join(ASSETS, 'Azonix.otf');
const { TYPE_LABELS } = require('./types');
// Azonix has no accents: the band prints capitals without any.
const bandLabel = (type) => printable(TYPE_LABELS[type] ?? TYPE_LABELS.participant).normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();

const dayLine = (edition) => {
  const day = edition.date ? new Date(`${edition.date}T12:00:00Z`) : null;
  const label = day && !Number.isNaN(day.getTime()) ? new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }).format(day) : '';
  return printable([label, edition.city].filter(Boolean).join(', '));
};

/** Fold and crop marks: short ticks in the margin, outside the area that is cut. */
function drawMarks(doc) {
  doc.save().lineWidth(0.4).strokeColor(COLORS.muted);
  for (const x of [TRIM.left, TRIM.right]) {
    for (const [y, dy] of [[TRIM.top, -1], [TRIM.bottom, 1]]) {
      doc.moveTo(x, y + dy * 4).lineTo(x, y + dy * 14).stroke();
      doc.moveTo(x + (x === TRIM.left ? -4 : 4), y).lineTo(x + (x === TRIM.left ? -14 : 14), y).stroke();
    }
  }
  doc.dash(2, { space: 2 });
  for (const [from, to] of [[TRIM.top - 14, TRIM.top - 4], [TRIM.bottom + 4, TRIM.bottom + 14]]) doc.moveTo(MID, from).lineTo(MID, to).stroke();
  doc.restore();
}

/** Vector QR code: dark modules as rectangles, with an explicit white quiet zone of 4 modules around the symbol. */
function drawQr(doc, matrix, { x, y, side }) {
  const module = side / matrix.size;
  const quiet = QUIET_MODULES * module;
  doc.save().rect(x - quiet, y - quiet, side + 2 * quiet, side + 2 * quiet).fill(COLORS.white);
  for (const { row, col, length } of qrRuns(matrix)) doc.rect(x + col * module, y + row * module, length * module, module);
  doc.fill(COLORS.qr).restore();
}

/** Verso: program of the edition, plan of the venue at its right when the edition has one. */
function drawVerso(doc, { edition, program, plan, measure }) {
  const top = TRIM.top + PAD;
  doc.font('Display').fontSize(12).fillColor(COLORS.title).text('PROGRAMME', LEFT.x, top, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.ink).text(printable(edition.title), LEFT.x, top + 20, { width: LEFT.width, height: 10, ellipsis: true, lineBreak: false });
  doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(dayLine(edition), LEFT.x, top + 32, { width: LEFT.width, height: 10, ellipsis: true, lineBreak: false });

  const boxTop = top + 52;
  const boxHeight = TRIM.bottom - PAD - boxTop;
  const programWidth = plan ? Math.round(LEFT.width * (1 - PLAN_SHARE)) - PROGRAM_GAP / 2 : LEFT.width;

  const laid = layoutProgram({ sessions: program?.sessions ?? [], notes: program?.notes ?? [], measure, width: programWidth, height: boxHeight });
  let y = boxTop;
  for (const row of laid.rows) {
    const lead = laid.size * LEADING;
    if (row.time) doc.font('Helvetica-Bold').fontSize(laid.size).fillColor(COLORS.title).text(row.time, LEFT.x, y, { lineBreak: false });
    row.titleLines.forEach((line, index) => doc.font('Helvetica-Bold').fontSize(laid.size).fillColor(COLORS.ink).text(line, LEFT.x + 24, y + index * lead, { lineBreak: false }));
    row.speakerLines.forEach((line, index) =>
      doc.font('Helvetica').fontSize(laid.size).fillColor(COLORS.muted).text(line, LEFT.x + 24, y + (row.titleLines.length + index) * lead, { lineBreak: false }),
    );
    y += row.height;
  }
  const mention = laid.mention?.lines ?? (laid.rows.length ? [] : [CUT_MENTION]);
  mention.forEach((line, index) => doc.font('Helvetica-Bold').fontSize(laid.size).fillColor(COLORS.title).text(line, LEFT.x, y + index * laid.size * LEADING, { lineBreak: false }));

  if (plan) {
    const x = LEFT.x + programWidth + PROGRAM_GAP;
    const width = LEFT.x + LEFT.width - x;
    doc.font('Display').fontSize(7).fillColor(COLORS.title).text('PLAN DU LIEU', x, boxTop, { lineBreak: false });
    doc.image(plan, x, boxTop + 14, { fit: [width, boxHeight - 14] });
  }
}

/** Recto: logo, name, company, function, type band in the accent colour, QR code. */
function drawRecto(doc, { badge, accent, qr, logo, measure }) {
  const logoWidth = 170;
  doc.image(logo, RIGHT.x, TRIM.top + PAD, { width: logoWidth });

  const name = fitText({ text: `${badge.firstName ?? ''} ${badge.lastName ?? ''}`, measure: (text, size) => measure(text, size, true), sizes: [34, 30, 26, 22, 18, 15], width: RIGHT.width, maxLines: 2, maxChars: NAME_MAX });
  const company = fitText({ text: badge.company, measure: (text, size) => measure(text, size, true), sizes: [18, 16, 14, 12, 10], width: RIGHT.width, maxLines: 2, maxChars: COMPANY_MAX });
  const job = fitText({ text: badge.jobTitle, measure: (text, size) => measure(text, size, false), sizes: [14, 12, 11, 10], width: RIGHT.width, maxLines: 2, maxChars: JOB_MAX });

  let y = 170;
  const lines = (block, font, color) => {
    block.lines.forEach((line, index) => doc.font(font).fontSize(block.size).fillColor(color).text(line, RIGHT.x, y + index * block.size * 1.18, { lineBreak: false }));
    y += block.lines.length * block.size * 1.18;
  };
  lines(name, 'Helvetica-Bold', COLORS.ink);
  y += 14;
  lines(company, 'Helvetica-Bold', COLORS.title);
  y += 6;
  lines(job, 'Helvetica', COLORS.muted);

  const bandTop = 470;
  const bandHeight = 54;
  doc.rect(MID, bandTop, TRIM.right - MID, bandHeight).fill(accent);
  const label = bandLabel(badge.type);
  let labelSize = 17;
  doc.font('Display');
  while (labelSize > 8 && doc.fontSize(labelSize).widthOfString(label) > RIGHT.width) labelSize -= 1;
  doc.fontSize(labelSize).fillColor(COLORS.white).text(label, MID, bandTop + (bandHeight - labelSize) / 2 + 1, { width: TRIM.right - MID, align: 'center', lineBreak: false });

  const qrX = MID + (TRIM.right - MID - QR_SIDE) / 2;
  const qrY = bandTop + bandHeight + 40;
  drawQr(doc, qr, { x: qrX, y: qrY, side: QR_SIDE });
  doc.link(qrX, qrY, QR_SIDE, QR_SIDE, badge.url);
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text('Scannez le code pour ouvrir ma carte', RIGHT.x, qrY + QR_SIDE + QUIET_MODULES * (QR_SIDE / qr.size) + 8, { width: RIGHT.width, align: 'center', lineBreak: false });
}

/**
 * PDF of the badges, one A4 page per badge, in the order given (F-97, F-98).
 *   badges: [{ firstName, lastName, jobTitle, company, type: 'participant'|'speaker'|'exhibitor_rep'|'organizer', url }]
 *   edition: { title, date, city } ; program: { sessions, notes } of the program service (or null) ; plan: Buffer of a PNG or JPEG (or null) ;
 *   accent: hexadecimal colour wanted for the type band, replaced by the title colour when white text on it falls under AA.
 * `compress: false` keeps the page contents readable (tests). Fonts: Azonix (the site's display font) for capitals, the built-in Helvetica
 * for the rest, because the site's Sora and Source Sans 3 are variable woff2 files that pdfkit cannot subset. -> Promise<Buffer>
 */
function buildBadgesPdf({ badges, edition, program = null, plan = null, accent = null, compress = true }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0, compress, info: { Title: `Badges ${printable(edition.title)}`, Producer: 'Kosmio', Creator: 'Kosmio' } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      doc.registerFont('Display', DISPLAY_FONT);
      const measure = (text, size, bold) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).widthOfString(text);
      const logo = doc.openImage(LOGO);
      const planImage = plan ? doc.openImage(plan) : null;
      const bandColor = accentColor(accent);

      for (const badge of badges) {
        doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
        drawMarks(doc);
        drawVerso(doc, { edition, program, plan: planImage, measure });
        drawRecto(doc, { badge, accent: bandColor, qr: qrMatrix(badge.url), logo, measure });
      }
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = { MM, PAGE, QR_SIDE, buildBadgesPdf };
