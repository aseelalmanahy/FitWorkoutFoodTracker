#!/usr/bin/env bash
# Restores an encrypted backup into a NEW database on this server's db container, and verifies it. The private key is
# needed, so this runs only when the owner brings it (from a password manager, onto the server for the drill only):
#   ./restore.sh <backup.dump.age> <identity-file> <target-database>
# The target must not exist yet, and must not be the live database: this never overwrites anything. To recover the
# live service, restore into a new name, check it, then point APP_DATABASE_URL and MIGRATION_DATABASE_URL at it.
# Monthly drill (G5): restore the latest backup into restore_check, compare, then drop it with:
#   docker compose ... exec db dropdb -U postgres restore_check
set -euo pipefail
cd "$(dirname "$0")"
BACKUP="${1:?usage: restore.sh <backup.dump.age> <identity-file> <target-database>}"; KEY="${2:?}"; TARGET="${3:?}"
set -a; . ./single-server.env; set +a
[[ "$TARGET" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || { echo "REFUSED: target must be a plain lowercase name"; exit 4; }
[ "$TARGET" != "$POSTGRES_DB" ] || { echo "REFUSED: never restore over the live database ($POSTGRES_DB)"; exit 4; }
dc() { docker compose -f compose.production.yml -f compose.single-server.yml --env-file production.env --env-file single-server.env "$@"; }
psql_() { dc exec -T db psql -U postgres -X -At -v ON_ERROR_STOP=1 "$@"; }
[ -z "$(psql_ -d postgres -c "SELECT 1 FROM pg_database WHERE datname = '$TARGET'")" ] || { echo "REFUSED: $TARGET already exists"; exit 4; }

umask 077; plain=$(mktemp); trap 'shred -u "$plain" 2>/dev/null || rm -f "$plain"' EXIT
age -d -i "$KEY" -o "$plain" "$BACKUP"
psql_ -d postgres -c "CREATE DATABASE \"$TARGET\""
# The same access as postgres/10-roles.sh gives the live database (default privileges are per database), and the
# objects restored as fit_migrator's, so the copy can serve the app. Then run the migrate step once against it: it
# removes fit_app's access to the migration history again, as after every deploy.
psql_ -d "$TARGET" <<SQL
REVOKE ALL ON DATABASE "$TARGET" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE "$TARGET" TO fit_migrator;
GRANT CONNECT ON DATABASE "$TARGET" TO fit_app;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO fit_migrator;
GRANT USAGE ON SCHEMA public TO fit_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fit_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fit_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fit_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO fit_app;
SQL
dc exec -T db pg_restore -U postgres --role=fit_migrator -d "$TARGET" --no-owner --no-privileges --exit-on-error < "$plain"
tables=$(psql_ -d "$TARGET" -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
migrations=$(psql_ -d "$TARGET" -c 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')
unvalidated=$(psql_ -d "$TARGET" -c "SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' AND contype = 'f' AND NOT convalidated")
users=$(psql_ -d "$TARGET" -c 'SELECT count(*) FROM "User"')
echo "restored into $TARGET: $tables tables, $migrations migrations, $users accounts, $unvalidated unvalidated foreign keys"
[ "$unvalidated" = 0 ] && [ "$migrations" -gt 0 ] || { echo "RESTORE CHECK FAILED"; exit 1; }
echo "RESTORE VERIFIED"
