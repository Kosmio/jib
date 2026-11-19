# Phase 0 : plan d'exécution et décisions d'architecture

Rédigé par l'architecte le 29 octobre 2026, pour la phase 0 des 2 et 3 novembre. Les décisions A-xx valent pour tout le projet. Les specs `02`, `05`, `06`, `11` et `docs/espace/CLAUDE.md` ont été mis à jour dans le même commit.

## 1. Cartographie du dépôt

| Sujet | Constat |
|---|---|
| Versions | Strapi 5.59.0, Astro 6.0.7 (`@astrojs/node` 10.0.4 `standalone`, `output: "server"`), React 19.2.4 (`@astrojs/react` 5.0.1), Tailwind 4.2.2, `@getbrevo/brevo` 5.0.1, PostgreSQL 17 (`postgres:17-alpine`), Node 24 (local 24.22.1, images `node:24-alpine`), pnpm 12.15.0 par corepack |
| Îlots | React par `@astrojs/react`. Un seul îlot aujourd'hui : `web/src/react-components/ContactForm.tsx` (Altcha), hydraté `client:visible` |
| Appels API existants | `web/src/lib/strapi.ts` : `fetch(STRAPI_URL/api/…)` côté serveur, sans jeton (permissions publiques `find` et `findOne`) ; `REACT_STRAPI_URL` côté navigateur |
| Pages publiques | `/`, `/editions`, `/editions/[slug]`, `/intervenants/[slug]`, `/organisations/[slug]`, `/partenaires`, `/pourquoi`, `/a-propos`, `/contact`, `/confidentialite`, `/mentions-legales`, 404. Layout unique `Layout.astro` : Header, Footer, Matomo, bandeau cookies, Google Fonts |
| Types de contenu | `edition`, `sequence`, `intervention`, `intervenant`, `organisation`, `partenaire` (brouillon et publication), `tag`, `home-page` (type unique), `static-page` ; routes personnalisées `contact`, `newsletter`, `captcha`. Correspondance avec la spec : `02-modele-donnees.md` |
| Bootstrap | `strapi/src/index.js` (environ 1 500 lignes) : locale `fr`, permissions publiques, libellés français, migrations de données idempotentes, éditions de démonstration si la base est vide, restauration de médias si `RESTORE_MISSING_MEDIA=true` |
| Déploiement | Dépôt `Kosmio/jib`. `dev.yml` construit et pousse les images GHCR `jib-strapi`, `jib-web` et `jib-mcp`, étiquetées par `VERSION`, sur push de `main` ou d'une étiquette. `deploy.yml` (manuel, SSH) déploie en dev ou en prod. Traefik v3 : web sur `/`, Strapi sur `/strapi`, MCP sur `/mcp`. Dev : `dev.journees-innovation-bois.xylofutur.fr` |
| Base | Postgres 17. En local, conteneur `jib-postgres` : `strapi` (référence) et `strapi_espace` (dev), 14 Mo chacune. Sur les serveurs, base `strapi` dans `~/jib/data/postgres` |
| Tests | Aucun : `make test` affiche « No Test », aucun script de test, aucun workflow de test |
| E-mail | Brevo appelé directement par `contact.js` et `newsletter.js` (gabarits Brevo). Le plugin e-mail de Strapi est resté sur sendmail |

## 2. Décisions d'architecture

### A-01. Back de l'espace : une API Strapi `espace`

Tout le back de l'espace vit dans `strapi/src/api/espace/` :

