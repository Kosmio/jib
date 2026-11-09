# 12. Lot badges : badge PDF A4 pliable et carte par QR

Statut : **DRAFT**, demandé par Xylofutur le 9 novembre 2026, hors périmètre initial (`01-contexte-perimetre.md`, « Badges, contrôle d'accès, scan : non demandés »). À livrer avant le 2 décembre, après la mise en production du 20 novembre. Priorité P1 pour l'ensemble du lot ; aucune exigence ne bloque la recette du 19 novembre.

## Décisions de cadrage (Mathieu, 9 novembre)

- Format : A4 plié, deux colonnes (modèle de référence fourni par Xylofutur), identité visuelle de l'édition et logo des Journées de l'Innovation.
- Recto : logo, prénom et nom, entreprise, fonction, type (participant, intervenant, exposant), QR code.
- Verso : **programme de l'édition** (fixe, pris dans Strapi) et, à droite, **plan du lieu** si l'édition en porte un. Aucune donnée de rendez-vous : les badges sont imprimables à l'avance et ne se périment pas.
- Le QR renvoie vers la fiche du participant dans l'espace, pas vers LinkedIn : aucune collecte d'URL.
- Visibilité (option 2) : le scan du QR affiche la fiche **sans connexion**. Un profil visible (`directoryOptIn = true`) montre sa fiche R-42 ; un profil masqué montre une **carte réduite** limitée à ce qui est imprimé sur le badge. La navigation web suit R-41 comme avant.

## R. Règles métier

- **R-80** Jeton de carte : chaque Attendee actif a un jeton de carte aléatoire de 128 bits au moins (URL-safe), stocké haché (même traitement que les jetons de lien magique), jamais journalisé en clair. Le jeton donne accès en lecture seule à une seule page : la carte de cet Attendee. Il n'ouvre aucune session et ne permet aucune autre route.
- **R-81** Contenu de la carte, profil visible : les champs de R-42 (prénom, nom, fonction, entreprise, photo, présentation, sujets, type). **Jamais l'e-mail ni le téléphone.** Profil masqué : prénom, nom, fonction, entreprise et type uniquement, sans photo, présentation ni sujets. Ces quatre champs sont ceux imprimés sur le badge, donc déjà montrés par le porteur.
- **R-82** Les règles R-41 et R-42 restent inchangées pour la navigation web (annuaire, fiche, suggestions) : le jeton n'élargit que la page carte.
- **R-83** Durée de vie : le jeton cesse de fonctionner quand l'édition passe en lecture seule, ou quand l'Attendee est annulé (I-14). L'organisateur peut le régénérer (l'ancien cesse aussitôt, badge à réimprimer). Une carte invalide répond « Cette carte n'est plus valable », sans révéler si l'Attendee existe.
- **R-84** Un participant dont `consentAt` est vide (n'a jamais ouvert son espace) est traité comme profil masqué : la carte réduite s'affiche, jamais la fiche complète.

## F. Exigences fonctionnelles

- **F-95 (P1)** Page carte `/espace/{edition}/carte/{jeton}` : rendu serveur, sans JavaScript requis, `noindex`, `Referrer-Policy: strict-origin`. Affiche R-81, un bandeau d'édition et un bouton « Se connecter pour proposer un rendez-vous ».
- **F-96 (P1)** Le bouton de F-95 mène à E0 en mémorisant la fiche visée ; après connexion, retour sur la fiche de l'annuaire si R-41 l'autorise, sinon sur E1. Un scanneur déjà connecté est envoyé directement vers la fiche de l'annuaire (ou reste sur la carte si R-41 la masque).
- **F-97 (P1)** E9 : bouton « Générer les badges » produisant un PDF de tous les Attendee actifs de l'édition, une page A4 par badge, ordre alphabétique par défaut, filtre par type. Compte rendu : nombre de badges, profils masqués (carte réduite).
- **F-98 (P1)** E9 : « Badge à l'unité » depuis la fiche d'un participant, pour la réimpression sur place, et « Régénérer le jeton ».
- **F-99 (P1)** Strapi, édition : champs `badgePlan` (média, image du plan, facultatif) et `badgeAccent` facultatif (sinon `hero_bg_color`). Sans plan, le verso occupe toute la largeur avec le programme.

## Mise en page du badge

- A4 portrait, pli au milieu : deux demi-pages A5 côte à côte, verso et recto imprimés sur la même feuille comme sur le modèle de référence (colonne gauche et colonne droite). Repères de pli et de coupe discrets.
- Le bandeau de type (participant, intervenant, exposant) prend la couleur d'accent de l'édition ; texte en contraste AA minimum.
- QR code de 28 mm de côté au moins, niveau de correction M, zone de silence de 4 modules, noir sur blanc. URL courte par construction : `PUBLIC_URL` + chemin + jeton.
- Texte long : le nom et l'entreprise se réduisent par paliers puis se tronquent avec points de suspension ; un test couvre un nom de 40 caractères.
- Le programme est celui des séquences et interventions publiées de l'édition (même source que E8). Si le programme dépasse la place, il se réduit puis se coupe avec la mention « Programme complet dans l'application ».
- Polices et logos : fichiers du site (logo des JIB en vectoriel, SVG ou PDF, à fournir). Aucune valeur de couleur en dur hors des tokens de `07-design.md`.

## I. Intégration

- **I-43** Génération du PDF côté Strapi, dans `strapi/src/api/espace/lib/`, avec une bibliothèque PDF et une bibliothèque de QR code à choisir par l'architecte (critères : sobriété, aucun appel réseau, rendu vectoriel du QR). Aucun service tiers : le QR se génère localement (NF du site : pas de traqueur).

## API (à reporter dans `06-api.md`)

| Méthode | Route | Accès | Rôle |
|---|---|---|---|
| GET | `/cards/{edition}/{token}` | public, limité en débit | `Card` selon R-81 ; 404 uniforme si jeton invalide ou périmé (R-83) |
| POST | `/admin/{edition}/badges` | organisateur | PDF de F-97, corps `{ types?: string[] }`, réponse `application/pdf` |
| GET | `/admin/{edition}/attendees/{id}/badge` | organisateur | PDF d'un badge (F-98) |
| POST | `/admin/{edition}/attendees/{id}/card-token/regenerate` | organisateur | nouveau jeton (F-98, R-83) |

Modèle : champ `cardTokenHash` (string, unique, indexé) et `cardTokenCreatedAt` (datetime) sur l'Attendee. Sur un type existant, scalaires seulement (CLAUDE.md, A-15). Création des jetons : migration de remplissage à l'activation du lot, pour les Attendee déjà importés, puis à l'import pour les nouveaux.

## NF. Sécurité et RGPD

- **NF-54** Limitation de débit de `/cards/…` par IP (30 requêtes par minute), réponse 404 identique pour un jeton inconnu, expiré ou d'un Attendee annulé, pour éviter l'énumération.
- **NF-55** Le jeton n'apparaît dans aucun journal ni e-mail ; le gabarit du badge est le seul endroit qui le reçoit en clair, à la génération. Les jetons étant stockés hachés, régénérer est la seule façon de réimprimer un badge pour un jeton perdu.
- **NF-56** Texte de consentement (E2, R-40) : ajouter « Mon badge comporte un QR code qui affiche mon nom, ma fonction et mon entreprise (et ma fiche si mon profil est visible) à la personne qui le scanne. » La formulation est à valider par Xylofutur avant mise en ligne ; les participants déjà inscrits sont informés par e-mail avant l'impression.
- **NF-57** La page carte n'est jamais mise en cache partagée (`Cache-Control: private, no-store`) et ne charge aucune ressource tierce.

## Critères d'acceptation

- **T-60** Étant donné un participant visible, quand on ouvre l'URL de son QR sans session, alors la fiche R-42 s'affiche, sans e-mail ni téléphone.
- **T-61** Étant donné un participant masqué, quand on ouvre l'URL de son QR sans session, alors seuls prénom, nom, fonction, entreprise et type s'affichent ; ni photo, ni présentation, ni sujets dans le HTML ni dans la réponse API.
- **T-62** Étant donné le même participant masqué, quand un autre participant ouvre sa fiche par l'annuaire, alors R-41 s'applique (refus), sans changement.
- **T-63** Étant donné un jeton inconnu, expiré, d'un Attendee annulé ou d'une édition en lecture seule, alors la réponse est la même 404 et le même texte.
- **T-64** Étant donné un jeton régénéré, alors l'ancien est refusé et le nouveau accepté.
- **T-65** Étant donné une édition de 17 participants de recette, quand l'organisateur génère les badges, alors le PDF compte 17 pages A4, chaque page porte le bon nom et un QR qui, décodé, donne l'URL attendue.
- **T-66** Étant donné un nom de 40 caractères, une entreprise de 60, un programme de 30 interventions, alors rien ne déborde de sa colonne.
- **T-67** Étant donné un scan sans session puis une connexion par lien magique, alors le retour se fait sur la fiche visée si R-41 l'autorise.
- **T-68** Étant donné une édition sans `badgePlan`, alors le verso est complet sans zone vide.
- **T-69** Contrôle de conventions : aucun tiret cadratin dans les gabarits et fichiers du lot (`conventions.test.js` étendu).

## Hors lot

- Impression, découpe et pliage, matériel du jour J.
- Contrôle d'accès, scan d'entrée, émargement (toujours hors périmètre).
- Rendez-vous B2B sur le badge (écarté le 9 novembre : le verso est le programme fixe).
- QR vers LinkedIn (écarté : le QR renvoie vers l'espace).

## Questions ouvertes

1. Dimensions imprimables exactes et marges de l'imprimeur, ou imprimante de bureau.
2. Logo des JIB en vectoriel, et fichier du plan du lieu.
3. Validation par Xylofutur du texte NF-56 et de la carte réduite (option 2).
4. Faut-il un badge pour les organisateurs et bénévoles absents de HelloAsso ? Hypothèse par défaut : non, génération depuis l'organisateur à l'unité seulement si un Attendee existe.
