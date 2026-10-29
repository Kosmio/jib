// Appels de l'API de l'espace participant depuis le rendu serveur des pages Astro (frontmatter).
// STRAPI_URL ne sert qu'ici, côté serveur ; le navigateur reçoit REACT_STRAPI_URL (formulaires et îlots).
// La session est un cookie posé et lu par Strapi seul : le rendu serveur relaie l'en-tête `Cookie` du navigateur.
import type { Me } from "./client";

const strapiUrl = import.meta.env.STRAPI_URL || process.env.STRAPI_URL;

/** Adresse publique de Strapi, celle que le navigateur atteint (action des formulaires, appels des îlots). */
export const publicStrapiUrl: string = import.meta.env.REACT_STRAPI_URL || process.env.REACT_STRAPI_URL;

export type EspaceEdition = {
  slug: string;
  title: string;
  date: string | null;
  city: string | null;
  themeColor: string | null;
  participantSpaceEnabled: boolean;
};

/** A-18 : état d'un lien de connexion, sans le consommer. L'adresse n'est renvoyée que pour un lien connu mais inutilisable. */
export type LinkState = { valid: boolean; editionSlug?: string; email?: string };

const get = (path: string, headers?: HeadersInit) =>
  fetch(`${strapiUrl}/api/espace${path}`, { headers, signal: AbortSignal.timeout(8000) });

/** Édition publiée, ou null si elle est absente ou non publiée (404). Toute autre réponse d'erreur remonte. */
export async function getEdition(slug: string): Promise<EspaceEdition | null> {
  const response = await get(`/editions/${encodeURIComponent(slug)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GET /editions/${slug} : ${response.status}`);
  return response.json();
}

/** Édition dont l'espace est ouvert : absente, non publiée ou fermée, la page répond 404 (NF-52). */
export async function getOpenEdition(slug: string): Promise<EspaceEdition | null> {
  const edition = await getEdition(slug);
  return edition?.participantSpaceEnabled ? edition : null;
}

/** Profil de la session du navigateur (`Cookie` relayé), ou null sans session valable (401). */
export async function getMe(cookie: string | null): Promise<Me | null> {
  if (!cookie) return null;
  const response = await get("/me", { cookie });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`GET /me : ${response.status}`);
  return response.json();
}

export async function getLinkState(token: string): Promise<LinkState> {
  const response = await get(`/auth/link?token=${encodeURIComponent(token)}`);
  if (!response.ok) throw new Error(`GET /auth/link : ${response.status}`);
  return response.json();
}
