# ---> Build stage
FROM node:24-alpine AS build

ENV CI=true
RUN corepack enable
WORKDIR /app

COPY ./strapi /app

ENV PATH /app/node_modules/.bin:$PATH

RUN pnpm install

ARG NODE_ENV=production
ARG ADMIN_URL=/strapi/admin
ARG STRAPI_ADMIN_BACKEND_URL=/strapi
ENV NODE_ENV=${NODE_ENV}
ENV ADMIN_URL=${ADMIN_URL}
ENV STRAPI_ADMIN_BACKEND_URL=${STRAPI_ADMIN_BACKEND_URL}

RUN pnpm build

# ---> Runtime stage
FROM node:24.22.1-alpine

COPY --from=build /app /app

EXPOSE 1337

WORKDIR /app
ENV NODE_ENV=production

CMD ["node_modules/.bin/strapi", "start"]
