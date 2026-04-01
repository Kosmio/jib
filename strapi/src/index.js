'use strict';

const path = require('path');
const fs = require('fs');

const SEED_ASSETS_DIR = path.join(__dirname, '..', 'seed-assets');

// =============================================================================
// SEED DATA — Tags
// =============================================================================

const SEED_TAGS = [
  // Intervenant / organisation type tags
  { name: 'Entrepreneur',    slug: 'entrepreneur',    color: 'amber'   },
  { name: 'Chercheur',       slug: 'chercheur',       color: 'blue'    },
  { name: 'Financeur',       slug: 'financeur',       color: 'emerald' },
  { name: 'Institutionnel',  slug: 'institutionnel',  color: 'purple'  },
  { name: 'Organisateur',    slug: 'organisateur',    color: 'primary' },
  // Programme category tags
  { name: 'Introduction',    slug: 'introduction',    color: 'primary' },
  { name: 'Finance',         slug: 'finance',         color: 'amber'   },
  { name: 'Recherche',       slug: 'recherche',       color: 'emerald' },
  { name: 'Témoignages',     slug: 'temoignages',     color: 'blue'    },
  { name: 'Actions',         slug: 'actions',         color: 'purple'  },
  { name: 'Pause',           slug: 'pause',           color: 'gray'    },
  { name: 'Clôture',         slug: 'cloture',         color: 'gray'    },
  // Partenariat role tags
  { name: 'Co-organisateur', slug: 'co-organisateur', color: 'primary' },
  { name: 'Soutien',         slug: 'soutien',         color: 'amber'   },
  { name: 'Privé',           slug: 'prive',           color: 'wood'    },
];

// =============================================================================
// SEED DATA — Organisations
// =============================================================================

