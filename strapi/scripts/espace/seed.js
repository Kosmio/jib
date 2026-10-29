'use strict';

/**
 * Recette seed (A-13, 10-recette.md): starts Strapi without an HTTP server, wipes then recreates
 * the recette data, and stops. Two runs give the same state.
 *
 *   DATABASE_NAME=strapi_e2e corepack pnpm@12.15.0 --dir <repo>/strapi seed
 *
 * Refuses any database whose name does not end with _e2e or _test, and NODE_ENV=production.
 * The recette data are identified by the edition slug and by the "test-" slug prefix.
 * Phase 0 creates the existing content types only; fixtures/recette.json already holds the data
 * of the next phases (editionSettings, topics, exhibitors, attendees), ignored until their types exist.
 * Attendees will come from fixtures/helloasso-items.json through the import (I-11), then recette.json.
 */

const { compileStrapi, createStrapi } = require('@strapi/strapi');
const recette = require('./fixtures/recette.json');

const EDITION_SLUG = recette.edition.slug;
const PREFIX = 'test-';
const UID = {
  edition: 'api::edition.edition',
  sequence: 'api::sequence.sequence',
  intervention: 'api::intervention.intervention',
  intervenant: 'api::intervenant.intervenant',
  organisation: 'api::organisation.organisation',
};

function refuse(reason) {
  console.error(`Seed refusé : ${reason}`);
  console.error('Seules les bases dont le nom finit par _e2e ou _test sont admises. Exemple :');
  console.error('  DATABASE_NAME=strapi_e2e corepack pnpm@12.15.0 --dir <dépôt>/strapi seed');
  process.exit(1);
}

async function wipe(app) {
  const remove = async (uid, filters) => {
    const documents = await app.documents(uid).findMany({ filters, limit: 1000 });
    for (const { documentId } of documents) await app.documents(uid).delete({ documentId });
  };
  await remove(UID.intervention, { sequence: { edition: { slug: EDITION_SLUG } } });
  await remove(UID.sequence, { edition: { slug: EDITION_SLUG } });
  await remove(UID.edition, { slug: EDITION_SLUG });
  await remove(UID.intervenant, { slug: { $startsWith: PREFIX } });
  await remove(UID.organisation, { slug: { $startsWith: PREFIX } });
}

async function populate(app) {
  const create = (uid, data) => app.documents(uid).create({ data, status: 'published' });
  const link = ({ documentId }) => ({ documentId });

  const organisations = {};
  for (const organisation of recette.organisations) {
    organisations[organisation.slug] = await create(UID.organisation, organisation);
  }

  const edition = await create(UID.edition, recette.edition);

  // kind and topic are added to sequence by phase 1 (02-modele-donnees.md)
  const sequences = {};
  for (const [index, { kind, topic, ...fields }] of recette.sequences.entries()) {
    const sequence = await create(UID.sequence, { ...fields, order: index + 1, edition: link(edition) });
    sequences[fields.title] ??= sequence;
  }

  for (const { organisation, sequence, ...fields } of recette.intervenants) {
    const intervenant = await create(UID.intervenant, { ...fields, organisation: link(organisations[organisation]) });
    await create(UID.intervention, { sequence: link(sequences[sequence]), intervenants: [link(intervenant)], order: 0 });
  }
}

async function summarize(app, database) {
  const count = (uid, filters) => app.documents(uid).count({ filters });
  const breaks = recette.sequences.filter(({ kind }) => kind === 'b2b_break').length;
  console.log(`Seed de recette terminé sur la base ${database}.`);
  console.log(`  Édition        ${await count(UID.edition, { slug: EDITION_SLUG })} (${EDITION_SLUG})`);
  console.log(`  Séquences      ${await count(UID.sequence, { edition: { slug: EDITION_SLUG } })} (dont ${breaks} pauses B2B)`);
  console.log(`  Intervenants   ${await count(UID.intervenant, { slug: { $startsWith: PREFIX } })}`);
  console.log(`  Interventions  ${await count(UID.intervention, { sequence: { edition: { slug: EDITION_SLUG } } })}`);
  console.log(`  Organisations  ${await count(UID.organisation, { slug: { $startsWith: PREFIX } })}`);
}

async function main() {
  if (process.env.NODE_ENV === 'production') refuse('NODE_ENV vaut production.');

  // No demo editions, no media upload on an empty database.
  process.env.DEMO_SEED = 'false';

  const app = createStrapi(await compileStrapi());
  // Strapi has read strapi/.env without overriding the shell: check the effective database before any connection.
  const database = app.config.get('database.connection.connection.database');
  if (!/_(e2e|test)$/.test(database || '')) {
    refuse(`la base « ${database} » n’est pas une base de recette (DATABASE_NAME absent de l’environnement ou mal choisi).`);
  }

  app.log.level = 'error';
  await app.load();
  try {
    await wipe(app);
    await populate(app);
    await summarize(app, database);
  } finally {
    await app.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
