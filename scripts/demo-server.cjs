// Runs the application for hands-on testing, on fitdb_test only, until stopped with Ctrl+C:
//   node --env-file=.env.test scripts/demo-server.cjs --confirm=fitdb_test
// Needs a production build. It's the same setup the guarded suites use: a production build as a designated local test server,
// with the local food stub in place of USDA and Open Food Facts, AI features off, and mail going only to a temporary folder.
// So it calls nothing outside this machine and costs nothing. Registration stays closed, as it would on a real deployment.
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { databaseUrlProblem, environmentProblems, verifyServerIdentity } = require("./lib/test-target-guard.cjs");
const { ROOT, NEXT_BIN, LOOPBACK_HOST, startStub, spawnNode, waitForChild, killTree, portInUse } = require("./lib/test-servers.cjs");

const TARGET = "fitdb_test";
const refuse = (message) => { console.error(`REFUSED (nothing was started): ${message}`); process.exit(4); };

const args = process.argv.slice(2);
const portArg = args.find((a) => a.startsWith("--port="));
if (!args.includes(`--confirm=${TARGET}`) || args.some((a) => a !== `--confirm=${TARGET}` && a !== portArg)) refuse(`use --confirm=${TARGET}, and optionally --port=<number>.`);
const port = portArg ? Number(portArg.slice("--port=".length)) : 3000;
if (!Number.isInteger(port) || port < 1024 || port > 65535) refuse("the port must be a number from 1024 to 65535.");
const envFiles = process.execArgv.filter((a) => a.startsWith("--env-file"));
if (envFiles.length !== 1 || !envFiles[0].startsWith("--env-file=") || path.basename(envFiles[0].slice("--env-file=".length)) !== ".env.test") refuse("run this with exactly --env-file=.env.test.");
if (process.env.DATABASE_URL !== parseEnv(fs.readFileSync(envFiles[0].slice("--env-file=".length), "utf8")).DATABASE_URL) refuse("a DATABASE_URL already in this shell differs from .env.test's. In PowerShell, run: Remove-Item Env:DATABASE_URL");
const DB = process.env.DATABASE_URL;
const problems = [databaseUrlProblem(DB), ...environmentProblems(process.env)].filter(Boolean);
if (problems.length) refuse(problems.map((p) => p.message).join(" | "));
if (decodeURIComponent(new URL(DB).pathname.slice(1)) !== TARGET) refuse(`DATABASE_URL must name ${TARGET} exactly.`);
if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) refuse("there's no production build. Run the build in docs/MANUAL_UI_TESTING_GUIDE.md first.");

(async () => {
  if (await portInUse(port)) refuse(`port ${port} is already in use. Stop what's using it, or add --port=<number>.`);
  const mailDir = fs.mkdtempSync(path.join(os.tmpdir(), "fit-demo-mail-"));
  const stub = await startStub({});
  // Only this machine can reach it (SEC-01): it holds the demo sign-in and publishes its database identity.
  const app = spawnNode([NEXT_BIN, "start", "-H", LOOPBACK_HOST, "-p", String(port)], {
    DATABASE_URL: DB, FDC_BASE_URL: `${stub.url}/fdc/v1`, OFF_BASE_URL: `${stub.url}/off`, FDC_API_KEY: "stub", EXPOSE_DB_IDENTITY: "1", MAIL_STUB_DIR: mailDir, FIT_LOCAL_TEST_SERVER: "1",
    ANTHROPIC_API_KEY: "", ANTHROPIC_BASE_URL: "", LABEL_EXTRACTION_MODEL: "", MEAL_IDENTIFICATION_MODEL: "", FOOD_RATE_LIMIT_MULTIPLIER: "100",
  });
  let stopping = false;
  const stop = async (code) => {
    if (stopping) return;
    stopping = true;
    await killTree(app).catch(() => {});
    await killTree(stub.child).catch(() => {});
    fs.rmSync(mailDir, { recursive: true, force: true });
    process.exit(code);
  };
  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));
  app.once("exit", () => { console.error("The application stopped."); stop(1); });
  const url = `http://localhost:${port}`;
  try {
    await waitForChild(`${url}/login`, app);
    await verifyServerIdentity({ baseUrl: url, databaseUrl: DB });
  } catch (e) {
    console.error(`REFUSED: the server couldn't be verified as using ${TARGET}: ${e.message}`);
    return stop(4);
  }
  console.log(`Running at ${url}, verified on ${TARGET}. Sign-in details are in demo-account.local.md. Press Ctrl+C to stop.`);
})().catch((e) => { console.error(`FAILED: ${String(e.message).slice(0, 200)}`); process.exit(1); });
