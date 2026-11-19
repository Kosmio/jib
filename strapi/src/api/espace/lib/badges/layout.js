'use strict';

const path = require('node:path');
const PDFDocument = require('pdfkit');
const { COLORS, accentColor } = require('./colors');
const { CUT_MENTION, LEADING, layoutProgram } = require('./program');
const { QUIET_MODULES, qrMatrix, qrRuns } = require('./qr');
const { fitText, printable, wrap } = require('./text');

const MM = 72 / 25.4;
// A4 portrait folded in four: first in two along the height, then in two along the width (decision of 18 November 2026, 12-badges.md).
// Upper half: two A6 faces, both with the name and the QR code, so that the badge reads whichever face shows. Lower half: the program and
// the meetings of the bearer, printed upside down so that they read upright once the sheet is folded over its middle.
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 10 * MM; // printer margin of a desk printer (D-13)
const PAD = 14;
const MID = PAGE.width / 2;
const HALF = PAGE.height / 2;
const TRIM = { left: MARGIN, right: PAGE.width - MARGIN, top: MARGIN, bottom: PAGE.height - MARGIN };
// The two faces of a half sheet, from the printer margin to the vertical fold.
const PANELS = [{ x0: TRIM.left, x1: MID }, { x0: MID, x1: TRIM.right }];
const inner = (panel) => ({ x: panel.x0 + PAD, width: panel.x1 - panel.x0 - 2 * PAD });
// Content box of a half sheet whose top edge is at `oy`: the printer margin above, the horizontal fold below.
const boxOf = (oy) => ({ top: oy + TRIM.top + 10, bottom: oy + HALF - PAD });
const QR_SIDE = 30 * MM; // symbol only, quiet zone excluded: above the 28 mm minimum
const NAME_MAX = 80;
const COMPANY_MAX = 120;
const JOB_MAX = 120;
const LOGO_WIDTH = 110;
const BAND_HEIGHT = 30;
const QR_CAPTION = 'Scannez le code pour ouvrir ma carte';
const MEETING_SIZE = 8.5;
const MEETING_ROW = 2 * MEETING_SIZE * 1.22 + 5;
const MEETING_TIME_WIDTH = 36;
const PLAN_MIN_HEIGHT = 70;

const ASSETS = path.join(__dirname, 'assets');
const LOGO = path.join(ASSETS, 'logo-jib.png');
const DISPLAY_FONT = path.join(ASSETS, 'Azonix.otf');
const { TYPE_LABELS } = require('./types');
// Azonix has no accents: the band prints capitals without any.
const bandLabel = (type) => printable(TYPE_LABELS[type] ?? TYPE_LABELS.participant).normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();

