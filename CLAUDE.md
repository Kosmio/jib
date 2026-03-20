# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

**Skeleton Astro + Strapi** is a full-stack starter project combining a Strapi v5 headless CMS with an Astro 6 SSR frontend. It serves as a reusable base for web projects with content management, contact forms, newsletter subscriptions, and Docker-based deployment.

**Key Technologies:**
- **Backend**: Strapi v5.40 (Node.js headless CMS, REST API, PostgreSQL)
- **Frontend**: Astro 6 SSR with Node.js adapter, React 19 for interactive components
- **Styling**: Tailwind CSS v4 (CSS-based config via `@tailwindcss/vite`)
- **Package Manager**: pnpm
- **Infrastructure**: Docker Compose with base + overlay pattern, multi-stage Dockerfiles

## Project Structure

```
skeleton-astro-strapi/
├── strapi/                     # Strapi v5 backend
│   ├── config/                 # Environment-driven config (server, db, admin, api)
│   ├── src/
│   │   ├── index.js            # Bootstrap (locale setup, seed data)
│   │   └── api/                # Content types + custom controllers
│   │       ├── article/        # Articles (standard CRUD via factories)
│   │       ├── contact/        # Contact form (custom POST endpoint)
│   │       └── newsletter/     # Newsletter subscription (Altcha + Brevo)
│   └── .env.example
├── web/                        # Astro 6 SSR frontend
│   ├── astro.config.mjs        # SSR + React + Tailwind vite plugin
│   ├── src/
│   │   ├── styles/app.css      # Tailwind v4 theme
│   │   ├── layouts/Layout.astro
│   │   ├── components/         # Astro components (Header, Footer, Hero, Card, Button)
│   │   ├── react-components/   # React components (ContactForm, ArticleList, MarkdownContent)
│   │   ├── pages/              # File-based routing (index, articles, contact, 404)
│   │   └── lib/                # API client (strapi.ts) + types (types.ts)
│   └── public/                 # Static assets (favicon, cookie consent)
├── infra/
│   ├── deploy/                 # Docker Compose base + overlays (local/dev/prod)
│   │   └── scripts/deploy.sh   # Unified deployment script
│   ├── docker/                 # Dockerfiles (strapi, website)
│   └── make/                   # Per-service Makefiles
├── Makefile                    # Root orchestration
├── VERSION                     # Project version (used in Docker tags)
└── ai/                         # Practice documentation
    ├── STRAPI_PRACTICES.md
    ├── ASTRO_PRACTICES.md
    └── INFRA_PRACTICES.md
```

## Quick Start

```bash
# Start Postgres
make infra-up

# Start Strapi (terminal 1)
cd strapi && pnpm develop
# → http://localhost:1337/admin

# Start web (terminal 2)
cd web && pnpm dev
# → http://localhost:4321
```

On first Strapi start, the bootstrap seeds 3 demo articles and sets French as the default locale.

## Key Architecture Decisions

### Strapi v5
- API responses are flat: `article.title`, `article.image?.url`
- Use `strapi.documents()` (Document Service) for all data operations
- i18n is a core plugin, no separate dependency needed

### Astro SSR
- All pages are server-rendered at request time (`output: "server"`)
- Dynamic routes fetch data on each request
- React components hydrate client-side via `client:visible`

### Tailwind v4
- Theme defined in CSS (`src/styles/app.css` with `@theme` block)
- Uses `@tailwindcss/vite` plugin in Astro's Vite config

### Environment variable split
- `STRAPI_URL` + `STRAPI_KEY` — server-side only (in Astro frontmatter)
- `REACT_STRAPI_URL` — public URL passed as props to React components
- `PUBLIC_*` — available everywhere (Matomo)

## Build & Deploy

```bash
# Build Docker images
make build

# Lint Dockerfiles
make lint

# Push to registry
make stage

# Deploy to environment
./infra/deploy/scripts/deploy.sh <local|dev|prod> up
```

## Practices

Read `.claude/practices.md` for the index of all practice docs. Key docs:
- `ai/STRAPI_PRACTICES.md` — Strapi content types, controllers, config, bootstrap
- `ai/ASTRO_PRACTICES.md` — Pages, components, hydration, API client, Tailwind v4
- `ai/INFRA_PRACTICES.md` — Docker, deployment, Makefiles, environment management
