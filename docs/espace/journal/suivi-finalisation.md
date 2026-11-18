# Suivi de la finalisation, espace participant JIB

Tenu par le superviseur (`13-orchestration.md`, section 11). Lots : `specs/14-lots-finalisation.md`. Départ : `feat/espace-participant` à `f1d8824`, mardi 17 novembre 2026.

Consigne de Mathieu du 17 novembre : coder toutes les vagues à la suite, sans attendre les dates de la vue d'ensemble ; badges obligatoires (D-13) ; connexion par code à six chiffres réalisée (D-17).

| Lot | Vague | État | Créneau | Branche | Tête | Tests du lot | Intégré le | Reste, blocage |
|---|---|---|---|---|---|---|---|---|
| V1-A | 1 | intégré | | lot/v1-a-deploiement | e9f765f | deploy-workflow 4/4, backup.sh essayé (14 archives, cron idempotent, restauration) | 17/11 | |
| V1-B | 1 | intégré | 1 | lot/v1-b-acces | 55aab1c | acces-robuste 18, acces 110, e2e 25 | 17/11 | adresse saisie par cookie éphémère, jamais dans l’URL |
| V1-C | 1 | intégré | 2 | lot/v1-c-ouverture | 6a6ec49 | welcome 12, espace-welcome 19, sync 64, recette e2e 24 | 17/11 | |
| V1-D | 1 | intégré | 3 | lot/v1-d-gardes | ce7b968 | admin-gardes 26, admin-guards 28, seed 55, concurrence 16 | 17/11 | |
| V1-E | 1 | intégré | 4 | lot/v1-e-erreurs | dbfda4c | web-middleware 63, espace-erreurs 15 | 17/11 | |
| V2-A | 2 | intégré | 9 | lot/v2-a-accueil-agenda | b398722 | accueil-agenda 19 | 17/11 | |
| V2-B | 2 | intégré | 5 | lot/v2-b-consentement | b488de2 | consentement 10, parcours et recette adaptés | 17/11 | |
| V2-C | 2 | intégré | 7 | lot/v2-c-admin-lisible | 4a1c098 | time 63, admin-libelles 28 | 17/11 | |
| V2-D | 2 | intégré | 13 | lot/v2-d-pilotage | 1918f54 | pilotage 23, e2e 16, program-stats 38 | 17/11 | |
| V2-E | 2 | intégré | 8 | lot/v2-e-finitions | 62d2533 | templates 132, pwa 6, finitions 2 | 17/11 | theme-color à relayer par AppShell (V2-D) ; test:visual non lancé |
| V2-Q | 2 | à relancer | | | | | | audit axe et Lighthouse final après intégration de tout |
| V3-A | 3 | intégré | 10 | lot/v3-a-relances | 2152115 | reminders 73, templates 57, relances 38 | 17/11 | |
| V3-B | 3 | intégré | 15 | lot/v3-b-relance-manuelle | dd9183d | e2e 11 (+1 envoi réel entre 8h et 20h) | 18/11 | |
| V3-C | 3 | intégré | 16 | lot/v3-c-hors-ligne | 4857471 | hors-ligne 9, pwa 6 | 18/11 | expiration 48 h à vérifier sur preprod |
| V3-D | 3 | intégré | 17 | lot/v3-d-fraicheur | d1e44c3 | fraicheur 10, messages 38 | 18/11 | R-88 complété par INT-3 (conversations.js) |
| V3-E | 3 | intégré | 11 | lot/v3-e-participants | 104e8e6 | admin-participants 50, e2e 8 | 18/11 | |
| V3-F | 3 | intégré | 12 | lot/v3-f-rendezvous | 5ffa166 | admin-rendezvous 62, blocks 49, concurrence 20, couverture branches lib/meetings.js 95,8 % | 18/11 | |
| V3-G | 3 | intégré | 14 | lot/v3-g-code | be914af | acces-code 40, e2e 13 | 18/11 | |
| V4-A | 4 | intégré | 19 | lot/v4-a-annuaire | d68e68b | directory 70, e2e 14 | 18/11 | |
| V4-B | 4 | intégré | 21 | lot/v4-b-profil | b1d8c7c | profil e2e 20, profile-photo 25 | 18/11 | |
| V4-C | 4 | intégré | 20 | lot/v4-c-jour-j | d6deaaf | jour-j 16, program-stats 45 | 18/11 | |
| V4-D | 4 | intégré | 18, 23 | lot/v4-d1-badges, lot/v4-d2-badges-pilotage | 98b8b38, 82e8677 | badges 56, espace-badges 39, carte 11, pilotage-badges 15 | 18/11 | |
| V4-E | 4 | intégré | | lot/v4-e-charge | 59593dd | rapport reports/quality/2026-11-18-charge-espace.md | 18/11 | p95 au-dessus de 300 ms sur le poste local saturé ; lot PERF ; mesure à refaire sur preprod |
| V4-F | 4 | intégré | 24, 30 | lot/v4-f-lecture-seule, lot/v4-f2-lecture-seule-ecrans | 5b588bf, b963a0d | lecture-seule 25, read-only 12, écrans 22 | 18/11 | |
| V5-A à V5-G | 5 | intégré | 22 à 29 | lot/v5-* | 26d62ae à af5fd70 | effacement 38+43+11, signalements 41+10, multi-éditions 40+8, profil-b2b 49, calendrier 28, webhook 40, mcp 93, rôle 6 | 18/11 | |

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

## Lots d’intégration ajoutés par le superviseur

INT-1 à INT-6 : tests anciens alignés sur les changements voulus des lots intégrés (routes admises, cadences, clés de Me, gardes), e2e rendus indépendants de leur ordre, et un défaut réel corrigé (R-88 appliqué au filtre de conversations.js). PERF : /meetings et statistiques sans parcours quadratique. V4-F2 et V4-F3 : bandeau et actions désactivées après la fin de l’édition sur tous les écrans.

## Décisions du superviseur

- 18/11 : à un stand, tous les représentants de l’exposant voient le téléphone d’un rendez-vous accepté par l’un d’eux (R-42 amendé, V5-D).
- 18/11 : effacement et export des données permis en lecture seule et espace fermé (droits RGPD, V5-A).

## Dette créée

- `@strapi/utils` résolu depuis `@strapi/strapi` par `require.resolve` (V1-D) : à déclarer dans `strapi/package.json`.
- `viewUrl` encore émis par `services/meetings.js` sans usage (V2-E).
- Aucun e-mail au déplacement d'un rendez-vous de table par l'organisateur (V3-F).
- L'attribut `csp` d'iframe n'est appliqué que par Chromium ; le HTML de l'aperçu ne contient pas de script.
- `strapi/tests/SPEC.md` à compléter avec les fichiers de test des lots qui ne l’ont pas fait.
- NF-21 : p95 à mesurer sur la préproduction (le poste local saturé donne 350 à 530 ms).
- L’agenda lit la fiche de chaque interlocuteur pour le téléphone (une requête par rendez-vous accepté).
- `strapi/mcp/index.js:411` journalise l’objet d’erreur brut.
- Webhook HelloAsso : une commande sans édition correspondante répond « accepted » sans effet.
