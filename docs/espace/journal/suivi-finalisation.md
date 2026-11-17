# Suivi de la finalisation, espace participant JIB

Tenu par le superviseur (`13-orchestration.md`, section 11). Lots : `specs/14-lots-finalisation.md`. Départ : `feat/espace-participant` à `f1d8824`, mardi 17 novembre 2026.

Consigne de Mathieu du 17 novembre : coder toutes les vagues à la suite, sans attendre les dates de la vue d'ensemble ; badges obligatoires (D-13) ; connexion par code à six chiffres réalisée (D-17).

| Lot | Vague | État | Créneau | Branche | Tête | Tests du lot | Intégré le | Reste, blocage |
|---|---|---|---|---|---|---|---|---|
| V1-A | 1 | intégré | | lot/v1-a-deploiement | e9f765f | deploy-workflow 4/4, backup.sh essayé (14 archives, cron idempotent, restauration) | 17/11 | |
| V1-B | 1 | en cours | 1 | lot/v1-b-acces | c94f8b2 | acces-robuste 18/18, acces 110/110 ; e2e 8 échecs | | adresse e-mail dans l'URL à retirer, 401 de l'îlot du profil |
| V1-C | 1 | intégré | 2 | lot/v1-c-ouverture | 6a6ec49 | welcome 12, espace-welcome 19, sync 64, recette e2e 24 | 17/11 | |
| V1-D | 1 | intégré | 3 | lot/v1-d-gardes | ce7b968 | admin-gardes 26, admin-guards 28, seed 55, concurrence 16 | 17/11 | |
| V1-E | 1 | intégré | 4 | lot/v1-e-erreurs | dbfda4c | web-middleware 63, espace-erreurs 15 | 17/11 | |
| V2-A | 2 | intégré | 9 | lot/v2-a-accueil-agenda | b398722 | accueil-agenda 19 | 17/11 | recette e2e à rejouer en entier |
| V2-B | 2 | intégré | 5 | lot/v2-b-consentement | b488de2 | consentement 10, parcours et recette adaptés | 17/11 | |
| V2-C | 2 | intégré | 7 | lot/v2-c-admin-lisible | 4a1c098 | time 63, admin-libelles 28 | 17/11 | |
| V2-D | 2 | à lancer | | | | | | |
| V2-E | 2 | intégré | 8 | lot/v2-e-finitions | 62d2533 | templates 132, pwa 6, finitions 2 | 17/11 | theme-color à relayer par AppShell (V2-D) ; test:visual non lancé |
| V2-Q | 2 | arrêté | 6 | | | | | relancé en fin de vague 2 (mémoire) |
| V3-A | 3 | intégré | 10 | lot/v3-a-relances | 2152115 | reminders 73, templates 57, relances 38 | 17/11 | |
| V3-B | 3 | à lancer | | | | | | |
| V3-C | 3 | à lancer | | | | | | |
| V3-D | 3 | à lancer | | | | | | |
| V3-E | 3 | en cours | 11 | lot/v3-e-participants | c23990c | | | développement interrompu |
| V3-F | 3 | à relire | 12 | lot/v3-f-rendezvous | 877b0c0 | | | tests interrompus |
| V3-G | 3 | à lancer | | | | | | |
| V4-A | 4 | à lancer | | | | | | |
| V4-B | 4 | à lancer | | | | | | |
| V4-C | 4 | à lancer | | | | | | |
| V4-D | 4 | à lancer | | | | | | |
| V4-E | 4 | à lancer | | | | | | |
| V4-F | 4 | à lancer | | | | | | |
| V5-A à V5-G | 5 | à détailler | | | | | | |

## Décisions appliquées

- D-13 : badges réalisés (Mathieu, 17/11). Réponses par défaut aux questions de `12-badges.md` consignées dans `13-orchestration.md`, section 8.
- D-17 : code à six chiffres réalisé sans attendre H-5 (Mathieu, 17/11).
- D-12, D-14, D-15, D-16, D-18 : valeurs par défaut de la section 8.

## Écarts aux specs

- Arbres de travail des lots sous `<dépôt>/.lots/<id>` (exclu par `.git/info/exclude`) au lieu de `../jib-lots/`, pour rester dans le dossier de travail des agents.

## Écarts (suite)

- Intégration : la suite complète est lancée une fois par lot de fusions, pas après chaque lot (machine limitée en mémoire et en disque) ; les lots sont fusionnés en local et poussés après la suite verte.
- V1-B : `organisateur.astro` et `ProfileForm.tsx` attribués à V1-B pour une ligne chacun (F-103, F-104).
- V2-B : `espace-parcours.spec.ts` et `espace-recette.spec.ts` adaptés par le testeur de V2-B.
- V1-C : l'aperçu de l'e-mail est isolé par l'attribut `csp` de l'iframe au lieu de `sandbox` (erreur de console du navigateur).
- V3-A : le GET du lien de désabonnement est sans effet, seul le POST coupe (analyseurs de liens).
- V4-D1 : réglages de badge sur un type nouveau de l'espace (A-15).

## Dette créée

- `@strapi/utils` résolu depuis `@strapi/strapi` par `require.resolve` (V1-D) : à déclarer dans `strapi/package.json`.
- `viewUrl` encore émis par `services/meetings.js` sans usage (V2-E).
- Aucun e-mail au déplacement d'un rendez-vous de table par l'organisateur (V3-F).
- L'attribut `csp` d'iframe n'est appliqué que par Chromium ; le HTML de l'aperçu ne contient pas de script.
- `strapi/tests/SPEC.md` à mettre à jour avec les fichiers de test de chaque lot.
