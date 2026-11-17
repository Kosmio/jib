import React, { useEffect, useState } from "react";
import { agoLabel, runSync, type SyncRun } from "../../../lib/espace/admin";
import { EspaceApiError } from "../../../lib/espace/client";
import { plural } from "../../../lib/espace/format";
import { FeedbackArea, Icon, LOAD_FAILED, type CardProps, type Feedback } from "./shared";

// Synchronisation HelloAsso (F-90) : état de la dernière exécution, bouton manuel, erreurs de la dernière exécution.

type Props = CardProps & {
  lastSync: SyncRun | null;
  /** Instant du rendu serveur : l'ancienneté s'affiche pareil au serveur et à l'hydratation. */
  nowIso: string;
  /** Relit les statistiques et l'historique ; rejette si la lecture échoue. */
  onRefresh: () => Promise<void>;
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

const SYNC_FAILED = "La synchronisation a échoué. Vérifiez votre connexion et réessayez.";

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

export default function SyncCard({ edition: editionSlug, strapiUrl, lastSync, nowIso, onRefresh }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<Feedback | null>(null);
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
      await onRefresh();
      setNotice(syncSummary(run));
    } catch {
      setNotice({ kind: "alert", text: `${syncSummary(run).text} ${LOAD_FAILED}` });
    }
    setSyncing(false);
  }

  const lastErrors = lastSync ? errorLines(lastSync) : [];

  return (
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

      <FeedbackArea feedback={notice} />
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
  );
}
