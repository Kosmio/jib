// Manifeste de l'application installable (phase 3, F-05, NF-24, T-45) : un par édition, car `start_url` ouvre l'accueil de l'édition
// (sans session, E0 prend le relais). Il couvre tout `/espace/` : la vérification du lien et les autres éditions restent dans l'application.
// Les couleurs de la charte (07-design.md) sont recopiées ici une seule fois : un manifeste n'a pas de variables CSS. Les icônes sont
// celles du site, `favicon-192.png` et son agrandissement `espace/icon-512.png`.
import type { APIRoute } from "astro";
import { getOpenEdition } from "../../../lib/espace/api";
import { bannerColor } from "../../../lib/espace/format";

const TITLE_COLOR = "#325062";
const SURFACE_COLOR = "#f5f0eb";

export const GET: APIRoute = async ({ params }) => {
  const slug = params.edition ?? "";
  const edition = await getOpenEdition(slug);
  if (!edition) return new Response(null, { status: 404 });

  const start = `/espace/${encodeURIComponent(slug)}/`;
  const manifest = {
    id: start,
    name: "Journées de l’Innovation Filière Bois",
    short_name: "JIB",
    description: "Espace participant : profil, annuaire, rendez-vous B2B, messages et programme.",
    lang: "fr",
    start_url: start,
    scope: "/espace/",
    display: "standalone",
    background_color: SURFACE_COLOR,
    theme_color: bannerColor(edition.themeColor) ?? TITLE_COLOR,
    icons: [
      { src: "/assets/favicon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/espace/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };

  return new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/manifest+json; charset=utf-8" } });
};
