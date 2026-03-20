# Remove Cookie Consent Banner Entirely

This permanently removes the cookie consent system from the codebase. Only do this if you're certain the project will never need cookie consent (i.e., no third-party cookies will ever be set).

**Current state:** The banner is already disabled by default (gated behind `PUBLIC_COOKIE_CONSENT` env var). This guide is for removing the code entirely, not just disabling it.

**Impact:** None on functionality — the banner is already off by default. This just removes dead code.

## Files to Delete

- `web/public/assets/cookieconsent.js`
- `web/public/assets/cookieconsent.css`

## Files to Modify

### `web/src/layouts/Layout.astro`
- Remove the conditional CSS link:
  ```astro
  {import.meta.env.PUBLIC_COOKIE_CONSENT === "true" && (
    <link rel="stylesheet" type="text/css" href="/assets/cookieconsent.css" />
  )}
  ```
- Remove the conditional JS script:
  ```astro
  {import.meta.env.PUBLIC_COOKIE_CONSENT === "true" && (
    <script defer src="/assets/cookieconsent.js"></script>
  )}
  ```

### `web/src/components/Footer.astro`
- Remove the `cookieConsent` variable: `const cookieConsent = import.meta.env.PUBLIC_COOKIE_CONSENT === "true";`
- Remove the conditional "Gestion des cookies" button:
  ```astro
  {cookieConsent && (
    <button type="button" data-cc="c-settings" class="hover:text-gray-300 transition-colors">
      Gestion des cookies
    </button>
  )}
  ```

### `web/.env.example`
- Remove `PUBLIC_COOKIE_CONSENT`
- Remove the comment `# Cookie consent banner - set to "true" to enable`

## Note

If you later need cookie consent (e.g., adding Google Analytics or advertising pixels), you'll need to re-implement it. Consider keeping the code disabled (`remove nothing`) if there's any chance you'll need it.
