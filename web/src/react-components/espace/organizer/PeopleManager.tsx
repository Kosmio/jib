import React, { useEffect, useId, useRef, useState } from "react";
import { EspaceApiError, request } from "../../../lib/espace/client";
import { plural } from "../../../lib/espace/format";
import { strapiAdminUrl, STRAPI_UID } from "../../../lib/espace/strapi-links";
import AttendeeSheet, { AttendeeFieldset, createAttendee, listAttendees, ROLE_LABELS, type AttendeeFields, type AttendeeList } from "./AttendeeSheet";
import { FeedbackArea, type Feedback } from "./shared";
import { buttonPrimary, buttonQuiet, buttonSecondary, controlClass, failure, Field, HelpLink, StrapiLink } from "./ui";

// Écran « Personnes » de l'interface organisation (15-administration.md, AD-2) : personnes de l'édition et leurs rôles cumulés
// (D-20, F-170, F-171, F-173), organisations et exposants (F-169, F-172). La fiche d'une personne reprend celle du pilotage (F-135).

type Props = { edition: string; strapiUrl: string; tablesCount: number };

type Organisation = {
  id: string;
  name: string;
  website: string;
  linkedinUrl: string;
  description: string;
  logoUrl: string | null;
  updatedAt: string;
  exhibitor: { id: string; standNumber: string; representatives: { id: string; name: string }[] } | null;
};
type OrganisationList = { total: number; exhibitors: number; items: Organisation[] };
type Intervenant = { id: string; name: string; title: string; organisation: string; linkedTo: { id: string; name: string } | null };
type Roles = {
  id: string;
  name: string;
  role: string;
  roles: { participant: boolean; speaker: boolean; exhibitor: boolean; organizer: boolean; listedOrganizer: boolean };
  speaker: { id: string; name: string; title: string } | null;
  exhibitor: { id: string; organisationId: string | null; name: string; standNumber: string } | null;
  hostedTableNumber: number | null;
};

const enc = encodeURIComponent;
const ROLE_FILTERS: [string, string][] = [
  ["", "Tous les rôles"],
  ["speaker", "Intervenants"],
  ["exhibitor_rep", "Représentants d’exposant"],
  ["organizer", "Organisateurs"],
  ["participant", "Participants"],
];
const EMPTY_PERSON: AttendeeFields = { firstName: "", lastName: "", email: "", company: "", jobTitle: "", role: "participant" };

/** Valeur stabilisée après une pause de frappe, pour ne pas interroger le serveur à chaque touche. */
function useDebounced<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

