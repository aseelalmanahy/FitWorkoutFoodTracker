#!/bin/bash
# Runs once, as the PostgreSQL superuser, when the database volume is first initialised (the official image runs every
# script in /docker-entrypoint-initdb.d then, and never again). It applies deploy/database-roles.sql's design:
#   fit_migrator  owns the schema; used only by the separate migrate step (scripts/migrate-approved.cjs)
#   fit_app       rows only, through default privileges; no way to change the schema or the migration history
# Passwords come from the environment, are passed to psql as variables (never into a file or shell history), and are
# only stored by PostgreSQL as SCRAM hashes. Network connections must use TLS; the container's own socket stays local.
set -euo pipefail
: "${FIT_MIGRATOR_PASSWORD:?FIT_MIGRATOR_PASSWORD is required}"
: "${FIT_APP_PASSWORD:?FIT_APP_PASSWORD is required}"
for pw in "$FIT_MIGRATOR_PASSWORD" "$FIT_APP_PASSWORD" "$POSTGRES_PASSWORD"; do
  if [ "${#pw}" -lt 24 ]; then echo "10-roles.sh: every database password must be at least 24 characters" >&2; exit 1; fi
done
if [ "$FIT_MIGRATOR_PASSWORD" = "$FIT_APP_PASSWORD" ]; then echo "10-roles.sh: the migrator and app passwords must differ" >&2; exit 1; fi
case "$POSTGRES_DB" in *test*|*TEST*) echo "10-roles.sh: the database name must not contain 'test' (the app refuses one)" >&2; exit 1;; esac

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v migrator_pw="$FIT_MIGRATOR_PASSWORD" -v app_pw="$FIT_APP_PASSWORD" -v db="$POSTGRES_DB" <<'SQL'
CREATE ROLE fit_migrator LOGIN PASSWORD :'migrator_pw';
CREATE ROLE fit_app LOGIN PASSWORD :'app_pw';

REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO fit_migrator;
GRANT CONNECT ON DATABASE :"db" TO fit_app;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO fit_migrator;
GRANT USAGE ON SCHEMA public TO fit_app;

ALTER DEFAULT PRIVILEGES FOR ROLE fit_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fit_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fit_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO fit_app;
SQL

# Network connections: TLS only, with SCRAM. The image's last rule allows any host without TLS; it becomes hostssl.
hba="$PGDATA/pg_hba.conf"
if ! grep -Eq '^host[[:space:]]+all[[:space:]]+all[[:space:]]+all[[:space:]]+scram-sha-256' "$hba"; then
  echo "10-roles.sh: pg_hba.conf doesn't have the expected network rule; refusing to guess" >&2; exit 1
fi
sed -Ei 's/^host([[:space:]]+all[[:space:]]+all[[:space:]]+all[[:space:]]+scram-sha-256)/hostssl\1/' "$hba"
echo "10-roles.sh: roles fit_migrator and fit_app created; network connections require TLS."
