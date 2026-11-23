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

/** Adresse d'une photo : `photoUrl` est le chemin d'Upload (`/uploads/…`), à préfixer par l'adresse publique de Strapi. */
export function photoSrc(strapiUrl: string, photoUrl: string | null | undefined): string | null {
  if (!photoUrl) return null;
  return /^(https?:|blob:|data:)/.test(photoUrl) ? photoUrl : `${strapiUrl}${photoUrl}`;
}

/** Initiales d'une personne : « Léa Ducasse » donne « LD ». */
export function initialsOf(firstName: string, lastName: string): string {
  return `${firstName.trim().charAt(0)}${lastName.trim().charAt(0)}`.toUpperCase();
}

/** Jour calendaire de Paris d'un instant, « 2026-12-03 ». */
export function parisDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Jours calendaires de Paris entre `now` et la date d'une édition (« 2026-12-03 ») : positif avant, 0 le jour J, négatif après. */
export function daysUntil(date: string, now: Date = new Date()): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${parisDay(now)}T00:00:00Z`)) / 86_400_000);
}

export type Countdown = { state: "before" | "today" | "after"; label: string };

/** F-20 : « J-16 », « Aujourd’hui » le jour J, puis « Merci de votre participation ». Null sans date d'édition. */
export function countdown(date: string | null, now: Date = new Date()): Countdown | null {
  if (!date || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return null;
  const days = daysUntil(date, now);
  if (days > 0) return { state: "before", label: `J-${days}` };
  if (days === 0) return { state: "today", label: "Aujourd’hui" };
  return { state: "after", label: "Merci de votre participation" };
}

/** Heure de Paris d'un instant ISO, à la française : « 10h45 », « 9h05 ». */
export function timeLabel(iso: string): string {
  const parts = new Intl.DateTimeFormat("fr-FR", { hour: "numeric", minute: "2-digit", hourCycle: "h23", timeZone: TIME_ZONE }).formatToParts(
    new Date(iso),
  );
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("hour")}h${part("minute")}`;
}

/** « 1 profil », « 5 profils » : accord au pluriel, zéro au singulier. */
export function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count < 2 ? one : many}`;
}
