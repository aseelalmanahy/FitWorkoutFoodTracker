-- TEMPLATE, never run. Least privilege for a production database, once one exists (owner decision 5).
-- Replace the database name, and set passwords out of band, never in this file or in shell history.

-- fit_migrator owns the schema and is used only by the separate migration step.
CREATE ROLE fit_migrator LOGIN;
-- fit_app is what the running application uses: rows only, with no way to change the schema.
CREATE ROLE fit_app LOGIN;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO fit_migrator;
GRANT USAGE ON SCHEMA public TO fit_app;

-- Run as fit_migrator, so that tables it creates later are covered too.
ALTER DEFAULT PRIVILEGES FOR ROLE fit_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fit_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fit_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO fit_app;

-- Backups use a separate read-only role, or the provider's own mechanism. See docs/PHASE_4_0_3_BACKUP_RECOVERY.md.
