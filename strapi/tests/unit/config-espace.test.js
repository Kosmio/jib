'use strict';

/**
 * Configuration de l'espace en phase 1 (section 4.3 du plan, A-04, A-05, A-08, NF-06, NF-52, I-23) : `config/server.js`
 * (proxy, cron, espace, helloasso), `config/middlewares.js` (CORS restreint aux origines du front), `config/cron-tasks.js`
 * et `.env.example`. Lue par l'aide `env` simulée, sans démarrer Strapi. Les tâches de `cron-tasks.js` n'appellent que des
 * services (purge avec délai de grâce : A-21, lot 6b).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { makeEnv } = require('../helpers/config-env');

const CONFIG = path.resolve(__dirname, '../../config');
const server = (vars = {}) => require('../../config/server')({ env: makeEnv(vars) });
const middlewares = (vars = {}) => require('../../config/middlewares')({ env: makeEnv(vars) });

describe('config/server.js : section espace (A-05, I-23, NF-06)', () => {
  it('donne les valeurs locales par défaut : localhost:4321, aucun organisateur', () => {
    assert.deepEqual(server().espace, { publicUrl: 'http://localhost:4321', organizerEmails: [], corsOrigins: ['http://localhost:4321'] });
  });

  it('lit PUBLIC_URL, ORGANIZER_EMAILS et CORS_ORIGINS (listes séparées par des virgules, espaces retirés)', () => {
    const { espace } = server({
      PUBLIC_URL: 'https://journees.example.org',
      ORGANIZER_EMAILS: 'organisation@example.org, equipe@example.org',
      CORS_ORIGINS: 'https://journees.example.org,http://localhost:4321',
    });
    assert.equal(espace.publicUrl, 'https://journees.example.org');
    assert.deepEqual(espace.organizerEmails, ['organisation@example.org', 'equipe@example.org']);
    assert.deepEqual(espace.corsOrigins, ['https://journees.example.org', 'http://localhost:4321']);
  });

  it('laisse une liste d’organisateurs vide vide : aucun e-mail fantôme', () => {
    assert.deepEqual(server({ ORGANIZER_EMAILS: '' }).espace.organizerEmails.filter(Boolean), []);
  });
});

describe('config/server.js : HelloAsso (I-10, NF-53)', () => {
  it('est vide par défaut : une synchronisation sans réglage écrit un SyncRun HELLOASSO_NOT_CONFIGURED', () => {
    const { helloasso } = server();
    assert.ok(!helloasso.apiBase && !helloasso.clientId && !helloasso.clientSecret);
  });

  it('lit HELLOASSO_API_BASE, HELLOASSO_CLIENT_ID et HELLOASSO_CLIENT_SECRET', () => {
    const { helloasso } = server({ HELLOASSO_API_BASE: 'http://localhost:4010/v5', HELLOASSO_CLIENT_ID: 'id', HELLOASSO_CLIENT_SECRET: 'secret' });
    assert.deepEqual({ ...helloasso }, { apiBase: 'http://localhost:4010/v5', clientId: 'id', clientSecret: 'secret' });
  });
});

describe('config/server.js : proxy et tâches planifiées (A-04, A-08)', () => {
  it('ne fait pas confiance à X-Forwarded-For par défaut', () => {
    assert.equal(server().proxy.koa, false);
  });

  it('lit l’IP du client dans X-Forwarded-For derrière un proxy (IS_PROXIED=true), la dernière entrée seulement', () => {
    const { proxy } = server({ IS_PROXIED: 'true' });
    assert.equal(proxy.koa, true);
    assert.equal(proxy.maxIpsCount, 1);
  });

  it('coupe les tâches planifiées par défaut (local et test)', () => {
    assert.equal(server().cron.enabled, false);
  });

  it('active les tâches planifiées avec CRON_ENABLED=true (dev et prod)', () => {
    assert.equal(server({ CRON_ENABLED: 'true' }).cron.enabled, true);
  });
});

// Acquis de la phase 0 que la phase 1 ne doit pas perdre en réécrivant config/server.js (déjà vrais : tests actifs).
describe('config/server.js : acquis de la phase 0 conservés', () => {
  it('garde la section email et la coupure de la notification de mise à jour (D2)', () => {
    const config = server({ EMAIL_PROVIDER: 'console' });
    assert.equal(config.email.provider, 'console');
    assert.equal(config.logger.updates.enabled, false);
  });
});

describe('config/middlewares.js : CORS restreint (A-05, NF-04)', () => {
  const cors = (vars) => middlewares(vars).find((entry) => entry?.name === 'strapi::cors');

  it('est une fonction de { env } qui rend la liste des intergiciels de Strapi dans le même ordre', () => {
    const names = middlewares().map((entry) => (typeof entry === 'string' ? entry : entry.name));
    assert.deepEqual(names, ['strapi::logger', 'strapi::errors', 'strapi::security', 'strapi::cors', 'strapi::poweredBy', 'strapi::query', 'strapi::body', 'strapi::session', 'strapi::favicon', 'strapi::public']);
  });

  it('limite CORS à l’origine du front local par défaut, avec les cookies (credentials)', () => {
    assert.deepEqual(cors().config.origin, ['http://localhost:4321']);
    assert.equal(cors().config.credentials, true);
  });

  it('suit CORS_ORIGINS', () => {
    assert.deepEqual(cors({ CORS_ORIGINS: 'https://journees.example.org,http://localhost:4321' }).config.origin, ['https://journees.example.org', 'http://localhost:4321']);
  });

  it('ne laisse jamais l’origine libre : ni « * », ni valeur vraie', () => {
    const { origin } = cors().config;
    assert.ok(Array.isArray(origin));
    assert.ok(!origin.includes('*'));
  });
});

/** Règles de planification, quelle que soit la forme choisie : { 'expression': fonction } ou { nom: { task, options: { rule, tz } } }. */
function scheduleOf(tasks) {
  return Object.entries(tasks).map(([key, value]) => {
    if (typeof value === 'function') return { rule: key, tz: undefined, task: value };
    const options = value.options;
    return { rule: typeof options === 'string' ? options : options?.rule, tz: options?.tz, task: value.task };
  });
}

