"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { createStableReader, productCode } from "@/lib/barcode";
import { getBarcodeDetector, detectInImage } from "@/lib/client/barcode-detect";
import { hasNoNutrition, missingText, recordOrigin } from "@/lib/food-provenance";
import { fmtG, fmtKcal } from "@/lib/nutrition";
import type { FoodDto, SearchResponse } from "@/lib/server/foods/service";
import { localTestNotice, MIN_EXTERNAL_QUERY_LENGTH, searchPath } from "@/lib/food-search-view";
import { packageQuery, rankCandidates, type Candidate } from "@/lib/package-match";
import { Button, Card, ErrorText, Field, Input, Select } from "@/components/ui";

type Matches = { state: "searching" } | { state: "done"; query: string; items: Candidate[]; testNotice: string | null; errors: string[] };

type Phase =
  | { kind: "camera" }
  | { kind: "looking"; code: string }
  | { kind: "found"; code: string; food: FoodDto; fromWords?: string[] }
  | { kind: "unknown"; code: string }
  | { kind: "reading" }
  | { kind: "words"; lines: string[] }
  | { kind: "resolving"; lines: string[]; name: string }
  | { kind: "manual" };

const CAMERA_HELP: Record<string, string> = {
  NotAllowedError: "Camera access was refused. You can allow it in the browser's settings for this site, or type the barcode below.",
  NotFoundError: "No camera was found. Type the barcode below instead.",
  NotReadableError: "The camera is in use by another app. Close it, or type the barcode below.",
  OverconstrainedError: "That camera couldn't be started. Try another, or type the barcode below.",
};

/**
 * Phase 2: scan a package's barcode with the camera (or a photo, or by typing it), look it up with the app's
 * existing barcode lookup, and show what was found for the person to confirm. Frames never leave the device; only
 * the digits are sent. Nothing is logged here: a confirmed product goes to the usual amount-and-meal sheet.
 *
 * Phase 4: a photo of a package with no readable barcode is read for its words, on this app's server. Those words
 * (brand and name) are then searched once with the usual food search, Open Food Facts, USDA and the person's own foods,
 * and the closest records are offered, each with its source. Nothing is logged until the person confirms one and
 * chooses an amount. Its words never become values: a record's nutrition is the provider's, as it came. The person can
 * edit the words and search again, open the full search, scan the label, or create a food.
 */
