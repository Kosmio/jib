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
- Traefik handles reverse proxy with TLS: single domain, web on `/`, Strapi on `/strapi`
- CI/CD via GitHub Actions: `dev.yml` builds/pushes images, `deploy.yml` does SSH remote deployment
- Secrets are never in env files: `.env.secrets` is created at deploy time from GitHub secrets, merged, then deleted
- Run `/quality` for a unified quality audit (accessibility, SEO, eco-design, GDPR). Reports saved to `reports/quality/`.
- Run `/accessibility` to audit pages for WCAG 2.1 AA compliance (axe-core + jsx-a11y)
- Run `/seo` to audit pages for SEO best practices (meta tags, OG, structured data, CWV, sitemap, robots.txt)
- Run `/ecoconception` to audit environmental impact (EcoIndex, carbon footprint, GreenIT best practices, RGESN)
- Run `/gdpr` to audit for GDPR compliance (cookies, analytics, forms, third-party services, privacy policy)
- Run `/security` to audit for web security vulnerabilities (OWASP, headers, dependencies, input validation)
- Run `/setup-deploy` to set up deployment infrastructure (secrets, GitHub config, env files)
- Run `/deploy` to deploy the application to dev or prod via GitHub Actions
- When modifying Strapi content types, always update `strapi/mcp/content-types.json` to match — see `ai/STRAPI_PRACTICES.md` § MCP Server Maintenance
