# SPEC des tests de l'espace participant

Registre vivant de ce qui est testé et pourquoi. Tenu par le tester. Couvre les trois suites du dépôt : Strapi (`strapi/tests/`), Playwright `e2e` (`web/tests/e2e/`) et Playwright `visual` (`web/tests/visual/`). État : fin de la phase 0 (lot C).

## Lancer les tests

`<dépôt>` = racine du dépôt. Toujours par corepack (`docs/espace/CLAUDE.md`).

| Suite | Commande | Prérequis | Durée mesurée le 29/10 |
|---|---|---|---|
| Strapi, tout | `corepack pnpm@12.15.0 --dir <dépôt>/strapi test` | Postgres (`make -C <dépôt> infra-up`) | 28 s, 298 tests |
| Strapi, unitaires | `… strapi test:unit` | aucun (rapide, sans Strapi) | 3 s, 247 tests |
| Strapi, intégration | `… strapi test:integration` | Postgres | 25 s, 51 tests |
| e2e | `corepack pnpm@12.15.0 --dir <dépôt>/web test:e2e` | Postgres, Chromium, ports 1338 et 4322 libres | 16 s, 10 tests |
| visuel (local) | `… web test:visual` | Strapi sur `strapi_espace` (1337), `web build` puis `web preview --host 127.0.0.1 --port 4321` | 6 s, 4 tests |

Préparation des bases : rien à faire à la main. `strapi_test` et `strapi_e2e` sont créées si elles manquent, puis vidées au démarrage de chaque suite (`node tests/prepare-databases.js`, depuis `strapi/`, les crée seules). Le workflow `.github/workflows/tests.yml` appelle ce script.

Ports e2e : 1338 (Strapi) et 4322 (front), modifiables par `E2E_STRAPI_PORT` et `E2E_WEB_PORT` si un autre projet les occupe (le cas sur la machine de Mathieu : le serveur de développement de BoisDesAlpes). Playwright échoue aussitôt avec « already used » et ne réutilise jamais un serveur existant.

## Garde-fous (valent pour toutes les suites)

| Règle | Mécanisme | Preuve |
|---|---|---|
| Jamais la base `strapi` ni `strapi_espace` | `tests/helpers/env.js` : `assertTestDatabase` (seuls `_test` et `_e2e`) appelé avant toute connexion, `ENV_PATH` vide (aucun `strapi/.env`), `DATABASE_NAME` imposée et non surchargeable | `unit/harness.test.js` |
| Aucun e-mail réel | `EMAIL_PROVIDER=console`, `EMAIL_API_KEY` vide, `brevo` refusé sous `NODE_ENV=test`, client Brevo toujours simulé | `unit/mail.test.js`, `unit/harness.test.js`, `integration/api.test.js` |
| Aucun appel réseau hors localhost | `tests/helpers/no-network.js`, préchargé par `node --require` (scripts `test*`, serveur e2e, sous-processus du seed) : toute connexion TCP hors boucle locale échoue et est consignée. Télémétrie Strapi coupée. Navigateur e2e : toute requête hors localhost coupée, seules les polices Google tolérées | `unit/harness.test.js`, `e2e/fixtures.ts` |
| Fuseau | `TZ=UTC` dans les scripts et l'environnement imposé | |
| Seed uniquement sur `_test` ou `_e2e` | garde du seed (code du developer) vérifiée en code et en sous-processus avec une base inventée, jamais contre les vraies bases | `unit/seed-guard.test.js` |

## Couverture par exigence

