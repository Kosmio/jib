import React, { useEffect, useState } from "react";
import { agoLabel, getServiceStatus, getSyncRuns, runSync, type SyncError, type SyncRun } from "../../../lib/espace/admin";
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

/** F-121 : cas attendus, une information repliée ; tout autre code (doublon, lecture, erreur interne…) est une erreur, en rouge. */
const INFO_CODES = ["WAITING", "UNKNOWN", "ERASED"];
export const isInfoError = ({ code }: SyncError) => INFO_CODES.includes(code);

/** F-120 : une exécution est en échec quand elle n'a rien pu lire ou n'a pas pu s'exécuter, pas quand quelques billets sont refusés. */
const FAILURE_CODES = ["FETCH_FAILED", "INTERNAL", "HELLOASSO_NOT_CONFIGURED"];
const isFailure = (run: SyncRun) => run.errors.some(({ code }) => FAILURE_CODES.includes(code));

const HOUR_MS = 3_600_000;

/** Erreur de `SyncRun.errors` (06-api.md) avec le nom de l'inscrit qui tient déjà l'adresse, ajouté par le serveur (F-121). */
type SyncErrorRow = SyncError & { holderName?: string };

/** Libellés des codes de `SyncRun.errors` (06-api.md), au singulier et au pluriel, pour les informations : « 2 billets en attente, ignorés ». */
const INFO_LABELS: Record<string, [string, string]> = {
  WAITING: ["billet en attente, ignoré", "billets en attente, ignorés"],
  UNKNOWN: ["billet à l’état inconnu, ignoré", "billets à l’état inconnu, ignorés"],
  ERASED: ["billet effacé à la demande, ignoré", "billets effacés à la demande, ignorés"],
};

/** Motif en français et action attendue d'une erreur, par code. */
function describeError(error: SyncErrorRow): { reason: string; action: string } {
  const holder = error.holderName ? ` par ${error.holderName}` : " par un autre inscrit";
  switch (error.code) {
    case "DUPLICATE_EMAIL":
    case "EMAIL_TAKEN":
      return {
        reason: `Adresse e-mail déjà utilisée${holder}.`,
        action: "Faites corriger l’adresse sur HelloAsso s’il s’agit d’une autre personne, sinon ignorez ce billet en doublon.",
      };
    case "INVALID_EMAIL":
      return { reason: "Billet sans adresse e-mail valable.", action: "Complétez l’adresse e-mail du billet sur HelloAsso, puis synchronisez de nouveau." };
    case "APPLY_FAILED":
      return { reason: "L’enregistrement du billet a échoué.", action: "Synchronisez de nouveau. Si l’erreur revient, contactez Kosmio." };
    case "FETCH_FAILED":
      return {
        reason: `La lecture de HelloAsso a échoué${error.status ? ` (code ${error.status})` : ""}.`,
        action: "Synchronisez de nouveau dans quelques minutes. Si l’erreur revient, vérifiez les accès HelloAsso de l’édition.",
      };
    case "HELLOASSO_NOT_CONFIGURED":
      return { reason: "La configuration HelloAsso est absente pour cette édition.", action: "Renseignez le formulaire HelloAsso de l’édition dans Strapi." };
    case "INTERNAL":
      return { reason: "Erreur inattendue pendant la synchronisation.", action: "Synchronisez de nouveau. Si l’erreur revient, contactez Kosmio." };
    default:
      return { reason: `Erreur ${error.code}.`, action: "Contactez Kosmio." };
  }
}

const SYNC_FAILED = "La synchronisation a échoué. Vérifiez votre connexion et réessayez.";

function syncSummary(run: SyncRun): { kind: "alert" | "status"; text: string } {
  if (run.errors.some(({ code }) => code === "HELLOASSO_NOT_CONFIGURED")) {
    return { kind: "alert", text: "HelloAsso n’est pas configuré pour cette édition. Renseignez son formulaire HelloAsso dans Strapi." };
  }
  const counts = `${plural(run.created, "inscrit créé", "inscrits créés")}, ${run.updated} mis à jour, ${plural(run.cancelled, "annulé")}`;
  const problems = run.errors.filter((error) => !isInfoError(error)).length;
  return problems
    ? { kind: "alert", text: `Synchronisation terminée avec ${plural(problems, "erreur")}\u00a0: ${counts}.` }
    : { kind: "status", text: `Synchronisation terminée\u00a0: ${counts}.` };
}

