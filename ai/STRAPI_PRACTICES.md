# Strapi v5 Backend Practices

This guide covers patterns and conventions for the Strapi v5 backend. Follow these strictly when creating or modifying content types, controllers, routes, and configuration.

---

## Architecture Overview

Strapi serves as a headless CMS exposing a REST API. The backend has three roles:

1. **Content management** — CRUD for structured data (articles, etc.) via auto-generated REST endpoints
2. **Custom actions** — Thin controllers for side-effects (sending emails, subscribing to newsletters)
3. **Bootstrap** — Auto-configuration on startup (locale setup, seed data)

```
strapi/
├── config/                  # Environment-driven configuration
│   ├── server.js            # Server, email, captcha config
│   ├── database.js          # Database connection
│   ├── admin.js             # Admin panel secrets
│   ├── middlewares.js        # Middleware stack
│   └── api.js               # REST API defaults
├── src/
│   ├── index.js             # Bootstrap lifecycle (register + bootstrap)
│   └── api/
│       └── {collection}/
│           ├── content-types/{collection}/schema.json
│           ├── controllers/{collection}.js
│           ├── routes/{collection}.js
│           └── services/{collection}.js
└── .env                     # Local environment variables (never committed)
```

---

## Content Types

### Schema definition

Content type schemas live in `src/api/{name}/content-types/{name}/schema.json`.

```json
{
  "kind": "collectionType",
  "collectionName": "articles",
  "info": {
    "singularName": "article",
    "pluralName": "articles",
    "displayName": "Article"
  },
  "options": {
    "draftAndPublish": true
  },
  "attributes": {
    "title": { "type": "string", "required": true },
    "slug": { "type": "uid", "targetField": "title" },
    "content": { "type": "richtext" },
    "image": { "type": "media", "multiple": false, "allowedTypes": ["images"] }
  }
}
```

**Rules:**
- Always include a `slug` field of type `uid` targeting the title for URL-friendly identifiers
- Use `draftAndPublish: true` for content that should go through a review workflow
- Media fields: set `multiple: false` unless the use case genuinely requires multiple files
- Keep schemas lean — avoid storing derived or computed data

### Standard CRUD endpoints

For standard collections, use Strapi factories. Do not write custom CRUD logic:

```js
// controllers/{collection}.js
const { createCoreController } = require('@strapi/strapi').factories;
module.exports = createCoreController('api::article.article');

// routes/{collection}.js
const { createCoreRouter } = require('@strapi/strapi').factories;
module.exports = createCoreRouter('api::article.article');

// services/{collection}.js
const { createCoreService } = require('@strapi/strapi').factories;
module.exports = createCoreService('api::article.article');
```

This generates GET (list, findOne), POST, PUT, DELETE endpoints automatically with filtering, pagination, and population.

---

## Custom Controllers

For actions that are not CRUD (sending emails, subscribing to lists), use custom controllers with custom routes.

### Pattern

```js
// controllers/contact.js
module.exports = {
  send: async (ctx) => {
    // 1. Validate input
    if (!ctx.request.body.email || !ctx.request.body.message) {
      return ctx.send({ message: 'invalid content' }, 400);
    }

    // 2. Read config from strapi.config.get() — never hardcode
    const apiKey = strapi.config.get('server.email.apiKey');

    // 3. Perform action
    try {
      await someExternalCall(apiKey, ctx.request.body);
      ctx.send({ message: 'success' }, 200);
    } catch {
      ctx.send({ message: 'error' }, 500);
    }
  },
};
```

```js
// routes/contact.js
module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/contact/send',
      handler: 'contact.send',
      config: { policies: [], middlewares: [] },
    },
  ],
};
```

**Rules:**
- Custom controllers are thin: validate, call external service, return response
- Business logic that grows beyond a few lines should move to the service file
- Always read secrets from `strapi.config.get('server.*')` — config is defined in `config/server.js`
- Return consistent response shapes: `{ message: string }` with appropriate HTTP status codes
- Service files can remain empty stubs until logic is needed

---

## Configuration

### Environment-driven config

All configuration comes from environment variables. The `config/server.js` file maps env vars to a structured config object:

```js
module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('BASE_URL', 'http://localhost:1337'),
  app: { keys: env.array('APP_KEYS') },
  // Custom config sections accessed via strapi.config.get('server.email.*')
  email: {
    apiKey: env('EMAIL_API_KEY'),
    listId: env('EMAIL_LIST_ID'),
  },
});
```

**Rules:**
- Never hardcode URLs, API keys, or credentials in source code
- Group related config under named sections (`email`, `captcha`)
- Use `env()` for strings, `env.int()` for numbers, `env.array()` for comma-separated lists
- Provide sensible defaults only for non-sensitive values (host, port)
- Document all required env vars in `.env.example`

### Database config