// tag_slugs: used to link tags; role: used to create the Partenariat entry (null = no partenariat)
const SEED_ORGANISATIONS = [
  // --- Co-organisateurs ---
  {
    name: 'Xylofutur',
    logo_file: 'logos/xylofutur-ss-baseline.png',
    description: 'Pôle de compétitivité de la filière forêt-bois-papier. Fédère plus de 300 adhérents et accompagne les acteurs de son écosystème dans leurs projets d\'innovation collaborative, de la recherche au marché.',
    website: 'https://www.xylofutur.fr',
    linkedin_url: 'https://www.linkedin.com/company/xylofutur/',
    tag_slugs: ['co-organisateur', 'organisateur'],
    role: 'co-organisateur',
  },
  {
    name: 'Fibois Normandie',
    logo_file: 'logos/fibois-normandie.png',
    description: 'Interprofession régionale de la filière forêt-bois en Normandie. Réunit plus de cent adhérents — propriétaires forestiers, exploitants, scieurs, constructeurs — pour structurer et promouvoir la filière sur le territoire.',
    website: 'https://www.fibois-normandie.fr',
    linkedin_url: 'https://www.linkedin.com/company/fibois-normandie/',
    tag_slugs: ['co-organisateur'],
    role: 'co-organisateur',
  },

  // --- Soutien financier ---
  {
    name: 'CODIFAB',
    logo_file: 'logos/codifab.png',
    description: 'Comité professionnel de Développement des Industries Françaises de l\'Ameublement et du Bois. Finance environ 200 actions collectives par an représentant ~13 M€, au bénéfice de 4 200 PME de la filière.',
    website: 'https://www.codifab.fr',
    tag_slugs: ['soutien'],
    role: 'soutien',
  },
  {
    name: 'France Bois Forêt',
    logo_file: 'logos/france-bois-foret.jpg',
    description: 'Interprofession nationale de la filière forêt-bois. Regroupe 24 organisations professionnelles et soutient la promotion, la recherche et le développement durable de la filière bois française.',
    website: 'https://www.franceboisforet.fr',
    tag_slugs: ['soutien'],
    role: 'institutionnel',
  },

  // --- Institutionnels nationaux ---
  {
    name: 'BPI France',
    logo_file: 'logos/bpi-france.jpg',
    description: 'Banque publique d\'investissement. Accompagne les entreprises françaises dans leur développement, leur innovation et leur transition écologique à travers des prêts, des garanties et des investissements en fonds propres.',
    website: 'https://www.bpifrance.fr',
    linkedin_url: 'https://www.linkedin.com/company/bpifrance/',
    tag_slugs: ['institutionnel', 'financeur'],
    role: 'institutionnel',
  },
  {
    name: 'FCBA',
    logo_file: 'logos/fcba.png',
    description: 'Institut technologique Forêt, Cellulose, Bois-construction, Ameublement. 350 experts au service de la R&D, la certification et le conseil technique pour les entreprises de la filière bois.',
    website: 'https://www.fcba.fr',
    linkedin_url: 'https://www.linkedin.com/company/fcba/',
    tag_slugs: ['institutionnel'],
    role: 'institutionnel',
  },
  {
    name: 'INRAE',
    logo_file: 'logos/inrae.jpg',
    description: 'Premier institut de recherche agronomique en Europe. Ses travaux sur la forêt, le bois-matériau et la bioéconomie contribuent à la transition écologique de la filière.',
    website: 'https://www.inrae.fr',
    linkedin_url: 'https://www.linkedin.com/company/inrae/',
    tag_slugs: ['institutionnel'],
    role: 'institutionnel',
  },
  {
    name: 'UICB',
    logo_file: 'logos/uicb.png',
    description: 'Union des Industriels et Constructeurs Bois (anciennement Union des Industries de la Construction et du Commerce du Bois). Représente ~500 entreprises, plus de 50 000 emplois et 7 milliards d\'euros de chiffre d\'affaires.',
    website: 'https://www.uicb.pro',
    tag_slugs: ['institutionnel'],
    role: 'institutionnel',
  },
  {
    name: 'UMB-FFB',
    logo_file: 'logos/umb-ffb.png',
    description: 'Union des Métiers du Bois de la Fédération Française du Bâtiment. Fédère plus de 9 000 entreprises et 100 000 salariés spécialisés dans la charpente, la menuiserie et la construction bois.',
    website: 'https://umb.ffbatiment.fr',
    tag_slugs: ['institutionnel'],
    role: 'institutionnel',
  },
  {
    name: 'CSF Bois',
    logo_file: 'logos/csf-bois.png',
    description: 'Comité Stratégique de Filière Bois. Instance de concertation entre l\'État et les professionnels pour renforcer la compétitivité et l\'innovation d\'une filière générant 50 milliards d\'euros de chiffre d\'affaires annuel.',
    website: 'https://csfbois.wixsite.com/website',
    tag_slugs: ['institutionnel'],
    role: 'institutionnel',
  },
  {
    name: 'France Douglas',
    logo_file: 'logos/france-douglas.png',
    description: 'Association nationale qui fédère les acteurs de la filière Douglas en France — 420 000 hectares plantés, deuxième essence résineuse du pays — pour promouvoir ce bois durable et performant.',
    website: 'https://www.france-douglas.com',
    tag_slugs: ['institutionnel'],
    role: 'institutionnel',
  },
  {
    name: 'FCBA Innovathèque',
    logo_file: 'logos/fcba-innovatheque.png',
    description: 'Matériauthèque du FCBA regroupant plus de 2 300 références de matériaux innovants pour la construction et l\'ameublement.',
    website: 'https://www.innovatheque.fr',
    tag_slugs: ['institutionnel'],
    role: 'institutionnel',
  },
  {
    name: 'INRAE Innovation',
    logo_file: 'logos/inrae.jpg',
    description: 'Filiale de transfert et de valorisation de l\'INRAE. Accompagne les entreprises dans l\'innovation par le transfert de technologies issues de la recherche agronomique.',
    website: 'https://www.inrae.fr',
    tag_slugs: ['institutionnel'],
    role: 'institutionnel',
  },

  // --- Institutionnels régionaux (Normandie) ---
  {
    name: 'PUI Normandie',
    logo_file: 'logos/pui-normandie.png',
    description: 'Pôle Universitaire d\'Innovation de Normandie. Fabrique d\'innovations fédérant les acteurs de l\'enseignement supérieur et de la recherche pour accélérer le transfert technologique vers les entreprises du territoire.',
    website: 'https://www.normandie-univ.fr/p-u-i-normandie/',
    tag_slugs: ['institutionnel'],
    role: 'institutionnel',
  },
  {
    name: 'Normandie Incubation',
    logo_file: 'logos/normandie-incubation.png',
    description: 'Incubateur de la recherche publique normande depuis plus de 25 ans. A accompagné 263 projets et contribué à la création de 200 entreprises innovantes sur le territoire.',
    website: 'https://www.normandie-incubation.com',
    tag_slugs: ['institutionnel'],
    role: 'institutionnel',
  },
  {
    name: 'ADN Normandie',
    logo_file: 'logos/adn-normandie.png',
    description: 'Agence de Développement de la Normandie. 56 agents au service de l\'attractivité et du développement économique régional, guichet unique pour l\'accompagnement des entreprises et le financement de l\'innovation.',
    website: 'https://www.adnormandie.fr',
    linkedin_url: 'https://www.linkedin.com/company/adn-normandie/',
    tag_slugs: ['institutionnel', 'financeur'],
    role: null,
  },
  {
    name: 'PPLA',
    logo_file: 'logos/ppla.png',
    description: 'Pacte Bois et Biosourcés en Normandie, porté par Fibois Normandie. Rassemble plus de 30 signataires engagés à augmenter la part de matériaux bois et biosourcés dans la construction régionale.',
    website: 'https://www.fibois-normandie.fr',
    tag_slugs: ['institutionnel'],
    role: 'institutionnel',
  },

  // --- Partenaires privés ---
  {
    name: 'CBS-CBT',
    logo_file: 'logos/cbs-cbt.png',
    description: 'Groupe franco-suisse d\'ingénierie bois fondé en 1991. Spécialiste des structures bois innovantes et de la préfabrication, avec des bureaux à Paris, Lausanne et un atelier en Savoie.',
    website: 'https://cbs-cbt.com',
    tag_slugs: ['prive', 'entrepreneur'],
    role: 'institutionnel',
  },
  {
    name: 'Soprema-Pavatex',
    logo_file: 'logos/soprema-pavatex.png',
    description: 'Soprema, leader de l\'étanchéité, a acquis Pavatex en 2016 pour développer l\'isolation en fibre de bois. Gamme complète de panneaux isolants biosourcés pour toiture, mur et sol.',
    website: 'https://www.soprema.fr',
    tag_slugs: ['prive', 'entrepreneur'],
    role: 'prive',
  },
  {
    name: 'Impulse Partners',
    logo_file: 'logos/impulse-partners.png',
    description: 'Cabinet de conseil en innovation spécialisé dans la construction et l\'immobilier. 50 consultants qui accompagnent les entreprises dans leur transformation et leurs projets d\'innovation.',
    website: 'https://www.impulse-partners.com',
    tag_slugs: ['prive'],
    role: 'prive',
  },
  {
    name: 'Open Kairos',
    logo_file: 'logos/open-kairos.png',
    description: 'Cabinet de conseil en stratégie, innovation et transformation. Accompagne PME, ETI et grands groupes dans leurs démarches d\'innovation et de transformation digitale.',
    website: 'https://openkairos.fr',
    tag_slugs: ['prive'],
    role: 'prive',
  },
  {
    name: 'Veepee',
    logo_file: 'logos/veepee.png',
    description: 'Leader européen des ventes événementielles en ligne (1,8 milliard d\'euros de CA). Engagé dans la transition écologique, partenaire de la filière bois pour promouvoir l\'éco-construction.',
    website: 'https://www.veepee.fr',
    tag_slugs: ['prive'],
    role: 'prive',
  },
  {
    name: 'Forinvest',
    logo_file: 'logos/forinvest.png',
    description: 'Réseau des forestiers investisseurs. Facilite la mise en relation entre investisseurs et entrepreneurs de la filière forêt-bois, avec environ 9 millions d\'euros investis à ce jour.',
    website: 'https://www.forinvest-ba.fr',
    tag_slugs: ['prive', 'financeur'],
    role: 'prive',
  },
  {
    name: 'Hors-Site',
    logo_file: 'logos/hors-site.png',
    description: 'Acteur de la construction hors-site (préfabrication industrielle). Promeut des solutions constructives innovantes pour accélérer les chantiers et réduire l\'empreinte environnementale.',
    tag_slugs: ['prive'],
    role: 'institutionnel',
  },
  {
    name: 'SSPM',
    logo_file: 'logos/sspm.jpg',
    description: 'Syndicat des constructeurs de structures en bois, partenaire de la filière construction bois.',
    tag_slugs: ['prive'],
    role: 'prive',
  },
  {
    name: 'WAYS',
    logo_file: 'logos/ways.png',
    description: 'Partenaire des Journées de l\'Innovation Filière Bois.',
    tag_slugs: ['prive'],
    role: 'prive',
  },
  {
    name: 'DHDA',
    logo_file: 'logos/dhda.png',
    description: 'Partenaire des Journées de l\'Innovation Filière Bois.',
    tag_slugs: ['prive'],
    role: 'institutionnel',
  },

  // --- Organisations from old intervenant entries (no partenariat) ---
  {
    name: 'Künkel',
    logo_file: 'photos/kunkel.jpg',
    description: 'Entreprise spécialisée dans la fabrication de dés de palettes, engagée dans une démarche d\'économie circulaire pour réduire l\'impact environnemental de sa production.',
    tag_slugs: ['entrepreneur'],
    role: null,
  },
  {
    name: 'Proxipel',
    logo_file: 'photos/proxipel.jpg',
    description: 'Entreprise normande innovante dans le domaine des granulés de bois, développant des solutions pour améliorer le rendement et la performance du marché.',
    tag_slugs: ['entrepreneur'],
    role: null,
  },
  {
    name: 'Linex Panneaux',
    logo_file: 'photos/linex-panneaux.jpg',
    description: 'Fabricant de panneaux de bois reconstitué, pionnier dans l\'intégration croissante de bois recyclé dans ses process de production.',
    tag_slugs: ['entrepreneur'],
    role: null,
  },
  {
    name: 'UMR ECODIV',
    logo_file: 'photos/umr-ecodiv.png',
    description: 'Unité mixte de recherche en écologie des écosystèmes continentaux (Université de Rouen Normandie). Étudie la biodiversité des sols forestiers et les interactions entre gestion sylvicole et fonctionnement écologique.',
    tag_slugs: ['chercheur'],
    role: null,
  },
  {
    name: 'HydroXyl-PACT',
    logo_file: 'logos/hydroxyl-pact.png',
    description: 'Projet de recherche explorant les propriétés antimicrobiennes des hémicelluloses extraites de bois feuillus pour des applications dans le domaine de la santé.',
    tag_slugs: ['chercheur'],
    role: null,
  },
  {
    name: 'SOLORGA',
    logo_file: 'logos/solorga.png',
    description: 'Projet de recherche appliquée qui repense la conception des sols équestres en combinant des matériaux biosourcés issus du bois avec des critères de confort animal et de durabilité.',
    tag_slugs: ['chercheur'],
    role: null,
  },
  {
    name: 'Kutsh',
    logo_file: 'photos/kutsh.png',
    description: 'Startup développant une application d\'intelligence artificielle qui automatise l\'analyse des demandes d\'autorisations d\'urbanisme, accélérant le processus pour les collectivités et les constructeurs bois.',
    tag_slugs: ['entrepreneur'],
    role: null,
  },
  {
    name: 'Fibraterre',
    logo_file: 'photos/fibraterre.png',
    description: 'Entreprise innovante qui développe et produit des panneaux isolants semi-rigides à base de paille, offrant une alternative biosourcée performante pour la construction.',
    tag_slugs: ['entrepreneur'],
    role: null,
  },
  {
    name: 'Micao',
    logo_file: 'photos/micao.png',
    description: 'Entreprise spécialisée dans le réemploi de matériaux bois pour la construction. Développe des méthodologies et des outils pour intégrer le bois de réemploi dans les ouvrages neufs.',
    tag_slugs: ['entrepreneur'],
    role: null,
  },
  {
    name: 'THN',
    logo_file: 'photos/thn.jpg',
    description: 'Collectif normand qui élabore et porte une feuille de route dédiée à l\'innovation dans l\'habitat, fédérant les acteurs publics et privés du territoire pour transformer les pratiques constructives.',
    tag_slugs: ['institutionnel'],
    role: null,
  },
  {
    name: 'CAP',
    logo_file: 'logos/cap.jpg',
    description: 'Initiative collective qui structure et diffuse les savoir-faire liés à la construction en paille, à travers une boîte à outils pratique destinée aux professionnels du bâtiment.',
    tag_slugs: ['institutionnel'],
    role: null,
  },
  {
    name: 'Lise',
    logo_file: 'photos/lise-financement.png',
    description: 'Plateforme innovante facilitant l\'accès au financement en fonds propres pour les PME et ETI, via une bourse simplifiée connectant entreprises et investisseurs.',
    tag_slugs: ['financeur'],
    role: null,
  },
];

