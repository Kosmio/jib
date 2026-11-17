'use strict';

/**
 * Administration Strapi lisible (V2-C) :
 *   - critère 1 (NF-68, NF-69) : la configuration du gestionnaire de contenu lue par l'API d'admin porte les libellés, aides,
 *     champs principaux et colonnes de liste attendus, sur une base vide comme après un second démarrage ;
 *   - critère 3 (R-86) : « 10.45 » sur une pause b2b_break est refusé à l'enregistrement (Document Service et API d'admin),
 *     accepté sur une séquence d'un autre type.
 * (Le critère 2, les quatre écritures d'heure, est dans tests/unit/time.test.js.) Données fictives (@example.org).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startEspace } = require('../helpers/espace');
const { UID, createEdition, link } = require('../helpers/espace-data');

const EMAIL = 'admin.libelles@example.org';
const PASSWORD = 'Libelles-Fictif-2026!';

/** Super-admin créé s'il manque, connecté par /admin/login : renvoie un client HTTP de l'API d'admin. */
async function adminClient({ app, baseUrl }) {
  if (!(await app.db.query('admin::user').findOne({ where: { email: EMAIL } }))) {
    const role = await app.db.query('admin::role').findOne({ where: { code: 'strapi-super-admin' } });
    await app.service('admin::user').create({ email: EMAIL, firstname: 'Admin', lastname: 'Fictif', password: PASSWORD, isActive: true, roles: [role.id] });
  }
  const login = await fetch(`${baseUrl}/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const loginText = await login.text();
  assert.equal(login.status, 200, loginText);
  const jwt = JSON.parse(loginText).data.token;
  return async (path, { method = 'GET', json } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${jwt}`, ...(json ? { 'content-type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : undefined,
    });
    return { status: response.status, json: await response.json().catch(() => undefined) };
  };
}

const configurationOf = async (admin, uid) => {
  const { status, json } = await admin(`/content-manager/content-types/${uid}/configuration`);
  assert.equal(status, 200, JSON.stringify(json));
  return json.data.contentType;
};

