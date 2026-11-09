# Phase 3: Accuracy-First Nutrition

> **Synchronization note (2026-11-09):** Status update: Phase 3 (3.1–3.6) is complete for development and on `main`; the on-server readers were added later. Current state: [FEATURE_INVENTORY.md](FEATURE_INVENTORY.md).

**Principle:** accuracy matters more than automation. AI may read printed values and suggest what a food might be. It must never invent calories, macros, weights, ingredients or missing facts. Only confirmed source data and user-provided quantities enter nutrition calculations.

This replaces the earlier plan in `ARCHITECTURE.md` for AI-estimated calories and portions.

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| 3.1 | Secure image input and validation | Done |
| 3.2 | Nutrition-label scanning and structured extraction | Done |
| 3.3 | User review, correction and confirmation | Done |
| 3.4 | PDF nutrition extraction | Done |
| 3.5 | Meal photo identification, with no AI-generated calories | Done |
| 3.6 | Food matching, provenance indicators, security and full regression testing | Implemented, awaiting review |

Each milestone needs review before the next one starts.

## 3.1: Secure image input

`POST /api/images/validate` takes one image as the raw request body, decodes every pixel, and produces a clean copy.

| Rule | Value |
|---|---|
| Formats | JPEG, PNG, WebP, with animation rejected |
| Size | 7 MiB in and out, which still fits a 10 MB base64 limit |
| Dimensions | 200 to 8,000 px per side, 16 megapixels at most |
| Rate limit | 20 uploads per user per 10 minutes. Rejected uploads count |
| Uploads in memory | 4 at once, and 1 per user |
| Decoding | 1 image at a time, on at most 2 threads, with at most 4 waiting or running |
| Slow uploads | Abandoned after 30 seconds |
| Processing | The caller gets an answer within 15 seconds. The upload's slot stays held until decoding really ends |

**How an image is checked, in order:**

1. Authentication, Origin, declared type and rate limits run before any of the body is read.
2. The first bytes must match an allowed format, so SVG, GIF, TIFF and others never reach libvips. libvips must then report the same format. Loaders aren't locked with `sharp.block()`, because that's process-wide and Next's image optimizer sets it too, so each would undo or break the other.
3. Dimensions come from the header and are limited before any pixel is decoded, so a small file claiming billions of pixels costs almost nothing.
4. Every pixel is decoded by sharp (libvips), a maintained library. Damage the decoder notices is rejected, including warnings.
5. The image is rotated upright from its EXIF orientation, converted to sRGB and re-encoded in its original format.

**The clean copy** holds only pixels. EXIF (including GPS), XMP, colour profiles, comments, text chunks and appended data can't survive, because nothing is copied from the original except decoded pixels. Anything sending an image elsewhere must use this copy. JPEG and WebP are re-encoded at quality 90, so they change slightly. PNG stays pixel-identical unless it's rotated or converted to sRGB.

**Retention:** images aren't stored. The bytes live in memory until processing ends, and they're never logged or returned. The libvips cache is off, so nothing is kept between images. Its temp files are avoided by the pixel limit, as it writes a decoded image to disk only above 100 MiB. The browser previews the user's own file, so no image URL exists to expose. The response holds only metadata and a SHA-256 of the uploaded file.

**Why not a stricter own parser:** an earlier version of this milestone parsed each format's structure by hand and decoded nothing. That accepted files with corrupt pixels, which only a real decoder can reject.

**Timeouts:** libvips's own timeout doesn't cover PNG encoding, so the 15-second answer is a deadline in our code. Abandoned work can't be cancelled, so it keeps both its queue place and its upload slot until it really ends. It can't pile up, and a stuck decode fails closed: uploads get 429 until the server restarts, while the rest of the app keeps working.

**Known limitations:**

- **Undetectable damage:** baseline JPEG and lossy WebP have no pixel checksums, so some damage decodes without any error into a wrong-looking picture. In a seeded test, single-byte damage to baseline JPEG scan data was detected only about 12% of the time. PNG detected all of it. This is why a person must compare the extracted values with the photo in 3.3.
- **Strict decoding:** treating decoder warnings as failures could reject some unusual files that browsers display. This needs testing with real phone photos.
- **Per-process limits:** like the login limits, all of these limits apply per server process.

### Deployment memory

| Measured on a production build (Windows, 32 threads) | Result |
|---|---|
| Idle server | About 180 MB |
| Heaviest images, one at a time (16 MP) | About 680 MB peak |
| Heaviest image straight after floods of 1,000+ rejected requests | **788 MB peak** |
| After 60 heaviest decodes in a row | Settled at about 260 MB, with no growth between rounds |

**Requirements, per Node process:**

- **Minimum: 1 GB.** The measured peak leaves little margin below that.
- **Recommended for a first deployment: 1.5 GB**, until the numbers are confirmed on the target host.
- **Not a Node setting:** decoding uses native memory, so `--max-old-space-size` doesn't limit it. Set the limit on the container or host.
- **Each process counts separately:** the limits are per process, so memory and upload allowances multiply with the number of processes.

