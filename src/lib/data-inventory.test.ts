// L1 and the notice's consistency. The real tree against the inventory, then each check shown failing on a fixture,
// as a switch turning a check off would prove nothing. No database: Prisma.dmmf connects to nothing.
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import dataMap from "./account-data-map.json";
import inventoryJson from "./data-inventory.json";
import { type Inventory, type InventoryFacts, callSiteFiles, hostLiterals, inventoryProblems, withoutComments } from "./data-inventory-check";
import { DRAFT_MARKER, NOTICE, type Notice, noticeHash, noticeIsFinal, noticeIsMalformed, noticeText } from "./legal/notice";
import { sha256Hex } from "./legal/sha256";
import { AI_SETTINGS } from "./server/production-config";

const ROOT = path.resolve(__dirname, "../..");
const inventory = inventoryJson as Inventory;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const sources = [...walk(path.join(ROOT, "src")), path.join(ROOT, "next.config.ts")]
  .filter((f) => /\.[cm]?[jt]sx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes(`${path.sep}src${path.sep}test${path.sep}`))
  .map((f) => ({ path: path.relative(ROOT, f).split(path.sep).join("/"), text: readFileSync(f, "utf8") }));
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };
const facts: InventoryFacts = {
  models: Prisma.dmmf.datamodel.models.map((m) => ({ name: m.name, fields: m.fields.map((f) => f.name) })),
  dataMapModels: Object.keys(dataMap),
  sources,
  dependencies: Object.keys(pkg.dependencies),
  aiSettings: [...AI_SETTINGS],
};
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const problemsWith = (change: (inv: Inventory, f: InventoryFacts) => void) => {
  const inv = clone(inventory);
  const f: InventoryFacts = { ...clone({ ...facts, sources: [] }), sources: [...sources] };
  change(inv, f);
  return inventoryProblems(inv, f);
};

describe("the real code matches the inventory", () => {
  it("has no differences", () => {
    expect(inventoryProblems(inventory, facts)).toEqual([]);
  });
  it("really found something, as an empty scan would pass with nothing", () => {
    expect(facts.models.length).toBeGreaterThanOrEqual(15);
    expect(sources.length).toBeGreaterThan(100);
    expect(callSiteFiles(sources).length).toBeGreaterThanOrEqual(8);
    expect(callSiteFiles(sources)).toContain("src/lib/server/foods/http.ts");
    expect(callSiteFiles(sources)).toContain("src/lib/server/labels/anthropic.ts");
    expect(hostLiterals(sources)).toEqual(expect.arrayContaining(["api.nal.usda.gov", "world.openfoodfacts.org"]));
    expect(inventory.mail.transports.length).toBeGreaterThanOrEqual(2);
  });
  it("lists Anthropic as conditional, as the code sends photos when its settings are present", () => {
    expect(inventory.processors.anthropic.state).toBe("conditional");
    expect(inventory.hosts).not.toHaveProperty("api.anthropic.com"); // the SDK's default: this can't be seen, and the document says so
  });
  it("names what can't be decided yet as unknown, rather than guessing", () => {
    for (const id of ["host", "database", "email-provider"]) expect(inventory.processors[id].state).toBe("unknown");
    for (const id of ["backups", "logs", "unused-accounts"]) expect(inventory.periods[id].state).toBe("unknown");
  });
});

