// Mise en forme des pages de l'espace participant : dates en français (Europe/Paris, fuseau explicite),
// couleur d'édition, édition déduite d'un chemin. Fonctions pures.
import type { EspaceEdition } from "./api";

const TIME_ZONE = "Europe/Paris";
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
// Blanc sur la couleur d'édition doit atteindre 4,5:1 (NF-30), soit une luminance relative d'au plus 0,18.
const MAX_LUMINANCE = 0.18;

function luminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Couleur d'édition utilisable en fond de bandeau sous du texte blanc, ou null (le bandeau prend alors `bg-title`). */
export function bannerColor(themeColor: string | null | undefined): string | null {
  return themeColor && HEX_COLOR.test(themeColor) && luminance(themeColor) <= MAX_LUMINANCE ? themeColor : null;
}

/** Date de l'édition (sans heure, « 2026-12-03 ») : « jeudi 3 décembre », avec l'année si demandée. */
function dayLabel(date: string | null, withYear: boolean): string | null {
  const day = date ? new Date(`${date}T12:00:00Z`) : null;
  if (!day || Number.isNaN(day.getTime())) return null;
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(withYear && { year: "numeric" }),
    timeZone: TIME_ZONE,
  }).format(day);
}

/** Sous-titre d'E0 et de la vérification : « Préparez vos rencontres de la journée du jeudi 3 décembre à Bordeaux. » */
export function meetingsSubtitle(edition: Pick<EspaceEdition, "date" | "city"> | null): string {
  const day = dayLabel(edition?.date ?? null, false);
  const city = edition?.city;
  return `Préparez vos rencontres de la journée${day ? ` du ${day}` : ""}${city ? ` à ${city}` : ""}.`;
}

/** Date et ville de l'édition (E1) : « Jeudi 3 décembre 2026 à Bordeaux ». */
export function editionLine(edition: Pick<EspaceEdition, "date" | "city">): string {
  const day = dayLabel(edition.date, true);
  return [day && day.charAt(0).toUpperCase() + day.slice(1), edition.city && `à ${edition.city}`].filter(Boolean).join(" ");
}

/** Slug d'édition d'un chemin `/espace/{slug}/…` (paramètre `next` de la vérification), ou null. */
export function editionSlugFromPath(path: string | null): string | null {
  return path?.match(/^\/espace\/([^/?#]+)\//)?.[1] ?? null;
}