describe('config/cron-tasks.js : fichier prévu par le lot 2', () => {
  it('existe et s’importe sans rien exécuter', () => {
    assert.ok(fs.existsSync(path.join(CONFIG, 'cron-tasks.js')));
    assert.equal(typeof require('../../config/cron-tasks'), 'object');
  });
});

describe('config/cron-tasks.js : synchronisation toutes les 15 minutes et purge quotidienne (A-08, I-12, I-20)', () => {
  const tasks = () => scheduleOf(require('../../config/cron-tasks'));

  it('planifie la synchronisation HelloAsso `*/15 * * * *` en Europe/Paris', () => {
    const sync = tasks().find((entry) => entry.rule === '*/15 * * * *');
    assert.ok(sync, 'tâche de synchronisation absente');
    assert.equal(sync.tz, 'Europe/Paris');
    assert.equal(typeof sync.task, 'function');
  });

  it('planifie la purge des jetons expirés `0 4 * * *` en Europe/Paris', () => {
    const purge = tasks().find((entry) => entry.rule === '0 4 * * *');
    assert.ok(purge, 'tâche de purge absente');
    assert.equal(purge.tz, 'Europe/Paris');
    assert.equal(typeof purge.task, 'function');
  });

  it('ne planifie rien d’autre en phase 1', () => {
    assert.deepEqual(tasks().map((entry) => entry.rule).sort(), ['*/15 * * * *', '0 4 * * *']);
  });
});

