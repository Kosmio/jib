import React, { useEffect, useState } from "react";
import { EspaceApiError, saveConsent, updateProfile, type Consent, type Profile, type Topic } from "../../lib/espace/client";

// E2 (F-10 à F-12, F-116, F-118, NF-56) : les quatre champs importés de l'inscription et les trois choix de visibilité.
// Aucune case n'est cochée par le code : elles reflètent la valeur reçue du serveur (D-14). Chaque case dit sa conséquence quand elle est
// décochée ; « Continuer » sans l'annuaire demande d'abord une confirmation en ligne (annoncée, focus dessus).
// « Continuer » envoie PATCH /me puis PUT /me/consent, puis ouvre E1. Textes et classes : phase-1-design.md, question 1.
// Aucun champ n'a d'attribut `name` (D3, NF-07) : le formulaire est rendu côté serveur, et sans JavaScript « Continuer » le soumet en
// GET sur la page. Sans `name`, le navigateur ne sérialise rien : ni prénom, nom, fonction, entreprise ni choix dans l'URL, qui est
// journalisée. Les valeurs vivent dans l'état React ; `id` et `autoComplete` suffisent à l'accessibilité et à la saisie automatique.

type Props = {
  /** REACT_STRAPI_URL : adresse publique de Strapi, atteinte par le navigateur. */
  strapiUrl: string;
  editionSlug: string;
  initial: Profile & Consent & { topics: string[] };
  /** Sujets de l'édition (`GET /editions/:slug/topics`). Quand il y en a, en choisir au moins un est obligatoire (retour de recette du 18 novembre). */
  topics?: Topic[];
};

