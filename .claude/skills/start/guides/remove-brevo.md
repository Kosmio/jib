# Remove or Replace Brevo (Email Service)

This removes the Brevo email SDK. Only do this if both contact form and newsletter are removed, or if replacing Brevo with another email provider.

**Impact:** No emails can be sent (contact form) and no subscribers can be added to mailing lists (newsletter).

## Prerequisites

Both consumers must be handled first:
- Contact form → removed or adapted to new provider
- Newsletter → removed or adapted to new provider

## Files to Modify

### `strapi/package.json`
- Remove dependency: `@getbrevo/brevo`

### `strapi/config/server.js`
- Remove the entire `email` block:
  ```js
  email: {
    apiKey: env('EMAIL_API_KEY'),
    listId: env('EMAIL_LIST_ID'),
    contact: { to: env('EMAIL_CONTACT_TO'), templateId: env('EMAIL_CONTACT_TEMPLATE_ID') },
  },
  ```

### Environment variables to remove
- `EMAIL_API_KEY` from:
  - `strapi/.env.example`
  - `infra/deploy/base/docker-compose.base.yml`
  - All overlay `.env` files
- `EMAIL_LIST_ID` (if not already removed with newsletter)
- `EMAIL_CONTACT_TO` (if not already removed with contact)
- `EMAIL_CONTACT_TEMPLATE_ID` (if not already removed with contact)

## Replacing with Another Email Provider

If replacing Brevo with a different provider:

1. Complete the removal steps above
2. Install the new provider's SDK in `strapi/package.json`
3. Update `strapi/config/server.js` with the new provider's config keys
4. Rewrite `strapi/src/api/contact/controllers/contact.js` to use the new SDK for sending emails
5. Rewrite `strapi/src/api/newsletter/controllers/newsletter.js` to use the new SDK for managing subscribers
6. Add the new provider's env vars to all `.env` files and docker-compose
