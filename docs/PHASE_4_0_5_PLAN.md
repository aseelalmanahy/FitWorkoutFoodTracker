# Phase 4.0.5: privacy, consent and data retention

**The owner authorized local development of L1 to L5 on 2026-11-06, and they're built on `feature/phase-4.0.5-privacy`, unmerged. Status is in the tracker, section 2e. Final text and any deletion stay blocked.** Based on `main` at `5434f90`. Requirements stay in `PHASE_4_0_DESIGN.md`, section 10 and the 4.0.5 milestone, and in Annex H of `PHASE_4_0_1_IMPLEMENTATION_PLAN.md`. Status stays in the tracker.

This version corrects `5d83560`, after an independent review and three read-only reviews of it: architecture, security and QA. They read code and ran nothing, and no database was touched.

## 1. The main constraint

**The final text can't be written here, and the mechanisms can.** The notice has to name an operator, country, host, database, email provider, retention periods and backup window. None of those is decided, and it has to reflect legal advice that doesn't exist yet. So this plan builds what doesn't depend on those facts, and makes it impossible for a draft to open registration.

## 2. Decisions recorded

| ID | Decision, as the owner approved it |
|---|---|
| **O1** | Local development may proceed before final legal review. **This doesn't waive the legal review required before any real-user release** |
| **O2** | Real production registration fails closed while the legal documents are drafts. **Both invitation requests and account creation are protected** |
| **O3** | The reacceptance policy is deferred, pending legal review |
| **O4** | Hourly background cleanup is deferred to a separate reviewed milestone |
| **O5** | Two public URLs, `/privacy` and `/terms`, from one versioned notice source |
| **O6** | An unticked acceptance checkbox is approved for development. **Final wording and enforceability remain subject to legal review** |

**Still open: whether L1 to L5 may merge before legal advice.** O1 covers development, and doesn't mention merging. Annex H2 says Decision 6's advice comes "before 4.0.5 merges", and the design lists legal review as an approval. Each merge needs its own approval in any case, so this plan assumes nothing, and the owner decides when the first one is ready.

## 3. What exists today

Read from the code at `5434f90`.

| Requirement | State |
|---|---|
| `User.termsVersion`, `termsAcceptedAt` | In the schema and MIG-03, on `fitdb_test` only. Always null today, and already in the export. **No new migration is needed** |
| Acceptance at sign-up | None |
| Privacy or terms pages | None |
| Data-flow inventory | **Doesn't exist.** R-11's acceptance depends on it. `account-data-map.json` covers database fields only |
| Retention rule | None (R-06) |
| Telling accounts apart | **Not possible, section 6** |
| Expired rows | Sessions stay until their owner returns, logs out or deletes the account. Tokens are purged only when someone asks for a new link (S-22). **Both stay as they are, under O4, and the notice has to say so** |
| "Backups may keep a copy" | Interim wording on `account-deleted` (E-06). A restore can bring deleted accounts back (S-14) |
| "Not medical advice" | Interim copy only (Decision 7, R-02) |

## 4. What can be built locally

| Can be built with no legal or infrastructure approval | Needs the owner, a reviewer or infrastructure |
|---|---|
| The inventory and its verification | Operator, country, host, provider, periods (Decisions 2, 3, 4, 5, 12, 14, 16) |
| A versioned notice source, and pages showing a **marked draft** | The final notice and terms (R-11, R-01) |
| Recording acceptance, with the server setting version and time | Whether that's valid consent, and whether explicit consent is needed (H7 item 6) |
| The gate keeping a draft from opening registration | Flipping to final (R-01) |
| A read-only report of facts about accounts | **Any classification, period or deletion** (R-06) |

**Nothing here writes a legal conclusion, or invents a period.**

## 5. Milestones

On a new branch from `main`, when authorized. One reviewable commit group each, with its own review. **No migration, dependency or external service. No deletion or recurring job.**

### L1. Data-flow inventory, verified against the code

`docs/PHASE_4_0_5_DATA_INVENTORY.md`, and `src/lib/data-inventory.json` holding what can be checked.

**Authoritative sources, compared by a test:**

| What | Source | Rule |
|---|---|---|
| Database models | `Prisma.dmmf.datamodel.models`, as `data-map.test.ts` uses. **No database connection** | The inventory's models must equal the schema's, and the data map's |
| Stored personal-data categories | The same fields, through `account-data-map.json` | A `category` per model, referring to the map by name and repeating no field list. Overrides must name real fields, so a typo fails |
| Outbound call sites | A scan of every non-test file under `src/`, for `fetch(`, `http(s).request`, `net` or `tls.connect`, `new WebSocket`, `XMLHttpRequest`, `sendBeacon`, `EventSource`, `new Anthropic(`, and imports of `node:http`, `node:https`, `node:net`, `node:tls`, `node:dns`, `node:child_process`, the SDK, or a package from `package.json` that can reach a network | **The files found must equal the inventory's list, split into server and browser.** A new file fails, and so does a stale entry |
| Outbound hosts | `http(s)://` literals in the files that build provider URLs, compared with the inventory's hosts | A new host fails |
| Mail transports | Implementations of `MailTransport`, and `mailTransport()` as the only factory | A new transport or provider import fails |
| External processing services | Derived from the above: each destination says what it receives. Environment settings are compared with `AI_SETTINGS` | Undecided ones (host, database, provider) are listed by hand as `unknown` |

