'use strict';

// =============================================================================
// SEED DATA — Édition Normandie (2 avril 2026)
// =============================================================================

const SEED_PARTENAIRES = [
  { name: 'Xylofutur', description: 'Pôle de Compétitivité de la filière forêt-bois. Accompagne les acteurs de son écosystème dans leurs projets d\'innovation.', website: 'https://xylofutur.fr', category: 'coorganisateur', is_global: true },
  { name: 'Fibois Normandie', description: 'Association interprofessionnelle de la filière forêt-bois en Normandie réunissant plus de cent acteurs de la filière.', website: 'https://www.fibois-normandie.fr', category: 'coorganisateur', is_global: false },
  { name: 'CODIFAB', description: 'Développement des Industries Françaises de l\'Ameublement et du Bois. Soutien financier des Journées de l\'Innovation.', category: 'soutien', is_global: true },
  { name: 'PUI Normandie', description: 'Pôle Universitaire d\'Innovation — fabrique d\'innovations fédérant les acteurs de l\'Enseignement supérieur et de la Recherche en Normandie.', category: 'institutionnel', is_global: false },
  { name: 'Normandie Incubation', description: 'Incubateur de la Recherche Publique depuis plus de 25 ans, accompagne les entrepreneurs dans la création de leurs startups.', category: 'institutionnel', is_global: false },
  { name: 'UICB', description: 'Union des Industries de la Construction et du Commerce du Bois.', category: 'institutionnel', is_global: true },
  { name: 'UMB-FFB', description: 'Union des Métiers du Bois — Fédération Française du Bâtiment.', category: 'institutionnel', is_global: true },
  { name: 'Université de Rouen Normandie', description: 'Campus Sciences et Ingénierie, accueille la matinée de l\'édition Normandie à la Technopole du Madrillet.', category: 'institutionnel', is_global: false },
];

const SEED_INTERVENANTS = [
  { name: 'Künkel', organization: 'Künkel', topic: 'Comment Künkel a réussi à réduire son impact environnemental grâce à l\'économie circulaire pour la fabrication de ses dés de palettes.' },
  { name: 'Proxipel', organization: 'Proxipel', topic: 'Quelle solution pour améliorer le rendement du marché du granulés ?' },
  { name: 'Linex Panneaux', organization: 'Linex Panneaux', topic: 'L\'augmentation de la part de bois recyclé dans les panneaux, un moteur d\'innovation au service de l\'économie circulaire.' },
  { name: 'UMR ECODIV', organization: 'UMR ECODIV', topic: 'Expertise sur la biodiversité des sols en lien avec la gestion forestière et la filière bois.' },
  { name: 'Projet HydroXyl-PACT', organization: 'HydroXyl-PACT', topic: 'Applications en santé des hémicelluloses issues des bois feuillus grâce à leurs propriétés antimicrobiennes.' },
  { name: 'Projet SOLORGA', organization: 'SOLORGA', topic: 'Comment le projet SOLORGA repense les sols équestres en alliant science, confort et durabilité.' },
  { name: 'ADN Normandie', organization: 'ADN Normandie', title: 'Guichet unique développement économique', topic: 'Le financement de l\'innovation en Normandie.' },
  { name: 'BpiFrance', organization: 'BpiFrance', title: 'Accompagnement des entreprises', topic: 'Accompagnement des projets de développement, transition écologique et innovation.' },
  { name: 'Lise financement', organization: 'Lise', topic: 'Accès simplifié au financement en fonds propres pour PME et ETI grâce à une nouvelle bourse.' },
  { name: 'Forinvest', organization: 'Forinvest', topic: 'Réseau des forestiers investisseurs pour le développement des entreprises de la filière forêt-bois.' },
  { name: 'Kutsh', organization: 'Kutsh', topic: 'Application qui automatise grâce à l\'IA l\'analyse des demandes d\'autorisations d\'urbanisme.' },
  { name: 'Fibraterre', organization: 'Fibraterre', topic: 'Panneaux semi-rigides à base de paille pour la construction.' },
  { name: 'Micao', organization: 'Micao', topic: 'Intégration du réemploi de bois dans les ouvrages de construction.' },
  { name: 'THN', organization: 'Territoire & Habitat Normand', topic: 'Feuille de route dédiée à l\'innovation dans l\'habitat normand.' },
  { name: 'CAP', organization: 'Concevoir Autrement en Paille', topic: 'Boîte à outils pour structurer et diffuser les savoir-faire liés à la paille.' },
  { name: 'FCBA', organization: 'FCBA', topic: 'La certification CTB Composants et Systèmes Bois au service de l\'innovation.' },
];

