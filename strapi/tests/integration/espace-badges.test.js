'use strict';

/**
 * Badges et carte publique, lot V4-D1 (docs/espace/specs/12-badges.md) : F-95 à F-99, R-80 à R-84, I-43, NF-54 à NF-57, T-60 à T-66, T-68.
 *
 * Routes :
 *   POST /api/espace/admin/:edition/badges  { types?, sort? }  -> application/pdf, X-Badges-Count, X-Badges-Reduced
 *   GET  /api/espace/admin/:edition/attendees/:id/badge          -> application/pdf
 *   POST /api/espace/admin/:edition/attendees/:id/card-token/regenerate -> { regeneratedAt }
 *   GET  /api/espace/cards/:edition/:token                       -> public, 30 requêtes par minute et par IP, 404 CARD_NOT_FOUND uniforme
 *
 * Le PDF est lu comme le lira l'imprimante : pdftotext (position des mots), pdftoppm (rendu) et une relecture du QR sur le rendu, module par
 * module (aucun décodeur de QR n'est installé : une matrice relue identique à qrMatrix(URL attendue) donne l'URL à tout lecteur). L'annotation
 * /URI du fichier porte la même URL. Ignoré (skip) sans poppler.
 *
 * Écarts acceptés : Helvetica intégrée et Azonix.otf ; organisateurs en carte réduite.
 * Hors de portée à ce lot : « édition en lecture seule » de T-63, le champ `readOnlyAt` (NF-70) n'existant pas encore ; test `todo`.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { freshIp, sha256, useEspace } = require('../helpers/espace');
const { UID, createAttendee, createEdition, createProgram, link } = require('../helpers/espace-data');
const { makePng } = require('../helpers/png');
const { CARD_TOKEN_PATTERN, cardUrl, deriveCardToken, qrMatrix } = require('../../src/api/espace/lib/badges');
const items = require('../../scripts/espace/fixtures/helloasso-items.json');
const recette = require('../../scripts/espace/fixtures/recette.json');
const { mapItem } = require('../../src/api/espace/lib/import');

const SETTING = 'api::espace.badge-setting';
const MESSAGE = 'Cette carte n’est plus valable.';
const ORGANIZER = 'organisation@example.org';

const tool = (name) => ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'].map((dir) => path.join(dir, name)).find((file) => fs.existsSync(file));
const PDFTOPPM = tool('pdftoppm');
const PDFTOTEXT = tool('pdftotext');
const skip = PDFTOPPM && PDFTOTEXT ? false : 'poppler (pdftoppm, pdftotext) absent';

const MM = 72 / 25.4;
const A4 = { width: 595.28, height: 841.89 };
const MID = A4.width / 2;
const MARGIN = 10 * MM;
const DPI = 150;

// ----- lecture d'un PDF ------------------------------------------------------------------------------------------------------------------

const pageCount = (buffer) => (buffer.toString('latin1').match(/\/Type \/Page(?![s\w])/g) ?? []).length;

/** Pages dans l'ordre, avec l'URL (/URI) et le cadre (/Rect) de l'annotation du QR. */
function pdfPages(buffer) {
  const text = buffer.toString('latin1');
  const objects = new Map([...text.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)].map((match) => [Number(match[1]), match[2]]));
  const refs = (source) => [...source.matchAll(/(\d+) 0 R/g)].map((match) => Number(match[1]));
  const tree = [...objects.values()].find((body) => /\/Type \/Pages/.test(body));
  return refs(/\/Kids \[([^\]]*)\]/.exec(tree)[1]).map((id) => {
    const page = objects.get(id);
    const annots = /\/Annots \[([^\]]*)\]/.exec(page);
    const annot = annots ? objects.get(refs(annots[1])[0]) : '';
    const action = /\/A (\d+) 0 R/.exec(annot)?.[1];
    return {
      mediaBox: /\/MediaBox \[([^\]]*)\]/.exec(page)?.[1].trim().split(/\s+/).map(Number),
      uri: /\/URI \(([^)]*)\)/.exec(`${annot}${action ? objects.get(Number(action)) : ''}`)?.[1],
      rect: /\/Rect \[([^\]]*)\]/.exec(annot)?.[1].trim().split(/\s+/).map(Number),
    };
  });
}

function pdfWords(file) {
  const run = spawnSync(PDFTOTEXT, ['-bbox', file, '-'], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr);
  const unescape = (text) => text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'');
  return run.stdout.split('<page ').slice(1).map((page) =>
    [...page.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((m) => ({ x0: Number(m[1]), y0: Number(m[2]), x1: Number(m[3]), y1: Number(m[4]), text: unescape(m[5]) })),
  );
}

/** Pages rendues : { width, height, channels, data } ; en niveaux de gris (QR) ou en couleur (bandeau). */
function renderPages(file, directory, { color = false } = {}) {
  const run = spawnSync(PDFTOPPM, [...(color ? [] : ['-gray']), '-r', String(DPI), file, path.join(directory, 'page')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return fs.readdirSync(directory).filter((name) => /^page-\d+\.p[gp]m$/.test(name)).sort().map((name) => {
    const bytes = fs.readFileSync(path.join(directory, name));
    const header = /^P[56]\s+(\d+)\s+(\d+)\s+255\s/.exec(bytes.subarray(0, 40).toString('latin1'));
    return { width: Number(header[1]), height: Number(header[2]), channels: color ? 3 : 1, data: bytes.subarray(header[0].length) };
  });
}

/** Matrice du QR relue sur le rendu (position de l'annotation), et zone de silence. */
function readQr(image, rect, size) {
  const scale = DPI / 72;
  const [x0, , x1, y1] = rect;
  const side = x1 - x0;
  const module = side / size;
  const top = A4.height - y1;
  const pixel = (x, y) => image.data[Math.round(y * scale) * image.width + Math.round(x * scale)];
  const rows = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => pixel(x0 + (col + 0.5) * module, top + (row + 0.5) * module) < 128));
  const quiet = [];
  for (let step = 0.5; step < 4; step += 1) {
    for (let k = 0; k <= size; k += 4) quiet.push(pixel(x0 - step * module, top + k * module), pixel(x0 + side + step * module, top + k * module), pixel(x0 + k * module, top - step * module), pixel(x0 + k * module, top + side + step * module));
  }
  return { rows, quiet };
}

