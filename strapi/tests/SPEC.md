# SPEC des tests de l'espace participant

Registre vivant de ce qui est testé et pourquoi. Tenu par le tester. Couvre les trois suites du dépôt : Strapi (`strapi/tests/`), Playwright `e2e` (`web/tests/e2e/`) et Playwright `visual` (`web/tests/visual/`). État : lot 1 de la phase 1 (clôture de la phase 0, bases et ports configurables).

## Lancer les tests

`<dépôt>` = racine du dépôt. Toujours par corepack (`docs/espace/CLAUDE.md`).

| Suite | Commande | Prérequis | Durée mesurée le 29/10 (lot 1) |
|---|---|---|---|
| Strapi, tout | `corepack pnpm@12.15.0 --dir <dépôt>/strapi test` | Postgres (`make -C <dépôt> infra-up`) | 35 s, 356 tests, 0 `todo` |
| Strapi, unitaires | `… strapi test:unit` | aucun (rapide, sans Strapi) | 4 s, 291 tests |
| Strapi, intégration | `… strapi test:integration` | Postgres | 30 s, 65 tests |
| e2e | `corepack pnpm@12.15.0 --dir <dépôt>/web test:e2e` | Postgres, Chromium, ports 1348 et 4332 libres | 17 s, 10 tests |
| visuel (local) | `… web test:visual` | Strapi sur `strapi_espace` (1337), `web build` puis `web preview --host 127.0.0.1 --port 4321` | 6 s, 4 tests |

Préparation des bases : rien à faire à la main. La base des tests d'intégration (`TEST_DATABASE`, défaut `strapi_test`) et celle du e2e (`E2E_DATABASE`, défaut `strapi_e2e`) sont créées si elles manquent, puis vidées au démarrage de chaque suite (`node tests/prepare-databases.js`, depuis `strapi/`, les crée seules sans les vider). Le workflow `.github/workflows/tests.yml` appelle ce script, sans variable : il garde les défauts.

Ports e2e : 1348 (Strapi) et 4332 (front), modifiables par `E2E_STRAPI_PORT` et `E2E_WEB_PORT` si un autre projet les occupe (1338 et 4322 sont pris sur la machine de Mathieu par le serveur de développement de BoisDesAlpes). Playwright échoue aussitôt avec « already used » et ne réutilise jamais un serveur existant.

### Exécutions simultanées

Plusieurs agents peuvent lancer leurs suites en même temps sur le même poste si chacun prend ses propres bases et ports :

`TEST_DATABASE=strapi_dev_test E2E_DATABASE=strapi_dev_e2e E2E_STRAPI_PORT=1358 E2E_WEB_PORT=4342`

| Ressource | Propre à chaque exécution par | Où |
|---|---|---|
| Base des tests d'intégration | `TEST_DATABASE`, nom en `_test` | `helpers/env.js` (`testDatabaseName`) |
| Base du e2e et du seed de recette | `E2E_DATABASE`, nom en `_e2e` | `helpers/env.js` (`e2eDatabaseName`), `e2e-server.js` |
| Ports e2e | `E2E_STRAPI_PORT`, `E2E_WEB_PORT` | `web/playwright.config.ts`, `e2e-server.js` |
| Port de Strapi d'intégration | port libre choisi par le système | `helpers/strapi.js` |
| Boîte d'e-mails | un fichier par base dans le dossier temporaire du système | `helpers/env.js` (`EMAIL_OUTBOX_FILE`) |
| Front construit, résultats, rapport Playwright | le port web : `web/dist-e2e/<port>`, `web/test-results/e2e-<port>`, `web/playwright-report/e2e-<port>` | `web/playwright.config.ts` |

Règles : un nom qui ne finit pas par `_test` (`TEST_DATABASE`) ou `_e2e` (`E2E_DATABASE`), qui dépasse 63 caractères ou qui vaut `strapi` ou `strapi_espace` est refusé avant toute connexion, ce qui interdit aussi de donner la même base aux deux suites. Partagés sans conflit constaté : le serveur Postgres, `web/.astro/` (réécrit par le build, à restaurer avant tout commit) et `strapi/.strapi-updater.json` (plus jamais écrit depuis le correctif D2). Deux exécutions sur la même base, elles, se vident l'une l'autre : ne pas le faire.

## Garde-fous (valent pour toutes les suites)

