/**
 * Gardes pures du serveur MCP (sans réseau, sans Express) : extraction du jeton,
 * contrôle des types de contenu, confirmation des suppressions, masquage des jetons.
 * Exportées pour être testées seules.
 */

/** Préfixe des types de l'espace participant : jamais exposés par le MCP. */
export const ESPACE_UID_PREFIX = 'api::espace.';

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const FIELD_PATTERN = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;

/**
 * Jeton d'API : uniquement l'en-tête `Authorization: Bearer <jeton>`.
 * Aucun repli sur l'URL. Renvoie le jeton ou null.
 * @param {Record<string, string | string[] | undefined>} headers
 */
export function extractToken(headers) {
  const auth = headers?.authorization;
  if (typeof auth !== 'string') return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(auth);
  return match ? match[1] : null;
}

/**
 * Vrai si la requête porte un jeton dans l'URL (refusée par le serveur).
 * @param {Record<string, unknown> | undefined} query
 */
export function hasTokenInUrl(query) {
  if (!query) return false;
  return Object.keys(query).some((key) => /^(token|access_token|api_token|apikey|api_key)$/i.test(key));
}

/** Retire tout jeton d'un texte destiné aux journaux ou aux réponses d'erreur. */
export function redactSecrets(text) {
  return String(text ?? '')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[masqué]')
    .replace(/([?&](?:access_)?token=)[^&\s"']+/gi, '$1[masqué]');
}

/**
 * Valide le nom pluriel d'un type de contenu : forme sûre, jamais un type de l'espace,
 * et présent dans content-types.json (liste blanche). Renvoie le nom ou lève une erreur.
 * @param {string} contentType
 * @param {Record<string, unknown>} knownContentTypes contenu de content-types.json
 */
export function assertContentTypeAllowed(contentType, knownContentTypes) {
  const value = String(contentType ?? '').trim();
  if (value.toLowerCase().startsWith(ESPACE_UID_PREFIX)) {
    throw new Error(`Type refusé : les types de l'espace participant (${ESPACE_UID_PREFIX}*) ne sont pas accessibles par le MCP.`);
  }
  if (!NAME_PATTERN.test(value)) {
    throw new Error('Nom de type invalide : utilisez le nom pluriel de l\'API (ex. "organisations").');
  }
  if (!Object.prototype.hasOwnProperty.call(knownContentTypes, value)) {
    throw new Error(
      `Type inconnu ou non exposé : "${value}". Types disponibles : ${Object.keys(knownContentTypes).join(', ')}.`,
    );
  }
  return value;
}

/** Valide un documentId (aucun caractère de chemin ou de requête). */
export function assertDocumentId(documentId) {
  const value = String(documentId ?? '');
  if (!DOCUMENT_ID_PATTERN.test(value)) throw new Error('documentId invalide.');
  return value;
}

/** Valide un nom de champ de filtre. */
export function assertFieldName(field) {
  const value = String(field ?? '');
  if (!FIELD_PATTERN.test(value)) throw new Error('Nom de champ invalide.');
  return value;
}

/**
 * Une suppression exige `confirm === true` explicite. Lève sinon.
 * @param {unknown} confirm
 */
export function assertDeleteConfirmed(confirm) {
  if (confirm !== true) {
    throw new Error(
      'Suppression non confirmée : passez confirm=true après avoir demandé son accord à l\'utilisateur. La suppression est définitive.',
    );
  }
}

/**
 * Contrôle complet d'une suppression : type autorisé puis confirmation.
 * Renvoie { contentType, documentId }.
 */
export function checkDelete({ contentType, documentId, confirm }, knownContentTypes) {
  const type = assertContentTypeAllowed(contentType, knownContentTypes);
  const id = assertDocumentId(documentId);
  assertDeleteConfirmed(confirm);
  return { contentType: type, documentId: id };
}

/** Résumé des champs d'un type pour list_content_types (indique les champs privés). */
export function describeContentTypes(knownContentTypes) {
  return Object.entries(knownContentTypes).map(([pluralName, ct]) => ({
    pluralName,
    singularName: ct.singularName,
    displayName: ct.displayName,
    description: ct.description,
    draftAndPublish: ct.draftAndPublish,
    fields: Object.entries(ct.fields).map(([name, f]) => ({
      name,
      type: f.type,
      required: f.required || false,
      private: f.private || false,
      description: f.description,
    })),
  }));
}
