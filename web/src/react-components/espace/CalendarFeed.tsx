import React, { useId, useState } from "react";
import { EspaceApiError, request } from "../../lib/espace/client";

// I-42 : abonnement de l'agenda à une application de calendrier. L'adresse du flux porte le jeton : elle n'est affichée qu'une fois,
// à la création, et ne peut plus être relue ensuite (le serveur n'en garde que l'empreinte). Régénérer ou révoquer invalide l'ancienne.

type Props = { strapiUrl: string };

const BUTTON = "inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-title bg-white px-4 font-bold text-title hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60";
const DANGER = "inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-danger bg-white px-4 font-bold text-danger hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60";

type Notice = { kind: "status" | "alert"; text: string };

/** « https://…/x.ics » -> « webcal://…/x.ics » : les applications de calendrier s'abonnent au flux au lieu de le télécharger. */
const webcal = (url: string): string => url.replace(/^https?:\/\//, "webcal://");

export default function CalendarFeed({ strapiUrl }: Props) {
  const [feed, setFeed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const fieldId = useId();

  const failure = (error: unknown): Notice => ({
    kind: "alert",
    text: error instanceof EspaceApiError && error.status !== 0 && error.message ? error.message : "L’opération a échoué. Réessayez.",
  });

  async function subscribe() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const { path } = await request<{ path: string }>(strapiUrl, "/me/calendar-feed", "POST");
      // `strapiUrl` est l'adresse publique de Strapi (préfixe `/strapi` compris) : le serveur ne la connaît pas.
      const url = webcal(`${strapiUrl.replace(/\/+$/, "")}${path}`);
      setFeed(url);
      setNotice({ kind: "status", text: "Votre abonnement est créé. Copiez cette adresse maintenant : elle ne sera plus affichée." });
    } catch (error) {
      setNotice(failure(error));
    }
    setBusy(false);
  }

  async function revoke() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await request<{ revoked: boolean }>(strapiUrl, "/me/calendar-feed", "DELETE");
      setFeed(null);
      setNotice({ kind: "status", text: "L’abonnement est révoqué. Votre application de calendrier ne recevra plus de mises à jour." });
    } catch (error) {
      setNotice(failure(error));
    }
    setBusy(false);
  }

  async function copy() {
    if (!feed) return;
    try {
      await navigator.clipboard.writeText(feed);
      setNotice({ kind: "status", text: "Adresse copiée." });
    } catch {
      setNotice({ kind: "alert", text: "La copie a échoué. Sélectionnez l’adresse et copiez-la à la main." });
    }
  }

  return (
    <section aria-labelledby={`${fieldId}-title`} className="mt-6 rounded-xl border border-surface-alt bg-white p-4">
      <h2 id={`${fieldId}-title`} className="font-heading text-xl font-semibold normal-case">
        Agenda dans mon calendrier
      </h2>
      <p className="mt-2 text-muted">
        Abonnez votre application de calendrier : vos rendez-vous acceptés et le programme s’y mettent à jour seuls. Créer un nouvel abonnement remplace le précédent.
      </p>

      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" onClick={subscribe} disabled={busy} className={BUTTON}>
          S’abonner à mon agenda
        </button>
        <button type="button" onClick={revoke} disabled={busy} className={DANGER}>
          Révoquer
        </button>
      </div>

      {feed && (
        <div className="mt-4">
          <label htmlFor={fieldId} className="block font-semibold text-ink">
            Adresse de l’abonnement
          </label>
          <div className="mt-1 flex flex-wrap gap-3">
            <input
              id={fieldId}
              type="text"
              readOnly
              value={feed}
              onFocus={(event) => event.currentTarget.select()}
              className="min-h-11 min-w-0 flex-1 rounded-lg border-2 border-surface-alt bg-surface px-3 text-ink"
            />
            <button type="button" onClick={copy} className={BUTTON}>
              Copier
            </button>
            <a href={feed} className={BUTTON}>
              Ouvrir dans mon calendrier
            </a>
          </div>
        </div>
      )}

      <div role={notice?.kind === "alert" ? "alert" : "status"} className="mt-3 font-semibold text-ink empty:hidden">
        {notice?.text}
      </div>
    </section>
  );
}
