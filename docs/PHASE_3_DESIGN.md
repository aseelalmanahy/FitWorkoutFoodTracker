# Phase 3: Accuracy-First Nutrition

**Principle:** accuracy matters more than automation. AI may read printed values and suggest what a food might be. It must never invent calories, macros, weights, ingredients or missing facts. Only confirmed source data and user-provided quantities enter nutrition calculations.

This replaces the earlier plan in `ARCHITECTURE.md` for AI-estimated calories and portions.

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| 3.1 | Secure image input and validation | Implemented, awaiting review |
| 3.2 | Nutrition-label scanning and structured extraction | Designed below |
| 3.3 | User review, correction and confirmation | Designed below |
| 3.4 | PDF nutrition extraction | Not started |
| 3.5 | Meal photo identification, with no AI-generated calories | Not started |
| 3.6 | Food matching, provenance indicators, security and full regression testing | Not started |

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

## 3.2: Label scanning (design)

### Client preparation for phone photos

The server's 16 MP limit stays. Phone photos can be far larger (48 MP and up), so the browser prepares them first. The goal is the most readable label, not the smallest file, and the server still validates everything because a client can't be trusted.

**1. Choosing a file.** Use `accept="image/jpeg,image/png,image/webp"`, with JPEG first and no HEIC. iOS Safari is reported to convert HEIC to the first accepted type when a file is chosen.

**2. HEIC.** Detect it from the file's first bytes, then try to decode it in the browser. Safari 17+ is reported to decode HEIC, while Chrome and Firefox aren't. If it can't be decoded, say so plainly: "This browser can't open HEIC photos. Export it as JPEG, or use Most Compatible in your iPhone's camera settings." HEIC isn't accepted by the server, and a WebAssembly decoder isn't planned for the first version.

**3. Crop first, at full resolution.** The preview is a scaled image, but the crop maps back to original pixels. This is the main way to preserve text: a label filling a fifth of a 48 MP photo can keep every pixel once cropped, while scaling the whole photo would discard most of them.

**4. Decode with orientation applied.** Use `createImageBitmap(file, { imageOrientation: "from-image", resizeWidth, resizeHeight, resizeQuality: "high" })`, so the image is scaled as it's decoded. A full-size canvas must never be needed, because older iOS versions limit a canvas to 16.7 megapixels. Where the resize options aren't honoured, scale in steps of one half using `imageSmoothingQuality: "high"`. Check that the result isn't blank, because a failed canvas can fail silently.

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
- **Sharpness check:** variance of the Laplacian can warn about blur. It only warns, never blocks or changes the image, and its threshold must be set from real labels.
- **Unreadable fields stay unreadable:** if extraction reports `unreadable`, nothing is guessed. The app offers a closer crop or retake, using original pixels. An automatic retry never uses a smaller or more compressed image.
- **Failures are explicit:** an image too large or too damaged to prepare gets a message, never a lower-quality substitute.

**Must be verified on real devices in 3.2:** HEIC from an iPhone in Safari, 48 MP and 200 MP photos on low-memory phones, Android Chrome and desktop Chrome with HEIC, all 8 orientations, wide-colour photos, and text legibility after both encoding steps. The browser facts above come partly from bug reports and blog posts, so they're starting assumptions, not guarantees.

### Provider interface

```ts
interface LabelExtractor {
  readonly id: string; // e.g. "anthropic:claude-opus-5-5", recorded with each result
  extract(image: { bytes: Uint8Array; mediaType: string }, signal: AbortSignal): Promise<unknown>;
}
```

The result is `unknown` on purpose: provider output is untrusted input until it passes the same validation as anything else. Automated tests use a mocked extractor. No AI framework is needed.

### What gets extracted

Each field records exactly what was printed:

