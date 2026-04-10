# Infrastructure Practices

This guide covers Docker, deployment, and operational patterns for the skeleton project.

---

## Architecture Overview

The project uses Docker Compose with a **base + overlay** pattern for multi-environment deployments:

```
infra/
├── deploy/
│   ├── base/
│   │   └── docker-compose.base.yml     # All services defined once
│   ├── overlays/
│   │   ├── local/                      # Local dev (Postgres only)
│   │   │   ├── docker-compose.override.yml
│   │   │   └── .env.local
│   │   ├── dev/                        # Dev deployment
│   │   │   ├── docker-compose.override.yml
│   │   │   └── .env.dev
│   │   └── prod/                       # Production
│   │       ├── docker-compose.override.yml
│   │       └── .env.prod
│   └── scripts/
│       └── deploy.sh                   # Unified deployment script
├── docker/
│   ├── strapi/Dockerfile               # Strapi multi-stage build
│   └── website/Dockerfile              # Astro multi-stage build
└── make/
    ├── make_strapi.mk                  # Strapi build targets
    └── make_web.mk                     # Web build targets
```

---

## Reverse Proxy (Traefik)

Traefik v3 serves as the reverse proxy for all deployed environments (dev, prod). It handles:
- **TLS termination** via Let's Encrypt ACME (HTTP challenge)
- **Single-domain routing**: web serves `/`, Strapi serves `/strapi`, MCP serves `/mcp` — all via path prefix
- **HTTP→HTTPS redirect** for all traffic
- **Auto-discovery** of services via Docker labels

### How routing works

Traefik is defined in `docker-compose.base.yml` with ACME configuration. In the environment overlays, each service gets Traefik labels:

- **Strapi**: `Host(hostname) && PathPrefix(/strapi)` → strip `/strapi` prefix → forward to port 1337
- **MCP**: `Host(hostname) && PathPrefix(/mcp)` → strip `/mcp` prefix → forward to port 3100
- **Web**: `Host(hostname)` → forward to port 80

This means a single domain serves the frontend, CMS, and MCP. Example:
- `https://your-domain.com/` → Astro frontend
- `https://your-domain.com/strapi/api/articles` → Strapi REST API
- `https://your-domain.com/strapi/admin` → Strapi admin panel
- `https://your-domain.com/mcp` → MCP server (AI content management)

### Configuration

Traefik-related env vars:
- `TRAEFIK_VERSION` — Traefik image version (default: `v3.6.1`)
- `ACME_EMAIL` — email for Let's Encrypt certificate notifications
- `HOST_NAME` — the domain name for routing rules

**In local development**, Traefik is disabled (`profiles: [disabled]`). Strapi and web run directly on the host.

---

## Base + Overlay Pattern

### Base compose

`docker-compose.base.yml` defines all services once with their full configuration. Overlays only add or override what changes per environment.

**Rules:**
- Every service must include `platform: linux/amd64` for consistent builds
- The network must be `external: true` (created by `deploy.sh`, not by compose)
- Use `${VARIABLE}` substitution for anything that changes between environments (image tags, passwords, URLs)
- Version tags, registry URLs, and all secrets come from the overlay's `.env.*` file

### Overlay conventions

Each environment directory has:
- `docker-compose.override.yml` — service overrides (ports, volumes, restart policies, resource limits)
- `.env.<env>` — environment variables for that deployment

**Local overlay:**
- Only Postgres runs in Docker
- Strapi and web are disabled (`profiles: [disabled]`) — they run on the host via `pnpm`
- Postgres data mounts to `~/DockerVolumes/<project>/postgres` for persistence across rebuilds
- Ports are bound to `0.0.0.0` (accessible from host)

**Dev overlay:**
- All services run in Docker
- `version: '3.8'` header (required for some Docker Compose versions)
- Named volumes for data persistence
- `restart: unless-stopped`
- Postgres bound to `127.0.0.1:5432` (localhost only)

**Prod overlay:**
- All services run in Docker
- `restart: always`
- Memory limits on all services (e.g., postgres 2G, strapi 1G, web 1G)
- Named volumes
- Postgres bound to `127.0.0.1:5432`

---

## Dockerfiles

### Multi-stage builds

Both services use multi-stage Dockerfiles to minimize image size:

