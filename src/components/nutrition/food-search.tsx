"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, newIdempotencyKey, parseNum, SAVE_TIMEOUT_MS, saveFailureMessage } from "@/lib/client/api";
import { hasNoNutrition, missingText, recordOrigin, type RecordSource } from "@/lib/food-provenance";
import { fmtG, fmtKcal, MEAL_LABELS, relativeDayLabel, scaleNutrients, type MealType, type Nutrients } from "@/lib/nutrition";
import { Button, Card, ErrorText, Field, Input, Select, cx } from "@/components/ui";
import { Sheet } from "./sheet";
import { PortionEditor } from "./portion-editor";
import type { FoodDto, SearchItem, SearchResponse, SearchSource } from "@/lib/server/foods/service";

type Filter = "ALL" | SearchSource;
const FILTERS: { v: Filter; label: string }[] = [
  { v: "ALL", label: "All" },
  { v: "USDA", label: "Generic" },
  { v: "OPEN_FOOD_FACTS", label: "Packaged" },
  { v: "CUSTOM", label: "My foods" },
];
const SECTION: Record<SearchSource, { title: string; note: string }> = {
  CUSTOM: { title: "My foods", note: "Foods you created" },
  USDA: { title: "Generic foods", note: "USDA FoodData Central" },
  OPEN_FOOD_FACTS: { title: "Packaged foods", note: "Open Food Facts (ODbL)" },
};

function Per100({ item }: { item: Pick<SearchItem, "per100" | "basisUnit"> }) {
  const n = item.per100;
  const u = item.basisUnit === "ML" ? "ml" : "g";
  return (
    <span className="num">
      per 100 {u}: {fmtKcal(n.kcal)} kcal · P {fmtG(n.protein)} · C {fmtG(n.carbs)} · F {fmtG(n.fat)}
    </span>
  );
}

/** Where a record came from, and what it doesn't report. Shown wherever a record can be chosen. */
function RecordFacts({ food }: { food: { source: RecordSource; dataType: string | null; per100: Nutrients } }) {
  const missing = missingText(food.per100);
  return (
    <>
      <span className="mt-1 block text-[11px] text-muted" data-testid="food-source" data-source={food.source}>{recordOrigin(food).badge}</span>
      {missing && <span className="mt-0.5 block text-[11px] text-down" data-testid="food-missing">{missing}</span>}
    </>
  );
}