const dayFormat = (options) => new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: 'Europe/Paris' });
const dayLine = (edition) => {
  const day = edition.date ? new Date(`${edition.date}T12:00:00Z`) : null;
  const label = day && !Number.isNaN(day.getTime()) ? dayFormat({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(day) : '';
  return printable([label, edition.city].filter(Boolean).join(', '));
};

/** Crop marks at the four corners and fold marks at the middle of each side: short ticks in the margin, outside the area that is cut. */
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
  for (const [from, to] of [[TRIM.left - 14, TRIM.left - 4], [TRIM.right + 4, TRIM.right + 14]]) doc.moveTo(from, HALF).lineTo(to, HALF).stroke();
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

/**
 * One face of the upper half: logo, name, company, function, type band in the accent colour, QR code. `link` puts the URL annotation on
 * the QR code: one face only, so that the token is written once in the file (NF-55).
 */
function drawIdentity(doc, panel, { badge, accent, qr, logo, measure, link }) {
  const { x, width } = inner(panel);
  const { top, bottom } = boxOf(0);
  doc.image(logo, x, top, { width: LOGO_WIDTH });
  const logoBottom = top + (LOGO_WIDTH * logo.height) / logo.width;

  const quiet = QUIET_MODULES * (QR_SIDE / qr.size);
  const qrX = x + quiet;
  const qrY = bottom - quiet - QR_SIDE;
  drawQr(doc, qr, { x: qrX, y: qrY, side: QR_SIDE });
  if (link) doc.link(qrX, qrY, QR_SIDE, QR_SIDE, badge.url);
  const captionX = qrX + QR_SIDE + quiet + 12;
  const captionLines = wrap(QR_CAPTION, 8, x + width - captionX, (text, size) => measure(text, size, false));
  captionLines.forEach((line, index) =>
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text(line, captionX, qrY + (QR_SIDE - captionLines.length * 10) / 2 + index * 10, { lineBreak: false }),
  );

  const bandTop = qrY - quiet - 12 - BAND_HEIGHT;
  doc.rect(panel.x0, bandTop, panel.x1 - panel.x0, BAND_HEIGHT).fill(accent);
  const label = bandLabel(badge.type);
  let labelSize = 13;
  doc.font('Display');
  while (labelSize > 8 && doc.fontSize(labelSize).widthOfString(label) > width) labelSize -= 1;
  doc.fontSize(labelSize).fillColor(COLORS.white).text(label, panel.x0, bandTop + (BAND_HEIGHT - labelSize) / 2 + 1, { width: panel.x1 - panel.x0, align: 'center', lineBreak: false });

  const name = fitText({ text: `${badge.firstName ?? ''} ${badge.lastName ?? ''}`, measure: (text, size) => measure(text, size, true), sizes: [30, 27, 24, 21, 18, 15], width, maxLines: 2, maxChars: NAME_MAX });
  const company = fitText({ text: badge.company, measure: (text, size) => measure(text, size, true), sizes: [15, 13, 12, 10], width, maxLines: 2, maxChars: COMPANY_MAX });
  const job = fitText({ text: badge.jobTitle, measure: (text, size) => measure(text, size, false), sizes: [11, 10, 9], width, maxLines: 2, maxChars: JOB_MAX });
  const blocks = [
    { block: name, font: 'Helvetica-Bold', color: COLORS.ink, before: 0 },
    { block: company, font: 'Helvetica-Bold', color: COLORS.title, before: 10 },
    { block: job, font: 'Helvetica', color: COLORS.muted, before: 5 },
  ].filter(({ block }) => block.lines.length);
  const heightOf = ({ block, before }) => before + block.lines.length * block.size * 1.18;
  // Centred between the logo and the band ; the sizes above make the tallest text fit that zone.
  const zone = { top: logoBottom + 14, bottom: bandTop - 10 };
  let y = Math.max(zone.top, zone.top + (zone.bottom - zone.top - blocks.reduce((sum, item) => sum + heightOf(item), 0)) / 2);
  for (const item of blocks) {
    y += item.before;
    item.block.lines.forEach((line, index) => doc.font(item.font).fontSize(item.block.size).fillColor(item.color).text(line, x, y + index * item.block.size * 1.18, { lineBreak: false }));
    y += item.block.lines.length * item.block.size * 1.18;
  }
}

/** Program of the edition on one face of the lower half, whose top edge is at `oy`. */
function drawProgram(doc, panel, oy, { edition, program, measure }) {
  const { x, width } = inner(panel);
  const { top, bottom } = boxOf(oy);
  doc.font('Display').fontSize(12).fillColor(COLORS.title).text('PROGRAMME', x, top, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.ink).text(printable(edition.title), x, top + 20, { width, height: 10, ellipsis: true, lineBreak: false });
  doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(dayLine(edition), x, top + 32, { width, height: 10, ellipsis: true, lineBreak: false });

  const boxTop = top + 50;
  const laid = layoutProgram({ sessions: program?.sessions ?? [], notes: program?.notes ?? [], measure, width, height: bottom - boxTop });
  let y = boxTop;
  for (const row of laid.rows) {
    const lead = laid.size * LEADING;
    if (row.time) doc.font('Helvetica-Bold').fontSize(laid.size).fillColor(COLORS.title).text(row.time, x, y, { lineBreak: false });
    row.titleLines.forEach((line, index) => doc.font('Helvetica-Bold').fontSize(laid.size).fillColor(COLORS.ink).text(line, x + 24, y + index * lead, { lineBreak: false }));
    row.speakerLines.forEach((line, index) =>
      doc.font('Helvetica').fontSize(laid.size).fillColor(COLORS.muted).text(line, x + 24, y + (row.titleLines.length + index) * lead, { lineBreak: false }),
    );
    y += row.height;
  }
  const mention = laid.mention?.lines ?? (laid.rows.length ? [] : [CUT_MENTION]);
  mention.forEach((line, index) => doc.font('Helvetica-Bold').fontSize(laid.size).fillColor(COLORS.title).text(line, x, y + index * laid.size * LEADING, { lineBreak: false }));
}

/**
 * Confirmed meetings of the bearer on the other face of the lower half, as they stand when the badge is generated, then the plan of the
 * venue in the room left. Meetings that do not fit are counted in a closing line.
 */
function drawMeetings(doc, panel, oy, { meetings, printedOn, plan, measure }) {
  const { x, width } = inner(panel);
  const { top, bottom } = boxOf(oy);
  doc.font('Display').fontSize(12).fillColor(COLORS.title).text('MES RENDEZ-VOUS', x, top, { lineBreak: false });
  doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(printable(`Confirmés au ${printedOn}. Agenda à jour dans l’application.`), x, top + 20, { width, height: 10, ellipsis: true, lineBreak: false });

  const oneLine = (text, bold, lineWidth) => fitText({ text, measure: (value, size) => measure(value, size, bold), sizes: [MEETING_SIZE], width: lineWidth, maxLines: 1 }).lines[0] ?? '';
  let y = top + 40;
  if (!meetings.length) {
    doc.font('Helvetica').fontSize(MEETING_SIZE).fillColor(COLORS.ink).text('Aucun rendez-vous confirmé à l’impression de ce badge.', x, y, { lineBreak: false });
    y += MEETING_ROW;
  } else {
    const room = Math.max(1, Math.floor((bottom - y) / MEETING_ROW));
    const shown = meetings.length > room ? meetings.slice(0, room - 1) : meetings;
    for (const meeting of shown) {
      doc.font('Helvetica-Bold').fontSize(MEETING_SIZE).fillColor(COLORS.title).text(oneLine(meeting.time, true, MEETING_TIME_WIDTH - 4), x, y, { lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(MEETING_SIZE).fillColor(COLORS.ink).text(oneLine(meeting.name, true, width - MEETING_TIME_WIDTH), x + MEETING_TIME_WIDTH, y, { lineBreak: false });
      const detail = oneLine(meeting.detail, false, width - MEETING_TIME_WIDTH);
      if (detail) doc.font('Helvetica').fontSize(MEETING_SIZE).fillColor(COLORS.muted).text(detail, x + MEETING_TIME_WIDTH, y + MEETING_SIZE * 1.22, { lineBreak: false });
      y += MEETING_ROW;
    }
    if (shown.length < meetings.length) {
      const left = meetings.length - shown.length;
      doc.font('Helvetica-Bold').fontSize(MEETING_SIZE).fillColor(COLORS.title).text(`${left} autre${left > 1 ? 's' : ''} rendez-vous dans l’application`, x, y, { lineBreak: false });
      y += MEETING_ROW;
    }
  }

  if (plan && bottom - y - 28 >= PLAN_MIN_HEIGHT) {
    doc.font('Display').fontSize(7).fillColor(COLORS.title).text('PLAN DU LIEU', x, y + 10, { lineBreak: false });
    doc.image(plan, x, y + 24, { fit: [width, bottom - y - 24] });
  }
}

/**
 * PDF of the badges, one A4 page per badge, in the order given (F-97, F-98).
 *   badges: [{ firstName, lastName, jobTitle, company, type: 'participant'|'speaker'|'exhibitor_rep'|'organizer', url,
 *              meetings?: [{ time, name, detail }] }], the confirmed meetings of the bearer in the order of the day ;
 *   edition: { title, date, city } ; program: { sessions, notes } of the program service (or null) ; plan: Buffer of a PNG or JPEG (or null) ;
 *   accent: hexadecimal colour wanted for the type band, replaced by the title colour when white text on it falls under AA ;
 *   printedAt: instant written above the meetings (they are those of that moment).
 * `compress: false` keeps the page contents readable (tests). Fonts: Azonix (the site's display font) for capitals, the built-in Helvetica
 * for the rest, because the site's Sora and Source Sans 3 are variable woff2 files that pdfkit cannot subset. -> Promise<Buffer>
 */
function buildBadgesPdf({ badges, edition, program = null, plan = null, accent = null, compress = true, printedAt = new Date() }) {
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
      const printedOn = dayFormat({ day: 'numeric', month: 'long', year: 'numeric' }).format(printedAt);

      for (const badge of badges) {
        doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
        drawMarks(doc);
        const qr = qrMatrix(badge.url);
        PANELS.forEach((panel, index) => drawIdentity(doc, panel, { badge, accent: bandColor, qr, logo, measure, link: index === 0 }));
        // Lower half, turned by 180 degrees around its centre: drawn as an upright half sheet whose top edge is the fold.
        doc.save().rotate(180, { origin: [MID, HALF * 1.5] });
        drawProgram(doc, PANELS[0], HALF, { edition, program, measure });
        drawMeetings(doc, PANELS[1], HALF, { meetings: badge.meetings ?? [], printedOn, plan: planImage, measure });
        doc.restore();
      }
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = { HALF, MM, PAGE, QR_SIDE, buildBadgesPdf };
