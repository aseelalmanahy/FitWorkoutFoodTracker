# Phase 4.0.3: Backup and Recovery Design

**Status: a design only. Nothing here is operational.** No production database or backup exists, no backup has ever been restored (T-10), and the deletion ledger isn't built. **Don't describe deletion reconciliation as working until its persistence, its independence from backups, and a recovery with it have all been verified.**

Periods marked *proposed* are engineering suggestions for the owner to decide. **No retention period here is legally approved** (Decision 12 and R-01).

## Objectives

| Objective | Proposed | Basis |
|---|---|---|
| Recovery point: data that could be lost | *24 hours,* or less if the provider offers point-in-time recovery | A small invited beta, on judgement. **Owner decides** |
| Recovery time: how long a restore can take | *4 hours,* in waking hours | One person on call, on judgement. **Owner decides** |
| Measured | **Nothing yet** | The first timed restore replaces these guesses |

## Backups

| Requirement | Design |
|---|---|
| Automated | The managed provider's daily backups, if chosen, **plus** an independent logical dump, as a provider's snapshots usually live in the same account and can vanish with it |
| Off-site | `pg_dump --format=custom` to object storage with another provider, or at least another account |
| Encrypted | Encrypted before leaving the server, with a key that isn't stored beside the backups, for example `age` with an offline private key |
| Restricted | A read-only database role for dumping, and a write-only storage credential on the server, so a compromised server can't read or delete old backups. Restores use a separate credential, held by the owner |
| Retention | **Pending Decision 12.** The design suggested about 14 days, for legal confirmation. Storage lifecycle rules enforce whichever period is chosen |
| Before migrations | Always, as a step of the release. The migration waits until the backup reads back |
| Monitoring | A check-in monitor alerts if no backup succeeds in the expected period |
| Logs | **Pending.** Logs are also a copy of what happened, and need their own period (S-14) |

**Backups hold health-related data.** A backup that still exists after a person leaves still holds their data until it expires. The privacy notice has to say so.

## Verifying a restore

**A backup that has never been restored is a hope, not a backup.** These apply each time, and the first passing run is the acceptance test for going live.

1. **Authorization names the exact target database.** Never restore over a database in use.
2. Create a new, empty, separate database, with no application connected.
3. Restore, and record the start and end times. That's the measured recovery time.
4. Compare row counts per table with the count recorded when the backup was taken, and read `_prisma_migrations`.
5. Run the deletion reconciliation below, and check its result, before anything connects.
6. Start the app against it on a disposable server. It must pass the preflight and `/api/health`, and a test login must work.
7. Delete the restored copy, and write down the date, duration and outcome.

**Frequency:** once before the first invite, then *quarterly,* and after any change to how backups are made.

## S-14: a restore must not bring deleted people back

**The problem.** Deleting an account removes it from the live database, but backups still hold it. Restoring one silently brings the person back: their email, password hash, food log and session rows. Their old password would work again. Nothing in the app could tell.

**What can't solve it.** Any list kept in the database. A restore rolls the list back too, which is exactly when it's needed.

### Proposed design: a deletion ledger outside the database

An append-only record of deleted accounts, stored apart from the database and its backups, and consulted by every restore before anything connects.

**Each record holds only:** `HMAC-SHA-256(ledger key, userId)`, the time, and a state. **No email, name or plain id.** `userId` is an opaque, never-reused value, so someone who registers again with the same address has a new id, and isn't affected.

| Property | How |
|---|---|
| Survives a restore | Different storage and provider account from the database and its backups, with object lock or versioning |
| Reveals little | The HMAC can't be reversed. Even with the key, it can only confirm an id you already have, which is what a restore needs |
| Works without trusting the server later | The running app can only append. It can't read or remove records |
| Key is separate | The ledger key lives in the app's secrets and with the owner offline. **If it's lost, old records can no longer be matched** |

### The write has to happen in two steps

The database and the ledger can't share a transaction, so one can fail after the other:

| Order | If it fails between | Result |
|---|---|---|
| Delete first, then write the ledger | After the commit | **The person could come back after a restore, silently.** The failure this exists to stop |
| Write the ledger only, first | Before the commit | A live account is recorded as deleted, and a later restore would **wrongly delete it** |

