import React, { useEffect, useState } from "react";
import { EspaceApiError, request } from "../../../lib/espace/client";
import { Card, FeedbackArea, LOAD_FAILED, type CardProps, type Feedback } from "./shared";

// F-75, R-63 : les messages signalés par les participants. Chaque signalement donne l'auteur du signalement, la personne signalée,
// la date, le motif et le seul texte du message signalé. Routes : GET /reports, POST /reports/{id}/handle, sous /admin/{edition}.

type Report = {
  id: string;
  status: "open" | "handled";
  at: string;
  handledAt: string | null;
  reason: string;
  reporter: { name: string };
  reported: { name: string };
  message: { body: string | null };
};
type Reports = { open: Report[]; handled: Report[] };

const ACTION_FAILED = "L’action a échoué. Vérifiez votre connexion et réessayez.";
const enc = encodeURIComponent;

const dateLabel = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

function ReportItem({ report, busy, onHandle }: { report: Report; busy: boolean; onHandle?: () => void }) {
  return (
    <li className="rounded-lg border border-surface-alt p-4">
      <p className="font-semibold">
        {report.reporter.name} a signalé un message de {report.reported.name}
      </p>
      <p className="text-sm text-muted">
        <time dateTime={report.at}>{dateLabel(report.at)}</time>
        {report.handledAt && (
          <>
            {" · "}traité le <time dateTime={report.handledAt}>{dateLabel(report.handledAt)}</time>
          </>
        )}
      </p>
      <p className="mt-3">
        <span className="font-semibold">Motif{" "}: </span>
        <span className="break-words whitespace-pre-wrap">{report.reason}</span>
      </p>
      <blockquote className="mt-3 rounded-lg bg-surface p-3 break-words whitespace-pre-wrap">
        {report.message.body ?? "Message supprimé."}
      </blockquote>
      {onHandle && (
        <button
          type="button"
          onClick={onHandle}
          disabled={busy}
          className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-title bg-white px-4 font-bold text-title hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
        >
          Marquer comme traité<span className="sr-only"> : signalement de {report.reporter.name}</span>
        </button>
      )}
    </li>
  );
}

export default function ReportsCard({ edition, strapiUrl }: CardProps) {
  const base = `/admin/${enc(edition)}`;
  const [data, setData] = useState<Reports | null>(null);
  const [notice, setNotice] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await request<Reports>(strapiUrl, `${base}/reports`, "GET"));
    } catch {
      setNotice({ kind: "alert", text: LOAD_FAILED });
    }
  }

  useEffect(() => {
    load();
  }, [edition, strapiUrl]);

  async function handle(report: Report) {
    setBusy(true);
    setNotice(null);
    try {
      await request(strapiUrl, `${base}/reports/${enc(report.id)}/handle`, "POST");
      await load();
      setNotice({ kind: "status", text: "Signalement marqué comme traité." });
    } catch (failure) {
      setNotice({ kind: "alert", text: (failure instanceof EspaceApiError && failure.status !== 0 && failure.message) || ACTION_FAILED });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card heading="Messages signalés">
      <p className="mt-2 text-muted">Seul le message signalé est affiché, jamais le reste de la conversation.</p>
      <FeedbackArea feedback={notice} />
      {data && (
        <>
          <h3 className="mt-6 font-heading text-lg font-semibold normal-case">
            À traiter ({data.open.length})
          </h3>
          {data.open.length === 0 ? (
            <p className="mt-2 text-muted">Aucun signalement à traiter.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {data.open.map((report) => (
                <ReportItem key={report.id} report={report} busy={busy} onHandle={() => handle(report)} />
              ))}
            </ul>
          )}
          {data.handled.length > 0 && (
            <>
              <h3 className="mt-6 font-heading text-lg font-semibold normal-case">
                Traités ({data.handled.length})
              </h3>
              <ul className="mt-3 space-y-3">
                {data.handled.map((report) => (
                  <ReportItem key={report.id} report={report} busy={busy} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Card>
  );
}
