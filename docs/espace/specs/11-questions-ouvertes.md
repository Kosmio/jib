# 11. Questions ouvertes et hypothèses par défaut

Tant qu'une question n'est pas tranchée par Xylofutur, les agents appliquent l'hypothèse par défaut et la mentionnent dans le compte rendu de phase.

| Id | Question | Qui tranche | Hypothèse par défaut |
|---|---|---|---|
| Q-01 | Qui maintient le site et l'hébergement ? Accès au dépôt et à la base ? | Xylofutur | Bloquant pour la phase 0 : à obtenir le 2 novembre |
| Q-02 | Version de Strapi et base de données (SQLite, PostgreSQL) ? | Phase 0 | Adapter ; si SQLite en production, vérifier la tenue des transactions de R-13 |
| Q-03 | Libellés exacts des champs personnalisés HelloAsso (fonction, entreprise) | Xylofutur | Ajout demandé ; à défaut, saisie à la première connexion |
| Q-04 | Nombre de tables disponibles par créneau | Xylofutur | 20 |
| Q-05 | Durée d'un créneau | Xylofutur | 15 minutes |
| Q-06 | Ouverture et fermeture de la prise de RDV | Xylofutur | 20 novembre 10h00 au 2 décembre 18h00 |
| Q-07 | Demandes de RDV autorisées le jour J sur place ? | Xylofutur | Non en v1 (fenêtre fermée la veille) ; P1 : réouverture le jour J pour les créneaux de l'après-midi |
| Q-08 | Les exposants ont-ils tous un billet HelloAsso nominatif ? | Xylofutur | Oui ; rattachement au stand par l'organisateur dans Strapi |
| Q-09 | Fournisseur d'e-mail et domaine d'envoi (SPF, DKIM sur xylofutur.fr) | Xylofutur | Brevo, sous-domaine dédié ; configuration DNS à demander dès le 2 novembre |
| Q-10 | Texte de la politique de confidentialité de l'espace | Xylofutur | Brouillon fourni par l'équipe, validation Xylofutur avant le 19 novembre |
| Q-11 | Domaine de l'espace : même domaine que le site ? | Phase 0 | `journees-innovation-bois.xylofutur.fr/espace/…` |
| Q-12 | Nom des organisateurs ayant accès au tableau de bord | Xylofutur | Liste d'e-mails dans `ORGANIZER_EMAILS` |

## Réponses et décisions au 29 octobre 2026

| Id | Réponse | Source |
|---|---|---|
| Q-01 | Dépôt GitHub `Kosmio/jib`, maintenu par Kosmio. Serveurs dev et prod déployés par le workflow Deploy (GitHub Actions, SSH). | constat |
| Q-02 | Strapi 5.59 sur PostgreSQL 17, en dev comme en prod. Les transactions requises par R-13 sont disponibles. | constat |
| Q-04, Q-05, Q-06 | Réglables dans Strapi pour chaque édition (`tablesCount`, `slotDurationMinutes`, `meetingRequestsOpenAt`, `meetingRequestsCloseAt`). Les hypothèses par défaut servent de valeurs initiales. | Mathieu |
| Q-09 | Même compte et même domaine d'envoi Brevo que le site actuel (formulaire de contact, newsletter). | Mathieu |
| Q-11 | Même domaine confirmé : Traefik sert le site sur `/` et Strapi sur `/strapi`. Le cookie de session (I-22) est posé sur le domaine du site, sans proxy supplémentaire. | constat |
| Q-03, Q-08 | Demandés à Xylofutur (Néthi), avec les identifiants API HelloAsso de production. En attendant, le développement se fait contre une organisation créée sur le bac à sable HelloAsso. | en attente |

| Id | Décision | Source |
|---|---|---|
| D-01 | Recette du 19 novembre sur le serveur de dev ; la prod reste inchangée jusqu'au 20 novembre (remplace l'alternative de la phase 4 de `09-phases.md`). | Mathieu |
| D-02 | Réalisation par l'équipe d'agents décrite dans `09-phases.md` (architecte, designer, developer, tester), avec les portes de validation prévues. | Mathieu |
| D-03 | Aucun paramètre d'édition en dur : tout ce qui varie d'une édition à l'autre se règle dans Strapi. | Mathieu |

## Constats préalables pour la phase 0

- Le programme vit dans le type `sequence` (titre, `start_time` et `end_time` en texte au format « 10h45 », relation `edition`). Pas de champ `kind` : les pauses B2B se repèrent aujourd'hui à leur titre. L'édition Nouvelle-Aquitaine compte déjà les trois pauses de R-01.
- Les intervenants sont le type `intervenant`, rattachés aux séquences par `intervention`.
- `partenaire` porte un rôle de soutien (soutien, co-organisateur, institutionnel, privé) entre une `organisation` et des éditions : ce n'est pas un exposant. Le type Exhibitor est à créer, en s'appuyant sur `organisation` pour le nom, le logo et la description.
- La couleur d'édition existe déjà : champ `hero_bg_color` (sélecteur de couleur), `#600e24` pour Nouvelle-Aquitaine.
- Les étiquettes `tag` mêlent thèmes et rôles ; les Topic par édition de `02-modele-donnees.md` restent à créer.