**Linux hasn't been measured.** Before launch, repeat the measurement on the target. sharp's documentation says glibc's allocator suits this kind of work poorly and recommends jemalloc. It uses 1 thread on glibc to limit fragmentation, which this code preserves, so decoding will be slower there. Alpine (musl) isn't affected. Also confirm that the reverse proxy limits request bodies, and raise any host limit below the 15-second deadline.

**If `next/image` is added later:** its work runs outside this queue, so its memory adds to these figures.

## 3.2: Label scanning

### Client preparation for phone photos

The server's 16 MP limit stays. Phone photos can be far larger (48 MP and up), so the browser prepares them first. The goal is the most readable label, not the smallest file, and the server still validates everything because a client can't be trusted.

**1. Choosing a file.** Use `accept="image/jpeg,image/png,image/webp"`, with JPEG first and no HEIC. iOS Safari is reported to convert HEIC to the first accepted type when a file is chosen.

**2. HEIC.** Detect it from the file's first bytes, then try to decode it in the browser. Safari 17+ is reported to decode HEIC, while Chrome and Firefox aren't. If it can't be decoded, say so plainly: "This browser can't open HEIC photos. Export it as JPEG, or use Most Compatible in your iPhone's camera settings." HEIC isn't accepted by the server, and a WebAssembly decoder isn't planned for the first version.

**3. Crop first, at full resolution.** The preview is a scaled image, but the crop maps back to original pixels. This is the main way to preserve text: a label filling a fifth of a 48 MP photo can keep every pixel once cropped, while scaling the whole photo would discard most of them.

**4. Decode with orientation applied.** The whole upright image is drawn from an image element with `imageSmoothingQuality: "high"`, positioned so that a canvas the size of the result clips it to the crop. A full-size canvas is never needed, because older iOS versions limit a canvas to 16.7 megapixels. A source rectangle in `drawImage` can't be used: WebKit reads it differently on a rotated image, which cropped the wrong region in testing. The result is checked for failure, because a canvas can fail silently.

**5. Change as little as possible:**

| Selected image | What happens |
|---|---|
| Upright, uncropped, long edge up to 2,576 px, an accepted format, up to 7 MiB | Original bytes are uploaded, with no client re-encoding. The server removes metadata before anything leaves it |
| Cropped or rotated, long edge up to 2,576 px | Re-encoded at the same pixel size, never scaled |
| Long edge above 2,576 px | Scaled to 2,576 px, which is what vision providers work at. Never enlarged |

Re-encoding uses JPEG at quality 0.92. If that's over 7 MiB, 0.85 is tried once. If it's still too large, the user is asked to crop. Quality never drops below 0.85, and there's no loop that keeps lowering it until the file fits. The server then re-encodes at quality 90, so a test on real labels must confirm that the two steps together keep small text readable.

**6. Readability is never assumed:**

- **Changes are shown:** for example, "Scaled from 8,000 x 6,000 to 2,576 x 1,932".
- **The user checks it:** the prepared image, not the original, opens at 100% zoom with "Can you read the numbers clearly?" and the choices Use this, Crop closer and Retake.
- **Advice when scaling is heavy:** if an uncropped photo loses more than half its width, the app suggests cropping to the label.
- **Not automated yet:** a sharpness warning, such as variance of the Laplacian, isn't implemented, because its threshold must come from real labels. Until then the person checking the image is the safeguard.
- **Unreadable fields stay unreadable:** if extraction reports `unreadable`, nothing is guessed. The app offers a closer crop or retake, using original pixels. An automatic retry never uses a smaller or more compressed image.
- **Failures are explicit:** an image too large or too damaged to prepare gets a message, never a lower-quality substitute.

**Measured in Chromium, Firefox and WebKit on a synthetic 48 MP photo:** after scaling the whole photo and both encoding steps, text at least 40 px tall in the original stays readable, and text of 28 px or less becomes hard or impossible to read. Cropping to the label keeps all of it sharp, down to 20 px. This is why cropping comes first, and why heavily reduced photos get advice to crop.

**Still needs real devices:** HEIC from an iPhone in Safari, 48 MP and 200 MP photos on low-memory phones, Android Chrome, wide-colour photos, and real label photos. Automated tests ran Playwright's desktop browser builds, not phones, and WebKit there isn't iOS Safari. Some browser facts above come from bug reports and blog posts, so they're starting assumptions, not guarantees.

### Provider interface

```ts
interface LabelExtractor {
  readonly id: string; // e.g. "anthropic:some-model", recorded with each result
  extract(image: { bytes: Uint8Array; mediaType: string }, signal: AbortSignal): Promise<unknown>;
}
```

The result is `unknown` on purpose: provider output is untrusted input until it passes validation. Failures carry only a code, never provider text. The Anthropic adapter uses the official SDK. Automated tests never reach a provider: unit tests inject a fake `fetch` under the real SDK, and browser tests point it at `scripts/stub-label-provider.cjs`.

### What gets extracted

Each field records what was printed, and missing is null, never 0:

