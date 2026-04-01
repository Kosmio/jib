'use strict';

const { Client } = require('pg');

function slugify(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function randomDocId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 24 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

const client = new Client({ host: 'localhost', port: 5432, database: 'strapi', user: 'strapi', password: 'strapi' });

async function main() {
  await client.connect();
  console.log('Connected\n');

  // Get existing published partenaires
  const { rows: existingP } = await client.query("SELECT id, document_id, name FROM partenaires WHERE published_at IS NOT NULL");
  const partMap = {};
  for (const p of existingP) partMap[p.name] = { id: p.id, documentId: p.document_id };
  console.log('Existing partenaires:', Object.keys(partMap).join(', '));

  // Create missing partenaires (both draft + published rows, like Strapi v5 does)
  const needed = [
    { name: 'BPI France', category: 'institutionnel', website: 'https://www.bpifrance.fr', is_global: true },
    { name: 'France Bois Forêt', category: 'institutionnel', website: 'https://www.franceboisforet.fr', is_global: false },
    { name: 'PPLA', category: 'institutionnel', website: null, is_global: false },
    { name: 'SSPM', category: 'prive', website: null, is_global: false },
    { name: 'CBS-CBT', category: 'prive', website: null, is_global: false },
    { name: 'FCBA', category: 'institutionnel', website: 'https://www.fcba.fr', is_global: false },
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

  console.log('\n=== Creating missing partenaires ===');
  for (const p of needed) {
    if (partMap[p.name]) continue;
    const docId = randomDocId();
    const slug = slugify(p.name);
    const now = new Date().toISOString();

    // Create published row (like Strapi Document Service does)
    const { rows } = await client.query(
      `INSERT INTO partenaires (document_id, name, slug, category, website, is_global, created_at, updated_at, published_at, locale)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7, 'fr') RETURNING id, document_id`,
      [docId, p.name, slug, p.category, p.website, p.is_global, now]
    );
    partMap[p.name] = { id: rows[0].id, documentId: rows[0].document_id };
    console.log(`  Created: ${p.name} (id=${rows[0].id})`);
  }

  // Get existing intervenants
  const { rows: existingI } = await client.query("SELECT id, document_id, name FROM intervenants WHERE published_at IS NOT NULL");
  const intervMap = {};
  for (const i of existingI) intervMap[i.name] = { id: i.id, documentId: i.document_id };

  // Create missing intervenants for 2024
  const neededInterv = [
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

  console.log('\n=== Creating missing intervenants ===');
  for (const i of neededInterv) {
    if (intervMap[i.name]) continue;
    const docId = randomDocId();
    const slug = slugify(i.name);
    const now = new Date().toISOString();
    const { rows } = await client.query(
      `INSERT INTO intervenants (document_id, name, slug, title, organization, created_at, updated_at, published_at, locale)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $6, 'fr') RETURNING id`,
      [docId, i.name, slug, i.title, i.organization, now]
    );
    intervMap[i.name] = { id: rows[0].id };
    console.log(`  Created: ${i.name} (id=${rows[0].id})`);
  }

  // === Fix edition-partenaire links ===
  console.log('\n=== Fixing edition-partenaire links ===');

  // Clear broken links for Paris 2024/2025
  await client.query('DELETE FROM editions_partenaires_lnk WHERE edition_id IN (18, 19)');

  // Paris 2024 partenaires
  const p2024 = ['BPI France', 'CODIFAB', 'France Bois Forêt', 'PPLA', 'SSPM'];
  let ord = 1;
  for (const name of p2024) {
    if (partMap[name]) {
      await client.query(
        'INSERT INTO editions_partenaires_lnk (edition_id, partenaire_id, edition_ord, partenaire_ord) VALUES ($1, $2, $3, $3)',
        [18, partMap[name].id, ord++]
      );
    } else {
      console.log(`  Warning: ${name} not found`);
    }
  }
  console.log(`  Paris 2024: linked ${ord - 1} partenaires`);

  // Paris 2025 partenaires
  const p2025 = ['BPI France', 'CODIFAB', 'CBS-CBT', 'FCBA', 'FCBA Innovathèque', 'France Douglas', 'Hors-Site', 'Impulse Partners', 'INRAE Innovation', 'CSF Bois', 'DHDA', 'UICB', 'UMB-FFB', 'Open Kairos', 'Soprema-Pavatex', 'Veepee', 'WAYS'];
  ord = 1;
  for (const name of p2025) {
    if (partMap[name]) {
      await client.query(
        'INSERT INTO editions_partenaires_lnk (edition_id, partenaire_id, edition_ord, partenaire_ord) VALUES ($1, $2, $3, $3)',
        [19, partMap[name].id, ord++]
      );
    } else {
      console.log(`  Warning: ${name} not found`);
    }
  }
  console.log(`  Paris 2025: linked ${ord - 1} partenaires`);

  // Final stats
  const { rows: [{ count: pCount }] } = await client.query('SELECT COUNT(*) FROM partenaires WHERE published_at IS NOT NULL');
  const { rows: [{ count: iCount }] } = await client.query('SELECT COUNT(*) FROM intervenants WHERE published_at IS NOT NULL');
  const { rows: [{ count: eCount }] } = await client.query("SELECT COUNT(*) FROM editions WHERE published_at IS NOT NULL");
  console.log(`\nFinal (published): ${pCount} partenaires, ${iCount} intervenants, ${eCount} editions`);

  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  try { await client.end(); } catch (e) {}
  process.exit(1);
});
