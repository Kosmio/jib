# 01. Contexte et périmètre

## Problème

Les Journées de l'Innovation Filière Bois réunissent TPE, PME, startups, chercheurs et financeurs de la filière forêt-bois. La valeur principale de la journée tient aux rencontres d'affaires, aujourd'hui laissées au hasard des pauses. Xylofutur veut que chaque participant puisse identifier les bonnes personnes et réserver des rendez-vous avant et pendant l'événement, sans quitter ses outils actuels (site Astro/Strapi, billetterie HelloAsso).

## Objectifs mesurables (première édition)

| Id | Objectif | Cible |
|---|---|---|
| O-1 | Part des inscrits ayant activé leur espace | ≥ 60 % à J-1 |
| O-2 | Part des profils complets (voir R-30) | ≥ 50 % à J-1 |
| O-3 | Rendez-vous acceptés | ≥ 1 par participant actif en moyenne |
| O-4 | Ressaisie manuelle par l'équipe Xylofutur | aucune pour les inscrits |

## Personas

| Persona | Description | Besoin principal |
|---|---|---|
| Participant | Dirigeant ou cadre d'une entreprise de la filière, inscrit via HelloAsso, sur smartphone | Repérer et rencontrer des interlocuteurs utiles |
| Intervenant | Orateur d'une séquence du programme, également inscrit | Être sollicité sur son sujet, gérer ses créneaux |
| Exposant | Entreprise tenant un stand, représentée par 1 à 3 participants | Remplir son stand de rendez-vous qualifiés |
| Organisateur | Équipe Xylofutur | Suivre l'activation, relancer, exporter, faire le bilan |

## Périmètre v1 (P0)

1. Import automatique des inscrits HelloAsso et accès par lien magique.
2. Consentements de visibilité (RGPD).
3. Profil participant et fiches intervenants et exposants.
4. Annuaire avec recherche et filtres.
5. Prise de rendez-vous sur les créneaux des pauses B2B, attribution de table ou de stand.
6. Agenda personnel combinant programme et rendez-vous, export .ics.
7. Messagerie 1:1 avec notification par e-mail.
8. Trois scénarios de relance e-mail.
9. Programme, intervenants, informations pratiques (contenus Strapi existants).
10. Tableau de bord organisateur, exports CSV.
11. Installation en PWA (manifest, icônes, service worker minimal).

## Hors périmètre v1

| Élément | Raison |
|---|---|
| Publication sur l'App Store et Google Play | Délai de validation incompatible avec le 20 novembre |
| Notifications push | Option ultérieure (P2), la donnée est prête (R-60) |
| SMS | Coût et faible valeur ajoutée |
| Badges, contrôle d'accès, scan | Non demandés |
| Sondages, questions en direct, live, plan interactif | Non demandés |
| Billetterie | Reste sur HelloAsso |
| Matchmaking par IA | P2 ; v1 = suggestions par sujets communs (R-50) |
| Multilingue | Français uniquement |

## Contraintes

- Livraison le 20 novembre 2026, recette le 19.
- Hébergement : celui du site actuel, sans nouveau serveur si possible.
- Toutes les données restent dans la base Strapi de Xylofutur.
- Réutilisable pour les éditions suivantes (Auvergne-Rhône-Alpes, juin 2027) sans développement.
