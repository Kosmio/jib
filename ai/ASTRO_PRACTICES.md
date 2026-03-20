# Astro 6 + React 19 Frontend Practices

This guide covers patterns and conventions for the Astro SSR frontend with React components and Tailwind CSS v4.

---

## Architecture Overview

The frontend is a server-rendered Astro application with selective client-side interactivity via React components:

- **Astro pages** handle routing, data fetching, and server rendering
- **Astro components** render static HTML (headers, footers, cards, heroes)
- **React components** handle client-side interactivity (forms, paginated lists)
- **Tailwind CSS v4** provides styling via utility classes

```
web/
├── astro.config.mjs           # Astro + Vite config (SSR, React, Tailwind)
├── src/
│   ├── styles/app.css         # Tailwind v4 theme (@theme block)
│   ├── layouts/Layout.astro   # Base HTML layout (head, scripts, header/footer)
│   ├── components/            # Astro components (static, server-rendered)
│   ├── react-components/      # React components (client-hydrated)
│   ├── pages/                 # File-based routing
│   │   ├── index.astro
│   │   ├── 404.astro
│   │   ├── contact.astro
│   │   └── articles/
│   │       ├── index.astro
│   │       └── [slug].astro
│   └── lib/
│       ├── strapi.ts          # API client (server + client helpers)
│       └── types.ts           # TypeScript interfaces for API data
└── public/                    # Static assets (favicons, vendored scripts)
```

---

## SSR Pages

All pages are server-rendered. There is no static generation (`getStaticPaths` is not used).

### Data fetching pattern

Fetch data in the frontmatter block. The code runs on the server at request time:

```astro
---
import { getArticles } from "../lib/strapi";

const articles = await getArticles({ limit: 6, start: 0 });
---

<Layout title="Home">
  {articles?.data?.map((article) => (
    <Card title={article.title} slug={article.slug} />
  ))}
</Layout>
```

### Dynamic routes

Dynamic routes use `[param].astro` files. Read the param from `Astro.params`:

```astro
---
const { slug } = Astro.params;
const response = await getArticleBySlug(slug);
const article = response?.data?.[0];

if (!article) {
  return Astro.redirect("/404");
}
---
```

**Rules:**
- Never use `getStaticPaths()` — the app is fully SSR
- Always handle missing data with `Astro.redirect("/404")`
- Fetch only what the page needs (use pagination, filters)

---

## Astro Components vs React Components

### When to use Astro components

Use `.astro` files for components that:
- Render static HTML with no client-side interactivity
- Accept props and produce markup
- Don't need state, effects, or event handlers beyond simple inline scripts

Examples: `Header.astro`, `Footer.astro`, `Hero.astro`, `Card.astro`, `Button.astro`

### When to use React components

Use `.tsx` files for components that:
- Need `useState`, `useEffect`, or other React hooks
- Handle forms with validation and submission
- Manage client-side pagination or filtering
- Need to fetch data from the browser (not the server)

Examples: `ContactForm.tsx`, `ArticleList.tsx`, `MarkdownContent.tsx`

### Client hydration

React components must be explicitly hydrated with a client directive:

```astro
<ContactForm client:visible strapiUrl={strapiUrl} />
```

**Directives:**
- `client:visible` — hydrate when the component enters the viewport (preferred for below-the-fold content)
- `client:load` — hydrate immediately on page load (use sparingly, only for above-the-fold interactive content)

**Rules:**
- Default to `client:visible` unless the component must be interactive immediately
- Pass all data React components need as props — they cannot access `import.meta.env` server vars
- Keep React components focused on interactivity; rendering logic that doesn't need state belongs in Astro

---

## API Client (`src/lib/strapi.ts`)

### Server-side vs client-side

There are two fetch paths, because server and browser have different access:

**Server-side** (used in `.astro` frontmatter):
```ts
const strapiFetch = (targetUrl: string) =>
  fetch(`${import.meta.env.STRAPI_URL}/api${targetUrl}`, {
    headers: { Authorization: `Bearer ${import.meta.env.STRAPI_KEY}` },
  }).then((res) => res.json());
```
- Uses `STRAPI_URL` (server-only, can be internal Docker hostname)
- Uses `STRAPI_KEY` (secret, never sent to browser)

