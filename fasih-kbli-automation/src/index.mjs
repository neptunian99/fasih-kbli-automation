import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMaster, loadQueue } from "./data.mjs";
import { runManualAssist } from "./manual-assist.mjs";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await fs.readFile(path.join(projectDir, "config.json"), "utf8"));
config.dataFile = path.resolve(projectDir, config.dataFile);
config.masterFile = path.resolve(projectDir, config.masterFile);
const [rows, master] = await Promise.all([
  loadQueue(config.dataFile, config.dataSheet),
  loadMaster(config.masterFile, config.masterSheet),
]);
if (!rows.length) throw new Error("Tidak ada baris berstatus kosong pada sheet Hasil.");
await runManualAssist({ rows, master, config });
