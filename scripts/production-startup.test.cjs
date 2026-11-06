// Starts the real production server with each configuration it must refuse, and checks it exits without
// listening. Every value is fake, and example.invalid is reserved and never resolves, so nothing is contacted.
// The successful path needs a real database that isn't a test one, so it's tested with a stand-in, in
// production-config.test.ts. Needs a production build.
//   node --test scripts/production-startup.test.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { ROOT, NEXT_BIN, freePort, spawnNode, killTree } = require("./lib/test-servers.cjs");

const SECRET = "fake-sentinel-password-5f3a9c1e";
const HOST = "db.example.invalid";
const database = (rest = `fit_production?sslmode=require`, host = HOST) => `postgresql://fit_app:${SECRET}@${host}:5432/${rest}`;
// Next.js loads .env for any setting that's undefined, and it never replaces one that's already there, even
// if empty. So every setting that could matter is stated, and nothing comes from a developer's own file.
const QUIET = Object.fromEntries(["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "LABEL_EXTRACTION_MODEL", "LABEL_EXTRACTION_EFFORT", "MEAL_IDENTIFICATION_MODEL", "MEAL_IDENTIFICATION_EFFORT", "FDC_API_KEY", "FDC_BASE_URL", "OFF_BASE_URL", "OFF_CONTACT", "OFF_USER_AGENT", "LABEL_STUB_URL", "STUB_LOG_FILE", "EXPOSE_DB_IDENTITY", "FOOD_RATE_LIMIT_MULTIPLIER", "REGISTRATION_ALLOWLIST", "FIT_LOCAL_TEST_SERVER", "FIT_TEST_OPEN_REGISTRATION", "SAFETY_DB_URL", "SAFETY_DB_CONFIRM", "SAFETY_OTHER_DB_URL", "GUARD_SNAPSHOT_SCOPE", "BASE_URL", "SHOTS_DIR", "SERVER_LOG_FILE", "EXPECT_UNCONFIGURED", "NODE_TEST_CONTEXT"].map((k) => [k, ""]));
const VALID = { ...QUIET, NODE_ENV: "production", APP_ORIGIN: "https://app.example.invalid", DATABASE_URL: database(), TRUST_PROXY_HOPS: "1" };

const listening = (port) => new Promise((resolve) => {
  const socket = net.connect({ port, host: "127.0.0.1" });
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
});

/** Runs the server until it exits, or until it's clearly serving. */
async function start(env) {
  const port = await freePort();
  const child = spawnNode([NEXT_BIN, "start", "-p", String(port)], env, { capture: true, cwd: ROOT });
  let output = "";
  child.stdout.on("data", (d) => { output += d; });
  child.stderr.on("data", (d) => { output += d; });
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  const code = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve("still running"), 20_000))]);
  const served = code === "still running" && (await listening(port));
  if (code === "still running") await killTree(child);
  return { code, served, output };
}

async function assertRefused(id, over) {
  const { code, served, output } = await start({ ...VALID, ...over });
  assert.notEqual(code, "still running", `${id}: the server should have stopped. Served: ${served}`);
  assert.notEqual(code, 0, `${id}: a failure exit`);
  assert.match(output, new RegExp(`\\[preflight\\] ${id}:`), `${id}: named in the output`);
  assert.match(output, /Refusing to start/);
  assert.equal(output.includes(SECRET), false, `${id}: no password in the output`);
  assert.equal(output.includes(HOST), false, `${id}: no database host in the output`);
}

for (const [id, over] of [
  ["app-origin", { APP_ORIGIN: "" }],
  ["app-origin", { APP_ORIGIN: "http://app.example.invalid" }],
  ["database-missing", { DATABASE_URL: "" }],
  ["database-test", { DATABASE_URL: database("fitdb_test?sslmode=require") }],
  ["database-password-weak", { DATABASE_URL: `postgresql://fit_app:short@${HOST}:5432/fit_production?sslmode=require` }],
  ["database-tls", { DATABASE_URL: database("fit_production") }],
  ["db-identity", { EXPOSE_DB_IDENTITY: "1" }],
  ["ai-enabled", { ANTHROPIC_API_KEY: "fake" }],
  ["ai-enabled", { LABEL_EXTRACTION_MODEL: "fake" }],
  ["stub-provider", { FDC_BASE_URL: "http://127.0.0.1:9/fdc" }],
  ["test-setting", { FOOD_RATE_LIMIT_MULTIPLIER: "100" }],
  ["test-server-flag", { FIT_LOCAL_TEST_SERVER: "1" }],
  ["test-registration-flag", { FIT_TEST_OPEN_REGISTRATION: "1" }],
  ["proxy-hops", { TRUST_PROXY_HOPS: "" }],
  ["allowlist-invalid", { REGISTRATION_ALLOWLIST: "*" }],
]) {
  test(`the server refuses to start: ${id} ${JSON.stringify(over).replaceAll(SECRET, "<secret>").replaceAll(HOST, "<host>")}`, { timeout: 90_000 }, () => assertRefused(id, over));
}

test("the test exemption can't be used on a remote database with a test name", { timeout: 90_000 }, async () => {
  await assertRefused("test-server-flag", { FIT_LOCAL_TEST_SERVER: "1", DATABASE_URL: database("fitdb_test?sslmode=require") });
});

test("a valid configuration passes every setting check, then refuses when it can't check the database itself", { timeout: 90_000 }, async () => {
  const { code, output } = await start(VALID);
  assert.notEqual(code, 0);
  assert.notEqual(code, "still running");
  const reported = [...output.matchAll(/\[preflight\] ([a-z-]+):/g)].map((m) => m[1]);
  assert.deepEqual(reported, ["database-unverified"], "nothing else was wrong");
  assert.equal(output.includes(SECRET), false, "no password in the output");
  assert.equal(output.includes(HOST), false, "no database host in the output");
});