// =============================================================================
// SEED DATA — Intervenants (persons only)
// =============================================================================

const SEED_INTERVENANTS = [
  {
    name: 'Arnaud Groff',
    org_name: null,
    title: 'Expert en management de l\'innovation',
    photo_file: 'photos/arnaud-groff.jpg',
    topic: 'Les 4 sources d\'innovation et comment innover concrètement.',
    bio: 'Entrepreneur, consultant et enseignant-chercheur, expert reconnu en management de l\'innovation. Parcours de PSA à la direction du mastère spécialisé à Toulouse Business School. A accompagné plus de 500 entreprises dans leurs démarches d\'innovation. Auteur de « Innovez autrement, disnovez ».',
    tag_slugs: ['entrepreneur'],
  },
  {
    name: 'Stefano Millefiorini',
    org_name: 'Soprema-Pavatex',
    title: 'Prescripteur Isolation Durable',
    photo_file: 'photos/stefano-millefiorini.png',
    topic: 'Retour d\'une démarche d\'innovation dans l\'isolation en fibre de bois.',
    bio: 'Prescripteur Isolation Durable chez Soprema-Pavatex, spécialiste des solutions d\'isolation biosourcées en fibre de bois.',
    tag_slugs: ['entrepreneur'],
  },
  {
    name: 'Gaétan Miguet',
    org_name: 'CBS-CBT',
    title: 'Responsable R&D — Ingénieur structure bois',
    photo_file: 'photos/gaetan-miguet.png',
    topic: 'Retour d\'une démarche d\'innovation en ingénierie structure bois.',
    bio: 'Responsable R&D et ingénieur structure bois chez CBS-CBT, groupe franco-suisse d\'ingénierie bois spécialisé dans les structures innovantes et la préfabrication.',
    tag_slugs: ['entrepreneur'],
  },
  {
    name: 'Yann Raoult',
    org_name: 'WAYS',
    title: 'Président & Co-fondateur',
    photo_file: 'photos/yann-raoult.png',
    topic: 'Retour d\'une démarche d\'innovation chez WAYS.',
    bio: 'Président et co-fondateur de WAYS, entreprise engagée dans l\'innovation au service de la filière bois.',
    tag_slugs: ['entrepreneur'],
  },
  {
    name: 'Cyril Durand',
    org_name: 'Open Kairos',
    title: 'Co-fondateur d\'Océan Bleu et de l\'Entrepriserie',
    photo_file: 'photos/cyril-durand.png',
    topic: 'Atelier Océan Bleu — Stratégie et innovation.',
    bio: 'Co-fondateur d\'Océan Bleu et de l\'Entrepriserie. Conférencier expert en stratégie et innovation, accompagne les entreprises dans la création de nouveaux marchés.',
    tag_slugs: ['entrepreneur'],
  },
  {
    name: 'Maud Chemin',
    org_name: 'FCBA',
    title: 'Chargée Innovation et Transfert de Technologie',
    photo_file: 'photos/maud-chemin.png',
    topic: 'L\'Innovathèque comme support au transfert technologique.',
    bio: 'Chargée Innovation et Transfert de Technologie au FCBA, anime l\'Innovathèque pour faciliter le transfert technologique vers les entreprises de la filière.',
    tag_slugs: ['institutionnel'],
  },
  {
    name: 'Thomas Vigier',
    org_name: null,
    title: 'Ingénieur en Obsolescence et Pérennité Programmée',
    photo_file: null,
    topic: 'L\'innovation sur le système productif de la filière — l\'obsolescence comme source d\'innovation.',
    bio: 'Ingénieur spécialisé en obsolescence et pérennité programmée. Explore comment les pannes et l\'obsolescence des outils peuvent devenir une source d\'innovation avec des gains économiques, écologiques et de souveraineté.',
    tag_slugs: ['chercheur'],
  },
  {
    name: 'Lucas De Pedro',
    org_name: 'Xylofutur',
    title: 'Chef de projet innovation & industrie',
    photo_file: 'photos/lucas-de-pedro.png',
    topic: 'Atelier : Savoir parler de votre innovation.',
    bio: 'Chef de projet innovation et industrie chez Xylofutur, accompagne les entreprises dans la valorisation et la communication de leurs projets innovants.',
    tag_slugs: ['organisateur'],
  },
  {
    name: 'Apolline Oswald',
    org_name: 'Xylofutur',
    title: 'Responsable de l\'équipe Projets',
    photo_file: 'photos/apolline-oswald.png',
    topic: 'Atelier : Capter et créer de la valeur.',
    bio: 'Responsable de l\'équipe Projets chez Xylofutur, coordonne les projets collaboratifs d\'innovation de la filière forêt-bois.',
    tag_slugs: ['organisateur'],
  },
  {
    name: 'Céline Beaujolin',
    org_name: null,
    title: null,
    photo_file: null,
    topic: 'Enjeux d\'innovation dans la filière bois.',
    bio: 'Intervenante partenaire lors de la 2e édition parisienne des Journées de l\'Innovation Filière Bois.',
    tag_slugs: ['institutionnel'],
  },
  {
    name: 'Jean-Luc Dunoyer',
    org_name: null,
    title: null,
    photo_file: null,
    topic: 'Enjeux d\'innovation dans la filière bois.',
    bio: 'Intervenant partenaire lors de la 2e édition parisienne des Journées de l\'Innovation Filière Bois.',
    tag_slugs: ['institutionnel'],
  },
  {
    name: 'Mathieu Ruillet',
    org_name: null,
    title: null,
    photo_file: null,
    topic: 'Enjeux d\'innovation dans la filière bois.',
    bio: 'Intervenant partenaire lors de la 2e édition parisienne des Journées de l\'Innovation Filière Bois.',
    tag_slugs: ['institutionnel'],
  },
  {
    name: 'Dominique Cotineau',
    org_name: null,
    title: null,
    photo_file: null,
    topic: 'Enjeux d\'innovation dans la filière bois.',
    bio: 'Intervenant partenaire lors de la 2e édition parisienne des Journées de l\'Innovation Filière Bois.',
    tag_slugs: ['institutionnel'],
  },
];

