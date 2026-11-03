// S2: with FDC_API_KEY unset, clients get a generic message; the detail is in server logs.
// Run against a server started WITHOUT FDC_API_KEY, logging to SERVER_LOG_FILE.
//   SERVER_LOG_FILE=/tmp/server.log BASE_URL=http://localhost:3000 node --test scripts/provider-config.test.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const ORIGIN = new URL(BASE).origin;

test("missing USDA key: generic client message, detail only in server log", async () => {
  let cookie = "";
  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) }, body: body && JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set && set.startsWith("fit_session=")) cookie = set.split(";")[0];
    return { status: res.status, text: await res.text() };
  };
  assert.equal((await call("POST", "/api/auth/register", { email: `cfg${Date.now()}@test.dev`, password: "long password 123" })).status, 200);
  const search = await call("GET", "/api/foods/search?q=banana&sources=USDA");
  assert.equal(search.status, 200);
  const err = JSON.parse(search.text).errors[0];
  assert.deepEqual([err.source, err.kind], ["USDA", "unavailable"]);
  assert.equal(err.message, "This food database is currently unavailable. Try again later.");
  // An uncached id: cached foods are (correctly) served without contacting USDA.
  const resolve = await call("POST", "/api/foods/resolve", { source: "USDA", sourceId: String(7000000 + (Date.now() % 1000000)) });
  assert.equal(resolve.status, 503);
  for (const body of [search.text, resolve.text]) {
    assert.doesNotMatch(body, /FDC_API_KEY|not_configured|api[_ ]?key|credential/i);
  }
  const log = fs.readFileSync(process.env.SERVER_LOG_FILE, "utf8");
  assert.match(log, /USDA configuration error: FDC_API_KEY is not set/);
});