```ts
{ status: "read" | "absent" | "unreadable"; value: number | null; unit: string | null; printed: string | null; reason: string | null }
```

| Status | Rules |
|---|---|
| `read` | `printed` is required and holds the exact label text. `value` may be null if the text isn't an exact number, such as "<1 g" |
| `absent` | Everything else is null |
| `unreadable` | `value` and `unit` are null, and `reason` is required |

Text fields have no `unit`, and serving size uses `amount` instead of `value`. A label holds `isNutritionLabel`, `productName`, `brand`, `servingSize`, `servingsPerContainer`, and up to 4 `columns`. Each column has a `basis` of `per_serving`, `per_100g`, `per_100ml` or `other`, its `printedHeading`, and `kcal`, `protein`, `carbs`, `fat` and `fiber`.

A response is rejected whole if it isn't JSON, is over 64,000 characters, breaks these rules or holds any unknown key.

Evidence is the exact printed text beside the original photo, not bounding boxes, because model coordinates are approximate.

### Deterministic checks after extraction

A failed check never changes a value. It adds a flag for the person reviewing:

| Flag | When |
|---|---|
| `printed_value_mismatch` | The value isn't a number the printed text can mean. A dropped decimal point is caught |
| `value_not_parsed` | Printed, but not as an exact number |
| `invalid_number` | Negative, or 0 servings per container |
| `implausible_value` | Fails `implausibleNutrients` in `nutrition.ts` |
| `energy_macro_mismatch` | kcal differs from 4P + 4C + 9F by over 20% and 10 kcal, using `macroKcal`. Fiber and polyols can legitimately cause gaps |
| `contradictory_columns` | Same-basis columns disagree, or per-serving doesn't match per-100 at the printed serving, using `scaleNutrients` |
| `columns_not_comparable` | One column is in grams and the other in millilitres, so they're neither compared nor converted |
| `energy_in_kilojoules` | Energy is printed only in kJ. It isn't converted |
| `unexpected_unit` | A nutrient has an unexpected unit, such as mg of protein. It isn't converted |
| `serving_unit_needs_input` | The serving isn't in g or ml, such as "1 cup" or "1 oz". The user must supply it |
| `serving_amount_out_of_range` | Outside the supported serving limits |
| `unknown_column_basis` | The column isn't per serving or per 100 |
| `no_nutrition_values` | Nothing could be read |

The tolerances are starting points, set from label rounding rather than measured on real labels.

**Never done:** treating a missing value as zero, converting between mass and volume, or using any number the model calculated.

### API

```
POST /api/nutrition/label-scans
  Body: raw image. Same upload checks and limits as /api/images/validate.
  200: { verified: false, notice, extraction, flags[], extractorId, imageSha256 }
```

| Failure | Response |
|---|---|
| Not signed in, or wrong Origin | 401 or 403, before the body is read |
| Scanning not set up | 503, before the body is read |
| Scan limit reached | 429 with `Retry-After`, before the body is read |
| Rejected image | Same as image validation. Nothing is sent, and no scan is used |
| Not a nutrition label | 422 |
| Unusable provider output, or a refusal | 502 |
| Provider unavailable, or our key or model refused | 503 |
| Provider timeout (60 seconds) | 504 |

Nothing is stored and no food or log entry is created. Errors and logs hold only a code, never provider text.

### Configuration and cost controls

| Setting | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required. Scanning is off without it |
| `LABEL_EXTRACTION_MODEL` | Required, with **no default**. Choose it from a test on real labels |
| `LABEL_EXTRACTION_EFFORT` | Optional. Lower effort costs less |
| `LABEL_SCAN_USER_DAILY_LIMIT` | Scans per user per rolling 24 hours. Default 30 |
| `LABEL_SCAN_GLOBAL_DAILY_LIMIT` | Scans overall per rolling 24 hours. Default 300 |

**What bounds the cost of a scan:** one request, as SDK retries are off and refusal fallbacks aren't used. Output is capped at 4,096 tokens, and the image at the size above. Failed requests still count against the limits, because they may be billed. Provider requests also hold an upload slot, so at most 4 run at once.

**After a timeout:** the user gets the 504 on time and cancellation is requested, but a provider request that ignores cancellation stays counted. It keeps its upload slot until it really ends, and is never retried. If requests truly hang, each holds its slot until the server restarts: that user's uploads, and everyone's once all 4 are held, get 429, while routes that don't take uploads keep working.

**These limits live in memory, per server process, and reset on restart.** Set a spending limit with the provider too, as the only hard ceiling.

### Safety

- **Label text is data:** the prompt says so, the image is the only variable input, no tools are offered, and the response can only fill the fixed fields. The page renders it as plain text.
- **What this can't prevent:** a label could still mislead a model into a wrong value that also appears in the text. That's why results stay unverified and a person must check them. How a real model responds to injection hasn't been measured, because that needs paid requests.
- **Provider data:** only the clean image copy and fixed text are sent, with the operator's key. No cookies, session or user details are included.

### Provenance and schema

