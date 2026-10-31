// Prevent duplicate checkout SMS for crew who have multiple open jobs.
// Independent of input ordering; choose the latest timestamp for context.
export function uniqueLatestCrewCheckins(rows = []) {
  const byCrew = new Map();
  for (const row of rows) {
    if (!row?.crew_id) continue;
    const existing = byCrew.get(row.crew_id);
    if (!existing || Date.parse(row.check_in || 0) > Date.parse(existing.check_in || 0)) {
      byCrew.set(row.crew_id, row);
    }
  }
  return [...byCrew.values()];
}
