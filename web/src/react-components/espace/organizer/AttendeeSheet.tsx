import React, { useEffect, useState } from "react";
import { EspaceApiError, request } from "../../../lib/espace/client";
import { plural } from "../../../lib/espace/format";
import { FeedbackArea, Icon, type Feedback } from "./shared";

// F-135, F-137, F-138 : fiche d'un inscrit du pilotage. Les appels sont définis ici (contrat : 14-lots-finalisation.md, V3-E).
// L'e-mail ne sort que de ces routes d'administration ; aucun contenu de message n'y figure (R-63, R-42).
// V4-D2 ajoute ses boutons dans la zone d'actions (`data-attendee-actions`).

export const ROLE_LABELS: Record<string, string> = {
  participant: "Participant",
  speaker: "Intervenant",
  exhibitor_rep: "Représentant d’exposant",
  organizer: "Organisateur",
};

/** Ligne de la liste (`GET /admin/{edition}/attendees`). */
export type AttendeeRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  company: string | null;
  jobTitle: string | null;
  role: string;
  status: "active" | "cancelled";
  activated: boolean;
  lastSeenAt: string | null;
  directoryOptIn: boolean;
  manual: boolean;
};

export type AttendeeList = { items: AttendeeRow[]; total: number; page: number; pageSize: number; pages: number };

/** Fiche (`GET /admin/{edition}/attendees/{id}`). */
export type AttendeeSheetData = AttendeeRow & {
  importedAt: string;
  source: "helloasso" | "manual";
  activatedAt: string | null;
  statusLockedAt: string | null;
  consent: { directoryOptIn: boolean; meetingsOptIn: boolean; newsOptIn: boolean; consentAt: string | null };
  meetings: { total: number; pending: number; accepted: number };
  emails: { template: string; sentAt: string | null; status: "sent" | "failed"; error: string | null }[];
};

export type AttendeeFields = { firstName: string; lastName: string; email: string; company: string; jobTitle: string; role: string };

const enc = encodeURIComponent;
const base = (edition: string) => `/admin/${enc(edition)}/attendees`;

export const listAttendees = (strapiUrl: string, edition: string, query: Record<string, string>) => {
  const search = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== ""));
  return request<AttendeeList>(strapiUrl, `${base(edition)}${search.size ? `?${search}` : ""}`, "GET");
};
export const createAttendee = (strapiUrl: string, edition: string, fields: AttendeeFields) =>
  request<AttendeeSheetData>(strapiUrl, base(edition), "POST", fields);
export const getAttendee = (strapiUrl: string, edition: string, id: string) =>
  request<AttendeeSheetData>(strapiUrl, `${base(edition)}/${enc(id)}`, "GET");
export const updateAttendee = (strapiUrl: string, edition: string, id: string, fields: Partial<AttendeeFields>) =>
  request<AttendeeSheetData>(strapiUrl, `${base(edition)}/${enc(id)}`, "PATCH", fields);
export const sendAttendeeLink = (strapiUrl: string, edition: string, id: string) =>
  request<{ status: "sent" | "failed"; error: string | null; remaining: number }>(strapiUrl, `${base(edition)}/${enc(id)}/link`, "POST");
export const cancelAttendee = (strapiUrl: string, edition: string, id: string) =>
  request<AttendeeSheetData>(strapiUrl, `${base(edition)}/${enc(id)}/cancel`, "POST");
export const restoreAttendee = (strapiUrl: string, edition: string, id: string) =>
  request<AttendeeSheetData>(strapiUrl, `${base(edition)}/${enc(id)}/restore`, "POST");

/** Message d'un échec d'appel ; une session expirée renvoie à la connexion. */
export function failureText(failure: unknown, edition: string, fallback: string): string {
  if (failure instanceof EspaceApiError) {
    if (failure.status === 401) {
      window.location.assign(`/espace/${encodeURIComponent(edition)}/connexion`);
      return "";
    }
    if (failure.status !== 0 && failure.message) return failure.message;
  }
  return fallback;
}

const dateFormat = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Europe/Paris" });

/** « 3 décembre 2026 à 14:05 », en heure de Paris, ou « jamais ». */
export const dateLabel = (iso: string | null, never = "jamais") => (iso ? dateFormat.format(new Date(iso)) : never);

const TEMPLATE_LABELS: Record<string, string> = {
  "access-link": "Lien de connexion",
  welcome: "Bienvenue",
  "meeting-request": "Demande de rendez-vous",
  "meeting-accepted": "Rendez-vous accepté",
  "meeting-declined": "Rendez-vous refusé",
  "meeting-cancelled": "Rendez-vous annulé",
  "new-message": "Nouveau message",
  "reminder-profile": "Relance du profil",
  "reminder-no-meeting": "Relance sans rendez-vous",
  "reminder-eve": "Veille de l’événement",
};

const FIELDS: { name: keyof Omit<AttendeeFields, "role">; label: string; type?: string; required?: boolean }[] = [
  { name: "firstName", label: "Prénom", required: true },
  { name: "lastName", label: "Nom", required: true },
  { name: "email", label: "Adresse e-mail", type: "email", required: true },
  { name: "company", label: "Entreprise" },
  { name: "jobTitle", label: "Fonction" },
];