**The list today, checked by search.** Server: `foods/http.ts:101`, the one server `fetch`, sending search text and barcodes, and `labels/anthropic.ts:87`, the one Anthropic client, sending a label or meal **photo**. Hosts: `api.nal.usda.gov`, `world.openfoodfacts.org`, `search.openfoodfacts.org`. Browser, same-origin by CSP: `lib/client/api.ts`, `lib/client/pdf-browser.ts`, `components/account/data-controls.tsx`, `components/nutrition/label-scanner.tsx`, `components/nutrition/meal-photo.tsx`. Mail: a file stub holding addresses and live tokens, with no network code.

**Anthropic is listed as a conditional destination, not as "off".** The code sends photos when its settings are present, and "off" is a state of the environment. Startup refuses those settings on a real deployment today.

**Detection limits, stated in the inventory.** This is a tripwire, not proof. It can't see: a host known only at run time, base URLs from the environment (`FDC_BASE_URL`, `OFF_BASE_URL`, and `ANTHROPIC_BASE_URL`, which the SDK reads with no mention in `src`), SDK defaults, calls made inside dependencies (Next.js, Prisma, the SDK), build-time fetches, what a listed call actually sends, the host's own processing, access logs, backups and DNS, or anything under `scripts/`. **Logs need reading by hand:** `foods/http.ts:92` writes provider details. It also matches some harmless text, such as a method named `fetch` at `pdf-browser.ts:13`, so the matching rule for those is decided and tested, not ignored.

**Accept:** every unknown named, and the controls in section 8.

### L2. Notice source and public pages

- `src/lib/legal/notice.ts`: one source of `version`, `status` and sections. `/privacy` and `/terms` render from it.
- Public, keyboard accessible, and linked from sign-up, the link-completion page, login, profile and `/account`. A draft carries a fixed banner saying it isn't final and isn't for real users.
- **`noticeIsFinal()` is the only test of status,** and it reads committed source only, with no environment input. It requires exactly `final`, a version not starting `draft-`, a recorded review (date and reviewer), no draft marker, and a SHA-256 of the text matching the review record. **So a typed date or word can't flip it, and a later text edit reverts it to not final.**
- Anything else counts as a draft. A malformed `final` refuses startup. **A test pins `draft` for this phase.**

### L3. Acceptance recording

**Three separate things, which this plan keeps apart:**

| | What it is | What it can do |
|---|---|---|
| **Draft-document testing** | A `draft-` version, on development and designated test databases only | Exercises the flow. **Authorizes no real registration** |
| **Versioned acceptance recording** | Which version was shown and ticked, and when, stored with the account | **Records that the token holder posted it. A script can post the public version with no box. It isn't a claim of valid consent** |
| **Legally approved final documents** | B1, after legal advice | **The only thing that can open real registration,** and even then legal decides what a tick means |

**`POST /api/auth/register/complete`, with a new schema,** as `redeemTokenSchema` is shared with reset. The order, in which each step is a real choice:

1. Rate limit.
2. Schema, including `acceptedVersion`. Missing: 400.
3. Version compared with the server's constant, **with no database read, so it says nothing about any token.** Wrong: 409, returning no version, with no automatic retry. **Nothing is spent.** The page has already cleared the link from the address bar, so the message says to reopen the email.
4. Token lookup.
5. `registrationAllowed`, which now holds the gate and the allowlist.
6. Argon2.
7. Transaction: spend the token, and create the account. **Version and time are the server's, in the same transaction,** so an account can't exist without them.

Other tests: `scripts/lib/signup.cjs` and the suite's `complete` helper accept for real, with no bypass. `scripts/lib/test-users.cjs` writes test users directly, as it does today, behind the target guard. **That's the named exception,** and those users have null fields.

**Before the address is typed:** `/register` links the notice and says what the address is used for. Whether that's enough is a legal question.

### L4. A read-only report of account facts

**The earlier `selectRetentionCandidates` is withdrawn.** A list of candidates is a deletion list, and today's columns can't classify anyone. **A missing profile doesn't prove an account is abandoned or refused.**

