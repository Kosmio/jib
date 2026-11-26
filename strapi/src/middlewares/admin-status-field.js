'use strict';

// @strapi/utils is not a direct dependency (pnpm): resolved from @strapi/strapi, as in src/index.js.
const { errors } = require(require.resolve('@strapi/utils', { paths: [require.resolve('@strapi/strapi')] }));

// The content manager of Strapi 5 treats `status` as the draft & publish status of a document, whatever the content type:
//  - on reading, it overwrites the attribute (removed from a record, 'published' in a list) when draft & publish is off ;
//  - on create and update, it reads `status` in the body as 'draft' | 'published' and refuses anything else ("Invalid status").
// Several content types of the participant space have their own `status` enumeration (attendee: active | cancelled, meeting,
// e-mail log): their records came up in the Strapi admin with an empty, required "Statut" and none could be saved.
//
// This middleware, on the content manager routes of these types only:
//  - puts the stored value back into the responses, so the form and the list show the real status ;
//  - takes the attribute out of the body of a write before the content manager sees it, so the rest of the record saves.
// The status itself does not change from the Strapi admin: the organizer dashboard changes it, with the rules that go with it
// (cancelled attendee, cancelled meetings...). An attempt is refused with a message that says where to make it.
const PATH = /^\/content-manager\/collection-types\/(api::espace\.[a-z-]+)(?:\/(.+))?$/;
const PUBLICATION_STATUSES = ['draft', 'published'];

const refusal = (message) => new errors.ValidationError(message, { errors: [{ path: ['status'], message, name: 'ValidationError' }] });

/** The content manager request on a type with its own `status` enumeration: { uid, attribute, action, documentId }, or null. */
function route(ctx, strapi) {
  const match = PATH.exec(ctx.path);
  if (!match) return null;
  const [, uid, rest] = match;
  const attribute = strapi.contentTypes[uid]?.attributes?.status;
  if (attribute?.type !== 'enumeration') return null;
  const single = rest && !rest.includes('/') ? decodeURIComponent(rest) : null;
  if (ctx.method === 'GET' && !rest) return { uid, attribute, action: 'list' };
  if (ctx.method === 'GET' && single) return { uid, attribute, action: 'read', documentId: single };
  if (ctx.method === 'PUT' && single) return { uid, attribute, action: 'update', documentId: single };
  if (ctx.method === 'POST' && (!rest || /^clone\/[^/]+$/.test(rest))) return { uid, attribute, action: 'create' };
  return null;
}

/** Checks the `status` of a write against the stored one and takes it out of the body. */
async function guardWrite(ctx, strapi, { uid, attribute, action, documentId }) {
  const body = ctx.request.body;
  if (!body || typeof body !== 'object' || !Object.prototype.hasOwnProperty.call(body, 'status')) return;
  const wanted = body.status;
  if (PUBLICATION_STATUSES.includes(wanted)) return; // what the content manager itself sends: left to it

  if (action === 'update') {
    const current = await strapi.documents(uid).findOne({ documentId, fields: ['status'] });
    if (current && wanted != null && wanted !== current.status) {
      throw refusal('Le statut ne se modifie pas ici : annulez ou réactivez depuis le tableau de bord organisateur de l’espace participant.');
    }
  } else if (wanted != null && attribute.default !== undefined && wanted !== attribute.default) {
    throw refusal(`Une fiche se crée avec le statut « ${attribute.default} » : changez-le ensuite depuis le tableau de bord organisateur.`);
  }
  delete body.status;
}

/** Puts the stored `status` back into the records of the response ({ data } of a record, { results } of a list). */
async function restoreStatus(ctx, strapi, { uid }) {
  const body = ctx.body;
  if (!body || typeof body !== 'object' || ctx.status >= 400) return;
  const records = [body.data, ...(Array.isArray(body.results) ? body.results : [])].filter((record) => record && typeof record === 'object' && record.documentId);
  if (!records.length) return;
  const stored = await strapi.documents(uid).findMany({
    filters: { documentId: { $in: [...new Set(records.map((record) => record.documentId))] } },
    fields: ['status'],
    limit: records.length,
  });
  const statusOf = new Map(stored.map((record) => [record.documentId, record.status]));
  for (const record of records) if (statusOf.has(record.documentId)) record.status = statusOf.get(record.documentId);
}

module.exports = (config, { strapi }) => async (ctx, next) => {
  const request = route(ctx, strapi);
  if (!request) return next();
  if (request.action === 'update' || request.action === 'create') await guardWrite(ctx, strapi, request);
  await next();
  await restoreStatus(ctx, strapi, request);
};