No migration is needed to start 3.2 and 3.3: a confirmed label can be saved as a `CUSTOM` food with `dataType: "Label"`, which needs no schema change. Field-level provenance does need one, so it's proposed here for review, and nothing will be migrated without approval:

```prisma
enum NutritionEvidence { MANUFACTURER_LABEL  USDA_RECORD  OPEN_FOOD_FACTS_RECORD  USER_ENTERED }

model Food {
  // existing fields stay as they are
  evidence      NutritionEvidence?
  labelEvidence Json?  // per field: extracted value, printed text, final value, whether the user corrected it,
                       // extractor id, image SHA-256. No image is stored.
}

enum QuantityEvidence { MEASURED  ESTIMATED }

model FoodEntry {
  // existing fields stay as they are
  quantityEvidence QuantityEvidence?  // null for existing rows: unknown, not assumed
}
```

These describe where information came from, not a guarantee that it's accurate. Existing rows stay null and are never backfilled with guesses.

### Tests for 3.2 and 3.3

With mocked extractor responses: missing fields stay null, invalid serving units require user input, wrong values are flagged, per-serving and per-100 stay distinct, contradictory columns are flagged, non-label images are rejected, a prompt injection printed on a label has no effect beyond its own field, corrections are recorded, and nothing is saved or logged without confirmation.

## 3.3: Review and confirmation

After a scan, the person's own image stays beside the extracted values, and every value can be edited. Nothing is confirmed automatically, and the image is held only in the browser. It's sent again only if the person chooses **Scan this image again**, which counts as another scan and discards corrections. The rules live in `src/lib/label-review.ts`, as pure functions.

### Where each value came from

| Shown as | Meaning |
|---|---|
| Read by AI | As the scan read it, and not yet confirmed |
| Corrected by you | The person changed what the scan read |
| Entered by you | The scan had no value, and the person supplied one |
| Removed by you | The person cleared what the scan read |
| Not on label | The label doesn't report it. The field stays empty, never 0 |
| Couldn't read | It's there but unreadable. The field stays empty, with the reason |
| Needs a value | It's printed, but not usably, such as "<1 g", kJ or mg. It isn't converted |

The exact printed text appears under each field. Each column is kept separate: one is chosen for saving, and the others stay visible for comparison.

### Correction rules

- **Numbers:** an empty field is empty, not 0, and a person may type 0 where the label supports it. "1,200" is refused rather than read as 1.2 or 1200, while a decimal comma such as "12,5" is accepted.
- **Wrong readings:** a value that doesn't match its printed text is shown as read and flagged, never corrected silently.
- **Warnings follow the values:** the scan's checks run again on the values as they stand, so a correction can clear a warning or create one.
- **Conflicts:** any remaining warning needs its own acknowledgement before saving.
- **Changing anything clears the confirmations,** as the person agreed to the values they saw.

### Serving and basis

| Label reports | What's needed | What's sent to `POST /api/foods` |
|---|---|---|
| Per serving | Serving amount and unit | The values as they stand |
| Per 100 g | Serving amount in g | `scaleNutrients(values, amount, 6)` |
| Per 100 ml | Serving amount in ml | `scaleNutrients(values, amount, 6)` |

- **Household servings:** "1 cup" can't be saved until a gram or millilitre amount is confirmed. It's never guessed.
- **No serving on the label:** the person enters one, or chooses **Use 100 g as the serving**.
- **Grams and millilitres:** a per-100 g column can't be saved with a serving in ml, or the reverse, because density isn't known.
- **Precision:** the API takes per-serving values and stores per-100, so 6 decimals are kept on the way. With the usual 2, a 1 g serving at 8.3 g per 100 g would be stored as 8.

### Saving

The form uses the same `customFoodSchema` the server enforces, so both give the same answer, and the API contract is unchanged. Everything still needed is listed in plain words. Once it's resolved, the page shows exactly what will be saved, per serving and per 100, and needs an explicit confirmation. A double click sends one request.

After saving, the page shows the saved nutrition as the server returned it, and missing fiber reads "Not reported". **Saving a food never logs it:** adding it to the diary stays a separate step, through the normal food workflow. The scan link on the Add food page appears only when scanning is configured.

### Known limits

- **Servings per container isn't saved:** it can be corrected, which settles any warning about it, but the food API has nowhere to store it.
- **Where values came from isn't stored:** saved foods look like any other custom food. Field-level provenance needs the migration proposed above, which hasn't been approved.
- **Duplicates:** a double click can't create two foods, and since 3.6 neither can retrying after a dropped connection. Scanning and saving the same label twice still will.
- **The person is the final check:** the confirmation records that someone looked, not that the values are right.

## 3.4: PDF nutrition extraction

**PDFs are processed only in the browser, with pdf.js from Mozilla.** The file is never uploaded, stored or sent to a provider. The server sees only what it already handles: a page image, through the same checks as a photo, and a confirmed food, through `POST /api/foods`.

| | In the browser (chosen) | On the server |
|---|---|---|
| Where a hostile PDF can do harm | The user's own tab, in a sandboxed worker | The shared server |
| Stopping a stuck parser | The worker is terminated | A running parse can't be stopped, as with libvips |
| New server dependency | None | Native canvas library |
| PDF in server memory | Never | Yes, even if briefly |

