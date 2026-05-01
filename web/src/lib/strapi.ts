import type { Edition, Intervenant, Organisation, Partenaire, ProgrammeItem, Responses, Sequence, Tag } from "./types";

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
  query.set("populate[2]", "partenaires.organisation.logo");
  query.set("sort", "date:asc");
  if (params?.status) query.set("filters[edition_status][$eq]", params.status);
  if (params?.year) query.set("filters[year][$eq]", String(params.year));
  return strapiFetch(`/editions?${query.toString()}`);
};

export const getEditionBySlug = (
  slug: string
): Promise<Responses<Edition>> => {
  const populate = [
    "image",
    "lieux",
    "sequences.interventions.intervenant.photo",
    "sequences.interventions.intervenant.organisation.logo",
    "sequences.interventions.presentation",
    "sequences.tags",
    "sequences.organisations.logo",
    "partenaires.organisation.logo",
    "gallery",
  ];
  const query = populate.map((p, i) => `populate[${i}]=${encodeURIComponent(p)}`).join("&");
  return strapiFetch(`/editions?filters[slug][$eq]=${slug}&${query}`);
};

// --- Intervenants ---

export const getIntervenants = (): Promise<Responses<Intervenant>> =>
  strapiFetch(
    "/intervenants?populate[0]=photo&populate[1]=organisation.logo&populate[2]=tags&populate[3]=interventions.sequence.edition&sort=name:asc"
  );

export const getIntervenantBySlug = (
  slug: string
): Promise<Responses<Intervenant>> =>
  strapiFetch(
    `/intervenants?filters[slug][$eq]=${slug}&populate[0]=photo&populate[1]=organisation.logo&populate[2]=tags&populate[3]=interventions.sequence.edition&populate[4]=interventions.presentation`
  );

// --- Partenaires ---

export const getPartenaires = (params?: {
  role?: string;
}): Promise<Responses<Partenaire>> => {
  const query = new URLSearchParams();
  query.set("populate[0]", "organisation.logo");
  query.set("sort", "organisation.name:asc");
  if (params?.role !== undefined)
    query.set("filters[role][$eq]", params.role);
  return strapiFetch(`/partenaires?${query.toString()}`);
};

// --- Organisations ---

export const getOrganisations = (): Promise<Responses<Organisation>> =>
  strapiFetch("/organisations?populate[0]=logo&populate[1]=tags&sort=name:asc");

export const getOrganisationBySlug = (
  slug: string
): Promise<Responses<Organisation>> =>
  strapiFetch(
    `/organisations?filters[slug][$eq]=${slug}&populate[0]=logo&populate[1]=tags&populate[2]=intervenants.photo&populate[3]=intervenants.interventions.sequence.edition&populate[4]=partenariats.editions`
  );

// --- Tags ---

export const getTags = (): Promise<Responses<Tag>> =>
  strapiFetch("/tags?sort=name:asc");

// --- Programme Items (legacy, kept for compat) ---

export const getProgrammeItems = (
  editionDocumentId: string
): Promise<Responses<ProgrammeItem>> =>
  strapiFetch(
    `/programme-items?filters[edition][documentId][$eq]=${editionDocumentId}&populate[0]=intervenants.photo&populate[1]=organisations.logo&populate[2]=tags&sort=order:asc`
  );

// --- Sequences ---

export const getSequencesForEdition = (
  editionDocumentId: string
): Promise<Responses<Sequence>> => {
  const populate = [
    "interventions.intervenant.photo",
    "interventions.intervenant.organisation.logo",
    "interventions.presentation",
    "tags",
    "organisations.logo",
  ];
  const query = populate.map((p, i) => `populate[${i}]=${encodeURIComponent(p)}`).join("&");
  return strapiFetch(
    `/sequences?filters[edition][documentId][$eq]=${editionDocumentId}&${query}&sort=order:asc`
  );
};

// --- Static Pages ---

export type StaticPage = {
  slug: string;
  title: string;
  hero_subtitle?: string;
  body: string;
  meta_description?: string;
};

export const getStaticPageBySlug = async (slug: string): Promise<StaticPage | null> => {
  try {
    const res = await strapiFetch(`/static-pages?filters[slug][$eq]=${slug}`);
    return res?.data?.[0] ?? null;
  } catch {
    return null;
  }
};
