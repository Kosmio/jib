import React, { useState } from "react";
import { EspaceApiError } from "../../../lib/espace/client";
import { parisDay, plural } from "../../../lib/espace/format";
import { ROLE_LABELS } from "./AttendeeSheet";
import { Card, FeedbackArea, type CardProps, type Feedback } from "./shared";

// F-97, carte « Badges » : PDF de tous les inscrits actifs, filtré par type et trié. F-98 : le téléchargement à l'unité
// (`downloadPdf`) sert aussi la fiche d'un inscrit. Le PDF se télécharge, il ne s'ouvre jamais dans l'onglet de l'espace.
// Contrat (V4-D1) : POST /admin/{edition}/badges { types?, sort? } -> application/pdf, en-têtes X-Badges-Count et X-Badges-Reduced.

const BADGES_FAILED = "Les badges n’ont pas pu être générés. Vérifiez votre connexion et réessayez.";

const SORTS: [string, string][] = [
  ["name", "Par nom"],
  ["company", "Par entreprise"],
];

/** Texte sans accents ni caractères spéciaux, en minuscules, pour un nom de fichier. */
export const fileSlug = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Récupère un PDF avec le cookie de session, le télécharge sous `fileName` et rend les en-têtes de la réponse. */
export async function downloadPdf(url: string, fileName: string, body?: unknown): Promise<Headers> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      credentials: "include",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new EspaceApiError(0, "NETWORK", "Le serveur ne répond pas.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new EspaceApiError(response.status, data?.error?.code ?? "UNKNOWN", data?.error?.message ?? "");
  }
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return response.headers;
}

export default function BadgesCard({ edition, strapiUrl }: CardProps) {
  const [types, setTypes] = useState<string[]>(Object.keys(ROLE_LABELS));
  const [sort, setSort] = useState("name");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Feedback | null>(null);

  const toggle = (type: string) => setTypes((current) => (current.includes(type) ? current.filter((value) => value !== type) : [...current, type]));

  async function generate() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const headers = await downloadPdf(
        `${strapiUrl}/api/espace/admin/${encodeURIComponent(edition)}/badges`,
        `badges-${fileSlug(edition) || "edition"}-${parisDay()}.pdf`,
        { types, sort },
      );
      const count = Number(headers.get("X-Badges-Count") ?? 0);
      const reduced = Number(headers.get("X-Badges-Reduced") ?? 0);
      setNotice({ kind: "status", text: `${plural(count, "badge")}, dont ${plural(reduced, "en carte réduite", "en carte réduite")} (profil masqué).` });
    } catch (failure) {
      if (failure instanceof EspaceApiError && failure.status === 401) {
        window.location.assign(`/espace/${encodeURIComponent(edition)}/connexion`);
        return;
      }
      setNotice({ kind: "alert", text: (failure instanceof EspaceApiError && failure.status !== 0 && failure.message) || BADGES_FAILED });
    }
    setBusy(false);
  }

  return (
    <Card heading="Badges">
      <p className="mt-2 text-muted">
        Un badge A4 plié par inscrit actif, avec son QR code. Un badge réimprimé garde son QR&nbsp;: seul « Régénérer le jeton », dans la fiche d’un inscrit, l’invalide.
      </p>
      <fieldset className="mt-4">
        <legend className="font-semibold">Types de badges</legend>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <label key={value} className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={types.includes(value)} onChange={() => toggle(value)} className="size-5 accent-title" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-4 max-w-xs">
        <label htmlFor="badges-tri" className="block font-semibold">
          Tri
        </label>
        <select id="badges-tri" value={sort} onChange={(event) => setSort(event.target.value)} className="mt-2 min-h-12 w-full rounded-lg border-2 border-accent bg-white px-4 text-lg text-ink">
          {SORTS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={generate}
        disabled={busy || types.length === 0}
        aria-busy={busy}
        className="mt-4 inline-flex min-h-13 items-center justify-center rounded-lg bg-gold px-6 text-lg font-bold text-gold-ink shadow-md shadow-gold/25 hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Génération en cours…" : "Générer les badges"}
      </button>
      {types.length === 0 && <p className="mt-2 text-sm text-muted">Cochez au moins un type de badge.</p>}
      <FeedbackArea feedback={notice} />
    </Card>
  );
}
