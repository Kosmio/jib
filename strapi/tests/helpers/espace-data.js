'use strict';

/**
 * Données de test de l'espace (phase 1, lot 3), créées par le Document Service sur la base de test : éditions,
 * programme, Attendee. Toutes les personnes et adresses sont fictives (@example.org). Les modèles viennent des
 * schémas du lot 2 (02-modele-donnees.md) : tant qu'ils n'existent pas, ces fonctions échouent, et seuls des tests
 * `pending('lot …')` les appellent.
 */

const recette = require('../../scripts/espace/fixtures/recette.json');

const UID = {
  edition: 'api::edition.edition',
  sequence: 'api::sequence.sequence',
  intervenant: 'api::intervenant.intervenant',
  organisation: 'api::organisation.organisation',
  topic: 'api::espace.topic',
  slot: 'api::espace.slot',
  attendee: 'api::espace.attendee',
  exhibitor: 'api::espace.exhibitor',
  meeting: 'api::espace.meeting',
  magicToken: 'api::espace.magic-token',
  emailLog: 'api::espace.email-log',
  syncRun: 'api::espace.sync-run',
};

const link = ({ documentId }) => ({ documentId });

/**
 * Édition publiée et ouverte, réglée comme celle de la recette (créneaux de 15 min, 3 tables, fenêtre de rendez-vous
 * ouverte du 1er octobre au 2 décembre 2026, formulaire HelloAsso du faux). `settings` surcharge les réglages ;
 * `enabled: false` ferme l'espace (NF-52) ; `draft: true` laisse l'édition non publiée.
 */
async function createEdition(app, { slug = 'edition-essai', title = 'Édition d’essai', enabled = true, draft = false, settings = {} } = {}) {
  return app.documents(UID.edition).create({
    data: { ...recette.edition, slug, title, ...recette.editionSettings, participantSpaceEnabled: enabled, ...settings },
    status: draft ? 'draft' : 'published',
  });
}

/** Les 9 séquences du programme de recette, publiées, rattachées à l'édition ; renvoie un tableau dans l'ordre du programme. */
async function createProgram(app, edition, { sequences = recette.sequences } = {}) {
  const created = [];
  for (const [index, { topic, ...fields }] of sequences.entries()) {
    created.push(await app.documents(UID.sequence).create({ data: { ...fields, order: index + 1, edition: link(edition) }, status: 'published' }));
  }
  return created;
}

let attendeeCounter = 0;

/** Attendee actif de l'édition ; `fields` surcharge n'importe quel champ (rôle, statut, consentements, rattachements…). */
async function createAttendee(app, edition, fields = {}) {
  attendeeCounter += 1;
  const n = String(attendeeCounter).padStart(3, '0');
  return app.documents(UID.attendee).create({
    data: {
      helloassoItemId: `9${n}`,
      helloassoOrderId: `8${n}`,
      email: `participant.${n}@example.org`,
      firstName: 'Prénom',
      lastName: `Nom${n}`,
      company: 'Entreprise Fictive',
      jobTitle: 'Fonction',
      role: 'participant',
      status: 'active',
      directoryOptIn: false,
      meetingsOptIn: false,
      newsOptIn: false,
      ...fields,
      edition: link(edition),
    },
  });
}

const findAttendee = (app, edition, email) =>
  app.documents(UID.attendee).findFirst({ filters: { email, edition: { documentId: edition.documentId } } });

const countByEdition = (app, uid, edition) => app.documents(uid).count({ filters: { edition: { documentId: edition.documentId } } });

module.exports = { UID, countByEdition, createAttendee, createEdition, createProgram, findAttendee, link, recette };
