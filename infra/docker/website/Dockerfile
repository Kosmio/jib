# ---> Build stage
FROM node:24-trixie AS node-build

ENV CI=true
RUN corepack enable
WORKDIR /usr/src/app
COPY ./web /usr/src/app/

# Install ALL deps (including devDependencies needed for build)
RUN pnpm install --frozen-lockfile

# Build needs env vars for Astro config (site URL for sitemap)
ENV NODE_ENV=production
RUN pnpm build

# ---> Serve stage
FROM node:24.22.1-alpine AS node-server
ENV NODE_ENV=production
COPY --from=node-build /usr/src/app/dist /usr/share/web/html/dist
COPY --from=node-build /usr/src/app/package.json /usr/share/web/html/package.json
COPY --from=node-build /usr/src/app/pnpm-lock.yaml /usr/share/web/html/pnpm-lock.yaml
COPY --from=node-build /usr/src/app/pnpm-workspace.yaml /usr/share/web/html/pnpm-workspace.yaml
RUN corepack enable
WORKDIR /usr/share/web/html
RUN pnpm install --prod --frozen-lockfile
EXPOSE 80
CMD ["/bin/sh", "-c", "HOST=0.0.0.0 PORT=80 node dist/server/entry.mjs"]