```
Choose a PDF → signature and size checks → pdf.js opens it in a worker → page count and encryption checks
  → read each page's text, within limits → the person chooses a page
       ├─ clear text: deterministic parser → Phase 3.3 review (no AI, no cost)
       └─ scanned or unclear: render one page → crop → Phase 3.2 scan → Phase 3.3 review
```

### Limits

| Limit | Value |
|---|---|
| File size | 20 MiB |
| Pages | 50 |
| Text per page, and in total | 20,000 and 200,000 characters. Over that, the file is refused |
| Embedded image | 100 megapixels. Larger images aren't rendered |
| Rendered page | 300 DPI and 16 megapixels at most, one page at a time |
| Opening a file | 20 seconds |
| Reading text | 10 seconds a page, 30 seconds in total |
| Rendering a page | 30 seconds |
| Documents open | 1, in 1 worker |

**A deadline terminates the worker,** so no unfinished work survives it. Unlike the image path, nothing stays running.

**Limitation on decompressed size:** pdf.js has no limit on how far a compressed stream expands. A bomb is bounded by the deadline and by the tab's own memory, and only affects the person who opened it. It can't reach the server. In Chromium on the development PC, a page expanding to 1.5 GB read as an empty page within 7 seconds, and the tab kept working. A phone has far less memory, and that hasn't been measured. Limits in the browser protect the person's tab, not the server, which is why the server still validates everything it receives.

### What the browser can't guarantee

These limits protect the person's own tab. The server doesn't rely on any of them:

- **A modified browser can skip every limit here.** It gains nothing, because all it can send is an image or a food, and the server validates those itself.
- **Scan and save limits are the server's own,** so they apply however a client behaves.
- **Memory can't be capped from a page.** The render size and embedded image limits bound the main costs, but not every internal buffer pdf.js uses, such as transparency layers, and not how far a stream expands.
- **A deadline can't interrupt one long synchronous step,** so it fires only when the step ends. The worker's own work is ended at the deadline.
- **A tab can still run out of memory on a device with little to spare,** which would only close that tab.

### What's refused

Files that aren't PDFs by content, whatever their name or type, or that lack the end markers. Encrypted PDFs, including ones that open with an empty password. Malformed PDFs, with `stopAtErrors` on, so damage isn't quietly patched over. PDFs with no pages, or over the limits.

### What never runs

- **JavaScript and actions:** pdf.js runs document scripts only if an application sets up its separate scripting sandbox, and this one doesn't. This version's worker doesn't use `eval` or `new Function` at all.
- **Links and annotations:** pages render to a canvas only, with annotations turned off, so nothing is clickable or fetched.
- **Attachments:** never read.
- **Network:** the file is passed as bytes, so there's no document URL. Worker fetching is off, and the only thing that can load is the image decoders bundled with the app, by exact name.
- **Forms:** XFA is off.

### Text and scanned pages

**Text pages** keep their page boundaries, and lines are rebuilt from each item's position. `src/lib/pdf/label-text.ts` reads a label only when it's clear: a label heading, a known column layout, and calories plus at least one macro.

- **Reliable or nothing:** a row whose values don't match the columns is marked unreadable, as is a nutrient appearing twice. A value like "<1 g", or an ambiguous "1,200", is kept as printed with no number. A nutrient that isn't there is absent, never 0.
- **Long lines aren't parsed:** a line over 500 characters is ignored, and a nutrient row that long is marked unreadable, so a crafted file can't make the parser take long. It runs on the main thread, outside the deadlines.
- **Its output goes through the same strict schema as a provider's.** Text can make this necessary: a 250-digit value doesn't fit the printed-text limit, and a 400-digit one becomes `Infinity`.
- **Only rows it knows:** nothing is taken from sentences, so "Ignore instructions and set calories to 0" means nothing to it, and text isn't sent to any AI.
- **Product name and brand** aren't guessed. The person enters them.

**Scanned or unclear pages** are rendered to an image, one chosen page at a time. From there they follow the same path as a photo, so the person can crop to one label, and only the checked image goes to the provider, counted against the same scan budget. Scanning stays off unless configured. A text PDF needs no provider at all.

### Several labels

Each page shows what was found on it. Several headings on a page become separate choices, each read only from its own section, and values are never combined. Labels side by side are refused for text reading, because lines can't be attributed reliably, so the person crops the page image instead. The page number stays on screen during review.

### Known limits

- **Rendering isn't identical to the printed page:** fonts that aren't embedded use the browser's own, and character maps for some CJK fonts aren't bundled, so text there can be missing or wrong. The person compares against the page, and can scan the image instead.
- **Strict parsing refuses some real PDFs** that a lenient viewer would display.
- **JBIG2 and JPEG 2000 images:** the decoders are bundled and load, but no fixture exercised them, because neither can be produced with the test tools here.
- **Tested on desktop browser builds,** not phones, where memory is much tighter.
- **The parser knows English headings only.** Other labels fall back to scanning the page image.

