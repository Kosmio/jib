# CLAUDE.md, espace participant JIB

Ce fichier est la mémoire partagée des agents (architect, designer, developer, tester). Le lire en entier avant toute tâche. L'architecte en est le seul propriétaire et le met à jour quand une connaissance opérationnelle se confirme.

## Mission

Ajouter au site existant des Journées de l'Innovation Filière Bois (journees-innovation-bois.xylofutur.fr, Astro + Strapi) un **espace participant** : application web installable (PWA) de profils, annuaire, prise de rendez-vous B2B, messagerie, relances e-mail et tableau de bord organisateur, alimentée par les inscriptions HelloAsso.

- Client : Xylofutur. Réalisation : Kosmio.
- Première édition servie : Nouvelle-Aquitaine, jeudi 3 décembre 2026, Bordeaux, environ 200 participants.
- **Mise en production impérative : vendredi 20 novembre 2026.** Recette client le 19 novembre.
- Budget au forfait très contraint : chaque choix privilégie la simplicité, la réutilisation de l'existant et le code le plus court qui satisfait les critères d'acceptation.

## Lecture obligatoire, dans cet ordre

1. `docs/espace/specs/00-index.md` : carte des spécifications et règles de travail des agents
2. Le fichier de spec de la phase en cours (voir `docs/espace/specs/09-phases.md`)
3. `docs/espace/specs/04-regles-metier.md` avant toute tâche qui touche aux rendez-vous

## Pile technique

- Front : **Astro** existant (v6 constaté en production). L'espace participant vit dans le même dépôt, sous `/espace/*`. Interactivité par îlots en **React 19**, déjà présent dans le dépôt (`@astrojs/react`).
- Back : **Strapi 5.59** sur **PostgreSQL 17** (constaté le 29 octobre 2026), servi sous `/strapi` sur le même domaine que le site.
- E-mail transactionnel : le compte et le domaine d'envoi **Brevo** déjà utilisés par le site, via une interface `MailProvider` pour pouvoir en changer.
- Multi-éditions : l'espace sert chaque édition sans développement ; tous les paramètres d'une édition (créneaux, tables, fenêtre de rendez-vous, formulaire HelloAsso) se règlent dans Strapi.
- Recette : sur le serveur de **dev** (workflow Deploy, environnement `dev`) ; la prod reste inchangée jusqu'à la mise en production.
- Pas de nouvelle base de données : tout est stocké dans la base de Strapi.
- Pas de service tiers d'analytics, pas de traqueur.

## Commandes

À compléter par l'architecte en phase 0 après analyse du dépôt (installation, lancement local du front et de Strapi, tests, lint, build). Ne jamais inventer une commande : la lire dans `package.json`.

## Conventions

- Langue de l'interface, des e-mails et des messages d'erreur : **français**. Langue du code (identifiants, noms de fichiers) : anglais.
- Typographie française dans les textes : apostrophe typographique ’, espace insécable avant « : ; ! ? » et dans les montants, guillemets « ».
- **Ne jamais utiliser le tiret cadratin (caractère U+2014) ni son entité HTML** dans aucun texte, HTML, e-mail ou commentaire. Utiliser virgule, deux-points, parenthèses.
- Formuler directement ; éviter les tournures « il ne s'agit pas de X mais de Y ».
- Toutes les entités métier sont rattachées à une **édition** (multi-éditions dès la v1).
- Aucune valeur de couleur ou de taille en dur hors des tokens de `docs/espace/specs/07-design.md`.
- Toute donnée personnelle sort de l'API uniquement si les règles de visibilité de `04-regles-metier.md` l'autorisent.
- Dates et heures stockées en UTC, affichées en Europe/Paris.

## Règles de travail entre agents

- Le developer n'écrit pas les tests ; le tester les écrit et les exécute. **Aucune phase n'est close sans feu vert du tester.**
- Chaque exigence porte un identifiant (`F-xx`, `R-xx`, `NF-xx`). Les commits, tests et revues citent ces identifiants.
- En cas d'ambiguïté non tranchée par les specs : consulter `11-questions-ouvertes.md`, appliquer l'hypothèse par défaut qui y figure et la signaler dans le compte rendu de phase.
- Ne pas modifier les pages publiques existantes du site hors des points d'intégration listés dans `03-ecrans.md`.
