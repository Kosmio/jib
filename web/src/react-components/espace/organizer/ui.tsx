import React, { useId } from "react";
import { EspaceApiError } from "../../../lib/espace/client";
import { Icon, type Feedback } from "./shared";

// Briques des écrans de l'interface organisation (15-administration.md) : sections, champs étiquetés avec leurs erreurs (NF-76),
// interrupteur, boutons et lien vers la fiche Strapi (F-154). Mêmes tokens que les cartes du pilotage (07-design.md).

export const buttonPrimary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-gold px-5 font-bold text-gold-ink hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60";
export const buttonSecondary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border-2 border-title bg-white px-5 font-bold text-title hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60";
export const buttonQuiet =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 font-semibold text-title underline-offset-4 hover:bg-surface hover:underline disabled:cursor-not-allowed disabled:opacity-60";
export const buttonDanger =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border-2 border-danger bg-white px-5 font-bold text-danger hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60";

export const controlClass = (invalid = false) =>
  `mt-1.5 min-h-11 w-full rounded-lg border-2 bg-white px-3 text-base text-ink ${invalid ? "border-danger" : "border-surface-alt focus:border-accent"}`;

/** Section d'un écran : titre, phrase d'explication, puis le contenu ; `aside` à droite du titre (lien Strapi, aide). */
export function Section({ id, title, intro, aside, children }: { id?: string; title: string; intro?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className="rounded-xl border border-surface-alt bg-white p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h2 id={headingId} className="font-heading text-xl font-semibold normal-case">
          {title}
        </h2>
        {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
      </div>
      {intro && <p className="mt-1 max-w-[70ch] text-muted">{intro}</p>}
      {children}
    </section>
  );
}

/** Champ étiqueté : `render` reçoit l'identifiant et les attributs d'accessibilité à poser sur le contrôle. */
export function Field({
  label,
  hint,
  error,
  required,
  className = "",
  render,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  render: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean; required?: boolean }) => React.ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-aide` : undefined;
  const errorId = error ? `${id}-erreur` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="block font-semibold">
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger">
            {" "}
            *
          </span>
        )}
      </label>
      {render({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, required })}
      {hint && (
        <p id={hintId} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 flex items-start gap-2 text-sm font-semibold text-danger">
          <Icon name="alert" />
          {error}
        </p>
      )}
    </div>
  );
}

/** Interrupteur (case à cocher annoncée comme « switch ») avec son libellé et sa description. */
export function Switch({
  checked,
  onChange,
  label,
  states = ["activé", "désactivé"],
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Mots de l'état, allumé puis éteint (« ouvert », « fermé »). */
  states?: [string, string];
  description?: React.ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-4">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-8 w-14 shrink-0 items-center rounded-full border-2 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          checked ? "border-primary-dark bg-primary-dark" : "border-muted bg-surface-alt"
        }`}
      >
        <span className="sr-only">{label}</span>
        <span
          aria-hidden="true"
          className={`inline-block size-6 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-6" : "translate-x-0.5"}`}
        />
      </button>
      <div>
        <label htmlFor={id} className="cursor-pointer font-semibold">
          {label}
          <span className={`ml-2 rounded-full px-2 py-0.5 text-sm font-semibold ${checked ? "bg-surface text-primary-ink" : "bg-surface-alt text-muted"}`}>{checked ? states[0] : states[1]}</span>
        </label>
        {description && (
          <p id={`${id}-desc`} className="text-sm text-muted">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

/** Lien « Ouvrir dans Strapi » (F-154, F-184), dans un nouvel onglet. */
export function StrapiLink({ href, label = "Ouvrir dans Strapi" }: { href: string; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-muted underline-offset-4 hover:text-title hover:underline">
      {label}
      <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
      </svg>
      <span className="sr-only">(nouvel onglet)</span>
    </a>
  );
}

/** Lien « ? » vers la section d'aide qui explique l'écran (F-189). */
export function HelpLink({ edition, page, label }: { edition: string; page: string; label: string }) {
  return (
    <a
      href={`/espace/${encodeURIComponent(edition)}/organisateur/aide/${page}`}
      className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-title"
      title={`Aide : ${label}`}
    >
      <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" />
      </svg>
      <span className="sr-only">Aide : {label}</span>
    </a>
  );
}

/** Message d'un échec d'appel (le texte de l'API quand il y en a un), et erreurs par champ d'un 400 VALIDATION. */
export function failure(error: unknown, fallback = "L’enregistrement n’a pas abouti. Réessayez."): { feedback: Feedback; fields: Record<string, string>; code: string | null } {
  if (error instanceof EspaceApiError) {
    return { feedback: { kind: "alert", text: error.status !== 0 && error.message ? error.message : fallback }, fields: error.fields ?? {}, code: error.code };
  }
  return { feedback: { kind: "alert", text: fallback }, fields: {}, code: null };
}

const parisParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Instant ISO -> valeur d'un champ `datetime-local` en heure de Paris (« 2026-12-02T18:00 »), ou "". */
export function toParisInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const parts = Object.fromEntries(parisParts.formatToParts(new Date(iso)).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Valeur d'un champ `datetime-local` lue en heure de Paris -> instant ISO, ou null. */
export function fromParisInput(local: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let instant = wall;
  for (let i = 0; i < 2; i += 1) {
    const shown = toParisInput(new Date(instant).toISOString());
    const [, sy, smo, sd, sh, smi] = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(shown)!.map(Number);
    instant -= Date.UTC(sy, smo - 1, sd, sh, smi) - wall;
  }
  return new Date(instant).toISOString();
}
