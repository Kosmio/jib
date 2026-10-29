# CLAUDE.md, espace participant JIB

Ce fichier est la mémoire partagée des agents (architect, designer, developer, tester). Le lire en entier avant toute tâche. L'architecte en est le seul propriétaire et le met à jour quand une connaissance opérationnelle se confirme.

## Mission

Ajouter au site existant des Journées de l'Innovation Filière Bois (journees-innovation-bois.xylofutur.fr, Astro + Strapi) un **espace participant** : application web installable (PWA) de profils, annuaire, prise de rendez-vous B2B, messagerie, relances e-mail et tableau de bord organisateur, alimentée par les inscriptions HelloAsso.

- Client : Xylofutur. Réalisation : Kosmio.
- Première édition servie : Nouvelle-Aquitaine, jeudi 3 décembre 2026, Bordeaux, environ 200 participants.
- **Mise en production impérative : vendredi 20 novembre 2026.** Recette client le 19 novembre.
- Budget au forfait très contraint : chaque choix privilégie la simplicité, la réutilisation de l'existant et le code le plus court qui satisfait les critères d'acceptation.

## Lecture obligatoire, dans cet ordre

1. `docs/espace/specs/00-index.md` : carte des spécifications et règles de travail des agents
2. Le fichier de spec de la phase en cours (voir `docs/espace/specs/09-phases.md`)
3. `docs/espace/specs/04-regles-metier.md` avant toute tâche qui touche aux rendez-vous

## Pile technique

- Front : **Astro 6.0.7** existant (SSR, adaptateur Node `standalone`). L'espace participant vit dans le même dépôt, sous `/espace/*`. Interactivité par îlots en **React 19**, déjà présent dans le dépôt (`@astrojs/react`).
- Back : **Strapi 5.59** sur **PostgreSQL 17** (constaté le 29 octobre 2026), servi sous `/strapi` sur le même domaine que le site.
- E-mail transactionnel : le compte et le domaine d'envoi **Brevo** déjà utilisés par le site, via une interface `MailProvider` pour pouvoir en changer.
- Multi-éditions : l'espace sert chaque édition sans développement ; tous les paramètres d'une édition (créneaux, tables, fenêtre de rendez-vous, formulaire HelloAsso) se règlent dans Strapi.
- Recette : sur le serveur de **dev** (workflow Deploy, environnement `dev`) ; la prod reste inchangée jusqu'à la mise en production.
- Pas de nouvelle base de données : tout est stocké dans la base de Strapi.
- Pas de service tiers d'analytics, pas de traqueur.

## Commandes

Relevées le 29 octobre 2026 dans `strapi/package.json`, `web/package.json` et le `Makefile`. Ne jamais inventer une commande : la lire dans `package.json`. `<dépôt>` = `/Users/mathieu/Operations/Kosmio/20-Axe2-Plateformes-IA/Projets/Site-web-wylofutur/dev-form-cdc/skeleton-astro-strapi/skeleton-astro-strapi`. Une commande par appel, sans `&&` ni `;` : toutes les formes ci-dessous tiennent en une ligne, préfixe de variables compris.

**pnpm.** Il n'est pas dans le PATH : toujours passer par corepack. Corepack choisit la version de pnpm d'après le `package.json` du répertoire courant. Lancé depuis la racine du dépôt, qui n'en a pas, il prend une autre version et pnpm refuse (`ERR_PNPM_BAD_PM_VERSION`), même avec `--dir`. Forme à une seule commande, valable depuis n'importe quel répertoire : `corepack pnpm@12.15.0 --dir <dépôt>/strapi <script>` (ou `<dépôt>/web`). La version doit rester celle du champ `packageManager` ; la vérifier si elle change.

