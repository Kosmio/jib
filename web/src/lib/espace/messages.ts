// Messagerie de l'espace participant (E7) : types de l'API, appels du navigateur et mise en forme des fils.
// Contrat : docs/espace/journal/phase-2-plan.md, sections 3.2 (routes `/conversations`) et A-37. Fonctions de mise en forme pures.
import { request, type ProfileCard } from "./client";
import { timeLabel } from "./format";

/** Rendez-vous confirmé de la paire, calculé par le serveur (A-37) : `slotLabel` est déjà lisible (« jeudi 3 décembre à 10h45 »). */
export type LinkedMeeting = { id: string; slotLabel: string; location: string | null };

/** Une ligne de `GET /conversations`, dernier message d'abord. */
export type ConversationSummary = {
  id: string;
  counterpart: ProfileCard;
  lastMessage: { excerpt: string; at: string; mine: boolean };
  unread: number;
  meeting: LinkedMeeting | null;
};

export type ThreadMessage = { id: string; body: string; at: string; mine: boolean; readAt: string | null };

/** `GET /conversations/:id/messages` : le fil, dont les messages reçus sont marqués lus par cet appel (R-63 : jamais ailleurs). */
export type Thread = {
  conversation: { id: string; counterpart: ProfileCard; meeting: LinkedMeeting | null; counterpartGetsEmail: boolean };
  messages: ThreadMessage[];
};

/** F-72 : 2 000 caractères au plus, compteur visible au-delà de 1 800. */
export const MESSAGE_MAX_LENGTH = 2000;
export const MESSAGE_COUNTER_FROM = 1800;

/** Délai d'interrogation d'un fil ouvert (F-71, A-37). */
export const POLL_INTERVAL_MS = 20_000;

/** Cible d'une nouvelle conversation, `p:{documentId}` (A-37) : l'identifiant du paramètre `avec`, ou null s'il est mal formé. */
export function parseTarget(text: string | null): string | null {
  return text && /^p:[A-Za-z0-9_-]+$/.test(text) ? text : null;
}

const enc = encodeURIComponent;

/** Le fil entier à chaque interrogation : « Lu » se met à jour sur des messages anciens, qu'un `after=` ne renverrait pas. */
export const getThread = (baseUrl: string, conversationId: string) =>
  request<Thread>(baseUrl, `/conversations/${enc(conversationId)}/messages`, "GET");

/** POST /conversations : 200 pour la conversation existante, 201 pour la nouvelle ; 403 TARGET_UNAVAILABLE (R-61). */
export const openConversation = (baseUrl: string, target: string) =>
  request<{ id: string }>(baseUrl, "/conversations", "POST", { with: target });

/** POST /conversations/:id/messages : 400 VALIDATION (vide, plus de 2 000), 429 RATE_LIMITED (R-64). */
export const postMessage = (baseUrl: string, conversationId: string, body: string) =>
  request<ThreadMessage>(baseUrl, `/conversations/${enc(conversationId)}/messages`, "POST", { body });

const TIME_ZONE = "Europe/Paris";

const dayKey = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** Jour de Paris d'un message, « 2026-11-17 » : deux messages du même jour portent la même clé. */
export const messageDay = dayKey;

/** Séparateur de jour d'un fil : « Aujourd’hui », sinon « Mardi 17 novembre » (l'année s'ajoute hors de l'année en cours). */
export function dayHeading(iso: string, now: Date = new Date()): string {
  const today = dayKey(now.toISOString());
  if (dayKey(iso) === today) return "Aujourd’hui";
  const sameYear = dayKey(iso).slice(0, 4) === today.slice(0, 4);
  const label = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(!sameYear && { year: "numeric" }),
    timeZone: TIME_ZONE,
  }).format(new Date(iso));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Repère de temps d'une ligne de la liste : l'heure pour un message du jour (« 14h40 »), sinon le jour (« 17 nov. »). */
export function listTime(iso: string, now: Date = new Date()): string {
  if (dayKey(iso) === dayKey(now.toISOString())) return timeLabel(iso);
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: TIME_ZONE }).format(new Date(iso));
}