const MAX_TOPICS = 3;

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
    effect: "Vous ne serez pas visible et ne recevrez aucune demande.",
  },
  {
    name: "meetingsOptIn",
    label: "Recevoir des demandes de rendez-vous et des messages",
    help: "Les autres participants peuvent vous proposer un rendez-vous ou vous écrire en premier.",
    effect: "Vous pourrez proposer des rendez-vous, pas en recevoir.",
  },
  {
    name: "newsOptIn",
    label: "Recevoir des nouvelles des prochaines éditions",
    help: "Vous pouvez vous désinscrire à tout moment.",
    effect: null,
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

export default function WelcomeForm({ strapiUrl, editionSlug, initial, topics = [] }: Props) {
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
  const [topicIds, setTopicIds] = useState<string[]>(initial.topics.filter((id) => topics.some((topic) => topic.id === id)));
  const [topicError, setTopicError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focusField, setFocusField] = useState<string | null>(null);
  const [askDirectory, setAskDirectory] = useState(false);

  const loginUrl = `/espace/${encodeURIComponent(editionSlug)}/connexion`;

  // Le focus passe au premier champ en erreur (ou au bouton, après un échec d'envoi) une fois le message affiché.
  useEffect(() => {
    if (focusField) document.getElementById(focusField)?.focus();
  }, [focusField]);

  // La confirmation reçoit le focus à son apparition : le lecteur d'écran en lit le titre et le texte.
  useEffect(() => {
    if (askDirectory) document.getElementById("confirmation-annuaire")?.focus();
  }, [askDirectory]);

  function validate(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (topics.length > 0 && topicIds.length === 0) {
      setTopicError("Choisissez au moins un sujet : il sert à vous proposer les bonnes personnes.");
      setFormError(null);
      setFocusField(`sujet-${topics[0].id}`);
      return;
    }
    if (!consent.directoryOptIn) {
      setFormError(null);
      setFocusField(null);
      setAskDirectory(true);
      return;
    }
    void save(consent);
  }

  function chooseDirectory(appear: boolean) {
    const next = { ...consent, directoryOptIn: appear };
    setConsent(next);
    void save(next);
  }

  async function save(toSave: Consent) {
    setSaving(true);
    setAskDirectory(false);
    setErrors({});
    setFormError(null);
    setFocusField(null);

    let profileSaved = false;
    try {
      await updateProfile(strapiUrl, topics.length ? { ...profile, topics: topicIds } : profile);
      profileSaved = true;
      await saveConsent(strapiUrl, toSave);
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
      } else if (profileSaved) {
        setFormError("Vos informations sont enregistrées, mais pas vos choix de visibilité. Vérifiez votre connexion et cliquez de nouveau sur « Continuer ».");
        setFocusField("continuer");
      } else {
        setFormError("Rien n’a été enregistré. Vérifiez votre connexion et réessayez.");
        setFocusField("continuer"); // le bouton désactivé pendant l'envoi a perdu le focus
      }
    }
  }

  return (
    <form noValidate onSubmit={validate}>
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

      {topics.length > 0 && (
        <fieldset className="mt-6" aria-describedby={topicError ? "sujets-aide sujets-erreur" : "sujets-aide"}>
          <legend className="font-heading text-xl font-semibold normal-case">
            Vos sujets d’intérêt
            <span aria-hidden="true" className="text-danger">
              {" "}
              *
            </span>
          </legend>
          <p id="sujets-aide" className="mt-1 text-sm text-muted">
            De 1 à {MAX_TOPICS}. L’accueil vous propose les personnes qui partagent vos sujets.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {topics.map((topic) => {
              const checked = topicIds.includes(topic.id);
              const full = !checked && topicIds.length >= MAX_TOPICS;
              return (
                <li key={topic.id}>
                  <label
                    className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 px-4 font-semibold ${
                      checked ? "border-primary-ink bg-surface text-title" : full ? "cursor-not-allowed border-surface-alt text-muted" : "border-surface-alt bg-white text-ink hover:border-accent"
                    }`}
                  >
                    <input
                      id={`sujet-${topic.id}`}
                      type="checkbox"
                      className="size-5 accent-primary-ink"
                      checked={checked}
                      disabled={full}
                      onChange={(event) => {
                        setTopicError(null);
                        setTopicIds(event.target.checked ? [...topicIds, topic.id] : topicIds.filter((id) => id !== topic.id));
                      }}
                    />
                    {topic.name}
                  </label>
                </li>
              );
            })}
          </ul>
          {topicError && (
            <p id="sujets-erreur" role="alert" className="mt-2 flex items-start gap-2 text-sm font-semibold text-danger">
              <Icon name="alert" />
              {topicError}
            </p>
          )}
        </fieldset>
      )}

      <fieldset className="mt-6 rounded-xl bg-surface p-4">
        <legend className="float-left w-full font-heading font-semibold text-title">Vos choix de visibilité</legend>
        <p className="clear-both pt-1 text-sm text-muted">Vous pouvez les modifier à tout moment depuis votre profil.</p>
        <div className="mt-2">
          {CHOICES.map(({ name, label, help, effect }) => (
            <label key={name} className="flex min-h-11 gap-3 py-1">
              <input
                type="checkbox"
                checked={consent[name]}
                onChange={(event) => {
                  setAskDirectory(false);
                  setConsent({ ...consent, [name]: event.target.checked });
                }}
                aria-labelledby={`${name}-libelle`}
                aria-describedby={effect && !consent[name] ? `${name}-aide ${name}-effet` : `${name}-aide`}
                className="mt-0.5 size-5 shrink-0 accent-primary-ink"
              />
              <span>
                <span id={`${name}-libelle`} className="block font-semibold">
                  {label}
                </span>
                <span id={`${name}-aide`} className="block text-sm text-muted">
                  {help}
                </span>
                {effect && !consent[name] && (
                  <span id={`${name}-effet`} className="block text-sm font-semibold text-ink">
                    {effect}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
        <p id="badge-consentement" className="mt-2 text-sm text-muted">
          Mon badge comporte un QR code qui affiche mon nom, ma fonction et mon entreprise (et ma fiche si mon profil est visible) à la personne qui le
          scanne.
        </p>
        <div role="status" className="mt-2 empty:hidden">
          {consent.meetingsOptIn && !consent.directoryOptIn && (
            <p className="flex items-start gap-2 rounded-lg bg-white p-3 text-sm">
              <Icon name="info" />
              Sans apparaître dans l’annuaire, seules les personnes à qui vous écrivez pourront vous proposer un rendez-vous.
            </p>
          )}
        </div>
      </fieldset>

      {askDirectory && (
        <div
          id="confirmation-annuaire"
          role="alert"
          tabIndex={-1}
          aria-labelledby="confirmation-annuaire-titre"
          aria-describedby="confirmation-annuaire-texte"
          className="mt-6 rounded-lg border-2 border-title bg-white p-4"
        >
          <p id="confirmation-annuaire-titre" className="font-heading font-semibold text-title">
            Vous n’apparaîtrez pas dans l’annuaire
          </p>
          <p id="confirmation-annuaire-texte" className="mt-1 text-sm">
            Les autres participants ne vous verront pas et ne pourront pas vous trouver. L’annuaire est le moyen le plus simple d’être contacté.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => chooseDirectory(false)}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-title bg-white px-5 font-bold text-title hover:bg-surface"
            >
              Continuer sans apparaître
            </button>
            <button
              type="button"
              onClick={() => chooseDirectory(true)}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-gold px-5 font-bold text-gold-ink hover:bg-gold-light"
            >
              Apparaître dans l’annuaire
            </button>
          </div>
        </div>
      )}

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
