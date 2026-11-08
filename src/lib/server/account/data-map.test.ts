import { Prisma } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import dataMap from "@/lib/account-data-map.json";
import { MAX_EXPORT_BYTES, exportFilename, exportRow, exportValue, serializeExport, withExportSlot } from "./export";
import { deleteAccountSchema, accountPasswordSchema } from "@/lib/validation";

type Entry = { deletion: string; export: string[]; excluded: Record<string, string> };
const map = dataMap as Record<string, Entry>;
const models = Prisma.dmmf.datamodel.models;
const SRC = path.resolve(__dirname, "../../..");

describe("every model and field is classified", () => {
  it("names exactly the schema's models, so a new table fails here until it's classified", () => {
    expect(Object.keys(map).sort()).toEqual(models.map((m) => m.name).sort());
  });
  it.each(models.map((m) => m.name))("%s: every stored field is exported or excluded, never both", (name) => {
    const stored = models.find((m) => m.name === name)!.fields.filter((f) => f.kind !== "object").map((f) => f.name);
    const entry = map[name];
    expect([...entry.export, ...Object.keys(entry.excluded)].sort()).toEqual([...stored].sort());
    for (const reason of Object.values(entry.excluded)) expect(reason.length).toBeGreaterThan(0);
  });
  it("never exports a credential or session", () => {
    expect(map.User.export).not.toContain("passwordHash");
    expect(map.Session.export).toEqual([]);
    expect(map.AccountToken.export).toEqual([]);
    for (const [name, entry] of Object.entries(map)) expect(entry.export, name).not.toContain("userId");
  });
  it("every relation to a user or a shared parent has a stated deletion rule", () => {
    for (const m of models) expect(map[m.name].deletion.length, m.name).toBeGreaterThan(0);
    const restricting = models.flatMap((m) => m.fields.filter((f) => f.relationOnDelete === "Restrict").map((f) => `${m.name}.${f.name}`));
    expect(restricting.sort()).toEqual(["SessionExercise.exercise", "SessionExercise.machine", "SessionExercise.plannedExercise", "TemplateExercise.exercise"]);
    for (const m of ["TemplateExercise", "SessionExercise"]) expect(map[m].deletion).toMatch(/Restricts deleting its exercise/);
  });
  it("deletion names every model that holds a userId", () => {
    const code = readFileSync(path.join(SRC, "lib/server/account/delete.ts"), "utf8");
    const owned = models.filter((m) => m.fields.some((f) => f.name === "userId")).map((m) => m.name);
    expect(owned.length).toBeGreaterThan(8);
    for (const m of owned) {
      const accessor = m[0].toLowerCase() + m.slice(1);
      expect(code, m).toMatch(new RegExp(`tx\\.${accessor}\\.deleteMany\\(\\{ where: \\{ userId \\} \\}\\)`));
    }
  });
  it("the export writes every model with exported fields, and its size check counts all but the single rows", () => {
    const code = readFileSync(path.join(SRC, "lib/server/account/export.ts"), "utf8");
    const exported = Object.keys(map).filter((m) => map[m].export.length > 0);
    expect(exported.length).toBeGreaterThan(8);
    for (const m of exported) {
      expect(code, m).toContain(`exportRow("${m}"`);
      if (m !== "User" && m !== "Profile") expect(code, m).toContain(`tx.${m[0].toLowerCase() + m.slice(1)}.count(`);
    }
  });
  it("deletion removes sign-up tokens by address, as they have no user for a cascade to follow", () => {
    const code = readFileSync(path.join(SRC, "lib/server/account/delete.ts"), "utf8");
    expect(code).toMatch(/tx\.accountToken\.deleteMany\(\{ where: \{ email: locked\[0\]\.email \} \}\)/);
    expect(code).toMatch(/SELECT id, email, "passwordHash" FROM "User"/);
  });
  it("deletion goes through sessions and templates before exercises", () => {
    const code = readFileSync(path.join(SRC, "lib/server/account/delete.ts"), "utf8");
    const at = (s: string) => code.indexOf(`tx.${s}.deleteMany`);
    expect(at("workoutSession")).toBeGreaterThan(-1);
    expect(at("workoutSession")).toBeLessThan(at("exercise"));
    expect(at("workoutTemplate")).toBeLessThan(at("exercise"));
    expect(code.indexOf("tx.user.delete")).toBeGreaterThan(at("session"));
  });
});

