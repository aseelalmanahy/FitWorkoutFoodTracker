# Release acceptance package

**Release candidate:** `feature/multi-gym-exercise-alternatives`, application code at `d7d278d`; the commits after it are documentation only. (Earlier: `8c520a0`, the draft privacy-notice wording on top of `37198a8`.) Current state: [PROJECT_STATUS.md](PROJECT_STATUS.md).

**Code is frozen.** Development is closed. Only a reproducible critical or high-severity defect, a data-loss risk or a release-blocking regression would reopen it.

**Release verdict (2026-11-09, Part 11): READY FOR STAGING DEPLOYMENT, NOT YET for an invited beta.** The single-server stack passed a full staging rehearsal on a disposable Linux machine (108/108), from an empty database to HTTPS, backup, restore and automatic rollback. Deploying it needs your purchases and approvals (Part 11.5 A). The invited beta still needs production, real email, NOTICE-B, phone testing, your acceptance, the security sign-off and the merge (Part 11.5 B). Earlier verdicts below are kept as the record.

**Earlier verdict:** NOT READY for an invited beta, and not yet ready for staging.
- **What passed:** G1 on Linux (17 of 17), and the final regression at `caca244` (56/56 guarded, 2,309 unit tests).
- **EXP-01:** verified fixed (Part 9).
- **Database operations (Part 10):**
  - **B2 PASSED:** a real backup restores, and `fitdb_review` is unchanged.
  - **B1b PASSED** on the real server, with the candidate's test; QA-05 is verified.
  - **MIG-FB + MIG-GYM applied and verified on `fitdb_test`.**
  - Multi-gym works with the demo account (12/12).
- **Still missing:** `fitdb_review`'s migrations (and with them G1's guarded path), role isolation (A4), hosting, email, phones, the privacy review and your acceptance.
- **Next approvals:** in 8.9, from row 5.

