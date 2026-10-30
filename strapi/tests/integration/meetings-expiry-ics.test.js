'use strict';

/**
 * Rendez-vous, expiration et export calendrier (lot 8, tests d'abord) :
 *   - T-22, R-17, A-32 : `meetings.expirePending({ now })` passe en `expired` les demandes `pending` des éditions dont la fenêtre est
 *     close, n'envoie rien, est idempotent ; fenêtre par défaut = veille de Edition.date à 18h00 Europe/Paris ;
 *   - tâche planifiée `espaceMeetingExpiry` (`*\/5`) enregistrée seulement avec CRON_ENABLED=true ;
 *   - T-23, I-40, F-65 : GET /meetings.ics, text/calendar, rendez-vous acceptés et séquences, fuseau Europe/Paris, UID stables.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { pending } = require('../helpers/pending');
const { sleep, useEspace } = require('../helpers/espace');
const { UID } = require('../helpers/espace-data');
const { eventsOf, firstProp, unescapeText, validateIcs } = require('../helpers/ics-validate');
const W = require('../helpers/meetings-world');

const iso = (value) => new Date(value).toISOString();

describe('rendez-vous : expiration (T-22) et export .ics (T-23) (lot 8)', pending('lot 8', { timeout: 600_000 }), () => {
  const espace = useEspace({ overrides: { ORGANIZER_EMAILS: 'organisation@example.org' } });
  const login = W.useLogin(espace);
  const api = W.useApi(espace);
  const app = () => espace().app;

  const newEdition = (options) => W.createMeetingEdition(app(), { slug: W.unique('exp'), title: 'Édition d’essai', ...options });
  const person = (edition, fields) => W.createPerson(app(), edition, fields);
  const as = async (edition, who) => api(await login(edition, who));
  const seed = (world, fields) => W.seedMeeting(app(), { edition: world.edition, ...fields });
  const status = async (meeting) => (await W.readMeeting(app(), meeting.documentId)).status;
  const meetings = () => app().service('api::espace.meetings');

  describe('expirePending : fenêtre close (T-22, R-17, A-32)', () => {
    async function closedEdition() {
      const world = await newEdition({ window: 'closed' });
      const [a, b, c, d, e, f, g, h] = await Promise.all(Array.from({ length: 8 }, () => person(world.edition)));
      return {
        world,
        people: { a, b, c, d, e, f, g, h },
        pendingOne: await seed(world, { slot: world.slots['10h45'], requester: a, target: b }),
        pendingTwo: await seed(world, { slot: world.slots['11h00'], requester: c, target: d }),
        accepted: await seed(world, { slot: world.slots['12h30'], requester: e, target: f, status: 'accepted', tableNumber: 1 }),
        declined: await seed(world, { slot: world.slots['12h45'], requester: g, target: h, status: 'declined' }),
      };
    }

    it('T-22 : les demandes `pending` d’une édition dont la fenêtre est close passent `expired`', async () => {
      const { pendingOne, pendingTwo } = await closedEdition();
      await meetings().expirePending({ now: new Date() });
      assert.equal(await status(pendingOne), 'expired');
      assert.equal(await status(pendingTwo), 'expired');
    });

    it('les rendez-vous `accepted` et les demandes déjà closes ne changent pas ; la table reste prise', async () => {
      const { accepted, declined, world } = await closedEdition();
      await meetings().expirePending({ now: new Date() });
      assert.equal(await status(accepted), 'accepted');
      assert.equal(await status(declined), 'declined');
      assert.equal((await W.readMeeting(app(), accepted.documentId)).tableKey, `${world.slots['12h30'].documentId}:1`);
    });

    it('une édition dont la fenêtre est ouverte n’est pas touchée', async () => {
      const world = await newEdition();
      const [a, b] = [await person(world.edition), await person(world.edition)];
      const meeting = await seed(world, { slot: world.slots['10h45'], requester: a, target: b });
      await meetings().expirePending({ now: new Date() });
      assert.equal(await status(meeting), 'pending');
    });

    it('une édition dont la fenêtre n’est pas encore ouverte n’est pas touchée non plus', async () => {
      const world = await newEdition({ window: 'not_open' });
      const [a, b] = [await person(world.edition), await person(world.edition)];
      const meeting = await seed(world, { slot: world.slots['10h45'], requester: a, target: b });
      await meetings().expirePending({ now: new Date() });
      assert.equal(await status(meeting), 'pending');
    });

    it('idempotente : un second appel ne change rien ; sans argument, elle prend l’heure courante', async () => {
      const { pendingOne, accepted } = await closedEdition();
      await meetings().expirePending();
      assert.equal(await status(pendingOne), 'expired');
      await meetings().expirePending();
      assert.equal(await status(pendingOne), 'expired');
      assert.equal(await status(accepted), 'accepted');
    });

    it('n’envoie aucun e-mail et n’écrit aucun EmailLog (A-32 : la tâche n’envoie rien)', async () => {
      const { people } = await closedEdition();
      const before = espace().outbox().length;
      await meetings().expirePending({ now: new Date() });
      await sleep(500);
      assert.equal(espace().outbox().length, before);
      for (const attendee of [people.a, people.b, people.c, people.d]) assert.equal((await W.emailLogs(app(), attendee)).length, 0);
    });

    it('le demandeur retrouve la demande expirée dans son historique, avec son statut et aucun bouton', async () => {
      const { world, people, pendingOne } = await closedEdition();
      await meetings().expirePending({ now: new Date() });
      const { json } = await (await as(world.edition, people.a)).get('/meetings');
      assert.deepEqual(json.sent, []);
      const entry = json.closed.find((meeting) => meeting.id === pendingOne.documentId);
      assert.equal(entry.status, 'expired');
      assert.deepEqual([entry.canAccept, entry.canDecline, entry.canCounter, entry.canCancel], [false, false, false, false]);
    });

    it('une demande expirée libère la place : elle ne compte plus dans les dix demandes en attente', async () => {
      const { world, people, pendingOne } = await closedEdition();
      await meetings().expirePending({ now: new Date() });
      assert.equal(await status(pendingOne), 'expired');
      assert.equal((await W.meetingsAt(app(), world.edition, { status: 'pending', requester: { documentId: people.a.documentId } })).length, 0);
    });
  });

  describe('A-19 · A-32 : l’instant est injectable, fermeture par défaut la veille à 18h00 Europe/Paris', () => {
    const SUMMER = { date: '2031-06-12', meetingRequestsOpenAt: null, meetingRequestsCloseAt: null };
    const WINTER = { date: '2031-12-04', meetingRequestsOpenAt: null, meetingRequestsCloseAt: null };

    async function fixedEdition(settings) {
      const world = await newEdition({ settings });
      const [a, b] = [await person(world.edition), await person(world.edition)];
      return { world, meeting: await seed(world, { slot: world.slots['10h45'], requester: a, target: b }) };
    }

    it('été (CEST) : la demande tient jusqu’au 11 juin à 18h00 Paris, soit 16h00 UTC, puis expire', async () => {
      const { meeting } = await fixedEdition(SUMMER);
      await meetings().expirePending({ now: new Date('2031-06-11T15:59:59.000Z') });
      assert.equal(await status(meeting), 'pending');
      await meetings().expirePending({ now: new Date('2031-06-11T16:00:01.000Z') });
      assert.equal(await status(meeting), 'expired');
    });

    it('hiver (CET) : la demande tient jusqu’au 3 décembre à 18h00 Paris, soit 17h00 UTC, puis expire', async () => {
      const { meeting } = await fixedEdition(WINTER);
      await meetings().expirePending({ now: new Date('2031-12-03T16:59:59.000Z') });
      assert.equal(await status(meeting), 'pending');
      await meetings().expirePending({ now: new Date('2031-12-03T17:00:01.000Z') });
      assert.equal(await status(meeting), 'expired');
    });

    it('une fermeture explicite l’emporte sur la valeur par défaut', async () => {
      const { meeting } = await fixedEdition({ date: '2031-06-12', meetingRequestsOpenAt: null, meetingRequestsCloseAt: '2031-06-01T08:00:00.000Z' });
      await meetings().expirePending({ now: new Date('2031-06-01T07:59:00.000Z') });
      assert.equal(await status(meeting), 'pending');
      await meetings().expirePending({ now: new Date('2031-06-01T08:01:00.000Z') });
      assert.equal(await status(meeting), 'expired');
    });

    it('avant l’ouverture, rien n’expire même si l’instant donné est antérieur', async () => {
      const { meeting } = await fixedEdition({ date: '2031-06-12', meetingRequestsOpenAt: '2031-05-01T08:00:00.000Z', meetingRequestsCloseAt: null });
      await meetings().expirePending({ now: new Date('2031-04-01T08:00:00.000Z') });
      assert.equal(await status(meeting), 'pending');
    });
  });

  describe('T-23 · I-40 · F-65 : GET /meetings.ics', () => {
    const SEQUENCES = [...W.recette.sequences, { title: 'Clôture', start_time: '17h00', kind: 'other' }];

    async function scene() {
      const world = await newEdition({ sequences: SEQUENCES });
      const lea = await person(world.edition, { firstName: 'Léa', lastName: 'Ducasse' });
      const [mathis, helene, jules, ines] = [
        await person(world.edition, { firstName: 'Mathis', lastName: 'Lagrange' }),
        await person(world.edition, { firstName: 'Hélène', lastName: 'Marquès' }),
        await person(world.edition, { firstName: 'Jules', lastName: 'Mazères' }),
        await person(world.edition, { firstName: 'Inès', lastName: 'Castaing' }),
      ];
      const { exhibitor } = await W.createExhibitor(app(), world.edition, { name: 'Sylvadour', standNumber: '4' });
      const rep = await person(world.edition, { firstName: 'Benoît', lastName: 'Tastet', role: 'exhibitor_rep', exhibitor: { documentId: exhibitor.documentId } });
      const m = {
        table: await seed(world, { slot: world.slots['10h45'], requester: lea, target: mathis, status: 'accepted', tableNumber: 1, answeredBy: mathis }),
        stand: await seed(world, { slot: world.slots['12h30'], requester: lea, exhibitor, status: 'accepted', answeredBy: rep }),
        received: await seed(world, { slot: world.slots['15h30'], requester: helene, target: lea }),
        sent: await seed(world, { slot: world.slots['13h00'], requester: lea, target: jules }),
        declined: await seed(world, { slot: world.slots['13h15'], requester: jules, target: lea, status: 'declined' }),
        cancelled: await seed(world, { slot: world.slots['13h30'], requester: lea, target: helene, status: 'cancelled' }),
        expired: await seed(world, { slot: world.slots['13h45'], requester: helene, target: lea, status: 'expired' }),
        others: await seed(world, { slot: world.slots['11h00'], requester: ines, target: mathis, status: 'accepted', tableNumber: 1 }),
      };
      return { world, lea, ines, m };
    }
    const download = async (world, who) => espace().request('/api/espace/meetings.ics', { cookie: await login(world.edition, who) });
    const meetingEvents = (text, ...ids) => eventsOf(text).filter((event) => ids.some((id) => firstProp(event, 'UID').value.includes(id)));

    it('sans session : 401', async () => {
      const response = await espace().request('/api/espace/meetings.ics');
      assert.equal(response.status, 401);
    });

    it('200 text/calendar; charset=utf-8, en pièce jointe « jib-{édition}.ics »', async () => {
      const { world, lea } = await scene();
      const response = await download(world, lea);
      assert.equal(response.status, 200, response.text);
      assert.match(response.headers.get('content-type'), /^text\/calendar;\s*charset=utf-8$/i);
      assert.equal(response.headers.get('content-disposition'), `attachment; filename="jib-${world.edition.slug}.ics"`);
    });

    it('T-23 : le fichier est un calendrier valable (RFC 5545), dates en Europe/Paris', async () => {
      const { world, lea } = await scene();
      const { text } = await download(world, lea);
      assert.deepEqual(validateIcs(text), []);
      assert.match(text, /TZID:Europe\/Paris/);
      assert.ok(eventsOf(text).every((event) => firstProp(event, 'DTSTART').params.TZID === 'Europe/Paris'));
    });

    it('contient les rendez-vous acceptés de Léa, pas les demandes en attente, refusées, annulées ni expirées, ni ceux d’un tiers', async () => {
      const { world, lea, m } = await scene();
      const { text } = await download(world, lea);
      assert.equal(meetingEvents(text, m.table.documentId).length, 1);
      assert.equal(meetingEvents(text, m.stand.documentId).length, 1);
      for (const key of ['received', 'sent', 'declined', 'cancelled', 'expired', 'others']) assert.equal(meetingEvents(text, m[key].documentId).length, 0, key);
    });

    it('un rendez-vous à table : heure du créneau, lieu « Table 1 », l’autre personne nommée', async () => {
      const { world, lea, m } = await scene();
      const [event] = meetingEvents((await download(world, lea)).text, m.table.documentId);
      assert.equal(firstProp(event, 'DTSTART').value, `${world.edition.date.replaceAll('-', '')}T104500`);
      assert.equal(firstProp(event, 'DTEND').value, `${world.edition.date.replaceAll('-', '')}T110000`);
      assert.match(unescapeText(firstProp(event, 'LOCATION').value), /Table 1/);
      assert.match(unescapeText(firstProp(event, 'SUMMARY').value), /Mathis Lagrange/);
    });

    it('un rendez-vous au stand : lieu « Stand 4 », l’exposant nommé', async () => {
      const { world, lea, m } = await scene();
      const [event] = meetingEvents((await download(world, lea)).text, m.stand.documentId);
      assert.equal(firstProp(event, 'DTSTART').value, `${world.edition.date.replaceAll('-', '')}T123000`);
      assert.match(unescapeText(firstProp(event, 'LOCATION').value), /Stand 4/);
      assert.match(unescapeText(firstProp(event, 'SUMMARY').value), /Sylvadour/);
    });

    it('contient aussi les séquences du programme à heure lisible ; une séquence sans fin dure 30 minutes', async () => {
      const { world, lea } = await scene();
      const { text } = await download(world, lea);
      const day = world.edition.date.replaceAll('-', '');
      const events = eventsOf(text);
      const byTitle = (title) => events.find((event) => unescapeText(firstProp(event, 'SUMMARY').value).includes(title));
      const opening = byTitle('Accueil et ouverture');
      assert.equal(firstProp(opening, 'DTSTART').value, `${day}T091500`);
      assert.equal(firstProp(opening, 'DTEND').value, `${day}T094500`);
      const closing = byTitle('Clôture');
      assert.equal(firstProp(closing, 'DTSTART').value, `${day}T170000`);
      assert.equal(firstProp(closing, 'DTEND').value, `${day}T173000`, 'sans fin : 30 minutes');
      assert.equal(events.length, 10 + 2, 'dix séquences et deux rendez-vous acceptés');
    });

    it('UID stables, de la forme {type}-{documentId}@jib, d’un téléchargement à l’autre', async () => {
      const { world, lea, m } = await scene();
      const first = eventsOf((await download(world, lea)).text).map((event) => firstProp(event, 'UID').value);
      const second = eventsOf((await download(world, lea)).text).map((event) => firstProp(event, 'UID').value);
      assert.deepEqual(first.sort(), second.sort());
      assert.ok(first.every((uid) => /^[a-z]+-[a-z0-9]+@jib$/.test(uid)), first.join(', '));
      assert.ok(first.some((uid) => uid.includes(m.table.documentId)));
      assert.equal(new Set(first).size, first.length);
    });

    it('un participant sans rendez-vous reçoit un calendrier valable avec les seules séquences', async () => {
      const { world, ines } = await scene();
      const newcomer = await person(world.edition);
      const { text } = await download(world, newcomer);
      assert.deepEqual(validateIcs(text), []);
      assert.equal(eventsOf(text).length, 10);
      assert.equal(ines.documentId === newcomer.documentId, false);
    });

    it('R-42 : aucune adresse e-mail, aucun identifiant HelloAsso dans le fichier', async () => {
      const { world, lea } = await scene();
      assert.deepEqual(W.leaks((await download(world, lea)).text), []);
    });

    it('le calendrier d’un participant ne contient jamais les rendez-vous d’une autre édition', async () => {
      const { world, lea } = await scene();
      const other = await newEdition();
      const [a, b] = [await person(other.edition), await person(other.edition)];
      const foreign = await seed(other, { slot: other.slots['10h45'], requester: a, target: b, status: 'accepted', tableNumber: 1 });
      assert.ok(!(await download(world, lea)).text.includes(foreign.documentId));
    });

    it('UID de session : le documentId de la séquence, jamais un identifiant numérique', async () => {
      const { world, lea } = await scene();
      const sequences = await app().documents(UID.sequence).findMany({ filters: { edition: { documentId: world.edition.documentId } }, status: 'published', limit: 100 });
      const { text } = await download(world, lea);
      for (const sequence of sequences.filter((item) => item.start_time && item.start_time !== '--')) {
        assert.ok(eventsOf(text).some((event) => firstProp(event, 'UID').value.includes(sequence.documentId)), `séquence absente : ${sequence.title}`);
      }
      assert.ok(iso(world.slots['10h45'].startsAt));
    });
  });
});

describe('tâche planifiée espaceMeetingExpiry (lot 8)', pending('lot 8', { timeout: 300_000 }), () => {
  const espace = useEspace({ overrides: { CRON_ENABLED: 'true', ORGANIZER_EMAILS: 'organisation@example.org' } });
  // Strapi enregistre ses propres tâches (métriques) : seules celles de l'espace comptent.
  const STRAPI_JOBS = new Set(['uploadWeekly', 'sendProjectInformation']);
  const jobs = () => espace().app.cron.jobs.filter(({ name }) => !STRAPI_JOBS.has(name));

  it('CRON_ENABLED=true : une tâche `*/5 * * * *` en Europe/Paris est enregistrée', () => {
    const entry = jobs().find(({ options }) => (typeof options === 'string' ? options : options?.rule) === '*/5 * * * *');
    assert.ok(entry, 'tâche d’expiration non enregistrée');
    assert.equal(entry.options.tz, 'Europe/Paris');
  });

  it('les tâches de la phase 1 sont toujours là (`*/15` et `0 4`)', () => {
    const rules = jobs().map(({ options }) => (typeof options === 'string' ? options : options?.rule));
    assert.ok(rules.includes('*/15 * * * *') && rules.includes('0 4 * * *'));
  });

  it('la tâche expire les demandes d’une fenêtre close, par le service, sans erreur', async () => {
    const { app } = espace();
    const world = await W.createMeetingEdition(app, { slug: W.unique('cron'), title: 'Édition d’essai', window: 'closed' });
    const [a, b] = [await W.createPerson(app, world.edition), await W.createPerson(app, world.edition)];
    const meeting = await W.seedMeeting(app, { edition: world.edition, slot: world.slots['10h45'], requester: a, target: b });
    await require('../../config/cron-tasks').espaceMeetingExpiry.task({ strapi: app });
    assert.equal((await W.readMeeting(app, meeting.documentId)).status, 'expired');
  });
});
