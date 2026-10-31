import React from "react";
import type { ProfileCard } from "../../lib/espace/client";
import { photoSrc } from "../../lib/espace/format";

// Carte de profil (E1 suggestions, E4 annuaire, E5 représentants, E7 interlocuteurs) : avatar ou initiales, nom, sous-titre, étiquette.
// Composant sans état : rendu serveur sans hydratation dans les pages (aucune directive `client:`), réutilisable dans un îlot.
//  - `href` : la carte entière est un lien, avec chevron (annuaire) ;
//  - `action` : un bouton (suggestions : « Rencontrer »), sous le texte et sur toute la largeur tant que la carte fait moins de
//    28 rem (`@md`, requête de conteneur : la largeur de la carte, pas celle de l'écran), à droite au-delà ;
//  - ni l'un ni l'autre : carte seule.
// `strapiUrl` (REACT_STRAPI_URL passé en propriété) préfixe le chemin de photo renvoyé par l'API.

export type { ProfileCard };

type Props = {
  card: ProfileCard;
  strapiUrl: string;
  href?: string;
  action?: { label: string; href: string };
};

/** Couleur d'avatar déterministe : quatre paires de jetons, choisies par l'empreinte de l'identifiant. */
const TONES = [
  "bg-wood text-white",
  "bg-title text-white",
  "bg-surface-alt text-wood-dark",
  "bg-accent text-gold-ink",
] as const;

function toneOf(key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}

/** Étiquette de type (TagBadge) : mot, jamais la couleur seule. */
export function tagOf(card: Pick<ProfileCard, "tag" | "standNumber">): { label: string; classes: string } {
  const stand = card.standNumber ? `, stand ${card.standNumber}` : "";
  switch (card.tag) {
    case "speaker":
      return { label: "Intervenant", classes: "bg-title text-white" };
    case "exhibitor":
      return { label: `Exposant${stand}`, classes: "bg-gold text-gold-ink" };
    case "exhibitor_rep":
      return { label: `Représentant${stand}`, classes: "bg-gold text-gold-ink" };
    default:
      return { label: "Participant", classes: "bg-surface-alt text-gold-ink" };
  }
}

/** Avatar rond : photo, sinon initiales sur une couleur déterministe. Décoratif, le nom est toujours à côté. */
export function Avatar({ card, strapiUrl, size = "size-12" }: { card: ProfileCard; strapiUrl: string; size?: string }) {
  const src = photoSrc(strapiUrl, card.photoUrl);
  return src ? (
    <img src={src} alt="" width={96} height={96} loading="lazy" className={`${size} shrink-0 rounded-full bg-surface-alt object-cover`} />
  ) : (
    <span
      aria-hidden="true"
      className={`flex ${size} shrink-0 items-center justify-center rounded-full font-heading font-semibold ${toneOf(`${card.kind}:${card.id}`)}`}
    >
      {card.initials}
    </span>
  );
}

export default function ProfileCardView({ card, strapiUrl, href, action }: Props) {
  const tag = tagOf(card);
  const body = (
    <>
      <Avatar card={card} strapiUrl={strapiUrl} />
      <span className="min-w-0 flex-1">
        <span className="block text-lg leading-snug font-bold text-ink">{card.displayName}</span>
        {card.subtitle && <span className="block leading-snug text-muted">{card.subtitle}</span>}
        <span className={`mt-1.5 inline-block rounded-md px-2 py-0.5 text-sm font-bold ${tag.classes}`}>{tag.label}</span>
      </span>
    </>
  );
  const frame = "flex items-center gap-4 rounded-xl border border-surface-alt bg-white p-4";

  if (href) {
    return (
      <a href={href} className={`${frame} min-h-11 hover:bg-surface`}>
        {body}
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-title">
          <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </span>
      </a>
    );
  }

  if (!action) return <div className={frame}>{body}</div>;

  return (
    <div className="@container">
      <div className="flex flex-col gap-4 rounded-xl border border-surface-alt bg-white p-4 @md:flex-row @md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">{body}</div>
        <a
          href={action.href}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-gold px-5 font-bold text-gold-ink shadow-md shadow-gold/25 hover:bg-gold-light"
        >
          {action.label}
          <span className="sr-only">{` : ${card.displayName}`}</span>
        </a>
      </div>
    </div>
  );
}
