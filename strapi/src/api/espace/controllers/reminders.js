'use strict';

const { EspaceError } = require('../lib/errors');
const { requireOrganizer } = require('../lib/guards');
const { escapeHtml } = require('../lib/mail/layout');

async function organizerEdition(ctx) {
  requireOrganizer(ctx, ctx.params.edition);
  const edition = await strapi.service('api::espace.editions').findPublished(ctx.params.edition);
  if (!edition) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');
  return edition;
}

const scenarioOf = (ctx) => (ctx.request.body && typeof ctx.request.body === 'object' ? ctx.request.body.scenario : undefined);

const page = (title, lines, link) => `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px 12px;background-color:#f5f0eb;font-family:'Source Sans 3','Segoe UI',Helvetica,Arial,sans-serif;color:#2a3a44">
<main style="max-width:560px;margin:0 auto;padding:32px 28px;background-color:#ffffff;border-radius:16px">
<h1 style="margin:0 0 16px;font-size:24px;color:#325062">${escapeHtml(title)}</h1>
${lines.map((line) => `<p style="margin:0 0 16px;font-size:17px;line-height:1.5">${escapeHtml(line)}</p>`).join('\n')}
${link ? `<p style="margin:0;font-size:17px"><a href="${escapeHtml(link.url)}" style="color:#007a5e">${escapeHtml(link.label)}</a></p>` : ''}
</main></body></html>`;

module.exports = {
  // POST /api/espace/admin/:edition/reminders/preview (organizer): F-92, { recipients, skipped: { alreadySent, optedOut }, sampleHtml }.
  preview: async (ctx) => {
    ctx.body = await strapi.service('api::espace.reminders').preview(await organizerEdition(ctx), scenarioOf(ctx));
  },

  // POST /api/espace/admin/:edition/reminders/send (organizer): F-92, R-71, { sent, skipped, failed } ; 409 OUTSIDE_SENDING_HOURS.
  send: async (ctx) => {
    ctx.body = await strapi.service('api::espace.reminders').send(await organizerEdition(ctx), scenarioOf(ctx));
  },

  // GET and POST /api/espace/reminders/unsubscribe?token= (public, I-39): switches `reminders` off in one click and says so.
  // GET is the link of the e-mails (a page), POST the one-click request of the mail clients (List-Unsubscribe-Post).
  unsubscribe: async (ctx) => {
    const { token } = ctx.query;
    // strapi::logger writes ctx.url once the response is sent: without its query string, the token stays out of the log.
    ctx.url = ctx.path;
    const done = await strapi.service('api::espace.reminders').unsubscribe(token);

    if (ctx.method === 'POST') {
      ctx.status = done ? 200 : 400;
      ctx.body = done ? { status: 'unsubscribed' } : { error: { code: 'TOKEN_INVALID', message: 'Lien invalide.' } };
      return;
    }

    ctx.type = 'html';
    if (!done) {
      ctx.status = 400;
      ctx.body = page('Lien invalide', ['Ce lien de désabonnement n’est pas valable. Ouvrez « Gérer mes notifications » depuis un e-mail récent de l’espace participant.']);
      return;
    }
    const { edition } = done;
    ctx.set('Referrer-Policy', 'no-referrer');
    ctx.body = page(
      'Rappels désactivés',
      [
        `Vous ne recevrez plus les e-mails de rappel de l’édition ${edition.title}.`,
        'Les e-mails liés à vos rendez-vous et à vos messages restent actifs, et la veille des Journées vous recevez le récapitulatif de vos rendez-vous acceptés.',
      ],
      { label: 'Gérer mes notifications', url: `${strapi.config.get('server.espace').publicUrl.replace(/\/+$/, '')}/espace/${edition.slug}/profil` }
    );
  },
};
