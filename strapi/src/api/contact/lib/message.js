'use strict';

const { parseAddress } = require('../../espace/lib/mail');
const { escapeHtml } = require('../../espace/lib/mail/layout');

const NBSP = ' ';
const MAX = { name: 200, subject: 200, message: 10000 };

/** One line, no control character (a subject or a name never carries a line break), cut to `max`. */
const oneLine = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * The form of the public site -> { replyTo, subject, html, text } for the mail provider of the space,
 * or { error } (400) when the address is not valid or a field is missing or too long.
 * The visitor's address becomes the Reply-To: answering the e-mail writes to them.
 */
function contactMessage({ name, email, subject, message } = {}) {
  let replyTo;
  try {
    replyTo = parseAddress(typeof email === 'string' ? email : '');
  } catch {
    return { error: 'invalid email' };
  }
  const body = typeof message === 'string' ? message.replace(/\r\n?/g, '\n').trim() : '';
  if (!body) return { error: 'invalid content' };
  if (body.length > MAX.message) return { error: 'message too long' };

  const who = oneLine(name, MAX.name);
  const topic = oneLine(subject, MAX.subject);
  if (who) replyTo.name = who;

  const fields = [
    ['Nom', who || '(non renseigné)'],
    ['E-mail', replyTo.email],
    ['Objet', topic || '(sans objet)'],
  ];
  const intro = 'Nouveau message reçu par le formulaire de contact du site des Journées de l’Innovation Filière Bois.';
  const outro = `Pour répondre, répondez simplement à cet e-mail${NBSP}: la réponse partira vers ${replyTo.email}.`;

  const text = [intro, fields.map(([label, value]) => `${label}${NBSP}: ${value}`).join('\n'), `Message${NBSP}:\n${body}`, outro].join('\n\n');
  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><title>${escapeHtml(topic || 'Message du formulaire de contact')}</title></head>
<body style="margin:0;padding:24px;font-family:'Source Sans 3','Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#2a3a44">
<p style="margin:0 0 16px">${escapeHtml(intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px">${fields
    .map(([label, value]) => `<tr><td style="padding:0 16px 4px 0;font-weight:700">${escapeHtml(label)}</td><td style="padding:0 0 4px">${escapeHtml(value)}</td></tr>`)
    .join('')}</table>
<div style="margin:0 0 16px;padding:16px;background-color:#f5f0eb;border-radius:8px;white-space:pre-wrap">${escapeHtml(body)}</div>
<p style="margin:0;font-size:14px;color:#54585a">${escapeHtml(outro)}</p>
</body>
</html>`;

  return { replyTo, subject: `Contact du site${NBSP}: ${topic || 'sans objet'}`, html, text };
}

module.exports = { contactMessage, MAX };
