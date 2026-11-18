// Interface organisation (15-administration.md) : garde commune des pages de `/espace/{edition}/organisateur/*`, onglets (F-153)
// et liens vers la fiche Strapi de chaque objet (F-154, F-184).
import type { AstroGlobal } from "astro";
import { guardSession, type EspaceEdition } from "./api";
import type { Me } from "./client";

export type OrganizerTab = "pilotage" | "edition" | "programme" | "personnes" | "b2b" | "aide";

/** Onglets, dans l'ordre (F-153) ; `readOnly` : encore ouvert sur une édition terminée. */
export const ORGANIZER_TABS: { id: OrganizerTab; label: string; path: string; readOnly: boolean }[] = [
  { id: "pilotage", label: "Pilotage", path: "", readOnly: true },
  { id: "edition", label: "Édition", path: "/edition", readOnly: false },
  { id: "programme", label: "Programme", path: "/programme", readOnly: false },
  { id: "personnes", label: "Personnes", path: "/personnes", readOnly: false },
  { id: "b2b", label: "Vue B2B", path: "/b2b", readOnly: true },
  { id: "aide", label: "Aide", path: "/aide", readOnly: true },
];

export type OrganizerPage =
  | { kind: "page"; edition: EspaceEdition; me: Me; slug: string; base: string; cookie: string | null }
  | { kind: "refused"; edition: EspaceEdition; me: Me; slug: string; base: string }
  | { kind: "response"; response: Response };

/**
 * Garde d'une page organisateur : redirection vers la connexion, page introuvable, 403 pour un non-organisateur ; sur une
 * édition en lecture seule, un onglet d'écriture renvoie au pilotage (F-153).
 */
export async function organizerPage(Astro: AstroGlobal, tab: OrganizerTab): Promise<OrganizerPage> {
  const slug = Astro.params.edition ?? "";
  const cookie = Astro.request.headers.get("cookie");
  const guard = await guardSession(slug, cookie, { pilotage: true });
  if ("redirect" in guard) return { kind: "response", response: Astro.redirect(guard.redirect) };
  if ("notFound" in guard) return { kind: "response", response: await Astro.rewrite("/espace/introuvable") };
  const base = `/espace/${encodeURIComponent(slug)}`;
  if (!guard.me.isOrganizer) {
    Astro.response.status = 403;
    return { kind: "refused", edition: guard.edition, me: guard.me, slug, base };
  }
  if (guard.edition.readOnly && !ORGANIZER_TABS.find(({ id }) => id === tab)?.readOnly) {
    return { kind: "response", response: Astro.redirect(`${base}/organisateur`) };
  }
  return { kind: "page", edition: guard.edition, me: guard.me, slug, base, cookie };
}

export { STRAPI_UID, strapiAdminUrl } from "./strapi-links";
