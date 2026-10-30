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

/** Réponse de l'API, lue : `data` pour un succès, `error` (forme de 06-api.md) pour tout statut d'erreur. */
export type EspaceResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: { code: string; message: string; fields?: Record<string, string> } };

const get = (path: string, headers?: HeadersInit) =>
  fetch(`${strapiUrl}/api/espace${path}`, { headers, signal: AbortSignal.timeout(8000) });

/**
 * GET d'une route de l'API depuis le rendu serveur ; `path` commence par `/` (« /directory?type=all »), `cookie` est l'en-tête
 * `Cookie` de la requête de la page (null pour une route publique). Ne lève que si Strapi ne répond pas : une réponse d'erreur
 * (401, 404…) est rendue dans `error`, à la page d'en décider (redirection, `Astro.rewrite`, repli).
 */
export async function espaceGet<T>(path: string, cookie: string | null): Promise<EspaceResult<T>> {
  const response = await get(path, cookie ? { cookie } : undefined);
  const body = await response.json().catch(() => null);
  if (response.ok) return { ok: true, status: response.status, data: body as T };
  return {
    ok: false,
    status: response.status,
    error: { code: body?.error?.code ?? "UNKNOWN", message: body?.error?.message ?? "", fields: body?.error?.fields },
  };
}

/** Édition publiée, ou null si elle est absente ou non publiée (404). Toute autre réponse d'erreur remonte. */
export async function getEdition(slug: string): Promise<EspaceEdition | null> {
  const result = await espaceGet<EspaceEdition>(`/editions/${encodeURIComponent(slug)}`, null);
  if (result.ok) return result.data;
  if (result.status === 404) return null;
  throw new Error(`GET /editions/${slug} : ${result.status}`);
}

/** Édition dont l'espace est ouvert : absente, non publiée ou fermée, la page répond 404 (NF-52). */
export async function getOpenEdition(slug: string): Promise<EspaceEdition | null> {
  const edition = await getEdition(slug);
  return edition?.participantSpaceEnabled ? edition : null;
}

/** Profil de la session du navigateur (`Cookie` relayé), ou null sans session valable (401). Avec `counts` (A-36). */
export async function getMe(cookie: string | null): Promise<Me | null> {
  if (!cookie) return null;
  const result = await espaceGet<Me>("/me", cookie);
  if (result.ok) return result.data;
  if (result.status === 401) return null;
  throw new Error(`GET /me : ${result.status}`);
}

/**
 * Garde commune des pages de l'espace avec session : à appeler en tête de page, puis
 *   `if ("redirect" in guard) return Astro.redirect(guard.redirect);`
 *   `if ("notFound" in guard) return Astro.rewrite("/espace/introuvable");`
 * Édition absente ou fermée : `notFound`. Sans session valable pour cette édition : E0. Sans consentement enregistré : E2
 * (sauf `consent: false`, pour E2 lui-même).
 */
export type EspaceGuard = { edition: EspaceEdition; me: Me } | { redirect: string } | { notFound: true };

export async function guardSession(slug: string, cookie: string | null, { consent = true } = {}): Promise<EspaceGuard> {
  const edition = await getOpenEdition(slug);
  if (!edition) return { notFound: true };
  const base = `/espace/${encodeURIComponent(slug)}`;
  const me = await getMe(cookie);
  if (me?.edition.slug !== slug) return { redirect: `${base}/connexion` };
  if (consent && !me.consent.consentAt) return { redirect: `${base}/bienvenue` };
  return { edition, me };
}

export async function getLinkState(token: string): Promise<LinkState> {
  const result = await espaceGet<LinkState>(`/auth/link?token=${encodeURIComponent(token)}`, null);
  if (!result.ok) throw new Error(`GET /auth/link : ${result.status}`);
  return result.data;
}
