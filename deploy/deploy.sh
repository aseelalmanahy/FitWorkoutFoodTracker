#!/usr/bin/env bash
# Deploys one pinned image tag to this server (option A, compose.single-server.yml), as the deploy user, from deploy/:
#   ./deploy.sh <tag>              pull ghcr images <repo>:<tag> and <repo>-migrate:<tag>, then deploy
#   ./deploy.sh <tag> --no-pull    images already present (CI rehearsal, or images loaded by hand)
# Order: backup (if the database holds data) -> guarded migrate step -> app -> health -> smoke -> done.
# If the new app isn't healthy, or the smoke test fails, it goes back to the previous tag and says ROLLED BACK.
# Migrations are forward-only: a rollback restarts the previous app on the migrated schema, which works while
# migrations only add (as MIG-FB and MIG-GYM do). A migration that removes anything needs its own plan and a restore.
set -euo pipefail
cd "$(dirname "$0")"
TAG="${1:?usage: deploy.sh <tag> [--no-pull]}"
PULL=1; [ "${2:-}" = "--no-pull" ] && PULL=0
[[ "$TAG" =~ ^[A-Za-z0-9_.-]{1,64}$ ]] || { echo "REFUSED: tag must be letters, digits, . _ - (got '$TAG')"; exit 4; }
for f in production.env single-server.env; do
  [ -f "$f" ] || { echo "REFUSED: deploy/$f is missing (copy it from its .example and fill it in)"; exit 4; }
  perms=$(stat -c %a "$f"); [ "$perms" = "600" ] || { echo "REFUSED: deploy/$f must be mode 600 (it is $perms)"; exit 4; }
  if grep -q 'CHANGE_ME' "$f"; then echo "REFUSED: deploy/$f still has CHANGE_ME values"; exit 4; fi
done
set -a; . ./single-server.env; set +a
STATE=.deployed-tag
PREVIOUS=$(cat "$STATE" 2>/dev/null || true)
compose() {
  local files=(-f compose.production.yml -f compose.single-server.yml)
  # CI rehearsal only: one more overlay (Caddy's internal CA, as a runner has no public name). Unset on a server.
  [ -n "${DEPLOY_EXTRA_COMPOSE:-}" ] && files+=(-f "$DEPLOY_EXTRA_COMPOSE")
  APP_IMAGE_TAG="$1" docker compose "${files[@]}" --env-file production.env --env-file single-server.env "${@:2}"
}
log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

wait_healthy() { # the app container's own health check (Dockerfile HEALTHCHECK, /api/health with a database query)
  local id status
  for _ in $(seq 1 60); do
    id=$(compose "$1" ps -q app); status=$( [ -n "$id" ] && docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo starting)
    [ "$status" = "healthy" ] && return 0
    [ "$status" = "unhealthy" ] && return 1
    if [ -n "$id" ] && [ "$(docker inspect -f '{{.State.Running}}' "$id")" = "false" ]; then return 1; fi
    sleep 3
  done
  return 1
}

rollback() {
  log "FAILED: $1"
  if [ -z "$PREVIOUS" ]; then log "no previous tag to go back to; the app is left stopped"; compose "$TAG" stop app || true; exit 1; fi
  log "rolling back to $PREVIOUS"
  if compose "$PREVIOUS" up -d --no-deps app && wait_healthy "$PREVIOUS" && ./smoke.sh "${APP_ORIGIN_FOR_SMOKE:-}"; then
    log "ROLLED BACK to $PREVIOUS, which is healthy. $TAG is not deployed."; exit 1
  fi
  log "ROLLBACK ALSO FAILED: see 'docker compose logs app'. Restore from backup if the database is at fault."; exit 2
}

APP_ORIGIN_FOR_SMOKE=$(grep -E '^APP_ORIGIN=' production.env | cut -d= -f2-)
log "deploying $TAG (previous: ${PREVIOUS:-none})"
if [ "$PULL" = 1 ]; then
  docker pull "$APP_IMAGE_REPO:$TAG"; docker pull "$APP_IMAGE_REPO-migrate:$TAG"
fi
docker image inspect "$APP_IMAGE_REPO:$TAG" "$APP_IMAGE_REPO-migrate:$TAG" > /dev/null
# Tags can be re-pushed: record exactly which images this deploy ran (compare with the release's published digests).
for img in "$APP_IMAGE_REPO:$TAG" "$APP_IMAGE_REPO-migrate:$TAG"; do
  echo "$(date -u +%FT%TZ) $img $(docker image inspect -f '{{join .RepoDigests " "}}{{if not .RepoDigests}}{{.Id}}{{end}}' "$img")" >> .deploy-history
done

compose "$TAG" up -d db
# A backup before every deploy that could touch existing data (none on the very first one). On a server it runs as
# the root-owned systemd unit (the backup folder is root's alone); elsewhere (the CI rehearsal) directly.
if [ -n "$PREVIOUS" ]; then
  log "backup before the deploy"
  if systemctl cat fit-backup.service > /dev/null 2>&1; then
    sudo systemctl start fit-backup.service || { log "FAILED: the backup failed (journalctl -u fit-backup). Nothing was changed."; exit 1; }
  else
    ./backup.sh || { log "FAILED: the backup failed. Nothing was changed."; exit 1; }
  fi
fi

log "migrations (guarded: only those in prisma/approved-migrations.json, as the migrator)"
if ! compose "$TAG" --profile migrate run --rm migrate; then
  log "FAILED: the migrate step refused or failed; ${PREVIOUS:-no app} is still running. A refusal applies nothing, but a"
  log "failure partway can leave earlier migrations applied: check 'migrate status' before deploying again."; exit 1
fi

# The proxy waits for a healthy app, so a release that can't start fails here: that's a rollback, not an abort.
compose "$TAG" up -d app proxy || rollback "the new app didn't start"
wait_healthy "$TAG" || rollback "the new app didn't become healthy"
./smoke.sh "$APP_ORIGIN_FOR_SMOKE" || rollback "the smoke test failed"
echo "$TAG" > "$STATE"
log "DEPLOYED $TAG"
