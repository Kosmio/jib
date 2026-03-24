# ---> Build stage
FROM node:20-bullseye AS node-build

ENV CI=true
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /usr/src/app
COPY ./web /usr/src/app/

# Install ALL deps (including devDependencies needed for build)
RUN pnpm install --frozen-lockfile

# Build needs env vars for Astro config (site URL for sitemap)
ENV NODE_ENV=production
RUN pnpm build

# ---> Serve stage
FROM node:20-alpine AS node-server
ENV NODE_ENV=production
COPY --from=node-build /usr/src/app/dist /usr/share/web/html/dist
COPY --from=node-build /usr/src/app/package.json /usr/share/web/html/package.json
COPY --from=node-build /usr/src/app/pnpm-lock.yaml /usr/share/web/html/pnpm-lock.yaml
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /usr/share/web/html
RUN pnpm install --prod --frozen-lockfile
CMD ["/bin/sh", "-c", "HOST=0.0.0.0 PORT=80 node dist/server/entry.mjs"]