export const inputClass = (invalid: boolean) =>
  `mt-2 min-h-12 w-full rounded-lg border-2 bg-white px-4 text-lg text-ink ${invalid ? "border-danger" : "border-accent"}`;

/** Champs d'un formulaire d'inscrit (correction ou ajout), avec leur message d'erreur par champ (400 VALIDATION). */
export function AttendeeFieldset({
  id,
  values,
  errors,
  onChange,
}: {
  id: string;
  values: AttendeeFields;
  errors: Record<string, string>;
  onChange: (values: AttendeeFields) => void;
}) {
  const field = (name: keyof AttendeeFields) => `${id}-${name}`;
  const described = (name: string) => (errors[name] ? `${id}-${name}-erreur` : undefined);
  const error = (name: string) =>
    errors[name] && (
      <p id={`${id}-${name}-erreur`} className="mt-2 flex items-start gap-2 text-sm font-semibold text-danger">
        <Icon name="alert" />
        {errors[name]}
      </p>
    );
  return (
    <div className="mt-3 grid gap-4 md:grid-cols-2">
      {FIELDS.map(({ name, label, type, required }) => (
        <div key={name}>
          <label htmlFor={field(name)} className="block font-semibold">
            {label}
          </label>
          <input
            id={field(name)}
            type={type ?? "text"}
            required={required}
            value={values[name]}
            onChange={(event) => onChange({ ...values, [name]: event.target.value })}
            aria-invalid={errors[name] ? "true" : undefined}
            aria-describedby={described(name)}
            className={inputClass(Boolean(errors[name]))}
          />
          {error(name)}
        </div>
      ))}
      <div>
        <label htmlFor={field("role")} className="block font-semibold">
          Rôle
        </label>
        <select
          id={field("role")}
          value={values.role}
          onChange={(event) => onChange({ ...values, role: event.target.value })}
          aria-invalid={errors.role ? "true" : undefined}
          aria-describedby={described("role")}
          className={inputClass(Boolean(errors.role))}
        >
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {error("role")}
      </div>
    </div>
  );
}

const fieldsOf = (sheet: AttendeeSheetData): AttendeeFields => ({
  firstName: sheet.firstName,
  lastName: sheet.lastName,
  email: sheet.email,
  company: sheet.company ?? "",
  jobTitle: sheet.jobTitle ?? "",
  role: sheet.role,
});

const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-title bg-white px-5 font-bold text-title hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60";
const primaryClass = "inline-flex min-h-11 items-center justify-center rounded-lg bg-gold px-5 font-bold text-gold-ink hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60";
const dangerClass = "inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-danger bg-white px-5 font-bold text-danger hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60";

type Props = {
  edition: string;
  strapiUrl: string;
  /** documentId de l'inscrit. */
  attendeeId: string;
  /** Retour à la liste (la liste se recharge). */
  onClose: () => void;
};

