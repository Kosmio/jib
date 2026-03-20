# Remove or Replace Analytics (Matomo)

This removes the Matomo analytics tracking script. Analytics is completely independent from other features.

**Impact:** No visitor tracking. No other features are affected.

## Files to Modify

### `web/src/layouts/Layout.astro`
- Remove the entire conditional Matomo script block:
  ```astro
  {import.meta.env.PUBLIC_MATOMO_URL && import.meta.env.PUBLIC_MATOMO_SITE_ID && (
    <script define:vars={{ ... }}>
      ...matomo tracking code...
    </script>
  )}
  ```

### `web/.env.example`
- Remove `PUBLIC_MATOMO_URL`
- Remove `PUBLIC_MATOMO_SITE_ID`
- Remove the comment `# Analytics (Matomo) - leave empty to disable`

### `infra/deploy/base/docker-compose.base.yml`
- Remove from web service environment:
  - `PUBLIC_MATOMO_URL`
  - `PUBLIC_MATOMO_SITE_ID`

### All overlay `.env` files
- Remove `PUBLIC_MATOMO_URL` and `PUBLIC_MATOMO_SITE_ID` from:
  - `infra/deploy/overlays/local/.env.local`
  - `infra/deploy/overlays/dev/.env.dev`
  - `infra/deploy/overlays/prod/.env.prod`

### `web/src/pages/index.astro`
- Remove or update feature cards that mention analytics

## Replacing with Another Analytics Provider

If replacing Matomo with a different provider:

1. Complete the removal steps above
2. Add the new tracking script to `web/src/layouts/Layout.astro` in the `<head>` section
3. Gate it behind environment variables (follow the same pattern: check if vars exist before rendering)
4. Add the new env vars to `web/.env.example`, docker-compose, and all overlay `.env` files
5. If the new provider uses cookies, consider enabling the cookie consent banner (see `remove-cookie-consent.md` — reverse the steps)
