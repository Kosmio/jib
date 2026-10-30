import React, { useEffect, useState } from "react";
import { EspaceApiError, saveConsent, updateProfile, type Consent, type Profile } from "../../lib/espace/client";

// E2 (F-10 à F-12) : les quatre champs importés de l'inscription et les trois choix de visibilité, décochés à la première visite.
// « Continuer » envoie PATCH /me puis PUT /me/consent, puis ouvre E1. Textes et classes : phase-1-design.md, question 1.
// Aucun champ n'a d'attribut `name` (D3, NF-07) : le formulaire est rendu côté serveur, et sans JavaScript « Continuer » le soumet en
// GET sur la page. Sans `name`, le navigateur ne sérialise rien : ni prénom, nom, fonction, entreprise ni choix dans l'URL, qui est
// journalisée. Les valeurs vivent dans l'état React ; `id` et `autoComplete` suffisent à l'accessibilité et à la saisie automatique.

type Props = {
  /** REACT_STRAPI_URL : adresse publique de Strapi, atteinte par le navigateur. */
  strapiUrl: string;
  editionSlug: string;
  initial: Profile & Consent;
};

const FIELDS = [
  { name: "firstName", label: "Prénom", autoComplete: "given-name", required: true, fallback: "Indiquez votre prénom." },
  { name: "lastName", label: "Nom", autoComplete: "family-name", required: true, fallback: "Indiquez votre nom." },
  { name: "jobTitle", label: "Fonction (facultatif)", autoComplete: "organization-title", required: false, fallback: "100 caractères au plus." },
  { name: "company", label: "Entreprise", autoComplete: "organization", required: true, fallback: "Indiquez votre entreprise." },
] as const;

const CHOICES = [
  {
    name: "directoryOptIn",
    label: "Apparaître dans l’annuaire des participants",
    help: "Nom, fonction, entreprise, photo et sujets. Jamais votre adresse e-mail.",
  },
  {
    name: "meetingsOptIn",
    label: "Recevoir des demandes de rendez-vous et des messages",
    help: "Les autres participants peuvent vous proposer un rendez-vous ou vous écrire en premier.",
  },
  {
    name: "newsOptIn",
    label: "Recevoir des nouvelles des prochaines éditions",
    help: "Vous pouvez vous désinscrire à tout moment.",
  },
] as const;

type FieldErrors = Partial<Record<keyof Profile, string>>;

function Icon({ name }: { name: "alert" | "info" }) {
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
      <circle cx="12" cy="12" r="9" />
      <path d={name === "alert" ? "M12 8v5M12 16.5h.01" : "M12 11v5M12 7.5h.01"} />
    </svg>
  );
}

