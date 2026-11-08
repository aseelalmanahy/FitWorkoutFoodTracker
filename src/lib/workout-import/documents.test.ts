// Phase 3: reading plan files by their contents, including crafted and hostile ones. ZIPs are built here, byte by byte.
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { FILE_LIMITS, PlanFileError, readCsv, readDocx, readXlsx, sniffPlanFile, type Inflate } from "./documents";
import { parseWorkoutTable, parseWorkoutText } from "./parse";

const inflate: Inflate = async (data, maxBytes) => new Uint8Array(inflateRawSync(data, { maxOutputLength: maxBytes }));
const enc = (s: string) => new TextEncoder().encode(s);

/** A ZIP of the given entries. `lie` declares a smaller size than the real one; `encrypt` sets the encryption flag. */
function zip(entries: Record<string, string | Uint8Array>, { lie = false, encrypt = false, store = false } = {}): Uint8Array {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const raw = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
    const data = store ? raw : deflateRawSync(raw);
    const n = Buffer.from(name);
    const size = lie ? 10 : raw.length;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(encrypt ? 1 : 0, 6); head.writeUInt16LE(store ? 0 : 8, 8);
    head.writeUInt32LE(crc32(raw), 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(size, 22); head.writeUInt16LE(n.length, 26);
    locals.push(head, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(encrypt ? 1 : 0, 8); c.writeUInt16LE(store ? 0 : 8, 10);
    c.writeUInt32LE(crc32(raw), 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(size, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    centrals.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const docxXml = `<?xml version="1.0"?><w:document><w:body>${p("Strength &amp; Size")}${p("Day 1 – Monday")}${p("Back Squat 5x5 @ 100kg")}
<w:tbl><w:tr><w:tc>${p("Exercise")}</w:tc><w:tc>${p("Sets")}</w:tc><w:tc>${p("Reps")}</w:tc></w:tr><w:tr><w:tc>${p("Leg Curl")}</w:tc><w:tc>${p("3")}</w:tc><w:tc>${p("12")}</w:tc></w:tr></w:tbl></w:body></w:document>`;

describe("what a file is, from its contents", () => {
  it("PDF, images, DOCX, XLSX, CSV and text", () => {
    expect(sniffPlanFile(enc("%PDF-1.7\n..."), "x.pdf")).toBe("pdf");
    expect(sniffPlanFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]), "x.png")).toBe("image");
    expect(sniffPlanFile(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "x.jpg")).toBe("image");
    expect(sniffPlanFile(new Uint8Array([...enc("RIFF"), 0, 0, 0, 0, ...enc("WEBP")]), "x.webp")).toBe("image");
    expect(sniffPlanFile(zip({ "word/document.xml": docxXml }), "plan.docx")).toBe("docx");
    expect(sniffPlanFile(zip({ "xl/workbook.xml": "<workbook/>" }), "plan.xlsx")).toBe("xlsx");
    expect(sniffPlanFile(enc("Exercise,Sets,Reps\nSquat,3,5"), "plan.csv")).toBe("csv");
    expect(sniffPlanFile(enc("Squat 3x5\nBench 3x5"), "plan.txt")).toBe("txt");
  });
  it("a name doesn't decide it, and anything else is refused, saying what is supported", () => {
    expect(sniffPlanFile(enc("Squat 3x5"), "plan.pdf")).toBe("txt");
    for (const [bytes, name] of [[new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]), "plan.pdf"], [new Uint8Array([0xc3, 0x28, 0xa0]), "plan.txt"], [zip({ "other.txt": "x" }), "plan.docx"], [new Uint8Array(), "plan.txt"], [new Uint8Array(FILE_LIMITS.maxBytes + 1).fill(65), "big.txt"]] as const) {
      expect(() => sniffPlanFile(bytes, name), name).toThrow(PlanFileError);
    }
  });
});

