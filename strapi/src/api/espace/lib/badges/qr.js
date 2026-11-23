'use strict';

const QRCode = require('qrcode');

/** Quiet zone around the symbol, in modules (12-badges.md). */
const QUIET_MODULES = 4;

/**
 * Matrix of the QR code of `text`, error correction level M, no network and no image: { size, rows } with rows[r][c] = true for a dark module.
 * Only the matrix of the `qrcode` library is used ; the PDF draws it as vector rectangles (I-43).
 */
function qrMatrix(text) {
  const { modules } = QRCode.create(String(text), { errorCorrectionLevel: 'M' });
  const rows = Array.from({ length: modules.size }, (_, row) => Array.from({ length: modules.size }, (_, col) => Boolean(modules.get(row, col))));
  return { size: modules.size, rows };
}

/** Horizontal runs of dark modules, [{ row, col, length }], fewer rectangles than one per module. */
function qrRuns({ rows }) {
  const runs = [];
  rows.forEach((cells, row) => {
    let col = 0;
    while (col < cells.length) {
      if (!cells[col]) {
        col += 1;
        continue;
      }
      let length = 0;
      while (cells[col + length]) length += 1;
      runs.push({ row, col, length });
      col += length;
    }
  });
  return runs;
}

module.exports = { QUIET_MODULES, qrMatrix, qrRuns };