export default function WelcomeForm({ strapiUrl, editionSlug, initial }: Props) {
  const [profile, setProfile] = useState<Profile>({
    firstName: initial.firstName,
    lastName: initial.lastName,
    jobTitle: initial.jobTitle,
    company: initial.company,
  });
  const [consent, setConsent] = useState<Consent>({
    directoryOptIn: initial.directoryOptIn,
    meetingsOptIn: initial.meetingsOptIn,
    newsOptIn: initial.newsOptIn,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focusField, setFocusField] = useState<string | null>(null);

  const loginUrl = `/espace/${encodeURIComponent(editionSlug)}/connexion`;

  // Le focus passe au premier champ en erreur (ou au bouton, après un échec d'envoi) une fois le message affiché.
  useEffect(() => {
    if (focusField) document.getElementById(focusField)?.focus();
  }, [focusField]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setErrors({});
    setFormError(null);
    setFocusField(null);

    try {
      await updateProfile(strapiUrl, profile);
      await saveConsent(strapiUrl, consent);
      window.location.assign(`/espace/${encodeURIComponent(editionSlug)}/`);
    } catch (error) {
      setSaving(false);
      if (error instanceof EspaceApiError && error.status === 401) {
        window.location.assign(loginUrl);
        return;
      }
      const flagged = FIELDS.filter(({ name }) => error instanceof EspaceApiError && name in error.fields);
      if (flagged.length) {
        setErrors(Object.fromEntries(flagged.map(({ name, fallback }) => [name, (error as EspaceApiError).fields[name] || fallback])));
        setFormError("Corrigez les champs signalés pour continuer.");
        setFocusField(flagged[0].name);
      } else {
        setFormError("L’enregistrement a échoué. Vérifiez votre connexion et réessayez.");
        setFocusField("continuer"); // le bouton désactivé pendant l'envoi a perdu le focus
      }
    }
  }

  return (
    <form noValidate onSubmit={submit}>
      <h2 className="font-heading text-xl font-semibold normal-case">Vos informations</h2>
      <p className="mt-1 text-sm text-muted">Importées depuis votre inscription, modifiables.</p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {FIELDS.map(({ name, label, autoComplete, required }) => (
          <div key={name}>
            <label htmlFor={name} className="block font-semibold">
              {label}
            </label>
            <input
              id={name}
              type="text"
              autoComplete={autoComplete}
              required={required}
              value={profile[name]}
              onChange={(event) => setProfile({ ...profile, [name]: event.target.value })}
              aria-invalid={errors[name] ? "true" : undefined}
              aria-describedby={errors[name] ? `${name}-erreur` : undefined}
              className={`mt-2 min-h-12 w-full rounded-lg border-2 bg-white px-4 text-lg text-ink ${errors[name] ? "border-danger" : "border-accent"}`}
            />
            {errors[name] && (
              <p id={`${name}-erreur`} className="mt-2 flex items-start gap-2 text-sm font-semibold text-danger">
                <Icon name="alert" />
                {errors[name]}
              </p>
            )}
          </div>
        ))}
      </div>

      <fieldset className="mt-6 rounded-xl bg-surface p-4">
        <legend className="float-left w-full font-heading font-semibold text-title">Vos choix de visibilité</legend>
        <p className="clear-both pt-1 text-sm text-muted">Ces choix sont facultatifs et modifiables à tout moment depuis votre profil.</p>
        <div className="mt-2">
          {CHOICES.map(({ name, label, help }) => (
            <label key={name} className="flex min-h-11 gap-3 py-1">
              <input
                type="checkbox"
                checked={consent[name]}
                onChange={(event) => setConsent({ ...consent, [name]: event.target.checked })}
                aria-labelledby={`${name}-libelle`}
                aria-describedby={`${name}-aide`}
                className="mt-0.5 size-5 shrink-0 accent-primary-ink"
              />
              <span>
                <span id={`${name}-libelle`} className="block font-semibold">
                  {label}
                </span>
                <span id={`${name}-aide`} className="block text-sm text-muted">
                  {help}
                </span>
              </span>
            </label>
          ))}
        </div>
        <div role="status" className="mt-2 empty:hidden">
          {consent.meetingsOptIn && !consent.directoryOptIn && (
            <p className="flex items-start gap-2 rounded-lg bg-white p-3 text-sm">
              <Icon name="info" />
              Sans apparaître dans l’annuaire, seules les personnes à qui vous écrivez pourront vous proposer un rendez-vous.
            </p>
          )}
        </div>
      </fieldset>

      {formError && (
        <p role="alert" className="mt-6 flex items-start gap-3 rounded-lg border-2 border-danger bg-white p-3 font-semibold">
          <span className="text-danger">
            <Icon name="alert" />
          </span>
          {formError}
        </p>
      )}

      <button
        id="continuer"
        type="submit"
        disabled={saving}
        aria-busy={saving}
        className="mt-6 inline-flex min-h-13 w-full items-center justify-center rounded-lg bg-gold px-6 text-lg font-bold text-gold-ink shadow-md shadow-gold/25 hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving ? "Enregistrement…" : "Continuer"}
      </button>
      <p className="mt-2 text-center text-sm">
        <a href="/confidentialite" className="inline-flex min-h-11 items-center text-title underline">
          Confidentialité
        </a>
      </p>
    </form>
  );
}