**Approvals are only those the owner gave, as recorded verbatim in this document** (consolidated in [DECISION_REGISTER.md](DECISION_REGISTER.md) §1). Every acceptance is the owner's too, and **none is recorded yet**. Nothing has been merged or deployed. **Migrations:** MIG-FB and MIG-GYM were applied to `fitdb_test` only, on 2026-11-09, with the owner's approval (Part 10). `fitdb`, `fitdb_review` and production have had no new migration. *(Corrected 2026-11-09: this line used to say that nothing here was approved and no migration had been applied, which stopped being true at Part 10.)*

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
| SEC-ACL | Medium (data exposure on this PC) | `Desktop\FitWorkoutFoodTracker-backups`, which holds the database dumps (including `fitdb_review`'s) and would hold A4's credential backups, inherits **Modify** access for `CodexSandboxUsers` and two unresolved SIDs, and isn't encrypted | **Access: FIXED** on 2026-11-08 (Part 7). **Encryption: open,** a G2/G5 item (Part 7) |

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

**A2 status: COMPLETE.** The owner ran `A2-firewall.ps1 -Apply -Approval A2` elevated on 2026-11-08 at 18:29 (state file `firewall-A2-20261108-182956.json` and policy export `firewall-before-A2-20261108-182956.wfw`). Its check reported "no enabled inbound Allow rule for node.exe". Re-checked read-only in Part 7. The record below is the preparation, kept as evidence.

**Earlier status: READY. BLOCKED only by elevation** (checked 2026-11-08). The security review approved A2 conditionally. This session's shell isn't elevated (medium integrity), so `-Apply` wasn't run, and nothing was changed.

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

**A3 status: COMPLETE.** The owner ran `A3-postgres-listen.ps1 -Apply -Approval A3` elevated on 2026-11-08 at 18:31 (backup `postgresql.conf.before-A3-20261108-183101`). Its check reported "loopback only". Re-checked read-only in Part 7, including the four servers' database access after the restart. The record below is the preparation, kept as evidence.

**Earlier status: READY. BLOCKED only by elevation** (checked 2026-11-08). The security review approved A3 conditionally. `-Apply` wasn't run; the real `postgresql.conf` and the service weren't touched.

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

0. **Superseded by Part 7's approval package,** which is the current order. This list is kept as the earlier record.
1. A1, A2 and A3 (**COMPLETE**, 2026-11-08); SEC-ACL access (**FIXED**, 2026-11-08); A4 (on hold until B2)
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
| Privacy notice (NOTICE-B) | IMPLEMENTED as a draft (`draft-2026-11-08`, `8c520a0`); BLOCKED for final | Owner decisions and a real legal review (Part 7) |
| Branding consistency | VERIFIED in the app and emails; final name and icons BLOCKED | No "Forge" in `src`, `public` or `scripts`; icons are temporary; FitBunny deferred |
| Physical iPhone | BLOCKED | E1: Tailscale and the phone; never tested |
| Physical Android | BLOCKED | E1: Tailscale and the phone; never tested |
| Real email delivery | BLOCKED | C1 and C2: a domain and a Resend account |
| Linux container | BLOCKED | G1: Docker Desktop, and MIG-FB and MIG-GYM recorded first |
| Hosting selection | BLOCKED | G2 decisions |
| HTTPS | BLOCKED | G4, which needs a domain and hosting |
| Database restoration | IMPLEMENTED; mechanism VERIFIED on throwaway databases | B2 on the real `fitdb_review` backup is BLOCKED by approval |
| Monitoring and alerts | IMPLEMENTED (`/api/health`); not set up | G6 |
| A1 | VERIFIED | Above; re-checked in Part 7 |
| A2, A3 | VERIFIED | Applied by the owner, re-checked read-only in Part 7 |
| SEC-ACL (access) | VERIFIED | Part 7 |
| A4 | BLOCKED | B2 first, then the owner's approval and the superuser password (Part 7) |

**FAILED: none.** No check that ran failed.

---

## Part 7. Release execution round (2026-11-08, evening)

Run from `FitWorkoutFoodTracker-beta`, which was at `37198a8`; local equalled `origin`. Evidence is in `FitWorkoutFoodTracker-backups\diagnostics\release-execution-8c520a0\` and `…\sec-acl-2026-11-08\`.

**Approvals in this round:** the owner was asked once, in the approval interface, about B2, B1b and MIG-FB + MIG-GYM on `fitdb_test`. **No selection was submitted, so none of the three was run.** No persistent database was created, dropped or migrated. Nothing was merged or deployed, and nothing was bought.

### 7.1 Local security: verified

| Gate | Check (read-only unless stated) | Result |
|---|---|---|
| A1 | Listeners | 3000–3003 on `127.0.0.1` only |
| A2 | `node.exe` inbound rules | Both "Node.js JavaScript Runtime" rules `Enabled=False` |
| A3 | Listeners on 5432 | `127.0.0.1` and `::1` only; `postgresql-x64-18` running |
| Servers after the restart | `/api/health` runs `SELECT 1` | `ok` on all four. 3000 and 3001 also return `fitdb_test`'s marker comment, a catalog read |
| Signed-in database reads | The demo account on 3000 and 3001 (password read from its file, not printed): login, then `/api/sessions`, `/api/templates`, `/api/profile` and `/api/foods/recent`, then logout | All 200; the old cookie is 401 after logout. 3002 and 3003 (`fitdb_review`, your data) weren't signed in to |
| Demo status | `demo-account.cjs --status` | Identical to the A1 record (sets 518, weight entries 53, and so on) |

### 7.2 SEC-ACL: access FIXED; encryption open

**Who had access, resolved:**
- `CodexSandboxUsers` (`…-1002`) is Codex's managed group. Its members are the local accounts `CodexSandboxOffline` and `CodexSandboxOnline`. With `sandbox = "elevated"`, Codex runs its commands as these accounts.
- `S-1-5-21-1631495452-…-426349801` is Codex's writable-root capability SID for `C:\Users\Aseel\Desktop` (from `~\.codex\cap_sid`).
- `S-1-5-21-3084734977-…-1732271687` is in no current mapping. Its form matches, so it's most likely a stale, rotated Codex capability SID.
- All three were **explicit grants on Desktop**, inherited by the backup folder. Every entry on the folder was inherited.

**Dependencies:**
- Of the 103 items in the folder, 100 are owned by Aseel and 3 by Administrators (the elevated A2 and A3 runs). None is owned by a Codex account.
- No scheduled task touches the folder.
- The scripts that write there (`local-db-roles.cjs`, `mig-04.cjs`, `g1-image-check.cjs`, A2, A3) run as the owner.
- `pg_dump` and `pg_restore` run client-side as the caller, so the PostgreSQL service account needs no access.
- So nothing that's needed depended on the Codex grants.

**Change, on this folder only:**
- Inheritance was turned off, keeping a copy of the entries, and the three Codex entries were removed.
- Remaining on the folder and every item under it: `Aseel`, `SYSTEM` and `Administrators`, each with full control. SDDL: `D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;…-1001)`.
- Afterwards: no Codex SID on any item below; the owner can still write and read; `pg_restore --list` still reads `fitdb_review-2026-11-07-21-52-51.dump` (114 TOC entries, 17 tables of data).
- Desktop itself and the repositories were left alone, because Codex needs them as its workspace.

**Rollback (corrected 2026-11-09, after a rehearsal; the first version of this section claimed more than had been tested):**
- **`icacls "$HOME\Desktop\FitWorkoutFoodTracker-backups" /reset /T /C`, rehearsed.**
  - The rehearsal used a scratch folder on the Desktop with a file and a subfolder inside, so it inherited exactly what the backup folder had. The same change was applied, then `/reset /T /C`.
  - Result: the folder, subfolder and both files were **identical** to the originals.
  - **Condition:** `/reset` re-inherits whatever Desktop grants *at that moment*. It matches the original only while Desktop's own permissions are unchanged, as they were on 2026-11-09. It doesn't change file owners.
  - Not rehearsed on the real folder's 103 items, which stay secured.
- **`icacls "$HOME\Desktop" /restore "<…>\acl-before-20261108-203742.icacls"` FAILS in a normal shell.** The rehearsal returned "Not all privileges or groups referenced are assigned to the caller", and nothing changed. It would need an elevated shell, which hasn't been tested and is outside the no-Windows-changes rule. The saved file is kept only as a record of the original permissions.
- `sddl-before-20261108-203742.txt` and `sddl-after.txt` are kept beside it.

**Remaining risk:**
- **Encryption.** Windows 11 Home has no EFS, and BitLocker device-encryption status needs an elevated `manage-bde -status C:` (owner action 1). An account with admin rights can still read the folder.
- **Codex re-granting.** If Codex is ever pointed at the backup folder as a workspace, it may add its own grants again. Re-check with `(Get-Acl …).Access` before A4.
- **Repository env files.** Those in the repositories (including `.env.review`'s password) stay readable by Codex's sandbox accounts, because the repos are Codex's workspace. A4 narrows what that password can reach.

### 7.3 Databases

- **Survey (read-only, as `fit`):**
  - `fitdb`, `fitdb_review`, `fitdb_test`, `fitdb_test_isolated` and `fitdb_test_other` exist, all owned by `fit`, all with default ACLs;
  - the markers are as expected;
  - `fitdb_restore_check` and `fitdb_test_isolated_other` don't exist;
  - `fit` is the only role: `NOSUPERUSER`, `CREATEDB`, no memberships.
- **A4 `--verify`:** NOT ISOLATED, as expected before A4. The six env files are unchanged, all using login `fit`; the beta worktree's `.env.isolated` is the throwaway cluster.
- **Migration checksums**, recomputed from `8c520a0`:
  - MIG-FB `20261108120000_feedback`: `23a3268b9948508ef54fb73022815355323cd4db7eaea963f6b7dbe9699f4b5b`;
  - MIG-GYM `20261109120000_multi_gym`: `16e04fa8c38bcf3457ea1bfdb9ce66b0e23d1dd2aebae2b2e0738d9a572bbc5d`.
  - Both match the recorded values. Neither file drops, deletes or rewrites anything: the only keyword hits are `ON DELETE` and `ON UPDATE` rules on new foreign keys. Neither is in `approved-migrations.json`, so the guard still refuses `fitdb_review` and production.
- **B2, B1b and the migrations:** not run (see the approvals note above). The exact procedures are unchanged from Part 2 and in the package below.

### 7.4 Privacy, branding and hosting

- **NOTICE-B (`8c520a0`):** the fact-checked wording from `PRIVACY_WORDING_DRAFTS.md` sections 1–5 and 7 is now in the notice, version `draft-2026-11-08`, still `status: "draft"`, with no review recorded. Checked against the code:
  - both OCR routes (`/api/foods/photo-text` and `/api/workouts/import/ocr`) use local `recognizePlanText`, with no outbound call;
  - plan documents are parsed in the browser (`plan-extract.ts`, `pdf-browser.ts`);
  - `fit.nextGym` is removed on sign-out (`account-actions.tsx`).
  - **Open:** feedback retention and access, transient-processing wording, free-text gym names, health-data status, the legal basis, the operator, providers, backup retention (Decision 12) and restore handling (S-14). Each is a visible `[TO CONFIRM]`, so `noticeIsFinal()` stays false and real registration stays closed.
- **Branding:**
  - The previous name appears nowhere user-facing in `src` or `public`. The only matches are code identifiers such as `forgetAttempts`, and the word "forge" in a comment.
  - The email subjects use `APP_NAME = "FitWorkoutFoodTracker"`, and the manifest is "FitWorkoutFoodTracker" / "FitTracker".
  - The icons are temporary and unchanged.
- **G2:** `BETA_HOSTING.md` now has prices checked on the providers' own pages, one recommendation and proposed targets. It's **not approved.**
  - **Recommendation:** option A (one Hetzner server, about €14/month excl. VAT, plus about $12/year for a domain).
  - **Proposed targets:** RPO 24 h, RTO 4 h, retention 14 days, owner-held encryption keys.

### 7.5 Final regression, on `8c520a0`

| Check | Result |
|---|---|
| Production build (`npm run build`) | Exit 0 |
| Full guarded regression (throwaway cluster on 127.0.0.1:55434) | **56 ran, 56 passed, 0 failed, 0 blocked.** 5 excluded, on demand as before: `migration-snapshot`, `migration-verify`, `profile-migration-snapshot`, `profile-migration-verify`, `demo-account-e2e`. Includes `privacy-e2e`, `privacy-consent`, `gyms-api`, `gyms-e2e`, `feedback-api`, `account-data(-e2e)`, `csp-e2e`, `pwa`, `barcode`, `workout-import`, `responsive`, `production-security(-e2e)`, `hardening`, `safety-no-marker` (7 passed, 1 skipped, POSIX-only) and `db-guard-scoped` 6/6 |
| Unit tests (vitest) | 71 files: **2,309 passed, 0 failed, 1 skipped** (the on-request evaluation runner) |
| Type check | Clean |
| `npm audit`, all and production only | 0 vulnerabilities |
| Linux image (G1) | **Not run.** Docker Desktop isn't running, and step 5 refuses until the migrations are recorded |
| Physical phones (E1) | **Not run** |

**Why the 5 are excluded:**
- the four migration snapshot and verify suites check a specific migration against a specific database, and run with that migration's approval;
- `demo-account-e2e` writes the demo account on `fitdb_test`.

**Observation T-LOAD-1** (test-only, Low, not a defect):
- **What happened:** one earlier unit run, sharing the CPU with `tsc`, `npm audit` and a second vitest run, failed four tests in `login/route.test.ts`. Three were 5-second timeouts, and one counted 15 instead of 14.
- **Isolated:** 55/55, three times running.
- **Why it isn't the limiter:** `acquirePasswordCheck` checks and increments without an `await` in between, so the cap can't be exceeded.
- **The count of 15:** a timed-out test's login requests kept running and called the shared mock.
- **Log:** kept as `vitest-under-load.txt`.
- **Takeaway:** run the unit tests on their own, as the runner's RC-04 lock already does for the browser suites.

**RC-08 and QA-05, reconciled:**
- **RC-08** (proxy connection failures, test-only): no recurrence in this regression either. The summary has no `ECONNRESET`, `ECONNREFUSED` or `socket hang up`, and the 186 suite logs are kept. Still VERIFIED as test-only, and monitored.
- **QA-05** (late sign-up cleanup): `safety-no-marker` passes again on the throwaway cluster. On the real server it's still BLOCKED by B1b.
- Neither is reopened.

### 7.6 Real-device checklist (E1)

**Access:**
- `tailscale serve` on this PC forwards HTTPS to a server on `127.0.0.1`. Nothing is opened on the home network or to the internet.
- **Disclosure:** Tailscale's HTTPS certificate is published in public Certificate Transparency logs, and it names this machine and the tailnet (`<machine>.<tailnet>.ts.net`). It doesn't expose the service, only the name.
- **Server:** it must run this branch on a database with both migrations: `fitdb_test` after the migration approval (owner action 4), or the throwaway cluster, which needs no database approval but has no demo data.

**Run each step on a real iPhone (Safari) and a real Android phone (Chrome):**

| # | Step | Pass when | iPhone | Android |
|---|---|---|---|---|
| 1 | Open the tailnet address; turn Wi-Fi and Tailscale off and retry | Opens on the tailnet; doesn't open off it | | |
| 2 | Install to the home screen, then launch from the icon | Opens full screen with the app's name | | |
| 3 | Register a new account (stand-in email) and sign in; sign out; sign back in | Each works; after sign-out, Back shows no private page | | |
| 4 | Choose a gym, start a workout, log sets with weights, swap an exercise for an alternative, switch to a named machine, finish | Completed sets kept after the swap; the gym and machine shown in history | | |
| 5 | Start the same exercise at a second gym | Previous performance is the second gym's machine, not the first's | | |
| 6 | Scan a real barcode with the camera | The product found, with its source shown | | |
| 7 | Photograph a real package with its barcode hidden | Candidates found from its words; no value without a source; nothing logged until you choose | | |
| 8 | Import a plan from a screenshot | The rows shown for review; only what you confirm is saved | | |
| 9 | Log a food with a serving amount | The day's totals change; missing nutrients stay blank, not 0 | | |
| 10 | Close the app fully, reopen it | Still signed in; everything from 3–9 still there | | |
| 11 | Sign out, sign in as a second account, open history | None of the first account's data, including while offline | | |
| 12 | Rotate; set large text; use VoiceOver or TalkBack on the workout screen | No overlap or cut-off controls; buttons are announced | | |

Results are filled in only from your own testing. The detailed steps are H.1–H.10 and MG.1–MG.15 in `MANUAL_UI_TESTING_GUIDE.md`.

### 7.7 Approval package (dependency order)

Only actions that need your access, authorization, device, money or acceptance. Each is approved on its own, and approving one approves nothing else.

| # | Action | Why | Risk, data, downtime | Verify | Rollback | Your action |
|---|---|---|---|---|---|---|
| 1 | Check disk encryption | The backups and the B2 scratch copy hold your data; Windows Home has no EFS | None, read-only | BitLocker "Protection On" | n/a | Elevated: `manage-bde -status C:`, and tell me the protection status. If it's off, choose: turn on Device Encryption, or keep backups in an encrypted archive |
| 2 | **B2**: restore check on `fitdb_review` | Proves recovery on real data; A4's prerequisite | Reads `fitdb_review`; a scratch copy of your data exists until it's dropped; no downtime | "RESTORE VERIFIED"; `fitdb_review`'s counts unchanged; scratch dropped | Drop `fitdb_restore_check` | Say "B2 approved" (I run a fresh `pg_dump`, then `restore-check.cjs`, then drop it, as `fit`) |
| 3 | **B1b**: companion test database | QA-05 on the real server | One new test database; no downtime | Both suites pass; other databases' markers and counts unchanged | Drop `fitdb_test_isolated_other` | Say "B1b approved" |
| 4 | **MIG-FB + MIG-GYM on `fitdb_test`** | GYM-ACCEPT and E1 need them; the demo account gets its gyms | Adds 3 tables and 5 nullable columns; existing rows untouched; 3000 and 3001 keep working (older builds ignore new columns) | A backup first; `migrate status`; rows fingerprinted equal; new columns null; FKs valid; no drift; `gyms-api`, `feedback-api` | Forward-only, from the backup | Say "MIG-FB and MIG-GYM approved for fitdb_test" |
| 5 | **A4**: one role per environment | Ends the shared `fit` login | Every server's credentials change; a few seconds per restart; no data changes | `--verify` ISOLATED; servers work; counts equal | `--rollback --confirm=A4 --state=<file>` | After 2: approve, then set `ADMIN_DATABASE_URL` in your own shell and run `--plan`, then `--apply --confirm=A4` |
| 6 | **MIG-FB + MIG-GYM on `fitdb_review`** | Your review copy and the release need them | As 4, on your data; restart 3002 and 3003 | A backup taken and checked with B2's method first; then as 4; then the smoke test (sign in, a workout, a food, a gym) | Forward-only, from the backup | After 2 and 4: say "approved for fitdb_review". I record both names and hashes in `approved-migrations.json` in a commit |
| 7 | **GYM-ACCEPT** and **UX-01** | Product acceptance | None | Your judgement | n/a | Follow MG.1–MG.15 and the UX-01 section; say "accepted", or list what's wrong |
| 8 | **E1** on both phones | Required; can't be simulated | Tailscale certificate name disclosure (7.6) | The 7.6 checklist | Stop `tailscale serve` | Run 7.6 and report the results |
| 9 | **G2** decisions | Hosting, region, ceiling, data access, targets | Cost about €14/month and about $12/year at today's prices | Recorded in `FEATURE_DECISIONS.md` | n/a | Choose a provider and region (recommended: Hetzner, option A), a monthly ceiling, who may read production data, the domain name, and RPO/RTO/retention |
| 10 | **C1 + C2**: email | Registration and password reset | A domain (about $12/year); Resend's free tier | Domain verified; G.1–G.6 in a real inbox | Revoke the key | Buy the domain, create a Resend account, verify the domain, put the key in the env file yourself; then run G.1–G.6 |
| 11 | **G1**: Linux image | Production verification | Starts Docker Desktop | "G1 CHECK PASSED" | n/a | After 6: start Docker Desktop and approve `g1-image-check.cjs --approval=G1` |
| 12 | **NOTICE-B** | Real registration stays closed without it | None | `noticeIsFinal()` true, with a dated review | n/a | Decide the open gaps (7.4) and have the notice reviewed by a lawyer |
| 13 | **Security sign-off** | Required before the beta | n/a | A dated, written sign-off | n/a | Read Part 1's limitations and Part 7's remaining risks; sign off or list what must be fixed |
| 14 | **G3–G7**, then the merge | Staging through the invited beta | Each its own approval | Each gate's checks | Previous image tag | Approve each in order; the merge is approved separately at G7 |

**7.7 is superseded by 8.9.**

---

## Part 8. Staging round (2026-11-08 night to 2026-11-09)

### 8.1 Owner decisions recorded

The owner wrote on 2026-11-08:

- **No further changes to this Windows PC:** no encryption, Windows security settings, firewall, user permissions, system software or PostgreSQL network settings. A1, A2, A3 and SEC-ACL are complete and not repeated. **Owner action 1 in 7.7 (the encryption check) is withdrawn.**
- **The unencrypted C: drive is an accepted limitation** of this local development environment. It is **not** approval to store more sensitive data insecurely: **no new unencrypted copy of real review data without separate approval.**
- **G1 using the existing infrastructure.** Starting the already-installed Docker Desktop (its WSL2 distribution was present, so nothing was installed or configured) is recorded as the G1 approval.
- **Persistent database operations** run only after their own approval is recorded. None was recorded in this round, so none ran.

### 8.2 Read-only database verification (counts only, no row content)

| | `fitdb_test` | `fitdb_review` |
|---|---|---|
| Marker | `…test-database:v1:fitdb_test` | `…review-database:v1:fitdb_review` |
| Migrations applied | 8, through `…_body_metrics` | 8, through `…_body_metrics` |
| Tables | 16 | 16 |
| Foreign keys | 20, all validated | 20, all validated |
| Rows | User 5,698; WorkoutSession 1,635; SessionExercise 4,152; SetEntry 780,388; FoodEntry 10,507; Food 4,220; and so on (832,592 in all) | User 3; WorkoutSession 7; SessionExercise 13; SetEntry 31; FoodEntry 17; Food 15; Exercise 47; and so on |

These are the "before" figures for B2 and the migrations.

### 8.3 G1, the production image on Linux: 14 of 15, not yet passed

Seven runs on Docker 29.8.2 (Linux engine) with disposable data only, each against the commit it names. Evidence is in `FitWorkoutFoodTracker-backups\diagnostics\g1\<time>\results.json`.

| Step | Result (last complete run, `d832521`) |
|---|---|
| 1. Build | **PASS**: 3,307 MB image, about 60 s |
| 2. Layer scan | **PASS**: 16 layers, the 5 local secret values searched for, 0 findings (no env file, account file, Git folder or dump) |
| 3. Throwaway database with TLS | **PASS** |
| 4. Startup refuses a weak database password, and an http origin | **PASS**, both (exit 1). The logs show Next.js's "Ready" line, but G1 joins stderr and stdout, so the order isn't chronological. `production-startup` (in the regression) proves a refused start never listens |
| 5a. The **guarded** migrate image refuses the unapproved migrations, applying nothing | **PASS**: exit 4, no history table. Evidence that the guard works inside the image |
| 5a2. Migrations applied to the throwaway container only (`--disposable-migrations`, `a239a9a`) | **PASS**: 1 s |
| 5b. App starts read-only, with no capabilities, at 1536 MB | **PASS**: 187 MB anonymous |
| 6a–6b. Health; sign-in | **PASS** |
| 6c–6d. Label scan and meal photo, read on the server | **PASS**: 552 ms and 3.6 s. Anonymous memory after the meal model loads: about 833 MB |
| 7. One export at the row limit while a second is refused (429), then the second | **FAIL at 100,000 rows** (`d832521`): answers correct (200 and 429, then 200, 61 MiB); process alive; no OOM kill. But **anonymous memory peaked at 1,517 MB**, against the 1,280 MB required (256 MB under the limit) |
| 7b. An account over the limit is refused with 413 | **PASS** |
| 8. Clean stop | **PASS**: exit 0 in 1 s |

**Run 7 (`749ca8b`, the 50,000-row limit) didn't complete.** Claude Code stopped it after the image build, because the PC was critically low on memory: Docker's VM was holding about 7 GB beside four local app servers. Docker Desktop and its VM were then stopped, returning them to how they were before this round.

**Left for G1:**
- re-run once at `749ca8b` or later;
- one stopped `fit-g1` container and its app image are left on Docker's virtual disk; remove them first: `docker ps -a` to find the container using `fitworkoutfoodtracker:g1-749ca8b`, `docker rm -f` it, then `docker image rm fitworkoutfoodtracker:g1-749ca8b`;
- after MIG-FB and MIG-GYM are approved, run again **without** `--disposable-migrations` for the guarded path.

**G1 tooling defects found and fixed** (test scripts only):
- `57a055c`: layers unpacked with Windows' `tar.exe` (Git Bash's GNU tar read `C:\…` as a remote host);
- `3342345`: the synthetic user gets a profile, as the access gate requires, and the app's logs are kept on failure;
- `d832521`: memory is judged by sampled anonymous memory and OOM kills. The cgroup peak counts file cache; here that cache was 0, so the peak was real.

### 8.4 Defect EXP-01: a large export crashed the production app (FIXED in code; the G1 check is pending)

- **Severity: High (availability).** The beta has one app instance, so one export by one account took the service down for everyone until the container restarted.
- **Repro (G1, `57a055c`):** an account with 249,000 food entries exports in the 1536 MB container: "FATAL ERROR: Reached heap limit … JavaScript heap out of memory", exit 139.
  - The earlier 250,000-row limit was judgement ("not measurement").
  - The Windows measurement (about 700 MB, S-13) missed it, because Node on Windows doesn't size its heap from a container limit.
- **Root cause:** the export is deliberately buffered (so a cut-off download can't look complete). It holds about 6.8 KB of anonymous memory per row while it's built. On top of the meal model's about 833 MB, the container has room for only so many rows.
- **Fix:**
  - `MAX_EXPORT_ROWS` 250,000 → **50,000** (`c26775b`, `749ca8b`): about a decade of heavy logging; the beta's real accounts hold under 200 rows;
  - `MAX_CONCURRENT_EXPORTS` 2 → **1** (`dbcdf4c`): a second export gets the existing 429 with `Retry-After: 5`.
  - The unit test now fills exactly that many slots, and checks the next person is refused and then served.
- **Evidence so far:**
  - 100,000 rows: 1,517 MB, alive, no OOM kill;
  - over the limit: 413;
  - 50,000 rows: measurement pending (run 7, above). By the measured rate it's about 1,175 MB, under the 1,280 MB bar.
- **Behaviour change (owner to note):** an account with more than 50,000 rows can't download its export in one file, and is told to contact support. Raising the limit needs a **streamed export**, recorded as follow-up EXP-02. It's needed before the beta grows beyond invited testers.

### 8.5 B2, prepared under the "no new unencrypted copy" rule

- `restore-check.cjs` restores a plain dump into `fitdb_restore_check` on the same server. **Any real-data restore creates a plaintext database copy on C:** for the minutes until it's dropped. No mechanism avoids that without installing software, which is ruled out.
- **The procedure with the fewest copies:**
  - **no fresh dump**: restore the **existing** `fitdb_review-2026-11-07-21-52-51.dump` (in the folder fixed by SEC-ACL). `restore-check.cjs` reports row counts beside the source's, and allows for growth since the backup;
  - create the empty scratch database, check, and **drop it immediately**;
  - **the only new copy is the transient scratch database.**
- **Needs:** the owner's approval of that transient copy (8.9, action 1).
- **The alternative needs no approval but proves less:** the mechanism has already been proven twice on throwaway data (Part 2).

### 8.6 The `fitdb_test` migrations, ready to run on approval

**New:** `scripts/table-fingerprint.cjs` (`57a055c`), read-only. Before a migration it records each table's row count and an MD5 over its original columns in key order, then compares after.
- **Self-test on the throwaway cluster, 7 of 7:** an added column and an added migration read as unchanged; an edited value, a NULL changed to a value, a deleted row and a dropped column are each detected.
- **Trial on `fitdb_test`:** 16 tables and 832,592 rows in about 7 s, UNCHANGED.

**Full rehearsal on a current copy of `fitdb_test`** (synthetic test data; `fitdb_test` only read; the copy was restored into the throwaway cluster, then dropped, and the dump deleted): **9 of 9.**
1. Dump: 12 MiB in 1 s.
2. Restored: 8 migrations.
3. Fingerprint saved.
4. `migrate deploy` applied `…_feedback` and `…_multi_gym` in 1.1 s.
5. Every existing row unchanged over its original columns.
6. 0 of 1,635 workouts with a gym; 0 of 4,152 exercises with a machine, swap or plan link.
7. `Feedback`, `GymLocation` and `GymEquipment` exist, and are empty.
8. 31 foreign keys, 0 unvalidated; 4 indexes on the new columns, as in the migration (`plannedExerciseId` has none, by design: it only slows the rare deletion of an exercise).
9. No drift from `schema.prisma`.

**Runbook, on approval** (from `FitWorkoutFoodTracker-beta`, with `fitdb_test`'s own env file; test data only):
1. `pg_dump -Fc` of `fitdb_test` into `FitWorkoutFoodTracker-backups\` (the protected folder), then `pg_restore --list` on it.
2. `node --env-file=../FitWorkoutFoodTracker/.env.test scripts/table-fingerprint.cjs --save=<backups>\fp-fitdb_test-before.json`
3. `node --env-file=../FitWorkoutFoodTracker/.env.test node_modules/prisma/build/index.js migrate deploy`. `fitdb_test` is a test database, so the approved list doesn't apply, as `local-db.cjs` documents.
4. `table-fingerprint.cjs --compare=…`: UNCHANGED. Then the null-link and new-table checks, and `migrate diff --exit-code` (as in the rehearsal).
5. `demo-account.cjs --status`: identical. 3000 and 3001 still answer (older builds don't read the new columns).
6. Then GYM-ACCEPT: populate the demo account's gyms (`demo-account.cjs --populate`, which writes only the demo account's rows), and serve this branch's build for MG.1–MG.15.

**`fitdb_review` (later, separately):** the same steps after B2, with the two names and hashes recorded in `prisma/approved-migrations.json` in a commit that names the approval. Run through `local-db.cjs --init --confirm=fitdb_review`, which then allows them. Smoke test: sign in, a workout, a food, a gym.

### 8.7 B1b and A4: unchanged, ready

- **B1b:** as in Part 2, from the release folder (8 migrations). It creates only a test database, with no real data.
- **A4:** `--verify` NOT ISOLATED, as expected; the six env files and the roles are unchanged (7.3). Prerequisites still open: B2, then the owner's approval, and the superuser password typed by the owner. No credential was changed.

### 8.8 Final regression

**Final candidate tested: `749ca8b`.** Evidence: `FitWorkoutFoodTracker-backups\diagnostics\release-execution-749ca8b\`.

| Check | Result |
|---|---|
| Production build | Exit 0 |
| Guarded regression (throwaway cluster) | **56 ran: 55 passed, 1 failed (`meal`), 0 blocked.** 5 excluded, on demand as before (the four migration snapshot and verify suites; `demo-account-e2e`). Passed: `account-data` 26/26, `account-data-e2e`, `production-startup` 19/19, `production-security` 14/14, `production-security-e2e`, `safety-no-marker` (7 passed, 1 skipped, POSIX-only), `db-guard-scoped` 6/6, and the rest |
| `meal`, then on its own | Failed once in the full run; **passed 3 of 3 on its own** right after (`meal-reruns\`) |
| Unit tests | 71 files: **2,309 passed, 0 failed, 1 skipped** (the on-request evaluation runner) |
| Script tests | Script audit 60/60, `migration-safety` 8/8, `mig-04` 103/103, `local-security` 2/2, `demo-account` 33/33, `account-facts` 18/18 |
| Type check | Clean |
| `npm audit` | 0 (at `8c520a0`; no dependency changed since) |
| Linux image (G1) | 14 of 15 at `d832521`; the run at `749ca8b` didn't complete (8.3) |
| Physical phones | Not run |

**Observation M-WK-1** (open, Low, intermittent, cause not determined):
- **What failed:** in the full run, every functional check of `meal` passed in Chromium, Firefox and WebKit. Then its final "no page errors" assertion caught one WebKit error: a food-search request (`/api/foods/search?q=7 Up…`) "cancelled due to access control checks". That is how WebKit reports an in-flight request that was aborted.
- **The server log** has no error.
- **Not RC-08:** proxy connection resets appear in every browser suite, passing ones included, so they don't explain this.
- **Frequency:** once in the four full regressions recorded on this branch (`5c5d7d2`, `e35f76d`, `8c520a0`, `749ca8b`); three isolated runs since are clean.
- **Not caused by this round's changes:** `meal` doesn't use the export.
- **Next step:** if it recurs, trace that run's request timing.

**RC-08 and QA-05:**
- RC-08 (proxy connection failures): no recurrence of its own failure mode. Still VERIFIED as test-only.
- QA-05: `safety-no-marker` passes; on the real server it's still blocked by B1b.

**What this regression covers:** application code changed only in `export.ts` (and its test) since `8c520a0`, and every suite that exports passed.

### 8.9 Approval package (dependency order; replaces 7.7)

| # | Action | Risk, data, interruption | Verify | Rollback | Owner says |
|---|---|---|---|---|---|
| 1 | **B2** with the existing dump (8.5) | A transient plaintext copy of review data in `fitdb_restore_check`, dropped immediately; no interruption | "RESTORE VERIFIED"; `fitdb_review` unchanged; scratch dropped | Drop the scratch database | "B2 approved, transient copy accepted" |
| 2 | **B1b** | One test database, no real data; no interruption | Both suites pass; other databases unchanged | Drop `fitdb_test_isolated_other` | "B1b approved" |
| 3 | **MIG-FB + MIG-GYM on `fitdb_test`** (8.6) | Adds 3 tables and 5 nullable columns to test data; no interruption | Fingerprint UNCHANGED; nulls; no drift; suites | Forward-only, from the backup | "MIG-FB and MIG-GYM approved for fitdb_test" |
| 4 | **G1 re-run** | Starts Docker Desktop; disposable containers only; uses about 7 GB of RAM while it runs, so close other heavy apps first | "G1 CHECK PASSED", with step 7 under 1,280 MB anonymous at 50,000 rows | n/a | "re-run G1" |
| 5 | **A4** | Every server's credentials change; a few seconds per restart; no data changes | `--verify` ISOLATED; servers work; counts equal | `--rollback --state=…` | After 1: "A4 approved"; you type the superuser password |
| 6 | **MIG-FB + MIG-GYM on `fitdb_review`** | Your review data gains the new tables and columns; restart 3002 and 3003 | As 3, plus the smoke test | Forward-only, from the backup | After 1 and 3: "approved for fitdb_review" |
| 7 | **G1, guarded path** | As 4 | "G1 CHECK PASSED" without `--disposable-migrations` | n/a | After 6: "run G1 guarded" |
| 8 | **GYM-ACCEPT** and **UX-01** | None | Your judgement | n/a | "accepted", or what's wrong |
| 9 | **E1** on both phones (7.6) | Tailscale's certificate publishes the machine and tailnet name | The 7.6 checklist | Stop `tailscale serve` | The results |
| 10 | **G2** decisions | About €14/month and $12/year (verified prices) | Recorded in `FEATURE_DECISIONS.md` | n/a | Provider and region, ceiling, data access, domain, RPO/RTO/retention |
| 11 | **C1 + C2** email | Domain purchase; Resend free tier | Verified domain; G.1–G.6 | Revoke the key | Buy the domain; you enter the key |
| 12 | **NOTICE-B** | None | `noticeIsFinal()` with a dated review | n/a | Decisions plus a legal review |
| 13 | **Security sign-off**, including EXP-01's new limits | n/a | Dated, written | n/a | "sign-off given", or what to fix |
| 14 | **G3–G7**, then the merge | Each its own approval | Each gate's checks | Previous image tag | In order |

**8.9 is superseded by 9.6.**

---

## Part 9. Release completion round (2026-11-09)

Evidence: `FitWorkoutFoodTracker-backups\diagnostics\release-execution-caca244\`, which includes both Linux runs' artifacts.

### 9.1 G1 on Linux: PASSED, 17 of 17 (disposable-migration path)

This PC couldn't run G1 safely:
- **Commit charge:** 39.1 of its 47.2 GB commit limit was in use, 12.4 GB of it by one other application.
- **What G1 needs:** Docker's VM needs about 7 GB.
- **Constraint:** no Windows settings can be changed.

So G1 ran on an isolated Linux machine instead:
- **Where:** a GitHub-hosted Ubuntu 24.04 runner, through `.github/workflows/g1-linux.yml` (`b7d0cc7`): 4 vCPU, 16 GB, Docker 28.0.4, cgroup v2.
- **Isolation:** synthetic data, throwaway containers, a read-only token, no secrets, and no pull-request trigger.
- **Same limits:** the app container has the production limits, so its memory figures mean the same as on the server.

| Run | Commit | Result | Step 7 (the export) |
|---|---|---|---|
| [42557578695](https://github.com/aseelalmanahy/FitWorkoutFoodTracker/actions/runs/42557578695) | `b7d0cc7` (1536 MB, heap not pinned) | **FAIL, 15 of 16** | Correct answers, no OOM kill, but anonymous memory peaked at **1,326 MB** of 1,536 and **stayed at 1,267 MB** afterwards: V8 kept the heap it grew |
| [42558272013](https://github.com/aseelalmanahy/FitWorkoutFoodTracker/actions/runs/42558272013) | `caca244` (2048 MB, heap pinned at 768 MB) | **PASS, 17 of 17** | Peak **1,360 MB** of 2,048 (688 MB margin; 256 required); **1,138 MB** afterwards; 0 OOM kills; 0 restarts |

**Memory at `caca244`** (anonymous, MB):

| Point | MB |
|---|---|
| Started | 184 |
| After a label scan | 286 |
| After the meal model loads | 774 |
| Export at the limit, highest | 1,360 |
| Afterwards | 1,138 |

**Export behaviour verified:**
- An export at 50,000 rows succeeds while a simultaneous second one is refused (429). The second then succeeds (30 MiB, 6 s).
- An account over the limit is refused with 413 and not loaded.
- **New 7c:** after both refusals, an ordinary account exports whole (25 of 25 entries), health answers, and the process hasn't restarted. Nothing is held by a refused export.
- **New 5c:** the running server's own environment has `NODE_OPTIONS=--max-old-space-size=768`, and Node reports an 864 MB heap limit (768 old space plus the young generation).

**Qualifications:**
- **Secret-value scan:** on the runner it had no local values to search for. The local run at `d832521` searched for 5 and found 0. The file checks ran in both.
- **Guarded migration path:** still to run, after MIG-FB and MIG-GYM are approved (`--disposable-migrations` dropped).

### 9.2 EXP-01: VERIFIED FIXED on Linux

The final fix has three parts:
- `MAX_EXPORT_ROWS` 50,000 (`749ca8b`);
- one export at a time (`dbcdf4c`);
- Node's heap pinned at 768 MB and the app container at 2,048 MB (`caca244`).

All three were verified by run 42558272013 above. The unit test in `deploy-config.test.ts` now pins `mem_limit: 2048m` and the heap setting, in the commit that adds this part.

**Hosting impact:** still fits the recommended 4 GB server (`BETA_HOSTING.md`).

**Follow-up EXP-02:** a streamed export, before the limit is raised.

### 9.3 M-WK-1: ROOT CAUSE FOUND, FIXED (test defect)

- **Cause:** step 10b of `e2e-meal.cjs` put "7 Up" in the food search, waited a fixed 450 ms, then navigated (step 11, `page.goto`). The search box sends its request 500 ms after its last change. When the timer fired as the navigation began, WebKit reported the request the navigation cancelled as a page error: "Fetch API cannot load … due to access control checks". The app catches that failure (`api()` turns it into an `ApiError`, and the search records it). The suite already exempted the identical WebKit message for Next.js's own router requests.
- **Evidence:** in the failed run's proxy trace, all 12 searches completed with 200, and none was the "7 Up" search, in any browser. It never reached the server. The window (450 ms plus about 50 ms of assertions, against a 500 ms debounce) explains why it was intermittent, and why only WebKit failed.
- **Fix (`caca244`):** the suite waits for the search response itself, then asserts the query was "7 Up" and that nothing was selected. That's a stronger check than before.
- **Result:** 3 of 3 isolated, and passing in the full regression below.

### 9.4 Security

- **SEC-ACL:** the folder stays secured. Its rollback documentation is corrected in 7.2: `/reset` was rehearsed and is identical while Desktop's permissions are unchanged; `/restore` fails without elevation.
- **Demo password rotated (2026-11-09)**, through the app's own route on 3000:
  - change 200; the new password logs in;
  - the old password is refused (401), and the session from before the change is revoked (401);
  - `demo-account.cjs --status` reports the password works, with every row count identical;
  - the new value is only in the Git-ignored `demo-account.local.md` and was never printed.

### 9.5 Final regression, on `caca244`

| Check | Result |
|---|---|
| Production build | Exit 0 |
| Guarded regression (throwaway cluster) | **56 ran, 56 passed, 0 failed, 0 blocked.** 5 excluded, on demand as before: `migration-snapshot`, `migration-verify`, `profile-migration-snapshot`, `profile-migration-verify`, `demo-account-e2e`. Includes `meal`, `account-data` 26/26, `account-data-e2e`, `production-startup` 19/19, `safety-no-marker` (7 passed, 1 skipped, POSIX-only), `db-guard-scoped` 6/6 |
| Unit tests | 71 files, **2,309 passed, 1 skipped** (the on-request evaluation runner), after one expectation was updated for the measured 2048 MB limit (first run: 1 failed, `deploy-config.test.ts`, which pinned `1536m`) |
| Script audit | 60/60, which also checks Compose and the Dockerfile agree with G1 |
| Type check; `npm audit` | Clean; 0 vulnerabilities |
| Linux image | **G1 PASSED** (9.1) |
| Physical phones | Not run |

**Why the 5 are excluded:**
- the four migration snapshot and verify suites check a specific migration against a specific database, with that migration's approval;
- `demo-account-e2e` writes the demo account on `fitdb_test`.

**Code since the regression:** only `deploy-config.test.ts` (a test) and documentation.

### 9.6 Databases and the one approval request

**Which local databases hold synthetic data** (read-only; accounts classified by email domain, counts only):

| Database | Accounts | Data |
|---|---|---|
| `fitdb_test` | 5,698, all on reserved test domains | **Synthetic** |
| `fitdb_test_isolated` | 1,713, all on reserved test domains | **Synthetic** |
| `fitdb_test_other` | 0 | Empty |
| `fitdb_review` | 3, on one real domain | **Real** (the owner's) |
| `fitdb` | 1, on a real domain, unmarked | Treated as **real** |

**One approval covers the three operations, run in order, each stopping everything on failure:**
1. **B2** (8.5):
   - restore the **existing** `fitdb_review` dump into a new, empty `fitdb_restore_check`, with no fresh dump;
   - check: "RESTORE VERIFIED", and `fitdb_review`'s fingerprint and counts unchanged;
   - **drop the scratch database immediately**.
   - Real data: a transient plaintext copy, for minutes.
2. **B1b** (Part 2):
   - from the release folder (8 migrations), create `fitdb_test_isolated_other`;
   - run `safety-no-marker` and `db-guard-scoped`;
   - check the other databases' markers and counts.
   - Synthetic data only.
3. **MIG-FB + MIG-GYM on `fitdb_test`** (8.6 runbook, rehearsed 9/9):
   - backup, then `pg_restore --list` on it;
   - fingerprint;
   - `migrate deploy`;
   - fingerprint compare, null links, foreign keys, drift;
   - `gyms-api`, `feedback-api`;
   - demo status.
   - Synthetic data only.

**Wording that approves all three:** "B2, B1b and MIG-FB + MIG-GYM on fitdb_test approved; B2's transient copy accepted." Any part can be approved alone.

**Still behind their own gates:** A4, the migrations on `fitdb_review`, the guarded G1 run (after `fitdb_review`), and everything from 8.9 rows 8–14.

---

## Part 10. Database operations (2026-11-09)

**Owner approval, recorded verbatim:** "B2, B1b and MIG-FB + MIG-GYM on fitdb_test approved; B2's transient copy accepted." Order: B2, then B1b, then the migrations, **stopping at the first failed check**. Not authorized: any change to `fitdb_review` beyond B2's temporary restore, to `fitdb`, to A4 credentials, or to production.

Evidence: `FitWorkoutFoodTracker-backups\diagnostics\db-ops-2026-11-09\`.

| # | Operation | Result |
|---|---|---|
| 1 | **B2** | **PASSED** |
| 2 | **B1b** | **FAILED**: `db-guard-scoped` 6/6; `safety-no-marker` 5 passed, **2 failed**, 1 skipped |
| 3 | **MIG-FB + MIG-GYM on `fitdb_test`** | **NOT RUN**: the sequence stopped at B1b, as instructed |

### 10.1 B2: PASSED

Run from the release folder (`ca015e5`; its `restore-check.cjs` is identical to this branch's apart from line endings).

1. **Before:** `table-fingerprint.cjs --save` on `fitdb_review` (read-only): 16 tables, 249 rows, 8 migrations.
2. **Created** an empty `fitdb_restore_check` (owner `fit`, no marker, 0 tables).
3. **Restored** with `restore-check.cjs --backup=…\fitdb_review-2026-11-07-21-52-51.dump`: **"RESTORE VERIFIED"**.
   - 8 migrations, 17 tables, 153 columns, the owner's account and the 47 built-in exercises, all matching `fitdb_review`'s schema.
   - Rows restored against `fitdb_review` now: AccountToken 0/0, BodyMetric 2/2, Exercise 47/47, Food 6/15, FoodEntry 5/17, FoodServing 19/58, NutritionTarget 1/1, Profile 3/3, ScheduleSlot 1/3, Session 13/40, SessionExercise 5/13, SetEntry 11/31, TemplateExercise 2/6, User 3/3, WorkoutSession 3/7, WorkoutTemplate 1/3, `_prisma_migrations` 8/8.
4. **After:** `fitdb_review` independently compared: **UNCHANGED**, every row identical and every foreign key validated.
5. **Dropped** `fitdb_restore_check`, confirmed absent.

**No new backup was created.** The only dump is the existing one from 2026-11-07.

**Finding:** that backup is **two days behind** `fitdb_review` (for example 5 of 17 food entries). B2 proves that a backup restores, not that a recent one exists. On staging this is the job of the nightly backup (RPO 24 h, proposed in G2). Locally, the owner chose not to keep another copy.

### 10.2 B1b: FAILED (no data was harmed)

Run from the release folder, with 8 migrations, as planned.

**Steps:**
- `local-db.cjs --init --confirm=fitdb_test_isolated_other`: created, 8 migrations, 47 built-in exercises, marked, READY.
- Then the runner, with `safety-no-marker db-guard-scoped`.

**Databases afterwards (read-only):**
- **Fingerprint-identical** to just before B1b: `fitdb_review`, `fitdb_test` and `fitdb`.
- `fitdb_test_isolated` (synthetic): users 1,713, the same as before; **no test user left behind**. Its AccountToken count went 1 → 0 (explained below).
- `fitdb_test_isolated_other`: exists, synthetic, no users. **Left in place** for a diagnostic re-run. Rollback: drop it.

**Failure 1, "matching DB: … cleanup restores row counts". Cause found; a test assumption, not an app defect.**
- **What the test saw:** every count matched before and after, except `AccountToken`, 1 → 0.
- **Why:** issuing any link first deletes every **expired** link (`access.ts:56`), as the privacy notice states. The test's sign-up issued a link, so the one pre-existing token was purged.
- **Why it must have been expired:** a live token is deleted only for its own email or user, and the test uses new addresses.
- **Where it came from:** most likely an earlier test run's sign-up link that never became a user. The live check's cleanup sweeps users, not orphaned sign-up links: a test-cleanup gap, in a synthetic database only.
- **Why it passed elsewhere:** on the throwaway cluster the table started empty.

**Failure 2, "request TIMEOUT: a sign-up that lands after the client gave up is removed by the second sweep" (QA-05's test). Cause NOT determined.**
- **What the test does:** a proxy holds `POST /api/auth/register/complete` for 2.5 s, the client gives up at 1 s, and a second sweep runs 5 s later.
- **What happened:** the client timed out as intended, but the held request **never created a user**. The second sweep found none, and `fitdb_test_isolated` still has exactly 1,713 users. So the cleanup worked, but the late write it exists to catch never happened. QA-05's protection is therefore **unverified on the real server**, not disproved.
- **No more evidence available:** the suite deletes its report files, and the test app's server log isn't kept.
- **Elsewhere:** passed on the throwaway cluster in every full regression (including `caca244`).

**Not done, under the stop rule:**
- no re-run of the suites;
- no change to either test;
- the migrations on `fitdb_test`;
- dropping the companion database.

**Safest next step (one approval):** "B1b diagnostic re-run approved". It re-runs `safety-no-marker` against the real server, synthetic data only, with the test app's server log and the live check's report kept.
- **Failure 1:** it should then pass, as the expired token is gone. If so, the cleanup gap gets a separate test fix: the live check also removes the sign-up links of its own test addresses.
- **Failure 2:** the server log will show whether the held request reached the app, and what it answered.
- **Then:** if both pass, and the protected databases are unchanged, B1b passes, and the `fitdb_test` migrations can proceed under the approval already given, if the owner confirms.

### 10.3 Also done

**SEC-ACL:**
- the backup folder is still restricted (unchanged);
- the rollback is corrected (7.2).

### 10.4 Second execution (the same approval, re-sent by the owner): B1b PASSED, migrations APPLIED

**B2:** not repeated. It had passed, and repeating it would have made a second plaintext copy of the owner's data for no new evidence.

**B1b, re-run 1** (the same suites, unchanged):
- the stale-token failure was gone (as predicted in 10.2);
- QA-05's late-sign-up test **failed again**, reproducibly.

**Root cause:** the release folder (`ca015e5`) predates commit `d6f94f3` (2026-11-08). That commit's instrumented QA-05 investigation found:
- the delayed completion *does* reach the app, and is correctly refused with 400: the first sweep had already deleted the run's sign-up links;
- so no late account can exist, and the old test wrongly expected one.

The fixed test checks both guarantees, with a negative control. It is the only change to that file between `ca015e5` and `caca244`.

**B1b, re-run 2** (the release candidate's test, with 8 migrations kept):
- **Method:** the candidate's `live-provider-check.safety.test.cjs` (blob `21a7e57`) was put into the release folder's working tree for the run, and then restored (0 changed files after). No commit or branch changed.
- **Result: `safety-no-marker` 7 passed, 1 skipped (SIGTERM; POSIX only); `db-guard-scoped` 6/6.**
- `fitdb_review`, `fitdb_test` and `fitdb` were fingerprint-identical before and after.
- `fitdb_test_isolated`: still 1,713 users.
- **B1b PASSED.** QA-05 is VERIFIED on the real server.

**MIG-FB + MIG-GYM on `fitdb_test`: APPLIED AND VERIFIED** (`mig-fitdb_test.txt`):

| Step | Result |
|---|---|
| Backup | `fitdb_test-before-MIG-FB-GYM-20261108-235610.dump`: 12.4 MB, 17 tables of data, lists cleanly. Synthetic data, in the restricted folder |
| 0 | The pending migrations were exactly MIG-FB and MIG-GYM, with their reviewed hashes; the marker is `fitdb_test`'s |
| 1–2 | Fingerprint saved (832,567 rows); `prisma migrate deploy` applied both in 0.9 s |
| 3 | **Every existing row unchanged** over its original columns |
| 4a | 0 of 1,635 workouts with a gym; 0 of 4,152 exercises with a machine, swap or plan link: **nothing invented** |
| 4b | `Feedback`, `GymLocation` and `GymEquipment` exist, empty |
| 4c | 31 foreign keys, 0 unvalidated; 4 indexes on the new columns |
| 4d–e | No drift (`migrate diff` exit 0); `migrate status`: 10 migrations, up to date |

**Afterwards:**
- `fitdb_review` and `fitdb`: fingerprint-identical; **not touched**.
- The demo account: identical rows, and its password works.
- 3000 and 3001 (older builds, on the migrated `fitdb_test`): health, sign-in, reads and sign-out all work.

**Regression against the migrated `fitdb_test`** (the candidate's build): **9 of 9 passed**:
- `gyms-api` 23/23, `gyms-e2e`;
- `feedback-api` 8/8;
- `account-data` 26/26, `account-data-e2e`;
- `workout-sets` 25/25, `nutrition-api` 79/79;
- `workout-import-api` 8/8, `e2e-smoke`.

**Multi-gym with the demo account:**
- **Populated:** `demo-account.cjs --populate`, with the password kept, added 2 gyms (City Gym, Home gym), 11 equipment rows (2 named machines) and the day since the last run.
- **Round trip, 12/12,** on the candidate's build (a server on `127.0.0.1:3004` against `fitdb_test`, stopped afterwards), as the demo account:
  - its gyms and named machines list;
  - a workout starts at City Gym;
  - an exercise goes on the "Lat pulldown station", and a set is logged;
  - 2 alternatives are offered (Chin-Up, Pull-Up);
  - the swap keeps the completed set on the original and links the replacement;
  - a gym change is refused with 409 while a machine at the current gym is in use, as designed (`gyms.ts:155`);
  - the workout is discarded (200, then 404).
  - **The demo account's row counts are identical before and after.**
- **Limitation:** only 1 of the demo's 32 workouts has a gym, and none has machine history. The account's workouts were created before MIG-GYM, and the demo script never updates rows. For MG.1–MG.15 the owner logs workouts in the app, and the gyms and machines are ready for it.

**`demo-account-e2e` (the demo account in three browsers):**
- **Date dependence fixed** (`e2e-demo-account.cjs`): its "a partly reported day is marked" check failed on Monday 2026-11-09, because the history page marks only the selected week, which then held one day. The check now steps back at most three weeks.
- **Result:** 31 of 31 functional checks passed in Chromium, Firefox and WebKit. The final "no page error" check failed in WebKit only, on two Next.js messages: "Failed to fetch RSC payload for …/dashboard" and "…/nutrition/history?week=2026-10-26 … Falling back to browser navigation. TypeError: Load failed". Next.js then loads the page fully, and its content checks pass.
  - Waiting for the network to settle didn't change it, so it isn't the test cutting a request short.
  - It's the same family as the WebKit `_rsc` failure the suite already exempts on plain-http localhost (the WebKit build here won't send the Secure cookie over http, and the suite works around that).
  - **Observation WK-RSC-1:** open, Low, test environment, cause not determined. The exemption was deliberately **not** widened. The suite has no multi-gym steps; that is covered by the round trip above.

**Still not authorized and not done:** `fitdb_review`'s migrations, A4, and the guarded G1 run.


---

## Part 11. Cloud deployment readiness (2026-11-09)

**Owner decision (2026-11-09):**
- Production and staging are built in the cloud, independent of the owner's computer.
- Local A4 and `fitdb_review`'s migrations are **not** prerequisites for the cloud: a fresh cloud database has its own credentials and the guarded migration step.
- No local Windows, Docker or backup work.

**The candidate:** `feature/multi-gym-exercise-alternatives` at `d7d278d` (application code unchanged since `caca244`, which passed the full regression; the changes since are deployment files, the migrate image, CI and documentation).

### 11.1 What was built

| Piece | Files |
|---|---|
| The single-server stack: app, PostgreSQL 18 and Caddy | `deploy/compose.single-server.yml`, `deploy/postgres/10-roles.sh` (TLS only, least-privilege roles), `deploy/single-server.env.example` |
| Deploy, with automatic rollback | `deploy/deploy.sh` (pre-deploy backup, guarded migrate step and seed, health, smoke, rollback to the previous tag; image digests recorded) |
| Smoke test and user journey | `deploy/smoke.sh`, `scripts/staging-journey.cjs` |
| Encrypted backup and verified restore | `deploy/backup.sh`, `deploy/restore.sh` (age, to the owner's public key; the private key never on the server; offsite by `rclone`, upload only) |
| Server provisioning | `deploy/provision/cloud-init.yml` (deploy user, key-only SSH, ufw, unattended upgrades, Docker, swap, nightly backup timer) |
| Synthetic staging accounts | `scripts/create-staging-account.cjs` (reserved test domains only, `*_staging` databases only; registration stays closed under the draft notice) |
| Image publishing (by hand) | `.github/workflows/release-image.yml` (GHCR, commit-tagged, digests in the summary, release branch or `main` only, actions pinned) |
| The rehearsal | `.github/workflows/staging-rehearsal.yml` |
| The runbook | `docs/PHASE_4_0_3_DEPLOYMENT.md`, "Single-server deployment, option A": procedure, rollback, backup, DNS, email, oversized exports |

### 11.2 Defects found and fixed this round

| ID | Severity | Found by | Defect | Fix |
|---|---|---|---|---|
| DEP-01 | **High** (deployment-blocking) | The rehearsal | A fresh database had **0 built-in exercises**: the migrate step only migrated, and the seed ran only in local tooling. Nobody on a new server could add an exercise to a workout | The migrate image generates Prisma's client and runs `prisma/seed.ts` after the guarded step succeeds (`267a6ea`). Verified: 47 seeded, then 0 added on re-runs |
| DEP-02 | Medium (build reliability) | G1 and the rehearsal (both failed) | `onnxruntime-node` downloaded optional **CUDA** binaries from GitHub at install; GitHub answered 504, and every release build failed | Skipped (`014d813`); the CPU runtime ships in the package. Meal photos still pass in G1; the image shrank from 2,331 to 2,003 MB |
| DEP-03 | Medium | The rehearsal | After a rollback, Caddy kept the app out of rotation for up to 30 s, so `deploy.sh` reported **ROLLBACK ALSO FAILED** for a healthy rollback | Waits up to 60 s for the proxy to route again (`d7d278d`) |
| SR-1 | Medium | The security review | Every deploy after the first would fail its backup: the deploy user can't write root's backup folder | The backup runs as the root systemd unit (`267a6ea`) |
| SR-2 | Medium | The security review | `create-staging-account.cjs` could run on production, making an account that skips the notice | Refuses any database not named `*_staging` |
| SR-3 | Medium | The security review | A compromised server could delete the offsite backups | Upload only; retention by the bucket's lifecycle rule |
| SR-4 | Medium | The security review | Release images and actions weren't pinned | Actions pinned to SHAs; publishing from the release branch or `main` only; digests recorded at publish and deploy |

The independent review found **no critical or high issue**.

**Lows accepted, recorded:**
- **Database TLS isn't authenticated.** It uses the image's snakeoil certificate with `sslmode=require`. Its exposure is the internal Docker network only. A per-server certificate and `verify-full` are a later hardening.
- **The deploy user is root-equivalent** through the docker group. That's inherent to running Docker; SSH to it is key-only and limited to the owner's IP.
- **The database container's environment holds the role passwords,** readable by root on the server.
- **A restored copy** allows `fit_app` to write the migration history until the migrate step runs again (documented in `restore.sh`).

### 11.3 Evidence

**The staging rehearsal: [run 42569013328](https://github.com/aseelalmanahy/FitWorkoutFoodTracker/actions/runs/42569013328), at `d7d278d`. 108 checks passed, 0 failed.** It ran on a disposable Ubuntu 24.04 runner, with synthetic data and generated, masked passwords.

1. **An empty PostgreSQL:**
   - TLS on; the network rule is `hostssl`; a connection without TLS is refused;
   - roles `fit_app` and `fit_migrator`.
2. **The guarded step refuses the unapproved migrations** (exit 4) and applies nothing. Then, with a disposable approval recorded only in the runner's copy of the list after checking the reviewed hashes, **the first deploy runs from empty**:
   - all 10 migrations, and the 47 built-in exercises seeded;
   - 31 foreign keys, all validated; no drift;
   - `fit_migrator` owns every table;
   - `fit_app` can't change the schema or the migration history, has rows, and connects over TLS;
   - running the migrate step again: nothing pending.
3. **HTTPS through Caddy, with the chain verified:**
   - headers (HSTS, CSP, nosniff, referrer policy), no `Server` header;
   - HTTP→HTTPS redirect; 401 without a session; the identity endpoint off (404);
   - a synthetic account signs in, with a cookie that is `Secure`, `HttpOnly` and `SameSite`;
   - a real address is refused for a staging account.
4. **The journey, 15 of 15:**
   - sign in → profile → gym → a workout at the gym → exercise → set → finish;
   - custom food → logged → the day's total (240 kcal);
   - **the export holds the gym, the workout at it and the food entry**, and isn't cached;
   - signed out: 401.
5. **Restarts:** the database and the app restarted, with users, gyms, workouts and food entries unchanged (1/1/1/1).
6. **Backup and restore:**
   - the backup is age-encrypted (20 tables of data) and can't be read without the key;
   - `restore.sh` restores it into a new database: 20 tables, 10 migrations, matching counts, "RESTORE VERIFIED";
   - a restore over the live database is refused.
7. **Rollback:** a release that can't start fails its health check, and **`deploy.sh` rolls back automatically** ("ROLLED BACK to ci-a, which is healthy"), with smoke passing afterwards.
8. **Logs and shutdown:** no password or account address in any container's log; the app stops cleanly (exit 0).
9. **Memory, idle after the run:** app 196 MB of 2 GB, PostgreSQL 54 MB of 768 MB, Caddy 15 MB of 256 MB.

**G1 on Linux: [run 42568545382](https://github.com/aseelalmanahy/FitWorkoutFoodTracker/actions/runs/42568545382), at `267a6ea`, PASSED 17 of 17** (as in Part 9, with the new migrate image). Earlier at `014d813`: the export at the 50,000-row limit, 429, 413 and an ordinary export afterwards; the meal photo in 1.7 s.

**Tests run locally this round:**
- `deploy-config` 19/19;
- `migration-safety` 8/8, now asserting the guarded step runs before the seed and that `migrate deploy` is never run directly;
- the script audit 60/60, which registers both new scripts.

**Not re-run:** the full guarded regression. The application code hasn't changed since `caca244` (56/56). **No real server, domain, email or phone was used.**

### 11.4 Sizing

| | Measured on Linux |
|---|---|
| App | 0.8 GB with the meal model loaded; 1.36 GB peak during an export at the limit; container limit 2 GB, heap pinned at 768 MB |
| PostgreSQL | 54 MB idle; limit 768 MB |
| Caddy | 15 MB; limit 256 MB |

- **4 GB holds the stack's limits** (about 3.1 GB) with the system and 2 GB of swap. That's sufficient for **staging** (synthetic, a few testers).
- **8 GB for production** removes the margin question: real users' meal photos and exports at the same time, with the database's cache growing. It's €3 a month more.

### 11.5 The authorization package

#### A. Staging (synthetic data only), the next step

| # | Who | Action | Cost |
|---|---|---|---|
| A1 | **Owner** | Buy a domain, for example `fitworkoutfoodtracker.com`, at an at-cost registrar (Porkbun: $11.81/yr, checked 2026-11-08). Staging needs it: a free temporary address can't reliably get a certificate | ~$12/yr |
| A2 | **Owner** | Create a Hetzner Cloud account and project, with a spending alert at €25/month | — |
| A3 | **Owner** | Create the **staging** server: **CX23** (2 vCPU, 4 GB, 40 GB NVMe), **Nuremberg (nbg1) or Falkenstein (fsn1)**, Ubuntu 24.04, with `deploy/provision/cloud-init.yml` (your SSH public key put in), and a Cloud Firewall: 22 from your IP, 80 and 443 from anywhere | €5.99 + €0.50 IPv4 a month |
| A4 | **Owner** | DNS: an A record for `staging` pointing at its IP, and a CAA record for Let's Encrypt (runbook) | — |
| A5 | **Owner** | Approve the migrations for the cloud databases. Say "MIG-FB and MIG-GYM approved for the cloud databases". **Disclosure:** `prisma/approved-migrations.json` is shared, so recording them also lets the local tooling apply them to `fitdb_review` if someone runs it. That still needs its own explicit run, which stays your decision | — |
| A6 | **Owner** | Create a backup key pair on your own computer (`age-keygen -o fit-backup.key`), keep the private key in your password manager, and give me the **public** key (`age1…`) | — |
| A7 | **Claude** | After A5: record the approval in `approved-migrations.json` in a commit that names it, re-run the rehearsal on that commit, and trigger **Release image**, publishing two images to GHCR. Then the server must be able to pull them: either set the two packages to public in GitHub (the code is already public, and G1 found no secret in any layer), or `docker login ghcr.io` on the server with a read-only token | — |
| A8 | **Owner**, with Claude's exact commands | On the server: put `deploy/` in place, fill `production.env` and `single-server.env` (`POSTGRES_DB=fitworkoutfoodtracker_staging`, generated passwords, your public key), then run `./deploy.sh <tag>`. Create the tester accounts with `create-staging-account.cjs`. The smoke test and the journey then run against `https://staging.<domain>` | — |
| A9 | **Owner** | Phones: iPhone and Android against `https://staging.<domain>` (checklist 7.6), then MG.1–MG.15 and UX-01 there | — |