describe("each check can fail", () => {
  const FETCH = { path: "src/lib/server/new-thing.ts", text: 'await fetch("https://api.example.test/x");' };
  it("a model added to the schema", () => {
    expect(problemsWith((_, f) => f.models.push({ name: "SomethingNew", fields: ["id"] })).join()).toMatch(/model: SomethingNew isn't in the inventory/);
  });
  it("a model with its category removed", () => {
    expect(problemsWith((inv) => { delete inv.categories.training; }).join()).toMatch(/has no category/);
  });
  it("a model missing from the data map", () => {
    expect(problemsWith((_, f) => { f.dataMapModels = f.dataMapModels.filter((m) => m !== "Food"); }).join()).toMatch(/data-map model/);
  });
  it("a field that doesn't exist", () => {
    expect(problemsWith((inv) => inv.possiblyHealthRelated.push("Profile.bloodType")).join()).toMatch(/field: Profile.bloodType doesn't exist/);
  });
  it("a new file calling fetch", () => {
    expect(problemsWith((_, f) => f.sources.push(FETCH)).join()).toMatch(/call site: src\/lib\/server\/new-thing.ts isn't in the inventory/);
  });
  it.each(["new Anthropic({})", 'import x from "node:https";', 'import x from "https";', 'import "node:http";', "new WebSocket(u)", "navigator.sendBeacon(u)", 'await import("node:net")', "const f = fetch;", "const f = window.fetch;", "fetch (u)", "/* note */ fetch(u)", "fetch.call(null, u)", 'import A from "@anthropic-ai/sdk";', 'import { request } from "undici";', 'await import("undici")', 'require("nodemailer")'])("a new file using %s", (code) => {
    expect(problemsWith((_, f) => f.sources.push({ path: "src/lib/new.ts", text: code })).join()).toMatch(/call site: src\/lib\/new.ts/);
  });
  it("a stale entry in the call-site list", () => {
    expect(problemsWith((inv) => { inv.callSites.server["src/lib/server/gone.ts"] = "old"; }).join()).toMatch(/gone.ts is listed, and wasn't found/);
  });
  it("a mention in a comment isn't a call", () => {
    expect(callSiteFiles([{ path: "a.ts", text: "// fetch(x)\n/* fetch(y) */\n * fetch(z)\nconst a = 1; // fetch(q)" }])).toEqual([]);
    expect(withoutComments('const u = "https://a.example"; // note')).toContain("https://a.example");
  });
  it("a host literal not in the inventory", () => {
    expect(problemsWith((_, f) => f.sources.push({ path: "src/lib/x.ts", text: 'const u = "https://tracker.example.test/p";' })).join()).toMatch(/host: tracker.example.test/);
  });
  it("a stale host", () => {
    expect(problemsWith((inv) => { inv.hosts["old.example.test"] = "usda"; }).join()).toMatch(/old.example.test is listed/);
  });
  it("an unlisted mail transport", () => {
    expect(problemsWith((_, f) => f.sources.push({ path: "src/lib/server/mail/smtp.ts", text: "const smtp: MailTransport = { async send() {} };" })).join()).toMatch(/mail transport: smtp/);
  });
  it("a mail transport declared with satisfies", () => {
    expect(problemsWith((_, f) => f.sources.push({ path: "src/lib/server/mail/smtp.ts", text: "const smtp = { async send() {} } satisfies MailTransport;" })).join()).toMatch(/mail transport: smtp/);
  });
  it("a transport given the factory's name, in any file", () => {
    expect(problemsWith((_, f) => f.sources.push({ path: "src/lib/server/mail/other.ts", text: "const mailTransport: MailTransport = { async send() {} };" })).join()).toMatch(/mail transport: mailTransport/);
  });
  it("a transport cast, or extending another class", () => {
    expect(problemsWith((_, f) => f.sources.push({ path: "src/lib/a.ts", text: "const smtp = {} as MailTransport;" })).join()).toMatch(/mail transport: smtp/);
    expect(problemsWith((_, f) => f.sources.push({ path: "src/lib/a.ts", text: "class Smtp extends Base implements MailTransport {" })).join()).toMatch(/mail transport: Smtp/);
  });
  it("a second mail factory", () => {
    expect(problemsWith((_, f) => f.sources.push({ path: "src/lib/server/mail/other.ts", text: "export function mailTransport() { return null; }" })).join()).toMatch(/mail: the factory/);
  });
  it("server code listed as browser code, and the reverse", () => {
    expect(problemsWith((inv) => { inv.callSites.browser["src/lib/server/foods/http.ts"] = "x"; }).join()).toMatch(/listed as browser code/);
    expect(problemsWith((inv) => { inv.callSites.server["src/lib/client/api.ts"] = "x"; }).join()).toMatch(/listed as server code/);
  });
  it("an unclassified dependency", () => {
    expect(problemsWith((_, f) => f.dependencies.push("nodemailer")).join()).toMatch(/dependency: nodemailer/);
  });
  it("an AI setting the inventory doesn't know", () => {
    expect(problemsWith((_, f) => f.aiSettings.push("OPENAI_API_KEY")).join()).toMatch(/AI setting: OPENAI_API_KEY/);
  });
  it("a period changed in the code", () => {
    expect(problemsWith((inv) => { inv.periods.session.proof = "SESSION_TTL_MS = 7 "; }).join()).toMatch(/period: session/);
  });
});

describe("the notice's hash", () => {
  it.each(["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(1000), "naïve café ✓", noticeText(NOTICE)])("matches node:crypto on %j", (text) => {
    expect(sha256Hex(text)).toBe(createHash("sha256").update(text).digest("hex"));
  });
});

describe("the notice", () => {
  const text = noticeText(NOTICE);
  const reviewed = (over: Partial<Notice> = {}): Notice => {
    const clean: Notice = { ...clone(NOTICE), version: "2027-01-01", status: "final", ...over };
    const strip = (s: string) => s.replaceAll(/\[TO CONFIRM[^\]]*\]/g, "Decided.");
    for (const part of [clean.privacy, clean.terms]) for (const section of part) section.paragraphs = section.paragraphs.map(strip);
    return { ...clean, review: clean.review ?? { date: "2027-01-01", reviewer: "A reviewer", textSha256: noticeHash(clean) } };
  };

  it("is pinned as a draft in this phase, and says so", () => {
    expect(NOTICE.status).toBe("draft");
    expect(NOTICE.version.startsWith("draft-")).toBe(true);
    expect(NOTICE.review).toBeNull();
    expect(noticeIsFinal()).toBe(false);
    expect(noticeIsMalformed()).toBe(false);
    expect(text).toContain(DRAFT_MARKER);
  });
  it("a date that doesn't exist, or a draft version in other case, can't pass", () => {
    const badDate = reviewed();
    badDate.review = { ...badDate.review!, date: "2026-99-99" };
    expect(noticeIsFinal(badDate)).toBe(false);
    const feb = reviewed();
    feb.review = { ...feb.review!, date: "2026-02-30" };
    expect(noticeIsFinal(feb)).toBe(false);
    expect(noticeIsFinal(reviewed({ version: "DRAFT-x" }))).toBe(false);
    expect(noticeIsFinal(reviewed({ version: " draft-x" }))).toBe(false);
  });
  it("final needs every part of the review", () => {
    expect(noticeIsFinal(reviewed())).toBe(true);
    const good = reviewed();
    expect(noticeIsFinal({ ...good, status: "draft" })).toBe(false);
    expect(noticeIsFinal({ ...good, review: null })).toBe(false);
    expect(noticeIsFinal({ ...good, version: "draft-2027" })).toBe(false);
    expect(noticeIsFinal({ ...good, review: { ...good.review!, date: "soon" } })).toBe(false);
    expect(noticeIsFinal({ ...good, review: { ...good.review!, reviewer: " " } })).toBe(false);
    expect(noticeIsFinal({ ...good, review: { ...good.review!, textSha256: "0".repeat(64) } })).toBe(false);
  });
  it("a draft version can't pass, even with its own matching hash", () => {
    const good = reviewed({ version: "draft-2027" });
    expect(good.review!.textSha256).toBe(noticeHash(good));
    expect(noticeIsFinal(good)).toBe(false);
  });
  it("a typed status over today's text isn't final, and is malformed", () => {
    const typed: Notice = { ...clone(NOTICE), status: "final", version: "2027-01-01", review: { date: "2027-01-01", reviewer: "Someone", textSha256: "x" } };
    expect(noticeIsFinal(typed)).toBe(false);
    expect(noticeIsMalformed(typed)).toBe(true);
  });
  it("a marker left in fails, even with a matching hash", () => {
    const marked: Notice = { ...clone(NOTICE), status: "final", version: "2027-01-01", review: null };
    marked.review = { date: "2027-01-01", reviewer: "A reviewer", textSha256: noticeHash(marked) };
    expect(noticeIsFinal(marked)).toBe(false);
  });
  it("an edit after review undoes it", () => {
    const edited = reviewed();
    edited.terms[0].paragraphs[0] += " Edited later.";
    expect(noticeIsFinal(edited)).toBe(false);
    expect(noticeIsMalformed(edited)).toBe(true);
  });
  it("calls nothing consent, and claims nothing approved", () => {
    expect(text).not.toMatch(/consent|compliant|GDPR|HIPAA|legally/i);
  });

  it("names exactly the inventory's processors and periods", () => {
    expect([...NOTICE.names.processors].sort()).toEqual(Object.keys(inventory.processors).sort());
    expect([...NOTICE.names.periods].sort()).toEqual(Object.keys(inventory.periods).sort());
  });
  it.each(Object.entries(inventory.processors))("mentions %s", (_id, p) => {
    expect(text).toContain(p.noticeName);
  });
  it.each(Object.entries(inventory.periods).filter(([, p]) => p.state === "built"))("states %s, as the code does", (_id, p) => {
    expect(text).toContain(p.noticeText);
  });
  it.each(Object.entries(inventory.periods).filter(([, p]) => p.state === "unknown"))("marks %s as undecided, where it belongs", (_id, p) => {
    expect(text).toContain(`${p.noticeLabel}: ${DRAFT_MARKER}`);
    expect(text).toContain(p.needs);
  });
});
