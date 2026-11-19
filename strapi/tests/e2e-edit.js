'use strict';

/**
 * Modification du programme de l'édition de recette pendant un test du navigateur (F-94, R-02).
 *
 * Le navigateur n'a aucune route pour changer une pause B2B (l'admin de Strapi n'est pas construit dans les tests e2e) : ce script
 * charge Strapi sans serveur HTTP, comme le seed, applique des opérations par le Document Service sur la base e2e, puis s'arrête.
 * Le Strapi du serveur e2e relit la base à chaque requête : le test voit les changements aussitôt.
 *
 *   node --require ./tests/helpers/no-network.js tests/e2e-edit.js '<JSON d'une opération ou d'une liste d'opérations>'
 *
 * Lancé depuis strapi/ avec l'environnement de `buildTestEnv` (web/tests/e2e/programme.ts s'en charge). Refuse toute base qui ne
 * finit pas par _e2e. Opérations (une séquence est désignée par son titre, et son heure de début si deux portent le même titre) :
 *
 *   { op: 'create-sequence', data }              nouvelle séquence publiée de l'édition de recette
 *   { op: 'update-sequence', match, data }       change la séquence publiée désignée par `match` ({ title, start_time? })
 *   { op: 'delete-sequences', titlePrefix }      supprime les séquences de l'édition dont le titre commence par `titlePrefix`
 *   { op: 'update-edition', data }               change l'édition publiée (par exemple { date: null })
 *   { op: 'reset' }                              remet le programme et la date comme le seed, supprime les séquences `F-94 …`,
 *                                                puis régénère les créneaux (même service que le bouton d'E9)
 */

const recette = require('../scripts/espace/fixtures/recette.json');
const { assertTestDatabase } = require('./helpers/env');

const SLUG = recette.edition.slug;
const SEQUENCE = 'api::sequence.sequence';
const EDITION = 'api::edition.edition';
const TEST_PREFIX = 'F-94';
const SETTLE_MS = 750;

async function publishedEdition(app) {
  const [edition] = await app.documents(EDITION).findMany({ filters: { slug: SLUG }, status: 'published', limit: 1 });
  if (!edition) throw new Error(`Édition « ${SLUG} » introuvable.`);
  return edition;
}

async function sequencesOf(app, filters = {}) {
  return app.documents(SEQUENCE).findMany({ filters: { edition: { slug: SLUG }, ...filters }, status: 'published', limit: 1000 });
}

async function sequenceMatching(app, { title, start_time }) {
  const found = await sequencesOf(app, { title, ...(start_time && { start_time }) });
  if (found.length !== 1) throw new Error(`${found.length} séquence(s) publiée(s) pour « ${title} »${start_time ? ` à ${start_time}` : ''}, une attendue.`);
  return found[0];
}

/** Change le brouillon puis le publie : la lecture publiée des créneaux voit le changement. */
async function change(app, uid, documentId, data) {
  await app.documents(uid).update({ documentId, data });
  await app.documents(uid).publish({ documentId });
}

async function reset(app) {
  const edition = await publishedEdition(app);
  for (const { documentId } of await sequencesOf(app, { title: { $startsWith: TEST_PREFIX } })) {
    await app.documents(SEQUENCE).delete({ documentId });
  }
  for (const { title, start_time, end_time, kind } of recette.sequences) {
    const sequence = await sequenceMatching(app, { title, start_time });
    if (sequence.end_time !== end_time || sequence.kind !== kind) await change(app, SEQUENCE, sequence.documentId, { end_time, kind });
  }
  if (edition.date !== recette.edition.date) await change(app, EDITION, edition.documentId, { date: recette.edition.date });
  await app.service('api::espace.slots').regenerate(edition.documentId);
}

async function apply(app, operation) {
  switch (operation.op) {
    case 'create-sequence': {
      const edition = await publishedEdition(app);
      await app.documents(SEQUENCE).create({ data: { ...operation.data, edition: { documentId: edition.documentId } }, status: 'published' });
      return;
    }
    case 'update-sequence': {
      const sequence = await sequenceMatching(app, operation.match);
      await change(app, SEQUENCE, sequence.documentId, operation.data);
      return;
    }
    case 'delete-sequences': {
      for (const { documentId } of await sequencesOf(app, { title: { $startsWith: operation.titlePrefix } })) {
        await app.documents(SEQUENCE).delete({ documentId });
      }
      return;
    }
    case 'update-edition': {
      const edition = await publishedEdition(app);
      await change(app, EDITION, edition.documentId, operation.data);
      return;
    }
    case 'reset':
      await reset(app);
      return;
    default:
      throw new Error(`Opération inconnue : ${JSON.stringify(operation.op)}`);
  }
}

async function main() {
  const operations = [JSON.parse(process.argv[2] ?? 'null')].flat();
  if (!operations.length || operations.some((operation) => !operation?.op)) throw new Error('Usage : e2e-edit.js \'<opération ou liste d’opérations en JSON>\'');

  const { compileStrapi, createStrapi } = require('@strapi/strapi');
  const app = createStrapi(await compileStrapi());
  // Strapi a lu l'environnement du processus : vérifier la base effective avant toute connexion.
  assertTestDatabase(app.config.get('database.connection.connection.database'));
  if (!app.config.get('database.connection.connection.database').endsWith('_e2e')) throw new Error('e2e-edit.js : seule une base en _e2e est admise.');

  app.log.level = 'error';
  await app.load();
  try {
    for (const operation of operations) await apply(app, operation);
  } finally {
    // Les événements entry.* sont émis sans être attendus : voir tests/helpers/strapi.js.
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
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
