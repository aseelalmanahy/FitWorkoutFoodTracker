// Phase 3 fixtures: workout plans as real files of every supported kind, and hostile ones, built here byte by byte.
"use strict";
const { crc32, deflateRawSync } = require("node:zlib");
const sharp = require("sharp");
const { buildPdf, textPage } = require("./pdf-fixtures.cjs");

/** A ZIP of the given entries. `lie` declares a 10-byte size; `encrypt` sets the encryption flag. */
function zip(entries, { lie = false, encrypt = false } = {}) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const raw = Buffer.from(content);
    const data = deflateRawSync(raw);
    const n = Buffer.from(name);
    const size = lie ? 10 : raw.length;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(encrypt ? 1 : 0, 6); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc32(raw), 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(size, 22); head.writeUInt16LE(n.length, 26);
    locals.push(head, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(encrypt ? 1 : 0, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc32(raw), 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(size, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    centrals.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const para = (t) => `<w:p><w:r><w:t xml:space="preserve">${xml(t)}</w:t></w:r></w:p>`;
const cell = (t) => `<w:tc>${para(t)}</w:tc>`;

/** A Word document: paragraphs, then optionally a table. */
function docx(paragraphs, table = []) {
  const tbl = table.length ? `<w:tbl>${table.map((r) => `<w:tr>${r.map(cell).join("")}</w:tr>`).join("")}</w:tbl>` : "";
  return zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map(para).join("")}${tbl}</w:body></w:document>` });
}

/** An Excel workbook with one sheet, every cell an inline string or a number. */
function xlsx(rows) {
  const col = (i) => String.fromCharCode(65 + i);
  const sheet = rows.map((r, y) => `<row r="${y + 1}">${r.map((v, x) => (v === "" ? "" : /^\d+(\.\d+)?$/.test(v) ? `<c r="${col(x)}${y + 1}"><v>${v}</v></c>` : `<c r="${col(x)}${y + 1}" t="inlineStr"><is><t>${xml(v)}</t></is></c>`)).join("")}</row>`).join("");
  return zip({ "[Content_Types].xml": "<Types/>", "xl/workbook.xml": "<workbook/>", "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${sheet}</sheetData></worksheet>` });
}

/** A phone-sized screenshot of a plan: dark text on white, as a notes app shows it. */
async function screenshot(lines, { format = "png" } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${160 + lines.length * 74}"><rect width="100%" height="100%" fill="#ffffff"/>${lines.map((l, i) => `<text x="60" y="${120 + i * 74}" font-family="Arial" font-size="44" fill="#111111">${xml(l)}</text>`).join("")}</svg>`;
  const img = sharp(Buffer.from(svg));
  return format === "jpeg" ? img.jpeg({ quality: 92 }).toBuffer() : img.png().toBuffer();
}

const PLAN_LINES = ["Strength Block", "Monday - Upper", "Barbell Bench Press 4x6-8 @ 80kg", "Pull-Up 3x8", "Thursday - Lower", "Squat 5x5 @ 225 lbs", "RDL 3x10"];

module.exports = {
  zip, docx, xlsx, screenshot, PLAN_LINES,
  textPdf: (lines) => buildPdf({ pages: [textPage(lines, { columnX: [72, 300, 380, 460] })] }),
  scannedPdf: async (lines) => {
    const jpeg = await screenshot(lines, { format: "jpeg" });
    const meta = await sharp(jpeg).metadata();
    return buildPdf({ pages: [{ width: 612, height: 792, image: { jpeg, width: meta.width, height: meta.height }, content: "" }] });
  },
};
