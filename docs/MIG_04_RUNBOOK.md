# MIG-04: how to apply and verify it

**Prepared, and not executed. No database was accessed to prepare this.** Applying MIG-04 needs the owner's separate, explicit authorization (J-02), which this document doesn't grant. It covers `fitdb_test` only. `fitdb`, `fitdb_test_other` and any production database each need their own decision and backup.

`scripts/mig-04.cjs` has never run against a database. Only its refusals are tested, with no database, in `scripts/mig-04.test.cjs`, so its first real run may find a defect in it. Any `STOP` or `REFUSED` ends the procedure: report it, and don't work around it.

## What it is

| | |
|---|---|
| File | `prisma/migrations/20261106150000_body_metrics/migration.sql` |
| Git blob | `30a8dac92da1f059b4b2a0672191c2d4c705a9da` |
| SHA-256, LF only | `b5dd6a4b31dc8717952cef81a67bf42e7b71cc2f3de216d516c5864e5155bbf4` |
| Does | Creates enum `BodyMetricKind`, table `BodyMetric`, one unique index, and a foreign key to `User` that deletes with the account |
| Doesn't | Change, rewrite or remove any existing table, column or row |
| Locks | Adding the foreign key briefly locks `User` against writes. Unimportant on a test database, and to be considered on a live one |

## Its relationship to MIG-03, from repository files only

| Check | Result |
|---|---|
| Order | MIG-03 is `20261106140000_account_tokens`, and MIG-04 sorts directly after it. No migration is named between or after them |
| Dependency | MIG-04 refers only to `User`, created by the first migration. It uses nothing MIG-03 made, and alters nothing MIG-03 made |
| MIG-03 unchanged | The same blob, `8c1e6ca`, on `main`, 4.0.5, 4.1 and 4.0.6, and the same one the tracker recorded when it was applied |
| Other migrations | `main`, 4.0.5, 4.0.6 and the fixture branch each have 7. MIG-04 is the only new migration in Phase 4's remaining work |
| Schema and file agree | `prisma migrate diff`, from `main`'s schema to 4.1's, with no database, generates SQL identical to the file once line endings are normalized |
| Schema valid | `prisma validate` passes, with a closed-port address |
| Line endings | `.gitattributes` keeps this file LF on every machine, so its recorded checksum doesn't depend on Git's settings. That was defect C-10 for an earlier migration |
| Ordering in code | **MIG-04 must come before this code on any database,** or the dashboard, account deletion and export fail there |

**Not checked:** replaying all eight migrations from empty needs a shadow database, which isn't authorized. Whether `fitdb_test` really equals `main`'s schema is `preflight`'s no-drift check, run only once authorized.

## Before starting

1. **Have the owner's written authorization,** naming MIG-04 and `fitdb_test`.
2. Check out `feature/phase-4.1-progress`, or whatever was approved in its place, with a clean tree.
3. Generate Prisma's client, below. It touches no database, and the address in it is a closed port. The client is shared across branches, so **generate again after returning to a branch without `BodyMetric`.**
4. Check that port 3000 and any other test process are idle, and that at least 4 GB of memory is available.

```powershell
$env:DATABASE_URL = "postgresql://none:none@127.0.0.1:1/fitdb_test"
node node_modules/prisma/build/index.js generate
Remove-Item Env:DATABASE_URL
```

## The procedure

**In PowerShell, from the repository root, one block at a time.** Paste a block, read its output, and go on only if it ends without an error. Each works in PowerShell 7 and in Windows PowerShell 5.1, as tested.

**Why each block clears `DATABASE_URL`:** `node --env-file` lets a variable already in the shell win, silently, so one left in the window would be used in place of `.env.test`. `Remove-Item` clears it for this window only. **If it's skipped, the script refuses,** as it compares the value in use with the one in `.env.test`, and it also refuses any other env file. Avoid `npx` here, as Windows PowerShell may block its script.