| Besoin | Commande | Vérifiée le 29/10 |
|---|---|---|
| Postgres local (conteneur `jib-postgres`) | `make -C <dépôt> infra-up` | conteneur déjà actif |
| Valider la configuration Docker locale | `make -C <dépôt> infra-validate` | oui |
| Installer les dépendances | `corepack pnpm@12.15.0 --dir <dépôt>/strapi install`, idem pour `web` | non relancée, `node_modules` présents |
| Strapi en dev, admin compris (port 1337) | `corepack pnpm@12.15.0 --dir <dépôt>/strapi develop` | |
| Vérifier que Strapi démarre et lister ses routes | `corepack pnpm@12.15.0 --dir <dépôt>/strapi strapi routes:list` | oui, environ 10 s |
| Version de Strapi | `corepack pnpm@12.15.0 --dir <dépôt>/strapi strapi version` | oui, 5.59.0 |
| Construire l'admin Strapi | `corepack pnpm@12.15.0 --dir <dépôt>/strapi build` | non (lente) |
| Front en dev (port 4321) | `corepack pnpm@12.15.0 --dir <dépôt>/web dev` | |
| Construire le front | `corepack pnpm@12.15.0 --dir <dépôt>/web build` | oui, environ 3 s |
| Servir le front construit | `corepack pnpm@12.15.0 --dir <dépôt>/web preview` | |
| Requête SQL (sans terminal interactif) | `docker exec jib-postgres psql -U strapi -d strapi_espace -Atc "select slug from editions"` | oui |
| Créer une base | `docker exec jib-postgres createdb -U strapi strapi_e2e` | |
| Lint des Dockerfiles (hadolint par Docker) | `make -C <dépôt> lint` | |
| Seed de recette | `DATABASE_NAME=strapi_e2e corepack pnpm@12.15.0 --dir <dépôt>/strapi seed` | oui (lot B) |
| Faux HelloAsso, port 4010 (`FAKE_HELLOASSO_PORT`) | `corepack pnpm@12.15.0 --dir <dépôt>/strapi helloasso:fake` ; affiche les `HELLOASSO_*` à utiliser | oui (lot B) |

Les configurations `strapi` et `web` de `.claude/launch.json` lancent `develop` et `dev` par corepack, depuis le bon répertoire. Ne pas utiliser `make strapi`, `make web` ni `make mcp` : ils appellent `pnpm` sans corepack. `make test` n'affiche que « No Test ». `make build` et `make stage` construisent et poussent des images : jamais sans demande de Mathieu.

### Tests

Registre de ce qui est testé : `strapi/tests/SPEC.md`, tenu par le tester. Mesures du 29 octobre.

| Suite | Commande | Prérequis | Durée |
|---|---|---|---|
| Strapi, tout | `corepack pnpm@12.15.0 --dir <dépôt>/strapi test` | Postgres (`jib-postgres`) | 28 s, 298 tests |
| Strapi, unitaires | `corepack pnpm@12.15.0 --dir <dépôt>/strapi test:unit` | aucun | 3 s |
| Strapi, intégration | `corepack pnpm@12.15.0 --dir <dépôt>/strapi test:integration` | Postgres | 25 s |
| Navigateur des tests (une fois) | `corepack pnpm@12.15.0 --dir <dépôt>/web exec playwright install chromium` (sans `--with-deps` sous macOS) | | |
| e2e sur ce poste | `E2E_STRAPI_PORT=1348 E2E_WEB_PORT=4332 corepack pnpm@12.15.0 --dir <dépôt>/web test:e2e` | Postgres, Chromium | 16 s, 10 tests |
| Visuel (local seulement) | `corepack pnpm@12.15.0 --dir <dépôt>/web test:visual` | les trois serveurs ci-dessous | 6 s, 4 tests |
| Mettre à jour les références visuelles | `corepack pnpm@12.15.0 --dir <dépôt>/web test:visual --update-snapshots=all` | idem ; seulement pour un changement voulu d'une page publique, avec l'accord de l'architecte | |

Serveurs du test visuel, chacun dans son terminal ou en arrière-plan :

1. Strapi sur `strapi_espace`, port 1337 : `corepack pnpm@12.15.0 --dir <dépôt>/strapi develop` (`strapi/.env` inchangé) ;
2. `corepack pnpm@12.15.0 --dir <dépôt>/web build` ;
3. `corepack pnpm@12.15.0 --dir <dépôt>/web preview --host 127.0.0.1 --port 4321`, dans le fuseau Europe/Paris, celui du poste. Les dates affichées suivent le fuseau de ce processus : si `TZ` est réglé autrement, préfixer `TZ=Europe/Paris`.

Contournements en place, à connaître avant d'écrire ou de lancer un test :

