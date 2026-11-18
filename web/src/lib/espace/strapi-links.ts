// Liens vers l'administration de Strapi (F-154, F-184, F-185), utilisables par le rendu serveur comme par les îlots.

/** Types de Strapi dont une fiche s'ouvre depuis l'interface (F-184). */
export const STRAPI_UID = {
  edition: "api::edition.edition",
  sequence: "api::sequence.sequence",
  intervention: "api::intervention.intervention",
  intervenant: "api::intervenant.intervenant",
  organisation: "api::organisation.organisation",
  exhibitor: "api::espace.exhibitor",
  attendee: "api::espace.attendee",
  badgeSetting: "api::espace.badge-setting",
  topic: "api::espace.topic",
} as const;

/** Fiche du gestionnaire de contenu de Strapi ; sans `documentId`, la liste du type ; sans `uid`, l'accueil de l'administration. */
export function strapiAdminUrl(strapiUrl: string, uid?: string, documentId?: string): string {
  const root = `${strapiUrl.replace(/\/+$/, "")}/admin`;
  if (!uid) return root;
  return `${root}/content-manager/collection-types/${uid}${documentId ? `/${encodeURIComponent(documentId)}` : ""}`;
}