- `content-types/<nom>/schema.json` : types nouveaux, UID `api::espace.<nom>` (`02-modele-donnees.md`) ;
- `routes/espace.js` : toutes les routes de `06-api.md`, déclarées `/espace/…`, servies sous `/api/espace/…` ;
- `controllers/<domaine>.js` : minces (valider, appeler un service, répondre) ;
- `services/<domaine>.js` : accès base, transactions ;
- `middlewares/context.js` : middleware de route commun (A-02) ;
- `lib/` : logique pure sans Strapi (calculs des règles R-xx, dates, jetons, fournisseurs d'e-mail), requise explicitement, testable en unitaire sans démarrer Strapi. Strapi ne charge pas ce dossier.

Pas de plugin Strapi, pas un dossier par type : un seul endroit pour l'espace.

### A-02. Routes CRUD désactivées par construction

Aucun `createCoreRouter` ni `createCoreController` pour les types `api::espace.*` : aucune route REST générée, aucune permission publique à gérer. Le back-office (Content Manager) reste disponible. Les routes personnalisées sont déclarées `config: { auth: false, middlewares: ['api::espace.context'] }`. Le middleware `context` :

1. attribue un identifiant de requête et convertit les erreurs au format `{ error: { code, message } }` de `06-api.md`, avec un journal structuré (NF-50) ;
2. contrôle l'en-tête `Origin` des écritures (A-05) ;
3. charge la session si le cookie est présent (`ctx.state.espace = { attendee, edition }`).

Les contrôleurs appellent `requireSession(ctx)` ou `requireOrganizer(ctx)` ; les services vérifient l'appartenance de chaque objet à l'édition de la session (NF-01). Les types existants gardent leurs routes et leurs permissions. Vérification : `strapi routes:list` ne montre aucune nouvelle route hors de `/api/espace/…`.

### A-03. Modèle

Règles détaillées dans `02-modele-donnees.md` : types nouveaux sans brouillon ni publication ; relations vers l'existant unidirectionnelles, portées par le type nouveau ; filtrage par `documentId` et lecture `status: 'published'` ; champs ajoutés à `edition` en `private: true` ; `sequence.kind` et `sequence.topic` publics, reportés dans `strapi/mcp/content-types.json` ; aucune relation existante modifiée ; types de l'espace hors du MCP. À couvrir par un test d'intégration en phase 1 : republier une édition ne détache ni Attendee ni Slot.

### A-04. Lien magique et session (I-20 à I-23)

- **Jeton** : 32 octets aléatoires (`crypto.randomBytes`), encodés en base64url. Seule l'empreinte SHA-256 est stockée (`MagicToken.tokenHash`) ; la vérification cherche l'empreinte, le jeton en clair n'est jamais comparé (NF-02).
- **Lien** : `{PUBLIC_URL}/espace/verifier?token=…&next=/espace/…`. La page Astro affiche un bouton « Ouvrir mon espace » (hypothèse Q-13) : un formulaire POST vers `{REACT_STRAPI_URL}/api/espace/auth/verify`. Strapi marque le jeton utilisé, crée un MagicToken `session`, pose le cookie et répond 303 vers `next` (limité aux chemins `/espace/`), vers E2 si aucun consentement n'a été donné, sinon vers E1. Jeton expiré ou utilisé : 303 vers la page de lien invalide (F-04).
- **Cookie** `jib_espace` : posé par Strapi (`ctx.cookies.set`, `signed: true` avec les clés `APP_KEYS`), `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` quand `PUBLIC_URL` est en https, durée 30 jours. L'échéance est prolongée au plus une fois par jour, pour ne pas écrire en base à chaque requête. Déconnexion : suppression du MagicToken `session` et du cookie.
- **Pas de proxy Astro** (choix demandé par I-22) : en dev serveur et en prod, Traefik sert le site et Strapi sur le même domaine (Q-11). En local, `localhost:4321` et `localhost:1337` partagent les cookies (un cookie ne dépend pas du port) et sont du même site au sens de `SameSite`. Aucun code de proxy.
- **Organisateurs** (I-23) : si un e-mail de `ORGANIZER_EMAILS` demande un lien sans être inscrit à l'édition, l'espace crée un Attendee `role = organizer`, sans consentement donc invisible, puis suit le même parcours.
- **Limitation de débit** de la demande de lien (NF-03, T-04) : compteur en mémoire par e-mail et par IP sur 15 minutes. Un e-mail inconnu reçoit la même réponse 202 et la même limite 429 (F-02, pas d'énumération). L'hypothèse d'une instance Strapi unique est assumée. L'IP réelle impose `proxy: { koa: env.bool('IS_PROXIED', false), maxIpsCount: 1 }` dans `config/server.js`. Les autres limites (R-11.9, R-64) se comptent en base.
- **Plusieurs éditions** : une session correspond à un Attendee, donc à une édition ; passer à une autre édition demande un nouveau lien.

### A-05. CSRF et CORS (NF-04)

Toute requête autre que GET et HEAD sur `/api/espace` doit porter un `Origin` présent dans `CORS_ORIGINS`, sinon 403 `ORIGIN_REFUSED`. Ce contrôle couvre les îlots et les formulaires HTML sans JavaScript, qui ne peuvent pas ajouter d'en-tête personnalisé. `strapi::cors` est restreint à `CORS_ORIGINS` (`credentials: true`) : par défaut, Strapi renvoie l'origine de n'importe quel site avec `credentials`, ce qui laisserait un sous-domaine lire `/me`. Le site public appelle Strapi depuis la même origine en dev serveur et en prod : il n'est pas affecté. `SameSite=Lax` reste une seconde barrière.

### A-06. Appels du front vers l'API

| Contexte | Mécanisme | Base |
|---|---|---|
| Rendu serveur (frontmatter Astro) | `web/src/lib/espace/api.ts` : `fetch(STRAPI_URL + '/api/espace' + path, { headers: { cookie } })` avec l'en-tête `Cookie` reçu. 401 : redirection vers `/espace/{edition}/connexion` ; 404 : page 404 | `STRAPI_URL` (interne) |
| Îlots React | `web/src/lib/espace/client.ts` : JSON, `credentials: 'include'`, base reçue en prop ; le message d'erreur de l'API est affiché tel quel | `REACT_STRAPI_URL` |
| Formulaires sans JavaScript (E0, vérification, déconnexion) | `<form method="post" action="{REACT_STRAPI_URL}/api/espace/auth/…">` ; Strapi répond 303 | `REACT_STRAPI_URL` |

Le front ne recalcule aucune règle (booléens `can*`, état des créneaux). Les pages passent leurs données initiales aux îlots en props ; seuls les îlots qui doivent se rafraîchir interrogent l'API (messagerie, F-71, interrogation suspendue onglet masqué, NF-23).

### A-07. Concurrence des rendez-vous (R-11, R-13, préparation de la phase 2)

Création et acceptation dans `strapi.db.transaction`, sous `pg_advisory_xact_lock` sur le créneau (et sur le demandeur pour R-11.7). La plus petite table libre est calculée sous ce verrou. L'index unique sur `meetings.table_key` (`02-modele-donnees.md`), créé au bootstrap par `CREATE UNIQUE INDEX IF NOT EXISTS`, garantit l'absence de collision même en cas d'erreur de code. Preuve attendue : T-17.

### A-08. Tâches planifiées

`strapi/config/cron-tasks.js`, branché par `cron: { enabled: env.bool('CRON_ENABLED', false), tasks }` dans `config/server.js`. `CRON_ENABLED=true` uniquement dans les overlays dev et prod ; désactivé en local et en test. Chaque tâche se réduit à l'appel d'un service idempotent, que les routes organisateur et les tests appellent aussi ; aucune logique dans le cron. Règles avec `tz: 'Europe/Paris'` :

| Tâche | Règle | Spec |
|---|---|---|
| Synchronisation HelloAsso | `*/15 * * * *`, sous `pg_try_advisory_lock` par édition (cron et bouton F-90 simultanés) | I-12 |
| Expiration des demandes | `*/5 * * * *` | R-17 |
| Notifications de messages | `*/5 * * * *` | R-62 |
| Relances | `30 9 * * *` et `0 16 * * *` ; la fenêtre 20h00 à 8h00 est vérifiée dans le service | R-70, R-72 |
| Purge des jetons expirés | `0 4 * * *` | I-20 |

Une tâche en erreur journalise et rend la main ; elle ne fait jamais tomber Strapi.

### A-09. Dates : stockage UTC, affichage Europe/Paris

- Tous les `datetime` sont en UTC (timestamptz) ; l'API renvoie de l'ISO 8601 UTC.
- Les horaires texte du programme (« 9h15 », « 10h45 », « -- ») sont analysés et combinés à `Edition.date` en Europe/Paris par `strapi/src/api/espace/lib/time.js`, avec `Intl` et sans bibliothèque. Les cas de changement d'heure sont couverts par les tests unitaires.
- Le serveur calcule les libellés (`Slot.label`, heures des e-mails, compte à rebours en jours calendaires de Paris). Le front formate le reste avec `Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris' })` dans `web/src/lib/espace/format.ts`. Le fuseau est toujours passé explicitement, jamais celui de la machine.
- Les tests tournent sous `TZ=UTC` pour révéler toute dépendance au fuseau local.

### A-10. Code front

```
web/src/
  pages/espace/
    verifier.astro                      E0 (vérification du lien)
    [edition]/index.astro               E1
    [edition]/connexion.astro           E0
    [edition]/bienvenue.astro           E2
    [edition]/profil.astro              E3
    [edition]/annuaire/index.astro      E4
    [edition]/annuaire/[type]/[id].astro E5
    [edition]/agenda.astro              E6
    [edition]/messages/index.astro      E7 (liste)
    [edition]/messages/[id].astro       E7 (fil)
    [edition]/programme.astro           E8
    [edition]/organisateur.astro        E9
  layouts/EspaceLayout.astro            AppShell ; importe app.css ; sans Header, Footer, Matomo ni bandeau cookies ; noindex
  components/espace/*.astro             composants statiques de 07
  react-components/espace/*.tsx         îlots
  lib/espace/{api,client,format}.ts     A-06, A-09
  middleware.ts                         en-têtes NF-07 sur /espace uniquement, retour immédiat ailleurs
web/public/espace/                      manifest, icônes, service worker de portée /espace/ (phase 3)
```

`astro.config.mjs` : filtre du sitemap excluant `/espace/`. Aucune page publique n'est modifiée en phase 0.

### A-11. E-mails

- Fournisseur (I-30) : `strapi/src/api/espace/lib/mail/`, `send({ to, subject, html, text, attachments, headers })` → `{ messageId }`. `ConsoleMailProvider` écrit chaque message (pièces jointes comprises, en base64) sur une ligne JSON de `EMAIL_OUTBOX_FILE` et journalise destinataire, sujet et liens : c'est la boîte que lisent les tests. `BrevoMailProvider` réutilise le client `BrevoClient` et la clé `EMAIL_API_KEY` du site (`server.email.apiKey`).
- Choix (NF-53) : `EMAIL_PROVIDER` s'il est fixé, sinon `brevo` si `NODE_ENV=production`, sinon `console`. `brevo` est refusé quand `NODE_ENV=test`. Comme les serveurs dev et prod tournent en `NODE_ENV=production`, le dev serveur enverra de vrais e-mails : à régler avant la recette (Q-16).
- Phase 1 : service `mailer` = rendu du gabarit, envoi, écriture d'EmailLog. Ne jamais utiliser `strapi.plugin('email')`, resté sur sendmail.

### A-12. Faux HelloAsso

Serveur Node sans dépendance (`node:http`), `strapi/scripts/espace/fake-helloasso.js`, utilisable en ligne de commande (port 4010) et comme module (port libre, pour les tests). Il reproduit l'API v5 au plus près pour que le vrai bac à sable se branche par variables d'environnement seulement :

| Point d'accès | Comportement |
|---|---|
| `POST /oauth2/token` | formulaire `grant_type=client_credentials` (`client_id` et `client_secret` non vides) ou `refresh_token` → `{ access_token, token_type: "bearer", expires_in, refresh_token }` ; durée réglable pour tester le renouvellement (I-10) |
| `GET /v5/organizations/{org}/forms/{formType}/{formSlug}/items` | jeton Bearer exigé (401 sinon ou s'il a expiré) ; 404 si formulaire inconnu ; `pageSize` (défaut 20, max 100) et `continuationToken` ; réponse `{ data: [...], pagination: { pageSize, totalCount, pageIndex, totalPages, continuationToken } }` ; après la dernière page, `data: []` ; `customFields` et `options` seulement avec `withDetails=true` |
| `GET /v5/orders/{orderId}` | commande et ses billets (I-13) |
| `POST /__fake/items`, `PATCH /__fake/items/{id}`, `GET /__fake/stats` | pilotage par les tests : remplacer le jeu, modifier un billet (annulation T-06), compter les appels (cache du jeton) |

Un billet suit le format v5 : `id`, `order` (`id`, `date`, `formSlug`, `formType`, `organizationSlug`), `payer` (`email`, `firstName`, `lastName`), `user` (`firstName`, `lastName`, le bénéficiaire), `name` (intitulé du tarif), `state`, `type: "Registration"`, `amount`, `payments` (`state`, dont `Refunded`), `customFields` (`id`, `name`, `type`, `answer`). Le formulaire reproduit le relevé Q-03 :

- tous les tarifs : Nom et Prénom (`user`), « Accès PMR » ;
- tarif « Journée Innovation Filière Bois en Nouvelle-Auitaine » seulement (coquille conservée) : « Organisation », « Type d'organisation », « Poste », « N° de téléphone », « Email », « Code Postal ».

Les champs non importés (téléphone, code postal, type d'organisation, PMR) sont présents dans le faux pour prouver qu'ils sont ignorés (NF-11). Toutes les adresses sont en `@example.org` (domaine réservé), tous les noms sont fictifs. Bascule vers le bac à sable : `HELLOASSO_API_BASE=https://api.helloasso-sandbox.com/v5` ; le jeton se demande toujours sur `{origine de HELLOASSO_API_BASE}/oauth2/token`.

### A-13. Bases, seed et jeux de données

| Base | Rôle | Règle |
|---|---|---|
| `strapi` | copie de référence | aucun accès, pas même un démarrage de Strapi (il synchroniserait le schéma) |
| `strapi_espace` | dev par défaut (`strapi/.env`), copie de prod avec données personnelles | jamais de seed ni d'export ; sert aux captures visuelles |
| `strapi_test` | intégration Strapi | vidée par la suite de tests |
| `strapi_e2e` | seed de recette, Playwright, essais manuels de l'espace | remplie par `seed` |

- Strapi charge `strapi/.env` de lui-même : tout script ou test fixe `DATABASE_NAME` dans son environnement avant le chargement. Le seed et la suite d'intégration refusent toute base dont le nom ne finit pas par `_test` ou `_e2e`, et refusent `NODE_ENV=production`.
- `DEMO_SEED=false` (ajouté au bootstrap en lot B) empêche la création des éditions de démonstration et le téléversement des images sur une base vide.
- Une seule commande `seed`. Elle démarre Strapi par programme, efface puis recrée les données de recette (repérées par l'édition `nouvelle-aquitaine-test` et le préfixe de slug `test-`), puis s'arrête ; deux exécutions donnent le même état. Chaque phase l'étend aux types qu'elle crée.
- Source unique des personnes fictives : `strapi/scripts/espace/fixtures/helloasso-items.json` (format HelloAsso, servi par le faux). `fixtures/recette.json` décrit l'édition, le programme, les sujets, les intervenants, les exposants et, par e-mail, les réglages de chaque personne (consentements, rôle, statut). À partir de la phase 1, le seed crée les Attendee en appliquant aux billets la correspondance de l'import (I-11), puis ces réglages.

### A-14. Cadre de test (choix fin laissé au tester)

- Strapi : base Postgres `strapi_test`, pas SQLite (T-17 a besoin des verrous et des transactions de Postgres). Démarrage par programme selon la doc Strapi 5 (`createStrapi().load()`), sans construire l'admin. Recommandation : `node:test` de Node 24 (aucune dépendance, couverture des branches pour la porte de phase 2) ; Jest et Supertest, comme dans la doc Strapi, seulement si `node:test` bloque.
- Environnement imposé par le harnais avant le chargement : `DATABASE_NAME=strapi_test`, `DEMO_SEED=false`, `EMAIL_PROVIDER=console`, `EMAIL_API_KEY` vide, `CRON_ENABLED=false`, `TZ=UTC`.
- Front : Playwright, Chromium seulement. Projet `e2e` sur `strapi_e2e` (Strapi sur 1338, web sur 4322, pour laisser tourner les serveurs de dev) ; projet `visual` local sur `strapi_espace` (1337 et 4321), exclu de la CI : il n'y a pas de données de prod en CI et les références sont propres à macOS.
- CI : workflow GitHub Actions de tests, sans secret ; il ne construit ni ne publie d'image et ne déploie rien.

## 3. Lots de la phase 0

Les lots s'enchaînent strictement : A, puis B, puis C. A fige l'aspect avant toute modification de code ; C teste le code livré par B. Dans les commandes, `<dépôt>` désigne le chemin absolu du dépôt ; forme des commandes et environnement : section « Commandes » de `docs/espace/CLAUDE.md`.

### Fichiers partagés : qui les modifie

| Fichier | Lot A (tester) | Lot B (developer) | Lot C (tester) |
|---|---|---|---|
| `web/package.json` | ajoute `@playwright/test` (devDependency) et le script `test:visual` | non | ajoute le script `test:e2e` |
| `web/pnpm-lock.yaml` | oui | non | seulement s'il ajoute une dépendance |
| `strapi/package.json` | non | ajoute les scripts `seed` et `helloasso:fake`, **aucune dépendance** | ajoute les scripts `test`, `test:unit`, `test:integration` et ses éventuelles devDependencies |
| `strapi/pnpm-lock.yaml` | non | **non** | seulement s'il ajoute une dépendance |
| `strapi/pnpm-workspace.yaml`, `web/pnpm-workspace.yaml` | si Playwright l'exige (`allowBuilds`) | non | si une dépendance l'exige |
| `web/playwright.config.ts` | crée (projet `visual`) | non | ajoute le projet `e2e` |
| `.gitignore` (racine) | ajoute `web/test-results/` et `web/playwright-report/` | non | complète si besoin |

Personne ne committe `web/.astro/`, `.claude/launch.json` ni `strapi/.strapi-updater.json` (modifiés localement, hors périmètre).

### Lot A (tester) : captures de référence, avant tout changement de code

Objectif : figer l'aspect actuel de `/` et de `/editions/nouvelle-aquitaine`. Exigences : porte de la phase 0 (`09-phases.md`), NF-40.

Fichiers dont le tester est propriétaire : `web/playwright.config.ts`, `web/tests/visual/public-pages.spec.ts` et ses références `web/tests/visual/public-pages.spec.ts-snapshots/*.png`, plus les fichiers partagés ci-dessus.

Consignes :
- Strapi sur `strapi_espace` (`strapi/.env` inchangé) sur le port 1337 ; front sur le port 4321, **construit** (`build` puis `preview`) plutôt que `dev`, dont la barre d'outils apparaît dans les captures.
- 4 références : 2 pages en 390 × 844 et 1280 × 800, page entière, Chromium. Animations désactivées, attente de `document.fonts.ready` (polices Google : capture dépendante du réseau, Q-14), masque de ce qui varie, tolérance écrite dans le test.
- `corepack pnpm@12.15.0 --dir <dépôt>/web exec playwright install chromium` (sans `--with-deps` sous macOS).

Critères d'acceptation :
1. Les 4 références sont committées et ont été prises sur le code du commit de ce plan : aucun fichier de `web/src`, `strapi/src` ni `strapi/config` n'a changé.
2. `test:visual` passe 3 fois de suite sans aucune modification (stabilité).
3. Les commandes exactes de lancement et de mise à jour des références sont transmises à l'architecte pour `docs/espace/CLAUDE.md`.
4. Aucune donnée de `strapi_espace` n'est exportée : seules des captures de pages publiques sont versionnées.

### Lot B (developer) : socle back

Exigences : I-30, NF-06, NF-53 (B1) ; I-10, I-11, I-13, I-14, Q-03, Q-15, NF-11 (B2) ; `10-recette.md`, Q-17 (B3) ; `06-api.md` `/health` (B4).

Fichiers dont le developer est propriétaire :
- `strapi/src/api/espace/routes/espace.js`, `strapi/src/api/espace/controllers/health.js`
- `strapi/src/api/espace/lib/mail/index.js`, `console.js`, `brevo.js`
- `strapi/scripts/espace/seed.js`, `fake-helloasso.js`, `fixtures/recette.json`, `fixtures/helloasso-items.json`
- `strapi/config/server.js` (section `email` seulement), `strapi/.env.example`
- `strapi/src/index.js` : **uniquement** la garde `DEMO_SEED` autour de `seedData`
- `strapi/package.json` : scripts `seed` et `helloasso:fake`

Interdits : `web/`, les lockfiles, `contact` et `newsletter`, les schémas existants, les fichiers de test.

**B1. Fournisseurs d'e-mail.** `createMailProvider({ provider, apiKey, from, outboxFile, nodeEnv, logger, client })` renvoie `{ name, send(message) }`. `message` : `{ to: string | { email, name }, subject, html, text, attachments?: [{ filename, content, contentType }], headers? }`. Choix, console et Brevo selon A-11 ; `client` est injectable pour tester Brevo sans réseau ; `from` accepte « Nom <adresse> » ou une adresse seule. `brevo` sans `apiKey` ou sans `from` lève une erreur dès la création, de même que `brevo` sous `NODE_ENV=test`. Configuration : `server.email.provider` (`EMAIL_PROVIDER`), `server.email.from` (`EMAIL_FROM`), `server.email.outboxFile` (`EMAIL_OUTBOX_FILE`, défaut `.tmp/mail-outbox.jsonl`, relatif à `strapi/`), à côté de `server.email.apiKey` existant ; les trois variables sont ajoutées à `.env.example` avec une valeur fictive. Aucun branchement à une route en phase 0.

**B2. Faux HelloAsso.** Selon A-12. Module : `startFakeHelloAsso({ port = 0, items, tokenTtlSeconds = 1800 })` → `{ origin, apiBase, close(), setItems(), updateItem(), stats() }`. En ligne de commande (`helloasso:fake`) : port `FAKE_HELLOASSO_PORT` ou 4010, jeu par défaut `fixtures/helloasso-items.json`, affichage des lignes `HELLOASSO_API_BASE=…`, `HELLOASSO_CLIENT_ID=…` et `HELLOASSO_CLIENT_SECRET=…` à utiliser. Le jeu par défaut couvre la population de recette (Q-17 : 17 billets, organisation `xylofutur-test`, formulaire `Event` / `jib-nouvelle-aquitaine-test`) : la majorité au tarif Nouvelle-Aquitaine avec ses 7 champs personnalisés ; quelques billets aux tarifs fictifs « Exposant » et « Intervenant », sans champ Email, donc à importer par `payer.email`, avec des payeurs distincts ; un billet `Canceled`. Les cas limites de l'import (commande groupée à e-mail commun, champ Email invalide, `Waiting`, paiement `Refunded`, e-mail en majuscules avec espaces, plus de 20 billets pour la pagination) sont produits par une fonction exportée du module, et non par le jeu de recette.

**B3. Seed.** Selon A-13. `corepack pnpm@12.15.0 --dir <dépôt>/strapi seed`, précédé de `DATABASE_NAME=strapi_e2e` (ou d'une base en `_test`). Phase 0, types existants seulement, tout publié : l'édition `nouvelle-aquitaine-test` (« Nouvelle-Aquitaine (test) », 2026, `nouvelle-aquitaine`, 3 décembre 2026, Bordeaux, `inscriptions-ouvertes`, `hero_bg_color` `#600e24`, un lieu fictif) ; 9 séquences, dont les pauses B2B 10h45 à 11h15, 12h30 à 14h00 et 15h30 à 16h00, et une séquence par sujet (Forêt et adaptation ; Process, data et IA ; Économie circulaire ; Territoires résilients ; Construction bois) ; 2 intervenants avec leurs interventions ; 4 organisations fictives (2 exposants, stands 4 et 12, et 2 structures d'intervenants). `recette.json` porte dès maintenant les données des phases suivantes (sujets, `kind`, 3 tables, fenêtre de rendez-vous ouverte, rattachements, consentements dont 2 refus d'annuaire, organisateur `organisation@example.org`), ignorées tant que les types n'existent pas. Résumé affiché en fin d'exécution.

**B4. Squelette.** `GET /api/espace/health` → 200 `{ "status": "ok" }`, `auth: false`. Garde `if (process.env.DEMO_SEED !== 'false')` autour de `seedData` dans `strapi/src/index.js`. Le front n'est pas touché en phase 0 ; les dossiers de A-10 seront créés avec leurs premiers fichiers en phase 1.

Critères d'acceptation :
1. `corepack pnpm@12.15.0 --dir <dépôt>/strapi strapi routes:list` montre `GET /api/espace/health` et aucune autre nouvelle route.
2. Strapi lancé sur `strapi_espace` : `/api/espace/health` répond `{"status":"ok"}` ; les pages publiques sont inchangées.
3. Sans `EMAIL_PROVIDER` ni `NODE_ENV`, le fournisseur est `console` : un envoi ajoute une ligne au fichier et ne fait aucun appel réseau. `EMAIL_PROVIDER=brevo` avec `NODE_ENV=test` lève une erreur.
4. Le faux HelloAsso répond conformément à A-12 en ligne de commande et en module : jeton, pagination jusqu'à `data: []`, `customFields` seulement avec `withDetails=true`, 401 sans jeton valide, champs par tarif conformes à Q-03, adresses en `@example.org` uniquement.
5. Le seed refuse `strapi_espace` et `strapi` avec un message clair ; sur `strapi_e2e` créée vide, deux exécutions successives donnent les mêmes comptes.
6. Aucune dépendance ajoutée, lockfiles intacts, `web/` intact ; sans `DEMO_SEED`, le bootstrap se comporte comme avant.
7. Aucun tiret cadratin ; textes en français ; identifiants en anglais ; `.env.example` à jour, sans secret.
8. Le compte rendu du developer liste les commandes exécutées et leurs résultats.

### Lot C (tester) : outillage de test, CI, suite qui passe

Exigences : porte de la phase 0 ; tests de I-30, NF-53, I-10, I-11 (format du faux), Q-03 ; non-régression visuelle.

Fichiers dont le tester est propriétaire : `strapi/tests/**` (harnais, unitaires, intégration, script de démarrage de Strapi pour les tests), `web/tests/e2e/**`, `.github/workflows/tests.yml`, plus les fichiers partagés ci-dessus.

Contenu :
- **C1. Outillage Strapi** selon A-14 ; création de `strapi_test` si elle manque ; `test:unit` (dossier `lib/` et faux HelloAsso, sans Strapi, rapide) et `test:integration` (Strapi démarré une fois par exécution) ; `test` lance les deux.
- **C2. Tests du lot B** : fabrique et fournisseurs d'e-mail (choix par défaut, fichier de sortie, correspondance Brevo avec un client simulé, refus en test, analyse de `from`) ; faux HelloAsso (jeton, expiration, pagination, `withDetails`, champs par tarif, statistiques) ; seed (garde, idempotence sur une base `_test`) ; `/api/espace/health` et absence de route CRUD sous `/api/espace`.
- **C3. Playwright e2e** : projet `e2e` selon A-14, `webServer` qui démarre Strapi sans construire l'admin et le front, test de fumée (accueil rendu avec l'édition de recette, `/api/espace/health` en 200).
- **C4. Non-régression visuelle** : projet `visual` du lot A, local.
- **C5. Workflow** `.github/workflows/tests.yml` : push sur `main` et `feat/**`, pull request ; service `postgres:17-alpine` ; Node 24 et corepack ; installation `--frozen-lockfile` dans `strapi` et `web` ; bases `strapi_test` et `strapi_e2e` ; tests Strapi, seed, `playwright install --with-deps chromium`, e2e ; rapport Playwright en artefact en cas d'échec ; valeurs factices non secrètes pour `APP_KEYS` et les sels. Il ne tournera qu'au premier push autorisé par Mathieu.

Critères d'acceptation :
1. `test` (Strapi), `test:e2e` et `test:visual` (web) passent en local ; durées rapportées.
2. Le workflow est syntaxiquement valide (actionlint si disponible) ; il n'est pas exécuté tant qu'aucun push n'est autorisé.
3. Aucun test n'ouvre `strapi` ; seul le test visuel lit `strapi_espace`, en lecture par les pages publiques ; aucun e-mail réel (fournisseur `console` vérifié par un test) ; aucun appel réseau hors localhost, sauf les polices Google du test visuel.
4. Le compte rendu donne les commandes, la préparation des bases et tout contournement d'environnement, que l'architecte reporte dans `docs/espace/CLAUDE.md`.
5. Les défauts du lot B sont signalés à l'architecte avec leur reproduction ; le tester ne corrige pas le code applicatif.

## 4. Porte de la phase 0

- Lot C vert en local, y compris la non-régression visuelle des deux pages.
- Workflow vert en intégration continue : en attente de l'autorisation de push.
- Compte rendu `docs/espace/journal/phase-0.md` (fait, écarts, hypothèses appliquées : Q-13 à Q-17, dette connue).

## 5. Points qui demandent une action de Mathieu

1. Autoriser un push de `feat/espace-participant` pour faire tourner le workflow de tests (porte « en intégration continue »).
2. Créer le compte bac à sable HelloAsso et un formulaire reproduisant Q-03 avant la porte de la phase 1 (6 novembre). À défaut, la porte de la phase 1 se passe sur le faux et le bac à sable est vérifié dès qu'il existe.
3. Fournir l'adresse `EMAIL_FROM` (Q-16) et décider de l'envoi réel depuis le serveur de dev pour la recette (A-11).
4. Valider Q-13 (clic de confirmation du lien) et Q-14 (polices servies par le site).
5. Avant toute image Docker construite depuis la branche : changer `VERSION` (par exemple `0.2.0-rc1`), puisque la prod tourne sur les images `0.1.0`.

## 6. À reprendre en phase 1 (conséquences des décisions)

- `strapi/config/server.js` : `proxy`, `cron`, sections `helloasso` et `espace` (`PUBLIC_URL`, `ORGANIZER_EMAILS`) ; `config/middlewares.js` : `strapi::cors` restreint ; `config/cron-tasks.js`.
- `infra/deploy/base/docker-compose.base.yml` et overlays : nouvelles variables de Strapi ; `deploy.yml` : secret `HELLOASSO_CLIENT_SECRET`.
- `strapi/mcp/content-types.json` : `sequence.kind` et `sequence.topic`.
- `astro.config.mjs` : filtre du sitemap.
- Tests d'intégration : republication d'une édition sans perte de liens ; contenu publié renvoyé par `populate` avec `status: 'published'` ; survie de l'index `table_key` à un redémarrage.
