<p align="center">
  <img src="web/public/assets/logo-xylo.png" alt="Xylofutur" width="220" />
</p>

<h1 align="center">Journées de l'Innovation Filière Bois</h1>

<p align="center">
  Site des Journées de l'Innovation de la Filière Bois — événements régionaux portés par Xylofutur et les Fibois.<br/>
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

### 1. Installer les dépendances

```bash
cd strapi && pnpm install && cd ..
cd web && pnpm install && cd ..
```

### 2. Configurer l'environnement

Les fichiers `.env` sont déjà générés avec des secrets frais. Vérifiez les valeurs dans :
- `strapi/.env`
- `web/.env`

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

Au premier lancement, Strapi configure le français comme locale par défaut.

## Structure du projet

```
├── strapi/                  Strapi v5 — CMS headless
│   ├── config/              Configuration (serveur, BDD, admin, API)
│   ├── src/
│   │   ├── index.js         Bootstrap (locale FR, permissions publiques)
│   │   └── api/
│   │       ├── contact/     Formulaire de contact (Brevo)
│   │       └── newsletter/  Inscription newsletter (Altcha + Brevo)
│   └── .env
│
├── web/                     Astro 6 — Frontend SSR
│   ├── astro.config.mjs     Config (SSR, React, Tailwind)
│   ├── src/
│   │   ├── styles/app.css   Thème Tailwind v4 (couleurs Xylofutur)
│   │   ├── layouts/         Layout principal
│   │   ├── components/      Composants Astro (Header, Footer, Hero)
│   │   ├── react-components/ Composants React (ContactForm)
│   │   ├── pages/           Routes (accueil, contact, 404)
│   │   └── lib/             Client API Strapi + types TypeScript
│   └── .env
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

## Fonctionnalités

### Formulaire de contact
Formulaire React avec envoi d'email via l'API transactionnelle Brevo. Les messages sont envoyés à `mathieu+xylo@kosm.io`.

### Newsletter
Inscription dans le footer avec ajout du contact dans une liste Brevo. Protection anti-bot via Altcha (self-hosted, RGPD).

### Cookie Consent
Bannière RGPD désactivée par défaut (pas de cookies non-essentiels). Prête à être activée si des outils tiers sont ajoutés.

### Analytics
Intégration Matomo optionnelle. S'active en renseignant `PUBLIC_MATOMO_URL` et `PUBLIC_MATOMO_SITE_ID`.

## Déploiement

```bash
# Construire les images
make build

# Pousser vers le registry
make stage

# Déployer
./infra/deploy/scripts/deploy.sh <local|dev|prod> <up|down|logs|ps|restart>
```

## Personnalisation

### Couleurs et thème

Modifier `web/src/styles/app.css` :

```css
@theme {
  --color-primary: #00B194;    /* Vert Xylofutur */
  --color-accent: #BA8748;     /* Or / bois */
  --color-surface: #F3E3CF;    /* Beige clair */
}
```

---

<p align="center">
  <img src="web/public/assets/logo-xylo.png" alt="Xylofutur" width="60" />
</p>