const SEED_PROGRAMME = [
  { title: 'Accueil Café', start_time: '9h00', end_time: '9h30', category: 'pause', order: 1, intervenants: [] },
  { title: 'Introduction — Pourquoi et Comment Innover', start_time: '9h30', end_time: '10h00', category: 'introduction', order: 2, intervenants: ['Xylofutur'] },
  { title: 'Le financement de l\'innovation', start_time: '10h00', end_time: '10h15', category: 'finance', order: 3, intervenants: ['ADN Normandie'] },
  { title: 'La recherche au service de la filière', start_time: '10h15', end_time: '11h00', category: 'recherche', order: 4, intervenants: ['UMR ECODIV', 'Projet HydroXyl-PACT', 'Projet SOLORGA'] },
  { title: 'Le financement de l\'innovation', start_time: '11h00', end_time: '11h15', category: 'finance', order: 5, intervenants: ['BpiFrance'] },
  { title: 'Retour d\'expériences d\'entrepreneurs', start_time: '11h15', end_time: '12h00', category: 'temoignages', order: 6, intervenants: ['Künkel', 'Linex Panneaux', 'Proxipel'] },
  { title: 'Le financement de l\'innovation', start_time: '12h00', end_time: '12h30', category: 'finance', order: 7, intervenants: ['Lise financement', 'Forinvest'] },
  { title: 'Apéritif convivial', start_time: '12h30', end_time: '13h00', category: 'pause', order: 8, intervenants: [] },
  { title: 'Produits et services innovants au service de la construction', start_time: '14h30', end_time: '15h30', category: 'temoignages', order: 9, intervenants: ['Kutsh', 'Fibraterre', 'Micao'] },
  { title: 'Les initiatives collectives et individuelles pour favoriser l\'innovation dans la construction', start_time: '15h30', end_time: '16h30', category: 'actions', order: 10, intervenants: ['THN', 'CAP', 'FCBA'] },
  { title: 'Clôture et temps d\'échanges informels', start_time: '16h30', end_time: '17h00', category: 'cloture', order: 11, intervenants: [] },
  { title: 'Célébration des 2 ans du Pacte Bois et Biosourcés en Normandie', start_time: '17h00', end_time: '', category: null, order: 12, intervenants: [] },
];

const SEED_EDITIONS = [
  {
    title: 'Normandie',
    year: 2026,
    region: 'normandie',
    date: '2026-04-02',
    city: 'Rouen',
    status: 'open',
    description: 'Première étape de la tournée nationale 2026. Une dynamique de filière pour connecter les acteurs, structurer les projets et valoriser les innovations.',
    inscription_url: 'https://www.helloasso.com/associations/xylofutur-produits-et-materiaux-des-forets-cultivees/evenements/journee-regionale-de-l-innovation-en-normandie',
    lieux: [
      { name: 'Technopole du Madrillet', address: 'UFR des Sciences et Techniques de l\'université de Rouen Normandie\nAvenue de l\'Université\nSaint-Étienne-du-Rouvray\nCampus Sciences et Ingénierie Rouen Normandie', time_slot: 'Matin (9h00 - 13h00)' },
      { name: 'Le Kaléidoscope', address: '29 Rue Victor Hugo\n76140 Le Petit-Quevilly', time_slot: 'Après-midi (14h30 - 17h00)' },
    ],
  },
  {
    title: 'Région Sud',
    year: 2026,
    region: 'region-sud',
    date: '2026-06-15',
    city: 'À confirmer',
    status: 'upcoming',
    description: 'Deuxième étape de la tournée — Région Sud, juin 2026.',
    lieux: [],
  },
  {
    title: 'Nouvelle-Aquitaine',
    year: 2026,
    region: 'nouvelle-aquitaine',
    date: '2026-10-15',
    city: 'À confirmer',
    status: 'upcoming',
    description: 'Troisième étape — Nouvelle-Aquitaine, octobre 2026.',
    lieux: [],
  },
  {
    title: 'Auvergne-Rhône-Alpes',
    year: 2026,
    region: 'auvergne-rhone-alpes',
    date: '2026-12-15',
    city: 'À confirmer',
    status: 'upcoming',
    description: 'Quatrième étape — Auvergne-Rhône-Alpes, fin 2026.',
    lieux: [],
  },
];

