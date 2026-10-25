import fs from "node:fs/promises";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { readZipEntries } from "./zip.mjs";

const XML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const escapeXml = (value) => String(value).replace(/[&<>"']/g, (char) => XML_ESCAPES[char]);
const decodeXml = (value) => String(value ?? "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function sharedStrings(entries) {
  const xml = entries.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  return [...xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((match) =>
    decodeXml([...match[1].matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((item) => item[1]).join("")));
}

function workbookSheetPath(entries, sheetName) {
  const workbook = entries.get("xl/workbook.xml")?.toString("utf8");
  const rels = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8");
  if (!workbook || !rels) throw new Error("Struktur workbook XLSX tidak lengkap.");
  const sheets = [...workbook.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>(?:<\/(?:\w+:)?sheet>)?/g)];
  const selected = sheets.find((match) => decodeXml(match[1].match(/\bname="([^"]*)"/)?.[1]) === sheetName);
  if (!selected) throw new Error(`Sheet ${sheetName} tidak ditemukan.`);
  const relId = selected[1].match(/\br:id="([^"]+)"/)?.[1];
  const relation = [...rels.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/g)]
    .find((match) => match[1].match(/\bId="([^"]+)"/)?.[1] === relId);
  const target = relation?.[1].match(/\bTarget="([^"]+)"/)?.[1];
  if (!target) throw new Error(`Relasi sheet ${sheetName} tidak ditemukan.`);
  const normalizedTarget = target.replace(/^\//, "");
  return path.posix.normalize(normalizedTarget.startsWith("xl/") ? normalizedTarget : path.posix.join("xl", normalizedTarget));
}

function columnNumber(reference) {
  const letters = String(reference).match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "";
  let result = 0;
  for (const char of letters) result = result * 26 + char.charCodeAt(0) - 64;
  return result;
}

function cellValue(cellXml, strings) {
  const type = cellXml.match(/<(?:\w+:)?c\b[^>]*\bt="([^"]+)"/)?.[1] ?? "";
  if (type === "inlineStr") {
    return decodeXml([...cellXml.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((item) => item[1]).join(""));
  }
  const raw = cellXml.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1] ?? "";
  if (type === "s") return strings[Number(raw)] ?? "";
  if (type === "b") return raw === "1";
  return decodeXml(raw);
}

export async function readSheet(filePath, sheetName) {
  const buffer = await fs.readFile(filePath);
  const entries = readZipEntries(buffer);
  const sheetPath = workbookSheetPath(entries, sheetName);
  const xml = entries.get(sheetPath)?.toString("utf8");
  if (!xml) throw new Error(`XML sheet ${sheetName} tidak ditemukan.`);
  const strings = sharedStrings(entries);
  const rows = [];
  for (const rowMatch of xml.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const rowNumber = Number(rowMatch[1].match(/\br="(\d+)"/)?.[1]);
    if (!Number.isInteger(rowNumber)) continue;
    const values = [];
    for (const cellMatch of rowMatch[2].matchAll(/<(?:\w+:)?c\b[^>]*\br="([A-Z]+\d+)"[^>]*>[\s\S]*?<\/(?:\w+:)?c>|<(?:\w+:)?c\b[^>]*\br="([A-Z]+\d+)"[^>]*\/>/gi)) {
      const reference = cellMatch[1] || cellMatch[2];
      values[columnNumber(reference) - 1] = cellValue(cellMatch[0], strings);
    }
    rows.push({ rowNumber, values });
  }
  return rows;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipEntries(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, contentValue] of entries) {
    const nameBuffer = Buffer.from(name, "utf8");
    const content = Buffer.from(contentValue);
    const compressed = deflateRawSync(content, { level: 6 });
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22); local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28); central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + compressed.length;
  }
  const centralSize = centralParts.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function replaceStatusCell(xml, rowNumber, status) {
  const rowPattern = new RegExp(`<row\\b([^>]*\\br="${rowNumber}"[^>]*)>([\\s\\S]*?)<\\/row>`);
  const rowMatch = xml.match(rowPattern);
  if (!rowMatch) throw new Error(`Baris ${rowNumber} tidak ditemukan pada XML sheet.`);
  const reference = `B${rowNumber}`;
  const cellPattern = new RegExp(`<c\\b([^>]*\\br="${reference}"[^>]*)>[\\s\\S]*?<\\/c>|<c\\b([^>]*\\br="${reference}"[^>]*)\\/>`, "i");
  const current = rowMatch[2].match(cellPattern)?.[0] ?? "";
  const attrs = (current.match(/<c\b([^>]*)/i)?.[1] ?? ` r="${reference}"`)
    .replace(/\s+t="[^"]*"/i, "");
  const cell = `<c${attrs} t="inlineStr"><is><t>${escapeXml(status)}</t></is></c>`;
  let cells;
  if (current) cells = rowMatch[2].replace(cellPattern, cell);
  else {
    const candidates = [...rowMatch[2].matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*(?:>[\s\S]*?<\/c>|\/\>)/gi)];
    const next = candidates.find((match) => columnNumber(match[1]) > 2);
    cells = next ? rowMatch[2].slice(0, next.index) + cell + rowMatch[2].slice(next.index) : rowMatch[2] + cell;
  }
  return xml.replace(rowPattern, `<row${rowMatch[1]}>${cells}</row>`);
}

export async function writeStatusCell(filePath, sheetName, rowNumber, status) {
  const buffer = await fs.readFile(filePath);
  const entries = readZipEntries(buffer);
  const sheetPath = workbookSheetPath(entries, sheetName);
  const xml = entries.get(sheetPath)?.toString("utf8");
  if (!xml) throw new Error(`XML sheet ${sheetName} tidak ditemukan.`);
  entries.set(sheetPath, Buffer.from(replaceStatusCell(xml, rowNumber, status), "utf8"));
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, zipEntries(entries));
  await fs.rename(temporary, filePath);
}