| Exigence | Ce qui est vérifié | Fichier |
|---|---|---|
| I-30, NF-53 (B1) | choix du fournisseur par défaut (console hors production, brevo en production), `EMAIL_PROVIDER` vide, refus de brevo sous `NODE_ENV=test`, sans clé, sans expéditeur, fournisseur inconnu, `from` invalide, analyse des adresses (`Nom <a@b.c>`, guillemets, objets, invalides) | `unit/mail.test.js` |
| I-30 | fournisseur console : une ligne JSON par message, cumul, dossier créé, pièces jointes en base64 (Buffer ou texte), en-têtes, journal (destinataire, sujet, liens uniques), aucun appel réseau, aucune clé dans le journal | `unit/mail.test.js` |
| I-30 | fournisseur Brevo avec client simulé : `sender`, `to`, contenus, `attachment` en `{ name, content }`, `headers`, `messageId`, erreur propagée, validation avant l'appel | `unit/mail.test.js` |
| B1, NF-06 | `config/server.js` : `email.provider`, `email.from`, `email.outboxFile` (défaut `.tmp/mail-outbox.jsonl`), clé et réglages du site intacts ; `.env.example` à jour, console par défaut, sans secret ; configuration câblée dans Strapi démarré | `unit/config-email.test.js`, `integration/api.test.js` |
| I-10 | faux HelloAsso : jeton pour tout couple non vide, 400 sinon, expiration (horloge simulée), `expires_in`, refresh à usage unique, 401 sans jeton ou jeton expiré | `unit/fake-helloasso.test.js` |
| I-11, Q-15 | pagination (défaut 20, max 100, `pageSize` invalide, `continuationToken` invalide en 400, `data: []` après la dernière page, répétable), `withDetails` (champs seulement avec `true`), cas limites de `buildEdgeCaseItems` | `unit/fake-helloasso.test.js` |
| Q-03, Q-17, NF-11 | 17 billets : 12 tarif Nouvelle-Aquitaine (7 champs), 3 Exposant et 2 Intervenant (champ « Accès PMR » seul, sans Email, payeurs distincts), 1 Canceled, adresses en `@example.org` uniquement ; champs non importés présents dans le faux | `unit/fake-helloasso.test.js`, `unit/fixtures.test.js` |
| I-13, I-14 | `GET /orders/{id}` (commande groupée, 404), pilotage `/__fake/items`, `PATCH`, `/__fake/stats`, `stats()` en copie, jeu par défaut jamais modifié, ligne de commande `helloasso:fake` | `unit/fake-helloasso.test.js` |
| A-13, B3 | `recette.json` conforme à `10-recette.md` (3 pauses B2B, 5 sujets, 9 séquences, 4 organisations, stands 4 et 12, 12 participants dont 2 sans annuaire et 1 annulé, 2 intervenants, 3 représentants) et cohérent avec les billets | `unit/fixtures.test.js` |
| B3 (garde) | refus de `strapi`, `strapi_espace` et de toute base hors `_test`/`_e2e` (motif lu dans `seed.js`), garde avant `app.load()`, refus en sous-processus d'une base inventée et de `NODE_ENV=production`, message clair | `unit/seed-guard.test.js` |
| B3 (seed) | sur `strapi_test` vide : édition publiée avec ses réglages, 9 séquences ordonnées, 3 pauses B2B, 4 organisations, 2 intervenants liés, résumé ; second passage : même état, mêmes comptes, données étrangères conservées ; aucun tag, aucun fichier | `integration/seed.test.js` |
| B4 | `GET /api/espace/health` 200 `{"status":"ok"}` sans authentification, HEAD 200, POST/PUT/PATCH/DELETE 405 | `integration/api.test.js`, `e2e/smoke.spec.ts` |
| A-02 | seule route sous `/api/espace` : `GET /health` ; aucune route CRUD pour un type `api::espace.*` ; GET de chemins CRUD en 404, écritures en 404 ou 405 | `integration/api.test.js`, `e2e/smoke.spec.ts` |
| B4 (DEMO_SEED) | avec `DEMO_SEED=false` : base vide, aucune édition, aucun tag, aucune image ; sans la variable : éditions de démonstration créées comme avant (téléversement simulé, aucun fichier écrit dans `public/uploads`) | `integration/api.test.js`, `integration/bootstrap-demo.test.js` |
| Routes du site | `contact/send`, `newsletter/subscribe`, `captcha/challenge` toujours déclarées ; lecture publique des éditions, intervenants, organisations, séquences, tags en 200 | `integration/api.test.js` |
| C3 | accueil rendu avec l'édition de recette, liste des éditions, page d'édition (9 titres de programme dont 2 « Pause et B2B », lieu, intervenants), fiches intervenant et organisation, 404 d'une page inconnue, redirection vers 404 d'une édition inconnue ; aucune exception JavaScript ; aucune requête hors localhost hors polices Google | `e2e/smoke.spec.ts`, `e2e/fixtures.ts` |
| NF-40, porte de phase 0 | non-régression visuelle de `/` et `/editions/nouvelle-aquitaine` à 390 et 1280 px (4 références macOS, tolérance 0,01 %) | `web/tests/visual/public-pages.spec.ts` (lot A) |
| Conventions | aucun tiret cadratin (U+2014 ni entité) dans les fichiers de l'espace, des tests, du workflow et de `docs/espace` | `unit/conventions.test.js` |

