# Project Practices — Journées de l'Innovation Filière Bois

## Practice docs to read

Read these files before writing or reviewing code. They define the project's conventions:

- `ai/STRAPI_PRACTICES.md` — Strapi v5 backend patterns (content types, controllers, routes, config, bootstrap)
- `ai/ASTRO_PRACTICES.md` — Astro 6 + React 19 frontend patterns (pages, components, hydration, API client)
- `ai/INFRA_PRACTICES.md` — Docker, deployment, and infrastructure patterns

## Key rules

- All Strapi config is environment-driven: secrets and URLs come from env vars, never hardcoded
- Strapi v5 API responses are flat: fields directly on the object, no `attributes` wrapper
- Use `strapi.documents()` (Document Service), not the deprecated `entityService`
- Astro pages are server-rendered (SSR): no `getStaticPaths`, fetch data directly in frontmatter
- React components hydrate client-side via `client:visible` — keep them minimal, pass data as props
- Tailwind v4 uses CSS-based config (`@theme` in `src/styles/app.css`), not `tailwind.config.js`
- Server-side env vars (`STRAPI_URL`, `STRAPI_KEY`) are never exposed to the client
- Client-side env vars use `PUBLIC_` prefix or are passed as props from Astro pages
- Infrastructure follows the base + overlay pattern: one base docker-compose, per-environment overrides
- In local dev, only Postgres runs in Docker; Strapi and web run on the host via `pnpm develop`/`pnpm dev`
