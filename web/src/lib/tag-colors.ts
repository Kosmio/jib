export const tagLabels: Record<string, string> = {
  entrepreneur: "Entrepreneur",
  chercheur: "Recherche",
  financeur: "Financement",
  institutionnel: "Institutionnel",
  organisateur: "Organisateur",
  introduction: "Introduction",
  finance: "Finance",
  recherche: "Recherche",
  temoignages: "Témoignages",
  actions: "Actions",
  pause: "Pause",
  cloture: "Clôture",
  "co-organisateur": "Co-organisateur",
  soutien: "Soutien",
  prive: "Privé",
};

export const tagColors: Record<string, string> = {
  entrepreneur: "bg-amber-100 text-amber-800",
  chercheur: "bg-blue-100 text-blue-800",
  financeur: "bg-emerald-100 text-emerald-800",
  institutionnel: "bg-purple-100 text-purple-800",
  organisateur: "bg-primary/10 text-primary-dark",
  "co-organisateur": "bg-primary/10 text-primary-dark",
  soutien: "bg-amber-100 text-amber-800",
  prive: "bg-gray-100 text-gray-700",
  introduction: "bg-primary/10 text-primary-dark",
  finance: "bg-amber-100 text-amber-800",
  recherche: "bg-emerald-100 text-emerald-800",
  temoignages: "bg-blue-100 text-blue-800",
  actions: "bg-purple-100 text-purple-800",
  pause: "bg-gray-100 text-gray-600",
  cloture: "bg-gray-100 text-gray-600",
};

export const getTagColor = (slug: string): string =>
  tagColors[slug] || "bg-gray-100 text-gray-700";

export const getTagLabel = (slug: string): string =>
  tagLabels[slug] || slug;