| Visible with existing columns | Not visible |
|---|---|
| Profile present or absent, a stored date under the minimum today | Refused, abandoned or simply new, as a refused date isn't stored (`profile/route.ts`) |
| Session row with `expiresAt` in the future, terms fields, `createdAt` | Never signed in or signed out, as logout deletes sessions. Last activity |
| Owned rows, live tokens | Why any of these is so |

- `reportAccountFacts`: aggregate counts of those facts only, by age band. **No id, address, period or category name. No caller-chosen period.**
- A script, not a route, through a read-only transaction and a reader exposing only `count`. Small counts are suppressed, as one restricted account can identify someone. **Test databases only** until Decision 14 says otherwise.
- **A test forbids any write or delete call, or any import of deletion code, in that module.** No path from it leads to deletion.

**Not built in this phase:** deletion of any kind, recurring cleanup (O4), or any purge. S-22 stays open, and is disclosed in the draft.

### L5. Gate, consistency and tracker

**The gate goes inside `registrationAllowed`,** the one check that issuing a link and creating an account already share, in the only place either happens (`access.ts`). So:

- **Invitation requests:** the job's first check. It stops silently. **`/register` answers the same 200, with nothing looked up first,** so enumeration is unchanged.
- **Account creation:** step 5 above. It answers the same generic 400 as a bad link, so a token issued before the gate can't get through either, and nothing depends on the address.
- A real deployment warns at startup. It still starts, as T-16 and T-17 appear not to need sign-up.

**Exemptions, none of them an environment switch for real deployments:**

- `FIT_TEST_OPEN_REGISTRATION` **never** opens this gate.
- **Designated test databases:** `isLocalTestServer`, **and** `APP_ORIGIN` empty or loopback, **and** preflight confirming the database's own test marker, so a real host or a tunnel named `fitdb_test` isn't exempt. This narrows S-20. `production-https` sets a non-loopback `APP_ORIGIN`, so that suite's use is checked when this is built.
- **Development:** `NODE_ENV === "development"` exactly, and a loopback database. Never `!== "production"`, as an unset value must not open it. `next dev` skips preflight, so this check stands alone.

Also: a consistency test that every period and processor named in the notice is in the inventory. Tracker and documents updated, with `M-13` still open.

### Blocked, not part of this work

- **B1. Final text:** R-01, and Decisions 2 to 6, 12, 14 and 16. Then a new version with its review record, checked against the deployment.
- **B2. Retention deletion:** section 6.

## 6. Future retention deletion, design requirements only

**Nothing here is built or authorized.** It returns to product review first, and needs its own approval.

**It must not use `deleteAccount(userId, verifiedHash)`.** That function's safety comes from a password just checked by the person. A job would have to read that hash from the row it's guarding, which proves nothing. A separate path would share only the row-removal core.

| Requirement | What it has to state |
|---|---|
| **Authorized administrative execution** | Who may run it, on what approval, never from a request. A run cap, and an owner-approved manifest of what it will act on |
| **Explicit account classification** | A recorded state, not an inference. **Past refusals can't be recovered by a migration,** as nothing recorded them, and what happens to those accounts is a legal question |
| **Auditability** | A record of each run, kept **outside the database,** naming no one beyond what's approved. Whether a deletion must leave a record is S-15 |
| **Transactional consistency** | One transaction per account, re-checking its state under `FOR UPDATE`, so nothing is deleted on stale facts |
| **Restrictions** | `TemplateExercise` and `SessionExercise` restrict deleting an `Exercise`. A blocked account rolls back, is retained and reported as `blocked`, for human review. **Never cascaded** |
| **Backup reconciliation** | S-14's ledger assumes the person asked for deletion, which isn't true here, and a rollback leaves intent only. **The ledger needs an origin and an `aborted` state,** in `PHASE_4_0_3_BACKUP_RECOVERY.md`, before this |
| **Defined, approved periods** | From R-06. None invented. Whether people are told first is legal's question |
| **Independent security review** | Before any run, including on `fitdb_test` |

## 7. Decisions, and security and legal dependencies

**Blocking the final text:** Decisions 2 (country and participants), 3 (operator), 4 (name and domain), 5 (host, database, email provider), 6 (legal reviewer and budget), 12 (backup retention), 14 (production data access), 16 (end of beta and support contact). Also 7, for "not medical advice" and who the app isn't for, and G-04's token lifetimes, as the notice will state them.

**Security risks:**

| Risk | Treatment | Test |
|---|---|---|
| A draft opening real registration | The gate in `registrationAllowed`, covering both paths and older tokens | Unit in production mode, both paths |
| A mistaken flip to final | `noticeIsFinal()`, with a review record and a text hash. No environment input | Unit, pinned test |
| An exemption reaching a real deployment | The narrowed predicates above | Unit, each condition alone |
| Revealing who has an account or holds a token | The gate is silent or generic, and the version check precedes any database read | Unit, DB suite |
| A token spent on a version problem | The check comes before the lookup | DB suite |
| An account without acceptance | Written in the same transaction, from the server | Unit, DB suite, browser |
| Overclaiming consent | Nothing in code, text or the tracker calls a tick consent | By review |
| The report becoming a deletion path, or identifying someone | Counts only, read-only, no ids, small counts suppressed, a test forbidding writes | Unit |
| Notice not matching behaviour | The inventory checks. **Text is written last** | Unit |
| Weakening what's there | Allowlist, single use and the adults-only gate are unchanged | Full regression |