- Default to PostgreSQL (`DATABASE_CLIENT=postgres`)
- Default `DATABASE_HOST` to `localhost` for local development (not `postgres` — that's the Docker container name)
- Keep `useNullAsDefault: true` for SQLite compatibility

### Admin config

- `transfer.token.salt` is required in Strapi v5 — always include it
- Do not set `url` in admin config; the admin URL derives from `server.url`

---

## Bootstrap & Lifecycle

The `src/index.js` file exposes two hooks:

- `register()` — runs before Strapi is fully loaded (for custom fields, middlewares)
- `bootstrap()` — runs after Strapi is loaded (for seeding data, configuring plugins)

### Seeding data

```js
async bootstrap({ strapi }) {
  // Use Document Service API (v5), not entityService (deprecated)
  const articles = await strapi.documents('api::article.article').findMany({ limit: 1 });
  if (articles.length === 0) {
    for (const article of SEED_DATA) {
      await strapi.documents('api::article.article').create({
        data: article,
        status: 'published',  // publishes immediately
      });
    }
  }
}
```

**Rules:**
- Always use `strapi.documents()` (Document Service API) — `entityService` is deprecated in v5
- To publish on creation, pass `status: 'published'`
- Guard seed operations with existence checks to prevent duplicates on restart
- Use `strapi.plugin('i18n').service('locales')` for locale management

---

## Strapi v5 API Response Format

Strapi v5 returns flat objects — there is no `attributes` wrapper:

```json
{
  "data": [
    {
      "id": 1,
      "documentId": "abc123",
      "title": "My Article",
      "slug": "my-article",
      "image": { "id": 1, "url": "/uploads/photo.jpg", "alternativeText": "..." },
      "createdAt": "...",
      "updatedAt": "...",
      "publishedAt": "..."
    }
  ],
  "meta": { "pagination": { "page": 1, "pageSize": 25, "pageCount": 1, "total": 1 } }
}
```

Key differences from v4:
- Fields are directly on the object (no `data[].attributes.title` — just `data[].title`)
- Media fields return the object directly (no `image.data.attributes.url` — just `image.url`)
- `documentId` (string) is the stable identifier; numeric `id` is internal
- Pagination meta is unchanged

---

## External Service Integration

### Brevo SDK v5

The `@getbrevo/brevo` v5 SDK uses a client-based API:

```js
const { BrevoClient } = require('@getbrevo/brevo');
const client = new BrevoClient({ apiKey: strapi.config.get('server.email.apiKey') });

// Send transactional email
await client.transactionalEmails.sendTransacEmail({ templateId, to, replyTo, params });

// Create contact in list
await client.contacts.createContact({ email, listIds: [listId] });
```

### Altcha (captcha)

Anti-bot protection uses Altcha, a self-hosted proof-of-work solution (MIT, GDPR-friendly, no third-party):
- The `captcha` API exposes `GET /api/captcha/challenge` to generate challenges
- The `captcha` service provides `verify(token)` using `altcha-lib`
- Config: `ALTCHA_HMAC_KEY` env var (single secret, no API keys needed)
- When `ALTCHA_HMAC_KEY` is not set, captcha verification is skipped

---

## Naming Conventions

| Element | Pattern | Example |
|---|---|---|
| Content type directory | `kebab-case` | `src/api/article/` |
| Schema file | `schema.json` | `content-types/article/schema.json` |
| Controller/Route/Service | `{collection}.js` | `controllers/article.js` |
| Custom route handler | `{noun}.{verb}` | `contact.send`, `newsletter.subscribe` |
| Env variable | `SCREAMING_SNAKE` | `EMAIL_API_KEY` |
| Config section | `camelCase` | `server.email.apiKey` |

---

## MCP Server Maintenance

The MCP server (`strapi/mcp/`) exposes Strapi content types as tools for AI agents (Claude, ChatGPT, Gemini, Cursor, etc.), allowing clients to manage their website content through chat.

### The maintenance contract

`strapi/mcp/content-types.json` is the mapping between Strapi schemas and MCP tool descriptions. It defines which content types the MCP knows about, their fields, and human-readable descriptions.

**Any change to `strapi/src/api/*/content-types/*/schema.json` must be reflected in `strapi/mcp/content-types.json`.**

### When adding a new content type

Add an entry to `content-types.json` with:
- The plural API name as the key (e.g. `"projects"`)
- `singularName`, `displayName`, `description`
- `draftAndPublish` flag matching the schema
- All fields with their `type`, `required` flag, and a `description` written for non-technical users

Example:
```json
{
  "projects": {
    "singularName": "project",
    "displayName": "Project",
    "description": "Portfolio projects showcased on the website",
    "draftAndPublish": true,
    "fields": {
      "title": { "type": "string", "required": true, "description": "Project title" },
      "slug": { "type": "uid", "description": "URL-friendly identifier (auto-generated from title)" }
    }
  }
}
```

### When modifying fields

Update the corresponding field entry in `content-types.json`. If a field is renamed, added, or removed in the schema, do the same in the config.

### When removing a content type

Remove its entry from `content-types.json`.

### Field descriptions

Write descriptions that help the AI agent understand the field's purpose and constraints. Include where it's used on the site, any limits, and behavioral notes:
- Good: `"Short summary shown in article list cards and meta descriptions, plain text, keep under 200 chars"`
- Good: `"URL-friendly identifier auto-generated from title — do not set manually"`
- Bad: `"Text field"` (too vague — the agent won't know what it's for)

### Why this matters

The MCP server is part of the skeleton and ships to real projects. If `content-types.json` drifts from the actual schema, the AI agent will give clients wrong information about their content — or fail silently. Treat this file with the same care as the schema itself.
