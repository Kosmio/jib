'use strict';

/**
 * PNG minimal pour les tests de la photo de profil (F-30, A-35) : un carré uni, valable pour un décodeur d'images, sans
 * dépendance (zlib de Node). `padTo` ajoute un bloc `tEXt` pour atteindre une taille précise sans changer l'image.
 */

const zlib = require('node:zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** @returns {Buffer} un PNG RVB 8 bits de `width` x `height` pixels, de la couleur `rgb`. */
function makePng({ width = 256, height = 256, rgb = [186, 135, 72], padTo = 0 } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // profondeur
  header[9] = 2; // RVB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  const pixels = zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  const parts = [SIGNATURE, chunk('IHDR', header), chunk('IDAT', pixels)];
  let size = parts.reduce((total, part) => total + part.length, 0) + 12; // + IEND
  if (padTo > size + 12) {
    const filler = Buffer.concat([Buffer.from('Comment\0', 'latin1'), Buffer.alloc(padTo - size - 12 - 8, 0x61)]);
    parts.push(chunk('tEXt', filler));
    size += filler.length + 12;
  }
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** Requête multipart (champ de fichier unique) vers Strapi, avec Origin admis et IP choisie, sans suivre les redirections. */
async function postFile(espace, path, { cookie, field = 'photo', filename = 'photo.png', type = 'image/png', bytes, origin, ip }) {
  const form = new FormData();
  if (bytes !== undefined) form.append(field, new Blob([bytes], { type }), filename);
  const headers = { 'x-forwarded-for': ip ?? `10.250.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
  const sentOrigin = origin === undefined ? espace.origin : origin;
  if (sentOrigin) headers.origin = sentOrigin;
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${espace.baseUrl}${path}`, { method: 'POST', headers, body: form, redirect: 'manual' });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: response.status, headers: response.headers, text, json };
}

module.exports = { makePng, postFile };
