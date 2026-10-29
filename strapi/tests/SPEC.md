# SPEC des tests de l'espace participant

Registre vivant de ce qui est testé et pourquoi. Tenu par le tester. Couvre les trois suites du dépôt : Strapi (`strapi/tests/`), Playwright `e2e` (`web/tests/e2e/`) et Playwright `visual` (`web/tests/visual/`). État : lot 3 de la phase 1 (tests d'abord, écrits à partir des specs avant le code des lots 2 à 5).

Deux sortes de tests coexistent dans la suite Strapi :

- **actifs** : ils passent aujourd'hui et doivent passer à tout moment ;
- **tests d'abord** : écrits avant le code qui les satisfait, ils portent `pending('lot N')` (`tests/helpers/pending.js`, option `todo` de `node:test`). Ils s'exécutent et s'affichent, leur échec ne fait pas échouer la suite. Le tester retire le marqueur du groupe quand le lot N est livré (section « Tests d'abord de la phase 1 »).

## Lancer les tests

`<dépôt>` = racine du dépôt. Toujours par corepack (`docs/espace/CLAUDE.md`).

| Suite | Commande | Prérequis | Durée mesurée le 29/10 (lot 3) |
|---|---|---|---|
| Strapi, tout | `corepack pnpm@12.15.0 --dir <dépôt>/strapi test` | Postgres (`make -C <dépôt> infra-up`) | 125 s environ, 998 tests : 430 passés, 568 `todo` (tests d'abord), 0 échec |
| Strapi, unitaires | `… strapi test:unit` | aucun (rapide, sans Strapi) | 7 s, 691 tests : 355 passés, 336 `todo` |
| Strapi, intégration | `… strapi test:integration` | Postgres | 129 s, 307 tests : 75 passés, 232 `todo` |
| e2e | `corepack pnpm@12.15.0 --dir <dépôt>/web test:e2e` | Postgres, Chromium, ports 1348 et 4332 libres | 17 s, 10 tests |
| visuel (local) | `… web test:visual` | Strapi sur `strapi_espace` (1337), `web build` puis `web preview --host 127.0.0.1 --port 4321` | 6 s, 4 tests |

Mesures du lot 3, arbre de travail du 29/10 (lots 2, 4 et 5 du développeur commités) : les 568 tests d'abord y sont marqués `todo` et 566 passent déjà (ils s'affichent donc comme `todo` réussis) ; sur le commit a70a56e, avant le lot 2, la suite compte 978 tests (410 passés, 568 `todo` en échec). Le nombre de tests actifs passe de 410 à 430 une fois les types de l'espace créés, parce que les règles communes des schémas se vérifient pour chacun d'eux. Pour lire les erreurs des tests d'abord : `TESTS_FIRST_STRICT=1` devant la commande (section « Tests d'abord de la phase 1 »). La durée vient surtout des démarrages de Strapi (une quinzaine, dont trois pour le seed et deux pour le test d'index).

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
| Aucune relation existante modifiée (prod éditée directement : une relation changée recrée sa table de liaison, vide) | liste figée des relations, médias et composants des 9 types existants (`tests/fixtures/existing-schemas.json`, relevée au commit a70a56e) comparée aux `schema.json` ; seuls 9 champs privés sur `edition` et `kind` sur `sequence` peuvent s'ajouter ; aucune relation d'un type existant ne vise `api::espace.*` ; les types de l'espace n'ont ni brouillon, ni côté inverse vers un type existant | `unit/schemas.test.js` (actif), `integration/espace-schema.test.js` (republication, lot 2) |
| Seed uniquement sur `_test` ou `_e2e` | garde du seed (code du developer) : prédicat `isSeedAllowed` appelé directement, ordre des étapes de `main()` lu dans le source, refus en sous-processus avec une base inventée ; jamais contre les vraies bases | `unit/seed-guard.test.js` |

## Tests d'abord de la phase 1 (lot 3)

Écrits à partir des specs et du plan (`docs/espace/journal/phase-1-plan.md`, section 4), avant le code des lots 2 à 5. Chaque groupe porte `pending('lot N')` : le test s'exécute et s'affiche, son échec ne fait pas échouer la suite (suite en code 0 à tout moment). À la livraison du lot N, le tester retire le marqueur du groupe (`grep -rn "pending('lot N" strapi/tests`), lance la suite et rapporte les échecs à l'architecte avec leur reproduction ; il ne corrige pas le code applicatif.

Voir les vraies erreurs de tous les groupes en attente, comme avec un code en place : `TESTS_FIRST_STRICT=1 corepack pnpm@12.15.0 --dir <dépôt>/strapi test:unit` (ou `test:integration`). Cette variable n'est lue que par `tests/helpers/pending.js`.

**Vérification de l'écriture « d'abord »** (29 octobre) : sur l'arbre du commit a70a56e, avant tout code du lot 2, la suite sort en code 0 avec 410 tests actifs passés et 568 tests d'abord en attente, dont aucun ne passe. En mode strict, chacun échoue pour la bonne raison : module absent (`Cannot find module …/lib/slots`), route absente (404 ou 405), table ou type absent (`Cannot read properties of undefined (reading 'attributes')` sur `documents('api::espace.*')`), `schema.json` absent, section de configuration absente, index absent. Les tests qui passaient avant le code (par exemple un refus de nom de gabarit qui n'était que l'échec du chargement du module) ont été resserrés ou déplacés en tests actifs.

**Contrôle informatif contre le code du développeur** (commit 4236ea2, lots 2, 4 et 5 commités le 29 octobre, après l'écriture des tests) : en mode strict, 566 des 568 tests d'abord passent. Les deux qui échouent sont des ambiguïtés de spec (points 4 et 8 ci-dessous). Ce contrôle n'active rien : un groupe ne s'active que sur demande de l'architecte.

| Fichier | Groupes | Exigences | Lot | Tests |
|---|---|---|---|---|
| `unit/time.test.js` | `parseProgramTime` (formes du programme, `--`), `zonedToUtc` (hiver, été, saut de printemps, heure ambiguë d'automne), `formatTimeLabel` | R-01, A-09 | 2 | 39 |
| `unit/slots.test.js` | `computeSlots` (exemple de R-01, pas et bornes, avertissements `MISSING_END` `INVALID_TIME` `TOO_SHORT` `OVERLAP`), `planSlots` (créer, garder, supprimer, orphelins, idempotence) | R-01, R-02 | 2 | 34 |
| `unit/tokens.test.js` | `generateToken`, `hashToken`, `linkUrl` | I-20, I-21, NF-02, A-04 | 2 | 11 |
| `unit/errors-guards.test.js` | `EspaceError`, `requireSession`, `requireOrganizer` | NF-01, I-23, 06-api | 2 | 10 |
| `unit/mail-templates.test.js` | `escapeHtml`, nom de gabarit contrôlé `^[a-z-]+$` | NF-05, I-31 | 2 | 14 |
| | gabarits `welcome` et `meeting-cancelled` (lien en HTML et texte, `<script>` échappé, couleur d'édition, enveloppe 600 px, logo, pied, « Gérer mes notifications », aucun tiret cadratin, apostrophes typographiques) | I-12, A-17, I-21, R-18, T-06, NF-05 | 4 | 20 |
| | gabarit `access-link` (mêmes contrôles) | T-01, I-20 | 5 | 10 |
| `unit/schemas.test.js` | les 10 types nouveaux : tables `espace_*`, relations et cibles de la section 3, 9 champs privés d'`edition`, `sequence.kind`, MCP | 02, A-03, A-15 | 2 | 31 |
| `unit/config-espace.test.js` | `config/server.js` (espace, HelloAsso, proxy, cron), `config/middlewares.js` (CORS), `.env.example`, variables transmises par le compose, overlays et `deploy.yml` | A-04, A-05, A-08, I-10, I-23, NF-06, NF-53 | 2 | 30 |
| | contenu de `config/cron-tasks.js` (`*/15 * * * *`, `0 4 * * *`, Europe/Paris) | A-08, I-12, I-20 | 4 | 3 |
| `unit/import.test.js` | `normalizeEmail`, `mapItem` (Q-03 par tarif, bénéficiaire et payeur, Q-15 état par état, NF-11), `planSync` (I-14, R-18, R-31, idempotence, remplissage de 120 billets) | I-11, I-12, I-14, Q-03, Q-15, R-18, R-31, NF-11 | 4 | 77 |
| `unit/helloasso-client.test.js` | jeton (cache, expiration à `expires_in - 60`, 401 puis un seul nouvel essai), pagination au-delà de 100 billets, 50 pages au plus, `HelloAssoError` sans secret | I-10, I-11, I-13, NF-06 | 4 | 15 |
| `unit/session.test.js` | `safeNextPath` (redirections ouvertes), `sessionCookieOptions` | I-21, I-22, A-04, NF-04 | 5 | 33 |
| `unit/rate-limit.test.js` | limiteur à fenêtre glissante, 5 par 15 minutes | NF-03, T-04, F-02 | 5 | 9 |
| `integration/espace-schema.test.js` | index `espace_meetings_table_key_uq` (unicité, nuls admis, redémarrage), republication d'une édition, d'une séquence, d'un intervenant et d'une organisation sans détacher Slot, Topic, Attendee, Exhibitor ni les relations existantes | R-13, A-07, A-03, section 3 | 2 | 14 |
| `integration/espace-socle.test.js` | `GET /editions/:slug`, API publique du site sans champ de l'espace, contrôle `Origin`, CORS refusé hors du front, erreurs `INTERNAL` avec `requestId` et journal, configuration câblée, services `editions` `tokens` | 06-api, NF-04, NF-50, NF-52, A-04, A-05, A-20, I-20 | 2 | 41 |
| `integration/seed.test.js` | seed du lot 2 : réglages, 5 Topic, `kind`, `Topic.sessions`, 2 Exhibitor, 10 Slot, idempotence, données étrangères conservées | 4.4 points 1 à 5, A-13, R-01, Q-17 | 2 | 12 |
| | seed du lot 4 : 17 Attendee, Lucas Darrigade `cancelled`, consentements, 17 EmailLog `welcome`, idempotence | 4.4 point 6, Q-15, Q-17, NF-11 | 4 | 12 |
| `integration/espace-sync.test.js` | synchronisation sur le faux (création, idempotence, cas limites, annulation, réactivation, champs édités, verrou `SYNC_RUNNING`, `welcome`, T-06 avec `meeting-cancelled`, HelloAsso en défaut, secret absent des journaux), `mailer.send`, `HELLOASSO_NOT_CONFIGURED`, tâches planifiées avec `CRON_ENABLED=true` | I-10 à I-12, I-14, I-30, I-31, Q-03, Q-15, R-18, R-31, NF-11, NF-13, A-16, A-17, A-19, T-05, T-06 | 4 | 45 |
| `integration/espace-acces.test.js` | T-01 à T-04, A-18 (états d'un lien), vérification, session (cookie, signature, glissement, déconnexion), organisateurs, accès croisés A, B, C sur `/me`, profil et consentement, gel de l'édition, redirections 303 absolues, cookie `Secure` en https, réponse qui n'attend pas l'envoi | T-01 à T-04, I-20 à I-23, F-01 à F-04, NF-01 à NF-04, NF-52, Q-13, A-16, A-18, A-19 | 5 | 91 |
| `integration/espace-admin.test.js` | route de régénération des créneaux (R-01, R-02, orphelins, doublons), routes de synchronisation et d'historique, scénario de la porte (import idempotent, jeton renouvelé, T-06, sessions refusées) | R-01, R-02, I-12, A-16, NF-01, T-05, T-06 | 5 (avec 2 et 4) | 17 |

Total : 236 tests d'abord pour le lot 2, 172 pour le lot 4, 160 pour le lot 5.

### Harnais ajouté au lot 3

| Fichier | Rôle |
|---|---|
| `helpers/pending.js` | marqueur `pending('lot N')` et mode strict |
| `helpers/config-env.js` | aide `env` de Strapi simulée (`int`, `bool`, `array`, `json`) pour les tests de configuration |
| `helpers/espace.js` | Strapi démarré avec faux HelloAsso en module, requêtes avec `Origin` et IP choisis, lecture de la boîte de sortie avec attente, connexion d'un Attendee (demande, lien, vérification, cookie), `useEspace` (une erreur de démarrage ne fait pas échouer le hook) |
| `helpers/espace-data.js` | éditions, programme et Attendee de test par le Document Service |
| `helpers/env.js` | `buildTestEnv` : `PUBLIC_URL`, `CORS_ORIGINS`, `ORGANIZER_EMAILS`, `IS_PROXIED=true`, `HELLOASSO_*` vidés |
| `fixtures/existing-schemas.json` | relations, médias et composants des types existants, relevés au commit a70a56e |

### Écarts et ambiguïtés relevés dans les specs (pour l'architecte)

Chaque point cite le test concerné. Hypothèse retenue entre parenthèses.

1. **Méthode de `services/slots.js`** : la section 4.1 ne nomme que `lib/slots.js`. Les tests passent par le seed (lot 2) et la route de régénération (lot 5), jamais par le service.
2. **Gabarit d'essai du lot 2 (critère 9)** : aucun gabarit n'existe au lot 2. Le test de `mailer.send` utilise `welcome` et s'active au lot 4.
3. **`hit(key)` du limiteur** : le sens du booléen n'est pas dit (vrai si la demande est admise).
4. **`mapItem` sans `helloassoFieldMap`** (null, `{}`) : repli sur `payer.email` seul (D-03, « jamais en dur ») ou libellés `Email`, `Organisation`, `Poste` par défaut ? Test : `import.test.js`, « ne plante pas sans correspondance de champs ». Le code en cours du lot 4 retient les libellés par défaut et échoue ce test.
5. **Champ Email invalide, payeur valable** (billet 910004 des cas limites) : I-11 dit de se replier sur le payeur, le critère 2 du lot 4 attend `INVALID_EMAIL` consigné. Les tests acceptent la création par le payeur ou l'erreur ; `INVALID_EMAIL` n'est exigé que si aucune adresse n'est valable.
6. **`DUPLICATE_EMAIL` ou `EMAIL_TAKEN`** quand l'adresse appartient déjà à un Attendee de l'édition : la seconde synchronisation doit redonner les mêmes erreurs (critère 2 du lot 4), donc `DUPLICATE_EMAIL`. Les tests unitaires de `planSync` admettent les deux codes ; seul l'aller-retour exige l'identité des erreurs.
7. **Motif (`reason`) de `meeting-cancelled`** : donné au gabarit, mais l'affichage n'est pas imposé. Non vérifié.
8. **Lien « Gérer mes notifications » dans `access-link`** : le plan l'attache à l'enveloppe commune (4.1), le gabarit en cours du lot 5 l'omet. Le test l'exige pour les trois gabarits.
9. **Édition fermée et `meeting-cancelled`** : NF-52 coupe les envois d'une édition fermée, donc l'annulation d'un inscrit d'une édition fermée ne notifie personne. Les tests de T-06 utilisent une édition ouverte.
10. **Synchronisation manuelle d'une édition sans formulaire HelloAsso renseigné** : comportement non spécifié (le cron l'ignore). Non testé.
11. **`SYNC_RUNNING` au niveau du service** : le plan donne le 409 de la route ; au niveau de `sync.run`, les tests acceptent une erreur de `code` `SYNC_RUNNING` ou de `status` 409.
12. **Forme des Attendee passés à `planSync`, de `existing[]` dans `planSlots` (`activeMeetings`) et de la valeur rendue par `listFormItems` (tableau)** : déduites du modèle et du plan, non écrites dans la section 4.1.
13. **Test de la porte, session organisateur** : les routes `admin` (créneaux, synchronisation) ne se testent qu'avec une session, donc leurs groupes ne s'activent qu'avec le lot 5, même quand leur logique relève des lots 2 et 4. Le service `sync.run` et le seed se testent dès le lot 4.

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
| Harnais de la phase 1 (lot 3) | `buildTestEnv` pose `PUBLIC_URL`, `CORS_ORIGINS` (`http://localhost:4321`), `ORGANIZER_EMAILS` (`organisation@example.org`), `IS_PROXIED=true` (chaque requête de test choisit son IP par `X-Forwarded-For`) et vide `HELLOASSO_*` même si l'environnement du poste en porte ; une surcharge peut viser le faux HelloAsso | `unit/harness.test.js` |
| Configuration de l'espace (acquis) | `config/server.js` garde la section e-mail et la coupure de la notification de mise à jour ; `.env.example` et les fichiers de déploiement ne contiennent aucun secret réel | `unit/config-espace.test.js` (actifs) |
| Bases configurables (lot 1, phase 1) | `testDatabaseName` et `e2eDatabaseName` : défauts, variable posée, lecture de `process.env`, refus (`strapi`, `strapi_espace`, sans suffixe, mauvais suffixe, majuscules, injection, plus de 63 caractères) avec le nom de la variable dans le message ; `buildTestEnv` et `startStrapi` suivent `TEST_DATABASE` et refusent une base interdite avant toute connexion ; boîte d'e-mails distincte par base | `unit/harness.test.js` |
| Bases configurables sur Postgres | `ensureDatabase` crée la base manquante, supporte six créations simultanées de la même base ; `resetDatabase` ne vide que sa base ; `prepare-databases.js` crée les deux bases nommées par les variables, est répétable, ne vide rien, refuse chacune des 8 valeurs interdites sans rien créer (la base valide de l'autre variable non plus) ; bases temporaires `jib_tmp_<pid>_…` supprimées à la fin | `integration/databases.test.js` |
| B3 (seed) | sur `strapi_test` vide : édition publiée avec ses réglages, 9 séquences ordonnées, 3 pauses B2B, 4 organisations, 2 intervenants liés, résumé ; second passage : même état, mêmes comptes, données étrangères conservées ; aucun tag, aucun fichier | `integration/seed.test.js` |
| B4 | `GET /api/espace/health` 200 `{"status":"ok"}` sans authentification, HEAD 200, POST/PUT/PATCH/DELETE 405 | `integration/api.test.js`, `e2e/smoke.spec.ts` |
| A-02 | toute route sous `/api/espace` figure dans la table de la section 4.2 du plan de la phase 1 (12 routes, noms de paramètres libres), aucune en double, aucune route CRUD, aucune route de l'API `espace` hors du préfixe ; `GET /health` toujours présente ; aucune route rattachée à un type `api::espace.*` ; GET de chemins CRUD en 404, écritures (avec un `Origin` admis, pour ne pas dépendre du contrôle du lot 2) en 404 ou 405. Vrai à chaque lot : une route de plus doit être ajoutée à la liste du test, donc au plan | `integration/api.test.js`, `e2e/smoke.spec.ts` (voir limites) |
| B4 (DEMO_SEED) | avec `DEMO_SEED=false` : base vide, aucune édition, aucun tag, aucune image ; sans la variable : éditions de démonstration créées comme avant (téléversement simulé, aucun fichier écrit dans `public/uploads`) | `integration/api.test.js`, `integration/bootstrap-demo.test.js` |
| Routes du site | `contact/send`, `newsletter/subscribe`, `captcha/challenge` toujours déclarées ; lecture publique des éditions, intervenants, organisations, séquences, tags en 200 ; contact et newsletter ne reçoivent jamais `ORIGIN_REFUSED` (NF-04 ne vaut que sous `/api/espace`) | `integration/api.test.js` |
| C3 | accueil rendu avec l'édition de recette, liste des éditions, page d'édition (9 titres de programme dont 2 « Pause et B2B », lieu, intervenants), fiches intervenant et organisation, 404 d'une page inconnue, redirection vers 404 d'une édition inconnue ; aucune exception JavaScript ; aucune requête hors localhost hors polices Google | `e2e/smoke.spec.ts`, `e2e/fixtures.ts` |
| NF-40, porte de phase 0 | non-régression visuelle de `/` et `/editions/nouvelle-aquitaine` à 390 et 1280 px (4 références macOS, tolérance 0,01 %) | `web/tests/visual/public-pages.spec.ts` (lot A) |
| Conventions | aucun tiret cadratin (U+2014 ni entité) dans les fichiers de l'espace, des tests, du workflow et de `docs/espace`, et, dès leur création, dans les dossiers de la phase 1 : `strapi/config/{middlewares,cron-tasks}.js` et, côté web, `EspaceLayout.astro`, `espace.css`, `components/espace`, `pages/espace`, `react-components/espace`, `lib/espace`, `middleware.ts`. Jamais les pages publiques ni les contenus saisis | `unit/conventions.test.js` |

## Défauts du lot B

Aucun défaut ouvert. Un défaut constaté mais non corrigé se consigne par un test marqué `todo` (il s'exécute et s'affiche sans faire échouer la suite) ; le tester retire `todo` dès la correction. Aucun `todo` de défaut n'est en cours : les `todo` de la suite sont les tests d'abord de la phase 1 (section « Tests d'abord de la phase 1 »).

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
- Les tests d'abord de la phase 1 supposent des noms que les specs ne figent pas toujours (voir « Écarts et ambiguïtés relevés dans les specs ») : à l'activation, un échec peut venir du test autant que du code, et l'architecte tranche.
- Les tests d'intégration qui coupent la base (`app.db.connection.client.acquireConnection`) ou le journal (`app.log.*`) le font le temps d'un appel et rétablissent l'original dans un `finally`. Ceux de la boîte de sortie bloquée (tube nommé, `mkfifo`) ou impossible (dossier à la place du fichier) rétablissent aussi le fichier : ils supposent un poste Unix.
- `strapi test` pèse environ 125 s : le coût vient des démarrages de Strapi, un par fichier d'intégration (le seed en fait trois). La suite reste séquentielle (`--test-concurrency=1`) parce que tous les fichiers partagent la base de test.
- Aucun test de temps de réponse : la propriété de F-02 (une adresse connue et une adresse inconnue ne se distinguent pas au temps de réponse) se vérifie par un envoi bloqué qui ne retarde pas la réponse (A-19), pas par une mesure.
- NF-02 (comparaison de jeton en temps constant) n'est pas testable de l'extérieur : seuls le hachage, l'usage unique et le refus de l'empreinte comme jeton sont vérifiés.
- Le test de la porte (`integration/espace-admin.test.js`) tient en un seul test long (environ 7 s) parce que ses trois synchronisations dépendent l'une de l'autre ; le bac à sable HelloAsso reste à faire à la main, hors CI (plan de la phase 1, section 7).