- **Environnement hermétique.** Tout Strapi de test reçoit son environnement de `strapi/tests/helpers/env.js` (`buildTestEnv`) : `ENV_PATH=/dev/null`, donc ni `strapi/.env` ni la clé Brevo ne sont lus ; valeurs factices pour les clés et les sels ; `NODE_ENV=test`, `TZ=UTC`, `EMAIL_PROVIDER=console`, `DEMO_SEED=false`, `CRON_ENABLED=false`. Une variable nouvelle dont le code a besoin en test s'ajoute là (tester), jamais dans un `.env`.
- **Bases.** `strapi_test` et `strapi_e2e` sont créées si elles manquent, puis vidées au démarrage de chaque suite (`strapi/tests/prepare-databases.js`). Rien à préparer à la main. Seules les bases en `_test` ou `_e2e` sont admises.
- **Aucun réseau.** `strapi/tests/helpers/no-network.js` est préchargé par tous les scripts `test*`, le serveur e2e et le seed lancé par les tests : toute connexion TCP hors boucle locale échoue. Un service externe doit donc être injectable ou simulé (faux HelloAsso, client Brevo simulé). Le navigateur e2e coupe toute requête hors localhost, sauf les polices Google.
- **Serveurs e2e.** `test:e2e` pose `PLAYWRIGHT_E2E=1` : Playwright démarre alors lui-même Strapi (`strapi/tests/e2e-server.js` : vide `strapi_e2e`, lance le seed, admin non construit) et le front construit dans `web/dist-e2e`. Il ne réutilise jamais un serveur existant : un port occupé le fait échouer aussitôt (« already used »).
- **Arrêt de Strapi.** `stopStrapi` attend 750 ms avant de couper la connexion, parce que Strapi émet les événements `entry.*` sans les attendre ; sans ce délai, le processus reste bloqué 60 s.
- **Défauts connus.** Un défaut constaté mais non corrigé est un test marqué `todo` : il s'exécute et s'affiche sans faire échouer la suite. Le tester retire `todo` dès la correction.
- **Test visuel.** Références propres à macOS et au Chromium de Playwright 1.64.1, tolérance `maxDiffPixelRatio: 0.0001`, ligne `©` du pied de page masquée, dépendance au réseau pour Google Fonts (Q-14). Exclu de la CI.

### Ports

| Port | Service |
|---|---|
| 1337 | Strapi de dev (`strapi_espace`) |
| 4321 | front Astro (dev ou build servi) |
| 5432 | Postgres (`jib-postgres`, utilisateur `strapi`) |
| 4010 | faux HelloAsso |
| 1348, 4332 | Strapi et front des tests e2e (`strapi_e2e`) : défauts retenus, en place dès le lot 1 de la phase 1 |

Ce poste fait aussi tourner un autre projet : relevé `lsof -nP -iTCP -sTCP:LISTEN` du 29 octobre, 1338, 4322, 4330 et 5173 occupés, ainsi qu'un second Postgres sur 5433. D'ici le lot 1 de la phase 1, les défauts du code restent 1338 et 4322 (`web/playwright.config.ts`, `strapi/tests/e2e-server.js`, `web/tests/e2e/fixtures.ts`) : passer `E2E_STRAPI_PORT=1348 E2E_WEB_PORT=4332`. Les deux variables restent la surcharge si un port est pris. Le Postgres de l'espace est celui de Docker, sur 5432, jamais celui de 5433.

### Bases (même serveur Postgres)

| Base | Rôle | Règle |
|---|---|---|
| `strapi` | copie de référence | n'y toucher sous aucun prétexte, pas même en démarrant Strapi dessus |
| `strapi_espace` | dev par défaut (`strapi/.env`) ; copie de prod avec des données personnelles réelles | jamais de seed, d'export ni de commit ; sert aux captures visuelles |
| `strapi_test` | tests d'intégration Strapi | créée si besoin et vidée par la suite de tests |
| `strapi_e2e` | seed de recette, Playwright, essais manuels de l'espace | créée si besoin et vidée par `test:e2e`, remplie par `seed` |

Démarrer Strapi sur une base aligne son schéma sur le code. Le premier démarrage sur `strapi_espace` avec les schémas de la phase 1 ajoute donc les tables de l'espace : c'est la répétition de la migration de prod. Le relevé de référence des tables de liaison, à comparer après ce démarrage, figure dans `docs/espace/journal/phase-1-plan.md` (lot 2, critère 1).

### Variables d'environnement

