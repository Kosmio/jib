---
name: setup-deploy
description: Interactive wizard to set up deployment infrastructure — generates secrets, configures GitHub secrets/variables/environments, creates env files. Run this before your first deployment.
---

# Deployment Setup

You are an interactive deployment setup wizard. Your job is to prepare everything needed for the CI/CD pipeline to deploy the application — generate secrets, create local `.env` files, configure GitHub repository secrets, variables, and environments.

After running this skill, the user should be able to run `/deploy` and ship.

## TONE & APPROACH

- **Match the user's language.** If they write in French, respond in French. If in English, respond in English. If the user only typed `/setup-deploy` with no text, default to English.
- **Friendly, clear, patient.** This is a wizard, not a terminal.
- **Explain what each secret/variable is for** in plain language. Not everyone knows what a "JWT secret" or "API token salt" is.
- **Non-technical users should be able to follow along.** Don't assume knowledge of GitHub Actions, SSH, or Docker.

## BEFORE YOU START

### 1. Detect GitHub tooling

You need a way to interact with GitHub (set secrets, variables, environments). Two options:

1. Run `which gh` to check for the GitHub CLI.
   - If found, check authentication: `gh auth status`
   - If not authenticated: ask the user to run `! gh auth login` (the `!` prefix runs it in the current session)
2. If `gh` is not found, check if GitHub MCP tools are available (look for tools starting with `mcp__github__`)
3. If neither is available: recommend installing `gh` (`brew install gh` on macOS), explain it's a one-time setup. Let the user choose when they're ready.

Store which tool to use for all subsequent GitHub operations.

### 2. Read project state

- Read `infra/deploy/base/.env.base` to get `PROJECT_SLUG` and `DOCKER_REGISTRY_REPOSITORY`
- Read `infra/deploy/overlays/dev/.env.dev` and `infra/deploy/overlays/prod/.env.prod` to see current placeholder values
- Read `strapi/.env.example` and `web/.env.example` for local env templates
- Read `.github/workflows/deploy.yml` to confirm expected secrets/variables
- Run `git remote get-url origin` to infer GitHub org/repo

### 3. Check what's already configured

- If using `gh`: run `gh secret list` and `gh variable list` to see what's already set
- If using MCP: equivalent API calls
- Report to user: "I found X secrets and Y variables already configured. I'll skip those unless you want to regenerate them."
- Also check CLAUDE.md for a `## Deployment Status` section from a previous run

## WIZARD FLOW

### Step 1: Server setup check

Ask: "Do you have a server ready for deployment?"

> Before we set up the pipeline, you need a server where the application will run. We use Ansible to set up machines with Docker, Traefik, and everything needed.
>
> **If you don't have a server yet**, or need to set one up:
> - Use our Ansible playbook: https://gitlab.kosm.io/infra/ansible-host-setup
> - If you'd rather have someone do it for you, ask Luc -- he'll get your machine ready. Fair warning though: it's gonna cost you a Neipa. And trust me, you don't want to skip the Neipa. Luc will hold a grudge, and you really, *really* don't want him to have a grudge on you.
>
> **If your server is already set up**, let's continue!

Wait for the user to confirm they have a server ready.

If they ask you to run the Ansible playbook yourself, respond:

> I can't run the Ansible playbook myself -- that repository isn't set up for AI yet and we don't want to risk it. Contact Luc, he'll handle it. And don't forget the Neipa.

### Step 2: Server connection details

Ask for:
- **Deploy host** -- IP address or hostname of the server (e.g. `123.45.67.89` or `server.example.com`)

Deploy user is set to `kosmio` by default and SSH port to `2234` -- don't ask about them here. They're standard across our infrastructure.

Explain: "This is the address of your server. The pipeline will connect to it via SSH to deploy the application."

### Step 3: SSH key

We have a shared SSH key for GitHub infrastructure. Check if it's already set up:
- Run `gh secret list` and look for `SSH_PRIVATE_KEY`
- If it exists: good, skip this step entirely.
- If it doesn't: tell the user to ask Luc to set it up. This key is managed centrally, not per-project.

### Step 4: Domain names

Ask for domain names per environment:
- **Dev domain** (e.g. `dev.example.com`) -- if not known yet, keep `dev.your-domain.com` placeholder
- **Prod domain** (e.g. `example.com`) -- if not known yet, keep `your-domain.com` placeholder

Explain: "These domains are used for routing and HTTPS certificates. You can change them later in the env files if you don't have them yet."

