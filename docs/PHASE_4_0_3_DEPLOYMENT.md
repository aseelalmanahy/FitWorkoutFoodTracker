# Phase 4.0.3: Deployment and Security Runbook

**Status: prepared, never used.** Nothing here has been deployed, and no hosting, domain or database exists. No image has been built, as no Docker daemon was available, and no traffic has passed through the proxy configuration. **These are templates to rehearse, not a tested procedure.** Owner decisions 4, 5 and 14 are still open.

Backups and restores are in `docs/PHASE_4_0_3_BACKUP_RECOVERY.md`.

## What needs an owner decision

| Decision | What it is | Recommendation | Blocks |
|---|---|---|---|
| 4 | Working name and domain | One name | `APP_DOMAIN`, `APP_ORIGIN` |
| 5 | Host, database, monthly ceiling | One x64 Linux VPS plus managed PostgreSQL, in the beta's region (design section 11) | All of it |
| 14 | Who may read production data, and when | Written and restricted | First real data |
| 12 | Backup retention | Needs legal confirmation | Backup configuration |

## Shape

| Part | Choice | Why |
|---|---|---|
| Instances | **Exactly one** | Rate limits and export slots are in memory, per process (S-02). Two instances would double every limit |
| Database | Managed PostgreSQL, external to Compose | The data is what can't be replaced, and this is the owner's first production system |
| Proxy | Caddy, the only published port | Certificates, HTTP redirect, 8 MB body limit |
| App | Container, unpublished, read-only filesystem, no capabilities, non-root | Limits what a compromise can do |
| Resources | 1.5 GB and 1.5 CPUs for the app, 256 MB for the proxy | The design's figure. One maximum export peaked at about 700 MB on the development PC, on Windows, so two at once fit but leave little room. **Unmeasured on Linux, S-13** |
| Restarts | `unless-stopped`, with a health check on `/api/health` | A preflight refusal stops the process, and is visible as a restart loop |

**Environments.** Any deployed environment runs `NODE_ENV=production`, with its own credentials. There's no permanent staging: use a disposable rehearsal server. `.env` files never reach an image, by `.dockerignore`.

## Startup preflight

`src/lib/server/production-config.ts` runs as the server starts, from `src/instrumentation.ts`. On any problem it logs the setting's name, never its value, and exits before serving a request.

| Refuses when | Why |
|---|---|
| `APP_ORIGIN` is missing, not HTTPS, this machine, or has a path or credentials | The Origin check, and later reset links, depend on it |
| `DATABASE_URL` is missing, not PostgreSQL, names a test database, or names the local development database | Real data must not reach a test database, or the reverse |
| The database password is missing, under 16 characters, a common word, or the same as the user name | There's no other production secret: the app has no signing key of its own |
| A remote database without `sslmode=require` or stricter | Credentials and health data would cross a network unencrypted |
| The connected database has a test name or marker, or can't be reached to check | An alias could hide a test database. Fails closed, so a database outage at startup means a restart loop until it returns |
| `EXPOSE_DB_IDENTITY` | It publishes the database's identity |
| Any AI key, base URL, model or effort | Paid AI isn't approved. Readiness items 1 to 5 come first |
| Any stub URL or test setting | They redirect providers, or loosen limits |
| `FIT_LOCAL_TEST_SERVER` or `FIT_TEST_OPEN_REGISTRATION` on anything but a designated test database on this machine | The suites need them. See below |
| `TRUST_PROXY_HOPS` isn't a positive whole number | Without it, per-client limits are off |
| `REGISTRATION_ALLOWLIST` holds anything but exact addresses | So `*` or `@example.com` can't open sign-up |
| A placeholder `FDC_API_KEY`, disabled certificate checks, or a debugger in `NODE_OPTIONS` | Development settings |

**The test exemption.** `next start` is always production mode, and the automated suites use it. They set `FIT_LOCAL_TEST_SERVER=1`, which is honoured only when `DATABASE_URL` is `fitdb_test` or `fitdb_test_other` on a loopback address. **`next dev` isn't checked,** so it must never serve real traffic. The image sets `NODE_ENV=production` and runs `next start`.

## Registration

Closed by default in production, by `REGISTRATION_ALLOWLIST`: exact addresses, compared after the shared schema's normalization, and read at startup, so a change needs a restart.

- An address that isn't invited and an existing account get the same 403, byte for byte. The password is hashed first in both cases, so timing doesn't separate them, and the limit of 10 per 15 minutes still applies.
- **A successful sign-up does show that an address is invited and unused.** So anyone who guesses an invited address can claim it until 4.0.4's email proof exists (S-16). **Keep the list small, add addresses just before inviting, and remove them once used.**

## Releasing

**Order: back up, migrate, verify, then swap the image.** Prisma has no down migrations, so changes follow expand and contract: add first, and remove in a later release.

1. Build and tag the image with the commit SHA. Run `npm audit`, and read the result.
2. **Take a backup, and confirm it reads back** (backup document).
3. Run the migration, as its own step, with the migration credential, only when the release has one:
   `docker compose -f deploy/compose.production.yml --env-file deploy/production.env --profile migrate run --rm migrate`
4. Confirm `prisma migrate status` from the same image.
5. Set `APP_IMAGE_TAG`, then `docker compose -f deploy/compose.production.yml --env-file deploy/production.env up -d app`.
6. Watch for health, and read the logs. The proxy warning appears once per process.

