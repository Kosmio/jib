# Remove Newsletter

This removes the newsletter subscription form and its backend endpoint. Subscriber management is handled by Brevo.

**Impact:** The newsletter form in the footer disappears. If contact form also uses Brevo, the Brevo dependency remains.

## Directories to Delete

- `strapi/src/api/newsletter/` (entire folder: routes, controllers)

## Files to Modify

### `strapi/src/index.js`
- Remove from `setPublicPermissions` array: `{ api: 'newsletter', actions: ['subscribe'] }`

### `web/src/components/Footer.astro`
- Remove the entire "Newsletter" section: heading, description, alert divs, form (with altcha widget)
- Remove the `<script>import 'altcha';</script>` block (if contact form is also removed)
- Remove the entire newsletter form submission `<script define:vars>` block
- Remove `strapiUrl` variable (if only used by newsletter form)
- Adjust the footer grid: change `grid md:grid-cols-3` to `grid md:grid-cols-2` (only Brand + Navigation remain)

### `web/src/pages/index.astro`
- Remove or update feature cards that mention newsletter

### Environment variables to remove
- `EMAIL_LIST_ID` from:
  - `strapi/.env.example`
  - `infra/deploy/base/docker-compose.base.yml`
  - All overlay `.env` files

## Note on Brevo

If contact form is still enabled, keep `@getbrevo/brevo` and `EMAIL_API_KEY`. If both are removed, follow `remove-brevo.md`.

## Note on Captcha

If contact form is still enabled, keep captcha. If both contact and newsletter are removed, follow `remove-captcha.md`.