describe('config/cron-tasks.js : les tâches n’appellent que des services, aucune logique dans le cron (section 4.3 du plan)', () => {
  const taskOf = (rule) => scheduleOf(require('../../config/cron-tasks')).find((entry) => entry.rule === rule).task;

  /**
   * Strapi simulé : `service(uid)` rend un service enregistreur, `log.error` consigne ; tout autre accès (`db`, `documents`,
   * `entityService`…) lève, ce qui prouve que la tâche ne fait pas elle-même de requête.
   */
  function fakeStrapi({ failWith } = {}) {
    const calls = [];
    const errors = [];
    const run = (name) => async (...args) => {
      calls.push([name, args]);
      if (failWith) throw failWith;
      return 3;
    };
    const services = { 'api::espace.sync': { runAll: run('sync.runAll') }, 'api::espace.tokens': { purgeExpired: run('tokens.purgeExpired') } };
    const target = { service: (uid) => services[uid], log: { error: (message) => errors.push(String(message)) } };
    const strapi = new Proxy(target, {
      get(object, property) {
        if (property in object) return object[property];
        throw new Error(`accès inattendu à strapi.${String(property)} : la tâche doit passer par un service`);
      },
    });
    return { strapi, calls, errors };
  }

  it('la synchronisation appelle sync.runAll() sans argument et rien d’autre', async () => {
    const { strapi, calls, errors } = fakeStrapi();
    await taskOf('*/15 * * * *')({ strapi });
    assert.deepEqual(calls, [['sync.runAll', []]]);
    assert.deepEqual(errors, []);
  });

  it('la purge appelle tokens.purgeExpired() sans argument (le délai de grâce de 7 jours est celui du service, A-21) et rien d’autre', async () => {
    const { strapi, calls, errors } = fakeStrapi();
    await taskOf('0 4 * * *')({ strapi });
    assert.deepEqual(calls, [['tokens.purgeExpired', []]]);
    assert.deepEqual(errors, [], 'la tâche a accédé à autre chose qu’un service');
  });

  it('une erreur de la synchronisation est journalisée et ne remonte jamais', async () => {
    const { strapi, errors } = fakeStrapi({ failWith: new Error('HelloAsso en panne') });
    await assert.doesNotReject(taskOf('*/15 * * * *')({ strapi }));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /HelloAsso en panne/);
  });

  it('une erreur de la purge est journalisée et ne remonte jamais', async () => {
    const { strapi, calls, errors } = fakeStrapi({ failWith: new Error('base indisponible') });
    await assert.doesNotReject(taskOf('0 4 * * *')({ strapi }));
    assert.equal(calls.length, 1, 'la purge doit appeler le service avant d’échouer');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /base indisponible/);
  });

  it('le fichier ne contient plus aucune requête : ni strapi.db, ni query, ni Document Service, ni new Date()', () => {
    const source = fs.readFileSync(path.join(CONFIG, 'cron-tasks.js'), 'utf8');
    assert.doesNotMatch(source, /strapi\.db|\.query\(|deleteMany|\.documents\(|entityService|new Date\(/);
  });
});

describe('.env.example : variables de la phase 1 (NF-06)', () => {
  const text = fs.readFileSync(path.resolve(__dirname, '../../.env.example'), 'utf8');
  const value = (key) => text.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1];

  it('documente PUBLIC_URL, ORGANIZER_EMAILS et CORS_ORIGINS avec des valeurs locales fictives', () => {
    assert.equal(value('PUBLIC_URL'), 'http://localhost:4321');
    assert.match(value('ORGANIZER_EMAILS'), /@example\.org$/);
    assert.equal(value('CORS_ORIGINS'), 'http://localhost:4321');
  });

  it('désactive par défaut le proxy et les tâches planifiées (poste local)', () => {
    assert.equal(value('IS_PROXIED'), 'false');
    assert.equal(value('CRON_ENABLED'), 'false');
  });

  it('pointe HelloAsso sur le faux local, avec des identifiants fictifs', () => {
    assert.equal(value('HELLOASSO_API_BASE'), 'http://localhost:4010/v5');
    assert.match(value('HELLOASSO_CLIENT_ID'), /^(fake|your|change|example)/i);
    assert.match(value('HELLOASSO_CLIENT_SECRET'), /^(fake|your|change|example)/i);
  });

});