**A failed migration.** Don't retry blindly, and don't run `migrate resolve` until you know what happened. The old image keeps serving if the change was additive. Otherwise, follow the restore procedure.

**Rollback.** The previous image, if no migration in between changed what it needs. Once nulls exist in a column made nullable, older code can't read those rows, and rollback is forward-only (Annex H6). This has been seen for 4.0.1b: an older client throws `P2032`.

**Also unverified about the image:** the runner stage installs no dev dependencies, and `next.config.ts` is read at startup, so whether that works without `typescript` is unknown until the first build. If it doesn't, the config has to be compiled to JavaScript in the build stage.

**Also before the first invite, none of it done:** prove a clean `npm ci` on Linux, run the test suites on Linux, seed the exercise library with the approved procedure, and read-only check that production is empty (R-08).

## Least privilege

`deploy/database-roles.sql` is a template for three separate credentials: `fit_app` for rows only, `fit_migrator` for schema changes, and a read-only one for backups. The app container holds only `fit_app`.

**Not verified: that `prisma migrate deploy` and the app both work under these roles, and that the preflight's catalog read does.** A managed provider may also restrict `ALTER DEFAULT PRIVILEGES`. Rehearse it.

## Monitoring and alerts

The design's minimum, with no vendor chosen:

| What | How | Alert when |
|---|---|---|
| Up | A free external monitor on `https://<domain>/api/health` | Two checks fail. **Goes to the owner's phone** |
| Restart loop | Docker's restart count, from a daily check | Above zero unexpectedly |
| Disk | The host's own check, or a scheduled `df` | Above 80 % |
| Backups | The backup job reports success to a check-in monitor | No success in the expected period |
| Errors | `docker compose logs`, reviewed after each deploy | Any `[preflight]` or repeated `Database error` |

**There's no error-tracking service,** as one would receive personal data, and that needs a privacy decision. Logs hold only an error's type and code for database errors (S-10).

## Updates

| What | Cadence | Who |
|---|---|---|
| Operating system security updates | Automatic, for example `unattended-upgrades`, with a planned reboot | **Needs a named person** |
| Base image and dependencies | `npm audit` and a rebuild for each release, and at least monthly | **Needs a named person** |
| Caddy | With the image update. Pin a tag once rehearsed | **Needs a named person** |

**Known finding.** `npm audit` reports 3 high findings, in `deepmerge-ts` through Prisma's `@prisma/config`. The fix is a breaking upgrade to Prisma 7, which isn't done here (R-15). It's used by Prisma's configuration tooling, not with request data, which is judgement from reading the path, and not a verified analysis.

## Security review, at this commit

| Area | Finding | State |
|---|---|---|
| Origin | With `APP_ORIGIN`, mutations need that exact origin, and no header is believed. Tested with forged `Host`, `X-Forwarded-Host` and `X-Forwarded-Proto`. The fallback to `Host` remains for development and the suites | Local test passes. **Through a deployed proxy: not tested** |
| Proxy trust | `TRUST_PROXY_HOPS` must be right, or addresses can be forged (too high) or everyone shares one identity (too low). Existing unit tests cover forged `X-Forwarded-For` | **The design's forged-header test through the real proxy can't run yet** |
| Rate limits | In memory, per process, lost on restart. A restart resets password guess counts, so a restart loop would weaken them | S-02, accepted for one instance. The 15-minute windows are judgement |
| Request size | 256 KiB for JSON, 4 KiB for auth, an image limit of its own, and 8 MB at the proxy. Middleware doesn't run on `/api/`, so it can't buffer an upload | Unit and integration tests. **The proxy limit isn't tested** |
| Export memory | About 700 MB peak for 249,000 rows, 82 MiB, on Windows. Two at once per process | S-13 stays open until measured on the server |
| Sessions | Cookies are `HttpOnly`, `SameSite=Lax` and `Secure`, and hold a random token, stored only as a hash. **A session lasts a fixed 30 days, and a password change can't revoke others, as no change exists until 4.0.4** | Tested by header. Accepted until 4.0.4 |
| Cookie prefix | No `__Host-` prefix, as the suites run over plain HTTP on localhost. It would add protection on HTTPS | Possible later hardening |
| Health | `{ "status": "ok" }` or 503, with one `SELECT 1` and a 2-second limit. No version, host or database details. Unauthenticated | Tested. The proxy could restrict it, but an external monitor needs it |
| CSP | Scripts need a per-request nonce or this site. `style-src` keeps `'unsafe-inline'`, for inline style attributes, and can't run code. **Every page is now rendered per request,** as a nonce must be fresh | 3 browsers. No violation report endpoint exists, so a violation in the field isn't seen |
| Zod | Its one eval probe is blocked, and it carries on without compiling validators, which is slower but equivalent | Observed in browsers |
| Page errors | `next start` logs errors thrown while rendering by itself. A console guard reduces Prisma errors there to type and code | Unit-tested. **Not triggered by a real page failure** |
| WebKit | This Windows WebKit build won't send a `Secure` cookie over plain `http://localhost`, so its login can't complete locally | **Needs real HTTPS devices, T-15** |
| Image validation | `/api/images/validate` returns 404 in production while AI is off | Tested |
