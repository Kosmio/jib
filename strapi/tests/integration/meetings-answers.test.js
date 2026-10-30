'use strict';

/**
 * Rendez-vous, réponses (lot 8, tests d'abord) : accepter (T-15, T-16, T-19, T-24, T-26, R-13, R-14, R-15, A-30, A-32), refuser,
 * contre-proposer (T-20, A-31), annuler (T-21, R-16), cycle de vie (R-10), réservation d'une table dédiée (R-19), e-mails (A-33, I-41).
 * Contrats : section 3.2 du plan des phases 2 et 3. La concurrence (T-17, T-25) est dans meetings-concurrency.test.js.
 *
 * Chaque test crée ses personnes et, quand les tables ou les demandes d'un créneau comptent, son édition. Les demandes de départ sont
 * écrites par le Document Service ; les réponses passent par l'API avec une vraie session. Un seul démarrage de Strapi.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { useEspace } = require('../helpers/espace');
const { UID } = require('../helpers/espace-data');
const { eventsOf, firstProp, unescapeText, validateIcs } = require('../helpers/ics-validate');
const W = require('../helpers/meetings-world');

const COLLISION_REASON = 'Créneau pris par un autre rendez-vous';

describe('rendez-vous : réponses, annulation, tables et e-mails (lot 8)', { timeout: 900_000 }, () => {
  const espace = useEspace({ overrides: { ORGANIZER_EMAILS: 'organisation@example.org' } });
  const login = W.useLogin(espace);
  const api = W.useApi(espace);
  const app = () => espace().app;

  const newEdition = (options) => W.createMeetingEdition(app(), { slug: W.unique('rep'), title: 'Édition d’essai', ...options });
  const person = (edition, fields) => W.createPerson(app(), edition, fields);
  const as = async (edition, who) => api(await login(edition, who));
  const seed = (world, fields) => W.seedMeeting(app(), { edition: world.edition, ...fields });
  const reload = (meeting) => W.readMeeting(app(), meeting.documentId);
  const answer = async (world, who, meeting, verb, body = {}) => (await as(world.edition, who)).post(`/meetings/${meeting.documentId}/${verb}`, body);
  const mailsTo = (attendee) => W.outboxTo(espace, attendee.email);
  const logs = (attendee, template) => W.emailLogs(app(), attendee, template);
  const expectError = (response, status, code) => {
    assert.equal(response.status, status, `${response.status} ${response.text}`);
    assert.equal(response.json?.error?.code, code, response.text);
    assert.ok(response.json.error.message?.length > 0);
  };
  /** Deux personnes nommées d'après la recette. */
  const duo = async (world) => ({
    lea: await person(world.edition, { firstName: 'Léa', lastName: 'Ducasse' }),
    ines: await person(world.edition, { firstName: 'Inès', lastName: 'Castaing' }),
  });
  /** Un exposant et ses représentants actifs. */
  async function stand(world, { reps = 2, name = 'Sylvadour', standNumber = '4' } = {}) {
    const { exhibitor } = await W.createExhibitor(app(), world.edition, { name, standNumber });
    const people = [];
    for (let index = 0; index < reps; index += 1) {
      people.push(await person(world.edition, { firstName: ['Benoît', 'Pierre', 'Camille'][index], lastName: ['Tastet', 'Haurie', 'Lasserre'][index], role: 'exhibitor_rep', exhibitor: { documentId: exhibitor.documentId } }));
    }
    return { exhibitor, reps: people };
  }

  describe('T-15 · R-13 : accepter une demande', () => {
    async function accepted() {
      const world = await newEdition();
      const { lea, ines } = await duo(world);
      const meeting = await seed(world, { slot: world.slots['10h45'], requester: ines, target: lea, message: 'Bonjour Léa.' });
      const response = await answer(world, lea, meeting, 'accept');
      return { world, lea, ines, meeting, response };
    }

    it('200 avec le Meeting `accepted`, vu de la cible (« received »), lieu « Table 1 »', async () => {
      const { response, ines } = await accepted();
      assert.equal(response.status, 200, response.text);
      const meeting = response.json;
      assert.deepEqual(Object.keys(meeting).sort(), W.MEETING_KEYS);
      assert.equal(meeting.status, 'accepted');
      assert.equal(meeting.direction, 'received');
      assert.equal(meeting.location, 'Table 1');
      assert.equal(meeting.counterpart.id, ines.documentId);
      assert.deepEqual([meeting.canAccept, meeting.canDecline, meeting.canCounter, meeting.canCancel], [false, false, false, true]);
    });

    it('écrit en base la plus petite table libre, la clé {créneau}:{table} (A-27), qui a répondu et quand', async () => {
      const { world, lea, meeting } = await accepted();
      const row = await reload(meeting);
      assert.equal(row.status, 'accepted');
      assert.equal(row.tableNumber, 1);
      assert.equal(row.tableKey, `${world.slots['10h45'].documentId}:1`);
      assert.equal(row.location, 'Table 1');
      assert.equal(row.answeredBy.documentId, lea.documentId);
      assert.ok(row.answeredAt, 'answeredAt manque');
    });

    it('e-mail meeting-accepted au demandeur, avec le .ics du rendez-vous en pièce jointe (T-15, I-41)', async () => {
      const { world, ines, meeting } = await accepted();
      await W.waitForEmailLogs(app(), ines, 'meeting-accepted');
      const mail = mailsTo(ines).at(-1);
      assert.equal(mail.attachments.length, 1);
      const [attachment] = mail.attachments;
      assert.match(attachment.filename, /\.ics$/);
      assert.match(attachment.contentType, /^text\/calendar/);
      const text = Buffer.from(attachment.content, 'base64').toString('utf8');
      assert.deepEqual(validateIcs(text), []);
      const [event] = eventsOf(text);
      assert.equal(firstProp(event, 'UID').value.includes(meeting.documentId), true, 'l’UID doit porter le documentId du rendez-vous');
      assert.match(firstProp(event, 'UID').value, /@jib$/);
      assert.equal(unescapeText(firstProp(event, 'LOCATION').value).includes('Table 1'), true);
      assert.equal(firstProp(event, 'DTSTART').params.TZID, 'Europe/Paris');
      assert.equal(firstProp(event, 'DTSTART').value, `${world.edition.date.replaceAll('-', '')}T104500`);
      assert.match(unescapeText(firstProp(event, 'SUMMARY').value), /Léa Ducasse/);
    });

    it('le message nomme la table et le créneau ; la cible qui a accepté ne reçoit pas meeting-accepted', async () => {
      const { lea, ines } = await accepted();
      await W.waitForEmailLogs(app(), ines, 'meeting-accepted');
      assert.ok(mailsTo(ines).at(-1).text.includes('Table 1'));
      assert.ok(mailsTo(ines).at(-1).text.includes('10h45'));
      assert.equal((await W.settledEmailLogs(app(), lea, 'meeting-accepted')).length, 0);
    });

    it('aucune adresse e-mail ni identifiant HelloAsso dans la réponse (R-42)', async () => {
      const { response } = await accepted();
      assert.deepEqual(W.leaks(response.text), []);
    });
  });

  describe('R-13 · R-03 : attribution de la plus petite table libre', () => {
    /** N demandes en attente de personnes distinctes vers des cibles distinctes, au même créneau. */
    async function pairs(world, count, label = '10h45') {
      const list = [];
      for (let index = 0; index < count; index += 1) {
        const requester = await person(world.edition);
        const target = await person(world.edition);
        list.push({ requester, target, meeting: await seed(world, { slot: world.slots[label], requester, target }) });
      }
      return list;
    }

    it('tables 1, 2, 3 dans l’ordre, puis 409 NO_TABLE_LEFT : la quatrième demande reste en attente', async () => {
      const world = await newEdition();
      const list = await pairs(world, 4);
      const got = [];
      for (const { target, meeting } of list) {
        const response = await answer(world, target, meeting, 'accept');
        got.push(response.status === 200 ? response.json.location : `${response.status} ${response.json.error.code}`);
      }
      assert.deepEqual(got, ['Table 1', 'Table 2', 'Table 3', '409 NO_TABLE_LEFT']);
      assert.equal((await reload(list[3].meeting)).status, 'pending');
      assert.equal((await W.settledEmailLogs(app(), list[3].requester, 'meeting-accepted', { settleMs: 200 })).length, 0);
    });

    it('T-21 : une table libérée par une annulation est de nouveau attribuée, la plus petite d’abord', async () => {
      const world = await newEdition();
      const list = await pairs(world, 4);
      for (const { target, meeting } of list.slice(0, 3)) assert.equal((await answer(world, target, meeting, 'accept')).status, 200);
      assert.equal((await answer(world, list[0].requester, list[0].meeting, 'cancel')).status, 200);
      const response = await answer(world, list[3].target, list[3].meeting, 'accept');
      assert.equal(response.status, 200, response.text);
      assert.equal(response.json.location, 'Table 1');
      const keys = (await W.meetingsAt(app(), world.edition, { status: 'accepted' })).map((row) => row.tableKey).sort();
      assert.equal(new Set(keys).size, keys.length, 'deux rendez-vous sur la même table');
    });

    it('T-26 : table 2 dédiée à un intervenant, les 1-to-1 prennent les tables 1 et 3, la troisième acceptation reçoit NO_TABLE_LEFT', async () => {
      const world = await newEdition();
      await person(world.edition, { role: 'speaker', hostedTableNumber: 2, meetingsOptIn: false });
      const list = await pairs(world, 3);
      const got = [];
      for (const { target, meeting } of list) {
        const response = await answer(world, target, meeting, 'accept');
        got.push(response.status === 200 ? response.json.location : `${response.status} ${response.json.error.code}`);
      }
      assert.deepEqual(got, ['Table 1', 'Table 3', '409 NO_TABLE_LEFT']);
      const tables = (await W.meetingsAt(app(), world.edition, { status: 'accepted' })).map((row) => row.tableNumber).sort();
      assert.deepEqual(tables, [1, 3]);
    });

    it('les tables d’un autre créneau sont indépendantes', async () => {
      const world = await newEdition();
      const first = (await pairs(world, 1, '10h45'))[0];
      const second = (await pairs(world, 1, '11h00'))[0];
      assert.equal((await answer(world, first.target, first.meeting, 'accept')).json.location, 'Table 1');
      assert.equal((await answer(world, second.target, second.meeting, 'accept')).json.location, 'Table 1');
    });
  });

  describe('R-14 · R-15 · A-30 : exposants et fermeture des autres demandes', () => {
    it('un représentant accepte au nom du stand : « Stand 4 », aucune table, qui a répondu (R-13, R-14)', async () => {
      const world = await newEdition();
      const { exhibitor, reps: [r1] } = await stand(world);
      const visitor = await person(world.edition);
      const meeting = await seed(world, { slot: world.slots['10h45'], requester: visitor, exhibitor });
      const response = await answer(world, r1, meeting, 'accept');
      assert.equal(response.status, 200, response.text);
      assert.equal(response.json.location, 'Stand 4');
      assert.deepEqual(response.json.viaExhibitor, { id: exhibitor.documentId, name: 'Sylvadour', standNumber: '4' });
      const row = await reload(meeting);
      assert.equal(row.tableNumber ?? null, null);
      assert.equal(row.tableKey ?? null, null);
      assert.equal(row.location, 'Stand 4');
      assert.equal(row.answeredBy.documentId, r1.documentId);
      await W.waitForEmailLogs(app(), visitor, 'meeting-accepted');
    });

    it('un rendez-vous au stand ne consomme aucune table : le 1-to-1 suivant au même créneau prend la table 1', async () => {
      const world = await newEdition();
      const { exhibitor, reps: [r1] } = await stand(world);
      const [visitor, requester, target] = [await person(world.edition), await person(world.edition), await person(world.edition)];
      const atStand = await seed(world, { slot: world.slots['10h45'], requester: visitor, exhibitor });
      const oneToOne = await seed(world, { slot: world.slots['10h45'], requester, target });
      assert.equal((await answer(world, r1, atStand, 'accept')).status, 200);
      assert.equal((await answer(world, target, oneToOne, 'accept')).json.location, 'Table 1');
    });

    it('seul un représentant actif de l’exposant ciblé peut répondre : un participant ordinaire reçoit 403 (T-24)', async () => {
      const world = await newEdition();
      const { exhibitor } = await stand(world);
      const [visitor, outsider] = [await person(world.edition), await person(world.edition)];
      const meeting = await seed(world, { slot: world.slots['10h45'], requester: visitor, exhibitor });
      expectError(await answer(world, outsider, meeting, 'accept'), 403, 'FORBIDDEN');
      expectError(await answer(world, visitor, meeting, 'accept'), 403, 'FORBIDDEN');
      assert.equal((await reload(meeting)).status, 'pending');
    });

    it('T-19 : trois demandes en attente, les deux premières acceptations passent, la troisième demande est refusée automatiquement et notifiée', async () => {
      const world = await newEdition();
      const { exhibitor, reps: [r1, r2] } = await stand(world);
      const visitors = [await person(world.edition), await person(world.edition), await person(world.edition)];
      const meetings = [];
      for (const visitor of visitors) meetings.push(await seed(world, { slot: world.slots['11h00'], requester: visitor, exhibitor }));
      assert.equal((await answer(world, r1, meetings[0], 'accept')).status, 200);
      assert.equal((await reload(meetings[2])).status, 'pending', 'l’exposant n’est pas complet après une seule acceptation');
      assert.equal((await answer(world, r2, meetings[1], 'accept')).status, 200);
      assert.equal((await reload(meetings[2])).status, 'declined', 'l’exposant est complet : la demande restante est refusée (A-30)');
      const [log] = await W.waitForEmailLogs(app(), visitors[2], 'meeting-declined');
      assert.equal(log.status, 'sent');
      expectError(await answer(world, r1, meetings[2], 'accept'), 409, 'INVALID_TRANSITION');
    });

    it('A-30 : exposant à un seul représentant, l’acceptation refuse les autres demandes du stand au même créneau', async () => {
      const world = await newEdition();
      const { exhibitor, reps: [r1] } = await stand(world, { reps: 1 });
      const [first, second, third] = [await person(world.edition), await person(world.edition), await person(world.edition)];
      const m1 = await seed(world, { slot: world.slots['10h45'], requester: first, exhibitor });
      const m2 = await seed(world, { slot: world.slots['10h45'], requester: second, exhibitor });
      const m3 = await seed(world, { slot: world.slots['11h00'], requester: third, exhibitor });
      assert.equal((await answer(world, r1, m1, 'accept')).status, 200);
      assert.equal((await reload(m2)).status, 'declined');
      assert.equal((await reload(m3)).status, 'pending', 'un autre créneau n’est pas touché');
      await W.waitForEmailLogs(app(), second, 'meeting-declined');
    });

    it('T-16 · R-15 · A-30 : l’acceptation ferme les autres demandes du créneau qui impliquent les deux personnes', async () => {
      // La demande envoyée par le demandeur lui-même sur le même créneau n’est pas créable par l’API (R-11.5) : elle n’est couverte
      // que par le test unitaire de closeOnAccept.
      const world = await newEdition();
      const names = ['lea', 'ines', 'hugo', 'jules', 'mathis', 'eva', 'helene'];
      const p = {};
      for (const [index, key] of names.entries()) p[key] = await person(world.edition, { firstName: key[0].toUpperCase() + key.slice(1), lastName: `Test${index}` });
      const slot = world.slots['10h45'];
      const m = {
        accepted: await seed(world, { slot, requester: p.ines, target: p.lea }),
        rival1: await seed(world, { slot, requester: p.hugo, target: p.lea }),
        rival2: await seed(world, { slot, requester: p.jules, target: p.lea }),
        sentByTarget: await seed(world, { slot, requester: p.lea, target: p.mathis }),
        toRequester: await seed(world, { slot, requester: p.helene, target: p.ines }),
        otherSlot: await seed(world, { slot: world.slots['11h00'], requester: p.hugo, target: p.lea }),
      };
      assert.equal((await answer(world, p.lea, m.accepted, 'accept')).status, 200);

      for (const key of ['rival1', 'rival2', 'toRequester']) assert.equal((await reload(m[key])).status, 'declined', `${key} doit être refusée`);
      for (const key of ['sentByTarget']) {
        const row = await reload(m[key]);
        assert.equal(row.status, 'cancelled', `${key} doit être annulée`);
        assert.equal(row.cancelReason, COLLISION_REASON);
        assert.equal(row.tableKey ?? null, null);
      }
      assert.equal((await reload(m.otherSlot)).status, 'pending', 'un autre créneau n’est pas touché');

      for (const key of ['hugo', 'jules', 'helene']) {
        await W.waitForEmailLogs(app(), p[key], 'meeting-declined');
        const mail = mailsTo(p[key]).at(-1);
        assert.match(mail.text, /Le créneau n[’']est plus disponible/, `${key} : motif du refus`);
      }
      for (const key of ['mathis']) {
        for (const template of ['meeting-declined', 'meeting-cancelled']) {
          assert.equal((await W.settledEmailLogs(app(), p[key], template, { settleMs: 100 })).length, 0, `${key} ne reçoit aucun ${template} (annulation sans e-mail)`);
        }
      }
      await W.waitForEmailLogs(app(), p.ines, 'meeting-accepted');
    });
  });

  describe('T-24 · NF-01 : qui peut répondre', () => {
    async function pendingBetween() {
      const world = await newEdition();
      const { lea, ines } = await duo(world);
      const stranger = await person(world.edition);
      const meeting = await seed(world, { slot: world.slots['10h45'], requester: ines, target: lea });
      return { world, lea, ines, stranger, meeting };
    }

    it('T-24 : une personne qui n’est pas la cible reçoit 403 en tentant d’accepter la demande adressée à une autre', async () => {
      const { world, stranger, meeting } = await pendingBetween();
      expectError(await answer(world, stranger, meeting, 'accept'), 403, 'FORBIDDEN');
      assert.equal((await reload(meeting)).status, 'pending');
    });

    it('le demandeur ne peut pas accepter sa propre demande : 403', async () => {
      const { world, ines, meeting } = await pendingBetween();
      expectError(await answer(world, ines, meeting, 'accept'), 403, 'FORBIDDEN');
      assert.equal((await reload(meeting)).status, 'pending');
    });

    for (const verb of ['decline', 'counter', 'cancel']) {
      it(`un tiers reçoit 403 sur ${verb}, la demande reste intacte`, async () => {
        const { world, stranger, meeting } = await pendingBetween();
        const body = verb === 'counter' ? { slotId: world.slots['11h00'].documentId } : {};
        expectError(await answer(world, stranger, meeting, verb, body), 403, 'FORBIDDEN');
        assert.equal((await reload(meeting)).status, 'pending');
        assert.equal((await W.meetingsAt(app(), world.edition)).length, 1);
      });
    }

    it('le demandeur ne peut ni refuser ni contre-proposer sa propre demande : 403', async () => {
      const { world, ines, meeting } = await pendingBetween();
      expectError(await answer(world, ines, meeting, 'decline'), 403, 'FORBIDDEN');
      expectError(await answer(world, ines, meeting, 'counter', { slotId: world.slots['11h00'].documentId }), 403, 'FORBIDDEN');
    });

    it('404 MEETING_NOT_FOUND : identifiant inconnu', async () => {
      const { world, lea } = await pendingBetween();
      for (const verb of ['accept', 'decline', 'counter', 'cancel']) {
        const response = await (await as(world.edition, lea)).post(`/meetings/inconnu0000000000000000/${verb}`, verb === 'counter' ? { slotId: world.slots['11h00'].documentId } : {});
        expectError(response, 404, 'MEETING_NOT_FOUND');
      }
    });

    it('404 MEETING_NOT_FOUND : rendez-vous d’une autre édition, même pour un participant connecté (NF-01)', async () => {
      const mine = await newEdition();
      const theirs = await newEdition();
      const visitor = await person(mine.edition);
      const [a, b] = [await person(theirs.edition), await person(theirs.edition)];
      const foreign = await seed(theirs, { slot: theirs.slots['10h45'], requester: a, target: b });
      for (const verb of ['accept', 'decline', 'cancel']) expectError(await answer(mine, visitor, foreign, verb), 404, 'MEETING_NOT_FOUND');
      expectError(await answer(mine, visitor, foreign, 'counter', { slotId: mine.slots['11h00'].documentId }), 404, 'MEETING_NOT_FOUND');
      assert.equal((await reload(foreign)).status, 'pending');
    });
  });

  describe('R-10 : cycle de vie, toute autre transition donne 409 INVALID_TRANSITION', () => {
    const START = { accepted: { status: 'accepted', tableNumber: 1 }, declined: { status: 'declined' }, cancelled: { status: 'cancelled' }, expired: { status: 'expired' } };

    async function inState(name) {
      const world = await newEdition();
      const { lea, ines } = await duo(world);
      const meeting = await seed(world, { slot: world.slots['10h45'], requester: ines, target: lea, ...START[name] });
      return { world, lea, ines, meeting };
    }

    for (const name of Object.keys(START)) {
      it(`accepter une demande ${name} : 409`, async () => {
        const { world, lea, meeting } = await inState(name);
        expectError(await answer(world, lea, meeting, 'accept'), 409, 'INVALID_TRANSITION');
        assert.equal((await reload(meeting)).status, START[name].status);
      });
    }

    for (const name of ['accepted', 'declined', 'cancelled', 'expired']) {
      it(`refuser une demande ${name} : 409`, async () => {
        const { world, lea, meeting } = await inState(name);
        expectError(await answer(world, lea, meeting, 'decline'), 409, 'INVALID_TRANSITION');
      });
    }

    for (const name of ['declined', 'cancelled', 'expired']) {
      it(`annuler une demande ${name} : 409`, async () => {
        const { world, ines, meeting } = await inState(name);
        expectError(await answer(world, ines, meeting, 'cancel'), 409, 'INVALID_TRANSITION');
      });
    }

    for (const name of ['accepted', 'declined', 'cancelled', 'expired']) {
      it(`contre-proposer à une demande ${name} : 409`, async () => {
        const { world, lea, meeting } = await inState(name);
        expectError(await answer(world, lea, meeting, 'counter', { slotId: world.slots['11h00'].documentId }), 409, 'INVALID_TRANSITION');
      });
    }

    it('annuler deux fois : la seconde annulation reçoit 409', async () => {
      const { world, ines, meeting } = await inState('accepted');
      assert.equal((await answer(world, ines, meeting, 'cancel')).status, 200);
      expectError(await answer(world, ines, meeting, 'cancel'), 409, 'INVALID_TRANSITION');
    });

    it('accepter deux fois : la seconde acceptation reçoit 409', async () => {
      const world = await newEdition();
      const { lea, ines } = await duo(world);
      const meeting = await seed(world, { slot: world.slots['10h45'], requester: ines, target: lea });
      assert.equal((await answer(world, lea, meeting, 'accept')).status, 200);
      expectError(await answer(world, lea, meeting, 'accept'), 409, 'INVALID_TRANSITION');
    });
  });

  describe('A-32 · R-16 : fenêtre fermée et créneau commencé', () => {
    it('A-32 : une demande `pending` ne s’accepte plus après la fermeture, avant même la tâche d’expiration (409 WINDOW_CLOSED)', async () => {
      const world = await newEdition({ window: 'closed' });
      const { lea, ines } = await duo(world);
      const meeting = await seed(world, { slot: world.slots['10h45'], requester: ines, target: lea });
      expectError(await answer(world, lea, meeting, 'accept'), 409, 'WINDOW_CLOSED');
      const row = await reload(meeting);
      assert.equal(row.status, 'pending');
      assert.equal(row.tableKey ?? null, null);
    });

    it('accepter une demande dont le créneau a commencé : 409 SLOT_PAST', async () => {
      const world = await newEdition({ daysAhead: -1 });
      const { lea, ines } = await duo(world);
      const meeting = await seed(world, { slot: world.slots['10h45'], requester: ines, target: lea });
      expectError(await answer(world, lea, meeting, 'accept'), 409, 'SLOT_PAST');
    });

    it('R-16 : annuler un rendez-vous dont le créneau a commencé : 409 SLOT_PAST, le rendez-vous reste accepté', async () => {
      const world = await newEdition({ daysAhead: -1 });
      const { lea, ines } = await duo(world);
      const meeting = await seed(world, { slot: world.slots['10h45'], requester: ines, target: lea, status: 'accepted', tableNumber: 1 });
      expectError(await answer(world, ines, meeting, 'cancel'), 409, 'SLOT_PAST');
      expectError(await answer(world, lea, meeting, 'cancel'), 409, 'SLOT_PAST');
      assert.equal((await reload(meeting)).status, 'accepted');
    });

    it('R-11.5 à l’acceptation : le demandeur déjà pris sur le créneau par un autre rendez-vous reçoit 409 SLOT_TAKEN', async () => {
      const world = await newEdition();
      const { lea, ines } = await duo(world);
      const hugo = await person(world.edition);
      const meeting = await seed(world, { slot: world.slots['10h45'], requester: ines, target: lea });
      await seed(world, { slot: world.slots['10h45'], requester: ines, target: hugo, status: 'accepted', tableNumber: 1 });
      expectError(await answer(world, lea, meeting, 'accept'), 409, 'SLOT_TAKEN');
      assert.equal((await reload(meeting)).status, 'pending');
    });
  });

  describe('refuser (F-61)', () => {
    async function declined(body = { reason: 'Je suis déjà pris à cette heure-là.' }, personFields = {}) {
      const world = await newEdition();
      const lea = await person(world.edition, { firstName: 'Léa', lastName: 'Ducasse' });
      const ines = await person(world.edition, { firstName: 'Inès', lastName: 'Castaing', ...personFields });
      const meeting = await seed(world, { slot: world.slots['10h45'], requester: ines, target: lea });
      const response = await answer(world, lea, meeting, 'decline', body);
      return { world, lea, ines, meeting, response };
    }

    it('200 : le Meeting passe à `declined`, qui a répondu et quand sont notés, aucune table', async () => {
      const { response, lea, meeting } = await declined();
      assert.equal(response.status, 200, response.text);
      assert.equal(response.json.status, 'declined');
      assert.deepEqual([response.json.canAccept, response.json.canDecline, response.json.canCounter, response.json.canCancel], [false, false, false, false]);
      const row = await reload(meeting);
      assert.equal(row.status, 'declined');
      assert.equal(row.answeredBy.documentId, lea.documentId);
      assert.ok(row.answeredAt);
      assert.equal(row.tableKey ?? null, null);
    });

    it('e-mail meeting-declined au demandeur, avec le motif et une invitation à choisir un autre créneau', async () => {
      const { ines } = await declined();
      await W.waitForEmailLogs(app(), ines, 'meeting-declined');
      const mail = mailsTo(ines).at(-1);
      assert.ok(mail.text.includes('Je suis déjà pris à cette heure-là.'));
      assert.ok(mail.text.includes('Léa Ducasse'));
      assert.match(mail.text, /\/espace\/verifier\?token=/);
    });

    it('le motif est facultatif : sans corps, 200', async () => {
      const { response, ines } = await declined({});
      assert.equal(response.status, 200, response.text);
      await W.waitForEmailLogs(app(), ines, 'meeting-declined');
    });

    it('la cible qui refuse ne reçoit pas meeting-declined', async () => {
      const { lea } = await declined();
      assert.equal((await W.settledEmailLogs(app(), lea, 'meeting-declined')).length, 0);
    });

    it('A-33 : meeting-declined part même si le demandeur a désactivé toutes ses préférences', async () => {
      const { ines } = await declined({}, { emailPrefs: { meetingRequests: false, messages: false, reminders: false } });
      await W.waitForEmailLogs(app(), ines, 'meeting-declined');
    });

    it('un représentant refuse au nom de l’exposant', async () => {
      const world = await newEdition();
      const { exhibitor, reps: [r1] } = await stand(world);
      const visitor = await person(world.edition);
      const meeting = await seed(world, { slot: world.slots['10h45'], requester: visitor, exhibitor });
      const response = await answer(world, r1, meeting, 'decline', { reason: 'Stand complet.' });
      assert.equal(response.status, 200, response.text);
      assert.equal((await reload(meeting)).answeredBy.documentId, r1.documentId);
      await W.waitForEmailLogs(app(), visitor, 'meeting-declined');
    });
  });

  describe('T-20 · A-31 : contre-proposition', () => {
    async function counter(body, { label = '11h00' } = {}) {
      const world = await newEdition();
      const { lea, ines } = await duo(world);
      const initial = await seed(world, { slot: world.slots['10h45'], requester: ines, target: lea, message: 'Bonjour Léa.' });
      const response = await answer(world, lea, initial, 'counter', { slotId: world.slots[label].documentId, ...body });
      return { world, lea, ines, initial, response };
    }

    it('201 : la nouvelle demande, dans l’autre sens (Léa vers Inès), `pending`, sur le nouveau créneau', async () => {
      const { response, ines } = await counter({ message: 'Plutôt à 11h00 ?' });
      assert.equal(response.status, 201, response.text);
      assert.deepEqual(Object.keys(response.json).sort(), W.MEETING_KEYS);
      assert.equal(response.json.status, 'pending');
      assert.equal(response.json.direction, 'sent');
      assert.equal(response.json.slot.label, '11h00');
      assert.equal(response.json.message, 'Plutôt à 11h00 ?');
      assert.equal(response.json.counterpart.id, ines.documentId);
    });

    it('en base : la demande initiale est `declined` (qui a répondu), une demande Léa vers Inès existe', async () => {
      const { world, lea, ines, initial, response } = await counter({});
      const old = await reload(initial);
      assert.equal(old.status, 'declined');
      assert.equal(old.answeredBy.documentId, lea.documentId);
      assert.ok(old.answeredAt);
      const rows = await W.meetingsAt(app(), world.edition);
      assert.equal(rows.length, 2);
      const created = rows.find((row) => row.documentId === response.json.id);
      assert.equal(created.requester.documentId, lea.documentId);
      assert.equal(created.targetAttendee.documentId, ines.documentId);
      assert.equal(created.status, 'pending');
    });

    it('seul e-mail : meeting-request à l’ancien demandeur, en variante « nouvelle proposition » avec le créneau précédent ; pas de meeting-declined', async () => {
      const { ines } = await counter({});
      await W.waitForEmailLogs(app(), ines, 'meeting-request');
      const mail = mailsTo(ines).at(-1);
      assert.match(`${mail.subject}\n${mail.text}`, /nouvelle proposition/i);
      assert.ok(mail.text.includes('10h45'), 'le créneau précédent doit être rappelé');
      assert.equal((await W.settledEmailLogs(app(), ines, 'meeting-declined')).length, 0);
    });

    it('Inès retrouve la contre-proposition parmi ses demandes reçues, la demande initiale dans son historique', async () => {
      const { world, ines, initial, response } = await counter({});
      const body = (await (await as(world.edition, ines)).get('/meetings')).json;
      assert.deepEqual(body.received.map((meeting) => meeting.id), [response.json.id]);
      assert.deepEqual(body.closed.map((meeting) => meeting.id), [initial.documentId]);
    });

    it('un échec annule tout : Léa déjà prise au nouveau créneau, 409 SLOT_TAKEN, la demande initiale reste `pending`, aucun e-mail', async () => {
      const world = await newEdition();
      const { lea, ines } = await duo(world);
      const hugo = await person(world.edition);
      const initial = await seed(world, { slot: world.slots['10h45'], requester: ines, target: lea });
      await seed(world, { slot: world.slots['11h00'], requester: lea, target: hugo, status: 'accepted', tableNumber: 1 });
      const response = await answer(world, lea, initial, 'counter', { slotId: world.slots['11h00'].documentId });
      expectError(response, 409, 'SLOT_TAKEN');
      assert.equal((await reload(initial)).status, 'pending');
      assert.equal((await W.meetingsAt(app(), world.edition)).length, 2);
      assert.equal((await W.settledEmailLogs(app(), ines, 'meeting-request', { settleMs: 200 })).length, 0);
    });

    it('un échec annule tout : fenêtre fermée, 409 WINDOW_CLOSED, la demande initiale reste `pending`', async () => {
      const world = await newEdition({ window: 'closed' });
      const { lea, ines } = await duo(world);
      const initial = await seed(world, { slot: world.slots['10h45'], requester: ines, target: lea });
      expectError(await answer(world, lea, initial, 'counter', { slotId: world.slots['11h00'].documentId }), 409, 'WINDOW_CLOSED');
      assert.equal((await reload(initial)).status, 'pending');
    });

    it('A-31 : pas de contre-proposition d’un exposant, 409 COUNTER_UNAVAILABLE, la demande reste `pending`', async () => {
      const world = await newEdition();
      const { exhibitor, reps: [r1] } = await stand(world);
      const visitor = await person(world.edition);
      const initial = await seed(world, { slot: world.slots['10h45'], requester: visitor, exhibitor });
      expectError(await answer(world, r1, initial, 'counter', { slotId: world.slots['11h00'].documentId }), 409, 'COUNTER_UNAVAILABLE');
      assert.equal((await reload(initial)).status, 'pending');
      assert.equal((await W.meetingsAt(app(), world.edition)).length, 1);
    });

    it('400 VALIDATION : créneau absent, message de plus de 300 caractères ; 404 SLOT_NOT_FOUND : créneau inconnu', async () => {
      const world = await newEdition();
      const { lea, ines } = await duo(world);
      const initial = await seed(world, { slot: world.slots['10h45'], requester: ines, target: lea });
      expectError(await answer(world, lea, initial, 'counter', {}), 400, 'VALIDATION');
      expectError(await answer(world, lea, initial, 'counter', { slotId: world.slots['11h00'].documentId, message: 'x'.repeat(301) }), 400, 'VALIDATION');
      expectError(await answer(world, lea, initial, 'counter', { slotId: 'inconnu0000000000000000' }), 404, 'SLOT_NOT_FOUND');
      assert.equal((await reload(initial)).status, 'pending');
    });

    it('404 SLOT_NOT_FOUND : créneau d’une autre édition', async () => {
      const world = await newEdition();
      const other = await newEdition();
      const { lea, ines } = await duo(world);
      const initial = await seed(world, { slot: world.slots['10h45'], requester: ines, target: lea });
      expectError(await answer(world, lea, initial, 'counter', { slotId: other.slots['11h00'].documentId }), 404, 'SLOT_NOT_FOUND');
    });
  });

  describe('T-21 · R-16 : annuler', () => {
    async function acceptedBetween() {
      const world = await newEdition();
      const { lea, ines } = await duo(world);
      const meeting = await seed(world, { slot: world.slots['10h45'], requester: ines, target: lea, status: 'accepted', tableNumber: 1 });
      return { world, lea, ines, meeting };
    }

    it('le demandeur annule un rendez-vous accepté : `cancelled`, table libérée (tableKey nul), date et motif notés', async () => {
      const { world, ines, meeting } = await acceptedBetween();
      const response = await answer(world, ines, meeting, 'cancel', { reason: 'Empêchement de dernière minute.' });
      assert.equal(response.status, 200, response.text);
      assert.equal(response.json.status, 'cancelled');
      assert.deepEqual([response.json.canAccept, response.json.canDecline, response.json.canCounter, response.json.canCancel], [false, false, false, false]);
      const row = await reload(meeting);
      assert.equal(row.status, 'cancelled');
      assert.equal(row.tableKey ?? null, null);
      assert.ok(row.cancelledAt);
      assert.equal(row.cancelReason, 'Empêchement de dernière minute.');
      assert.ok(world);
    });

    it('la cible peut annuler aussi ; l’autre partie reçoit meeting-cancelled avec le motif, pas celle qui annule (T-21)', async () => {
      const { world, lea, ines, meeting } = await acceptedBetween();
      assert.equal((await answer(world, lea, meeting, 'cancel', { reason: 'Salle indisponible.' })).status, 200);
      await W.waitForEmailLogs(app(), ines, 'meeting-cancelled');
      assert.ok(mailsTo(ines).at(-1).text.includes('Salle indisponible.'));
      assert.equal((await W.settledEmailLogs(app(), lea, 'meeting-cancelled')).length, 0);
    });

    it('le créneau annulé redevient disponible dans la grille de la cible', async () => {
      const { world, lea, ines, meeting } = await acceptedBetween();
      const hugo = await person(world.edition);
      await answer(world, ines, meeting, 'cancel');
      const { json } = await (await as(world.edition, hugo)).get(`/slots?target=p:${lea.documentId}`);
      assert.equal(json.groups.flatMap((group) => group.slots).find((slot) => slot.label === '10h45').state, 'available');
    });

    it('F-63 : annuler une demande envoyée (`pending`) : `cancelled` et la cible en est informée', async () => {
      const world = await newEdition();
      const { lea, ines } = await duo(world);
      const meeting = await seed(world, { slot: world.slots['10h45'], requester: lea, target: ines });
      const response = await answer(world, lea, meeting, 'cancel');
      assert.equal(response.status, 200, response.text);
      assert.equal((await reload(meeting)).status, 'cancelled');
      await W.waitForEmailLogs(app(), ines, 'meeting-cancelled');
    });

    it('A-33 : meeting-cancelled part même si l’autre partie a désactivé toutes ses préférences', async () => {
      const world = await newEdition();
      const lea = await person(world.edition);
      const ines = await person(world.edition, { emailPrefs: { meetingRequests: false, messages: false, reminders: false } });
      const meeting = await seed(world, { slot: world.slots['10h45'], requester: lea, target: ines, status: 'accepted', tableNumber: 1 });
      await answer(world, lea, meeting, 'cancel');
      await W.waitForEmailLogs(app(), ines, 'meeting-cancelled');
    });

    it('rendez-vous au stand annulé par le visiteur : les représentants actifs sont informés', async () => {
      const world = await newEdition();
      const { exhibitor, reps: [r1, r2] } = await stand(world);
      const visitor = await person(world.edition);
      const inactive = await person(world.edition, { role: 'exhibitor_rep', exhibitor: { documentId: exhibitor.documentId }, status: 'cancelled' });
      const meeting = await seed(world, { slot: world.slots['10h45'], requester: visitor, exhibitor, status: 'accepted', answeredBy: r1 });
      assert.equal((await answer(world, visitor, meeting, 'cancel')).status, 200);
      await W.waitForEmailLogs(app(), r1, 'meeting-cancelled');
      await W.waitForEmailLogs(app(), r2, 'meeting-cancelled');
      assert.equal((await logs(inactive, 'meeting-cancelled')).length, 0);
    });
  });

  describe('R-19 : réservation d’une table dédiée', () => {
    async function hosted(options = {}) {
      const world = await newEdition(options);
      const host = await person(world.edition, { firstName: 'Antoine', lastName: 'Vergnes', role: 'speaker', hostedTableNumber: 2, meetingsOptIn: false, directoryOptIn: false });
      const hugo = await person(world.edition, { firstName: 'Hugo', lastName: 'Peyrat' });
      return { world, host, hugo };
    }
    const book = async (world, who, host, label = '10h45') => (await as(world.edition, who)).post('/meetings', { slotId: world.slots[label].documentId, target: `p:${host.documentId}` });

    it('201 : le rendez-vous est créé `accepted` d’emblée, lieu « Table 2 », sans demande ni validation', async () => {
      const { world, host, hugo } = await hosted();
      const response = await book(world, hugo, host);
      assert.equal(response.status, 201, response.text);
      assert.equal(response.json.status, 'accepted');
      assert.equal(response.json.location, 'Table 2');
      assert.equal(response.json.direction, 'sent');
      assert.equal(response.json.counterpart.id, host.documentId);
      assert.equal(response.json.counterpart.hostedTableNumber, 2);
      assert.equal(response.json.canCancel, true);
      assert.deepEqual(W.leaks(response.text), []);
    });

    it('en base : table 2, clé {créneau}:2, `answeredAt` posé, `answeredBy` vide', async () => {
      const { world, host, hugo } = await hosted();
      const { json } = await book(world, hugo, host);
      const row = await reload({ documentId: json.id });
      assert.equal(row.status, 'accepted');
      assert.equal(row.tableNumber, 2);
      assert.equal(row.tableKey, `${world.slots['10h45'].documentId}:2`);
      assert.equal(row.location, 'Table 2');
      assert.ok(row.answeredAt, 'answeredAt manque');
      assert.equal(row.answeredBy ?? null, null);
      assert.equal(row.targetAttendee.documentId, host.documentId);
    });

    it('A-33 : meeting-accepted aux deux, .ics joint ; aucun meeting-request', async () => {
      const { world, host, hugo } = await hosted();
      await book(world, hugo, host);
      for (const who of [hugo, host]) {
        await W.waitForEmailLogs(app(), who, 'meeting-accepted');
        const [attachment] = mailsTo(who).at(-1).attachments;
        assert.match(attachment.filename, /\.ics$/);
        assert.deepEqual(validateIcs(Buffer.from(attachment.content, 'base64').toString('utf8')), []);
      }
      assert.equal((await W.settledEmailLogs(app(), host, 'meeting-request', { settleMs: 100 })).length, 0);
    });

    it('R-19.2 : le créneau déjà réservé donne 409 TARGET_BUSY à un autre participant ; un autre créneau reste libre', async () => {
      const { world, host, hugo } = await hosted();
      const other = await person(world.edition);
      assert.equal((await book(world, hugo, host)).status, 201);
      expectError(await book(world, other, host), 409, 'TARGET_BUSY');
      assert.equal((await book(world, other, host, '11h00')).status, 201);
    });

    it('R-19.2 : un second rendez-vous à venir avec le même hôte donne 409 ALREADY_REQUESTED', async () => {
      const { world, host, hugo } = await hosted();
      assert.equal((await book(world, hugo, host)).status, 201);
      expectError(await book(world, hugo, host, '11h00'), 409, 'ALREADY_REQUESTED');
    });

    it('R-19.2 : le participant déjà pris sur le créneau reçoit 409 SLOT_TAKEN', async () => {
      const { world, host, hugo } = await hosted();
      const ines = await person(world.edition);
      await seed(world, { slot: world.slots['10h45'], requester: hugo, target: ines, status: 'accepted', tableNumber: 1 });
      expectError(await book(world, hugo, host), 409, 'SLOT_TAKEN');
    });

    it('R-19.3 : l’intervenant reste à sa table, il n’envoie pas de demande (409 HOST_AT_TABLE)', async () => {
      const { world, host, hugo } = await hosted();
      const response = await (await as(world.edition, host)).post('/meetings', { slotId: world.slots['10h45'].documentId, target: `p:${hugo.documentId}` });
      expectError(response, 409, 'HOST_AT_TABLE');
    });

    it('R-19.4 : annulation par le participant ou par l’hôte, qui libère le créneau ; l’autre partie reçoit meeting-cancelled', async () => {
      const { world, host, hugo } = await hosted();
      const other = await person(world.edition);
      const first = (await book(world, hugo, host)).json;
      assert.equal((await answer(world, hugo, { documentId: first.id }, 'cancel')).status, 200);
      await W.waitForEmailLogs(app(), host, 'meeting-cancelled');
      const second = (await book(world, other, host)).json;
      assert.equal(second.status, 'accepted', 'le créneau libéré se réserve de nouveau');
      assert.equal((await answer(world, host, { documentId: second.id }, 'cancel')).status, 200);
      await W.waitForEmailLogs(app(), other, 'meeting-cancelled');
      assert.equal((await reload({ documentId: second.id })).tableKey ?? null, null);
    });

    it('R-03 · T-26 : la réservation à la table 2 ne consomme pas le lot commun, les 1-to-1 prennent encore les tables 1 et 3', async () => {
      const { world, host, hugo } = await hosted();
      assert.equal((await book(world, hugo, host)).status, 201);
      const got = [];
      for (let index = 0; index < 3; index += 1) {
        const [requester, target] = [await person(world.edition), await person(world.edition)];
        const meeting = await seed(world, { slot: world.slots['10h45'], requester, target });
        const response = await answer(world, target, meeting, 'accept');
        got.push(response.status === 200 ? response.json.location : `${response.status} ${response.json.error.code}`);
      }
      assert.deepEqual(got, ['Table 1', 'Table 3', '409 NO_TABLE_LEFT']);
    });

    it('R-17 : fenêtre fermée, la réservation est refusée (409 WINDOW_CLOSED)', async () => {
      const { world, host, hugo } = await hosted({ window: 'closed' });
      expectError(await book(world, hugo, host), 409, 'WINDOW_CLOSED');
    });

    it('A-29 : deux intervenants sur la même table, le plus ancien la garde, l’autre n’est pas réservable (il n’a pas coché meetingsOptIn)', async () => {
      const world = await newEdition();
      const keeper = await person(world.edition, { role: 'speaker', hostedTableNumber: 2, meetingsOptIn: false });
      const loser = await person(world.edition, { role: 'speaker', hostedTableNumber: 2, meetingsOptIn: false });
      const hugo = await person(world.edition);
      assert.equal((await book(world, hugo, keeper)).status, 201);
      expectError(await book(world, await person(world.edition), loser, '11h00'), 409, 'TARGET_UNAVAILABLE');
    });

    it('A-29 : un numéro hors de 1 à tablesCount est ignoré, l’intervenant n’est pas réservable', async () => {
      const world = await newEdition();
      const invalid = await person(world.edition, { role: 'speaker', hostedTableNumber: 9, meetingsOptIn: false });
      expectError(await book(world, await person(world.edition), invalid), 409, 'TARGET_UNAVAILABLE');
    });
  });

  describe('A-33 : les e-mails répondent à un acte et partent malgré les préférences', () => {
    it('meeting-accepted part même si le demandeur a désactivé toutes ses préférences', async () => {
      const world = await newEdition();
      const lea = await person(world.edition);
      const ines = await person(world.edition, { emailPrefs: { meetingRequests: false, messages: false, reminders: false } });
      const meeting = await seed(world, { slot: world.slots['10h45'], requester: ines, target: lea });
      await answer(world, lea, meeting, 'accept');
      await W.waitForEmailLogs(app(), ines, 'meeting-accepted');
    });

    it('EmailLog : un enregistrement par e-mail envoyé, rattaché à l’Attendee destinataire, statut « sent »', async () => {
      const world = await newEdition();
      const { lea, ines } = await duo(world);
      const meeting = await seed(world, { slot: world.slots['10h45'], requester: ines, target: lea });
      await answer(world, lea, meeting, 'accept');
      const [log] = await W.waitForEmailLogs(app(), ines, 'meeting-accepted');
      assert.equal(log.status, 'sent');
      assert.ok(log.sentAt);
      const all = await app().db.query(UID.emailLog).findMany({ where: { template: 'meeting-accepted', attendee: { documentId: ines.documentId } } });
      assert.equal(all.length, 1);
    });
  });
});
