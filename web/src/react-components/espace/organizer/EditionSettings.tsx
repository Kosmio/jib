import React, { useState } from "react";
import { request } from "../../../lib/espace/client";
import { plural } from "../../../lib/espace/format";
import { regenerateSlots, type SlotsReport } from "../../../lib/espace/admin";
import { strapiAdminUrl, STRAPI_UID } from "../../../lib/espace/strapi-links";
import { FeedbackArea, Icon, type Feedback } from "./shared";
import {
  buttonDanger,
  buttonPrimary,
  buttonSecondary,
  controlClass,
  failure,
  Field,
  fromParisInput,
  HelpLink,
  Section,
  StrapiLink,
  Switch,
  toParisInput,
} from "./ui";

// Écran « Édition » de l'interface organisation (15-administration.md, AD-1) : informations générales (F-168), inscriptions
// HelloAsso (F-155 à F-159, R-92), ouverture de l'espace et rendez-vous B2B (F-177 à F-179), pauses B2B (F-180).
// Chaque section s'enregistre seule ; les réglages s'appliquent dès l'enregistrement (l'édition est publiée).

export type EditionSettingsData = {
  id: string;
  updatedAt: string;
  readOnly: boolean;
  attendees: number;
  general: { title: string; date: string | null; city: string; inscriptionUrl: string };
  helloasso: { orgSlug: string; formType: string; formSlug: string; fieldMap: Partial<Record<FieldKey, string>>; credentials: boolean; syncs: number };
  space: {
    participantSpaceEnabled: boolean;
    b2bEnabled: boolean;
    tablesCount: number;
    slotDurationMinutes: number;
    meetingRequestsOpenAt: string | null;
    meetingRequestsCloseAt: string | null;
    checklist: { key: string; label: string; done: boolean; hint: string }[];
  };
  sequences: { id: string; title: string; startTime: string | null; endTime: string | null; kind: string; slots: number; updatedAt: string }[];
};

type FieldKey = "company" | "jobTitle" | "email" | "linkedin";
type Preview = { title: string | null; totalCount: number; fieldNames: string[]; suggestedFieldMap: Partial<Record<FieldKey, string>> };

type Props = { edition: string; strapiUrl: string; initial: EditionSettingsData };

const enc = encodeURIComponent;
const FORM_TYPES: [string, string][] = [
  ["Event", "Billetterie (événement)"],
  ["Membership", "Adhésion"],
  ["CrowdFunding", "Collecte"],
  ["Donation", "Don"],
  ["PaymentForm", "Paiement"],
  ["Checkout", "Paiement intégré"],
  ["Shop", "Boutique"],
];
const FIELD_LABELS: [FieldKey, string, string][] = [
  ["company", "Entreprise", "Champ HelloAsso qui donne l’entreprise de la personne."],
  ["jobTitle", "Fonction", "Champ qui donne son poste ou sa fonction."],
  ["email", "Adresse e-mail du participant", "Si la personne inscrite n’est pas celle qui paie. Sinon, l’adresse du payeur est prise."],
  ["linkedin", "Page LinkedIn", "Facultatif."],
];

const TYPE_SEGMENTS: Record<string, string> = { evenements: "Event", adhesions: "Membership", collectes: "CrowdFunding", formulaires: "Donation", paiements: "PaymentForm", boutiques: "Shop" };

