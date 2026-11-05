"use client";

import { useEffect, useRef, useState } from "react";
import { FULL_CROP, sniffFileKind } from "@/lib/label-image";
import type { MealIdentification } from "@/lib/meal-identification";
import { MEAL_LABELS, MEAL_TYPES, type MealType } from "@/lib/nutrition";
import { acceptItem, addItem, buildMealReview, canFindFood, describeSuggestion, isCorrected, markLogged, markUnknown, removeItem, renameItem, searchQueryFor, STATUS_LABELS, type ReviewItem } from "@/lib/meal-review";
import { Button, Card, cx, ErrorText, Field, Input, Select } from "@/components/ui";
import { FoodSearch } from "./food-search";
import { LabelImage } from "./label-review";
import { HEIC_HELP, OPEN_FAILED, PREPARE_FAILED, prepare, type Opened, type Prepared } from "./label-scanner";

interface IdentifyResponse { notice: string; identification: MealIdentification }
type Stage = "pick" | "check" | "identifying" | "review";

function ItemCard({ item, selected, loggedTo, onRename, onAccept, onRemove, onUnknown, onFind }: {
  item: ReviewItem;
  selected: boolean;
  loggedTo?: MealType;
  onRename: (name: string) => void;
  onAccept: () => void;
  onRemove: () => void;
  onUnknown: () => void;
  onFind: () => void;
}) {
  const logged = item.status === "logged";
  return (
    <Card className={cx("space-y-2 p-4", selected && "border-fg")} data-testid="meal-item" data-status={item.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium" data-testid="meal-suggestion">{describeSuggestion(item)}</p>
        <span className="whitespace-nowrap rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted" data-testid="meal-status">{STATUS_LABELS[item.status]}{isCorrected(item) ? ", corrected" : ""}</span>
      </div>
      {item.observation && <p className="text-xs text-muted">What the AI could see: {item.observation}</p>}
      {item.preparation && <p className="text-xs text-muted">Possibly prepared: {item.preparation}</p>}
      {item.possibleIngredients.length > 0 && <p className="text-xs text-muted">Possible ingredients: {item.possibleIngredients.join(", ")}</p>}
      <Field label="Food name">
        <Input data-testid="meal-name" value={item.name} maxLength={100} disabled={logged} placeholder="What is this food?" onChange={(e) => onRename(e.target.value)} />
      </Field>
      {!logged && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={item.status === "accepted" ? "secondary" : "primary"} data-testid="meal-accept" disabled={item.name.trim() === "" || item.status === "accepted"} onClick={onAccept}>{item.status === "accepted" ? "Accepted" : "Accept this name"}</Button>
          {canFindFood(item) && <Button size="sm" data-testid="meal-find" onClick={onFind}>Find this food</Button>}
          <Button size="sm" variant="secondary" data-testid="meal-unknown" disabled={item.status === "unknown"} onClick={onUnknown}>Mark as unknown</Button>
          <Button size="sm" variant="secondary" data-testid="meal-remove" onClick={onRemove}>Remove</Button>
        </div>
      )}
      {logged && <p className="text-sm" role="status">Added to {loggedTo ? MEAL_LABELS[loggedTo] : "your diary"}, with the amount you entered.</p>}
    </Card>
  );
}

