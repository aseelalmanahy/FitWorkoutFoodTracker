# Phase 4.0.4: email-proven access

**Architecture and security plan, written before the code,** as `DEVELOPMENT_WORKFLOW.md` requires. It follows `PHASE_4_0_DESIGN.md` sections 7 and 8, and says where it had to choose. Status is in the tracker.

## Product review

**Covered.** `FEATURE_DECISIONS.md` records account recovery and verified email as BUILD, P0, and the design's section 4 merges verification, recovery and closed sign-up into this milestone. Change-password is in the design's scope. **The owner approved Decisions 8, 10 and 11 on 2026-11-06,** recorded in the design's decision register. Decision 11 follows the agent's recommendation over the design's earlier proposal. No new product review was run, as nothing here goes beyond that scope.

**Not approved here:** applying any migration, an email provider or SDK, a Prisma major upgrade, deployment, merging. Decision 5 stays open.

## Flows

```
Sign-up
  POST /api/auth/register { email }           always the same 200. Everything else happens after the response
    job: on the allowlist, no account yet, cooldown and caps pass -> token row, email
  /register/complete#token=...                GET renders a form, and the server never sees the token
  POST /api/auth/register/complete { token, password }
    read the token, re-check the allowlist, hash the password in an Argon2 slot, then in one transaction:
      delete the token where id, purpose and expiry match, and require count = 1
      create the User
    after it commits, delete other sign-up tokens for this address
    no sign-in. The person logs in, and onboarding follows as it does today

Recovery
  POST /api/auth/password/forgot { email }    always the same 200
    job: an account exists, cooldown and caps pass -> token row, email
  /reset-password#token=...
  POST /api/auth/password/reset { token, password }
    read the token, hash in a slot, then in one transaction:
      lock the user row
      delete the token where id, purpose and expiry match, and require count = 1
      update passwordHash, delete every Session, delete every token for this user and address
    clear this browser's cookies, no sign-in, notify by email

Change password (signed in, reachable with no profile or restricted)
  POST /api/account/password { currentPassword, newPassword }
    current password through the shared re-authentication limit, hash in a slot, then in one transaction:
      update passwordHash where it's still the hash just verified, and require count = 1
      delete every Session, delete this user's tokens, create one new Session
    set the new session and device cookies, notify by email
```

## Schema: MIG-03, additive

```prisma
enum AccountTokenPurpose { SIGNUP  PASSWORD_RESET }

model AccountToken {
  id        String              @id           // SHA-256 of the emailed token
  purpose   AccountTokenPurpose
  email     String                            // normalized
  userId    String?                           // null for SIGNUP, as no account exists yet
  expiresAt DateTime
  createdAt DateTime            @default(now())
  user      User?               @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([email, purpose])
  @@index([userId])
  @@index([expiresAt])
  @@index([createdAt])
}

model User { termsVersion String?  termsAcceptedAt DateTime?  accountTokens AccountToken[] }
```

**The design's `@@unique([email, purpose])` is dropped,** by its own final-round finding: several live tokens can exist, so a slow first email doesn't die when someone asks again. One redemption removes the rest. Acceptance fields stay null until 4.0.5.

**Every query on `User` selects these columns, so this code needs MIG-03 on any database it runs against.** The same applies to `fitdb` (B-07, C-08), so nothing here can run on a database until that migration is separately approved.

## Decisions the design left open