/** F-155 : adresse HelloAsso collée -> association, type et formulaire (même lecture que le serveur), ou null. */
function parseHelloAssoUrl(input: string): { orgSlug: string; formType: string; formSlug: string } | null {
  try {
    const url = new URL(input.trim());
    if (!/(^|\.)helloasso\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const index = parts.findIndex((part, i) => i > 0 && TYPE_SEGMENTS[part.toLowerCase()] && parts[i + 1]);
    if (index < 1 || parts[index - 1] === "associations") return null;
    return { orgSlug: parts[index - 1], formType: TYPE_SEGMENTS[parts[index].toLowerCase()], formSlug: parts[index + 1] };
  } catch {
    return null;
  }
}

export default function EditionSettings({ edition, strapiUrl, initial }: Props) {
  const [data, setData] = useState(initial);
  const editionUrl = strapiAdminUrl(strapiUrl, STRAPI_UID.edition, data.id);
  const save = (body: Record<string, unknown>) =>
    request<EditionSettingsData>(strapiUrl, `/admin/${enc(edition)}/settings`, "PATCH", { updatedAt: data.updatedAt, ...body }).then((fresh) => {
      setData(fresh);
      return fresh;
    });

  return (
    <div className="space-y-6">
      <nav aria-label="Sections de la page" className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold">
        <a className="text-title underline-offset-4 hover:underline" href="#general">Informations</a>
        <a className="text-title underline-offset-4 hover:underline" href="#helloasso">Inscriptions HelloAsso</a>
        <a className="text-title underline-offset-4 hover:underline" href="#ouverture">Ouverture et B2B</a>
        <a className="text-title underline-offset-4 hover:underline" href="#pauses">Pauses B2B</a>
      </nav>
      <GeneralSection edition={edition} data={data} save={save} strapiHref={editionUrl} />
      <HelloAssoSection edition={edition} strapiUrl={strapiUrl} data={data} save={save} strapiHref={editionUrl} />
      <SpaceSection edition={edition} data={data} save={save} strapiHref={editionUrl} />
      <BreaksSection edition={edition} strapiUrl={strapiUrl} data={data} onChange={setData} />
    </div>
  );
}

type SectionProps = { edition: string; data: EditionSettingsData; save: (body: Record<string, unknown>) => Promise<EditionSettingsData>; strapiHref: string };

/** Formulaire d'une section : état d'envoi, message, erreurs par champ, et l'action d'enregistrement. */
function useSaver() {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Rend null en cas de succès, sinon le code et le message de l'échec (déjà affiché, sauf `quiet`). */
  async function run(action: () => Promise<unknown>, done: string, quiet: string[] = []): Promise<{ code: string | null; text: string } | null> {
    setBusy(true);
    setFeedback(null);
    setErrors({});
    try {
      await action();
      setFeedback({ kind: "status", text: done });
      return null;
    } catch (error) {
      const { feedback: message, fields, code } = failure(error);
      if (!code || !quiet.includes(code)) setFeedback(message);
      setErrors(fields);
      return { code, text: message.text };
    } finally {
      setBusy(false);
    }
  }
  return { busy, feedback, errors, run, setFeedback };
}

function GeneralSection({ edition, data, save, strapiHref }: SectionProps) {
  const [form, setForm] = useState(data.general);
  const { busy, feedback, errors, run } = useSaver();
  const dirty = JSON.stringify(form) !== JSON.stringify(data.general);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });

  return (
    <Section
      id="general"
      title="Informations générales"
      intro="Ce qui s’affiche sur la page publique de l’édition et dans l’espace participant. La galerie, les vidéos et le bilan se règlent dans Strapi."
      aside={
        <>
          <HelpLink edition={edition} page="preparer-une-edition" label="préparer une édition" />
          <StrapiLink href={strapiHref} />
        </>
      }
    >
      <form
        className="mt-5 grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => save(form), "Informations enregistrées.");
        }}
      >
        <Field label="Titre" required error={errors.title} className="md:col-span-2" render={(p) => <input {...p} className={controlClass(!!errors.title)} value={form.title} onChange={set("title")} />} />
        <Field label="Date" error={errors.date} render={(p) => <input {...p} type="date" className={controlClass(!!errors.date)} value={form.date ?? ""} onChange={set("date")} />} />
        <Field label="Ville" render={(p) => <input {...p} className={controlClass()} value={form.city} onChange={set("city")} />} />
        <Field
          label="Lien d’inscription"
          hint="Adresse du bouton « S’inscrire » de la page publique, en général le formulaire HelloAsso."
          error={errors.inscriptionUrl}
          className="md:col-span-2"
          render={(p) => <input {...p} type="url" inputMode="url" placeholder="https://www.helloasso.com/…" className={controlClass(!!errors.inscriptionUrl)} value={form.inscriptionUrl} onChange={set("inscriptionUrl")} />}
        />
        <div className="md:col-span-2">
          <SaveButton busy={busy} dirty={dirty} />
          <FeedbackArea feedback={feedback} />
        </div>
      </form>
    </Section>
  );
}