export function FoodSearch({ date, today, initialMeal, embedded }: {
  date: string;
  today: string;
  initialMeal: MealType;
  /** Inside another page, starting from a name a person confirmed. The amount must then be typed. */
  embedded?: { initialQuery: string; onLogged: (meal: MealType, food: FoodDto) => void };
}) {
  const [q, setQ] = useState(embedded?.initialQuery ?? "");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [recent, setRecent] = useState<FoodDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FoodDto | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [meal, setMeal] = useState<MealType>(initialMeal);
  const [added, setAdded] = useState<{ name: string; kcal: number | null; meal: MealType }[]>([]);
  const reqId = useRef(0);
  const picking = useRef(false);
  // A result is disabled while its record loads, which drops focus before the sheet opens, so it's remembered here.
  const pickedRow = useRef<HTMLElement | null>(null);

  useEffect(() => {
    api<{ foods: FoodDto[] }>("GET", "/api/foods/recent").then((r) => setRecent(r.foods)).catch(() => setRecent([]));
  }, []);

  const search = useCallback(async (term: string, f: Filter) => {
    const id = ++reqId.current;
    if (term.trim().length < 2) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const sources = f === "ALL" ? "" : `&sources=${f}`;
      const r = await api<SearchResponse>("GET", `/api/foods/search?q=${encodeURIComponent(term.trim())}${sources}`);
      if (id === reqId.current) setData(r);
    } catch (e) {
      if (id === reqId.current) setError((e as Error).message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(q, filter), 350);
    return () => clearTimeout(t);
  }, [q, filter, search]);

  async function pick(item: SearchItem) {
    if (picking.current) return; // a slower answer must not replace the record chosen later
    picking.current = true;
    pickedRow.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError(null);
    setResolving(item.key);
    try {
      const r = item.foodId && item.source === "CUSTOM"
        ? await api<{ food: FoodDto }>("GET", `/api/foods/${item.foodId}`)
        : await api<{ food: FoodDto }>("POST", "/api/foods/resolve", { source: item.source, sourceId: item.sourceId });
      if (hasNoNutrition(r.food.per100)) setError(`${r.food.name} has no nutrition data to log.`);
      else setSelected(r.food);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      picking.current = false;
      setResolving(null);
    }
  }

  useEffect(() => {
    if (selected || resolving || !pickedRow.current?.isConnected) return;
    pickedRow.current.focus({ preventScroll: true });
    pickedRow.current = null;
  }, [selected, resolving]);

  const sections = (["CUSTOM", "USDA", "OPEN_FOOD_FACTS"] as SearchSource[]).filter((s) => filter === "ALL" || filter === s);
  const total = data ? sections.reduce((n, s) => n + data.results[s].length, 0) : 0;

  return (
    <div>
      <div className={embedded ? "pb-3" : "sticky top-0 z-20 -mx-4 bg-bg/95 px-4 pt-4 pb-3 backdrop-blur-xl"}>
        {!embedded && (
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">Add food</h1>
              <p className="text-xs text-muted">{relativeDayLabel(date, today)} · {MEAL_LABELS[meal]}</p>
            </div>
            <Link href={date === today ? "/nutrition" : `/nutrition?date=${date}`} className="rounded-xl bg-fg px-4 py-2 text-sm font-semibold text-bg">Done</Link>
          </div>
        )}
        <Input type="search" placeholder="Search foods or enter a barcode" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={!embedded} aria-label="Search foods" />
        <div className="mt-2 flex gap-1.5 overflow-x-auto">
          {FILTERS.map((f) => (
            <button key={f.v} type="button" onClick={() => setFilter(f.v)} aria-pressed={filter === f.v}
              className={cx("h-8 shrink-0 rounded-full px-3 text-xs font-medium", filter === f.v ? "bg-fg text-bg" : "bg-surface-2 text-muted")}>
              {f.label}
            </button>
          ))}
          <button type="button" onClick={() => setCreating(true)} className="h-8 shrink-0 rounded-full bg-surface-2 px-3 text-xs font-medium text-accent-ink">+ Custom food</button>
        </div>
      </div>

      {added.length > 0 && (
        <Card className="mb-3 border-up/30 bg-up/8 p-3 text-sm" role="status">
          <p className="font-semibold text-up">Added {added.length} item{added.length > 1 ? "s" : ""}</p>
          <p className="num text-xs text-muted">{added.map((a) => `${a.name} (${fmtKcal(a.kcal)} kcal, ${MEAL_LABELS[a.meal]})`).join(" · ")}</p>
        </Card>
      )}
      <ErrorText>{error}</ErrorText>

      {q.trim().length < 2 ? (
        <section>
          <h2 className="mt-2 mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Recent</h2>
          {recent === null ? <p className="text-sm text-muted">Loading…</p> : recent.length === 0 ? (
            <p className="text-sm text-muted">Search for a food to get started. Foods you log will show here for quick re-logging.</p>
          ) : (
            <Card className="divide-y divide-line">
              {recent.map((f) => (
                <button key={f.id} type="button" disabled={hasNoNutrition(f.per100)} onClick={() => setSelected(f)} className="block w-full px-4 py-3 text-left hover:bg-surface-2 disabled:opacity-50" data-testid="recent-food">
                  <span className="block font-medium">{f.name}{f.brand && <span className="text-muted"> · {f.brand}</span>}</span>
                  <span className="text-xs text-muted"><Per100 item={f} /></span>
                  <RecordFacts food={f} />
                </button>
              ))}
            </Card>
          )}
        </section>
      ) : (
        <>
          {loading && <p className="py-3 text-sm text-muted" aria-live="polite">Searching…</p>}
          {data?.errors.map((e) => (
            <p key={e.source} className="mb-2 rounded-xl bg-down/10 px-3 py-2 text-xs text-down">{SECTION[e.source].note}: {e.message}</p>
          ))}
          {data && !loading && total === 0 && (
            <Card className="p-6 text-center">
              <p className="font-semibold">{data.errors.length ? "Search is partly unavailable" : "No foods found"}</p>
              <p className="mt-1 text-sm text-muted">
                {data.errors.length ? "Some food databases couldn't be searched right now. Try again shortly, or log a recent or custom food."
                  : data.barcode ? "No product matches this barcode." : "Try a simpler term, check spelling, or create a custom food."}
              </p>
              <Button variant="secondary" className="mt-3" onClick={() => setCreating(true)}>Create custom food</Button>
            </Card>
          )}
          {data && sections.map((s) => data.results[s].length > 0 && (
            <section key={s} className="mb-4">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{SECTION[s].title}</h2>
                <span className="text-[11px] text-muted">{SECTION[s].note}</span>
              </div>
              <Card className="divide-y divide-line">
                {data.results[s].map((item) => {
                  const def = item.servings[0];
                  const defN = def ? scaleNutrients(item.per100, def.amount) : null;
                  // An Open Food Facts search hit is only a preview: the full product may still have nutrition data.
                  const checkDetails = !item.hasNutrition && item.source === "OPEN_FOOD_FACTS";
                  return (
                    <button key={item.key} type="button" disabled={(!item.hasNutrition && !checkDetails) || resolving !== null} onClick={() => pick(item)}
                      className="block w-full px-4 py-3 text-left hover:bg-surface-2 disabled:opacity-50" data-testid="food-result">
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block font-medium leading-snug">{item.name}</span>
                          {item.brand && <span className="block text-xs text-muted">{item.brand}</span>}
                        </span>
                        {resolving === item.key ? <span className="text-xs text-muted">Loading…</span> :
                          checkDetails ? <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">Tap for details</span> :
                          !item.hasNutrition ? <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">No nutrition data</span> :
                          !item.complete ? <span className="shrink-0 rounded-full bg-down/10 px-2 py-0.5 text-[11px] text-down">Incomplete</span> : null}
                      </span>
                      <span className="mt-1 block text-xs text-muted"><Per100 item={item} /></span>
                      {def && def.amount !== 100 && defN && (
                        <span className="num block text-xs text-muted">{def.label}: {fmtKcal(defN.kcal)} kcal</span>
                      )}
                      {checkDetails ? <span className="mt-1 block text-[11px] text-muted" data-testid="food-source" data-source={item.source}>{recordOrigin(item).badge}</span> : <RecordFacts food={item} />}
                    </button>
                  );
                })}
              </Card>
            </section>
          ))}
        </>
      )}

      {selected && (
        <AddSheet food={selected} date={date} meal={meal} requireQuantity={Boolean(embedded)} onClose={() => setSelected(null)}
          onAdded={(name, kcal, m) => { if (embedded) { embedded.onLogged(m, selected); return; } setAdded((a) => [...a, { name, kcal, meal: m }]); setMeal(m); setSelected(null); setRecent((r) => (r && !r.some((x) => x.id === selected.id) ? [selected, ...r] : r)); }} />
      )}
      {creating && (
        <CustomFoodSheet initialName={q.trim()} onClose={() => setCreating(false)} onCreated={(f) => { setCreating(false); setSelected(f); }} />
      )}
    </div>
  );
}

