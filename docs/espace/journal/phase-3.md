# Phase 3 : finalisation, compte rendu

Finalisation de l'espace participant après l'audit du 17 novembre 2026 (`2026-11-17-audit-ux-et-plan.md`). Lots : `specs/14-lots-finalisation.md` ; mode d'exécution : `specs/13-orchestration.md` ; tableau de bord tenu par le superviseur : `suivi-finalisation.md`, qui fait foi en cas d'écart avec ce résumé.

## Déroulé

- Départ le mardi 17 novembre 2026, `feat/espace-participant` à `f1d8824`. Consigne de Mathieu du même jour : coder toutes les vagues à la suite, sans attendre les dates de la vue d'ensemble (prévues du 18 novembre à après le 3 décembre).
- Lots développés en parallèle, trois à la fois, chacun dans son arbre de travail (`<dépôt>/.lots/<id>`), testés par son testeur, puis fusionnés en local par le superviseur. 101 commits entre `ed77b24` et `7551431` : 91 le 17 novembre, 10 le 18.
- État décrit : 18 novembre, à `7551431`.

## Lots intégrés

| Vague | Lots | Contenu |
|---|---|---|
| 1 | V1-A, V1-B, V1-C, V1-D, V1-E | déploiement sûr (reset refusé en prod, sauvegarde quotidienne, variables GitHub, version 0.2.0) ; accès robustes (plafond IP réglable, `next` conservé, organisateur sur espace fermé, session expirée) ; ouverture contrôlée (`welcome` à la demande, état du service, `EmailLog.error`) ; garde-fous de l'administration ; page d'erreur lisible |
| 2 | V2-A, V2-B, V2-C, V2-D, V2-E | accueil et agenda actionnables ; consentement compris ; administration Strapi lisible et guide organisateur ; pilotage lisible (simulation des créneaux, exports complétés) ; finitions (accents, e-mails, icône, contraste) |
| 3 | V3-A à V3-G | relances planifiées et désabonnement ; relance manuelle ; consultation hors connexion ; fraîcheur des badges et messages (e-mail à 2 min) ; participants et rendez-vous dans le pilotage (blocages de tables) ; connexion par code à six chiffres |
| 4 | V4-A, V4-B, V4-C, V4-D1, V4-D2, V4-E, V4-F | annuaire dans l'URL ; profil (barre d'enregistrement, suppression de la photo) ; repères du jour J ; badges PDF, jeton de carte et carte publique, badges dans le pilotage ; mesure de charge ; lecture seule après l'événement |
| 5 | V5-A, V5-B, V5-C, V5-D, V5-F, V5-G | effacement, export individuel et purge ; signalement d'un message ; plusieurs éditions dans le pilotage ; profil B2B (Je cherche, Je propose, téléphone) ; MCP ; rôle « Organisation Xylofutur » |

Encore à intégrer au moment de ce compte rendu : V4-F2 et V4-F3 (lecture seule visible dans les écrans), V5-E (flux calendrier et webhook HelloAsso), PERF (routes hors du seuil NF-21). Leurs routes et champs sont déjà décrits dans `06-api.md`, `02-modele-donnees.md` et `exploitation.md`, d'après leur contrat. V2-Q (axe et Lighthouse, T-70, T-71) a été arrêté (mémoire du poste) ; aucun commit à `7551431`.

## Décisions appliquées

| # | Décision | Application |
|---|---|---|
| D-12 | relances au 20 novembre | ouverture avec le seul `welcome` ; relances livrées en vague 3 pour l'envoi du 27 novembre ; l'envoi « sans rendez-vous » à l'ouverture devient manuel |
| D-13 | badges | **tranché par Mathieu le 17 novembre : réalisés et obligatoires.** Imprimante de bureau A4, marges de 10 mm, logo du site en attendant le vectoriel, texte NF-56 tel qu'écrit (à valider par Xylofutur), pas de badge hors Attendee |
| D-14 | case « rendez-vous et messages » précochée (D-07) | inchangée ; l'écran de bienvenue la rend explicite (V2-B), à signaler à Xylofutur |
| D-15 | version | `0.2.0` |
| D-16 | plafond de liens par IP | 60 par 15 min, `LINK_RATE_IP_MAX` ; 5 par adresse e-mail |
| D-17 | connexion par code | **tranché par Mathieu le 17 novembre : réalisée sans attendre l'essai H-5.** Le code complète le lien |
| D-18 | expéditeur, organisateurs, texte de confidentialité, exposants | tuyauterie seulement ; valeurs à fournir par Xylofutur, bloquant pour la mise en production |