// =============================================================================
// SEED DATA — Programme
// =============================================================================

// Normandie programme: participants are all organisations (no named persons)
const SEED_PROGRAMME_NORMANDIE = [
  {
    title: 'Accueil Café',
    start_time: '9h00', end_time: '9h30',
    tag_slugs: ['pause'], order: 1,
    intervenant_names: [], org_names: [],
  },
  {
    title: 'Introduction — Pourquoi et Comment Innover',
    start_time: '9h30', end_time: '10h00',
    tag_slugs: ['introduction'], order: 2,
    intervenant_names: [], org_names: ['Xylofutur'],
  },
  {
    title: 'Le financement de l\'innovation',
    start_time: '10h00', end_time: '10h15',
    tag_slugs: ['finance'], order: 3,
    intervenant_names: [], org_names: ['ADN Normandie'],
  },
  {
    title: 'La recherche au service de la filière',
    start_time: '10h15', end_time: '11h00',
    tag_slugs: ['recherche'], order: 4,
    intervenant_names: [], org_names: ['UMR ECODIV', 'HydroXyl-PACT', 'SOLORGA'],
  },
  {
    title: 'Le financement de l\'innovation',
    start_time: '11h00', end_time: '11h15',
    tag_slugs: ['finance'], order: 5,
    intervenant_names: [], org_names: ['BPI France'],
  },
  {
    title: 'Retour d\'expériences d\'entrepreneurs',
    start_time: '11h15', end_time: '12h00',
    tag_slugs: ['temoignages'], order: 6,
    intervenant_names: [], org_names: ['Künkel', 'Linex Panneaux', 'Proxipel'],
  },
  {
    title: 'Le financement de l\'innovation',
    start_time: '12h00', end_time: '12h30',
    tag_slugs: ['finance'], order: 7,
    intervenant_names: [], org_names: ['Lise', 'Forinvest'],
  },
  {
    title: 'Apéritif convivial',
    start_time: '12h30', end_time: '13h00',
    tag_slugs: ['pause'], order: 8,
    intervenant_names: [], org_names: [],
  },
  {
    title: 'Produits et services innovants au service de la construction',
    start_time: '14h30', end_time: '15h30',
    tag_slugs: ['temoignages'], order: 9,
    intervenant_names: [], org_names: ['Kutsh', 'Fibraterre', 'Micao'],
  },
  {
    title: 'Les initiatives collectives et individuelles pour favoriser l\'innovation dans la construction',
    start_time: '15h30', end_time: '16h30',
    tag_slugs: ['actions'], order: 10,
    intervenant_names: [], org_names: ['THN', 'CAP', 'FCBA'],
  },
  {
    title: 'Clôture et temps d\'échanges informels',
    start_time: '16h30', end_time: '17h00',
    tag_slugs: ['cloture'], order: 11,
    intervenant_names: [], org_names: [],
  },
  {
    title: 'Célébration des 2 ans du Pacte Bois et Biosourcés en Normandie',
    start_time: '17h00', end_time: '',
    tag_slugs: [], order: 12,
    intervenant_names: [], org_names: [],
  },
];

