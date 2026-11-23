import React, { useEffect, useState } from "react";
import { request } from "../../../lib/espace/client";
import { plural } from "../../../lib/espace/format";
import { regenerateSlots } from "../../../lib/espace/admin";
import { programThemes, type ProgramTheme } from "../../../lib/program-themes";
import { strapiAdminUrl, STRAPI_UID } from "../../../lib/espace/strapi-links";
import RichText, { displayHtml } from "./RichText";
import { FeedbackArea, type Feedback } from "./shared";
import { buttonDanger, buttonPrimary, buttonQuiet, buttonSecondary, controlClass, failure, Field, HelpLink, StrapiLink } from "./ui";

// Éditeur du programme de l'interface organisation (15-administration.md, AD-3) : la journée se présente comme la page publique,
// séquence par séquence dans l'ordre horaire, chaque bloc modifiable sur place (F-160 à F-163). Tout s'écrit sur le brouillon ;
// « Publier le programme » met en ligne d'un coup (D-22, F-164), puis propose de régénérer les créneaux si les pauses ont changé (F-165).

type State = "new" | "modified" | "published";
type Speaker = {
  id: string;
  name: string;
  title: string;
  organisation: { id: string; name: string } | null;
  bio: string;
  topic: string;
  linkedinUrl: string;
  photoUrl: string | null;
  state: State;
  updatedAt: string;
};
type Intervention = { id: string; description: string; order: number; presentation: { name: string; url: string } | null; speakers: Speaker[]; state: State; updatedAt: string };
type Sequence = {
  id: string;
  title: string;
  subtitle: string;
  startTime: string;
  endTime: string;
  kind: "talk" | "b2b_break" | "other";
  theme: string;
  description: string;
  order: number;
  organisations: { id: string; name: string }[];
  state: State;
  updatedAt: string;
  interventions: Intervention[];
};
export type ProgramData = { editionId: string; themes: string[]; sequences: Sequence[]; changes: { kind: string; id: string; label: string; state: State }[] };

type Props = { edition: string; strapiUrl: string; publicPath: string; initial: ProgramData };
type Api = (method: string, path: string, body?: unknown) => Promise<ProgramData>;

const enc = encodeURIComponent;
const KIND_LABELS = { talk: "Intervention", b2b_break: "Pause B2B", other: "Autre (accueil, déjeuner…)" };
const THEME_LABELS: Record<string, string> = { foret: "Forêt", industrie: "Industrie", coproduits: "Coproduits", ville: "Ville", construction: "Construction" };
const STATE_LABELS: Record<State, string> = { new: "Nouveau", modified: "Modifié", published: "" };
const minutes = (value: string) => {
  const match = /^(\d{1,2})\s*[h:]\s*(\d{2})?$/i.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2] ?? 0) : Number.POSITIVE_INFINITY;
};

function StateTag({ state }: { state: State }) {
  if (state === "published") return null;
  return <span className="rounded-full border border-wood px-2 py-0.5 text-xs font-bold text-wood-dark">{STATE_LABELS[state]}</span>;
}

