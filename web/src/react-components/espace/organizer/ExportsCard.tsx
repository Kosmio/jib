import React from "react";
import { Card, type CardProps } from "./shared";

// Exports CSV (F-91) : liens vers `GET /admin/{edition}/export/{nom}.csv`, téléchargés avec le cookie de session.

const EXPORTS = [
  { file: "participants", label: "Participants", help: "Coordonnées, rôle, page LinkedIn et rendez-vous confirmés de chacun (badges, relances)." },
  { file: "meetings", label: "Rendez-vous", help: "Tous les rendez-vous par heure, avec la table ou le stand et le statut." },
  { file: "exhibitors", label: "Exposants", help: "Stand, représentants et nombre de demandes reçues." },
  { file: "stats", label: "Statistiques", help: "Les indicateurs de ce tableau de bord." },
] as const;

export default function ExportsCard({ edition: editionSlug, strapiUrl }: CardProps) {
  return (
    <Card heading="Exports">
      <p className="mt-2 text-muted">
        Fichiers CSV à ouvrir dans Excel. Ils contiennent des données personnelles&nbsp;: à réserver à l’organisation de la journée.
      </p>
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {EXPORTS.map(({ file, label, help }) => (
          <li key={file}>
            <a
              href={`${strapiUrl}/api/espace/admin/${encodeURIComponent(editionSlug)}/export/${file}.csv`}
              className="flex min-h-13 flex-col justify-center rounded-lg border-2 border-title bg-white px-4 py-2 text-title hover:bg-surface"
            >
              <span className="font-bold">{label}</span>
              <span className="text-sm text-muted">{help}</span>
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
