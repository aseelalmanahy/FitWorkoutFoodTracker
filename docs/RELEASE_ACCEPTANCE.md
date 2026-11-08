# Release acceptance package

**Release candidate:** `feature/multi-gym-exercise-alternatives` at `32c3914`, plus the documentation commit that adds this file.

**Code is frozen.** Development is closed. Only a reproducible critical or high-severity defect, a data-loss risk or a release-blocking regression would reopen it.

**Technical verdict: TECHNICALLY READY.** All the required technical verification is done. The release now waits only on the approvals and physical tests below.

**Nothing in this document is approved.** Every approval is the owner's, and so is every acceptance. Nothing has been merged or deployed. No migration has been applied to `fitdb`, `fitdb_test`, `fitdb_review` or production.

The document is in three parts, kept separate:

- **Part 1:** technical defects (closed), with known limitations.
- **Part 2:** administrative approvals.
- **Part 3:** physical-device testing.

Part 4 is the security sign-off, and Part 5 is the order to do things in.

---

## Part 1. Technical defects: closed

### The seven review findings: FIXED

| # | Finding | Fix commits | Test evidence |
|---|---|---|---|
| 1 | Machine removal racing machine choice | `99c68f6`, `ebabcee` | `gyms-api`: 12 concurrent rounds, forced lock orderings in both directions, a swap onto a machine being removed. No 500; a machine used in a workout is never removed |
| 2 | Swap retried with `updatePlan` dropped the update | `99c68f6`, `ebabcee` | `gyms-api`: retries make the update; a retry without it never undoes one; concurrent retries make one swap |
| 3 | Plan update hit the wrong entry when the plan repeats an exercise | `99c68f6`, `ebabcee`, `6e77cd8` | `gyms-api`: the second of two entries; a repeated workout; refused with the reason when there's no plan, the exercise was added during the workout, or the plan was edited since |
| 4 | Gym-name uniqueness across case, Unicode encodings and invisible characters | `99c68f6`, `ebabcee`, `6e77cd8` | `gyms-api`: six spellings sent at once make one gym; a rename racing a create; machine names. Unit: 8 cases, including scripts that need joiners |
| 5 | Migration safeguards and role permissions | `47bc004`, `b11564c`, `4926fb9`, `5c5d7d2`, `e35f76d`, `92a80f5` | `migration-safety` 8/8; `mig-04` 103/103. Live, the real guard script against throwaway databases, scenarios S1–S9 (tracker 2m): it refuses unapproved migrations, a history table it doesn't own, another role's grant, membership of the owner (inherited or not), and `pg_write_all_data`; it never reports success otherwise |
| 6 | Food-photo matching: misleading, duplicate or mismatched candidates | `f468dd8` | `package-match` unit 11; `barcode` suite |
| 7 | CSP violations | `a0fcb9e`, `60fbc0f` | `csp-e2e`: 28 pages, signed out and in, in Chromium, Firefox and WebKit, with a positive control in each. It failed on the build before the fix and passes on the fixed one |

These seven are **CLOSED.** They aren't reopened without new, reproducible evidence.

### Final verification at `32c3914`

| Check | Result |
|---|---|
| Branch clean; all 10 remediation commits pushed (`99c68f6` to `32c3914`); local equals `origin` | Yes |
| The seven fixes present in the code at `32c3914` | Yes, checked per fix |
| MIG-GYM matches the Prisma schema | Yes, two ways: (1) regenerating from the base schema (`5b854f7`) with `prisma migrate diff` gives a file **identical** to the committed `migration.sql`; (2) the throwaway database with all 10 migrations applied has **no drift** from `schema.prisma` (`migrate diff --exit-code` exits 0; `migrate status` says up to date) |
| The approval guard fails closed | Yes. On this checkout, `node scripts/migrate-approved.cjs` exits 4, "REFUSED (nothing was applied)", naming both pending migrations. `local-db.cjs` refuses `fitdb_review` likewise (`migration-safety`) |
| No credentials, secrets or temporary test files committed | Yes. No tracked `.env*` (except `.env.example`), `*.local.md`, dump, key, log, build or scratch file. No secret-like line added on the branch. `.env.isolated`, `.env.test`, `.env.review` and `demo-account.local.md` are Git-ignored. Nothing is untracked |

### Regression evidence