describe('.env.example : aucun secret réel (NF-06)', () => {
  it('ne contient aucune clé Brevo, GitHub ou privée', () => {
    const text = fs.readFileSync(path.resolve(__dirname, '../../.env.example'), 'utf8');
    assert.ok(!/xkeysib-|xsmtpsib-|sk_live|ghp_|-----BEGIN/.test(text));
  });
});

/**
 * Déploiement (plan de la phase 1, section 4.3) : chaque variable de Strapi est listée une à une dans
 * `infra/deploy/base/docker-compose.base.yml`, réglée dans les overlays dev et prod, et le secret HelloAsso est fusionné par
 * `deploy.yml`. Une variable oubliée ne casse rien en test et reste vide sur le serveur : ces tests la rattrapent.
 */
describe('déploiement : variables de l’espace transmises à Strapi (NF-06)', () => {
  const REPO = path.resolve(__dirname, '../../..');
  const read = (file) => fs.readFileSync(path.join(REPO, file), 'utf8');
  const SPACE_VARIABLES = ['PUBLIC_URL', 'ORGANIZER_EMAILS', 'CORS_ORIGINS', 'IS_PROXIED', 'CRON_ENABLED', 'HELLOASSO_API_BASE', 'HELLOASSO_CLIENT_ID', 'HELLOASSO_CLIENT_SECRET'];

  for (const variable of SPACE_VARIABLES) {
    it(`docker-compose.base.yml transmet ${variable} à Strapi`, () => {
      assert.match(read('infra/deploy/base/docker-compose.base.yml'), new RegExp(`^\\s+${variable}:`, 'm'));
    });
  }

  // Phase 0 : sans EMAIL_PROVIDER ni EMAIL_FROM transmis, un Strapi en production choisit brevo sans expéditeur (I-30, Q-16).
  for (const variable of ['EMAIL_PROVIDER', 'EMAIL_FROM']) {
    it(`docker-compose.base.yml transmet aussi ${variable} (variable de la phase 0)`, () => {
      assert.match(read('infra/deploy/base/docker-compose.base.yml'), new RegExp(`^\\s+${variable}:`, 'm'));
    });
  }

  for (const overlay of ['dev/.env.dev', 'prod/.env.prod']) {
    it(`${overlay} active le proxy et les tâches planifiées (IS_PROXIED=true, CRON_ENABLED=true)`, () => {
      const text = read(`infra/deploy/overlays/${overlay}`);
      assert.match(text, /^(STRAPI_)?IS_PROXIED=true$/m);
      assert.match(text, /^(STRAPI_)?CRON_ENABLED=true$/m);
    });
  }

  it('deploy.yml fusionne le secret HelloAsso dans .env.secrets depuis le secret GitHub SECRET_HELLOASSO_CLIENT_SECRET', () => {
    assert.match(read('.github/workflows/deploy.yml'), /HELLOASSO_CLIENT_SECRET=\$\{\{ secrets\.SECRET_HELLOASSO_CLIENT_SECRET \}\}/);
  });
});

describe('déploiement : aucun secret HelloAsso en clair (NF-06)', () => {
  it('ni dans le compose, ni dans les overlays dev et prod', () => {
    const REPO = path.resolve(__dirname, '../../..');
    for (const file of ['infra/deploy/base/docker-compose.base.yml', 'infra/deploy/overlays/dev/.env.dev', 'infra/deploy/overlays/prod/.env.prod']) {
      assert.doesNotMatch(fs.readFileSync(path.join(REPO, file), 'utf8'), /^\s*(STRAPI_)?HELLOASSO_CLIENT_SECRET[:=]\s*[A-Za-z0-9]{8,}\s*$/m, file);
    }
  });
});
