# ---> Build stage
FROM node:20-alpine as build

ENV CI=true
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN mkdir -p /app

WORKDIR /app

# Copy our Strapi folder into /app
COPY ./strapi /app

ENV PATH /app/node_modules/.bin:$PATH

# Install dependencies in /app
RUN pnpm install

# For production build
ENV NODE_ENV=${NODE_ENV}

FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=build /app /app

EXPOSE 1337

WORKDIR /app
ENV NODE_ENV=${NODE_ENV}

CMD ["/bin/sh", "-c", "pnpm build; pnpm start"]
