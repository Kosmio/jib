'use strict';

/**
 * Préparation des bases de test (A-13). Chaque fonction vérifie le nom de la base avant toute
 * connexion : seules les bases en _test ou _e2e sont créées ou vidées. La base de maintenance
 * `postgres` sert à créer une base manquante ; la base `strapi` n'est jamais ouverte.
 */

const { Client } = require('pg');
const { DB_SERVER, assertTestDatabase } = require('./env');

async function withClient(database, fn) {
  if (database !== 'postgres') assertTestDatabase(database);
  const client = new Client({ ...DB_SERVER, database });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Crée la base si elle manque. */
async function ensureDatabase(name) {
  assertTestDatabase(name);
  await withClient('postgres', async (client) => {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (!rowCount) await client.query(`create database ${name}`);
  });
}

/** Crée la base si elle manque, puis la vide entièrement (schéma public recréé). */
async function resetDatabase(name) {
  await ensureDatabase(name);
  await withClient(name, async (client) => {
    await client.query('drop schema public cascade');
    await client.query('create schema public');
  });
}

/** Exécute une requête en lecture sur une base de test. */
async function queryDatabase(name, sql, params = []) {
  assertTestDatabase(name);
  return withClient(name, (client) => client.query(sql, params));
}

module.exports = { ensureDatabase, resetDatabase, queryDatabase };