// =============================================================================
// BOOTSTRAP
// =============================================================================

module.exports = {
  register(/*{ strapi }*/) {},

  async bootstrap({ strapi }) {
    // Set French as default locale if not already configured
    const localeService = strapi.plugin('i18n').service('locales');
    const existingLocales = await localeService.find();
    const hasFrench = existingLocales.some((l) => l.code === 'fr');

    if (!hasFrench) {
      await localeService.create({ code: 'fr', name: 'French (fr)' });
    }

    const frLocale = (await localeService.find()).find((l) => l.code === 'fr');
    if (frLocale && !frLocale.isDefault) {
      await localeService.setIsDefault(frLocale.id);
    }

    // Set public permissions for API endpoints
    await setPublicPermissions(strapi, [
      { api: 'captcha', actions: ['challenge'] },
      { api: 'contact', actions: ['send'] },
      { api: 'newsletter', actions: ['subscribe'] },
      { api: 'edition', actions: ['find', 'findOne'] },
      { api: 'programme-item', actions: ['find', 'findOne'] },
      { api: 'intervenant', actions: ['find', 'findOne'] },
      { api: 'partenaire', actions: ['find', 'findOne'] },
    ]);

    // Set French labels on content types
    await setFrenchLabels(strapi);

    // Seed demo data if no editions exist yet
    await seedData(strapi);
  },
};

// =============================================================================
// SEED FUNCTION
// =============================================================================

async function seedData(strapi) {
  const existingEditions = await strapi.documents('api::edition.edition').findMany({ limit: 1 });
  if (existingEditions.length > 0) {
    strapi.log.info('Data already seeded, skipping.');
    return;
  }

  strapi.log.info('Seeding demo data...');

  // 1. Create partenaires
  const partenaireMap = {};
  for (const p of SEED_PARTENAIRES) {
    const created = await strapi.documents('api::partenaire.partenaire').create({
      data: { ...p, slug: slugify(p.name) },
      status: 'published',
    });
    partenaireMap[p.name] = created;
  }
  strapi.log.info(`Seeded ${SEED_PARTENAIRES.length} partenaires.`);

  // 2. Create intervenants
  const intervenantMap = {};
  for (const i of SEED_INTERVENANTS) {
    const created = await strapi.documents('api::intervenant.intervenant').create({
      data: { ...i, slug: slugify(i.name) },
      status: 'published',
    });
    intervenantMap[i.name] = created;
  }
  strapi.log.info(`Seeded ${SEED_INTERVENANTS.length} intervenants.`);

  // 3. Create editions with lieux + link partenaires
  for (const edData of SEED_EDITIONS) {
    const { lieux, ...edFields } = edData;

    // Find matching partenaires for this edition
    const editionPartenaires = edData.title === 'Normandie'
      ? Object.values(partenaireMap).map((p) => ({ documentId: p.documentId }))
      : [partenaireMap['Xylofutur'], partenaireMap['CODIFAB']].filter(Boolean).map((p) => ({ documentId: p.documentId }));

    const edition = await strapi.documents('api::edition.edition').create({
      data: {
        ...edFields,
        slug: slugify(edFields.title),
        lieux: lieux || [],
        partenaires: editionPartenaires,
      },
      status: 'published',
    });

    // 4. Create programme items for Normandie edition
    if (edData.title === 'Normandie') {
      for (const prog of SEED_PROGRAMME) {
        const { intervenants: intervenantNames, ...progFields } = prog;
        const linkedIntervenants = intervenantNames
          .map((name) => intervenantMap[name])
          .filter(Boolean)
          .map((i) => ({ documentId: i.documentId }));

        await strapi.documents('api::programme-item.programme-item').create({
          data: {
            ...progFields,
            edition: { documentId: edition.documentId },
            intervenants: linkedIntervenants,
          },
          status: 'published',
        });
      }
      strapi.log.info(`Seeded ${SEED_PROGRAMME.length} programme items for Normandie.`);
    }

    strapi.log.info(`Seeded edition: ${edData.title}`);
  }

  strapi.log.info('Seed complete!');
}

