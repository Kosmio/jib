'use strict';

/**
 * Faux HelloAsso API v5 (A-12, I-10, I-11, I-13, I-14, Q-03, Q-15, Q-17, NF-11) : jeton et expiration, refresh à
 * usage unique, pagination, withDetails, champs par tarif, commandes, pilotage par les tests, statistiques.
 * Serveur local sur un port libre, aucune dépendance, aucun appel hors localhost.
 */

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const { startFakeHelloAsso, buildItem, buildEdgeCaseItems, FORM, REGION_TARIFF } = require('../../scripts/espace/fake-helloasso');
const defaultItems = require('../../scripts/espace/fixtures/helloasso-items.json');

const ITEMS_PATH = `/organizations/${FORM.organizationSlug}/forms/${FORM.formType}/${FORM.formSlug}/items`;

/** Démarre un faux serveur pour la durée d'une suite et offre des raccourcis d'appel. */
function useFake(options) {
  const ctx = {};
  beforeEach(async () => {
    ctx.fake = await startFakeHelloAsso(options);
    ctx.token = async () => (await ctx.requestToken()).json.access_token;
    ctx.requestToken = async (fields = { grant_type: 'client_credentials', client_id: 'id', client_secret: 'secret' }) => {
      const response = await fetch(`${ctx.fake.origin}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
      });
      return { status: response.status, json: await response.json() };
    };
    ctx.get = async (pathname, token) => {
      const response = await fetch(`${ctx.fake.apiBase}${pathname}`, token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } });
      return { status: response.status, json: await response.json() };
    };
    ctx.items = async (query = '') => ctx.get(`${ITEMS_PATH}${query}`, await ctx.token());
  });
  afterEach(async () => {
    await ctx.fake.close();
  });
  return ctx;
}

/** Parcourt toutes les pages et renvoie la liste des billets. */
async function readAllPages(ctx, query = 'pageSize=20&withDetails=true') {
  const token = await ctx.token();
  const pages = [];
  let continuationToken;
  for (;;) {
    const suffix = continuationToken ? `&continuationToken=${encodeURIComponent(continuationToken)}` : '';
    const { status, json } = await ctx.get(`${ITEMS_PATH}?${query}${suffix}`, token);
    assert.equal(status, 200);
    pages.push(json);
    if (!json.data.length) return pages;
    continuationToken = json.pagination.continuationToken;
  }
}

describe('faux HelloAsso : jeton (I-10)', () => {
  const ctx = useFake({ tokenTtlSeconds: 1800 });

  it('délivre un jeton pour tout couple client_id / client_secret non vide', async () => {
    const { status, json } = await ctx.requestToken();
    assert.equal(status, 200);
    assert.equal(json.token_type, 'bearer');
    assert.equal(json.expires_in, 1800);
    assert.match(json.access_token, /^[0-9a-f]{48}$/);
    assert.match(json.refresh_token, /^[0-9a-f]{48}$/);
    assert.notEqual(json.access_token, json.refresh_token);
  });

  it('délivre des jetons différents à chaque demande', async () => {
    const first = await ctx.requestToken();
    const second = await ctx.requestToken();
    assert.notEqual(first.json.access_token, second.json.access_token);
  });

  for (const [label, fields] of [
    ['client_id vide', { grant_type: 'client_credentials', client_id: '', client_secret: 'secret' }],
    ['client_secret vide', { grant_type: 'client_credentials', client_id: 'id', client_secret: '' }],
    ['sans identifiants', { grant_type: 'client_credentials' }],
  ]) {
    it(`refuse ${label} (400 invalid_client)`, async () => {
      const { status, json } = await ctx.requestToken(fields);
      assert.equal(status, 400);
      assert.equal(json.error, 'invalid_client');
    });
  }

  it('refuse un type d’autorisation inconnu (400 unsupported_grant_type)', async () => {
    const { status, json } = await ctx.requestToken({ grant_type: 'password', client_id: 'id', client_secret: 'secret' });
    assert.equal(status, 400);
    assert.equal(json.error, 'unsupported_grant_type');
  });

  it('renouvelle par refresh_token', async () => {
    const first = await ctx.requestToken();
    const renewed = await ctx.requestToken({ grant_type: 'refresh_token', refresh_token: first.json.refresh_token });
    assert.equal(renewed.status, 200);
    assert.notEqual(renewed.json.access_token, first.json.access_token);
    const { status } = await ctx.get(`${ITEMS_PATH}`, renewed.json.access_token);
    assert.equal(status, 200);
  });

  it('refuse de réutiliser un refresh_token (usage unique, 400 invalid_grant)', async () => {
    const first = await ctx.requestToken();
    await ctx.requestToken({ grant_type: 'refresh_token', refresh_token: first.json.refresh_token });
    const reuse = await ctx.requestToken({ grant_type: 'refresh_token', refresh_token: first.json.refresh_token });
    assert.equal(reuse.status, 400);
    assert.equal(reuse.json.error, 'invalid_grant');
  });

  it('refuse un refresh_token inconnu ou absent', async () => {
    assert.equal((await ctx.requestToken({ grant_type: 'refresh_token', refresh_token: 'inconnu' })).json.error, 'invalid_grant');
    assert.equal((await ctx.requestToken({ grant_type: 'refresh_token' })).json.error, 'invalid_grant');
  });

  it('un refresh_token ne peut servir à obtenir un jeton que pour le serveur qui l’a émis', async () => {
    const other = await startFakeHelloAsso();
    try {
      const foreign = await fetch(`${other.origin}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'id', client_secret: 'secret' }),
      }).then((r) => r.json());
      const { status } = await ctx.requestToken({ grant_type: 'refresh_token', refresh_token: foreign.refresh_token });
      assert.equal(status, 400);
    } finally {
      await other.close();
    }
  });

  it('refuse GET sur /oauth2/token', async () => {
    const response = await fetch(`${ctx.fake.origin}/oauth2/token`);
    assert.equal(response.status, 404);
  });
});

