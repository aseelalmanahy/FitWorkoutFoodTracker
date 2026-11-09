# Roadmap

**Canonical: what comes next, in dependency order.**
- **No future phase here is approved** unless its row says "Approved" with a source in [DECISION_REGISTER.md](DECISION_REGISTER.md).
- There are **no dates**, because none have been set.
- Complexity is a rough engineering estimate: **S**, days; **M**, one or two weeks; **L**, more.

The original ordering is [PRODUCT_STRATEGY.md](PRODUCT_STRATEGY.md) (PS:218–329), whose rationale stays there. This file shows where the project actually is against it.

## Where the plan and reality diverged

PS put the installable app, camera barcode, exercise swaps and package scanning in Phase 4.3, *after* the 4.2 real-user beta. The owner approved and had them built **before** it:
- the beta capabilities, 2026-11-08 (OD-10);
- multi-gym and alternatives, 2026-11-08 (OD-11).

So:
- Phase 4.2 hasn't started.
- Much of 4.3 is already implemented.

The list below reflects that. Delivered items are in [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md).

## A. Essential before an invited beta (in order)

| Step | Objective | Contents | Depends on | Priority | Complexity | Database or infrastructure | Security and privacy | Acceptance / definition of done |
|---|---|---|---|---|---|---|---|---|
| **A1. Staging** (G3) | A real server, independent of the owner's PC, with synthetic data | Hetzner CX23, the domain, DNS, `deploy.sh`, synthetic accounts | the owner's purchases and approvals (BL-STG) | P0 | S (rehearsed 108/108) | new cloud PostgreSQL (`*_staging`); MIG-FB and MIG-GYM approved for the cloud | TLS only; least-privilege roles; nothing exposed but 80 and 443 | `smoke.sh` and `staging-journey.cjs` pass at `https://staging.<domain>`; the backup timer runs; a restore drill passes |
| **A2. Real phones** (E1) | Prove the PWA, camera and layouts on hardware | the RA 7.6 checklist on iPhone (Safari) and Android (Chrome), against staging | A1 | P0 | S | none | camera frames stay on the device; the service worker caches no personal data | every checklist step passes on both phones, recorded by the owner |
| **A3. Owner acceptance** | Confirm the delivered work | UX-01U, GYM-ACCEPT (MG.1–MG.15), U-04 | A1 or the local demo | P0 | S (owner time) | none | — | the owner's explicit "accepted" for each, recorded |
| **A4. Legal and clinical** | Lawful, safe registration | NOTICE-B (final notice, review recorded); R-01 legal; R-02 clinical; R-03 low-target threshold; R-06 retention; R-12 help resource; PS-Q1, PS-Q2, PD-D12, PD-D14, PD-D16 | the owner and outside reviewers | P0 | M (mostly external) | retention may need a purge job (S-22) | no unsupported claims; deletion versus backups (S-14) | `noticeIsFinal()` passes; each R item has its recorded evidence |
| **A5. Real email** (C1/C2) | Sign-up and password reset in real inboxes | Resend, domain verification (SPF, DKIM, DMARC), a sending-only key | A1 (the domain); A4 opens registration | P0 | S | none | the key only on the server; no enumeration (already built) | G.1–G.6 pass in a real inbox |
| **A6. Production** (G4–G6) | The invited-beta service | Hetzner CX33, Object Storage (lifecycle 14 days), monitoring of `/api/health` with alerts (G6) | A1–A5, the security sign-off, the merge approval | P0 | S–M | a fresh production database, clean (no local data copied) | backups encrypted to the owner's key; deletion and backups (S-14) | production smoke passes; a backup and a restore drill pass; alerts reach the owner |
| **A7. Invited rollout** (G7) | 5 to 10 invited adults | the allowlist, invitations, the feedback review loop | A6 | P0 | S | none | invitation-only registration | invitations sent; feedback reviewed per FEEDBACK_REVIEW_WORKFLOW.md |

**Recommended alongside A, not a blocker:** TD-CI. Run the unit tests and the type check in CI (S). Today they run only on the owner's PC.

## B. Phase 4.2: the real-user beta (Proposed in PS; not started)

| | |
|---|---|
| **Objective** | Learn from 5 to 10 adults over a few weeks, with a conversation each (PS:250–260) |
| **Features** | None new: the delivered product plus the feedback system |
| **Depends on** | all of section A |
| **Priority** | P0 (PS) |
| **Database** | none |
| **Security** | real personal and health-related data for the first time: every A4 item applies |
| **Acceptance** | findings written up, and the roadmap re-ranked from them (PS). EP:125: "a 'go' still wouldn't begin 4.2 without its own authorization" |

## C. Post-beta improvements (Proposed; re-rank after 4.2)

