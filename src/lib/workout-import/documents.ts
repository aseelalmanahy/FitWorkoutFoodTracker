/**
 * Phase 3: reading a plan's file in the browser, so the file itself never reaches the server. The type is decided by
 * the file's contents, never its name alone. DOCX and XLSX are ZIP files: only the few entries holding text are read,
 * with limits on the archive and on every entry, declared and actual, so a crafted archive can't exhaust the tab.
 * Pure apart from `inflate`, which the browser passes as its own DecompressionStream and the tests as zlib.
 */
export type PlanFileKind = "pdf" | "image" | "docx" | "xlsx" | "csv" | "txt";
export type Inflate = (data: Uint8Array, maxBytes: number) => Promise<Uint8Array>;

export const FILE_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxZipEntries: 2000,
  maxEntryBytes: 8 * 1024 * 1024,
  maxTextChars: 200_000,
  maxRows: 2000,
  maxColumns: 30,
} as const;

export class PlanFileError extends Error {
  constructor(message: string) { super(message); this.name = "PlanFileError"; }
}

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** What a file is, from its first bytes; text is only text if it decodes as UTF-8 with no control characters. */
export function sniffPlanFile(bytes: Uint8Array, name: string): PlanFileKind {
  if (bytes.length === 0) throw new PlanFileError("The file is empty.");
  if (bytes.length > FILE_LIMITS.maxBytes) throw new PlanFileError("The file is too large. The limit is 10 MB.");
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || startsWith(bytes, [0xff, 0xd8, 0xff]) || (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))) return "image";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const names = zipNames(bytes);
    if (names.includes("word/document.xml")) return "docx";
    if (names.includes("xl/workbook.xml")) return "xlsx";
    throw new PlanFileError("This ZIP file isn't a Word document or an Excel workbook.");
  }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new PlanFileError("This file type isn't supported. Use a PDF, an image, a CSV, TXT, DOCX or XLSX file."); }
  if (/[\x00-\x08\x0e-\x1f]/.test(text)) throw new PlanFileError("This file type isn't supported. Use a PDF, an image, a CSV, TXT, DOCX or XLSX file.");
  return /\.(csv|tsv)$/i.test(name) || looksTabular(text) ? "csv" : "txt";
}

function looksTabular(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  if (lines.length < 2) return false;
  return [",", ";", "\t"].some((d) => { const n = lines[0].split(d).length; return n >= 3 && lines.every((l) => l.split(d).length === n); });
}

// ─── ZIP ─────────────────────────────────────────────────────────────────────

type ZipEntry = { name: string; method: number; flags: number; compressed: number; size: number; offset: number };

function zipEntries(b: Uint8Array): ZipEntry[] {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new PlanFileError("This file is damaged and couldn't be read.");
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  if (count > FILE_LIMITS.maxZipEntries || count === 0xffff || at === 0xffffffff) throw new PlanFileError("This file has too many parts to read safely.");
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > b.length || view.getUint32(at, true) !== 0x02014b50) throw new PlanFileError("This file is damaged and couldn't be read.");
    const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true), size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true), extraLen = view.getUint16(at + 30, true), commentLen = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(b.subarray(at + 46, at + 46 + nameLen));
    out.push({ name, method, flags, compressed, size, offset });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
const zipNames = (b: Uint8Array) => { try { return zipEntries(b).map((e) => e.name); } catch { return []; } };

async function zipRead(b: Uint8Array, wanted: string, inflate: Inflate): Promise<string | null> {
  const e = zipEntries(b).find((x) => x.name === wanted);
  if (!e) return null;
  if (e.flags & 1) throw new PlanFileError("This file is encrypted, so it can't be read.");
  if (e.size > FILE_LIMITS.maxEntryBytes || e.compressed > b.length) throw new PlanFileError("This file is too large to read safely.");
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (e.offset + 30 > b.length || view.getUint32(e.offset, true) !== 0x04034b50) throw new PlanFileError("This file is damaged and couldn't be read.");
  const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
  const data = b.subarray(start, start + e.compressed);
  let raw: Uint8Array;
  if (e.method === 0) raw = data;
  // The declared size can lie: inflating stops at the limit, and a part that would exceed it is refused.
  else if (e.method === 8) raw = await inflate(data, FILE_LIMITS.maxEntryBytes).catch(() => { throw new PlanFileError("This file is too large or damaged to read safely."); });
  else throw new PlanFileError("This file uses a compression that isn't supported.");
  if (raw.length > FILE_LIMITS.maxEntryBytes) throw new PlanFileError("This file is too large to read safely.");
  return new TextDecoder().decode(raw);
}

