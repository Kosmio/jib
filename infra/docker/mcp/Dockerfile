# ---> Build stage
FROM node:22-alpine AS build

ENV CI=true
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY ./strapi/mcp /app

RUN pnpm install --frozen-lockfile

# ---> Runtime stage
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=build /app /app

EXPOSE 3100

WORKDIR /app
ENV NODE_ENV=production

CMD ["node", "index.js"]