export default function PeopleManager({ edition, strapiUrl, tablesCount }: Props) {
  const [view, setView] = useState<"people" | "organisations">(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("vue") === "organisations" ? "organisations" : "people",
  );
  const [personId, setPersonId] = useState<string | null>(null);

  function show(next: "people" | "organisations") {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "organisations") url.searchParams.set("vue", "organisations");
    else url.searchParams.delete("vue");
    window.history.replaceState(null, "", url);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Afficher" className="inline-flex rounded-lg border-2 border-title p-0.5">
          {(
            [
              ["people", "Personnes"],
              ["organisations", "Organisations et exposants"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              onClick={() => show(id)}
              className={`min-h-10 rounded-md px-4 font-semibold ${view === id ? "bg-title text-white" : "text-title hover:bg-surface"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <HelpLink edition={edition} page="personnes" label="organisations, personnes et rôles" />
      </div>
      {view === "people" ? (
        <PeoplePane edition={edition} strapiUrl={strapiUrl} tablesCount={tablesCount} personId={personId} onOpen={setPersonId} />
      ) : (
        <OrganisationsPane
          edition={edition}
          strapiUrl={strapiUrl}
          onOpenPerson={(id) => {
            setPersonId(id);
            show("people");
          }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Personnes */

function PeoplePane({ edition, strapiUrl, tablesCount, personId, onOpen }: Props & { personId: string | null; onOpen: (id: string | null) => void }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [list, setList] = useState<AttendeeList | null>(null);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [person, setPerson] = useState<AttendeeFields>(EMPTY_PERSON);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const q = useDebounced(query);

  useEffect(() => {
    let current = true;
    listAttendees(strapiUrl, edition, { q, role, page: String(page) })
      .then((result) => current && setList(result))
      .catch(() => current && setFeedback({ kind: "alert", text: "La liste n’a pas pu être chargée. Rechargez la page." }));
    return () => {
      current = false;
    };
  }, [q, role, page, version]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setFeedback(null);
    try {
      const created = await createAttendee(strapiUrl, edition, person);
      setAdding(false);
      setPerson(EMPTY_PERSON);
      setVersion((n) => n + 1);
      onOpen(created.id);
      setFeedback({ kind: "status", text: `${created.firstName} ${created.lastName} est ajouté. Aucun e-mail n’est parti : le lien de connexion s’envoie depuis sa fiche ou la carte « E-mail de bienvenue ».` });
    } catch (error) {
      const result = failure(error, "L’ajout n’a pas abouti. Réessayez.");
      setErrors(result.fields);
      setFeedback(result.feedback);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(20rem,2fr)_3fr]">
      <section aria-labelledby="personnes-liste" className={`rounded-xl border border-surface-alt bg-white p-5 ${personId ? "max-lg:hidden" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="personnes-liste" className="font-heading text-xl font-semibold normal-case">
            Personnes {list && <span className="text-base font-normal text-muted">({list.total})</span>}
          </h2>
          <button type="button" className={buttonSecondary} aria-expanded={adding} onClick={() => setAdding(!adding)}>
            Ajouter une personne
          </button>
        </div>
        {adding && (
          <form noValidate onSubmit={add} className="mt-4 rounded-lg bg-surface p-4">
            <p className="font-semibold">Nouvelle personne</p>
            <p className="text-sm text-muted">Inscrite à la main, elle ne sera ni dupliquée ni retirée par HelloAsso : un billet à la même adresse la rejoint.</p>
            <AttendeeFieldset id="nouvelle-personne" values={person} errors={errors} onChange={setPerson} />
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="submit" className={buttonPrimary} disabled={saving}>
                {saving ? "Ajout…" : "Ajouter"}
              </button>
              <button type="button" className={buttonSecondary} onClick={() => setAdding(false)}>
                Annuler
              </button>
            </div>
          </form>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-[3fr_2fr]">
          <Field
            label="Rechercher"
            render={(p) => (
              <input
                {...p}
                type="search"
                className={controlClass()}
                value={query}
                placeholder="Nom, entreprise, e-mail"
                onChange={(event) => {
                  setPage(1);
                  setQuery(event.target.value);
                }}
              />
            )}
          />
          <Field
            label="Rôle"
            render={(p) => (
              <select
                {...p}
                className={controlClass()}
                value={role}
                onChange={(event) => {
                  setPage(1);
                  setRole(event.target.value);
                }}
              >
                {ROLE_FILTERS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          />
        </div>
        <FeedbackArea feedback={feedback} />
        {list && list.items.length === 0 && <p className="mt-4 text-muted">Personne ne correspond à cette recherche.</p>}
        <ul className="mt-3 divide-y divide-surface-alt">
          {list?.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-current={item.id === personId ? "true" : undefined}
                onClick={() => onOpen(item.id)}
                className={`flex w-full flex-wrap items-baseline justify-between gap-x-3 px-2 py-2.5 text-left hover:bg-surface ${item.id === personId ? "bg-surface" : ""} ${item.status === "cancelled" ? "text-muted" : ""}`}
              >
                <span className="min-w-0">
                  <span className="font-semibold">
                    {item.firstName} {item.lastName}
                  </span>
                  {item.company && <span className="block text-sm text-muted">{item.company}</span>}
                </span>
                <span className="text-sm text-muted">
                  {item.status === "cancelled" ? "Désinscrit" : ROLE_LABELS[item.role] ?? item.role}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {list && list.pages > 1 && (
          <div className="mt-3 flex items-center justify-between gap-2">
            <button type="button" className={buttonQuiet} disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Précédentes
            </button>
            <span className="text-sm text-muted">
              Page {list.page} sur {list.pages}
            </span>
            <button type="button" className={buttonQuiet} disabled={page >= list.pages} onClick={() => setPage(page + 1)}>
              Suivantes
            </button>
          </div>
        )}
      </section>

      <div className={personId ? "" : "max-lg:hidden"}>
        {personId ? (
          <div className="space-y-6">
            <RolesEditor key={personId} edition={edition} strapiUrl={strapiUrl} tablesCount={tablesCount} attendeeId={personId} onChanged={() => setVersion((n) => n + 1)} />
            <section className="rounded-xl border border-surface-alt bg-white p-5" aria-label="Fiche de la personne">
              <AttendeeSheet
                key={`${personId}-${version}`}
                edition={edition}
                strapiUrl={strapiUrl}
                attendeeId={personId}
                onClose={() => {
                  onOpen(null);
                  setVersion((n) => n + 1);
                }}
              />
            </section>
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-surface-alt p-8 text-center text-muted">
            Choisissez une personne pour voir sa fiche et régler ses rôles.
          </div>
        )}
      </div>
    </div>
  );
}

function RolesEditor({ edition, strapiUrl, tablesCount, attendeeId, onChanged }: { edition: string; strapiUrl: string; tablesCount: number; attendeeId: string; onChanged: () => void }) {
  const [roles, setRoles] = useState<Roles | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState<"speaker" | "exhibitor" | null>(null);
  const path = `/admin/${enc(edition)}/attendees/${enc(attendeeId)}/roles`;

  useEffect(() => {
    request<Roles>(strapiUrl, path, "GET")
      .then(setRoles)
      .catch(() => setFeedback({ kind: "alert", text: "Les rôles n’ont pas pu être chargés." }));
  }, [attendeeId]);

  async function save(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setFeedback(null);
    try {
      setRoles(await request<Roles>(strapiUrl, path, "PATCH", body));
      setChoosing(null);
      setFeedback({ kind: "status", text: done });
      onChanged();
    } catch (error) {
      setFeedback(failure(error).feedback);
    } finally {
      setBusy(false);
    }
  }

  if (!roles) return <FeedbackArea feedback={feedback} />;
  const { roles: has } = roles;

  return (
    <section aria-labelledby="roles-titre" className="rounded-xl border border-surface-alt bg-white p-5">
      <h2 id="roles-titre" className="font-heading text-xl font-semibold normal-case">
        {roles.name || "Rôles"}
        <span className="block text-base font-normal text-muted">Rôles dans l’édition</span>
      </h2>
      <p className="mt-1 text-sm text-muted">Une personne peut en cumuler plusieurs. Le badge et l’annuaire affichent le premier dans l’ordre organisateur, intervenant, exposant, participant.</p>
      <ul className="mt-4 space-y-4">
        <RoleRow label="Participant" checked={has.participant} disabled description={has.participant ? "Tout inscrit actif est participant." : "Désinscrit : rétablissez l’inscription dans la fiche."} />

        <RoleRow
          label="Intervenant"
          checked={has.speaker || choosing === "speaker"}
          disabled={busy}
          onToggle={(on) => (on ? setChoosing("speaker") : roles.speaker ? void save({ speaker: null }, "Rôle d’intervenant retiré.") : setChoosing(null))}
          description={roles.speaker ? `Rattaché à la fiche intervenant « ${roles.speaker.name} »${roles.speaker.title ? `, ${roles.speaker.title}` : ""}.` : "Lié à une fiche intervenant du programme."}
        >
          {roles.speaker && (
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <Field
                label="Table dédiée"
                hint="Les rendez-vous qu’on lui demande s’y tiennent."
                render={(p) => (
                  <select
                    {...p}
                    className={controlClass()}
                    value={roles.hostedTableNumber ?? ""}
                    disabled={busy}
                    onChange={(event) => void save({ hostedTableNumber: event.target.value ? Number(event.target.value) : null }, event.target.value ? `Table ${event.target.value} dédiée.` : "Plus de table dédiée.")}
                  >
                    <option value="">Aucune</option>
                    {Array.from({ length: tablesCount }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        Table {n}
                      </option>
                    ))}
                  </select>
                )}
              />
              <StrapiLink href={strapiAdminUrl(strapiUrl, STRAPI_UID.intervenant, roles.speaker.id)} label="Fiche intervenant dans Strapi" />
            </div>
          )}
          {choosing === "speaker" && !roles.speaker && (
            <SpeakerChooser edition={edition} strapiUrl={strapiUrl} busy={busy} onPick={(id, name) => void save({ speaker: id }, `Rattaché à « ${name} ».`)} onCreate={() => void save({ speaker: "new" }, "Fiche intervenant créée à partir de la personne.")} onCancel={() => setChoosing(null)} />
          )}
        </RoleRow>

        <RoleRow
          label="Exposant"
          checked={has.exhibitor || choosing === "exhibitor"}
          disabled={busy}
          onToggle={(on) => (on ? setChoosing("exhibitor") : roles.exhibitor ? void save({ exhibitor: null }, "Rôle d’exposant retiré.") : setChoosing(null))}
          description={
            roles.exhibitor
              ? `Représente « ${roles.exhibitor.name} »${roles.exhibitor.standNumber ? `, stand ${roles.exhibitor.standNumber}` : ""}. Les demandes adressées au stand lui arrivent.`
              : "Représente une organisation qui expose."
          }
        >
          {choosing === "exhibitor" && !roles.exhibitor && (
            <ExhibitorChooser edition={edition} strapiUrl={strapiUrl} busy={busy} onPick={(id, name, standNumber) => void save({ exhibitor: id, standNumber }, `Représente maintenant « ${name} ».`)} onCancel={() => setChoosing(null)} />
          )}
        </RoleRow>

        <RoleRow
          label="Organisateur"
          checked={has.organizer}
          disabled={busy || has.listedOrganizer}
          onToggle={(on) => void save({ organizer: on }, on ? "Devient organisateur : accès à l’interface organisation." : "N’est plus organisateur.")}
          description={has.listedOrganizer ? "Organisateur par la configuration du serveur (ORGANIZER_EMAILS) : ne se change pas ici." : "Accès à l’interface organisation de l’édition."}
        />
      </ul>
      <FeedbackArea feedback={feedback} />
    </section>
  );
}

function RoleRow({
  label,
  checked,
  disabled,
  description,
  onToggle,
  children,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  description: string;
  onToggle?: (on: boolean) => void;
  children?: React.ReactNode;
}) {
  const id = useId();
  return (
    <li>
      <div className="flex items-start gap-3">
        <input id={id} type="checkbox" className="mt-0.5 size-6 shrink-0 accent-primary-dark" checked={checked} disabled={disabled || !onToggle} onChange={(event) => onToggle?.(event.target.checked)} aria-describedby={`${id}-desc`} />
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="font-semibold">
            {label}
          </label>
          <p id={`${id}-desc`} className="text-sm text-muted">
            {description}
          </p>
          {children}
        </div>
      </div>
    </li>
  );
}

function SpeakerChooser({ edition, strapiUrl, busy, onPick, onCreate, onCancel }: { edition: string; strapiUrl: string; busy: boolean; onPick: (id: string, name: string) => void; onCreate: () => void; onCancel: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Intervenant[]>([]);
  const q = useDebounced(query);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    request<Intervenant[]>(strapiUrl, `/admin/${enc(edition)}/intervenants?q=${enc(q)}`, "GET").then(setResults, () => setResults([]));
  }, [q]);
  return (
    <div className="mt-3 rounded-lg bg-surface p-4">
      <label htmlFor="intervenant-recherche" className="block font-semibold">
        Fiche intervenant du programme
      </label>
      <input ref={input} id="intervenant-recherche" type="search" className={controlClass()} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom ou organisation" />
      <ul className="mt-2 max-h-64 divide-y divide-surface-alt overflow-y-auto rounded-lg bg-white">
        {results.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0">
              <span className="font-semibold">{item.name}</span>
              <span className="block text-sm text-muted">{[item.title, item.organisation].filter(Boolean).join(", ")}</span>
              {item.linkedTo && <span className="block text-sm text-wood-dark">Déjà rattachée à {item.linkedTo.name}</span>}
            </span>
            <button type="button" className={buttonSecondary} disabled={busy || Boolean(item.linkedTo)} onClick={() => onPick(item.id, item.name)}>
              Rattacher
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="px-3 py-2 text-sm text-muted">Aucune fiche intervenant ne correspond.</li>}
      </ul>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" className={buttonPrimary} disabled={busy} onClick={onCreate}>
          Créer une fiche à partir de la personne
        </button>
        <button type="button" className={buttonSecondary} onClick={onCancel}>
          Annuler
        </button>
      </div>
    </div>
  );
}

function ExhibitorChooser({ edition, strapiUrl, busy, onPick, onCancel }: { edition: string; strapiUrl: string; busy: boolean; onPick: (id: string, name: string, standNumber: string) => void; onCancel: () => void }) {
  const [query, setQuery] = useState("");
  const [stand, setStand] = useState("");
  const [results, setResults] = useState<Organisation[]>([]);
  const q = useDebounced(query);
  useEffect(() => {
    request<OrganisationList>(strapiUrl, `/admin/${enc(edition)}/organisations?q=${enc(q)}`, "GET").then((list) => setResults(list.items.slice(0, 12)), () => setResults([]));
  }, [q]);
  return (
    <div className="mt-3 rounded-lg bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-[3fr_1fr]">
        <Field label="Organisation" render={(p) => <input {...p} type="search" autoFocus className={controlClass()} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom de l’organisation" />} />
        <Field label="Stand" hint="Facultatif." render={(p) => <input {...p} className={controlClass()} value={stand} maxLength={20} onChange={(event) => setStand(event.target.value)} />} />
      </div>
      <ul className="mt-2 max-h-64 divide-y divide-surface-alt overflow-y-auto rounded-lg bg-white">
        {results.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span>
              <span className="font-semibold">{item.name}</span>
              {item.exhibitor && <span className="ml-2 text-sm text-muted">exposant{item.exhibitor.standNumber ? `, stand ${item.exhibitor.standNumber}` : ""}</span>}
            </span>
            <button type="button" className={buttonSecondary} disabled={busy} onClick={() => onPick(item.id, item.name, stand)}>
              Choisir
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="px-3 py-2 text-sm text-muted">Aucune organisation : créez-la dans « Organisations et exposants ».</li>}
      </ul>
      <button type="button" className={`${buttonSecondary} mt-3`} onClick={onCancel}>
        Annuler
      </button>
    </div>
  );
}

/* ----------------------------------------------------------- Organisations */

function OrganisationsPane({ edition, strapiUrl, onOpenPerson }: { edition: string; strapiUrl: string; onOpenPerson: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [onlyExhibitors, setOnlyExhibitors] = useState(true);
  const [list, setList] = useState<OrganisationList | null>(null);
  const [selected, setSelected] = useState<Organisation | null>(null);
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);
  const q = useDebounced(query);

  useEffect(() => {
    request<OrganisationList>(strapiUrl, `/admin/${enc(edition)}/organisations?q=${enc(q)}${onlyExhibitors && !q ? "&exhibitors=true" : ""}`, "GET").then(setList, () => setList({ total: 0, exhibitors: 0, items: [] }));
  }, [q, onlyExhibitors, version]);

  const refresh = (organisation: Organisation) => {
    setSelected(organisation);
    setVersion((n) => n + 1);
  };

  return (
    <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(20rem,2fr)_3fr]">
      <section aria-labelledby="organisations-liste" className={`rounded-xl border border-surface-alt bg-white p-5 ${selected || creating ? "max-lg:hidden" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="organisations-liste" className="font-heading text-xl font-semibold normal-case">
            Organisations {list && <span className="text-base font-normal text-muted">({plural(list.exhibitors, "exposant")})</span>}
          </h2>
          <button
            type="button"
            className={buttonSecondary}
            onClick={() => {
              setSelected(null);
              setCreating(true);
            }}
          >
            Nouvelle organisation
          </button>
        </div>
        <div className="mt-4">
          <Field label="Rechercher" hint={q ? "Toutes les organisations, exposants en premier." : undefined} render={(p) => <input {...p} type="search" className={controlClass()} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom de l’organisation" />} />
          {!q && (
            <label className="mt-3 flex items-center gap-2 font-semibold">
              <input type="checkbox" className="size-5 accent-primary-dark" checked={onlyExhibitors} onChange={(event) => setOnlyExhibitors(event.target.checked)} />
              Exposants de l’édition seulement
            </label>
          )}
        </div>
        {list && list.items.length === 0 && <p className="mt-4 text-muted">{onlyExhibitors && !q ? "Aucun exposant pour l’instant. Cherchez une organisation pour en faire un exposant." : "Aucune organisation ne correspond."}</p>}
        <ul className="mt-3 divide-y divide-surface-alt">
          {list?.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-current={item.id === selected?.id ? "true" : undefined}
                onClick={() => {
                  setCreating(false);
                  setSelected(item);
                }}
                className={`flex w-full items-baseline justify-between gap-3 px-2 py-2.5 text-left hover:bg-surface ${item.id === selected?.id ? "bg-surface" : ""}`}
              >
                <span className="font-semibold">{item.name}</span>
                {item.exhibitor && (
                  <span className="shrink-0 text-sm text-muted">
                    {item.exhibitor.standNumber ? `Stand ${item.exhibitor.standNumber}` : "Exposant"}, {plural(item.exhibitor.representatives.length, "représentant")}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {list && list.total > list.items.length && <p className="mt-2 text-sm text-muted">{list.items.length} premières sur {list.total} : affinez la recherche.</p>}
      </section>

      <div className={selected || creating ? "" : "max-lg:hidden"}>
        {creating ? (
          <OrganisationForm
            key="new"
            edition={edition}
            strapiUrl={strapiUrl}
            onDone={(organisation) => {
              setCreating(false);
              refresh(organisation);
            }}
            onCancel={() => setCreating(false)}
            onPickExisting={(id, name) => {
              setCreating(false);
              setQuery(name);
              request<OrganisationList>(strapiUrl, `/admin/${enc(edition)}/organisations?q=${enc(name)}`, "GET").then(
                (found) => setSelected(found.items.find((item) => item.id === id) ?? null),
                () => setSelected(null),
              );
            }}
          />
        ) : selected ? (
          <OrganisationForm key={selected.id} edition={edition} strapiUrl={strapiUrl} organisation={selected} onDone={refresh} onCancel={() => setSelected(null)} onOpenPerson={onOpenPerson} />
        ) : (
          <div className="rounded-xl border-2 border-dashed border-surface-alt p-8 text-center text-muted">Choisissez une organisation pour la modifier ou en faire un exposant.</div>
        )}
      </div>
    </div>
  );
}

function OrganisationForm({
  edition,
  strapiUrl,
  organisation,
  onDone,
  onCancel,
  onPickExisting,
  onOpenPerson,
}: {
  edition: string;
  strapiUrl: string;
  organisation?: Organisation;
  onDone: (organisation: Organisation) => void;
  onCancel: () => void;
  onPickExisting?: (id: string, name: string) => void;
  onOpenPerson?: (id: string) => void;
}) {
  const initial = { name: organisation?.name ?? "", website: organisation?.website ?? "", linkedinUrl: organisation?.linkedinUrl ?? "", description: organisation?.description ?? "" };
  const [form, setForm] = useState(initial);
  const [exhibitor, setExhibitor] = useState({ enabled: Boolean(organisation?.exhibitor), standNumber: organisation?.exhibitor?.standNumber ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [candidates, setCandidates] = useState<{ id: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/admin/${enc(edition)}/organisations`;
  const dirty = JSON.stringify(form) !== JSON.stringify(initial) || exhibitor.enabled !== Boolean(organisation?.exhibitor) || exhibitor.standNumber !== (organisation?.exhibitor?.standNumber ?? "");

  async function submit(force = false) {
    setBusy(true);
    setErrors({});
    setFeedback(null);
    try {
      const saved = organisation
        ? await request<Organisation>(strapiUrl, `${base}/${enc(organisation.id)}`, "PATCH", { ...form, updatedAt: organisation.updatedAt, exhibitor })
        : await request<Organisation>(strapiUrl, base, "POST", { ...form, force });
      if (!organisation && exhibitor.enabled) {
        onDone(await request<Organisation>(strapiUrl, `${base}/${enc(saved.id)}`, "PATCH", { exhibitor }));
      } else onDone(saved);
      setCandidates(null);
      setFeedback({ kind: "status", text: organisation ? "Organisation enregistrée." : "Organisation créée." });
    } catch (error) {
      const result = failure(error);
      if (result.code === "SIMILAR_ORGANISATIONS" && error instanceof EspaceApiError) {
        setCandidates((error.details.candidates as { id: string; name: string }[] | undefined) ?? []);
      }
      setErrors(result.fields);
      setFeedback(result.feedback);
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: event.target.value });

  return (
    <section aria-labelledby="organisation-titre" className="rounded-xl border border-surface-alt bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id="organisation-titre" className="font-heading text-xl font-semibold normal-case">
          {organisation ? organisation.name : "Nouvelle organisation"}
        </h2>
        <div className="flex flex-wrap gap-1">
          {organisation && <StrapiLink href={strapiAdminUrl(strapiUrl, STRAPI_UID.organisation, organisation.id)} />}
          {organisation?.exhibitor && <StrapiLink href={strapiAdminUrl(strapiUrl, STRAPI_UID.exhibitor, organisation.exhibitor.id)} label="Exposant dans Strapi" />}
        </div>
      </div>
      {!organisation && <p className="mt-1 text-sm text-muted">Les organisations existantes sont proposées avant toute création, pour éviter les doublons.</p>}
      <form
        noValidate
        className="mt-4 grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Nom" required error={errors.name} className="md:col-span-2" render={(p) => <input {...p} className={controlClass(!!errors.name)} value={form.name} onChange={set("name")} />} />
        <Field label="Site web" error={errors.website} render={(p) => <input {...p} type="url" inputMode="url" placeholder="https://" className={controlClass(!!errors.website)} value={form.website} onChange={set("website")} />} />
        <Field label="Page LinkedIn" error={errors.linkedinUrl} render={(p) => <input {...p} type="url" inputMode="url" placeholder="https://www.linkedin.com/company/…" className={controlClass(!!errors.linkedinUrl)} value={form.linkedinUrl} onChange={set("linkedinUrl")} />} />
        <Field label="Description courte" hint="Deux ou trois phrases, affichées sur la fiche de l’exposant." error={errors.description} className="md:col-span-2" render={(p) => <textarea {...p} rows={3} maxLength={500} className={`${controlClass(!!errors.description)} py-2`} value={form.description} onChange={set("description")} />} />

        <fieldset className="rounded-lg border border-surface-alt p-4 md:col-span-2">
          <legend className="px-1 font-semibold">Exposant de cette édition</legend>
          <label className="flex items-center gap-3 font-semibold">
            <input type="checkbox" className="size-6 accent-primary-dark" checked={exhibitor.enabled} onChange={(event) => setExhibitor({ ...exhibitor, enabled: event.target.checked })} />
            Expose à cette édition
          </label>
          {exhibitor.enabled && (
            <div className="mt-3 max-w-48">
              <Field label="Numéro de stand" hint="Facultatif." render={(p) => <input {...p} maxLength={20} className={controlClass()} value={exhibitor.standNumber} onChange={(event) => setExhibitor({ ...exhibitor, standNumber: event.target.value })} />} />
            </div>
          )}
          {organisation?.exhibitor && (
            <div className="mt-4">
              <p className="font-semibold">Représentants</p>
              {organisation.exhibitor.representatives.length ? (
                <ul className="mt-1 flex flex-wrap gap-2">
                  {organisation.exhibitor.representatives.map((person) => (
                    <li key={person.id}>
                      <button type="button" className="min-h-10 rounded-full bg-surface px-3 font-semibold text-title hover:underline" onClick={() => onOpenPerson?.(person.id)}>
                        {person.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Aucun : dans « Personnes », cochez « Exposant » sur la fiche d’une personne pour la rattacher.</p>
              )}
            </div>
          )}
        </fieldset>

        {candidates && candidates.length > 0 && (
          <div role="alertdialog" aria-labelledby="doublons" className="rounded-lg border-2 border-title bg-white p-4 md:col-span-2">
            <p id="doublons" className="font-semibold">
              Elle existe peut-être déjà
            </p>
            <ul className="mt-2 space-y-1">
              {candidates.map((candidate) => (
                <li key={candidate.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{candidate.name}</span>
                  <button type="button" className={buttonSecondary} onClick={() => onPickExisting?.(candidate.id, candidate.name)}>
                    Utiliser celle-ci
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className={`${buttonQuiet} mt-2`} disabled={busy} onClick={() => void submit(true)}>
              Non, créer « {form.name} » quand même
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-3 md:col-span-2">
          <button type="submit" className={buttonPrimary} disabled={busy || !dirty}>
            {busy ? "Enregistrement…" : organisation ? "Enregistrer" : "Créer l’organisation"}
          </button>
          <button type="button" className={buttonSecondary} onClick={onCancel}>
            {organisation ? "Fermer" : "Annuler"}
          </button>
        </div>
      </form>
      <FeedbackArea feedback={feedback} />
    </section>
  );
}
