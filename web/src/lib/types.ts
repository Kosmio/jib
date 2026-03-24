export interface Entity {
  id: number;
  documentId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  locale?: string;
}

export interface Response<T extends Entity> {
  data: T;
  meta: any;
}

export interface Responses<T extends Entity> {
  data: T[];
  meta: {
    pagination?: {
      page: number;
      pageSize: number;
      pageCount: number;
      total: number;
    };
  };
}

export interface Image {
  id: number;
  url: string;
  alternativeText: string | null;
  width: number;
  height: number;
  formats?: Record<string, { url: string; width: number; height: number }>;
}

export interface Lieu {
  id: number;
  name: string;
  address: string;
  description: string | null;
  map_url: string | null;
  time_slot: string | null;
}

export interface Intervenant extends Entity {
  name: string;
  slug: string;
  title: string | null;
  organization: string;
  bio: string | null;
  photo: Image | null;
  topic: string | null;
  linkedin_url: string | null;
  programme_items?: ProgrammeItem[];
}

export interface Partenaire extends Entity {
  name: string;
  slug: string;
  logo: Image | null;
  description: string | null;
  website: string | null;
  category: 'soutien' | 'coorganisateur' | 'institutionnel' | 'prive';
  is_global: boolean;
  editions?: Edition[];
}

export interface ProgrammeItem extends Entity {
  title: string;
  start_time: string;
  end_time: string;
  description: string | null;
  category: 'introduction' | 'finance' | 'recherche' | 'temoignages' | 'actions' | 'pause' | 'cloture' | null;
  order: number | null;
  edition?: Edition;
  intervenants?: Intervenant[];
}

export type Region =
  | 'normandie' | 'region-sud' | 'nouvelle-aquitaine' | 'auvergne-rhone-alpes'
  | 'ile-de-france' | 'bretagne' | 'occitanie' | 'grand-est'
  | 'hauts-de-france' | 'pays-de-la-loire' | 'bourgogne-franche-comte'
  | 'centre-val-de-loire' | 'corse';

export const regionLabels: Record<Region, string> = {
  'normandie': 'Normandie',
  'region-sud': 'Région Sud',
  'nouvelle-aquitaine': 'Nouvelle-Aquitaine',
  'auvergne-rhone-alpes': 'Auvergne-Rhône-Alpes',
  'ile-de-france': 'Île-de-France',
  'bretagne': 'Bretagne',
  'occitanie': 'Occitanie',
  'grand-est': 'Grand Est',
  'hauts-de-france': 'Hauts-de-France',
  'pays-de-la-loire': 'Pays de la Loire',
  'bourgogne-franche-comte': 'Bourgogne-Franche-Comté',
  'centre-val-de-loire': 'Centre-Val de Loire',
  'corse': 'Corse',
};

export interface Edition extends Entity {
  title: string;
  slug: string;
  year: number;
  region: Region;
  date: string;
  city: string;
  status: 'upcoming' | 'open' | 'full' | 'past';
  description: string | null;
  inscription_url: string | null;
  image: Image | null;
  lieux: Lieu[];
  programme_items?: ProgrammeItem[];
  partenaires?: Partenaire[];
  gallery: Image[];
  video_urls: string | null;
  summary: string | null;
  testimonials: string | null;
}
