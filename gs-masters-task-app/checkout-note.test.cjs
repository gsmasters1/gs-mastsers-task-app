const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "src/App.js"), "utf8");
const start = source.indexOf("async function saveCrewCheckout(");
const end = source.indexOf("function checkoutNoteLabel(", start);
assert.ok(start >= 0 && end > start);
const shift = { id:"ci1", crewId:"crew1", jobId:"job1", date:"2026-11-10" };
const patch = { check_out:"2026-11-10T23:00:00Z" };
let row, rejectNote, rejectCheckout, calls = [];
const ctx = vm.createContext({
  sbGet: async table => table === "field_logs" ? (row ? [row] : []) : [],
  sbPost: async (_table, payload) => {
    calls.push("note");
    if (rejectNote) throw Error("denied");
    row = payload;
  },
  sbFetch: async () => {
    calls.push("checkout");
    if (rejectCheckout) throw Error("offline");
    return [{id:shift.id}];
  },
  translateText: async (text, target, key) => {
    assert.equal(key, "configured");
    return target + ":" + text;
  },
});
vm.runInContext(source.slice(start, end), ctx);
(async () => {
  const save = note => ctx.saveCrewCheckout({ shift, note, patch, translationKey:"configured" });
  await assert.rejects(save(" \n "), /checkout_note_required/);
  assert.deepEqual(calls, []);
  rejectNote = true;
  await assert.rejects(save("Instalé la puerta"), /denied/);
  assert.deepEqual(calls, ["note"]);
  calls = [];
  rejectNote = false;
  rejectCheckout = true;
  await assert.rejects(save("Instalé la puerta"), /offline/);
  assert.deepEqual(calls, ["note", "checkout"]);
  assert.equal(row.text_en, "en:Instalé la puerta");
  assert.equal(row.text_es, "es:Instalé la puerta");
  assert.equal(row.log_date, shift.date);
  calls = [];
  rejectCheckout = false;
  await save("Instalé la puerta");
  assert.deepEqual(calls, ["checkout"]);
  console.log("Crew checkout note requirement, bilingual save and retry passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
