# Audit de la porte de l'espace participant (V2-Q, T-70, T-71)

Date : 18 novembre 2026. Tête 2b73e9f (vagues 1 à 5 intégrées), branche `lot/v2-q-audits`. Front construit, base e2e seedée, Chromium de Playwright. Tests : `web/tests/e2e/espace-a11y.spec.ts` (8 tests, verts).

## 1. T-70 : axe-core (wcag2a, wcag2aa, wcag21a, wcag21aa), 390 px et 1280 px

Écrans couverts : E0 (formulaire, état « Lien envoyé », lien invalide), E1 à E8 avec Léa (participant), « Mes données » du profil (boîte de confirmation ouverte), E9 avec l'organisateur (pilotage et toutes ses cartes : relances, badges, participants, rendez-vous, signalements ; relances avec aperçu et confirmation ; fiche d'un participant), carte publique de badge (jeton réel), carte non valable, page d'erreur, page introuvable, E10 (HTML de l'e-mail de connexion, la seule forme testable d'E10 qui soit des e-mails).

Résultat : aucune violation `critical`. 16 occurrences `serious` de 3 règles, réparties en 4 défauts. Toutes les autres violations (moderate, minor) : aucune relevée. Écrans sans aucune violation : E0 et ses états, E10, carte, carte non valable, erreur, introuvable.

Les défauts sont listés dans `KNOWN_VIOLATIONS` (le test reste vert ; retirer la ligne à la correction).

| N° | Règle | Gravité | Écrans | Largeur | Fichier probable | Lot propriétaire |
|---|---|---|---|---|---|---|
| A-1 | label-content-name-mismatch | serious | E1 | 390 | `web/src/pages/espace/[edition]/index.astro` l.68 : lien avatar `aria-label="Mon profil"` dont le texte visible est les initiales | V2-A |
| A-2 | label-content-name-mismatch | serious | E3, E3 Mes données, E4, E5, E6, E7, E7 fil, E8, E9 fiche participant | 390 | `web/src/components/espace/AppShell.astro` l.88-93 : avatar fixe `.top-2`, `aria-label="Mon profil, Prénom Nom"` pour des initiales visibles (F-149) | V4-B |
| A-3 | label-content-name-mismatch | serious | E9, E9 relances | 390 et 1280 | `web/src/react-components/espace/organizer/AttendeesCard.tsx` l.175 : bouton de ligne `aria-label="Ouvrir la fiche de X"` sans le nom, la société ni l'e-mail visibles (le nom y figure, mais l'étiquette ne commence pas par le texte visible) | V3-E |
| A-4 | listitem | serious | E7 fil | 390 et 1280 | `web/src/react-components/espace/ChatThread.tsx` l.276-291 : `<ol role="log">` remplace le rôle liste, ses `<li>` (séparateurs de jour, bulles) n'ont plus de parent liste | V3-D |

Correctif suggéré : A-1, A-2, A-3 : mettre le texte visible au début de l'étiquette ou retirer `aria-label` quand un texte sr-only suffit. A-4 : envelopper le `<ol>` dans un `<div role="log">`.

### Parcours clavier seul (T-43), 390 px

Verts, sans piège de focus : connexion par code à six chiffres (e-mail, Entrée, code, « Valider le code »), demande de rendez-vous (fiche, créneau à Espace, message, envoi), acceptation d'une demande, envoi d'un message (le focus reste atteignable ensuite). Chaque session est ouverte une fois (fichier temporaire de cookies, validé à la réutilisation).

## 2. T-71 : Lighthouse mobile

Lighthouse 13.6.0 par `npx` (sans l'ajouter aux dépendances), Chromium de Playwright (`CHROME_PATH`), émulation mobile par défaut, session de Léa transmise par en-tête Cookie, front construit sur 127.0.0.1 (hors réseau).

| Écran | Performance | Accessibilité | LCP | TBT | CLS | JS d'îlots (brut) | JS d'îlots (gzip) |
|---|---|---|---|---|---|---|---|
| E1 accueil | 99 | 100 | 1,2 s | 0 ms | 0 | 0 Ko | 0 Ko |
| E4 annuaire | 100 | 100 | 1,4 s | 0 ms | 0 | 205,6 Ko | 67,0 Ko |
| E6 agenda | 100 | 100 | 1,2 s | 0 ms | 0 | 221,0 Ko | 71,7 Ko |

E5 (fiche) n'a pas été passée à Lighthouse. Seuil T-71 (90 et 90) atteint partout. NF-20 (JavaScript d'îlots ≤ 80 Ko compressé) tenu : le gzip est calculé sur les fichiers de `dist-e2e/<port>/client/_astro/` (le serveur local ne compresse pas, Lighthouse rapporte donc le brut). Marge faible sur l'agenda (71,7 Ko) : React (`client.*.js`, 186 Ko brut) pèse l'essentiel.

Note : l'audit Lighthouse « label-content-name-mismatch » échoue sur les trois écrans (A-1, A-2), sans effet sur le score arrondi à 100.
