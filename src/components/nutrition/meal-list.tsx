"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, parseNum, SAVE_TIMEOUT_MS } from "@/lib/client/api";
import { missingText, recordOrigin, SOURCE_NOT_AVAILABLE } from "@/lib/food-provenance";
import { fmtG, fmtKcal, MEAL_LABELS, type MealType, type NutrientTotals } from "@/lib/nutrition";
import { Button, Card, ErrorText } from "@/components/ui";
import { PlusIcon } from "@/components/icons";
import { Sheet } from "./sheet";
import { PortionEditor, type ServingChoice } from "./portion-editor";
import type { EntryDto } from "@/lib/server/nutrition/entries";

export interface MealGroup {
  mealType: MealType;
  entries: EntryDto[];
  totals: NutrientTotals;
}

export function MealList({ meals, date }: { meals: MealGroup[]; date: string }) {
  const [editing, setEditing] = useState<EntryDto | null>(null);
  return (
    <div className="space-y-3">
      {meals.map((m) => (
        <Card key={m.mealType} className="overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
            <div>
              <h3 className="font-bold">{MEAL_LABELS[m.mealType]}</h3>
              <p className="num text-xs text-muted">
                {m.entries.length ? <>{fmtKcal(m.totals.kcal)} kcal · P {fmtG(m.totals.protein)} · C {fmtG(m.totals.carbs)} · F {fmtG(m.totals.fat)}</> : "Nothing logged"}
              </p>
            </div>
            <Link href={`/nutrition/add?date=${date}&meal=${m.mealType}`} aria-label={`Add food to ${MEAL_LABELS[m.mealType]}`}
              className="grid h-9 w-9 place-items-center rounded-full bg-accent text-accent-fg">
              <PlusIcon width={18} height={18} />
            </Link>
          </div>
          {m.entries.length > 0 && (
            <ul className="divide-y divide-line border-t border-line">
              {m.entries.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => setEditing(e)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{e.foodName}{e.brand && <span className="text-muted"> · {e.brand}</span>}</span>
                      {missingText(e.nutrients) && <span className="block text-[11px] text-down" data-testid="entry-missing">{missingText(e.nutrients)}</span>}
                      <span className="num block truncate text-xs text-muted">
                        {e.servingAmount === 1 ? `${fmtG(e.quantity)} ${e.servingLabel}` : `${fmtG(e.quantity)} × ${e.servingLabel}`} · P {fmtG(e.nutrients.protein)} · C {fmtG(e.nutrients.carbs)} · F {fmtG(e.nutrients.fat)}
                      </span>
                    </span>
                    <span className="num shrink-0 text-sm font-semibold">{fmtKcal(e.nutrients.kcal)}<span className="text-xs font-normal text-muted"> kcal</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
      {editing && <EntryEditor entry={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EntryEditor({ entry, onClose }: { entry: EntryDto; onClose: () => void }) {
  const router = useRouter();
  const isRaw = entry.servingAmount === 1 && (entry.servingLabel === "g" || entry.servingLabel === "ml");
  const current: ServingChoice = { id: isRaw ? null : "__current", label: entry.servingLabel, amount: entry.servingAmount };
  const [servings, setServings] = useState<ServingChoice[]>(isRaw ? [] : [current]);
  const [servingId, setServingId] = useState<string | null>(current.id);
  const [quantity, setQuantity] = useState(String(entry.quantity));
  const [mealType, setMealType] = useState(entry.mealType);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  // Offer the food's other servings when the cached food still exists.
  useEffect(() => {
    if (!entry.foodId) return;
    let alive = true;
    api<{ food: { servings: { id: string; label: string; amount: number }[] } }>("GET", `/api/foods/${entry.foodId}`)
      .then(({ food }) => {
        if (!alive) return;
        const match = food.servings.find((s) => s.label === entry.servingLabel && s.amount === entry.servingAmount);
        const list: ServingChoice[] = food.servings.map((s) => ({ id: s.id, label: s.label, amount: s.amount }));
        if (!match && !isRaw) list.push(current);
        setServings(list);
        if (match) setServingId(match.id);
      })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  async function save() {
    const q = parseNum(quantity);
    if (!(q > 0)) return setError("Quantity must be greater than 0.");
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      await api("PATCH", `/api/nutrition/entries/${entry.id}`, {
        quantity: q,
        mealType,
        ...(servingId === "__current" ? {} : { servingId }),
      }, { timeoutMs: SAVE_TIMEOUT_MS });
      onClose();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      saving.current = false;
      setBusy(false);
    }
  }

  async function remove() {
    if (saving.current || !confirm(`Delete ${entry.foodName}?`)) return;
    saving.current = true;
    setBusy(true);
    try {
      // Already gone means an earlier attempt worked and its answer was lost.
      await api("DELETE", `/api/nutrition/entries/${entry.id}`, undefined, { timeoutMs: SAVE_TIMEOUT_MS }).catch((e) => { if (!(e instanceof ApiError && e.status === 404)) throw e; });
      onClose();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <Sheet open title={entry.foodName} locked={busy} onClose={onClose}>
      <p className="-mt-2 mb-3 text-xs text-muted" data-testid="entry-provenance" data-source={entry.foodSource ?? "none"}>
        {entry.foodSource ? `${recordOrigin({ source: entry.foodSource }).badge}. ${recordOrigin({ source: entry.foodSource }).detail}` : SOURCE_NOT_AVAILABLE}
      </p>
      <fieldset disabled={busy} className="min-w-0">
        <PortionEditor
          per100={entry.per100}
          basisUnit={entry.basisUnit}
          servings={servings}
          servingId={servingId}
          quantity={quantity}
          mealType={mealType}
          onChange={(p) => {
            if (p.servingId !== undefined) setServingId(p.servingId);
            if (p.quantity !== undefined) setQuantity(p.quantity);
            if (p.mealType) setMealType(p.mealType);
          }}
        />
      </fieldset>
      <div className="mt-4"><ErrorText>{error}</ErrorText></div>
      <div className="mt-3 flex gap-2">
        <Button variant="danger" onClick={remove} disabled={busy}>Delete</Button>
        <Button className="flex-1" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
      </div>
    </Sheet>
  );
}
