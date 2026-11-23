import React from "react";
import { editionLine } from "../../../lib/espace/format";

// V5-C, E9 : sélecteur d'édition en tête du pilotage. Chaque autre édition est un formulaire qui envoie `POST /admin/{edition}/switch` :
// Strapi ouvre la session de la cible et répond 303 vers son pilotage. Rien n'exige JavaScript, le composant n'est pas hydraté.

export type PilotableEdition = { slug: string; title: string; date: string | null; city: string | null; current: boolean };

type Props = { editions: PilotableEdition[]; strapiUrl: string };

export default function EditionSwitcher({ editions, strapiUrl }: Props) {
  if (editions.length < 2) return null;
  return (
    <nav aria-labelledby="editions-pilotables" className="rounded-xl border border-surface-alt bg-white p-4">
      <h2 id="editions-pilotables" className="font-heading text-base font-semibold normal-case">
        Éditions que vous pilotez
      </h2>
      <ul className="mt-3 flex flex-wrap gap-3">
        {editions.map((edition) => (
          <li key={edition.slug}>
            {edition.current ? (
              <span
                aria-current="page"
                className="inline-flex min-h-11 flex-col justify-center rounded-lg border-2 border-primary-ink bg-surface px-4 py-1 text-title"
              >
                <span className="font-bold">{edition.title}</span>
                <span className="text-sm text-muted">Édition affichée</span>
              </span>
            ) : (
              <form method="post" action={`${strapiUrl}/api/espace/admin/${encodeURIComponent(edition.slug)}/switch`}>
                <button
                  type="submit"
                  className="inline-flex min-h-11 flex-col justify-center rounded-lg border-2 border-title bg-white px-4 py-1 text-left text-title hover:bg-surface"
                >
                  <span className="font-bold">{edition.title}</span>
                  <span className="text-sm text-muted">{editionLine(edition) || "Passer à cette édition"}</span>
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
