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
    icon: ["M8 19a4 4 0 0 1-2.24-7.32A3.5 3.5 0 0 1 9 6.03V6a3 3 0 1 1 6 0v.04a3.5 3.5 0 0 1 3.24 5.65A4 4 0 0 1 16 19Z", "M12 19v3"],
  },
  industrie: {
    band: "bg-gold text-text",
    badge: "bg-white/40 text-text",
    border: "border-gold",
    icon: ["M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"],
  },
  coproduits: {
    band: "bg-accent-dark text-white",
    badge: WHITE_BADGE,
    border: "border-accent-dark",
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

export const getProgramTheme = (theme: string | null | undefined): ThemeStyle | null =>
  theme && theme in programThemes ? programThemes[theme as ProgramTheme] : null;