Décision du superviseur du 18 novembre (V5-D) : à un stand, tous les représentants de l'exposant voient le téléphone du demandeur d'un rendez-vous accepté par l'un d'eux. Reportée dans `04-regles-metier.md` (R-42 amendé).

## Écarts aux specs

- Arbres de travail sous `<dépôt>/.lots/<id>` au lieu de `../jib-lots/`.
- Suite complète lancée une fois par série de fusions, pas après chaque lot (mémoire et disque du poste).
- V1-C : aperçu de l'e-mail isolé par l'attribut `csp` de l'iframe au lieu de `sandbox`.
- V3-A : le GET du lien de désabonnement ne change rien, seul le POST coupe les rappels.
- V4-D1 : réglages de badge sur un type nouveau `badge-setting` (A-15 interdit un média ajouté à l'édition).
- V5-A : effacement par `POST /me/erase` `{ confirm: true }` au lieu du `DELETE /me` prévu ; effacement et export permis sur un espace fermé et en lecture seule.
- V4-E : p95 au-dessus de 300 ms pour `/me`, `/directory`, `/meetings` et `/admin/*/stats` sur le poste de développement (`reports/quality/2026-11-18-charge-espace.md`), mesure indicative ; corrections confiées au lot PERF.

## Dette

- `@strapi/utils` résolu depuis `@strapi/strapi` par `require.resolve` (V1-D) : à déclarer dans `strapi/package.json`.
- `viewUrl` encore émis par `services/meetings.js` sans usage (V2-E).
- Aucun e-mail au déplacement d'un rendez-vous de table par l'organisateur (V3-F).
- L'attribut `csp` d'iframe n'est appliqué que par Chromium.
- `strapi/tests/SPEC.md` à mettre à jour avec les fichiers de test de chaque lot (testeur).
- Journal d'accès de Traefik actif (`--accesslog=true`) : jetons de carte, de flux calendrier et de lien écrits en clair (NF-55). À désactiver ou masquer avant l'ouverture, voir `exploitation.md`, section 11.
- `docs/espace/CLAUDE.md`, piège « images Docker » : cite encore 0.1.0 comme version courante, la branche est en 0.2.0 (D-15).
- Comptes rendus `phase-1.md` et `phase-2.md` absents ; mise en accord de F-10 et R-40 avec D-07 et lignes de `01-contexte-perimetre.md` sur les badges, toujours dues (`14-lots-finalisation.md`, dette documentaire).
- Audits V2-Q (axe, Lighthouse) non faits.

## Reste à faire par les humains

| # | Tâche | Qui |
|---|---|---|
| H-1 | valeurs de prod : `EMAIL_FROM`, `ORGANIZER_EMAILS`, secrets `SECRET_EMAIL_API_KEY` et `SECRET_HELLOASSO_CLIENT_SECRET`, `SECRET_ADMIN_RESET` vide | Mathieu, avec Xylofutur |
| H-2 | domaine d'envoi vérifié dans Brevo (SPF, DKIM), premier envoi réel, rendu Gmail et Outlook | Mathieu |
| H-3 | essai HelloAsso réel sur preprod : pagination, doublons d'e-mail, champs Organisation et Poste | Mathieu |
| H-4 | réglages Strapi de prod : pauses `b2b_break`, formulaire HelloAsso, tables, fenêtre, sujets, exposants, tables dédiées, régénération des créneaux | Mathieu, avec Xylofutur |
| H-5 | essai sur iPhone (Safari, lien ouvert depuis Gmail et Outlook) et Android : parcours, photo, installation, code à six chiffres | Mathieu |
| H-6 | texte de confidentialité validé et publié, validation de D-14 | Xylofutur |
| H-7 | sauvegarde avant bascule, déploiement, première synchronisation, envoi des `welcome` depuis le pilotage | Mathieu |
| H-8 | export participants ouvert dans Excel FR (T-41) | Mathieu |

S'y ajoutent :

- mesure NF-21 sur la préproduction, Strapi séparé du générateur de charge, après le lot PERF ;
- test visuel des pages publiques (`test:visual`, local seulement), non relancé depuis V2-E (bouton d'entrée de l'espace modifié) ;
- essai réel du webhook HelloAsso (URL déclarée, inscription d'essai) et des e-mails Brevo de bout en bout (relances, désabonnement en un clic, `message-report`) ;
- impression d'un badge sur l'imprimante du jour J et scan du QR ;
- décision sur le journal d'accès de Traefik (NF-55).