function AddSheet({ food, date, meal, requireQuantity, onClose, onAdded }: {
  food: FoodDto; date: string; meal: MealType; requireQuantity: boolean; onClose: () => void; onAdded: (name: string, kcal: number | null, meal: MealType) => void;
}) {
  const def = food.servings.find((s) => s.isDefault) ?? food.servings[0];
  const [servingId, setServingId] = useState<string | null>(def?.id ?? null);
  // With requireQuantity nothing is filled in, so an amount is always the person's own.
  const [quantity, setQuantity] = useState(requireQuantity ? "" : def ? "1" : "100");
  const [mealType, setMealType] = useState<MealType>(meal);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One per opening of this sheet: retrying can't log twice, and opening it again is a new, deliberate entry.
  const [idempotencyKey] = useState(newIdempotencyKey);
  const saving = useRef(false);

  async function add() {
    if (saving.current) return; // two clicks can land before the button is disabled
    const q = parseNum(quantity);
    if (!(q > 0)) return setError("Quantity must be greater than 0.");
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ entry: { nutrients: { kcal: number | null } } }>("POST", "/api/nutrition/entries", { date, mealType, foodId: food.id, servingId, quantity: q }, { idempotencyKey, timeoutMs: SAVE_TIMEOUT_MS });
      onAdded(food.name, r.entry.nutrients.kcal, mealType);
    } catch (e) {
      setError(saveFailureMessage(e));
      saving.current = false;
      setBusy(false);
    }
  }

  const missing = missingText(food.per100);
  const sourceNote = food.source === "USDA" ? `USDA FoodData Central #${food.sourceId}` : food.source === "OPEN_FOOD_FACTS" ? `Open Food Facts · ${food.sourceId}` : "Custom food";
  return (
    <Sheet open title={food.name} locked={busy} onClose={onClose}>
      <p className="-mt-2 text-xs text-muted">{food.brand ? `${food.brand} · ` : ""}{sourceNote}{food.dataType && food.source === "USDA" ? ` · ${food.dataType}` : ""}</p>
      <p className="mb-3 mt-1 text-xs text-muted" data-testid="food-provenance">{recordOrigin(food).detail}{missing ? ` ${missing}` : ""}</p>
      <fieldset disabled={busy} className="min-w-0">
        <PortionEditor per100={food.per100} basisUnit={food.basisUnit} servings={food.servings} servingId={servingId} quantity={quantity} mealType={mealType}
          onChange={(p) => {
            if (p.servingId !== undefined) setServingId(p.servingId);
            if (p.quantity !== undefined) setQuantity(p.quantity);
            if (p.mealType) setMealType(p.mealType);
          }} />
      </fieldset>
      <div className="mt-3"><ErrorText>{error}</ErrorText></div>
      <Button size="lg" className="mt-3 w-full" onClick={add} disabled={busy || (requireQuantity && !(parseNum(quantity) > 0))}>{busy ? "Adding…" : `Add to ${MEAL_LABELS[mealType]}`}</Button>
    </Sheet>
  );
}