// Paris 2025 programme: participants are all persons (intervenants)
const SEED_PROGRAMME_PARIS_2025 = [
  {
    title: 'S\'inspirer : Conférence — Les 4 sources d\'innovation',
    start_time: '9h30', end_time: '11h00',
    tag_slugs: ['introduction'], order: 1,
    intervenant_names: ['Arnaud Groff'], org_names: [],
  },
  {
    title: 'Partager : Retours d\'une démarche d\'innovation',
    start_time: '11h00', end_time: '12h00',
    tag_slugs: ['temoignages'], order: 2,
    intervenant_names: ['Stefano Millefiorini', 'Gaétan Miguet', 'Yann Raoult'], org_names: [],
  },
  {
    title: 'Se projeter : Interventions Partenaires — Quels sont les enjeux d\'innovation dans la filière ?',
    start_time: '12h00', end_time: '12h30',
    tag_slugs: ['finance'], order: 3,
    intervenant_names: ['Céline Beaujolin', 'Jean-Luc Dunoyer', 'Mathieu Ruillet', 'Dominique Cotineau'], org_names: [],
  },
  {
    title: 'Cocktail déjeunatoire & networking',
    start_time: '12h30', end_time: '14h00',
    tag_slugs: ['pause'], order: 4,
    intervenant_names: [], org_names: [],
  },
  {
    title: 'Atelier : Cycle Expérience Client',
    start_time: '14h00', end_time: '16h30',
    tag_slugs: ['actions'], order: 5,
    intervenant_names: ['Arnaud Groff'], org_names: [],
  },
  {
    title: 'Atelier : Océan Bleu — Stratégie et innovation',
    start_time: '14h00', end_time: '16h30',
    tag_slugs: ['actions'], order: 6,
    intervenant_names: ['Cyril Durand'], org_names: [],
  },
  {
    title: 'Atelier : L\'Innovathèque comme support au transfert technologique',
    start_time: '14h00', end_time: '16h30',
    tag_slugs: ['actions'], order: 7,
    intervenant_names: ['Maud Chemin'], org_names: [],
  },
  {
    title: 'Atelier : L\'innovation sur le système productif de la filière',
    start_time: '14h00', end_time: '16h30',
    tag_slugs: ['actions'], order: 8,
    intervenant_names: ['Thomas Vigier'], org_names: [],
  },
  {
    title: 'Atelier : Savoir parler de votre innovation',
    start_time: '14h00', end_time: '16h30',
    tag_slugs: ['actions'], order: 9,
    intervenant_names: ['Lucas De Pedro'], org_names: [],
  },
  {
    title: 'Atelier : Capter et créer de la valeur',
    start_time: '14h00', end_time: '16h30',
    tag_slugs: ['actions'], order: 10,
    intervenant_names: ['Apolline Oswald'], org_names: [],
  },
  {
    title: 'Restitution des ateliers et clôture',
    start_time: '16h30', end_time: '17h00',
    tag_slugs: ['cloture'], order: 11,
    intervenant_names: [], org_names: [],
  },
];

