// LIVE provider verification for Phase 2 (USDA FoodData Central + Open Food Facts).
//
// Drives a RUNNING local instance of this app through its own HTTP API, so every
// provider call made on the app's behalf goes through the existing server-side clients
// (no separate integration, no mocks, no stubs).
//
// Usage, with the app running against a dedicated, MARKED test database (see README):
//   node --env-file=.env.test scripts/live-provider-check.cjs
// .env.test must hold the same DATABASE_URL the server uses (the test database), and
// FDC_API_KEY (used only to confirm no response contains it).
// Env options: BASE_URL (default http://localhost:3000); REPORT_FILE (default
// live-provider-report.json, git-ignored); LIVE_CHECK_ALLOW_DATABASE (see guard 2);
// LIVE_CHECK_REQUEST_TIMEOUT_MS (default 60000); LIVE_CHECK_CLEANUP_GRACE_MS (default 15000);
// LIVE_CHECK_USDA_ORACLE=off (skip the independent USDA check; USDA-6 then reports NOT RUN).
//
// SAFETY GUARDS (the script refuses to run, exit code 4, BEFORE any write anywhere):
//   1. BASE_URL must be localhost / 127.0.0.1 / [::1]. It never targets a deployed app.
//   2. The database name in DATABASE_URL must contain "test" (e.g. fitdb_test), unless
//      LIVE_CHECK_ALLOW_DATABASE is set to exactly that database name. Guard 4 still applies.
//   3. The RUNNING SERVER's actual database must be that same database. The script reads an
//      opaque fingerprint from the server (GET /api/health/db-identity: hash of database name,
//      OID and cluster start time) and compares it with the fingerprint of its own
//      DATABASE_URL (read-only query). Unreachable, disabled, erroring or differing → refuse.
//      The endpoint is on under `npm run dev`; for `npm start` set EXPOSE_DB_IDENTITY=1.
//   4. That database must carry the explicit TEST-DATABASE MARKER, as reported by the running
//      server through the same endpoint: the PostgreSQL comment on the database must be exactly
//      `fitworkoutfoodtracker:test-database:v1:<database name>`. It's created only deliberately
//      with scripts/mark-test-database.cjs. Missing or invalid → refuse.
//
// CLEANUP: the throwaway users this run creates (live-check-<n>-<run>@example.test) are
// deleted after success, failures, crashes and termination signals (SIGINT, SIGTERM, SIGHUP,
// and SIGBREAK on Windows). Their entries, targets, sessions and custom foods are removed by
// ON DELETE CASCADE. In-flight requests are awaited (or aborted on interrupt) before deletion.
// If any request was aborted or timed out, its write may still land on the server, so a
// second sweep runs after LIVE_CHECK_CLEANUP_GRACE_MS. Cached provider foods are kept (shared
// cache of real provider data, not test records).
//
// LIVE EVIDENCE (fail-closed, see scripts/lib/live-verdict.cjs): "LIVE VERIFICATION: PASSED"
// requires, for BOTH providers, the server-recorded origin host (Food.origin) to be the real
// provider host and a successful search with a realistic result count. It also needs no stub
// overrides, 0 FAIL and 0 NOT RUN. A contradiction → NOT LIVE (exit 3); missing evidence or
// any failure → INCOMPLETE OR FAILED (exit 1).
//
// USDA-6 (missing nutrients stay null) compares the app's normalized values for real USDA
// foods with an INDEPENDENT raw USDA response, fetched with USDA's public DEMO_KEY (never your
// key). If no food with a genuinely absent nutrient is found, or the oracle is unavailable,
// USDA-6 reports NOT RUN.
//
// SECRETS: FDC_API_KEY and the DATABASE_URL password are redacted from every line this script
// prints and from the report. The key is read only to confirm no API response contains it.
//
// Exit codes: 0 PASSED · 1 INCOMPLETE OR FAILED · 3 NOT LIVE · 4 refused (nothing written) ·
// 2 cleanup incomplete (manual cleanup needed) · 130 interrupted (after cleanup).
"use strict";
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { redact, urlSecrets, TEST_DB_MARKER_PREFIX } = require("./lib/test-db-guard.cjs");
const { decideVerdict, decideProt1, REAL_HOSTS } = require("./lib/live-verdict.cjs");
const { compareWithApp } = require("./lib/usda-nutrient-oracle.cjs");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const REPORT = process.env.REPORT_FILE || "live-provider-report.json";
const KEY = process.env.FDC_API_KEY || "";
const REQUEST_TIMEOUT_MS = Number(process.env.LIVE_CHECK_REQUEST_TIMEOUT_MS || 60_000);
const CLEANUP_GRACE_MS = Number(process.env.LIVE_CHECK_CLEANUP_GRACE_MS || 15_000);
const ORACLE_BASE = (process.env.LIVE_CHECK_USDA_ORACLE_URL || "https://api.nal.usda.gov/fdc/v1").replace(/\/$/, "");
const ORACLE_DISABLED = process.env.LIVE_CHECK_USDA_ORACLE === "off";
const SECRETS = [KEY, ...urlSecrets(process.env.DATABASE_URL)].filter(Boolean);
const run = Date.now();
const results = [];
const bodies = []; // every response body, scanned for the key at the end
const createdEmails = [];
let registered = 0; // sign-ups the server confirmed (HTTP 200)
const evidence = { USDA: { origin: "unknown", count: null }, OPEN_FOOD_FACTS: { origin: "unknown", count: null } };
const envOverrides = ["FDC_BASE_URL", "OFF_BASE_URL"].filter((v) => process.env[v]);
let prisma = null;
let interrupted = false;
let abortedRequests = 0;
const inflight = new Map(); // promise → AbortController, for requests not yet settled