describe('faux HelloAsso : accès et expiration du jeton (I-10, 401)', () => {
  const ctx = useFake({ tokenTtlSeconds: 60 });

  it('répond 401 sans en-tête Authorization', async () => {
    assert.equal((await ctx.get(ITEMS_PATH)).status, 401);
  });

  it('répond 401 avec un jeton inconnu', async () => {
    assert.equal((await ctx.get(ITEMS_PATH, 'jeton-inconnu')).status, 401);
  });

  it('répond 401 avec un schéma d’autorisation autre que Bearer', async () => {
    const token = await ctx.token();
    const response = await fetch(`${ctx.fake.apiBase}${ITEMS_PATH}`, { headers: { authorization: `Basic ${token}` } });
    assert.equal(response.status, 401);
  });

  it('accepte le jeton jusqu’à son expiration puis répond 401', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const token = await ctx.token();

    t.mock.timers.tick(59_000);
    assert.equal((await ctx.get(ITEMS_PATH, token)).status, 200, 'encore valide à 59 s');

    t.mock.timers.tick(2_000);
    assert.equal((await ctx.get(ITEMS_PATH, token)).status, 401, 'expiré à 61 s');
  });

  it('délivre un nouveau jeton valable après l’expiration du précédent', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const first = await ctx.requestToken();
    t.mock.timers.tick(61_000);
    const renewed = await ctx.requestToken({ grant_type: 'refresh_token', refresh_token: first.json.refresh_token });
    assert.equal((await ctx.get(ITEMS_PATH, first.json.access_token)).status, 401);
    assert.equal((await ctx.get(ITEMS_PATH, renewed.json.access_token)).status, 200);
  });

  it('refuse aussi les commandes sans jeton', async () => {
    assert.equal((await ctx.get('/orders/200001')).status, 401);
  });
});

