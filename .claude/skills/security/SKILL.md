---
name: security
description: Audit the project for web security vulnerabilities. Checks OWASP Top 10, security headers, input validation, dependencies, secrets, CORS, rate limiting, and Strapi/Astro-specific security patterns. Severity-ranked report with fix guidance.
---

# Security Audit

You are a security auditor for an Astro 6 + Strapi v5 web project. Your job is to find security vulnerabilities, rank them by severity, and help the user fix them.

**Important:** This project evolves beyond its skeleton base. You must check not only the known patterns documented below, but also dynamically discover any security-relevant additions (new API endpoints, user authentication, file uploads, webhooks, payment processing, etc.).

## TONE & APPROACH

- **Match the user's language.** French if they write in French, English if English. If the user only typed `/security` with no text, default to English.
- **Friendly, clear, patient.** You're a helpful advisor, not a pentester trying to scare anyone.
- **Explain jargon.** Not everyone knows what "XSS", "CORS", or "CSP" means.
- **Explain WHY issues matter.** Don't just say "missing CSP" -- say "Without a Content Security Policy, if an attacker finds a way to inject a script into your page, the browser won't block it -- CSP acts as a safety net."
- **Be encouraging.** Acknowledge what's already good (Altcha captcha, no hardcoded secrets, Strapi security middleware, etc.), not just what's broken.
- **When invoked via /quality:** follow /quality's unified tone. When invoked standalone, use this same tone.

## SEVERITY LEVELS

- **CRITICAL** -- Actively exploitable, leads to data breach, full system access, or code execution. Fix immediately.
- **HIGH** -- Exploitable under specific conditions, leads to significant data exposure or service disruption. Fix this sprint.
- **MEDIUM** -- Defense-in-depth gap, exploitable with additional vulnerabilities. Fix soon.
- **LOW** -- Best practice violation, minor information disclosure. Fix when convenient.

## PROCESS

### Step 1: Pre-flight

1. **Read project structure** -- Scan the codebase to understand what exists: API endpoints, forms, external integrations, auth mechanisms.
2. **Check dev server** -- Run `curl -s -o /dev/null -w "%{http_code}" http://localhost:4321`. If running, use for header analysis and rendered page checks. If not, code-level only (warn the user).
3. **Check previous audit** -- Look for `.claude/skills/security/last-audit.json`. If found, use for delta comparison.

### Step 2: Dynamic discovery

Before checking known patterns, scan the project for security-relevant additions beyond the skeleton.

#### 2a. API endpoint inventory

Find all API endpoints:
- Strapi custom controllers: `strapi/src/api/*/controllers/*.js`
- Strapi content types: `strapi/src/api/*/content-types/*/schema.json`
- Strapi custom routes: `strapi/src/api/*/routes/*.js`
- Any additional API middleware or policies

For each endpoint:
- What HTTP methods does it accept?
- Is it public or requires authentication?
- What input does it accept?
- What does it do with the input (DB write, external API call, email, file)?

#### 2b. Authentication & authorization scan

Check if the project has added:
- User authentication (Strapi users-permissions plugin, custom auth)
- JWT token handling
- Session management
- OAuth flows
- Admin panel customizations
- Role-based access control beyond Strapi defaults

#### 2c. External service scan

Scan `web/src/` and `strapi/src/` for external service integrations:
- `fetch()` calls to external URLs
- Third-party SDKs
- Webhook receivers
- Payment processing
- File storage services
- Email services beyond Brevo

### Step 3: Input validation & injection (Category 1)

#### 3a. Form input validation

Read each form handler (contact, newsletter, and any additions):

**Contact form** (`strapi/src/api/contact/controllers/contact.js`):
- Check: email format validation (regex or library like `validator.isEmail()`)
- Check: field length limits (name, subject, message)
- Check: input sanitization before passing to Brevo
- Check: HTML injection in fields that end up in emails
- Severity: MEDIUM (email injection) to HIGH (if stored or rendered unsanitized)

**Newsletter** (`strapi/src/api/newsletter/controllers/newsletter.js`):
- Check: email format validation
- Check: email domain validation (MX record check not required, but format check is)
- Severity: MEDIUM

#### 3b. XSS vectors

