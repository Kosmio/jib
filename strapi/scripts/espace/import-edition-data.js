'use strict';

/**
 * Loads the data an organiser sends for an edition of the participant space: the exhibitors and the real e-mail
 * addresses of the speakers. Starts Strapi without an HTTP server, like the seed, and stops.
 *
 *   node scripts/espace/import-edition-data.js <file.json>            dry run: prints what would change, writes nothing
 *   node scripts/espace/import-edition-data.js <file.json> --apply    writes
 *
 * The file holds personal data: it stays out of the repository (scripts/espace/local/ is ignored by git). Shape:
 *
 *   {
 *     "edition": "nouvelle-aquitaine",
 *     "exhibitors": [{ "organisation": "Bois de France", "standNumber": "1" }],
 *     "speakers": [{ "name": "Prénom Nom", "email": "prenom.nom@example.org" }]
 *   }
 *
 * Exhibitors: the organisation is found by its name (case and accents ignored), created and published when it does not exist,
 * then one Exhibitor per organisation and edition ; `standNumber` is updated when given.
 * Speakers: the account of the speaker is the attendee linked to the intervenant, or of the same name. Its address becomes
 * the real one (the fake address of a test account is replaced). Without an account, a speaker account is created. When
 * another attendee already holds the address (HelloAsso registration), that attendee becomes the speaker account and the
 * other one is reported, never removed.
 * Idempotent: a second run changes nothing. No e-mail is sent here ; the next synchronization sends `welcome` to new accounts.
 */

const fs = require('node:fs');
const path = require('node:path');
const { compileStrapi, createStrapi } = require('@strapi/strapi');

const UID = {
  edition: 'api::edition.edition',
  sequence: 'api::sequence.sequence',
  intervenant: 'api::intervenant.intervenant',
  organisation: 'api::organisation.organisation',
  exhibitor: 'api::espace.exhibitor',
  attendee: 'api::espace.attendee',
};

/** Name without case, accents, punctuation nor repeated spaces: « Wood & Co » and « Wood&Co » compare equal. */
const plain = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const squeezed = (text) => plain(text).replace(/ /g, '');
const slugOf = (text) => plain(text).replace(/ /g, '-');
const link = ({ documentId }) => ({ documentId });

/**
 * What to do for one speaker row, from the accounts of the edition. Pure, so that a unit test can call it.
 * -> { action: 'none' | 'update' | 'create' | 'promote' | 'invalid', attendee?, duplicate? }
 */
function planSpeaker({ row, intervenant, attendees }) {
  const email = String(row.email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !plain(row.name)) return { action: 'invalid' };

  const sameName = (attendee) => squeezed(`${attendee.firstName} ${attendee.lastName}`) === squeezed(row.name);
  const account = attendees.find((attendee) => intervenant && attendee.speaker?.documentId === intervenant.documentId) ?? attendees.find(sameName);
  const holder = attendees.find((attendee) => attendee.email.toLowerCase() === email);

  if (holder && account && holder.documentId !== account.documentId) return { action: 'promote', attendee: holder, duplicate: account, email };
  if (holder) {
    const linked = !intervenant || holder.speaker?.documentId === intervenant.documentId;
    return holder.role === 'speaker' && linked ? { action: 'none', attendee: holder, email } : { action: 'promote', attendee: holder, email };
  }
  return account ? { action: 'update', attendee: account, email } : { action: 'create', email };
}

async function importExhibitors(app, edition, rows, apply, log) {
  const organisations = await app.documents(UID.organisation).findMany({ status: 'published', fields: ['name', 'slug'], limit: 5000 });
  const exhibitors = await app.documents(UID.exhibitor).findMany({
    filters: { edition: link(edition) },
    populate: { organisation: { fields: ['documentId', 'name'] } },
    limit: 1000,
  });

  for (const row of rows) {
    const name = String(row.organisation ?? '').trim();
    if (!name) continue;
    let organisation = organisations.find((item) => squeezed(item.name) === squeezed(name));
    if (!organisation) {
      log(`organisation à créer : ${name}`);
      if (apply) organisation = await app.documents(UID.organisation).create({ data: { name, slug: slugOf(name) }, status: 'published' });
    }
    const exhibitor = organisation && exhibitors.find((item) => item.organisation?.documentId === organisation.documentId);
    const standNumber = row.standNumber == null || row.standNumber === '' ? null : String(row.standNumber);

    if (!exhibitor) {
      log(`exposant à créer : ${name}${standNumber ? `, stand ${standNumber}` : ''}`);
      if (apply) await app.documents(UID.exhibitor).create({ data: { edition: link(edition), organisation: link(organisation), standNumber } });
    } else if (standNumber && exhibitor.standNumber !== standNumber) {
      log(`exposant ${name} : stand ${exhibitor.standNumber ?? 'vide'} -> ${standNumber}`);
      if (apply) await app.documents(UID.exhibitor).update({ documentId: exhibitor.documentId, data: { standNumber } });
    } else {
      log(`exposant déjà en place : ${name}`);
    }
  }
}

