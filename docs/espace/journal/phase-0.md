# Phase 0 : compte rendu

Rédigé par l'architecte le 29 octobre 2026. Plan : `phase-0-plan.md` (`ca188d3`). Branche `feat/espace-participant`, non poussée.

## Fait

| Lot | Commits | Livré |
|---|---|---|
| A (tester) | `a5a52f0` | 4 captures de référence (`/` et `/editions/nouvelle-aquitaine`, 390 et 1280 px), prises avant tout changement de code ; 3 exécutions vertes de suite ; tolérance `maxDiffPixelRatio: 0.0001`, seule la ligne `©` du pied de page masquée |
| B (developer) | `399e083`, `bf63090`, `ab16240` | fournisseurs d'e-mail `console` et `brevo` (I-30, NF-53) ; `GET /api/espace/health` ; faux HelloAsso API v5 (A-12), port `FAKE_HELLOASSO_PORT` (défaut 4010), tout couple d'identifiants non vide accepté, 17 billets de recette (Q-17) et `buildEdgeCaseItems()` (32 cas limites) ; commande `seed` et garde `DEMO_SEED` du bootstrap |
| C (tester) | `31cf095`, `a5f18b4`, `d0da43a` | harnais `node:test` (unitaires et intégration sur `strapi_test`), registre `strapi/tests/SPEC.md`, projet Playwright `e2e` sur `strapi_e2e`, workflow `.github/workflows/tests.yml` |

Résultats du lot C, confirmés par une relance indépendante le 29 octobre :

- `strapi test` : 298 tests, 296 réussis, 0 échec, 2 `todo` (D1, D2), code de sortie 0, 28 s ;
- `web test:e2e` : 10 sur 10 en 16 s, avec `E2E_STRAPI_PORT=1348 E2E_WEB_PORT=4332` ;
- `web test:visual` : 4 sur 4 ;
- Strapi sur `strapi_espace` : `/api/espace/health` en 200, `POST` en 405, `/api/editions` en 200 ;
- `tests.yml` validé par actionlint, jamais exécuté sur GitHub.

## Écarts au plan

1. **Bac à sable HelloAsso** (prévu par `09-phases.md`) : pas encore créé. Le faux HelloAsso (A-12) le remplace ; la bascule se fera par `HELLOASSO_API_BASE`.
2. **Intégration continue** : le workflow n'a pas tourné, faute de push autorisé.
3. **Ports e2e** : les défauts du code (1338 et 4322) sont occupés sur le poste de Mathieu par un autre projet. Suite validée sur 1348 et 4332 ; changement des défauts confié au tester (lot 1 de la phase 1).
4. **Fenêtre de rendez-vous du seed** figée dans `recette.json` : du 1er octobre au 2 décembre 2026 (18h00, heure de Paris). Le seed sera périmé après le 3 décembre.
5. **Séquences du seed** : `seed.js` retire `kind` et `topic`, absents du schéma en phase 0. À rétablir en phase 1.
6. **Billet `Canceled` de Lucas Darrigade** : `recette.json` lui donne `status: cancelled`. Or un import sur base vide ignore un billet annulé (Q-15). C'est donc le seed de la phase 1 qui crée cet Attendee.
7. Les clés `editionSettings`, `topics`, `exhibitors`, `organizerEmails` et `attendees` de `recette.json` sont ignorées en phase 0, comme le prévoyait B3.

## Hypothèses appliquées (`11-questions-ouvertes.md`)

| Id | Application en phase 0 |
|---|---|
| Q-13 | Lien magique ouvert par un bouton (clic de confirmation) : décision reprise par A-04 ; rien n'est encore implémenté, l'écran arrive en phase 1 |
| Q-14 | Polices de l'espace servies par le site : à faire en phase 1. Le test visuel des pages publiques dépend encore de Google Fonts |
| Q-15 | États de billet reproduits par le faux HelloAsso ; traitement à l'import en phase 1 |
| Q-16 | `EMAIL_FROM` inconnu : fournisseur `console` partout ; valeur fictive `espace@example.org` dans les tests |
| Q-17 | 17 billets fictifs : 12 participants, 2 intervenants, 3 représentants ; l'organisateur `organisation@example.org` sans billet |

## Dette connue

| Sujet | Détail | Suite |
|---|---|---|
| D1 | `buildEdgeCaseItems()` ne produit aucun paiement `Refunded` | correction du developer en cours ; le tester retire le `todo` (phase 1, lot 1) |
| D2 | la notification de mise à jour de Strapi interroge le registre npm et réécrit `strapi/.strapi-updater.json` | correction en cours (`config/server.js`) ; retrait du `todo` au lot 1 |
| Garde du seed | non exportée, donc testée par lecture du source | correction en cours ; le test passe sur l'export au lot 1 |
| Références visuelles | propres à macOS et au Chromium de Playwright 1.64.1 ; dates selon le fuseau du processus `preview` (Europe/Paris) ; dépendance au réseau pour Google Fonts (Q-14) ; locales seulement, hors CI | assumé |
| Arrêt de Strapi en test | `stop()` attend 750 ms : Strapi n'attend pas les événements `entry.*` | assumé |
| Fenêtre du seed | périmée après le 3 décembre | sans effet avant l'événement ; les tests injectent l'heure (A-19) |
| Tirets cadratins | les pages publiques et le bootstrap en contiennent, par exemple dans les titres de page, entre l'année et « Xylofutur » ; les tests les évitent | piège documenté dans `docs/espace/CLAUDE.md` |
| Seed en test | `integration/seed.test.js` redémarre Strapi 3 fois, soit environ 15 s | assumé |
| Couverture | pas de mesure des branches | à mettre en place pour la porte de la phase 2 |

## État de la porte

| Condition (`09-phases.md`) | État |
|---|---|
| Suite qui passe en local | **verte**. Code de sortie 0, 0 échec, 2 `todo` connus (D1, D2) |
| Suite qui passe en intégration continue | **en attente** de l'autorisation de push |
| Aucune régression visuelle sur l'accueil et la page d'édition | **verte**. 4 références, 3 exécutions stables |
| Compte rendu | ce fichier |

La porte est verte en local. La condition « en intégration continue » reste ouverte ; elle est reportée dans la porte de la phase 1 et sera levée au premier push autorisé. La phase 1 peut démarrer sur la porte locale.