| Règle | Mécanisme | Preuve |
|---|---|---|
| Jamais la base `strapi` ni `strapi_espace` | `tests/helpers/env.js` : `assertTestDatabase` (seuls `_test` et `_e2e`, 63 caractères au plus) appelé avant toute connexion, y compris sur les noms venus de `TEST_DATABASE` et `E2E_DATABASE`, `ENV_PATH` vide (aucun `strapi/.env`), `DATABASE_NAME` imposée et non surchargeable | `unit/harness.test.js`, `integration/databases.test.js` |
| Aucun e-mail réel | `EMAIL_PROVIDER=console`, `EMAIL_API_KEY` vide, `brevo` refusé sous `NODE_ENV=test`, client Brevo toujours simulé | `unit/mail.test.js`, `unit/harness.test.js`, `integration/api.test.js` |
| Aucun appel réseau hors localhost | `tests/helpers/no-network.js`, préchargé par `node --require` (scripts `test*`, serveur e2e, sous-processus du seed) : toute connexion TCP hors boucle locale échoue et est consignée. Télémétrie Strapi coupée. Navigateur e2e : toute requête hors localhost coupée, seules les polices Google tolérées | `unit/harness.test.js`, `e2e/fixtures.ts` |
| Fuseau | `TZ=UTC` dans les scripts et l'environnement imposé | |
| Seed uniquement sur `_test` ou `_e2e` | garde du seed (code du developer) : prédicat `isSeedAllowed` appelé directement, ordre des étapes de `main()` lu dans le source, refus en sous-processus avec une base inventée ; jamais contre les vraies bases | `unit/seed-guard.test.js` |

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
| B3 (garde), A-13 | `isSeedAllowed({ database, nodeEnv })` exportée par `seed.js` : refuse `strapi`, `strapi_espace`, toute base hors `_test`/`_e2e` (noms inventés, vides, `undefined`, `null`, casse, suffixe suivi d'un caractère) et `NODE_ENV=production`, même sur une base de recette ; admet `_test` et `_e2e` sous `test`, `development` ou sans `NODE_ENV`. Ordre des étapes de `main()` (garde avant `app.load()`, `wipe` et `populate`, lecture du source). `require` du module ne lance pas le seed. Refus en sous-processus d'une base inventée et de `NODE_ENV=production`, message clair, aucune connexion | `unit/seed-guard.test.js` |
| Bases configurables (lot 1, phase 1) | `testDatabaseName` et `e2eDatabaseName` : défauts, variable posée, lecture de `process.env`, refus (`strapi`, `strapi_espace`, sans suffixe, mauvais suffixe, majuscules, injection, plus de 63 caractères) avec le nom de la variable dans le message ; `buildTestEnv` et `startStrapi` suivent `TEST_DATABASE` et refusent une base interdite avant toute connexion ; boîte d'e-mails distincte par base | `unit/harness.test.js` |
| Bases configurables sur Postgres | `ensureDatabase` crée la base manquante, supporte six créations simultanées de la même base ; `resetDatabase` ne vide que sa base ; `prepare-databases.js` crée les deux bases nommées par les variables, est répétable, ne vide rien, refuse chacune des 8 valeurs interdites sans rien créer (la base valide de l'autre variable non plus) ; bases temporaires `jib_tmp_<pid>_…` supprimées à la fin | `integration/databases.test.js` |
| B3 (seed) | sur `strapi_test` vide : édition publiée avec ses réglages, 9 séquences ordonnées, 3 pauses B2B, 4 organisations, 2 intervenants liés, résumé ; second passage : même état, mêmes comptes, données étrangères conservées ; aucun tag, aucun fichier | `integration/seed.test.js` |
| B4 | `GET /api/espace/health` 200 `{"status":"ok"}` sans authentification, HEAD 200, POST/PUT/PATCH/DELETE 405 | `integration/api.test.js`, `e2e/smoke.spec.ts` |
| A-02 | seule route sous `/api/espace` : `GET /health` ; aucune route CRUD pour un type `api::espace.*` ; GET de chemins CRUD en 404, écritures en 404 ou 405 | `integration/api.test.js`, `e2e/smoke.spec.ts` |
| B4 (DEMO_SEED) | avec `DEMO_SEED=false` : base vide, aucune édition, aucun tag, aucune image ; sans la variable : éditions de démonstration créées comme avant (téléversement simulé, aucun fichier écrit dans `public/uploads`) | `integration/api.test.js`, `integration/bootstrap-demo.test.js` |
| Routes du site | `contact/send`, `newsletter/subscribe`, `captcha/challenge` toujours déclarées ; lecture publique des éditions, intervenants, organisations, séquences, tags en 200 | `integration/api.test.js` |
| C3 | accueil rendu avec l'édition de recette, liste des éditions, page d'édition (9 titres de programme dont 2 « Pause et B2B », lieu, intervenants), fiches intervenant et organisation, 404 d'une page inconnue, redirection vers 404 d'une édition inconnue ; aucune exception JavaScript ; aucune requête hors localhost hors polices Google | `e2e/smoke.spec.ts`, `e2e/fixtures.ts` |
| NF-40, porte de phase 0 | non-régression visuelle de `/` et `/editions/nouvelle-aquitaine` à 390 et 1280 px (4 références macOS, tolérance 0,01 %) | `web/tests/visual/public-pages.spec.ts` (lot A) |
| Conventions | aucun tiret cadratin (U+2014 ni entité) dans les fichiers de l'espace, des tests, du workflow et de `docs/espace` | `unit/conventions.test.js` |

## Défauts du lot B

Aucun défaut ouvert. Un défaut constaté mais non corrigé se consigne par un test marqué `todo` (il s'exécute et s'affiche sans faire échouer la suite) ; le tester retire `todo` dès la correction. La suite compte 0 `todo`.

| Id | Défaut | Test | Corrigé |
|---|---|---|---|
| D1 | `buildEdgeCaseItems()` ne produisait aucun paiement `Refunded` (`payments` transmis à `buildItem()`, qui attend `paymentState`) | `unit/fake-helloasso.test.js`, « contient un billet actif dont le paiement est Refunded » | commit `37b1327` ; `todo` retiré au lot 1 de la phase 1 |
| D2 | `createStrapi()` (seed, `develop`, `start`) interrogeait le registre npm une fois par jour et réécrivait `strapi/.strapi-updater.json`, fichier suivi par git | `integration/api.test.js`, « coupe la notification de mise à jour de Strapi » | commit `37b1327` (`logger: { updates: { enabled: false } }`) ; `todo` retiré au lot 1 de la phase 1. Vérifié : le contenu de `.strapi-updater.json` est identique avant et après une exécution complète |

## Limites et dette

- Le projet `visual` reste local : références propres à macOS, données de `strapi_espace` absentes en CI. Il dépend des polices Google (Q-14).
- Les anciens ports e2e (1338, 4322) sont occupés sur le poste de Mathieu par le serveur de développement de BoisDesAlpes : les défauts sont 1348 et 4332 depuis le lot 1 de la phase 1 (libres au 29/10). Le refus immédiat sur port occupé (« already used ») a été vérifié en phase 0.
- Le workflow `tests.yml` a tourné vert sur GitHub (exécution 40904388004, commit `37b1327`). Il ne pose aucune variable : il garde les bases et les ports par défaut, que le lot 1 a changés sans le modifier.
- La garde du seed (`/_(e2e|test)$/`) admet `_test` et `x__test`, que `assertTestDatabase` des tests refuse : sans conséquence (ce sont des noms de bases de test), consigné pour mémoire. Le test d'ordre des étapes de `main()` lit encore le source de `seed.js` (`refuse`, `app.load()`, `await wipe(app)`) : un renommage dans le seed le casse sans que le comportement change.
- `web/.astro/types.d.ts` est réécrit par `astro build` (donc par `test:e2e`) : fichier suivi par git, à restaurer avant tout commit.
- `integration/seed.test.js` redémarre Strapi trois fois sur la base de test (environ 15 s) : le prix de la preuve d'idempotence avec données étrangères.
- Les événements `entry.create` et `entry.publish` de Strapi sont émis sans être attendus : `stopStrapi` patiente 750 ms avant de détruire la connexion (`helpers/strapi.js`), sinon le processus reste 60 s sur un délai d'acquisition de connexion.
- Pas de couverture de branches mesurée en phase 0 (`node --test --experimental-test-coverage` est disponible pour la porte de la phase 2).
- Phase 1 : retirer ou adapter `routes: ne déclare que GET /api/espace/health` et ajouter les tests T-xx de `10-recette.md` ; le harnais (`startStrapi`, `buildTestEnv`, `resetDatabase`, faux HelloAsso en module) est prévu pour eux.
