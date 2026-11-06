# Phase 4.0.5: privacy, consent and data retention

**A proposed plan, for independent review. It approves nothing, and nothing here has been started.** Written 2026-11-06, from `main` at `5434f90`. Requirements stay in `PHASE_4_0_DESIGN.md`, section 10 and the 4.0.5 milestone, and in Annex H of `PHASE_4_0_1_IMPLEMENTATION_PLAN.md`. Status stays in the tracker.

## 1. The main constraint

**The final text can't be written here, and the mechanisms can.** The notice has to name an operator, country, host, database, email provider, retention periods and backup window. None of those is decided. It also has to reflect legal advice that doesn't exist yet. So this plan builds everything that doesn't depend on those facts, makes it impossible to mistake a draft for the final text, and leaves the rest visibly blocked.

**A conflict the owner needs to settle.** Annex H2 says Decision 6's advice comes "before 4.0.5 merges", and the design lists legal review as an approval for the milestone. Read strictly, none of the local work below can merge until a reviewer exists. Section 5 proposes a way through, as O1.

## 2. What exists today

Read from the code and documents at `5434f90`.

| Requirement | State |
|---|---|
| `User.termsVersion`, `termsAcceptedAt` | **In the schema and in MIG-03, on `fitdb_test` only.** Nullable, always null today. Already in the export, by `account-data-map.json`. **No new migration is needed** |
| Acceptance at sign-up | None. `completeSignup` doesn't set these fields |
| Privacy or terms pages | None. No route, and no link |
| Data-flow inventory | **Doesn't exist.** The design scoped it to 4.0.0, and R-11's acceptance depends on it. `account-data-map.json` covers database fields only, not processors or periods |
| Retention rule for refused and abandoned accounts | None (R-06). A refused person's date isn't saved, so that account looks the same as an abandoned one: no profile |
| Expired rows | **Expired sessions stay until their owner returns or deletes the account,** as only a read removes one. Expired tokens are purged only when someone asks for a new link (S-22) |
| "Backups may keep a copy" | On `account-deleted`, as interim wording (E-06). A restore can bring deleted accounts back (S-14), and the ledger is a design only |
| "Not medical advice" and who it isn't for | Interim copy only. Final wording is clinical (Decision 7, R-02) |
| Open Food Facts | Labelled ODbL in the search UI. Whether more is owed is a legal question |

## 3. What can be built locally

| Can be built with no legal or infrastructure approval | Needs the owner, a reviewer or infrastructure |
|---|---|
| The inventory, from what the code does, with unknowns marked | Operator, country, host, provider, periods (Decisions 2, 3, 4, 5, 12, 14, 16) |
| A versioned notice module, and public pages showing a **marked draft** | The final notice and terms (R-11, R-01) |
| Recording acceptance at sign-up, with the server setting version and time | Whether a checkbox is sufficient, and whether explicit consent is needed (H7 item 6) |
| A check that a draft can't reach a real sign-up | The retention period, and whether people are told first (R-06, H7 items 4 and 5) |
| Selecting retention candidates, as a read-only report | **Actually deleting anything by that rule** |
| Purging rows that have already expired, if O4 is approved | Backup, log and restore behaviour on real infrastructure (S-14, F-05, F-06, R-07) |

**Nothing in this plan writes a legal conclusion, or invents a period.** Draft text states what the software does, and carries an unmistakable marker where a fact or a reviewer's answer is missing.

## 4. Proposed milestones

On a new branch from `main`. Each is one reviewable commit group, with its own review before the next starts. **No migration, dependency or external service.**

### L1. Data-flow inventory (documents and one test)

