"use client";

import { entryNutrients, fmtG, fmtKcal, GRAMS_PER_OZ, MEAL_LABELS, MEAL_TYPES, OZ_SERVING_ID, ozServing, type MealType, type Nutrients } from "@/lib/nutrition";
import { parseNum } from "@/lib/client/api";
import { Field, Input, Select } from "@/components/ui";

export interface ServingChoice {
  id: string | null; // null = raw grams/ml; OZ_SERVING_ID = ounces (foods measured by weight only)
  label: string;
  amount: number;
}

/** Shared serving/quantity/meal controls with a live nutrition preview. */
export function PortionEditor({ per100, basisUnit, servings, servingId, quantity, mealType, onChange }: {
  per100: Nutrients;
  basisUnit: "G" | "ML";
  servings: ServingChoice[];
  servingId: string | null;
  quantity: string;
  mealType: MealType;
  onChange: (p: { servingId?: string | null; quantity?: string; mealType?: MealType }) => void;
}) {
  const u = basisUnit === "ML" ? "ml" : "g";
  // UI-12: ounces are a weight, so they're offered only when the food is measured in grams; never converted to ml.
  const oz = basisUnit === "G" ? { id: OZ_SERVING_ID, ...ozServing() } : null;
  const units: ServingChoice[] = [...servings.filter((s) => s.id !== null && s.id !== OZ_SERVING_ID), ...(oz ? [oz] : [])];
  const serving = units.find((s) => s.id === servingId) ?? { id: null, label: u, amount: 1 };
  const isOz = serving.id === OZ_SERVING_ID;
  const q = parseNum(quantity);
  const valid = Number.isFinite(q) && q > 0;
  const n = valid ? entryNutrients(per100, serving.amount, q) : null;
  const total = valid ? Math.round(serving.amount * q * 10) / 10 : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <Field label={serving.id === null ? `Amount (${u})` : isOz ? "Amount (oz)" : "Servings"}>
          <Input inputMode="decimal" value={quantity} onChange={(e) => onChange({ quantity: e.target.value })} aria-invalid={!valid} data-testid="portion-quantity" />
        </Field>
        <Field label="Serving size">
          <Select value={servingId ?? "__raw"} data-testid="portion-unit" onChange={(e) => {
            const id = e.target.value === "__raw" ? null : e.target.value;
            // Keep the consumed amount roughly constant when switching units.
            const next = units.find((s) => s.id === id) ?? { amount: 1 };
            const amt = valid ? serving.amount * q : null;
            onChange({ servingId: id, quantity: amt != null ? String(Math.round((amt / next.amount) * 100) / 100) : quantity });
          }}>
            {units.filter((s) => s.id !== OZ_SERVING_ID).map((s) => <option key={s.id} value={s.id!}>{s.label}</option>)}
            <option value="__raw">{u === "g" ? "grams (g)" : "millilitres (ml)"}</option>
            {oz && <option value={OZ_SERVING_ID}>ounces (oz)</option>}
          </Select>
        </Field>
      </div>
      <Field label="Meal">
        <Select value={mealType} onChange={(e) => onChange({ mealType: e.target.value as MealType })}>
          {MEAL_TYPES.map((m) => <option key={m} value={m}>{MEAL_LABELS[m]}</option>)}
        </Select>
      </Field>
      <div className="rounded-2xl bg-surface-2 p-3">
        <p className="text-xs text-muted" data-testid="portion-total">{total == null ? "Enter a quantity greater than 0" : isOz ? `This entry · ${fmtG(q)} oz = ${fmtG(total)} g (1 oz = ${GRAMS_PER_OZ} g)` : `This entry · ${fmtG(total)} ${u}`}</p>
        <div className="num mt-1 grid grid-cols-4 gap-2 text-center">
          {([["kcal", "kcal"], ["protein", "Protein"], ["carbs", "Carbs"], ["fat", "Fat"]] as const).map(([k, label]) => (
            <div key={k}>
              <p className="text-lg font-bold">{n ? (k === "kcal" ? fmtKcal(n[k]) : fmtG(n[k])) : "—"}</p>
              <p className="text-[11px] text-muted">{label}{k !== "kcal" && " (g)"}</p>
            </div>
          ))}
        </div>
        {n && Object.entries(n).some(([k, v]) => v == null && k !== "fiber") && (
          <p className="mt-2 text-xs text-down">Some values aren&apos;t reported by the source and are shown as “—”. They are not counted as 0.</p>
        )}
      </div>
    </div>
  );
}
