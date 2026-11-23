'use strict';

/**
 * Rôle d'administration restreint « Organisation Xylofutur » (V5-G), créé à l'amorçage par src/admin-role.js.
 *   - critère 1 : deux démarrages sur la même base donnent un seul rôle et les mêmes permissions ; une permission
 *     interdite ajoutée à la main est retirée au démarrage suivant, une permission autorisée ajoutée à la main est conservée ;
 *   - critère 2 : un utilisateur de ce rôle reçoit 403 sur la suppression d'un participant (API du gestionnaire de
 *     contenu) et sur la création d'un jeton d'API ; il peut modifier une séquence et en publier une.
 *
 * Données fictives (@example.org).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { startEspace, useEspace } = require('../helpers/espace');
const { testDatabaseName } = require('../helpers/env');
const { UID, createAttendee, createEdition, link } = require('../helpers/espace-data');

const ROLE_CODE = 'xylofutur-organisation';
const PASSWORD = 'Role-Fictif-2026!';
const EXPLORER = 'plugin::content-manager.explorer.';

const signature = (permissions) =>
  permissions.map(({ action, subject }) => `${action}|${subject ?? ''}`).sort();

const rolePermissions = async (app) => {
  const role = await app.db.query('admin::role').findOne({ where: { code: ROLE_CODE } });
  assert.ok(role, 'rôle absent');
  const permissions = await app.service('admin::permission').findMany({ where: { role: { id: role.id } } });
  return { role, permissions };
};

const manual = (action, subject = null) => ({ action, subject, properties: {}, conditions: [] });

describe('rôle d’administration restreint (V5-G)', { timeout: 300_000 }, () => {
  describe('critère 1 : amorçage idempotent', () => {
    it('deux démarrages sur la même base : un seul rôle, mêmes permissions', async () => {
      const database = testDatabaseName();
      const first = await startEspace({ database });
      let before;
      try {
        before = await rolePermissions(first.app);
        assert.ok(before.permissions.length > 0, 'aucune permission posée');
      } finally {
        await first.stop();
      }

      const second = await startEspace({ database, reset: false });
      try {
        const after = await rolePermissions(second.app);
        const roles = await second.app.db.query('admin::role').findMany({ where: { code: ROLE_CODE } });
        assert.equal(roles.length, 1);
        assert.equal(after.role.id, before.role.id);
        assert.deepEqual(signature(after.permissions), signature(before.permissions));
      } finally {
        await second.stop();
      }
    });

    it('retire au démarrage suivant une permission interdite ajoutée à la main, conserve une permission autorisée ajoutée à la main', async () => {
      const database = testDatabaseName();
      const first = await startEspace({ database });
      const kept = manual(`${EXPLORER}read`, 'api::espace.message');
      const forbidden = [
        manual('admin::api-tokens.create'),
        manual('admin::users.delete'),
        manual(`${EXPLORER}delete`, 'api::espace.attendee'),
      ];
      try {
        const { role } = await rolePermissions(first.app);
        await first.app.service('admin::role').addPermissions(role.id, [kept, ...forbidden]);
        const { permissions } = await rolePermissions(first.app);
        const present = signature(permissions);
        for (const permission of [kept, ...forbidden]) assert.ok(present.includes(signature([permission])[0]), `ajout manuel absent : ${permission.action}`);
      } finally {
        await first.stop();
      }

      const second = await startEspace({ database, reset: false });
      try {
        const { permissions } = await rolePermissions(second.app);
        const present = signature(permissions);
        for (const permission of forbidden) assert.ok(!present.includes(signature([permission])[0]), `permission interdite conservée : ${permission.action}`);
        assert.ok(present.includes(signature([kept])[0]), 'permission autorisée ajoutée à la main retirée');
        assert.equal(permissions.filter((p) => p.action.startsWith('admin::')).length, 0, 'action admin:: présente');
      } finally {
        await second.stop();
      }
    });
  });

  describe('critère 2 : utilisateur du rôle', () => {
    const espace = useEspace();
    let jwt;

    async function login() {
      if (jwt) return jwt;
      const { app, baseUrl } = espace();
      const role = await app.db.query('admin::role').findOne({ where: { code: ROLE_CODE } });
      assert.ok(role, 'rôle absent');
      await app.service('admin::user').create({
        email: 'organisation.role@example.org', firstname: 'Organisation', lastname: 'Fictive', password: PASSWORD, isActive: true, roles: [role.id],
      });
      const response = await fetch(`${baseUrl}/admin/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'organisation.role@example.org', password: PASSWORD }),
      });
      const text = await response.text();
      assert.equal(response.status, 200, text);
      jwt = JSON.parse(text).data.token;
      return jwt;
    }

    async function call(method, path, body) {
      const token = await login();
      const response = await fetch(`${espace().baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      let json;
      try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
      return { status: response.status, json, text };
    }

    it('403 sur la suppression d’un participant par l’API du gestionnaire de contenu, participant intact', async () => {
      const { app } = espace();
      const edition = await createEdition(app, { slug: 'role-admin-1', title: 'Role admin 1' });
      const attendee = await createAttendee(app, edition);
      const result = await call('DELETE', `/content-manager/collection-types/${UID.attendee}/${attendee.documentId}`);
      assert.equal(result.status, 403, result.text);
      assert.ok(await app.documents(UID.attendee).findOne({ documentId: attendee.documentId }));
    });

    it('403 sur la création d’un jeton d’API', async () => {
      const result = await call('POST', '/admin/api-tokens', { name: 'Jeton fictif', description: '', type: 'full-access', lifespan: null });
      assert.equal(result.status, 403, result.text);
    });

    it('peut modifier une séquence', async () => {
      const { app } = espace();
      const edition = await createEdition(app, { slug: 'role-admin-2', title: 'Role admin 2' });
      const sequence = await app.documents(UID.sequence).create({
        data: { title: 'Séquence fictive', kind: 'talk', start_time: '09:00', order: 1, edition: link(edition) },
        status: 'published',
      });
      const result = await call('PUT', `/content-manager/collection-types/${UID.sequence}/${sequence.documentId}`, { title: 'Séquence modifiée' });
      assert.equal(result.status, 200, result.text);
      const draft = await app.documents(UID.sequence).findOne({ documentId: sequence.documentId, status: 'draft' });
      assert.equal(draft.title, 'Séquence modifiée');
    });

    it('peut publier une séquence', async () => {
      const { app } = espace();
      const edition = await createEdition(app, { slug: 'role-admin-3', title: 'Role admin 3' });
      const sequence = await app.documents(UID.sequence).create({
        data: { title: 'Séquence à publier', kind: 'talk', start_time: '09:00', order: 1, edition: link(edition) },
      });
      const result = await call('POST', `/content-manager/collection-types/${UID.sequence}/${sequence.documentId}/actions/publish`, {});
      assert.equal(result.status, 200, result.text);
      assert.ok(await app.documents(UID.sequence).findOne({ documentId: sequence.documentId, status: 'published' }));
    });
  });
});
