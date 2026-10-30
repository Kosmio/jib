# 09. Phases, calendrier et portes de validation

Méthode de l'équipe d'agents : l'architecte pilote, consulte designer et tester avant chaque phase, confie l'implémentation au developer, et **ne passe à la phase suivante qu'après le feu vert du tester**. Chaque phase se termine par un compte rendu court dans `docs/espace/journal/phase-N.md` : fait, écarts, hypothèses appliquées (11-questions-ouvertes), dette connue.

Le calendrier tient compte du 11 novembre férié. Marge : aucune. En cas de retard, sacrifier dans l'ordre les exigences **P1**, jamais les P0 ni les tests.

## Phase 0 : analyse et socle (2 et 3 novembre)

Objectif : un environnement local qui fait tourner le site et Strapi, et un plan validé.

- Cartographier le dépôt : versions d'Astro et de Strapi, framework d'îlots, types de contenu existants, déploiement, hébergement, base de données.
- Compléter `CLAUDE.md` (commandes, ports, variables), `02-modele-donnees.md` (colonne « type existant »), `11-questions-ouvertes.md`.
- Mettre en place : outil de test côté Strapi (unitaires et intégration avec base de test), tests de bout en bout (Playwright) sur le front, `ConsoleMailProvider`, compte bac à sable HelloAsso avec un formulaire de test reproduisant les champs du formulaire réel.
- Jeu de données de recette (10-recette.md) chargeable par une commande unique `seed`.

Porte : le tester exécute une suite vide qui passe en local et en intégration continue ; le site public existant n'a aucune régression visuelle sur la page d'accueil et la page d'édition (captures de référence).

## Phase 1 : données, import, accès (4 au 6 novembre)

- Types de contenu et extensions (02), désactivation des routes CRUD générées.
- Génération des créneaux (R-01, R-02).
- Client HelloAsso, import et synchronisation (I-10 à I-12, I-14), SyncRun.
- Lien magique, session, déconnexion, organisateurs (I-20 à I-23), limitation de débit.
- Écrans E0 et E2, gabarits `access-link` et `welcome`.

Porte : T-01 à T-06 verts ; import du formulaire bac à sable idempotent (deux exécutions successives, aucun doublon) ; tests d'accès croisés NF-01 sur `/me`.

## Phase 2 : annuaire et rendez-vous (9, 10, 12 et 13 novembre)

- `/me`, E3 et R-30, R-31.
- Annuaire et fiches (E4, E5 partie fiche), visibilité (R-40 à R-43), suggestions (R-50), E1.
- Service des rendez-vous : création, acceptation, refus, contre-proposition, annulation, expiration (R-10 à R-18), attribution des tables (R-13), tables dédiées des intervenants (R-19), concurrence.
- E5 partie demande, E6, export .ics (I-40, I-41), gabarits `meeting-*`.

Porte : T-10 à T-26 verts, dont le test de concurrence T-17 (20 demandes simultanées sur le dernier créneau libre : exactement une table attribuée par rendez-vous accepté, aucune collision) ; couverture des règles R-10 à R-18 à 100 % des branches du service.

## Phase 3 : messagerie, relances, pilotage, PWA (16 au 18 novembre)

- Messagerie (E7, R-60 à R-64), notifications e-mail différées.
- Relances (R-70 à R-72), tâches planifiées, gabarits `reminder-*`.
- Tableau de bord, exports, relance manuelle (E9, F-90 à F-92).
- E8 programme, manifest PWA, icônes, service worker minimal (F-05 en P1, NF-24 en P1).
- Passe accessibilité et performance (NF-20 à NF-31).

Porte : T-30 à T-45 verts ; audit Lighthouse mobile ≥ 90 en accessibilité et performance sur E1, E4, E5 ; audit axe sans erreur critique.

## Phase 4 : recette client (19 novembre)

- Déploiement sur l'environnement de préproduction (ou production avec `participantSpaceEnabled = false`).
- Démonstration du scénario T-50 avec le référent Xylofutur ; liste des anomalies classées bloquante, majeure, mineure.
- Corrections des bloquantes et majeures le jour même.

Porte : aucune anomalie bloquante ou majeure ouverte ; validation écrite du référent.

## Phase 5 : mise en production (20 novembre)

- Sauvegarde de la base (NF-51), bascule HelloAsso et e-mail en production, première synchronisation réelle, contrôle de 5 fiches importées avec le référent.
- Activation `participantSpaceEnabled = true` : envoi des e-mails `welcome`.
- Surveillance des journaux et des envois pendant 2 heures.

## Exploitation (21 novembre au 11 décembre)

- 27 novembre : relances a et b. 2 décembre : récapitulatif de la veille (R-70 c). 3 décembre : support sur place.
- Semaine du 7 décembre : exports et bilan pour Xylofutur, puis passage de l'édition en lecture seule.

## Parallélisation conseillée

| Flux | Agent | Dépend de |
|---|---|---|
| Modèle de données et services métier | developer A | phase 0 |
| Composants UI (07) et écrans statiques à partir des maquettes | developer B, sous revue du designer | tokens confirmés en phase 0 |
| Client HelloAsso et e-mails | developer A ou C | modèle Attendee |
| Tests de règles métier écrits à partir de 04 avant l'implémentation | tester | 04 uniquement |

Les tests des règles R-xx peuvent être écrits dès la phase 0 à partir de `04-regles-metier.md` (approche tests d'abord), ce qui sécurise la phase 2.