function CustomFoodSheet({ initialName, onClose, onCreated }: { initialName: string; onClose: () => void; onCreated: (f: FoodDto) => void }) {
  const [v, setV] = useState({ name: /^\d+$/.test(initialName) ? "" : initialName, brand: "", barcode: /^\d{6,14}$/.test(initialName) ? initialName : "", basisUnit: "G", servingLabel: "1 serving", servingAmount: "", kcal: "", protein: "", carbs: "", fat: "", fiber: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey] = useState(newIdempotencyKey);
  const saving = useRef(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((x) => ({ ...x, [k]: e.target.value }));

  async function create() {
    if (saving.current) return; // two clicks can land before the button is disabled
    setError(null);
    const n = (s: string) => parseNum(s);
    const nums = { servingAmount: n(v.servingAmount), kcal: n(v.kcal), protein: n(v.protein), carbs: n(v.carbs), fat: n(v.fat) };
    if (!v.name.trim()) return setError("Name is required.");
    if (Object.values(nums).some((x) => !Number.isFinite(x) || x < 0) || !(nums.servingAmount > 0)) return setError("Enter serving size, calories, protein, carbs and fat (0 is allowed).");
    saving.current = true;
    setBusy(true);
    try {
      const r = await api<{ food: FoodDto }>("POST", "/api/foods", {
        name: v.name.trim(), brand: v.brand.trim() || null, barcode: v.barcode.trim() || null, basisUnit: v.basisUnit,
        servingLabel: v.servingLabel.trim() || "1 serving", servingAmount: nums.servingAmount,
        perServing: { kcal: nums.kcal, protein: nums.protein, carbs: nums.carbs, fat: nums.fat, fiber: v.fiber.trim() ? n(v.fiber) : null },
      }, { idempotencyKey, timeoutMs: SAVE_TIMEOUT_MS });
      onCreated(r.food);
    } catch (e) {
      setError(saveFailureMessage(e));
      saving.current = false;
      setBusy(false);
    }
  }
  const u = v.basisUnit === "ML" ? "ml" : "g";
  return (
    <Sheet open title="Custom food" locked={busy} onClose={onClose}>
      <p className="-mt-2 mb-3 text-xs text-muted">Enter values per serving as printed on the label.</p>
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        <Field label="Name"><Input value={v.name} onChange={set("name")} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Brand" hint="Optional"><Input value={v.brand} onChange={set("brand")} /></Field>
          <Field label="Barcode" hint="Optional"><Input inputMode="numeric" value={v.barcode} onChange={set("barcode")} /></Field>
        </div>
        <div className="grid grid-cols-[2fr_1fr_1fr] gap-2">
          <Field label="Serving name"><Input value={v.servingLabel} onChange={set("servingLabel")} /></Field>
          <Field label={`Size (${u})`}><Input inputMode="decimal" value={v.servingAmount} onChange={set("servingAmount")} /></Field>
          <Field label="Unit"><Select value={v.basisUnit} onChange={set("basisUnit")}><option value="G">g</option><option value="ML">ml</option></Select></Field>
        </div>
        <div className="grid grid-cols-5 gap-2">
          <Field label="kcal"><Input inputMode="decimal" value={v.kcal} onChange={set("kcal")} /></Field>
          <Field label="Prot g"><Input inputMode="decimal" value={v.protein} onChange={set("protein")} /></Field>
          <Field label="Carb g"><Input inputMode="decimal" value={v.carbs} onChange={set("carbs")} /></Field>
          <Field label="Fat g"><Input inputMode="decimal" value={v.fat} onChange={set("fat")} /></Field>
          <Field label="Fiber g"><Input inputMode="decimal" value={v.fiber} placeholder="—" onChange={set("fiber")} /></Field>
        </div>
      </fieldset>
      <div className="mt-3"><ErrorText>{error}</ErrorText></div>
      <Button size="lg" className="mt-3 w-full" onClick={create} disabled={busy}>{busy ? "Saving…" : "Save and continue"}</Button>
    </Sheet>
  );
}
