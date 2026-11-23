'use strict';

/**
 * NF-72, D-23: the rich text written by the program editor, cleaned on the server before it is stored. The site shows these
 * fields through `safeHtml` (sanitize-html, web/src/lib/html.ts) ; this allowlist is narrower: paragraphs, line breaks, bold,
 * italic, lists, links (http, https, mailto) and subheadings. Every other tag is dropped (its text kept), `script`, `style`,
 * `iframe` and the like with their content ; no attribute but a link's `href` survives.
 */

const ALLOWED = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a', 'h3', 'h4']);
const DROPPED_WITH_CONTENT = ['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math', 'textarea', 'select'];
const VOID = new Set(['br']);
const RENAME = { b: 'strong', i: 'em', h1: 'h3', h2: 'h3', h5: 'h4', h6: 'h4', div: 'p' };
const MAX_LENGTH = 20000;

const escapeText = (text) => text.replace(/&(?!(#\d+|#x[0-9a-f]+|[a-z]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A link target that may be kept, decoded once so that `java&#115;cript:` is seen for what it is ; null otherwise. */
function safeHref(raw) {
  const decoded = String(raw ?? '')
    .replace(/&#(\d+);?/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .trim();
  // eslint-disable-next-line no-control-regex
  const compact = decoded.replace(/[\u0000- ]+/g, '');
  if (!/^(https?:|mailto:)/i.test(compact)) return null;
  return decoded;
}

function hrefOf(attributes) {
  const match = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes);
  return match ? safeHref(match[2] ?? match[3] ?? match[4]) : null;
}

/** Cleaned HTML of a rich text field, or null when nothing readable is left. */
function cleanRichText(input) {
  if (input === null || input === undefined) return null;
  let html = String(input).slice(0, MAX_LENGTH);
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of DROPPED_WITH_CONTENT) html = html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?(<\\/${tag}\\s*>|$)`, 'gi'), '');

  const out = [];
  const open = [];
  const pattern = /<\s*(\/)?\s*([a-z][a-z0-9]*)\b([^>]*)>|<|[^<]+/gi;
  for (const [token, closing, rawName, attributes = ''] of html.matchAll(pattern)) {
    if (!rawName) {
      out.push(escapeText(token));
      continue;
    }
    const name = RENAME[rawName.toLowerCase()] ?? rawName.toLowerCase();
    if (!ALLOWED.has(name)) continue;
    if (closing) {
      const index = open.lastIndexOf(name);
      if (index === -1) continue;
      while (open.length > index) out.push(`</${open.pop()}>`);
      continue;
    }
    if (VOID.has(name)) {
      out.push('<br>');
      continue;
    }
    // An item or a paragraph left open ends where the next one starts, as in a browser.
    if ((name === 'li' || name === 'p') && open.at(-1) === name) out.push(`</${open.pop()}>`);
    if (name === 'a') {
      const href = hrefOf(attributes);
      if (!href) continue;
      out.push(`<a href="${escapeAttribute(href)}">`);
    } else out.push(`<${name}>`);
    open.push(name);
  }
  while (open.length) out.push(`</${open.pop()}>`);

  const result = out
    .join('')
    .replace(/<(p|h3|h4|li|strong|em|u)>\s*<\/\1>/g, '')
    .replace(/(<br>\s*)+(<\/p>)/g, '$2')
    .trim();
  return result.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim() ? result : null;
}

module.exports = { cleanRichText, safeHref };