/** All output goes through these, so secrets are redacted everywhere. */
const out = (msg) => console.log(redact(msg, SECRETS));
const err = (msg) => console.error(redact(msg, SECRETS));

// ─── Safety guards 1 and 2 (before anything else) ────────────────────────────
function refuse(msg) {
  err(`REFUSED (nothing was written): ${msg}`);
  process.exit(4);
}
let baseUrl;
try { baseUrl = new URL(BASE); } catch { refuse(`BASE_URL is not a valid URL`); }
if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(baseUrl.hostname)) {
  refuse(`BASE_URL host "${baseUrl.hostname}" is not local. This script only runs against a local app.`);
}
if (!process.env.DATABASE_URL) refuse("DATABASE_URL is not set (run with --env-file=.env.test, the same database the server uses).");
let dbName, dbHost;
try {
  const u = new URL(process.env.DATABASE_URL);
  dbName = decodeURIComponent(u.pathname.replace(/^\//, ""));
  dbHost = u.hostname;
} catch { refuse("DATABASE_URL can't be parsed."); }
if (!/test/i.test(dbName) && process.env.LIVE_CHECK_ALLOW_DATABASE !== dbName) {
  refuse(`database "${dbName}" doesn't look like a test database. Point the server and this script at a dedicated, marked ` +
    `test database (e.g. fitdb_test), or set LIVE_CHECK_ALLOW_DATABASE=${dbName} (the test-database marker is still required).`);
}
const ORIGIN = baseUrl.origin;

// Must match src/lib/server/db-identity.ts exactly (SQL, hash format, marker format).
const DB_IDENTITY_SQL =
  "SELECT current_database() || '|' || (SELECT oid::text FROM pg_database WHERE datname = current_database()) || '|' || extract(epoch from pg_postmaster_start_time())::text AS identity, " +
  "shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database') AS marker";
const fingerprintOf = (identity) => createHash("sha256").update(`fwft-db-identity-v1|${identity}`).digest("hex");
const getPrisma = () => (prisma = prisma || new (require("@prisma/client").PrismaClient)());

/**
 * Guards 3 and 4: prove the running server uses this script's database, and that the
 * server reports that database's explicit test marker. Read-only query here, read-only
 * GET there. Refuses (exit 4) unless both are verified.
 */
async function verifyServerDatabase() {
  let mine;
  try {
    const rows = await getPrisma().$queryRawUnsafe(DB_IDENTITY_SQL);
    mine = fingerprintOf(rows[0].identity);
  } catch (e) {
    refuse(`can't read the identity of the script's database "${dbName}" (${e.message}).`);
  }
  let res, body;
  try {
    res = await fetch(`${BASE}/api/health/db-identity`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    body = await res.json().catch(() => null);
  } catch (e) {
    refuse(`can't reach ${BASE}/api/health/db-identity to verify the server's database (${e.message}). Is the app running?`);
  }
  if (res.status === 404) {
    refuse("the server doesn't expose /api/health/db-identity, so its database can't be verified. Run it with `npm run dev`, " +
      "or for a production build start it with EXPOSE_DB_IDENTITY=1.");
  }
  if (!res.ok || !body || typeof body.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(body.fingerprint)) {
    refuse(`the server couldn't report its database identity (HTTP ${res.status}).`);
  }
  if (body.fingerprint !== mine) {
    refuse(`the server's database does not match this script's database "${dbName}" on ${dbHost}. ` +
      "Start the server with the same test DATABASE_URL as this script.");
  }
  const marker = body.testMarker;
  if (marker === null || marker === undefined || marker === "") {
    refuse(`the server's database "${dbName}" has no test-database marker. Mark a dedicated test database deliberately: ` +
      `node --env-file=.env.test scripts/mark-test-database.cjs --confirm ${dbName}`);
  }
  if (typeof marker !== "string" || marker !== TEST_DB_MARKER_PREFIX + dbName) {
    refuse(`the server's database "${dbName}" has an invalid test-database marker (expected the marker for "${dbName}"). ` +
      "Re-mark it with scripts/mark-test-database.cjs only if it really is a dedicated test database.");
  }
  out(`Verified before any write: the server uses this script's database ("${dbName}"), and it carries a valid test-database marker.`);
}

// ─── Cleanup (always runs) ───────────────────────────────────────────────────
// One shared promise: the signal handler and the normal `finally` path both await the
// same cleanup, so neither can exit while the other's deletion is still running.
let cleanupPromise = null;
const cleanup = () => (cleanupPromise ??= doCleanup());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sweep(db) {
  const users = await db.user.findMany({ where: { email: { in: createdEmails } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const del = await db.user.deleteMany({ where: { id: { in: ids } } }); // cascades entries/targets/sessions/custom foods
  return { deleted: del.count, ids };
}

async function doCleanup() {
  if (!createdEmails.length) return;
  // On interrupt, abort requests still running so cleanup can't hang on a stuck server.
  // Counted here, at the moment of abort, so the second sweep below can't be skipped by timing.
  if (interrupted) for (const c of inflight.values()) { abortedRequests++; c.abort(new Error("interrupted")); }
  // A request already sent still completes on the server, so let every in-flight request settle.
  await Promise.allSettled([...inflight.keys()]);
  try {
    const db = getPrisma();
    const first = await sweep(db);
    let deleted = first.deleted;
    const allIds = new Set(first.ids);
    if (abortedRequests > 0) {
      // An aborted request may still be processed by the server after we stopped waiting.
      out(`Cleanup: ${abortedRequests} request(s) were aborted; waiting ${CLEANUP_GRACE_MS} ms for late writes, then sweeping again…`);
      await sleep(CLEANUP_GRACE_MS);
      const second = await sweep(db);
      deleted += second.deleted;
      second.ids.forEach((id) => allIds.add(id));
      if (second.deleted) out(`Cleanup: the second sweep removed ${second.deleted} late-created test user(s).`);
    }
    const ids = [...allIds];
    const leftUsers = await db.user.count({ where: { email: { in: createdEmails } } });
    const leftEntries = await db.foodEntry.count({ where: { userId: { in: ids } } });
    const leftFoods = await db.food.count({ where: { userId: { in: ids } } });
    const leftTargets = await db.nutritionTarget.count({ where: { userId: { in: ids } } });
    out(`Cleanup: removed ${deleted} test user(s); remaining → users ${leftUsers}, entries ${leftEntries}, custom foods ${leftFoods}, targets ${leftTargets}.`);
    if (leftUsers + leftEntries + leftFoods + leftTargets > 0) process.exitCode = 2;
    // Defense in depth (guard 3 should make this unreachable): fewer rows found than the
    // server confirmed would mean the server wrote to a different database.
    if (deleted < registered) {
      err(`Cleanup MISMATCH: the server confirmed ${registered} sign-up(s) but only ${deleted} were found in "${dbName}". ` +
        `Remove users matching live-check-*-${run}@example.test on the server's database manually.`);
      process.exitCode = 2;
    }
  } catch (e) {
    err(`Cleanup FAILED (${e.message}). Remove users matching live-check-*-${run}@example.test manually.`);
    process.exitCode = 2;
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => {});
  }
}
// SIGBREAK is Ctrl+Break / console close on Windows; SIGHUP is terminal close.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  try {
    process.on(sig, async () => {
      interrupted = true; // no new requests from here on
      err(`\nInterrupted (${sig}); stopping requests, then cleaning up…`);
      await cleanup();
      process.exit(process.exitCode === 2 ? 2 : 130); // 2 = cleanup incomplete
    });
  } catch { /* signal not supported on this platform */ }
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────
function client() {
  let cookie = "";
  const call = async (method, path, body) => {
    if (interrupted) throw new Error("interrupted");
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      abortedRequests++; // counted at abort time (see doCleanup)
      controller.abort(new Error(`request timed out after ${REQUEST_TIMEOUT_MS} ms`));
    }, REQUEST_TIMEOUT_MS);
    const req = fetch(BASE + path, {
      method, body: body !== undefined ? JSON.stringify(body) : undefined, signal: controller.signal,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
    });
    inflight.set(req, controller);
    let res, text;
    try {
      res = await req;
      text = await res.text();
    } catch (e) {
      if (controller.signal.aborted) {
        throw new Error(`${method} ${path}: ${controller.signal.reason?.message || "aborted"}`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
      inflight.delete(req);
    }
    const set = res.headers.get("set-cookie");
    if (set && set.startsWith("fit_session=")) cookie = set.split(";")[0];
    bodies.push(text);
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, body: json, ms: Date.now() - t0 };
  };
  return { get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), put: (p, b) => call("PUT", p, b), patch: (p, b) => call("PATCH", p, b), del: (p) => call("DELETE", p) };
}

async function check(id, area, description, fn) {
  if (interrupted) throw new Error("interrupted"); // abort the run; don't record further checks
  try {
    const detail = await fn();
    results.push({ id, area, description, status: "PASS", detail: redact(detail ?? "", SECRETS) });
    out(`PASS     ${id}  ${description}${detail ? `  — ${detail}` : ""}`);
  } catch (e) {
    if (interrupted) throw e;
    const status = e && e.skip ? "NOT RUN" : "FAIL";
    const msg = redact(String(e && e.message ? e.message : e), SECRETS);
    results.push({ id, area, description, status, detail: msg });
    out(`${status.padEnd(8)} ${id}  ${description}  — ${msg}`);
  }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const skip = (msg) => Object.assign(new Error(msg), { skip: true });
const fmt = (n) => (n == null ? "null" : Math.round(n * 10) / 10);
const per100 = (f) => `kcal ${fmt(f.per100.kcal)}, P ${fmt(f.per100.protein)}, C ${fmt(f.per100.carbs)}, F ${fmt(f.per100.fat)}`;
const plausible = (n) => n.kcal == null || (n.kcal >= 0 && n.kcal <= 950);
/** Energy vs Atwater 4/4/9 from macros: a sanity check, not an exact identity. */
function atwaterGap(n) {
  if ([n.kcal, n.protein, n.carbs, n.fat].some((v) => v == null)) return null;
  const est = 4 * n.protein + 4 * n.carbs + 9 * n.fat;
  return { est: Math.round(est), diff: Math.round(n.kcal - est) };
}
/** Read the server-recorded origin of a cached provider food (live evidence). */
async function recordOrigin(source, sourceId) {
  const row = await getPrisma().food.findUnique({ where: { source_sourceId: { source, sourceId } }, select: { origin: true } });
  const host = row ? row.origin : "(not found in this database)";
  evidence[source] = { ...evidence[source], origin: host === REAL_HOSTS[source] ? "real" : "other", originHost: host };
}

const profile = { name: "Live check", birthDate: "1990-01-01", sex: "MALE", heightCm: 180, currentWeightKg: 80, goalWeightKg: null,
  goal: "MAINTENANCE", activityLevel: "MODERATE", experience: "BEGINNER", workoutDaysPerWeek: 3, unitSystem: "METRIC", timezone: "UTC", calorieTargetOverride: null };

async function main() {
  out(`Live provider check → app ${BASE}, database "${dbName}" on ${dbHost}. FDC_API_KEY ${KEY ? "present in this shell" : "NOT present in this shell"}.`);
  await verifyServerDatabase(); // refuses (exit 4) unless verified; must stay before the first write

  const A = client(), B = client(), L = client();
  for (const [c, n] of [[A, "a"], [B, "b"], [L, "l"]]) {
    const email = `live-check-${n}-${run}@example.test`;
    createdEmails.push(email); // recorded before creation so cleanup also covers half-created state
    const r = await c.post("/api/auth/register", { email, password: "live check password 123" });
    if (r.status !== 200) throw new Error(`cannot register test user (HTTP ${r.status}). Is the app running at ${BASE}?`);
    registered++;
    const p = await c.put("/api/profile", profile);
    if (p.status !== 200) throw new Error(`cannot create the test user's profile (HTTP ${p.status})`);
  }
  const ctx = {};

  // ─── USDA FoodData Central ────────────────────────────────────────────────
  for (const [id, q] of [["USDA-1", "banana"], ["USDA-2", "chicken breast"], ["USDA-3", "white rice"]]) {
    await check(id, "USDA", `search "${q}" returns normalised results`, async () => {
      const r = await A.get(`/api/foods/search?q=${encodeURIComponent(q)}&sources=USDA`);
      must(r.status === 200, `HTTP ${r.status}`);
      const e = r.body.errors.find((x) => x.source === "USDA");
      must(!e, `provider error: ${e && `${e.kind} — ${e.message}`}`);
      const list = r.body.results.USDA;
      if (q === "banana") evidence.USDA.count = list.length; // successful search → volume evidence
      must(list.length > 0, "no results");
      must(list.every((i) => i.source === "USDA" && /^\d+$/.test(i.sourceId)), "non-USDA item or non-numeric fdcId");
      must(list.every((i) => ["Foundation", "SR Legacy", "Survey (FNDDS)"].includes(i.dataType)), "unexpected dataType (generic types only)");
      must(list.every((i) => plausible(i.per100)), "implausible kcal value");
      ctx[q] = list;
      const types = [...new Set(list.map((i) => i.dataType))].join(", ");
      return `${list.length} results in ${r.ms} ms; types: ${types}; incomplete: ${list.filter((i) => !i.complete).length}; first: "${list[0].name}" (${per100(list[0])})`;
    });
  }

  await check("USDA-4", "USDA", "food detail (resolve) for a banana result: servings + nutrients", async () => {
    const item = (ctx.banana || [])[0];
    if (!item) throw skip("no banana search result");
    const r = await A.post("/api/foods/resolve", { source: "USDA", sourceId: item.sourceId });
    must(r.status === 200, `HTTP ${r.status} ${r.body && r.body.error}`);
    const f = r.body.food;
    must(f.source === "USDA" && f.sourceId === item.sourceId, "source id not preserved");
    must(f.servings.some((s) => s.label === "100 g" && s.amount === 100), "100 g serving missing");
    must(f.servings.every((s) => s.amount > 0 && s.amount <= 5000), "serving amount outside 0–5000 g");
    for (const k of ["kcal", "protein", "carbs", "fat"]) must(f.per100[k] === null || typeof f.per100[k] === "number", `${k} not number|null`);
    await recordOrigin("USDA", f.sourceId);
    ctx.bananaFood = f;
    const gap = atwaterGap(f.per100);
    return `fdcId ${f.sourceId} (${f.dataType}); ${per100(f)}; servings: ${f.servings.map((s) => s.label).slice(0, 4).join(" | ")}${gap ? `; 4P+4C+9F ≈ ${gap.est} (Δ ${gap.diff})` : ""}`;
  });

  await check("USDA-5", "USDA", "Foundation food detail: energy present (Atwater ids 2047/2048 when 1008 absent)", async () => {
    let found = [...(ctx.banana || []), ...(ctx["chicken breast"] || []), ...(ctx["white rice"] || [])].find((i) => i.dataType === "Foundation");
    for (const q of ["apple raw", "egg whole raw"]) {
      if (found) break;
      const r = await A.get(`/api/foods/search?q=${encodeURIComponent(q)}&sources=USDA`);
      found = (r.body?.results?.USDA || []).find((i) => i.dataType === "Foundation");
    }
    if (!found) throw skip("no Foundation food found in five searches");
    const r = await A.post("/api/foods/resolve", { source: "USDA", sourceId: found.sourceId });
    must(r.status === 200, `HTTP ${r.status}`);
    const f = r.body.food;
    must(f.per100.kcal != null, "energy missing for a Foundation food (Atwater mapping may have failed)");
    must(f.per100.protein != null && f.per100.fat != null, "protein/fat missing");
    const gap = atwaterGap(f.per100);
    return `"${f.name}" fdcId ${f.sourceId}: ${per100(f)}${gap ? `; 4P+4C+9F ≈ ${gap.est} (Δ ${gap.diff})` : ""}`;
  });

  await check("USDA-6", "USDA", "genuinely absent nutrients stay null (vs an independent raw USDA response)", async () => {
    if (ORACLE_DISABLED) throw skip("the independent USDA oracle is disabled (LIVE_CHECK_USDA_ORACLE=off)");
    const pool = [...(ctx.banana || []), ...(ctx["chicken breast"] || []), ...(ctx["white rice"] || [])];
    const seen = new Set();
    // Prefer foods whose search entry already shows a null; the oracle decides what is truly absent.
    const candidates = pool.filter((i) => !seen.has(i.sourceId) && seen.add(i.sourceId))
      .sort((a, b) => Object.values(b.per100).filter((v) => v === null).length - Object.values(a.per100).filter((v) => v === null).length)
      .slice(0, 4);
    if (!candidates.length) throw skip("no USDA search results to examine");
    let oracleFailures = 0, examined = 0;
    for (const c of candidates) {
      const app = await A.post("/api/foods/resolve", { source: "USDA", sourceId: c.sourceId });
      must(app.status === 200, `resolve fdcId ${c.sourceId} → HTTP ${app.status}`);
      let raw;
      try {
        const res = await fetch(`${ORACLE_BASE}/food/${c.sourceId}?api_key=DEMO_KEY`, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) { oracleFailures++; continue; }
        raw = await res.json();
      } catch { oracleFailures++; continue; }
      examined++;
      const cmp = compareWithApp(raw, app.body.food.per100);
      must(!cmp.mismatches.length, `fdcId ${c.sourceId}: ${cmp.mismatches.join("; ")}`);
      if (cmp.absent.length) {
        return `fdcId ${c.sourceId} ("${app.body.food.name}"): absent in raw USDA response → null in app: ${cmp.absent.join(", ")}` +
          `${cmp.zero.length ? `; reported zero → 0 in app: ${cmp.zero.join(", ")}` : ""}; all present values match`;
      }
    }
    if (!examined) throw skip(`the independent USDA oracle (DEMO_KEY) was unavailable for all ${oracleFailures} request(s)`);
    throw skip(`none of the ${examined} USDA food(s) examined has a genuinely absent nutrient; nothing to verify`);
  });

  await check("USDA-7", "USDA", "invalid searches handled safely", async () => {
    const short = await A.get("/api/foods/search?q=a&sources=USDA");
    must(short.status === 400, `1-char query → ${short.status}, expected 400`);
    const none = await A.get(`/api/foods/search?q=${encodeURIComponent("zzqxjv" + run)}&sources=USDA`);
    must(none.status === 200, `nonsense query → ${none.status}`);
    must(!none.body.errors.length, `nonsense query produced provider error: ${JSON.stringify(none.body.errors)}`);
    const bad = await A.post("/api/foods/resolve", { source: "USDA", sourceId: "1" });
    must([404, 502].includes(bad.status), `unknown fdcId → ${bad.status}`);
    return `short → 400; nonsense → 200 with ${none.body.results.USDA.length} results, no error; unknown id → ${bad.status}`;
  });

  // ─── Open Food Facts ──────────────────────────────────────────────────────
  await check("OFF-1", "OFF", 'search "nutella" returns packaged products', async () => {
    const r = await A.get("/api/foods/search?q=nutella&sources=OPEN_FOOD_FACTS");
    must(r.status === 200, `HTTP ${r.status}`);
    const e = r.body.errors.find((x) => x.source === "OPEN_FOOD_FACTS");
    must(!e, `provider error: ${e && `${e.kind} — ${e.message}`}`);
    const list = r.body.results.OPEN_FOOD_FACTS;
    evidence.OPEN_FOOD_FACTS.count = list.length; // successful search → volume evidence
    must(list.length > 0, "no results");
    must(list.every((i) => plausible(i.per100)), "implausible kcal value");
    return `${list.length} results in ${r.ms} ms; incomplete: ${list.filter((i) => !i.complete).length}; no nutrition: ${list.filter((i) => !i.hasNutrition).length}; first: "${list[0].name}" (${per100(list[0])})`;
  });

  await check("OFF-2", "OFF", "barcode 3017620422003 lookup: name, serving, nutrition", async () => {
    const r = await A.get("/api/foods/barcode/3017620422003");
    must(r.status === 200, `HTTP ${r.status} ${r.body && r.body.error}`);
    const f = r.body.food;
    must(/nutella/i.test(f.name), `unexpected name "${f.name}"`);
    must(f.source === "OPEN_FOOD_FACTS" && f.sourceId === "3017620422003", "source/barcode not preserved");
    must(f.per100.kcal != null && f.per100.kcal > 400 && f.per100.kcal < 650, `kcal/100 g ${f.per100.kcal} outside expected range for a hazelnut spread`);
    must(f.servings.some((s) => s.amount === 100), "100 g serving missing");
    await recordOrigin("OPEN_FOOD_FACTS", "3017620422003");
    ctx.nutella = f;
    return `"${f.name}"${f.brand ? ` (${f.brand})` : ""}; ${per100(f)}; servings: ${f.servings.map((s) => s.label).join(" | ")}`;
  });

  await check("OFF-3", "OFF", "nonexistent barcode → not found, no provider error", async () => {
    // 0000000000018 has an INVALID EAN-13 check digit (the valid one is 7), so no real product can carry it.
    const r = await A.get("/api/foods/barcode/0000000000018");
    must(r.status === 404, `HTTP ${r.status}, expected 404`);
    const s = await A.get("/api/foods/search?q=0000000000018&sources=OPEN_FOOD_FACTS");
    must(s.status === 200 && s.body.errors.length === 0 && s.body.results.OPEN_FOOD_FACTS.length === 0, "barcode-style search should be empty without error");
    return "lookup → 404; barcode search → empty, no error";
  });

  await check("OFF-4", "OFF", "energy consistent with macros (kcal used directly or converted from kJ)", async () => {
    if (!ctx.nutella) throw skip("barcode lookup failed");
    const gap = atwaterGap(ctx.nutella.per100);
    must(gap, "macros incomplete for this product");
    must(Math.abs(gap.diff) < 0.15 * ctx.nutella.per100.kcal, `energy ${ctx.nutella.per100.kcal} vs 4P+4C+9F ${gap.est} differs by > 15 %`);
    return `kcal ${fmt(ctx.nutella.per100.kcal)} vs 4P+4C+9F ≈ ${gap.est} (Δ ${gap.diff}); kJ-only conversion remains unit-tested`;
  });

  // ─── App protection (without abusing providers) ───────────────────────────
  await check("PROT-1", "Protection", "per-user OFF search limit (4/min) stops the 5th search before the provider", async () => {
    const kinds = [];
    for (let i = 0; i < 5; i++) {
      let r;
      try {
        r = await L.get(`/api/foods/search?q=${encodeURIComponent(`limitcheck${run}x${i}`)}&sources=OPEN_FOOD_FACTS`);
      } catch (e) {
        if (interrupted) throw e;
        kinds.push("no_app_response");
        continue;
      }
      const errors = r.status === 200 && Array.isArray(r.body?.errors) ? r.body.errors : null;
      const e = errors?.find((x) => x.source === "OPEN_FOOD_FACTS");
      kinds.push(!errors ? "no_app_response" : e ? e.kind : "ok");
    }
    const { status, detail } = decideProt1(kinds);
    if (status === "NOT RUN") throw skip(detail);
    must(status === "PASS", detail);
    return detail;
  });

  // ─── Workflow with real provider data ─────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  await check("FLOW-1", "Workflow", "log a USDA food with a serving; totals; edit ×2; isolation; delete → 0", async () => {
    const f = ctx.bananaFood;
    if (!f) throw skip("USDA detail unavailable");
    if (f.per100.kcal == null) throw skip("chosen food has no energy value");
    const serving = f.servings[0];
    const e = await A.post("/api/nutrition/entries", { date: today, mealType: "BREAKFAST", foodId: f.id, servingId: serving.id, quantity: 1 });
    must(e.status === 200, `log → ${e.status} ${e.body && e.body.error}`);
    const expected = Math.round((f.per100.kcal * serving.amount) / 100 * 100) / 100;
    must(Math.abs(e.body.entry.nutrients.kcal - expected) < 0.011, `entry kcal ${e.body.entry.nutrients.kcal} ≠ ${expected}`);
    let d = (await A.get(`/api/nutrition/day?date=${today}`)).body;
    must(Math.abs(d.totals.kcal - expected) < 0.011, `day total ${d.totals.kcal} ≠ ${expected}`);
    must((await A.patch(`/api/nutrition/entries/${e.body.entry.id}`, { quantity: 2 })).status === 200, "edit failed");
    d = (await A.get(`/api/nutrition/day?date=${today}`)).body;
    must(Math.abs(d.totals.kcal - Math.round(expected * 200) / 100) < 0.021, `after edit ${d.totals.kcal} ≠ ${expected * 2}`);
    must(d.target && d.calories, "target/remaining missing");
    must((await B.patch(`/api/nutrition/entries/${e.body.entry.id}`, { quantity: 9 })).status === 404, "other user could edit");
    must((await B.del(`/api/nutrition/entries/${e.body.entry.id}`)).status === 404, "other user could delete");
    must((await B.get(`/api/nutrition/day?date=${today}`)).body.totals.kcal === 0, "other user sees entries");
    must((await A.del(`/api/nutrition/entries/${e.body.entry.id}`)).status === 200, "delete failed");
    d = (await A.get(`/api/nutrition/day?date=${today}`)).body;
    must(d.totals.kcal === 0, `after delete ${d.totals.kcal}`);
    return `"${f.name}", ${serving.label}: ${expected} kcal → ×2 ${Math.round(expected * 200) / 100} → deleted 0; other user: 404/404 / sees 0`;
  });

  await check("FLOW-2", "Workflow", "log an OFF product by grams; history keeps the day's target", async () => {
    const f = ctx.nutella;
    if (!f) throw skip("OFF product unavailable");
    const e = await A.post("/api/nutrition/entries", { date: today, mealType: "SNACK", foodId: f.id, servingId: null, quantity: 30 });
    must(e.status === 200, `log → ${e.status}`);
    const h = (await A.get(`/api/nutrition/history?end=${today}&days=7`)).body;
    const day = h.days.find((x) => x.date === today);
    must(day.entries === 1 && Math.abs(day.totals.kcal - e.body.entry.nutrients.kcal) < 0.011, "history totals mismatch");
    must(day.target && day.target.kcal > 0, "history day has no target");
    await A.del(`/api/nutrition/entries/${e.body.entry.id}`);
    return `30 g → ${e.body.entry.nutrients.kcal} kcal; history day target ${day.target.kcal} kcal; entry removed`;
  });

  // ─── Secret exposure ──────────────────────────────────────────────────────
  await check("SEC-1", "Security", "FDC_API_KEY never appears in any API response", async () => {
    if (!KEY) throw skip("FDC_API_KEY not available to this script (run with --env-file=.env.test)");
    const leaks = bodies.filter((b) => b.includes(KEY)).length;
    must(leaks === 0, `key found in ${leaks} response(s)`);
    return `${bodies.length} responses scanned, 0 contain the key`;
  });
}

(async () => {
  let crashed = null;
  try {
    await main();
  } catch (e) {
    crashed = e;
    err(`Live check stopped early: ${e.message}`);
  } finally {
    await cleanup();
  }
  if (interrupted) return; // the signal handler reports and exits after the same cleanup
  const v = decideVerdict({ results, evidence, envOverrides, crashed: !!crashed });
  const report = { base: BASE, database: dbName, ranAt: new Date().toISOString(), verdict: v.verdict, live: v.live,
    contradictions: v.contradictions, missingEvidence: v.missing, evidence, summary: v.summary, results,
    stoppedEarly: crashed ? String(crashed.message) : null };
  fs.writeFileSync(REPORT, redact(JSON.stringify(report, null, 2), SECRETS));
  out(`\n${v.summary.PASS} passed, ${v.summary.FAIL} failed, ${v.summary["NOT RUN"]} not run. Report: ${REPORT} (no secrets; git-ignored).`);
  if (v.contradictions.length) { out("NOT LIVE — these results do not verify the real providers:"); v.contradictions.forEach((r) => out(`  - ${r}`)); }
  if (v.missing.length) { out("Live evidence missing:"); v.missing.forEach((r) => out(`  - ${r}`)); }
  if (crashed) out(`  - run stopped early: ${crashed.message}`);
  out(`LIVE VERIFICATION: ${v.verdict}`);
  process.exit(process.exitCode && process.exitCode !== 0 ? process.exitCode : v.exitCode);
})();
