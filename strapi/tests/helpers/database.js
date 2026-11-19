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

const databaseExists = async (client, name) =>
  (await client.query('select 1 from pg_database where datname = $1', [name])).rowCount > 0;

/**
 * Crée la base si elle manque. Deux exécutions qui la créent en même temps (le test passe de « absente » à
 * « existe » entre la lecture et la création) ne s'opposent pas : Postgres refuse la seconde création (42P04 ou
 * 23505 selon l'instant), et le perdant n'a qu'à constater que la base existe désormais.
 */
async function ensureDatabase(name) {
  assertTestDatabase(name);
  await withClient('postgres', async (client) => {
    if (await databaseExists(client, name)) return;
    try {
      await client.query(`create database "${name}"`);
    } catch (error) {
      if (!(await databaseExists(client, name))) throw error;
    }
  });
}

/** Supprime une base de test, connexions comprises. Sert aux tests qui créent une base à eux ; le nom est contrôlé. */
async function dropDatabase(name) {
  assertTestDatabase(name);
  await withClient('postgres', (client) => client.query(`drop database if exists "${name}" with (force)`));
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

module.exports = { dropDatabase, ensureDatabase, resetDatabase, queryDatabase };