export function MealPhoto({ today }: { today: string }) {
  const [stage, setStage] = useState<Stage>("pick");
  const [opened, setOpened] = useState<Opened | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [notice, setNotice] = useState("");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [finding, setFinding] = useState<string | null>(null);
  // No default: a photo says nothing about which meal it was. Starts empty, then holds the person's last choice.
  const [meal, setMeal] = useState<MealType | null>(null);
  const [loggedTo, setLoggedTo] = useState<Record<string, MealType>>({});
  const [error, setError] = useState<string | null>(null);
  const urls = useRef(new Set<string>());
  const track = (url: string) => { urls.current.add(url); return url; };
  const cameraInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const all = urls.current;
    return () => { for (const url of all) URL.revokeObjectURL(url); };
  }, []);

  const reset = () => {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
    setOpened(null);
    setPrepared(null);
    setItems([]);
    setFinding(null);
    setMeal(null);
    setLoggedTo({});
    setError(null);
    setStage("pick");
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    reset();
    const kind = sniffFileKind(new Uint8Array(await file.slice(0, 32).arrayBuffer()));
    if (kind === "unknown" || kind === "pdf") {
      setError(OPEN_FAILED);
      return;
    }
    const url = track(URL.createObjectURL(file));
    const image = new Image();
    image.onerror = () => setError(kind === "heic" ? HEIC_HELP : OPEN_FAILED);
    image.onload = async () => {
      const next: Opened = { file, url, kind, image, width: image.naturalWidth, height: image.naturalHeight };
      try {
        const result = await prepare(next, FULL_CROP);
        if ("error" in result) {
          setError(result.error);
          return;
        }
        track(result.url);
        setOpened(next);
        setPrepared(result);
        setStage("check");
      } catch {
        setError(PREPARE_FAILED);
      }
    };
    image.src = url;
  };

  /** One request, only when asked. Nothing is sent or saved by choosing a photo. */
  const identify = async () => {
    if (!prepared) return;
    setError(null);
    setStage("identifying");
    try {
      const response = await fetch("/api/nutrition/meal-identifications", { method: "POST", headers: { "Content-Type": prepared.blob.type }, body: prepared.blob });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "The photo couldn't be read. Try again later.");
        setStage("check");
        return;
      }
      const { notice: text, identification } = body as IdentifyResponse;
      setNotice(text);
      setItems(buildMealReview(identification));
      setStage("review");
    } catch {
      setError("The photo couldn't be read. Check your connection and try again.");
      setStage("check");
    }
  };

  // On a slow connection a photo can be chosen before this page becomes interactive, which would otherwise be lost.
  useEffect(() => {
    for (const input of [cameraInput.current, photoInput.current]) {
      const early = input?.files?.[0];
      if (input && early) {
        input.value = "";
        void pick(early);
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only for a file chosen before the first render
  }, []);

  const findingItem = items.find((item) => item.id === finding);
  const query = findingItem ? searchQueryFor(findingItem) : null;

  return (
    <div className="space-y-4">
      {stage === "pick" && (
        <Card className="space-y-3 p-4">
          <p className="text-sm text-muted">The AI suggests what foods it can see. It never estimates amounts or nutrition: you choose each food and type how much.</p>
          <div>
            <label className="block text-sm font-medium" htmlFor="meal-camera">Take a photo</label>
            <input ref={cameraInput} id="meal-camera" className="mt-1" type="file" accept="image/*" capture="environment" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
          <div>
            <label className="block text-sm font-medium" htmlFor="meal-photo">Choose a photo</label>
            <input ref={photoInput} id="meal-photo" className="mt-1" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
        </Card>
      )}

      {(stage === "check" || stage === "identifying") && prepared && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- the user's own file, held only in this browser */}
          <img data-testid="meal-preview" src={prepared.url} alt="Your meal" className="block w-full rounded-lg" />
          <p className="text-sm text-muted">Identifying sends this photo to our AI provider, after removing location and other hidden data. Your name and email aren&apos;t sent, and the photo isn&apos;t kept.</p>
          <div className="flex flex-wrap gap-2">
            <Button data-testid="meal-identify" disabled={stage === "identifying"} onClick={() => void identify()}>{stage === "identifying" ? "Looking at the photo…" : "Identify foods"}</Button>
            <Button variant="secondary" disabled={stage === "identifying"} onClick={reset}>Choose another photo</Button>
          </div>
        </>
      )}

      {stage === "review" && prepared && opened && (
        <div className="grid gap-4 md:relative md:left-1/2 md:w-[min(calc(100vw-2rem),64rem)] md:-translate-x-1/2 md:grid-cols-2 md:items-start">
          <LabelImage preparedUrl={prepared.url} originalUrl={null} />
          <div className="min-w-0 space-y-4" data-testid="meal-review">
            <Card className="border-amber-500/60 p-4">
              <p className="font-medium text-amber-700 dark:text-amber-400" role="status">{notice}</p>
              <p className="mt-1 text-sm text-muted">Nothing has been saved or logged. Accept or correct each name, then choose the actual food and type how much you had.</p>
            </Card>
            {items.length === 0 && <Card className="p-4 text-sm" data-testid="meal-none">No foods could be identified. Add them yourself below.</Card>}
            {items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                selected={finding === item.id}
                loggedTo={loggedTo[item.id]}
                onRename={(name) => { setItems((all) => renameItem(all, item.id, name)); if (finding === item.id) setFinding(null); }}
                onAccept={() => setItems((all) => acceptItem(all, item.id))}
                onRemove={() => { setItems((all) => removeItem(all, item.id)); if (finding === item.id) setFinding(null); }}
                onUnknown={() => { setItems((all) => markUnknown(all, item.id)); if (finding === item.id) setFinding(null); }}
                onFind={() => setFinding(item.id)}
              />
            ))}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" data-testid="meal-add" onClick={() => setItems((all) => addItem(all))}>Add a food the AI missed</Button>
              <Button variant="secondary" onClick={reset}>Start over</Button>
            </div>
            {query && findingItem && (
              <Card className="p-4" data-testid="meal-food-search">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="font-medium">Choose the food for &ldquo;{findingItem.name}&rdquo;</h3>
                  <Button size="sm" variant="ghost" onClick={() => setFinding(null)}>Close</Button>
                </div>
                <Field label="Which meal is this food for?">
                  <Select data-testid="meal-type" value={meal ?? ""} onChange={(e) => setMeal(e.target.value as MealType)}>
                    {!meal && <option value="" disabled>Choose a meal</option>}
                    {MEAL_TYPES.map((m) => <option key={m} value={m}>{MEAL_LABELS[m]}</option>)}
                  </Select>
                </Field>
                {meal && (
                  <div className="mt-3">
                    <FoodSearch
                      key={`${findingItem.id}:${query}:${meal}`}
                      date={today}
                      today={today}
                      initialMeal={meal}
                      embedded={{ initialQuery: query, onLogged: (chosen) => { setItems((all) => markLogged(all, findingItem.id)); setLoggedTo((all) => ({ ...all, [findingItem.id]: chosen })); setMeal(chosen); setFinding(null); } }}
                    />
                  </div>
                )}
              </Card>
            )}
          </div>
        </div>
      )}

      <ErrorText>{error}</ErrorText>
    </div>
  );
}