// ─── XML text, without a parser: these formats keep text in a few known elements ────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeXml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()]));

function docxParagraph(xml: string): string {
  return decodeXml(xml.replace(/<w:tab\/>/g, "\t").replace(/<w:br\/>/g, "\n").replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<[^>]+>/g, (_, t) => t ?? ""));
}

/** A Word document's text, in order; each table row is one line of cells separated by tabs. */
export async function readDocx(bytes: Uint8Array, inflate: Inflate): Promise<{ text: string; rows: string[][] }> {
  const xml = await zipRead(bytes, "word/document.xml", inflate);
  if (xml === null) throw new PlanFileError("This Word document has no text.");
  const lines: string[] = [];
  const rows: string[][] = [];
  const body = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (table) => {
    for (const tr of table.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) ?? []) {
      const cells = (tr.match(/<w:tc[\s>][\s\S]*?<\/w:tc>/g) ?? []).map((tc) => (tc.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) ?? []).map(docxParagraph).join(" ").trim());
      rows.push(cells.slice(0, FILE_LIMITS.maxColumns));
      lines.push(cells.join("\t"));
    }
    return "";
  });
  for (const p of body.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) ?? []) lines.push(docxParagraph(p));
  const text = lines.join("\n");
  if (text.length > FILE_LIMITS.maxTextChars) throw new PlanFileError("This document holds too much text to read safely.");
  return { text, rows: rows.slice(0, FILE_LIMITS.maxRows) };
}

const columnIndex = (ref: string) => [...ref.replace(/\d+$/, "")].reduce((n, ch) => n * 26 + ch.toUpperCase().charCodeAt(0) - 64, 0) - 1;

/** The first worksheet of an Excel workbook, as rows of cell text (shared and inline strings, and numbers). */
export async function readXlsx(bytes: Uint8Array, inflate: Inflate): Promise<string[][]> {
  const shared = (await zipRead(bytes, "xl/sharedStrings.xml", inflate)) ?? "";
  const strings = (shared.match(/<si[\s>][\s\S]*?<\/si>/g) ?? []).map((si) => decodeXml((si.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
  const sheet = await zipRead(bytes, "xl/worksheets/sheet1.xml", inflate);
  if (sheet === null) throw new PlanFileError("This workbook has no first sheet to read.");
  const rows: string[][] = [];
  for (const row of sheet.match(/<row[\s>][\s\S]*?<\/row>/g) ?? []) {
    if (rows.length >= FILE_LIMITS.maxRows) break;
    const cells: string[] = [];
    for (const c of row.match(/<c\s[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
      const ref = /\br="([A-Z]+\d+)"/.exec(c)?.[1];
      const type = /\bt="([a-zA-Z]+)"/.exec(c)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(c)?.[1];
      const inline = /<is>[\s\S]*?<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(c)?.[1];
      const value = type === "s" ? strings[Number(v)] ?? "" : type === "inlineStr" ? decodeXml(inline ?? "") : decodeXml(v ?? "");
      const i = ref ? columnIndex(ref) : cells.length;
      if (i >= 0 && i < FILE_LIMITS.maxColumns) cells[i] = value;
    }
    rows.push(Array.from(cells, (x) => x ?? ""));
  }
  return rows;
}

/** CSV or TSV with quoted fields; the delimiter is whichever of comma, semicolon or tab the first line uses most. */
export function readCsv(text: string): string[][] {
  if (text.length > FILE_LIMITS.maxTextChars) throw new PlanFileError("This file holds too much text to read safely.");
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const d = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === d) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row.slice(0, FILE_LIMITS.maxColumns)); row = []; cell = "";
      if (rows.length >= FILE_LIMITS.maxRows) return rows;
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row.slice(0, FILE_LIMITS.maxColumns)); }
  return rows.map((r) => r.map((c) => c.trim()));
}
