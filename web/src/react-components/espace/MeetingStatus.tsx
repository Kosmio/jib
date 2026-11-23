import React from "react";
import type { MeetingStatus as Status } from "../../lib/espace/meetings";

// Statut d'un rendez-vous (F-64) : toujours un mot et une icône, jamais la couleur seule (07-design.md).
// Rendu serveur possible : aucun état, aucun effet. `Icon` sert aussi à SlotPicker et AgendaBoard (îlots, donc React).

export type IconName = "alert" | "back" | "check" | "clock" | "cross" | "download" | "info";

const PATHS: Record<IconName, React.ReactNode> = {
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16.5h.01" />
    </>
  ),
  back: <path d="m15 5-7 7 7 7" />,
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  cross: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>
  ),
  download: <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5h.01" />
    </>
  ),
};

/** Icône en trait (stroke 2 px), décorative : le sens est porté par le texte voisin. */
export function Icon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`${className} shrink-0`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}

export const STATUS_LABEL: Record<Status, string> = {
  accepted: "Confirmé",
  pending: "En attente de réponse",
  declined: "Refusé",
  cancelled: "Annulé",
  expired: "Expiré",
};

const STATUS_VIEW: Record<Status, { icon: IconName; tone: string }> = {
  accepted: { icon: "check", tone: "text-primary-ink" },
  pending: { icon: "clock", tone: "text-wood-dark" },
  declined: { icon: "cross", tone: "text-muted" },
  cancelled: { icon: "cross", tone: "text-muted" },
  expired: { icon: "clock", tone: "text-muted" },
};

export default function MeetingStatus({ status }: { status: Status }) {
  const { icon, tone } = STATUS_VIEW[status];
  return (
    <span className={`inline-flex items-center gap-2 font-semibold ${tone}`}>
      <Icon name={icon} />
      {STATUS_LABEL[status]}
    </span>
  );
}
