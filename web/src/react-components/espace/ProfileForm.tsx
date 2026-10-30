import React, { useEffect, useState } from "react";
import {
  EspaceApiError,
  request,
  saveConsent,
  updateProfile,
  type Consent,
  type EmailPrefs,
  type Profile,
  type Topic,
} from "../../lib/espace/client";
import { initialsOf, photoSrc } from "../../lib/espace/format";

// E3 (F-30 à F-32, F-12, R-30, R-31, R-40, A-35) : photo, quatre champs importés, présentation (280), sujets (0 à 3), choix de visibilité
// de E2 et préférences e-mail. « Enregistrer » envoie PATCH /me, puis PUT /me/consent si un choix a changé. La photo part dès qu'elle
// est choisie (POST /me/photo) : recadrée en carré et réduite à 256 px par le navigateur, en WebP, ou en JPEG si le navigateur n'encode
// pas le WebP (Safari). Aucune dépendance : `canvas` seulement.

type Props = {
  /** REACT_STRAPI_URL : adresse publique de Strapi, atteinte par le navigateur. */
  strapiUrl: string;
  editionSlug: string;
  initial: Profile &
    Consent & {
      bio: string;
      photoUrl: string | null;
      topics: string[];
      emailPrefs: EmailPrefs;
    };
  /** Sujets de l'édition (`GET /editions/:slug/topics`), tri français. */
  topics: Topic[];
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

const EMAIL_CHOICES = [
  { name: "meetingRequests", label: "Demandes de rendez-vous", help: "Un e-mail quand quelqu’un vous propose un rendez-vous." },
  { name: "messages", label: "Messages", help: "Un e-mail quand vous recevez un message non lu." },
  { name: "reminders", label: "Rappels avant la journée", help: "Un récapitulatif de vos rendez-vous à l’approche de l’événement." },
] as const;

const BIO_MAX = 280;
const TOPICS_MAX = 3;
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_SIDE = 256;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

type FieldName = (typeof FIELDS)[number]["name"] | "bio" | "topics" | "emailPrefs";
type FieldErrors = Partial<Record<FieldName, string>>;

function Icon({ name }: { name: "alert" | "check" | "info" }) {
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
      <path d={name === "alert" ? "M12 8v5M12 16.5h.01" : name === "check" ? "m8.5 12.5 2.5 2.5 4.5-5" : "M12 11v5M12 7.5h.01"} />
    </svg>
  );
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="mt-2 flex items-start gap-2 text-sm font-semibold text-danger">
      <Icon name="alert" />
      {children}
    </p>
  );
}

/** Recadre au carré (centre de l'image) et réduit à 256 px ; WebP si le navigateur l'encode, sinon JPEG (A-35). */
async function squarePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_SIDE;
  canvas.height = PHOTO_SIDE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  // Fond uni sous les images transparentes : le JPEG n'a pas de transparence.
  context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--color-surface") || "transparent";
  context.fillRect(0, 0, PHOTO_SIDE, PHOTO_SIDE);
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, PHOTO_SIDE, PHOTO_SIDE);
  bitmap.close();
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  const webp = await encode("image/webp");
  if (webp?.type === "image/webp") return webp;
  const jpeg = await encode("image/jpeg");
  if (jpeg) return jpeg;
  throw new Error("canvas");
}

