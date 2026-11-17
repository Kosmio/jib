import React, { useEffect, useRef, useState } from "react";
import { plural } from "../../../lib/espace/format";
import AttendeeSheet, {
  AttendeeFieldset,
  ROLE_LABELS,
  createAttendee,
  failureText,
  inputClass,
  listAttendees,
  type AttendeeFields,
  type AttendeeList,
} from "./AttendeeSheet";
import { Card, FeedbackArea, LOAD_FAILED, type CardProps, type Feedback } from "./shared";
import { EspaceApiError } from "../../../lib/espace/client";

// F-134, F-136 : carte « Participants » du pilotage. Liste paginée avec recherche, filtres et tri ; ouvre la fiche (F-135) ;
// ajoute un invité. Le contrat des routes est dans AttendeeSheet.tsx.

const EMPTY_GUEST: AttendeeFields = { firstName: "", lastName: "", email: "", company: "", jobTitle: "", role: "participant" };
const SEARCH_DELAY_MS = 250;

const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-title bg-white px-5 font-bold text-title hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60";
const primaryClass = "inline-flex min-h-11 items-center justify-center rounded-lg bg-gold px-5 font-bold text-gold-ink hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60";

type Filters = { q: string; role: string; activated: string; visible: string; status: string; sort: string };

const FILTER_FIELDS: { name: Exclude<keyof Filters, "q">; label: string; options: [string, string][] }[] = [
  { name: "role", label: "Rôle", options: [["", "Tous les rôles"], ...Object.entries(ROLE_LABELS)] },
  { name: "status", label: "Inscription", options: [["", "Tous"], ["active", "Inscrits"], ["cancelled", "Désinscrits"]] },
  { name: "activated", label: "Espace", options: [["", "Activé ou non"], ["true", "Activé"], ["false", "Pas encore activé"]] },
  { name: "visible", label: "Annuaire", options: [["", "Visible ou non"], ["true", "Visible"], ["false", "Non visible"]] },
  { name: "sort", label: "Tri", options: [["name", "Par nom"], ["lastSeen", "Dernière connexion"]] },
];

export default function AttendeesCard({ edition, strapiUrl }: CardProps) {
  const [filters, setFilters] = useState<Filters>({ q: "", role: "", activated: "", visible: "", status: "", sort: "name" });
  const [query, setQuery] = useState(filters.q);
  const [page, setPage] = useState(1);
  const [list, setList] = useState<AttendeeList | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [guest, setGuest] = useState<AttendeeFields>(EMPTY_GUEST);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Feedback | null>(null);
  const latest = useRef(0);

  // La saisie de la recherche est différée : une requête par pause, pas une par touche.
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setFilters((current) => (current.q === query ? current : { ...current, q: query }));
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const load = () => {
    const call = ++latest.current;
    listAttendees(strapiUrl, edition, { ...filters, sort: filters.sort === "name" ? "" : filters.sort, page: page > 1 ? String(page) : "" }).then(
      (result) => {
        if (call !== latest.current) return;
        setList(result);
        setFailed(false);
      },
      () => call === latest.current && setFailed(true)
    );
  };

  useEffect(() => {
    if (!selected) load();
  }, [edition, strapiUrl, filters, page, selected]);

  async function addGuest(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setErrors({});
    setNotice(null);
    try {
      const created = await createAttendee(strapiUrl, edition, guest);
      setGuest(EMPTY_GUEST);
      setAdding(false);
      setNotice({ kind: "status", text: `${created.firstName} ${created.lastName} est ajouté. L’e-mail de bienvenue part selon les règles d’envoi (entre 8h00 et 20h00, après le premier envoi).` });
      load();
    } catch (failure) {
      if (failure instanceof EspaceApiError && (failure.code === "VALIDATION" || failure.code === "EMAIL_TAKEN")) setErrors(failure.fields);
      const text = failureText(failure, edition, "L’ajout a échoué. Réessayez.");
      if (text) setNotice({ kind: "alert", text });
    }
    setSaving(false);
  }

  if (selected) {
    return (
      <Card heading="Participants">
        <AttendeeSheet edition={edition} strapiUrl={strapiUrl} attendeeId={selected} onClose={() => setSelected(null)} />
      </Card>
    );
  }

  const setFilter = (name: keyof Filters, value: string) => {
    setPage(1);
    setFilters({ ...filters, [name]: value });
  };

  return (
    <Card heading="Participants">
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1">
          <label htmlFor="participants-recherche" className="block font-semibold">
            Rechercher un inscrit
          </label>
          <input
            id="participants-recherche"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nom, entreprise ou adresse e-mail"
            className={inputClass(false)}
          />
        </div>
        <button type="button" onClick={() => setAdding(!adding)} aria-expanded={adding} className={buttonClass}>
          Ajouter un invité
        </button>
      </div>

      {adding && (
        <form noValidate onSubmit={addGuest} aria-labelledby="invite-titre" className="mt-4 rounded-lg border border-surface-alt bg-surface p-4">
          <h3 id="invite-titre" className="font-heading text-base font-semibold normal-case">
            Ajouter un invité
          </h3>
          <AttendeeFieldset id="invite" values={guest} errors={errors} onChange={setGuest} />
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="submit" disabled={saving} aria-busy={saving} className={primaryClass}>
              Ajouter l’invité
            </button>
            <button type="button" onClick={() => setAdding(false)} disabled={saving} className={buttonClass}>
              Annuler
            </button>
          </div>
        </form>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {FILTER_FIELDS.map(({ name, label, options }) => (
          <div key={name}>
            <label htmlFor={`participants-${name}`} className="block text-sm font-semibold">
              {label}
            </label>
            <select id={`participants-${name}`} value={filters[name]} onChange={(event) => setFilter(name, event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border-2 border-accent bg-white px-3">
              {options.map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <FeedbackArea feedback={notice ?? (failed ? { kind: "alert", text: LOAD_FAILED } : null)} />

      <p role="status" className="mt-4 text-muted">
        {list ? (list.total === 0 ? "Aucun inscrit ne correspond." : `${plural(list.total, "inscrit")}, page ${list.page} sur ${list.pages}.`) : "Chargement…"}
      </p>

      {list && list.items.length > 0 && (
        <ul className="mt-2 divide-y divide-surface-alt rounded-lg border border-surface-alt">
          {list.items.map((attendee) => (
            <li key={attendee.id}>
              <button
                type="button"
                onClick={() => setSelected(attendee.id)}
                aria-label={`Ouvrir la fiche de ${attendee.firstName} ${attendee.lastName}`}
                className="flex min-h-14 w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 text-left hover:bg-surface"
              >
                <span>
                  <span className="block font-semibold text-title">{`${attendee.firstName} ${attendee.lastName}`}</span>
                  <span className="block text-muted">{[attendee.company, attendee.email].filter(Boolean).join(", ")}</span>
                </span>
                <span className="text-sm text-muted">
                  {[ROLE_LABELS[attendee.role] ?? attendee.role, attendee.status === "cancelled" ? "Désinscrit" : null, attendee.activated ? "Espace activé" : "Pas encore connecté", attendee.manual ? "Invité" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {list && list.pages > 1 && (
        <nav aria-label="Pages des inscrits" className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={() => setPage(list.page - 1)} disabled={list.page <= 1} className={buttonClass}>
            Page précédente
          </button>
          <button type="button" onClick={() => setPage(list.page + 1)} disabled={list.page >= list.pages} className={buttonClass}>
            Page suivante
          </button>
        </nav>
      )}
    </Card>
  );
}
