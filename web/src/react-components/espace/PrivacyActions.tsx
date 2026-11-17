import React, { useRef, useState } from "react";
import { EspaceApiError, request } from "../../lib/espace/client";

// F-33, R-44, NF-12 : télécharger mes données (JSON) et supprimer mes données depuis le profil.
// La suppression passe par une confirmation qui nomme ses effets ; sans elle, rien n'est envoyé.

type Props = { strapiUrl: string; editionSlug: string };

const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-title bg-white px-5 font-bold text-title hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60";
const dangerClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-danger bg-white px-5 font-bold text-danger hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60";

/** Récupère le fichier JSON avec le cookie de session et le télécharge. */
async function downloadExport(strapiUrl: string, editionSlug: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${strapiUrl}/api/espace/me/export`, { credentials: "include" });
  } catch {
    throw new EspaceApiError(0, "NETWORK", "Le serveur ne répond pas.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new EspaceApiError(response.status, data?.error?.code ?? "UNKNOWN", data?.error?.message ?? "");
  }
  const href = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = href;
  link.download = `mes-donnees-${editionSlug}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export default function PrivacyActions({ strapiUrl, editionSlug }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  async function exportData() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await downloadExport(strapiUrl, editionSlug);
      setMessage({ kind: "status", text: "Vos données sont téléchargées." });
    } catch (failure) {
      setMessage({ kind: "alert", text: failure instanceof EspaceApiError && failure.status !== 0 && failure.message ? failure.message : "Le téléchargement a échoué. Réessayez." });
    }
    setBusy(false);
  }

  async function erase() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await request<{ erased: boolean }>(strapiUrl, "/me/erase", "POST", { confirm: true });
    } catch (failure) {
      setMessage({ kind: "alert", text: failure instanceof EspaceApiError && failure.status !== 0 && failure.message ? failure.message : "La suppression a échoué. Réessayez." });
      setConfirming(false);
      setBusy(false);
      return;
    }
    // Les copies hors connexion de l'espace sont vidées, comme à la déconnexion.
    if ("caches" in window) {
      const names = await caches.keys().catch(() => [] as string[]);
      await Promise.all(names.filter((name) => name.startsWith("jib-espace-v2-ed-")).map((name) => caches.delete(name))).catch(() => undefined);
    }
    window.location.assign(`/espace/${encodeURIComponent(editionSlug)}/connexion?deconnecte=1`);
  }

  return (
    <section aria-labelledby="mes-donnees-titre" className="rounded-xl border border-surface-alt bg-white p-5">
      <h2 id="mes-donnees-titre" className="font-heading text-xl font-semibold normal-case">
        Mes données
      </h2>
      <p className="mt-2 text-muted">Téléchargez une copie de vos données, ou supprimez-les définitivement.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={exportData} disabled={busy} className={buttonClass}>
          Télécharger mes données
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(true);
            setTimeout(() => confirmRef.current?.focus(), 0);
          }}
          disabled={busy || confirming}
          className={dangerClass}
        >
          Supprimer mes données
        </button>
      </div>

      {confirming && (
        <div role="alertdialog" aria-labelledby="suppression-titre" aria-describedby="suppression-texte" className="mt-4 rounded-lg border-2 border-danger bg-white p-4">
          <p id="suppression-titre" className="font-semibold">
            Supprimer mes données ?
          </p>
          <ul id="suppression-texte" className="mt-2 list-disc space-y-1 pl-6 text-muted">
            <li>Vos rendez-vous à venir sont annulés et vos interlocuteurs sont prévenus.</li>
            <li>Vos messages restent chez vos interlocuteurs, sous le nom « Participant supprimé ».</li>
            <li>Vous ne pourrez plus vous reconnecter avec cette adresse, et votre profil disparaît de l’annuaire.</li>
            <li>Cette action est définitive.</li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-3">
            <button ref={confirmRef} type="button" onClick={erase} disabled={busy} aria-busy={busy} className={dangerClass}>
              Supprimer définitivement mes données
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={buttonClass}>
              Annuler
            </button>
          </div>
        </div>
      )}

      <div role="status" className="empty:hidden">
        {message?.kind === "status" && <p className="mt-4 rounded-lg bg-surface p-3 font-semibold">{message.text}</p>}
      </div>
      {message?.kind === "alert" && (
        <p role="alert" className="mt-4 rounded-lg border-2 border-danger bg-white p-3 font-semibold">
          {message.text}
        </p>
      )}
    </section>
  );
}