| Item | Objective | Status | Depends on | Priority (PS/FD) | Complexity | Database or infrastructure | Security and privacy |
|---|---|---|---|---|---|---|---|
| Copy a meal or a day | Faster logging | Proposed (FD:486–496) | 4.2 findings | P2 | S | none | none new |
| Saved meals | Faster logging | Proposed, "only if asked" (FD:496) | copy first | P3 | M | a new table | per-user isolation |
| Custom reporting periods | Choose the range on charts and history | Proposed, presets first (FD:55–66) | — | P2 | S–M | none | none |
| Weekly summary | Facts only; days logged | Proposed (FD:716–730); a dashboard count exists | — | P2 | S | none | no advice wording |
| Factual progress observations | Plain facts from the user's own data | Proposed BUILD (FD:122–126) | — | P2 | M | none | no health claims |
| Workout effort rating | One rating per session | Owner backlog, not approved (TR:301–303); `SetEntry.rpe` exists unused | after UX-01 acceptance | P2 | S–M | maybe a session field (migration) | none |
| Body measurements | Waist and similar | Proposed post-MVP (FD:618–631) | — | P2 | M | a new `BodyMetric` kind (migration) | health-related data: notice and retention |
| Sleep and recovery check-in | Optional daily check-in, no score | Owner backlog, not approved (TR:301) | — | P2 | M | a new kind or table (migration) | health-related data |
| Activity log (walk, run, cycle, sports) | Manual entries in their own table; no GPS, no calories | Proposed MODIFY P2 (FD:96–116); owner backlog | — | P2 | M | a new table (migration) | none new |
| Reminders (calendar file first, then opt-in) | Consistency (4.4) | Proposed (FD:318–346) | — | P2 | M–L | settings; push subscriptions | off by default; no weights or calories in the text |
| Offline logging | Log without a connection | Deferred (DF-04) | idempotent sets (done) | P2 | L | a client store and sync | no personal data in caches (current rule) |
| Streamed export (EXP-02) | Lift the 50,000-row limit | Follow-up (DF-15) | — | P2 | M | none | as for export |
| Adaptive targets (a suggestion the person accepts) | Targets that follow the weight trend | Deferred (DF-08) | weight-log data; the clinical review | P2 | M | none | must not over-claim precision |
| Final name and branding | One name, logo, icons | Open (PS-Q4, BRAND) | the owner | P2 | S–M | the domain | trademark check (pre-launch) |

## D. Public-launch validation gate (Proposed; required before anyone not invited)

PS:288–301 lists:
- a legal review per market;
- the CSP;
- backups and monitoring in operation;
- an accessibility review;
- a trademark check;
- dependency and Prisma decisions.

**Depends on:** 4.2 findings. **Priority:** P0 for a public launch. **Done when:** each item has its recorded evidence.

## E. Optional long-term expansion (not approved)

| Item | Status | Gate | Source |
|---|---|---|---|
| **Track A: paid AI activation** for label and meal reading | Deferred (DF-05). The code exists and is refused in production | PS-Q9, PS-Q10, a spending limit, the notice, explicit approval of paid requests | PS:303–313 |
| **Initiative T: personal-trainer platform** | Deferred (DF-01), "not to be implemented yet" | the stages below, each with its own gate | PS:331–382 |
| Exercise demonstrations (outbound links) | Deferred (DF-10) | a qualified reviewer (PS-Q11) | FD:750–767 |
| Native or store apps | Deferred (DF-11) | after real-phone testing | FD:259–276 |
| AI fitness assistant | Deferred (DF-06) | — | FD:557–566 |
| Progress photos | Deferred (DF-07) | storage, encryption, deletion including backups | FD:568–576 |
| GPS routes; followers and sharing | **Open owner decision** (recommended reject; the owner kept them open, OD-09) | an owner decision | TR:305–306 |
| Business and monetization | **Open** (PS-Q5). No plan is documented. Marketplace and payments rejected for now (RJ-02) | an owner decision | PS:504 |

### Initiative T stages (none approved)

| Stage | Contents | Gate to start the next |
|---|---|---|
| T0 | Demand test: an export shared with a trainer; trainer conversations | evidence of real demand |
| T1 | Permission model, threat model, legal review (no code) | reviewed and approved |
| T2 | One central access check, with no visible change | route-by-permission tests pass |
| T3 | Read-only sharing: invitation, consent, revocation, access log | a pilot with real trainers and clients |
| T4 | Trainer plans (as copies) and notes | the pilot shows use |
| T5 | A private trainer profile, text first | none stated |

**Constraints for every stage:**
- Access is client-initiated, by category, read-only, and revocable immediately.
- The marketplace and payments are rejected (RJ-02).
- Public discovery and photos are deferred (DF-02).

**Database:** relationships, permissions and an access log. All need migrations from T2 on.