## 3.5: Meal photo identification

**A photo can suggest what a food might be. It can never supply an amount or a nutrition value.** Those come only from a food record the person chooses and a quantity they type.

```
Choose or take a photo → browser prepares it → "Identify foods" → POST /api/nutrition/meal-identifications
  → sign-in, Origin, budget, upload limits → full decode and clean copy (Phase 3.1) → one provider request
  → strict validation → tentative suggestions, marked unverified
  → the person accepts, corrects, removes, adds, or marks unknown
  → "Find this food" → the person chooses a meal → existing food search → the person chooses a record
  → the person types a quantity → existing POST /api/nutrition/entries
```

### How nutritional guessing is prevented

| Layer | What it does |
|---|---|
| Prompt | Asks only for what foods are, and for no amounts, sizes or nutrition. Those aren't requested at all |
| JSON schema | Has no number fields, so there's nowhere to put a value |
| Unknown keys | `calories`, `grams` or anything else unexpected rejects the whole response, at any level |
| Text check | Numbers in any script, units, serving and measure words, number words, nutrition claims and non-Latin letters in any text reject the whole response. Text is normalized first, so fullwidth forms and invisible characters can't hide a word. A short list of exact names, such as "7 Up" and "pound cake", is set aside, and the rest of the text is still checked |
| Observations | What can be seen is never about nutrition, so these also reject words like "protein" and "high-carb" that a food's name might use |
| Confidence | Only the words likely, possible and unknown. A numeric score would be invented |
| Review state | A review item has no amount field, so nothing can be carried forward |
| Search | Only a name the person accepted can become a query, and only when they ask |
| Meal | No default. The person chooses a meal before the search appears, it's visible and changeable in the add sheet, and the review shows where each food went |
| Food choice | Results are never selected automatically. No match means no food, and never a guessed profile |
| Quantity | The add sheet starts empty in this flow, and can't be submitted until an amount is typed |
| Calculation | The server's existing `POST /api/nutrition/entries` is the only thing that calculates, from the record and the typed amount |

A response is rejected whole rather than cleaned, because a model that returns an amount has already gone outside its instructions. The cost is that a harmless phrase, such as "half an avocado" or "rice on one side of the plate", wastes a scan.

### What's shared, and what isn't

- **Shared with label scanning:** image validation, sanitizing, upload limits, the concurrency slot held until provider work settles, the provider request code, and the scan budget, so paid requests have one ceiling across both features.
- **Its own:** `MEAL_IDENTIFICATION_MODEL`, with no default and no fallback to the label model, as accuracy on labels says nothing about accuracy on meals.

**Not stored:** the photo stays in memory for the request, and in the person's browser for review. Identifying creates no food or diary entry. Choosing a USDA or Open Food Facts result caches that record, as the food search always has.

### Estimated cost per photo

Up to about 5,400 input tokens, and up to 1,500 output tokens, including thinking. The typical figure assumes about 400 output tokens. These are estimates, not measurements.

| Model | Typical | Worst case |
|---|---|---|
| Opus 5.5 | About 2.8 cents | About 5.2 cents |
| Sonnet 5.5 | About 1.4 cents | About 2.6 cents |
| Haiku 5.5 | About 0.07 cents | About 0.13 cents |

### Known limits

- **Accuracy is unmeasured:** suggestions have never come from a real model. Mixed dishes and hidden ingredients can't be seen in a photo at all, which is why nothing relies on them.
- **Real prompt injection is unmeasured:** a sign in a photo could still mislead a real model into a wrong name. It can't produce an action or an amount, and a person accepts every name.
- **The text check is a word list, in English:** an amount in unusual phrasing, or in another language written in Latin letters such as "cien gramos", could pass. It would only ever be shown as text, as nothing reads numbers from it. Size words such as "large" are allowed, as they're part of names like "large egg".
- **Numbered names outside the list are rejected:** a product such as "Pizza 73" fails closed and costs a scan, until it's added to the list.
- **A false rejection costs a scan,** as described above.

## 3.6: Integration and hardening

No new AI functionality, no paid requests, no schema change and no new dependency. The production assessment is separate: `docs/PHASE_3_PRODUCTION_READINESS.md`.

### Integration plan

Written before the code changed, from reading the code as merged at the end of 3.5.