/** Les assertions du critère 1, rejouées sur chaque démarrage. */
function describeConfiguration(title, getAdmin) {
  describe(title, () => {
    const edit = (config, field) => config.metadatas[field]?.edit ?? {};

    it('édition : libellés et aides des réglages de l’espace', async () => {
      const config = await configurationOf(getAdmin(), UID.edition);
      assert.equal(edit(config, 'participantSpaceEnabled').label, 'Espace participant ouvert');
      assert.match(edit(config, 'participantSpaceEnabled').description, /Publier pour appliquer/);
      assert.equal(edit(config, 'helloassoOrgSlug').label, 'Identifiant HelloAsso de l’association');
      assert.equal(edit(config, 'slotDurationMinutes').label, 'Durée d’un créneau de rendez-vous (minutes)');
      assert.equal(edit(config, 'tablesCount').label, 'Nombre de tables');
      assert.match(edit(config, 'helloassoFieldMap').description, /ne pas modifier/);
    });

    it('édition : les réglages de l’espace sont regroupés en fin de formulaire, dans l’ordre prévu', async () => {
      const config = await configurationOf(getAdmin(), UID.edition);
      const names = config.layouts.edit.flat().map(({ name }) => name);
      const tail = ['participantSpaceEnabled', 'helloassoOrgSlug', 'helloassoFormType', 'helloassoFormSlug', 'helloassoFieldMap', 'slotDurationMinutes', 'tablesCount', 'meetingRequestsOpenAt', 'meetingRequestsCloseAt'];
      const present = tail.filter((name) => names.includes(name));
      assert.deepEqual(present, tail, 'tous les réglages sont dans le formulaire');
      const positions = tail.map((name) => names.indexOf(name));
      assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'ordre prévu');
      assert.equal(names.length, new Set(names).size, 'aucun champ en double');
    });

    it('séquence : libellés et aides de la nature et des heures (exemple 10h45)', async () => {
      const config = await configurationOf(getAdmin(), UID.sequence);
      assert.equal(edit(config, 'kind').label, 'Nature de la séquence');
      assert.match(edit(config, 'kind').description, /Pause rendez-vous B2B/);
      assert.equal(edit(config, 'start_time').label, 'Heure de début');
      assert.match(edit(config, 'start_time').description, /10h45/);
      assert.equal(edit(config, 'end_time').label, 'Heure de fin');
    });

    it('participant : champ principal, tri, colonnes et libellés (NF-69)', async () => {
      const config = await configurationOf(getAdmin(), UID.attendee);
      assert.equal(config.settings.mainField, 'lastName');
      assert.equal(config.settings.defaultSortBy, 'lastName');
      assert.equal(config.settings.defaultSortOrder, 'ASC');
      assert.deepEqual(config.layouts.list, ['lastName', 'firstName', 'company', 'email', 'role', 'status']);
      assert.equal(edit(config, 'lastName').label, 'Nom');
      assert.equal(config.metadatas.lastName.list.label, 'Nom');
      assert.equal(edit(config, 'company').label, 'Entreprise');
    });

    it('exposant : champ principal et colonnes', async () => {
      const config = await configurationOf(getAdmin(), UID.exhibitor);
      assert.equal(config.settings.mainField, 'standNumber');
      assert.deepEqual(config.layouts.list, ['organisation', 'standNumber']);
      assert.equal(edit(config, 'standNumber').label, 'Stand');
    });

    it('rendez-vous : champ principal, tri par création décroissant, colonnes', async () => {
      const config = await configurationOf(getAdmin(), UID.meeting);
      assert.equal(config.settings.mainField, 'status');
      assert.equal(config.settings.defaultSortBy, 'createdAt');
      assert.equal(config.settings.defaultSortOrder, 'DESC');
      assert.deepEqual(config.layouts.list, ['status', 'slot', 'requester', 'targetAttendee', 'tableNumber']);
      assert.equal(edit(config, 'targetAttendee').label, 'Participant sollicité');
    });

    it('créneau : champ principal, tri par début croissant, colonnes', async () => {
      const config = await configurationOf(getAdmin(), UID.slot);
      assert.equal(config.settings.mainField, 'label');
      assert.equal(config.settings.defaultSortBy, 'startsAt');
      assert.equal(config.settings.defaultSortOrder, 'ASC');
      assert.deepEqual(config.layouts.list, ['label', 'startsAt', 'endsAt']);
    });

    it('journal d’e-mails : champ principal, tri par envoi décroissant, colonnes de base', async () => {
      const config = await configurationOf(getAdmin(), UID.emailLog);
      assert.equal(config.settings.mainField, 'template');
      assert.equal(config.settings.defaultSortBy, 'sentAt');
      assert.equal(config.settings.defaultSortOrder, 'DESC');
      for (const column of ['template', 'status', 'sentAt']) assert.ok(config.layouts.list.includes(column), column);
      assert.equal(edit(config, 'template').label, 'Gabarit');
    });
  });
}

describe('administration lisible : configuration du gestionnaire de contenu (V2-C, NF-68, NF-69)', { timeout: 300_000 }, () => {
  let espace;
  let admin;
  let afterFirst;
  let configurationRows;

  before(async () => {
    // Premier démarrage : base vide, Strapi crée lui-même les configurations.
    espace = await startEspace();
    admin = await adminClient(espace);
  });
  after(async () => {
    await espace?.stop();
  });

  describeConfiguration('sur une base vide (premier démarrage)', () => admin);

  describe('après un second démarrage sur la même base', () => {
    before(async () => {
      const key = (uid) => `plugin_content_manager_configuration_content_types::${uid}`;
      const read = async () => (await espace.app.db.query('strapi::core-store').findMany({ where: { key: { $startsWith: 'plugin_content_manager_configuration_content_types::api::' } } }))
        .map(({ key: k, value }) => [k, typeof value === 'string' ? value : JSON.stringify(value)]).sort();
      configurationRows = await read();
      assert.ok(configurationRows.some(([k]) => k === key(UID.attendee)));
      await espace.stop();
      espace = await startEspace({ reset: false });
      afterFirst = await read();
      admin = await adminClient(espace);
    });

    it('est idempotent : le second démarrage ne change aucune configuration stockée', () => {
      assert.deepEqual(afterFirst, configurationRows);
    });

    describeConfiguration('relue par l’API d’admin après le second démarrage', () => admin);
  });
});

