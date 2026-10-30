// Tableau de bord organisateur (E9) : types de l'API, appels du navigateur et regroupements d'affichage.
// Contrat : docs/espace/journal/phase-2-plan.md, section 3.2 (`/admin/{edition}/stats`) et 06-api.md (synchronisation HelloAsso).
// Aucune route ne renvoie le contenu d'un message : les indicateurs ne portent que des nombres (R-63).
import { request } from "./client";

/** `SyncRun.errors` (06-api.md) : `code` est l'un de ceux listés dans `SYNC_ERROR_LABELS` du panneau. */
export type SyncError = { itemId?: string; code: string; email?: string; attendeeDocumentId?: string; status?: number | null };

export type SyncRun = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  created: number;
  updated: number;
  cancelled: number;
  errors: SyncError[];
};

/** Avertissement des statistiques (A-29 : `HOSTED_TABLE_CONFLICT`, `HOSTED_TABLE_INVALID`) ; `message` quand le serveur en fournit un. */
export type StatsWarning = { code: string; message?: string };

export type SlotFill = { sessionTitle: string; label: string; accepted: number; pending: number; tables: number };

export type Stats = {
  attendees: { total: number; active: number; cancelled: number; byRole: Record<string, number> };
  activated: number;
  consented: number;
  directoryOptIn: number;
  profilesComplete: number;
  meetings: { pending: number; accepted: number; declined: number; cancelled: number; expired: number };
  messages: number;
  slots: SlotFill[];
  topExhibitors: { id: string; name: string; requests: number; standNumber?: string | number | null }[];
  warnings: (StatsWarning | string)[];
  lastSync: SyncRun | null;
};

const enc = encodeURIComponent;

export const getStats = (baseUrl: string, editionSlug: string) => request<Stats>(baseUrl, `/admin/${enc(editionSlug)}/stats`, "GET");

export const getSyncRuns = (baseUrl: string, editionSlug: string) =>
  request<SyncRun[]>(baseUrl, `/admin/${enc(editionSlug)}/sync-runs`, "GET");

/** POST /admin/{edition}/sync : attend la fin et rend le SyncRun clos ; 409 SYNC_RUNNING si une synchronisation est en cours. */
export const runSync = (baseUrl: string, editionSlug: string) => request<SyncRun>(baseUrl, `/admin/${enc(editionSlug)}/sync`, "POST");

/** Un avertissement du serveur, qu'il soit un code seul ou un objet. */
export const normalizeWarning = (warning: StatsWarning | string): StatsWarning =>
  typeof warning === "string" ? { code: warning } : warning;

export type SlotGroup = { title: string; firstLabel: string; slots: number; accepted: number; pending: number; capacity: number };

const labelMinutes = (label: string) => {
  const match = /^(\d{1,2})h(\d{2})?$/.exec(label);
  return match ? Number(match[1]) * 60 + Number(match[2] ?? 0) : Number.POSITIVE_INFINITY;
};

/**
 * Remplissage par pause B2B : les créneaux, triés sur l'heure, se regroupent tant que le titre de la séance reste le même.
 * Deux pauses de même titre (« Pause et B2B » à 10h45 et à 15h30) restent séparées par la séance qui les sépare.
 * Capacité d'un groupe = somme des tables de ses créneaux (un rendez-vous occupe une table pendant un créneau).
 */
export function groupSlots(slots: SlotFill[]): SlotGroup[] {
  const groups: SlotGroup[] = [];
  for (const slot of [...slots].sort((a, b) => labelMinutes(a.label) - labelMinutes(b.label))) {
    const last = groups.at(-1);
    if (last && last.title === slot.sessionTitle) {
      last.slots += 1;
      last.accepted += slot.accepted;
      last.pending += slot.pending;
      last.capacity += slot.tables;
    } else {
      groups.push({
        title: slot.sessionTitle,
        firstLabel: slot.label,
        slots: 1,
        accepted: slot.accepted,
        pending: slot.pending,
        capacity: slot.tables,
      });
    }
  }
  return groups;
}

/** Part d'un total, en pourcentage entier, bornée à [0, 100] ; 0 si le total est nul. */
export const percent = (part: number, total: number) => (total > 0 ? Math.min(100, Math.max(0, Math.round((part / total) * 100))) : 0);

/** « à l’instant », « il y a 4 min », « il y a 3 h », « il y a 2 j » : ancienneté d'un instant ISO. */
export function agoLabel(iso: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes}\u00a0min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours}\u00a0h`;
  return `il y a ${Math.floor(hours / 24)}\u00a0j`;
}