export default function ProfileForm({ strapiUrl, editionSlug, initial, topics }: Props) {
  const [profile, setProfile] = useState<Profile>({
    firstName: initial.firstName,
    lastName: initial.lastName,
    jobTitle: initial.jobTitle,
    company: initial.company,
  });
  const [bio, setBio] = useState(initial.bio);
  const [topicIds, setTopicIds] = useState<string[]>(initial.topics);
  const [consent, setConsent] = useState<Consent>({
    directoryOptIn: initial.directoryOptIn,
    meetingsOptIn: initial.meetingsOptIn,
    newsOptIn: initial.newsOptIn,
  });
  const [savedConsent, setSavedConsent] = useState<Consent>(consent);
  const [emailPrefs, setEmailPrefs] = useState<EmailPrefs>(initial.emailPrefs);
  const [photoUrl, setPhotoUrl] = useState(initial.photoUrl);
  const [photoState, setPhotoState] = useState<{ busy: boolean; error: string | null; done: boolean }>({ busy: false, error: null, done: false });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [focusField, setFocusField] = useState<string | null>(null);

  const loginUrl = `/espace/${encodeURIComponent(editionSlug)}/connexion`;
  const photo = photoSrc(strapiUrl, photoUrl);
  const atTopicLimit = topicIds.length >= TOPICS_MAX;

  // Le focus passe au premier champ en erreur (ou au bouton, après un échec d'envoi) une fois le message affiché.
  useEffect(() => {
    if (focusField) document.getElementById(focusField)?.focus();
  }, [focusField]);

  function touch() {
    setSaved(false);
  }

  async function choosePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const fail = (error: string) => setPhotoState({ busy: false, error, done: false });
    if (!PHOTO_TYPES.includes(file.type)) return fail("Choisissez une image JPEG, PNG ou WebP.");
    if (file.size > PHOTO_MAX_BYTES) return fail("La photo dépasse 5 Mo.");

    setPhotoState({ busy: true, error: null, done: false });
    let blob: Blob;
    try {
      blob = await squarePhoto(file);
    } catch {
      return fail("Cette image ne peut pas être lue. Choisissez un autre fichier.");
    }
    try {
      const body = new FormData();
      body.append("photo", blob, blob.type === "image/webp" ? "photo.webp" : "photo.jpg");
      const result = await request<{ photoUrl: string }>(strapiUrl, "/me/photo", "POST", body);
      setPhotoUrl(result.photoUrl);
      setPhotoState({ busy: false, error: null, done: true });
    } catch (error) {
      if (error instanceof EspaceApiError && error.status === 401) {
        window.location.assign(loginUrl);
        return;
      }
      fail(error instanceof EspaceApiError && error.message ? error.message : "L’envoi de la photo a échoué. Vérifiez votre connexion et réessayez.");
    }
  }

  function toggleTopic(id: string, checked: boolean) {
    touch();
    setTopicIds((current) => (checked ? [...current, id] : current.filter((item) => item !== id)));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setErrors({});
    setFormError(null);
    setSaved(false);
    setFocusField(null);

    try {
      await updateProfile(strapiUrl, { ...profile, bio, topics: topicIds, emailPrefs });
      if (JSON.stringify(consent) !== JSON.stringify(savedConsent)) {
        await saveConsent(strapiUrl, consent);
        setSavedConsent(consent);
      }
      setSaved(true);
      setSaving(false);
    } catch (error) {
      setSaving(false);
      if (error instanceof EspaceApiError && error.status === 401) {
        window.location.assign(loginUrl);
        return;
      }
      const names: FieldName[] = [...FIELDS.map(({ name }) => name), "bio", "topics", "emailPrefs"];
      const flagged = names.filter((name) => error instanceof EspaceApiError && name in error.fields);
      if (flagged.length) {
        const sent = (error as EspaceApiError).fields;
        const fallback = (name: FieldName) =>
          FIELDS.find((field) => field.name === name)?.fallback ?? (name === "bio" ? `${BIO_MAX} caractères au plus.` : "Valeur non valable.");
        setErrors(Object.fromEntries(flagged.map((name) => [name, sent[name] || fallback(name)])));
        setFormError("Corrigez les champs signalés pour enregistrer.");
        setFocusField(flagged[0] === "topics" ? "sujet-0" : flagged[0] === "emailPrefs" ? "emailPrefs-0" : flagged[0]);
      } else {
        setFormError("L’enregistrement a échoué. Vérifiez votre connexion et réessayez.");
        setFocusField("enregistrer"); // le bouton désactivé pendant l'envoi a perdu le focus
      }
    }
  }

  const inputClass = (name: FieldName) =>
    `mt-2 w-full rounded-lg border-2 bg-white px-4 text-lg text-ink ${errors[name] ? "border-danger" : "border-accent"}`;

  return (
    <form noValidate onSubmit={submit} className="space-y-6">
      <section aria-labelledby="photo-titre">
        <h2 id="photo-titre" className="font-heading text-xl font-semibold normal-case">
          Votre photo
        </h2>
        <div className="mt-3 flex items-center gap-4">
          {photo ? (
            <img src={photo} alt="" width={96} height={96} className="size-24 shrink-0 rounded-full bg-surface-alt object-cover" />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-24 shrink-0 items-center justify-center rounded-full bg-title font-heading text-2xl font-semibold text-white"
            >
              {initialsOf(profile.firstName, profile.lastName)}
            </span>
          )}
          <div className="min-w-0">
            <input
              id="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={choosePhoto}
              disabled={photoState.busy}
              aria-describedby="photo-aide"
              className="peer sr-only"
            />
            <label
              htmlFor="photo"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-title bg-white px-5 font-bold text-title peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-title peer-disabled:opacity-60 hover:bg-surface"
            >
              {photo ? "Changer la photo" : "Ajouter une photo"}
            </label>
            <p id="photo-aide" className="mt-2 text-sm text-muted">
              JPEG, PNG ou WebP, 5&nbsp;Mo au plus. Elle est recadrée en carré et enregistrée dès son envoi.
            </p>
          </div>
        </div>
        <div role="status" className="empty:hidden">
          {photoState.busy && <p className="mt-2 font-semibold">Envoi de la photo…</p>}
          {photoState.done && (
            <p className="mt-2 flex items-start gap-2 font-semibold text-primary-ink">
              <Icon name="check" />
              Photo enregistrée
            </p>
          )}
        </div>
        {photoState.error && (
          <p role="alert" className="mt-2 flex items-start gap-2 text-sm font-semibold text-danger">
            <Icon name="alert" />
            {photoState.error}
          </p>
        )}
      </section>

      <section aria-labelledby="infos-titre">
        <h2 id="infos-titre" className="font-heading text-xl font-semibold normal-case">
          Vos informations
        </h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {FIELDS.map(({ name, label, autoComplete, required }) => (
            <div key={name}>
              <label htmlFor={name} className="block font-semibold">
                {label}
              </label>
              <input
                id={name}
                name={name}
                type="text"
                autoComplete={autoComplete}
                required={required}
                value={profile[name]}
                onChange={(event) => {
                  touch();
                  setProfile({ ...profile, [name]: event.target.value });
                }}
                aria-invalid={errors[name] ? "true" : undefined}
                aria-describedby={errors[name] ? `${name}-erreur` : undefined}
                className={`${inputClass(name)} min-h-12`}
              />
              {errors[name] && <FieldError id={`${name}-erreur`}>{errors[name]}</FieldError>}
            </div>
          ))}
        </div>

        <div className="mt-4">
          <label htmlFor="bio" className="block font-semibold">
            Présentation (facultatif)
          </label>
          <textarea
            id="bio"
            name="bio"
            rows={4}
            maxLength={BIO_MAX}
            value={bio}
            onChange={(event) => {
              touch();
              setBio(event.target.value);
            }}
            aria-invalid={errors.bio ? "true" : undefined}
            aria-describedby={`bio-compteur${errors.bio ? " bio-erreur" : ""}`}
            className={`${inputClass("bio")} py-3`}
          />
          <p id="bio-compteur" className="mt-1 text-right text-sm text-muted">
            {bio.length}&nbsp;/&nbsp;{BIO_MAX}&nbsp;caractères
          </p>
          {errors.bio && <FieldError id="bio-erreur">{errors.bio}</FieldError>}
        </div>
      </section>

      {topics.length > 0 && (
        <fieldset className="min-w-0" aria-describedby={errors.topics ? "topics-erreur" : "topics-aide"}>
          <legend className="font-heading text-xl font-semibold text-title">Vos sujets d’intérêt</legend>
          <p id="topics-aide" className="mt-1 text-sm text-muted">
            Jusqu’à {TOPICS_MAX} sujets, pour recevoir des suggestions de rendez-vous. {topicIds.length}&nbsp;sur&nbsp;{TOPICS_MAX} choisis.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {topics.map((topic, index) => {
              const checked = topicIds.includes(topic.id);
              return (
                <label key={topic.id} className="relative">
                  <input
                    id={`sujet-${index}`}
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && atTopicLimit}
                    onChange={(event) => toggleTopic(topic.id, event.target.checked)}
                    className="peer absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                  />
                  <span
                    className={`inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-4 font-semibold peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-title peer-disabled:opacity-60 ${
                      checked ? "border-title bg-title text-white" : "border-accent bg-white text-title"
                    }`}
                  >
                    {checked && <Icon name="check" />}
                    {topic.name}
                  </span>
                </label>
              );
            })}
          </div>
          {errors.topics && <FieldError id="topics-erreur">{errors.topics}</FieldError>}
        </fieldset>
      )}

      <fieldset className="min-w-0 rounded-xl bg-surface p-4">
        <legend className="float-left w-full font-heading font-semibold text-title">Vos choix de visibilité</legend>
        <p className="clear-both pt-1 text-sm text-muted">Modifiables à tout moment.</p>
        <div className="mt-2">
          {CHOICES.map(({ name, label, help }) => (
            <label key={name} className="flex min-h-11 gap-3 py-1">
              <input
                type="checkbox"
                name={name}
                checked={consent[name]}
                onChange={(event) => {
                  touch();
                  setConsent({ ...consent, [name]: event.target.checked });
                }}
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

      <fieldset className="min-w-0 rounded-xl bg-surface p-4" aria-describedby={errors.emailPrefs ? "emailPrefs-erreur" : undefined}>
        <legend className="float-left w-full font-heading font-semibold text-title">E-mails que vous recevez</legend>
        <p className="clear-both pt-1 text-sm text-muted">Les e-mails sur un rendez-vous confirmé ou annulé sont toujours envoyés.</p>
        <div className="mt-2">
          {EMAIL_CHOICES.map(({ name, label, help }, index) => (
            <label key={name} className="flex min-h-11 gap-3 py-1">
              <input
                id={`emailPrefs-${index}`}
                type="checkbox"
                name={name}
                checked={emailPrefs[name]}
                onChange={(event) => {
                  touch();
                  setEmailPrefs({ ...emailPrefs, [name]: event.target.checked });
                }}
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
        {errors.emailPrefs && <FieldError id="emailPrefs-erreur">{errors.emailPrefs}</FieldError>}
      </fieldset>

      {formError && (
        <p role="alert" className="flex items-start gap-3 rounded-lg border-2 border-danger bg-white p-3 font-semibold">
          <span className="text-danger">
            <Icon name="alert" />
          </span>
          {formError}
        </p>
      )}

      <div>
        <button
          id="enregistrer"
          type="submit"
          disabled={saving}
          aria-busy={saving}
          className="inline-flex min-h-13 w-full items-center justify-center rounded-lg bg-gold px-6 text-lg font-bold text-gold-ink shadow-md shadow-gold/25 hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        <div role="status" className="empty:hidden">
          {saved && (
            <p className="mt-3 flex items-start justify-center gap-2 font-semibold text-primary-ink">
              <Icon name="check" />
              Profil enregistré
            </p>
          )}
        </div>
      </div>
    </form>
  );
}
