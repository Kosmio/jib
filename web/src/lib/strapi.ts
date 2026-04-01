import type { Edition, Intervenant, Partenaire, ProgrammeItem, Responses } from "./types";

const strapiUrl = import.meta.env.STRAPI_URL || process.env.STRAPI_URL;
const reactStrapiUrl = import.meta.env.REACT_STRAPI_URL || process.env.REACT_STRAPI_URL;

export const buildImageUrl = (baseUrl: string) =>
  `${reactStrapiUrl}${baseUrl}`;

const strapiFetch = (targetUrl: string) =>
  fetch(`${strapiUrl}/api${targetUrl}`).then((res) =>
    res.json()
  );

// Client-side fetch helpers (for React components)
const clientFetch = (url: string, targetUrl: string) =>
  fetch(`${url}/api${targetUrl}`).then((res) => res.json());

export const clientBuildImageUrl = (url: string, baseUrl: string) =>
  `${url}${baseUrl}`;

// --- Editions ---

export const getEditions = (params?: {
  status?: string;
  year?: number;
}): Promise<Responses<Edition>> => {
  const query = new URLSearchParams();
  query.set("populate[0]", "image");
  query.set("populate[1]", "lieux");
  query.set("populate[2]", "partenaires.logo");
  query.set("sort", "date:asc");
  if (params?.status) query.set("filters[edition_status][$eq]", params.status);
  if (params?.year) query.set("filters[year][$eq]", String(params.year));
  return strapiFetch(`/editions?${query.toString()}`);
};

export const getEditionBySlug = (
  slug: string
): Promise<Responses<Edition>> =>
  strapiFetch(
    `/editions?filters[slug][$eq]=${slug}&populate[0]=image&populate[1]=lieux&populate[2]=programme_items.intervenants.photo&populate[3]=partenaires.logo&populate[4]=gallery`
  );

// --- Intervenants ---

export const getIntervenants = (): Promise<Responses<Intervenant>> =>
  strapiFetch("/intervenants?populate[0]=photo&populate[1]=partenaire.logo&sort=name:asc");

export const getIntervenantBySlug = (
  slug: string
): Promise<Responses<Intervenant>> =>
  strapiFetch(
    `/intervenants?filters[slug][$eq]=${slug}&populate[0]=photo&populate[1]=partenaire.logo&populate[2]=programme_items.edition`
  );

// --- Partenaires ---

export const getPartenaires = (params?: {
  is_global?: boolean;
}): Promise<Responses<Partenaire>> => {
  const query = new URLSearchParams();
  query.set("populate[0]", "logo");
  query.set("sort", "name:asc");
  if (params?.is_global !== undefined)
    query.set("filters[is_global][$eq]", String(params.is_global));
  return strapiFetch(`/partenaires?${query.toString()}`);
};

// --- Programme Items ---

export const getProgrammeItems = (
  editionDocumentId: string
): Promise<Responses<ProgrammeItem>> =>
  strapiFetch(
    `/programme-items?filters[edition][documentId][$eq]=${editionDocumentId}&populate[0]=intervenants.photo&sort=order:asc`
  );
