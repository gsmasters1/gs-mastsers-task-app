import test from "node:test";
import assert from "node:assert/strict";
import { uniqueLatestCrewCheckins } from "./field-reminder-dedupe.mjs";

test("two open jobs for one crew member yield one reminder", () => {
  const rows = [
    { id: "a", crew_id: "u1", check_in: "2026-10-30T12:00:00Z" },
    { id: "b", crew_id: "u1", check_in: "2026-10-30T14:00:00Z" },
    { id: "c", crew_id: "u2", check_in: "2026-10-30T10:00:00Z" }
  ];
  assert.deepEqual(uniqueLatestCrewCheckins(rows).map(r => r.id), ["b", "c"]);
});

test("empty and malformed inputs cannot generate a reminder", () => {
  assert.deepEqual(uniqueLatestCrewCheckins([]), []);
  assert.deepEqual(uniqueLatestCrewCheckins([{ id: "x" }]), []);
});
