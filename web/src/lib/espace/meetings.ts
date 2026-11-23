// Rendez-vous de l'espace participant (E5, E6) : types des réponses de l'API, appels, textes d'erreur, heures de Paris.
// Contrat : docs/espace/journal/phase-2-plan.md, section 3.2. Le front n'applique aucune règle de R-10 à R-19 : il affiche
// l'état calculé par le serveur (`state`, `can*`, `blocked`). Sans variable d'environnement : utilisable dans le navigateur
// comme dans le rendu serveur, l'adresse de Strapi vient en paramètre.
import { EspaceApiError, request, type ProfileCard } from "./client";

const TIME_ZONE = "Europe/Paris";

export type MeetingStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";

export type Meeting = {
  id: string;
  status: MeetingStatus;
  slot: { id: string; label: string; startsAt: string; endsAt: string; sessionTitle: string | null };
  location: string | null;
  counterpart: ProfileCard;
  direction: "sent" | "received";
  /** Le visiteur répond au nom de son exposant. */
  viaExhibitor: { id: string; name: string; standNumber: string | number | null } | null;
  message: string | null;
  answeredByName: string | null;
  createdAt: string;
  canAccept: boolean;
  canDecline: boolean;
  canCounter: boolean;
  canCancel: boolean;
};

export type SlotState = "available" | "unavailable" | "requested" | "confirmed";

export type SlotsResponse = {
  /** `request` : demande à valider, `booking` : réservation d'une table dédiée (R-19), `stand` : stand d'un exposant. */
  mode: "request" | "booking" | "stand";
  window: { state: "open" | "not_open" | "closed"; openAt: string | null; closeAt: string | null };
  blocked: null | { code: "SELF" | "TARGET_UNAVAILABLE" | "WINDOW_CLOSED" | "HOST_AT_TABLE"; message: string };
  pending: null | { meetingId: string; slotLabel: string };
  groups: {
    session: { id: string; title: string; start: string | null; end: string | null };
    slots: { id: string; label: string; startsAt: string; state: SlotState }[];
  }[];
};

export type AgendaSession = {
  type: "session";
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  startsAt: string;
  endsAt: string | null;
  kind: string;
};

export type AgendaItem = AgendaSession | { type: "meeting"; startsAt: string; meeting: Meeting };

export type MeetingsResponse = {
  received: Meeting[];
  sent: Meeting[];
  agenda: AgendaItem[];
  closed: Meeting[];
};

/** `GET /directory/p/:id` (E5) : la carte plus les champs de la fiche. Jamais d'e-mail (R-42). */
export type DirectoryPerson = ProfileCard & {
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  company: string | null;
  bio: string | null;
  /** Page LinkedIn, seulement sur une fiche complète (D-09). */
  linkedinUrl?: string | null;
  /** Séquences de l'intervenant, heures du programme en texte (« 11h15 »). */
  sessions: { title: string; start: string | null; end: string | null }[];
  exhibitor: { id: string; name: string; standNumber?: string | number | null } | null;
  isSelf: boolean;
  canMessage: boolean;
};

/** `GET /directory/x/:id` (E5) : la carte de l'exposant plus sa fiche, avec ses représentants visibles. */
export type DirectoryExhibitor = ProfileCard & {
  description: string | null;
  website: string | null;
  representatives: ProfileCard[];
  isMine: boolean;
};

/** Échecs d'une création ou d'une contre-proposition qui rendent la grille périmée : elle est rechargée (F-56). */
const STALE_SLOT_CODES = ["SLOT_TAKEN", "TARGET_BUSY", "NO_TABLE_LEFT", "SLOT_PAST"];

export const isStaleSlotError = (error: unknown): boolean => error instanceof EspaceApiError && STALE_SLOT_CODES.includes(error.code);

/** Texte affichable d'un échec : `error.message` vient du serveur, en français, et s'affiche tel quel (F-115). */
export function meetingErrorMessage(error: unknown, fallback = "L’opération a échoué. Vérifiez votre connexion et réessayez."): string {
  return (error instanceof EspaceApiError && error.message) || fallback;
}

