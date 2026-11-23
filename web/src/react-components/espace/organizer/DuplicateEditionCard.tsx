import React, { useState } from "react";
import { EspaceApiError, request } from "../../../lib/espace/client";
import { Card, FeedbackArea, Icon, type CardProps, type Feedback } from "./shared";

// V5-C, E9 : « Dupliquer cette édition ». Une nouvelle édition en brouillon reprend les réglages de l'espace, les séquences du programme et
// les thèmes ; ni participants, ni exposants, ni rendez-vous, ni formulaire HelloAsso. L'espace participant de la copie reste fermé.

type Field = "title" | "slug" | "date";

const DUPLICATE_FAILED = "La duplication a échoué. Vérifiez votre connexion et réessayez.";

/** Identifiant URL proposé d'après le titre : minuscules sans accents, tirets. */
const slugify = (title: string) =>
  title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

export default function DuplicateEditionCard({ edition, strapiUrl }: CardProps) {
  const [values, setValues] = useState({ title: "", slug: "", date: "" });
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [notice, setNotice] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);

  function change(name: Field, value: string) {
    setValues((current) => ({
      ...current,
      [name]: value,
      ...(name === "title" && !slugEdited && { slug: slugify(value) }),
    }));
    if (name === "slug") setSlugEdited(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setNotice(null);
    try {
      const { slug } = await request<{ slug: string }>(strapiUrl, `/admin/${encodeURIComponent(edition)}/duplicate`, "POST", values);
      setNotice({
        kind: "status",
        text: `L’édition « ${slug} » est créée en brouillon. Complétez-la dans Strapi puis publiez-la : elle apparaîtra alors dans vos éditions.`,
      });
      setValues({ title: "", slug: "", date: "" });
      setSlugEdited(false);
    } catch (failure) {
      if (failure instanceof EspaceApiError && Object.keys(failure.fields).length > 0) setErrors(failure.fields as Partial<Record<Field, string>>);
      else setNotice({ kind: "alert", text: (failure instanceof EspaceApiError && failure.status !== 0 && failure.message) || DUPLICATE_FAILED });
    }
    setBusy(false);
  }

  const FIELDS: { name: Field; label: string; type: string; help?: string }[] = [
    { name: "title", label: "Titre", type: "text" },
    { name: "slug", label: "Identifiant URL", type: "text", help: "Il ne pourra plus changer dès que l’édition aura des participants." },
    { name: "date", label: "Date de la journée", type: "date" },
  ];

  return (
    <Card heading="Dupliquer cette édition">
      <p className="mt-2 text-muted">
        Crée une édition en brouillon avec les réglages de l’espace (durée des créneaux, tables), le programme et les thèmes de celle-ci. Aucun participant,
        exposant, rendez-vous ni formulaire HelloAsso n’est repris, et l’espace participant reste fermé.
      </p>
      <form noValidate onSubmit={submit} className="mt-4 grid gap-4 md:grid-cols-3">
        {FIELDS.map(({ name, label, type, help }) => (
          <div key={name}>
            <label htmlFor={`duplicate-${name}`} className="block font-semibold">
              {label}
            </label>
            <input
              id={`duplicate-${name}`}
              name={name}
              type={type}
              required
              value={values[name]}
              onChange={(event) => change(name, event.target.value)}
              aria-invalid={errors[name] ? "true" : undefined}
              aria-describedby={errors[name] ? `duplicate-${name}-erreur` : help ? `duplicate-${name}-aide` : undefined}
              className={`mt-2 min-h-12 w-full rounded-lg border-2 bg-white px-4 text-lg text-ink ${errors[name] ? "border-danger" : "border-accent"}`}
            />
            {errors[name] ? (
              <p id={`duplicate-${name}-erreur`} className="mt-2 flex items-start gap-2 text-sm font-semibold text-danger">
                <Icon name="alert" />
                {errors[name]}
              </p>
            ) : (
              help && (
                <p id={`duplicate-${name}-aide`} className="mt-2 text-sm text-muted">
                  {help}
                </p>
              )
            )}
          </div>
        ))}
        <div className="md:col-span-3">
          <button
            type="submit"
            disabled={busy}
            aria-busy={busy}
            className="inline-flex min-h-13 items-center justify-center rounded-lg bg-gold px-6 text-lg font-bold text-gold-ink shadow-md shadow-gold/25 hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Duplication en cours…" : "Dupliquer l’édition"}
          </button>
        </div>
      </form>
      <FeedbackArea feedback={notice} />
    </Card>
  );
}
