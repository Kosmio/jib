'use strict';

/**
 * Serveur MCP (V5-F) : gardes pures de strapi/mcp/lib/guards.js, et synchronisation de strapi/mcp/content-types.json
 * avec les schémas de strapi/src/api (hors api::espace.*).
 *
 * Règle de synchronisation : chaque type exposé a un schéma ; chaque champ déclaré existe dans le schéma ; chaque attribut du
 * schéma est déclaré, relations, médias et composants compris (le fichier les décrit tous). Aucun champ technique n'est
 * exempté. Les types de l'espace sont absents du fichier.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const STRAPI = path.resolve(__dirname, '../..');
const REPO = path.resolve(STRAPI, '..');
const MCP_DIR = path.join(STRAPI, 'mcp');
const API_DIR = path.join(STRAPI, 'src/api');
const contentTypes = JSON.parse(fs.readFileSync(path.join(MCP_DIR, 'content-types.json'), 'utf8'));

const EDITION_SETTINGS = [
  'participantSpaceEnabled',
  'welcomeStartedAt',
  'helloassoOrgSlug',
  'helloassoFormType',
  'helloassoFormSlug',
  'helloassoFieldMap',
  'slotDurationMinutes',
  'tablesCount',
  'meetingRequestsOpenAt',
  'meetingRequestsCloseAt',
];

let g;
before(async () => {
  g = await import(pathToFileURL(path.join(MCP_DIR, 'lib/guards.js')).href);
});

const schemaOf = (ct) => {
  const file = path.join(API_DIR, ct.singularName, 'content-types', ct.singularName, 'schema.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};

describe('extractToken', () => {
  it('lit le jeton de l\'en-tête Authorization Bearer', () => {
    assert.equal(g.extractToken({ authorization: 'Bearer abc123' }), 'abc123');
  });
  it('accepte Bearer sans tenir compte de la casse', () => {
    assert.equal(g.extractToken({ authorization: 'bearer abc123' }), 'abc123');
  });
  it('renvoie null sans en-tête', () => {
    assert.equal(g.extractToken({}), null);
    assert.equal(g.extractToken(undefined), null);
  });
  it('renvoie null pour un schéma autre que Bearer', () => {
    assert.equal(g.extractToken({ authorization: 'Basic abc123' }), null);
  });
  it('renvoie null pour un Bearer vide ou contenant des espaces', () => {
    assert.equal(g.extractToken({ authorization: 'Bearer ' }), null);
    assert.equal(g.extractToken({ authorization: 'Bearer a b' }), null);
  });
  it('ignore un jeton placé ailleurs que dans l\'en-tête', () => {
    assert.equal(g.extractToken({ 'x-api-key': 'abc', token: 'abc' }), null);
  });
});

describe('hasTokenInUrl', () => {
  for (const key of ['token', 'access_token', 'api_token', 'apikey', 'api_key', 'TOKEN']) {
    it(`détecte ?${key}=`, () => assert.equal(g.hasTokenInUrl({ [key]: 'x' }), true));
  }
  it('ne détecte rien sans paramètre jeton', () => {
    assert.equal(g.hasTokenInUrl({ sessionId: 'x', page: '1' }), false);
  });
  it('tolère une requête absente ou vide', () => {
    assert.equal(g.hasTokenInUrl(undefined), false);
    assert.equal(g.hasTokenInUrl({}), false);
  });
});

describe('redactSecrets', () => {
  it('masque un jeton Bearer', () => {
    const out = g.redactSecrets('échec avec Authorization: Bearer sk-secret-123 reçu');
    assert.ok(!out.includes('sk-secret-123'));
    assert.ok(out.includes('Bearer [masqué]'));
  });
  it('masque token= et access_token= dans une URL', () => {
    const out = g.redactSecrets('GET /sse?token=abc&x=1 puis /m?access_token=def');
    assert.ok(!out.includes('abc'));
    assert.ok(!out.includes('def'));
    assert.ok(out.includes('x=1'));
  });
  it('laisse un texte sans secret intact', () => {
    assert.equal(g.redactSecrets('rien à masquer'), 'rien à masquer');
  });
  it('tolère undefined et null', () => {
    assert.equal(g.redactSecrets(undefined), '');
    assert.equal(g.redactSecrets(null), '');
  });
});

describe('assertContentTypeAllowed', () => {
  it('accepte chaque type de content-types.json', () => {
    for (const name of Object.keys(contentTypes)) assert.equal(g.assertContentTypeAllowed(name, contentTypes), name);
  });
  it('refuse un type absent du fichier', () => {
    assert.throws(() => g.assertContentTypeAllowed('users', contentTypes), /inconnu ou non exposé/);
  });
  it('refuse un uid api::espace.* dans toutes les casses', () => {
    for (const uid of ['api::espace.attendee', 'API::ESPACE.attendee', '  api::espace.meeting']) {
      assert.throws(() => g.assertContentTypeAllowed(uid, contentTypes), /espace participant/, uid);
    }
  });
  it('refuse le nom pluriel d\'un type de l\'espace', () => {
    for (const name of ['attendees', 'meetings', 'messages', 'email-logs', 'sync-runs', 'erased-emails']) {
      assert.throws(() => g.assertContentTypeAllowed(name, contentTypes), undefined, name);
    }
  });
  it('refuse les noms de forme dangereuse', () => {
    for (const name of ['../admin', 'tags/1', 'tags?x=1', 'Tags', '', undefined, 'tags ']) {
      if (name === 'tags ') continue; // espaces finaux retirés par trim : accepté
      assert.throws(() => g.assertContentTypeAllowed(name, contentTypes), undefined, String(name));
    }
  });
  it('refuse les clés héritées d\'Object', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasownproperty']) {
      assert.throws(() => g.assertContentTypeAllowed(name, contentTypes), undefined, name);
    }
  });
});

describe('assertDocumentId et assertFieldName', () => {
  it('accepte un documentId usuel', () => {
    assert.equal(g.assertDocumentId('abc123XYZ_-9'), 'abc123XYZ_-9');
  });
  it('refuse un documentId avec chemin, requête, espace, vide ou trop long', () => {
    for (const id of ['../x', 'a/b', 'a?b=1', 'a b', '', undefined, 'a'.repeat(65)]) {
      assert.throws(() => g.assertDocumentId(id), /documentId invalide/, String(id));
    }
  });
  it('accepte un nom de champ simple ou pointé', () => {
    assert.equal(g.assertFieldName('title'), 'title');
    assert.equal(g.assertFieldName('organisation.name'), 'organisation.name');
  });
  it('refuse un nom de champ avec crochets, espaces, symboles ou vide', () => {
    for (const f of ['a[b]', 'a b', 'a&b=1', '.a', 'a.', '', undefined]) {
      assert.throws(() => g.assertFieldName(f), /champ invalide/, String(f));
    }
  });
});

describe('suppression protégée', () => {
  it('assertDeleteConfirmed exige exactement true', () => {
    assert.doesNotThrow(() => g.assertDeleteConfirmed(true));
    for (const v of [false, undefined, null, 'true', 1, 'yes', {}]) {
      assert.throws(() => g.assertDeleteConfirmed(v), /non confirmée/, String(v));
    }
  });
  it('checkDelete renvoie le type et l\'identifiant quand tout est valide', () => {
    assert.deepEqual(g.checkDelete({ contentType: 'tags', documentId: 'abc', confirm: true }, contentTypes), {
      contentType: 'tags',
      documentId: 'abc',
    });
  });
  it('checkDelete refuse sans confirm', () => {
    assert.throws(() => g.checkDelete({ contentType: 'tags', documentId: 'abc' }, contentTypes), /non confirmée/);
    assert.throws(() => g.checkDelete({ contentType: 'tags', documentId: 'abc', confirm: 'true' }, contentTypes), /non confirmée/);
  });
  it('checkDelete refuse un type de l\'espace même confirmé', () => {
    assert.throws(
      () => g.checkDelete({ contentType: 'api::espace.attendee', documentId: 'abc', confirm: true }, contentTypes),
      /espace participant/,
    );
  });
  it('checkDelete refuse un type inconnu même confirmé', () => {
    assert.throws(() => g.checkDelete({ contentType: 'attendees', documentId: 'abc', confirm: true }, contentTypes));
  });
  it('checkDelete refuse un documentId dangereux même confirmé', () => {
    assert.throws(() => g.checkDelete({ contentType: 'tags', documentId: '../x', confirm: true }, contentTypes), /documentId/);
  });
});

describe('describeContentTypes', () => {
  it('décrit chaque type avec ses champs et signale les champs privés', () => {
    const list = g.describeContentTypes(contentTypes);
    assert.equal(list.length, Object.keys(contentTypes).length);
    const edition = list.find((t) => t.pluralName === 'editions');
    const field = edition.fields.find((f) => f.name === 'helloassoFieldMap');
    assert.equal(field.private, true);
    assert.equal(edition.fields.find((f) => f.name === 'title').private, false);
  });
});

describe('content-types.json', () => {
  it('ne contient aucun type de l\'espace', () => {
    for (const [plural, ct] of Object.entries(contentTypes)) {
      assert.ok(!plural.startsWith(g.ESPACE_UID_PREFIX), plural);
      assert.ok(!JSON.stringify(ct).includes(g.ESPACE_UID_PREFIX), `${plural} mentionne ${g.ESPACE_UID_PREFIX}`);
    }
  });
  it('expose chaque type de strapi/src/api hors espace', () => {
    const dirs = fs.readdirSync(API_DIR).filter((d) => d !== 'espace' && fs.existsSync(path.join(API_DIR, d, 'content-types', d, 'schema.json')));
    const exposed = Object.values(contentTypes).map((c) => c.singularName);
    for (const d of dirs) assert.ok(exposed.includes(d), `type ${d} absent de content-types.json`);
  });
  for (const [plural, ct] of Object.entries(contentTypes)) {
    describe(plural, () => {
      it('a un schéma, un nom pluriel et un draftAndPublish concordants', () => {
        const schema = schemaOf(ct);
        assert.ok(schema, `schéma introuvable pour ${ct.singularName}`);
        // Un type unique se route par son nom singulier (/api/home-page), les autres par le pluriel.
        assert.equal(schema.kind === 'singleType' ? schema.info.singularName : schema.info.pluralName, plural);
        assert.equal(schema.info.singularName, ct.singularName);
        assert.equal(Boolean(schema.options?.draftAndPublish), ct.draftAndPublish);
      });
      it('ne déclare aucun champ absent du schéma', () => {
        const attrs = Object.keys(schemaOf(ct).attributes);
        const extra = Object.keys(ct.fields).filter((f) => !attrs.includes(f));
        assert.deepEqual(extra, []);
      });
      it('déclare tous les champs du schéma', () => {
        const declared = Object.keys(ct.fields);
        const missing = Object.keys(schemaOf(ct).attributes).filter((f) => !declared.includes(f));
        assert.deepEqual(missing, []);
      });
      it('marque private les champs privés du schéma', () => {
        for (const [name, attr] of Object.entries(schemaOf(ct).attributes)) {
          if (attr.private) assert.equal(ct.fields[name]?.private, true, `${name} doit être private`);
        }
      });
      it('décrit chaque champ (type et description)', () => {
        for (const [name, f] of Object.entries(ct.fields)) {
          assert.ok(f.type, `${name}: type`);
          assert.ok(f.description && f.description.length > 5, `${name}: description`);
        }
      });
    });
  }
  it('porte les réglages de l\'espace sur editions', () => {
    for (const name of EDITION_SETTINGS) {
      assert.ok(contentTypes.editions.fields[name], `${name} absent`);
      assert.equal(contentTypes.editions.fields[name].private, true, `${name} doit être private`);
    }
  });
});

describe('tirets cadratins', () => {
  const walk = (p) => {
    if (!fs.existsSync(p)) return [];
    const st = fs.statSync(p);
    if (st.isFile()) return [p];
    return fs.readdirSync(p).flatMap((n) => (n === 'node_modules' || n === 'pnpm-lock.yaml' ? [] : walk(path.join(p, n))));
  };
  const targets = [
    ...walk(MCP_DIR),
    path.join(REPO, 'web/public/llms.txt'),
    path.join(REPO, 'web/public/.well-known/mcp.json'),
  ].filter((f) => !f.endsWith('pnpm-lock.yaml'));
  it('cible les fichiers attendus', () => {
    const names = targets.map((f) => path.relative(REPO, f));
    for (const n of ['strapi/mcp/README.md', 'strapi/mcp/content-types.json', 'strapi/mcp/index.js', 'strapi/mcp/lib/guards.js', 'web/public/llms.txt', 'web/public/.well-known/mcp.json']) {
      assert.ok(names.includes(n), n);
    }
  });
  for (const f of targets) {
    it(`${path.relative(REPO, f)} sans tiret cadratin`, () => {
      const text = fs.readFileSync(f, 'utf8');
      assert.ok(!text.includes('—'), 'U+2014 présent');
      assert.ok(!/&mdash;|&#8212;|\\u2014/i.test(text), 'entité du tiret cadratin présente');
    });
  }
});