Existantes. Strapi (`strapi/.env`, lu par `strapi/config/*.js`) : `HOST`, `PORT`, `BASE_URL`, `ADMIN_URL`, `APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET`, `DATABASE_CLIENT`, `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`, `EMAIL_API_KEY` (clé Brevo réelle), `EMAIL_LIST_ID`, `EMAIL_CONTACT_TO`, `EMAIL_CONTACT_TEMPLATE_ID`, `ALTCHA_HMAC_KEY`, `RESTORE_MISSING_MEDIA`. Front (`web/.env`) : `STRAPI_URL` (serveur), `REACT_STRAPI_URL` (navigateur), `PUBLIC_COOKIE_CONSENT`, `PUBLIC_MATOMO_URL`, `PUBLIC_MATOMO_SITE_ID`.

Ajoutées par l'espace (Strapi) :

| Variable | Rôle | Depuis |
|---|---|---|
| `EMAIL_PROVIDER` | `console` ou `brevo` ; défaut `brevo` si `NODE_ENV=production`, sinon `console` ; `brevo` refusé sous `NODE_ENV=test` | phase 0 |
| `EMAIL_FROM` | expéditeur des e-mails de l'espace, « Nom <adresse> » (Q-16) | phase 0 |
| `EMAIL_OUTBOX_FILE` | fichier JSONL du `ConsoleMailProvider`, défaut `.tmp/mail-outbox.jsonl` | phase 0 |
| `DEMO_SEED` | `false` empêche le bootstrap de créer les éditions de démonstration sur une base vide | phase 0 |
| `HELLOASSO_CLIENT_ID`, `HELLOASSO_CLIENT_SECRET`, `HELLOASSO_API_BASE` | I-10 ; en local `HELLOASSO_API_BASE=http://localhost:4010/v5` (faux) ; jeton demandé à `{origine}/oauth2/token` | phase 1 |
| `PUBLIC_URL` | URL publique du site : liens des e-mails, redirections 303 | phase 1 |
| `ORGANIZER_EMAILS` | e-mails des organisateurs, séparés par des virgules (I-23) | phase 1 |
| `CORS_ORIGINS` | origines admises par CORS et par le contrôle `Origin`, défaut `http://localhost:4321` | phase 1 |
| `IS_PROXIED` | `proxy.koa` de Strapi : `true` derrière Traefik (dev, prod) | phase 1 |
| `CRON_ENABLED` | tâches planifiées : `false` en local et en test, `true` en dev et prod | phase 1 |

Outillage, jamais lues par l'application :

| Variable | Rôle |
|---|---|
| `FAKE_HELLOASSO_PORT` | port du faux HelloAsso en ligne de commande (défaut 4010) |
| `E2E_STRAPI_PORT`, `E2E_WEB_PORT` | ports des serveurs e2e (section Ports) |
| `PLAYWRIGHT_E2E` | posée à 1 par `test:e2e` : Playwright démarre les serveurs e2e |

Déploiement : chaque variable de Strapi est listée une à une dans `infra/deploy/base/docker-compose.base.yml` (`strapi.environment`). Une variable nouvelle s'ajoute là, dans `infra/deploy/overlays/{dev,prod}/.env.*` et, si elle est secrète, dans les secrets GitHub fusionnés par `deploy.yml`.

### Pièges connus

