# SPEC des tests de l'espace participant

Registre vivant de ce qui est testé et pourquoi. Tenu par le tester. Couvre les trois suites du dépôt : Strapi (`strapi/tests/`), Playwright `e2e` (`web/tests/e2e/`) et Playwright `visual` (`web/tests/visual/`). État : lot 7 de la phase 1 exécuté (30 octobre) : suite Strapi inchangée en nombre (1136), 31 tests e2e de l'espace ajoutés (41 au total, dont un échec attendu : défaut D3), test visuel relancé.

Tous les tests de la suite Strapi sont **actifs** : ils passent et doivent passer à tout moment. Aucun n'est marqué `todo` ni en attente. Le marqueur `pending('lot N')` (`tests/helpers/pending.js`, option `todo` de `node:test`) reste disponible pour de futurs tests écrits avant leur code ; aucun fichier ne l'importe plus. Un défaut constaté mais non corrigé se consigne par un test `todo` accompagné de sa reproduction, à retirer dès la correction.

## Lancer les tests

`<dépôt>` = racine du dépôt. Toujours par corepack (`docs/espace/CLAUDE.md`).

| Suite | Commande | Prérequis | Mesure du 29/10 (lot 6b) |
|---|---|---|---|
| Strapi, tout | `corepack pnpm@12.15.0 --dir <dépôt>/strapi test` | Postgres (`make -C <dépôt> infra-up`) | 178 s, 1136 tests : 1136 passés, 0 `todo`, 0 échec (30/10, lot 7) |
| Strapi, unitaires | `… strapi test:unit` | aucun (sans Strapi) | 7,4 s, 770 tests |
| Strapi, intégration | `… strapi test:integration` | Postgres | environ 162 s, 366 tests |
| e2e | `corepack pnpm@12.15.0 --dir <dépôt>/web test:e2e` | Postgres, Chromium, ports 1348 et 4332 libres | 26 s de tests (environ 40 s avec le démarrage et la construction du front), 41 tests : 41 passés dont 1 échec attendu, D3 (30/10, lot 7) |
| e2e avec captures du designer | `E2E_CAPTURES_DIR=<dossier hors dépôt> … web test:e2e` | idem | mêmes tests ; `capture()` enregistre les écrans à 390 et 1280 px (voir « Tests e2e de l'espace ») |
| visuel (local) | `… web test:visual` | Strapi sur `strapi_espace` (1337), `web build` puis `web preview --host 127.0.0.1 --port 4321` | 6 s, 4 tests : 4 passés (30/10, lot 7) |

La durée de la suite Strapi vient des démarrages de Strapi (un par fichier d'intégration, trois pour `seed.test.js`, deux pour le test d'index, un pour `espace-seed-sync.test.js`). La suite est séquentielle (`--test-concurrency=1`) parce que tous les fichiers partagent la base de test. Deux exécutions complètes de suite sur l'arbre du lot 6b donnent le même résultat (1136 sur 1136), une troisième au lot 7 aussi.

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
| Aucun appel réseau hors localhost | `tests/helpers/no-network.js`, préchargé par `node --require` (scripts `test*`, serveur e2e, sous-processus du seed) : toute connexion TCP hors boucle locale échoue et est consignée. Télémétrie Strapi coupée. Navigateur e2e : toute requête hors localhost coupée ; seules les polices Google sont tolérées, et seulement sur les pages publiques : les tests de l'espace (`e2e/espace.ts`) n'en tolèrent aucune Le délai de HelloAsso se prouve contre un serveur local qui ne répond pas, jamais contre un hôte distant | `unit/harness.test.js`, `e2e/fixtures.ts`, `integration/espace-sync.test.js` |
| Fuseau | `TZ=UTC` dans les scripts et l'environnement imposé | |
| Aucune relation existante modifiée (prod éditée directement : une relation changée recrée sa table de liaison, vide) | liste figée des relations, médias et composants des 9 types existants (`tests/fixtures/existing-schemas.json`, relevée au commit a70a56e) comparée aux `schema.json` ; seuls 9 champs privés sur `edition` et `kind` sur `sequence` peuvent s'ajouter ; aucune relation d'un type existant ne vise `api::espace.*` ; les types de l'espace n'ont ni brouillon, ni côté inverse vers un type existant | `unit/schemas.test.js`, `integration/espace-schema.test.js` (republication) |
| Seed uniquement sur `_test` ou `_e2e` | garde du seed (code du developer) : prédicat `isSeedAllowed` appelé directement, ordre des étapes de `main()` lu dans le source, refus en sous-processus avec une base inventée ; jamais contre les vraies bases | `unit/seed-guard.test.js` |
| Adresses fictives | `@example.org` partout ; les adresses de longueur imposée viennent de `helpers/addresses.js` | `unit/conventions.test.js`, tests de chaque fichier |

## Tests de la phase 1 : état par fichier

Écrits à partir des specs et du plan (`docs/espace/journal/phase-1-plan.md`, sections 4 et 11) avant le code des lots 2 à 5 et 6b, puis activés le 29 octobre, après livraison du code. Au moment d'activer, les tests ont été corrigés selon les décisions de la section 11 du plan quand c'était le test qui se trompait (section « Écarts et ambiguïtés : tranchés »). Les nombres sont ceux du fichier entier, tests de la phase 0 compris.

| Fichier | Ce qui est vérifié | Exigences | Tests |
|---|---|---|---|
| `unit/time.test.js` | `parseProgramTime` (formes du programme, `--`), `zonedToUtc` (hiver, été, saut de printemps, heure ambiguë d'automne), `formatTimeLabel` | R-01, A-09 | 39 |
| `unit/slots.test.js` | `computeSlots` (exemple de R-01, pas et bornes, avertissements `MISSING_END` `INVALID_TIME` `TOO_SHORT` `OVERLAP`), `planSlots` (créer, garder, supprimer, orphelins dont seuls les rendez-vous `pending` et `accepted` comptent, idempotence) | R-01, R-02 | 34 |
| `unit/tokens.test.js` | `generateToken`, `hashToken`, `linkUrl` | I-20, I-21, NF-02, A-04 | 11 |
| `unit/errors-guards.test.js` | `EspaceError`, `requireSession`, `requireOrganizer` | NF-01, I-23, 06-api | 10 |
| `unit/mail-templates.test.js` | `escapeHtml`, nom de gabarit contrôlé `^[a-z-]+$`, gabarits `welcome`, `meeting-cancelled` et `access-link` (lien en HTML et texte, `<script>` échappé, couleur d'édition, enveloppe 600 px, logo, pied, aucun tiret cadratin, apostrophes typographiques), « Gérer mes notifications » présent dans `welcome` et `meeting-cancelled` et absent d'`access-link`, motif de `meeting-cancelled` affiché seulement s'il est donné | I-12, I-21, A-17, R-18, T-01, T-06, NF-05, I-31 | 52 |
| `unit/schemas.test.js` | les 10 types nouveaux : tables `espace_*`, relations et cibles de la section 3, 9 champs privés d'`edition`, `sequence.kind`, MCP, relations existantes inchangées | 02, A-03, A-15 | 80 |
| `unit/config-espace.test.js` | `config/server.js` (espace, HelloAsso, proxy, cron), `config/middlewares.js` (CORS), `.env.example`, variables transmises par le compose, overlays et `deploy.yml` ; `config/cron-tasks.js` (`*/15 * * * *`, `0 4 * * *`, Europe/Paris) et son contenu : la synchronisation et la purge n'appellent que des services (`tokens.purgeExpired()` sans argument, erreur journalisée et jamais remontée), aucune requête (`strapi.db`, `query`, Document Service, `new Date()`) | A-04, A-05, A-08, A-21, I-10, I-12, I-20, I-23, NF-06, NF-53 | 41 |
| `unit/import.test.js` | `normalizeEmail` (254 caractères au plus, seule définition dans `strapi/src`, `services/auth.js` l'importe), `mapItem` (Q-03 par tarif, bénéficiaire et payeur, Q-15 état par état, NF-11, repli sur le payeur sans `helloassoFieldMap`, adresse de 255 caractères non retenue), `planSync` (I-14, R-18, R-31, idempotence, remplissage de 120 billets, rachat d'un billet par un Attendee annulé selon A-22 : rattachement, champs rafraîchis hors `editedFields`, rôle et consentements intacts, idempotence, un seul rattachement par synchronisation, majuscules, annulation concomitante) | I-11, I-12, I-14, Q-03, Q-15, R-18, R-31, NF-11, A-22, A-23 | 109 |
| `unit/helloasso-client.test.js` | jeton (cache, expiration à `expires_in - 60`, 401 puis un seul nouvel essai), pagination au-delà de 100 billets, 50 pages au plus, `HelloAssoError` sans secret ; délai `timeoutMs` (défaut 20 s) : jeton, billets et `getOrder` qui ne répondent pas donnent une `HelloAssoError` sans `status`, un signal d'abandon est fourni à chaque `fetch` | I-10, I-11, I-13, NF-06, section 11 point 7 | 22 |
| `unit/session.test.js` | `safeNextPath` (redirections ouvertes), `sessionCookieOptions` | I-21, I-22, A-04, NF-04 | 33 |
| `unit/rate-limit.test.js` | limiteur à fenêtre glissante, 5 par 15 minutes ; `hit(key)` vrai si la demande est admise, une demande refusée n'est pas comptée | NF-03, T-04, F-02 | 9 |
| `unit/web-middleware.test.js` | `web/src/middleware.ts` chargé tel quel par Node (modules d'Astro simulés) : CSP sans origine tierce, `nosniff`, `Cache-Control: private, no-store` sous `/espace` et rien ailleurs ; `Referrer-Policy: strict-origin` sur `/espace/verifier` (avec jeton en requête, avec barre finale), `strict-origin-when-cross-origin` sur les autres pages, jamais `no-referrer` | NF-07, A-24 | 27 |
| `integration/espace-schema.test.js` | index `espace_meetings_table_key_uq` (unicité, nuls admis, redémarrage), republication d'une édition, d'une séquence, d'un intervenant et d'une organisation sans détacher Slot, Topic, Attendee, Exhibitor ni les relations existantes | R-13, A-07, A-03, section 3 | 14 |
| `integration/espace-socle.test.js` | `GET /editions/:slug`, API publique du site sans champ de l'espace, contrôle `Origin`, CORS refusé hors du front, erreurs `INTERNAL` avec `requestId` et journal, configuration câblée, services `editions` `tokens` `mailer` ; `tokens.purgeExpired` avec délai de grâce de 7 jours (6 jours gardé, 8 jours supprimé, frontière à 7 jours, liens et sessions, nombre rendu, `graceDays` réglable, valeurs par défaut, lien expiré la veille encore en « expiré, adresse préremplie ») | 06-api, NF-04, NF-50, NF-52, A-04, A-05, A-18, A-20, A-21, I-20 | 55 |
| `integration/seed.test.js` | seed de recette : réglages, 5 Topic, `kind`, `Topic.sessions`, 2 Exhibitor, 10 Slot, 17 Attendee dont Lucas Darrigade `cancelled`, consentements, 17 EmailLog `welcome`, idempotence, données étrangères conservées | 4.4, A-13, R-01, Q-15, Q-17, NF-11 | 37 |
| `integration/espace-seed-sync.test.js` | base fraîchement seedée puis synchronisation contre le faux : 0 création, 0 mise à jour, 0 annulation, 0 erreur, aucun e-mail (le seed et l'import s'accordent sur les 17 billets) | 4.4 point 6, critère 1 du lot 4, I-12, Q-15 | 6 |
| `integration/espace-sync.test.js` | synchronisation sur le faux (création, idempotence, cas limites, annulation, réactivation, champs édités, verrou `SYNC_RUNNING`, `welcome`, T-06 avec `meeting-cancelled`, HelloAsso en défaut, secret absent des journaux) ; A-22 de bout en bout (rachat d'un billet : 0 création, 1 mise à jour, identifiant de commande renouvelé, rendez-vous annulés qui le restent, reconnexion possible, deux billets actifs B et C, annulation concomitante) ; édition fermée (rendez-vous annulés, `tableKey` à `null`, aucune ligne dans la boîte de sortie, aucun lien émis, aucun EmailLog `meeting-cancelled`, appel direct de `cancelForAttendee`) ; HelloAsso qui ne répond pas (jeton puis billets : SyncRun clos en `FETCH_FAILED` sans statut, Strapi debout, synchronisation suivante non bloquée) ; `mailer.send` ; `HELLOASSO_NOT_CONFIGURED` ; tâches planifiées avec `CRON_ENABLED=true` | I-10 à I-12, I-14, I-30, I-31, Q-03, Q-15, R-18, R-31, NF-11, NF-13, NF-52, A-08, A-16, A-17, A-19, A-22, T-05, T-06 | 63 |
| `integration/espace-acces.test.js` | T-01 à T-04, A-18 (états d'un lien ; lien d'un inscrit annulé ou d'une édition fermée sans adresse), vérification, session (cookie, signature, glissement, déconnexion), organisateurs, accès croisés A, B, C sur `/me`, profil et consentement, gel de l'édition, redirections 303 absolues, cookie `Secure` en https, réponse qui n'attend pas l'envoi ; adresse de 255 caractères refusée en `EMAIL_INVALID` (A-23) ; A-25 : sans `X-Forwarded-Proto`, `GET /me` d'une session à prolonger répond 200 sans `Set-Cookie` ni échéance changée, le glissement a lieu à l'appel suivant du navigateur, `POST /auth/logout` répond 204 et supprime la session sans `Set-Cookie`, le formulaire de déconnexion redirige en 303 | T-01 à T-04, I-20 à I-23, F-01 à F-04, NF-01 à NF-04, NF-52, Q-13, A-16, A-18, A-19, A-23, A-25 | 110 |
| `integration/espace-admin.test.js` | route de régénération des créneaux (R-01, R-02, orphelins, doublons) et `services/slots.js` `regenerate` en appel direct, routes de synchronisation et d'historique (formulaire absent ou en défaut : réponse 200), scénario de la porte (import idempotent, jeton renouvelé, T-06, sessions refusées). Resserré au lot 7 : la première synchronisation crée exactement 139 Attendee (16 de recette, 1 commande groupée, 910004 par repli sur le payeur, Zoe, 120 figurants) et ses `errors` sont exactement les quatre de l'énoncé, au lieu de `>= 138` et de quatre codes parmi d'autres ; un `welcome` par Attendee créé et aucun de plus à la seconde synchronisation se lisent aussi dans la boîte de sortie, plus seulement dans EmailLog | R-01, R-02, I-12, A-16, NF-01, T-05, T-06 | 25 |

### Harnais

| Fichier | Rôle |
|---|---|
| `helpers/pending.js` | marqueur `pending('lot N')` et mode strict `TESTS_FIRST_STRICT=1`, disponible, inutilisé |
| `helpers/config-env.js` | aide `env` de Strapi simulée (`int`, `bool`, `array`, `json`) pour les tests de configuration |
| `helpers/espace.js` | Strapi démarré avec faux HelloAsso en module, requêtes avec `Origin` et IP choisis, lecture de la boîte de sortie avec attente, connexion d'un Attendee (demande, lien, vérification, cookie), `useEspace` (une erreur de démarrage ne fait pas échouer le hook) |
| `helpers/espace-data.js` | éditions, programme et Attendee de test par le Document Service |
| `helpers/addresses.js` | `addressOfLength(n)` : adresse valable de `n` caractères exactement, pour les limites de `normalizeEmail` (254 caractères au plus) |
| `helpers/env.js` | `buildTestEnv` : `PUBLIC_URL`, `CORS_ORIGINS`, `ORGANIZER_EMAILS`, `IS_PROXIED=true`, `HELLOASSO_*` vidés |
| `e2e-server.js` | serveur Strapi du e2e (vide la base, seed, démarre). Lot 7 : `PUBLIC_URL` et `CORS_ORIGINS` valent l'URL du front e2e (`http://127.0.0.1:E2E_WEB_PORT`) au lieu de `http://localhost:4321`, sans quoi les liens des e-mails, les 303 et le contrôle `Origin` visent un autre site ; la boîte de sortie (`EMAIL_OUTBOX_FILE` de `buildTestEnv` pour la base e2e) est supprimée au démarrage |
| `web/tests/e2e/espace.ts` | `test` de l'espace : réseau strict (aucun hôte externe, polices Google comprises), IP propre à chaque test par `X-Forwarded-For` (la limite de 5 demandes par IP ne lie pas les tests), lecture de la boîte de sortie (`mailsTo`, `nextMail`, `linkOf`, `receiveLink`), `capture()` |
| `fixtures/existing-schemas.json` | relations, médias et composants des types existants, relevés au commit a70a56e |

### Écarts et ambiguïtés : tranchés

Relevés au lot 3 dans les specs, tranchés par l'architecte à la section 11 du plan (29 octobre). Chaque point dit ce que les tests exigent désormais.

1. **`services/slots.js`** : `regenerate(editionDocumentId)`, appelé directement par `espace-admin.test.js`.
2. **Gabarit d'essai du lot 2** : `welcome`, vérifié par `mailer.send` dans `espace-sync.test.js`.
3. **`hit(key)`** : vrai si la demande est admise ; une demande refusée n'est pas comptée (`rate-limit.test.js`).
4. **`mapItem` sans `helloassoFieldMap`** : repli sur le payeur seul, aucun libellé par défaut (D-03, A-23). C'était le test qui se trompait (l'aide `map` remplaçait `undefined` par la correspondance de Q-03) : corrigé.
5. **Champ Email invalide, payeur valable** : repli sur le payeur (I-11). `INVALID_EMAIL` n'est exigé que sans aucune adresse valable.
6. **`DUPLICATE_EMAIL` ou `EMAIL_TAKEN`** : `planSync` ne produit que `DUPLICATE_EMAIL` ; `EMAIL_TAKEN` ne sort que du contrôle sous verrou du service. Les tests unitaires de `planSync` interdisent `EMAIL_TAKEN`.
7. **Motif de `meeting-cancelled`** : affiché seulement s'il est donné ; la synchronisation n'en donne pas.
8. **« Gérer mes notifications »** : exigé de `welcome` et `meeting-cancelled`, absent d'`access-link` (`manage: false`, design Q5).
9. **Édition fermée et `meeting-cancelled`** : les rendez-vous sont annulés, rien n'est envoyé (NF-52). Test actif depuis le lot 6b.
10. **Synchronisation manuelle sans formulaire HelloAsso** : SyncRun clos avec `HELLOASSO_NOT_CONFIGURED`, réponse 200. Testé.
11. **`SYNC_RUNNING` au niveau du service** : le plan donne le 409 de la route ; au niveau de `sync.run`, les tests acceptent une erreur de `code` `SYNC_RUNNING` ou de `status` 409.
12. **Forme des entrées de `planSync`, de `planSlots` (`activeMeetings`) et de `listFormItems`** : écrite en section 4.1 du plan.
13. **Test de la porte, session organisateur** : les routes `admin` ne se testent qu'avec une session ; leurs groupes relèvent du lot 5 même quand leur logique vient des lots 2 et 4.

## Tests e2e de l'espace (lot 7 de la phase 1)

Navigateur Chromium contre Strapi `strapi_e2e` (seed de recette) et le front construit, sur 127.0.0.1 : le navigateur envoie les formulaires et les appels de l'îlot à Strapi sur une autre origine (port 1348), comme sur dev et prod pour la partie CORS et cookie. Les e-mails se lisent dans la boîte de sortie du fournisseur `console`. Données : le seed ; chaque test a ses inscrits parce que la base n'est pas remise à zéro entre les tests et qu'un lien se consomme (Léa : T-01 ; Eva : T-03 ; Hugo : T-04 ; Mathis : sans JavaScript ; Clara et Lucas Darrigade, annulé : T-02 ; Tom Laffitte, seul inscrit sans consentement : parcours complet).

| Fichier | Ce qui est vérifié | Exigences | Tests |
|---|---|---|---|
| `e2e/espace-acces.spec.ts` | **E0** : bandeau, formulaire, mention, 0 balise `<script>` et 0 fichier JavaScript ; `?erreur=email` ; 404 d'une édition inconnue. **T-01** : « Lien envoyé », e-mail `access-link` (30 minutes, lien sur l'URL du front), lien valable. **T-02** : adresse inconnue et inscrit annulé, même message, aucun e-mail. **T-03** : lien lu sans être consommé, utilisé une fois, puis « Ce lien n'est plus valable » avec adresse préremplie et nouveau lien qui part ; jeton inconnu avec ou sans `next` ; 0 JavaScript sur la vérification ; le POST du formulaire part avec `Origin` de l'espace et `Referer` réduit à l'origine (`strict-origin`) et aboutit. **T-04** : 6e demande refusée, formulaire gardé, 5 e-mails seulement. **Sans JavaScript** : demande, lien, « Ouvrir mon espace », E1, déconnexion ; limitation ; message `<noscript>` d'E2 dans le HTML servi ; preuve que l'îlot ne s'hydrate pas ; **D3** (échec attendu, voir « Défauts ») | T-01 à T-04, F-01 à F-04, A-18, A-24, Q-13, NF-03, NF-20, NF-31, NF-04 | 12 |
| `e2e/espace-parcours.spec.ts` | Tom Laffitte, un test à étapes : E0, e-mail, vérification vers E2 (aucun consentement), cookie `jib_espace` (HttpOnly, Lax, non Secure en http, 30 jours), E2 (4 champs importés, 3 cases décochées, F-10), note F-11 qui apparaît et disparaît, erreurs par champ (`aria-invalid`, `aria-describedby`, focus, rien d'enregistré), « Continuer » (PATCH /me puis PUT /me/consent en CORS avec cookie) vers E1, rechargement, retour sur E2 avec les valeurs enregistrées, déconnexion vers E0 (`?deconnecte=1`, cookie effacé), E1 et E2 sans session renvoient vers E0, lien consommé non rejouable. Poids de l'îlot d'E2 : au plus 80 Ko compressés, mesuré sur les réponses (environ 64 Ko) | F-01 à F-04, F-10 à F-12, I-22, NF-04, NF-20 | 1 |
| `e2e/espace-securite.spec.ts` | En-têtes de NF-07 lus sur les réponses du front construit (E0, E0 envoyé, vérification, la redirection de E1 sans session, 404 de l'espace) : CSP dont la seule origine nommée est celle de Strapi, sans joker ni Google ni Matomo, `nosniff`, `Referrer-Policy` (`strict-origin` sur la vérification, `strict-origin-when-cross-origin` ailleurs, jamais `no-referrer`), `Cache-Control: private, no-store`. Aucun de ces en-têtes sur `/`, `/editions`, une édition, `/contact`, `/a-propos` et une 404 publique. `noindex` et uniquement des requêtes vers le front et Strapi, aucune vers Google ni Matomo ; polices servies par `/fonts/`. Sitemap sans `/espace` | NF-07, A-24, NF-23, NF-20, Q-14 | 18 |
| `e2e/smoke.spec.ts` | (phase 0) API de santé, absence de route CRUD, pages publiques avec l'édition de recette | B4, A-02, C3 | 10 |

**Captures du designer.** `capture(page, nom)` (`e2e/espace.ts`) ne fait rien sans `E2E_CAPTURES_DIR` ; avec, elle écrit `<nom>-390.png` et `<nom>-1280.png` (page entière). Noms : `E0-initial`, `E0-envoye`, `E0-429`, `E0-adresse-invalide`, `E0-deconnecte`, `verification-valable`, `verification-lien-invalide`, `E2-initial`, `E2-note-F11`, `E2-erreurs`, `E1-provisoire`. Elles se prennent pendant les tests, donc sur un état réel, en une exécution ; le dossier de sortie est hors du dépôt.

## Porte de la phase 1 (section 7 du plan) : état au 30 octobre

| Condition | État | Preuve |
|---|---|---|
| T-01 à T-06 | **remplie** | intégration (`espace-acces`, `espace-sync`, `espace-admin`) et e2e pour T-01 à T-04 ; aucun `todo` |
| Import idempotent sur le faux HelloAsso (scénario de la section 7) | **remplie** | `integration/espace-admin.test.js`, test de la porte : 2 pages, jeton renouvelé, 2 SyncRun clos, aucun doublon, aucun `welcome` de plus (EmailLog et boîte de sortie), T-06, 409 sur deux synchronisations simultanées |
| Import sur le bac à sable HelloAsso | **non remplie, en attente** : le compte et le formulaire de Q-03 n'existent pas | à passer à la main, hors CI, quand Mathieu les aura créés ; `no-network.js` sera à ouvrir à ce seul hôte sur demande explicite |
| NF-01 sur `/me` | **remplie** | `integration/espace-acces.test.js`, groupe « NF-01 sur /me » (A, B, C), sessions invalides, cloisonnement, minimisation |
| Non-régression visuelle | **remplie** | `test:visual` : 4 sur 4 le 30/10 |
| Intégration continue | remplie au dernier push, **à refaire** pour les nouveaux e2e | exécution GitHub verte sur `212e439` (relevée par `gh run list`) ; les 31 e2e du lot 7 n'ont pas encore tourné en CI |
| Revue du designer | **en attente** | captures remises dans le rapport du lot 7, hors dépôt |
| Contrôle axe (facultatif) | **reporté en phase 3** | `@axe-core/playwright` n'est pas installé et aucune installation n'était permise ; autorisé par la section 8 du plan |
| Compte rendu `phase-1.md` | à l'architecte | |

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
| Harnais de la phase 1 | `buildTestEnv` pose `PUBLIC_URL`, `CORS_ORIGINS` (`http://localhost:4321`), `ORGANIZER_EMAILS` (`organisation@example.org`), `IS_PROXIED=true` (chaque requête de test choisit son IP par `X-Forwarded-For`) et vide `HELLOASSO_*` même si l'environnement du poste en porte ; une surcharge peut viser le faux HelloAsso | `unit/harness.test.js` |
| Configuration de l'espace | `config/server.js` garde la section e-mail et la coupure de la notification de mise à jour ; `.env.example` et les fichiers de déploiement ne contiennent aucun secret réel | `unit/config-espace.test.js` |
| Bases configurables (lot 1, phase 1) | `testDatabaseName` et `e2eDatabaseName` : défauts, variable posée, lecture de `process.env`, refus (`strapi`, `strapi_espace`, sans suffixe, mauvais suffixe, majuscules, injection, plus de 63 caractères) avec le nom de la variable dans le message ; `buildTestEnv` et `startStrapi` suivent `TEST_DATABASE` et refusent une base interdite avant toute connexion ; boîte d'e-mails distincte par base | `unit/harness.test.js` |
| Bases configurables sur Postgres | `ensureDatabase` crée la base manquante, supporte six créations simultanées de la même base ; `resetDatabase` ne vide que sa base ; `prepare-databases.js` crée les deux bases nommées par les variables, est répétable, ne vide rien, refuse chacune des 8 valeurs interdites sans rien créer (la base valide de l'autre variable non plus) ; bases temporaires `jib_tmp_<pid>_…` supprimées à la fin | `integration/databases.test.js` |
| B3 (seed) | sur `strapi_test` vide : édition publiée avec ses réglages, 9 séquences ordonnées, 3 pauses B2B, 4 organisations, 2 intervenants liés, résumé ; second passage : même état, mêmes comptes, données étrangères conservées ; aucun tag, aucun fichier | `integration/seed.test.js` |
| 4.4 point 6, I-12, Q-15 | synchronisation d'une base seedée : 0, 0, 0, aucune erreur, aucun e-mail de plus | `integration/espace-seed-sync.test.js` |
| B4 | `GET /api/espace/health` 200 `{"status":"ok"}` sans authentification, HEAD 200, POST/PUT/PATCH/DELETE 405 | `integration/api.test.js`, `e2e/smoke.spec.ts` |
| A-02 | toute route sous `/api/espace` figure dans la table de la section 4.2 du plan de la phase 1 (12 routes, noms de paramètres libres), aucune en double, aucune route CRUD, aucune route de l'API `espace` hors du préfixe ; `GET /health` toujours présente ; aucune route rattachée à un type `api::espace.*` ; GET de chemins CRUD en 404, écritures (avec un `Origin` admis) en 404 ou 405. Vrai à chaque lot : une route de plus doit être ajoutée à la liste du test, donc au plan | `integration/api.test.js`, `e2e/smoke.spec.ts` (voir limites) |
| B4 (DEMO_SEED) | avec `DEMO_SEED=false` : base vide, aucune édition, aucun tag, aucune image ; sans la variable : éditions de démonstration créées comme avant (téléversement simulé, aucun fichier écrit dans `public/uploads`) | `integration/api.test.js`, `integration/bootstrap-demo.test.js` |
| Routes du site | `contact/send`, `newsletter/subscribe`, `captcha/challenge` toujours déclarées ; lecture publique des éditions, intervenants, organisations, séquences, tags en 200 ; contact et newsletter ne reçoivent jamais `ORIGIN_REFUSED` (NF-04 ne vaut que sous `/api/espace`) | `integration/api.test.js` |
| C3 | accueil rendu avec l'édition de recette, liste des éditions, page d'édition (9 titres de programme dont 2 « Pause et B2B », lieu, intervenants), fiches intervenant et organisation, 404 d'une page inconnue, redirection vers 404 d'une édition inconnue ; aucune exception JavaScript ; aucune requête hors localhost hors polices Google | `e2e/smoke.spec.ts`, `e2e/fixtures.ts` |
| NF-40, porte de phase 0 | non-régression visuelle de `/` et `/editions/nouvelle-aquitaine` à 390 et 1280 px (4 références macOS, tolérance 0,01 %) | `web/tests/visual/public-pages.spec.ts` (lot A) |
| Conventions | aucun tiret cadratin (U+2014 ni entité) dans les fichiers de l'espace, des tests, du workflow et de `docs/espace`, et, dès leur création, dans les dossiers de la phase 1 : `strapi/config/{middlewares,cron-tasks}.js` et, côté web, `EspaceLayout.astro`, `espace.css`, `components/espace`, `pages/espace`, `react-components/espace`, `lib/espace`, `middleware.ts`. Jamais les pages publiques ni les contenus saisis | `unit/conventions.test.js` |
| T-01, T-02, F-01, F-02, I-20 | demande de lien : même réponse pour une adresse inscrite, inconnue, annulée ou d'une édition fermée ; e-mail `access-link` seulement pour un inscrit actif ; réponse qui n'attend pas l'envoi (A-19) ; formulaire sans JavaScript en 303 absolue | `integration/espace-acces.test.js` |
| T-04, NF-03 | limitation de débit de la demande de lien : 6e demande en 15 minutes refusée en 429 `RATE_LIMITED`, par adresse normalisée et par IP (dernière entrée de `X-Forwarded-For`), adresses inconnues comptées, aucun e-mail pour la demande refusée | `integration/espace-acces.test.js`, `unit/rate-limit.test.js` |
| T-03, I-20, I-21, NF-02 | vérification : jeton à usage unique, haché en base, expiré, inconnu ; session ouverte ; `redirect` filtré par `safeNextPath` | `integration/espace-acces.test.js`, `unit/tokens.test.js`, `unit/session.test.js` |
| A-18 | `GET /auth/link` sans consommer le jeton : valide, expiré ou utilisé avec adresse préremplie, inconnu ; pour un inscrit annulé ou une édition fermée : `{ valid: false, editionSlug }` sans adresse | `integration/espace-acces.test.js` |
| I-22, NF-04 | cookie `jib_espace` : attributs, signature, glissement journalier, déconnexion ; `Secure` quand `PUBLIC_URL` est en https | `integration/espace-acces.test.js`, `unit/session.test.js` |
| A-25 | rendu serveur en http interne (sans `X-Forwarded-Proto`) : ni `Set-Cookie`, ni 500 ; glissement différé à l'appel suivant du navigateur ; avec `X-Forwarded-Proto: https`, cookie `Secure` et échéance repoussée | `integration/espace-acces.test.js` |
| I-23, A-26 | organisateurs par `ORGANIZER_EMAILS` ; routes `admin` refusées aux participants et aux autres éditions | `integration/espace-acces.test.js`, `integration/espace-admin.test.js` |
| NF-01, R-42 | `/me` : profil tiré de la session, jamais du corps ; accès croisés entre A, B (même édition) et C (autre édition) ; aucun e-mail ni identifiant HelloAsso en sortie | `integration/espace-acces.test.js` |
| NF-52 | édition fermée (`participantSpaceEnabled` faux) : lecture seule, aucun envoi ; l'annulation d'un inscrit annule ses rendez-vous sans `meeting-cancelled` ni lien | `integration/espace-acces.test.js`, `integration/espace-sync.test.js` |
| A-21 | `tokens.purgeExpired({ now, graceDays = 7 })` ; la tâche `espaceTokenPurge` n'appelle que ce service | `integration/espace-socle.test.js`, `unit/config-espace.test.js` |
| A-22 | rachat d'un billet par un Attendee annulé : règles de `planSync` et parcours complet par le service | `unit/import.test.js`, `integration/espace-sync.test.js` |
| A-23 | `normalizeEmail` unique, 254 caractères au plus ; 255 caractères : 400 `EMAIL_INVALID` à `request-link`, non retenue par `mapItem` ; rôle et e-mail jamais resynchronisés, champs jamais vidés | `unit/import.test.js`, `integration/espace-acces.test.js` |
| A-24, NF-07 | `Referrer-Policy: strict-origin` sur `/espace/verifier`, `strict-origin-when-cross-origin` ailleurs sous `/espace`, jamais `no-referrer` ; CSP sans origine tierce | `unit/web-middleware.test.js` |
| I-10, I-11 (délai) | `timeoutMs` (défaut 20 s) sur chaque requête HelloAsso, jeton compris ; dépassement : `HelloAssoError` sans `status`, SyncRun clos en `FETCH_FAILED`, synchronisation suivante non bloquée | `unit/helloasso-client.test.js`, `integration/espace-sync.test.js` |
| T-01 à T-04 (navigateur) | demande depuis E0, états « Lien envoyé » et « Trop de demandes », e-mail lu dans la boîte de sortie, lien réutilisé avec adresse préremplie, aucun e-mail pour une adresse inconnue ou annulée, 6e demande refusée | `e2e/espace-acces.spec.ts` |
| F-10 à F-12, I-22 | E2 : valeurs importées, cases décochées, note F-11, erreurs par champ, enregistrement du profil et du consentement par l'îlot (CORS avec cookie), cookie de session | `e2e/espace-parcours.spec.ts` |
| NF-07, A-24 (navigateur) | en-têtes sur les réponses du front construit ; absence sur les pages publiques ; `Referer` réduit à l'origine et POST du formulaire de vérification accepté sous `strict-origin` | `e2e/espace-securite.spec.ts`, `e2e/espace-acces.spec.ts` |
| NF-23, NF-20, Q-14 | aucune requête sortante sous `/espace` (polices Google comprises), 0 JavaScript sur E0 et la vérification, îlot d'E2 sous 80 Ko compressés, polices servies par le site | `e2e/espace-securite.spec.ts`, `e2e/espace-acces.spec.ts`, `e2e/espace-parcours.spec.ts` |
| NF-31 | E0 et vérification sans JavaScript : de la demande à la déconnexion | `e2e/espace-acces.spec.ts` |
| Sitemap | `/espace` absent du sitemap, pages publiques présentes | `e2e/espace-securite.spec.ts` |

## Défauts

Un défaut constaté mais non corrigé se consigne par un test marqué `todo` (il s'exécute et s'affiche sans faire échouer la suite) avec sa reproduction ; le tester retire `todo` dès la correction. Côté Playwright, l'équivalent est `test.fail(true, …)` : le test s'exécute, compte comme passé tant que le défaut existe, et échoue dès que le défaut est corrigé, ce qui rappelle de retirer la ligne. **Aucun `todo` dans la suite Strapi ; un défaut ouvert, D3 (basse), consigné côté e2e.**

| Id | Défaut (ouvert) | Test | Décision attendue |
|---|---|---|---|
| D3 | sans JavaScript, « Continuer » d'E2 envoie le formulaire de l'îlot, rendu côté serveur sans `action` ni `method`, en GET sur la même page : prénom, nom, fonction et entreprise passent dans l'URL, que Traefik journalise. Reproduction : JavaScript coupé, session ouverte, `/espace/<édition>/bienvenue`, clic sur « Continuer » : l'URL devient `…/bienvenue?firstName=…&lastName=…&company=…`. NF-31 ne couvre que E0 et E8, et la spec du designer prévoit un `<noscript>` : écart de minimisation à trancher par l'architecte (pistes : `client:only` pour que le formulaire n'existe pas sans JavaScript, ou le masquer par CSS quand `<noscript>` s'affiche) | `e2e/espace-acces.spec.ts`, « D3 : … » (`test.fail`) | architecte, puis `test.fail` à retirer |


Défauts corrigés (D1 et D2, phase 0) :

| Id | Défaut | Test | Corrigé |
|---|---|---|---|
| D1 | `buildEdgeCaseItems()` ne produisait aucun paiement `Refunded` (`payments` transmis à `buildItem()`, qui attend `paymentState`) | `unit/fake-helloasso.test.js`, « contient un billet actif dont le paiement est Refunded » | commit `37b1327` ; `todo` retiré au lot 1 de la phase 1 |
| D2 | `createStrapi()` (seed, `develop`, `start`) interrogeait le registre npm une fois par jour et réécrivait `strapi/.strapi-updater.json`, fichier suivi par git | `integration/api.test.js`, « coupe la notification de mise à jour de Strapi » | commit `37b1327` (`logger: { updates: { enabled: false } }`) ; `todo` retiré au lot 1 de la phase 1 |

Défauts de la revue de l'architecte (section 11 du plan), corrigés au lot 6b (commits `720f778`, `628ca59`, `89b90f8`). Chacun a un test actif qui échoue sans la correction.

| # | Défaut | Tests | Corrigé |
|---|---|---|---|
| 1 | cookie `Secure` posé sur l'appel http interne du rendu serveur (500 sur dev et prod), A-25 | `integration/espace-acces.test.js`, groupe « A-25 » | `720f778` |
| 2 | purge des jetons sans délai de grâce, qui fait perdre l'état « expiré » de A-18 ; logique dans le cron, A-21 | `integration/espace-socle.test.js`, `unit/config-espace.test.js` | `628ca59` |
| 3 | Attendee annulé qui rachète un billet : `DUPLICATE_EMAIL` sans fin, A-22 | `unit/import.test.js`, `integration/espace-sync.test.js` | `720f778` |
| 4 | `Referer` complet, jeton compris, envoyé par `/espace/verifier`, A-24 | `unit/web-middleware.test.js` | `89b90f8` |
| 5 | `normalizeEmail` en double, règles divergentes, A-23 | `unit/import.test.js`, `integration/espace-acces.test.js` | `720f778` |
| 6 | `meeting-cancelled` envoyé pour une édition fermée, NF-52 | `integration/espace-sync.test.js`, groupe « édition fermée » | `628ca59` |
| 7 | `GET /auth/link` renvoie l'adresse d'un inscrit annulé ou d'une édition fermée, A-18 | `integration/espace-acces.test.js` | `720f778` |
| 8 | `fetch` HelloAsso sans délai : synchronisation bloquée, `welcome` en double possible | `unit/helloasso-client.test.js`, `integration/espace-sync.test.js` | `628ca59` |

## Limites et dette

- Le projet `visual` reste local : références propres à macOS, données de `strapi_espace` absentes en CI. Il dépend des polices Google (Q-14).
- Les anciens ports e2e (1338, 4322) sont occupés sur le poste de Mathieu par le serveur de développement de BoisDesAlpes : les défauts sont 1348 et 4332 depuis le lot 1 de la phase 1. Le refus immédiat sur port occupé (« already used ») a été vérifié en phase 0.
- Le workflow `tests.yml` a tourné vert sur GitHub sur `212e439` (relevé par `gh run list` le 30 octobre, sans poser de variable : il garde les bases et ports par défaut). Il n'a pas encore exécuté les 31 tests e2e du lot 7, ajoutés après ce commit : à vérifier au prochain push autorisé.
- La garde du seed (`/_(e2e|test)$/`) admet `_test` et `x__test`, que `assertTestDatabase` des tests refuse : sans conséquence (ce sont des noms de bases de test), consigné pour mémoire. Le test d'ordre des étapes de `main()` lit encore le source de `seed.js` (`refuse`, `app.load()`, `await wipe(app)`) : un renommage dans le seed le casse sans que le comportement change.
- `web/.astro/types.d.ts` est réécrit par `astro build` (donc par `test:e2e`) : fichier suivi par git, à restaurer avant tout commit. Même règle pour `strapi/types/generated/*` si un démarrage de Strapi le réécrit.
- `integration/seed.test.js` redémarre Strapi trois fois sur la base de test (environ 15 s) : le prix de la preuve d'idempotence avec données étrangères.
- Les événements `entry.create` et `entry.publish` de Strapi sont émis sans être attendus : `stopStrapi` patiente 750 ms avant de détruire la connexion (`helpers/strapi.js`), sinon le processus reste 60 s sur un délai d'acquisition de connexion.
- Pas de couverture de branches mesurée (`node --test --experimental-test-coverage` est disponible pour la porte de la phase 2).
- Les tests d'intégration qui coupent la base (`app.db.connection.client.acquireConnection`) ou le journal (`app.log.*`) le font le temps d'un appel et rétablissent l'original dans un `finally`. Ceux de la boîte de sortie bloquée (tube nommé, `mkfifo`) ou impossible (dossier à la place du fichier) rétablissent aussi le fichier : ils supposent un poste Unix.
- Les preuves de délai de HelloAsso (`espace-sync.test.js`) interrogent un serveur local muet et ramènent `AbortSignal.timeout` à 150 ou 200 ms le temps d'une synchronisation (rétabli aussitôt) : la valeur par défaut de 20 s n'est vérifiée que par le client (`unit/helloasso-client.test.js`). Elles ont leur propre délai d'expiration (30 s par test) et ne dépendent d'aucun hôte distant.
- Aucun test de temps de réponse : la propriété de F-02 (une adresse connue et une adresse inconnue ne se distinguent pas au temps de réponse) se vérifie par un envoi bloqué qui ne retarde pas la réponse (A-19), pas par une mesure.
- NF-02 (comparaison de jeton en temps constant) n'est pas testable de l'extérieur : seuls le hachage, l'usage unique et le refus de l'empreinte comme jeton sont vérifiés.
- Le test de la porte (`integration/espace-admin.test.js`) tient en un seul test long (environ 7 s) parce que ses trois synchronisations dépendent l'une de l'autre ; le bac à sable HelloAsso reste à faire à la main, hors CI (plan de la phase 1, section 7).
- **Lot 7, ce qui n'est pas fait** : (1) contrôle axe (`@axe-core/playwright`, facultatif) : reporté en phase 3, la dépendance n'est pas installée ; (2) bac à sable HelloAsso : condition de la porte non remplie, aucun compte (voir la table de la porte) ; (3) lien **expiré** dans le navigateur : la durée de 30 minutes ne se teste pas en e2e sans horloge ni accès SQL, seul le lien déjà utilisé est joué ; l'expiration reste prouvée en intégration (`espace-acces.test.js`, A-18) ; (4) la revue du designer attend ses captures.
- **E2 sans JavaScript** : voir le défaut D3 (« Défauts »). Reproduit dans un navigateur au lot 7 : l'URL devient `…/bienvenue?firstName=Nathan&lastName=Lasserre&jobTitle=…&company=…&directoryOptIn=on…`.
- Les tests e2e de l'espace partagent une base non remise à zéro entre eux : ils ne rejouent pas deux fois le même inscrit après consommation de son lien, et ne se relancent pas en désordre sur la même base (`test:e2e` vide la base à chaque exécution). Le fichier de boîte de sortie se lit en dehors de Strapi : `e2e/espace.ts` recalcule son chemin par `buildTestEnv`, et `e2e-server.js` le supprime au démarrage.
- Playwright coupe JavaScript par l'émulation du protocole : Chromium n'affiche alors pas le contenu de `<noscript>`. Le test lit donc le HTML servi pour ce message, et prouve que l'îlot ne s'hydrate pas par la note F-11 qui n'apparaît pas.
