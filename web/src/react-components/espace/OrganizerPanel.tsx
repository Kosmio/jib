import React, { useEffect, useState } from "react";
import {
  agoLabel,
  getStats,
  getSyncRuns,
  groupSlots,
  normalizeWarning,
  percent,
  runSync,
  type Stats,
  type SyncRun,
} from "../../lib/espace/admin";
import { EspaceApiError } from "../../lib/espace/client";
import { plural, timeLabel } from "../../lib/espace/format";

// E9, tableau de bord organisateur (F-90) : synchronisation HelloAsso, indicateurs, remplissage par pause B2B, exposants les plus
// sollicités, avertissements, historique. Les chiffres viennent de `GET /admin/{edition}/stats` ; aucun contenu de message (R-63).
// Les exports CSV (F-91) et la relance manuelle (F-92) viennent après la recette du 30 octobre.

type Props = {
  /** REACT_STRAPI_URL : adresse publique de Strapi, atteinte par le navigateur. */
  strapiUrl: string;
  editionSlug: string;
  /** Instant du rendu serveur : l'ancienneté de la synchronisation s'affiche pareil au serveur et à l'hydratation. */
  nowIso: string;
  /** Couleur d'édition déjà validée (`bannerColor`) pour les barres, ou null (`bg-title`). */
  themeColor: string | null;
  initialStats: Stats;
  initialRuns: SyncRun[];
};

/** Libellés des codes de `SyncRun.errors` (06-api.md), au singulier et au pluriel : « 2 billets sans adresse e-mail valable ». */
const SYNC_ERROR_LABELS: Record<string, [string, string]> = {
  DUPLICATE_EMAIL: ["adresse e-mail déjà utilisée par un autre inscrit", "adresses e-mail déjà utilisées par d’autres inscrits"],
  EMAIL_TAKEN: ["adresse e-mail déjà utilisée par un autre inscrit", "adresses e-mail déjà utilisées par d’autres inscrits"],
  INVALID_EMAIL: ["billet sans adresse e-mail valable", "billets sans adresse e-mail valable"],
  WAITING: ["billet en attente, ignoré", "billets en attente, ignorés"],
  UNKNOWN: ["billet à l’état inconnu, ignoré", "billets à l’état inconnu, ignorés"],
  APPLY_FAILED: ["billet dont l’enregistrement a échoué", "billets dont l’enregistrement a échoué"],
  FETCH_FAILED: ["échec de la lecture de HelloAsso", "échecs de la lecture de HelloAsso"],
  HELLOASSO_NOT_CONFIGURED: ["configuration HelloAsso absente pour cette édition", "configurations HelloAsso absentes pour cette édition"],
  INTERNAL: ["erreur inattendue", "erreurs inattendues"],
};

/** Libellés de repli des avertissements des statistiques (A-29) : le serveur fournit en général son propre `message`, qui nomme la personne. */
const WARNING_LABELS: Record<string, string> = {
  HOSTED_TABLE_CONFLICT: "Deux intervenants ont la même table dédiée\u00a0: seul le premier inscrit la garde, l’autre est ignoré.",
  HOSTED_TABLE_INVALID: "Une table dédiée est hors des tables de l’édition ou n’est pas portée par un intervenant\u00a0: elle est ignorée.",
};

const SYNC_FAILED = "La synchronisation a échoué. Vérifiez votre connexion et réessayez.";
const LOAD_FAILED = "Les chiffres n’ont pas pu être actualisés. Rechargez la page.";

const number = (value: number) => value.toLocaleString("fr-FR");
const percentLabel = (value: number) => `${value} %`;

function Icon({ name }: { name: "alert" | "check" | "refresh" }) {
  return (
    <svg
      aria-hidden="true"
      className="size-5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "refresh" && <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" />}
      {name !== "refresh" && <circle cx="12" cy="12" r="9" />}
      {name === "alert" && <path d="M12 8v5M12 16.5h.01" />}
      {name === "check" && <path d="m8.5 12.5 2.5 2.5 4.5-5" />}
    </svg>
  );
}