// =============================================================================
// SEED DATA — Editions
// =============================================================================

const SEED_EDITIONS = [
  {
    title: 'Paris 2024',
    year: 2024,
    region: 'ile-de-france',
    date: '2024-11-07',
    city: 'Paris',
    edition_status: 'passee',
    image_file: 'editions/paris-2024.png',
    description: 'Première édition de la Journée de l\'Innovation de la Filière Forêt-Bois. Une journée riche en échanges sur les dernières avancées dans la construction, la bioéconomie, l\'économie circulaire, la gestion forestière et le changement climatique. Conférences, tribunes de start-up et tables rondes.',
    lieux: [
      { name: 'Auditorium Bpifrance', address: '8 Boulevard Haussmann\n75009 Paris', time_slot: 'Journée (9h00 - 17h00)' },
    ],
    partenaire_names: ['BPI France', 'CODIFAB', 'France Bois Forêt', 'PPLA', 'SSPM'],
    video_urls: 'https://youtu.be/W_TDNqg0q7w\nhttps://youtu.be/8dtYBw0LQHw\nhttps://youtu.be/f7x2YFisifk',
    programme_key: null,
  },
  {
    title: 'Paris 2025',
    year: 2025,
    region: 'ile-de-france',
    date: '2025-12-03',
    city: 'Paris',
    edition_status: 'passee',
    image_file: 'editions/paris-2025.png',
    description: 'Deuxième édition parisienne des Journées de l\'Innovation Filière Bois. Une journée 100 % dédiée à l\'innovation dans la filière bois mêlant inspiration, partage d\'expériences et ateliers pratiques, aux côtés d\'experts et d\'acteurs engagés de la filière.',
    lieux: [],
    partenaire_names: ['BPI France', 'CSF Bois', 'DHDA', 'FCBA Innovathèque', 'France Douglas', 'Hors-Site', 'Impulse Partners', 'INRAE Innovation', 'UICB', 'UMB-FFB'],
    video_urls: 'https://youtu.be/L_XZnUGz18w\nhttps://youtu.be/tKlqNtm3SwI\nhttps://youtu.be/RFjQ1TxjBnQ',
    programme_key: 'paris-2025',
  },
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
    partenaire_names: ['Xylofutur', 'Fibois Normandie', 'PUI Normandie', 'Normandie Incubation', 'CODIFAB', 'UICB', 'UMB-FFB'],
    programme_key: 'normandie',
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
    programme_key: null,
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
    programme_key: null,
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
    programme_key: null,
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
      { api: 'tag', actions: ['find', 'findOne'] },
      { api: 'organisation', actions: ['find', 'findOne'] },
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

  strapi.log.info('Seeding data...');

  // -----------------------------------------------------------------------
  // 1. Create Tags -> tagMap[slug]
  // -----------------------------------------------------------------------
  const tagMap = {};
  for (const t of SEED_TAGS) {
    const created = await strapi.documents('api::tag.tag').create({
      data: { name: t.name, slug: t.slug, color: t.color },
      // Tags have draftAndPublish: false, so no status field
    });
    tagMap[t.slug] = created;
  }
  strapi.log.info(`Seeded ${SEED_TAGS.length} tags.`);

  // -----------------------------------------------------------------------
  // 2. Create Organisations -> orgMap[name]
  // -----------------------------------------------------------------------
  const orgMap = {};
  for (const o of SEED_ORGANISATIONS) {
    const { logo_file, tag_slugs, role, ...fields } = o;

    const linkedTags = (tag_slugs || [])
      .map((s) => tagMap[s])
      .filter(Boolean)
      .map((t) => ({ documentId: t.documentId }));

    const created = await strapi.documents('api::organisation.organisation').create({
      data: {
        ...fields,
        slug: slugify(o.name),
        tags: linkedTags,
      },
      status: 'published',
    });
    orgMap[o.name] = created;

    // Upload and attach logo
    if (logo_file) {
      await uploadAndAttach(strapi, logo_file, {
        refId: created.id,
        ref: 'api::organisation.organisation',
        field: 'logo',
      });
    }
  }
  strapi.log.info(`Seeded ${SEED_ORGANISATIONS.length} organisations.`);

  // -----------------------------------------------------------------------
  // 3. Create Partenariats -> partMap[orgName]
  //    DO NOT link editions yet
  // -----------------------------------------------------------------------
  const partMap = {};
  for (const o of SEED_ORGANISATIONS) {
    if (!o.role) continue;

    const org = orgMap[o.name];
    if (!org) continue;

    const roleLabels = { soutien: 'Soutien', 'co-organisateur': 'Co-organisateur', institutionnel: 'Institutionnel', prive: 'Privé' };
    const created = await strapi.documents('api::partenaire.partenaire').create({
      data: {
        display_name: `${o.name} — ${roleLabels[o.role] || o.role}`,
        role: o.role,
        organisation: { documentId: org.documentId },
      },
      status: 'published',
    });
    partMap[o.name] = created;
  }
  strapi.log.info(`Seeded ${Object.keys(partMap).length} partenariats.`);

  // -----------------------------------------------------------------------
  // 4. Create Intervenants (persons) -> intMap[name]
  // -----------------------------------------------------------------------
  const intMap = {};
  for (const i of SEED_INTERVENANTS) {
    const { org_name, photo_file, tag_slugs, ...fields } = i;

    const linkedTags = (tag_slugs || [])
      .map((s) => tagMap[s])
      .filter(Boolean)
      .map((t) => ({ documentId: t.documentId }));

    const data = {
      ...fields,
      slug: slugify(i.name),
      tags: linkedTags,
    };

    if (org_name && orgMap[org_name]) {
      data.organisation = { documentId: orgMap[org_name].documentId };
    }

    const created = await strapi.documents('api::intervenant.intervenant').create({
      data,
      status: 'published',
    });
    intMap[i.name] = created;

    if (photo_file) {
      await uploadAndAttach(strapi, photo_file, {
        refId: created.id,
        ref: 'api::intervenant.intervenant',
        field: 'photo',
      });
    }
  }
  strapi.log.info(`Seeded ${SEED_INTERVENANTS.length} intervenants.`);

  // -----------------------------------------------------------------------
  // 5. Create Editions — link partenariats via partMap[partenaire_names]
  // -----------------------------------------------------------------------
  const programmeByKey = {
    'normandie': SEED_PROGRAMME_NORMANDIE,
    'paris-2025': SEED_PROGRAMME_PARIS_2025,
  };

  for (const edData of SEED_EDITIONS) {
    const { lieux, image_file, partenaire_names, programme_key, ...edFields } = edData;

    const linkedPartenaires = (partenaire_names || [])
      .map((name) => partMap[name])
      .filter(Boolean)
      .map((p) => ({ documentId: p.documentId }));

    const edition = await strapi.documents('api::edition.edition').create({
      data: {
        ...edFields,
        slug: slugify(edFields.title),
        lieux: lieux || [],
        partenaires: linkedPartenaires,
      },
      status: 'published',
    });

    if (image_file) {
      await uploadAndAttach(strapi, image_file, {
        refId: edition.id,
        ref: 'api::edition.edition',
        field: 'image',
      });
    }

    // -----------------------------------------------------------------------
    // 6. Create Programme Items for editions that have one
    // -----------------------------------------------------------------------
    const editionProgramme = programme_key ? programmeByKey[programme_key] : null;
    if (editionProgramme) {
      for (const prog of editionProgramme) {
        const { intervenant_names, org_names, tag_slugs, ...progFields } = prog;

        const linkedIntervenants = (intervenant_names || [])
          .map((name) => intMap[name])
          .filter(Boolean)
          .map((i) => ({ documentId: i.documentId }));

        const linkedOrgs = (org_names || [])
          .map((name) => orgMap[name])
          .filter(Boolean)
          .map((o) => ({ documentId: o.documentId }));

        const linkedTags = (tag_slugs || [])
          .map((s) => tagMap[s])
          .filter(Boolean)
          .map((t) => ({ documentId: t.documentId }));

        await strapi.documents('api::programme-item.programme-item').create({
          data: {
            ...progFields,
            edition: { documentId: edition.documentId },
            intervenants: linkedIntervenants,
            organisations: linkedOrgs,
            tags: linkedTags,
          },
          status: 'published',
        });
      }
      strapi.log.info(`Seeded ${editionProgramme.length} programme items for ${edData.title}.`);
    }

    strapi.log.info(`Seeded edition: ${edData.title}`);
  }

  strapi.log.info('Seed complete!');
}

