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

const page = (title, lines, link, form) => `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px 12px;background-color:#f5f0eb;font-family:'Source Sans 3','Segoe UI',Helvetica,Arial,sans-serif;color:#2a3a44">
<main style="max-width:560px;margin:0 auto;padding:32px 28px;background-color:#ffffff;border-radius:16px">
<h1 style="margin:0 0 16px;font-size:24px;color:#325062">${escapeHtml(title)}</h1>
${lines.map((line) => `<p style="margin:0 0 16px;font-size:17px;line-height:1.5">${escapeHtml(line)}</p>`).join('\n')}
${form ? `<form method="post" action="${escapeHtml(form.action)}" style="margin:0 0 16px"><button type="submit" style="min-height:44px;padding:12px 24px;border:0;border-radius:8px;background-color:#f0ab00;color:#3a2410;font-size:17px;font-weight:700;cursor:pointer">${escapeHtml(form.label)}</button></form>` : ''}
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

  // GET and POST /api/espace/reminders/unsubscribe?token= (public, I-39). GET only shows a confirmation page and changes nothing (link scanners
  // open links). POST switches `reminders` off: the form of that page (HTML answer) or the one-click request of a mail client
  // (List-Unsubscribe=One-Click, RFC 8058, 200).
  unsubscribe: async (ctx) => {
    const { token } = ctx.query;
    // strapi::logger writes ctx.url once the response is sent: without its query string, the token stays out of the log.
    ctx.url = ctx.path;
    const reminders = strapi.service('api::espace.reminders');
    const publicUrl = strapi.config.get('server.espace').publicUrl.replace(/\/+$/, '');

    if (ctx.method === 'POST' && ctx.request.body?.['List-Unsubscribe'] === 'One-Click') {
      const done = await reminders.unsubscribe(token);
      ctx.status = done ? 200 : 400;
      ctx.body = done ? { status: 'unsubscribed' } : { error: { code: 'TOKEN_INVALID', message: 'Lien invalide.' } };
      return;
    }

    ctx.type = 'html';
    ctx.set('Referrer-Policy', 'no-referrer');
    const done = await reminders.unsubscribe(token, { apply: ctx.method === 'POST' });
    if (!done) {
      ctx.status = 400;
      ctx.body = page('Lien invalide', ['Ce lien de désabonnement n’est pas valable. Ouvrez « Gérer mes notifications » depuis un e-mail récent de l’espace participant.']);
      return;
    }
    const { edition } = done;
    const manage = { label: 'Gérer mes notifications', url: `${publicUrl}/espace/${edition.slug}/profil` };
    ctx.body =
      ctx.method === 'POST'
        ? page(
            'Vous ne recevrez plus de rappels',
            [
              `Les e-mails de rappel de l’édition ${edition.title} sont désactivés.`,
              'Les e-mails liés à vos rendez-vous et à vos messages restent actifs, et la veille des Journées vous recevez le récapitulatif de vos rendez-vous acceptés.',
            ],
            manage
          )
        : page('Rappels de l’édition', [`Confirmez pour ne plus recevoir les e-mails de rappel de l’édition ${edition.title}.`], manage, {
            action: `?token=${encodeURIComponent(token)}`,
            label: 'Ne plus recevoir les rappels',
          });
  },
};