```powershell
# Step 1: preflight
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
if (Test-Path Env:DATABASE_URL) { throw "DATABASE_URL is still set. Stop here." }
node --env-file=.env.test scripts/mig-04.cjs preflight
if ($LASTEXITCODE -ne 0) { throw "preflight stopped with exit code $LASTEXITCODE. Report it, and go no further." }
```

```powershell
# Step 2: backup
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
if (Test-Path Env:DATABASE_URL) { throw "DATABASE_URL is still set. Stop here." }
node --env-file=.env.test scripts/mig-04.cjs backup
if ($LASTEXITCODE -ne 0) { throw "backup stopped with exit code $LASTEXITCODE. Report it, and go no further." }
```

```powershell
# Step 3: apply. Only with the owner's written authorization.
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
if (Test-Path Env:DATABASE_URL) { throw "DATABASE_URL is still set. Stop here." }
node --env-file=.env.test scripts/mig-04.cjs apply --owner-authorized=MIG-04
if ($LASTEXITCODE -ne 0) { throw "apply stopped with exit code $LASTEXITCODE. Report it, and go no further." }
```

```powershell
# Step 4: verify
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
if (Test-Path Env:DATABASE_URL) { throw "DATABASE_URL is still set. Stop here." }
node --env-file=.env.test scripts/mig-04.cjs verify
if ($LASTEXITCODE -ne 0) { throw "verify stopped with exit code $LASTEXITCODE. Report it, and go no further." }
```

| # | What's verified | How | Step |
|---|---|---|---|
| 1 | **Effective database connection** | The value in use has to be the one in `.env.test`, so an inherited `DATABASE_URL` can't replace it. It has to name `fitdb_test` on this machine, and pass the shared guard, before anything connects. Prisma's own tool then has to report the same target whatever `.env` holds, as it would otherwise read `.env` | all, and Prisma's own tool in `preflight` |
| 2 | **Exact database identity** | The connected server reports `current_database()` as `fitdb_test`, schema `public`, on a loopback address. Repeated by every step | all |
| 3 | **Test marker** | `fitworkoutfoodtracker:test-database:v1:fitdb_test`. `verify` also checks that the marker's catalog row wasn't rewritten | all |
| 4 | **Existing migrations** | Exactly 7 applied, none failed or unfinished, each checksum matching its file, MIG-03 last, exactly MIG-04 pending, and no drift from `main`'s schema. MIG-04's objects don't exist yet | `preflight` |
| 5 | **Backup** | `pg_dump --format=custom` of `fitdb_test`, to a new timestamped file in `FitWorkoutFoodTracker-backups` under the home folder | `backup` |
| 6 | **Backup verification** | The listing reads and names `fitdb_test`, holds no `BodyMetric`, and **each table's row count read from the archive equals the database's,** with no database used for that reading. Its SHA-256 is recorded, and rechecked before applying | `backup` |
| 7 | **Application of MIG-04** | Refuses without the authorization flag, then **repeats every check straight before deploying,** below. Then `prisma migrate deploy` only. **On failure: no reset, no restore, stop and report** | `apply` |
| 8 | **Schema verification** | `migrate status` is clean, 8 applied with MIG-04 last and its checksum the reviewed one. Columns, enum, unique index and cascading foreign key are as reviewed, with no drift from the branch's schema | `verify` |
| 9 | **Row-count preservation** | Each table's count equals the preflight's, with `_prisma_migrations` up by exactly one, and `BodyMetric` empty | `verify` |

**The authorization flag is a guard against accidents, not the authorization.** Only the owner can give that.

### What `apply` checks again

`apply` doesn't take `preflight`'s word for anything it can check again. Both run the same `verifyBeforeMigration()` in `scripts/lib/mig-04-verify.cjs`. The record from `preflight` only says what was there when the backup was taken. Any mismatch stops with no change to the database, and the deploy is the only thing in the step that writes to it.

