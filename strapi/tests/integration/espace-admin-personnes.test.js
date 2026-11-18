'use strict';

/**
 * Écran « Personnes » de l'interface organisation, lot AD-2 (docs/espace/specs/15-administration.md) : D-20, F-169 à F-173,
 * R-96, R-97, T-81, T-82, T-83, T-86.
 *
 * Routes (organisateur de l'édition, 403 sinon), sous /api/espace/admin/:edition :
 *   GET, POST /organisations   PATCH /organisations/:id   GET /intervenants   GET, PATCH /attendees/:id/roles
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const defaultItems = require('../../scripts/espace/fixtures/helloasso-items.json');
const { sleep, useEspace } = require('../helpers/espace');
const { UID, createAttendee, createEdition, createProgram, link } = require('../helpers/espace-data');

describe('écran « Personnes » de l’interface organisation (AD-2)', { timeout: 600_000 }, () => {
  const espace = useEspace({ fake: true });
  let counter = 0;

  const newEdition = (options = {}) => {
    counter += 1;
    return createEdition(espace().app, { slug: `personnes-${counter}`, title: `Personnes ${counter}`, ...options });
  };
  async function person(edition, fields = {}) {
    const attendee = await createAttendee(espace().app, edition, { consentAt: new Date().toISOString(), ...fields });
    return { attendee, ...(await espace().signIn(edition.slug, attendee.email)) };
  }
  const organizerOf = (edition) => person(edition, { role: 'organizer' });
  const send = (edition, method, path, cookie, json) =>
    espace().request(`/api/espace/admin/${edition.slug}${path}`, { method, cookie, ...(json !== undefined && { json }) });

  it('T-86 : chaque route répond 403 à un participant et à l’organisateur d’une autre édition', async () => {
    const edition = await newEdition();
    const other = await newEdition();
    const participant = await person(edition);
    const stranger = await organizerOf(other);
    const target = await createAttendee(espace().app, edition);
    const routes = [
      ['GET', '/organisations'],
      ['POST', '/organisations', { name: 'Intrus' }],
      ['PATCH', '/organisations/abc', { name: 'Intrus' }],
      ['GET', '/intervenants'],
      ['GET', `/attendees/${target.documentId}/roles`],
      ['PATCH', `/attendees/${target.documentId}/roles`, { organizer: true }],
    ];
    for (const [method, path, json] of routes) {
      assert.equal((await send(edition, method, path, participant.cookie, json)).status, 403, `${method} ${path} participant`);
      assert.equal((await send(edition, method, path, stranger.cookie, json)).status, 403, `${method} ${path} autre édition`);
    }
  });

  it('T-83 : une organisation proche est proposée avant toute création', async () => {
    const edition = await newEdition();
    const organizer = await organizerOf(edition);
    const first = await send(edition, 'POST', '/organisations', organizer.cookie, { name: 'Wood & Co', website: 'https://wood.example.org' });
    assert.equal(first.status, 201, first.text);
    const again = await send(edition, 'POST', '/organisations', organizer.cookie, { name: 'wood&co' });
    assert.equal(again.status, 409);
    assert.equal(again.json.error.code, 'SIMILAR_ORGANISATIONS');
    assert.deepEqual(again.json.error.candidates.map(({ name }) => name), ['Wood & Co']);
    const forced = await send(edition, 'POST', '/organisations', organizer.cookie, { name: 'wood&co', force: true });
    assert.equal(forced.status, 409, 'un nom identique ne se crée jamais deux fois');
    assert.equal((await send(edition, 'POST', '/organisations', organizer.cookie, { name: 'Wood and Co', force: true })).json.error.code, 'SIMILAR_ORGANISATIONS');
    const close = await send(edition, 'POST', '/organisations', organizer.cookie, { name: 'Woods & Co' });
    assert.equal(close.status, 409);
    assert.equal(close.json.error.exact, false);
    assert.equal((await send(edition, 'POST', '/organisations', organizer.cookie, { name: 'Woods & Co', force: true })).status, 201);
    const found = await send(edition, 'GET', '/organisations?q=wood', organizer.cookie);
    assert.equal(found.json.items.length, 2);
  });

  it('T-81 : une personne créée à la main devient intervenante et représentante d’exposant ; ses rendez-vous de stand lui arrivent', async () => {
    const { app } = espace();
    const edition = await newEdition();
    await createProgram(app, edition);
    await app.service('api::espace.slots').regenerate(edition.documentId);
    const organizer = await organizerOf(edition);
    const created = await send(edition, 'POST', '/attendees', organizer.cookie, { firstName: 'Camille', lastName: 'Essai', email: 'camille.essai@example.org', company: 'Atelier Fictif', jobTitle: 'Directrice' });
    assert.equal(created.status, 201, created.text);
    const id = created.json.id;
    const { json: organisation } = await send(edition, 'POST', '/organisations', organizer.cookie, { name: 'Atelier Fictif' });

    const roles = await send(edition, 'PATCH', `/attendees/${id}/roles`, organizer.cookie, { speaker: 'new', exhibitor: organisation.id, standNumber: '12' });
    assert.equal(roles.status, 200, roles.text);
    assert.equal(roles.json.role, 'speaker');
    assert.deepEqual({ speaker: roles.json.roles.speaker, exhibitor: roles.json.roles.exhibitor }, { speaker: true, exhibitor: true });
    assert.equal(roles.json.speaker.name, 'Camille Essai');
    assert.equal(roles.json.exhibitor.standNumber, '12');

    const listed = await send(edition, 'GET', '/organisations?exhibitors=true', organizer.cookie);
    assert.deepEqual(listed.json.items.map(({ name, exhibitor }) => [name, exhibitor.representatives.map((rep) => rep.name)]), [['Atelier Fictif', ['Camille Essai']]]);
    const found = await send(edition, 'GET', '/intervenants?q=camille', organizer.cookie);
    assert.equal(found.json[0].linkedTo.id, id);

    // Une demande au stand de l'exposant arrive à sa représentante.
    const visitor = await person(edition, { meetingsOptIn: true, directoryOptIn: true });
    const exhibitor = roles.json.exhibitor.id;
    const [slot] = await app.documents(UID.slot).findMany({ filters: { edition: link(edition) }, limit: 1 });
    const asked = await espace().request('/api/espace/meetings', { method: 'POST', cookie: visitor.cookie, json: { slotId: slot.documentId, target: `x:${exhibitor}`, message: 'Bonjour.' } });
    assert.ok([200, 201].includes(asked.status), asked.text);
    const meeting = await app.documents(UID.meeting).findFirst({ filters: { targetExhibitor: { documentId: exhibitor } } });
    assert.ok(meeting, 'la demande vise l’exposant');

    // R-97 : seule représentante d'un exposant qui a une demande en cours, elle garde le rôle.
    const refused = await send(edition, 'PATCH', `/attendees/${id}/roles`, organizer.cookie, { exhibitor: null });
    assert.equal(refused.status, 409);
    assert.equal(refused.json.error.code, 'ROLE_HAS_MEETINGS');
  });

  it('T-82 : un billet HelloAsso de la même adresse rejoint la personne créée à la main, sans toucher à ses rôles', async () => {
    const { app, fake } = espace();
    const [ticket] = defaultItems;
    const email = ticket.customFields.find((field) => field.name === 'Email')?.answer ?? ticket.payer.email;
    fake.setItems([ticket]);
    const edition = await newEdition();
    const organizer = await organizerOf(edition);
    const created = await send(edition, 'POST', '/attendees', organizer.cookie, { firstName: 'Nom', lastName: 'Corrigé', email, company: 'Société Fictive' });
    assert.equal(created.status, 201, created.text);
    await send(edition, 'PATCH', `/attendees/${created.json.id}/roles`, organizer.cookie, { speaker: 'new' });

    const run = await app.service('api::espace.sync').run(edition.documentId);
    await sleep(200);
    const same = await app.documents(UID.attendee).findMany({ filters: { edition: link(edition), email: { $eqi: email } }, populate: ['speaker'] });
    assert.equal(same.length, 1, 'une seule personne');
    assert.equal(same[0].helloassoItemId, String(ticket.id), 'le billet est rattaché');
    assert.equal(same[0].role, 'speaker');
    assert.ok(same[0].speaker, 'le lien intervenant reste');
    assert.equal(same[0].lastName, 'Corrigé');
    assert.ok(!run.errors.some((error) => error.code === 'DUPLICATE_EMAIL'), JSON.stringify(run.errors));
  });

  it('F-171 : les organisateurs de ORGANIZER_EMAILS restent organisateurs, et l’on ne retire pas son propre rôle', async () => {
    const edition = await newEdition();
    const organizer = await organizerOf(edition);
    const self = await send(edition, 'PATCH', `/attendees/${organizer.attendee.documentId}/roles`, organizer.cookie, { organizer: false });
    assert.equal(self.status, 409);
    assert.equal(self.json.error.code, 'SELF_FORBIDDEN');
    const target = await createAttendee(espace().app, edition);
    const promoted = await send(edition, 'PATCH', `/attendees/${target.documentId}/roles`, organizer.cookie, { organizer: true });
    assert.equal(promoted.json.role, 'organizer');
    const back = await send(edition, 'PATCH', `/attendees/${target.documentId}/roles`, organizer.cookie, { organizer: false });
    assert.equal(back.json.role, 'participant');
  });
});
