// Thèmes visuels des séquences du programme, repris du programme imprimé (champ `theme` de la séquence dans Strapi).
// Chaque thème donne la couleur du bandeau et un pictogramme au trait (24 x 24). Classes écrites en entier pour Tailwind.

export type ProgramTheme = "foret" | "industrie" | "coproduits" | "ville" | "construction";

type ThemeStyle = {
  /** Fond et texte du bandeau. */
  band: string;
  /** Pastille du pictogramme, posée sur le bandeau. */
  badge: string;
  /** Bordure de la carte. */
  border: string;
  /** Pastille du fil chronologique, à côté de l'heure. */
  dot: string;
  /** Tracés du pictogramme. */
  icon: string[];
  /** Cercles du pictogramme : [cx, cy, r]. */
  circles?: [number, number, number][];
};

const WHITE_BADGE = "bg-white/20 text-white";

export const programThemes: Record<ProgramTheme, ThemeStyle> = {
  foret: {
    band: "bg-forest text-white",
    badge: WHITE_BADGE,
    border: "border-forest",
    dot: "bg-forest",
    icon: ["M8 19a4 4 0 0 1-2.24-7.32A3.5 3.5 0 0 1 9 6.03V6a3 3 0 1 1 6 0v.04a3.5 3.5 0 0 1 3.24 5.65A4 4 0 0 1 16 19Z", "M12 19v3"],
  },
  industrie: {
    band: "bg-gold text-text",
    badge: "bg-white/40 text-text",
    border: "border-gold",
    dot: "bg-gold",
    icon: ["M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"],
  },
  coproduits: {
    band: "bg-accent-dark text-white",
    badge: WHITE_BADGE,
    border: "border-accent-dark",
    dot: "bg-accent-dark",
    icon: [
      "M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2",
      "M8.5 2h7",
      "M7 16h10",
    ],
  },
  ville: {
    band: "bg-bordeaux text-white",
    badge: WHITE_BADGE,
    border: "border-bordeaux",
    dot: "bg-bordeaux",
    icon: [],
    circles: [
      [12, 7, 4],
      [12, 7, 1],
      [7, 16, 4],
      [7, 16, 1],
      [17, 16, 4],
      [17, 16, 1],
    ],
  },
  construction: {
    band: "bg-title text-white",
    badge: WHITE_BADGE,
    border: "border-title",
    dot: "bg-title",
    icon: [
      "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z",
      "M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",
      "M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2",
      "M10 6h4",
      "M10 10h4",
      "M10 14h4",
      "M10 18h4",
    ],
  },
};

// Repli quand le champ `theme` n'est pas renseigné dans Strapi : le thème se déduit du titre de la séquence.
// Motifs volontairement étroits (début de titre ou mot propre au thème), pour qu'une remise de prix ou une pause reste neutre.
const TITLE_HINTS: [RegExp, ProgramTheme][] = [
  [/coproduit/, "coproduits"],
  [/en ville|urbain/, "ville"],
  [/^foret/, "foret"],
  [/^constru/, "construction"],
  [/process|\bdatas?\b|\bia\b/, "industrie"],
];

const plain = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Style d'une séquence : le thème saisi dans Strapi, sinon celui que son titre laisse deviner, sinon rien (carte neutre). */
export const getProgramTheme = (theme: string | null | undefined, title?: string | null): ThemeStyle | null => {
  if (theme && theme in programThemes) return programThemes[theme as ProgramTheme];
  const guessed = title ? TITLE_HINTS.find(([pattern]) => pattern.test(plain(title)))?.[1] : undefined;
  return guessed ? programThemes[guessed] : null;
};
