# Privacy wording drafts

**DRAFT, for owner and legal review. Not legal advice and not an approved notice.**

The live privacy notice is in `src/lib/legal/notice.ts`, version `draft-2026-11-06b`. Nothing in this document changes it. Putting any of this wording into the notice is gate **NOTICE-B**. That needs the owner's decision and a legal review, and the notice gets a new version and hash when it changes.

Each section below has three parts:

- **What the software does.** These facts are checked against the code on `feature/multi-gym-exercise-alternatives`.
- **Proposed wording,** to add to the named section of the notice.
- **To confirm.** The questions only the owner or a lawyer can answer. `[TO CONFIRM: …]` marks gaps in the same way the notice does.

## 1. In-app feedback

**What the software does**

A report stores:

- its category;
- the person's description;
- the page it was sent from (the route only, with no query string);
- its status.

An administrator can add a severity, a priority, a duplicate link, a working note and a task link. These triage fields don't go out in the person's export. Deleting the account deletes the person's reports. If another report was marked as a duplicate of one of them, that report keeps its own text and the link is cleared. No screenshot, device fingerprint or contact detail is attached automatically.

**Proposed wording (What is stored; Why)**

> If you send feedback, we keep what you wrote, the type of feedback you chose, the page you sent it from, and whether we've dealt with it. We use it only to find and fix problems and decide what to improve. It's included when you download your data, and deleted when you delete your account. Please don't include health details or anything about other people in feedback.

**To confirm**

- How long feedback is kept after it's resolved. `[TO CONFIRM: feedback retention]`
- Who can read it, by role. Today that's the administrator IDs set at start-up.
- Whether administrators' triage notes count as personal data that the person can request.

## 2. Product-photo processing (a package with no readable barcode)

**What the software does**

The barcode is first looked for on the device. Camera frames never leave the device: only a barcode's digits are sent, to look up the product.

If a photo has no readable barcode, the photo is sent to this app's own server. There, text recognition runs locally, with no paid service and no network request. Only lines of words come back, and anything that looks like a nutrient, a number or a marketing claim is dropped. The photo is validated, held in memory and released. It isn't stored or logged.

Those words, usually the brand and product name, are then searched once with the app's food search. So the search text, but not the photo, goes to USDA FoodData Central and Open Food Facts. Candidate products are shown with their source. Nothing is logged until the person confirms a product and chooses an amount. Every nutrition value comes from the chosen record, never from the photo.

**Proposed wording (Who else receives data; How long)**

> If you take a photo of a package and no barcode can be read, the photo is sent to our server so the words on it can be read there. The photo isn't kept: it's deleted from memory as soon as the words are read, and it isn't sent to anyone else. We then search USDA FoodData Central and Open Food Facts for those words, the same way as if you'd typed them, and show you the products they return. Nothing is added to your log until you choose a product and an amount. Nutrition values always come from the product record you choose, never from the photo.

**To confirm**

- Whether a photo held only in memory for seconds needs its own mention under "How long". `[TO CONFIRM: transient processing wording]`
- Whether the server's location matters for this processing (Decision 5).

## 3. Workout-plan image processing

**What the software does**

A plan in a document (PDF with text, DOCX, XLSX, CSV or TXT) is read in the browser and never uploaded.

An image of a plan (a photo, a screenshot or a scanned PDF page) is sent once to this app's server. Text recognition runs there locally, with no network request, and only the text comes back. The image isn't stored or logged.

The person reviews every row. Only the confirmed plan is saved, as ordinary workout plans.

**Proposed wording (What is stored; Who else receives data)**

> When you import a workout plan from a document, it's read on your device and isn't uploaded. If you import a photo or screenshot of a plan, the image is sent to our server so its text can be read there; it isn't kept or sent to anyone else. Only the plan you confirm is saved, as workout plans in your account.

## 4. Browser-side parsing versus server text recognition

**What the software does**

| Input | Where it's read | What leaves the device |
|---|---|---|
| Camera barcode scan | On the device | The barcode's digits, to look up the product |
| Photo with a barcode | On the device | The barcode's digits |
| Package photo with no barcode | Text recognition on this app's server | The photo, to this server only; then the words, as a food search |
| Plan document (PDF text, DOCX, XLSX, CSV, TXT) | On the device | Nothing until the confirmed plan is saved |
| Plan image or scanned page | Text recognition on this app's server | The image, to this server only |
| Nutrition label or meal photo | Read on this server when local reading is configured. Otherwise, by Anthropic only when that's configured (see 6) | The photo, to this server; to Anthropic only in the configured case |

