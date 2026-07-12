// ════════════════════════════════════════════════════════════════════════
//  GS MASTERS — Field App → GSM Builder sync
//  POST { type: 'receipt'|'log'|'task_done', gsmJobId, data }
//  Writes directly into gsm_expenses / gsm_logs tables (per-row architecture).
//  anon key has full access — same Supabase project.
// ════════════════════════════════════════════════════════════════════════

const SB_URL = "https://mkibgjnzbgfqjkhowafr.supabase.co";
const SB_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_zh5Soyi6iNGd8CLxPfD9Lg_dVdAwDe7";

const hdr = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

async function isDuplicate(table, id) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=id`, { headers: hdr });
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function insertRow(table, id, data) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...hdr, Prefer: "return=minimal" },
    body: JSON.stringify({ id, data }),
  });
  if (!res.ok) throw new Error(`${table} insert ${res.status}: ${await res.text()}`);
}

export default async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  let body;
  try { body = await req.json(); }
  catch { return new Response("Bad JSON", { status: 400 }); }

  const { type, gsmJobId, data } = body;
  if (!type || !gsmJobId || !data) {
    return new Response(JSON.stringify({ error: "Need type, gsmJobId, data" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    // ── RECEIPT → gsm_expenses ──────────────────────────────────────
    if (type === "receipt") {
      const expId = "fe-" + data.id;
      if (await isDuplicate("gsm_expenses", expId)) {
        return new Response(JSON.stringify({ ok: true, skipped: true }),
          { status: 200, headers: { "Content-Type": "application/json" } });
      }
      const expData = {
        id: expId,
        // Default to catch-all category — Laura can re-categorize in GSM Builder
        cat: "Final Cleanup / Banking / Utilities",
        job: gsmJobId,
        date: (data.createdAt || new Date().toISOString()).slice(0, 10),
        paid: "",
        notes: `[Field App] ${data.store || ""}${data.note ? " — " + data.note : ""}`.trim(),
        amount: parseFloat(data.amount) || 0,
        method: "Field Crew",
        subcat: "Material",
        vendor: data.store || "Field Crew",
        receipt: !!(data.dataUrl),
        source: "field_app",
        checkNum: "",
        invoiceNum: "",
        submittedBy: data.crewName || "Field Crew",
        fieldReceiptId: data.id,
      };
      await insertRow("gsm_expenses", expId, expData);
      return new Response(JSON.stringify({ ok: true, inserted: expId }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // ── LOG / TASK DONE → gsm_logs ──────────────────────────────────
    if (type === "log" || type === "task_done") {
      const logId = (type === "task_done" ? "ftd-" : "fl-") + data.id;
      if (await isDuplicate("gsm_logs", logId)) {
        return new Response(JSON.stringify({ ok: true, skipped: true }),
          { status: 200, headers: { "Content-Type": "application/json" } });
      }
      const logData = {
        id: logId,
        date: data.date || new Date().toISOString().slice(0, 10),
        job: gsmJobId,
        crew: data.crewName || "Field Crew",
        hours: 0,
        notes: type === "task_done"
          ? `[Field App] Task completed: ${data.taskTitle || ""}`
          : `[Field App] ${data.en || data.es || ""}`,
        notesEs: data.es || "",
        flag: false,
        source: "field_app",
      };
      await insertRow("gsm_logs", logId, logData);
      return new Response(JSON.stringify({ ok: true, inserted: logId }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown type: " + type }),
      { status: 400, headers: { "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
