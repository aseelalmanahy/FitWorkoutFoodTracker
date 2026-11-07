// Signs a test user up through the real flow: ask for a link, read it from the mail stub's directory, set a
// password with it, then log in. The server writes one JSON file per message to MAIL_STUB_DIR, named
// <ms>-<random>.json, holding { to, kind, subject, text }. The link in `text` ends in #token=<43 characters>.
// A token is a credential: nothing here prints one, in an error or otherwise. Run-guarded-suites.cjs gives
// the app and everything that runs against it the same MAIL_STUB_DIR.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

/** The notice version a person would be shown, read from the source, as the page sends it. */
const NOTICE_VERSION = /version: "([^"]+)"/.exec(fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "legal", "notice.ts"), "utf8"))[1];
const TOKEN_IN_LINK = /#token=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function mailDir(dir) {
  if (!dir) throw new Error("MAIL_STUB_DIR isn't set, so there is nowhere to read the emailed link from. Run this through scripts/run-guarded-suites.cjs.");
  return dir;
}

/** Names of the files already in the directory, so a later read can ignore older mail. */
function mailFiles(dir = process.env.MAIL_STUB_DIR) {
  try { return new Set(fs.readdirSync(mailDir(dir)).filter((f) => f.endsWith(".json"))); } catch (e) {
    if (e.code === "ENOENT") return new Set();
    throw e;
  }
}

const order = (a, b) => (Number.parseInt(a.split("-")[0], 10) - Number.parseInt(b.split("-")[0], 10)) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * The newest token mailed to this address for this kind ('signup', 'password-reset', 'password-changed'),
 * waiting up to timeoutMs for it to arrive. `ignore` is a Set of file names from mailFiles() to skip.
 */
async function readMailLink(email, kind, { dir = process.env.MAIL_STUB_DIR, timeoutMs = 10_000, ignore } = {}) {
  mailDir(dir);
  const want = String(email).trim().toLowerCase();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let names = [];
    try { names = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !(ignore && ignore.has(f))).sort(order); } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    for (const name of names.reverse()) {
      let mail;
      try { mail = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); } catch { continue; } // still being written
      if (String(mail.to).trim().toLowerCase() !== want || mail.kind !== kind) continue;
      const match = TOKEN_IN_LINK.exec(String(mail.text));
      if (match) return match[1];
    }
    if (Date.now() >= deadline) throw new Error(`no '${kind}' mail for ${email} arrived in ${timeoutMs} ms (looked in ${names.length} file(s) in the mail directory)`);
    await sleep(100);
  }
}

/** A plain POST with the Origin header every mutation needs. Returns { status, headers, body }. */
function defaultPost(baseUrl) {
  const origin = new URL(baseUrl).origin;
  return async (urlPath, body) => {
    const res = await fetch(baseUrl + urlPath, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body), redirect: "manual" });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, headers: res.headers, body: json };
  };
}

/**
 * Registers, completes with the emailed link, logs in. Returns the session cookie as { name, value, cookie }.
 * `post(path, body)` may be supplied to use a script's own client, if it returns { status, headers } with
 * headers.getSetCookie(). Otherwise a plain fetch is used.
 */
async function signUpWithApi(baseUrl, email, password, { post = defaultPost(baseUrl), dir = process.env.MAIL_STUB_DIR, timeoutMs } = {}) {
  const seen = mailFiles(dir);
  const registered = await post("/api/auth/register", { email });
  if (registered.status !== 200) throw new Error(`sign-up for ${email}: /api/auth/register answered ${registered.status}`);
  const token = await readMailLink(email, "signup", { dir, timeoutMs, ignore: seen });
  const completed = await post("/api/auth/register/complete", { token, password, acceptedVersion: NOTICE_VERSION });
  if (completed.status !== 200) throw new Error(`sign-up for ${email}: /api/auth/register/complete answered ${completed.status}`);
  const login = await post("/api/auth/login", { email, password });
  if (login.status !== 200) throw new Error(`sign-up for ${email}: /api/auth/login answered ${login.status}`);
  const set = login.headers.getSetCookie().find((c) => c.startsWith("fit_session="));
  if (!set) throw new Error(`sign-up for ${email}: login set no session cookie`);
  const cookie = set.split(";")[0];
  const at = cookie.indexOf("=");
  return { name: cookie.slice(0, at), value: cookie.slice(at + 1), cookie };
}

/**
 * Goes through /register, the emailed link, and /login in a Playwright page, and leaves it at /onboarding.
 * The session cookie is whatever the server set in that page's context.
 */
async function signUpInBrowser(page, baseUrl, email, password, { dir = process.env.MAIL_STUB_DIR, timeoutMs } = {}) {
  const seen = mailFiles(dir);
  await page.goto(`${baseUrl}/register`);
  await page.fill("input[name=email]", email);
  await page.click("button[type=submit]");
  await page.getByRole("heading", { name: "Check your email" }).waitFor();
  const token = await readMailLink(email, "signup", { dir, timeoutMs, ignore: seen });
  // Playwright's errors quote the URL, and this one holds a token.
  // Fragments aren't in request URLs, so none of this can hold the token.
  const problems = [];
  const onPageError = (e) => problems.push(`pageerror: ${String(e.message).slice(0, 150)}`);
  const onRequestFailed = (r) => problems.push(`failed: ${new URL(r.url()).pathname} ${r.failure()?.errorText ?? ""}`);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onRequestFailed);
  let response;
  try { response = await page.goto(`${baseUrl}/register/complete#token=${token}`); } catch { throw new Error(`sign-up for ${email}: the emailed link's page didn't load`); }
  try {
    await page.fill("input[name=password]", password);
  } catch {
    const shown = (await page.locator("body").innerText().catch(() => "unreadable")).replace(/\s+/g, " ").slice(0, 200);
    throw new Error(`sign-up for ${email}: no password field on the emailed link's page. Status ${response?.status()}, at ${new URL(page.url()).pathname}, it showed: ${shown}. Problems: ${problems.join("; ") || "none seen"}`);
  }
  page.off("pageerror", onPageError);
  page.off("requestfailed", onRequestFailed);
  await page.check("input[name=accept]");
  await page.click("button[type=submit]");
  await page.waitForURL("**/login?created=1");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", password);
  await page.click("button[type=submit]");
  await page.waitForURL("**/onboarding");
}

module.exports = { readMailLink, mailFiles, signUpWithApi, signUpInBrowser, NOTICE_VERSION };