function SaveButton({ busy, dirty, label = "Enregistrer" }: { busy: boolean; dirty: boolean; label?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="submit" className={buttonPrimary} disabled={busy || !dirty}>
        {busy ? "Enregistrement…" : label}
      </button>
      {!dirty && !busy && <span className="text-sm text-muted">Aucune modification à enregistrer.</span>}
    </div>
  );
}

function HelloAssoSection({ edition, strapiUrl, data, save, strapiHref }: SectionProps & { strapiUrl: string }) {
  const stored = { orgSlug: data.helloasso.orgSlug, formType: data.helloasso.formType, formSlug: data.helloasso.formSlug, fieldMap: data.helloasso.fieldMap };
  const [form, setForm] = useState(stored);
  const [pasted, setPasted] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [testing, setTesting] = useState(false);
  const [testFeedback, setTestFeedback] = useState<Feedback | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { busy, feedback, errors, run } = useSaver();
  const dirty = JSON.stringify(form) !== JSON.stringify(stored);
  const fieldNames = [...new Set([...(preview?.fieldNames ?? []), ...Object.values(form.fieldMap).filter((v): v is string => Boolean(v))])];
  const webhookUrl = `${strapiUrl.replace(/\/+$/, "")}/api/espace/webhooks/helloasso`;

  function applyUrl(value: string) {
    setPasted(value);
    if (!value.trim()) return setPasteError(null);
    const parsed = parseHelloAssoUrl(value);
    if (!parsed) return setPasteError("Cette adresse n’est pas celle d’un formulaire HelloAsso. Copiez l’adresse de la page d’inscription.");
    setPasteError(null);
    setForm({ ...form, ...parsed });
  }

  async function test() {
    setTesting(true);
    setTestFeedback(null);
    try {
      const result = await request<Preview>(strapiUrl, `/admin/${enc(edition)}/helloasso/test`, "POST", { orgSlug: form.orgSlug, formType: form.formType, formSlug: form.formSlug });
      setPreview(result);
      const fieldMap = { ...result.suggestedFieldMap, ...Object.fromEntries(Object.entries(form.fieldMap).filter(([, name]) => name && result.fieldNames.includes(name))) };
      setForm((current) => ({ ...current, fieldMap }));
      setTestFeedback({ kind: "status", text: `Connexion réussie${result.title ? ` : « ${result.title} »` : ""}, ${plural(result.totalCount, "billet")}. Rien n’a été importé.` });
    } catch (error) {
      setPreview(null);
      setTestFeedback(failure(error, "Le test n’a pas abouti. Réessayez.").feedback);
    } finally {
      setTesting(false);
    }
  }

  async function submit(confirmFormChange = false) {
    setConfirm(null);
    const failed = await run(
      () => save({ helloassoOrgSlug: form.orgSlug, helloassoFormType: form.formType, helloassoFormSlug: form.formSlug, helloassoFieldMap: form.fieldMap, confirmFormChange }),
      "Réglages HelloAsso enregistrés. La prochaine synchronisation les utilisera.",
      ["FORM_CHANGE_CONFIRM"]
    );
    // R-92 : le serveur demande confirmation quand des inscrits viennent déjà de l'ancien formulaire.
    if (failed?.code === "FORM_CHANGE_CONFIRM") setConfirm(failed.text);
  }

  return (
    <Section
      id="helloasso"
      title="Inscriptions HelloAsso"
      intro="Les inscrits sont importés depuis le formulaire HelloAsso de l’édition. Collez son adresse, testez la connexion, puis enregistrez."
      aside={
        <>
          <HelpLink edition={edition} page="helloasso" label="régler HelloAsso" />
          <StrapiLink href={strapiHref} />
        </>
      }
    >
      <p className={`mt-4 flex items-start gap-2 rounded-lg p-3 text-sm ${data.helloasso.credentials ? "bg-surface" : "border-2 border-danger bg-white"}`}>
        <span className={data.helloasso.credentials ? "text-primary-ink" : "text-danger"}>
          <Icon name={data.helloasso.credentials ? "check" : "alert"} />
        </span>
        <span>
          {data.helloasso.credentials
            ? "Identifiants HelloAsso du serveur présents. Ils ne s’affichent jamais ici."
            : "Identifiants HelloAsso du serveur absents : ils se règlent au déploiement. Demandez-les à Kosmio."}
        </span>
      </p>

      <form
        className="mt-5 space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field
          label="Adresse du formulaire HelloAsso"
          hint="Par exemple https://www.helloasso.com/associations/xylofutur/evenements/journee-innovation. Les trois champs ci-dessous se remplissent seuls."
          error={pasteError ?? undefined}
          render={(p) => <input {...p} type="url" inputMode="url" className={controlClass(!!pasteError)} value={pasted} onChange={(event) => applyUrl(event.target.value)} placeholder="Coller l’adresse ici" />}
        />
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Association" hint="Après /associations/ dans l’adresse." error={errors.helloassoOrgSlug} render={(p) => <input {...p} className={controlClass(!!errors.helloassoOrgSlug)} value={form.orgSlug} onChange={(e) => setForm({ ...form, orgSlug: e.target.value.trim() })} />} />
          <Field
            label="Type de formulaire"
            error={errors.helloassoFormType}
            render={(p) => (
              <select {...p} className={controlClass(!!errors.helloassoFormType)} value={form.formType} onChange={(e) => setForm({ ...form, formType: e.target.value })}>
                {FORM_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          />
          <Field label="Formulaire" hint="Après /evenements/ dans l’adresse." error={errors.helloassoFormSlug} render={(p) => <input {...p} className={controlClass(!!errors.helloassoFormSlug)} value={form.formSlug} onChange={(e) => setForm({ ...form, formSlug: e.target.value.trim() })} />} />
        </div>

        <div>
          <button type="button" className={buttonSecondary} disabled={testing || !form.orgSlug || !form.formSlug || !data.helloasso.credentials} onClick={() => void test()}>
            {testing ? "Test en cours…" : "Tester la connexion"}
          </button>
          <FeedbackArea feedback={testFeedback} />
        </div>

        <fieldset className="rounded-lg border border-surface-alt p-4">
          <legend className="px-1 font-semibold">Correspondance des champs</legend>
          <p className="text-sm text-muted">
            {fieldNames.length
              ? "Indiquez quel champ du formulaire HelloAsso donne chaque information. Les champs reconnus sont choisis d’office."
              : "Testez la connexion pour choisir parmi les champs du formulaire."}
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {FIELD_LABELS.map(([key, label, hint]) => (
              <Field
                key={key}
                label={label}
                hint={hint}
                render={(p) => (
                  <select
                    {...p}
                    className={controlClass()}
                    value={form.fieldMap[key] ?? ""}
                    disabled={!fieldNames.length}
                    onChange={(e) => setForm({ ...form, fieldMap: { ...form.fieldMap, [key]: e.target.value || undefined } })}
                  >
                    <option value="">Aucun champ</option>
                    {fieldNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                )}
              />
            ))}
          </div>
        </fieldset>

        {confirm ? (
          <div role="alertdialog" aria-labelledby="helloasso-confirm" className="rounded-lg border-2 border-title bg-white p-4">
            <p id="helloasso-confirm" className="font-semibold">
              Changer de formulaire ?
            </p>
            <p className="mt-1 text-muted">{confirm}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" className={buttonPrimary} disabled={busy} onClick={() => void submit(true)}>
                Oui, changer de formulaire
              </button>
              <button type="button" className={buttonSecondary} onClick={() => setConfirm(null)}>
                Garder le formulaire actuel
              </button>
            </div>
          </div>
        ) : (
          <SaveButton busy={busy} dirty={dirty} />
        )}
        <FeedbackArea feedback={feedback} />
      </form>

      <div className="mt-6 border-t border-surface-alt pt-4">
        <p className="font-semibold">Notifications HelloAsso</p>
        <p className="mt-1 max-w-[70ch] text-sm text-muted">
          Pour qu’une inscription arrive dans l’espace en quelques secondes, collez cette adresse dans HelloAsso, rubrique « Mon compte », « Intégrations et API », « Notifications ». Sans elle, les inscrits arrivent à la synchronisation suivante (toutes les 15 minutes).
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="min-w-0 rounded-lg bg-surface px-3 py-2 text-sm break-all">{webhookUrl}</code>
          <button
            type="button"
            className={buttonSecondary}
            onClick={() => {
              void navigator.clipboard?.writeText(webhookUrl).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 3000);
              });
            }}
          >
            {copied ? "Copiée" : "Copier"}
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">
          {data.helloasso.syncs
            ? `${plural(data.helloasso.syncs, "synchronisation HelloAsso")} pour cette édition. L’historique est dans le pilotage.`
            : "Aucune synchronisation HelloAsso pour l’instant : elle se lance depuis le pilotage."}
        </p>
      </div>
    </Section>
  );
}

function SpaceSection({ edition, data, save, strapiHref }: SectionProps) {
  const stored = {
    tablesCount: String(data.space.tablesCount),
    slotDurationMinutes: String(data.space.slotDurationMinutes),
    open: toParisInput(data.space.meetingRequestsOpenAt),
    close: toParisInput(data.space.meetingRequestsCloseAt),
  };
  const [form, setForm] = useState(stored);
  const [switching, setSwitching] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const { busy, feedback, errors, run, setFeedback } = useSaver();
  const dirty = JSON.stringify(form) !== JSON.stringify(stored);
  const missing = data.space.checklist.filter((item) => !item.done);

  async function toggle(key: "participantSpaceEnabled" | "b2bEnabled", value: boolean, done: string) {
    setSwitching(key);
    await run(() => save({ [key]: value }), done);
    setSwitching(null);
  }

  return (
    <Section
      id="ouverture"
      title="Ouverture de l’espace et rendez-vous B2B"
      intro="Ouvrez l’espace quand les inscrits peuvent s’y connecter. Les rendez-vous se règlent ici : nombre de tables, durée d’un créneau, période des demandes."
      aside={
        <>
          <HelpLink edition={edition} page="rendez-vous-b2b" label="rendez-vous B2B" />
          <StrapiLink href={strapiHref} />
        </>
      }
    >
      <div className="mt-5 space-y-5">
        <Switch
          label="Espace participant"
          states={["ouvert", "fermé"]}
          checked={data.space.participantSpaceEnabled}
          disabled={switching !== null || confirmClose}
          onChange={(value) =>
            value ? void toggle("participantSpaceEnabled", true, "L’espace est ouvert : les inscrits peuvent se connecter.") : setConfirmClose(true)
          }
          description="Fermé, seuls les organisateurs peuvent se connecter."
        />
        {confirmClose && (
          <div role="alertdialog" aria-labelledby="close-confirm" className="rounded-lg border-2 border-title bg-white p-4">
            <p id="close-confirm" className="font-semibold">
              Fermer l’espace participant ?
            </p>
            <p className="mt-1 text-muted">Les participants ne pourront plus se connecter ni prendre de rendez-vous. Leurs données sont gardées et tout revient à la réouverture.</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                className={buttonDanger}
                disabled={switching !== null}
                onClick={() => {
                  setConfirmClose(false);
                  void toggle("participantSpaceEnabled", false, "L’espace est fermé : seuls les organisateurs s’y connectent.");
                }}
              >
                Fermer l’espace
              </button>
              <button type="button" className={buttonSecondary} onClick={() => setConfirmClose(false)}>
                Laisser ouvert
              </button>
            </div>
          </div>
        )}
        <div className="rounded-lg bg-surface p-4">
          <p className="font-semibold">{missing.length ? `Avant d’ouvrir : ${plural(missing.length, "point")} à vérifier` : "Tout est prêt pour l’ouverture."}</p>
          <ul className="mt-2 space-y-1.5">
            {data.space.checklist.map((item) => (
              <li key={item.key} className="flex items-start gap-2">
                <span className={item.done ? "text-primary-ink" : "text-wood"}>
                  <Icon name={item.done ? "check" : "alert"} />
                </span>
                <span>
                  {item.label}
                  <span className="sr-only">{item.done ? " : fait" : " : à faire"}</span>
                  {!item.done && <span className="block text-sm text-muted">{item.hint}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted">Un point manquant n’empêche pas d’ouvrir.</p>
        </div>
        <Switch
          label="Rendez-vous B2B"
          states={["activés", "désactivés"]}
          checked={data.space.b2bEnabled}
          disabled={switching !== null}
          onChange={(value) => void toggle("b2bEnabled", value, value ? "Les rendez-vous B2B sont activés." : "Les rendez-vous B2B sont désactivés : l’annuaire, la messagerie et le programme restent.")}
          description="Désactivés, l’agenda et les demandes de rendez-vous disparaissent de l’espace. L’annuaire, la messagerie et le programme restent."
        />
      </div>

      <form
        className="mt-6 grid gap-4 border-t border-surface-alt pt-5 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const open = form.open ? fromParisInput(form.open) : null;
          const close = form.close ? fromParisInput(form.close) : null;
          if (open && close && open >= close) {
            setFeedback({ kind: "alert", text: "La fermeture des demandes doit venir après leur ouverture." });
            return;
          }
          void run(
            () => save({ tablesCount: Number(form.tablesCount), slotDurationMinutes: Number(form.slotDurationMinutes), meetingRequestsOpenAt: open, meetingRequestsCloseAt: close }),
            "Réglages des rendez-vous enregistrés. Si la durée a changé, régénérez les créneaux plus bas."
          );
        }}
      >
        <Field
          label="Nombre de tables"
          hint="Tables disponibles pour les rendez-vous, à chaque créneau."
          error={errors.tablesCount}
          render={(p) => <input {...p} type="number" min={1} max={200} inputMode="numeric" className={controlClass(!!errors.tablesCount)} value={form.tablesCount} onChange={(e) => setForm({ ...form, tablesCount: e.target.value })} />}
        />
        <Field
          label="Durée d’un créneau (minutes)"
          hint="Ne change plus dès qu’un rendez-vous existe."
          error={errors.slotDurationMinutes}
          render={(p) => <input {...p} type="number" min={5} max={120} step={5} inputMode="numeric" className={controlClass(!!errors.slotDurationMinutes)} value={form.slotDurationMinutes} onChange={(e) => setForm({ ...form, slotDurationMinutes: e.target.value })} />}
        />
        <Field
          label="Ouverture des demandes"
          hint="Heure de Paris. Vide : dès l’ouverture de l’espace."
          error={errors.meetingRequestsOpenAt}
          render={(p) => <input {...p} type="datetime-local" className={controlClass(!!errors.meetingRequestsOpenAt)} value={form.open} onChange={(e) => setForm({ ...form, open: e.target.value })} />}
        />
        <Field
          label="Fermeture des demandes"
          hint="Heure de Paris. Vide : la veille de l’édition à 18h00."
          error={errors.meetingRequestsCloseAt}
          render={(p) => <input {...p} type="datetime-local" className={controlClass(!!errors.meetingRequestsCloseAt)} value={form.close} onChange={(e) => setForm({ ...form, close: e.target.value })} />}
        />
        <div className="md:col-span-2">
          <SaveButton busy={busy} dirty={dirty} />
        </div>
      </form>
      <FeedbackArea feedback={feedback} />
    </Section>
  );
}

function BreaksSection({ edition, strapiUrl, data, onChange }: { edition: string; strapiUrl: string; data: EditionSettingsData; onChange: (data: EditionSettingsData) => void }) {
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [report, setReport] = useState<SlotsReport | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const breaks = data.sequences.filter((sequence) => sequence.kind === "b2b_break");
  const slots = breaks.reduce((sum, sequence) => sum + sequence.slots, 0);

  async function toggle(sequence: EditionSettingsData["sequences"][number], isBreak: boolean) {
    setPending(sequence.id);
    setFeedback(null);
    try {
      const fresh = await request<EditionSettingsData>(strapiUrl, `/admin/${enc(edition)}/sequences/${enc(sequence.id)}/break`, "PATCH", { isBreak, updatedAt: sequence.updatedAt });
      onChange(fresh);
      setFeedback({ kind: "status", text: isBreak ? `« ${sequence.title} » est une pause B2B. Régénérez les créneaux pour l’ouvrir aux rendez-vous.` : `« ${sequence.title} » n’est plus une pause B2B. Régénérez les créneaux.` });
    } catch (error) {
      setFeedback(failure(error).feedback);
    } finally {
      setPending(null);
    }
  }

  async function regenerate() {
    setRegenerating(true);
    setFeedback(null);
    try {
      const result = await regenerateSlots(strapiUrl, edition);
      setReport(result);
      const fresh = await request<EditionSettingsData>(strapiUrl, `/admin/${enc(edition)}/settings`, "GET");
      onChange(fresh);
    } catch (error) {
      setFeedback(failure(error, "La régénération n’a pas abouti. Réessayez.").feedback);
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <Section
      id="pauses"
      title="Pauses B2B"
      intro="Les rendez-vous ont lieu pendant les pauses B2B du programme. Cochez les séquences concernées, puis régénérez les créneaux. Le changement est publié tout de suite."
      aside={<HelpLink edition={edition} page="rendez-vous-b2b" label="pauses B2B" />}
    >
      {data.sequences.length === 0 ? (
        <p className="mt-4 text-muted">Le programme publié n’a encore aucune séquence. Construisez-le dans l’onglet Programme.</p>
      ) : (
        <ul className="mt-4 divide-y divide-surface-alt rounded-lg border border-surface-alt">
          {data.sequences.map((sequence) => {
            const isBreak = sequence.kind === "b2b_break";
            const id = `pause-${sequence.id}`;
            return (
              <li key={sequence.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 p-3 ${isBreak ? "bg-surface" : ""}`}>
                <input
                  id={id}
                  type="checkbox"
                  className="size-6 shrink-0 accent-primary-dark"
                  checked={isBreak}
                  disabled={pending !== null}
                  onChange={(event) => void toggle(sequence, event.target.checked)}
                />
                <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                  <span className="mr-2 font-mono text-sm text-muted tabular-nums">
                    {sequence.startTime ?? "--"} à {sequence.endTime ?? "--"}
                  </span>
                  <span className="font-semibold">{sequence.title || "Sans titre"}</span>
                </label>
                <span className="text-sm text-muted">{isBreak ? plural(sequence.slots, "créneau", "créneaux") : "pas de rendez-vous"}</span>
                <StrapiLink href={strapiAdminUrl(strapiUrl, STRAPI_UID.sequence, sequence.id)} label="Strapi" />
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className={buttonSecondary} disabled={regenerating || breaks.length === 0} onClick={() => void regenerate()}>
          {regenerating ? "Régénération…" : "Régénérer les créneaux"}
        </button>
        <span className="text-sm text-muted">
          {plural(breaks.length, "pause")}, {plural(slots, "créneau", "créneaux")} de {data.space.slotDurationMinutes} minutes.
        </span>
      </div>
      {report && (
        <div role="status" className="mt-3 rounded-lg bg-surface p-3">
          <p className="font-semibold">
            Créneaux : {report.created} créé{report.created > 1 ? "s" : ""}, {report.kept} gardé{report.kept > 1 ? "s" : ""}, {report.removed} retiré{report.removed > 1 ? "s" : ""}.
          </p>
          {report.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-sm text-muted">
              {report.warnings.map((warning) => (
                <li key={`${warning.sessionDocumentId}-${warning.code}`}>
                  « {warning.title} » : {WARNINGS[warning.code] ?? warning.code}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <FeedbackArea feedback={feedback} />
    </Section>
  );
}

const WARNINGS: Record<string, string> = {
  MISSING_END: "pas d’heure de fin, aucun créneau.",
  INVALID_TIME: "heure illisible, aucun créneau.",
  TOO_SHORT: "trop courte pour un créneau.",
  OVERLAP: "chevauche une autre pause.",
};
