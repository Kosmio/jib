'use strict';

/**
 * Éditeur du programme de l'interface organisation, lot AD-3 (docs/espace/specs/15-administration.md) : D-22, D-23, F-160 à F-165,
 * R-93, R-94, NF-72, NF-75, T-78, T-79, T-80, T-85, T-86.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { useEspace } = require('../helpers/espace');
const { UID, createAttendee, createEdition, createProgram, link } = require('../helpers/espace-data');

const INTERVENTION = 'api::intervention.intervention';

describe('éditeur du programme de l’interface organisation (AD-3)', { timeout: 600_000 }, () => {
  const espace = useEspace({ fake: true });
  let counter = 0;

  const newEdition = (options = {}) => {
    counter += 1;
    return createEdition(espace().app, { slug: `programme-${counter}`, title: `Programme ${counter}`, ...options });
  };
  async function person(edition, fields = {}) {
    const attendee = await createAttendee(espace().app, edition, { consentAt: new Date().toISOString(), ...fields });
    return { attendee, ...(await espace().signIn(edition.slug, attendee.email)) };
  }
  const organizerOf = (edition) => person(edition, { role: 'organizer' });
  const send = (edition, method, path, cookie, json) =>
    espace().request(`/api/espace/admin/${edition.slug}${path}`, { method, cookie, ...(json !== undefined && { json }) });
  const publishedSequences = (edition) => espace().app.documents(UID.sequence).findMany({ filters: { edition: link(edition) }, status: 'published' });

  it('T-86 : les routes du programme répondent 403 à un participant', async () => {
    const edition = await newEdition();
    const participant = await person(edition);
    for (const [method, path] of [
      ['GET', '/program'],
      ['POST', '/program/publish'],
      ['POST', '/sequences'],
      ['PATCH', '/sequences/x'],
      ['DELETE', '/sequences/x'],
      ['POST', '/sequences/x/interventions'],
      ['PATCH', '/interventions/x'],
      ['DELETE', '/interventions/x'],
      ['POST', '/intervenants'],
      ['PATCH', '/intervenants/x'],
    ]) {
      assert.equal((await send(edition, method, path, participant.cookie, method === 'GET' ? undefined : {})).status, 403, `${method} ${path}`);
    }
  });

  it('T-78, T-80 : trois séquences, deux interventions et un intervenant nouveau restent hors ligne jusqu’à la publication ; le script collé disparaît', async () => {
    const edition = await newEdition();
    const organizer = await organizerOf(edition);
    for (const [title, startTime, endTime] of [
      ['Accueil', '9h00', '9h30'],
      ['Table ronde', '9h30', '10h30'],
      ['Clôture', '17h00', ''],
    ]) {
      const created = await send(edition, 'POST', '/sequences', organizer.cookie, { title, startTime, endTime, description: '<p><b>Gras</b></p><ul><li>un</li></ul><script>alert(1)</script>' });
      assert.equal(created.status, 201, created.text);
    }
    const speaker = await send(edition, 'POST', '/intervenants', organizer.cookie, { name: 'Camille Fictive', title: 'Ingénieure', bio: '<p>Bio <i>courte</i></p><img src=x onerror=alert(1)>' });
    assert.equal(speaker.status, 201, speaker.text);
    let { json: program } = await send(edition, 'GET', '/program', organizer.cookie);
    const table = program.sequences.find((sequence) => sequence.title === 'Table ronde');
    await send(edition, 'POST', `/sequences/${table.id}/interventions`, organizer.cookie, { description: 'Première', speakers: [speaker.json.id] });
    const second = await send(edition, 'POST', `/sequences/${table.id}/interventions`, organizer.cookie, { description: 'Seconde' });
    program = second.json;
    assert.equal(program.sequences.map((sequence) => sequence.title).join(', '), 'Accueil, Table ronde, Clôture', 'ordre horaire');
    assert.equal(program.sequences[0].description, '<p><strong>Gras</strong></p><ul><li>un</li></ul>', 'NF-72');
    assert.equal(program.changes.length, 6, JSON.stringify(program.changes));
    assert.equal((await publishedSequences(edition)).length, 0, 'rien en ligne avant la publication');

    // Ordre des interventions par les boutons (F-161).
    const [first, last] = program.sequences[1].interventions;
    const moved = await send(edition, 'PATCH', `/interventions/${last.id}`, organizer.cookie, { move: 'up' });
    assert.deepEqual(moved.json.sequences[1].interventions.map((item) => item.id), [last.id, first.id]);

    const published = await send(edition, 'POST', '/program/publish', organizer.cookie);
    assert.equal(published.status, 200, published.text);
    assert.deepEqual(published.json.published, { sequences: 3, interventions: 2, intervenants: 1 });
    assert.equal(published.json.program.changes.length, 0);
    assert.equal((await publishedSequences(edition)).length, 3);
    const online = await espace().app.documents(INTERVENTION).findMany({ filters: { sequence: { edition: link(edition) } }, status: 'published', populate: ['intervenants'] });
    assert.equal(online.length, 2);
    assert.ok(online.some((item) => item.intervenants.some((who) => who.name === 'Camille Fictive')));
    const bio = (await espace().app.documents(UID.intervenant).findOne({ documentId: speaker.json.id, status: 'published' })).bio;
    assert.equal(bio, '<p>Bio <em>courte</em></p>', 'T-80 : aucune balise ni attribut dangereux en base');
  });

  it('T-79 : une pause qui porte un rendez-vous accepté ne se supprime pas, ne change ni de nature ni d’horaire', async () => {
    const { app } = espace();
    const edition = await newEdition();
    const sequences = await createProgram(app, edition);
    await app.service('api::espace.slots').regenerate(edition.documentId);
    const organizer = await organizerOf(edition);
    const pause = sequences.find((sequence) => sequence.kind === 'b2b_break');
    const [slot] = await app.documents(UID.slot).findMany({ filters: { session: { documentId: pause.documentId } }, limit: 1 });
    const a = await createAttendee(app, edition);
    const b = await createAttendee(app, edition);
    await app.documents(UID.meeting).create({ data: { edition: link(edition), slot: link(slot), requester: link(a), targetAttendee: link(b), status: 'accepted', tableNumber: 1 } });

    for (const [method, path, json] of [
      ['DELETE', `/sequences/${pause.documentId}`],
      ['PATCH', `/sequences/${pause.documentId}`, { kind: 'talk' }],
      ['PATCH', `/sequences/${pause.documentId}`, { startTime: '8h00' }],
    ]) {
      const refused = await send(edition, method, path, organizer.cookie, json);
      assert.equal(refused.status, 409, `${method} ${JSON.stringify(json)} : ${refused.text}`);
      assert.match(refused.json.error.message, /1 rendez-vous/);
    }
    const renamed = await send(edition, 'PATCH', `/sequences/${pause.documentId}`, organizer.cookie, { title: 'Pause et rendez-vous' });
    assert.equal(renamed.status, 200, 'le titre change, lui');
  });

  it('T-85 : le second enregistrement d’une même séquence reçoit 409, rien n’est écrasé', async () => {
    const edition = await newEdition();
    const organizer = await organizerOf(edition);
    const { json } = await send(edition, 'POST', '/sequences', organizer.cookie, { title: 'Atelier', startTime: '14h00', endTime: '15h00' });
    const [sequence] = json.sequences;
    const one = await send(edition, 'PATCH', `/sequences/${sequence.id}`, organizer.cookie, { title: 'Atelier A', updatedAt: sequence.updatedAt });
    assert.equal(one.status, 200, one.text);
    const two = await send(edition, 'PATCH', `/sequences/${sequence.id}`, organizer.cookie, { title: 'Atelier B', updatedAt: sequence.updatedAt });
    assert.equal(two.status, 409);
    assert.equal(two.json.error.code, 'STALE');
    assert.equal((await send(edition, 'GET', '/program', organizer.cookie)).json.sequences[0].title, 'Atelier A');
  });

  it('R-86 : une pause B2B sans heure de fin et une heure illisible sont refusées', async () => {
    const edition = await newEdition();
    const organizer = await organizerOf(edition);
    const missing = await send(edition, 'POST', '/sequences', organizer.cookie, { title: 'Cocktail', startTime: '18h00', kind: 'b2b_break' });
    assert.equal(missing.status, 400);
    assert.ok(missing.json.error.fields.endTime);
    const unreadable = await send(edition, 'POST', '/sequences', organizer.cookie, { title: 'Cocktail', startTime: '--' });
    assert.ok(unreadable.json.error.fields.startTime);
  });
});
