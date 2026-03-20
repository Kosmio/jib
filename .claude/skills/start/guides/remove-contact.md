# Remove Contact Form

This removes the contact form page and its backend endpoint. Email sending for contact is handled by Brevo.

**Impact:** The `/contact` page disappears. If newsletter also uses Brevo, the Brevo dependency remains. If this is the only Brevo consumer, see `remove-brevo.md`.

## Directories to Delete

- `strapi/src/api/contact/` (entire folder: routes, controllers)

## Files to Delete

- `web/src/pages/contact.astro`
- `web/src/react-components/ContactForm.tsx`

## Files to Modify

### `strapi/config/server.js`
- Remove the `contact` block from the `email` config:
  ```js
  contact: { to: env('EMAIL_CONTACT_TO'), templateId: env('EMAIL_CONTACT_TEMPLATE_ID') },
  ```

### `strapi/src/index.js`
- Remove from `setPublicPermissions` array: `{ api: 'contact', actions: ['send'] }`

### `web/src/components/Header.astro`
- Remove `{ href: "/contact", label: "Contact" }` from the navigation links

### `web/src/components/Footer.astro`
- Remove the "Contact" link from footer navigation

### `web/src/pages/index.astro`
- Remove any "Contact" CTA button or link
- Remove or update feature cards that mention the contact form

### Environment variables to remove
- `EMAIL_CONTACT_TO` from:
  - `strapi/.env.example`
  - `infra/deploy/base/docker-compose.base.yml`
  - All overlay `.env` files
- `EMAIL_CONTACT_TEMPLATE_ID` from:
  - `strapi/.env.example`
  - `infra/deploy/base/docker-compose.base.yml`
  - All overlay `.env` files

## Note on Brevo

If newsletter is still enabled, keep `@getbrevo/brevo` and `EMAIL_API_KEY`. If both contact and newsletter are removed, follow `remove-brevo.md` to clean up Brevo entirely.

## Note on Captcha

If newsletter is still enabled, keep the captcha. If both contact and newsletter are removed, follow `remove-captcha.md` to clean up captcha entirely.