```ts
type ExtractedField<T> =
  | { status: "read"; value: T; printed: string }   // printed = the exact text on the label
  | { status: "absent" }                            // the label doesn't report it
  | { status: "unreadable"; reason: string };       // present, but it can't be read reliably

interface LabelExtraction {
  isNutritionLabel: boolean;
  productName: ExtractedField<string>;
  brand: ExtractedField<string>;
  servingSize: ExtractedField<{ amount: number; unit: string }>; // as printed, unconverted
  servingsPerContainer: ExtractedField<number>;
  columns: Array<{
    basis: "per_serving" | "per_100g" | "per_100ml" | "other";
    printedHeading: string;
    kcal: ExtractedField<number>;
    protein: ExtractedField<number>;
    carbs: ExtractedField<number>;
    fat: ExtractedField<number>;
    fiber: ExtractedField<number>;
  }>;
}
```

Evidence is the exact printed text beside the original photo, not bounding boxes, because model coordinates are approximate.

### Deterministic checks after extraction

A failed check never changes a value. It flags the field for the user:

| Check | Outcome |
|---|---|
| `isNutritionLabel` is false, or no columns | Rejected, with nothing to review |
| `printed` doesn't contain the digits in `value` | Field marked unreadable |
| Negative or non-numeric value | Field marked unreadable |
| Value fails `implausibleNutrients` in `nutrition.ts` | Flagged |
| kcal differs from 4P + 4C + 9F by more than 20%, using `macroKcal` | Flagged, not corrected, as fiber and polyols legitimately cause gaps |
| Two columns contradict each other at the printed serving size | Flagged |
| kJ only | Shown as printed. Conversion needs the user's confirmation |
| Unit isn't g, ml or a recognized mass or volume | Serving amount required from the user |

**Never done:** treating a missing value as zero, converting between mass and volume, or using any number the model calculated. A value labelled "per serving" stays that way until the serving's mass or volume is known. If the label says "1 cup" with no grams, the user must supply it, or the food can't be saved per 100 g.

### Saving

Per-100 values are calculated by the existing deterministic path. `POST /api/foods` already takes per-serving values and a serving amount, and `customFoodSchema` already enforces the physical limits. Nothing is logged automatically: saving a food and logging it stay separate user actions.

### API

```
POST /api/nutrition/label-scans
  Body: raw image. Same checks as /api/images/validate, plus its own stricter limit.
  Response: { extraction, flags[], extractorId, imageSha256 }
  Stores nothing. Sends only the clean image copy to the provider.
```

Confirmation then uses the existing `POST /api/foods`, extended as below.

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

## 3.3: Review and confirmation (design)

The original photo (the user's own local file) appears beside the extracted values. Every field is editable, unreadable and flagged fields stand out, and nothing is pre-confirmed. Absent nutrients show as "not reported", never 0. Save stays disabled until required fields are filled and the user confirms. After saving, the user picks a quantity through the existing add-food sheet.

## Provider recommendation

**Recommended:** Claude through the official Anthropic SDK, behind the interface above, starting with `claude-opus-5-5`. Vision is a single request with JSON-schema structured output, handles varied label layouts, and needs no separate OCR and parsing stages. The final model choice should come from a measured test on real labels.

| Option | Estimated cost per label | Strengths | Weaknesses |
|---|---|---|---|
| **Claude Opus 5.5** | About 4 cents | Layout understanding, structured output | Highest cost here, third-party data handling |
| Claude Sonnet 5.5 | About 2 cents | Same features at lower cost | Accuracy on labels unmeasured |
| Claude Haiku 5.5 | About 0.1 cent | Very low cost | Accuracy on labels unmeasured |
| Google Vision or Amazon Textract | About 0.15 cent, plus parsing | Mature OCR | Returns text, not nutrition fields, so a parser or LLM is still needed |
| Tesseract (local) | Free | Private, no vendor | Weak on phone photos of dense tables in the studies found |

**How the estimates work:** up to 4,784 visual tokens for a high-resolution image, about 600 for the prompt, and about 800 output tokens including thinking, at list prices. These are estimates, not measurements. Thinking could raise them, and scan volume will drive the real total.

**Privacy:** by default, Anthropic deletes API inputs and outputs within 30 days and doesn't train on them, with exceptions in its terms. Zero data retention is available by arrangement. A label photo is low-sensitivity once metadata is removed, but it can show a user's surroundings, so this needs a clear notice to users.

**Before choosing a model:** run a small test on real labels with known values, comparing models on each field. This needs approval, because it makes paid requests.
