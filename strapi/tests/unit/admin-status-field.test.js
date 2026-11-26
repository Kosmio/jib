'use strict';

/**
 * src/middlewares/admin-status-field.js : dans l'admin Strapi, le Content Manager lit `status` du corps comme le statut
 * brouillon / publié : il l'effaçait à la lecture (champ « Statut » vide et obligatoire) et refusait toute fiche Participant à
 * l'enregistrement (« Invalid status »). Le middleware remet la valeur stockée dans les réponses et retire l'attribut du corps ;
 * un changement de statut tenté depuis l'admin est refusé (il passe par le tableau de bord organisateur).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const factory = require('../../src/middlewares/admin-status-field');

const ATTENDEE = 'api::espace.attendee';
const stored = { 'doc-active': 'active', 'doc-cancelled': 'cancelled' };

const fakeStrapi = () => ({
  contentTypes: {
    [ATTENDEE]: { attributes: { status: { type: 'enumeration', enum: ['active', 'cancelled'], default: 'active' } } },
    'api::espace.edition-like': { attributes: { title: { type: 'string' } } },
  },
  documents: (uid) => ({
    findOne: async ({ documentId }) => (uid === ATTENDEE && stored[documentId] ? { documentId, status: stored[documentId] } : null),
    findMany: async ({ filters }) =>
      filters.documentId.$in.filter((documentId) => stored[documentId]).map((documentId) => ({ documentId, status: stored[documentId] })),
  }),
});

async function run({ method, path, body, response }) {
  const ctx = { method, path, status: 200, request: { body } };
  let called = false;
  await factory({}, { strapi: fakeStrapi() })(ctx, async () => {
    called = true;
    ctx.body = response;
  });
  return { called, body: ctx.request.body, response: ctx.body };
}

describe('admin-status-field : fiches de l’espace enregistrées depuis l’admin Strapi', () => {
  it('retire un statut inchangé à la mise à jour, le reste du corps passe', async () => {
    const { called, body } = await run({
      method: 'PUT',
      path: `/content-manager/collection-types/${ATTENDEE}/doc-active`,
      body: { firstName: 'Carole', email: 'carole@example.org', status: 'active' },
    });
    assert.equal(called, true);
    assert.deepEqual(body, { firstName: 'Carole', email: 'carole@example.org' });
  });

  it('garde une inscription annulée annulée quand on modifie autre chose', async () => {
    const { called, body } = await run({ method: 'PUT', path: `/content-manager/collection-types/${ATTENDEE}/doc-cancelled`, body: { email: 'x@example.org', status: 'cancelled' } });
    assert.equal(called, true);
    assert.equal('status' in body, false);
  });

  it('refuse un changement de statut et renvoie au tableau de bord', async () => {
    await assert.rejects(
      run({ method: 'PUT', path: `/content-manager/collection-types/${ATTENDEE}/doc-active`, body: { status: 'cancelled' } }),
      (error) => error.name === 'ValidationError' && /tableau de bord organisateur/.test(error.message) && error.details.errors[0].path[0] === 'status'
    );
  });

  it('à la création, retire le statut par défaut et refuse un autre', async () => {
    const created = await run({ method: 'POST', path: `/content-manager/collection-types/${ATTENDEE}`, body: { email: 'a@example.org', status: 'active' } });
    assert.equal(created.called, true);
    assert.equal('status' in created.body, false);
    const cloned = await run({ method: 'POST', path: `/content-manager/collection-types/${ATTENDEE}/clone/doc-active`, body: { status: 'active' } });
    assert.equal('status' in cloned.body, false);
    await assert.rejects(run({ method: 'POST', path: `/content-manager/collection-types/${ATTENDEE}`, body: { status: 'cancelled' } }), { name: 'ValidationError' });
  });

  it('remet le statut stocké dans la fiche et dans la liste que lit l’admin', async () => {
    const read = await run({ method: 'GET', path: `/content-manager/collection-types/${ATTENDEE}/doc-cancelled`, response: { data: { documentId: 'doc-cancelled' }, meta: {} } });
    assert.equal(read.response.data.status, 'cancelled');
    const list = await run({
      method: 'GET',
      path: `/content-manager/collection-types/${ATTENDEE}`,
      response: { results: [{ documentId: 'doc-active', status: 'published' }, { documentId: 'doc-cancelled', status: 'published' }], pagination: {} },
    });
    assert.deepEqual(list.response.results.map((record) => record.status), ['active', 'cancelled']);
    const saved = await run({ method: 'PUT', path: `/content-manager/collection-types/${ATTENDEE}/doc-active`, body: { status: 'active' }, response: { data: { documentId: 'doc-active' } } });
    assert.equal(saved.response.data.status, 'active');
  });

  it('laisse passer le reste sans y toucher', async () => {
    for (const request of [
      { method: 'GET', path: `/content-manager/collection-types/${ATTENDEE}/doc-active`, body: { status: 'active' } },
      { method: 'POST', path: `/content-manager/collection-types/${ATTENDEE}/actions/bulkDelete`, body: { status: 'active' } },
      { method: 'PUT', path: '/content-manager/collection-types/api::espace.edition-like/doc', body: { status: 'active' } },
      { method: 'PUT', path: '/content-manager/collection-types/api::intervenant.intervenant/doc', body: { status: 'active' } },
      { method: 'PUT', path: `/content-manager/collection-types/${ATTENDEE}/doc-active`, body: { status: 'published' } },
      { method: 'PUT', path: '/api/espace/me', body: { status: 'active' } },
    ]) {
      const { called, body } = await run(request);
      assert.equal(called, true);
      assert.equal(body.status, request.body.status, `${request.method} ${request.path}`);
    }
  });
});
