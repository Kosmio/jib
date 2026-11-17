import React, { useEffect, useState } from "react";
import { EspaceApiError, request } from "../../../lib/espace/client";
import { plural } from "../../../lib/espace/format";
import { Card, FeedbackArea, LOAD_FAILED, type CardProps, type Feedback } from "./shared";

// F-92, carte « Relances » : choix du scénario, destinataires et exclus, aperçu isolé, envoi confirmé (R-71, R-72).

type Scenario = "profile" | "no-meeting" | "eve" | "welcome";
type RemindersPreview = { recipients: number; skipped: { alreadySent: number; optedOut: number }; sampleHtml: string };
type RemindersResult = { sent: number; skipped: number; failed: number };

const SCENARIOS: { value: Scenario; label: string }[] = [
  { value: "profile", label: "Profil incomplet" },
  { value: "no-meeting", label: "Sans rendez-vous" },
  { value: "eve", label: "Veille de l’événement" },
  { value: "welcome", label: "Rappel d’activation" },
];

const SEND_FAILED = "L’envoi a échoué. Vérifiez votre connexion et réessayez.";
const OUTSIDE_HOURS = "Les relances partent entre 8h00 et 20h00, heure de Paris.";

const base = (edition: string) => `/admin/${encodeURIComponent(edition)}/reminders`;

/** Vrai entre 8h00 et 19h59, heure de Paris. */
function inSendingHours(now = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat("fr-FR", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Paris" }).format(now));
  return hour >= 8 && hour < 20;
}

export default function RemindersCard({ edition, strapiUrl }: CardProps) {
  const [scenario, setScenario] = useState<Scenario>("profile");
  const [preview, setPreview] = useState<RemindersPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(() => inSendingHours());
  const [notice, setNotice] = useState<Feedback | null>(null);

  const load = (target: Scenario) =>
    request<RemindersPreview>(strapiUrl, `${base(edition)}/preview`, "POST", { scenario: target }).then(
      (data) => setPreview((current) => (current === null || target === scenarioRef.current ? data : current)),
      () => setNotice({ kind: "alert", text: LOAD_FAILED }),
    );

  const scenarioRef = React.useRef(scenario);
  scenarioRef.current = scenario;

  useEffect(() => {
    setPreview(null);
    setConfirming(false);
    setNotice(null);
    load(scenario);
  }, [edition, strapiUrl, scenario]);

  useEffect(() => {
    const timer = window.setInterval(() => setOpen(inSendingHours()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function send() {
    if (sending) return;
    setSending(true);
    setNotice(null);
    let result: RemindersResult;
    try {
      result = await request<RemindersResult>(strapiUrl, `${base(edition)}/send`, "POST", { scenario });
    } catch (failure) {
      setSending(false);
      setConfirming(false);
      if (failure instanceof EspaceApiError && failure.code === "OUTSIDE_SENDING_HOURS") {
        setOpen(false);
        setNotice({ kind: "alert", text: OUTSIDE_HOURS });
        return;
      }
      setNotice({ kind: "alert", text: (failure instanceof EspaceApiError && failure.status !== 0 && failure.message) || SEND_FAILED });
      return;
    }
    setSending(false);
    setConfirming(false);
    setNotice({
      kind: result.failed ? "alert" : "status",
      text: `${plural(result.sent, "envoyé", "envoyés")}, ${plural(result.skipped, "déjà relancé", "déjà relancés")}, ${plural(result.failed, "en échec", "en échec")}.`,
    });
    await load(scenario);
  }

  const count = preview?.recipients ?? 0;
  const label = SCENARIOS.find((item) => item.value === scenario)?.label ?? "";
  const blocked = !open || count === 0;

  return (
    <Card heading="Relances">
      <p className="mt-2 text-muted">Chaque participant ne reçoit une relance qu’une fois par jour et par scénario. Rien ne part sans votre confirmation.</p>
      <div className="mt-4">
        <label htmlFor="reminders-scenario" className="block font-semibold text-title">
          Scénario
        </label>
        <select
          id="reminders-scenario"
          value={scenario}
          onChange={(event) => setScenario(event.target.value as Scenario)}
          disabled={sending}
          className="mt-1 min-h-11 w-full max-w-sm rounded-lg border-2 border-title bg-white px-3"
        >
          {SCENARIOS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-4 text-muted">
        {preview
          ? `${plural(count, "destinataire")} pour « ${label} ».`
          : "Chargement…"}
      </p>
      {preview && (
        <ul className="mt-2 list-disc pl-6 text-muted">
          <li>{plural(preview.skipped.alreadySent, "exclu, déjà relancé", "exclus, déjà relancés")}</li>
          <li>{plural(preview.skipped.optedOut, "exclu, a refusé les rappels", "exclus, ont refusé les rappels")}</li>
        </ul>
      )}
      {preview && (
        <details className="mt-4">
          <summary className="cursor-pointer font-semibold text-title">Voir l’aperçu de l’e-mail</summary>
          <iframe title={`Aperçu de l’e-mail « ${label} »`} csp="script-src 'none'" srcDoc={preview.sampleHtml} className="mt-3 h-96 w-full rounded-lg border border-surface-alt bg-white" />
        </details>
      )}
      {preview && !confirming && (
        <>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={blocked}
            aria-describedby={open ? undefined : "reminders-hours"}
            className="mt-4 inline-flex min-h-13 items-center justify-center rounded-lg bg-gold px-6 text-lg font-bold text-gold-ink shadow-md shadow-gold/25 hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60"
          >
            {`Envoyer à ${plural(count, "destinataire")}`}
          </button>
          {!open && (
            <p id="reminders-hours" className="mt-2 font-semibold text-danger">
              {OUTSIDE_HOURS}
            </p>
          )}
        </>
      )}
      {confirming && (
        <div role="alertdialog" aria-labelledby="reminders-confirm" className="mt-4 rounded-lg border-2 border-title bg-white p-4">
          <p id="reminders-confirm" className="font-semibold">
            {`Envoyer la relance « ${label} » à ${plural(count, "destinataire")} ?`}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={send}
              disabled={sending}
              aria-busy={sending}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-gold px-5 font-bold text-gold-ink hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sending ? "Envoi en cours…" : `Confirmer l’envoi à ${plural(count, "destinataire")}`}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={sending}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-title bg-white px-5 font-bold text-title hover:bg-surface disabled:opacity-60"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
      <FeedbackArea feedback={notice} />
    </Card>
  );
}
