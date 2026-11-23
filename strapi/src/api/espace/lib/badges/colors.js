'use strict';

// Tokens of docs/espace/specs/07-design.md, nothing else. QR code: black on white (12-badges.md).
const COLORS = {
  title: '#325062',
  ink: '#2a3a44',
  muted: '#54585a',
  surfaceAlt: '#e8dfd4',
  white: '#ffffff',
  qr: '#000000',
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
// White text on the accent must reach 4.5:1 (AA), that is a relative luminance of 0.18 at most (same rule as the web banner).
const MAX_LUMINANCE = 0.18;

function luminance(hex) {
  const [red, green, blue] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Contrast ratio of white text on `hex`. */
const contrastWithWhite = (hex) => 1.05 / (luminance(hex) + 0.05);

/** Colour of the type band: the first candidate that is a hexadecimal colour and keeps white text at AA, else the title colour. */
function accentColor(...candidates) {
  return candidates.find((value) => typeof value === 'string' && HEX_COLOR.test(value) && luminance(value) <= MAX_LUMINANCE) ?? COLORS.title;
}

module.exports = { COLORS, accentColor, contrastWithWhite };
