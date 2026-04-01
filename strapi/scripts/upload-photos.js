'use strict';

/**
 * Upload photos for intervenants and logos for partenaires.
 * Run: cd strapi && node scripts/upload-photos.js
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const STRAPI_URL = 'http://localhost:1337';
const ASSETS_DIR = '/tmp/jib-assets';

const client = new Client({ host: 'localhost', port: 5432, database: 'strapi', user: 'strapi', password: 'strapi' });

async function getAdminToken() {
  const loginData = JSON.stringify({ email: 'mathieu@kosm.io', password: 't0psecret-Str' });
  const res = await fetch(`${STRAPI_URL}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: loginData,
  });
  const json = await res.json();
  return json.data.token;
}

async function uploadAndLink(token, filePath, uid, documentId, field) {
  if (!fs.existsSync(filePath)) {
    console.log(`  File not found: ${filePath}`);
    return null;
  }

  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const mime = mimeTypes[ext] || 'application/octet-stream';

  // Upload via admin upload endpoint
  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: mime });
  formData.append('files', blob, fileName);
  formData.append('fileInfo', JSON.stringify({ name: fileName, alternativeText: fileName }));

  const uploadRes = await fetch(`${STRAPI_URL}/upload`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData,
  });

  if (!uploadRes.ok) {
    // Try admin API
    const uploadRes2 = await fetch(`${STRAPI_URL}/api/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });
    if (!uploadRes2.ok) {
      console.log(`  Upload failed for ${fileName}: ${uploadRes2.status}`);
      return null;
    }
    const uploaded = await uploadRes2.json();
    const fileId = uploaded[0]?.id;
    if (fileId) {
      // Link via direct DB update
      await linkFileToEntry(uid, documentId, field, fileId);
      console.log(`  Uploaded & linked: ${fileName} (fileId=${fileId})`);
    }
    return fileId;
  }

  const uploaded = await uploadRes.json();
  const fileId = uploaded[0]?.id;
  if (fileId) {
    await linkFileToEntry(uid, documentId, field, fileId);
    console.log(`  Uploaded & linked: ${fileName} (fileId=${fileId})`);
  }
  return fileId;
}

async function linkFileToEntry(uid, documentId, field, fileId) {
  // Strapi stores file links in the files_related_mph table
  // Get the entity ID from document_id
  const tableName = uid === 'api::intervenant.intervenant' ? 'intervenants' : 'partenaires';
  const { rows } = await client.query(
    `SELECT id FROM ${tableName} WHERE document_id = $1 AND published_at IS NOT NULL LIMIT 1`,
    [documentId]
  );
  if (rows.length === 0) return;
  const entityId = rows[0].id;

  // Check if already linked
  const { rows: existing } = await client.query(
    `SELECT id FROM files_related_mph WHERE related_id = $1 AND related_type = $2 AND field = $3`,
    [entityId, uid, field]
  );
  if (existing.length > 0) {
    // Update existing link
    await client.query(
      `UPDATE files_related_mph SET file_id = $1 WHERE related_id = $2 AND related_type = $3 AND field = $4`,
      [fileId, entityId, uid, field]
    );
  } else {
    await client.query(
      `INSERT INTO files_related_mph (file_id, related_id, related_type, field, "order") VALUES ($1, $2, $3, $4, 1)`,
      [fileId, entityId, uid, field]
    );
  }
}

function findImageInDir(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => /\.(png|jpg|jpeg|svg)$/i.test(f));
  // Prefer files with "logo" in name
  return files.find(f => /logo/i.test(f)) || files[0] || null;
}

async function main() {
  await client.connect();
  const token = await getAdminToken();
  console.log('Authenticated\n');

  // Get all intervenants with their document_ids
  const { rows: intervenants } = await client.query(
    "SELECT id, document_id, name FROM intervenants WHERE published_at IS NOT NULL"
  );

  // Intervenant photo mapping (2024 edition)
  const photoMap = {
    'Karima Benelhadj': 'BENELHADJ Karima.jpg',
    'Sylvain Bordebeure': 'BORDEBEURE Sylvain.jpg',
    'Sébastien Bories': 'BORIES Sébastien.jpg',
    'Bastien Bouteloup': 'BOUTELOUP Bastien.jpg',
    'Christophe Brevière': 'BREVIERE Christophe.jpg',
    'Frédéric Carteret': 'CARTERET Frederic.jpg',
    'Patrick Duvaut': 'DUVAUT Patrick.jpg',
    'Thomas Feiss': 'FEISS Thomas.jpg',
    'Eric Geoffroy': 'GEOFFROY Eric.jpg',
    'Arnaud Groff': 'GROFF Arnaud.jpg',
    'Camille Huet': 'HUET Camille.jpg',
    'Alban Le Cour': 'LE COUR Alban.png',
    'Sophie Lunard': 'LUNARD Sophie.jpg',
    'Thibaud Marchais': 'MARCHAIS Thibaud.jpg',
    'Charles-Henri Nicolas': 'NICOLAS Charles-Henri.jpg',
    'Clémence Nicollet': 'NICOLLET Clémence 2 HD.jpg',
    'Loïc Plauche-Gillon': 'PLAUCHE-GILLON Loic 2.jpeg',
    'Dominique Weber': 'WEBER Dominique 1.jpg',
  };

  console.log('=== Uploading intervenant photos ===');
  for (const interv of intervenants) {
    if (photoMap[interv.name]) {
      const filePath = path.join(ASSETS_DIR, '2024', photoMap[interv.name]);
      await uploadAndLink(token, filePath, 'api::intervenant.intervenant', interv.document_id, 'photo');
    }
  }

  // Partenaire logo mapping
  const logoMap = {
    'BPI France': [path.join(ASSETS_DIR, '2024/BPI'), path.join(ASSETS_DIR, '2025/BPiFrance')],
    'France Bois Forêt': [path.join(ASSETS_DIR, '2024/France Bois Foret')],
    'PPLA': [path.join(ASSETS_DIR, '2024/PPLA')],
    'SSPM': [path.join(ASSETS_DIR, '2024/SSPM')],
    'CBS-CBT': [path.join(ASSETS_DIR, '2025/CBS-CBT')],
    'FCBA': [path.join(ASSETS_DIR, '2025/FCBA')],
    'FCBA Innovathèque': [path.join(ASSETS_DIR, '2025/FCBA-Innovatheque')],
    'France Douglas': [path.join(ASSETS_DIR, '2025/FRANCE DOUGLAS')],
    'Hors-Site': [path.join(ASSETS_DIR, '2025/HORS-SITE')],
    'Impulse Partners': [path.join(ASSETS_DIR, '2025/IMPULSE PARTNERS')],
    'INRAE Innovation': [path.join(ASSETS_DIR, '2025/INRAE Innovation')],
    'CSF Bois': [path.join(ASSETS_DIR, '2025/CSF bois')],
    'DHDA': [path.join(ASSETS_DIR, '2025/DHDA')],
    'Open Kairos': [path.join(ASSETS_DIR, '2025/OPEN KAIROS')],
    'Soprema-Pavatex': [path.join(ASSETS_DIR, '2025/SOPREMA-PAVATEX')],
    'Veepee': [path.join(ASSETS_DIR, '2025/VEEPEE')],
    'WAYS': [path.join(ASSETS_DIR, '2025/WAYS')],
  };

  const { rows: partenaires } = await client.query(
    "SELECT id, document_id, name FROM partenaires WHERE published_at IS NOT NULL"
  );

  console.log('\n=== Uploading partenaire logos ===');
  for (const part of partenaires) {
    const dirs = logoMap[part.name];
    if (!dirs) continue;
    for (const dir of dirs) {
      const logoFile = findImageInDir(dir);
      if (logoFile) {
        const filePath = path.join(dir, logoFile);
        await uploadAndLink(token, filePath, 'api::partenaire.partenaire', part.document_id, 'logo');
        break;
      }
    }
  }

  console.log('\n=== Done ===');
  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  try { await client.end(); } catch (e) {}
  process.exit(1);
});