**Client-side** (used in React components):
```ts
const clientFetch = (url: string, key: string, targetUrl: string) =>
  fetch(`${url}/api${targetUrl}`, {
    headers: { Authorization: `Bearer ${key}` },
  }).then((res) => res.json());
```
- Receives URL and key as props from the Astro page
- Uses `REACT_STRAPI_URL` (public URL the browser can reach)

**Rules:**
- Never import `STRAPI_URL` or `STRAPI_KEY` in React components
- Pass `REACT_STRAPI_URL` and `STRAPI_KEY` from Astro pages as props when React needs API access
- `PUBLIC_*` env vars are available everywhere; non-prefixed vars are server-only

### Strapi v5 response types

Types reflect the flat v5 response format (no `attributes` wrapper):

```ts
export interface Entity {
  id: number;
  documentId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export type Article = Entity & {
  title: string;
  slug: string;
  content: string;
  image: Image | null;  // direct object, not { data: Image }
};
```

**Rules:**
- Access fields directly: `article.title`, not `article.attributes.title`
- Access media directly: `article.image?.url`, not `article.image?.data?.attributes?.url`
- Use `documentId` for stable identification across Strapi operations

---

## Tailwind CSS v4

### Configuration

Tailwind v4 uses CSS-based configuration instead of a JS config file. The theme is defined in `src/styles/app.css`:

```css
@import "tailwindcss";

@theme {
  --color-primary: #404F9D;
  --color-secondary: #ED751D;
  --color-gray-light: #F7F8FA;
  --font-sans: "Poppins", sans-serif;
  --breakpoint-sm: 480px;
  /* ... */
}
```

The Vite plugin handles everything — no `postcss.config.js` or `tailwind.config.js` needed:

```js
// astro.config.mjs
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  vite: { plugins: [tailwindcss()] },
});
```

### Dynamic classes

When Tailwind classes are constructed dynamically (e.g., `bg-${color}`), they won't be detected by the scanner. Force their inclusion with `@source inline()`:

```css
@source inline("bg-secondary bg-white bg-primary hover:text-primary text-white");
```

**Rules:**
- Define all theme values in `src/styles/app.css` under `@theme`
- Do not create `tailwind.config.js` or `postcss.config.js` — they are not used with TW4
- Import `../styles/app.css` in `Layout.astro` to load the theme
- When using dynamic class strings in component props, add them to `@source inline()`
- Prefer static class names over dynamic construction where possible

---

## Layout & Component Patterns

### Layout

`Layout.astro` is the single base layout. It handles:
- HTML boilerplate (lang, meta, fonts, favicon)
- Global CSS import (`src/styles/app.css`)
- Third-party scripts (Matomo) — conditionally loaded based on env vars
- Header and Footer components
- Cookie consent script

### Parameterized components

Astro components accept typed props via `export interface Props`:

```astro
---
export interface Props {
  title: string;
  bgColor?: string;
}

const { title, bgColor = "bg-primary" } = Astro.props;
---

<div class={bgColor}>{title}</div>
```

**Rules:**
- Use `export interface Props` for type safety
- Provide defaults for optional props
- Avoid deep prop drilling — if a component needs data, fetch it in the page and pass it down

### Inline scripts

For small interactivity (toggles, form submissions), use `<script>` tags in Astro components:

```astro
<script>
  document.getElementById('toggle')?.addEventListener('click', () => {
    document.getElementById('menu')?.classList.toggle('hidden');
  });
</script>
```

For scripts that need server-side values, use `define:vars`:

```astro
<script define:vars={{ apiUrl: import.meta.env.STRAPI_URL }}>
  fetch(apiUrl + '/api/something');
</script>
```

---

## Naming Conventions

| Element | Pattern | Example |
|---|---|---|
| Astro page | `kebab-case.astro` | `contact.astro`, `[slug].astro` |
| Astro component | `PascalCase.astro` | `Header.astro`, `Hero.astro` |
| React component | `PascalCase.tsx` | `ContactForm.tsx`, `ArticleList.tsx` |
| Lib module | `camelCase.ts` | `strapi.ts`, `types.ts` |
| CSS file | `kebab-case.css` | `app.css` |
| Static asset | `kebab-case` | `cookieconsent.js` |

### Directory conventions

- `src/components/` — Astro-only components (no React)
- `src/react-components/` — React components that need client hydration
- `src/pages/` — File-based routes (each file = a URL)
- `src/lib/` — Shared utilities and API client
- `src/layouts/` — Base layout(s)
- `src/styles/` — Global CSS and Tailwind theme
- `public/` — Static files served as-is (no processing)
