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

export const onRequest = defineMiddleware(async (context, next) => {
  if (!isEspace(context.url.pathname)) return next();

  const response = await next();
  response.headers.set("Content-Security-Policy", contentSecurityPolicy(context.url));
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", referrerPolicy(context.url.pathname));
  // Pages propres à la session de la personne : jamais mises en cache, ni par le navigateur ni par un relais.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});
