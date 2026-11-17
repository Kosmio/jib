import React, { useEffect, useState } from "react";
import { previewWelcome, sendWelcome, type WelcomePreview, type WelcomeResult } from "../../../lib/espace/admin";
import { EspaceApiError } from "../../../lib/espace/client";
import { plural } from "../../../lib/espace/format";
import { Card, FeedbackArea, LOAD_FAILED, type CardProps, type Feedback } from "./shared";

// F-105, carte « E-mail de bienvenue » : inscrits actifs jamais invités, aperçu, envoi confirmé. Rien ne part sans ce bouton (R-85).

const SEND_FAILED = "L’envoi a échoué. Vérifiez votre connexion et réessayez.";

export default function WelcomeCard({ edition, strapiUrl }: CardProps) {
  const [preview, setPreview] = useState<WelcomePreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<Feedback | null>(null);

  const load = () =>
    previewWelcome(strapiUrl, edition).then(setPreview, () => setNotice({ kind: "alert", text: LOAD_FAILED }));

  useEffect(() => {
    load();
  }, [edition, strapiUrl]);

  async function send() {
    if (sending) return;
    setSending(true);
    setNotice(null);
    let result: WelcomeResult;
    try {
      result = await sendWelcome(strapiUrl, edition);
    } catch (failure) {
      setSending(false);
      setConfirming(false);
      if (failure instanceof EspaceApiError && failure.status === 401) {
        window.location.assign(`/espace/${encodeURIComponent(edition)}/connexion`);
        return;
      }
      setNotice({ kind: "alert", text: (failure instanceof EspaceApiError && failure.status !== 0 && failure.message) || SEND_FAILED });
      return;
    }
    setSending(false);
    setConfirming(false);
    setNotice({
      kind: result.failed ? "alert" : "status",
      text: `${plural(result.sent, "e-mail envoyé", "e-mails envoyés")}, ${plural(result.failed, "en échec", "en échec")}.`,
    });
    await load();
  }

  const count = preview?.recipients ?? 0;

  return (
    <Card heading="E-mail de bienvenue">
      <p className="mt-2 text-muted">
        {preview
          ? `${plural(count, "inscrit actif n’a", "inscrits actifs n’ont")} pas encore reçu l’e-mail de bienvenue, avec son lien d’accès à l’espace. Les organisateurs sont exclus.`
          : "Chargement…"}
      </p>
      {preview && (
        <details className="mt-4">
          <summary className="cursor-pointer font-semibold text-title">Voir l’aperçu de l’e-mail</summary>
          <iframe title="Aperçu de l’e-mail de bienvenue" sandbox="" srcDoc={preview.sampleHtml} className="mt-3 h-96 w-full rounded-lg border border-surface-alt bg-white" />
        </details>
      )}
      {preview && !confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={count === 0}
          className="mt-4 inline-flex min-h-13 items-center justify-center rounded-lg bg-gold px-6 text-lg font-bold text-gold-ink shadow-md shadow-gold/25 hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60"
        >
          {`Envoyer à ${plural(count, "inscrit")}`}
        </button>
      )}
      {confirming && (
        <div role="alertdialog" aria-labelledby="welcome-confirm" className="mt-4 rounded-lg border-2 border-title bg-white p-4">
          <p id="welcome-confirm" className="font-semibold">
            {`Envoyer l’e-mail de bienvenue à ${plural(count, "inscrit")} ? Chacun ne le reçoit qu’une fois.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={send}
              disabled={sending}
              aria-busy={sending}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-gold px-5 font-bold text-gold-ink hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sending ? "Envoi en cours…" : `Confirmer l’envoi à ${plural(count, "inscrit")}`}
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
