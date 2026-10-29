'use strict';

/**
 * Fake HelloAsso API v5 (A-12): same paths, same payloads, no dependency.
 * The real sandbox plugs in by environment variables only:
 *   HELLOASSO_API_BASE=http://localhost:4010/v5, any non-empty client id and secret.
 *
 * Command line: pnpm helloasso:fake (port FAKE_HELLOASSO_PORT, default 4010).
 * Module: startFakeHelloAsso({ port = 0, items, tokenTtlSeconds = 1800 }).
 *
 * Test control: POST /__fake/items, PATCH /__fake/items/{id}, GET /__fake/stats.
 * All people and addresses are fictional (@example.org).
 */

const http = require('node:http');
const crypto = require('node:crypto');
const defaultItems = require('./fixtures/helloasso-items.json');

const FORM = { organizationSlug: 'xylofutur-test', formType: 'Event', formSlug: 'jib-nouvelle-aquitaine-test' };

// Tariff name of the real form, typo included (Q-03).
const REGION_TARIFF = 'Journée Innovation Filière Bois en Nouvelle-Auitaine';

// Custom fields of the real form (Q-03): [id, type]. "Accès PMR" is on every tariff, the others on the region tariff only.
const FIELDS = {
  'Accès PMR': [5001, 'YesNo'],
  Organisation: [5002, 'TextInput'],
  "Type d'organisation": [5003, 'ChoiceList'],
  Poste: [5004, 'TextInput'],
  'N° de téléphone': [5005, 'TextInput'],
  Email: [5006, 'TextInput'],
  'Code Postal': [5007, 'TextInput'],
};

/** A ticket in HelloAsso v5 format. `answers` maps custom field names to answers; `payer` overrides the default payer (the beneficiary). */
function buildItem({
  id,
  orderId = id + 100000,
  firstName,
  lastName,
  payer,
  name = REGION_TARIFF,
  state = 'Processed',
  amount = 3000,
  paymentState = 'Authorized',
  answers = {},
  date = '2026-10-05T09:00:00+02:00',
}) {
  return {
    id,
    order: { id: orderId, date, ...FORM },
    payer: { country: 'FRA', firstName, lastName, ...payer },
    user: { firstName, lastName },
    name,
    state,
    type: 'Registration',
    amount,
    payments: amount ? [{ id: 300000 + id, shareAmount: amount, state: paymentState }] : [],
    customFields: Object.entries(answers).map(([field, answer]) => ({
      id: FIELDS[field][0],
      name: field,
      type: FIELDS[field][1],
      answer,
    })),
    options: [],
  };
}

/** Region tariff answers for a person, with the 7 custom fields of Q-03. */
function regionAnswers({ email, organisation, kind = 'Entreprise', jobTitle = 'Responsable' }) {
  return {
    'Accès PMR': 'Non',
    Organisation: organisation,
    "Type d'organisation": kind,
    Poste: jobTitle,
    'N° de téléphone': '06 39 98 00 00',
    Email: email,
    'Code Postal': '33000',
  };
}

/**
 * Import edge cases (I-11, I-14, Q-15), separate from the recette set: a group order sharing one
 * payer e-mail, an invalid Email answer, an upper case e-mail with spaces, every non-active
 * state, a refunded payment, and `padding` more tickets so that the total exceeds one page of 20.
 */
