import React from "react";
import type { SyncRun } from "../../../lib/espace/admin";
import { timeLabel } from "../../../lib/espace/format";
import { isInfoError } from "./SyncCard";
import type { CardProps } from "./shared";

// Les dix dernières synchronisations HelloAsso.

const runDate = (iso: string) =>
  `${new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" }).format(new Date(iso))}, ${timeLabel(iso)}`;

export default function SyncHistory({ runs }: CardProps & { runs: SyncRun[] }) {
  return (
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
                  <td className="py-2 text-right">{run.endedAt ? run.errors.filter((error) => !isInfoError(error)).length : "en cours"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
