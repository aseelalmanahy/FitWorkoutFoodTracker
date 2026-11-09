// Creates one SYNTHETIC account on a deployed database (staging), for browser and phone testing. Runs in the migrate
// image, which has the migration credential and Prisma's CLI, so nothing extra is installed:
//   docker compose ... --profile migrate run --rm --entrypoint node migrate scripts/create-staging-account.cjs \
//     --email=tester1@staging.example.com
// Why it exists: on a real deployment, registration stays closed while the privacy notice is a draft (production-config
// noticeGateOpen), which is the pre-beta safeguard. This doesn't open it. It refuses any address outside the reserved
// example and test domains, so it can't create a real person's account; and it records no notice acceptance
// (termsVersion stays null), as nobody accepted one. The password is new and random. It's printed once to the
// operator's terminal, or taken from STAGING_ACCOUNT_PASSWORD (CI, masked). The account completes onboarding itself.
"use strict";
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { hash } = require("@node-rs/argon2");

const refuse = (m) => { console.error(`REFUSED (nothing was created): ${m}`); process.exit(4); };
const args = process.argv.slice(2);
const emailArg = args.find((a) => a.startsWith("--email="));
if (args.length !== 1 || !emailArg) refuse("use --email=<address at a reserved test domain>.");
const email = emailArg.slice("--email=".length).trim().toLowerCase();
// RFC 2606 / RFC 6761 names only: nobody can own or receive mail at them.
if (!/^[a-z0-9._+-]{1,64}@([a-z0-9-]+\.)*(example\.(com|org|net)|test|invalid)$/.test(email)) refuse("the address must be at example.com, example.org, example.net, .test or .invalid.");
if (!process.env.DATABASE_URL) refuse("DATABASE_URL isn't set (run it through the migrate service).");
// Staging only: its database is named …_staging (single-server.env.example); production's isn't, so this can never
// make an account that skips the privacy notice on the real service.
let dbName = "";
try { dbName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)); } catch { refuse("DATABASE_URL isn't a valid URL."); }
if (!/^[a-z0-9_]*_staging$/.test(dbName)) refuse(`staging databases only (their name ends in _staging); this is "${dbName}".`);
const given = process.env.STAGING_ACCOUNT_PASSWORD;
if (given !== undefined && given.length < 16) refuse("STAGING_ACCOUNT_PASSWORD must be at least 16 characters.");
const password = given ?? randomBytes(15).toString("base64url");

(async () => {
  // The app's own Argon2id parameters (src/lib/server/auth.ts), so the app verifies it as any other password.
  const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const id = `stg${randomBytes(12).toString("hex")}`;
  const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const sql = `INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES (${lit(id)}, ${lit(email)}, ${lit(passwordHash)}, now());`;
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", "node_modules", "prisma", "build", "index.js"), "db", "execute", "--stdin", "--schema", path.join(__dirname, "..", "prisma", "schema.prisma")], { input: sql, encoding: "utf8" });
  if (r.status !== 0) {
    const why = /unique|duplicate|23505/i.test(r.stderr + r.stdout) ? "that address already has an account." : "the database refused it (see above).";
    if (!/unique|duplicate|23505/i.test(r.stderr + r.stdout)) process.stderr.write(r.stderr.replace(/postgres(ql)?:\/\/\S+/g, "<url>"));
    refuse(why);
  }
  console.log(`Created synthetic account ${email}.`);
  if (given === undefined) console.log(`Its password (shown once, keep it in your password manager): ${password}`);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
