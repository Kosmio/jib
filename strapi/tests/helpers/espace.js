'use strict';

/**
 * Harnais des tests d'intégration de l'espace participant (phase 1, lot 3) : Strapi sur la base de test avec
 * l'environnement de `buildTestEnv`, faux HelloAsso en module, requêtes HTTP avec Origin et IP choisies par le test,
 * lecture de la boîte de sortie avec attente (A-19) et connexion d'un Attendee (demande, lien, vérification, cookie).
 *
 * Aucun réseau hors localhost, aucun e-mail réel : fournisseur console, boîte de sortie propre à la base de test.
 */

const { after, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');

const { startFakeHelloAsso } = require('../../scripts/espace/fake-helloasso');
const { startStrapi } = require('./strapi');

const SESSION_COOKIE = 'jib_espace';

/** SHA-256 hexadécimal : l'empreinte stockée d'un jeton (I-20), calculée ici sans le code de l'espace. */
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Un Set-Cookie en `{ name, value, attributes }` ; les attributs sont en minuscules, `true` s'ils n'ont pas de valeur. */
function parseSetCookie(line) {
  const [pair, ...attributes] = line.split(';').map((part) => part.trim());
  const separator = pair.indexOf('=');
  const cookie = { name: pair.slice(0, separator), value: pair.slice(separator + 1), attributes: {} };
  for (const attribute of attributes) {
    const [key, ...rest] = attribute.split('=');
    cookie.attributes[key.toLowerCase()] = rest.length ? rest.join('=') : true;
  }
  return cookie;
}

/** En-tête `Cookie` à renvoyer d'après des Set-Cookie : les cookies supprimés ou vides sont écartés. */
function cookieHeader(setCookies) {
  return setCookies
    .map(parseSetCookie)
    .filter(({ value, attributes }) => value && attributes['max-age'] !== '0' && !(attributes.expires && new Date(attributes.expires) < new Date()))
    .map(({ name, value }) => `${name}=${value}`)
    .join('; ');
}

/** Adresse IP fictive distincte à chaque appel : la limitation de débit (5 demandes / 15 min par IP) ne gêne aucun autre test. */
let ipCounter = 0;
function freshIp() {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

/**
 * @param {object} [options]
 * @param {boolean|object} [options.fake] démarre le faux HelloAsso en module (options de `startFakeHelloAsso`) et
 *   passe `HELLOASSO_API_BASE`, `HELLOASSO_CLIENT_ID` et `HELLOASSO_CLIENT_SECRET` à Strapi
 * @param {string} [options.database] base de test (défaut : TEST_DATABASE)
 * @param {boolean} [options.reset] vider la base avant le démarrage (défaut : oui)
 * @param {object} [options.overrides] variables d'environnement de Strapi à surcharger
 */
async function startEspace({ fake: fakeOptions, database, reset, overrides = {} } = {}) {
  const fake = fakeOptions ? await startFakeHelloAsso(fakeOptions === true ? {} : fakeOptions) : undefined;
  const helloasso = fake
    ? { HELLOASSO_API_BASE: fake.apiBase, HELLOASSO_CLIENT_ID: 'fake-client-id', HELLOASSO_CLIENT_SECRET: 'fake-client-secret' }
    : {};

  let strapi;
  try {
    strapi = await startStrapi({ database, reset, overrides: { ...helloasso, ...overrides } });
  } catch (error) {
    await fake?.close();
    throw error;
  }

  const { app, baseUrl, env } = strapi;
  const defaultOrigin = env.CORS_ORIGINS.split(',')[0].trim();
  const outboxFile = env.EMAIL_OUTBOX_FILE;

  /**
   * Requête HTTP. Les écritures portent par défaut un Origin admis (`origin: null` pour n'en envoyer aucun) et
   * chaque appel a sa propre IP (`ip`), lue par Strapi dans X-Forwarded-For. Les redirections ne sont pas suivies.
   */
  async function request(path, { method = 'GET', json, form, headers = {}, cookie, origin, ip, redirect = 'manual' } = {}) {
    const sent = { ...headers, 'x-forwarded-for': ip ?? freshIp() };
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (origin) sent.origin = origin;
    else if (origin === undefined && isWrite) sent.origin = defaultOrigin;
    if (cookie) sent.cookie = cookie;

    let body;
    if (json !== undefined) {
      sent['content-type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) {
      sent['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }

    const response = await fetch(`${baseUrl}${path}`, { method, headers: sent, body, redirect });
    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    return {
      status: response.status,
      headers: response.headers,
      location: response.headers.get('location'),
      setCookies: response.headers.getSetCookie(),
      text,
      json: parsed,
    };
  }

  const outbox = () =>
    fs.existsSync(outboxFile)
      ? fs.readFileSync(outboxFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
      : [];

  /** Premier e-mail de la boîte de sortie, après les `since` premiers, qui satisfait `predicate` ; attend jusqu'à `timeout` ms (A-19). */
  async function waitForMail(predicate, { since = 0, timeout = 5000 } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const found = outbox().slice(since).find(predicate);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`Aucun e-mail attendu dans la boîte de sortie après ${timeout} ms (${outbox().length} e-mails au total)`);
      await sleep(25);
    }
  }

  /**
   * Laisse à l'envoi détaché (A-19) le temps de partir, puis renvoie les e-mails écrits depuis le rang `since`, limités aux
   * destinataires `to` (adresses, comparées sans tenir compte de la casse) quand ils sont donnés : un envoi tardif d'un test
   * précédent ne doit pas faire échouer un test « aucun e-mail pour cette adresse ».
   */
  async function mailsSince(since, { settleMs = 400, to } = {}) {
    await sleep(settleMs);
    const wanted = to === undefined ? undefined : [to].flat().map((address) => address.trim().toLowerCase());
    return outbox().slice(since).filter((mail) => !wanted || wanted.includes(mail.to.email.toLowerCase()));
  }

  /** `{ url, token, next }` du lien de connexion contenu dans un e-mail (texte), ou undefined. */
  function linkOf(mail) {
    const url = (mail.text.match(/https?:\/\/[^\s"'<>)]+/g) || []).find((candidate) => candidate.includes('/espace/verifier'));
    if (!url) return undefined;
    const parsed = new URL(url);
    return { url, token: parsed.searchParams.get('token'), next: parsed.searchParams.get('next') };
  }

  /** Demande de lien, lecture du lien dans la boîte de sortie, vérification : renvoie le cookie de session et la réponse. */
  async function signIn(editionSlug, email, { ip, next } = {}) {
    const since = outbox().length;
    const asked = await request('/api/espace/auth/request-link', { method: 'POST', json: { editionSlug, email }, ip });
    assert.equal(asked.status, 202, `request-link ${email} : ${asked.text}`);
    const mail = await waitForMail((candidate) => candidate.to.email.toLowerCase() === email.trim().toLowerCase(), { since });
    const link = linkOf(mail);
    assert.ok(link?.token, `aucun lien de connexion dans l’e-mail à ${email}`);
    const verified = await request('/api/espace/auth/verify', { method: 'POST', json: { token: link.token, ...(next ? { next } : {}) } });
    assert.equal(verified.status, 200, `verify ${email} : ${verified.text}`);
    return { cookie: cookieHeader(verified.setCookies), me: verified.json.me, redirect: verified.json.redirect, mail, token: link.token, response: verified };
  }

  return {
    app,
    baseUrl,
    env,
    fake,
    strapi,
    publicUrl: env.PUBLIC_URL,
    origin: defaultOrigin,
    outboxFile,
    request,
    outbox,
    waitForMail,
    mailsSince,
    linkOf,
    signIn,
    query: (uid) => app.db.query(uid),
    stop: async () => {
      await strapi.stop();
      await fake?.close();
      fs.rmSync(outboxFile, { force: true });
    },
  };
}

/**
 * Démarre un Strapi pour la suite qui appelle cette fonction (hooks `before` et `after`). Une erreur de démarrage ne fait
 * pas échouer le hook : le getter renvoyé la relance dans chaque test, qui échoue (ou reste `todo`) pour cette raison.
 */
function useEspace(options) {
  let instance;
  let failure;
  before(async () => {
    try {
      instance = await startEspace(options);
    } catch (error) {
      failure = error;
    }
  });
  after(async () => {
    await instance?.stop();
  });
  return () => {
    if (failure) throw failure;
    return instance;
  };
}

module.exports = { SESSION_COOKIE, cookieHeader, freshIp, parseSetCookie, sha256, sleep, startEspace, useEspace };