| Evidence | Code | Result | Kept at |
|---|---|---|---|
| Full guarded regression | `e35f76d` (all application code) | **56 ran, 56 passed, 0 failed, 0 blocked; 5 excluded** (on demand: `migration-snapshot`, `migration-verify`, `profile-migration-snapshot`, `profile-migration-verify`, `demo-account-e2e`) | `FitWorkoutFoodTracker-backups\diagnostics\release-candidate-32c3914\` (summary and all 56 suite logs) |
| Full guarded regression, earlier | `5c5d7d2` | 56 of 56 passed | Same folder |
| Unit tests | `e35f76d` | 71 files: 2,309 passed, 1 skipped (the on-request evaluation runner) | Session record |
| Script tests | `92a80f5` | `migration-safety` 8/8, `mig-04` 103/103, `demo-account` 33/33, script audit 60/60 | Session record |
| Type check; `npm audit` | `92a80f5` | Clean; 0 vulnerabilities (all, and production only) | Session record |
| Live migration guard S1–S9; role template check | `92a80f5` | As in tracker 2m | Scripts kept in the evidence folder |

The commits after `e35f76d` didn't change application code. `92a80f5` changed only the guard script's SQL and its test, and `32c3914` is documentation. So the full regression on `e35f76d` covers all the app code.

**Not independently reproduced.** Everything above was run by one engineer, on one Windows PC, against a throwaway PostgreSQL 18 cluster. The independent security reviews read the code and ran nothing. These have **not** been reproduced elsewhere:

- any run of the suites on another machine, or on Linux (G1);
- the live guard scenarios S1–S9, by anyone else (their scripts are in the evidence folder);
- either migration, on a database holding real or long-lived data;
- any physical phone (Part 3).

### Known limitations: non-blocking, recorded, not fixed

| ID | Severity | Limitation | Repro |
|---|---|---|---|
| R1 | Low | Saving and deleting the same plan at once can deadlock. It existed before this branch. It ends as a 503 with nothing changed | Two tabs: save a plan in one, delete it in the other, at the same moment |
| I-1 | Info | Names that look alike can still both be saved: the Braille blank (U+2800, including a name made only of it), a repeated combining accent, and look-alikes across scripts (Cyrillic "а"). Only within one person's private names | Create "Café", then "Café" followed by U+2800 |
| I-2 | Info | Tag characters outside a flag are kept in names, so a name can carry invisible text. It matters only if names are ever given to a language model | A gym name ending in U+E0041 |
| I-3 | Info | A workout started from a plan just after a plan delete's lock query isn't locked by it. A cycle is theoretical, and would end as a 503 | Not reproduced |
| FM-1 | Low (follow-up) | Food-photo de-duplication: records that look identical (name, brand, unit and values) are shown once, keeping the first in source order. So a person's own food that matches a packaged record exactly is hidden from the photo's candidates. It stays in the full food search | Create a custom food identical to an Open Food Facts product, then use a photo of that product |
| K-04 | Low | A finished workout can still be edited by its owner from a page left open (pre-existing) | Open a workout, finish it in another tab, edit in the first |
| OPS-1 | Info | Anyone who can run the migrate image with another command can call Prisma directly. That's operational access, for G3 | Not applicable |
| OPS-2 | Info | The remembered "next gym" (an ID in browser storage) is cleared on sign-out only | Not applicable |

### Found during the security-gate checks (2026-11-08)

| ID | Severity | Finding | Status |
|---|---|---|---|
| A3-PS7 | Medium (tooling; it failed safe) | A3's `-Apply` couldn't find its line under PowerShell 7 (`-split …, -1`), so it refused with nothing changed, and A3 couldn't be applied from PowerShell 7 | **Fixed** (`2fb9c3e`), with a regression test in both editions |
| SEC-ACL | Medium (data exposure on this PC) | `Desktop\FitWorkoutFoodTracker-backups`, which holds the database dumps (including `fitdb_review`'s) and would hold A4's credential backups, inherits **Modify** access for `CodexSandboxUsers` and two unresolved SIDs, and isn't encrypted | **Open, owner decision.** It blocks A4 (safeguard 3). Repro: `(Get-Acl "$HOME\Desktop\FitWorkoutFoodTracker-backups").Access` |

---

## Part 2. Administrative approvals

For each item: what is being approved, the existing evidence, what is still unverified, the exact owner action, and the pass/fail criteria. Approving one item approves nothing else.

### A1. Test servers on loopback only

- **What:** restart the servers on 3000 and 3001 (and their food stubs) with `scripts/demo-server.cjs --confirm=fitdb_test --port=… --app-dir=<its folder>`, which binds 127.0.0.1 only.
- **Evidence:** `--app-dir` is implemented and tested (tracker 2j).
- **Unverified:** the restart itself.
- **Owner action:** say "A1 approved", or run the two restarts as in the manual guide.
- **Pass:** `netstat` shows 3000 and 3001 on 127.0.0.1 only; each serves its own build ID; the demo status is unchanged. **Fail:** either one listens beyond loopback, or the demo account changed.

**A1 status: COMPLETE.** Approved by the owner ("Proceed with A1 only") and carried out on 2026-11-08. Every criterion passed.

**The servers:**

| | 3000 (the demo) | 3001 (the UX-01 preview) |
|---|---|---|
| Was | `next start -p 3000` on `::`, every interface, with its food stub on `::`:54220 | `next start -p 3001` on `::`, with its food stub on `::`:62493 |
| Reachable before on 172.25.64.1, 26.145.70.150 and 192.168.1.207 (the virtual, VPN and home-network adapters) | Yes, 200 on all three | Yes, 200 on all three |
| Build served | `feature/demo-account` at `6dc45b7`, build `hEG6mXMo4n4mdvD2nCZyO` (from the scratchpad checkout `…\f6d0aefc-…\scratchpad\demo-run`) | `feature/ux-reliability-redesign` at `7daf826`, build `Gi3IYdrQ0T9jFWTcJucAv` (`FitWorkoutFoodTracker-ux`) |
| Restarted with | From `FitWorkoutFoodTracker-release` (`ca015e5`): `node --env-file=../FitWorkoutFoodTracker/.env.test scripts/demo-server.cjs --confirm=fitdb_test --port=3000 --app-dir=<demo-run>` | The same, with `--port=3001 --app-dir=../FitWorkoutFoodTracker-ux` |
| Launcher said | "Running at http://localhost:3000 (127.0.0.1 only) … verified on fitdb_test" | "Running at http://localhost:3001 (127.0.0.1 only) … verified on fitdb_test" |

The old processes were stopped by their PIDs: the two launchers (23736 and 50748), their apps (25876 and 42692) and their food stubs (64404 and 31332). Each launcher's children were listed first, so nothing else was touched.

**The checks:**

| Check | Result |
|---|---|
| `netstat`, after | `127.0.0.1:3000` (pid 41864), `127.0.0.1:3001` (pid 29596), and the new food stubs on `127.0.0.1:62255` and `127.0.0.1:62259`. **No listener on 3000 or 3001 other than 127.0.0.1**, and nothing on 54220 or 62493 |
| Reachable on this computer | `/login`: 200 through both `127.0.0.1` and `localhost`, on both ports |
| Not reachable from elsewhere | 172.25.64.1, 26.145.70.150 and 192.168.1.207 are unreachable on both ports. So is `[::1]` (IPv4 loopback only) |
| Each serves its own build | 3000: its own build's manifest 200, the other's 404. 3001: its own 200, the other's 404 |
| Demo status unchanged | `demo-account.cjs --status` (read-only) before and after: identical row counts (profile 1, exercise 1, plans 4, plan entries 20, schedule slots 4, targets 2, foods 17, servings 17, food entries 163, workouts 31, workout exercises 151, sets 518, weight entries 53); its password file present and working |
| Review servers untouched | `127.0.0.1:3002` (pid 30772) and `127.0.0.1:3003` (pid 14380): the same processes, before and after |

**Notes:**
- The demo on 3000 is still served from a scratchpad checkout under the temp folder. If that folder is ever deleted, the demo needs rebuilding from a folder of its own; this is outside A1.
- Rollback is the old commands, which listen on every interface again.

### A2. Firewall rules

- **What:** `deploy/local-security/A2-firewall.ps1 -Apply -Approval A2`, elevated.
- **Evidence:** the script and its own check; a dry run.
- **Unverified:** the apply path has never been executed.
- **Owner action:** run it elevated, or approve it to be run.
- **Pass:** its check passes, and a phone on the same Wi-Fi can't open port 3000. **Fail:** the check fails, or the port opens. Roll back with `-Rollback -State <file>`.

**A2 status: READY. BLOCKED only by elevation** (checked 2026-11-08). The security review approved A2 conditionally. This session's shell isn't elevated (medium integrity), so `-Apply` wasn't run, and nothing was changed.

**Preconditions, all passed:**
- **Rules targeted:** the inbound rules for `node.exe` are exactly two, both "Node.js JavaScript Runtime" (TCP and UDP): Public profile, any port, any remote address, Allow, enabled. Windows created them when someone allowed Node.js at its prompt.
- **Why they matter:** the Wi-Fi network and the Radmin VPN adapter both use the **Public** profile, so these rules apply to them. They're what made 3000 and 3001 reachable before A1.
- **Dependents:** none. No Node.js process listens beyond loopback (all six listeners are on 127.0.0.1), and none has a UDP endpoint. `tailscale serve` forwards to 127.0.0.1, so it's unaffected.
- **Unrelated rules:** other wide inbound Allow rules (ASUS Armoury and drivers, Teams, Copilot, Radmin VPN) aren't Node.js rules and aren't touched.
- **Backup folder:** exists and is writable.
- **Dry run:** `-Apply -WhatIf` would disable exactly those two rules, by name, and change nothing else.

**Owner action:** in PowerShell opened with **Run as administrator**:
```powershell
cd $HOME\Desktop\FitWorkoutFoodTracker-beta
.\deploy\local-security\A2-firewall.ps1 -Apply -Approval A2
```

**Expected:** `A2 APPLIED AND VERIFIED: no enabled inbound Allow rule for node.exe. Policy export: …firewall-before-A2-<time>.wfw. State: …firewall-A2-<time>.json`.

**Then (non-elevated, I can run these):**
- the A2 read-only check reports 0 enabled Allow rules for `node.exe`;
- 3000–3003 still answer on 127.0.0.1;
- they're unreachable on the LAN addresses;
- the `.wfw` export and the state file exist.

**Rollback:** `.\deploy\local-security\A2-firewall.ps1 -Rollback -Approval A2 -State <the state file>`, or `netsh advfirewall import <the .wfw file>`. **Downtime:** none. **Data:** none changes.

### A3. PostgreSQL listens on loopback only

- **What:** `deploy/local-security/A3-postgres-listen.ps1 -Apply -Approval A3`, elevated. It restarts PostgreSQL for 5 to 10 seconds.
- **Evidence:** the script and its check.
- **Unverified:** the apply path has never been executed.
- **Owner action:** run it elevated, at a quiet moment.
- **Pass:** 5432 listens on 127.0.0.1 and ::1 only, and the servers reconnect. **Fail:** anything else. Roll back with `-Rollback -Backup <copy>`.

**A3 status: READY. BLOCKED only by elevation** (checked 2026-11-08). The security review approved A3 conditionally. `-Apply` wasn't run; the real `postgresql.conf` and the service weren't touched.

**Defect found and fixed** (`2fb9c3e`, tooling only): under PowerShell 7, `-Apply` couldn't find the `listen_addresses` line. `-split "\r?\n", -1` returns the whole file as one piece there, so the script refused ("found 0") with nothing changed. Windows PowerShell 5.1 worked. It now uses `[regex]::Split`. The regression test `scripts/local-security.test.cjs` passes in both editions, and fails on the previous script.

**Preconditions, all passed:**
- **Service:** `postgresql-x64-18` is running, with automatic start.
- **Listening:** `listen_addresses = '*'` (line 60), so it listens on `0.0.0.0` and `::`.
- **Connections:** all 34 established connections reach PostgreSQL over loopback (`::1`). They come from exactly the four app servers (3000–3003). None comes from another address.
- **Docker, WSL:** not running.
- **Env files:** every one points at `localhost:5432`. The beta worktree's `.env.isolated` points at the separate throwaway cluster on 127.0.0.1:55434, which A3 doesn't affect.
- **`pg_hba.conf`:** already accepts only `127.0.0.1/32` and `::1/128`.
- **Backup folder:** exists and is writable. There's no earlier `postgresql.conf` backup; the script makes one and checks its hash before changing anything.
- **Dry run:** under Windows PowerShell 5.1, line 60 changes `'*'` to `'localhost'`.

**Rehearsal on a copy of the real file** (`-ConfPath <copy> -NoRestart`, in PowerShell 7 and 5.1):
- exactly one of 890 lines changed;
- CRLF and the final newline were kept;
- the backup matched the original byte for byte;
- rollback was byte for byte;
- the real file was unchanged.

**Owner action:** at a quiet moment, in PowerShell opened with **Run as administrator**:
```powershell
cd $HOME\Desktop\FitWorkoutFoodTracker-beta
.\deploy\local-security\A3-postgres-listen.ps1 -Apply -Approval A3
```

**Expected:** `Listening on 5432 after the restart: 127.0.0.1, ::1` and `A3 APPLIED AND VERIFIED: PostgreSQL listens on loopback only`.

**Then (non-elevated, I can run these):**
- 5432 listens on loopback only;
- 3000–3003 answer, and reach the database (a signed-in page loads);
- the demo account's read-only status is identical to before;
- `fitdb_review`'s row counts, read only, are identical to before.

**Rollback:** `.\deploy\local-security\A3-postgres-listen.ps1 -Rollback -Approval A3 -Backup <the copy it names>`, which puts the copy back and restarts.

**Downtime:** a 5–10 second restart; requests in flight on 3000–3003 fail, and Prisma reconnects. **Data:** none changes.

### A4. One PostgreSQL role per local environment

- **What:** `scripts/local-db-roles.cjs --apply --confirm=A4`, with `ADMIN_DATABASE_URL` set in your own shell; then restart each server. Every server's credentials change.
- **Evidence:** the role plan, `--verify`, and a full rehearsal (`diagnostics\a4-rehearsal`).
- **Unverified:** the apply on this PC's PostgreSQL.
- **Owner action:** type the `postgres` password into your own shell only, then run the command.
- **Pass:** `--verify` reports ISOLATED, and every server works after its restart. **Fail:** anything else. Roll back with `--rollback --confirm=A4 --state=<file>`.

**A4 status: ON HOLD** (security review: additional safeguards required). Only read-only work was done on 2026-11-08: `local-db-roles.cjs --verify`, and a catalog survey in `READ ONLY` transactions (metadata only, as `fit`). No password was asked for or written anywhere.

| Safeguard | Finding |
|---|---|
| 1. Databases match the role plan | **Yes.** `fitdb`, `fitdb_review`, `fitdb_test`, `fitdb_test_isolated` and `fitdb_test_other` are all owned by `fit`. `fit` owns every table (15 or 17), index and enum. The `public` schema is owned by `pg_database_owner`, so it follows the database's owner. `fitdb_test_isolated_other` and `fitdb_restore_check` don't exist, and are skipped. `--verify`: NOT ISOLATED, as expected before A4 |
| 2. Affected env files identified | **Yes: 6.** `FitWorkoutFoodTracker\.env` and `.env.test`; `FitWorkoutFoodTracker-review\.env.review` and `.env.isolated`; `FitWorkoutFoodTracker-release\.env.review` and `.env.isolated`. All use login `fit` with one shared password. The demo copy on 3000 and the UX folder have no env file of their own (they use `FitWorkoutFoodTracker\.env.test`). The beta worktree's `.env.isolated` is the throwaway cluster, and isn't affected |
| 3. Credential backups stored securely | **NOT MET.** A4 copies the env files, with plaintext database passwords, into `Desktop\FitWorkoutFoodTracker-backups\A4-<time>\`. That folder isn't encrypted (EFS), and it inherits **Modify** access for the local group `CodexSandboxUsers` and two unresolved account SIDs, beyond you, SYSTEM and Administrators. The same applies to the database dumps already there. **Owner decision needed** before A4: restrict that folder's access list (disable inheritance; keep you and SYSTEM), or choose a protected location |
| 4. Rollback covers the actual permissions | **Yes, for the current state.** Rollback restores a database's access list only when it was the default `NULL`, and restores only `CREATEDB` on `fit`. Today every access list is `NULL`, and `fit` is `NOSUPERUSER NOCREATEROLE CREATEDB`, with no memberships. There are no default privileges, no grants to other roles, no extensions and no other schemas. Re-check just before applying |
| 5. Unexpected grants or ownership | **None found** |
| 6. Recovery from a backup on a disposable target | **Demonstrated** (see B2): a real `fitdb_test` backup restored cleanly into the throwaway cluster, and the real restore check passed on a stand-in |
| 7. Before-and-after checklist | Below |

**A4 checklist.**

Before:
1. `--verify` (NOT ISOLATED, as now);
2. the catalog survey (as above);
3. read-only row counts for `fitdb_review` and `fitdb_test`, and the demo status;
4. a fresh backup of `fitdb_review` and `fitdb_test`;
5. safeguard 3 resolved.

Apply:
- set `ADMIN_DATABASE_URL` in your own shell;
- `--plan` (read only), then `--apply --confirm=A4`;
- restart each of 3000–3003 so it uses the new credentials.

After:
1. `--verify` reports ISOLATED;
2. each env file's login reaches only its own databases, and owns and writes them (A4 checks this itself);
3. the row counts and demo status are identical;
4. 3000–3003 answer;
5. no password appears in any log or report.

**Rollback:** `--rollback --confirm=A4 --state=<state.json>`, rehearsed end to end (`diagnostics\a4-rehearsal`).

### B2. Restore check

- **What:** create the empty scratch database `fitdb_restore_check` (owner `fit_review`, or `fit` before A4), run `restore-check.cjs`, then drop it.
- **Evidence:** the script refuses anything but an empty, unmarked scratch database.
- **Unverified:** a restore of a real backup has never been proven.
- **Owner action:** create the database, run the check, then drop it.
- **Pass:** "RESTORE VERIFIED", with `fitdb_review` unchanged before and after. **Fail:** anything else.

**B2 status: READY FOR OWNER APPROVAL. The mechanism was proven on the disposable cluster** on 2026-11-08; no protected database was touched.

**The real `restore-check.cjs`** ran against a stand-in `fitdb_review` (migrated, marked, with an owner account) and its `pg_dump` backup:
- **RESTORE VERIFIED:** 10 migrations, 20 tables, 184 columns, the owner account and 47 built-in exercises all matched; row counts equal for every table; the source unchanged.
- **Refusals:** exit 4 when the scratch database wasn't empty, and exit 4 when the source had no review marker.

**An actual backup file** (`fitdb_test`, from before MIG-04, test data) was restored into a disposable scratch database with `--exit-on-error`: 7 migrations, 16 tables, 828,726 rows, 19 foreign keys validated, 47 built-in exercises. Then it was dropped.

**The actual `fitdb_review` backup** (`fitdb_review-2026-11-07-21-52-51.dump`) lists cleanly: 17 tables of data, 20 foreign keys. **It wasn't restored**, because it holds your data and that's B2 itself.

**Still unverified:** a restore of the real `fitdb_review` backup and its comparison with `fitdb_review`, which is B2.

**Owner action** (creates and drops one scratch database on 5432):
```powershell
# 1. Create the empty scratch database, owned by fit (before A4) or fit_review (after A4).
#    For example, in psql as the PostgreSQL superuser: CREATE DATABASE fitdb_restore_check OWNER fit;
# 2. From the release folder:
cd $HOME\Desktop\FitWorkoutFoodTracker-release
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
node --env-file=.env.review scripts/restore-check.cjs --backup=..\FitWorkoutFoodTracker-backups\fitdb_review-2026-11-07-21-52-51.dump --confirm=fitdb_restore_check
# 3. Then drop it: DROP DATABASE fitdb_restore_check;
```

**Pass:** "RESTORE VERIFIED", with `fitdb_review` unchanged. **Downtime:** none. **Data:** `fitdb_review` is only read. The scratch copy holds your data until it's dropped. **Rollback:** drop the scratch database.

### B1b. The companion test database on the real server

- **What:** `local-db.cjs --init --confirm=fitdb_test_isolated_other` (from `.env.isolated`), then the runner with `safety-no-marker db-guard-scoped`.
- **Evidence:** both suites passed on the throwaway cluster this round (`safety-no-marker` 7 passed, 1 skipped; `db-guard-scoped` 6/6).
- **Unverified:** on this PC's real PostgreSQL.
- **Owner action:** approve, or run the two commands.
- **Pass:** both suites pass, and the other databases' markers and row counts are unchanged. **Fail:** otherwise.

**B1b status: READY FOR OWNER APPROVAL. BLOCKED** because it creates a persistent database on 5432 (`fitdb_test_isolated_other`).

**Configuration checked:** the release folder's `.env.isolated` points at `localhost:5432/fitdb_test_isolated`, which exists. The companion doesn't exist yet. Both suites passed on the throwaway cluster this round: `safety-no-marker` 7 passed and 1 skipped (POSIX-only), and `db-guard-scoped` 6/6.

**Condition:** run it from the **release folder** (`ca015e5`, 8 migrations), so the companion matches `fitdb_test_isolated`'s schema. Run from this branch (10 migrations), `--init` would apply MIG-FB and MIG-GYM to a new persistent test database. The approval guard deliberately doesn't cover test databases.

**Owner action:**
```powershell
cd $HOME\Desktop\FitWorkoutFoodTracker-release
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
node --env-file=.env.isolated scripts/local-db.cjs --init --confirm=fitdb_test_isolated_other
node --env-file=.env.isolated scripts/run-guarded-suites.cjs safety-no-marker db-guard-scoped
```

**Pass:** both suites pass, and the other databases' markers and row counts are unchanged. **Blocked tests:** `safety-no-marker` and `db-guard-scoped` on the real server. **Downtime:** none. **Data:** one new test database. **Rollback:** drop `fitdb_test_isolated_other`.

### MIG-FB. The feedback migration

- **What:** applying `20261108120000_feedback` (commit `5197037`: one table and four enums; changes nothing existing), first to `fitdb_test` (for the demo), then `fitdb_review`, then production at G3. Each database is approved separately.
  - SHA-256 (line endings normalised): `23a3268b9948508ef54fb73022815355323cd4db7eaea963f6b7dbe9699f4b5b`
- **Evidence:** `feedback-api` 8/8; `account-data` 26/26 with feedback in export and deletion; applied and tested on throwaway clusters only.
- **Unverified:** on any database holding real data. There's no runbook yet for `fitdb_test`; MIG-04 had one, and one would be written after approval.
- **Owner action:** for each database, say "MIG-FB approved for `<database>`". A backup is taken first, and the name and hash above are added to `prisma/approved-migrations.json` in a commit that records the approval. Both migrations are applied in one deploy, so approve MIG-FB and MIG-GYM together for each database.
- **Pass:** a backup is taken and readable; `migrate status` shows it applied; every existing table's row count is unchanged; the guard then allows the deploy. **Fail:** any drift or row change. Rollback is forward-only, from the backup.

### MIG-GYM. The multi-gym migration (revised)

- **What:** applying `20261109120000_multi_gym` (revised in `99c68f6`), to the same databases in the same order, after MIG-FB.
  - **Contents:** two new tables (`GymLocation`, `GymEquipment`), and five nullable columns with no default. `WorkoutSession` gains `gymLocationId`. `SessionExercise` gains `gymEquipmentId`, `substitutesId`, `plannedExerciseId` and, **new in this revision**, `templateExerciseId`.
  - **Keys and indexes:** indexes on the new columns, and foreign keys. A gym deleted clears a workout's gym, and a plan entry deleted clears the link (`SET NULL`). A machine or planned exercise that sets were done on can't be deleted (`RESTRICT`).
  - **Nothing is dropped or rewritten.**
  - SHA-256: `16e04fa8c38bcf3457ea1bfdb9ce66b0e23d1dd2aebae2b2e0738d9a572bbc5d`
- **Evidence:**
  - the migration matches the schema (regenerated identical; no drift);
  - `migration-safety`: it only adds, with the expected delete rules;
  - `gyms-api` 23/23, `gyms-e2e` in three engines, `account-data` 26/26;
  - the demo data's rows were inserted into the throwaway database twice, and every key holds.
- **Unverified:** on a database with long-lived data. A nullable column with no default is a metadata-only change in PostgreSQL 11 and later, so existing rows aren't rewritten, but that hasn't been measured here.
- **Owner action:** review the current `migration.sql` (the earlier version had no `templateExerciseId`). Then, per database, say "MIG-GYM approved for `<database>`". The backup and the record in `approved-migrations.json` are as for MIG-FB.
- **Pass:** as for MIG-FB. In addition, every existing workout's new columns are null; no gym or machine is invented for old sessions. **Fail:** otherwise.

**Migration verification, 2026-11-08** (throwaway cluster only; neither migration is approved or applied to `fitdb`, `fitdb_test`, `fitdb_review` or production).

**Upgrade on realistic existing data:** the real `fitdb_test` backup from before MIG-04 (7 migrations, 15 tables, 828,719 rows of test data) was restored. Then `migrate deploy` applied MIG-04, MIG-FB and MIG-GYM in order, in 0.6 seconds.

| Check | Result |
|---|---|
| Original rows unchanged | **All 15 existing tables byte-identical**, fingerprinted over their original columns before and after: workouts, workout exercises, sets, exercises, accounts, profiles, foods and the rest |
| Migration history | The 7 earlier records unchanged; 10 in total |
| New columns on existing tables | All null: `WorkoutSession.gymLocationId` (0 of 1,478); `SessionExercise.gymEquipmentId`, `substitutesId`, `plannedExerciseId` and `templateExerciseId` (each 0 of 3,758). No gym or machine invented |
| New tables | `GymLocation`, `GymEquipment` and `Feedback` empty |
| Ownership | `userId` is required on both gym tables. Deleting a user cascades to gyms, equipment and feedback. Deleting a gym cascades to its equipment, and clears a workout's gym. A machine or planned exercise with sets on it can't be deleted (`RESTRICT`). A deleted plan entry, swapped row or machine's exercise clears its link (`SET NULL`) |
| Foreign keys | 31, every one validated |
| Schema | No drift from `schema.prisma` |
| Order | Folder order: `…_body_metrics` < `…_feedback` < `…_multi_gym`. MIG-GYM depends on nothing in MIG-FB, but they deploy together |
| Checksums | MIG-FB `23a3268b…f4b5b`; MIG-GYM `16e04fa8…bbc5d` (in full in their sections) |
| Guard | On this checkout, `migrate-approved.cjs` refuses, exit 4, naming both. `local-db.cjs` refuses `fitdb_review` likewise |
| Backups and recovery | B2's mechanism proven (above); a real backup restores. Rollback after these migrations is forward-only, from the backup taken first |

### NOTICE-B. The privacy notice

- **What:** a new version of the privacy notice (`src/lib/legal/notice.ts`). It must name feedback, the reading of package and plan photos on this server, gyms and machines, any third-party image reading, export and deletion, and backup retention.
- **Evidence:** `docs/PRIVACY_WORDING_DRAFTS.md`, with each fact checked against the code.
- **Unverified:** a legal review; Decision 12 (backup retention), S-14 (restoring a backup that holds a deleted account), and the other gaps marked `[TO CONFIRM]`.
- **Owner action:** review the drafts with a lawyer, decide the marked gaps, and approve the final wording.
- **Pass:** the notice has a new version, no `[TO CONFIRM` marker, a recorded review with a real date, and passes the app's own "final notice" check. **Fail:** any marker left, or no recorded review.

### UX-01. The usability and design round

- **What:** your acceptance of UX-01: food-search reliability, responsive layouts, the redesign, login and welcome, and notes.
- **Evidence:** the `responsive` suite (13 views, 4 widths, 2 themes), visual QA and journeys (tracker 2j).
- **Unverified:** your own use of it. The UX-01T suites that write to `fitdb_test` wait on your authorization.
- **Owner action:** follow the "UX-01" section of `MANUAL_UI_TESTING_GUIDE.md`, then say "UX-01 accepted", or list what's wrong.
- **Pass:** you say it's accepted. **Fail:** any item you reject.

### GYM-ACCEPT. Multi-gym, swaps and package photos

- **What:** your acceptance of this branch's features.
- **Evidence:**
  - `gyms-api` 23/23; `gyms-e2e`, which runs the whole flow in Chromium, and a swap with a plan update in Chromium, Firefox and WebKit;
  - `barcode`, which covers the package-photo matching;
  - `csp-e2e`;
  - the demo account data (gyms on workouts from 2026-10-19, two named machines, one swap).
- **Unverified:** your use of it. It needs a database with both migrations.
- **Owner action:** either approve MIG-FB and MIG-GYM for `fitdb_test`, after which the demo account is populated with gyms, or ask for a preview on a throwaway database. Then follow steps **MG.1 to MG.15** ("Multi-gym, exercise swaps and package photos" in `MANUAL_UI_TESTING_GUIDE.md`) and say "GYM-ACCEPT accepted", or list what's wrong.
- **Pass:** every MG step gives its expected result and you accept. **Fail:** any step you reject.

### C1. Real email sending

- **What:** a Resend account, a verified sending domain, and a send-only key in `.env.review`.
- **Evidence:** the mail transport is implemented and tested against a stand-in.
- **Unverified:** real delivery.
- **Owner action:** create the account, verify a domain you control, then put the key in `.env.review` yourself.
- **Pass:** the domain shows as verified. **Fail:** otherwise. Roll back by removing the settings and revoking the key.

### C2. Email journeys

- **What:** `review-account.cjs --mail-tester --email=<address>`, then the email checklist **G.1 to G.6** ("The review environment" in the manual guide).
- **Evidence:** account-token suites pass against the stand-in.
- **Unverified:** a real inbox.
- **Owner action:** use one inbox you control, and run checklist G.1 to G.6.
- **Pass:** every G step gives its expected result. **Fail:** any step that doesn't.

### G1. The production image on Linux

- **What:** start Docker Desktop, then `node scripts/g1-image-check.cjs --approval=G1`. It builds the images, runs the guarded migrate step, starts the hardened app, and measures memory.
- **Evidence:** the script, with its 8 recorded steps.
- **Unverified:** everything about it; the image has never been built.
- **Sequencing:** the check's step 5 runs the guarded migrate image. While MIG-FB and MIG-GYM aren't recorded as approved, that step refuses, by design, so **G1 can only pass after both are approved and recorded.**
- **Owner action:** approve starting Docker Desktop, after recording MIG-FB and MIG-GYM, then run the check.
- **Pass:** "G1 CHECK PASSED", every step. **Fail:** any step.

### G2. Hosting and policy decisions

- **What:** Decisions 4 (name and domain), 5 (host, managed database, monthly ceiling) and 14 (who may read production data); backup retention, RPO and RTO; how deletion reaches backups; production access; and accepting any open dependency finding (there are none today).
- **Evidence:** `BETA_HOSTING.md`, and the proposed defaults in tracker 2j.
- **New in this round:** the migrate step refuses if any role other than the migrator can write the migration history, including through `pg_write_all_data`. So the chosen provider must let the migrator own the schema without such a role.
- **Owner action:** record each decision in `FEATURE_DECISIONS.md`.
- **Pass:** all recorded. **Fail:** any decision missing.

### G3 to G7. Rehearsal through rollout

Each needs G1 and G2 first, and is approved on its own.

- **G3:** a rehearsal on a disposable server, including the guarded migrate step as the migrator role.
- **G4:** HTTPS on the real domain.
- **G5:** backup and restore on the target.
- **G6:** monitoring and alerts.
- **G7:** invited rollout. That requires the pre-beta safeguards, NOTICE-B, UX-01 and GYM-ACCEPT, the security sign-off, and the merge approval.

For each:

- **Evidence:** `PHASE_4_0_3_DEPLOYMENT.md`.
- **Unverified:** all of them.
- **Owner action:** approve each in order.
- **Pass:** each gate's own checks. **Fail:** any check.

---

## Part 3. Physical-device testing (E1)

Simulated phone widths in desktop browsers **don't count** here.

- **What is approved:** Tailscale on this PC and on both phones, HTTPS certificates, `tailscale serve`, and the server started with `--origin`.
- **Prerequisite:** to test this branch, the server must run this branch's build on a database with both migrations, which means MIG-FB and MIG-GYM for that database first. Today, the candidate on 3003 runs an older branch.
- **Existing evidence:** checklist H was emulated in WebKit at phone size through a local HTTPS stand-in.
- **Unverified:** everything on a real phone.

**Owner action:** on a real iPhone (Safari) and a real Android phone (Chrome):

1. Checklist **H.1 to H.10** in the manual guide.
2. Install the app to the home screen, and open it from there.
3. Barcode scan with the camera; a package photo with no barcode (MG.12–MG.14); a plan imported from a screenshot.
4. Steps **MG.1 to MG.11** (gyms, the gym chosen before and during a workout, a swap, machine history).

**Pass:** every step on both phones, including H.10: the address doesn't open off the tailnet. **Fail:** any step on either phone.

---

## Part 4. Final security sign-off

- **What:** your sign-off that the remaining risk is acceptable for an invited beta.
- **Existing evidence:**
  - three independent read-only reviews of this branch (tracker 2l and 2m) found **no critical or high finding, and no cross-user access**;
  - every medium and low raised was fixed, except R1, I-1 to I-3, FM-1, K-04, OPS-1 and OPS-2, which are listed in Part 1 as limitations;
  - `npm audit` 0; the CSP is unchanged and has no violations.
- **Required before sign-off:** NOTICE-B; A1 to A4; B2; G1; the G3 rehearsal with the migrator and app roles as in `deploy/database-roles.sql` (the live check of that template was on a throwaway cluster only); and E1.
- **Owner action:** read Part 1's known limitations, then say "security sign-off given", or list the ones that must be fixed first.
- **Pass:** a written sign-off with the date. **Fail:** any limitation you require fixed. That would reopen development for that item only.

---

## Part 5. Order

1. A1 (**COMPLETE**, 2026-11-08); A2 and A3 (ready, need an elevated shell); A4 (on hold until SEC-ACL is resolved)
2. B2 and B1b
3. MIG-FB and MIG-GYM: `fitdb_test`, then `fitdb_review`
4. GYM-ACCEPT and UX-01
5. E1
6. C1, then C2
7. NOTICE-B
8. G1, then G2
9. Security sign-off
10. G3 to G7, each in order

Merging is a separate approval, at G7.

## Part 6. Beta requirements status (2026-11-08)

The labels: **IMPLEMENTED**, the code exists; **VERIFIED**, the acceptance criteria passed with recorded evidence; **BLOCKED**, an approval, device, credential or resource is missing; **FAILED**, a check didn't pass.

| Requirement | Status | Evidence, or what's missing |
|---|---|---|
| RC-08 (proxy connection failures in tests) | VERIFIED as test-only, still monitored | No recurrence in the last three full regressions. Every suite's proxy connections are traced. It's never in the app |
| QA-05 (late sign-up cleanup) | VERIFIED | `safety-no-marker` passes on the throwaway cluster; on the real server, BLOCKED by B1b |
| UX-01 acceptance | BLOCKED | Your acceptance. The preview is on 3001, loopback only |
| GYM-ACCEPT | BLOCKED | MIG-FB and MIG-GYM on `fitdb_test` (or a throwaway preview), then your acceptance |
| Privacy notice (NOTICE-B) | BLOCKED | Drafts exist; owner and legal review |
| Branding consistency | VERIFIED in the app and emails; final name and icons BLOCKED | No "Forge" in `src`, `public` or `scripts`; icons are temporary; FitBunny deferred |
| Physical iPhone | BLOCKED | E1: Tailscale and the phone; never tested |
| Physical Android | BLOCKED | E1: Tailscale and the phone; never tested |
| Real email delivery | BLOCKED | C1 and C2: a domain and a Resend account |
| Linux container | BLOCKED | G1: Docker Desktop, and MIG-FB and MIG-GYM recorded first |
| Hosting selection | BLOCKED | G2 decisions |
| HTTPS | BLOCKED | G4, which needs a domain and hosting |
| Database restoration | IMPLEMENTED; mechanism VERIFIED on throwaway databases | B2 on the real `fitdb_review` backup is BLOCKED by approval |
| Monitoring and alerts | IMPLEMENTED (`/api/health`); not set up | G6 |
| A1 | VERIFIED | Above |
| A2, A3 | BLOCKED by elevation only | Preconditions passed; exact commands above |
| A4 | BLOCKED | On hold; SEC-ACL first |

**FAILED: none.** No check that ran failed.
