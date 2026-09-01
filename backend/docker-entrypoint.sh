#!/bin/sh
set -e

# Container entrypoint.
#
# Migrations run here rather than in the platform command, because Render free
# services do not support preDeployCommand and its argv parsing mangles a
# quoted `sh -c "... && ..."` string.
#
# Set RUN_MIGRATIONS=false on any service that should not migrate — notably a
# separate worker, so two services never race the same migration.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "entrypoint: applying migrations"
  node dist/db/migrate.js
fi

# exec replaces this shell so the process receiving SIGTERM is node itself.
# Without it the shell swallows the signal, graceful shutdown never runs, and
# in-flight sends are killed on every deploy.
exec "$@"