| Area | What the code did | Gap | Plan |
|---|---|---|---|
| Matching | The person always chooses. Dedupe is only on `source:sourceId`, so nothing merges | Source shown only as a section heading. "Incomplete" doesn't say what's missing. Recent foods show neither. "greek yogurt" misses a custom "Yogurt, Greek", as the whole phrase had to match | Show source and missing values on every row. Match custom foods word by word, on name or brand. Ranking stays as it is |
| Provenance | `Food.source` and `dataType` are stored. A saved label is `dataType: "Custom"`, like any custom food. `FoodEntry` has only `foodId` | The diary showed no source, though the `foodId` join can supply it | Show what the row really records. Never suggest a custom food came from a label. Propose the rest as a schema change |
| Duplicates | `busy` state and, on label review, a ref | Two clicks in one task beat the re-render in the add and custom food sheets. Closing a sheet mid-save allowed a second save. A retry after a lost response created a second row | Guard with refs, lock sheets while saving, and add a persistent idempotency key, as below |
| Save in progress | The payload is fixed on click | Label review stayed editable during a save, so someone could edit and believe the edit was saved. "Choose another page" stayed active and discarded the result | Disable the form while saving, and block leaving |
| Network failure | `Failed to fetch` was shown as it came, and a request could hang forever | The message didn't say the save might have worked, and a hung request would trap a locked sheet | Plain message that says when the outcome is unknown, plus a client timeout |
| Numbers | `parseNum` read "1,200" as 1.2, `0x10` as 16 and `1e3` as 1000 | A custom food typed as "1,200" kcal saved 1.2 kcal | Same strictness as label review, with a clear message wherever it's used, including workouts, profile and targets |
| Resources | Image routes limit their bodies. `parseBody` used `req.json()` with no limit unless told | One signed-in request could fill the server's memory | A default limit for every JSON body |
| Logging | `console.error(err)` on unexpected errors | Some Prisma errors hold the query's values | Log only the error's type and code for those |

### Food matching

Search stays deterministic and has no AI: USDA and Open Food Facts answer in their own order, and custom foods are listed by name. A confirmed name is only a search term. **No result is ever chosen automatically, even when there's only one.** "White rice" stays a list of different records, and the person chooses, or chooses none.

- **Each row shows** its source (USDA with its data type, Open Food Facts, or My food), brand when known, nutrition per 100, and exactly which values are missing.
- **Nothing merges:** two records with the same name stay two records, within a source and across sources.
- **Missing stays missing:** a value not reported shows "—" and is named as missing. A record with no nutrition at all can't be chosen. The API itself would log one, with every value null, as nothing is invented either way.
- **Custom food search** matches every word against the name or brand, in any order, and at most 8 words.
- **Not added:** when a food database is down, cached records from it aren't searched. The person sees the source's error, and can use recent or custom foods.

### What each indicator means

| Shown | Comes from | Means | Doesn't mean |
|---|---|---|---|
| USDA | `Food.source`, `dataType` | A public USDA FoodData Central record | That it matches what was on the plate |
| Open Food Facts | `Food.source` | A community-contributed product record | That it's verified against the package |
| My food | `Food.source` | Values someone entered or confirmed in this account | That they came from a label: this isn't recorded, including for foods saved from a scan |
| Possibly or likely X, Accepted by you | Browser state during a review | How sure the AI said it was, and that the person accepted the name | Anything about nutrition |
| Missing: protein | Null values on the record | The source doesn't report it | That it's 0 |
| Unverified, Read by AI | Scan response | Read by a model, and not yet checked | |
| Source no longer available | `foodId` is null | The record was deleted, and the entry keeps the values saved when it was logged | |

**Identity and nutrition are separate claims.** Finding a record doesn't verify an AI suggestion: the page says so, and states that the nutrition comes from the chosen record and the typed amount. A confirmation records that a person accepted the information, not that anyone measured it.

**Not stored, so not shown after the review ends:** that an entry began as a photo suggestion, that a food came from a scan, or what was corrected.

### Proposed schema for provenance (not implemented)

No migration is authorized. This extends the proposal in 3.2:

```prisma
enum IdentityOrigin { USER_SEARCH  AI_SUGGESTION_ACCEPTED  AI_SUGGESTION_CORRECTED  USER_ADDED }

model FoodEntry {
  identityOrigin   IdentityOrigin?   // null: not recorded
  quantityEvidence QuantityEvidence? // from 3.2
}

model Food {
  evidence      NutritionEvidence? // from 3.2
  labelEvidence Json?              // from 3.2
  confirmedAt   DateTime?          // when a person confirmed a saved label
}
```

- **Benefits:** the diary could show whether an entry began as an AI suggestion, foods saved from a label could say so, and accuracy could be audited later by correction rate.
- **Migration risk:** low. These are nullable columns and new enums, with no rewrite of existing rows. `labelEvidence` can grow large, and would be exposed by any query that returns whole rows, so it needs explicit selects. The evidence is personal data, so it needs including in account deletion and any export.
- **Existing records:** stay null, shown as "Not recorded", and are never backfilled with guesses. A custom food from before the migration can't be claimed as label-derived.

### Duplicate submissions

| Risk | Protection |
|---|---|
| Double click, or two clicks in one task | A ref checked before anything else, so the second click does nothing |
| Repeated activation while saving | The button is disabled, and the form's fields with it |
| Closing a sheet during a save, then saving again | Close, Escape and the backdrop do nothing until the save ends |
| Leaving a label review during a save | "Choose another page" is disabled until it ends |
| Concurrent requests, and retries after a lost response | The idempotency key below, enforced by the database |

**Persistent idempotency needed no migration.** The client sends an `Idempotency-Key`, one per sheet or review, kept across retries. The server derives an existing unique value from `sha256(kind, userId, key)`:

