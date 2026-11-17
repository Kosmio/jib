import { defineMiddleware } from "astro:middleware";
import { publicStrapiUrl } from "./lib/espace/api";

// NF-07 : en-têtes de sécurité des pages de l'espace participant, et d'elles seules. Ailleurs, la requête passe sans être touchée.
// CSP sans aucune origine tierce. L'option `security.csp` d'Astro 6 s'applique à tout le site, pages publiques comprises (Matomo,
// Google Fonts) : elle est écartée. Les scripts de page d'Astro (îlot d'E2) sont en ligne, d'où `'unsafe-inline'`.
// Strapi est atteint par le navigateur : les formulaires lui sont envoyés (`form-action`) et l'îlot d'E2 l'appelle (`connect-src`).
// `style-src` admet l'attribut `style` du bandeau, dont la couleur vient de Strapi.
// `img-src` : les photos de profil sont servies par Strapi (`/uploads`), l'aperçu d'une photo recadrée est un `blob:` (A-35).
function contentSecurityPolicy(siteUrl: URL): string {
  const strapi = new URL(publicStrapiUrl || "/", siteUrl).origin;
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${strapi}`,
    "font-src 'self'",
    `connect-src 'self' ${strapi}`,
    `form-action 'self' ${strapi}`,
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const isEspace = (pathname: string) => pathname === "/espace" || pathname.startsWith("/espace/");

// A-24 : le jeton du lien d'accès est dans l'URL de /espace/verifier. Sur la même origine (dev serveur et prod, Strapi sous /strapi),
// `strict-origin-when-cross-origin` enverrait l'URL complète en Referer, que Traefik journalise : `strict-origin` n'envoie que l'origine.
// Jamais `no-referrer` : le navigateur enverrait `Origin: null` avec le POST du formulaire, et Strapi le refuserait (ORIGIN_REFUSED).
const referrerPolicy = (pathname: string) =>
  /^\/espace\/verifier\/?$/.test(pathname) ? "strict-origin" : "strict-origin-when-cross-origin";

// F-107, NF-50 : un délai ou une erreur réseau vers Strapi donne 503, toute autre exception 500. Les erreurs de `fetch` (Node) portent
// le code réseau dans `cause` ; api.ts signale un délai par `AbortSignal.timeout` (TimeoutError) et un échec de Strapi par « : 502 ».
const NETWORK_CODES = /^(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|UND_ERR_.*)$/;
function isUnavailable(error: unknown): boolean {
  const e = error as { name?: string; message?: string; code?: string; cause?: { code?: string } } | null;
  if (!e) return false;
  if (e.name === "TimeoutError" || e.name === "AbortError") return true;
  if (e.name === "TypeError" && /fetch failed/i.test(e.message ?? "")) return true;
  if (NETWORK_CODES.test(e.code ?? "") || NETWORK_CODES.test(e.cause?.code ?? "")) return true;
  return /: (502|503|504)$/.test(e.message ?? "");
}

// L'édition est lue dans l'URL, sans appel réseau ; les trois pages sans édition ne comptent pas.
function editionOf(pathname: string): string | null {
  const slug = pathname.split("/")[2];
  if (!slug || ["verifier", "introuvable", "erreur"].includes(slug)) return null;
  try {
    return decodeURIComponent(slug);
  } catch {
    return null;
  }
}

function secure(response: Response, url: URL): Response {
  response.headers.set("Content-Security-Policy", contentSecurityPolicy(url));
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", referrerPolicy(url.pathname));
  // Pages propres à la session de la personne : jamais mises en cache, ni par le navigateur ni par un relais.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const onRequest = defineMiddleware(async (context, next) => {
  if (!isEspace(context.url.pathname)) return next();

  // Une réécriture (introuvable, erreur) fait perdre `Astro.params` : l'édition de l'URL d'origine voyage par `locals`.
  const edition = editionOf(context.url.pathname);
  Object.assign(context.locals, { espaceEdition: edition });

  let response: Response;
  try {
    response = await next();
  } catch (error) {
    const requestId = crypto.randomUUID().slice(0, 8);
    const status = isUnavailable(error) ? 503 : 500;
    const err = error as Error | null;
    console.error(
      JSON.stringify({ level: "error", requestId, status, method: context.request.method, path: context.url.pathname, error: err?.message ?? String(error), stack: err?.stack }),
    );
    try {
      Object.assign(context.locals, { espaceError: { status, requestId, edition } });
      response = await context.rewrite("/espace/erreur");
    } catch {
      // La page d'erreur elle-même a échoué : réponse minimale, sans trace.
      response = new Response("Un incident empêche d’afficher cette page. Identifiant : " + requestId, {
        status,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  }
  return secure(response, context.url);
});