// =============================================================================
// FRENCH LABELS FOR CONTENT-MANAGER
// =============================================================================

const FRENCH_LABELS = {
  'api::tag.tag': {
    name: 'Nom',
    slug: 'Identifiant URL',
    color: 'Couleur',
    organisations: 'Organisations',
    intervenants: 'Intervenants',
  },
  'api::organisation.organisation': {
    name: 'Nom',
    slug: 'Identifiant URL',
    logo: 'Logo',
    description: 'Description courte',
    long_description: 'Description complète',
    website: 'Site web',
    linkedin_url: 'Profil LinkedIn',
    tags: 'Tags',
    intervenants: 'Intervenants',
    partenariats: 'Partenariats',
    programme_items: 'Interventions au programme',
  },
  'api::intervenant.intervenant': {
    name: 'Nom',
    slug: 'Identifiant URL',
    title: 'Fonction',
    organisation: 'Organisation',
    bio: 'Biographie',
    photo: 'Photo',
    topic: 'Sujet d\'intervention',
    linkedin_url: 'Profil LinkedIn',
    video_url: 'URL de la vidéo',
    long_description: 'Description complète',
    tags: 'Tags',
    programme_items: 'Interventions au programme',
  },
  'api::partenaire.partenaire': {
    display_name: 'Nom affiché',
    role: 'Rôle',
    organisation: 'Organisation',
    editions: 'Éditions associées',
  },
  'api::programme-item.programme-item': {
    title: 'Titre',
    start_time: 'Heure de début',
    end_time: 'Heure de fin',
    description: 'Description',
    tags: 'Tags',
    order: 'Ordre d\'affichage',
    edition: 'Édition',
    intervenants: 'Intervenants',
    organisations: 'Organisations',
  },
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
    partenaires: 'Partenariats',
    gallery: 'Galerie photos',
    video_urls: 'URLs des vidéos',
    summary: 'Bilan / Synthèse',
    testimonials: 'Témoignages',
  },
};

async function setFrenchLabels(strapi) {
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