| Request | Value derived | Unique constraint |
|---|---|---|
| `POST /api/nutrition/entries` | `FoodEntry.id` | Primary key |
| `POST /api/foods` | `Food.sourceId` | `@@unique([source, sourceId])` |

- **A retry with the same values** gets the original record, and nothing new is created. Two racing requests make one row: the loser gets the database's unique violation and returns the winner's row.
- **The same key with different values** gets 409 and creates nothing, as the first attempt may have saved. Silently returning the old values would claim that the new ones were saved. Values are compared as the columns store them, so a serving of 33.3333 g, stored as 33.333, still matches its own retry.
- **A later edit wins:** a stale retry of a request whose entry has since been edited gets 409, and doesn't undo the edit.
- **Another user's key** derives a different value, as the hash includes the user. The row is also read back by its owner, so the hash isn't the only protection. The value is 128 bits of SHA-256, and the key can't be recovered from it.
- **Deliberate repeats stay possible:** each opening of the add sheet makes a new key, so logging the same food twice makes two entries. Nothing compares food names.
- **No key:** behaves as before, so other clients still work.

**Limits:** deleting a record frees its key, so a stale retry of that exact request could recreate it. The window is narrow, as only the sheet that sent it holds the key. Saving the same label from two separate scans makes two foods: they are two deliberate saves, and judging them identical would mean comparing names or values, which isn't safe. Keys don't expire, which costs nothing as they're just the row's id.

### Saving

The label form, add sheet, custom food sheet and diary entry editor all follow the same rules while saving:

- **Fields are disabled,** so what's on screen is what was sent. Zooming the label image still works.
- **A failure keeps everything typed,** including corrections and confirmations.
- **The message says what's known.** No answer, or a server error, says the outcome is unknown, and that trying again is safe. A refusal gives the server's reason.
- **A request gets 30 seconds** before it counts as no answer, so a hung connection can't trap a locked sheet.
- **Deleting an entry that's already gone** counts as success, for a retry after a lost response.

### Sheets and the keyboard

A sheet is placed directly in `<body>`, and everything else is `inert` while it's open. Before this, pressing Tab during a save could reach a food name behind the sheet, and typing changed that item: the entry saved, but the item read "Not reviewed", which invited logging it again. The sheet was also pushed off screen on wide displays, by a CSS transform on the review layout.

- **Focus** moves into the sheet, stays there, and returns to whatever opened it. If saving took focus away, it comes back to the sheet when the save ends.
- **Not a trap:** the lock lasts only as long as the save, which has a 30-second deadline. Escape and Close then work again. Browser navigation still works, and leaves nothing inert.
- **A successful save always shows as logged,** whatever happened to the item in the meantime.

### Security review: changes made

- `parseBody` limits every JSON body to 256 KiB by default, reading through the same bounded reader as uploads.
- Prisma errors are logged by type and code only, as their messages can hold query values.
- Scan and identify buttons guard against two clicks in one task. The server's one-upload-per-user limit already stopped the second request being sent to the provider.

Everything else audited, and what remains for production, is in the readiness report.

### Known limits

- **Leaving the page during a save** can't be stopped. The save still completes, and the key can't help, as a new page makes a new key.
- **Custom foods still need all four main values,** because the API requires them. A label that omits one needs a value typed, or can't be saved, rather than saving with a gap.

## Provider recommendation

**Implemented:** Claude through the official Anthropic SDK, behind the interface above. Vision is a single request with JSON-schema structured output, handles varied label layouts, and needs no separate OCR and parsing stages. No model is chosen by default, because accuracy on labels hasn't been measured: choose the cheapest one that passes a test on real labels.

| Option | Estimated cost per label | Strengths | Weaknesses |
|---|---|---|---|
| **Claude Opus 5.5** | About 4 cents | Layout understanding, structured output | Highest cost here, third-party data handling |
| Claude Sonnet 5.5 | About 2 cents | Same features at lower cost | Accuracy on labels unmeasured |
| Claude Haiku 5.5 | About 0.1 cent | Very low cost | Accuracy on labels unmeasured |
| Google Vision or Amazon Textract | About 0.15 cent, plus parsing | Mature OCR | Returns text, not nutrition fields, so a parser or LLM is still needed |
| Tesseract (local) | Free | Private, no vendor | Weak on phone photos of dense tables in the studies found |

**How the estimates work:** up to 4,784 visual tokens for a high-resolution image, about 600 for the prompt, and about 800 output tokens including thinking, at list prices. These are estimates, not measurements. Thinking could raise them up to the 4,096-token cap, which would make a scan about 10 cents on Opus 5.5, 5 cents on Sonnet 5.5 and 0.3 cents on Haiku 5.5. Scan volume will drive the real total.

**Privacy:** by default, Anthropic deletes API inputs and outputs within 30 days and doesn't train on them, with exceptions in its terms. Zero data retention is available by arrangement. A label photo is low-sensitivity once metadata is removed, but it can show a user's surroundings, so this needs a clear notice to users.

**Before choosing a model:** run a small test on real labels with known values, comparing models on each field. This needs approval, because it makes paid requests.
