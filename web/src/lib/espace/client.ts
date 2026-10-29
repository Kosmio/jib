// Client de l'API de l'espace participant pour le navigateur (îlots React) : aucune variable d'environnement,
// l'adresse de Strapi vient en propriété de la page. Les types sont partagés avec le rendu serveur (api.ts).
// Contrat : docs/espace/specs/06-api.md. La session est un cookie posé par Strapi, d'où `credentials: "include"`.

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
};

export type Profile = {
  firstName: string;
  lastName: string;
  jobTitle: string;
  company: string;
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

async function request<T>(baseUrl: string, path: string, method: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/espace${path}`, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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

/** PATCH /me : les quatre champs importés de l'inscription (F-30). */
export const updateProfile = (baseUrl: string, profile: Profile) => request<Me>(baseUrl, "/me", "PATCH", profile);

/** PUT /me/consent : les trois choix de visibilité, tous obligatoires (R-40, F-10). */
export const saveConsent = (baseUrl: string, consent: Consent) => request<Me>(baseUrl, "/me/consent", "PUT", consent);