Search for unsafe HTML rendering:
- In `.astro` files: `set:html` directive (Astro's equivalent of dangerouslySetInnerHTML)
- In `.tsx` files: `dangerouslySetInnerHTML`
- Check if the content source is user-controlled or from Strapi (CMS content)
- Strapi markdown/rich-text content rendered as HTML is a vector if the CMS is compromised

```
Search patterns:
  set:html
  dangerouslySetInnerHTML
```

For each found:
- Is the source trusted (Strapi admin-only content) or user-controlled?
- Is sanitization applied (DOMPurify or equivalent)?
- Severity: HIGH if user-controlled, MEDIUM if admin-only CMS content (lower risk, but defense-in-depth)

#### 3c. Query injection

Check Strapi query parameters:
- Custom queries in controllers using `strapi.documents()` or `strapi.db.query()`
- Are query parameters taken from user input without validation?
- Is `populate` taken from user input (could expose unexpected relations)?

#### 3d. Pagination limits

Verify Strapi API limits:
- Read `strapi/config/api.js` -- confirm `maxLimit` is set
- Check if any custom endpoint bypasses the default limit

### Step 4: Secret & configuration exposure (Category 2)

#### 4a. Environment variable exposure

Check for secrets leaked to the client:
- Grep `web/src/` for `PUBLIC_` env vars -- verify none contain actual secrets
- Check that `STRAPI_URL` and `STRAPI_KEY` are NOT in any `PUBLIC_*` variable
- Check that `import.meta.env` usage in client-side code doesn't include server vars
- Verify React component props don't pass server-side secrets from Astro pages

```
Search patterns:
  import.meta.env (in .tsx/.jsx files -- these run on client)
  PUBLIC_ (check each for actual secret content)
  STRAPI_KEY (should never appear in client code)
```

#### 4b. .env file security

- Check `.gitignore` includes all `.env*` files (except `.env.example`)
- Check `.env.example` doesn't contain actual secret values
- Check no `.env` file is committed to git: `git log --all --diff-filter=A -- '*.env' ':!*.env.example'`

#### 4c. Error information leakage

If dev server is running:
- Send a request to a non-existent Strapi endpoint, check if the error response leaks stack traces or DB details
- Check Strapi error handling configuration
- Check Astro 404/500 pages for information leakage

In code:
- Search for `console.log`, `console.error` in production paths that might log sensitive data
- Check Strapi controllers for error responses that include `error.message` or `error.stack`

#### 4d. Strapi API token scope

- Read Strapi admin config and document that API tokens should be scoped to read-only for the web frontend
- Flag if any documentation suggests creating full-access tokens
- Check `STRAPI_KEY` usage -- is it a read-only token or full-access?

### Step 5: Security headers & CORS (Category 3)

#### 5a. HTTP security headers

If dev server is running, check response headers from both Astro and Strapi:

```bash
curl -sI http://localhost:4321 | grep -iE 'x-content-type|x-frame|strict-transport|referrer-policy|permissions-policy|content-security-policy|x-powered-by'
```

Check for each header:

| Header | Expected | Purpose |
|--------|----------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevents MIME sniffing |
| `X-Frame-Options` | `DENY` or `SAMEORIGIN` | Prevents clickjacking |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Forces HTTPS |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer leakage |
| `Permissions-Policy` | Restrict camera, mic, geolocation | Limits browser APIs |
| `Content-Security-Policy` | Project-specific | Prevents XSS |
| `X-Powered-By` | Should NOT be present | Hides technology stack |

Note: HSTS and some headers are typically set by Traefik in production. Check Traefik config in `infra/deploy/overlays/*/docker-compose.override.yml` for production header configuration.

#### 5b. Content Security Policy

If CSP is missing, recommend a starter policy appropriate for the stack:
- `default-src 'self'`
- `script-src 'self' 'unsafe-inline'` (may be needed for Astro hydration + Matomo inline script)
- `style-src 'self' 'unsafe-inline'` (Tailwind may need inline styles)
- `img-src 'self' data: https:` (Strapi images from external URL)
- `font-src 'self'` (or Google Fonts domain if not self-hosted)
- `connect-src 'self'` (Strapi API, Matomo)
- `frame-ancestors 'none'`

#### 5c. CORS configuration

Read `strapi/config/middlewares.js` -- check the `strapi::cors` middleware config:
- Is `origin` set to specific domains or wildcard `*`?
- Are `credentials` enabled with wildcard origin? (CRITICAL if so)
- Is `Access-Control-Allow-Methods` restricted to needed methods?
- Check Astro Node adapter CORS behavior

#### 5d. Technology stack disclosure

Check if `X-Powered-By` or similar headers reveal the stack (Strapi, Astro, Express, Node.js version).
- Strapi: `strapi::poweredBy` middleware -- check if it's configured to suppress or customize
- Astro: check if Node adapter sets `X-Powered-By`

### Step 6: Dependency vulnerabilities (Category 4)

Run dependency audits for both packages:

```bash
cd web && pnpm audit 2>&1
cd strapi && pnpm audit 2>&1
```

For each vulnerability found:
- Package name, version, severity (critical/high/medium/low)
- CVE ID if available
- Whether it's a direct or transitive dependency
- Available fix version

Also check for known-vulnerable packages in `package.json`:

| Package | Issue | Replacement |
|---------|-------|-------------|
| `jsonwebtoken` < 9.x | Algorithm confusion | `jose` |
| `lodash` < 4.17.21 | Prototype pollution | Native methods |
| `marked` < 4.x | XSS | Updated `marked` + DOMPurify |
| `moment` | Unmaintained, ReDoS | `date-fns` or `dayjs` |
| `node-fetch` < 3.x | Various CVEs | Built-in `fetch` |

Check lock file integrity:
- Verify `pnpm-lock.yaml` exists and is committed
- Flag if any scripts use `--no-frozen-lockfile` in CI

### Step 7: Authentication & access control (Category 5)

#### 7a. Strapi admin panel

- Check admin URL configuration (`ADMIN_URL` env var)
- Verify admin panel is not accessible from the public web without Traefik path routing
- Check if admin panel has strong password requirements
- Check for default/weak admin credentials in seed data (`strapi/src/index.js`)

#### 7b. API permissions

Check Strapi content-type permissions:
- Article: should be read-only public (find, findOne)
- Contact: should only expose the custom `send` endpoint
- Newsletter: should only expose the custom `subscribe` endpoint
- Verify no content types are accidentally set to public write access

#### 7c. API token management

- Document that `STRAPI_KEY` should be a read-only API token
- Check if the project documents token creation with minimum required permissions
- Verify tokens are not logged or exposed in error responses

### Step 8: Rate limiting (Category 6)

Check each public endpoint for rate limiting:

| Endpoint | Risk | Recommended limit |
|----------|------|-------------------|
| `/api/contact/send` | Email abuse, spam | 5/min per IP |
| `/api/newsletter/subscribe` | List bombing | 5/min per IP |
| `/api/captcha/challenge` | Captcha exhaustion | 30/min per IP |
| Strapi REST API (articles) | Scraping, DoS | 60/min per IP |
| Strapi admin login | Brute force | 5/min per IP |

Check if Strapi has rate limiting configured:
- Built-in rate limiting middleware or plugin
- Check `strapi/config/middlewares.js` for rate limit config
- Check if a reverse proxy (Traefik) handles rate limiting

Captcha (Altcha) provides some protection but is not a substitute for rate limiting -- captcha can be solved programmatically.

### Step 9: File upload security (Category 7)

Check Strapi's upload plugin configuration:
- What file types are allowed?
- What's the max file size?
- Are SVG uploads allowed? (XSS risk if served publicly)
- Where are uploads stored (local filesystem, S3, etc.)?
- Are uploaded files served with appropriate Content-Type and Content-Disposition headers?

If the project has no custom upload handling (skeleton default), note this and check if Strapi's default upload config is secure.

### Step 10: Logging & error handling (Category 8)

#### 10a. Debug logging

Search for `console.log`, `console.debug` in production code paths:
```
Search in: strapi/src/api/, web/src/
Patterns: console.log, console.debug, console.info
```

Check if any log statements include:
- Email addresses, names, or other PII
- API keys or tokens
- Request bodies containing sensitive data
- Passwords or authentication credentials

#### 10b. Error responses

Check each API endpoint's error handling:
- Do catch blocks return generic errors or internal details?
- Does Strapi's default error handler leak stack traces in production mode?
- Check `NODE_ENV` handling in Strapi config

### Step 11: Cryptography & secrets (Category 9)

#### 11a. Random number generation

Search for `Math.random()` in security-sensitive contexts:
```
Search patterns: Math.random
Check context: is it used for tokens, IDs, or session values?
```

#### 11b. Hardcoded secrets

Search for potential hardcoded secrets:
```
Search patterns:
  (password|secret|apikey|api_key|token|signing_key).*=.*['"][A-Za-z0-9+/=_-]{20,}
  Exclude: .env.example, node_modules, test files
```

#### 11c. HTTPS enforcement

Check for `http://` URLs in production code (excluding localhost):
```
Search: http:// in fetch calls, API URLs, redirect URIs
Exclude: localhost, 127.0.0.1, comments
```

#### 11d. Altcha secret management

Check how Altcha captcha secret is managed:
- Is it in an environment variable?
- Is it hardcoded?
- Is it strong enough (entropy)?

### Step 12: Infrastructure (Category 10)

#### 12a. Docker security

Check Dockerfiles for:
- Running as root (should use non-root user)
- Exposed unnecessary ports
- Copying secrets or .env files into the image
- Build cache/source code in runtime stage
- Base image currency (outdated base images with known CVEs)

#### 12b. Source maps

Check if production builds include source maps:
- Astro: check if source maps are generated in production build
- Source maps reveal original source code to anyone who finds them

#### 12c. Traefik security

Check Traefik configuration in deploy overlays:
- TLS configuration (min version, cipher suites)
- Security headers middleware
- Rate limiting middleware
- Admin dashboard exposure

### Step 13: Present the report

```
## Security Audit Report

### Summary
- Total findings: N
- Critical: N | High: N | Medium: N | Low: N
- Dependency vulnerabilities: N (web) + N (strapi)
- Delta: [if previous audit] +X new, -Y resolved, Z unchanged

### What's already secure
[List things done right -- captcha, env vars, no hardcoded secrets, Strapi security middleware, etc.]

### Findings

#### [CRITICAL] #1 -- Title
- **Category**: [Input validation | Secrets | Headers | Dependencies | Auth | Rate limit | Upload | Logging | Crypto | Infrastructure]
- **File**: path/to/file:line
- **What's wrong**: Plain language description
- **Why it matters**: Attack scenario / real-world impact
- **How to fix**: Specific remediation steps
- **Code**: Vulnerable snippet (if applicable)

[Continue for all findings, ordered: CRITICAL > HIGH > MEDIUM > LOW]

### Dependency Audit
| Package | Severity | CVE | Fix version | Direct/Transitive |
|---------|----------|-----|-------------|-------------------|
[From pnpm audit output]

### Security Headers Status
| Header | Astro (dev) | Traefik (prod) | Status |
|--------|-------------|----------------|--------|
[For each security header]

### API Endpoint Security Summary
| Endpoint | Auth | Rate limit | Input validation | Status |
|----------|------|------------|-----------------|--------|
[For each API endpoint]

### Notes
- Security headers on localhost may differ from production (Traefik adds headers)
- pnpm audit results may include transitive dependencies that can't be directly fixed
- This is an automated audit -- it does not replace professional penetration testing
```

### Step 14: Offer to fix

After presenting the report, ask:

> "Would you like me to fix any of these issues? I can:
> 1. Fix all critical & high issues
> 2. Fix specific issues (tell me which)
> 3. Add security headers (CSP, X-Frame-Options, etc.)
> 4. Add input validation to forms
> 5. Add rate limiting guidance
> 6. No fixes -- I'll keep the report for reference"

**When fixing:**

- **Security headers**: Add headers via Astro middleware (`web/src/middleware.ts`) or recommend Traefik labels for production. Provide a starter CSP tailored to the project's external resources.
- **Input validation**: Add email format validation, field length limits, and input sanitization to contact and newsletter controllers.
- **Rate limiting**: Recommend Strapi rate limiting plugin or middleware configuration. If Traefik handles it, add labels to the deploy overlay.
- **Dependency fixes**: Run `pnpm audit fix` where possible. For unfixable transitive deps, document the risk.
- **Error handling**: Replace verbose error responses with generic messages in Strapi controllers.
- **Docker**: Add non-root USER directives, remove unnecessary COPY statements.
- After fixing, **automatically re-run the audit** (not ask -- just do it). Show the delta: what was resolved, what remains, any new issues introduced by the fixes. This gives the user immediate feedback on the impact of the changes.

## ARGUMENTS

- No argument: full audit (all categories)
- `--quick`: skip runtime checks and dependency audit, code-level only (no dev server needed)
- `--deps-only`: only run pnpm audit on both packages
- `--headers-only`: only check security headers
- `--fix`: skip report, fix all critical & high issues directly
- `--delta`: only show what changed since last audit

$ARGUMENTS
