'use strict';

/**
 * Transaction-level advisory locks (A-16). A session-level lock is not reliable behind the knex pool:
 * the unlock could leave on another connection. pg_advisory_xact_lock is released by the commit or the rollback.
 */
module.exports = ({ strapi }) => ({
  /** Runs fn in a transaction that holds the lock `key`; Document Service calls made by fn join the transaction. */
  withLock: (key, fn) =>
    strapi.db.transaction(async ({ trx }) => {
      await strapi.db.connection.raw('select pg_advisory_xact_lock(hashtext(?))', [key]).transacting(trx);
      return fn();
    }),
});
