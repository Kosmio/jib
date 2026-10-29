'use strict';

/**
 * Schémas Strapi de l'espace (A-03, A-15, section 3 du plan de la phase 1, 02-modele-donnees.md), lus dans les fichiers
 * `schema.json`, sans démarrer Strapi.
 *
 * Garde des relations (ACTIF, vaut pour toute la phase) : la prod est éditée directement dans le back-office, et changer
 * une relation existante fait recréer sa table de liaison, vide, au démarrage qui suit le déploiement. Les types
 * existants gardent donc leurs relations, médias et composants à l'identique (liste figée dans
 * `tests/fixtures/existing-schemas.json`, relevée au commit a70a56e), et ne reçoivent que des champs scalaires :
 * 9 champs privés sur `edition`, `kind` sur `sequence`. Toute relation nouvelle part d'un type nouveau `api::espace.*`.
 *
 * Modèle du lot 2 (tests d'abord) : les 10 types nouveaux, leurs relations et leurs champs clés.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { pending } = require('../helpers/pending');
const frozen = require('../fixtures/existing-schemas.json');

const API_DIR = path.resolve(__dirname, '../../src/api');
const STRUCTURAL = new Set(['relation', 'media', 'component', 'dynamiczone']);
const EDITION_FIELDS = [
  'participantSpaceEnabled',
  'helloassoOrgSlug',
  'helloassoFormType',
  'helloassoFormSlug',
  'helloassoFieldMap',
  'slotDurationMinutes',
  'tablesCount',
  'meetingRequestsOpenAt',
  'meetingRequestsCloseAt',
];
const ALLOWED_ADDITIONS = { edition: EDITION_FIELDS, sequence: ['kind'] };

const readSchema = (type, name = type) => JSON.parse(fs.readFileSync(path.join(API_DIR, type, 'content-types', name, 'schema.json'), 'utf8'));
const structuralOf = (attributes) => Object.fromEntries(Object.entries(attributes).filter(([, definition]) => STRUCTURAL.has(definition.type)));
const espaceTypes = () => {
  const dir = path.join(API_DIR, 'espace/content-types');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => fs.existsSync(path.join(dir, name, 'schema.json'))) : [];
};

describe('garde des relations : les types existants ne changent pas (A-15, mémoire projet)', () => {
  for (const [name, reference] of Object.entries(frozen)) {
    describe(name, () => {
      const current = readSchema(name);

      it('garde ses relations, ses médias et ses composants à l’identique', () => {
        assert.deepEqual(structuralOf(current.attributes), reference.structural);
      });

      it('garde sa table (collectionName) et chacun de ses attributs avec le même type', () => {
        assert.equal(current.collectionName, reference.collectionName);
        for (const [attribute, type] of Object.entries(reference.attributes)) {
          assert.equal(current.attributes[attribute]?.type, type, `${name}.${attribute}`);
        }
      });

      it('ne reçoit que des champs scalaires autorisés', () => {
        const added = Object.keys(current.attributes).filter((attribute) => !(attribute in reference.attributes));
        const allowed = ALLOWED_ADDITIONS[name] ?? [];
        assert.deepEqual(added.filter((attribute) => !allowed.includes(attribute)), [], `champs ajoutés à ${name} hors liste`);
        for (const attribute of added) {
          assert.ok(!STRUCTURAL.has(current.attributes[attribute].type), `${name}.${attribute} est une relation, un média ou un composant`);
        }
      });
    });
  }

  it('les champs ajoutés à edition sont tous privés (absents de l’API publique)', () => {
    const { attributes } = readSchema('edition');
    for (const attribute of Object.keys(attributes).filter((key) => !(key in frozen.edition.attributes))) {
      assert.equal(attributes[attribute].private, true, `edition.${attribute}`);
    }
  });

  it('aucun type existant ne vise un type de l’espace dans une relation', () => {
    for (const name of Object.keys(frozen)) {
      for (const [attribute, definition] of Object.entries(readSchema(name).attributes)) {
        assert.ok(!String(definition.target ?? '').startsWith('api::espace.'), `${name}.${attribute} cible ${definition.target}`);
      }
    }
  });
});

describe('types de l’espace : règles communes (A-03, 02-modele-donnees.md)', () => {
  for (const name of espaceTypes()) {
    describe(name, () => {
      const schema = readSchema('espace', name);

      it('range sa table sous espace_ et n’a ni brouillon ni publication', () => {
        assert.match(schema.collectionName, /^espace_[a-z_]+$/);
        assert.equal(schema.options?.draftAndPublish, false);
      });

      it('déclare ses relations vers un type existant sans côté inverse (unidirectionnelles)', () => {
        for (const [attribute, definition] of Object.entries(schema.attributes)) {
          if (definition.type !== 'relation' || definition.target.startsWith('api::espace.')) continue;
          assert.ok(!('inversedBy' in definition) && !('mappedBy' in definition), `${name}.${attribute} vers ${definition.target}`);
        }
      });
    });
  }
});

describe('modèle du lot 2 : les 10 types nouveaux (section 3 du plan)', pending('lot 2'), () => {
  const EXPECTED = {
    topic: { table: 'espace_topics', relations: { edition: 'api::edition.edition', sessions: 'api::sequence.sequence' } },
    slot: { table: 'espace_slots', relations: { edition: 'api::edition.edition', session: 'api::sequence.sequence' } },
    attendee: {
      table: 'espace_attendees',
      relations: { edition: 'api::edition.edition', speaker: 'api::intervenant.intervenant', exhibitor: 'api::espace.exhibitor', topics: 'api::espace.topic' },
    },
    exhibitor: {
      table: 'espace_exhibitors',
      relations: { edition: 'api::edition.edition', organisation: 'api::organisation.organisation', representatives: 'api::espace.attendee', topics: 'api::espace.topic' },
    },
    meeting: {
      table: 'espace_meetings',
      relations: {
        edition: 'api::edition.edition',
        slot: 'api::espace.slot',
        requester: 'api::espace.attendee',
        targetAttendee: 'api::espace.attendee',
        targetExhibitor: 'api::espace.exhibitor',
        answeredBy: 'api::espace.attendee',
      },
    },
    conversation: {
      table: 'espace_conversations',
      relations: { edition: 'api::edition.edition', participants: 'api::espace.attendee', meeting: 'api::espace.meeting' },
    },
    message: { table: 'espace_messages', relations: { conversation: 'api::espace.conversation', author: 'api::espace.attendee' } },
    'magic-token': { table: 'espace_magic_tokens', relations: { attendee: 'api::espace.attendee' } },
    'email-log': { table: 'espace_email_logs', relations: { attendee: 'api::espace.attendee' } },
    'sync-run': { table: 'espace_sync_runs', relations: { edition: 'api::edition.edition' } },
  };

  it('contient exactement ces 10 types (Notification est P2 : non créée)', () => {
    assert.deepEqual(espaceTypes().sort(), Object.keys(EXPECTED).sort());
  });

  for (const [name, { table, relations }] of Object.entries(EXPECTED)) {
    describe(name, () => {
      it(`s’appelle api::espace.${name} et range sa table dans ${table}`, () => {
        const schema = readSchema('espace', name);
        assert.equal(schema.collectionName, table);
        assert.equal(schema.info.singularName, name);
      });

      it('porte toutes ses relations, vers les bons types', () => {
        const { attributes } = readSchema('espace', name);
        const found = Object.fromEntries(Object.entries(attributes).filter(([, d]) => d.type === 'relation').map(([key, d]) => [key, d.target]));
        for (const [relation, target] of Object.entries(relations)) assert.equal(found[relation], target, `${name}.${relation}`);
        assert.deepEqual(Object.keys(found).filter((key) => !(key in relations)), [], `relations imprévues sur ${name}`);
      });
    });
  }

  it('A-15 : Topic.sessions est une relation manyToMany unidirectionnelle vers sequence', () => {
    const { sessions } = readSchema('espace', 'topic').attributes;
    assert.equal(sessions.relation, 'manyToMany');
    assert.ok(!('inversedBy' in sessions) && !('mappedBy' in sessions));
  });

  it('Attendee.exhibitor et Exhibitor.representatives sont les deux faces d’une même relation', () => {
    const { exhibitor } = readSchema('espace', 'attendee').attributes;
    const { representatives } = readSchema('espace', 'exhibitor').attributes;
    assert.equal(exhibitor.relation, 'manyToOne');
    assert.equal(exhibitor.inversedBy, 'representatives');
    assert.equal(representatives.relation, 'oneToMany');
    assert.equal(representatives.mappedBy, 'exhibitor');
  });

  it('Attendee.speaker est unidirectionnelle vers l’intervenant (aucun changement du type existant)', () => {
    const { speaker } = readSchema('espace', 'attendee').attributes;
    assert.equal(speaker.relation, 'manyToOne');
    assert.ok(!('inversedBy' in speaker) && !('mappedBy' in speaker));
  });

  it('Attendee : champs de 02-modele-donnees.md, rôles et statuts', () => {
    const { attributes } = readSchema('espace', 'attendee');
    for (const field of ['helloassoItemId', 'helloassoOrderId', 'email', 'firstName', 'lastName', 'jobTitle', 'company', 'role', 'bio', 'directoryOptIn', 'meetingsOptIn', 'newsOptIn', 'consentAt', 'activatedAt', 'lastSeenAt', 'status', 'emailPrefs', 'editedFields', 'photo']) {
      assert.ok(field in attributes, `attendee.${field}`);
    }
    assert.equal(attributes.email.type, 'string', 'e-mail en string, pas le type email de Strapi (R-44)');
    assert.deepEqual(attributes.role.enum, ['participant', 'speaker', 'exhibitor_rep', 'organizer']);
    assert.deepEqual(attributes.status.enum, ['active', 'cancelled']);
    assert.equal(attributes.role.default, 'participant');
    for (const optIn of ['directoryOptIn', 'meetingsOptIn', 'newsOptIn']) assert.equal(attributes[optIn].default, false, `${optIn} décoché par défaut (R-40)`);
  });

  it('Meeting : statuts du cycle de vie (R-10) et champ tableKey (R-13)', () => {
    const { attributes } = readSchema('espace', 'meeting');
    assert.deepEqual(attributes.status.enum, ['pending', 'accepted', 'declined', 'cancelled', 'expired']);
    assert.ok('tableKey' in attributes && 'tableNumber' in attributes && 'location' in attributes);
  });

  it('MagicToken : kind link ou session, empreinte unique, échéance et usage', () => {
    const { attributes } = readSchema('espace', 'magic-token');
    assert.deepEqual(attributes.kind.enum, ['link', 'session']);
    assert.equal(attributes.tokenHash.unique, true);
    for (const field of ['expiresAt', 'usedAt', 'ip']) assert.ok(field in attributes, `magic-token.${field}`);
  });

  it('EmailLog et SyncRun : champs d’idempotence et de journal (R-71, NF-13)', () => {
    const log = readSchema('espace', 'email-log').attributes;
    for (const field of ['template', 'scenarioKey', 'sentAt', 'providerMessageId', 'status']) assert.ok(field in log, `email-log.${field}`);
    assert.deepEqual(log.status.enum, ['sent', 'failed']);
    const run = readSchema('espace', 'sync-run').attributes;
    for (const field of ['startedAt', 'endedAt', 'created', 'updated', 'cancelled', 'errors']) assert.ok(field in run, `sync-run.${field}`);
    assert.equal(run.errors.type, 'json');
  });

  it('Edition : les 9 champs ajoutés sont privés, aux valeurs par défaut de 02-modele-donnees.md', () => {
    const { attributes } = readSchema('edition');
    for (const field of EDITION_FIELDS) {
      assert.ok(field in attributes, `edition.${field}`);
      assert.equal(attributes[field].private, true, `edition.${field} doit être privé`);
    }
    assert.equal(attributes.participantSpaceEnabled.default, false, 'NF-52 : espace fermé par défaut');
    assert.equal(attributes.slotDurationMinutes.default, 15);
    assert.equal(attributes.tablesCount.default, 20);
    assert.equal(attributes.helloassoFormType.default, 'Event');
    assert.deepEqual(attributes.helloassoFormType.enum, ['Event', 'Membership', 'CrowdFunding', 'Donation', 'PaymentForm', 'Checkout', 'Shop']);
    assert.equal(attributes.helloassoFieldMap.type, 'json');
  });

  it('Sequence.kind : talk, b2b_break ou other, talk par défaut, public', () => {
    const { kind } = readSchema('sequence').attributes;
    assert.deepEqual(kind.enum, ['talk', 'b2b_break', 'other']);
    assert.equal(kind.default, 'talk');
    assert.ok(!kind.private, 'sequence.kind reste lisible par l’API publique (le site et le MCP)');
  });

  it('le MCP ne reçoit que sequence.kind : aucun type de l’espace n’y figure (données personnelles, aucune route REST)', () => {
    const mcp = require('../../mcp/content-types.json');
    assert.ok('kind' in mcp.sequences.fields, 'sequences.fields.kind');
    assert.deepEqual(Object.keys(mcp).filter((key) => /attendee|topic|slot|exhibitor|meeting|conversation|message|token|email-log|sync/i.test(key)), []);
    for (const field of EDITION_FIELDS) assert.ok(!(field in mcp.editions.fields), `editions.fields.${field} ne doit pas figurer dans le MCP`);
  });
});