**Proposed wording (a short paragraph under "What is stored")**

> Some things are read on your device and never leave it, such as barcodes from your camera and documents you import. Some photos need our server to read the words on them: a package with no barcode, an image of a workout plan, and nutrition labels. Those photos go only to our server, are read, and are deleted from memory. We don't keep them.

**To confirm**

- Whether "deleted from memory" is accurate enough wording, or whether it should say "not stored". The process memory is released, but not guaranteed overwritten.

## 5. Gym names and equipment

**What the software does**

People can add gyms, up to 20 per person. Each gym has a name the person chooses, the kinds of equipment it has, and optionally named machines, up to 100 per gym, each optionally for one exercise.

A workout can be linked to a gym, and an exercise in a workout to a machine. Swaps are recorded as a link between the planned exercise and the one actually done.

- **No location is used.** There's no GPS, no address and no map.
- **Gyms are private.** They're never shared with other people or offered to them.
- **The gym for the next workout** is remembered in that browser's local storage, as an internal ID only. It's cleared when the person signs out, and ignored if it isn't theirs.
- **Export and deletion.** All of this is in the data export, and deleted with the account.

Workouts from before gyms existed keep no gym. None is added for them.

**Proposed wording (What is stored)**

> If you add your gyms, we store the names you give them, the kinds of equipment and any machines you list, and which gym and machine you used in a workout. We don't use your location, and gym names you choose may say where you train, so you can use any name you like. Your gyms are only visible to you. To save you choosing it each time, your browser remembers which gym you picked for your next workout until you sign out.

**To confirm**

- Whether a gym name the person writes (it could be a home address) needs extra wording. `[TO CONFIRM: free-text location wording]`
- Whether the browser storage of a gym's ID needs mention in a cookie or storage notice (Decision on ePrivacy/consent).

## 6. Third-party image processing

**What the software does**

Label and meal photos can be read by Anthropic, but only when the settings for that feature are present. A production deployment refuses to start with those settings today, which is the existing C1 gate.

With local reading (`LABEL_OCR=local`, `MEAL_RECOGNITION=local`), no image goes to a third party. Package photos and plan images are never sent to a third party.

**Proposed wording (Who else receives data; replaces the current Anthropic paragraph only if the owner enables it)**

> [If enabled] Nutrition label and meal photos are sent to Anthropic, which reads them and returns the text or a description. [TO CONFIRM: Anthropic's role, location, retention and agreement, Decision 5.] No other photo is sent to a third party.
>
> [If not enabled] No photo is sent to any third party. Photos are read on our server and not kept.

**To confirm**

- Whether third-party image reading is enabled for the beta at all (C1, and the paid-request approval).

## 7. Export and deletion

**What the software does**

The export contains the following:

- the profile;
- custom exercises;
- plans and schedules;
- every workout with its sets, gym, machines and swaps;
- gyms with their equipment and machines;
- custom foods;
- food log entries with their source;
- nutrition targets;
- body metrics;
- the person's feedback.

Deletion removes all of this immediately, in one transaction, in the order the database requires. Shared exercise and food records stay, because they aren't the person's.

**Proposed wording (Your choices; adds to the current paragraph)**

> Your download includes everything you've logged or set up, including your gyms, the equipment and machines you listed, and which exercises you swapped in a workout. Deleting your account removes all of it straight away.

## 8. Backup retention

**What the software does**

The backup design is nightly encrypted `pg_dump` copies sent offsite, or the managed provider's backups.

- **Retention isn't decided yet.** That's Decision 12. About 14 days was proposed, for legal confirmation.
- **A deleted account stays in older backups** until they expire.
- **Restoring an older backup could bring a deleted account back.** Handling that is S-14.

**Proposed wording (How long; replaces the gap only once Decision 12 and S-14 are decided)**

> We keep encrypted backups for [TO CONFIRM: period, Decision 12] so we can recover from a failure. If you delete your account, it may remain in backups until they expire after that period. If we ever restore a backup, we [TO CONFIRM: S-14, e.g. re-delete accounts that were deleted after the backup was made].

## Review checklist for the owner

| Item | Decision needed | Gate |
|---|---|---|
| 1 | Feedback retention and access | NOTICE-B, Decision 16 |
| 2–4 | Wording for transient processing on this server | NOTICE-B |
| 5 | Free-text gym names; browser storage mention | NOTICE-B |
| 6 | Whether third-party image reading is enabled at all | C1, paid requests |
| 7 | None beyond NOTICE-B | NOTICE-B |
| 8 | Backup period and restore handling | Decision 12, S-14 |
