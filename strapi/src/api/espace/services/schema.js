'use strict';

module.exports = ({ strapi }) => ({
  /**
   * Called by the bootstrap. R-13 and A-07: two accepted meetings never share a table of a slot ({slotId}:{tableNumber}).
   * Strapi cannot declare this index, and Postgres allows several NULL values (meetings without a table).
   */
  async ensureIndexes() {
    await strapi.db.connection.raw('CREATE UNIQUE INDEX IF NOT EXISTS espace_meetings_table_key_uq ON espace_meetings (table_key)');
  },
});