| Point | Choice | Why |
|---|---|---|
| Token in the link | **URL fragment,** read by the page, then cleared from the address bar | A browser doesn't send it to a server, proxy log or `Referer`, and a mail scanner fetching it gets a form and no token. **Provider click tracking or a gateway rewriting links could still record the whole URL,** so tracking off is a selection criterion for Decision 5. Device test T-15 must confirm mail apps keep it |
| Link check on GET | None | The server can't see the token. A bad link is reported on submit |
| Expiry | Reset 60 minutes, the top of the design's suggested range. Sign-up 24 hours, a judgement, as the design gives none | Named constants, for the owner to confirm. **These are token lifetimes, not legal retention periods** |
| Cooldown | 60 seconds per address and purpose, from the token row | Durable, as the design asks |
| Per-recipient cap | At most 5 live tokens per address and purpose | Durable, and with the expiry above bounds email to one address to 5 an hour for reset, and 5 a day for sign-up. A judgement |
| Global cap | 200 tokens created in the last hour, counted from the table | Durable. A judgement, for a small invited beta |
| Serial job queue | One job at a time, at most 500 waiting, then dropped with a coded log | One at a time means cooldown checks can't race without any extra locking. **Assumes one instance, as the throttles do.** A second instance could only send extra email, and couldn't weaken a token |
| An address that already has an account | Sign-up sends nothing | Identical response. Copy points to login and reset, so nobody is stranded |
| Failed send | Only a definite rejection (`MailRejected`) deletes the token row. Anything else keeps it, and a coded failure is logged | After a timeout the email may have arrived, so cooldown and caps must keep counting it |
| Job deadline | The queue gives every job 30 seconds, and then moves on | One hung provider call can't stop all later sign-up, recovery and notices, while responses stay 200 |
| Token pages and sessions | `/register/complete` and `/reset-password` never redirect on a session | A redirect would carry the fragment to another page, and stop a signed-in owner finishing recovery |
| Provider | `MailTransport` interface with one method. A file stub for development and designated test databases. **Nothing else exists, so production sends nothing and warns once at startup** | No SDK. Sign-up and recovery fail closed. Startup isn't refused, as that would stop any rehearsal before Decision 5, so it's recorded as a blocker |
| Stub | One JSON file per message in `MAIL_STUB_DIR`, which startup refuses in production | Tokens would otherwise reach logs. Development defaults to `.mail-outbox/`, ignored by Git |
| Links | Only from `APP_ORIGIN`, or a fixed localhost value on development and designated test servers. **Never from a request header** | Closes S-01 for reset links |
| Auth deadline | Server: 10 s to read an auth body. Client: 15 s on auth forms | The design names a client deadline, and the server part shares `readLimitedBytes` |
| `FIT_TEST_OPEN_REGISTRATION` | Stays. It only opens the allowlist, on a designated test database on this machine, and startup refuses it anywhere else. **The email proof still runs** | Suites use many random addresses, and `production-security` runs closed. The stated rule is against bypassing the flow |

## Security review

| Threat | Treatment | Test |
|---|---|---|
| Stolen database | Only SHA-256 of 256-bit tokens is stored | Unit, and DB suite |
| Replay, parallel use | `deleteMany` with id, purpose and expiry must count 1, inside the transaction | Unit on a fake, **DB suite for the real race** |
| Wrong purpose, expiry | Both are in the `where`, and expiry is `gt now` | T-1 ms and T+1 ms, unit and by backdating in the DB suite |
| Enumeration | The response comes before any lookup, for both request routes. Validation and limits depend only on the body and client | Unit: same status and body, and no lookup before the response |
| Mail bombing | Allowlist, client limit, durable cooldown and caps | Unit, DB suite for restart |
| Mail scanners, CSRF | GET does nothing, POST carries the token, and the Origin check applies | Unit |
| Host-header poisoning | No request header reaches a link | Unit, with a forged Host |
| Allowlist bypass | Checked when the link is issued and again when it's used, before the password is hashed. The old password field on register is ignored | Unit |
| Pre-registration hijack | No account until the link is used, and the first password is set by whoever holds the mailbox | Closes S-16 in code |
| A session surviving reset, **through a login already past its password check** | `createSession` for login and change-password runs in a transaction that holds the user row `FOR SHARE` and compares `passwordHash` with what was verified. Reset and change update that row first, so one always sees the other | Unit for the comparison, **DB suite for the real race** |
| A second account by parallel redemption of two tokens | The unique email refuses it, and the transaction undoes the token's deletion. Other tokens go after commit, as deleting them inside would deadlock two redemptions | Unit, DB suite |
| Deletion during reset, two reset tokens at once | **Lock order is always the user row, then tokens,** in reset, change-password and `deleteAccount`. A later one finds its token or row gone, and rolls back | DB suite |
| Change-password racing a reset | The update requires the hash that was verified, so a stale request can't overwrite the owner's new password | Unit, DB suite |
| Secrets in logs | Mail and token failures log a fixed code and never the error's text. Throttle keys hold no address | Unit, with a provider error containing both |
| Deletion and export | `deleteAccount` removes tokens by user and by address, as cascades miss sign-up tokens. Tokens are never exported. Password routes use `accountRoute` | Data-map tests, DB suite |
| Adults-only | No change. Age stays at onboarding, under `accessStateFor`. A profile-less account can log in, reset, change password, export and delete, and reach nothing gated | Unit, DB suite |

An independent read-only review of this plan, before any code, found the change-password race (high), the lock order, the ambiguous send, the job deadline and the redirect (medium). All are in the tables above.

**Accepted limits, not closed here:**

- **A loopback database named `fitdb_test` skips preflight's identity check,** including with open registration, so a tunnel with that name could mislead it. It needs a deliberate misconfiguration, and is from 4.0.3. Low, recorded in the tracker.
- **Deleting an account while its address stays on the allowlist lets it sign up again.** Removing the address is a deletion runbook step, as nothing in the app can tell that apart from an invitation.
- **Manual email change must delete tokens for both addresses.** A runbook step, while it stays manual.
- **Abandoned sign-up tokens hold an address until they expire and the next token is issued,** as no background job exists. Retention stays with R-06, and no period is invented.
- **A refused or abandoned account keeps its email and password hash until R-06,** as Decision 11 keeps sign-up and profile separate.
- Throttles remain in memory and per process, so the client limit resets on restart. Cooldown and caps don't.
- **Notices sent after a reset can tell a mailbox holder only what they could already see.** They hold no token.
- Email change stays manual for the beta, by the design.

