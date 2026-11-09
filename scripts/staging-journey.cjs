// The core user journey against a DEPLOYED instance (staging), through its public HTTPS address, as one synthetic
// account (create it first with create-staging-account.cjs):
//   STAGING_EMAIL=… STAGING_PASSWORD=… node scripts/staging-journey.cjs https://staging.example.com
// Profile -> gym -> workout at the gym (exercise, set, finish) -> custom food -> food log -> day totals -> export.
// It adds synthetic rows to that account and nothing else. Prints no password. Exit 0 only if every step passes.
"use strict";
const BASE = (process.argv[2] || "").replace(/\/$/, "");
const email = process.env.STAGING_EMAIL, password = process.env.STAGING_PASSWORD;
if (!/^https:\/\//.test(BASE) || !email || !password) { console.error("usage: STAGING_EMAIL=… STAGING_PASSWORD=… node scripts/staging-journey.cjs https://<host>"); process.exit(4); }
if (!/@([a-z0-9-]+\.)*(example\.(com|org|net)|test|invalid)$/.test(email)) { console.error("REFUSED: only a synthetic account at a reserved test domain"); process.exit(4); }
const run = Date.now().toString(36);
let cookie = "";
const call = async (method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: { origin: BASE, cookie, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, body: json, headers: r.headers, setCookie: set };
};
let failed = 0;
const step = (label, ok, note = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${note ? `: ${note}` : ""}`); if (!ok) failed++; return ok; };
const today = new Date().toISOString().slice(0, 10);

(async () => {
  const login = await call("POST", "/api/auth/login", { email, password });
  const sc = login.setCookie.find((c) => c.startsWith("fit_session=")) ?? "";
  if (!step("sign in", login.status === 200)) throw new Error("can't continue without a session");
  step("session cookie is Secure, HttpOnly, SameSite=Lax", /;\s*Secure/i.test(sc) && /;\s*HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc));
  const prof = await call("PUT", "/api/profile", { name: "Staging tester", birthDate: "1990-01-01", sex: null, heightCm: 175, currentWeightKg: 75, goalWeightKg: null, goal: "MAINTENANCE", activityLevel: "MODERATE", experience: "BEGINNER", workoutDaysPerWeek: 3, unitSystem: "METRIC", timezone: "UTC", calorieTargetOverride: null });
  step("profile saved", prof.status === 200, String(prof.status));
  const gym = await call("POST", "/api/gyms", { name: `Staging gym ${run}` });
  step("a gym is created", gym.status === 200 && Boolean(gym.body?.gym?.id), String(gym.status));
  const ex = await call("GET", "/api/exercises");
  const bench = (ex.body?.exercises ?? []).find((e) => e.name === "Barbell Bench Press");
  step("the built-in exercise library is there", Boolean(bench), `${(ex.body?.exercises ?? []).length} exercises`);
  const s = await call("POST", "/api/sessions", { name: `Staging workout ${run}`, gymLocationId: gym.body.gym.id });
  const sid = s.body?.session?.id;
  step("a workout starts at the gym", s.status === 200 && s.body.session.gymLocationId === gym.body.gym.id, String(s.status));
  const se = await call("POST", `/api/sessions/${sid}/exercises`, { exerciseId: bench.id });
  step("an exercise is added", se.status === 200, String(se.status));
  const set = await call("POST", `/api/sessions/${sid}/exercises/${se.body.sessionExercise.id}/sets`, { reps: 5, weightKg: 60 });
  step("a set is logged", set.status === 200, String(set.status));
  const fin = await call("PATCH", `/api/sessions/${sid}`, { finish: true });
  step("the workout is finished", fin.status === 200, String(fin.status));
  const food = await call("POST", "/api/foods", { name: `Staging bar ${run}`, basisUnit: "G", servingLabel: "1 bar", servingAmount: 60, perServing: { kcal: 240, protein: 20, carbs: 24, fat: 8 } });
  step("a custom food is created, per 100 g computed from the serving", food.status === 200 && food.body?.food?.per100?.kcal === 400, String(food.status));
  const entry = await call("POST", "/api/nutrition/entries", { date: today, mealType: "SNACK", foodId: food.body.food.id, servingId: food.body.food.servings[0].id, quantity: 1 });
  step("it is logged", entry.status === 200, String(entry.status));
  const day = await call("GET", `/api/nutrition/day?date=${today}`);
  const kcal = day.body?.totals?.kcal ?? day.body?.total?.kcal;
  step("the day's total includes it", day.status === 200 && typeof kcal === "number" && kcal >= 240, `${day.status}, ${kcal} kcal`);
  const exp = await call("POST", "/api/account/export", { password });
  const doc = exp.body;
  step("the export is complete: the gym, the workout at it, the food entry", exp.status === 200 && doc?.gyms?.some((g) => g.name === `Staging gym ${run}`) && doc?.workoutSessions?.some((w) => w.gymLocationId === gym.body.gym.id && w.exercises?.[0]?.sets?.length === 1) && doc?.foodEntries?.some((f) => f.foodName === `Staging bar ${run}`), String(exp.status));
  step("the export is never cached", /no-store/.test(exp.headers.get("cache-control") ?? ""));
  await call("POST", "/api/auth/logout");
  const after = await call("GET", "/api/sessions");
  step("after sign-out, private data is refused", after.status === 401, String(after.status));
})().catch((e) => { console.log(`STOPPED: ${e.message}`); failed++; }).finally(() => {
  console.log(failed ? `JOURNEY FAILED: ${failed} step(s)` : "JOURNEY PASSED");
  process.exitCode = failed ? 1 : 0;
});
