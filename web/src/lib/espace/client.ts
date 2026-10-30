// Client de l'API de l'espace participant pour le navigateur (îlots React) : aucune variable d'environnement,
// l'adresse de Strapi vient en propriété de la page. Les types sont partagés avec le rendu serveur (api.ts).
// Contrat : docs/espace/specs/06-api.md et docs/espace/journal/phase-2-plan.md (section 3.2).
// La session est un cookie posé par Strapi, d'où `credentials: "include"`.

/** Sujet d'une édition (`GET /editions/:slug/topics`) et sujet d'un profil. */
export type Topic = { id: string; name: string };

/** CarteProfil de l'API : une personne (`attendee`) ou un exposant (`exhibitor`), en liste, en suggestion ou en interlocuteur. */
export type ProfileCard = {
  kind: "attendee" | "exhibitor";
  id: string;
  displayName: string;
  subtitle: string;
  /** Chemin renvoyé par Upload (`/uploads/…`) : à préfixer par l'adresse publique de Strapi (`photoSrc`, format.ts). */
  photoUrl: string | null;
  initials: string;
  tag: "participant" | "speaker" | "exhibitor_rep" | "exhibitor";
  topics: Topic[];
  standNumber?: string | number | null;
  hostedTableNumber?: number | null;
};

export type EmailPrefs = {
  meetingRequests: boolean;
  messages: boolean;
  reminders: boolean;
};

export type MeExhibitor = { id: string; name: string; standNumber: string | number | null };

/** Compteurs des badges d'onglet (F-24) : seulement dans `GET /me`, jamais dans la réponse d'un PATCH ou d'un PUT (A-36). */
export type MeCounts = { pendingReceived: number; unreadMessages: number };

export type Me = {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  company: string | null;
  role: string;
  isOrganizer: boolean;
  edition: { slug: string; title: string };
  consent: {
    directoryOptIn: boolean;
    meetingsOptIn: boolean;
    newsOptIn: boolean;
    consentAt: string | null;
  };
  bio: string | null;
  photoUrl: string | null;
  topics: Topic[];
  emailPrefs: EmailPrefs;
  profileCompletion: number;
  exhibitor: MeExhibitor | null;
  hostedTableNumber: number | null;
  counts?: MeCounts;
};

export type Profile = {
  firstName: string;
  lastName: string;
  jobTitle: string;
  company: string;
};

/** Corps de PATCH /me de l'écran E3 : les quatre champs importés plus présentation, sujets (documentId) et préférences e-mail. */
export type ProfileUpdate = Profile & {
  bio: string;
  topics: string[];
  emailPrefs: EmailPrefs;
};

export type Consent = {
  directoryOptIn: boolean;
  meetingsOptIn: boolean;
  newsOptIn: boolean;
};

/** Échec d'un appel : `status` 0 quand le serveur n'a pas répondu, `fields` pour une erreur 400 VALIDATION. */
export class EspaceApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = "EspaceApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/**
 * Appel de l'API depuis le navigateur ; `path` commence par `/` (« /meetings/abc/accept »). `body` : objet (envoyé en JSON),
 * `FormData` (envoi multipart, le navigateur pose l'en-tête) ou rien (GET, POST sans corps). Rend le JSON de la réponse, `null`
 * pour un 204. Échec : `EspaceApiError` (`status` 0 sans réponse du serveur, `code` et `message` de l'API, `fields` d'un VALIDATION).
 */
export async function request<T>(baseUrl: string, path: string, method: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/espace${path}`, {
      method,
      credentials: "include",
      headers: body === undefined || isForm ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new EspaceApiError(0, "NETWORK", "Le serveur ne répond pas.");
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data?.error;
    throw new EspaceApiError(response.status, error?.code ?? "UNKNOWN", error?.message ?? "", error?.fields);
  }
  return data as T;
}

/** PATCH /me : les quatre champs importés de l'inscription (F-30), ou le profil complet de E3 (`ProfileUpdate`). */
export const updateProfile = (baseUrl: string, profile: Profile | ProfileUpdate) =>
  request<Me>(baseUrl, "/me", "PATCH", profile);

/** PUT /me/consent : les trois choix de visibilité, tous obligatoires (R-40, F-10). */
export const saveConsent = (baseUrl: string, consent: Consent) => request<Me>(baseUrl, "/me/consent", "PUT", consent);
