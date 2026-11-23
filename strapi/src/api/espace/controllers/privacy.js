'use strict';

const { EspaceError } = require('../lib/errors');
const { requireOrganizer, requireSession } = require('../lib/guards');

const privacy = () => strapi.service('api::espace.privacy');

module.exports = {
  // POST /api/espace/me/erase (session) { confirm: true }: F-33, R-44. Anonymizes the person, closes the session and removes the cookie.
  erase: async (ctx) => {
    const session = requireSession(ctx);
    if (ctx.request.body?.confirm !== true) {
      throw new EspaceError(400, 'VALIDATION', 'Confirmez la suppression de vos données.', { fields: { confirm: 'Confirmation requise.' } });
    }
    ctx.body = await privacy().erase(session.attendee.documentId, { keepSessionDocumentId: session.session.documentId });
    await strapi.service('api::espace.auth').logout(ctx);
  },

  // GET /api/espace/me/export (session): NF-12, the JSON file of the person's data, as a download.
  export: async (ctx) => {
    const session = requireSession(ctx);
    ctx.set('Content-Disposition', `attachment; filename="mes-donnees-${session.edition.slug}.json"`);
    ctx.set('Cache-Control', 'private, no-store');
    ctx.body = await privacy().exportOf(session.attendee.documentId);
  },

  // POST /api/espace/admin/:edition/attendees/:id/erase (organizer): F-33, R-44. The sheet of the anonymized attendee. 409 SELF_FORBIDDEN.
  eraseAttendee: async (ctx) => {
    const session = requireOrganizer(ctx, ctx.params.edition);
    const edition = await strapi.service('api::espace.editions').findPublished(ctx.params.edition);
    if (!edition) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');
    const attendee = await strapi.documents('api::espace.attendee').findFirst({
      filters: { documentId: String(ctx.params.id), edition: { documentId: edition.documentId } },
    });
    if (!attendee) throw new EspaceError(404, 'ATTENDEE_NOT_FOUND', 'Inscrit introuvable.');
    if (attendee.documentId === session.attendee.documentId) {
      throw new EspaceError(409, 'SELF_FORBIDDEN', 'Pour supprimer vos propres données, utilisez « Supprimer mes données » dans votre profil.');
    }
    await privacy().erase(attendee.documentId);
    ctx.body = await strapi.service('api::espace.admin-attendees').show(edition, attendee.documentId);
  },
};
