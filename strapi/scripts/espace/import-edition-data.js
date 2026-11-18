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
 *     "topics": [{ "name": "Forêt", "sessions": ["Titre de la séquence"] }],
 *     "replaceTopics": false,
 *     "exhibitors": [{ "organisation": "Bois de France", "standNumber": "1" }],
 *     "speakers": [{ "name": "Prénom Nom", "email": "prenom.nom@example.org" }]
 *   }
 *
 * Topics (the tags of the profiles and of the directory filter): created by name, linked to the sequences named in `sessions`.
 * With `replaceTopics: true`, the topics of the edition that the file does not name are removed, and the profiles lose them.
 * Exhibitors: the organisation is found by its name (case and accents ignored), created and published when it does not exist,
 * then one Exhibitor per organisation and edition ; `standNumber` is updated when given. With `replaceExhibitors: true`, the
 * exhibitors of the edition that the file does not name are removed, except those the admin guards keep (pending or accepted meeting).
 * Files without personal data (topics, exhibitors) may live in scripts/espace/editions/ and be imported by the Deploy workflow.
 * Speakers: the account of the speaker is the attendee linked to the intervenant, or of the same name. Its address becomes
 * the real one (the fake address of a test account is replaced). Without an account, a speaker account is created. When
 * another attendee already holds the address (HelloAsso registration), that attendee becomes the speaker account and the
 * other one is reported, never removed.
 * `settings` (participantSpaceEnabled, tablesCount, slotDurationMinutes, meetingRequestsOpenAt, meetingRequestsCloseAt): written on the
 * draft and the published edition alike. `b2bSessions`: titles of the sequences that become B2B breaks, then the slots are regenerated.
 * `showTestSpeakers: true`: the speaker accounts with an @example.org address tick the directory and the meetings (test environments).
 * `testExhibitorReps: true`: a representative with an @example.org address for each exhibitor that has no active one (test environments).
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
  topic: 'api::espace.topic',
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

async function importTopics(app, edition, rows, replace, apply, log) {
  const sequences = await app.documents(UID.sequence).findMany({ filters: { edition: link(edition) }, status: 'published', fields: ['title'], limit: 1000 });
  const topics = await app.documents(UID.topic).findMany({ filters: { edition: link(edition) }, populate: { sessions: { fields: ['documentId'] } }, limit: 1000 });
  const kept = new Set();

  for (const row of rows) {
    const name = String(row.name ?? '').trim();
    if (!name) continue;
    const sessions = [];
    for (const title of row.sessions ?? []) {
      const sequence = sequences.find((item) => squeezed(item.title) === squeezed(title));
      if (sequence) sessions.push(link(sequence));
      else log(`séquence introuvable pour « ${name} » : ${title}`);
    }
    const wanted = sessions.map(({ documentId }) => documentId).sort().join();
    const topic = topics.find((item) => squeezed(item.name) === squeezed(name));
    if (!topic) {
      log(`sujet à créer : ${name} (${sessions.length} séquence(s))`);
      if (apply) await app.documents(UID.topic).create({ data: { name, edition: link(edition), sessions } });
      continue;
    }
    kept.add(topic.documentId);
    const current = [...new Set((topic.sessions ?? []).map(({ documentId }) => documentId))].sort().join();
    if (topic.name !== name || current !== wanted) {
      log(`sujet à mettre à jour : ${name}`);
      if (apply) await app.documents(UID.topic).update({ documentId: topic.documentId, data: { name, sessions } });
    } else {
      log(`sujet déjà en place : ${name}`);
    }
  }

  const others = topics.filter(({ documentId }) => !kept.has(documentId));
  if (!others.length) return;
  if (!replace) {
    log(`${others.length} autre(s) sujet(s) conservé(s) (replaceTopics absent)`);
    return;
  }
  log(`${others.length} sujet(s) à retirer : ${others.map(({ name }) => name).join(', ')}`);
  if (apply) for (const { documentId } of others) await app.documents(UID.topic).delete({ documentId });
}

