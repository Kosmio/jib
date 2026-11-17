'use strict';

const { EspaceError } = require('../lib/errors');

/**
 * Meetings in the dashboard of the organizer (E9, F-139 to F-141, R-90): resolves the published edition named in the URL, then hands over to
 * the meetings service, which holds the lock of the edition and the rules. Every identifier is a documentId.
 */
module.exports = ({ strapi }) => {
  const meetings = () => strapi.service('api::espace.meetings');

  async function editionOf(slug) {
    const edition = await strapi.service('api::espace.editions').findPublished(slug);
    if (!edition) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');
    return edition.documentId;
  }

  return {
    async list(slug) {
      return meetings().adminList(await editionOf(slug));
    },
    async cancel(slug, meetingId, body) {
      return meetings().adminCancel(await editionOf(slug), meetingId, body);
    },
    async move(slug, meetingId, body) {
      return meetings().adminMove(await editionOf(slug), meetingId, body);
    },
    async setBlocks(slug, slotId, body) {
      return meetings().adminSetBlocks(await editionOf(slug), slotId, body);
    },
  };
};