**So, an intent and then a confirmation:**

1. Append `intent` to the ledger. **If that fails, refuse the deletion** and say to try again.
2. Run the existing deletion transaction.
3. Append `confirmed`. If this fails, the deletion stands, and the intent stays unconfirmed.

### What a restore does

Before the restored database accepts any connection, a script computes the HMAC of every `User.id` in it and looks each one up:

| Ledger says | Action |
|---|---|
| `confirmed` | Delete through the same ordered, owner-scoped deletion the app uses, and record the count. **No names or emails in the output** |
| `intent` only | **Stop, for a person to decide.** The deletion either committed with the confirmation lost, or failed. Check whether that id exists in the most recent backup taken after the intent. If it's unclear, treat it as deleted, as the person asked for that |
| Nothing | Keep |

The restored database then gets only what's newer, and the ledger reaches beyond it, so any deletion after the backup is covered.

**Restoring a person's account on request.** Not offered. A deletion is final by design, and the app says so. If an accidental deletion ever needs reversing, that's a separate owner decision, for a specific account, restoring into a scratch database and copying only that person's data, after legal advice. It would also need an explicit ledger entry, or the next restore would delete it again.

### Tradeoffs

| Tradeoff | Effect | Position |
|---|---|---|
| Deletion depends on another service | If the ledger is down, nobody can delete their account | Accepted in this design: a brief refusal is better than a silent return. **It conflicts with the right to leave if an outage is long, so needs an owner decision.** The alternative is a queue on disk, which can be lost |
| It keeps something about people who left | One HMAC and a time, per person | Small, and not reversible, but it's still a record. **Legal should confirm it's acceptable and for how long.** It must outlast the longest backup retention, and can then be purged |
| New infrastructure, and a new secret | Storage account, and a key to protect and not lose | **Needs owner approval, under decision 5** |
| It covers only the database | Logs aren't reconciled. They expire by their own period | Pending S-14's log period |
| A restore takes longer and has a new step | The script has to work when things are already going badly | Rehearsed as part of every restore test |
| Provider snapshot restores | A restore through the provider's console bypasses the script unless the runbook is followed | **A process control, not a technical one.** The app could refuse to start until a marker says reconciliation ran, as later hardening |

**Rejected alternatives.** Keeping deleted ids in the same database, as a restore rolls them back. A file on the app server, as it's lost with the server. Storing emails or plain ids, as that keeps what the person asked to remove. Encrypting each person's data with a key that's destroyed on deletion, as it's a major change to every table, and out of proportion for this beta, though it's the strongest answer if the service ever grows.

### What building it would need

| Item | State |
|---|---|
| A storage provider and account for the ledger | **Owner decision, new infrastructure** |
| The ledger key, and where it's kept | Not created |
| Two-step writes around `deleteAccount` | **Not built.** No schema change. Not done in 4.0.3, as there's nowhere for the ledger to write |
| The reconciliation script | Not built |
| A test with a real restore | **Blocked:** needs authorization for an exact target database |
| Legal view on the record and its retention | R-01 |

**Until this exists: S-14 stays open, and a restore can bring deleted accounts back.** As a stopgap for the first restore, the owner could keep a manual list, as the design first proposed, but that list would itself hold identifiers, so it needs the same care.

## Failure scenarios

| Scenario | First steps |
|---|---|
| Bad release, no schema change | Previous image |
| Failed migration | Stop. Read the error. Restore if the schema is left inconsistent |
| Accidental data damage | Stop the app, to keep the damage from growing. Restore to a new database. Run reconciliation. Decide what to do about changes made since the backup |
| Database or provider lost | Restore the off-site dump to a new database, with new credentials |
| Server compromised | Treat every credential as stolen: rotate the database passwords, replace the server, and revoke all sessions by deleting `Session` rows. Follow the incident process, once one exists (legal review) |
| Backup key lost | Backups can't be read. Take a new backup at once, under a new key |

**Restoring also brings old sessions back.** After any restore, delete all `Session` rows, so old cookies stop working.