| Order | Check | No database needed |
|---|---|---|
| 1 | The record exists, reads, is for this migration, and was taken under an hour ago, timed from `preflight` itself | Yes |
| 2 | The backup is in the backups folder, with the recorded name, size and SHA-256 | Yes |
| 3 | The `DATABASE_URL` in use is still `.env.test`'s, re-read now | Yes |
| 4 | MIG-04's file is still the reviewed one, with `prisma/` unchanged | Yes |
| 5 | The connected database is `fitdb_test`, schema `public`, on this machine, with its marker | |
| 6 | Exactly 7 applied, none failed or rolled back, none unexpected, MIG-03 last, and each checksum its file's | |
| 7 | Exactly MIG-04 pending, by this script and by Prisma's own tool, which also has to name the same target | |
| 8 | No drift from `main`'s schema, and MIG-04's objects don't exist | |
| 9 | Same database fingerprint, marker row and migration checksums as at `preflight` | |
| 10 | The backup's data still holds the recorded row count for every table, then its bytes are checked again | Yes |
| 11 | Every table's row count is unchanged, with none added or removed, last of all | |

**Running `preflight` again discards the recorded backup,** so `backup` has to follow it. **What can't be closed from here:** something writing to the database in the moment between the last check and the deploy. This is a test database with nothing else meant to be running, so stop the suites and servers first.

**The one part already tried:** reading row counts from an archive was tried on the existing backup from before MIG-03, reading that file with no database. It read every table and printed only names and counts.

**What the backup verification doesn't show:** it hasn't been restored, as restoring needs a database that isn't authorized. T-10 stays open.

## After it's applied: tests

One at a time, in PowerShell, needing a production build of the branch. The build's address is a closed port. **The runner doesn't compare its value with `.env.test` as `mig-04.cjs` does, so clearing the variable is what protects it,** though it still refuses anything but a local `fitdb_test`.

```powershell
$env:DATABASE_URL = "postgresql://none:none@127.0.0.1:1/fitdb_test"
node node_modules/next/dist/bin/next build
Remove-Item Env:DATABASE_URL
```

```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
node --env-file=.env.test scripts/run-guarded-suites.cjs weight-progress
```

| # | What's verified | Suite | Covers |
|---|---|---|---|
| 10 | **Weight integration tests** | `weight-progress` | Stores kilograms, replaces on the same date, leaves the profile's weight alone, and races for one date leave one row |
| 11 | **Account isolation** | `weight-progress` | One person can't read, delete or overwrite another's entries, no session means no entries, and a restricted account can't reach them. Those test names exist, and **none has run** |
| 12 | **Export and deletion** | `weight-progress`, `account-data`, `account-data-e2e` | The export holds a person's entries and only theirs. Deleting an account removes its entries and nobody else's |
| 13 | **Browser tests** | `weight-e2e` first, then `e2e-smoke`, `profile-minimization-e2e`, `eligibility` | Chromium, Firefox and WebKit. The last three reach the dashboard or the goal field that this branch changed |

Then record the results in tracker J-02, T-24 and MIG-04, and run the real-server deliberate defects for 4.1, none of which has run. A wait that runs out or a suite that can't start is a failure to investigate, not a result.

The final regression belongs to the combined code, once all three phases are integrated, and isn't repeated here.

## If something goes wrong

| Situation | What to do |
|---|---|
| `STOP` or `REFUSED` before `apply` | Nothing has changed. Report it |
| `apply` fails | Stop. No `migrate reset`, `migrate resolve`, `db push` or restore without a new decision from the owner |
| `verify` fails | Stop, and leave the database as it is for inspection |
| Undoing it is wanted | Needs the owner's decision. The table holds nothing straight after applying, so dropping the table and enum and removing its migration record would undo it, or the backup can be restored. Once suites have run, it holds their rows |

## What changes for other branches

Once MIG-04 is on `fitdb_test`, code from `main`, 4.0.5 and 4.0.6 still runs against it, as it never reads the new table. Prisma would list MIG-04 as applied but missing from those branches' folders, so **don't run `prisma migrate dev` from them.** `prisma generate` has to be repeated when moving between 4.1 and those branches.
