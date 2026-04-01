'use strict';

const path = require('path');
const fs = require('fs');

const SEED_ASSETS_DIR = path.join(__dirname, '..', 'seed-assets');

// =============================================================================
// SEED DATA — Édition Normandie (2 avril 2026)
// =============================================================================

const SEED_PARTENAIRES = [
  // --- Co-organisateurs ---
  { name: 'Xylofutur', logo_file: 'logos/xylofutur.png', description: 'Pôle de compétitivité de la filière forêt-bois-papier. Fédère plus de 300 adhérents et accompagne les acteurs de son écosystème dans leurs projets d\'innovation collaborative, de la recherche au marché.', website: 'https://www.xylofutur.fr', linkedin_url: 'https://www.linkedin.com/company/xylofutur/', category: 'co-organisateur', is_global: true },
  { name: 'Fibois Normandie', logo_file: 'logos/fibois-normandie.jpg', description: 'Interprofession régionale de la filière forêt-bois en Normandie. Réunit plus de cent adhérents — propriétaires forestiers, exploitants, scieurs, constructeurs — pour structurer et promouvoir la filière sur le territoire.', website: 'https://www.fibois-normandie.fr', linkedin_url: 'https://www.linkedin.com/company/fibois-normandie/', category: 'co-organisateur', is_global: false },

  // --- Soutien financier ---
  { name: 'CODIFAB', logo_file: 'logos/codifab.png', description: 'Comité professionnel de Développement des Industries Françaises de l\'Ameublement et du Bois. Finance environ 200 actions collectives par an représentant ~13 M€, au bénéfice de 4 200 PME de la filière.', website: 'https://www.codifab.fr', category: 'soutien', is_global: true },
  { name: 'France Bois Forêt', logo_file: 'logos/france-bois-foret.jpg', description: 'Interprofession nationale de la filière forêt-bois. Regroupe 24 organisations professionnelles et soutient la promotion, la recherche et le développement durable de la filière bois française.', website: 'https://www.franceboisforet.fr', category: 'soutien', is_global: true },

  // --- Institutionnels nationaux ---
  { name: 'BPI France', logo_file: 'logos/bpi-france.jpg', description: 'Banque publique d\'investissement. Accompagne les entreprises françaises dans leur développement, leur innovation et leur transition écologique à travers des prêts, des garanties et des investissements en fonds propres.', website: 'https://www.bpifrance.fr', linkedin_url: 'https://www.linkedin.com/company/bpifrance/', category: 'institutionnel', is_global: true },
  { name: 'FCBA', logo_file: 'logos/fcba.png', description: 'Institut technologique Forêt, Cellulose, Bois-construction, Ameublement. 350 experts au service de la R&D, la certification et le conseil technique pour les entreprises de la filière bois.', website: 'https://www.fcba.fr', linkedin_url: 'https://www.linkedin.com/company/fcba/', category: 'institutionnel', is_global: true },
  { name: 'INRAE', logo_file: 'logos/inrae.jpg', description: 'Premier institut de recherche agronomique en Europe. Ses travaux sur la forêt, le bois-matériau et la bioéconomie contribuent à la transition écologique de la filière.', website: 'https://www.inrae.fr', linkedin_url: 'https://www.linkedin.com/company/inrae/', category: 'institutionnel', is_global: true },
  { name: 'UICB', logo_file: 'logos/uicb.png', description: 'Union des Industriels et Constructeurs Bois (anciennement Union des Industries de la Construction et du Commerce du Bois). Représente ~500 entreprises, plus de 50 000 emplois et 7 milliards d\'euros de chiffre d\'affaires.', website: 'https://www.uicb.pro', category: 'institutionnel', is_global: true },
  { name: 'UMB-FFB', logo_file: 'logos/umb-ffb.png', description: 'Union des Métiers du Bois de la Fédération Française du Bâtiment. Fédère plus de 9 000 entreprises et 100 000 salariés spécialisés dans la charpente, la menuiserie et la construction bois.', website: 'https://umb.ffbatiment.fr', category: 'institutionnel', is_global: true },
  { name: 'CSF Bois', logo_file: 'logos/csf-bois.png', description: 'Comité Stratégique de Filière Bois. Instance de concertation entre l\'État et les professionnels pour renforcer la compétitivité et l\'innovation d\'une filière générant 50 milliards d\'euros de chiffre d\'affaires annuel.', website: 'https://csfbois.wixsite.com/website', category: 'institutionnel', is_global: true },
  { name: 'France Douglas', description: 'Association nationale qui fédère les acteurs de la filière Douglas en France — 420 000 hectares plantés, deuxième essence résineuse du pays — pour promouvoir ce bois durable et performant.', website: 'https://www.france-douglas.com', category: 'institutionnel', is_global: true },
  { name: 'FCBA Innovathèque', logo_file: 'logos/fcba-innovatheque.png', description: 'Matériauthèque du FCBA regroupant plus de 2 300 références de matériaux innovants pour la construction et l\'ameublement.', website: 'https://www.innovatheque.fr', category: 'institutionnel', is_global: true },
  { name: 'INRAE Innovation', logo_file: 'logos/inrae.jpg', description: 'Filiale de transfert et de valorisation de l\'INRAE. Accompagne les entreprises dans l\'innovation par le transfert de technologies issues de la recherche agronomique.', website: 'https://www.inrae.fr', category: 'institutionnel', is_global: true },

  // --- Institutionnels régionaux (Normandie) ---
  { name: 'PUI Normandie', logo_file: 'logos/pui-normandie.jpg', description: 'Pôle Universitaire d\'Innovation de Normandie. Fabrique d\'innovations fédérant les acteurs de l\'enseignement supérieur et de la recherche pour accélérer le transfert technologique vers les entreprises du territoire.', website: 'https://www.normandie-univ.fr/p-u-i-normandie/', category: 'institutionnel', is_global: false },
  { name: 'Normandie Incubation', logo_file: 'logos/normandie-incubation.png', description: 'Incubateur de la recherche publique normande depuis plus de 25 ans. A accompagné 263 projets et contribué à la création de 200 entreprises innovantes sur le territoire.', website: 'https://www.normandie-incubation.com', category: 'institutionnel', is_global: false },
  { name: 'ADN Normandie', logo_file: 'logos/adn-normandie.png', description: 'Agence de Développement de la Normandie. 56 agents au service de l\'attractivité et du développement économique régional, guichet unique pour l\'accompagnement des entreprises et le financement de l\'innovation.', website: 'https://www.adnormandie.fr', linkedin_url: 'https://www.linkedin.com/company/adn-normandie/', category: 'institutionnel', is_global: false },
  { name: 'Université de Rouen Normandie', description: 'Université pluridisciplinaire accueillant 35 000 étudiants. Le Campus Sciences et Ingénierie de la Technopole du Madrillet héberge la matinée de l\'édition Normandie.', website: 'https://www.univ-rouen.fr', category: 'institutionnel', is_global: false },
  { name: 'PPLA', logo_file: 'logos/ppla.png', description: 'Pacte Bois et Biosourcés en Normandie, porté par Fibois Normandie. Rassemble plus de 30 signataires engagés à augmenter la part de matériaux bois et biosourcés dans la construction régionale.', website: 'https://www.fibois-normandie.fr', category: 'institutionnel', is_global: false },

  // --- Partenaires privés ---
  { name: 'CBS-CBT', logo_file: 'logos/cbs-cbt.png', description: 'Groupe franco-suisse d\'ingénierie bois fondé en 1991. Spécialiste des structures bois innovantes et de la préfabrication, avec des bureaux à Paris, Lausanne et un atelier en Savoie.', website: 'https://cbs-cbt.com', category: 'privé', is_global: true },
  { name: 'Soprema-Pavatex', logo_file: 'logos/soprema-pavatex.png', description: 'Soprema, leader de l\'étanchéité, a acquis Pavatex en 2016 pour développer l\'isolation en fibre de bois. Gamme complète de panneaux isolants biosourcés pour toiture, mur et sol.', website: 'https://www.soprema.fr', category: 'privé', is_global: true },
  { name: 'Impulse Partners', logo_file: 'logos/impulse-partners.png', description: 'Cabinet de conseil en innovation spécialisé dans la construction et l\'immobilier. 50 consultants qui accompagnent les entreprises dans leur transformation et leurs projets d\'innovation.', website: 'https://www.impulse-partners.com', category: 'privé', is_global: true },
  { name: 'Open Kairos', logo_file: 'logos/open-kairos.png', description: 'Cabinet de conseil en stratégie, innovation et transformation. Accompagne PME, ETI et grands groupes dans leurs démarches d\'innovation et de transformation digitale.', website: 'https://openkairos.fr', category: 'privé', is_global: true },
  { name: 'Veepee', logo_file: 'logos/veepee.jpg', description: 'Leader européen des ventes événementielles en ligne (1,8 milliard d\'euros de CA). Engagé dans la transition écologique, partenaire de la filière bois pour promouvoir l\'éco-construction.', website: 'https://www.veepee.fr', category: 'privé', is_global: true },
  { name: 'Forinvest', logo_file: 'logos/forinvest.png', description: 'Réseau des forestiers investisseurs. Facilite la mise en relation entre investisseurs et entrepreneurs de la filière forêt-bois, avec environ 9 millions d\'euros investis à ce jour.', website: 'https://www.forinvest-ba.fr', category: 'privé', is_global: true },
  { name: 'Hors-Site', logo_file: 'logos/hors-site.png', description: 'Acteur de la construction hors-site (préfabrication industrielle). Promeut des solutions constructives innovantes pour accélérer les chantiers et réduire l\'empreinte environnementale.', category: 'privé', is_global: true },
  { name: 'SSPM', logo_file: 'logos/sspm.jpg', description: 'Syndicat des constructeurs de structures en bois, partenaire de la filière construction bois.', category: 'privé', is_global: true },
  { name: 'WAYS', logo_file: 'logos/ways.png', description: 'Partenaire des Journées de l\'Innovation Filière Bois.', category: 'privé', is_global: true },
  { name: 'DHDA', logo_file: 'logos/dhda.png', description: 'Partenaire des Journées de l\'Innovation Filière Bois.', category: 'privé', is_global: true },
];

