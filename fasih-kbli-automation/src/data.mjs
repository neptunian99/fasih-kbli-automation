import { readSheet, writeStatusCell } from "./xlsx.mjs";

const text = (value) => String(value ?? "").trim();
const codeFrom = (value) => text(value).match(/\b\d{5}\b/)?.[0] ?? text(value).replace(/\.0$/, "");

export async function loadMaster(filePath, sheetName) {
  const rows = await readSheet(filePath, sheetName);
  const items = [];
  for (const row of rows.slice(1)) {
    const label = text(row.values[0]);
    const match = label.match(/^\[([^\]]+)\]\s*(\d{5})\s+(.+)$/);
    if (!match) continue;
    items.push({ category: match[1], code: match[2], title: match[3], label });
  }
  if (!items.length) throw new Error("Daftar master KBLI kosong atau formatnya tidak dikenali.");
  return items;
}

export async function loadQueue(filePath, sheetName) {
  const rows = await readSheet(filePath, sheetName);
  const header = rows.find((row) => row.rowNumber === 1)?.values ?? [];
  const expected = { A: "Nama", B: "Status", AC: "LINK", AD: "nama_usaha" };
  const index = (column) => {
    let value = 0;
    for (const char of column) value = value * 26 + char.charCodeAt(0) - 64;
    return value - 1;
  };
  for (const [column, name] of Object.entries(expected)) {
    if (text(header[index(column)]) !== name) throw new Error(`Header ${column} harus ${name}, terbaca ${text(header[index(column)]) || "(kosong)"}.`);
  }
  return rows.filter((row) => row.rowNumber > 1 && text(row.values[1]) === "" && text(row.values[0]) !== "")
    .map((row) => ({
      rowNumber: row.rowNumber,
      owner: text(row.values[index("A")]),
      businessName: text(row.values[index("AD")]) || text(row.values[index("L")]) || `(baris ${row.rowNumber})`,
      fasihLink: text(row.values[index("AC")]),
      previousCategory: text(row.values[index("M")]),
      previousCode: codeFrom(row.values[index("O")]),
      centralCategory: text(row.values[index("Y")]),
      centralReason: text(row.values[index("W")]),
      nfrqCode: codeFrom(row.values[index("AP")]),
      nfrqLabel: text(row.values[index("AP")]),
      nfrqCategory: text(row.values[index("AQ")]),
      nfrqStatus: text(row.values[index("AR")]),
      nfrqReason: text(row.values[index("AS")]),
      note: text(row.values[index("AF")]),
      evidence: ["L", "AG", "AH", "AI", "AJ", "AK", "AL", "AM", "AN", "AO"].map((column) => ({
        column,
        label: text(header[index(column)]) || column,
        value: text(row.values[index(column)]),
      })).filter((item) => item.value),
    }));
}

export async function writeStatusVerified({ filePath, sheetName, rowNumber, status, expectedBusinessName }) {
  const current = await loadQueue(filePath, sheetName);
  const row = current.find((item) => item.rowNumber === rowNumber);
  if (!row) throw new Error(`Baris ${rowNumber} tidak lagi berstatus kosong. Penulisan dibatalkan.`);
  if (text(row.businessName) !== text(expectedBusinessName)) {
    throw new Error(`Identitas baris ${rowNumber} berubah: target ${expectedBusinessName}, terbaca ${row.businessName}.`);
  }
  await writeStatusCell(filePath, sheetName, rowNumber, status);
  const allRows = await readSheet(filePath, sheetName);
  const written = text(allRows.find((item) => item.rowNumber === rowNumber)?.values?.[1]);
  if (written !== status) throw new Error(`Status ${status} baris ${rowNumber} tidak terverifikasi; terbaca ${written || "(kosong)"}.`);
}
