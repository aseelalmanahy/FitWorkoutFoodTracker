// Circuit breaker counts well-formed JSON with an unexpected structure as a provider
// failure. Run against a FRESH server (default budgets, circuits closed) whose provider
// URLs point at scripts/stub-food-apis.cjs started with STUB_LOG_FILE.
//   STUB_LOG_FILE=/tmp/stub.log BASE_URL=http://localhost:3000 node --test scripts/provider-malformed.test.cjs
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ORIGIN = new URL(BASE).origin;
const LOG = process.env.STUB_LOG_FILE;
const run = Date.now();
const hits = (re) => fs.readFileSync(LOG, "utf8").split("\n").filter((l) => re.test(l)).length;

function client() {
  let cookie = "";
  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method, body: body !== undefined ? JSON.stringify(body) : undefined,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
    });
    const set = res.headers.get("set-cookie");
    if (set && set.startsWith("fit_session=")) cookie = set.split(";")[0];
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, body: json };
  };
  return { get: (p) => call("GET", p), post: (p, b) => call("POST", p, b) };
}
const U = {};
before(async () => {
  assert.ok(LOG, "STUB_LOG_FILE must be set");
  for (const n of ["usda", "usda2", "detail", "offs", "offp"]) {
    U[n] = client();
    assert.equal((await U[n].post("/api/auth/register", { email: `mal${n}${run}@test.dev`, password: "long password 123" })).status, 200);
  }
});
const srcErr = (r, s) => r.body.errors.find((e) => e.source === s);

test("USDA detail: 3 malformed responses open the USDA circuit; the next request is not sent", async () => {
  const before = hits(/fdc\/v1\/food\//);
  for (let i = 0; i < 3; i++) {
    const r = await U.detail.post("/api/foods/resolve", { source: "USDA", sourceId: "990000" });
    assert.equal(r.status, 502);
    assert.equal(r.body.details.kind, "invalid_response");
  }
  const r = await U.detail.post("/api/foods/resolve", { source: "USDA", sourceId: String(7000000 + (run % 1000000)) });
  assert.equal(r.status, 503);
  assert.equal(r.body.details.kind, "unavailable");
  assert.equal(hits(/fdc\/v1\/food\//) - before, 3);
});

test("USDA search: after the circuit closes, a success resets; 3 malformed searches open it again", { timeout: 60_000 }, async () => {
  await new Promise((r) => setTimeout(r, 31_000)); // the 30 s open window from the previous test expires
  const before = hits(/fdc\/v1\/foods\/search/);
  const ok = await U.usda.get(`/api/foods/search?q=banana&sources=USDA`);
  assert.equal(srcErr(ok, "USDA"), undefined, "valid response after the window → success resets the count");
  for (let i = 0; i < 3; i++) {
    const r = await U.usda.get("/api/foods/search?q=malformed&sources=USDA");
    assert.equal(srcErr(r, "USDA").kind, "invalid_response", `malformed ${i + 1} reached the provider`);
  }
  const r = await U.usda2.get(`/api/foods/search?q=apple${run}&sources=USDA`); // different user
  assert.equal(srcErr(r, "USDA").kind, "unavailable", "circuit is shared: protects the provider for everyone");
  assert.equal(hits(/fdc\/v1\/foods\/search/) - before, 4);
});

test("OFF search: 3 malformed responses open the circuit; the 4th is not sent", async () => {
  const before = hits(/\/off\/search\?/);
  for (let i = 0; i < 3; i++) {
    const r = await U.offs.get(`/api/foods/search?q=malformed&sources=OPEN_FOOD_FACTS`);
    assert.equal(srcErr(r, "OPEN_FOOD_FACTS").kind, "invalid_response");
  }
  const r = await U.offs.get(`/api/foods/search?q=nutella&sources=OPEN_FOOD_FACTS`);
  assert.equal(srcErr(r, "OPEN_FOOD_FACTS").kind, "unavailable");
  assert.equal(hits(/\/off\/search\?/) - before, 3);
});

test("OFF product: a success resets the count; then 3 consecutive malformed open the circuit", async () => {
  const before = hits(/api\/v2\/product/);
  for (let i = 0; i < 2; i++) assert.equal((await U.offp.get("/api/foods/barcode/0000000000600")).status, 502);
  // Valid response from the provider → resets. A unique, never-cached code so it really reaches the provider.
  assert.equal((await U.offp.get(`/api/foods/barcode/77${String(run).slice(-11)}`)).status, 200);
  for (let i = 0; i < 2; i++) assert.equal((await U.offp.get("/api/foods/barcode/0000000000600")).status, 502);
  assert.equal(hits(/api\/v2\/product/) - before, 5, "still closed after 2+success+2");
  assert.equal((await U.offp.get("/api/foods/barcode/0000000000600")).status, 502); // 3rd consecutive
  // An uncached code (cached foods are still served while the circuit is open, by design).
  const r = await U.offp.get(`/api/foods/barcode/77${String(run + 1).slice(-11)}`);
  assert.equal(r.status, 503);
  assert.equal(r.body.details.kind, "unavailable");
  assert.equal(hits(/api\/v2\/product/) - before, 6, "request after the circuit opened was not sent");
});