async function importSpeakers(app, edition, rows, apply, log) {
  // Intervenants of the published program first, then any intervenant of the same name.
  const sequences = await app.documents(UID.sequence).findMany({
    filters: { edition: link(edition) },
    status: 'published',
    populate: { interventions: { populate: { intervenants: { fields: ['documentId', 'name'] } } } },
    limit: 1000,
  });
  const onProgram = new Map();
  for (const { interventions = [] } of sequences) {
    for (const { intervenants = [] } of interventions) for (const person of intervenants) onProgram.set(person.documentId, person);
  }
  const everyone = await app.documents(UID.intervenant).findMany({ status: 'published', fields: ['name'], limit: 5000 });
  const intervenantOf = (name) =>
    [...onProgram.values()].find((person) => squeezed(person.name) === squeezed(name)) ?? everyone.find((person) => squeezed(person.name) === squeezed(name)) ?? null;

  const attendees = await app.documents(UID.attendee).findMany({
    filters: { edition: link(edition) },
    fields: ['email', 'firstName', 'lastName', 'role', 'status'],
    populate: { speaker: { fields: ['documentId'] } },
    limit: 10000,
  });

  const named = new Set();
  for (const row of rows) {
    const intervenant = intervenantOf(row.name);
    if (intervenant) named.add(intervenant.documentId);
    const plan = planSpeaker({ row, intervenant, attendees });
    const speaker = intervenant ? link(intervenant) : null;
    const note = intervenant ? (onProgram.has(intervenant.documentId) ? '' : ' (intervenant hors programme publié)') : ' (aucun intervenant de ce nom dans Strapi)';

    if (plan.action === 'invalid') {
      log(`ligne ignorée, nom ou adresse illisible : ${row.name ?? ''}`);
    } else if (plan.action === 'none') {
      log(`déjà en place : ${row.name}`);
    } else if (plan.action === 'update') {
      log(`adresse à remplacer : ${row.name}, ${plan.attendee.email} -> ${plan.email}${note}`);
      if (apply) {
        const data = { email: plan.email, role: 'speaker', ...(speaker && { speaker }) };
        await app.documents(UID.attendee).update({ documentId: plan.attendee.documentId, data });
        plan.attendee.email = plan.email;
      }
    } else if (plan.action === 'promote') {
      log(`inscrit existant à passer intervenant : ${row.name}, ${plan.email}${note}`);
      if (plan.duplicate) log(`  doublon à retirer à la main : ${plan.duplicate.firstName} ${plan.duplicate.lastName}, ${plan.duplicate.email}`);
      if (apply) {
        // The link to the intervenant moves only when no other account holds it: the duplicate keeps it until someone removes it.
        const data = { role: 'speaker', ...(speaker && !plan.duplicate && { speaker }) };
        await app.documents(UID.attendee).update({ documentId: plan.attendee.documentId, data });
      }
    } else {
      log(`compte intervenant à créer : ${row.name}, ${plan.email}${note}`);
      const [firstName, ...rest] = String(row.name).trim().split(/\s+/);
      const data = { edition: link(edition), email: plan.email, firstName, lastName: rest.join(' ') || firstName, role: 'speaker', status: 'active', ...(speaker && { speaker }) };
      if (apply) attendees.push({ ...(await app.documents(UID.attendee).create({ data })), speaker });
      else attendees.push({ documentId: `new:${plan.email}`, ...data });
    }
  }

  for (const person of onProgram.values()) {
    if (!named.has(person.documentId) && !/confirmer/i.test(person.name)) log(`au programme, absent du fichier : ${person.name}`);
  }
}

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  const apply = flags.includes('--apply');
  if (!file) {
    console.error('Usage : node scripts/espace/import-edition-data.js <fichier.json> [--apply]');
    process.exit(1);
  }
  const input = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));

  process.env.DEMO_SEED = 'false';
  const app = createStrapi(await compileStrapi());
  app.log.level = 'error';
  await app.load();
  try {
    const edition = await app.documents(UID.edition).findFirst({ filters: { slug: input.edition }, status: 'published' });
    if (!edition) throw new Error(`édition publiée introuvable : ${input.edition}`);
    const database = app.config.get('database.connection.connection.database');
    console.log(`${apply ? 'Écriture' : 'Simulation (rien n’est écrit, ajouter --apply)'} : édition ${edition.slug}, base ${database}`);
    const log = (line) => console.log(`  ${line}`);

    console.log('Exposants');
    await importExhibitors(app, edition, input.exhibitors ?? [], apply, log);
    console.log('Intervenants');
    await importSpeakers(app, edition, input.speakers ?? [], apply, log);
  } finally {
    // Strapi emits the entry.* events without awaiting them: leave them the time to end before the connection closes.
    await new Promise((resolve) => setTimeout(resolve, 750));
    await app.destroy();
  }
}

module.exports = { planSpeaker, plain, squeezed };

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
