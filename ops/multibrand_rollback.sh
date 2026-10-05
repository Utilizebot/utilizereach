#!/bin/bash
# Roll a deployment back to the pre-multi-brand release.
#
#   ops/multibrand_rollback.sh <pre-deploy dump> <previous git commit> <saved crontab file>
#
# The multi-brand migration makes brand_id required on every tenant table, so
# the previous code cannot simply run on the migrated database (its inserts
# would fail). A rollback therefore restores the database snapshot taken right
# before the deploy. Anything written after that snapshot (opens, clicks,
# replies, new sends) is lost - export it first if it matters.
#
# For a row-level-security problem only, prefer the lighter switch instead:
#   echo TENANCY_APP_ROLE=off >> .env && docker compose up -d backend celery_worker celery_beat
set -euo pipefail
DUMP=${1:?pre-deploy dump path}
COMMIT=${2:?previous release commit or tag, e.g. <previous-release-commit>}
CRON=${3:?saved crontab file}
cd "$(dirname "$0")/.."

# container / database names follow docker-compose.yml defaults; override via env
PG_CONTAINER=${PG_CONTAINER:-marketing_postgres}
PG_USER=${POSTGRES_USER:-marketing}
PG_DB=${POSTGRES_DB:-marketing_ai}

[ -f "$DUMP" ] || { echo "dump not found: $DUMP"; exit 1; }
[ -f "$CRON" ] || { echo "crontab file not found: $CRON"; exit 1; }
[ -s "$CRON" ] || { echo "crontab file is empty - refusing"; exit 1; }

echo "== stopping app containers"
docker compose stop backend celery_worker celery_beat frontend

echo "== restoring database from $DUMP"
docker cp "$DUMP" "$PG_CONTAINER":/tmp/rollback.dump
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$PG_DB' AND pid<>pg_backend_pid()" \
  -c "DROP DATABASE \"$PG_DB\"" -c "CREATE DATABASE \"$PG_DB\" OWNER \"$PG_USER\""
docker exec "$PG_CONTAINER" pg_restore -U "$PG_USER" -d "$PG_DB" --no-owner --role="$PG_USER" /tmp/rollback.dump
docker exec "$PG_CONTAINER" rm -f /tmp/rollback.dump

echo "== checking out $COMMIT"
git checkout "$COMMIT"

echo "== rebuilding + starting"
docker compose up -d --build backend celery_worker celery_beat frontend

echo "== restoring crontab"
crontab "$CRON"
crontab -l | grep -c smart_sender

echo "rollback complete"