async function importExhibitors(app, edition, rows, replace, apply, log) {
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

  if (!replace) return;
  const listed = new Set(rows.map((row) => squeezed(row.organisation)));
  for (const exhibitor of exhibitors) {
    const name = exhibitor.organisation?.name ?? '(sans organisation)';
    if (exhibitor.organisation && listed.has(squeezed(exhibitor.organisation.name))) continue;
    log(`exposant absent de la liste, à retirer : ${name}`);
    if (!apply) continue;
    try {
      await app.documents(UID.exhibitor).delete({ documentId: exhibitor.documentId });
    } catch (error) {
      // Garde NF-63 : un exposant qui porte un rendez-vous en attente ou accepté reste en place.
      log(`  conservé : ${error.message}`);
    }
  }
}

const SETTING_KEYS = ['participantSpaceEnabled', 'tablesCount', 'slotDurationMinutes', 'meetingRequestsOpenAt', 'meetingRequestsCloseAt'];
const shown = (value) => (value === null || value === undefined ? 'vide' : String(value));
const sameSetting = (key, a, b) => (key.endsWith('At') ? (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null) : (a ?? null) === (b ?? null));

/**
 * Private settings of the edition. Written on the draft and the published rows at once (scalar fields only), so that the
 * other unpublished edits of the draft are not published with them. Same checks as the admin guards (NF-63, NF-64).
 */
async function importSettings(app, edition, settings, apply, log) {
  const data = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!SETTING_KEYS.includes(key)) log(`réglage inconnu, ignoré : ${key}`);
    else if (sameSetting(key, edition[key], value)) log(`réglage déjà en place : ${key} = ${shown(value)}`);
    else {
      log(`réglage à changer : ${key}, ${shown(edition[key])} -> ${shown(value)}`);
      data[key] = value;
    }
  }
  const after = { ...edition, ...data };
  if (after.meetingRequestsOpenAt && after.meetingRequestsCloseAt && new Date(after.meetingRequestsOpenAt) >= new Date(after.meetingRequestsCloseAt)) {
    throw new Error('la fenêtre de rendez-vous se ferme avant de s’ouvrir');
  }
  if (data.tablesCount !== undefined) {
    const beyond = await app.documents('api::espace.meeting').count({ filters: { edition: link(edition), status: 'accepted', tableNumber: { $gt: data.tablesCount } } });
    if (beyond) {
      log(`  tablesCount conservé : ${beyond} rendez-vous accepté(s) occupent une table au-delà de ${data.tablesCount}`);
      delete data.tablesCount;
    }
  }
  if (apply && Object.keys(data).length) await app.db.query(UID.edition).updateMany({ where: { documentId: edition.documentId }, data });
  Object.assign(edition, data);
}

/** Sequences that are B2B breaks (kind b2b_break, R-01), then the slots regenerated from them (R-02). */
async function importB2bSessions(app, edition, titles, apply, log) {
  const lib = (name) => require(path.join(app.dirs.dist.src, 'api', 'espace', 'lib', name));
  const { parseProgramTime } = lib('time.js');
  const { computeSlots } = lib('slots.js');
  const sequences = await app.documents(UID.sequence).findMany({
    filters: { edition: link(edition) },
    status: 'published',
    fields: ['title', 'kind', 'start_time', 'end_time'],
    limit: 1000,
  });

  // A title names every sequence that bears it: a program often has several « Pause et B2B ».
  const named = titles.flatMap((title) => {
    const found = sequences.filter((item) => squeezed(item.title) === squeezed(title));
    if (!found.length) log(`séquence introuvable : ${title}`);
    return found;
  });
  for (const sequence of new Set(named)) {
    if (!parseProgramTime(sequence.start_time) || !parseProgramTime(sequence.end_time)) {
      log(`horaires illisibles (${shown(sequence.start_time)} à ${shown(sequence.end_time)}), séquence laissée hors B2B : ${sequence.title}`);
    } else if (sequence.kind === 'b2b_break') log(`pause B2B déjà en place : ${sequence.title}`);
    else {
      log(`séquence à passer en pause B2B : ${sequence.title} (${sequence.start_time} à ${sequence.end_time})`);
      if (apply) await app.db.query(UID.sequence).updateMany({ where: { documentId: sequence.documentId }, data: { kind: 'b2b_break' } });
      sequence.kind = 'b2b_break';
    }
  }

  if (!edition.date) throw new Error('l’édition n’a pas de date : aucun créneau possible');
  const { slots, warnings } = computeSlots({ date: edition.date, durationMinutes: edition.slotDurationMinutes ?? 15, sessions: sequences });
  log(`${slots.length} créneau(x) de ${edition.slotDurationMinutes ?? 15} min sur ${edition.tablesCount ?? 20} table(s) : ${slots.map(({ label }) => label).join(', ')}`);
  for (const { title, code } of warnings) log(`  avertissement ${code} : ${title}`);
  if (!apply) return;
  const report = await app.service('api::espace.slots').regenerate(edition.documentId);
  log(`créneaux écrits : ${report.created} créé(s), ${report.kept} conservé(s), ${report.removed} retiré(s), ${report.orphans.length} orphelin(s)`);
}