describe('R-86 : heure illisible sur une pause B2B (V2-C)', { timeout: 300_000 }, () => {
  let espace;
  let admin;
  let edition;
  let counter = 0;

  before(async () => {
    espace = await startEspace();
    admin = await adminClient(espace);
    edition = await createEdition(espace.app, { slug: 'libelles-r86', title: 'Libellés R-86' });
  });
  after(async () => {
    await espace?.stop();
  });

  const create = (fields) => {
    counter += 1;
    return espace.app.documents(UID.sequence).create({ data: { title: `Séquence ${counter}`, order: counter, edition: link(edition), end_time: '11h15', ...fields } });
  };
  const sequencesCount = (kind) => espace.app.db.query(UID.sequence).count({ where: { kind, start_time: '10.45' } });

  describe('Document Service', () => {
    it('refuse « 10.45 » sur une pause b2b_break, message français avec l’exemple 10h45, rien d’enregistré', async () => {
      await assert.rejects(create({ kind: 'b2b_break', start_time: '10.45' }), /Pause de rendez-vous B2B.*heure de début.*10h45/s);
      assert.equal(await sequencesCount('b2b_break'), 0);
    });

    it('refuse une heure de fin illisible', async () => {
      await assert.rejects(create({ kind: 'b2b_break', start_time: '10h45', end_time: '11.15' }), /heure de fin/);
    });

    it('accepte « 10.45 » sur une séquence talk ou other', async () => {
      for (const kind of ['talk', 'other']) {
        const created = await create({ kind, start_time: '10.45' });
        assert.equal(created.start_time, '10.45');
      }
    });

    it('accepte 10h45, 10:45, 10 h 45 et 10H45 sur une pause b2b_break', async () => {
      for (const start_time of ['10h45', '10:45', '10 h 45', '10H45']) {
        assert.equal((await create({ kind: 'b2b_break', start_time })).start_time, start_time);
      }
    });

    it('refuse la mise à jour d’une pause vers « 10.45 », y compris quand la nature n’est pas renvoyée', async () => {
      const pause = await create({ kind: 'b2b_break', start_time: '10h45' });
      await assert.rejects(espace.app.documents(UID.sequence).update({ documentId: pause.documentId, data: { start_time: '10.45' } }), /Pause de rendez-vous B2B/);
      const stored = await espace.app.db.query(UID.sequence).findOne({ where: { documentId: pause.documentId, publishedAt: null } });
      assert.equal(stored.start_time, '10h45');
    });

    it('refuse de passer une séquence « 10.45 » en pause b2b_break', async () => {
      const talk = await create({ kind: 'talk', start_time: '10.45' });
      await assert.rejects(espace.app.documents(UID.sequence).update({ documentId: talk.documentId, data: { kind: 'b2b_break' } }), /Pause de rendez-vous B2B/);
    });

    it('accepte la mise à jour d’une séquence talk vers « 10.45 »', async () => {
      const talk = await create({ kind: 'talk', start_time: '10h45' });
      const updated = await espace.app.documents(UID.sequence).update({ documentId: talk.documentId, data: { start_time: '10.45' } });
      assert.equal(updated.start_time, '10.45');
    });
  });

  describe('API d’administration (content-manager)', () => {
    const post = (fields) => {
      counter += 1;
      return admin(`/content-manager/collection-types/${UID.sequence}`, { method: 'POST', json: { title: `Admin ${counter}`, order: counter, end_time: '11h15', ...fields } });
    };

    it('refuse « 10.45 » sur une pause b2b_break, en 400, avec le message français', async () => {
      const { status, json } = await post({ kind: 'b2b_break', start_time: '10.45' });
      assert.equal(status, 400, JSON.stringify(json));
      assert.match(JSON.stringify(json), /Pause de rendez-vous B2B/);
      assert.match(JSON.stringify(json), /10h45/);
    });

    it('accepte « 10.45 » sur une séquence talk', async () => {
      const { status, json } = await post({ kind: 'talk', start_time: '10.45' });
      assert.equal(status, 201, JSON.stringify(json));
    });

    it('accepte « 10:45 » sur une pause b2b_break', async () => {
      const { status, json } = await post({ kind: 'b2b_break', start_time: '10:45' });
      assert.equal(status, 201, JSON.stringify(json));
    });

    it('refuse la mise à jour d’une pause vers « 10.45 »', async () => {
      const created = await post({ kind: 'b2b_break', start_time: '10h45' });
      assert.equal(created.status, 201, JSON.stringify(created.json));
      const { status, json } = await admin(`/content-manager/collection-types/${UID.sequence}/${created.json.data.documentId}`, { method: 'PUT', json: { start_time: '10.45' } });
      assert.equal(status, 400, JSON.stringify(json));
      assert.match(JSON.stringify(json), /Pause de rendez-vous B2B/);
    });
  });
});
