'use strict';

module.exports = ({ strapi }) => ({
  /** Published edition by slug, private fields included (they are only hidden from the REST API), or null. */
  findPublished: (slug) =>
    strapi.documents('api::edition.edition').findFirst({ filters: { slug }, status: 'published', populate: ['lieux'] }),
});