## Tests

**Runnable now:** Vitest with in-memory fakes, which can't prove a database race, and negative controls.

**Run on `fitdb_test`, after MIG-03:** `scripts/account-tokens.test.cjs` for the real races and backdated expiry, and every suite that registers, through `scripts/lib/signup.cjs` and the mail stub. Results are in tracker section 2d. Over HTTP, expiry is checked just past and safely ahead of it, as an exact moment can't be hit. The 1 ms boundary is unit-tested.

**Also run:** a production build, and the pages in Chromium against a server with an unreachable database address. That covered the fragment being read and cleared, fixed notices, and no CSP violation. Queued jobs failed there with fixed codes, and no address reached the log.

## Review of the code

The read-only security agent found no high or medium defect. **It reasoned from the code, and ran nothing.** Fixed: deletion now refuses if a reset committed after its password check, a job past its deadline stops at its next check, the form separates an uncertain outcome and a short password from a dead link, an unreachable test branch now has a test, and development email stays out of Docker builds. **Left, in the tracker:** S-19, S-20, S-21. It didn't review `scripts/`.

**A later review of the final code, with `scripts/`,** found no critical or high defect. Its medium findings on reset links and lock waits are fixed, S-22 is left, and the rest are fixed or in the tracker.

**Measured since:** a lock limit of 4 seconds applies per lock, so a queued request can wait about 8. Sign-in transactions allow 10 seconds, so that always ends in 503. **Not verified:** whether route bundles share one queue under `next start`. If they don't, each route still has its own serial queue, and only one route issues each purpose, so the cooldown still holds.

## F-11: the Prisma findings, and the recommended order

**The findings.** `npm audit` reports 3 high findings, one chain: `deepmerge-ts` 7.1.5, stack exhaustion when merging recursive object graphs, through `@prisma/config` 6.19.3, through the `prisma` CLI. Audit's only offered fix is `prisma@7.10.1`, marked as breaking.

**Exposure, as read from the code and packages.** `@prisma/config` loads Prisma's own CLI configuration, and `@prisma/client`'s runtime holds no reference to `deepmerge-ts`. Nothing here passes request data to it. **So reaching it would take control of developer configuration, not a web request.** `npm` still lists the chain with `--omit=dev`, because `prisma` is an optional peer of the client, so this doesn't show that it's absent from a production image. F-07's image build should check that.

| | Stay on Prisma 6 for now | Upgrade to 7 before applying MIG-03 |
|---|---|---|
| **MIG-03** | Applies as written | Plain SQL, so it's unlikely to differ. **The upgrade guide says nothing about migration history,** so this would have to be shown |
| **New dependencies** | None | `@prisma/adapter-pg` is required, and the guide also says to add `dotenv` |
| **Code touched** | None | `db.ts`, `prisma.config.ts`, the generator with a required output path, and every import from `@prisma/client`, including `Prisma` in routes and `dmmf` in the coverage test |
| **Test safety** | Unchanged | Every script using `new PrismaClient({ datasources })`, including the **test-target guard,** moves to the adapter form. The guide says Prisma ships as ESM and to set `"type": "module"`, and the scripts are CommonJS |
| **Behaviour** | Unchanged | `pg` rejects invalid certificates, and has no default connection timeout, against 5 seconds before. Env files stop loading by themselves. **The guide doesn't address raw queries or interactive transactions,** which reset, login and deletion now depend on |
| **Risk** | The findings stay open, with the exposure above | Two large changes at once: a failure couldn't be pinned on either |
| **Evidence needed** | The 4.0.4 suites | All guarded suites and browsers, needing `fitdb_test` either way |

**Resolved at `55a686a` (2026-11-08), without Prisma 7:** an npm override pins `deepmerge-ts` 8.0.2 under `@prisma/config`, the Prisma CLI's config loader and the advisory's only path; `npm audit` reports 0 vulnerabilities (tracker 2j). The original recommendation follows, kept for the record.

**Recommendation: stay on Prisma 6 for now, accept F-11 in writing for development only, and upgrade as its own reviewed change, after MIG-03 and the 4.0.4 suites pass and before F-07's image build and any real user.** The exposure is low and doesn't grow with this work, while the upgrade's risk falls on the code this milestone just made lock-sensitive. With 4.0.4's races proved on Prisma 6, they become the upgrade's regression test.

**Check at that time:** npm's `latest` tag currently points to a release candidate of Prisma 8, so the target should be chosen deliberately, and 7.10.1 is the version audit names. **Nothing was upgraded, and no dependency changed.**