describe("export values", () => {
  it("keeps null as null and zero as zero", () => {
    expect(exportValue("kcal", null)).toBeNull();
    expect(exportValue("kcal", undefined)).toBeNull();
    expect(exportValue("kcal", 0)).toBe(0);
    expect(exportValue("kcal", new Prisma.Decimal("0.000"))).toBe(0);
  });
  it("turns decimals into numbers without losing what's stored", () => {
    expect(exportValue("kcalPer100", new Prisma.Decimal("123.456"))).toBe(123.456);
  });
  it("states calendar dates as dates, and moments in UTC", () => {
    const at = new Date("2026-01-02T03:04:05.678Z");
    expect(exportValue("birthDate", at)).toBe("2026-01-02");
    expect(exportValue("date", at)).toBe("2026-01-02");
    expect(exportValue("effectiveFrom", at)).toBe("2026-01-02");
    expect(exportValue("createdAt", at)).toBe("2026-01-02T03:04:05.678Z");
  });
  it("each calendar date in the schema is treated as one", () => {
    const dates = models.flatMap((m) => m.fields.filter((f) => (f as { nativeType?: unknown[] }).nativeType?.[0] === "Date").map((f) => f.name));
    expect(new Set(dates)).toEqual(new Set(["birthDate", "date", "effectiveFrom"]));
  });
  it("gives every mapped field a key, and only mapped fields", () => {
    const row = exportRow("Profile", { name: "Sam", passwordHash: "secret", userId: "u1" });
    expect(Object.keys(row).sort()).toEqual([...map.Profile.export].sort());
    expect(row.sex).toBeNull();
    expect(JSON.stringify(row)).not.toMatch(/secret|u1/);
  });
});

describe("export limits", () => {
  it("refuses a file over the byte limit, rather than cutting it", () => {
    expect(() => serializeExport({ a: "x".repeat(200) }, 100)).toThrow(/too much data/);
    expect(JSON.parse(serializeExport({ a: 1 }, 100).toString("utf8"))).toEqual({ a: 1 });
    expect(MAX_EXPORT_BYTES).toBeGreaterThan(1024 * 1024);
  });
  it("names the file with a date and nothing about the person", () => {
    expect(exportFilename(new Date("2026-11-06T12:00:00Z"))).toBe("fitworkoutfoodtracker-export-2026-11-06.json");
  });
  it("allows one export per person, and frees the slot even after a failure", async () => {
    let release!: () => void;
    const first = withExportSlot("u1", () => new Promise<void>((r) => { release = r; }));
    await expect(withExportSlot("u1", async () => 1)).rejects.toThrow(/already running/);
    release();
    await first;
    await expect(withExportSlot("u1", async () => { throw new Error("db"); })).rejects.toThrow("db");
    await expect(withExportSlot("u1", async () => 2)).resolves.toBe(2);
  });
  it("bounds how many run at once across people", async () => {
    const releases: (() => void)[] = [];
    const running = ["a", "b"].map((u) => withExportSlot(u, () => new Promise<void>((r) => releases.push(r))));
    await expect(withExportSlot("c", async () => 1)).rejects.toThrow(/already running/);
    releases.forEach((r) => r());
    await Promise.all(running);
  });
});

describe("request validation", () => {
  it("requires the exact confirmation word", () => {
    for (const confirmation of ["delete", "DELETE ", "", null, true, undefined]) expect(deleteAccountSchema.safeParse({ password: "x", confirmation }).success).toBe(false);
    expect(deleteAccountSchema.safeParse({ password: "x", confirmation: "DELETE" }).success).toBe(true);
  });
  it("requires a password, and bounds it", () => {
    for (const password of ["", null, undefined, "x".repeat(257)]) expect(accountPasswordSchema.safeParse({ password }).success).toBe(false);
  });
  it("takes no account identifier", () => {
    expect(deleteAccountSchema.parse({ password: "x", confirmation: "DELETE", userId: "u2", email: "b@x" })).toEqual({ password: "x", confirmation: "DELETE" });
  });
});
