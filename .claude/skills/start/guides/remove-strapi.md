# Remove Strapi (Go Pure Static Astro)

This removes the entire Strapi backend, PostgreSQL database, and all dynamic content fetching. The result is a pure static Astro site with hardcoded content.

**Impact:** This is the most significant removal. All features that depend on Strapi (articles, contact form, newsletter, captcha) are also removed.

## Dependencies to Handle First

If not already removed, these features must be removed first (or simultaneously):
- Articles → `remove-articles.md`
- Contact Form → `remove-contact.md`
- Newsletter → `remove-newsletter.md`
- Captcha → `remove-captcha.md`
- Brevo → `remove-brevo.md`

## Directories to Delete

- `strapi/` (entire folder)
- `infra/docker/strapi/` (Strapi Dockerfile)

## Files to Delete

- `infra/make/make_strapi.mk`
- `ai/STRAPI_PRACTICES.md`
- `web/src/lib/strapi.ts` (API client)
- `web/src/lib/types.ts` (Strapi types)
- `web/src/pages/articles/index.astro`
- `web/src/pages/articles/[slug].astro`
- `web/src/pages/contact.astro`
- `web/src/react-components/ArticleList.tsx`
- `web/src/react-components/MarkdownContent.tsx`
- `web/src/react-components/ContactForm.tsx`

## Files to Modify

### `web/astro.config.mjs`
- Change `output: "server"` to `output: "static"`
- Remove `adapter: node({ mode: "standalone" })` and the `@astrojs/node` import

### `web/package.json`
- Remove dependencies: `altcha`, `react-markdown`
- Remove dependency: `@astrojs/node`

### `web/src/components/Header.astro`
- Remove "Articles" and "Contact" from the navigation links array

### `web/src/components/Footer.astro`
- Remove `strapiUrl` variable and all `REACT_STRAPI_URL` / `STRAPI_URL` references
- Remove the entire Newsletter section (heading, form, altcha widget, alerts)
- Remove the newsletter submission script
- Remove the `import 'altcha'` script
- Remove "Articles" and "Contact" links from footer navigation

### `web/src/pages/index.astro`
- Remove `getArticles` import and call
- Remove the "Latest Articles" section
- Remove article-related CTA buttons
- Remove feature cards that reference Strapi, Contact, Newsletter
- Adapt the hero content to be generic static site content

### `infra/deploy/base/docker-compose.base.yml`
- Remove the `postgres` service entirely
- Remove the `strapi` service entirely
- Remove `depends_on: strapi` from the web service
- Remove all Strapi/email/captcha environment variables from web service
- Remove the postgres volume

### `infra/deploy/overlays/local/docker-compose.override.yml`
- Remove postgres volume mount
- Remove strapi service override

### `infra/deploy/overlays/dev/docker-compose.override.yml`
- Remove postgres and strapi service overrides

### `infra/deploy/overlays/prod/docker-compose.override.yml`
- Remove postgres and strapi service overrides

### All `.env` overlay files (`local/.env.local`, `dev/.env.dev`, `prod/.env.prod`)
- Remove all `STRAPI_*`, `EMAIL_*`, `ALTCHA_*`, `DATABASE_*`, `APP_KEYS`, `JWT_SECRET`, `ADMIN_JWT_SECRET`, `API_TOKEN_SALT`, `TRANSFER_TOKEN_SALT` variables

### `web/.env.example`
- Remove `STRAPI_URL` and `REACT_STRAPI_URL`

### `Makefile`
- Remove all `strapi` targets (build-strapi, stage-strapi, etc.)
- Remove infrastructure targets (infra-up, infra-down) if they only managed postgres

### Documentation
- `CLAUDE.md` — rewrite to reflect pure static Astro project
- `README.md` — rewrite setup instructions (no database, no Strapi)
- `.claude/practices.md` — remove Strapi practices reference

## Post-Removal

- The `infra/docker/website/Dockerfile` can remain for containerized deployment of the static Astro site
- Consider switching Astro to `output: "static"` with pre-rendering for better performance
- Remove `@astrojs/node` adapter if switching to static
