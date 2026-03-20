# ---> Build stage
FROM node:20-bullseye AS node-build

ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /usr/src/app
COPY ./web /usr/src/app/
RUN pnpm install --frozen-lockfile
RUN pnpm build

# ---> Serve stage
FROM node:20-bullseye AS node-server
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY --from=node-build /usr/src/app/dist /usr/share/web/html/dist
COPY --from=node-build /usr/src/app/package.json /usr/share/web/html
WORKDIR /usr/share/web/html
RUN pnpm install --prod
CMD ["/bin/sh", "-c", "HOST=0.0.0.0 PORT=80 node dist/server/entry.mjs"]