describe('faux HelloAsso : durée du jeton réglable', () => {
  it('annonce expires_in = tokenTtlSeconds et refuse un jeton déjà expiré (durée 0)', async () => {
    const fake = await startFakeHelloAsso({ tokenTtlSeconds: 0 });
    try {
      const response = await fetch(`${fake.origin}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'id', client_secret: 'secret' }),
      });
      const json = await response.json();
      assert.equal(json.expires_in, 0);
      const items = await fetch(`${fake.apiBase}${ITEMS_PATH}`, { headers: { authorization: `Bearer ${json.access_token}` } });
      assert.equal(items.status, 401);
    } finally {
      await fake.close();
    }
  });
});

describe('faux HelloAsso : billets du formulaire de recette (Q-03, Q-17)', () => {
  const ctx = useFake();

  it('répond 200 avec les 17 billets du jeu par défaut, sur une seule page de 20', async () => {
    const { status, json } = await ctx.items();
    assert.equal(status, 200);
    assert.equal(json.data.length, 17);
    assert.deepEqual(json.pagination, {
      pageSize: 20,
      totalCount: 17,
      pageIndex: 1,
      totalPages: 1,
      continuationToken: json.pagination.continuationToken,
    });
  });

  it('suit le format v5 : id, order, payer, user, name, state, type, amount, payments', async () => {
    const { json } = await ctx.items();
    for (const item of json.data) {
      assert.equal(typeof item.id, 'number');
      assert.deepEqual(Object.keys(item.order).sort(), ['date', 'formSlug', 'formType', 'id', 'organizationSlug']);
      assert.deepEqual(
        { organizationSlug: item.order.organizationSlug, formType: item.order.formType, formSlug: item.order.formSlug },
        FORM
      );
      assert.ok(item.payer.email && item.payer.firstName && item.payer.lastName);
      assert.ok(item.user.firstName && item.user.lastName);
      assert.equal(item.type, 'Registration');
      assert.equal(typeof item.amount, 'number');
      assert.ok(Array.isArray(item.payments));
    }
  });

  it('a des identifiants de billet uniques', async () => {
    const { json } = await ctx.items();
    assert.equal(new Set(json.data.map((i) => i.id)).size, 17);
  });

  it('répartit les tarifs : 12 Nouvelle-Aquitaine, 3 Exposant, 2 Intervenant', async () => {
    const { json } = await ctx.items();
    const counts = {};
    for (const item of json.data) counts[item.name] = (counts[item.name] || 0) + 1;
    assert.deepEqual(counts, { [REGION_TARIFF]: 12, Exposant: 3, Intervenant: 2 });
  });

  it('conserve la coquille « Auitaine » du tarif réel (Q-03)', () => {
    assert.equal(REGION_TARIFF, 'Journée Innovation Filière Bois en Nouvelle-Auitaine');
  });

  it('compte un billet Canceled et des billets Processed ou Registered pour le reste', async () => {
    const { json } = await ctx.items();
    const states = {};
    for (const item of json.data) states[item.state] = (states[item.state] || 0) + 1;
    assert.equal(states.Canceled, 1);
    assert.equal(states.Canceled + (states.Processed || 0) + (states.Registered || 0), 17);
  });

  it('n’utilise que des adresses en @example.org, pour les payeurs comme pour le champ Email', async () => {
    const emails = [];
    for (const page of await readAllPages(ctx)) {
      for (const item of page.data) {
        emails.push(item.payer.email);
        for (const field of item.customFields) if (field.name === 'Email') emails.push(field.answer);
      }
    }
    assert.ok(emails.length >= 17);
    for (const email of emails) assert.match(email, /^[a-z0-9.\-]+@example\.org$/, email);
  });

  it('ne contient aucune adresse hors example.org dans tout le fichier de billets', () => {
    const everyAddress = JSON.stringify(defaultItems).match(/[\w.+-]+@[\w.-]+/g) || [];
    assert.ok(everyAddress.length > 0);
    assert.deepEqual(everyAddress.filter((a) => !a.endsWith('@example.org')), []);
  });
});

describe('faux HelloAsso : withDetails et champs par tarif (I-11, Q-03, NF-11)', () => {
  const ctx = useFake();
  const fieldNames = (item) => item.customFields.map((f) => f.name);

  it('omet customFields et options sans withDetails', async () => {
    const { json } = await ctx.items();
    for (const item of json.data) {
      assert.ok(!('customFields' in item), `customFields présent sur le billet ${item.id}`);
      assert.ok(!('options' in item), `options présent sur le billet ${item.id}`);
    }
  });

  it('omet customFields pour withDetails=false', async () => {
    const { json } = await ctx.items('?withDetails=false');
    assert.ok(json.data.every((item) => !('customFields' in item)));
  });

  it('inclut customFields et options avec withDetails=true', async () => {
    const { json } = await ctx.items('?withDetails=true');
    assert.ok(json.data.every((item) => Array.isArray(item.customFields) && Array.isArray(item.options)));
  });

  it('donne au tarif Nouvelle-Aquitaine les 7 champs personnalisés du formulaire réel', async () => {
    const { json } = await ctx.items('?withDetails=true');
    const region = json.data.filter((i) => i.name === REGION_TARIFF);
    assert.equal(region.length, 12);
    for (const item of region) {
      assert.deepEqual(fieldNames(item).sort(), [
        'Accès PMR',
        'Code Postal',
        'Email',
        'N° de téléphone',
        'Organisation',
        'Poste',
        "Type d'organisation",
      ]);
    }
  });

  it('donne aux tarifs Exposant et Intervenant le seul champ « Accès PMR », sans Email', async () => {
    const { json } = await ctx.items('?withDetails=true');
    const others = json.data.filter((i) => i.name !== REGION_TARIFF);
    assert.equal(others.length, 5);
    for (const item of others) assert.deepEqual(fieldNames(item), ['Accès PMR']);
  });

  it('prévoit une adresse de payeur distincte pour chaque billet Exposant ou Intervenant (import par payer.email)', async () => {
    const { json } = await ctx.items('?withDetails=true');
    const payers = json.data.filter((i) => i.name !== REGION_TARIFF).map((i) => i.payer.email);
    assert.equal(new Set(payers).size, payers.length);
  });

  it('renseigne l’Email, l’Organisation et le Poste sur chaque billet Nouvelle-Aquitaine (champs importés, Q-03)', async () => {
    const { json } = await ctx.items('?withDetails=true');
    for (const item of json.data.filter((i) => i.name === REGION_TARIFF)) {
      for (const name of ['Email', 'Organisation', 'Poste']) {
        const field = item.customFields.find((f) => f.name === name);
        assert.ok(field?.answer, `${name} vide sur le billet ${item.id}`);
      }
    }
  });

  it('garde téléphone, code postal, type d’organisation et accès PMR dans le faux, pour prouver qu’ils sont ignorés (NF-11)', async () => {
    const { json } = await ctx.items('?withDetails=true');
    const item = json.data.find((i) => i.name === REGION_TARIFF);
    const byName = Object.fromEntries(item.customFields.map((f) => [f.name, f]));
    assert.ok(byName['N° de téléphone'].answer);
    assert.ok(byName['Code Postal'].answer);
    assert.ok(byName["Type d'organisation"].answer);
    assert.ok(byName['Accès PMR'].answer);
  });

  it('donne à chaque champ un id, un nom, un type et une réponse', async () => {
    const { json } = await ctx.items('?withDetails=true');
    for (const item of json.data) {
      for (const field of item.customFields) {
        assert.equal(typeof field.id, 'number');
        assert.ok(field.name);
        assert.ok(field.type);
        assert.ok('answer' in field);
      }
    }
  });
});

describe('faux HelloAsso : pagination (I-11)', () => {
  const ctx = useFake({ items: buildEdgeCaseItems() });

  it('plafonne la page à 20 billets par défaut et annonce le total', async () => {
    const { json } = await ctx.items();
    assert.equal(json.data.length, 20);
    assert.equal(json.pagination.pageSize, 20);
    assert.equal(json.pagination.totalCount, 32);
    assert.equal(json.pagination.totalPages, 2);
    assert.equal(json.pagination.pageIndex, 1);
  });

  it('suit le continuationToken jusqu’à data: [] sans perdre ni répéter un billet', async () => {
    const pages = await readAllPages(ctx, 'pageSize=20');
    assert.deepEqual(
      pages.map((p) => p.data.length),
      [20, 12, 0]
    );
    const ids = pages.flatMap((p) => p.data.map((i) => i.id));
    assert.equal(ids.length, 32);
    assert.equal(new Set(ids).size, 32);
    assert.equal(pages[1].pagination.pageIndex, 2);
    assert.equal(pages[2].pagination.totalCount, 32);
  });

  it('retourne data: [] à chaque nouvel appel après la dernière page', async () => {
    const pages = await readAllPages(ctx, 'pageSize=20');
    const last = pages.at(-1);
    const token = await ctx.token();
    const again = await ctx.get(`${ITEMS_PATH}?pageSize=20&continuationToken=${encodeURIComponent(last.pagination.continuationToken)}`, token);
    assert.deepEqual(again.json.data, []);
  });

  it('respecte pageSize', async () => {
    const { json } = await ctx.items('?pageSize=5');
    assert.equal(json.data.length, 5);
    assert.equal(json.pagination.pageSize, 5);
    assert.equal(json.pagination.totalPages, 7);
  });

  it('plafonne pageSize à 100', async () => {
    const { json } = await ctx.items('?pageSize=500');
    assert.equal(json.pagination.pageSize, 100);
    assert.equal(json.data.length, 32);
  });

  for (const pageSize of ['0', '-3', 'abc', '']) {
    it(`retombe sur 20 pour pageSize=« ${pageSize} »`, async () => {
      const { json } = await ctx.items(`?pageSize=${pageSize}`);
      assert.equal(json.pagination.pageSize, 20);
    });
  }

  for (const [label, token] of [
    ['illisible', '!!!'],
    ['non numérique', Buffer.from('abc').toString('base64url')],
    ['négatif', Buffer.from('-5').toString('base64url')],
  ]) {
    it(`répond 400 pour un continuationToken ${label}`, async () => {
      const { status, json } = await ctx.items(`?continuationToken=${encodeURIComponent(token)}`);
      assert.equal(status, 400);
      assert.match(json.message, /continuationToken/);
    });
  }

  it('parcourt aussi un jeu vide : data: [] et totalCount 0', async () => {
    ctx.fake.setItems([]);
    const { json } = await ctx.items();
    assert.deepEqual(json.data, []);
    assert.equal(json.pagination.totalCount, 0);
  });
});

describe('faux HelloAsso : formulaires inconnus (404)', () => {
  const ctx = useFake();

  for (const [label, pathname] of [
    ['organisation inconnue', `/organizations/autre-asso/forms/${FORM.formType}/${FORM.formSlug}/items`],
    ['type de formulaire inconnu', `/organizations/${FORM.organizationSlug}/forms/Shop/${FORM.formSlug}/items`],
    ['formulaire inconnu', `/organizations/${FORM.organizationSlug}/forms/${FORM.formType}/inconnu/items`],
  ]) {
    it(`répond 404 pour ${label}`, async () => {
      const { status } = await ctx.get(pathname, await ctx.token());
      assert.equal(status, 404);
    });
  }

  it('répond 404 pour un chemin inconnu', async () => {
    assert.equal((await ctx.get('/inconnu', await ctx.token())).status, 404);
  });

  it('répond 404 pour un chemin hors /v5', async () => {
    const response = await fetch(`${ctx.fake.origin}/inconnu`);
    assert.equal(response.status, 404);
  });

  it('répond 200 avec data: [] pour le formulaire de recette vide', async () => {
    ctx.fake.setItems([]);
    assert.equal((await ctx.get(ITEMS_PATH, await ctx.token())).status, 200);
  });

  it('répond 200 pour un formulaire connu par ses billets et 404 pour un formulaire inconnu', async () => {
    const other = buildItem({ id: 1, firstName: 'Zoé', lastName: 'Test', payer: { email: 'zoe@example.org' } });
    other.order = { ...other.order, organizationSlug: 'autre-asso', formSlug: 'autre-form' };
    ctx.fake.setItems([other]);
    const token = await ctx.token();
    assert.equal((await ctx.get('/organizations/autre-asso/forms/Event/autre-form/items', token)).status, 200);
    assert.equal((await ctx.get('/organizations/autre-asso/forms/Event/vide/items', token)).status, 404);
  });
});

describe('faux HelloAsso : commandes (I-13)', () => {
  const ctx = useFake({ items: buildEdgeCaseItems() });

  it('renvoie la commande groupée avec ses 3 billets et le payeur commun (I-14)', async () => {
    const { status, json } = await ctx.get('/orders/810001', await ctx.token());
    assert.equal(status, 200);
    assert.equal(json.id, 810001);
    assert.equal(json.payer.email, 'groupe@example.org');
    assert.equal(json.items.length, 3);
    assert.deepEqual(json.formSlug, FORM.formSlug);
    assert.equal(json.payments.length, 3);
  });

  it('répond 404 pour une commande inconnue', async () => {
    assert.equal((await ctx.get('/orders/999999999', await ctx.token())).status, 404);
  });

  it('suit l’état d’un billet modifié (annulation côté HelloAsso, T-06)', async () => {
    ctx.fake.updateItem(910001, { state: 'Canceled' });
    const { json } = await ctx.get('/orders/810001', await ctx.token());
    assert.deepEqual(
      json.items.map((i) => i.state),
      ['Canceled', 'Processed', 'Processed']
    );
  });
});

describe('faux HelloAsso : pilotage par les tests et statistiques', () => {
  const ctx = useFake();
  const control = (method, pathname, body) =>
    fetch(`${ctx.fake.origin}${pathname}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('remplace le jeu par POST /__fake/items', async () => {
    const only = buildItem({ id: 1, firstName: 'Zoé', lastName: 'Seule', payer: { email: 'zoe@example.org' } });
    const response = await control('POST', '/__fake/items', [only]);
    assert.deepEqual(await response.json(), { count: 1 });
    assert.equal((await ctx.items()).json.data.length, 1);
  });

  it('refuse un corps qui n’est pas un tableau (400)', async () => {
    const response = await control('POST', '/__fake/items', { id: 1 });
    assert.equal(response.status, 400);
  });

  it('modifie un billet par PATCH /__fake/items/{id}', async () => {
    const response = await control('PATCH', '/__fake/items/100001', { state: 'Canceled' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state, 'Canceled');
    const { json } = await ctx.items();
    assert.equal(json.data.find((i) => i.id === 100001).state, 'Canceled');
  });

  it('répond 404 pour PATCH d’un billet inconnu', async () => {
    assert.equal((await control('PATCH', '/__fake/items/424242', { state: 'Canceled' })).status, 404);
  });

  it('expose les compteurs d’appels par GET /__fake/stats, sans exiger de jeton', async () => {
    await ctx.items();
    await ctx.items();
    await ctx.get('/orders/200001', await ctx.token());
    const stats = await (await control('GET', '/__fake/stats')).json();
    assert.deepEqual(stats, { tokenRequests: 3, itemsRequests: 2, orderRequests: 1 });
  });

  it('stats() du module renvoie une copie : la modifier ne fausse pas les compteurs', async () => {
    await ctx.token();
    const snapshot = ctx.fake.stats();
    snapshot.tokenRequests = 99;
    assert.equal(ctx.fake.stats().tokenRequests, 1);
  });

  it('compte les demandes de jeton, y compris refusées (preuve du cache de jeton, I-10)', async () => {
    await ctx.requestToken({ grant_type: 'client_credentials', client_id: '', client_secret: '' });
    await ctx.requestToken();
    assert.equal(ctx.fake.stats().tokenRequests, 2);
  });

  it('ne compte pas les appels refusés en 401 comme des lectures de billets', async () => {
    await ctx.get(ITEMS_PATH);
    assert.equal(ctx.fake.stats().itemsRequests, 0);
  });

  it('updateItem() renvoie le billet modifié, ou undefined si inconnu', () => {
    assert.equal(ctx.fake.updateItem(100001, { state: 'Waiting' }).state, 'Waiting');
    assert.equal(ctx.fake.updateItem(1, { state: 'Waiting' }), undefined);
  });

  it('copie les billets reçus : le jeu par défaut importé n’est jamais modifié', async () => {
    ctx.fake.updateItem(100001, { state: 'Canceled' });
    assert.notEqual(defaultItems.find((i) => i.id === 100001).state, 'Canceled');
  });

  it('setItems() copie le tableau reçu', async () => {
    const mine = [buildItem({ id: 7, firstName: 'A', lastName: 'B', payer: { email: 'a@example.org' } })];
    ctx.fake.setItems(mine);
    mine[0].state = 'Canceled';
    assert.equal((await ctx.items()).json.data[0].state, 'Processed');
  });
});

describe('faux HelloAsso : cycle de vie du serveur', () => {
  it('écoute sur un port libre de 127.0.0.1 et annonce origin et apiBase', async () => {
    const fake = await startFakeHelloAsso();
    try {
      assert.match(fake.origin, /^http:\/\/localhost:\d+$/);
      assert.equal(fake.apiBase, `${fake.origin}/v5`);
    } finally {
      await fake.close();
    }
  });

  it('refuse de répondre après close()', async () => {
    const fake = await startFakeHelloAsso();
    await fake.close();
    await assert.rejects(fetch(`${fake.origin}/__fake/stats`));
  });

  it('plusieurs instances coexistent sans partager d’état', async () => {
    const [a, b] = await Promise.all([startFakeHelloAsso(), startFakeHelloAsso()]);
    try {
      assert.notEqual(a.origin, b.origin);
      a.updateItem(100001, { state: 'Canceled' });
      const token = await fetch(`${b.origin}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'id', client_secret: 'secret' }),
      }).then((r) => r.json());
      const { data } = await fetch(`${b.apiBase}${ITEMS_PATH}`, { headers: { authorization: `Bearer ${token.access_token}` } }).then((r) => r.json());
      assert.equal(data.find((i) => i.id === 100001).state, 'Processed');
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });
});

describe('buildEdgeCaseItems : cas limites de l’import (I-11, I-14, Q-15)', () => {
  const items = buildEdgeCaseItems();
  const byId = (id) => items.find((i) => i.id === id);
  const emailAnswer = (item) => item.customFields.find((f) => f.name === 'Email')?.answer;

  it('produit 32 billets, dont 20 de remplissage pour dépasser une page', () => {
    assert.equal(items.length, 32);
    assert.equal(buildEdgeCaseItems({ padding: 0 }).length, 12);
    assert.equal(buildEdgeCaseItems({ padding: 3 }).length, 15);
  });

  it('a des identifiants de billet uniques', () => {
    assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  });

  it('groupe 3 billets d’une même commande avec le même payeur et des bénéficiaires différents', () => {
    const group = items.filter((i) => i.order.id === 810001);
    assert.equal(group.length, 3);
    assert.deepEqual([...new Set(group.map((i) => i.payer.email))], ['groupe@example.org']);
    assert.equal(new Set(group.map((i) => `${i.user.firstName} ${i.user.lastName}`)).size, 3);
  });

  it('contient un champ Email invalide', () => {
    assert.equal(emailAnswer(byId(910004)), 'pas-une-adresse');
  });

  it('contient un e-mail en majuscules avec espaces autour', () => {
    assert.equal(emailAnswer(byId(910005)), '  Zoe.Garnier@Example.ORG  ');
  });

  it('couvre chaque état non actif : Waiting, Refused, Deleted, Abandoned, Unknown, Canceled', () => {
    const states = new Set(items.map((i) => i.state));
    for (const state of ['Waiting', 'Refused', 'Deleted', 'Abandoned', 'Unknown', 'Canceled']) assert.ok(states.has(state), state);
  });

  // Défaut D1 du lot B : buildEdgeCaseItems() passe `payments` à buildItem(), qui ignore ce paramètre
  // (il attend `paymentState`) ; aucun paiement Refunded n'est produit. Retirer `todo` après correction.
  it('contient un billet actif dont le paiement est Refunded', { todo: 'défaut D1 : paiement Refunded jamais produit' }, () => {
    const refunded = items.filter((i) => i.payments.some((p) => p.state === 'Refunded'));
    assert.equal(refunded.length, 1);
    assert.equal(refunded[0].state, 'Processed');
  });

  it('reste à l’écart du jeu de recette (identifiants distincts de ceux des 17 billets)', () => {
    const recetteIds = new Set(defaultItems.map((i) => i.id));
    assert.ok(items.every((i) => !recetteIds.has(i.id)));
  });

  it('n’utilise que des adresses en @example.org, hors le cas « invalide »', () => {
    const addresses = (JSON.stringify(items).match(/[\w.+-]+@[\w.-]+/g) || []).map((a) => a.toLowerCase());
    assert.ok(addresses.every((a) => a.endsWith('@example.org')));
  });
});

describe('faux HelloAsso : ligne de commande (helloasso:fake)', () => {
  let child;
  let output = '';

  before(async () => {
    const probe = await startFakeHelloAsso();
    const port = Number(new URL(probe.origin).port);
    await probe.close();

    child = spawn(process.execPath, [path.resolve(__dirname, '../../scripts/espace/fake-helloasso.js')], {
      env: { ...process.env, FAKE_HELLOASSO_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Le faux HelloAsso n’a rien affiché :\n${output}`)), 10_000);
      child.stdout.on('data', () => {
        if (output.includes('HELLOASSO_CLIENT_SECRET=')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once('exit', (code) => reject(new Error(`Sortie prématurée (${code}) :\n${output}`)));
    });
    child.removeAllListeners('exit');
    child.port = port;
  });

  after(() => {
    child?.kill();
  });

  it('affiche les trois variables à utiliser pour Strapi', () => {
    assert.match(output, new RegExp(`HELLOASSO_API_BASE=http://localhost:${child.port}/v5`));
    assert.match(output, /HELLOASSO_CLIENT_ID=\S+/);
    assert.match(output, /HELLOASSO_CLIENT_SECRET=\S+/);
  });

  it('annonce les 17 billets du formulaire de recette', () => {
    assert.match(output, /jib-nouvelle-aquitaine-test \(17 billets\)/);
  });

  it('sert le jeton puis les 17 billets sur le port FAKE_HELLOASSO_PORT', async () => {
    const origin = `http://localhost:${child.port}`;
    const token = await fetch(`${origin}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'fake-client-id', client_secret: 'fake-client-secret' }),
    }).then((r) => r.json());
    const page = await fetch(`${origin}/v5${ITEMS_PATH}?withDetails=true`, {
      headers: { authorization: `Bearer ${token.access_token}` },
    }).then((r) => r.json());
    assert.equal(page.pagination.totalCount, 17);
  });
});
