# syntax=docker/dockerfile:1

# 1) Build the web SPA.
FROM node:20-alpine AS web-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY web ./web
RUN npm run build --workspace web

# 2) Install production-only node_modules for the server workspace only
#    (no dev deps, no PGlite, no web runtime deps).
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --omit=dev -w server

# 3) Runtime image: server source + migrations + built SPA + prod deps.
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=80 \
    MIGRATIONS_DIR=/app/server/migrations \
    STATIC_DIR=/app/web/dist
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY --from=deps /app/node_modules ./node_modules
COPY server/src ./server/src
COPY server/migrations ./server/migrations
COPY --from=web-build /app/web/dist ./web/dist
EXPOSE 80
CMD ["node_modules/.bin/tsx", "server/src/server.ts"]
