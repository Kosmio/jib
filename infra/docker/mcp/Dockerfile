# ---> Build stage
FROM node:24-alpine AS build

ENV CI=true
RUN corepack enable
WORKDIR /app

COPY ./strapi/mcp /app

RUN pnpm install --frozen-lockfile

# ---> Runtime stage
FROM node:24.22.1-alpine

RUN corepack enable

COPY --from=build /app /app

EXPOSE 3100

WORKDIR /app
ENV NODE_ENV=production

CMD ["node", "index.js"]