/** Informations (cas attendus) regroupées par code, avec les numéros de billet : « 2 billets en attente, ignorés (n° 12, 15) ». */
function infoLines(errors: SyncError[]): string[] {
  const groups = new Map<string, string[]>();
  for (const { code, itemId } of errors.filter(isInfoError)) groups.set(code, [...(groups.get(code) ?? []), ...(itemId ? [itemId] : [])]);
  return [...groups].map(([code, ids]) => {
    const [one, many] = INFO_LABELS[code];
    const count = errors.filter((error) => error.code === code).length;
    return `${plural(count, one, many)}${ids.length ? ` (n°\u00a0${ids.join(", ")})` : ""}`;
  });
}

export default function SyncCard({ edition: editionSlug, strapiUrl, lastSync, nowIso, onRefresh }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<Feedback | null>(null);
  const [now, setNow] = useState(() => new Date(nowIso));
  // F-120 : dernière réussite (parmi les dix dernières exécutions) et état des tâches planifiées ; null tant que non lus.
  const [recent, setRecent] = useState<SyncRun[] | null>(null);
  const [cronEnabled, setCronEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    getServiceStatus(strapiUrl, editionSlug).then(
      ({ cron }) => setCronEnabled(cron.enabled),
      () => setCronEnabled(null),
    );
  }, [strapiUrl, editionSlug]);

  useEffect(() => {
    getSyncRuns(strapiUrl, editionSlug).then(setRecent, () => setRecent(null));
  }, [strapiUrl, editionSlug, lastSync?.id, lastSync?.endedAt]);

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

  const failed = Boolean(lastSync?.endedAt && isFailure(lastSync));
  const problems = (lastSync?.errors ?? []).filter((error) => !isInfoError(error)) as SyncErrorRow[];
  const infos = infoLines(lastSync?.errors ?? []);

  // F-120 : tâches planifiées actives et aucune réussite depuis plus d'une heure.
  const lastSuccess = (recent ?? []).find((run) => run.endedAt && !isFailure(run));
  const stale = cronEnabled === true && recent !== null && recent.length > 0 && (!lastSuccess || now.getTime() - new Date(lastSuccess.endedAt as string).getTime() > HOUR_MS);

  return (
    <section aria-labelledby="synchronisation" className="rounded-xl border border-surface-alt bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2
            id="synchronisation"
            className={`flex items-center gap-2 font-heading text-xl font-semibold normal-case ${failed ? "text-danger" : ""}`}
          >
            <span className={failed ? "" : "text-primary-ink"}>
              <Icon name={failed ? "alert" : "refresh"} />
            </span>
            {lastSync
              ? lastSync.endedAt
                ? failed
                  ? `Dernière synchronisation en échec ${agoLabel(lastSync.endedAt, now)}`
                  : `HelloAsso synchronisé ${agoLabel(lastSync.endedAt, now)}`
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
      {stale && (
        <p data-testid="sync-stale" className="mt-4 flex items-start gap-3 rounded-lg border-2 border-danger bg-white p-3 font-semibold">
          <span className="text-danger">
            <Icon name="alert" />
          </span>
          {lastSuccess
            ? `Dernière synchronisation réussie\u00a0: ${agoLabel(lastSuccess.endedAt as string, now)}. Les tâches planifiées sont actives, elle devrait avoir lieu toutes les 15\u00a0minutes. Vérifiez la configuration HelloAsso.`
            : "Aucune synchronisation réussie parmi les dernières exécutions, alors que les tâches planifiées sont actives. Vérifiez la configuration HelloAsso."}
        </p>
      )}
      {problems.length > 0 && (
        <div className="mt-4">
          <h3 className="font-semibold">{`Erreurs de la dernière synchronisation (${problems.length})`}</h3>
          <ul className="mt-2 space-y-2">
            {problems.map((error, index) => {
              const { reason, action } = describeError(error);
              return (
                <li key={`${error.code}-${error.itemId ?? index}-${index}`} className="rounded-lg border border-danger bg-white p-3">
                  <p className="flex items-start gap-3 font-semibold text-danger">
                    <Icon name="alert" />
                    <span className="min-w-0 break-words">
                      {error.itemId ? `Billet n°\u00a0${error.itemId}` : "Synchronisation"}
                      {error.email ? <span className="font-normal text-ink">{`, ${error.email}`}</span> : null}
                    </span>
                  </p>
                  <p className="mt-1 pl-8">{reason}</p>
                  <p className="pl-8 text-muted">{`À faire\u00a0: ${action}`}</p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {infos.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer font-semibold text-title">{`Informations (${infos.length})`}</summary>
          <ul className="mt-1 list-disc pl-5 text-muted">
            {infos.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