function Card({ heading, children, className = "" }: { heading: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-surface-alt bg-white p-6 ${className}`}>
      <h2 className="font-heading text-xl font-semibold normal-case">{heading}</h2>
      {children}
    </section>
  );
}

function Indicator({ label, value, lines }: { label: string; value: string; lines: string[] }) {
  return (
    <li className="rounded-xl border border-surface-alt bg-white p-5">
      <h3 className="font-heading font-semibold">{label}</h3>
      <p className="mt-1 font-heading text-4xl font-semibold text-title">{value}</p>
      {lines.map((line) => (
        <p key={line} className="mt-1 text-muted">
          {line}
        </p>
      ))}
    </li>
  );
}

function syncSummary(run: SyncRun): { kind: "alert" | "status"; text: string } {
  if (run.errors.some(({ code }) => code === "HELLOASSO_NOT_CONFIGURED")) {
    return { kind: "alert", text: "HelloAsso n’est pas configuré pour cette édition. Renseignez son formulaire HelloAsso dans Strapi." };
  }
  const counts = `${plural(run.created, "inscrit créé", "inscrits créés")}, ${run.updated} mis à jour, ${plural(run.cancelled, "annulé")}`;
  return run.errors.length
    ? { kind: "alert", text: `Synchronisation terminée avec ${plural(run.errors.length, "erreur")}\u00a0: ${counts}.` }
    : { kind: "status", text: `Synchronisation terminée\u00a0: ${counts}.` };
}

/** Erreurs d'un SyncRun regroupées par code : « 2 billets sans adresse e-mail valable ». */
function errorLines(run: SyncRun): string[] {
  const counts = new Map<string, number>();
  for (const { code } of run.errors) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts].map(([code, count]) => {
    const [one, many] = SYNC_ERROR_LABELS[code] ?? [code, code];
    return plural(count, one, many);
  });
}

const runDate = (iso: string) =>
  `${new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" }).format(new Date(iso))}, ${timeLabel(iso)}`;

export default function OrganizerPanel({ strapiUrl, editionSlug, nowIso, themeColor, initialStats, initialRuns }: Props) {
  const [stats, setStats] = useState(initialStats);
  const [runs, setRuns] = useState(initialRuns);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<{ kind: "alert" | "status"; text: string } | null>(null);
  const [now, setNow] = useState(() => new Date(nowIso));

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  async function synchronize() {
    if (syncing) return;
    setSyncing(true);
    setNotice(null);
    let run: SyncRun;
    try {
      run = await runSync(strapiUrl, editionSlug);
    } catch (failure) {
      setSyncing(false);
      if (failure instanceof EspaceApiError && failure.status === 401) {
        window.location.assign(`/espace/${encodeURIComponent(editionSlug)}/connexion`);
        return;
      }
      setNotice({ kind: "alert", text: (failure instanceof EspaceApiError && failure.status !== 0 && failure.message) || SYNC_FAILED });
      return;
    }
    try {
      const [freshStats, freshRuns] = await Promise.all([getStats(strapiUrl, editionSlug), getSyncRuns(strapiUrl, editionSlug)]);
      setStats(freshStats);
      setRuns(freshRuns);
      setNotice(syncSummary(run));
    } catch {
      setNotice({ kind: "alert", text: `${syncSummary(run).text} ${LOAD_FAILED}` });
    }
    setSyncing(false);
  }

  const { attendees, meetings, lastSync } = stats;
  const byRole = attendees.byRole ?? {};
  const closed = meetings.declined + meetings.cancelled + meetings.expired;
  const groups = groupSlots(stats.slots);
  const tables = [...new Set(stats.slots.map((slot) => slot.tables))];
  const warnings = stats.warnings.map(normalizeWarning);
  const lastErrors = lastSync ? errorLines(lastSync) : [];
  const acceptedColor = themeColor ? { backgroundColor: themeColor } : undefined;

  return (
    <div className="space-y-6">
      <section aria-labelledby="synchronisation" className="rounded-xl border border-surface-alt bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 id="synchronisation" className="flex items-center gap-2 font-heading text-xl font-semibold normal-case">
              <span className="text-primary-ink">
                <Icon name="refresh" />
              </span>
              {lastSync
                ? lastSync.endedAt
                  ? `HelloAsso synchronisé ${agoLabel(lastSync.endedAt, now)}`
                  : "Synchronisation en cours"
                : "HelloAsso n’a pas encore été synchronisé"}
            </h2>
            <p className="mt-1 text-muted">Les inscrits sont importés toutes les 15&nbsp;minutes, ou à la demande.</p>
          </div>
          <button
            type="button"
            onClick={synchronize}
            disabled={syncing}
            aria-busy={syncing}
            className="inline-flex min-h-13 items-center justify-center rounded-lg bg-gold px-6 text-lg font-bold text-gold-ink shadow-md shadow-gold/25 hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60"
          >
            {syncing ? "Synchronisation en cours…" : "Synchroniser maintenant"}
          </button>
        </div>

        <div role="status" className="empty:hidden">
          {notice?.kind === "status" && (
            <p className="mt-4 flex items-start gap-3 rounded-lg bg-surface p-3 font-semibold">
              <span className="text-primary-ink">
                <Icon name="check" />
              </span>
              {notice.text}
            </p>
          )}
        </div>
        {notice?.kind === "alert" && (
          <p role="alert" className="mt-4 flex items-start gap-3 rounded-lg border-2 border-danger bg-white p-3 font-semibold">
            <span className="text-danger">
              <Icon name="alert" />
            </span>
            {notice.text}
          </p>
        )}
        {lastErrors.length > 0 && (
          <div className="mt-4">
            <h3 className="font-semibold">Erreurs de la dernière synchronisation</h3>
            <ul className="mt-1 list-disc pl-5 text-muted">
              {lastErrors.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <ul className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Indicator
          label="Inscrits importés"
          value={number(attendees.active)}
          lines={[
            `dont ${plural(byRole.exhibitor_rep ?? 0, "représentant d’exposant", "représentants d’exposants")} et ${plural(byRole.speaker ?? 0, "intervenant")}`,
            ...(attendees.cancelled ? [plural(attendees.cancelled, "inscription annulée", "inscriptions annulées")] : []),
          ]}
        />
        <Indicator
          label="Espaces activés"
          value={number(stats.activated)}
          lines={[
            `sur ${plural(attendees.active, "inscrit")} (${percentLabel(percent(stats.activated, attendees.active))})`,
            `${plural(stats.consented, "choix de visibilité enregistré", "choix de visibilité enregistrés")}`,
          ]}
        />
        <Indicator
          label="Profils complets"
          value={percentLabel(percent(stats.profilesComplete, attendees.active))}
          lines={[`${plural(stats.profilesComplete, "profil")} sur ${number(attendees.active)}`]}
        />
        <Indicator
          label="Annuaire"
          value={number(stats.directoryOptIn)}
          lines={[`${stats.directoryOptIn < 2 ? "participant visible" : "participants visibles"} dans l’annuaire`]}
        />
        <Indicator
          label="Rendez-vous"
          value={number(meetings.accepted + meetings.pending)}
          lines={[
            `${plural(meetings.accepted, "accepté")}, ${plural(meetings.pending, "en attente", "en attente")}`,
            ...(closed ? [`${plural(closed, "refusé, annulé ou expiré", "refusés, annulés ou expirés")}`] : []),
          ]}
        />
        <Indicator label="Messages" value={number(stats.messages)} lines={["messages échangés"]} />
      </ul>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card heading="Rendez-vous par pause B2B">
          {groups.length === 0 ? (
            <p className="mt-4 text-muted">Aucun créneau B2B pour cette édition.</p>
          ) : (
            <>
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className={`size-3 ${themeColor ? "" : "bg-title"}`} style={acceptedColor} />
                  Acceptés
                </span>
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="size-3 bg-wood" />
                  En attente
                </span>
              </p>
              <ul className="mt-4 space-y-5">
                {groups.map((group, index) => {
                  const requests = group.accepted + group.pending;
                  const acceptedShare = percent(group.accepted, group.capacity);
                  const pendingShare = Math.min(percent(group.pending, group.capacity), 100 - acceptedShare);
                  return (
                    <li key={`${group.firstLabel}-${index}`}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                        <h3 className="font-heading font-semibold">
                          {group.title}, {group.firstLabel} ({plural(group.slots, "créneau", "créneaux")})
                        </h3>
                        <p className="text-muted">{plural(requests, "demande")}</p>
                      </div>
                      <div className="mt-2 flex h-4 gap-0.5 overflow-hidden rounded-lg bg-surface-alt">
                        <span
                          className={`block h-full ${themeColor ? "" : "bg-title"}`}
                          style={{ width: `${acceptedShare}%`, ...acceptedColor }}
                        />
                        <span className="block h-full bg-wood" style={{ width: `${pendingShare}%` }} />
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        {plural(group.accepted, "accepté")}, {group.pending} en attente, capacité de {plural(group.capacity, "rendez-vous", "rendez-vous")}
                      </p>
                    </li>
                  );
                })}
              </ul>
              {tables.length === 1 && (
                <p className="mt-4 text-muted">Capacité de {plural(tables[0], "table")} par créneau.</p>
              )}
            </>
          )}
        </Card>

        <Card heading="Exposants les plus sollicités">
          {stats.topExhibitors.length === 0 ? (
            <p className="mt-4 text-muted">Aucune demande à un exposant pour l’instant.</p>
          ) : (
            <table className="mt-4 w-full text-left">
              <thead>
                <tr className="border-b border-surface-alt text-muted">
                  <th scope="col" className="pb-2 font-semibold">
                    Exposant
                  </th>
                  <th scope="col" className="pb-2 text-right font-semibold">
                    Demandes
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.topExhibitors.map((exhibitor) => (
                  <tr key={exhibitor.id} className="border-b border-surface-alt last:border-0">
                    <th scope="row" className="py-3 pr-4 font-semibold">
                      {exhibitor.name}
                      {exhibitor.standNumber != null && exhibitor.standNumber !== "" && (
                        <span className="block text-sm font-normal text-muted">Stand {exhibitor.standNumber}</span>
                      )}
                    </th>
                    <td className="py-3 text-right font-heading text-xl font-semibold text-title">{number(exhibitor.requests)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card heading="Avertissements">
        {warnings.length === 0 ? (
          <p className="mt-4 flex items-center gap-3 text-muted">
            <span className="text-primary-ink">
              <Icon name="check" />
            </span>
            Aucun avertissement.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`} className="flex items-start gap-3">
                <span className="text-danger">
                  <Icon name="alert" />
                </span>
                {warning.message || WARNING_LABELS[warning.code] || warning.code}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <details className="rounded-xl border border-surface-alt bg-white p-6">
        <summary className="cursor-pointer font-heading text-xl font-semibold">
          Historique des synchronisations ({runs.length})
        </summary>
        {runs.length === 0 ? (
          <p className="mt-4 text-muted">Aucune synchronisation enregistrée.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left">
              <caption className="sr-only">Les dix dernières synchronisations HelloAsso, la plus récente en premier</caption>
              <thead>
                <tr className="border-b border-surface-alt text-muted">
                  <th scope="col" className="pr-4 pb-2 font-semibold">
                    Début
                  </th>
                  <th scope="col" className="pr-4 pb-2 text-right font-semibold">
                    Créés
                  </th>
                  <th scope="col" className="pr-4 pb-2 text-right font-semibold">
                    Mis à jour
                  </th>
                  <th scope="col" className="pr-4 pb-2 text-right font-semibold">
                    Annulés
                  </th>
                  <th scope="col" className="pb-2 text-right font-semibold">
                    Erreurs
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b border-surface-alt last:border-0">
                    <th scope="row" className="py-2 pr-4 font-semibold whitespace-nowrap">
                      <time dateTime={run.startedAt}>{runDate(run.startedAt)}</time>
                    </th>
                    <td className="py-2 pr-4 text-right">{run.created}</td>
                    <td className="py-2 pr-4 text-right">{run.updated}</td>
                    <td className="py-2 pr-4 text-right">{run.cancelled}</td>
                    <td className="py-2 text-right">{run.endedAt ? run.errors.length : "en cours"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </div>
  );
}