describe("Word documents", () => {
  it("paragraphs and table rows, in order, with entities decoded", async () => {
    const { text, rows } = await readDocx(zip({ "word/document.xml": docxXml }), inflate);
    expect(text.split("\n")).toEqual(["Exercise\tSets\tReps", "Leg Curl\t3\t12", "Strength & Size", "Day 1 – Monday", "Back Squat 5x5 @ 100kg"]);
    expect(rows).toEqual([["Exercise", "Sets", "Reps"], ["Leg Curl", "3", "12"]]);
    const draft = parseWorkoutText(text);
    expect(draft.days.flatMap((d) => d.exercises.map((e) => e.name))).toContain("Back Squat");
  });
  it("refuses an encrypted part, a part whose real size exceeds the limit, and a part declared too large", async () => {
    await expect(readDocx(zip({ "word/document.xml": docxXml }, { encrypt: true }), inflate)).rejects.toThrow(/encrypted/);
    const bomb = "a".repeat(FILE_LIMITS.maxEntryBytes + 1024); // compresses to a few KB
    await expect(readDocx(zip({ "word/document.xml": bomb }, { lie: true }), inflate)).rejects.toThrow(/too large or damaged/);
    await expect(readDocx(zip({ "word/document.xml": bomb }), inflate)).rejects.toThrow(/too large/);
    await expect(readDocx(zip({ "word/other.xml": "x" }), inflate)).rejects.toThrow(/no text/);
    await expect(readDocx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), inflate)).rejects.toThrow(/damaged/);
  });
});

describe("Excel workbooks", () => {
  it("the first sheet, with shared, inline and numeric cells in their columns", async () => {
    const shared = `<sst><si><t>Exercise</t></si><si><t>Sets</t></si><si><t>Reps</t></si><si><t>Weight (kg)</t></si><si><t>Bench Press</t></si><si><r><t>Pull</t></r><r><t>-Up</t></r></si></sst>`;
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>
      <row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2"><v>4</v></c><c r="C2" t="inlineStr"><is><t>6-8</t></is></c><c r="D2"><v>82.5</v></c></row>
      <row r="3"><c r="A3" t="s"><v>5</v></c><c r="C3"><v>10</v></c></row>
    </sheetData></worksheet>`;
    const rows = await readXlsx(zip({ "xl/workbook.xml": "<workbook/>", "xl/sharedStrings.xml": shared, "xl/worksheets/sheet1.xml": sheet }), inflate);
    expect(rows).toEqual([["Exercise", "Sets", "Reps", "Weight (kg)"], ["Bench Press", "4", "6-8", "82.5"], ["Pull-Up", "", "10"]]);
    const draft = parseWorkoutTable(rows);
    expect(draft.days[0].exercises[0]).toMatchObject({ name: "Bench Press", sets: 4, repsMin: 6, repsMax: 8, weight: { value: 82.5, unit: "kg" } });
    expect(draft.days[0].exercises[1]).toMatchObject({ name: "Pull-Up", sets: null, repsMin: 10 });
  });
});

describe("CSV", () => {
  it("quotes, embedded delimiters and line breaks, and semicolons", () => {
    expect(readCsv('Exercise,Sets,Reps,Notes\n"Bench Press, paused",3,5,"say ""slow"""\r\nSquat,3,5,\n')).toEqual([["Exercise", "Sets", "Reps", "Notes"], ["Bench Press, paused", "3", "5", 'say "slow"'], ["Squat", "3", "5", ""]]);
    expect(readCsv("Exercise;Sets;Reps\nSquat;3;5")).toEqual([["Exercise", "Sets", "Reps"], ["Squat", "3", "5"]]);
  });
  it("is bounded in rows and columns", () => {
    const rows = readCsv(Array.from({ length: FILE_LIMITS.maxRows + 50 }, () => Array.from({ length: 40 }, () => "x").join(",")).join("\n"));
    expect(rows).toHaveLength(FILE_LIMITS.maxRows);
    expect(rows[0]).toHaveLength(FILE_LIMITS.maxColumns);
  });
});
