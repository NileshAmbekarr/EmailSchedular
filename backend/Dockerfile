# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Copied separately so a dependency-free source change reuses the npm layer.
COPY package*.json ./
RUN npm ci

COPY tsconfig.json drizzle.config.ts ./
COPY src ./src
RUN npm run build

# Drop dev dependencies from the tree that ships.
RUN npm prune --omit=dev

# ---- runtime --------------------------------------------------------------
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Never run the process as root.
RUN addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --chown=app:app drizzle ./drizzle

USER app
EXPOSE 3001

# Uses the readiness endpoint, so a container with a dead database is reported
# unhealthy instead of merely "running".
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://localhost:3001/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
