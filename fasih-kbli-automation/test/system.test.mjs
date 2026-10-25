import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { loadMaster, loadQueue } from "../src/data.mjs";
import { assignVisibleSlots, isNaflahOwner, pageHtml, shouldReuseAutomationTab } from "../src/manual-assist.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
test("membaca data dan master aktual", async () => {
  const [rows, master] = await Promise.all([loadQueue(path.join(root, "Data.xlsx"), "Hasil"), loadMaster(path.join(root, "Daftar_Lengkap_KBLI_2025.xlsx"), "KBLI 2025")]);
  assert.ok(rows.length > 0); assert.ok(master.length > 1000); assert.ok(rows[0].owner); assert.match(rows[0].fasihLink, /^https:\/\//);
});
test("slot usaha lain tidak bergeser ketika satu selesai", () => {
  const initial = Array.from({ length: 12 }, (_, i) => ({ rowNumber: i + 1 }));
  const first = assignVisibleSlots(undefined, initial, 10);
  const after = assignVisibleSlots(first.slots, initial.filter((row) => row.rowNumber !== 4), 10);
  assert.deepEqual(after.slots.slice(0, 3), [1, 2, 3]); assert.equal(after.slots[3], 11); assert.equal(after.slots[4], 5);
});
test("skrip halaman pendamping valid", () => {
  const html = pageHtml("token-test", 10);
  const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /keepExisting=status==='#0'/);
  assert.match(script, /keepExistingKbli:keepExisting/);
  assert.match(script, /Mulai otomatis Sesuai \(#0\)/);
  assert.match(script, /autoMode:options\.autoMode===true/);
  assert.match(script, /url\.searchParams\.set\('fasihKbliRequest',requestId\)/);
});
test("tombol otomatis hanya berlaku untuk pemeriksa Naflah", () => {
  assert.equal(isNaflahOwner("Naflah"), true);
  assert.equal(isNaflahOwner("  NAFLAH "), true);
  assert.equal(isNaflahOwner("Dayat"), false);
  assert.equal(shouldReuseAutomationTab({ autoMode: true, status: "#0", owner: "Naflah" }), true);
  assert.equal(shouldReuseAutomationTab({ autoMode: true, status: "#1", owner: "Naflah" }), false);
  assert.equal(shouldReuseAutomationTab({ autoMode: true, status: "#0", owner: "Dayat" }), false);
});