## Défauts du lot B ouverts (tests marqués `todo`)

Un test `todo` s'exécute, son échec est affiché sans faire échouer la suite. Retirer `todo` dès que le code est corrigé : le test passera.

| Id | Défaut | Test | Reproduction |
|---|---|---|---|
| D1 | `buildEdgeCaseItems()` ne produit aucun paiement `Refunded` : `region(…, { payments: […] })` transmet `payments` à `buildItem()`, qui ignore ce paramètre (il attend `paymentState`) | `unit/fake-helloasso.test.js`, « contient un billet actif dont le paiement est Refunded » | `node -e "const {buildEdgeCaseItems}=require('./scripts/espace/fake-helloasso'); console.log([...new Set(buildEdgeCaseItems().flatMap(t=>t.payments.map(p=>p.state)))])"` affiche `[ 'Authorized' ]` |
| D2 | `createStrapi()` (seed, `develop`, `start`) interroge le registre npm une fois par jour (notification de mise à jour, `server.logger.updates.enabled` vaut true) et réécrit `strapi/.strapi-updater.json`, fichier suivi par git ; le seed et un Strapi de test sortent donc de la machine sans que personne le décide | `integration/api.test.js`, « coupe la notification de mise à jour de Strapi » | lire `strapi.config.get('server.logger.updates.enabled')` : `true`. Correction : `logger: { updates: { enabled: false } }` dans `config/server.js`. Les tests contournent par `no-network.js` |

## Limites et dette

- Le projet `visual` reste local : références propres à macOS, données de `strapi_espace` absentes en CI. Il dépend des polices Google (Q-14).
- Les ports e2e par défaut (1338, 4322) étaient occupés le 29/10 par le serveur de développement de BoisDesAlpes : la suite e2e a été validée avec `E2E_STRAPI_PORT=1348 E2E_WEB_PORT=4332`, et le refus immédiat sur ports occupés a été vérifié avec les valeurs par défaut. En CI les ports sont libres.
- Le workflow `tests.yml` n'a pas encore tourné sur GitHub (validé par actionlint 1.7.12 seulement) ; première exécution à l'autorisation de push.
- `integration/seed.test.js` redémarre Strapi trois fois sur `strapi_test` (environ 15 s) : le prix de la preuve d'idempotence avec données étrangères.
- Les événements `entry.create` et `entry.publish` de Strapi sont émis sans être attendus : `stopStrapi` patiente 750 ms avant de détruire la connexion (`helpers/strapi.js`), sinon le processus reste 60 s sur un délai d'acquisition de connexion.
- Pas de couverture de branches mesurée en phase 0 (`node --test --experimental-test-coverage` est disponible pour la porte de la phase 2).
- Phase 1 : retirer ou adapter `routes: ne déclare que GET /api/espace/health` et ajouter les tests T-xx de `10-recette.md` ; le harnais (`startStrapi`, `buildTestEnv`, `resetDatabase`, faux HelloAsso en module) est prévu pour eux.