- **Staging total:** **€6.49/month excl. VAT**, plus the domain.
- **Optional:** Hetzner Object Storage (€6.49/month, 1 TB) for offsite backups; staging's synthetic data doesn't need it.

#### B. Production launch (invited beta), later, separately

| # | Who | Action | Cost |
|---|---|---|---|
| B1 | **Owner** | The **production** server: **CX33** (4 vCPU, **8 GB**, 80 GB NVMe), the same region as staging, the same provisioning and firewall; DNS `app.<domain>` | €8.99 + €0.50 IPv4 a month |
| B2 | **Owner** | Hetzner **Object Storage** bucket for encrypted backups: a lifecycle rule to expire after 14 days, object lock if offered, and an access key on the server for upload | €6.49/month |
| B3 | **Owner** | **Resend** (free tier: 3,000 emails/month, 100/day): verify the domain (MX and SPF on `send`, DKIM at `resend._domainkey`, DMARC optional); create a sending-only key and put it in `production.env` yourself | €0 |
| B4 | **Owner** | **NOTICE-B** final, after legal review; until then registration stays closed on production by design | lawyer |
| B5 | **Owner** | Acceptance: UX-01, GYM-ACCEPT, E1 on both phones (on staging), and the security sign-off (Part 1's limitations plus 11.2's lows) | — |
| B6 | **Owner** | Approve the merge, and the production deploy | — |
| B7 | **Claude**, after B6 | Release image for the merged commit, the deploy commands, the production smoke test, the first backup and a restore drill | — |

- **Production total:** **€15.98/month excl. VAT** (server €8.99, IPv4 €0.50, Object Storage €6.49).
- **With staging kept running:** about **€22.47/month**, plus ~$12/yr for the domain. VAT is added by country.
- **Data residency:** Hetzner's CX plans are EU-only, so the data is held in Germany. A US region would need Hetzner's CPX/AMD plans at a higher price, and only if the owner requires it.

**Not done, and not to be done without the approvals above:** no purchase, server, domain, DNS, email, image publication, merge or deployment.
