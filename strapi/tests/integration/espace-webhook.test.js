'use strict';

/**
 * Webhook HelloAsso, lot V5-E (I-13, NF-03, NF-11) : POST /api/espace/webhooks/helloasso, contre le faux HelloAsso.
 *   - 200 { status: 'accepted' | 'ignored' } sans contrôle d'origine ni session ; 429 au-delà de 60 par minute et par IP ;
 *   - seul `eventType = Order` avec un `data.id` numérique est suivi, et seul cet identifiant sert : la commande est relue
 *     sur le faux (GET /orders/{id}) puis importée de façon asynchrone par le chemin de la synchronisation ;
 *   - aucune édition publiée dont le formulaire correspond : sans effet.
 * Chaque test a son propre formulaire (`helloassoFormSlug`) pour que les éditions de la suite ne se croisent pas.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildItem } = require('../../scripts/espace/fake-helloasso');
const { freshIp, sleep, useEspace } = require('../helpers/espace');
const { UID, createEdition } = require('../helpers/espace-data');

const URL_PATH = '/api/espace/webhooks/helloasso';
let counter = 0;

describe('webhook HelloAsso contre le faux (V5-E, I-13)', { timeout: 300_000 }, () => {
  const espace = useEspace({ fake: { items: [] } });
  const app = () => espace().app;
  const fake = () => espace().fake;

  /** Édition à son formulaire propre et billets du faux rattachés à ce formulaire. `tickets` : [{ id, email, firstName, lastName }]. */
  async function scene({ tickets = [], draft = false } = {}) {
    counter += 1;
    const formSlug = `webhook-${counter}`;
    const edition = await createEdition(app(), { slug: formSlug, title: `Webhook ${counter}`, draft, settings: { helloassoFormSlug: formSlug } });
    const base = 7000 + counter * 100;
    const items = tickets.map(({ email, firstName, lastName, ...rest }, index) => {
      const item = buildItem({
        id: base + index + 1,
        firstName,
        lastName,
        payer: { email },
        answers: { 'Accès PMR': 'Non', Organisation: 'Entreprise Fictive', Poste: 'Responsable', Email: email },
        ...rest,
      });
      item.order.formSlug = formSlug;
      return item;
    });
    return { edition, formSlug, items, orderOf: (index) => String(items[index].order.id) };
  }
  const publish = (...scenes) => fake().setItems(scenes.flatMap((one) => one.items));
  const post = (json, options = {}) => espace().request(URL_PATH, { method: 'POST', json, origin: null, ...options });
  const order = (id, extra = {}) => ({ eventType: 'Order', data: { id: Number(id), ...extra } });
  const attendeesOf = (edition) => app().documents(UID.attendee).findMany({ filters: { edition: { documentId: edition.documentId } }, limit: 1000 });
  const emails = async (edition) => (await attendeesOf(edition)).map((attendee) => attendee.email).sort();
  const reads = () => fake().stats().orderRequests;

  /** Attend que la relecture de la commande ait eu lieu, puis laisse l'import se terminer. */
  async function settled(since) {
    const deadline = Date.now() + 8000;
    while (reads() <= since && Date.now() < deadline) await sleep(25);
    await sleep(700);
  }

  async function waitFor(check, { timeout = 8000 } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const value = await check();
      if (value) return value;
      if (Date.now() > deadline) assert.fail('condition non atteinte à temps');
      await sleep(50);
    }
  }

  describe('commande valable (critère 3)', () => {
    it('200 { status: "accepted" } sans origine, sans session ni cookie ; Cache-Control no-store', async () => {
      const one = await scene({ tickets: [{ email: 'accepte@example.org', firstName: 'Alix', lastName: 'Accepté' }] });
      publish(one);
      const since = reads();
      const response = await post(order(one.orderOf(0)));
      assert.equal(response.status, 200, response.text);
      assert.deepEqual(response.json, { status: 'accepted' });
      assert.equal(response.headers.get('cache-control'), 'no-store');
      await settled(since);
    });

    it('relit la commande sur HelloAsso et l’importe : un Attendee actif créé avec les champs du faux', async () => {
      const one = await scene({ tickets: [{ email: 'alix.relue@example.org', firstName: 'Alix', lastName: 'Relue' }] });
      publish(one);
      const since = reads();
      assert.equal((await post(order(one.orderOf(0)))).status, 200);
      await waitFor(async () => (await attendeesOf(one.edition)).length === 1);
      assert.equal(reads(), since + 1, 'une seule relecture de la commande');
      const [attendee] = await attendeesOf(one.edition);
      assert.deepEqual([attendee.email, attendee.firstName, attendee.lastName, attendee.company, attendee.status], ['alix.relue@example.org', 'Alix', 'Relue', 'Entreprise Fictive', 'active']);
      assert.equal(String(attendee.helloassoItemId), String(one.items[0].id));
    });

    it('répond avant la fin de l’import : la réponse n’attend pas la relecture (traitement en tâche de fond)', async () => {
      const one = await scene({ tickets: [{ email: 'rapide@example.org', firstName: 'Rémi', lastName: 'Rapide' }] });
      publish(one);
      const since = reads();
      const response = await post(order(one.orderOf(0)));
      assert.equal(response.status, 200);
      await settled(since);
      assert.deepEqual(await emails(one.edition), ['rapide@example.org']);
    });

    it('une commande de plusieurs billets les importe tous, une seule relecture', async () => {
      const one = await scene({ tickets: [{ email: 'un@example.org', firstName: 'Un', lastName: 'Premier' }, { email: 'deux@example.org', firstName: 'Deux', lastName: 'Second' }] });
      one.items[1].order.id = one.items[0].order.id;
      publish(one);
      const since = reads();
      await post(order(one.orderOf(0)));
      await waitFor(async () => (await attendeesOf(one.edition)).length === 2);
      assert.equal(reads(), since + 1);
      assert.deepEqual(await emails(one.edition), ['deux@example.org', 'un@example.org']);
    });

    it('seul l’identifiant du corps sert : une commande inventée dans le corps n’est jamais importée, seule la version du faux l’est', async () => {
      const one = await scene({ tickets: [{ email: 'vraie@example.org', firstName: 'Vrai', lastName: 'Billet' }] });
      publish(one);
      const forged = {
        eventType: 'Order',
        data: {
          id: Number(one.orderOf(0)),
          formSlug: one.formSlug,
          payer: { firstName: 'Faux', lastName: 'Payeur', email: 'intrus@example.org' },
          items: [{ id: 999001, state: 'Processed', user: { firstName: 'Faux', lastName: 'Billet' }, customFields: [{ name: 'Email', answer: 'intrus@example.org' }], order: { id: Number(one.orderOf(0)) } }],
        },
        items: [{ id: 999002, user: { firstName: 'Autre', lastName: 'Faux' }, customFields: [{ name: 'Email', answer: 'intrus2@example.org' }] }],
      };
      const since = reads();
      assert.equal((await post(forged)).status, 200);
      await waitFor(async () => (await attendeesOf(one.edition)).length >= 1);
      await settled(since);
      assert.deepEqual(await emails(one.edition), ['vraie@example.org']);
      const everyone = JSON.stringify(await app().documents(UID.attendee).findMany({ limit: 10000 }));
      assert.ok(!/intrus/.test(everyone), 'donnée du corps importée');
    });

    it('un identifiant de commande inconnu du faux (404) : 200 accepted, rien d’importé, aucune erreur côté appelant', async () => {
      const one = await scene({ tickets: [{ email: 'present@example.org', firstName: 'Pia', lastName: 'Presente' }] });
      publish(one);
      const since = reads();
      const response = await post(order(999999999));
      assert.equal(response.status, 200);
      assert.deepEqual(response.json, { status: 'accepted' });
      await settled(since);
      assert.deepEqual(await emails(one.edition), []);
    });

    it('idempotent : la même notification deux fois ne crée qu’un Attendee, et la synchronisation qui suit ne crée rien', async () => {
      const one = await scene({ tickets: [{ email: 'idem@example.org', firstName: 'Ida', lastName: 'Idem' }] });
      publish(one);
      await post(order(one.orderOf(0)));
      await post(order(one.orderOf(0)));
      await waitFor(async () => (await attendeesOf(one.edition)).length >= 1);
      await sleep(800);
      assert.deepEqual(await emails(one.edition), ['idem@example.org']);
      const run = await app().service('api::espace.sync').run(one.edition.documentId);
      assert.deepEqual([run.created, run.updated, run.cancelled], [0, 0, 0]);
    });

    it('une commande modifiée chez HelloAsso met à jour l’Attendee existant', async () => {
      const one = await scene({ tickets: [{ email: 'maj@example.org', firstName: 'Mia', lastName: 'Avant' }] });
      publish(one);
      await post(order(one.orderOf(0)));
      await waitFor(async () => (await attendeesOf(one.edition)).length === 1);
      fake().updateItem(one.items[0].id, { user: { firstName: 'Mia', lastName: 'Après' }, customFields: one.items[0].customFields.map((field) => (field.name === 'Organisation' ? { ...field, answer: 'Nouvelle Entreprise' } : field)) });
      await post(order(one.orderOf(0)));
      await waitFor(async () => (await attendeesOf(one.edition))[0].company === 'Nouvelle Entreprise');
      const [attendee] = await attendeesOf(one.edition);
      assert.equal(attendee.lastName, 'Après');
    });

    it('une commande remboursée annule ce seul billet : les autres participants de l’édition restent actifs', async () => {
      const one = await scene({
        tickets: [{ email: 'reste@example.org', firstName: 'Rose', lastName: 'Reste' }, { email: 'rembourse@example.org', firstName: 'Remi', lastName: 'Rembourse' }],
      });
      publish(one);
      await app().service('api::espace.sync').run(one.edition.documentId);
      assert.equal((await attendeesOf(one.edition)).length, 2);
      fake().updateItem(one.items[1].id, { payments: [{ id: 1, shareAmount: 3000, state: 'Refunded' }] });
      const since = reads();
      await post(order(one.orderOf(1)));
      await settled(since);
      const byEmail = Object.fromEntries((await attendeesOf(one.edition)).map((attendee) => [attendee.email, attendee.status]));
      assert.deepEqual(byEmail, { 'reste@example.org': 'active', 'rembourse@example.org': 'cancelled' });
    });

    it('l’édition fermée (espace désactivé) reçoit aussi ses inscriptions, comme la synchronisation planifiée', async () => {
      const one = await scene({ tickets: [{ email: 'ferme@example.org', firstName: 'Fanny', lastName: 'Fermee' }] });
      await app().documents(UID.edition).update({ documentId: one.edition.documentId, data: { participantSpaceEnabled: false }, status: 'published' });
      publish(one);
      await post(order(one.orderOf(0)));
      await waitFor(async () => (await attendeesOf(one.edition)).length === 1);
    });

    it('deux éditions publiées au même formulaire HelloAsso reçoivent chacune le billet', async () => {
      const one = await scene({ tickets: [{ email: 'double@example.org', firstName: 'Dora', lastName: 'Double' }] });
      const twin = await createEdition(app(), { slug: `${one.formSlug}-bis`, title: 'Jumelle', settings: { helloassoFormSlug: one.formSlug } });
      publish(one);
      await post(order(one.orderOf(0)));
      await waitFor(async () => (await attendeesOf(one.edition)).length === 1 && (await attendeesOf(twin)).length === 1);
    });
  });

  describe('sans édition correspondante : sans effet (I-13)', () => {
    it('formulaire HelloAsso inconnu de toute édition : la commande est relue mais rien n’est importé', async () => {
      const one = await scene({ tickets: [{ email: 'orphelin@example.org', firstName: 'Olga', lastName: 'Orpheline' }] });
      one.items[0].order.formSlug = 'formulaire-sans-edition';
      publish(one);
      const before = await app().documents(UID.attendee).count({});
      const since = reads();
      const response = await post(order(one.orderOf(0)));
      assert.equal(response.status, 200);
      await settled(since);
      assert.equal(await app().documents(UID.attendee).count({}), before);
      assert.equal(await app().documents(UID.attendee).count({ filters: { email: 'orphelin@example.org' } }), 0);
    });

    it('édition en brouillon seulement : rien n’est importé', async () => {
      const one = await scene({ draft: true, tickets: [{ email: 'brouillon@example.org', firstName: 'Bruno', lastName: 'Brouillon' }] });
      publish(one);
      const since = reads();
      assert.equal((await post(order(one.orderOf(0)))).status, 200);
      await settled(since);
      assert.deepEqual(await emails(one.edition), []);
    });

    it('formulaire d’un autre organisme ou d’un autre type : rien n’est importé', async () => {
      const one = await scene({ tickets: [{ email: 'autre.org@example.org', firstName: 'Aude', lastName: 'Autre' }] });
      one.items[0].order.organizationSlug = 'autre-organisme';
      publish(one);
      const since = reads();
      await post(order(one.orderOf(0)));
      await settled(since);
      assert.deepEqual(await emails(one.edition), []);
    });
  });

  describe('autre type d’événement ou corps inexploitable : 200 ignored, sans effet (critère 4)', () => {
    async function ignored(body, label) {
      const one = await scene({ tickets: [{ email: `ignore.${(counter += 1)}@example.org`, firstName: 'Ines', lastName: 'Ignoree' }] });
      publish(one);
      const since = reads();
      const response = await post(typeof body === 'function' ? body(one) : body);
      assert.equal(response.status, 200, `${label} : ${response.text}`);
      assert.deepEqual(response.json, { status: 'ignored' }, label);
      await sleep(500);
      assert.equal(reads(), since, `${label} : la commande n’aurait pas dû être relue`);
      assert.deepEqual(await emails(one.edition), [], label);
    }

    for (const eventType of ['Payment', 'Form', 'Organization', 'Refund', 'Ticket', 'order', 'ORDER', '']) {
      it(`eventType « ${eventType} » : 200 ignored, aucune relecture, aucun import`, async () => {
        await ignored((one) => ({ eventType, data: { id: Number(one.orderOf(0)) } }), eventType);
      });
    }

    it('sans eventType : ignoré', async () => {
      await ignored((one) => ({ data: { id: Number(one.orderOf(0)) } }), 'sans eventType');
    });

    it('eventType Order sans data, ou sans identifiant : ignoré', async () => {
      await ignored({ eventType: 'Order' }, 'sans data');
      await ignored({ eventType: 'Order', data: {} }, 'sans id');
      await ignored({ eventType: 'Order', data: null }, 'data nul');
    });

    for (const id of ['abc', '12; drop table', '../orders/1', '1.5', '-3', '1234567890123456', '12 34']) {
      it(`identifiant de commande non numérique ou démesuré « ${id} » : ignoré`, async () => {
        await ignored({ eventType: 'Order', data: { id } }, id);
      });
    }

    it('identifiant en objet ou en tableau : ignoré', async () => {
      await ignored({ eventType: 'Order', data: { id: { $ne: 0 } } }, 'objet');
      await ignored({ eventType: 'Order', data: { id: [1, 2] } }, 'tableau');
    });

    it('corps qui est un tableau : ignoré ; un texte ou un nombre JSON est refusé par l’analyseur de Strapi (400), jamais par un 500', async () => {
      await ignored([{ eventType: 'Order', data: { id: 1 } }], 'tableau');
      for (const body of ['Order', 42]) {
        const response = await post(body);
        assert.equal(response.status, 400, String(body));
      }
    });

    it('corps vide ou JSON invalide : jamais un 500, jamais d’import', async () => {
      const empty = await espace().request(URL_PATH, { method: 'POST', origin: null });
      assert.ok(empty.status < 500, `corps vide : ${empty.status}`);
      const broken = await espace().request(URL_PATH, { method: 'POST', origin: null, headers: { 'content-type': 'application/json' } });
      assert.ok(broken.status < 500, `JSON absent : ${broken.status}`);
    });
  });

  describe('accès sans contrôle d’origine ni session (I-13)', () => {
    it('une origine étrangère ou aucune origine : même réponse 200', async () => {
      const without = await post({ eventType: 'Payment' }, { origin: null });
      const foreign = await post({ eventType: 'Payment' }, { origin: 'https://helloasso.example.org' });
      assert.deepEqual([without.status, foreign.status], [200, 200]);
      assert.deepEqual([without.json, foreign.json], [{ status: 'ignored' }, { status: 'ignored' }]);
    });

    it('la route n’expose ni cookie de session ni donnée : le corps n’a que `status`', async () => {
      const response = await post({ eventType: 'Payment' });
      assert.deepEqual(Object.keys(response.json), ['status']);
      assert.deepEqual(response.setCookies, []);
    });

    it('seule la méthode POST est servie : GET ne renvoie jamais 200', async () => {
      const response = await espace().request(URL_PATH);
      assert.notEqual(response.status, 200);
    });
  });

  describe('limite de débit (NF-03)', () => {
    it('60 notifications par minute et par IP, la 61e répond 429 RATE_LIMITED ; une autre IP n’est pas touchée', async () => {
      const ip = freshIp();
      const statuses = [];
      for (let i = 0; i < 61; i += 1) statuses.push((await post({ eventType: 'Payment' }, { ip })).status);
      assert.deepEqual(statuses.slice(0, 60), Array(60).fill(200));
      assert.equal(statuses[60], 429);
      const refused = await post({ eventType: 'Order', data: { id: 1 } }, { ip });
      assert.equal(refused.status, 429);
      assert.equal(refused.json.error.code, 'RATE_LIMITED');
      assert.equal((await post({ eventType: 'Payment' }, { ip: freshIp() })).status, 200);
    });

    it('une notification refusée par la limite ne déclenche aucune relecture de commande', async () => {
      const one = await scene({ tickets: [{ email: 'limite@example.org', firstName: 'Lou', lastName: 'Limite' }] });
      publish(one);
      const ip = freshIp();
      for (let i = 0; i < 60; i += 1) await post({ eventType: 'Payment' }, { ip });
      const since = reads();
      assert.equal((await post(order(one.orderOf(0)), { ip })).status, 429);
      await sleep(500);
      assert.equal(reads(), since);
      assert.deepEqual(await emails(one.edition), []);
    });
  });

  describe('aucune donnée du corps dans les journaux (NF-11)', () => {
    it('l’adresse et le nom du corps ne sont écrits dans aucun journal, importés ou non', async () => {
      const one = await scene({ tickets: [{ email: 'journal@example.org', firstName: 'Jade', lastName: 'Journal' }] });
      publish(one);
      const chunks = [];
      const out = process.stdout.write;
      const err = process.stderr.write;
      const previousLevel = app().log.level;
      process.stdout.write = (chunk, ...rest) => (chunks.push(String(chunk)), out.call(process.stdout, chunk, ...rest));
      process.stderr.write = (chunk, ...rest) => (chunks.push(String(chunk)), err.call(process.stderr, chunk, ...rest));
      app().log.level = 'debug';
      try {
        const since = reads();
        await post({ eventType: 'Order', data: { id: Number(one.orderOf(0)), payer: { email: 'corps.secret@example.org', firstName: 'Secrete' } } });
        await post({ eventType: 'Order', data: { id: 999999998, payer: { email: 'corps.secret2@example.org' } } });
        await settled(since);
      } finally {
        app().log.level = previousLevel;
        process.stdout.write = out;
        process.stderr.write = err;
      }
      const log = chunks.join('');
      assert.ok(log.includes(URL_PATH), 'le journal des requêtes était bien ouvert');
      assert.ok(!/corps\.secret|Secrete/.test(log), 'donnée du corps dans le journal');
    });
  });
});
