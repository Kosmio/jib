'use strict';

/**
 * Common e-mail layout (phase-1-design.md, Q5): 600 px card, header in the edition colour, Xylofutur footer.
 * Tables and inline styles only. The values are the tokens of 07-design.md, copied once here (no CSS variables in e-mail).
 *
 * A template returns { subject, preheader, title, blocks, footer?, manage? } where `blocks` is a list of
 *   'paragraph text' | { ul: ['item', …] } | { button: { label, url } } | { url } (fallback link)
 * and `footer` replaces the default footer sentence ; `manage: false` removes the "Gérer mes notifications" link.
 */

const COLORS = {
  page: '#e8dfd4',
  card: '#ffffff',
  ink: '#2a3a44',
  muted: '#54585a',
  title: '#325062',
  gold: '#f0ab00',
  goldInk: '#3a2410',
  link: '#007a5e',
  white: '#ffffff',
};
const FONT = "'Source Sans 3','Segoe UI',Helvetica,Arial,sans-serif";
const NBSP = ' ';
const JIB_LOGO_ALT = 'La Journée de l’Innovation de la Filière Bois';

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

/** The edition colour for the header, or the title colour when it is not a #rrggbb value or white would read under 4.5:1 on it. */
function headerColor(themeColor) {
  if (!/^#[0-9a-fA-F]{6}$/.test(themeColor || '')) return COLORS.title;
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = parseInt(themeColor.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.18 ? COLORS.title : themeColor;
}

const paragraphStyle = `margin:0 0 16px;font-size:17px;line-height:1.5;color:${COLORS.ink}`;
const linkStyle = `color:${COLORS.link};text-decoration:underline`;

function blockHtml(block) {
  if (typeof block === 'string') return `<p style="${paragraphStyle}">${escapeHtml(block)}</p>`;
  if (block.ul) {
    const items = block.ul.map((item) => `<li style="margin:0 0 6px">${escapeHtml(item)}</li>`).join('');
    return `<ul style="${paragraphStyle};padding-left:24px">${items}</ul>`;
  }
  if (block.button) {
    const { label, url } = block.button;
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td bgcolor="${COLORS.gold}" style="background-color:${COLORS.gold};border-radius:8px"><a href="${escapeHtml(url)}" style="display:block;padding:16px 28px;font-family:${FONT};font-size:17px;font-weight:700;color:${COLORS.goldInk};text-decoration:none">${escapeHtml(label)}</a></td></tr></table>`;
  }
  return `<p style="${paragraphStyle};font-size:15px;word-break:break-all"><a href="${escapeHtml(block.url)}" style="${linkStyle}">${escapeHtml(block.url)}</a></p>`;
}

function blockText(block) {
  if (typeof block === 'string') return block;
  if (block.ul) return block.ul.map((item) => `- ${item}`).join('\n');
  if (block.button) return `${block.button.label}${NBSP}: ${block.button.url}`;
  return block.url;
}

/** { subject, html, text } from a template result and its data ({ edition: { slug, title, themeColor }, publicUrl, … }). */
function renderLayout({ subject, preheader = '', title, blocks, footer, manage = true }, { edition, publicUrl }) {
  const base = String(publicUrl).replace(/\/+$/, '');
  const manageUrl = `${base}/espace/${edition.slug}/profil`;
  const footerText = footer ?? `Vous recevez ce message car vous participez à l’édition ${edition.title}.`;
  const color = headerColor(edition.themeColor);

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background-color:${COLORS.page};font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COLORS.page}" style="background-color:${COLORS.page}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background-color:${COLORS.card};border-radius:16px;overflow:hidden">
<tr><td bgcolor="${color}" style="background-color:${color};padding:28px 40px">
<img src="${escapeHtml(base)}/assets/logo-jib-blanc.png" width="180" alt="${JIB_LOGO_ALT}" style="display:block;border:0;width:180px;height:auto;margin:0 0 20px">
<div style="margin:0 0 6px;font-size:24px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${COLORS.white}">${escapeHtml(title)}</div>
<div style="font-size:16px;font-weight:600;color:${COLORS.white}">${escapeHtml(edition.title)}</div>
</td></tr>
<tr><td style="padding:32px 40px 16px">${blocks.map(blockHtml).join('\n')}</td></tr>
<tr><td style="padding:0 40px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${COLORS.page}"><tr><td style="padding-top:20px;font-size:14px;line-height:1.5;color:${COLORS.muted}">
<img src="${escapeHtml(base)}/assets/logo-xylofutur.png" width="90" alt="Xylofutur" style="display:block;border:0;width:90px;height:auto;margin:0 0 12px">
${escapeHtml(footerText)}${manage ? ` <a href="${escapeHtml(manageUrl)}" style="${linkStyle}">Gérer mes notifications</a>` : ''}
</td></tr></table></td></tr>
</table>
</td></tr></table>
</body>
</html>`;

  const text = [title, ...blocks.map(blockText), footerText + (manage ? `\nGérer mes notifications${NBSP}: ${manageUrl}` : '')].join('\n\n');
  return { subject, html, text };
}

module.exports = { COLORS, escapeHtml, renderLayout };