- Strapi charge `strapi/.env` de lui-même : un script ou un test qui ne fixe pas `DATABASE_NAME` dans son environnement tourne sur `strapi_espace`. Le seed et la suite d'intégration refusent toute base dont le nom ne finit pas par `_test` ou `_e2e`.
- Sur une base vide, le bootstrap (`strapi/src/index.js`) crée des éditions de démonstration et téléverse les images de `strapi/seed-assets/` : poser `DEMO_SEED=false`.
- `web/.astro/` est versionné et réécrit par `astro build` et `astro dev` : ne jamais committer ces modifications. `.claude/launch.json`, `strapi/.strapi-updater.json` et `.vscode/` ont aussi des modifications locales hors périmètre.
- Plusieurs agents travaillent en même temps dans ce dépôt : jamais de `git add -A`, `git add .` ni `git commit -a`. Committer avec des chemins explicites (`git commit -m "…" -- <fichiers>`), limités aux fichiers dont on est propriétaire.
- **Tirets cadratins déjà présents.** Les pages publiques (`Layout.astro`, `Header.astro`, `Footer.astro`, la plupart des pages de `web/src/pages/`), `app.css`, `ContactForm.tsx` et les données du bootstrap (`strapi/src/index.js`) contiennent des U+2014, par exemple dans les titres de page, entre l'année et « Xylofutur ». Conséquences : l'espace ne réutilise ni `Layout.astro`, ni `Header.astro`, ni `Footer.astro`, et ne recopie aucun de leurs textes ; un test qui compare un titre de page publique ou un contenu Strapi existant ne l'écrit pas en entier ; un test « sans tiret cadratin » vise les fichiers et les gabarits de l'espace, jamais les pages publiques ni les contenus saisis dans Strapi. `strapi/tests/unit/conventions.test.js` liste les dossiers contrôlés : l'étendre à chaque nouveau dossier de l'espace.
- `web/package-lock.json` est un reste de npm : seul `pnpm-lock.yaml` fait foi.
- Le plugin e-mail de Strapi est resté sur sendmail : ne jamais appeler `strapi.plugin('email')`, toujours passer par le fournisseur de l'espace.
- Types en brouillon et publication (`edition`, `sequence`, `intervention`, `intervenant`, `organisation`) : deux lignes par document. Filtrer par `documentId`, lire avec `status: 'published'`.
- Ne jamais changer le type d'une relation existante : la table de liaison est recréée vide au déploiement, et la prod est éditée directement. Sur un type existant, on n'ajoute que des champs scalaires ; toute nouvelle relation est déclarée sur un type nouveau `api::espace.*` (A-15).
- Les images Docker sont étiquetées par `VERSION` (0.1.0, la version de prod) : changer `VERSION` avant de construire une image depuis la branche.
- Données fictives uniquement, adresses en `@example.org`.

## Architecture de l'espace

Décisions A-01 à A-14 : `docs/espace/journal/phase-0-plan.md` ; A-15 à A-20 : `docs/espace/journal/phase-1-plan.md`, qui remplacent les points de A-03 et A-08 qu'elles citent. Comptes rendus de phase : `docs/espace/journal/phase-N.md`. L'essentiel :

- Back : une API Strapi `espace` (`strapi/src/api/espace/`), routes personnalisées sous `/api/espace`, sans route CRUD générée ; logique pure dans `lib/`, testable sans Strapi.
- Session (I-22) : cookie `jib_espace` signé, posé et lu par Strapi seul. Même domaine en prod et en dev serveur (Traefik : site sur `/`, Strapi sur `/strapi`) ; en local, les cookies de `localhost` sont partagés entre les ports 4321 et 1337. Pas de proxy Astro.
- Front : pages sous `web/src/pages/espace/[edition]/…`, layout `EspaceLayout.astro` sans Matomo ; rendu serveur par `STRAPI_URL` en relayant le cookie, îlots par `REACT_STRAPI_URL` avec `credentials: 'include'`.
- Dates en UTC en base, affichées avec `timeZone: 'Europe/Paris'` explicite ; tests sous `TZ=UTC`.

## Conventions

- Langue de l'interface, des e-mails et des messages d'erreur : **français**. Langue du code (identifiants, noms de fichiers) : anglais.
- Typographie française dans les textes : apostrophe typographique ’, espace insécable avant « : ; ! ? » et dans les montants, guillemets « ».
- **Ne jamais utiliser le tiret cadratin (caractère U+2014) ni son entité HTML** dans aucun texte, HTML, e-mail ou commentaire. Utiliser virgule, deux-points, parenthèses.
- Formuler directement ; éviter les tournures « il ne s'agit pas de X mais de Y ».
- Toutes les entités métier sont rattachées à une **édition** (multi-éditions dès la v1).
- Aucune valeur de couleur ou de taille en dur hors des tokens de `docs/espace/specs/07-design.md`.
- Toute donnée personnelle sort de l'API uniquement si les règles de visibilité de `04-regles-metier.md` l'autorisent.
- Dates et heures stockées en UTC, affichées en Europe/Paris.

## Règles de travail entre agents

- Le developer n'écrit pas les tests ; le tester les écrit et les exécute. **Aucune phase n'est close sans feu vert du tester.**
- Chaque exigence porte un identifiant (`F-xx`, `R-xx`, `NF-xx`). Les commits, tests et revues citent ces identifiants.
- En cas d'ambiguïté non tranchée par les specs : consulter `11-questions-ouvertes.md`, appliquer l'hypothèse par défaut qui y figure et la signaler dans le compte rendu de phase.
- Ne pas modifier les pages publiques existantes du site hors des points d'intégration listés dans `03-ecrans.md`.
