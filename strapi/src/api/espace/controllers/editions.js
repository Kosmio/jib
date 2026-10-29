'use strict';

const { EspaceError } = require('../lib/errors');

module.exports = {
  // GET /api/espace/editions/:slug (public): what the pages need to display an edition, and nothing private.
  show: async (ctx) => {
    const edition = await strapi.service('api::espace.editions').findPublished(ctx.params.slug);
    if (!edition) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');

    const [venue] = edition.lieux ?? [];
    ctx.body = {
      slug: edition.slug,
      title: edition.title,
      date: edition.date,
      city: edition.city,
      venue: venue ? { name: venue.name, address: venue.address } : null,
      themeColor: edition.hero_bg_color ?? null,
      participantSpaceEnabled: Boolean(edition.participantSpaceEnabled),
      meetingRequestsOpenAt: edition.meetingRequestsOpenAt ?? null,
      meetingRequestsCloseAt: edition.meetingRequestsCloseAt ?? null,
    };
  },
};