/** Test environments: the speaker accounts with a fake address (SPEAKER_TEST_ACCOUNTS) appear in full and take meeting requests. */
async function showTestSpeakers(app, edition, apply, log) {
  const accounts = await app.documents(UID.attendee).findMany({
    filters: { edition: link(edition), role: 'speaker', status: 'active', email: { $endsWith: '@example.org' } },
    fields: ['firstName', 'lastName', 'directoryOptIn', 'meetingsOptIn'],
    limit: 1000,
  });
  const hidden = accounts.filter(({ directoryOptIn, meetingsOptIn }) => !directoryOptIn || !meetingsOptIn);
  log(`${accounts.length} compte(s) de test d’intervenant, ${hidden.length} à rendre visible(s) et joignable(s)`);
  for (const account of hidden) {
    log(`  ${account.firstName} ${account.lastName}`);
    if (apply) await app.documents(UID.attendee).update({ documentId: account.documentId, data: { directoryOptIn: true, meetingsOptIn: true } });
  }
}

/**
 * Test environments: an exhibitor without an active representative cannot take a meeting request (R-14). Each one gets a
 * representative account « Stand <organisation> », stand.<organisation>@example.org, in the directory and open to meetings.
 */
async function createTestExhibitorReps(app, edition, apply, log) {
  const exhibitors = await app.documents(UID.exhibitor).findMany({
    filters: { edition: link(edition) },
    populate: { organisation: { fields: ['name'] }, representatives: { fields: ['status'] } },
    limit: 1000,
  });
  const attendees = await app.documents(UID.attendee).findMany({ filters: { edition: link(edition) }, fields: ['email'], limit: 10000 });
  const emails = new Set(attendees.map(({ email }) => email.toLowerCase()));

  for (const exhibitor of exhibitors) {
    const name = exhibitor.organisation?.name;
    if (!name) continue;
    if ((exhibitor.representatives ?? []).some(({ status }) => status === 'active')) {
      log(`représentant déjà en place : ${name}`);
      continue;
    }
    const email = `stand.${slugOf(name).replace(/-/g, '.')}@example.org`;
    if (emails.has(email)) {
      log(`adresse déjà prise, rien créé : ${email}`);
      continue;
    }
    log(`représentant de test à créer : Stand ${name}, ${email}`);
    if (!apply) continue;
    await app.documents(UID.attendee).create({
      data: {
        edition: link(edition),
        exhibitor: link(exhibitor),
        email,
        firstName: 'Stand',
        lastName: name,
        company: name,
        role: 'exhibitor_rep',
        status: 'active',
        directoryOptIn: true,
        meetingsOptIn: true,
      },
    });
    emails.add(email);
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

    if (input.settings) {
      console.log('Réglages');
      await importSettings(app, edition, input.settings, apply, log);
    }
    if (input.topics) {
      console.log('Sujets');
      await importTopics(app, edition, input.topics, input.replaceTopics === true, apply, log);
    }
    if (input.exhibitors) {
      console.log('Exposants');
      await importExhibitors(app, edition, input.exhibitors, input.replaceExhibitors === true, apply, log);
    }
    if (input.speakers) {
      console.log('Intervenants');
      await importSpeakers(app, edition, input.speakers, apply, log);
    }
    if (input.b2bSessions) {
      console.log('Pauses B2B et créneaux');
      await importB2bSessions(app, edition, input.b2bSessions, apply, log);
    }
    if (input.showTestSpeakers === true) {
      console.log('Comptes de test des intervenants');
      await showTestSpeakers(app, edition, apply, log);
    }
    if (input.testExhibitorReps === true) {
      console.log('Représentants de test des exposants');
      await createTestExhibitorReps(app, edition, apply, log);
    }
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
