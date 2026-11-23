import React from "react";
import { normalizeWarning, type Stats } from "../../../lib/espace/admin";
import { Card, Icon, type CardProps } from "./shared";

// Avertissements des statistiques (A-29).

/** Libellés de repli des avertissements des statistiques (A-29) : le serveur fournit en général son propre `message`, qui nomme la personne. */
const WARNING_LABELS: Record<string, string> = {
  HOSTED_TABLE_CONFLICT: "Deux intervenants ont la même table dédiée\u00a0: seul le premier inscrit la garde, l’autre est ignoré.",
  HOSTED_TABLE_INVALID: "Une table dédiée est hors des tables de l’édition ou n’est pas portée par un intervenant\u00a0: elle est ignorée.",
};

export default function WarningsCard({ stats }: CardProps & { stats: Stats }) {
  const warnings = stats.warnings.map(normalizeWarning);

  return (
    <Card heading="Avertissements">
      {warnings.length === 0 ? (
        <p className="mt-4 flex items-center gap-3 text-muted">
          <span className="text-primary-ink">
            <Icon name="check" />
          </span>
          Aucun avertissement.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {warnings.map((warning, index) => (
            <li key={`${warning.code}-${index}`} className="flex items-start gap-3">
              <span className="text-danger">
                <Icon name="alert" />
              </span>
              {warning.message || WARNING_LABELS[warning.code] || warning.code}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