async function withFiles(pdf, check) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jib-badges-it-'));
  try {
    const file = path.join(directory, 'badges.pdf');
    fs.writeFileSync(file, pdf);
    return await check({ file, directory });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const normalize = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const byName = (a, b) => normalize(`${a.lastName} ${a.firstName}`).localeCompare(normalize(`${b.lastName} ${b.firstName}`), 'fr');
const rectoText = (words) => words.filter((word) => word.x0 >= MID).map((word) => word.text).join(' ');

/** Le texte qui sort sur stdout et stderr pendant `run`, le journal de Strapi étant ouvert au niveau le plus bavard (NF-55). */
async function captured(app, run) {
  const chunks = [];
  const out = process.stdout.write;
  const err = process.stderr.write;
  const previous = app.log.level;
  process.stdout.write = (chunk, ...rest) => (chunks.push(String(chunk)), out.call(process.stdout, chunk, ...rest));
  process.stderr.write = (chunk, ...rest) => (chunks.push(String(chunk)), err.call(process.stderr, chunk, ...rest));
  app.log.level = 'debug';
  try {
    await run();
  } finally {
    app.log.level = previous;
    process.stdout.write = out;
    process.stderr.write = err;
  }
  return chunks.join('');
}

// ----- la suite --------------------------------------------------------------------------------------------------------------------------

describe('badges et carte publique (V4-D1 : F-95 à F-99, R-80 à R-84, NF-54 à NF-57)', { timeout: 900_000 }, () => {
  const espace = useEspace();
  let counter = 0;

  const secret = () => espace().app.config.get('server.app.keys')[0];
  const attendeeRow = (documentId) => espace().app.documents(UID.attendee).findOne({ documentId });
  const newEdition = (options = {}) => {
    counter += 1;
    return createEdition(espace().app, { slug: `badges-${counter}`, title: `Badges ${counter}`, ...options });
  };
  const person = (edition, fields = {}) => createAttendee(espace().app, edition, { consentAt: new Date().toISOString(), ...fields });
  const tokenOf = async (attendee) => (await espace().app.service('api::espace.badges').ensureToken(attendee)).token;
  const urlOf = (edition, token) => cardUrl({ publicUrl: espace().publicUrl, slug: edition.slug, token });

  /** Requête qui rend les octets (PDF) : le harnais `request` décode en texte. */
  async function binary(pathname, { method = 'GET', cookie, json, headers = {}, origin } = {}) {
    const sent = { 'x-forwarded-for': freshIp(), ...headers };
    if (cookie) sent.cookie = cookie;
    if (method !== 'GET') sent.origin = origin ?? espace().origin;
    if (json !== undefined) sent['content-type'] = 'application/json';
    const response = await fetch(`${espace().baseUrl}${pathname}`, { method, headers: sent, body: json === undefined ? undefined : JSON.stringify(json), redirect: 'manual' });
    const bytes = Buffer.from(await response.arrayBuffer());
    let parsed;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      parsed = undefined;
    }
    return { status: response.status, headers: response.headers, bytes, json: parsed, location: response.headers.get('location') };
  }

  const admin = (edition, suffix) => `/api/espace/admin/${edition.slug}${suffix}`;
  const generate = (edition, cookie, json = {}) => binary(admin(edition, '/badges'), { method: 'POST', cookie, json });
  const card = (edition, token, { ip } = {}) => espace().request(`/api/espace/cards/${edition.slug}/${token}`, { ip });

  /** Organisateur de l'édition : un inscrit de rôle organisateur, une adresse par appel (5 demandes de lien par adresse et par 15 minutes). */
  async function organizerOf(edition) {
    return espace().signIn(edition.slug, (await person(edition, { role: 'organizer' })).email);
  }

  /** Édition de recette : les 17 billets de la recette (un annulé) puis l'organisateur qui se connecte, soit 17 inscrits actifs. */
  let recetteWorld;
  async function recetteEdition() {
    if (recetteWorld) return recetteWorld;
    const edition = await newEdition({ slug: 'badges-recette', title: 'Journées de l’Innovation Filière Bois (recette)' });
    await createProgram(espace().app, edition);
    const attendees = [];
    for (const ticket of items) {
      const { email, firstName, lastName, company, jobTitle } = mapItem(ticket, recette.editionSettings.helloassoFieldMap);
      const { activated, topics, speaker, exhibitor, bio, hostedTableNumber, ...settings } = recette.attendees[email];
      attendees.push(await createAttendee(espace().app, edition, {
        email, firstName, lastName, company, jobTitle, bio, ...settings,
        ...(activated && { consentAt: '2026-10-01T08:00:00.000Z', activatedAt: '2026-10-01T08:00:00.000Z' }),
      }));
    }
    const organizer = await espace().signIn(edition.slug, ORGANIZER); // listé dans ORGANIZER_EMAILS : son inscrit est créé à la connexion (17e actif)
    recetteWorld = { edition, attendees, organizer, cookie: organizer.cookie };
    return recetteWorld;
  }

  // ----------------------------------------------------------------------------------------------------------------------------------
  describe('garde organisateur sur les trois routes d’administration (F-97, F-98)', () => {
    const routes = [
      ['POST', '/badges', {}],
      ['GET', '/attendees/:id/badge'],
      ['POST', '/attendees/:id/card-token/regenerate', {}],
    ];

    for (const [method, suffix, json] of routes) {
      it(`${method} ${suffix} : 401 sans session, 403 pour un participant et pour l’organisateur d’une autre édition, aucun jeton créé`, async () => {
        const edition = await newEdition();
        const other = await newEdition();
        const target = await person(edition, {});
        const participant = await espace().signIn(edition.slug, (await person(edition, {})).email);
        const stranger = await organizerOf(other);
        const url = admin(edition, suffix.replace(':id', target.documentId));

        assert.equal((await binary(url, { method, json })).status, 401);
        const denied = await binary(url, { method, json, cookie: participant.cookie });
        assert.equal(denied.status, 403);
        assert.equal(denied.json.error.code, 'FORBIDDEN');
        assert.equal((await binary(url, { method, json, cookie: stranger.cookie })).status, 403);
        const after = await attendeeRow(target.documentId);
        assert.ok(!after.cardTokenHash, 'une demande refusée ne crée aucun jeton');
      });
    }

    it('une écriture sans Origin admis est refusée (ORIGIN_REFUSED), sans jeton créé', async () => {
      const edition = await newEdition();
      const target = await person(edition, {});
      const { cookie } = await organizerOf(edition);
      const refused = await binary(admin(edition, `/attendees/${target.documentId}/card-token/regenerate`), { method: 'POST', cookie, json: {}, origin: 'https://pirate.example.org' });
      assert.equal(refused.status, 403);
      assert.equal(refused.json.error.code, 'ORIGIN_REFUSED');
      assert.ok(!(await attendeeRow(target.documentId)).cardTokenHash);
    });

    it('un navigateur dont la session a expiré, sur le badge à l’unité, va à la page de connexion (303)', async () => {
      const edition = await newEdition();
      const target = await person(edition, {});
      const response = await binary(admin(edition, `/attendees/${target.documentId}/badge`), { headers: { accept: 'text/html' } });
      assert.equal(response.status, 303);
      assert.match(response.location, new RegExp(`/espace/${edition.slug}/connexion\\?next=.*expire=1`));
    });
  });

  // ----------------------------------------------------------------------------------------------------------------------------------
  describe('T-65 : 17 badges de l’édition de recette, une page A4 chacun, bon nom, QR décodé', { skip }, () => {
    it('17 inscrits actifs : en-têtes, 17 pages A4, ordre alphabétique, nom du recto et QR relu sur le rendu = URL attendue', async () => {
      const { edition, attendees, cookie } = await recetteEdition();
      assert.equal(attendees.length, 17, '17 billets de recette');

      const response = await generate(edition, cookie);
      assert.equal(response.status, 200, response.bytes.toString('utf8').slice(0, 300));
      assert.equal(response.headers.get('content-type'), 'application/pdf');
      assert.equal(response.headers.get('x-badges-count'), '17', 'le billet annulé est exclu, l’organisateur connecté est compté');
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.match(response.headers.get('content-disposition'), /^attachment; filename="badges-badges-recette\.pdf"$/);
      assert.match(response.headers.get('access-control-expose-headers'), /X-Badges-Count/);
      assert.equal(pageCount(response.bytes), 17);

      // Qui doit figurer, dans quel ordre : tous les actifs de l'édition, relus en base après la génération.
      const rows = (await espace().app.documents(UID.attendee).findMany({ filters: { edition: { documentId: edition.documentId }, status: 'active' }, limit: 100 })).sort(byName);
      assert.equal(rows.length, 17);
      assert.ok(rows.every((row) => /^[0-9a-f]{64}$/.test(row.cardTokenHash) && row.cardTokenCreatedAt), 'jeton créé pour chacun');
      assert.ok(!rows.some((row) => row.status === 'cancelled'));

      const reducedExpected = rows.filter((row) => row.role === 'organizer' || !(row.directoryOptIn && row.consentAt)).length;
      assert.equal(response.headers.get('x-badges-reduced'), String(reducedExpected));

      await withFiles(response.bytes, ({ file, directory }) => {
        const words = pdfWords(file);
        const images = renderPages(file, directory);
        const pages = pdfPages(response.bytes);
        assert.equal(words.length, 17);
        assert.equal(images.length, 17);
        rows.forEach((row, index) => {
          const token = deriveCardToken({ secret: secret(), documentId: row.documentId, createdAt: row.cardTokenCreatedAt });
          assert.equal(sha256(token), row.cardTokenHash, `empreinte stockée de ${row.lastName}`);
          const expectedUrl = urlOf(edition, token);

          const page = pages[index];
          assert.ok(Math.abs(page.mediaBox[2] - A4.width) < 0.1 && Math.abs(page.mediaBox[3] - A4.height) < 0.1, `page ${index + 1} en A4`);
          const text = rectoText(words[index]);
          assert.ok(text.includes(row.firstName) && text.includes(row.lastName), `page ${index + 1} : « ${row.firstName} ${row.lastName} » absent de « ${text} »`);
          assert.equal(page.uri, expectedUrl, `annotation de la page ${index + 1}`);

          const expected = qrMatrix(expectedUrl);
          const read = readQr(images[index], page.rect, expected.size);
          assert.deepEqual(read.rows, expected.rows, `QR de la page ${index + 1} (${row.lastName})`);
          assert.ok(read.quiet.every((value) => value > 200), `zone de silence blanche, page ${index + 1}`);
          assert.ok(page.rect[2] - page.rect[0] >= 28 * MM, 'QR de 28 mm au moins');
        });
      });
    });

    it('chaque URL du PDF ouvre la carte de la personne imprimée sur la même page (jetons valides, un par inscrit)', async () => {
      const { edition, cookie } = await recetteEdition();
      const response = await generate(edition, cookie);
      const pages = pdfPages(response.bytes);
      await withFiles(response.bytes, async ({ file }) => {
        const words = pdfWords(file);
        const seen = new Set();
        for (const [index, page] of pages.entries()) {
          const token = page.uri.split('/').pop();
          assert.match(token, CARD_TOKEN_PATTERN);
          seen.add(token);
          const answer = await card(edition, token);
          assert.equal(answer.status, 200, `page ${index + 1}`);
          const text = rectoText(words[index]);
          assert.ok(text.includes(answer.json.card.firstName) && text.includes(answer.json.card.lastName), `carte « ${answer.json.card.displayName} » sur la page de « ${text} »`);
        }
        assert.equal(seen.size, 17);
      });
    });

    it('régénérer la génération : les mêmes jetons, donc les mêmes QR (un badge réimprimé garde son QR)', async () => {
      const { edition, cookie } = await recetteEdition();
      const first = pdfPages((await generate(edition, cookie)).bytes).map((page) => page.uri);
      const second = pdfPages((await generate(edition, cookie)).bytes).map((page) => page.uri);
      assert.deepEqual(second, first);
    });

    it('tri par entreprise, filtre par type et cas d’erreur du corps', async () => {
      const { edition, cookie, attendees } = await recetteEdition();
      const speakers = await generate(edition, cookie, { types: ['speaker'] });
      assert.equal(speakers.status, 200);
      assert.equal(speakers.headers.get('x-badges-count'), String(attendees.filter((a) => a.role === 'speaker' && a.status === 'active').length));
      assert.equal(pageCount(speakers.bytes), Number(speakers.headers.get('x-badges-count')));

      const organizers = await generate(edition, cookie, { types: ['organizer'] });
      assert.equal(organizers.headers.get('x-badges-count'), '1');
      assert.equal(organizers.headers.get('x-badges-reduced'), '1', 'un organisateur est en carte réduite');

      const several = await generate(edition, cookie, { types: ['speaker', 'exhibitor_rep'] });
      assert.equal(several.headers.get('x-badges-count'), String(attendees.filter((a) => ['speaker', 'exhibitor_rep'].includes(a.role) && a.status === 'active').length));

      const company = await generate(edition, cookie, { sort: 'company' });
      assert.equal(company.status, 200);
      assert.equal(company.headers.get('x-badges-count'), '17');

      for (const [json, field] of [[{ types: ['visiteur'] }, 'types'], [{ types: 'speaker' }, 'types'], [{ sort: 'taille' }, 'sort']]) {
        const bad = await generate(edition, cookie, json);
        assert.equal(bad.status, 400, JSON.stringify(json));
        assert.equal(bad.json.error.code, 'VALIDATION');
        assert.ok(bad.json.error.fields[field]);
      }
    });

    it('le tri par entreprise range les pages par entreprise puis par nom', async () => {
      const { edition, cookie } = await recetteEdition();
      const response = await generate(edition, cookie, { sort: 'company' });
      const rows = await espace().app.documents(UID.attendee).findMany({ filters: { edition: { documentId: edition.documentId }, status: 'active' }, limit: 100 });
      const byCompany = (a, b) => normalize(`${a.company ?? ''}|${a.lastName} ${a.firstName}`).localeCompare(normalize(`${b.company ?? ''}|${b.lastName} ${b.firstName}`), 'fr');
      const expected = [...rows].sort(byCompany);
      await withFiles(response.bytes, ({ file }) => {
        const words = pdfWords(file);
        expected.forEach((row, index) => assert.ok(rectoText(words[index]).includes(row.lastName), `page ${index + 1} : ${row.lastName} (${row.company})`));
      });
    });

    it('aucun badge à produire pour ce choix : 404 NO_BADGES, rien n’est créé', async () => {
      const edition = await newEdition();
      await person(edition, { role: 'participant' });
      const { cookie } = await organizerOf(edition);
      const none = await generate(edition, cookie, { types: ['speaker'] });
      assert.equal(none.status, 404);
      assert.equal(none.json.error.code, 'NO_BADGES');
    });

    it('un inscrit annulé n’a pas de badge : il ne figure ni dans le lot ni à l’unité', async () => {
      const edition = await newEdition();
      const cancelled = await person(edition, { status: 'cancelled', lastName: 'Annule' });
      await person(edition, { lastName: 'Actif' });
      const { cookie } = await organizerOf(edition);
      const bulk = await generate(edition, cookie);
      assert.equal(bulk.headers.get('x-badges-count'), '2', 'l’actif et l’organisateur');
      const single = await binary(admin(edition, `/attendees/${cancelled.documentId}/badge`), { cookie });
      assert.equal(single.status, 404);
      assert.equal(single.json.error.code, 'ATTENDEE_NOT_FOUND');
      assert.ok(!(await attendeeRow(cancelled.documentId)).cardTokenHash);
    });

    it('deux générations simultanées d’un inscrit neuf donnent le même jeton (verrou), un seul instant de création', async () => {
      const edition = await newEdition();
      const target = await person(edition, { lastName: 'Simultane' });
      const { cookie } = await organizerOf(edition);
      const [one, two, three] = await Promise.all([1, 2, 3].map(() => binary(admin(edition, `/attendees/${target.documentId}/badge`), { cookie })));
      for (const response of [one, two, three]) assert.equal(response.status, 200);
      const uris = [one, two, three].map((response) => pdfPages(response.bytes)[0].uri);
      assert.equal(new Set(uris).size, 1);
      const row = await attendeeRow(target.documentId);
      assert.equal(sha256(uris[0].split('/').pop()), row.cardTokenHash);
    });
  });

  // ----------------------------------------------------------------------------------------------------------------------------------
  describe('F-98 : badge à l’unité', { skip }, () => {
    it('une page, le nom, le même QR que dans le lot, en-têtes de téléchargement', async () => {
      const { edition, attendees, cookie } = await recetteEdition();
      const lea = attendees[0];
      const single = await binary(admin(edition, `/attendees/${lea.documentId}/badge`), { cookie });
      assert.equal(single.status, 200);
      assert.equal(single.headers.get('content-type'), 'application/pdf');
      assert.equal(single.headers.get('content-disposition'), 'attachment; filename="badge-ducasse-lea.pdf"'.replace('ducasse-lea', 'lea-ducasse'));
      assert.equal(single.headers.get('cache-control'), 'private, no-store');
      assert.equal(pageCount(single.bytes), 1);
      const bulk = pdfPages((await generate(edition, cookie)).bytes);
      assert.ok(bulk.some((page) => page.uri === pdfPages(single.bytes)[0].uri), 'même URL que dans le lot');
      await withFiles(single.bytes, ({ file }) => {
        const text = rectoText(pdfWords(file)[0]);
        assert.ok(text.includes('Léa') && text.includes('Ducasse'));
      });
    });

    it('inscrit d’une autre édition ou identifiant inconnu : 404 ATTENDEE_NOT_FOUND', async () => {
      const { edition, cookie } = await recetteEdition();
      const other = await newEdition();
      const foreign = await person(other, {});
      for (const id of [foreign.documentId, 'inconnu123']) {
        const response = await binary(admin(edition, `/attendees/${id}/badge`), { cookie });
        assert.equal(response.status, 404);
        assert.equal(response.json.error.code, 'ATTENDEE_NOT_FOUND');
      }
      assert.ok(!(await attendeeRow(foreign.documentId)).cardTokenHash, 'aucun jeton créé hors de l’édition');
    });

    it('la fonction et l’entreprise viennent de l’intervenant lié quand l’inscrit n’en a pas (identité de l’annuaire)', async () => {
      const edition = await newEdition();
      const organisation = await espace().app.documents(UID.organisation).create({ data: { name: 'Institut Lignea (essai)', slug: `lignea-${counter}` }, status: 'published' });
      const intervenant = await espace().app.documents(UID.intervenant).create({ data: { name: 'Hélène Marquès', slug: `helene-${counter}`, title: 'Directrice scientifique', organisation: link(organisation) }, status: 'published' });
      const speaker = await person(edition, { role: 'speaker', firstName: 'Hélène', lastName: 'Marquès', company: null, jobTitle: null, speaker: link(intervenant) });
      const { cookie } = await organizerOf(edition);
      const response = await binary(admin(edition, `/attendees/${speaker.documentId}/badge`), { cookie });
      await withFiles(response.bytes, ({ file }) => {
        const text = rectoText(pdfWords(file)[0]);
        assert.ok(text.includes('Directrice scientifique'), text);
        assert.ok(text.includes('Institut Lignea'), text);
        assert.ok(text.includes('INTERVENANT'), text);
      });
    });
  });

  // ----------------------------------------------------------------------------------------------------------------------------------
  describe('T-64, R-83 : régénérer le jeton', () => {
    it('l’ancien jeton est refusé aussitôt, le nouveau accepté, { regeneratedAt } en ISO, empreinte et instant changés', async () => {
      const edition = await newEdition();
      const target = await person(edition, { directoryOptIn: true, lastName: 'Regenere' });
      const { cookie } = await organizerOf(edition);
      const oldToken = await tokenOf(target);
      const before = await attendeeRow(target.documentId);
      assert.equal((await card(edition, oldToken)).status, 200);

      const response = await espace().request(admin(edition, `/attendees/${target.documentId}/card-token/regenerate`), { method: 'POST', cookie, json: {} });
      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(response.json), ['regeneratedAt']);
      assert.equal(new Date(response.json.regeneratedAt).toISOString(), response.json.regeneratedAt);
      const after = await attendeeRow(target.documentId);
      assert.equal(new Date(after.cardTokenCreatedAt).toISOString(), response.json.regeneratedAt);
      assert.ok(new Date(after.cardTokenCreatedAt) > new Date(before.cardTokenCreatedAt));
      assert.notEqual(after.cardTokenHash, before.cardTokenHash);

      const refused = await card(edition, oldToken);
      assert.equal(refused.status, 404);
      assert.equal(refused.json.error.code, 'CARD_NOT_FOUND');

      const fresh = pdfPages((await binary(admin(edition, `/attendees/${target.documentId}/badge`), { cookie })).bytes)[0].uri.split('/').pop();
      assert.notEqual(fresh, oldToken);
      assert.equal((await card(edition, fresh)).status, 200);
      assert.equal(sha256(fresh), after.cardTokenHash);
    });

    it('trois régénérations de suite : trois jetons différents, seul le dernier fonctionne', async () => {
      const edition = await newEdition();
      const target = await person(edition, {});
      const { cookie } = await organizerOf(edition);
      const tokens = [await tokenOf(target)];
      for (let index = 0; index < 3; index += 1) {
        const response = await espace().request(admin(edition, `/attendees/${target.documentId}/card-token/regenerate`), { method: 'POST', cookie, json: {} });
        assert.equal(response.status, 200);
        const row = await attendeeRow(target.documentId);
        tokens.push(deriveCardToken({ secret: secret(), documentId: target.documentId, createdAt: row.cardTokenCreatedAt }));
      }
      assert.equal(new Set(tokens).size, 4);
      const statuses = [];
      for (const token of tokens) statuses.push((await card(edition, token)).status);
      assert.deepEqual(statuses, [404, 404, 404, 200]);
    });

    it('régénérer pour un inscrit annulé ou inconnu : 404, rien n’est écrit', async () => {
      const edition = await newEdition();
      const cancelled = await person(edition, { status: 'cancelled' });
      const { cookie } = await organizerOf(edition);
      for (const id of [cancelled.documentId, 'inconnu123']) {
        const response = await espace().request(admin(edition, `/attendees/${id}/card-token/regenerate`), { method: 'POST', cookie, json: {} });
        assert.equal(response.status, 404);
        assert.equal(response.json.error.code, 'ATTENDEE_NOT_FOUND');
      }
      assert.ok(!(await attendeeRow(cancelled.documentId)).cardTokenHash);
    });

    it('l’empreinte est unique : deux inscrits ne peuvent pas porter la même (index unique de cardTokenHash)', async () => {
      const edition = await newEdition();
      const one = await person(edition, {});
      const two = await person(edition, {});
      await tokenOf(one);
      await tokenOf(two);
      const taken = (await attendeeRow(one.documentId)).cardTokenHash;
      await assert.rejects(espace().app.documents(UID.attendee).update({ documentId: two.documentId, data: { cardTokenHash: taken } }));
      assert.notEqual((await attendeeRow(two.documentId)).cardTokenHash, taken);
    });
  });

  // ----------------------------------------------------------------------------------------------------------------------------------
  describe('T-60, T-61, R-81, R-84 : contenu de la carte publique, sans session', () => {
    const PRINTED_KEYS = ['firstName', 'id', 'initials', 'jobTitle', 'kind', 'lastName', 'company', 'displayName', 'reduced', 'tag', 'type', 'typeLabel'].sort();
    const world = async () => {
      const edition = await newEdition();
      const theme = await espace().app.documents(UID.topic).create({ data: { name: `Sujet de carte ${counter}`, edition: link(edition) } });
      return { edition, theme };
    };

    async function withPhoto(attendee) {
      const upload = espace().app.plugin('upload').service('upload');
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jib-card-photo-'));
      const filepath = path.join(directory, 'photo.png');
      const png = makePng({ width: 64, height: 64 });
      fs.writeFileSync(filepath, png);
      const [uploaded] = await upload.upload({ data: { fileInfo: { name: `carte-${attendee.documentId}` } }, files: { filepath, originalFilename: `carte-${attendee.documentId}.png`, mimetype: 'image/png', size: png.length } });
      fs.rmSync(directory, { recursive: true, force: true });
      await espace().app.documents(UID.attendee).update({ documentId: attendee.documentId, data: { photo: uploaded.id } });
      return uploaded;
    }

    it('T-60 : profil visible, sans session : la fiche de R-42 (identité, présentation, sujets, photo, type), jamais l’e-mail ni le téléphone', async () => {
      const { edition, theme } = await world();
      const lea = await person(edition, { firstName: 'Léa', lastName: 'Ducasse', directoryOptIn: true, bio: 'Je cherche des fournisseurs de bois locaux.', topics: [link(theme)], email: 'lea.carte@example.org' });
      const uploaded = await withPhoto(lea);
      try {
        const token = await tokenOf(lea);
        const response = await card(edition, token);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('set-cookie'), null, 'aucune session ouverte');
        const { card: shown, edition: shownEdition } = response.json;
        assert.equal(shown.reduced, false);
        assert.deepEqual([shown.firstName, shown.lastName, shown.jobTitle, shown.company, shown.type, shown.typeLabel], ['Léa', 'Ducasse', 'Fonction', 'Entreprise Fictive', 'participant', 'Participant']);
        assert.equal(shown.bio, 'Je cherche des fournisseurs de bois locaux.');
        assert.deepEqual(shown.topics.map((entry) => entry.name), [theme.name]);
        assert.match(shown.photoUrl, /^\/uploads\//);
        assert.deepEqual([shownEdition.slug, shownEdition.title], [edition.slug, edition.title]);
        for (const forbidden of ['lea.carte@example.org', '@example.org', 'email', 'phone', 'telephone', 'consentAt', 'helloasso', 'cardToken', token, sha256(token)]) {
          assert.ok(!response.text.toLowerCase().includes(forbidden.toLowerCase()), `« ${forbidden} » dans la réponse`);
        }
      } finally {
        await espace().app.plugin('upload').service('upload').remove(uploaded);
      }
    });

    it('T-61 : profil masqué qui a une présentation, des sujets et une photo : seulement prénom, nom, fonction, entreprise et type, ni clé ni valeur des autres', async () => {
      const { edition, theme } = await world();
      const clara = await person(edition, { firstName: 'Clara', lastName: 'Dubourdieu', directoryOptIn: false, bio: 'Présentation secrète ZXQ-731.', topics: [link(theme)], email: 'clara.carte@example.org' });
      const uploaded = await withPhoto(clara);
      try {
        const response = await card(edition, await tokenOf(clara));
        assert.equal(response.status, 200);
        const { card: shown } = response.json;
        assert.equal(shown.reduced, true);
        assert.deepEqual(Object.keys(shown).sort(), PRINTED_KEYS, 'aucune clé de photo, de présentation ou de sujets, même vide');
        assert.deepEqual([shown.firstName, shown.lastName, shown.jobTitle, shown.company, shown.type], ['Clara', 'Dubourdieu', 'Fonction', 'Entreprise Fictive', 'participant']);
        for (const secretValue of ['ZXQ-731', theme.name, '/uploads/', 'photoUrl', 'bio', 'topics', 'clara.carte@example.org', 'standNumber']) {
          assert.ok(!response.text.includes(secretValue), `« ${secretValue} » dans la réponse d’une carte réduite`);
        }
      } finally {
        await espace().app.plugin('upload').service('upload').remove(uploaded);
      }
    });

    it('R-84 : profil visible mais jamais connecté (consentAt vide) : carte réduite', async () => {
      const { edition, theme } = await world();
      const tom = await createAttendee(espace().app, edition, { firstName: 'Tom', lastName: 'Laffitte', directoryOptIn: true, consentAt: null, bio: 'Jamais lue ZXQ-732.', topics: [link(theme)] });
      const response = await card(edition, await tokenOf(tom));
      assert.equal(response.json.card.reduced, true);
      assert.ok(!response.text.includes('ZXQ-732') && !response.text.includes(theme.name));
    });

    it('un organisateur, même visible, est en carte réduite avec le type organisateur', async () => {
      const { edition } = await world();
      const orga = await person(edition, { role: 'organizer', directoryOptIn: true, bio: 'Bio d’organisateur ZXQ-733.', email: 'orga.carte@example.org' });
      const response = await card(edition, await tokenOf(orga));
      assert.equal(response.json.card.reduced, true);
      assert.equal(response.json.card.type, 'organizer');
      assert.equal(response.json.card.typeLabel, 'Organisateur');
      assert.ok(!response.text.includes('ZXQ-733'));
    });

    it('un intervenant visible a le type « Intervenant » et sa fonction de l’annuaire ; un exposant visible porte son stand', async () => {
      const { edition } = await world();
      const organisation = await espace().app.documents(UID.organisation).create({ data: { name: 'Sylvadour (essai)', slug: `sylvadour-${counter}` }, status: 'published' });
      const exhibitor = await espace().app.documents(UID.exhibitor).create({ data: { edition: link(edition), organisation: link(organisation), standNumber: '4' } });
      const speaker = await person(edition, { role: 'speaker', directoryOptIn: true });
      const rep = await person(edition, { role: 'exhibitor_rep', directoryOptIn: true, exhibitor: link(exhibitor), company: null });
      const asSpeaker = await card(edition, await tokenOf(speaker));
      assert.equal(asSpeaker.json.card.type, 'speaker');
      assert.equal(asSpeaker.json.card.typeLabel, 'Intervenant');
      const asRep = await card(edition, await tokenOf(rep));
      assert.equal(asRep.json.card.typeLabel, 'Exposant');
      assert.equal(asRep.json.card.standNumber, '4');
      assert.equal(asRep.json.card.company, 'Sylvadour (essai)');
    });

    it('T-62 : la navigation web ne change pas : un autre participant, avec le jeton en main ou non, ne voit pas la fiche d’un profil masqué', async () => {
      const { edition } = await world();
      const hidden = await person(edition, { directoryOptIn: false, lastName: 'Masque' });
      const viewer = await person(edition, { directoryOptIn: true });
      const { cookie } = await espace().signIn(edition.slug, viewer.email);
      const before = await espace().request(`/api/espace/directory/p/${hidden.documentId}`, { cookie });
      assert.ok([403, 404].includes(before.status), `fiche masquée : ${before.status}`);
      const token = await tokenOf(hidden);
      assert.equal((await card(edition, token)).status, 200, 'la carte réduite reste lisible');
      const after = await espace().request(`/api/espace/directory/p/${hidden.documentId}`, { cookie });
      assert.equal(after.status, before.status);
      assert.deepEqual(after.json, before.json);
      assert.ok(!after.text.includes(hidden.email));
      const list = await espace().request('/api/espace/directory', { cookie });
      assert.ok(!list.text.includes(hidden.lastName), 'absent de l’annuaire');
    });
  });

  // ----------------------------------------------------------------------------------------------------------------------------------
  describe('T-63, R-83 : une seule réponse pour tout jeton qui ne marche pas', () => {
    it('jeton inconnu, mal formé, régénéré, d’un inscrit annulé, d’une autre édition, d’une édition fermée ou inconnue : la même 404, le même corps', async () => {
      const edition = await newEdition();
      const closed = await newEdition({ enabled: false });
      const other = await newEdition();
      const regenerated = await person(edition, {});
      const cancelled = await person(edition, {});
      const living = await person(edition, {});
      const inClosed = await person(closed, {});
      const regeneratedOld = await tokenOf(regenerated);
      const cancelledToken = await tokenOf(cancelled);
      const livingToken = await tokenOf(living);
      const closedToken = await tokenOf(inClosed);

      await espace().app.service('api::espace.badges').ensureToken(await attendeeRow(regenerated.documentId), { rotate: true });
      await espace().app.documents(UID.attendee).update({ documentId: cancelled.documentId, data: { status: 'cancelled' } });
      assert.equal((await card(edition, livingToken)).status, 200, 'le témoin fonctionne');

      const unknown = deriveCardToken({ secret: 'autre', documentId: 'inconnu', createdAt: new Date().toISOString() });
      const cases = {
        inconnu: card(edition, unknown),
        'trop court': card(edition, unknown.slice(0, 42)),
        'trop long': card(edition, `${unknown}A`),
        'caractères hors base64url': card(edition, `${unknown.slice(0, 40)}%2F%2B`),
        'jeton régénéré': card(edition, regeneratedOld),
        'inscrit annulé': card(edition, cancelledToken),
        'autre édition': card(other, livingToken),
        'édition fermée (NF-52)': card(closed, closedToken),
        'édition inconnue': espace().request(`/api/espace/cards/pas-une-edition/${livingToken}`),
      };
      const answers = {};
      for (const [name, pending] of Object.entries(cases)) answers[name] = await pending;
      const reference = answers.inconnu;
      assert.equal(reference.status, 404);
      assert.equal(reference.json.error.code, 'CARD_NOT_FOUND');
      assert.equal(reference.json.error.message, MESSAGE);
      for (const [name, answer] of Object.entries(answers)) {
        assert.equal(answer.status, 404, name);
        assert.deepEqual(answer.json, reference.json, `corps différent pour « ${name} »`);
        for (const header of ['cache-control', 'referrer-policy', 'x-robots-tag', 'content-type']) assert.equal(answer.headers.get(header), reference.headers.get(header), `${header} pour « ${name} »`);
      }
      assert.equal(JSON.stringify(reference.json).includes(livingToken), false);
    });

    it('l’espace d’une édition rouvert, la carte refonctionne (la fermeture ne détruit pas le jeton)', async () => {
      const closed = await newEdition({ enabled: false });
      const target = await person(closed, { directoryOptIn: true });
      const token = await tokenOf(target);
      assert.equal((await card(closed, token)).status, 404);
      await espace().app.documents(UID.edition).update({ documentId: closed.documentId, data: { participantSpaceEnabled: true }, status: 'published' });
      assert.equal((await card(closed, token)).status, 200);
    });

    it('édition en lecture seule : la carte cesse de fonctionner (R-83, NF-70, champ readOnlyAt)', { todo: 'NF-70 : le champ readOnlyAt de l’édition n’existe pas encore' }, async () => {
      const edition = await newEdition();
      const target = await person(edition, {});
      const token = await tokenOf(target);
      assert.equal((await card(edition, token)).status, 200);
      await espace().app.documents(UID.edition).update({ documentId: edition.documentId, data: { readOnlyAt: '2026-01-01T00:00:00.000Z' }, status: 'published' });
      const refused = await card(edition, token);
      assert.equal(refused.status, 404);
      assert.equal(refused.json.error.code, 'CARD_NOT_FOUND');
    });
  });

  // ----------------------------------------------------------------------------------------------------------------------------------
  describe('NF-54 : limitation de débit de la carte, 30 requêtes par minute et par IP', () => {
    it('la 31e requête d’une même IP en une minute reçoit 429 RATE_LIMITED, jetons inconnus comme valides ; une autre IP passe', async () => {
      const edition = await newEdition();
      const target = await person(edition, { directoryOptIn: true });
      const token = await tokenOf(target);
      const ip = freshIp();
      const unknown = deriveCardToken({ secret: 'autre', documentId: 'rate', createdAt: new Date().toISOString() });

      const statuses = [];
      for (let index = 0; index < 30; index += 1) statuses.push((await card(edition, index % 2 ? unknown : token, { ip })).status);
      assert.deepEqual([...new Set(statuses)].sort(), [200, 404], 'les 30 premières sont servies : 200 pour le jeton valide, 404 sinon');

      const limited = await card(edition, unknown, { ip });
      assert.equal(limited.status, 429, 'la 31e est limitée par un 429, pas un 404');
      assert.equal(limited.json.error.code, 'RATE_LIMITED');
      const limitedValid = await card(edition, token, { ip });
      assert.equal(limitedValid.status, 429, 'même réponse pour un jeton valide : le débit ne révèle pas la validité');
      assert.deepEqual(limitedValid.json, limited.json);
      assert.ok(!limitedValid.text.includes(token));

      assert.equal((await card(edition, token, { ip: freshIp() })).status, 200, 'la limite est par IP');
    });
  });

  // ----------------------------------------------------------------------------------------------------------------------------------
  describe('NF-57 : en-têtes de la réponse carte', () => {
    it('200, 404 et 429 portent Cache-Control private no-store, Referrer-Policy strict-origin et X-Robots-Tag noindex, sans cookie', async () => {
      const edition = await newEdition();
      const target = await person(edition, { directoryOptIn: true });
      const token = await tokenOf(target);
      const ip = freshIp();
      const unknown = deriveCardToken({ secret: 'autre', documentId: 'entetes', createdAt: new Date().toISOString() });
      const answers = [await card(edition, token, { ip }), await card(edition, unknown, { ip })];
      for (let index = 0; index < 29; index += 1) await card(edition, unknown, { ip });
      answers.push(await card(edition, token, { ip }));
      assert.deepEqual(answers.map((answer) => answer.status), [200, 404, 429]);
      for (const answer of answers) {
        assert.equal(answer.headers.get('cache-control'), 'private, no-store', String(answer.status));
        assert.equal(answer.headers.get('referrer-policy'), 'strict-origin', String(answer.status));
        assert.equal(answer.headers.get('x-robots-tag'), 'noindex', String(answer.status));
        assert.equal(answer.headers.get('set-cookie'), null, String(answer.status));
        assert.match(answer.headers.get('content-type'), /^application\/json/);
      }
    });
  });

  // ----------------------------------------------------------------------------------------------------------------------------------
  describe('R-80, NF-55 : le jeton n’est stocké que haché et n’apparaît dans aucun journal ni e-mail', () => {
    it('findMany (Document Service) rend les champs privés cardTokenHash et cardTokenCreatedAt ; l’API REST de l’espace ne les rend jamais', async () => {
      const edition = await newEdition();
      const target = await person(edition, { directoryOptIn: true });
      const { cookie } = await organizerOf(edition);
      const token = await tokenOf(target);

      const [row] = await espace().app.documents(UID.attendee).findMany({ filters: { documentId: target.documentId } });
      assert.match(row.cardTokenHash, /^[0-9a-f]{64}$/);
      assert.equal(row.cardTokenHash, sha256(token));
      assert.ok(!Number.isNaN(new Date(row.cardTokenCreatedAt).getTime()));
      assert.ok(!JSON.stringify(row).includes(token), 'le jeton lui-même n’est pas en base');

      for (const pathname of [`/attendees/${target.documentId}`, '/attendees']) {
        const response = await espace().request(admin(edition, pathname), { cookie });
        assert.equal(response.status, 200);
        assert.ok(!/cardToken/i.test(response.text), `${pathname} expose un champ de jeton`);
        assert.ok(!response.text.includes(token) && !response.text.includes(sha256(token)));
      }
      const mine = await espace().request('/api/espace/me', { cookie: (await espace().signIn(edition.slug, target.email)).cookie });
      assert.ok(!/cardToken/i.test(mine.text));
    });

    it('aucune table de l’espace ni la boîte de sortie ne contient le jeton en clair', async () => {
      const edition = await newEdition();
      const target = await person(edition, { directoryOptIn: true });
      const { cookie } = await organizerOf(edition);
      const since = espace().outbox().length;
      const response = await binary(admin(edition, `/attendees/${target.documentId}/badge`), { cookie });
      const token = pdfPages(response.bytes)[0].uri.split('/').pop();
      for (const uid of [UID.attendee, UID.magicToken, UID.emailLog, UID.syncRun]) {
        assert.ok(!JSON.stringify(await espace().query(uid).findMany({})).includes(token), `jeton en clair dans ${uid}`);
      }
      const mails = await espace().mailsSince(since, { settleMs: 200 });
      assert.ok(!JSON.stringify(mails).includes(token), 'jeton dans un e-mail');
    });

    it('NF-55 : ni la lecture d’une carte (valide, inconnue, régénérée), ni la génération, ni la régénération ne l’écrivent dans le journal de Strapi', async () => {
      const edition = await newEdition();
      const target = await person(edition, { directoryOptIn: true });
      const { cookie } = await organizerOf(edition);
      const tokens = [];
      const log = await captured(espace().app, async () => {
        const generated = await binary(admin(edition, `/attendees/${target.documentId}/badge`), { cookie });
        const token = pdfPages(generated.bytes)[0].uri.split('/').pop();
        tokens.push(token);
        await card(edition, token);
        await generate(edition, cookie);
        const unknown = deriveCardToken({ secret: 'autre', documentId: 'journal', createdAt: new Date().toISOString() });
        tokens.push(unknown);
        await card(edition, unknown);
        await espace().request(admin(edition, `/attendees/${target.documentId}/card-token/regenerate`), { method: 'POST', cookie, json: {} });
        await card(edition, token); // l'ancien, devenu invalide
        await card(edition, `${unknown.slice(0, 20)}`); // mal formé
        await espace().request(`/api/espace/cards/${edition.slug}/${token}?x=${token}`); // le jeton dans la requête
      });
      assert.ok(log.includes('/api/espace/cards/'), 'le journal des requêtes était bien ouvert');
      for (const token of tokens) {
        assert.ok(!log.includes(token), `jeton en clair dans le journal : ${token}`);
        assert.ok(!log.includes(sha256(token)), 'empreinte du jeton dans le journal');
        assert.ok(!log.includes(token.slice(0, 20)), 'début du jeton dans le journal');
      }
    });
  });

  // ----------------------------------------------------------------------------------------------------------------------------------
  describe('T-66 : nom de 40 caractères, entreprise de 60, programme de 30 interventions, de bout en bout par Strapi', { skip }, () => {
    it('le PDF de l’édition garde tout dans ses marges, le recto dans la demi-page droite, le verso dans la gauche', async () => {
      const edition = await newEdition({ enabled: false });
      const organisation = await espace().app.documents(UID.organisation).create({ data: { name: 'Organisation de recette', slug: `org-t66-${counter}` }, status: 'published' });
      for (let index = 0; index < 30; index += 1) {
        const intervenant = await espace().app.documents(UID.intervenant).create({ data: { name: `Intervenante Numéro ${index + 1}`, slug: `t66-${counter}-${index}`, organisation: link(organisation) }, status: 'published' });
        const sequence = await espace().app.documents(UID.sequence).create({
          data: { title: `Intervention ${index + 1} sur la valorisation des coproduits de scierie et des feuillus`, start_time: `${8 + Math.floor(index / 6)}h${String((index % 6) * 10).padStart(2, '0')}`, order: index + 1, edition: link(edition) },
          status: 'published',
        });
        await espace().app.documents('api::intervention.intervention').create({ data: { sequence: link(sequence), intervenants: [link(intervenant)], order: 0 }, status: 'published' });
      }
      const long = await person(edition, { firstName: 'Jean-Christophe', lastName: 'Montgolfier-Delacroix-XY', company: 'Société Coopérative Régionale des Industries du Bois et Forêt'.slice(0, 60), jobTitle: 'Directeur général délégué' });
      assert.equal(`${long.firstName} ${long.lastName}`.length, 40);
      assert.equal(long.company.length, 60);
      const { cookie } = await organizerOf(edition);

      const response = await binary(admin(edition, `/attendees/${long.documentId}/badge`), { cookie });
      assert.equal(response.status, 200);
      assert.equal(pageCount(response.bytes), 1);
      await withFiles(response.bytes, ({ file }) => {
        const [words] = pdfWords(file);
        for (const word of words) {
          assert.ok(word.x0 >= MARGIN - 0.5 && word.x1 <= A4.width - MARGIN + 0.5, `« ${word.text} » hors des marges latérales (${word.x0.toFixed(1)} à ${word.x1.toFixed(1)})`);
          assert.ok(word.y0 >= MARGIN - 0.5 && word.y1 <= A4.height - MARGIN + 0.5, `« ${word.text} » hors des marges verticales`);
          assert.ok(word.x0 >= MID - 0.5 || word.x1 <= MID + 0.5, `« ${word.text} » à cheval sur le pli`);
        }
        const verso = words.filter((word) => word.x1 <= MID + 0.5).map((word) => word.text).join(' ');
        const recto = rectoText(words);
        assert.ok(recto.includes('Jean-Christophe') && recto.includes('Montgolfier'), recto);
        assert.ok(verso.includes('Intervention 1 sur'), 'programme lu sur le verso (édition fermée comprise)');
      });
    });
  });

  // ----------------------------------------------------------------------------------------------------------------------------------
  describe('T-68, F-99 : plan du lieu et couleur d’accent', { skip }, () => {
    const bandColor = (image) => {
      const scale = DPI / 72;
      const x = Math.round(330 * scale);
      const y = Math.round(473 * scale); // dans le bandeau de type, au-dessus de son libellé (bandeau de 470 à 524 pt)
      const at = (y * image.width + x) * 3;
      return [...image.data.subarray(at, at + 3)];
    };
    const near = (rgb, hex) => [1, 3, 5].every((start, index) => Math.abs(rgb[index] - parseInt(hex.slice(start, start + 2), 16)) <= 6);

    async function renderedBand(edition, attendee, cookie) {
      const response = await binary(admin(edition, `/attendees/${attendee.documentId}/badge`), { cookie });
      assert.equal(response.status, 200);
      return withFiles(response.bytes, ({ file, directory }) => ({ rgb: bandColor(renderPages(file, directory, { color: true })[0]), words: pdfWords(file)[0] }));
    }

    it('sans réglage de badge : verso complet, aucune zone « PLAN DU LIEU », bandeau de la couleur de l’édition (hero_bg_color)', async () => {
      const edition = await newEdition();
      await createProgram(espace().app, edition);
      const target = await person(edition, {});
      const { cookie } = await organizerOf(edition);
      const { rgb, words } = await renderedBand(edition, target, cookie);
      assert.ok(near(rgb, recette.edition.hero_bg_color), `bandeau ${rgb} attendu ${recette.edition.hero_bg_color}`);
      const text = words.map((word) => word.text).join(' ');
      assert.ok(!text.includes('PLAN DU LIEU'));
      assert.ok(text.includes('PROGRAMME') && text.includes('Ouverture') || text.includes('PROGRAMME'), text.slice(0, 200));
    });

    it('réglage sans plan, avec un accent : le bandeau prend l’accent ; un accent trop clair retombe sur le bleu des titres', async () => {
      const edition = await newEdition();
      const target = await person(edition, {});
      const { cookie } = await organizerOf(edition);
      const setting = await espace().app.documents(SETTING).create({ data: { edition: link(edition), accent: '#1b5e20' } });
      let seen = await renderedBand(edition, target, cookie);
      assert.ok(near(seen.rgb, '#1b5e20'), `bandeau ${seen.rgb}`);
      assert.ok(!seen.words.some((word) => word.text === 'PLAN'));
      await espace().app.documents(SETTING).update({ documentId: setting.documentId, data: { accent: '#ffff00' } });
      seen = await renderedBand(edition, target, cookie);
      assert.ok(near(seen.rgb, '#325062'), `bandeau ${seen.rgb} attendu le bleu des titres`);
    });

    it('avec un plan PNG téléversé : « PLAN DU LIEU » et l’image au verso ; une image qui n’est ni PNG ni JPEG est ignorée sans erreur', async () => {
      const edition = await newEdition();
      const target = await person(edition, {});
      const { cookie } = await organizerOf(edition);
      const upload = espace().app.plugin('upload').service('upload');
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jib-plan-'));
      const send = async (name, mimetype, bytes) => {
        const filepath = path.join(directory, name);
        fs.writeFileSync(filepath, bytes);
        const [file] = await upload.upload({ data: { fileInfo: { name } }, files: { filepath, originalFilename: name, mimetype, size: bytes.length } });
        return file;
      };
      const png = await send(`plan-${crypto.randomUUID()}.png`, 'image/png', makePng({ width: 300, height: 200, rgb: [30, 90, 160] }));
      const gif = await send(`plan-${crypto.randomUUID()}.gif`, 'image/gif', Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'));
      const setting = await espace().app.documents(SETTING).create({ data: { edition: link(edition), plan: png.id } });
      try {
        let seen = await renderedBand(edition, target, cookie);
        assert.ok(seen.words.some((word) => word.text === 'PLAN') && seen.words.some((word) => word.text === 'LIEU'), 'zone de plan au verso');
        await espace().app.documents(SETTING).update({ documentId: setting.documentId, data: { plan: gif.id } });
        seen = await renderedBand(edition, target, cookie);
        assert.ok(!seen.words.some((word) => word.text === 'PLAN'), 'plan illisible ignoré : le verso redevient complet');
      } finally {
        await espace().app.documents(SETTING).delete({ documentId: setting.documentId });
        await upload.remove(png);
        await upload.remove(gif);
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  });

  // ----------------------------------------------------------------------------------------------------------------------------------
  describe('F-96, T-67 (côté Strapi) : le retour après connexion', () => {
    it('la vérification du lien renvoie l’adresse « next » de la fiche visée, interne à l’espace de l’édition', async () => {
      const edition = await newEdition();
      const target = await person(edition, { directoryOptIn: true });
      const visitor = await person(edition, {});
      const next = `/espace/${edition.slug}/annuaire/p/${target.documentId}`;
      const { redirect } = await espace().signIn(edition.slug, visitor.email, { next });
      assert.ok(String(redirect).endsWith(next), `redirection : ${redirect}`);
    });
  });
});
