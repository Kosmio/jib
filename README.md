<p align="center">
  <img src="web/public/assets/skelly.png" alt="Skelly" width="180" />
</p>

<h1 align="center">Skelly</h1>

<p align="center">
  Starter full-stack <strong>Astro 6</strong> + <strong>Strapi v5</strong> prêt à l'emploi.<br/>
  CMS headless, formulaire de contact, newsletter, cookie consent, Docker.
</p>

---

## Stack technique

| Couche          | Technologie          | Version     |
|-----------------|----------------------|-------------|
| CMS             | Strapi               | 5.40        |
| Frontend        | Astro (SSR, Node.js) | 6.0         |
| UI              | React                | 19          |
| Styling         | Tailwind CSS         | 4.2         |
| Base de données | PostgreSQL           | 15          |
| Emails          | Brevo                | SDK v5      |
| Anti-bot        | Altcha               | (self-hosted) |
| Analytics       | Matomo               | (optionnel) |
| Package manager | pnpm                 | —           |
| Conteneurs      | Docker Compose       | —           |

## Démarrage rapide

### Prérequis

- **Node.js** 20+
- **pnpm** (`corepack enable`)
- **Docker** (pour PostgreSQL)

### 1. Cloner et installer

```bash
git clone <repo-url> && cd skeleton-astro-strapi

# Installer les dépendances
cd strapi && pnpm install && cd ..
cd web && pnpm install && cd ..
```

### 2. Configurer l'environnement

```bash
# Strapi
cp strapi/.env.example strapi/.env
# → Les valeurs par défaut fonctionnent pour le développement local

# Web
cp web/.env.example web/.env
# → STRAPI_KEY doit être renseigné après le premier démarrage de Strapi
```

### 3. Lancer

```bash
# Terminal 1 — Base de données
make infra-up

# Terminal 2 — Strapi
cd strapi && pnpm develop
# → http://localhost:1337/admin

# Terminal 3 — Frontend
cd web && pnpm dev
# → http://localhost:4321
```

Au premier lancement, Strapi :
- Configure le français comme locale par défaut
- Crée 3 articles de démonstration

### 4. Connecter le frontend à Strapi

1. Ouvrir http://localhost:1337/admin et créer un compte administrateur
2. Aller dans **Settings → API Tokens** et créer un token (Full access)
3. Coller le token dans `web/.env` à la clé `STRAPI_KEY`
4. Aller dans **Settings → Users & Permissions → Roles → Public** et activer les permissions `find` et `findOne` sur Article
5. Redémarrer le serveur web

## Structure du projet

```
├── strapi/                  Strapi v5 — CMS headless
│   ├── config/              Configuration (serveur, BDD, admin, API)
│   ├── src/
│   │   ├── index.js         Bootstrap (locale FR, articles de démo)
│   │   └── api/
│   │       ├── article/     Articles (CRUD standard)
│   │       ├── contact/     Formulaire de contact (Brevo)
│   │       └── newsletter/  Inscription newsletter (Altcha + Brevo)
│   └── .env.example
│
├── web/                     Astro 6 — Frontend SSR
│   ├── astro.config.mjs     Config (SSR, React, Tailwind)
│   ├── src/
│   │   ├── styles/app.css   Thème Tailwind v4
│   │   ├── layouts/         Layout principal
│   │   ├── components/      Composants Astro (Header, Footer, Hero, Card)
│   │   ├── react-components/ Composants React (ContactForm, ArticleList)
│   │   ├── pages/           Routes (accueil, articles, contact, 404)
│   │   └── lib/             Client API Strapi + types TypeScript
│   └── .env.example
│
├── infra/
│   ├── deploy/              Docker Compose (base + overlays local/dev/prod)
│   │   └── scripts/deploy.sh
│   ├── docker/              Dockerfiles multi-stage (strapi, website)
│   └── make/                Makefiles par service
│
├── Makefile                 Commandes racine
└── VERSION                  Version du projet (tags Docker)
```