**Questions for the legal reviewer. Not concluded here.** All of Annex H7's: minimum age and the 29 February rule, any duty on refusal or on learning someone is a minor, a correction path (D-04), retention for refused and abandoned accounts including backups (R-06), whether birth date, weight and food are health data and what consent follows, and wording on declared age (S-04). From the design: breach duties, a possible medical-device question, timing and format of access and deletion rights (E-06), processor agreements and transfers, and whether an invite-only beta by an individual changes anything. **Added here:** reacceptance and whether a history must be kept (O3, which would need a migration), what a tick establishes (O6), whether telling people on `/register` is sufficient, whether a deletion must leave a record (S-15), what happens to accounts already unclassifiable, the "Stored with your profile" wording (C-09), and ODbL's attribution.

**Clinical, Decision 7 and R-02:** "not medical advice", who the app isn't for, and the help resource (R-12).

## 8. Test strategy

**This plan touched no database.** L1 and L2 need none, as `Prisma.dmmf` connects to nothing. **Database and browser suites for L3 to L5 need the owner's authorization for `fitdb_test`,** and no migration.

| Layer | Covers |
|---|---|
| Vitest, on fakes | L3's order, one case per step. Server-set values. `noticeIsFinal()` on each failing condition. The gate on both paths, by environment. Report output holding only counts |
| New guarded suite, `privacy-consent` | A real sign-up stores version and time, and they're exported. Missing or wrong acceptance creates nothing, and leaves the link usable. Parallel redemption still gives one account. Report on real rows, read only, and row counts unchanged around it |
| Regression | All 32 suites, one at a time, as sign-up changes |
| Browsers | Chromium, Firefox, WebKit: pages public, signed in and out, keyboard only through the checkbox and links, no CSP violation, draft banner visible |
| Security review | `security-review-agent` at L3 and L5, on the final code, and again for fixes after that |

**Inventory checks can pass by finding nothing, so they carry minimum counts,** at least 15 models and the server and browser call sites listed above, and fail if a glob or extractor comes back empty.

**Negative controls, each with a named test. A switch turning a check off proves nothing.**

| Run against a fixture, not the real tree | Must fail |
|---|---|
| A fake model, or a model with its category removed | Inventory |
| An unlisted file with `fetch(` or `new Anthropic(` | Call-site list |
| A stale entry in the call-site list | Call-site list |
| A host literal not in the inventory | Hosts |
| A category naming a field that doesn't exist | Categories |
| An unlisted mail transport or provider import | Transports |
| A `final` notice missing a review, holding a marker, or with changed text | `noticeIsFinal()` |

| Deliberate defect in the code | Must fail |
|---|---|
| Acceptance not required, or the client's time or version stored | Acceptance tests |
| The version check moved after the token lookup, or after spending it | Order tests |
| The gate off for invitation requests, or for account creation | Gate tests, separately |
| `FIT_TEST_OPEN_REGISTRATION` opening the gate, or a real `APP_ORIGIN` exempted | Exemption tests |
| A write added to the report, or ids in its output | Report tests |

**Can't be shown locally:** that the notice matches a deployment, real mail, real devices (T-15), backups or restore.

## 9. Completion

- **L1 to L5:** M-13 stays open, whatever is merged, with R-11 and R-06 BLOCKED.
- **M-13 complete:** only after B1, and whatever R-06 requires.
- **Not begun by this plan:** Phase 4.1 and 4.0.6.

## 10. Blockers this plan doesn't remove

Every one stays in the tracker, and the tracker wins if this list differs.

| Area | IDs |
|---|---|
| Legal and clinical | R-01, R-02, R-03, R-06, R-11, R-12, C-09, E-06, S-04, S-15, D-04 |
| Decisions | D-01 to D-05 |
| Email | G-03, G-04, G-05, G-06 |
| Backups, restore and deletion | S-14, F-05, F-06, T-10 |
| Infrastructure and production | M-11, R-07, R-08, R-15, T-16, T-17, F-04, F-07, F-09, F-10 |
| Databases | B-07, C-08, and MIG-03 beyond `fitdb_test` |
| Tests | T-14, T-15, T-18, T-21, R-13 |
| Risks | S-19 to S-25 |
| Dependency | F-11, not accepted for production. **Resolved at `55a686a`: `deepmerge-ts` overridden, `npm audit` 0** |
