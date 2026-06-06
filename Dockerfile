# syntax=docker/dockerfile:1

# ---- build stage ----
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage ----
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Production dependencies only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled output + the knowledge base (read at runtime).
COPY --from=build /app/dist ./dist
COPY src/kb ./src/kb

# auth_state/ (Baileys creds) and data/ (SQLite) are provided as volumes so they
# survive container rebuilds — see docker-compose.yml.
CMD ["node", "dist/index.js"]
