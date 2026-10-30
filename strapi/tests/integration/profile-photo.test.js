'use strict';

/**
 * Photo de profil (lot 9) : POST /me/photo (F-30, A-35). Le navigateur recadre et réduit à 256 px ; le serveur accepte JPEG, PNG ou
 * WebP (type vérifié sur les premiers octets), 5 Mo au plus, enregistre par le plugin Upload et supprime l'ancienne photo.
 * Codes : 400 PHOTO_INVALID, 400 PHOTO_TOO_LARGE. `photoUrl` est le chemin renvoyé par Upload (`/uploads/…`).
 *
 * Les fichiers téléversés par ces tests sont écrits dans strapi/public/uploads (dossier ignoré par git) ; chacun est relevé à sa
 * création et supprimé à la fin, avec ses variantes (miniature…), sans toucher aux fichiers des autres agents (ni à ceux de la base de
 * démonstration). Les formats JPEG et WebP ne sont pas encodés ici (aucun encodeur
 * sans dépendance) : seul le PNG est téléversé en entier, JPEG et WebP restent à vérifier à la main dans le navigateur (lot 16).
 */

const { after, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { STRAPI_DIR } = require('../helpers/env');
const { useEspace } = require('../helpers/espace');
const { UID } = require('../helpers/espace-data');
const { makePng, postFile } = require('../helpers/png');
const W = require('../helpers/meetings-world');

const UPLOADS = path.join(STRAPI_DIR, 'public', 'uploads');
const VARIANTS = ['', 'thumbnail_', 'small_', 'medium_', 'large_'];
const created = new Set();
const filesOf = (attendee) => (fs.existsSync(UPLOADS) ? fs.readdirSync(UPLOADS).filter((name) => name.includes(attendee.documentId)).sort() : []);

describe('photo de profil : POST /me/photo (lot 9)', { timeout: 600_000 }, () => {
  const espace = useEspace({ overrides: { ORGANIZER_EMAILS: 'organisation@example.org' } });
  const login = W.useLogin(espace);
  const api = W.useApi(espace);
  const app = () => espace().app;

  after(() => {
    for (const url of created) for (const prefix of VARIANTS) fs.rmSync(path.join(UPLOADS, `${prefix}${path.basename(url)}`), { force: true });
  });

  const newEdition = () => W.createMeetingEdition(app(), { slug: W.unique('photo'), title: 'Édition d’essai' });
  const person = (edition, fields) => W.createPerson(app(), edition, fields);
  let counter = 0;
  const upload = async (edition, who, { bytes = makePng(), filename, type = 'image/png', ...rest } = {}) => {
    const response = await postFile(espace(), '/api/espace/me/photo', { cookie: await login(edition, who), bytes, filename: filename ?? `l13-photo-${(counter += 1)}.png`, type, ...rest });
    if (response.status === 200 && response.json?.photoUrl) created.add(response.json.photoUrl);
    return response;
  };
  const photoOf = (attendee) => app().documents(UID.attendee).findOne({ documentId: attendee.documentId, populate: { photo: true } });
  const fileRow = (id) => app().db.query('plugin::upload.file').findOne({ where: { id } });
  const onDisk = (url) => fs.existsSync(path.join(STRAPI_DIR, 'public', url));
  const expectError = (response, status, code) => {
    assert.equal(response.status, status, `${response.status} ${response.text}`);
    assert.equal(response.json?.error?.code, code, response.text);
  };

  describe('un PNG de 256 px (F-30, A-35)', () => {
    it('200 { photoUrl } : un chemin /uploads/…', async () => {
      const world = await newEdition();
      const lea = await person(world.edition);
      const response = await upload(world.edition, lea);
      assert.equal(response.status, 200, response.text);
      assert.deepEqual(Object.keys(response.json), ['photoUrl']);
      assert.match(response.json.photoUrl, /^\/uploads\/[^?#]+\.(png|webp|jpe?g)$/i);
    });

    it('le fichier existe sur le disque ; l’Attendee y est rattaché ; Me et la complétion le reflètent', async () => {
      const world = await newEdition();
      const lea = await person(world.edition, { jobTitle: null });
      const { json } = await upload(world.edition, lea);
      assert.ok(onDisk(json.photoUrl), 'fichier absent du disque');
      const row = await photoOf(lea);
      assert.equal(row.photo.url, json.photoUrl);
      const me = (await api(await login(world.edition, lea)).get('/me')).json;
      assert.equal(me.photoUrl, json.photoUrl);
      assert.equal(me.profileCompletion, 55, '40 % + 15 % pour la photo');
    });

    it('la photo figure sur la carte de l’annuaire (le fichier téléversé ou sa miniature)', async () => {
      const world = await newEdition();
      const [lea, ines] = [await person(world.edition), await person(world.edition)];
      const { json } = await upload(world.edition, lea);
      const { items } = (await api(await login(world.edition, ines)).get('/directory')).json;
      const { photoUrl } = items.find((card) => card.id === lea.documentId);
      assert.match(photoUrl, /^\/uploads\//);
      // La carte peut porter la miniature que le plugin Upload génère (même fichier, nom préfixé).
      assert.equal(path.basename(photoUrl).replace(/^(thumbnail|small|medium|large)_/, ''), path.basename(json.photoUrl));
    });

    it('une nouvelle photo remplace l’ancienne : l’ancienne ligne et l’ancien fichier sont supprimés', async () => {
      const world = await newEdition();
      const lea = await person(world.edition);
      const first = (await upload(world.edition, lea)).json.photoUrl;
      const oldId = (await photoOf(lea)).photo.id;
      assert.ok(onDisk(first));
      const second = (await upload(world.edition, lea, { bytes: makePng({ rgb: [10, 20, 30] }) })).json.photoUrl;
      assert.notEqual(second, first);
      assert.equal((await photoOf(lea)).photo.url, second);
      assert.equal(await fileRow(oldId), null, 'l’ancienne ligne du plugin Upload subsiste');
      assert.equal(onDisk(first), false, 'l’ancien fichier subsiste sur le disque');
      assert.ok(onDisk(second));
    });

    it('la photo d’un participant ne touche ni celle d’un autre, ni son profil', async () => {
      const world = await newEdition();
      const [lea, ines] = [await person(world.edition), await person(world.edition)];
      const inesPhoto = (await upload(world.edition, ines)).json.photoUrl;
      await upload(world.edition, lea);
      assert.equal((await photoOf(ines)).photo.url, inesPhoto);
    });

    it('un fichier qui dépasse 256 px est accepté aussi (le serveur ne recadre pas) tant qu’il reste sous 5 Mo', async () => {
      const world = await newEdition();
      const lea = await person(world.edition);
      const response = await upload(world.edition, lea, { bytes: makePng({ width: 600, height: 600, padTo: 1_000_000 }) });
      assert.equal(response.status, 200, response.text);
    });
  });

  describe('400 PHOTO_INVALID : le type se lit sur les premiers octets, pas sur le nom ni sur l’en-tête', () => {
    const refuse = async (options) => {
      const world = await newEdition();
      const lea = await person(world.edition);
      const before = (await upload(world.edition, lea)).json.photoUrl;
      const response = await upload(world.edition, lea, options);
      expectError(response, 400, 'PHOTO_INVALID');
      assert.equal((await photoOf(lea)).photo.url, before, 'la photo précédente doit rester en place');
      assert.ok(onDisk(before));
      return response;
    };

    it('un fichier texte renommé .jpg', () => refuse({ bytes: Buffer.from('ceci n’est pas une image\n'.repeat(40)), filename: 'l13-photo-texte.jpg', type: 'image/jpeg' }));
    it('un fichier texte déclaré image/png', () => refuse({ bytes: Buffer.from('texte'.repeat(100)), filename: 'l13-photo-texte.png', type: 'image/png' }));
    it('un GIF', () => refuse({ bytes: Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(200)]), filename: 'l13-photo.gif', type: 'image/gif' }));
    it('un SVG déclaré image/png', () => refuse({ bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'), filename: 'l13-photo.svg', type: 'image/png' }));
    it('un PDF', () => refuse({ bytes: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200)]), filename: 'l13-photo.pdf', type: 'application/pdf' }));
    it('un fichier vide', () => refuse({ bytes: Buffer.alloc(0), filename: 'l13-photo-vide.png', type: 'image/png' }));

    it('une requête sans fichier ni champ « photo »', async () => {
      const world = await newEdition();
      const lea = await person(world.edition);
      expectError(await upload(world.edition, lea, { bytes: null }), 400, 'PHOTO_INVALID');
      expectError(await upload(world.edition, lea, { field: 'file' }), 400, 'PHOTO_INVALID');
    });

    it('aucun fichier ne reste sur le disque après un refus', async () => {
      const world = await newEdition();
      const lea = await person(world.edition);
      const before = fs.readdirSync(UPLOADS).length;
      await upload(world.edition, lea, { bytes: Buffer.from('texte'.repeat(100)), filename: 'l13-photo-refuse.jpg', type: 'image/jpeg' });
      assert.equal(fs.readdirSync(UPLOADS).length, before);
      assert.deepEqual(filesOf(lea), []);
    });
  });

  describe('400 PHOTO_TOO_LARGE : 5 Mo au plus', () => {
    it('un PNG valable de 6 Mo est refusé, la photo précédente reste en place', async () => {
      const world = await newEdition();
      const lea = await person(world.edition);
      const before = (await upload(world.edition, lea)).json.photoUrl;
      const response = await upload(world.edition, lea, { bytes: makePng({ padTo: 6_000_000 }), filename: 'l13-photo-gros.png' });
      expectError(response, 400, 'PHOTO_TOO_LARGE');
      assert.equal((await photoOf(lea)).photo.url, before);
    });

    it('un PNG d’environ 4 Mo passe', async () => {
      const world = await newEdition();
      const lea = await person(world.edition);
      const response = await upload(world.edition, lea, { bytes: makePng({ padTo: 4_000_000 }), filename: 'l13-photo-4mo.png' });
      assert.equal(response.status, 200, response.text);
    });
  });

  describe('accès', () => {
    it('401 UNAUTHENTICATED sans session', async () => {
      const response = await postFile(espace(), '/api/espace/me/photo', { bytes: makePng(), filename: 'l13-photo-anonyme.png' });
      expectError(response, 401, 'UNAUTHENTICATED');
    });

    it('403 ORIGIN_REFUSED sans en-tête Origin admis (NF-04)', async () => {
      const world = await newEdition();
      const lea = await person(world.edition);
      const cookie = await login(world.edition, lea);
      expectError(await postFile(espace(), '/api/espace/me/photo', { cookie, bytes: makePng(), filename: 'l13-photo-origine.png', origin: null }), 403, 'ORIGIN_REFUSED');
      expectError(await postFile(espace(), '/api/espace/me/photo', { cookie, bytes: makePng(), filename: 'l13-photo-origine.png', origin: 'https://pirate.example.org' }), 403, 'ORIGIN_REFUSED');
    });

    it('la photo se téléverse pour le participant de la session, jamais un autre (aucun paramètre d’identifiant)', async () => {
      const world = await newEdition();
      const [lea, ines] = [await person(world.edition), await person(world.edition)];
      await upload(world.edition, lea, { path: `/api/espace/me/photo?attendee=${ines.documentId}` });
      assert.equal((await photoOf(ines)).photo ?? null, null);
      assert.ok((await photoOf(lea)).photo);
    });
  });
});
