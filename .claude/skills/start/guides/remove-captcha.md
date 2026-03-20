# Remove or Replace Captcha (Altcha)

This removes the Altcha proof-of-work captcha system. If replacing with another captcha, follow the removal steps then implement the new provider.

**Impact:** Contact form and newsletter will have no bot protection unless replaced.

## Directories to Delete

- `strapi/src/api/captcha/` (entire folder: routes, controllers, services)

## Files to Modify

### `strapi/package.json`
- Remove dependency: `altcha-lib`

### `strapi/config/server.js`
- Remove the `captcha` block:
  ```js
  captcha: { hmacKey: env('ALTCHA_HMAC_KEY') },
  ```

### `strapi/src/index.js`
- Remove from `setPublicPermissions` array: `{ api: 'captcha', actions: ['challenge'] }`

### `strapi/src/api/contact/controllers/contact.js`
- Remove the captcha verification block (the lines that call `strapi.service('api::captcha.captcha').verify(captchaToken)` and return 403)
- Remove `captchaToken` from the destructured request body

### `strapi/src/api/newsletter/controllers/newsletter.js`
- Remove the captcha verification block (same pattern as contact)
- Remove `captchaToken` from the destructured request body

### `web/package.json`
- Remove dependency: `altcha`

### `web/src/components/Footer.astro`
- Remove the `strapiUrl` variable (if only used for altcha challengeurl)
- Remove the `<altcha-widget>` element from the newsletter form
- Remove the `<script>import 'altcha';</script>` block
- In the newsletter submission script: remove `captchaToken: formData.get('altcha')` from the fetch body

### `web/src/react-components/ContactForm.tsx`
- Remove `altchaToken` state and `altchaRef` ref
- Remove the `useEffect` that imports `altcha`
- Remove the `useEffect` that listens for `statechange`
- Remove `captchaToken` from the POST body
- Remove all `altchaRef.current?.reset?.()` calls
- Remove the `<altcha-widget>` JSX element

### Environment variables to remove
- `ALTCHA_HMAC_KEY` from:
  - `strapi/.env.example`
  - `infra/deploy/base/docker-compose.base.yml` (strapi service env)
  - `infra/deploy/overlays/local/.env.local`
  - `infra/deploy/overlays/dev/.env.dev`
  - `infra/deploy/overlays/prod/.env.prod`

## Replacing with Another Captcha

If replacing Altcha with a different captcha provider:

1. Complete all removal steps above
2. Install the new provider's server-side library in `strapi/package.json`
3. Create a new `strapi/src/api/captcha/` with:
   - `routes/captcha.js` — endpoint(s) the frontend needs (if any)
   - `controllers/captcha.js` — challenge generation (if applicable)
   - `services/captcha.js` — a `verify(token)` function
4. Re-add captcha verification in contact and newsletter controllers
5. Install the frontend widget/SDK in `web/package.json`
6. Add the widget to `ContactForm.tsx` and `Footer.astro` (newsletter form)
7. Add the new provider's env vars to all `.env` files
8. Update `strapi/src/index.js` to set public permissions for new captcha routes
