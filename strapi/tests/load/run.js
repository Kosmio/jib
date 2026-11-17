'use strict';

/**
 * Charge de l'espace participant (V4-E, T-73, NF-21), en Node pur (fetch et Promise), sur la base `strapi_load_test`.
 * 200 participants actifs, 600 rendez-vous (pending, accepted, declined), 20 utilisateurs simultanes pendant 30 s par route.
 * Seuil : p95 <= 300 ms. Le Strapi et le generateur de charge partagent le meme processus Node (helpers existants) :
 * les chiffres sont donc pessimistes. Variables : LOAD_USERS (20), LOAD_SECONDS (30).
 * Sortie : tableau texte et JSON sur la sortie standard. La base est supprimee a la fin.
 */

const os = require('node:os');
const { startEspace } = require('../helpers/espace');
const { dropDatabase } = require('../helpers/database');
const { createMeetingEdition, createPerson, seedMeeting } = require('../helpers/meetings-world');

const DATABASE = 'strapi_load_test';
const USERS = Number(process.env.LOAD_USERS || 20);
const SECONDS = Number(process.env.LOAD_SECONDS || 30);
const PARTICIPANTS = 200;
const MEETINGS = 600;
const THRESHOLD_MS = 300;

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];

async function main() {
  const espace = await startEspace({ database: DATABASE });
  let failed = false;
  try {
    const { app } = espace;
    const { edition, slotList } = await createMeetingEdition(app, { slug: 'charge', title: 'Edition de charge', daysAhead: 20, tablesCount: 3 });
    console.log(`Edition ${edition.slug}, ${slotList.length} creneaux`);

    const people = [];
    for (let i = 0; i < PARTICIPANTS; i += 1) {
      people.push(await createPerson(app, edition, { email: `charge.${String(i).padStart(3, '0')}@example.org`, lastName: `Charge${i}`, lookingFor: 'bois', offering: 'conseil' }));
    }
    const organizer = await createPerson(app, edition, { email: 'organisation@example.org', role: 'organizer', firstName: 'Olivia', lastName: 'Organisatrice' });

    const statuses = ['pending', 'accepted', 'declined'];
    const tables = new Map();
    const used = new Set();
    let created = 0;
    for (let i = 0; created < MEETINGS && i < MEETINGS * 20; i += 1) {
      const requester = people[i % PARTICIPANTS];
      const target = people[(i * 7 + 13 + Math.floor(i / PARTICIPANTS) * 31) % PARTICIPANTS];
      if (requester === target) continue;
      // Un participant n'a qu'un rendez-vous par creneau : on cherche un creneau libre pour les deux.
      const free = (candidate) => !used.has(`${candidate.documentId}:${requester.documentId}`) && !used.has(`${candidate.documentId}:${target.documentId}`);
      const slot = Array.from({ length: slotList.length }, (_, k) => slotList[(i + k) % slotList.length]).find(free);
      if (!slot) continue;
      used.add(`${slot.documentId}:${requester.documentId}`);
      used.add(`${slot.documentId}:${target.documentId}`);
      const status = statuses[created % 3];
      let tableNumber;
      if (status === 'accepted') {
        const n = (tables.get(slot.documentId) || 0) + 1;
        if (n <= 3) {
          tables.set(slot.documentId, n);
          tableNumber = n;
        }
      }
      await seedMeeting(app, { edition, slot, requester, target, status, tableNumber, message: 'Bonjour, echangeons.', ...(status !== 'pending' && { answeredBy: target }) });
      created += 1;
    }
    console.log(`${people.length} participants, ${created} rendez-vous`);

    const logins = [];
    for (let i = 0; i < USERS; i += 1) logins.push((await espace.signIn(edition.slug, people[i].email)).cookie);
    const organizerCookie = (await espace.signIn(edition.slug, organizer.email)).cookie;
    console.log(`${logins.length} sessions participants et 1 organisateur`);

    const routes = [
      { name: 'GET /me', path: '/api/espace/me', organizer: false },
      { name: 'GET /directory', path: '/api/espace/directory', organizer: false },
      { name: 'GET /meetings', path: '/api/espace/meetings', organizer: false },
      { name: `GET /admin/${edition.slug}/stats`, path: `/api/espace/admin/${edition.slug}/stats`, organizer: true },
      { name: `GET /admin/${edition.slug}/attendees`, path: `/api/espace/admin/${edition.slug}/attendees`, organizer: true },
    ];

    // Comptage des requetes SQL d'un appel isole (journal de knex).
    let sql = 0;
    const listener = () => { sql += 1; };
    app.db.connection.on('query', listener);
    for (const route of routes) {
      const cookie = route.organizer ? organizerCookie : logins[0];
      await espace.request(route.path, { cookie });
      sql = 0;
      const res = await espace.request(route.path, { cookie });
      route.sql = sql;
      route.bytes = res.text.length;
      route.status = res.status;
      if (res.status !== 200) console.log(`ATTENTION ${route.name} : ${res.status} ${res.text.slice(0, 200)}`);
    }
    app.db.connection.off('query', listener);

    const results = [];
    for (const route of routes) {
      const latencies = [];
      const codes = {};
      const end = Date.now() + SECONDS * 1000;
      const worker = async (index) => {
        const cookie = route.organizer ? organizerCookie : logins[index];
        while (Date.now() < end) {
          const t0 = performance.now();
          const res = await espace.request(route.path, { cookie, ip: `10.9.0.${index + 1}` });
          latencies.push(performance.now() - t0);
          codes[res.status] = (codes[res.status] || 0) + 1;
        }
      };
      await Promise.all(Array.from({ length: USERS }, (_, i) => worker(i)));
      latencies.sort((a, b) => a - b);
      const row = {
        route: route.name,
        requests: latencies.length,
        p50: Math.round(percentile(latencies, 50)),
        p95: Math.round(percentile(latencies, 95)),
        max: Math.round(latencies[latencies.length - 1]),
        sql: route.sql,
        bytes: route.bytes,
        codes,
        ok: percentile(latencies, 95) <= THRESHOLD_MS && Object.keys(codes).every((c) => c === '200'),
      };
      results.push(row);
      console.log(JSON.stringify(row));
    }

    console.log(`\nMachine : ${os.cpus()[0].model}, ${os.cpus().length} coeurs, ${(os.totalmem() / 2 ** 30).toFixed(1)} Go, libre ${(os.freemem() / 2 ** 30).toFixed(1)} Go, Node ${process.version}`);
    console.log(`Parametres : ${USERS} utilisateurs, ${SECONDS} s par route, seuil p95 ${THRESHOLD_MS} ms\n`);
    console.log('| Route | Requetes | p50 ms | p95 ms | max ms | SQL | Octets | Statuts | Seuil |');
    console.log('|---|---|---|---|---|---|---|---|---|');
    for (const r of results) console.log(`| ${r.route} | ${r.requests} | ${r.p50} | ${r.p95} | ${r.max} | ${r.sql} | ${r.bytes} | ${JSON.stringify(r.codes)} | ${r.ok ? 'tenu' : 'depasse'} |`);
    failed = results.some((r) => !r.ok);
  } finally {
    await espace.stop();
    await dropDatabase(DATABASE);
    console.log(`Base ${DATABASE} supprimee.`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  try { await dropDatabase(DATABASE); } catch {}
  process.exit(2);
});