export function BarcodeScan({ onConfirm, onCreate, onSearch, onClose }: { onConfirm: (food: FoodDto) => void; onCreate: (code: string) => void; onSearch: (query: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "camera" });
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [engine, setEngine] = useState<string | null>(null);
  const [matches, setMatches] = useState<Matches | null>(null);
  const searchId = useRef(0);

  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };

  async function lookUp(code: string) {
    stop();
    setMessage(null);
    setPhase({ kind: "looking", code });
    try {
      const { food } = await api<{ food: FoodDto }>("GET", `/api/foods/barcode/${code}`);
      setPhase({ kind: "found", code, food });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setPhase({ kind: "unknown", code });
      else { setMessage(e instanceof ApiError ? e.message : "The lookup failed. Try again."); setPhase({ kind: "manual" }); }
    }
  }

  // The camera, while scanning: the chosen one, or the back one by default.
  useEffect(() => {
    if (phase.kind !== "camera") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setMessage("This browser can't use the camera here. Type the barcode below, or choose a photo."); setPhase({ kind: "manual" }); return; }
      try {
        const detector = await getBarcodeDetector();
        setEngine(detector.native ? "this browser's barcode reader" : "the app's barcode reader");
        stream.current = await navigator.mediaDevices.getUserMedia({ video: cameraId ? { deviceId: { exact: cameraId } } : { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped) { stop(); return; }
        setCameras((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput"));
        const v = video.current!;
        v.srcObject = stream.current;
        await v.play();
        const read = createStableReader();
        const tick = async () => {
          if (stopped) return;
          try {
            if (v.readyState >= 2) {
              const found = (await detector.detect(v))[0];
              const code = read(found?.rawValue ?? null, found?.format);
              if (code) { await lookUp(code); return; }
            }
          } catch { /* a frame that can't be read is skipped */ }
          timer = setTimeout(tick, 200);
        };
        tick();
      } catch (e) {
        const name = (e as { name?: string }).name ?? "";
        setMessage(CAMERA_HELP[name] ?? "The camera couldn't be started. Type the barcode below, or choose a photo.");
        setPhase({ kind: "manual" });
      }
    })();
    return () => { stopped = true; if (timer) clearTimeout(timer); stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind, cameraId]);

  useEffect(() => () => stop(), []);

  /** One search of the approved sources, for words the person can see; a later search replaces an earlier one. */
  async function findMatches(q: string, lines: string[]) {
    const id = ++searchId.current;
    if (q.trim().length < MIN_EXTERNAL_QUERY_LENGTH) { setMatches(null); return; }
    setMatches({ state: "searching" });
    try {
      const r = await api<SearchResponse>("GET", searchPath(q, "ALL"));
      if (id === searchId.current) setMatches({ state: "done", query: q.trim(), items: rankCandidates(r, lines), testNotice: localTestNotice(r.localTestSources ?? []), errors: r.errors.map((e) => e.message) });
    } catch (e) {
      if (id === searchId.current) setMatches({ state: "done", query: q.trim(), items: [], testNotice: null, errors: [e instanceof ApiError ? e.message : "The search failed. Try again."] });
    }
  }

  /** The record behind a candidate, cached as structured food, for the person to confirm. Nothing is logged here. */
  async function choose(c: Candidate, lines: string[]) {
    setMessage(null);
    setPhase({ kind: "resolving", lines, name: c.name });
    try {
      const { food } = c.foodId && c.source === "CUSTOM"
        ? await api<{ food: FoodDto }>("GET", `/api/foods/${c.foodId}`)
        : await api<{ food: FoodDto }>("POST", "/api/foods/resolve", { source: c.source, sourceId: c.sourceId });
      setPhase({ kind: "found", code: "", food, fromWords: lines });
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "That record couldn't be loaded. Choose another, or search by name.");
      setPhase({ kind: "words", lines });
    }
  }

  async function fromPhoto(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    try {
      const found = (await detectInImage(file).catch(() => [])).map((d) => productCode(d.rawValue, d.format)).find(Boolean);
      if (found) { await lookUp(found); return; }
      // No barcode: the package's words, read on this app's server, for the person to choose a search from.
      stop();
      setPhase({ kind: "reading" });
      const res = await fetch("/api/foods/photo-text", { method: "POST", headers: { "Content-Type": file.type || "image/jpeg" }, body: file, credentials: "same-origin" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(body.error ?? "The photo couldn't be read. Search by name instead."); setPhase({ kind: "manual" }); return; }
      const lines: string[] = Array.isArray(body.lines) ? body.lines : [];
      const first = packageQuery(lines);
      setQuery(first);
      setPhase({ kind: "words", lines });
      if (lines.length) await findMatches(first, lines);
    } catch {
      setMessage("That photo couldn't be read. Try another, or type the barcode.");
      setPhase({ kind: "manual" });
    }
  }

  function submitTyped(e: React.FormEvent) {
    e.preventDefault();
    const code = productCode(typed);
    if (!code) { setMessage("That isn't a valid product barcode. Check the digits under the bars (8, 12, 13 or 14 of them)."); return; }
    lookUp(code);
  }

  return (
    <div className="space-y-4" data-testid="barcode-scan">
      {phase.kind === "camera" && (
        <>
          <div className="relative overflow-hidden rounded-2xl bg-black">
            <video ref={video} playsInline muted className="aspect-[4/3] w-full object-cover" data-testid="barcode-video" />
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-white/80" />
          </div>
          <p className="text-sm text-muted">Hold the barcode inside the box. It&apos;s read on this device{engine ? `, by ${engine}` : ""}; the picture isn&apos;t sent or kept.</p>
          {cameras.length > 1 && (
            <Field label="Camera">
              <Select value={cameraId} onChange={(e) => setCameraId(e.target.value)} data-testid="barcode-camera">
                <option value="">Default (back camera)</option>
                {cameras.map((c, i) => <option key={c.deviceId} value={c.deviceId}>{c.label || `Camera ${i + 1}`}</option>)}
              </Select>
            </Field>
          )}
        </>
      )}

      {phase.kind === "looking" && <p role="status" data-testid="barcode-looking">Looking up {phase.code}…</p>}

      {phase.kind === "found" && (
        <Card className="space-y-2 p-4" data-testid="barcode-found">
          <p className="text-sm text-muted" data-testid="found-how">{phase.fromWords ? "Is this your product? Matched by the words on your photo: check it against the package." : `Is this your product? Barcode ${phase.code}`}</p>
          <p className="text-lg font-semibold">{phase.food.name}</p>
          {phase.food.brand && <p className="text-sm">{phase.food.brand}</p>}
          <p className="text-[11px] text-muted" data-testid="barcode-source">{recordOrigin(phase.food).badge}</p>
          <p className="num text-sm">per 100 {phase.food.basisUnit === "ML" ? "ml" : "g"}: {fmtKcal(phase.food.per100.kcal)} kcal · P {fmtG(phase.food.per100.protein)} · C {fmtG(phase.food.per100.carbs)} · F {fmtG(phase.food.per100.fat)}</p>
          {missingText(phase.food.per100) && <p className="text-[11px] text-down">{missingText(phase.food.per100)}</p>}
          {hasNoNutrition(phase.food.per100)
            ? <p className="text-sm text-down" data-testid="barcode-no-nutrition">This record has no nutrition values, so it can&apos;t be logged. You can create your own food with this barcode.</p>
            : <Button onClick={() => onConfirm(phase.food)} data-testid="barcode-confirm">Yes, choose an amount</Button>}
          <div className="flex flex-wrap gap-2">
            {phase.fromWords
              ? <Button variant="secondary" size="sm" onClick={() => setPhase({ kind: "words", lines: phase.fromWords! })} data-testid="found-back">No, show the other matches</Button>
              : <Button variant="secondary" size="sm" onClick={() => setPhase({ kind: "camera" })}>No, scan again</Button>}
            <Button variant="ghost" size="sm" onClick={() => onCreate(phase.code)}>Create my own food</Button>
          </div>
        </Card>
      )}

      {phase.kind === "unknown" && (
        <Card className="space-y-2 p-4" data-testid="barcode-unknown">
          <p className="font-semibold">No product with barcode {phase.code} was found.</p>
          <p className="text-sm text-muted">Nothing has been guessed. You can create your own food with this barcode, from the label, or search by name.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onCreate(phase.code)} data-testid="barcode-create">Create my own food</Button>
            <Button variant="secondary" size="sm" onClick={() => setPhase({ kind: "camera" })}>Scan again</Button>
          </div>
        </Card>
      )}

      {phase.kind === "reading" && <p role="status" data-testid="package-reading">Reading the words on the package…</p>}
      {phase.kind === "resolving" && <p role="status" data-testid="package-resolving">Loading {phase.name}…</p>}

      {phase.kind === "words" && (
        <Card className="space-y-3 p-4" data-testid="package-words">
          {phase.lines.length === 0 ? (
            <p className="text-sm">No barcode and no clear words could be read from that photo. Search by name, scan the nutrition label, or create your own food.</p>
          ) : (
            <>
              <p className="text-sm text-muted">No barcode was found. These words were read from the package. They were searched for below; tap others to change the search.</p>
              <div className="flex flex-wrap gap-1.5">
                {phase.lines.map((l) => (
                  <button key={l} type="button" className="rounded-full bg-surface-2 px-3 py-1 text-sm" data-testid="package-word"
                    onClick={() => setQuery((q) => (q.toLowerCase().includes(l.toLowerCase()) ? q : `${q} ${l}`.trim()).slice(0, 60))}>{l}</button>
                ))}
              </div>
            </>
          )}
          <Field label="Search for">
            <Input value={query} maxLength={60} onChange={(e) => setQuery(e.target.value)} data-testid="package-query" />
          </Field>
          {matches?.state === "searching" && <p role="status" className="text-sm" data-testid="package-searching">Searching for matching products…</p>}
          {matches?.state === "done" && (
            <div className="space-y-1.5" data-testid="package-matches">
              {matches.testNotice && <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs" data-testid="package-test-notice">{matches.testNotice}</p>}
              {matches.errors.map((e) => <p key={e} className="text-xs text-down">{e}</p>)}
              {matches.items.length === 0
                ? <p className="text-sm" data-testid="package-no-match">No product matched “{matches.query}”. Change the words, scan the nutrition label, or create your own food.</p>
                : <p className="text-sm font-medium">Possible matches for “{matches.query}”. Choose yours to check it:</p>}
              <ul className="space-y-1.5">
                {matches.items.map((c) => (
                  <li key={c.key}>
                    <button type="button" disabled={!c.hasNutrition} onClick={() => choose(c, phase.lines)} data-testid="package-candidate" data-source={c.source}
                      className="w-full rounded-xl border border-line px-3 py-2 text-left disabled:opacity-60">
                      <span className="block font-medium">{c.name}</span>
                      {c.brand && <span className="block text-xs">{c.brand}</span>}
                      <span className="block text-[11px] text-muted">{recordOrigin(c).badge}{c.hasNutrition ? "" : " · no nutrition data, so it can't be logged"}</span>
                      {c.hasNutrition && <span className="num block text-xs text-muted">per 100 {c.basisUnit === "ML" ? "ml" : "g"}: {fmtKcal(c.per100.kcal)} kcal · P {fmtG(c.per100.protein)} · C {fmtG(c.per100.carbs)} · F {fmtG(c.per100.fat)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={query.trim().length < MIN_EXTERNAL_QUERY_LENGTH || matches?.state === "searching"} onClick={() => findMatches(query, phase.lines)} data-testid="package-search">Search</Button>
            <Button variant="secondary" size="sm" disabled={query.trim().length < 2} onClick={() => onSearch(query.trim())} data-testid="package-full-search">Open in food search</Button>
            <a className="inline-flex h-8 items-center rounded-lg bg-surface-2 px-3 text-sm font-medium" href="/nutrition/scan" data-testid="package-label-scan">Scan the nutrition label</a>
            <Button variant="ghost" size="sm" onClick={() => onCreate("")} data-testid="package-create">Create my own food</Button>
          </div>
          <p className="text-xs text-muted">The photo was read and released; it isn&apos;t kept. Results come from USDA and Open Food Facts, each with its source.</p>
        </Card>
      )}

      <ErrorText>{message}</ErrorText>

      {(phase.kind === "camera" || phase.kind === "manual") && (
        <form onSubmit={submitTyped} className="space-y-2">
          <Field label="Or type the barcode">
            <Input inputMode="numeric" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="e.g. 3017620425035" data-testid="barcode-typed" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" data-testid="barcode-lookup">Look up</Button>
            <label className="inline-flex h-8 cursor-pointer items-center rounded-lg bg-surface-2 px-3 text-sm font-medium">
              Choose a photo of the package
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => { fromPhoto(e.target.files?.[0]); e.target.value = ""; }} data-testid="barcode-photo" />
            </label>
            {phase.kind === "manual" && <Button variant="secondary" size="sm" onClick={() => { setMessage(null); setPhase({ kind: "camera" }); }}>Try the camera again</Button>}
          </div>
        </form>
      )}
      <Button variant="ghost" size="sm" onClick={() => { stop(); onClose(); }}>Close</Button>
    </div>
  );
}