/** Heure de Paris « 10h45 » d'un instant ISO ; une heure déjà lisible (« 10h45 », « 9h ») est rendue telle quelle. */
export function hourLabel(value: string | null | undefined): string {
  if (!value) return "";
  if (/^\d{1,2}h\d{0,2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("fr-FR", { hour: "numeric", minute: "2-digit", hourCycle: "h23", timeZone: TIME_ZONE }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${Number(part("hour"))}h${part("minute")}`;
}

/** « jeudi 3 décembre » d'une date d'édition (« 2026-12-03 », sans heure), ou null. */
export function dayLabelOf(date: string | null | undefined): string | null {
  const day = date ? new Date(`${date}T12:00:00Z`) : null;
  if (!day || Number.isNaN(day.getTime())) return null;
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: TIME_ZONE }).format(day);
}

/** « 10h45 à 11h15 », ou « 10h45 » sans fin. */
export const hourRange = (start: string | null | undefined, end: string | null | undefined): string =>
  end ? `${hourLabel(start)} à ${hourLabel(end)}` : hourLabel(start);

/** Premier mot du nom affiché d'une personne (« Inès Castaing » donne « Inès ») ; un exposant garde son nom entier. */
export const firstName = (card: Pick<ProfileCard, "kind" | "displayName">): string =>
  card.kind === "attendee" ? card.displayName.split(" ")[0] : card.displayName;

/** Cible d'une carte pour `/slots`, `/meetings` et l'URL de la fiche : `p:{id}` ou `x:{id}`. */
export const targetOf = (card: Pick<ProfileCard, "kind" | "id">): string => `${card.kind === "exhibitor" ? "x" : "p"}:${card.id}`;

/** Segment d'URL de la fiche d'une carte de l'annuaire : `p` personne, `x` exposant, `i` intervenant du programme sans compte (D-06). */
export const pathTypeOf = (card: Pick<ProfileCard, "kind">): "p" | "x" | "i" => (card.kind === "exhibitor" ? "x" : card.kind === "intervenant" ? "i" : "p");

export const fetchSlots = (strapiUrl: string, target: string) =>
  request<SlotsResponse>(strapiUrl, `/slots?target=${encodeURIComponent(target)}`, "GET", undefined);

export const createMeeting = (strapiUrl: string, body: { slotId: string; target: string; message?: string }) =>
  request<Meeting>(strapiUrl, "/meetings", "POST", body);

export const fetchMeetings = (strapiUrl: string) => request<MeetingsResponse>(strapiUrl, "/meetings", "GET", undefined);

export const acceptMeeting = (strapiUrl: string, id: string) =>
  request<Meeting>(strapiUrl, `/meetings/${encodeURIComponent(id)}/accept`, "POST", {});

export const declineMeeting = (strapiUrl: string, id: string) =>
  request<Meeting>(strapiUrl, `/meetings/${encodeURIComponent(id)}/decline`, "POST", {});

export const counterMeeting = (strapiUrl: string, id: string, body: { slotId: string; message?: string }) =>
  request<Meeting>(strapiUrl, `/meetings/${encodeURIComponent(id)}/counter`, "POST", body);

export const cancelMeeting = (strapiUrl: string, id: string) =>
  request<Meeting>(strapiUrl, `/meetings/${encodeURIComponent(id)}/cancel`, "POST", {});

/** Adresse de l'export .ics des rendez-vous acceptés et des séquences (F-65, I-40) : un lien, le navigateur télécharge. */
export const calendarUrl = (strapiUrl: string): string => `${strapiUrl}/api/espace/meetings.ics`;

export type RequestWindow = { state: "open" | "not_open" | "closed"; openAt: string | null; closeAt: string | null };

/**
 * F-111 : fenêtre des demandes d'une édition (`GET /editions/:slug`), même règle que le serveur (R-17) : une ouverture vide est
 * ouverte sans borne basse, une fermeture vide est la veille de l'édition à 18h00 à Paris.
 */
export function requestWindow(
  edition: { date: string | null; meetingRequestsOpenAt?: string | null; meetingRequestsCloseAt?: string | null },
  now: Date = new Date(),
): RequestWindow {
  const eve = edition.date ? Date.parse(`${edition.date}T00:00:00Z`) - 86_400_000 : NaN;
  const eveClosing = [16, 17].map((hour) => new Date(eve + hour * 3_600_000)).find((date) => !Number.isNaN(+date) && hourLabel(date.toISOString()) === "18h00");
  const openAt = edition.meetingRequestsOpenAt ?? null;
  const closeAt = edition.meetingRequestsCloseAt ?? eveClosing?.toISOString() ?? null;
  const state = closeAt && now.getTime() >= Date.parse(closeAt) ? "closed" : openAt && now.getTime() < Date.parse(openAt) ? "not_open" : "open";
  return { state, openAt, closeAt };
}

/** « jeudi 26 novembre à 9h00 » d'un instant ISO, heure de Paris. */
function dateAndHour(iso: string): string {
  const day = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: TIME_ZONE }).format(new Date(iso));
  return `${day} à ${hourLabel(iso)}`;
}

/** F-111 : texte de la fenêtre fermée (avant l'ouverture ou après la fermeture), ou null quand elle est ouverte ou sans date. */
export function windowLabel(window: RequestWindow): string | null {
  if (window.state === "not_open" && window.openAt) return `Les demandes ouvrent le ${dateAndHour(window.openAt)}.`;
  if (window.state === "closed" && window.closeAt) return `Les demandes sont closes depuis le ${dateAndHour(window.closeAt)}.`;
  return null;
}

/** F-114 : « En cours », « À venir » ou « Passés » d'un rendez-vous, selon l'heure de son créneau. */
export const PHASES = ["now", "next", "past"] as const;
export const PHASE_TITLE = { now: "En cours", next: "À venir", past: "Passés" };
export function phaseOf(meeting: Pick<Meeting, "slot">, now: number): (typeof PHASES)[number] {
  return now >= Date.parse(meeting.slot.endsAt) ? "past" : now >= Date.parse(meeting.slot.startsAt) ? "now" : "next";
}