## Fonctionnalités incluses

### Articles & Blog
Gestion de contenu via Strapi avec titre, slug, contenu Markdown, image et date de publication. Rendu côté serveur avec pagination client-side.

### Formulaire de contact
Formulaire React avec envoi d'email via l'API transactionnelle Brevo. Configurable via variables d'environnement.

### Newsletter
Inscription dans le footer avec ajout du contact dans une liste Brevo. Protection anti-bot via Altcha (self-hosted, RGPD).

### Cookie Consent
Bannière RGPD avec catégories (nécessaires, analytiques). Les scripts analytics ne se chargent qu'après consentement.

### Analytics
Intégration Matomo optionnelle, conditionnée au consentement cookies. S'active en renseignant `PUBLIC_MATOMO_URL` et `PUBLIC_MATOMO_SITE_ID`.

## Configuration

### Variables Strapi (`strapi/.env`)

| Variable | Description | Requis |
|----------|-------------|--------|
| `APP_KEYS` | Clés de session (séparées par des virgules) | Oui |
| `API_TOKEN_SALT` | Salt pour les tokens API | Oui |
| `ADMIN_JWT_SECRET` | Secret JWT admin | Oui |
| `TRANSFER_TOKEN_SALT` | Salt pour les tokens de transfert | Oui |
| `JWT_SECRET` | Secret JWT utilisateurs | Oui |
| `DATABASE_HOST` | Hôte PostgreSQL | Oui |
| `EMAIL_API_KEY` | Clé API Brevo | Non |
| `EMAIL_CONTACT_TO` | Email de réception du formulaire | Non |
| `EMAIL_CONTACT_TEMPLATE_ID` | ID du template Brevo | Non |
| `EMAIL_LIST_ID` | ID de la liste newsletter Brevo | Non |
| `ALTCHA_HMAC_KEY` | Clé HMAC pour Altcha (anti-bot) | Non |

### Variables Web (`web/.env`)

| Variable | Description | Requis |
|----------|-------------|--------|
| `STRAPI_URL` | URL interne Strapi (serveur) | Oui |
| `STRAPI_KEY` | Token API Strapi | Oui |
| `REACT_STRAPI_URL` | URL publique Strapi (navigateur) | Oui |
| `PUBLIC_MATOMO_URL` | URL Matomo | Non |
| `PUBLIC_MATOMO_SITE_ID` | ID site Matomo | Non |

Les fonctionnalités optionnelles (email, analytics, captcha) sont désactivées quand leurs variables sont vides.

## Déploiement

### Docker

```bash
# Construire les images
make build

# Linter les Dockerfiles
make lint

# Pousser vers le registry
make stage
```

### Environnements

Le déploiement utilise un script unifié avec des overlays par environnement :

```bash
./infra/deploy/scripts/deploy.sh <local|dev|prod> <up|down|logs|ps|restart>
```

| Environnement | Comportement |
|---------------|-------------|
| `local` | Postgres en Docker, Strapi et web en local |
| `dev` | Tout en Docker, `restart: unless-stopped` |
| `prod` | Tout en Docker, `restart: always`, limites mémoire |

## Personnalisation

### Couleurs et thème

Modifier `web/src/styles/app.css` :

```css
@theme {
  --color-primary: #1e40af;      /* Votre couleur principale */
  --color-accent: #f59e0b;       /* Votre couleur d'accent */
  --font-sans: "Inter", sans-serif;
}
```

### Ajouter un type de contenu

1. Créer le dossier dans `strapi/src/api/`
2. Définir le schema dans `content-types/<nom>/schema.json`
3. Créer controller, routes et service via les factories Strapi
4. Ajouter les types TypeScript dans `web/src/lib/types.ts`
5. Créer la page correspondante dans `web/src/pages/`

---

<p align="center">
  <img src="web/public/assets/skelly-head.png" alt="Skelly" width="40" />
</p>
