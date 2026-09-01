# syntax=docker/dockerfile:1

# One image, two roles. Render (or Compose) picks the role by overriding the
# command: `node dist/index.js` for the API, `node dist/worker.js` for workers.

# ---- build ----------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Build tooling (typescript, tsx) lives in devDependencies. Render sets
# NODE_ENV=production on its build environment, which makes npm skip
# devDependencies entirely — `tsc` then resolves to whatever global TypeScript
# the image happens to ship, which is how a TS7 "baseUrl has been removed"
# error appears in a project pinned to TS 5. Force a full install here.
ENV NODE_ENV=development

# Separate layer so a source-only change reuses the cached npm install.
COPY package*.json ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Reinstall without dev dependencies for the runtime layer.
RUN npm ci --omit=dev

# ---- runtime --------------------------------------------------------------
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Render injects PORT; this is only the local/Compose default.
ENV PORT=3001

# dumb-init reaps zombies and forwards SIGTERM to node, which is what makes
# graceful shutdown work — without it the worker is SIGKILLed on every deploy
# and leaves messages stranded in `processing`.
RUN apk add --no-cache dumb-init \
    && addgroup -S app \
    && adduser -S app -G app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/package.json ./package.json

# Migrations are applied by `node dist/db/migrate.js`, which reads these.
COPY --chown=app:app drizzle ./drizzle

# chmod here rather than relying on the git executable bit, which does not
# survive a checkout on Windows.
COPY --chown=app:app docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

USER app
EXPOSE 3001

# Render ignores this and uses its own health check path (/ready); it is here
# for Compose and plain `docker run`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The entrypoint applies migrations (unless RUN_MIGRATIONS=false) and then
# execs the command below, so platform overrides stay simple argv with no shell
# metacharacters — Render's command parsing does not handle a quoted
# `sh -c "a && b"` string.
ENTRYPOINT ["dumb-init", "--", "/app/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
