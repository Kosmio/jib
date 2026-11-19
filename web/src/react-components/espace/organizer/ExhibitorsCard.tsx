import React from "react";
import type { Stats } from "../../../lib/espace/admin";
import { Card, number, type CardProps } from "./shared";

// Exposants les plus sollicités.

export default function ExhibitorsCard({ stats }: CardProps & { stats: Stats }) {
  return (
      <Card heading="Exposants les plus sollicités">
        {stats.topExhibitors.length === 0 ? (
          <p className="mt-4 text-muted">Aucune demande à un exposant pour l’instant.</p>
        ) : (
          <table className="mt-4 w-full text-left">
            <thead>
              <tr className="border-b border-surface-alt text-muted">
                <th scope="col" className="pb-2 font-semibold">
                  Exposant
                </th>
                <th scope="col" className="pb-2 text-right font-semibold">
                  Demandes
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.topExhibitors.map((exhibitor) => (
                <tr key={exhibitor.id} className="border-b border-surface-alt last:border-0">
                  <th scope="row" className="py-3 pr-4 font-semibold">
                    {exhibitor.name}
                    {exhibitor.standNumber != null && exhibitor.standNumber !== "" && (
                      <span className="block text-sm font-normal text-muted">Stand {exhibitor.standNumber}</span>
                    )}
                  </th>
                  <td className="py-3 text-right font-heading text-xl font-semibold text-title">{number(exhibitor.requests)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
  );
}
