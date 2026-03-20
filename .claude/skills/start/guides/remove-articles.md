# Remove Articles / Blog

This removes the articles feature — the blog listing page, individual article pages, and the Strapi article content type.

**Impact:** No blog/articles section on the site. Strapi remains for other features (contact, newsletter). If you're removing Strapi entirely, use `remove-strapi.md` instead.

## Directories to Delete

- `strapi/src/api/article/` (entire folder: content-types, routes, controllers)

## Files to Delete

- `web/src/pages/articles/index.astro`
- `web/src/pages/articles/[slug].astro`
- `web/src/react-components/ArticleList.tsx`
- `web/src/react-components/MarkdownContent.tsx`
- `web/src/components/Card.astro`

## Files to Modify

### `strapi/src/index.js`
- Remove from `setPublicPermissions` array: `{ api: 'article', actions: ['find', 'findOne'] }`
- Remove the entire article seeding block (the code that creates demo articles on first boot)

### `web/src/lib/strapi.ts`
- Remove `getArticles()`, `getArticle()`, and `getArticlesWithPagination()` functions
- Remove any article-related type imports
- Keep the file if other API functions remain (e.g., for future content types)

### `web/src/lib/types.ts`
- Remove the `Article` type and `Image` type (if only used by articles)
- Keep `Entity` base type if used elsewhere

### `web/src/components/Header.astro`
- Remove `{ href: "/articles", label: "Articles" }` from navigation links

### `web/src/components/Footer.astro`
- Remove the "Articles" link from footer navigation

### `web/src/pages/index.astro`
- Remove `getArticles` import and data fetching
- Remove the "Latest Articles" section (article cards grid)
- Remove "Discover articles" CTA button/link
- Remove or update feature cards that mention articles

### `web/package.json`
- Remove dependency: `react-markdown` (if only used by MarkdownContent)

## Note

The Strapi article content type is defined via the admin panel and stored in `strapi/src/api/article/content-types/`. Deleting this folder removes the content type. If Strapi has already been run and the database exists, the database table will remain but be unused.