- `docs/PHASE_4_0_5_DATA_INVENTORY.md`, plus `src/lib/data-inventory.json` holding what can be checked: each data category, where it's stored, each external destination and what it receives, and each period, marked `decided`, `built` or `unknown`.
- Destinations come from the code: USDA and Open Food Facts (search text and barcodes), the email provider (addresses and links, not yet chosen), the host and database (not yet chosen), Anthropic (off, and listed only as Track A's condition).
- **Test:** every model in the schema has a category, and every external host the server code can call is listed. A new table or provider then fails until it's classified, as the data map does today.
- **Accept:** reviewed by reading, with every unknown named.

### L2. Notice module and public pages

- `src/lib/legal/notice.ts`: one source of `version`, `status: "draft" | "final"`, and sections. `/privacy` and `/terms` render from it (see O5).
- Public, no session needed, keyboard accessible, and linked from sign-up, the link-completion page, login, profile and `/account`. A page shown while `draft` carries a fixed banner saying it isn't final and isn't for real users.
- **Accept:** a test that a `final` notice holds no draft marker and names a dated review, so it can't be flipped by changing one word.

### L3. Acceptance at sign-up

- `POST /api/auth/register/complete` gains `acceptedVersion`. The page shows an **unticked** checkbox, with links, and the request can't complete without it.
- The server compares against the current version, **before spending the token or a password hash.** A mismatch answers 409, with the link still usable. Version and time come from the server, and are written in the same transaction as the account.
- **Before the address is typed:** `/register` links the notice and says what the address is used for, as the design wants people told before entering data. Whether that's enough is a legal question.
- Test helpers: `scripts/lib/signup.cjs` and the `complete` helper accept for real. **No test-only bypass.**

### L4. Retention mechanics, with nothing deleted

- A pure policy module: `selectRetentionCandidates(now, policy)`. Abandoned or refused means no profile, older than the period, with no live session. Restricted means a stored date under the minimum, older than the period. Both use existing columns.
- **`policy` has no default.** With no decided period, it returns nothing and reports that. An operator report lists counts only, with no address or id, and **no code path deletes.**
- **Applying the rule is a separate, later approval,** once R-06 has an answer. It would use the existing `deleteAccount`.
- If O4 is approved: an hourly purge of rows that have already expired, sessions and tokens. It invents no period, and closes part of S-22.
- **Return to product review first:** a recurring job is new, and CLAUDE.md asks for `product-strategy-agent` on a scope change like this.

### L5. Gate, and tracker

- A real deployment can't complete sign-up while the notice is a draft (O2). Designated test databases are exempt through the existing check, which startup refuses anywhere else.
- A consistency test: every period and processor named in the notice is in the inventory.
- Tracker and documents updated, with `M-13` still open.

### Blocked, not part of this work

- **B1. Final text:** needs R-01, and Decisions 2 to 6, 12, 14 and 16. Then a new version, flipped to `final`, with the reviewer's date recorded, and checked against the deployment.
- **B2. Applying retention:** needs R-06's period and rule, then its own approval and a tested run on `fitdb_test`.

## 5. Decisions needed

**Plan decisions, needed before starting:**

| ID | Question | Recommendation |
|---|---|---|
| **O1** | May L1 to L5 merge, as "complete for development", before legal advice? | **Yes, and read H2 as "before the final text merges".** The draft gate stops it reaching anyone, and the reviewer gets working pages to read. It changes an earlier gate, so it should be recorded |
| **O2** | While the notice is a draft, what does a real deployment do? | **Refuse sign-up completion, and warn at startup.** A rehearsal server can still start for T-16 and T-17. Refusing startup would block those, and doing nothing risks a draft reaching a person |
| **O3** | If the version changes, must existing accounts accept again? | **Don't build it now, and ask legal.** Production starts empty (R-08), so nobody is affected until the first change. The two fields hold only the latest acceptance, so **keeping a history would need a migration,** which isn't proposed |
| **O4** | Add an hourly purge of already-expired sessions and tokens? | **Yes, after product review.** The last security review rated S-22 medium before the beta. If no, tokens stay as they are, and the notice has to say so |
| **O5** | One combined page, or two? | **Two URLs, one source.** The design prefers one plain combined notice if the reviewer accepts it, and this allows either with no rework |
| **O6** | Tick box, or "by continuing you accept"? | **An unticked box,** as the more cautious. Legal confirms |

**Existing decisions that block the final text:** 2 (country and participants), 3 (operator), 4 (name and domain), 5 (host, database, email provider), 6 (legal reviewer and budget), 12 (backup retention), 14 (production data access), 16 (end of beta and support contact). Also 7, for "not medical advice" and who it isn't for, and G-04's token lifetimes, as the notice will state them.

## 6. Security and legal dependencies

**Security risks, and how the plan treats each:**

| Risk | Treatment | Test |
|---|---|---|
| Draft text reaching a real person | O2's gate, plus the banner, and `final` needing a recorded review | Unit, on a production-mode environment |
| A forged or stale acceptance | The client sends only which version it saw. The server sets the stored version and time | Unit, DB suite |
| Sign-up completing without acceptance | Checked on the server, before the token or hash. Atomic with the account | Unit, DB suite, browser |
| A token spent by a version mismatch | The check comes first, so the link survives | DB suite |
| Notice not matching behaviour | The inventory test, and the consistency test. **Text is written last** | Unit |
| A retention rule deleting the wrong account | No deleting code in this phase, no default period, counts only, and a pure, tested selector | Unit, DB suite on selection only |
| Personal data in a report or log | Counts only | Unit |
| A purge touching live rows | Strictly `expiresAt` in the past, and a test beside live rows | Unit, DB suite |
| Weakening what's there | Allowlist, generic responses, single use, and the adults-only gate are unchanged, and their suites rerun | Full regression |

**Questions for the legal reviewer. Not concluded here.** All of Annex H7's, including: minimum age and the 29 February rule. Any duty on refusal, or on learning someone is a minor. Whether a correction path is acceptable (D-04). The retention period for refused and abandoned accounts, including in backups (R-06). Whether birth date, weight and food are health data, and what consent follows. Wording on declared age (S-04). From the design: breach duties, a possible medical-device question, timing and format of access and deletion rights (E-06), processor agreements and transfers, and whether an invite-only beta by an individual changes anything. Added here: whether a deletion must leave a record (S-15), the "Stored with your profile" wording (C-09), ODbL's attribution, whether telling people on `/register` is sufficient, whether a tick box suffices, and whether acceptance history must be kept.

**Clinical, Decision 7 and R-02:** "not medical advice", who the app isn't for, and the help resource (R-12).

## 7. Test strategy

**No database is touched while writing this plan.** L1 and L2 need none. **Database and browser suites for L3 to L5 need the owner's authorization for `fitdb_test`,** like earlier phases, and no migration.

| Layer | Covers |
|---|---|
| Vitest, on fakes | Acceptance required, version mismatch, server-set values, no token spent. `final` with a marker refused. Draft gate by environment. Selector boundaries, with no policy returning nothing. Inventory coverage |
| New guarded suite, `privacy-consent` | A real sign-up stores version and time, and they're exported. Missing or wrong acceptance creates nothing, and leaves the link usable. Parallel redemption still gives one account. Selector on real rows, read only. Purge removes only expired rows, if O4 |
| Regression | All 32 suites, as sign-up changes, through the real flow, one at a time |
| Browsers | Chromium, Firefox and WebKit: pages public, signed in and out, keyboard only through the checkbox and links, no CSP violation, draft banner visible |
| Negative controls | Remove each protection and see a named test fail: acceptance not required, client-supplied time trusted, version unchecked, check moved after the token, draft gate off, `final` allowed with a marker, inventory check off, selector ignoring the period |
| Security review | `security-review-agent` on the plan's mechanisms at L3 and L4, on the final code, and again for the fixes after that review |

**Can't be shown locally:** that the notice matches a deployment, real mail, real devices (T-15), and backups or restore.

## 8. Completion

- **L1 to L5 merged:** M-13 could be "COMPLETE for development", if O1 is approved, with R-11 and R-06 still BLOCKED.
- **M-13 complete:** only after B1 and B2.
- **Not begun by this plan:** Phase 4.1 and 4.0.6.

## 9. Blockers this plan doesn't remove

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
| Dependency | F-11, not accepted for production |