export default function AttendeeSheet({ edition, strapiUrl, attendeeId, onClose }: Props) {
  const [sheet, setSheet] = useState<AttendeeSheetData | null>(null);
  const [values, setValues] = useState<AttendeeFields | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<Feedback | null>(null);

  const show = (next: AttendeeSheetData) => {
    setSheet(next);
    setValues(fieldsOf(next));
  };

  useEffect(() => {
    getAttendee(strapiUrl, edition, attendeeId).then(show, (failure) => {
      const text = failureText(failure, edition, "La fiche n’a pas pu être chargée. Rechargez la page.");
      if (text) setNotice({ kind: "alert", text });
    });
  }, [edition, strapiUrl, attendeeId]);

  /** Une action sur l'inscrit : état occupé, message de réussite ou d'échec. */
  async function act(work: () => Promise<string>, fallback: string) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setErrors({});
    try {
      setNotice({ kind: "status", text: await work() });
    } catch (failure) {
      if (failure instanceof EspaceApiError && failure.code === "VALIDATION") setErrors(failure.fields);
      const text = failureText(failure, edition, fallback);
      if (text) setNotice({ kind: "alert", text });
    }
    setConfirming(false);
    setBusy(false);
  }

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!sheet || !values) return;
    return act(async () => {
      show(await updateAttendee(strapiUrl, edition, sheet.id, values));
      return "Les corrections sont enregistrées. Les prochaines synchronisations ne les écraseront pas.";
    }, "Les corrections n’ont pas pu être enregistrées. Réessayez.");
  };

  const sendLink = () =>
    act(async () => {
      const result = await sendAttendeeLink(strapiUrl, edition, attendeeId);
      setSheet(await getAttendee(strapiUrl, edition, attendeeId));
      if (result.status === "failed") throw new EspaceApiError(502, "MAIL_FAILED", result.error ? `Le lien n’est pas parti : ${result.error}` : "Le lien n’est pas parti.");
      return `Lien envoyé à ${sheet?.email}. ${plural(result.remaining, "envoi restant", "envois restants")} cette heure.`;
    }, "Le lien n’a pas pu être envoyé. Réessayez.");

  const cancel = () =>
    act(async () => {
      show(await cancelAttendee(strapiUrl, edition, attendeeId));
      return "Inscrit désinscrit. Ses rendez-vous sont annulés et ses interlocuteurs prévenus.";
    }, "La désinscription a échoué. Réessayez.");

  const restore = () =>
    act(async () => {
      show(await restoreAttendee(strapiUrl, edition, attendeeId));
      return "Inscrit réinscrit. Ses rendez-vous annulés ne sont pas rétablis.";
    }, "La réinscription a échoué. Réessayez.");

  if (!sheet || !values) {
    return (
      <div>
        <button type="button" onClick={onClose} className={`${buttonClass} mt-4`}>
          Retour à la liste
        </button>
        {notice ? <FeedbackArea feedback={notice} /> : <p className="mt-4 text-muted">Chargement…</p>}
      </div>
    );
  }

  const cancelled = sheet.status === "cancelled";
  const rows: [string, string][] = [
    ["Rôle", ROLE_LABELS[sheet.role] ?? sheet.role],
    ["Statut", cancelled ? "Désinscrit" : "Inscrit"],
    ["Origine", sheet.source === "manual" ? "Ajouté à la main" : "Importé de HelloAsso"],
    ["Importé le", dateLabel(sheet.importedAt)],
    ["Espace activé le", dateLabel(sheet.activatedAt, "pas encore")],
    ["Dernière connexion", dateLabel(sheet.lastSeenAt)],
    ["Annuaire", sheet.consent.directoryOptIn ? "Profil visible" : "Profil non visible"],
    ["Rendez-vous", `${sheet.meetings.total} au total, dont ${plural(sheet.meetings.accepted, "accepté")} et ${sheet.meetings.pending} en attente`],
  ];

  return (
    <div>
      <button type="button" onClick={onClose} className={`${buttonClass} mt-4`}>
        Retour à la liste
      </button>
      <h3 className="mt-4 font-heading text-lg font-semibold normal-case">{`${sheet.firstName} ${sheet.lastName}`}</h3>
      <p className="text-muted">{[sheet.jobTitle, sheet.company].filter(Boolean).join(", ") || "Fonction et entreprise non renseignées"}</p>
      <p className="text-muted">{sheet.email}</p>

      <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
        {rows.map(([term, detail]) => (
          <React.Fragment key={term}>
            <dt className="font-semibold">{term}</dt>
            <dd className="text-muted">{detail}</dd>
          </React.Fragment>
        ))}
      </dl>

      <h4 className="mt-6 font-heading text-base font-semibold normal-case">Derniers e-mails</h4>
      {sheet.emails.length === 0 ? (
        <p className="mt-2 text-muted">Aucun e-mail envoyé à cet inscrit.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {sheet.emails.map((mail, index) => (
            <li key={`${mail.template}-${mail.sentAt}-${index}`} className="text-muted">
              <span className="font-semibold text-ink">{TEMPLATE_LABELS[mail.template] ?? mail.template}</span>
              {`, ${dateLabel(mail.sentAt, "date inconnue")}, `}
              <span className={mail.status === "failed" ? "font-semibold text-danger" : "font-semibold text-primary-ink"}>{mail.status === "failed" ? "Échec" : "Envoyé"}</span>
              {mail.status === "failed" && mail.error ? ` : ${mail.error}` : ""}
            </li>
          ))}
        </ul>
      )}

      <form noValidate onSubmit={save} className="mt-6" aria-labelledby={`fiche-${attendeeId}-corriger`}>
        <h4 id={`fiche-${attendeeId}-corriger`} className="font-heading text-base font-semibold normal-case">
          Corriger la fiche
        </h4>
        <AttendeeFieldset id={`fiche-${attendeeId}`} values={values} errors={errors} onChange={setValues} />
        <button type="submit" disabled={busy} aria-busy={busy} className={`${primaryClass} mt-4`}>
          Enregistrer les corrections
        </button>
      </form>

      <div data-attendee-actions className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={sendLink} disabled={busy || cancelled} className={buttonClass}>
          Renvoyer un lien de connexion
        </button>
        {cancelled ? (
          <button type="button" onClick={restore} disabled={busy} className={buttonClass}>
            Réinscrire
          </button>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} disabled={busy} className={dangerClass}>
            Désinscrire
          </button>
        )}
      </div>

      {confirming && (
        <div role="alertdialog" aria-labelledby="desinscrire-confirm" className="mt-4 rounded-lg border-2 border-danger bg-white p-4">
          <p id="desinscrire-confirm" className="font-semibold">
            {`Désinscrire ${sheet.firstName} ${sheet.lastName} ? Ses rendez-vous en attente ou acceptés sont annulés et ses interlocuteurs prévenus par e-mail.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" onClick={cancel} disabled={busy} aria-busy={busy} className={dangerClass}>
              Confirmer la désinscription
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={buttonClass}>
              Annuler
            </button>
          </div>
        </div>
      )}
      <FeedbackArea feedback={notice} />
    </div>
  );
}