If domains are provided, update the overlay env files:
- `infra/deploy/overlays/dev/.env.dev`: `HOST_NAME`, `STRAPI_BASE_URL` (https://{dev_domain}), `STRAPI_PUBLIC_URL` (https://{dev_domain}/strapi)
- `infra/deploy/overlays/prod/.env.prod`: `HOST_NAME`, `STRAPI_BASE_URL` (https://{prod_domain}), `STRAPI_PUBLIC_URL` (https://{prod_domain}/strapi)

### Step 5: Generate secrets

Explain: "I'm going to generate cryptographic secrets for your application. These are random strings that protect your data -- passwords, encryption keys, authentication tokens. Each environment gets its own set so they're fully isolated."

Generate with `openssl rand -hex 32` (each call produces a unique value):

**Per-environment secrets** (generate separate values for dev, prod, AND local):
- `POSTGRES_PASSWORD`
- `STRAPI_APP_KEYS` -- 4 comma-separated keys: run `openssl rand -hex 32` four times, join with commas
- `STRAPI_API_TOKEN_SALT`
- `STRAPI_ADMIN_JWT_SECRET`
- `STRAPI_JWT_SECRET`
- `ALTCHA_HMAC_KEY`

Local development should **never** share secrets with deployed environments.

### Step 6: Optional service credentials

For each optional service, ask if the user has credentials ready. If not, skip -- they can run `/setup-deploy` again later or set them manually.

- **Brevo (email):** API key, contact template ID, mailing list ID, contact-to email address
  - Explain: "Brevo handles sending emails for the contact form and newsletter. You'll need an account at brevo.com to get these values."
- **Matomo (analytics):** URL and site ID
  - Explain: "Matomo tracks website visits. If you have a Matomo instance, I need its URL and your site's ID."

### Step 7: Create local env files

Create `.env` files for local development from the `.env.example` templates:

- **`strapi/.env`** -- from `strapi/.env.example` with:
  - Local secrets — keep them simple and human-readable where possible (e.g. `POSTGRES_PASSWORD=strapi`, `ALTCHA_HMAC_KEY=local-dev-key`). Only use `openssl rand` for secrets that must be cryptographically strong even locally (JWT secrets, APP_KEYS, salts).
  - User-provided values (EMAIL_API_KEY, EMAIL_LIST_ID, EMAIL_CONTACT_TO, EMAIL_CONTACT_TEMPLATE_ID if provided)
  - Keep defaults for HOST, PORT, BASE_URL, DATABASE_* (they're correct for local dev)

- **`web/.env`** -- from `web/.env.example` with:
  - Keep defaults (STRAPI_URL=http://localhost:1337, REACT_STRAPI_URL=http://localhost:1337)
  - User-provided values (PUBLIC_MATOMO_URL, PUBLIC_MATOMO_SITE_ID if provided)

### Step 8: Set GitHub secrets

Explain: "Now I'll store these secrets in your GitHub repository. They're encrypted by GitHub and only accessible to your CI/CD pipeline -- no one can read them, not even repository admins."

Using `gh` CLI or GitHub MCP, set each secret:

**SSH key** is managed by Luc -- don't touch it. Only set it if explicitly asked to.

**Environment-scoped secrets** (different per environment):
```bash
# Dev
gh secret set SECRET_POSTGRES_PASSWORD --env dev --body "{dev_value}"
gh secret set SECRET_STRAPI_APP_KEYS --env dev --body "{dev_value}"
gh secret set SECRET_STRAPI_API_TOKEN_SALT --env dev --body "{dev_value}"
gh secret set SECRET_STRAPI_ADMIN_JWT_SECRET --env dev --body "{dev_value}"
gh secret set SECRET_STRAPI_JWT_SECRET --env dev --body "{dev_value}"
gh secret set SECRET_ALTCHA_HMAC_KEY --env dev --body "{dev_value}"

# Prod
gh secret set SECRET_POSTGRES_PASSWORD --env prod --body "{prod_value}"
gh secret set SECRET_STRAPI_APP_KEYS --env prod --body "{prod_value}"
gh secret set SECRET_STRAPI_API_TOKEN_SALT --env prod --body "{prod_value}"
gh secret set SECRET_STRAPI_ADMIN_JWT_SECRET --env prod --body "{prod_value}"
gh secret set SECRET_STRAPI_JWT_SECRET --env prod --body "{prod_value}"
gh secret set SECRET_ALTCHA_HMAC_KEY --env prod --body "{prod_value}"
```

**Optional secrets** (if values were provided -- set at repository level):
```bash
gh secret set SECRET_EMAIL_API_KEY --body "..."
gh secret set SECRET_EMAIL_CONTACT_TEMPLATE_ID --body "..."
gh secret set SECRET_PUBLIC_MATOMO_URL --body "..."
gh secret set SECRET_PUBLIC_MATOMO_SITE_ID --body "..."
```

### Step 9: Set GitHub variables

```bash
gh variable set DEPLOY_HOST --body "{deploy_host}"
gh variable set DEPLOY_USER --body "kosmio"
gh variable set SSH_PORT --body "2234"
gh variable set EMAIL_LIST_ID --body "{value}"  # if provided
```

### Step 10: Create GitHub environments

```bash
gh api repos/{owner}/{repo}/environments/dev -X PUT
gh api repos/{owner}/{repo}/environments/prod -X PUT
```

Explain: "GitHub environments scope secrets per deployment target — dev and prod each get their own set."

### Step 11: Mark setup as done in CLAUDE.md

Add a `## Deployment Status` section to `CLAUDE.md` (after the "Build & Deploy" section):

```markdown
## Deployment Status

`/setup-deploy` was run on {YYYY-MM-DD}. Deployment infrastructure is configured:
- GitHub secrets: configured (SSH key, Strapi secrets, Postgres password{, optional services if set})
- GitHub variables: configured (DEPLOY_HOST, DEPLOY_USER, SSH_PORT{, EMAIL_LIST_ID if set})
- GitHub environments: dev, prod
- Local env files: strapi/.env, web/.env
```

Update this section on subsequent runs if configuration changes.

### Step 12: Summary

Present a clear summary:

> ## Setup complete!
>
> **Local development:**
> - `strapi/.env` -- ready
> - `web/.env` -- ready
>
> **GitHub secrets:** X configured
> - [list each with checkmark]
>
> **GitHub variables:** X configured
> - [list each with checkmark]
>
> **GitHub environments:** dev, prod
>
> **Still needed:**
> - [list anything skipped -- e.g. "Brevo API key (not provided)", "Matomo (not configured)"]
>
> You're ready to deploy! Run `/deploy` when you want to ship.

## ARGUMENTS

- No argument: interactive mode (full wizard)
- `--check`: only verify what's configured, don't create anything
- `--regenerate`: regenerate all secrets (asks for confirmation -- this will invalidate existing deployments)
- `--local-only`: only create local `.env` files, skip GitHub setup

$ARGUMENTS
