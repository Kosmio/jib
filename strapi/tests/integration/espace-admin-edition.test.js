'use strict';

/**
 * Écran « Édition » de l'interface organisation, lot AD-1 (docs/espace/specs/15-administration.md) : F-155 à F-159, F-177 à F-180,
 * R-92, R-93, NF-71, NF-75, T-76, T-77, T-79, T-86.
 *
 * Routes (organisateur de l'édition, 403 sinon), sous /api/espace/admin/:edition :
 *   GET /settings   PATCH /settings   POST /helloasso/test   PATCH /sequences/:id/break
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const defaultItems = require('../../scripts/espace/fixtures/helloasso-items.json');
const { useEspace } = require('../helpers/espace');
const { UID, createAttendee, createEdition, createProgram, link } = require('../helpers/espace-data');

describe('écran « Édition » de l’interface organisation (AD-1)', { timeout: 600_000 }, () => {
  const espace = useEspace({ fake: true });
  let counter = 0;

  const newEdition = (options = {}) => {
    counter += 1;
    return createEdition(espace().app, { slug: `reglages-${counter}`, title: `Réglages ${counter}`, ...options });
  };
  async function person(edition, fields = {}) {
    const attendee = await createAttendee(espace().app, edition, { consentAt: new Date().toISOString(), ...fields });
    return { attendee, ...(await espace().signIn(edition.slug, attendee.email)) };
  }
  const organizerOf = (edition) => person(edition, { role: 'organizer' });
  const send = (edition, method, path, cookie, json) =>
    espace().request(`/api/espace/admin/${edition.slug}${path}`, { method, cookie, ...(json !== undefined && { json }) });

  it('T-86 : chaque route répond 403 à un participant et à l’organisateur d’une autre édition, 401 sans session', async () => {
    const edition = await newEdition();
    const other = await newEdition();
    const [sequence] = await createProgram(espace().app, edition);
    const participant = await person(edition);
    const stranger = await organizerOf(other);
    const routes = [
      ['GET', '/settings'],
      ['PATCH', '/settings', { title: 'Intrus' }],
      ['POST', '/helloasso/test', {}],
      ['PATCH', `/sequences/${sequence.documentId}/break`, { isBreak: true }],
    ];
    for (const [method, path, json] of routes) {
      assert.equal((await send(edition, method, path, participant.cookie, json)).status, 403, `${method} ${path} participant`);
      assert.equal((await send(edition, method, path, stranger.cookie, json)).status, 403, `${method} ${path} autre édition`);
      assert.equal((await send(edition, method, path, undefined, json)).status, 401, `${method} ${path} sans session`);
    }
  });

  it('T-77 : les identifiants HelloAsso sont dits présents, jamais renvoyés', async () => {
    const edition = await newEdition();
    const organizer = await organizerOf(edition);
    const read = await send(edition, 'GET', '/settings', organizer.cookie);
    assert.equal(read.status, 200);
    assert.equal(read.json.helloasso.credentials, true);
    const { HELLOASSO_CLIENT_ID: id, HELLOASSO_CLIENT_SECRET: secret } = espace().env;
    assert.ok(!read.text.includes(secret) && !read.text.includes(id), 'aucun identifiant dans la réponse');
  });

  it('T-76 : l’essai de connexion montre le formulaire, ses billets et ses champs, et n’importe personne', async () => {
    espace().fake.setItems(defaultItems);
    const edition = await newEdition({ settings: { helloassoOrgSlug: null, helloassoFormSlug: null } });
    const organizer = await organizerOf(edition);
    const before = await espace().app.documents(UID.attendee).count({ filters: { edition: link(edition) } });
    const tested = await send(edition, 'POST', '/helloasso/test', organizer.cookie, { orgSlug: 'xylofutur-test', formType: 'Event', formSlug: 'jib-nouvelle-aquitaine-test' });
    assert.equal(tested.status, 200, tested.text);
    assert.ok(tested.json.title);
    assert.ok(tested.json.totalCount > 0);
    assert.ok(tested.json.fieldNames.includes('Organisation') && tested.json.fieldNames.includes('Poste'));
    assert.deepEqual({ company: tested.json.suggestedFieldMap.company, jobTitle: tested.json.suggestedFieldMap.jobTitle }, { company: 'Organisation', jobTitle: 'Poste' });
    assert.equal(await espace().app.documents(UID.attendee).count({ filters: { edition: link(edition) } }), before);

    const missing = await send(edition, 'POST', '/helloasso/test', organizer.cookie, { orgSlug: 'xylofutur-test', formType: 'Event', formSlug: 'formulaire-inconnu' });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, 'HELLOASSO_FORM_NOT_FOUND');
  });

  it('enregistre les réglages, publie l’édition et refuse une version périmée (NF-75)', async () => {
    const edition = await newEdition();
    const organizer = await organizerOf(edition);
    const { json: first } = await send(edition, 'GET', '/settings', organizer.cookie);
    const saved = await send(edition, 'PATCH', '/settings', organizer.cookie, { updatedAt: first.updatedAt, city: 'Pessac', tablesCount: 8, b2bEnabled: false });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.json.general.city, 'Pessac');
    assert.equal(saved.json.space.tablesCount, 8);
    assert.equal(saved.json.space.b2bEnabled, false);
    const published = await espace().app.documents(UID.edition).findOne({ documentId: edition.documentId, status: 'published' });
    assert.equal(published.city, 'Pessac');

    const stale = await send(edition, 'PATCH', '/settings', organizer.cookie, { updatedAt: first.updatedAt, city: 'Talence' });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.error.code, 'STALE');

    const invalid = await send(edition, 'PATCH', '/settings', organizer.cookie, { tablesCount: 0, title: '' });
    assert.equal(invalid.status, 400);
    assert.deepEqual(Object.keys(invalid.json.error.fields).sort(), ['tablesCount', 'title']);
  });

  it('R-92 : changer de formulaire alors que des inscrits existent demande une confirmation', async () => {
    const edition = await newEdition();
    const organizer = await organizerOf(edition);
    const asked = await send(edition, 'PATCH', '/settings', organizer.cookie, { helloassoFormSlug: 'autre-formulaire' });
    assert.equal(asked.status, 409);
    assert.equal(asked.json.error.code, 'FORM_CHANGE_CONFIRM');
    const confirmed = await send(edition, 'PATCH', '/settings', organizer.cookie, { helloassoFormSlug: 'autre-formulaire', confirmFormChange: true });
    assert.equal(confirmed.status, 200, confirmed.text);
    assert.equal(confirmed.json.helloasso.formSlug, 'autre-formulaire');
  });

  it('F-180, T-79 : une séquence devient pause B2B, et une pause qui porte un rendez-vous accepté le reste', async () => {
    const { app } = espace();
    const edition = await newEdition();
    const sequences = await createProgram(app, edition);
    const organizer = await organizerOf(edition);
    const talk = sequences.find((sequence) => sequence.kind !== 'b2b_break' && sequence.end_time);
    const turned = await send(edition, 'PATCH', `/sequences/${talk.documentId}/break`, organizer.cookie, { isBreak: true });
    assert.equal(turned.status, 200, turned.text);
    assert.equal(turned.json.sequences.find((sequence) => sequence.id === talk.documentId).kind, 'b2b_break');

    const regenerated = await send(edition, 'POST', '/slots/regenerate', organizer.cookie);
    assert.equal(regenerated.status, 200, regenerated.text);
    const [slot] = await app.documents(UID.slot).findMany({ filters: { edition: link(edition), session: { documentId: talk.documentId } }, limit: 1 });
    assert.ok(slot, 'un créneau dans la nouvelle pause');
    const a = await createAttendee(app, edition, { meetingsOptIn: true });
    const b = await createAttendee(app, edition, { meetingsOptIn: true });
    await app.documents(UID.meeting).create({ data: { edition: link(edition), slot: link(slot), requester: link(a), targetAttendee: link(b), status: 'accepted', tableNumber: 1 } });

    const refused = await send(edition, 'PATCH', `/sequences/${talk.documentId}/break`, organizer.cookie, { isBreak: false });
    assert.equal(refused.status, 409);
    assert.equal(refused.json.error.code, 'BREAK_HAS_MEETINGS');
    assert.match(refused.json.error.message, /1 rendez-vous/);
  });
});
