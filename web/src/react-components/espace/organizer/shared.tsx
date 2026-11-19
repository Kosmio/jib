import React from "react";

// Éléments communs aux cartes du tableau de bord organisateur (E9).

/** Propriétés communes : `edition` est le slug de l'édition, `strapiUrl` l'adresse publique de Strapi (REACT_STRAPI_URL). */
export type CardProps = { edition: string; strapiUrl: string };

export const LOAD_FAILED = "Les chiffres n’ont pas pu être actualisés. Rechargez la page.";

export type Feedback = { kind: "alert" | "status"; text: string; lines?: string[] };

export const number = (value: number) => value.toLocaleString("fr-FR");
export const percentLabel = (value: number) => `${value} %`;

export function Icon({ name }: { name: "alert" | "check" | "refresh" }) {
  return (
    <svg
      aria-hidden="true"
      className="size-5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "refresh" && <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" />}
      {name !== "refresh" && <circle cx="12" cy="12" r="9" />}
      {name === "alert" && <path d="M12 8v5M12 16.5h.01" />}
      {name === "check" && <path d="m8.5 12.5 2.5 2.5 4.5-5" />}
    </svg>
  );
}

export function Card({ heading, children, className = "" }: { heading: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-surface-alt bg-white p-6 ${className}`}>
      <h2 className="font-heading text-xl font-semibold normal-case">{heading}</h2>
      {children}
    </section>
  );
}

/** Message d'état (`role="status"`, toujours présent pour être annoncé) ou d'alerte, avec ses lignes de détail. */
export function FeedbackArea({ feedback }: { feedback: Feedback | null }) {
  return (
    <>
      <div role="status" className="empty:hidden">
        {feedback?.kind === "status" && (
          <p className="mt-4 flex items-start gap-3 rounded-lg bg-surface p-3 font-semibold">
            <span className="text-primary-ink">
              <Icon name="check" />
            </span>
            {feedback.text}
          </p>
        )}
      </div>
      {feedback?.kind === "alert" && (
        <div role="alert" className="mt-4 rounded-lg border-2 border-danger bg-white p-3">
          <p className="flex items-start gap-3 font-semibold">
            <span className="text-danger">
              <Icon name="alert" />
            </span>
            {feedback.text}
          </p>
          {feedback.lines && feedback.lines.length > 0 && (
            <ul className="mt-2 list-disc pl-13 text-muted">
              {feedback.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
