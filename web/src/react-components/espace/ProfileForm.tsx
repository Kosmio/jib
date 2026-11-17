import React, { useEffect, useRef, useState } from "react";
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
      linkedinUrl: string;
      unavailableSessions: string[];
      photoUrl: string | null;
      topics: string[];
      emailPrefs: EmailPrefs;
    };
  /** Sujets de l'édition (`GET /editions/:slug/topics`), tri français. */
  topics: Topic[];
  /** Plages de rendez-vous B2B de la journée (D-10) ; sans plage, le bloc des disponibilités est omis. */
  b2bRanges?: { id: string; title: string; hours: string }[];
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

type FormValues = {
  profile: Profile;
  bio: string;
  linkedinUrl: string;
  awayIds: string[];
  topicIds: string[];
  consent: Consent;
  emailPrefs: EmailPrefs;
};

type FieldName = (typeof FIELDS)[number]["name"] | "bio" | "linkedinUrl" | "unavailableSessions" | "topics" | "emailPrefs";
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

export default function ProfileForm({ strapiUrl, editionSlug, initial, topics, b2bRanges = [] }: Props) {
  const [profile, setProfile] = useState<Profile>({
    firstName: initial.firstName,
    lastName: initial.lastName,
    jobTitle: initial.jobTitle,
    company: initial.company,
  });
  const [bio, setBio] = useState(initial.bio);
  const [linkedinUrl, setLinkedinUrl] = useState(initial.linkedinUrl);
  const [awayIds, setAwayIds] = useState<string[]>(initial.unavailableSessions);
  const [topicIds, setTopicIds] = useState<string[]>(initial.topics);
  const [consent, setConsent] = useState<Consent>({
    directoryOptIn: initial.directoryOptIn,
    meetingsOptIn: initial.meetingsOptIn,
    newsOptIn: initial.newsOptIn,
  });
  const [savedConsent, setSavedConsent] = useState<Consent>(consent);
  const [emailPrefs, setEmailPrefs] = useState<EmailPrefs>(initial.emailPrefs);
  // F-146 : valeurs au dernier enregistrement ; toute différence avec le formulaire est une modification en attente.
  const [baseline, setBaseline] = useState<FormValues>(() => ({
    profile: { firstName: initial.firstName, lastName: initial.lastName, jobTitle: initial.jobTitle, company: initial.company },
    bio: initial.bio,
    linkedinUrl: initial.linkedinUrl,
    awayIds: initial.unavailableSessions,
    topicIds: initial.topics,
    consent: { directoryOptIn: initial.directoryOptIn, meetingsOptIn: initial.meetingsOptIn, newsOptIn: initial.newsOptIn },
    emailPrefs: initial.emailPrefs,
  }));
  const [confirmingPhoto, setConfirmingPhoto] = useState(false);
  const savedRef = useRef<HTMLParagraphElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [photoUrl, setPhotoUrl] = useState(initial.photoUrl);
  const [photoState, setPhotoState] = useState<{ busy: boolean; error: string | null; done: boolean; removed: boolean }>({ busy: false, error: null, done: false, removed: false });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [focusField, setFocusField] = useState<string | null>(null);

  const loginUrl = `/espace/${encodeURIComponent(editionSlug)}/connexion`;
  const photo = photoSrc(strapiUrl, photoUrl);
  const atTopicLimit = topicIds.length >= TOPICS_MAX;
  const dirty = JSON.stringify({ profile, bio, linkedinUrl, awayIds, topicIds, consent, emailPrefs }) !== JSON.stringify(baseline);

  // F-146 : alerte du navigateur en quittant la page avec des modifications non enregistrées (changement d'onglet, lien, fermeture).
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // F-146 : la barre collante est opaque ; un champ qui prend le focus (ou que la barre vient recouvrir) est remonté au-dessus d'elle.
  function keepAboveBar(element: Element | null) {
    const bar = barRef.current;
    if (!element || !bar || !bar.hasAttribute("data-barre-enregistrement") || !element.closest("form")) return;
    const overlap = element.getBoundingClientRect().bottom - bar.getBoundingClientRect().top;
    if (overlap > -16) window.scrollBy({ top: overlap + 16 });
  }

  useEffect(() => {
    if (dirty) keepAboveBar(document.activeElement);
  }, [dirty]);

  // F-146 : le focus passe au message de succès, pour que le lecteur d'écran l'annonce et que la barre ne garde pas le focus.
  useEffect(() => {
    if (saved) savedRef.current?.focus();
  }, [saved]);

  // Le focus passe au premier champ en erreur (ou au bouton, après un échec d'envoi) une fois le message affiché.
  useEffect(() => {
    if (focusField) document.getElementById(focusField)?.focus();
  }, [focusField]);

  function touch() {
    setSaved(false);
  }

  /** F-146 « Annuler » : remet le formulaire aux valeurs du dernier enregistrement. */
  function cancel() {
    setProfile(baseline.profile);
    setBio(baseline.bio);
    setLinkedinUrl(baseline.linkedinUrl);
    setAwayIds(baseline.awayIds);
    setTopicIds(baseline.topicIds);
    setConsent(baseline.consent);
    setEmailPrefs(baseline.emailPrefs);
    setErrors({});
    setFormError(null);
    setSaved(false);
  }

  /** F-147 : supprime la photo (DELETE /me/photo) après confirmation. */
  async function removePhoto() {
    setConfirmingPhoto(false);
    setPhotoState({ busy: true, error: null, done: false, removed: false });
    try {
      await request<{ photoUrl: null }>(strapiUrl, "/me/photo", "DELETE");
      setPhotoUrl(null);
      setPhotoState({ busy: false, error: null, done: false, removed: true });
      setFocusField(null);
      setTimeout(() => setFocusField("photo"), 0);
    } catch (error) {
      if (error instanceof EspaceApiError && error.status === 401) {
        window.location.assign(loginUrl);
        return;
      }
      setPhotoState({ busy: false, error: "La suppression de la photo a échoué. Vérifiez votre connexion et réessayez.", done: false, removed: false });
    }
  }

  async function choosePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const fail = (error: string) => setPhotoState({ busy: false, error, done: false, removed: false });
    if (!PHOTO_TYPES.includes(file.type)) return fail("Choisissez une image JPEG, PNG ou WebP.");
    if (file.size > PHOTO_MAX_BYTES) return fail("La photo dépasse 5 Mo.");

    setPhotoState({ busy: true, error: null, done: false, removed: false });
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
      setPhotoState({ busy: false, error: null, done: true, removed: false });
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
      await updateProfile(strapiUrl, {
        ...profile,
        bio,
        linkedinUrl,
        // Seules les plages encore au programme partent : une plage retirée depuis ne bloque pas l'enregistrement.
        unavailableSessions: awayIds.filter((id) => b2bRanges.some((range) => range.id === id)),
        topics: topicIds,
        emailPrefs,
      });
      if (JSON.stringify(consent) !== JSON.stringify(savedConsent)) {
        await saveConsent(strapiUrl, consent);
        setSavedConsent(consent);
      }
      setBaseline({ profile, bio, linkedinUrl, awayIds, topicIds, consent, emailPrefs });
      setSaved(true);
      setSaving(false);
    } catch (error) {
      setSaving(false);
      if (error instanceof EspaceApiError && error.status === 401) {
        window.location.assign(loginUrl);
        return;
      }
      const names: FieldName[] = [...FIELDS.map(({ name }) => name), "linkedinUrl", "bio", "topics", "unavailableSessions", "emailPrefs"];
      const flagged = names.filter((name) => error instanceof EspaceApiError && name in error.fields);
      if (flagged.length) {
        const sent = (error as EspaceApiError).fields;
        const fallback = (name: FieldName) =>
          FIELDS.find((field) => field.name === name)?.fallback ?? (name === "bio" ? `${BIO_MAX} caractères au plus.` : "Valeur non valable.");
        setErrors(Object.fromEntries(flagged.map((name) => [name, sent[name] || fallback(name)])));
        setFormError("Corrigez les champs signalés pour enregistrer.");
        setFocusField(flagged[0] === "topics" ? "sujet-0" : flagged[0] === "emailPrefs" ? "emailPrefs-0" : flagged[0] === "unavailableSessions" ? "plage-0" : flagged[0]);
      } else {
        setFormError("L’enregistrement a échoué. Vérifiez votre connexion et réessayez.");
        setFocusField("enregistrer"); // le bouton désactivé pendant l'envoi a perdu le focus
      }
    }
  }

  const inputClass = (name: FieldName) =>
    `mt-2 w-full rounded-lg border-2 bg-white px-4 text-lg text-ink ${errors[name] ? "border-danger" : "border-accent"}`;

  return (
    <form noValidate onSubmit={submit} onFocus={(event) => keepAboveBar(event.target)} className="space-y-6 [&_input]:scroll-mb-44 [&_textarea]:scroll-mb-44">
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
            {photo && !confirmingPhoto && (
              <button
                type="button"
                id="supprimer-photo"
                onClick={() => setConfirmingPhoto(true)}
                disabled={photoState.busy}
                className="ml-2 inline-flex min-h-11 items-center justify-center px-3 font-bold text-title underline disabled:opacity-60"
              >
                Supprimer la photo
              </button>
            )}
            <p id="photo-aide" className="mt-2 text-sm text-muted">
              JPEG, PNG ou WebP, 5&nbsp;Mo au plus. Elle est recadrée en carré et enregistrée dès son envoi.
            </p>
          </div>
        </div>
        {confirmingPhoto && (
          <div role="group" aria-labelledby="photo-confirmation" className="mt-3 rounded-lg border-2 border-title bg-white p-3">
            <p id="photo-confirmation" className="font-semibold">
              Supprimer votre photo ? Vos initiales la remplaceront.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                id="confirmer-suppression-photo"
                autoFocus
                onClick={removePhoto}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-danger bg-white px-4 font-bold text-danger"
              >
                Oui, supprimer
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingPhoto(false);
                  setFocusField(null);
                  setTimeout(() => setFocusField("supprimer-photo"), 0);
                }}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-title bg-white px-4 font-bold text-title"
              >
                Garder la photo
              </button>
            </div>
          </div>
        )}
        <div role="status" className="empty:hidden">
          {photoState.removed && (
            <p className="mt-2 flex items-start gap-2 font-semibold text-primary-ink">
              <Icon name="check" />
              Photo supprimée
            </p>
          )}
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
          <label htmlFor="linkedinUrl" className="block font-semibold">
            Page LinkedIn (facultatif)
          </label>
          <input
            id="linkedinUrl"
            name="linkedinUrl"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="linkedin.com/in/votre-nom"
            maxLength={200}
            value={linkedinUrl}
            onChange={(event) => {
              touch();
              setLinkedinUrl(event.target.value);
            }}
            aria-invalid={errors.linkedinUrl ? "true" : undefined}
            aria-describedby={`linkedinUrl-aide${errors.linkedinUrl ? " linkedinUrl-erreur" : ""}`}
            className={`${inputClass("linkedinUrl")} min-h-12`}
          />
          <p id="linkedinUrl-aide" className="mt-1 text-sm text-muted">
            Affichée sur votre fiche de l’annuaire.
          </p>
          {errors.linkedinUrl && <FieldError id="linkedinUrl-erreur">{errors.linkedinUrl}</FieldError>}
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

      {b2bRanges.length > 0 && (
        <fieldset className="min-w-0 rounded-xl bg-surface p-4" aria-describedby={errors.unavailableSessions ? "plages-erreur" : "plages-aide"}>
          <legend className="float-left w-full font-heading font-semibold text-title">Vos disponibilités pour les rendez-vous</legend>
          <p id="plages-aide" className="clear-both pt-1 text-sm text-muted">
            Décochez une plage où vous ne serez pas disponible : ses créneaux ne seront plus proposés. Les rendez-vous déjà pris sont conservés.
          </p>
          <div className="mt-2">
            {b2bRanges.map((range, index) => (
              <label key={range.id} className="flex min-h-11 items-start gap-3 py-1">
                <input
                  id={`plage-${index}`}
                  aria-describedby={awayIds.includes(range.id) ? `plage-${index}-effet` : undefined}
                  type="checkbox"
                  checked={!awayIds.includes(range.id)}
                  onChange={(event) => {
                    touch();
                    setAwayIds((current) => (event.target.checked ? current.filter((id) => id !== range.id) : [...current, range.id]));
                  }}
                  className="mt-0.5 size-5 shrink-0 accent-primary-ink"
                />
                <span>
                  <span className="block font-semibold">{range.hours || range.title}</span>
                  {range.hours && <span className="block text-sm text-muted">{range.title}</span>}
                  {awayIds.includes(range.id) && (
                    <span id={`plage-${index}-effet`} className="block text-sm font-semibold text-ink">
                      Aucun nouveau créneau ne sera proposé sur cette plage. Les rendez-vous confirmés et les demandes en attente restent dans votre agenda.
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
          {errors.unavailableSessions && <FieldError id="plages-erreur">{errors.unavailableSessions}</FieldError>}
        </fieldset>
      )}

      <fieldset id="visibilite" className="min-w-0 scroll-mt-4 rounded-xl bg-surface p-4">
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
          {!consent.meetingsOptIn && (
            <p className="mb-2 flex items-start gap-2 rounded-lg bg-white p-3 text-sm">
              <Icon name="info" />
              Vous ne recevrez plus de nouvelles demandes de rendez-vous. Celles déjà en attente restent dans votre agenda, à accepter ou à refuser.
            </p>
          )}
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

      <div
        ref={barRef}
        data-barre-enregistrement={dirty ? "" : undefined}
        className={dirty ? "sticky bottom-17 z-30 -mx-5 border-t border-surface-alt bg-white px-5 py-3 shadow-[0_-4px_12px_rgb(0_0_0/0.08)] lg:bottom-0" : ""}
      >
        {dirty && !saving && (
          <p id="modifications-en-attente" className="mb-2 text-sm font-semibold">
            Modifications non enregistrées
          </p>
        )}
        <div className="flex gap-3">
          {dirty && (
            <button
              id="annuler"
              type="button"
              onClick={cancel}
              disabled={saving}
              className="inline-flex min-h-13 shrink-0 items-center justify-center rounded-lg border-2 border-title bg-white px-5 text-lg font-bold text-title hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
            >
              Annuler
            </button>
          )}
          <button
            id="enregistrer"
            type="submit"
            disabled={saving}
            aria-busy={saving}
            className="inline-flex min-h-13 w-full items-center justify-center rounded-lg bg-gold px-6 text-lg font-bold text-gold-ink shadow-md shadow-gold/25 hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
        <div role="status" className="empty:hidden">
          {saved && (
            <p ref={savedRef} tabIndex={-1} className="mt-3 flex items-start justify-center gap-2 font-semibold text-primary-ink outline-none">
              <Icon name="check" />
              Profil enregistré
            </p>
          )}
        </div>
      </div>
    </form>
  );
}
