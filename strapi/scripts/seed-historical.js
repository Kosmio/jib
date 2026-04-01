'use strict';

/**
 * Direct PostgreSQL seed for historical editions (2024 + 2025).
 * Run: cd strapi && node scripts/seed-historical.js
 */
const { Client } = require('pg');

function slugify(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function randomDocId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 24 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

const client = new Client({
  host: 'localhost', port: 5432, database: 'strapi', user: 'strapi', password: 'strapi',
});

async function main() {
  await client.connect();
  console.log('Connected to PostgreSQL\n');

  // Check existing data
  const { rows: existingEditions } = await client.query("SELECT slug FROM editions WHERE slug IN ('paris-2024', 'paris-2025')");
  const existingSlugs = new Set(existingEditions.map(e => e.slug));

  const { rows: existingPartenaires } = await client.query("SELECT id, document_id, name FROM partenaires");
  const partMap = {};
  for (const p of existingPartenaires) partMap[p.name] = { id: p.id, documentId: p.document_id };

  const { rows: existingIntervenants } = await client.query("SELECT id, document_id, name FROM intervenants");
  const intervMap = {};
  for (const i of existingIntervenants) intervMap[i.name] = { id: i.id, documentId: i.document_id };

  console.log(`Found: ${existingPartenaires.length} partenaires, ${existingIntervenants.length} intervenants, ${existingSlugs.size} matching editions\n`);

  // === PARTENAIRES ===
  const newPartenaires = [
    { name: 'BPI France', category: 'institutionnel', website: 'https://www.bpifrance.fr', is_global: true },
    { name: 'France Bois Forêt', category: 'institutionnel', website: 'https://www.franceboisforet.fr', is_global: false },
    { name: 'PPLA', category: 'institutionnel', website: null, is_global: false },
    { name: 'SSPM', category: 'prive', website: null, is_global: false },
    { name: 'CBS-CBT', category: 'prive', website: null, is_global: false },
    { name: 'FCBA Innovathèque', category: 'institutionnel', website: 'https://www.innovatheque.fr', is_global: false },
    { name: 'France Douglas', category: 'institutionnel', website: 'https://www.francedouglas.fr', is_global: false },
    { name: 'Hors-Site', category: 'prive', website: null, is_global: false },
    { name: 'Impulse Partners', category: 'prive', website: 'https://www.impulse-partners.com', is_global: false },
    { name: 'INRAE Innovation', category: 'institutionnel', website: 'https://www.inrae.fr', is_global: false },
    { name: 'CSF Bois', category: 'institutionnel', website: null, is_global: false },
    { name: 'DHDA', category: 'prive', website: null, is_global: false },
    { name: 'Open Kairos', category: 'prive', website: null, is_global: false },
    { name: 'Soprema-Pavatex', category: 'prive', website: 'https://www.soprema.fr', is_global: false },
    { name: 'Veepee', category: 'prive', website: 'https://www.veepee.fr', is_global: false },
    { name: 'WAYS', category: 'prive', website: null, is_global: false },
  ];

  console.log('=== Partenaires ===');
  for (const p of newPartenaires) {
    if (partMap[p.name]) { console.log(`  Exists: ${p.name}`); continue; }
    const docId = randomDocId();
    const now = new Date().toISOString();
    const { rows } = await client.query(
      `INSERT INTO partenaires (document_id, name, slug, category, website, is_global, created_at, updated_at, published_at, locale)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7, 'fr') RETURNING id, document_id`,
      [docId, p.name, slugify(p.name), p.category, p.website, p.is_global, now]
    );
    partMap[p.name] = { id: rows[0].id, documentId: rows[0].document_id };
    console.log(`  Created: ${p.name} (id=${rows[0].id})`);
  }

  // === INTERVENANTS 2024 ===
  const newIntervenants = [
    { name: 'Karima Benelhadj', organization: 'BPI France', title: 'Responsable Innovation' },
    { name: 'Sylvain Bordebeure', organization: 'Xylofutur', title: 'Directeur' },
    { name: 'Sébastien Bories', organization: 'Xylofutur', title: 'Chargé de mission' },
    { name: 'Bastien Bouteloup', organization: 'Filière Bois', title: 'Expert Innovation' },
    { name: 'Christophe Brevière', organization: 'Filière Bois', title: 'Intervenant' },
    { name: 'Frédéric Carteret', organization: 'Filière Bois', title: 'Expert' },
    { name: 'Patrick Duvaut', organization: 'Filière Bois', title: 'Intervenant' },
    { name: 'Thomas Feiss', organization: 'Filière Bois', title: 'Intervenant' },
    { name: 'Eric Geoffroy', organization: 'Filière Bois', title: 'Expert' },
    { name: 'Arnaud Groff', organization: 'Filière Bois', title: 'Intervenant' },
    { name: 'Camille Huet', organization: 'Filière Bois', title: 'Intervenante' },
    { name: 'Alban Le Cour', organization: 'Filière Bois', title: 'Expert' },
    { name: 'Sophie Lunard', organization: 'Filière Bois', title: 'Intervenante' },
    { name: 'Thibaud Marchais', organization: 'Filière Bois', title: 'Intervenant' },
    { name: 'Charles-Henri Nicolas', organization: 'Filière Bois', title: 'Expert' },
    { name: 'Clémence Nicollet', organization: 'Filière Bois', title: 'Intervenante' },
    { name: 'Loïc Plauche-Gillon', organization: 'France Bois Forêt', title: 'Président' },
    { name: 'Dominique Weber', organization: 'Filière Bois', title: 'Expert' },
  ];

  console.log('\n=== Intervenants 2024 ===');
  for (const i of newIntervenants) {
    if (intervMap[i.name]) { console.log(`  Exists: ${i.name}`); continue; }
    const docId = randomDocId();
    const now = new Date().toISOString();
    const { rows } = await client.query(
      `INSERT INTO intervenants (document_id, name, slug, title, organization, created_at, updated_at, published_at, locale)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $6, 'fr') RETURNING id, document_id`,
      [docId, i.name, slugify(i.name), i.title, i.organization, now]
    );
    intervMap[i.name] = { id: rows[0].id, documentId: rows[0].document_id };
    console.log(`  Created: ${i.name} (id=${rows[0].id})`);
  }

  // === EDITIONS ===
  console.log('\n=== Editions ===');

  if (!existingSlugs.has('paris-2024')) {
    const docId = randomDocId();
    const now = new Date().toISOString();
    const { rows } = await client.query(
      `INSERT INTO editions (document_id, title, slug, year, region, date, city, status, description, video_urls, created_at, updated_at, published_at, locale)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $11, 'fr') RETURNING id`,
      [docId, 'Paris 2024', 'paris-2024', 2024, 'ile-de-france', '2024-11-21', 'Paris', 'past',
       "Première édition des Journées de l'Innovation Filière Bois à Paris. Une journée de conférences et d'échanges pour connecter les acteurs de la filière forêt-bois autour de l'innovation.",
       'https://youtu.be/W_TDNqg0q7w\nhttps://youtu.be/8dtYBw0LQHw\nhttps://youtu.be/f7x2YFisifk', now]
    );
    const edId = rows[0].id;
    console.log(`Created: Paris 2024 (id=${edId})`);

    let ord = 1;
    for (const name of ['BPI France', 'CODIFAB', 'France Bois Forêt', 'PPLA', 'SSPM']) {
      if (partMap[name]) {
        await client.query(
          `INSERT INTO editions_partenaires_lnk (edition_id, partenaire_id, edition_ord, partenaire_ord)
           VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING`,
          [edId, partMap[name].id, ord++]
        );
      }
    }
    console.log('  Linked 5 partenaires');
  } else {
    console.log('Exists: Paris 2024');
  }

  if (!existingSlugs.has('paris-2025')) {
    const docId = randomDocId();
    const now = new Date().toISOString();
    const { rows } = await client.query(
      `INSERT INTO editions (document_id, title, slug, year, region, date, city, status, description, video_urls, created_at, updated_at, published_at, locale)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $11, 'fr') RETURNING id`,
      [docId, 'Paris 2025', 'paris-2025', 2025, 'ile-de-france', '2025-02-06', 'Paris', 'past',
       "Deuxième édition parisienne des JIB. Conférences sur la digitalisation, l'économie circulaire et le financement de l'innovation dans la filière bois.",
       'https://youtu.be/L_XZnUGz18w\nhttps://youtu.be/tKlqNtm3SwI\nhttps://youtu.be/RFjQ1TxjBnQ', now]
    );
    const edId = rows[0].id;
    console.log(`Created: Paris 2025 (id=${edId})`);

    const partners2025 = ['BPI France', 'CODIFAB', 'CBS-CBT', 'FCBA', 'FCBA Innovathèque', 'France Douglas', 'Hors-Site', 'Impulse Partners', 'INRAE Innovation', 'CSF Bois', 'DHDA', 'UICB', 'UMB-FFB', 'Open Kairos', 'Soprema-Pavatex', 'Veepee', 'WAYS'];
    let ord = 1;
    for (const name of partners2025) {
      if (partMap[name]) {
        await client.query(
          `INSERT INTO editions_partenaires_lnk (edition_id, partenaire_id, edition_ord, partenaire_ord)
           VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING`,
          [edId, partMap[name].id, ord++]
        );
      }
    }
    console.log(`  Linked ${partners2025.filter(n => partMap[n]).length} partenaires`);
  } else {
    console.log('Exists: Paris 2025');
  }

  // === CLEANUP ghost partenaires from failed CM API attempts ===
  const { rows: ghosts } = await client.query("SELECT id, name FROM partenaires WHERE name = 'TEST-DELETE'");
  for (const g of ghosts) {
    await client.query('DELETE FROM partenaires WHERE id = $1', [g.id]);
    console.log(`\nDeleted ghost: ${g.name} (id=${g.id})`);
  }

  // Also delete ghost entries from failed CM API (no document_id / null names)
  const { rowCount } = await client.query("DELETE FROM partenaires WHERE document_id IS NULL OR name IS NULL");
  if (rowCount > 0) console.log(`Deleted ${rowCount} ghost partenaires (null document_id or name)`);

  const { rowCount: ghostInterv } = await client.query("DELETE FROM intervenants WHERE document_id IS NULL OR name IS NULL");
  if (ghostInterv > 0) console.log(`Deleted ${ghostInterv} ghost intervenants`);

  console.log('\n=== Done ===');
  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  try { await client.end(); } catch (e) {}
  process.exit(1);
});