// =============================================================================
// FRENCH LABELS FOR CONTENT-MANAGER
// =============================================================================

const FRENCH_LABELS = {
  'api::edition.edition': {
    title: 'Titre',
    slug: 'Identifiant URL',
    year: 'Année',
    region: 'Région',
    date: 'Date',
    city: 'Ville',
    status: 'Statut',
    description: 'Description',
    inscription_url: 'Lien d\'inscription',
    image: 'Image de couverture',
    lieux: 'Lieux',
    programme_items: 'Éléments du programme',
    partenaires: 'Partenaires',
    gallery: 'Galerie photos',
    video_urls: 'URLs des vidéos',
    summary: 'Bilan / Synthèse',
    testimonials: 'Témoignages',
  },
  'api::intervenant.intervenant': {
    name: 'Nom',
    slug: 'Identifiant URL',
    title: 'Fonction',
    organization: 'Organisation',
    bio: 'Biographie',
    photo: 'Photo',
    topic: 'Sujet d\'intervention',
    linkedin_url: 'Profil LinkedIn',
    programme_items: 'Interventions au programme',
  },
  'api::partenaire.partenaire': {
    name: 'Nom',
    slug: 'Identifiant URL',
    logo: 'Logo',
    description: 'Description',
    website: 'Site web',
    category: 'Catégorie',
    is_global: 'Partenaire national',
    editions: 'Éditions associées',
  },
  'api::programme-item.programme-item': {
    title: 'Titre',
    start_time: 'Heure de début',
    end_time: 'Heure de fin',
    description: 'Description',
    category: 'Catégorie',
    order: 'Ordre d\'affichage',
    edition: 'Édition',
    intervenants: 'Intervenants',
  },
};

async function setFrenchLabels(strapi) {
  // Query the core_store for each content type configuration
  const entries = [];
  for (const uid of Object.keys(FRENCH_LABELS)) {
    const storeKey = `plugin_content_manager_configuration_content_types::${uid}`;
    const entry = await strapi.db.query('strapi::core-store').findOne({
      where: { key: storeKey },
    });
    strapi.log.info(`[FR] Looking for ${storeKey}: ${entry ? 'FOUND' : 'NOT FOUND'}`);
    if (entry) entries.push(entry);
  }

  for (const entry of entries) {
    const uid = entry.key.replace('plugin_content_manager_configuration_content_types::', '');
    const labels = FRENCH_LABELS[uid];
    if (!labels) continue;

    let config = typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value;
    const metadatas = config.metadatas || {};
    let changed = false;

    for (const [field, frLabel] of Object.entries(labels)) {
      if (metadatas[field]) {
        if (metadatas[field].edit && metadatas[field].edit.label !== frLabel) {
          metadatas[field].edit.label = frLabel;
          changed = true;
        }
        if (metadatas[field].list && metadatas[field].list.label !== frLabel) {
          metadatas[field].list.label = frLabel;
          changed = true;
        }
      }
    }

    if (changed) {
      config.metadatas = metadatas;
      await strapi.db.query('strapi::core-store').update({
        where: { id: entry.id },
        data: { value: JSON.stringify(config) },
      });
      strapi.log.info(`Labels français appliqués pour ${uid}`);
    }
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function setPublicPermissions(strapi, endpoints) {
  const publicRole = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: 'public' },
  });

  if (!publicRole) return;

  for (const { api, actions } of endpoints) {
    for (const action of actions) {
      const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
        where: {
          role: publicRole.id,
          action: `api::${api}.${api}.${action}`,
        },
      });

      if (!existing) {
        await strapi.db.query('plugin::users-permissions.permission').create({
          data: {
            role: publicRole.id,
            action: `api::${api}.${api}.${action}`,
          },
        });
        strapi.log.info(`Granted public permission: ${api}.${action}`);
      }
    }
  }
}
