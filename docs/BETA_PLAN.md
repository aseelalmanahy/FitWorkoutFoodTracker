# Beta plan

Branch `feature/beta-critical-capabilities`, from `feature/release-completion` at `ca015e5`. The owner approved the scope of phases 1 to 5 on 2026-11-08; operational gates keep their own approvals (tracker section 2j). Nothing here is merged or deployed. Status is kept in `PROJECT_COMPLETION_TRACKER.md` section 2k, with evidence; this page is the plan.

| Phase | What | Depends on | Accepted when |
|---|---|---|---|
| 0 | Release foundation gates A1 to A4, B1b, B2, C1/C2, E1, G1 to G7, UX-01 acceptance | Each its own approval | As in the tracker's approval package |
| 1 | Installable PWA: manifest, temporary icons, standalone, service worker caching static assets and an offline page only, install help | None | Automated: manifest, icons, worker scope and cache contents. **Real iPhone and Android: install, launch, sign in and out, log food and a workout, session kept (E1)** |
| 2 | Camera barcode scanner: on-device decoding (BarcodeDetector, else a wasm fallback served by this site), manual entry, the existing lookup and cache | None | Real UPC and EAN fixtures decode; unknown, duplicate, denied camera and unsupported browser handled; lookup, cache, provenance and logging tested. Real phones: E1 |
| 3 | Workout-plan import: PDF, images and screenshots (local OCR), CSV, TXT, DOCX, XLSX; a validated draft; exercise matching where uncertain ones need a choice; saved atomically after confirmation; uploads not stored | None (no migration needed) | The fixture set in the directive, invalid and malicious files refused, ownership, atomic save, nothing invented. A hosted model only after D2-style approval |
| 4 | Packaged-food photo identification: barcode from the photo on the device, product text by local OCR, provider search, confirmation; else label scan or a private custom food | Phases 2 and the existing label OCR | Known, unknown, conflicting and failed-provider cases; no image kept; nothing unverified shown as verified |
| 5 | In-app feedback and an admin dashboard (server-side admin allowlist), rate limits, a redacted export | One migration (`Feedback`), applied only to disposable test databases until approved | Submission, isolation, admin authorization, abuse limits, duplicates, redaction, failures |
| 6 | Feedback analysis workflow: redacted report, ChatGPT and Claude assessments, owner decision | Phase 5 | A documented, repeatable procedure |
| 7 | Full security and regression testing | 1 to 5 | Every suite, unit tests, type check, build, audit; real-device and production results recorded separately |
| 8 | Cloud and beta preparation: a single-server versus managed-database comparison and a cost-controlled recommendation | G2 decisions | The owner chooses; nothing provisioned or bought without approval |

**Launch gates before an invited beta:** the Linux image (G1), an approved host (G2, G3), HTTPS (G4), a verified restore (B2, G5), monitoring (G6), real email (C1, C2), real iPhone and Android (E1), a security sign-off, the final regression, UX-01 acceptance, and the owner's approval to merge and deploy (G7).

**Domain:** not bought now. It becomes necessary at C1 (a verified sending domain for real email) and G4 (HTTPS on a public name); the request will say what depends on it and the expected cost then.