export default function ProgramEditor({ edition, strapiUrl, publicPath, initial }: Props) {
  const [program, setProgram] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/admin/${enc(edition)}`;

  const api: Api = async (method, path, body) => {
    const fresh = await request<ProgramData>(strapiUrl, `${base}${path}`, method, body);
    setProgram(fresh);
    return fresh;
  };

  /** Une action : rend vrai en cas de succès, sinon affiche l'échec (et les erreurs par champ au formulaire appelant). */
  async function run(action: () => Promise<unknown>, done?: string): Promise<{ ok: boolean; fields: Record<string, string> }> {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
      if (done) setFeedback({ kind: "status", text: done });
      return { ok: true, fields: {} };
    } catch (error) {
      const result = failure(error);
      setFeedback(result.feedback);
      return { ok: false, fields: result.fields };
    } finally {
      setBusy(false);
    }
  }

  const ctx = { edition, strapiUrl, api, run, busy, editing, setEditing };

  return (
    <div>
      <PublishBar edition={edition} strapiUrl={strapiUrl} publicPath={publicPath} program={program} onPublished={setProgram} />
      <FeedbackArea feedback={feedback} />
      {program.sequences.length === 0 && (
        <div className="mt-6 rounded-xl border-2 border-dashed border-surface-alt p-8 text-center">
          <p className="font-semibold">Le programme est vide.</p>
          <p className="mt-1 text-muted">Ajoutez la première séquence de la journée : accueil, table ronde, pause B2B…</p>
        </div>
      )}
      <ol className="mt-6 space-y-4">
        {program.sequences.map((sequence, index) => (
          <SequenceBlock key={sequence.id} sequence={sequence} siblings={program.sequences.filter((other) => minutes(other.startTime) === minutes(sequence.startTime))} index={index} {...ctx} />
        ))}
      </ol>
      <NewSequence {...ctx} />
    </div>
  );
}

type Ctx = {
  edition: string;
  strapiUrl: string;
  api: Api;
  run: (action: () => Promise<unknown>, done?: string) => Promise<{ ok: boolean; fields: Record<string, string> }>;
  busy: boolean;
  editing: string | null;
  setEditing: (id: string | null) => void;
};

function PublishBar({ edition, strapiUrl, publicPath, program, onPublished }: { edition: string; strapiUrl: string; publicPath: string; program: ProgramData; onPublished: (p: ProgramData) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [offerSlots, setOfferSlots] = useState(false);
  const count = program.changes.length;

  async function publish() {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await request<{ published: { sequences: number; interventions: number; intervenants: number }; breaksChanged: boolean; program: ProgramData }>(strapiUrl, `/admin/${enc(edition)}/program/publish`, "POST");
      onPublished(result.program);
      setConfirming(false);
      setOfferSlots(result.breaksChanged);
      const { sequences, interventions, intervenants } = result.published;
      setFeedback({ kind: "status", text: `Programme publié : ${plural(sequences, "séquence")}, ${plural(interventions, "intervention")}, ${plural(intervenants, "intervenant")}. La page publique est à jour.` });
    } catch (error) {
      setFeedback(failure(error, "La publication n’a pas abouti. Réessayez.").feedback);
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    setBusy(true);
    try {
      const report = await regenerateSlots(strapiUrl, edition);
      setOfferSlots(false);
      setFeedback({ kind: "status", text: `Créneaux régénérés : ${report.created} créé${report.created > 1 ? "s" : ""}, ${report.kept} gardé${report.kept > 1 ? "s" : ""}, ${report.removed} retiré${report.removed > 1 ? "s" : ""}.` });
    } catch (error) {
      setFeedback(failure(error, "La régénération n’a pas abouti.").feedback);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`sticky top-0 z-20 -mx-2 rounded-xl border-2 px-4 py-3 shadow-sm ${count ? "border-gold bg-white" : "border-surface-alt bg-surface"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold" role="status">
          {count ? `${plural(count, "modification non publiée", "modifications non publiées")}` : "Tout est publié : la page publique montre ce programme."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <a href={publicPath} target="_blank" rel="noopener" className={buttonQuiet}>
            Voir la page publique
          </a>
          <HelpLink edition={edition} page="programme" label="construire et publier le programme" />
          {count > 0 && !confirming && (
            <button type="button" className={buttonPrimary} onClick={() => setConfirming(true)}>
              Publier le programme
            </button>
          )}
        </div>
      </div>
      {confirming && (
        <div role="alertdialog" aria-labelledby="publier-titre" className="mt-3 border-t border-surface-alt pt-3">
          <p id="publier-titre" className="font-semibold">
            Mettre en ligne ces modifications ?
          </p>
          <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5 text-sm text-muted">
            {program.changes.map((change) => (
              <li key={`${change.kind}-${change.id}`}>
                {change.label || "Sans titre"} ({change.state === "new" ? "nouveau" : "modifié"})
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" className={buttonPrimary} disabled={busy} onClick={() => void publish()}>
              {busy ? "Publication…" : "Oui, publier"}
            </button>
            <button type="button" className={buttonSecondary} onClick={() => setConfirming(false)}>
              Pas encore
            </button>
          </div>
        </div>
      )}
      {offerSlots && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-surface-alt pt-3">
          <p className="text-sm">Les pauses B2B ont changé : régénérez les créneaux pour que les rendez-vous suivent.</p>
          <button type="button" className={buttonSecondary} disabled={busy} onClick={() => void regenerate()}>
            Régénérer les créneaux
          </button>
        </div>
      )}
      <FeedbackArea feedback={feedback} />
    </div>
  );
}

function SequenceBlock({ sequence, siblings, index, ...ctx }: Ctx & { sequence: Sequence; siblings: Sequence[]; index: number }) {
  const theme = sequence.theme && sequence.theme in programThemes ? programThemes[sequence.theme as ProgramTheme] : null;
  const editingThis = ctx.editing === sequence.id;
  const position = siblings.findIndex((item) => item.id === sequence.id);
  const isBreak = sequence.kind === "b2b_break";

  return (
    <li className="grid gap-3 md:grid-cols-[6.5rem_1fr]">
      <div className="pt-3 md:text-right">
        <span className="text-xl font-bold tabular-nums text-title">{sequence.startTime || "--"}</span>
        {sequence.endTime && <span className="block text-sm text-muted">jusqu’à {sequence.endTime}</span>}
      </div>
      <article aria-labelledby={`seq-${sequence.id}`} className={`overflow-hidden rounded-xl border bg-white ${sequence.state === "published" ? "border-surface-alt" : "border-wood"}`}>
        {editingThis ? (
          <SequenceForm sequence={sequence} {...ctx} />
        ) : (
          <>
            <header className={`px-5 py-3 ${theme ? theme.band : isBreak ? "bg-surface" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  {sequence.subtitle && <p className="text-sm">{sequence.subtitle}</p>}
                  <h2 id={`seq-${sequence.id}`} className={`text-lg font-bold leading-snug normal-case ${theme ? "text-inherit" : "text-title"}`}>
                    {sequence.title || "Sans titre"}
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {isBreak && <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-title">Pause B2B</span>}
                  <StateTag state={sequence.state} />
                </div>
              </div>
              {sequence.description && <div className="rich-text mt-1 text-sm" dangerouslySetInnerHTML={{ __html: displayHtml(sequence.description) }} />}
            </header>
            <div className="px-5 py-3">
              <Interventions sequence={sequence} {...ctx} />
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-surface-alt pt-3">
                <button type="button" className={buttonSecondary} onClick={() => ctx.setEditing(sequence.id)} disabled={ctx.busy}>
                  Modifier la séquence
                </button>
                {siblings.length > 1 && (
                  <>
                    <button type="button" className={buttonQuiet} disabled={ctx.busy || position <= 0} onClick={() => void ctx.run(() => ctx.api("PATCH", `/sequences/${enc(sequence.id)}`, { move: "up" }))} aria-label={`Monter « ${sequence.title} »`}>
                      Monter
                    </button>
                    <button type="button" className={buttonQuiet} disabled={ctx.busy || position >= siblings.length - 1} onClick={() => void ctx.run(() => ctx.api("PATCH", `/sequences/${enc(sequence.id)}`, { move: "down" }))} aria-label={`Descendre « ${sequence.title} »`}>
                      Descendre
                    </button>
                  </>
                )}
                <span className="ml-auto">
                  <StrapiLink href={strapiAdminUrl(ctx.strapiUrl, STRAPI_UID.sequence, sequence.id)} />
                </span>
              </div>
            </div>
          </>
        )}
      </article>
    </li>
  );
}

function SequenceForm({ sequence, ...ctx }: Ctx & { sequence?: Sequence }) {
  const [form, setForm] = useState({
    title: sequence?.title ?? "",
    subtitle: sequence?.subtitle ?? "",
    startTime: sequence?.startTime ?? "",
    endTime: sequence?.endTime ?? "",
    kind: sequence?.kind ?? "talk",
    theme: sequence?.theme ?? "",
    description: sequence?.description ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState(false);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: event.target.value });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = sequence
      ? await ctx.run(() => ctx.api("PATCH", `/sequences/${enc(sequence.id)}`, { ...form, updatedAt: sequence.updatedAt }), "Séquence enregistrée dans le brouillon.")
      : await ctx.run(() => ctx.api("POST", "/sequences", form), "Séquence ajoutée au brouillon.");
    setErrors(result.fields);
    if (result.ok) ctx.setEditing(null);
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-4 p-5" aria-label={sequence ? `Modifier « ${sequence.title} »` : "Nouvelle séquence"}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Début" required hint="9h15 ou 9:15" error={errors.startTime} render={(p) => <input {...p} inputMode="text" className={controlClass(!!errors.startTime)} value={form.startTime} onChange={set("startTime")} />} />
        <Field label="Fin" hint={form.kind === "b2b_break" ? "Obligatoire pour une pause B2B" : "Facultatif"} error={errors.endTime} render={(p) => <input {...p} className={controlClass(!!errors.endTime)} value={form.endTime} onChange={set("endTime")} />} />
        <Field
          label="Nature"
          error={errors.kind}
          render={(p) => (
            <select {...p} className={controlClass(!!errors.kind)} value={form.kind} onChange={set("kind")}>
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        />
        <Field
          label="Thème"
          hint="Couleur du bandeau, comme sur le programme imprimé."
          error={errors.theme}
          render={(p) => (
            <select {...p} className={controlClass(!!errors.theme)} value={form.theme} onChange={set("theme")}>
              <option value="">Aucun</option>
              {Object.entries(THEME_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Titre" required error={errors.title} render={(p) => <input {...p} className={controlClass(!!errors.title)} value={form.title} onChange={set("title")} />} />
        <Field label="Sous-titre" hint="Au-dessus du titre, par exemple « Table ronde »." render={(p) => <input {...p} className={controlClass()} value={form.subtitle} onChange={set("subtitle")} />} />
      </div>
      <RichText label="Description" value={form.description} onChange={(description) => setForm({ ...form, description })} hint="Quelques lignes sous le titre. Gras, italique, listes et liens." />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonPrimary} disabled={ctx.busy}>
          {sequence ? "Enregistrer" : "Ajouter la séquence"}
        </button>
        <button type="button" className={buttonSecondary} onClick={() => ctx.setEditing(null)}>
          Annuler
        </button>
        {sequence && !deleting && (
          <button type="button" className={`${buttonDanger} ml-auto`} onClick={() => setDeleting(true)}>
            Supprimer
          </button>
        )}
      </div>
      {sequence && deleting && (
        <div role="alertdialog" aria-labelledby={`suppr-${sequence.id}`} className="rounded-lg border-2 border-danger bg-white p-4">
          <p id={`suppr-${sequence.id}`} className="font-semibold">
            Supprimer « {sequence.title} » et ses {plural(sequence.interventions.length, "intervention")} ?
          </p>
          <p className="text-sm text-muted">La suppression est immédiate, y compris sur la page publique. Les fiches des intervenants sont gardées.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              className={buttonDanger}
              disabled={ctx.busy}
              onClick={() => void ctx.run(() => ctx.api("DELETE", `/sequences/${enc(sequence.id)}`), "Séquence supprimée.").then((result) => result.ok && ctx.setEditing(null))}
            >
              Oui, supprimer
            </button>
            <button type="button" className={buttonSecondary} onClick={() => setDeleting(false)}>
              Garder
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

function NewSequence(ctx: Ctx) {
  if (ctx.editing === "new") {
    return (
      <div className="mt-6 rounded-xl border-2 border-title bg-white">
        <h2 className="px-5 pt-4 font-heading text-lg font-semibold normal-case">Nouvelle séquence</h2>
        <SequenceForm {...ctx} />
      </div>
    );
  }
  return (
    <button type="button" className={`${buttonSecondary} mt-6`} onClick={() => ctx.setEditing("new")}>
      Ajouter une séquence
    </button>
  );
}

function Interventions({ sequence, ...ctx }: Ctx & { sequence: Sequence }) {
  const adding = ctx.editing === `new-in-${sequence.id}`;
  return (
    <div>
      {sequence.interventions.length > 0 && (
        <ol className="space-y-3">
          {sequence.interventions.map((intervention, index) =>
            ctx.editing === intervention.id ? (
              <li key={intervention.id}>
                <InterventionForm sequence={sequence} intervention={intervention} {...ctx} />
              </li>
            ) : (
              <li key={intervention.id} className="rounded-lg bg-surface p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {intervention.speakers.length > 0 ? (
                      <ul className="space-y-0.5">
                        {intervention.speakers.map((speaker) => (
                          <li key={speaker.id}>
                            <span className="font-semibold">{speaker.name}</span>
                            {(speaker.title || speaker.organisation) && <span className="text-muted">, {[speaker.title, speaker.organisation?.name].filter(Boolean).join(", ")}</span>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted">Pas encore d’intervenant.</p>
                    )}
                    {intervention.description && <div className="rich-text mt-1 text-sm" dangerouslySetInnerHTML={{ __html: displayHtml(intervention.description) }} />}
                  </div>
                  <StateTag state={intervention.state} />
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <button type="button" className={buttonQuiet} onClick={() => ctx.setEditing(intervention.id)} disabled={ctx.busy}>
                    Modifier
                  </button>
                  {sequence.interventions.length > 1 && (
                    <>
                      <button type="button" className={buttonQuiet} disabled={ctx.busy || index === 0} onClick={() => void ctx.run(() => ctx.api("PATCH", `/interventions/${enc(intervention.id)}`, { move: "up" }))}>
                        Monter
                      </button>
                      <button type="button" className={buttonQuiet} disabled={ctx.busy || index === sequence.interventions.length - 1} onClick={() => void ctx.run(() => ctx.api("PATCH", `/interventions/${enc(intervention.id)}`, { move: "down" }))}>
                        Descendre
                      </button>
                    </>
                  )}
                </div>
              </li>
            ),
          )}
        </ol>
      )}
      {adding ? (
        <div className="mt-3">
          <InterventionForm sequence={sequence} {...ctx} />
        </div>
      ) : (
        <button type="button" className={`${buttonQuiet} mt-2`} onClick={() => ctx.setEditing(`new-in-${sequence.id}`)} disabled={ctx.busy}>
          + Ajouter une intervention
        </button>
      )}
    </div>
  );
}

function InterventionForm({ sequence, intervention, ...ctx }: Ctx & { sequence: Sequence; intervention?: Intervention }) {
  const [description, setDescription] = useState(intervention?.description ?? "");
  const [speakers, setSpeakers] = useState<{ id: string; name: string }[]>(intervention?.speakers.map(({ id, name }) => ({ id, name })) ?? []);
  const [editingSpeaker, setEditingSpeaker] = useState<Speaker | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = { description, speakers: speakers.map(({ id }) => id) };
    const result = intervention
      ? await ctx.run(() => ctx.api("PATCH", `/interventions/${enc(intervention.id)}`, { ...body, updatedAt: intervention.updatedAt }), "Intervention enregistrée dans le brouillon.")
      : await ctx.run(() => ctx.api("POST", `/sequences/${enc(sequence.id)}/interventions`, body), "Intervention ajoutée au brouillon.");
    if (result.ok) ctx.setEditing(null);
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-4 rounded-lg border-2 border-title bg-white p-4" aria-label={intervention ? "Modifier l’intervention" : "Nouvelle intervention"}>
      <div>
        <p className="font-semibold">Intervenants</p>
        {speakers.length > 0 ? (
          <ul className="mt-1 flex flex-wrap gap-2">
            {speakers.map((speaker) => {
              const full = intervention?.speakers.find((item) => item.id === speaker.id);
              return (
                <li key={speaker.id} className="inline-flex items-center gap-1 rounded-full bg-surface py-1 pr-1 pl-3">
                  {full ? (
                    <button type="button" className="font-semibold underline-offset-4 hover:underline" onClick={() => setEditingSpeaker(full)} title="Modifier la fiche">
                      {speaker.name}
                    </button>
                  ) : (
                    <span className="font-semibold">{speaker.name}</span>
                  )}
                  <button type="button" className="inline-flex size-8 items-center justify-center rounded-full hover:bg-surface-alt" aria-label={`Retirer ${speaker.name}`} onClick={() => setSpeakers(speakers.filter((item) => item.id !== speaker.id))}>
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">Aucun pour l’instant.</p>
        )}
        <SpeakerPicker {...ctx} exclude={speakers.map(({ id }) => id)} onAdd={(speaker) => setSpeakers([...speakers, speaker])} />
      </div>
      {editingSpeaker && <SpeakerForm speaker={editingSpeaker} {...ctx} onClose={() => setEditingSpeaker(null)} />}
      <RichText label="Description" value={description} onChange={setDescription} rows={3} hint="Sujet de l’intervention, facultatif." />
      <p className="text-sm text-muted">
        Support de présentation : {intervention?.presentation ? <a className="underline" href={intervention.presentation.url}>{intervention.presentation.name}</a> : "aucun"}. Il se dépose dans Strapi.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonPrimary} disabled={ctx.busy}>
          {intervention ? "Enregistrer" : "Ajouter l’intervention"}
        </button>
        <button type="button" className={buttonSecondary} onClick={() => ctx.setEditing(null)}>
          Annuler
        </button>
        {intervention && <StrapiLink href={strapiAdminUrl(ctx.strapiUrl, STRAPI_UID.intervention, intervention.id)} />}
        {intervention && !deleting && (
          <button type="button" className={`${buttonDanger} ml-auto`} onClick={() => setDeleting(true)}>
            Supprimer
          </button>
        )}
      </div>
      {intervention && deleting && (
        <div role="alertdialog" aria-label="Supprimer l’intervention" className="rounded-lg border-2 border-danger p-3">
          <p className="font-semibold">Supprimer cette intervention ?</p>
          <p className="text-sm text-muted">Immédiat. Les fiches des intervenants et leurs comptes restent.</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button type="button" className={buttonDanger} disabled={ctx.busy} onClick={() => void ctx.run(() => ctx.api("DELETE", `/interventions/${enc(intervention.id)}`), "Intervention supprimée.").then((r) => r.ok && ctx.setEditing(null))}>
              Oui, supprimer
            </button>
            <button type="button" className={buttonSecondary} onClick={() => setDeleting(false)}>
              Garder
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

type Found = { id: string; name: string; title: string; organisation: string };

function SpeakerPicker({ edition, strapiUrl, exclude, onAdd }: Ctx & { exclude: string[]; onAdd: (speaker: { id: string; name: string }) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", title: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) return setResults([]);
    const timer = window.setTimeout(() => {
      request<Found[]>(strapiUrl, `/admin/${enc(edition)}/intervenants?q=${enc(query)}`, "GET").then(setResults, () => setResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function create() {
    setError(null);
    try {
      const { id } = await request<{ id: string }>(strapiUrl, `/admin/${enc(edition)}/intervenants`, "POST", form);
      onAdd({ id, name: form.name.trim() });
      setCreating(false);
      setForm({ name: "", title: "" });
      setQuery("");
    } catch (failed) {
      setError(failure(failed).feedback.text);
    }
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <Field label="Ajouter un intervenant" render={(p) => <input {...p} type="search" className={controlClass()} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Chercher par nom ou organisation" />} />
        </div>
        <button type="button" className={buttonQuiet} onClick={() => setCreating(!creating)} aria-expanded={creating}>
          Nouvel intervenant
        </button>
      </div>
      {results.filter((item) => !exclude.includes(item.id)).length > 0 && (
        <ul className="mt-1 max-h-56 divide-y divide-surface-alt overflow-y-auto rounded-lg border border-surface-alt bg-white">
          {results
            .filter((item) => !exclude.includes(item.id))
            .map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left hover:bg-surface"
                  onClick={() => {
                    onAdd({ id: item.id, name: item.name });
                    setQuery("");
                  }}
                >
                  <span className="font-semibold">{item.name}</span>
                  <span className="block text-sm text-muted">{[item.title, item.organisation].filter(Boolean).join(", ")}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
      {creating && (
        <div className="mt-2 grid gap-3 rounded-lg bg-surface p-3 sm:grid-cols-2">
          <Field label="Nom" required render={(p) => <input {...p} className={controlClass()} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />} />
          <Field label="Fonction" render={(p) => <input {...p} className={controlClass()} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />} />
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <button type="button" className={buttonPrimary} disabled={!form.name.trim()} onClick={() => void create()}>
              Créer et ajouter
            </button>
            <span className="text-sm text-muted">Organisation, photo et biographie se complètent ensuite sur sa fiche.</span>
          </div>
          {error && <p className="text-sm font-semibold text-danger sm:col-span-2">{error}</p>}
        </div>
      )}
    </div>
  );
}

function SpeakerForm({ speaker, onClose, ...ctx }: Ctx & { speaker: Speaker; onClose: () => void }) {
  const [form, setForm] = useState({ name: speaker.name, title: speaker.title, topic: speaker.topic, linkedinUrl: speaker.linkedinUrl, bio: speaker.bio });
  const [organisation, setOrganisation] = useState(speaker.organisation);
  const [orgQuery, setOrgQuery] = useState("");
  const [orgResults, setOrgResults] = useState<{ id: string; name: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (orgQuery.trim().length < 2) return setOrgResults([]);
    const timer = window.setTimeout(() => {
      request<{ items: { id: string; name: string }[] }>(ctx.strapiUrl, `/admin/${enc(ctx.edition)}/organisations?q=${enc(orgQuery)}`, "GET").then((list) => setOrgResults(list.items.slice(0, 8)), () => setOrgResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [orgQuery]);

  async function save() {
    const result = await ctx.run(() => ctx.api("PATCH", `/intervenants/${enc(speaker.id)}`, { ...form, organisation: organisation?.id ?? null, updatedAt: speaker.updatedAt }), "Fiche intervenant enregistrée dans le brouillon.");
    setErrors(result.fields);
    if (result.ok) onClose();
  }

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });
  return (
    <section aria-label={`Fiche de ${speaker.name}`} className="space-y-3 rounded-lg bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">Fiche de {speaker.name}</p>
        <StrapiLink href={strapiAdminUrl(ctx.strapiUrl, STRAPI_UID.intervenant, speaker.id)} label="Photo et vidéo dans Strapi" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nom" required error={errors.name} render={(p) => <input {...p} className={controlClass(!!errors.name)} value={form.name} onChange={set("name")} />} />
        <Field label="Fonction" render={(p) => <input {...p} className={controlClass()} value={form.title} onChange={set("title")} />} />
        <div>
          <Field label="Organisation" hint={organisation ? `Actuelle : ${organisation.name}` : "Aucune"} error={errors.organisation} render={(p) => <input {...p} type="search" className={controlClass()} value={orgQuery} onChange={(event) => setOrgQuery(event.target.value)} placeholder="Chercher une organisation" />} />
          {orgResults.length > 0 && (
            <ul className="mt-1 divide-y divide-surface-alt rounded-lg border border-surface-alt bg-white">
              {orgResults.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left hover:bg-surface"
                    onClick={() => {
                      setOrganisation(item);
                      setOrgQuery("");
                    }}
                  >
                    {item.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {organisation && (
            <button type="button" className={`${buttonQuiet} mt-1`} onClick={() => setOrganisation(null)}>
              Retirer l’organisation
            </button>
          )}
        </div>
        <Field label="Page LinkedIn" error={errors.linkedinUrl} render={(p) => <input {...p} type="url" className={controlClass(!!errors.linkedinUrl)} value={form.linkedinUrl} onChange={set("linkedinUrl")} placeholder="https://www.linkedin.com/in/…" />} />
        <Field label="Sujet" hint="Sujet de son intervention, en quelques mots." className="sm:col-span-2" render={(p) => <input {...p} className={controlClass()} value={form.topic} onChange={set("topic")} />} />
      </div>
      <RichText label="Biographie" value={form.bio} onChange={(bio) => setForm({ ...form, bio })} rows={3} />
      <div className="flex flex-wrap gap-3">
        <button type="button" className={buttonPrimary} disabled={ctx.busy} onClick={() => void save()}>
          Enregistrer la fiche
        </button>
        <button type="button" className={buttonSecondary} onClick={onClose}>
          Fermer
        </button>
      </div>
    </section>
  );
}