const SEED_INTERVENANTS = [
  // --- Organisateur (introduction) ---
  { name: 'Xylofutur', type: 'organisation', photo_file: 'photos/xylofutur.png', organization: 'Xylofutur', category: 'organisateur', topic: 'Pourquoi et comment innover dans la filière forêt-bois.', bio: 'Pôle de compétitivité de la filière forêt-bois-papier. Fédère plus de 300 adhérents et organise les Journées de l\'Innovation pour connecter les acteurs et accélérer les projets collaboratifs.', website: 'https://www.xylofutur.fr', partenaire_name: 'Xylofutur' },

  // --- Retours d'expériences d'entrepreneurs ---
  { name: 'Künkel', type: 'organisation', photo_file: 'photos/kunkel.jpg', organization: 'Künkel', category: 'entrepreneur', topic: 'Comment Künkel a réussi à réduire son impact environnemental grâce à l\'économie circulaire pour la fabrication de ses dés de palettes.', bio: 'Entreprise spécialisée dans la fabrication de dés de palettes, engagée dans une démarche d\'économie circulaire pour réduire l\'impact environnemental de sa production.' },
  { name: 'Proxipel', type: 'organisation', photo_file: 'photos/proxipel.jpg', organization: 'Proxipel', category: 'entrepreneur', topic: 'Quelle solution pour améliorer le rendement du marché du granulés ?', bio: 'Entreprise normande innovante dans le domaine des granulés de bois, développant des solutions pour améliorer le rendement et la performance du marché.' },
  { name: 'Linex Panneaux', type: 'organisation', photo_file: 'photos/linex-panneaux.jpg', organization: 'Linex Panneaux', category: 'entrepreneur', topic: 'L\'augmentation de la part de bois recyclé dans les panneaux, un moteur d\'innovation au service de l\'économie circulaire.', bio: 'Fabricant de panneaux de bois reconstitué, pionnier dans l\'intégration croissante de bois recyclé dans ses process de production.' },

  // --- Chercheurs / Projets de recherche ---
  { name: 'UMR ECODIV', type: 'organisation', photo_file: 'photos/umr-ecodiv.png', organization: 'UMR ECODIV — Université de Rouen', category: 'chercheur', topic: 'Expertise sur la biodiversité des sols en lien avec la gestion forestière et la filière bois.', bio: 'Unité mixte de recherche en écologie des écosystèmes continentaux (Université de Rouen Normandie). Étudie la biodiversité des sols forestiers et les interactions entre gestion sylvicole et fonctionnement écologique.' },
  { name: 'Projet HydroXyl-PACT', type: 'organisation', organization: 'HydroXyl-PACT', category: 'chercheur', topic: 'Applications en santé des hémicelluloses issues des bois feuillus grâce à leurs propriétés antimicrobiennes.', bio: 'Projet de recherche explorant les propriétés antimicrobiennes des hémicelluloses extraites de bois feuillus pour des applications dans le domaine de la santé.' },
  { name: 'Projet SOLORGA', type: 'organisation', organization: 'SOLORGA', category: 'chercheur', topic: 'Comment le projet SOLORGA repense les sols équestres en alliant science, confort et durabilité.', bio: 'Projet de recherche appliquée qui repense la conception des sols équestres en combinant des matériaux biosourcés issus du bois avec des critères de confort animal et de durabilité.' },

  // --- Financeurs ---
  { name: 'ADN Normandie', type: 'organisation', photo_file: 'photos/adn-normandie.png', organization: 'ADN Normandie', title: 'Guichet unique développement économique', category: 'financeur', topic: 'Le financement de l\'innovation en Normandie.', bio: 'Agence de Développement de la Normandie. 56 agents mobilisés pour accompagner les entreprises dans leurs projets de développement, d\'innovation et de financement sur le territoire normand.', website: 'https://www.adnormandie.fr', partenaire_name: 'ADN Normandie' },
  { name: 'BpiFrance', type: 'organisation', photo_file: 'photos/bpifrance.jpg', organization: 'BpiFrance', title: 'Accompagnement des entreprises', category: 'financeur', topic: 'Accompagnement des projets de développement, transition écologique et innovation.', bio: 'Banque publique d\'investissement française. Soutient les entreprises à chaque étape de leur développement par des prêts, garanties et investissements, avec un focus sur l\'innovation et la transition écologique.', website: 'https://www.bpifrance.fr', partenaire_name: 'BPI France' },
  { name: 'Lise financement', type: 'organisation', photo_file: 'photos/lise-financement.png', organization: 'Lise', category: 'financeur', topic: 'Accès simplifié au financement en fonds propres pour PME et ETI grâce à une nouvelle bourse.', bio: 'Plateforme innovante facilitant l\'accès au financement en fonds propres pour les PME et ETI, via une bourse simplifiée connectant entreprises et investisseurs.' },
  { name: 'Forinvest', type: 'organisation', photo_file: 'photos/forinvest.png', organization: 'Forinvest', category: 'financeur', topic: 'Réseau des forestiers investisseurs pour le développement des entreprises de la filière forêt-bois.', bio: 'Réseau de forestiers investisseurs qui facilite la mise en relation entre capitaux forestiers et entrepreneurs de la filière bois. Environ 9 millions d\'euros investis à ce jour.', website: 'https://www.forinvest-ba.fr', partenaire_name: 'Forinvest' },

  // --- Innovations produits & services (après-midi) ---
  { name: 'Kutsh', type: 'organisation', photo_file: 'photos/kutsh.png', organization: 'Kutsh', category: 'entrepreneur', topic: 'Application qui automatise grâce à l\'IA l\'analyse des demandes d\'autorisations d\'urbanisme.', bio: 'Startup développant une application d\'intelligence artificielle qui automatise l\'analyse des demandes d\'autorisations d\'urbanisme, accélérant le processus pour les collectivités et les constructeurs bois.' },
  { name: 'Fibraterre', type: 'organisation', photo_file: 'photos/fibraterre.png', organization: 'Fibraterre', category: 'entrepreneur', topic: 'Panneaux semi-rigides à base de paille pour la construction.', bio: 'Entreprise innovante qui développe et produit des panneaux isolants semi-rigides à base de paille, offrant une alternative biosourcée performante pour la construction.' },
  { name: 'Micao', type: 'organisation', photo_file: 'photos/micao.png', organization: 'Micao', category: 'entrepreneur', topic: 'Intégration du réemploi de bois dans les ouvrages de construction.', bio: 'Entreprise spécialisée dans le réemploi de matériaux bois pour la construction. Développe des méthodologies et des outils pour intégrer le bois de réemploi dans les ouvrages neufs.' },

  // --- Initiatives collectives (après-midi) ---
  { name: 'THN', type: 'organisation', photo_file: 'photos/thn.jpg', organization: 'Territoire & Habitat Normand', category: 'institutionnel', topic: 'Feuille de route dédiée à l\'innovation dans l\'habitat normand.', bio: 'Collectif normand qui élabore et porte une feuille de route dédiée à l\'innovation dans l\'habitat, fédérant les acteurs publics et privés du territoire pour transformer les pratiques constructives.' },
  { name: 'CAP', type: 'organisation', organization: 'Concevoir Autrement en Paille', category: 'institutionnel', topic: 'Boîte à outils pour structurer et diffuser les savoir-faire liés à la paille.', bio: 'Initiative collective qui structure et diffuse les savoir-faire liés à la construction en paille, à travers une boîte à outils pratique destinée aux professionnels du bâtiment.' },
  { name: 'FCBA', type: 'organisation', photo_file: 'photos/fcba.png', organization: 'FCBA', category: 'institutionnel', topic: 'La certification CTB Composants et Systèmes Bois au service de l\'innovation.', bio: 'Institut technologique Forêt Cellulose Bois-construction Ameublement. 350 experts au service de la R&D, de la certification et du conseil pour les entreprises de la filière.', website: 'https://www.fcba.fr', partenaire_name: 'FCBA' },
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
    edition_status: 'inscriptions-ouvertes',
    image_file: 'editions/normandie.jpg',
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
    edition_status: 'a-venir',
    image_file: 'editions/a-venir.png',
    description: 'Deuxième étape de la tournée — Région Sud, juin 2026.',
    lieux: [],
  },
  {
    title: 'Nouvelle-Aquitaine',
    year: 2026,
    region: 'nouvelle-aquitaine',
    date: '2026-10-15',
    city: 'À confirmer',
    edition_status: 'a-venir',
    image_file: 'editions/a-venir.png',
    description: 'Troisième étape — Nouvelle-Aquitaine, octobre 2026.',
    lieux: [],
  },
  {
    title: 'Auvergne-Rhône-Alpes',
    year: 2026,
    region: 'auvergne-rhone-alpes',
    date: '2026-12-15',
    city: 'À confirmer',
    edition_status: 'a-venir',
    image_file: 'editions/a-venir.png',
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
    const { logo_file, ...fields } = p;
    const created = await strapi.documents('api::partenaire.partenaire').create({
      data: { ...fields, slug: slugify(p.name) },
      status: 'published',
    });
    partenaireMap[p.name] = created;

    // Upload and attach logo
    if (logo_file) {
      await uploadAndAttach(strapi, logo_file, {
        refId: created.id,
        ref: 'api::partenaire.partenaire',
        field: 'logo',
      });
    }
  }
  strapi.log.info(`Seeded ${SEED_PARTENAIRES.length} partenaires.`);

  // 2. Create intervenants (link to partenaire if partenaire_name is set)
  const intervenantMap = {};
  for (const i of SEED_INTERVENANTS) {
    const { partenaire_name, photo_file, ...fields } = i;
    const data = { ...fields, slug: slugify(i.name) };

    // Link intervenant to its partenaire if specified
    if (partenaire_name && partenaireMap[partenaire_name]) {
      data.partenaire = { documentId: partenaireMap[partenaire_name].documentId };
    }

    const created = await strapi.documents('api::intervenant.intervenant').create({
      data,
      status: 'published',
    });
    intervenantMap[i.name] = created;

    // Upload and attach photo
    if (photo_file) {
      await uploadAndAttach(strapi, photo_file, {
        refId: created.id,
        ref: 'api::intervenant.intervenant',
        field: 'photo',
      });
    }
  }
  strapi.log.info(`Seeded ${SEED_INTERVENANTS.length} intervenants.`);

  // 3. Create editions with lieux + link partenaires
  for (const edData of SEED_EDITIONS) {
    const { lieux, image_file, ...edFields } = edData;

    // Normandie gets all partenaires; other editions get global ones only
    const editionPartenaires = edData.title === 'Normandie'
      ? Object.values(partenaireMap).map((p) => ({ documentId: p.documentId }))
      : Object.entries(partenaireMap)
          .filter(([name]) => SEED_PARTENAIRES.find((p) => p.name === name && p.is_global))
          .map(([, p]) => ({ documentId: p.documentId }));

    const edition = await strapi.documents('api::edition.edition').create({
      data: {
        ...edFields,
        slug: slugify(edFields.title),
        lieux: lieux || [],
        partenaires: editionPartenaires,
      },
      status: 'published',
    });

    // Upload and attach edition image
    if (image_file) {
      await uploadAndAttach(strapi, image_file, {
        refId: edition.id,
        ref: 'api::edition.edition',
        field: 'image',
      });
    }

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
    edition_status: 'Statut',
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

/**
 * Upload a file from seed-assets and attach it to an entity.
 */
async function uploadAndAttach(strapi, relPath, { refId, ref, field }) {
  const filePath = path.join(SEED_ASSETS_DIR, relPath);
  if (!fs.existsSync(filePath)) {
    strapi.log.warn(`Seed asset not found: ${relPath}`);
    return;
  }

  const stats = fs.statSync(filePath);
  const fileName = path.basename(filePath);
  const MIME_MAP = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
  const mimeType = MIME_MAP[path.extname(filePath).toLowerCase()] || 'application/octet-stream';

  const uploaded = await strapi.plugins.upload.services.upload.upload({
    data: { refId, ref, field },
    files: {
      filepath: filePath,
      originalFilename: fileName,
      mimetype: mimeType,
      size: stats.size,
    },
  });

  strapi.log.info(`Uploaded ${relPath} → ${ref} (${field})`);
  return uploaded;
}

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
