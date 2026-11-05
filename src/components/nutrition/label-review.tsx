"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { LabelExtraction } from "@/lib/label-extraction";
import {
  BASIS_LABELS, buildReviewDraft, fieldOrigin, flagTargets, isManualColumn, manualBases, NUTRIENT_LABELS, NUTRIENT_UNITS, ORIGIN_LABELS, reviewFlags, savePreview, servingOrigin, validateReview,
  type BasisUnit, type FieldOrigin, type ReviewDraft, type ReviewField, type UsableBasis,
} from "@/lib/label-review";
import { fmtG, fmtKcal, NUTRIENT_KEYS, scaleNutrients, type NutrientKey, type Nutrients } from "@/lib/nutrition";
import type { FoodDto } from "@/lib/server/foods/service";
import { buttonClass, Button, Card, cx, ErrorText, Field, Input, Select } from "@/components/ui";

const ORIGIN_STYLES: Record<FieldOrigin, string> = {
  ai: "bg-surface-2 text-muted",
  corrected: "bg-up/15 text-up",
  entered: "bg-up/15 text-up",
  cleared: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  missing: "bg-surface-2 text-muted",
  unreadable: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  needs_value: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

function OriginBadge({ field, testId }: { field: ReviewField | FieldOrigin; testId?: string }) {
  const origin = typeof field === "string" ? field : fieldOrigin(field);
  return <span data-testid={testId} data-origin={origin} className={cx("whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", ORIGIN_STYLES[origin])}>{ORIGIN_LABELS[origin]}</span>;
}

function Evidence({ field }: { field: ReviewField }) {
  return (
    <>
      {field.printed && <span className="mt-1 block text-xs text-muted">Label says: {field.printed}</span>}
      {field.note && <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">{field.note}</span>}
    </>
  );
}

function LabelImage({ preparedUrl, originalUrl }: { preparedUrl: string; originalUrl: string | null }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [fullSize, setFullSize] = useState(false);
  return (
    <div className="sticky top-0 z-10 space-y-2 bg-[var(--bg)] py-2 md:top-4">
      <div className="max-h-[35vh] overflow-auto rounded-lg border border-line md:max-h-[75vh]">
        {/* eslint-disable-next-line @next/next/no-img-element -- the user's own file, held only in this browser */}
        <img data-testid="review-image" src={showOriginal && originalUrl ? originalUrl : preparedUrl} alt="The label you scanned" className={fullSize ? "block max-w-none" : "block w-full"} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => setFullSize((v) => !v)}>{fullSize ? "Fit to width" : "Zoom to full size"}</Button>
        {originalUrl && <Button type="button" size="sm" variant="secondary" onClick={() => setShowOriginal((v) => !v)}>{showOriginal ? "Show scanned image" : "Show original photo"}</Button>}
      </div>
    </div>
  );
}

function SavedFood({ food, onScanAnother }: { food: FoodDto; onScanAnother: () => void }) {
  const serving = food.servings.find((s) => s.isDefault) ?? food.servings[0];
  const unit = food.basisUnit === "ML" ? "ml" : "g";
  const perServing = serving ? scaleNutrients(food.per100, serving.amount) : null;
  const row = (values: Nutrients, key: NutrientKey) => {
    const value = values[key];
    if (value == null) return "Not reported";
    return key === "kcal" ? `${fmtKcal(value)} kcal` : `${fmtG(value)} g`;
  };
  return (
    <div className="space-y-4" data-testid="saved-food">
      <Card className="border-up/40 p-4">
        <p className="font-medium" role="status">Saved to My foods. It hasn&apos;t been added to your diary.</p>
        <p className="mt-1 text-lg font-semibold" data-testid="saved-name">{food.name}</p>
        {food.brand && <p className="text-sm text-muted">{food.brand}</p>}
      </Card>
      <Card className="p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1 font-normal">Saved nutrition</th>
              {serving && perServing && <th className="py-1 text-right font-normal">{serving.label}</th>}
              <th className="py-1 text-right font-normal">Per 100 {unit}</th>
            </tr>
          </thead>
          <tbody>
            {NUTRIENT_KEYS.map((key) => (
              <tr key={key}>
                <td className="py-1 text-muted">{NUTRIENT_LABELS[key]}</td>
                {perServing && <td className="py-1 text-right">{row(perServing, key)}</td>}
                <td className="py-1 text-right" data-testid={`saved-per100-${key}`}>{row(food.per100, key)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="flex flex-wrap gap-2">
        <Link href="/nutrition/add" className={buttonClass("primary")}>Add to diary</Link>
        <Button variant="secondary" onClick={onScanAnother}>Scan another label</Button>
        <Link href="/nutrition" className={buttonClass("secondary")}>Back to nutrition</Link>
      </div>
    </div>
  );
}

export function LabelReview({ extraction, notice, preparedUrl, originalUrl, rescanLabel = "Scan this image again", onRescan, onScanAnother }: {
  extraction: LabelExtraction;
  notice: string;
  preparedUrl: string;
  /** The photo before it was cropped or scaled, when that differs. */
  originalUrl: string | null;
  rescanLabel?: string;
  onRescan: () => void;
  onScanAnother: () => void;
}) {
  const [draft, setDraftState] = useState<ReviewDraft>(() => buildReviewDraft(extraction));
  const [confirmedValues, setConfirmedValues] = useState(false);
  const [confirmedWarnings, setConfirmedWarnings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<FoodDto | null>(null);
  const submitted = useRef(false);

  const validation = useMemo(() => validateReview(draft), [draft]);
  const flags = useMemo(() => reviewFlags(draft, extraction), [draft, extraction]);
  const preview = useMemo(() => savePreview(validation), [validation]);
  const problemFor = (field: string) => validation.problems.find((p) => p.field === field)?.message;

  /** Any change needs confirming again, as the person agreed to the values they saw. */
  const setDraft = (update: (current: ReviewDraft) => ReviewDraft) => {
    setDraftState(update);
    setConfirmedValues(false);
    setConfirmedWarnings(false);
    setSaveError(null);
  };
  const setNutrient = (key: NutrientKey, value: string) => setDraft((d) => ({
    ...d,
    columns: d.columns.map((c, i) => (i === d.active ? { ...c, nutrients: { ...c.nutrients, [key]: { ...c.nutrients[key], value } } } : c)),
  }));
  const setBasis = (basis: UsableBasis) => setDraft((d) => ({ ...d, columns: d.columns.map((c, i) => (i === d.active ? { ...c, basis } : c)) }));

  const column = draft.columns[draft.active];
  const manual = isManualColumn(draft, draft.active);
  const per100Unit = column?.basis === "per_100g" ? "g" : column?.basis === "per_100ml" ? "ml" : null;
  const canSave = validation.payload !== null && confirmedValues && (flags.length === 0 || confirmedWarnings) && !saving;

  const save = async () => {
    if (!canSave || submitted.current || !validation.payload) return; // a second click can't send a second request
    submitted.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const { food } = await api<{ food: FoodDto }>("POST", "/api/foods", validation.payload);
      setSaved(food);
    } catch (err) {
      submitted.current = false;
      setSaveError(err instanceof Error ? err.message : "The food couldn't be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (saved) return <SavedFood food={saved} onScanAnother={onScanAnother} />;

  return (
    <div className="grid gap-4 md:relative md:left-1/2 md:w-[min(calc(100vw-2rem),64rem)] md:-translate-x-1/2 md:grid-cols-2 md:items-start">
      <LabelImage preparedUrl={preparedUrl} originalUrl={originalUrl} />

      <div className="min-w-0 space-y-4" data-testid="scan-result">
        <Card className="border-amber-500/60 p-4">
          <p className="font-medium text-amber-700 dark:text-amber-400" role="status">{notice}</p>
          <p className="mt-1 text-sm text-muted">Nothing has been saved. Compare each value with the label, and correct anything that&apos;s wrong.</p>
        </Card>

        <Card className="space-y-3 p-4">
          <Field label="Product name" error={problemFor("name")}>
            <Input data-testid="input-name" value={draft.name.value} maxLength={200} onChange={(e) => { const value = e.target.value; setDraft((d) => ({ ...d, name: { ...d.name, value } })); }} />
            <span className="mt-1 flex flex-wrap items-center gap-2"><OriginBadge field={draft.name} testId="origin-name" /></span>
            <Evidence field={draft.name} />
          </Field>
          <Field label="Brand" hint="Optional" error={problemFor("brand")}>
            <Input data-testid="input-brand" value={draft.brand.value} maxLength={200} onChange={(e) => { const value = e.target.value; setDraft((d) => ({ ...d, brand: { ...d.brand, value } })); }} />
            <span className="mt-1 flex flex-wrap items-center gap-2"><OriginBadge field={draft.brand} /></span>
            <Evidence field={draft.brand} />
          </Field>
        </Card>

        <Card className="space-y-3 p-4">
          <h3 className="font-medium">Serving</h3>
          <Field label="Serving name" hint="Such as 1 cup or 2 biscuits" error={problemFor("servingLabel")}>
            <Input data-testid="input-serving-label" value={draft.servingLabel} maxLength={80} onChange={(e) => { const value = e.target.value; setDraft((d) => ({ ...d, servingLabel: value })); }} />
          </Field>
          <div className="grid grid-cols-[2fr_1fr] gap-2">
            <Field label="Serving size" error={problemFor("servingAmount")}>
              <Input data-testid="input-serving-amount" inputMode="decimal" value={draft.servingAmount.value} onChange={(e) => { const value = e.target.value; setDraft((d) => ({ ...d, servingAmount: { ...d.servingAmount, value } })); }} />
            </Field>
            <Field label="Unit">
              <Select data-testid="input-serving-unit" value={draft.servingUnit} onChange={(e) => { const value = e.target.value as BasisUnit | ""; setDraft((d) => ({ ...d, servingUnit: value })); }}>
                <option value="">Choose</option>
                <option value="G">g</option>
                <option value="ML">ml</option>
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2"><OriginBadge field={servingOrigin(draft)} testId="origin-serving" /></div>
          <Evidence field={draft.servingAmount} />
          {problemFor("servingUnit") && <p className="text-xs text-down" data-testid="serving-unit-problem">{problemFor("servingUnit")}</p>}
          {per100Unit && draft.servingAmount.value.trim() === "" && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setDraft((d) => ({
              ...d,
              servingLabel: `100 ${per100Unit}`,
              servingAmount: { ...d.servingAmount, value: "100" },
              servingUnit: per100Unit === "ml" ? "ML" : "G",
            }))}>Use 100 {per100Unit} as the serving</Button>
          )}
          <Field label="Servings per container" hint="For your reference while checking the label. It isn't saved with the food." error={problemFor("servingsPerContainer")}>
            <Input data-testid="input-servings-per-container" inputMode="decimal" value={draft.servingsPerContainer.value} onChange={(e) => { const value = e.target.value; setDraft((d) => ({ ...d, servingsPerContainer: { ...d.servingsPerContainer, value } })); }} />
            <span className="mt-1 flex flex-wrap items-center gap-2"><OriginBadge field={draft.servingsPerContainer} testId="origin-servings-per-container" /></span>
            <Evidence field={draft.servingsPerContainer} />
          </Field>
        </Card>

        <Card className="space-y-3 p-4">
          <h3 className="font-medium">Nutrition column to save</h3>
          <div role="radiogroup" aria-label="Nutrition column to save" className="space-y-2">
            {draft.columns.map((c, i) => {
              const isManual = isManualColumn(draft, i);
              const label = isManual ? "Enter the values myself" : `${BASIS_LABELS[c.basis]}${c.printedHeading ? ` (printed: ${c.printedHeading})` : ""}`;
              return (
                <label key={i} className={cx("flex items-start gap-2 rounded-lg border border-line p-2 text-sm", c.basis === "other" && "opacity-60")}>
                  <input type="radio" name="label-column" className="mt-1" disabled={c.basis === "other"} checked={draft.active === i} onChange={() => setDraft((d) => ({ ...d, active: i }))} />
                  <span>{label}{c.basis === "other" && !isManual ? " can't be saved directly" : ""}</span>
                </label>
              );
            })}
          </div>
          {problemFor("column") && <p className="text-xs text-down">{problemFor("column")}</p>}
          {manual && column && (
            <Field label="These values are">
              <Select data-testid="input-manual-basis" value={column.basis} onChange={(e) => setBasis(e.target.value as UsableBasis)}>
                {manualBases().map((basis) => <option key={basis} value={basis}>{BASIS_LABELS[basis]}</option>)}
              </Select>
            </Field>
          )}
        </Card>

        {column && (
          <Card className="space-y-3 p-4" data-testid="nutrient-form">
            <h3 className="font-medium">{BASIS_LABELS[column.basis]}</h3>
            {NUTRIENT_KEYS.map((key) => {
              const field = column.nutrients[key];
              const flagged = flags.filter((f) => flagTargets(f, draft.active, key));
              return (
                <Field key={key} label={`${NUTRIENT_LABELS[key]} (${NUTRIENT_UNITS[key]})${key === "fiber" ? ", optional" : ""}`} error={problemFor(key)}>
                  <Input data-testid={`input-${key}`} inputMode="decimal" value={field.value} placeholder={fieldOrigin(field) === "missing" || fieldOrigin(field) === "unreadable" ? "Empty" : undefined} aria-invalid={flagged.length > 0} className={flagged.length > 0 ? "border-amber-500" : undefined} onChange={(e) => setNutrient(key, e.target.value)} />
                  <span className="mt-1 flex flex-wrap items-center gap-2"><OriginBadge field={field} testId={`origin-${key}`} /></span>
                  <Evidence field={field} />
                  {flagged.map((f, i) => <span key={i} data-testid={`flag-${key}`} className="mt-1 block text-xs text-amber-700 dark:text-amber-400">{f.message}</span>)}
                </Field>
              );
            })}
          </Card>
        )}

        {draft.columns.some((c, i) => i !== draft.active && !isManualColumn(draft, i)) && (
          <Card className="p-4" data-testid="other-columns">
            <h3 className="mb-2 font-medium">Other columns on this label</h3>
            {extraction.columns.map((c, i) => (i === draft.active ? null : (
              <dl key={i} className="mb-3 last:mb-0">
                <dt className="text-sm font-medium">{BASIS_LABELS[c.basis]}{c.printedHeading ? ` (printed: ${c.printedHeading})` : ""}</dt>
                {NUTRIENT_KEYS.map((key) => (
                  <dd key={key} className="flex justify-between gap-4 py-0.5 text-sm">
                    <span className="text-muted">{NUTRIENT_LABELS[key]}</span>
                    <span>{c[key].status === "read" ? c[key].printed : c[key].status === "absent" ? <span className="text-muted">Not on label</span> : <span className="text-amber-700 dark:text-amber-400">Couldn&apos;t read</span>}</span>
                  </dd>
                ))}
              </dl>
            )))}
          </Card>
        )}

        {flags.length > 0 && (
          <Card className="border-amber-500/60 p-4" data-testid="scan-flags">
            <h3 className="mb-2 font-medium">Check these</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {flags.map((flag, i) => <li key={i}>{flag.message}</li>)}
            </ul>
          </Card>
        )}

        {validation.problems.length > 0 && (
          <Card className="p-4" data-testid="save-blockers">
            <h3 className="mb-2 font-medium">Needed before saving</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {validation.problems.map((p, i) => <li key={i}>{p.message}</li>)}
            </ul>
          </Card>
        )}

        {preview && (
          <Card className="space-y-3 p-4" data-testid="save-preview">
            <h3 className="font-medium">This is what will be saved</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1 font-normal"><span className="sr-only">Nutrient</span></th>
                  <th className="py-1 text-right font-normal">{preview.label} ({preview.amount} {preview.unit})</th>
                  <th className="py-1 text-right font-normal">Per 100 {preview.unit}</th>
                </tr>
              </thead>
              <tbody>
                {NUTRIENT_KEYS.map((key) => {
                  const show = (values: Nutrients) => (values[key] == null ? "Not reported" : key === "kcal" ? `${fmtKcal(values[key])} kcal` : `${fmtG(values[key])} g`);
                  return (
                    <tr key={key}>
                      <td className="py-1 text-muted">{NUTRIENT_LABELS[key]}</td>
                      <td className="py-1 text-right" data-testid={`preview-serving-${key}`}>{show(preview.serving)}</td>
                      <td className="py-1 text-right" data-testid={`preview-per100-${key}`}>{show(preview.per100)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <label className="flex items-start gap-2 text-sm">
              <input data-testid="confirm-values" type="checkbox" className="mt-1" checked={confirmedValues} onChange={(e) => setConfirmedValues(e.target.checked)} />
              <span>I compared these values with the label, and they&apos;re correct.</span>
            </label>
            {flags.length > 0 && (
              <label className="flex items-start gap-2 text-sm">
                <input data-testid="confirm-warnings" type="checkbox" className="mt-1" checked={confirmedWarnings} onChange={(e) => setConfirmedWarnings(e.target.checked)} />
                <span>I checked the warning{flags.length === 1 ? "" : "s"} above, and want to save anyway.</span>
              </label>
            )}
          </Card>
        )}

        <ErrorText>{saveError}</ErrorText>

        <div className="flex flex-wrap gap-2">
          <Button data-testid="save-food" onClick={() => void save()} disabled={!canSave}>{saving ? "Saving…" : "Save to My foods"}</Button>
          <Button variant="secondary" disabled={saving} onClick={onRescan}>{rescanLabel}</Button>
          <Button variant="secondary" disabled={saving} onClick={onScanAnother}>Scan another label</Button>
        </div>
        <p className="text-sm text-muted">Scanning sends the image to the AI provider, counts as a scan, and discards your corrections. Saving doesn&apos;t add anything to your diary.</p>
      </div>
    </div>
  );
}
