'use strict';

/**
 * V5-G: rôle d'administration « Organisation Xylofutur », créé à l'amorçage de façon idempotente.
 * Gestionnaire de contenu (lecture, création, modification, publication) sur tous les types visibles ; suppression
 * interdite sur les types de l'espace et sur l'édition ; aucun accès aux jetons, aux utilisateurs et rôles, au
 * constructeur de types, aux webhooks ni aux réglages. Un rôle existant garde ses ajouts manuels : on retire seulement
 * ce qui est interdit et on ajoute ce qui manque de la base.
 */

const ROLE_CODE = 'xylofutur-organisation';
const ROLE_NAME = 'Organisation Xylofutur';
const ROLE_DESCRIPTION = 'Gère les contenus et l’espace participant. Pas de jetons d’API, de gestion des comptes, de constructeur de types ni de réglages.';

const EXPLORER = 'plugin::content-manager.explorer.';
const CONTENT_ACTIONS = ['read', 'create', 'update', 'delete', 'publish'].map((a) => EXPLORER + a);
const DELETE_ACTION = `${EXPLORER}delete`;
const FIELD_ACTIONS = new Set([`${EXPLORER}read`, `${EXPLORER}create`, `${EXPLORER}update`]);

// Médiathèque : mêmes droits que le rôle Éditeur de Strapi, sans les réglages de la médiathèque
const MEDIA_ACTIONS = [
  'plugin::upload.read',
  'plugin::upload.configure-view',
  'plugin::upload.assets.create',
  'plugin::upload.assets.update',
  'plugin::upload.assets.download',
  'plugin::upload.assets.copy-link',
];

// Tout ce qui commence par l'un de ces préfixes est retiré du rôle : jetons d'API et de transfert, utilisateurs, rôles,
// webhooks, réglages du projet (tous sous admin::), constructeur de types, comptes du site, langues, réglages de la médiathèque
const FORBIDDEN_PREFIXES = [
  'admin::',
  'plugin::content-type-builder.',
  'plugin::users-permissions.',
  'plugin::i18n.',
  'plugin::upload.settings.',
];

const noDeleteSubject = (subject) => typeof subject === 'string' && (subject.startsWith('api::espace.') || subject === 'api::edition.edition');

function isForbidden({ action, subject }) {
  if (FORBIDDEN_PREFIXES.some((prefix) => action.startsWith(prefix))) return true;
  // Mise en page du gestionnaire de contenu : un réglage commun à tous les comptes
  if (action.startsWith('plugin::content-manager.') && !action.startsWith(EXPLORER)) return true;
  return action === DELETE_ACTION && noDeleteSubject(subject);
}

const keyOf = ({ action, subject }) => `${action}|${subject ?? ''}`;

/** Permissions de base du rôle : droits de contenu sur les types visibles, plus la médiathèque. */
function basePermissions(strapi) {
  const { actionProvider } = strapi.service('admin::permission');
  const all = actionProvider.values();
  const known = new Set(all.map((a) => a.actionId));
  const actions = all.filter((a) => CONTENT_ACTIONS.includes(a.actionId));
  const hidden = Object.values(strapi.contentTypes)
    .filter((ct) => ct?.pluginOptions?.['content-manager']?.visible === false)
    .map((ct) => ct.uid);
  const restrictedSubjects = ['plugin::users-permissions.user', ...hidden];
  const content = strapi.service('admin::content-type').getPermissionsWithNestedFields(actions, { restrictedSubjects });
  const media = MEDIA_ACTIONS.filter((id) => known.has(id)).map((action) => ({ action, subject: null, properties: {}, conditions: [] }));
  return [...content, ...media].filter((permission) => !isForbidden(permission));
}

async function ensureOrganisationRole(strapi) {
  const roles = strapi.service('admin::role');
  const permissions = strapi.service('admin::permission');

  let role = await roles.findOne({ code: ROLE_CODE });
  if (!role) {
    role = await roles.create({ name: ROLE_NAME, code: ROLE_CODE, description: ROLE_DESCRIPTION });
    strapi.log.info(`Rôle d’administration « ${ROLE_NAME} » créé`);
  }

  const existing = await permissions.findMany({ where: { role: { id: role.id } } });

  const forbidden = existing.filter(isForbidden);
  if (forbidden.length) {
    await permissions.deleteByIds(forbidden.map((p) => p.id));
    strapi.log.info(`Rôle « ${ROLE_NAME} » : ${forbidden.length} permission(s) interdite(s) retirée(s)`);
  }

  const present = new Set(existing.filter((p) => !isForbidden(p)).map(keyOf));
  const missing = basePermissions(strapi).filter((p) => !present.has(keyOf(p)));
  if (missing.length) {
    await roles.addPermissions(role.id, missing);
    strapi.log.info(`Rôle « ${ROLE_NAME} » : ${missing.length} permission(s) de base ajoutée(s)`);
  }
}

module.exports = { ensureOrganisationRole, ROLE_CODE, ROLE_NAME, isForbidden };
