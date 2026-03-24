# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

**Journées de l'Innovation Filière Bois** — Site web des Journées de l'Innovation de la Filière Bois, événements régionaux portés par Xylofutur (pôle de compétitivité forêt-bois) et les Fibois régionales.

Full-stack project combining a Strapi v5 headless CMS with an Astro 6 SSR frontend.

**Key Technologies:**
- **Backend**: Strapi v5.40 (Node.js headless CMS, REST API, PostgreSQL)
- **Frontend**: Astro 6 SSR with Node.js adapter, React 19 for interactive components
- **Styling**: Tailwind CSS v4 (CSS-based config via `@tailwindcss/vite`)
- **Package Manager**: pnpm
- **Infrastructure**: Docker Compose with base + overlay pattern, multi-stage Dockerfiles

## Project Structure

```
journees-innovation-bois/
├── strapi/                     # Strapi v5 backend
│   ├── config/                 # Environment-driven config (server, db, admin, api)
│   ├── src/
│   │   ├── index.js            # Bootstrap (locale setup, public permissions)
│   │   └── api/                # Content types + custom controllers
│   │       ├── contact/        # Contact form (custom POST endpoint)
│   │       └── newsletter/     # Newsletter subscription (Altcha + Brevo)
│   └── .env
├── web/                        # Astro 6 SSR frontend
│   ├── astro.config.mjs        # SSR + React + Tailwind vite plugin
│   ├── src/
│   │   ├── styles/app.css      # Tailwind v4 theme (Xylofutur colors)
│   │   ├── layouts/Layout.astro
│   │   ├── components/         # Astro components (Header, Footer, Hero)
│   │   ├── react-components/   # React components (ContactForm)
│   │   ├── pages/              # File-based routing (index, contact, 404)
│   │   └── lib/                # API client (strapi.ts) + types (types.ts)
│   └── public/                 # Static assets (logo, favicon, cookie consent)
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

On first Strapi start, the bootstrap sets French as the default locale.

## Key Architecture Decisions

### Strapi v5
- API responses are flat: `entity.title`, `entity.image?.url`
- Use `strapi.documents()` (Document Service) for all data operations
- i18n is a core plugin, no separate dependency needed
- API is public (no authentication required)

### Astro SSR
- All pages are server-rendered at request time (`output: "server"`)
- React components hydrate client-side via `client:visible`

### Tailwind v4
- Theme defined in CSS (`src/styles/app.css` with `@theme` block)
- Uses `@tailwindcss/vite` plugin in Astro's Vite config
- Colors: Xylofutur green (#00B194), gold/wood accent (#BA8748), beige surfaces

### Environment variable split
- `STRAPI_URL` — server-side only (in Astro frontmatter)
- `REACT_STRAPI_URL` — public URL passed as props to React components
- `PUBLIC_*` — available everywhere (Matomo, cookie consent)

### Docker naming convention
- All containers use `jib-` prefix (jib = Journées Innovation Bois)
- Network: `jib-network`
- Images: `jib-strapi`, `jib-web`

## Build & Deploy

```bash
make build          # Build Docker images
make lint           # Lint Dockerfiles
make stage          # Push to registry
./infra/deploy/scripts/deploy.sh <local|dev|prod> up
```

## Practices

Read `.claude/practices.md` for the index of all practice docs. Key docs:
- `ai/STRAPI_PRACTICES.md` — Strapi content types, controllers, config, bootstrap
- `ai/ASTRO_PRACTICES.md` — Pages, components, hydration, API client, Tailwind v4
- `ai/INFRA_PRACTICES.md` — Docker, deployment, Makefiles, environment management