```dockerfile
# Build stage: install deps and build
FROM node:20-alpine as build
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY ./<service> /app
RUN pnpm install
# ... build step

# Runtime stage: copy built output only
FROM node:20-alpine
COPY --from=build /app /app
```

**Rules:**
- Use `node:20-alpine` for Strapi (lightweight, native deps compile fine on Alpine)
- Use `node:20-bullseye` for web if native dependencies need glibc (otherwise Alpine is fine)
- Always enable pnpm via corepack in both stages
- `EXPOSE` the correct port (1337 for Strapi, 80 for web)
- Set `NODE_ENV` via build arg, not hardcoded

### Web production command

The Astro Node.js adapter produces a standalone server:

```dockerfile
CMD ["node", "dist/server/entry.mjs"]
```

Set `HOST=0.0.0.0` and `PORT=80` as environment variables so the server binds correctly in Docker.

---

## Deployment Script

`deploy.sh` is the single entry point for all deployment operations:

```bash
./infra/deploy/scripts/deploy.sh <environment> <action> [options]
```

**Environments:** `local`, `dev`, `prod`

**Actions:**
| Action | Description |
|---|---|
| `up` | Create network if needed, start services |
| `down` | Stop and remove containers |
| `logs` | Follow container logs |
| `ps` | Show service status |
| `pull` | Pull latest images |
| `restart` | Restart services |
| `config` | Show merged compose config |
| `validate` | Validate compose YAML |
| `kill` | Force kill containers and networks |

**Options:**
- `--skip-services postgres,strapi` — exclude services from the action

**Rules:**
- The script creates the Docker network if it doesn't exist
- Always use `deploy.sh` rather than raw `docker compose` commands — it handles file merging and network creation
- Each environment's `.env.*` file is loaded automatically

---

## Makefiles

The root `Makefile` delegates to per-service makefiles:

```make
# Root Makefile
include infra/make/make_strapi.mk
include infra/make/make_web.mk

infra-up:
	./infra/deploy/scripts/deploy.sh local up
```

### Per-service targets

Each `make_*.mk` provides:

| Target | Description |
|---|---|
| `lint` | Lint Dockerfile with hadolint |
| `build` | Build Docker image |
| `stage` | Tag and push to registry |

Images are tagged with the version from `VERSION` at the project root.

**Rules:**
- Version is managed in a single `VERSION` file at the root — all makefiles read from it
- Registry URL comes from the environment overlay's `.env.*` file
- Hadolint must pass before any image is pushed

---

## Environment Variables & Secrets

### Separation of concerns

- `.env.example` files document all variables with placeholder values — always committed
- `.env.<env>` files contain non-secret environment config — committed
- `.env.secrets` files contain actual secrets — never committed (in `.gitignore`)
- The deploy script merges env files at runtime

### Gitignore patterns

```gitignore
/.env*                                    # Root env files
infra/deploy/overlays/*/.env.secrets      # Per-environment secrets
infra/deploy/overlays/*/.env.*.merged     # Merged env files (generated)
```

**Rules:**
- Never commit actual secrets (API keys, passwords, JWT secrets)
- Always provide `.env.example` with descriptive placeholder values
- Use `changeme`, `your-*`, or empty strings as placeholders
- Document which variables are required vs optional

---

## Versioning

The project version is stored in `VERSION` at the root:

```
0.1.0
```

This version is used for:
- Docker image tags
- Compose service image references (`${DOCKER_REGISTRY_REPOSITORY}skeleton-strapi:${SKELETON_VERSION}`)

Bump this file when releasing a new version. All makefiles and compose files derive their version from it.

---

## Local Development Workflow

```bash
# 1. Start infrastructure (Postgres)
make infra-up

# 2. Start Strapi (in strapi/ directory)
pnpm develop

# 3. Start Astro dev server (in web/ directory)
pnpm dev

# Strapi: http://localhost:1337 (admin: /admin)
# Web:    http://localhost:4321
```

**Rules:**
- In local, Strapi and web always run on the host — never in Docker
- Postgres runs in Docker with a host volume so data persists
- The web `.env` points `STRAPI_URL` to `http://localhost:1337`
- The web `.env` points `REACT_STRAPI_URL` to `http://localhost:1337` (same in local, different in prod)
