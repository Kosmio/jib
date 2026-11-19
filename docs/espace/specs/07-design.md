# 07. Design

L'espace participant reprend **le design system du site actuel** (feuille `/_astro/Layout.*.css`, Tailwind v4, variables `--color-*`). En phase 0, le designer confirme ces valeurs dans le code source et réutilise les variables et composants existants plutôt que d'en créer.

## Tokens

| Rôle | Variable existante | Valeur | Emploi |
|---|---|---|---|
| Couleur d'édition | `Edition.themeColor` | `#600e24` (Nouvelle-Aquitaine) | Bandeaux d'édition, en-tête des e-mails, créneau sélectionné |
| Action principale | `--color-gold` | `#f0ab00` | Boutons principaux, texte `#3a2410` dessus |
| Or clair | `--color-gold-light` | `#ffbe33` | Survol des boutons principaux |
| Titres | `--color-title` | `#325062` | Titres, onglet actif secondaire, liens |
| Vert Xylofutur | `--color-primary` | `#00b388` | Barres de progression, indicateurs, filet d'onglet actif (jamais en texte) |
| Vert texte | dérivé | `#007a5e` | Texte et icônes « Confirmé », onglet actif (contraste AA) |
| Surface | `--color-surface` | `#f5f0eb` | Fond des écrans |
| Surface alternée | `--color-surface-alt` | `#e8dfd4` | Bordures de cartes, piste des barres |
| Bois | `--color-wood` / `--color-wood-dark` | `#8b5a2b` / `#6b4423` | Avatars, statut « En attente » (texte `#6b4423`) |
| Accent | `--color-accent` | `#ad8b5e` | Avatars, décor (jamais en texte) |
| Texte | dérivé | `#2a3a44` | Corps |
| Texte secondaire | `--color-muted` | `#54585a` | Sous-titres, métadonnées |

Typographies (déjà chargées par le site) : **Azonix** (titres d'écran, majuscules, `--font-display`), **Sora** (intertitres, heures, chiffres, `--font-heading`), **Source Sans 3** (corps, `--font-sans`). Rayons : 8 px (boutons, champs), 12 px (cartes), 16 px (bandeaux). Espacement sur la base de 4 px.

## Composants à produire

| Composant | Variantes et états |
|---|---|
| `AppShell` | barre d'onglets basse (mobile), latérale (≥ 1024 px), badge de compteur |
| `EditionBanner` | couleur d'édition, motif de constellation discret (SVG), compte à rebours |
| `ProfileCard` | carte annuaire ; avatar photo ou initiales sur couleur déterministe |
| `TagBadge` | participant, intervenant, exposant (avec stand) |
| `SlotGrid` | groupes par pause ; créneau disponible, sélectionné, indisponible (barré), demande envoyée |
| `MeetingCard` | statut avec icône et mot, actions selon `can*` |
| `Timeline` | sessions et rendez-vous sur une même frise |
| `ChatThread` | bulles, horodatage, « Lu », zone de saisie |
| `ProgressBar`, `EmptyState`, `Toast`, `ConfirmDialog`, `Button` (principal, secondaire, discret, danger) |

## Règles

- Mobile d'abord ; cibles tactiles ≥ 44 px ; pas de barre d'état simulée.
- Statuts jamais portés par la couleur seule (mot et icône).
- Pas de dégradé décoratif hors du halo doré du bandeau d'édition, repris du site.
- Pas d'emoji. Icônes en trait (stroke 2 px), en SVG en ligne.
- Mouvement réduit respecté (`prefers-reduced-motion`) ; aucune animation d'entrée.
- Les maquettes de `docs/espace/maquettes/` font foi pour l'aspect.