function buildEdgeCaseItems({ padding = 20 } = {}) {
  const payer = (email) => ({ payer: { email } });
  const region = (id, firstName, lastName, email, extra = {}) =>
    buildItem({
      id,
      firstName,
      lastName,
      ...payer(`payeur.${id}@example.org`),
      answers: regionAnswers({ email, organisation: `Organisation ${id}` }),
      ...extra,
    });

  const group = [
    ['Agathe', 'Lavigne'],
    ['Bastien', 'Moulin'],
    ['Colette', 'Rivière'],
  ].map(([firstName, lastName], i) =>
    buildItem({
      id: 910001 + i,
      orderId: 810001,
      firstName,
      lastName,
      ...payer('groupe@example.org'),
      name: 'Exposant',
      amount: 15000,
      answers: { 'Accès PMR': 'Non' },
    })
  );

  const otherStates = ['Waiting', 'Refused', 'Deleted', 'Abandoned', 'Unknown', 'Canceled'].map((state, i) =>
    region(910006 + i, 'Etat', state, `etat.${state.toLowerCase()}@example.org`, { state })
  );

  const padded = Array.from({ length: padding }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return region(920001 + i, 'Figurant', `Numero${n}`, `figurant.${n}@example.org`);
  });

  return [
    ...group,
    region(910004, 'Email', 'Invalide', 'pas-une-adresse'),
    region(910005, 'Zoe', 'Garnier', '  Zoe.Garnier@Example.ORG  '),
    ...otherStates,
    region(910012, 'Paiement', 'Rembourse', 'paiement.rembourse@example.org', {
      paymentState: 'Refunded',
    }),
    ...padded,
  ];
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function startFakeHelloAsso({ port = 0, items = defaultItems, tokenTtlSeconds = 1800 } = {}) {
  let tickets = structuredClone(items);
  const accessTokens = new Map(); // token -> expiry in ms
  const refreshTokens = new Set();
  const counters = { tokenRequests: 0, itemsRequests: 0, orderRequests: 0 };

  const setItems = (next) => {
    tickets = structuredClone(next);
  };
  const updateItem = (id, patch) => {
    const ticket = tickets.find((t) => String(t.id) === String(id));
    return ticket ? Object.assign(ticket, structuredClone(patch)) : undefined;
  };
  const stats = () => ({ ...counters });

  const issueTokens = () => {
    const accessToken = crypto.randomBytes(24).toString('hex');
    const refreshToken = crypto.randomBytes(24).toString('hex');
    accessTokens.set(accessToken, Date.now() + tokenTtlSeconds * 1000);
    refreshTokens.add(refreshToken);
    return { access_token: accessToken, token_type: 'bearer', expires_in: tokenTtlSeconds, refresh_token: refreshToken };
  };

  const isAuthorized = (req) => {
    const token = /^Bearer (.+)$/i.exec(req.headers.authorization || '')?.[1];
    return accessTokens.has(token) && accessTokens.get(token) > Date.now();
  };

  const encodeToken = (offset) => Buffer.from(String(offset)).toString('base64url');
  const decodeToken = (token) => (token ? Number.parseInt(Buffer.from(token, 'base64url').toString(), 10) : 0);

  const handle = async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const { pathname, searchParams } = new URL(req.url, 'http://localhost');
    const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (req.method === 'POST' && pathname === '/oauth2/token') {
      counters.tokenRequests += 1;
      const form = new URLSearchParams(await readBody(req));
      const grant = form.get('grant_type');
      if (grant === 'client_credentials') {
        if (!form.get('client_id') || !form.get('client_secret')) {
          return send(400, { error: 'invalid_client', error_description: 'client_id and client_secret are required' });
        }
        return send(200, issueTokens());
      }
      if (grant === 'refresh_token') {
        // A refresh token is single use, as on HelloAsso.
        if (!refreshTokens.delete(form.get('refresh_token'))) return send(400, { error: 'invalid_grant' });
        return send(200, issueTokens());
      }
      return send(400, { error: 'unsupported_grant_type' });
    }

    if (parts[0] === '__fake') {
      if (req.method === 'GET' && pathname === '/__fake/stats') return send(200, stats());
      if (req.method === 'POST' && pathname === '/__fake/items') {
        const body = JSON.parse((await readBody(req)) || 'null');
        if (!Array.isArray(body)) return send(400, { message: 'Expected a JSON array of items' });
        setItems(body);
        return send(200, { count: body.length });
      }
      if (req.method === 'PATCH' && parts[1] === 'items' && parts.length === 3) {
        const ticket = updateItem(parts[2], JSON.parse((await readBody(req)) || '{}'));
        return ticket ? send(200, ticket) : send(404, { message: `Item ${parts[2]} not found` });
      }
    }

    if (req.method === 'GET' && parts[0] === 'v5') {
      if (!isAuthorized(req)) return send(401, { message: 'Authorization has been denied for this request.' });

      // GET /v5/organizations/{org}/forms/{formType}/{formSlug}/items
      if (parts.length === 7 && parts[1] === 'organizations' && parts[3] === 'forms' && parts[6] === 'items') {
        counters.itemsRequests += 1;
        const [, , organizationSlug, , formType, formSlug] = parts;
        const inForm = tickets.filter(
          (t) => t.order.organizationSlug === organizationSlug && t.order.formType === formType && t.order.formSlug === formSlug
        );
        const isDefaultForm =
          organizationSlug === FORM.organizationSlug && formType === FORM.formType && formSlug === FORM.formSlug;
        if (!inForm.length && !isDefaultForm) return send(404, { message: `Form ${formType}/${formSlug} not found` });

        const requested = Number.parseInt(searchParams.get('pageSize'), 10);
        const pageSize = Math.min(requested > 0 ? requested : 20, 100);
        const offset = decodeToken(searchParams.get('continuationToken'));
        if (!(offset >= 0)) return send(400, { message: 'Invalid continuationToken' });

        const withDetails = searchParams.get('withDetails') === 'true';
        const data = inForm.slice(offset, offset + pageSize).map((t) => {
          const { customFields, options, ...light } = t;
          return withDetails ? t : light;
        });
        return send(200, {
          data,
          pagination: {
            pageSize,
            totalCount: inForm.length,
            pageIndex: Math.ceil(offset / pageSize) + 1,
            totalPages: Math.ceil(inForm.length / pageSize),
            continuationToken: encodeToken(offset + data.length),
          },
        });
      }

      // GET /v5/orders/{orderId}
      if (parts.length === 3 && parts[1] === 'orders') {
        counters.orderRequests += 1;
        const orderItems = tickets.filter((t) => String(t.order.id) === parts[2]);
        if (!orderItems.length) return send(404, { message: `Order ${parts[2]} not found` });
        return send(200, {
          ...orderItems[0].order,
          payer: orderItems[0].payer,
          items: orderItems,
          payments: orderItems.flatMap((t) => t.payments),
        });
      }
    }

    return send(404, { message: 'Not found' });
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: error.message }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const origin = `http://localhost:${server.address().port}`;
  return {
    origin,
    apiBase: `${origin}/v5`,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
    setItems,
    updateItem,
    stats,
  };
}

module.exports = { startFakeHelloAsso, buildItem, buildEdgeCaseItems, FORM, REGION_TARIFF, FIELDS };

if (require.main === module) {
  startFakeHelloAsso({ port: Number(process.env.FAKE_HELLOASSO_PORT) || 4010 })
    .then(({ origin, apiBase }) => {
      console.log(`Faux HelloAsso (données fictives) à l’écoute sur ${origin}`);
      console.log(`Formulaire : ${FORM.organizationSlug} / ${FORM.formType} / ${FORM.formSlug} (${defaultItems.length} billets)`);
      console.log('Variables à utiliser pour Strapi :');
      console.log(`HELLOASSO_API_BASE=${apiBase}`);
      console.log('HELLOASSO_CLIENT_ID=fake-client-id');
      console.log('HELLOASSO_CLIENT_SECRET=fake-client-secret');
    })
    .catch((error) => {
      console.error(`Impossible de démarrer le faux HelloAsso : ${error.message}`);
      process.exit(1);
    });
}
