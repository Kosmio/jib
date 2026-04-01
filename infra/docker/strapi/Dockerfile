# ---> Build stage
FROM node:22-alpine as build

ENV CI=true
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY ./strapi /app

ENV PATH /app/node_modules/.bin:$PATH

RUN pnpm install

ARG NODE_ENV=production
ARG ADMIN_URL=/admin
ENV NODE_ENV=${NODE_ENV}
ENV ADMIN_URL=${ADMIN_URL}

RUN pnpm build

# ---> Runtime stage
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=build /app /app

EXPOSE 1337

WORKDIR /app
ENV NODE_ENV=production

CMD ["pnpm", "start"]
