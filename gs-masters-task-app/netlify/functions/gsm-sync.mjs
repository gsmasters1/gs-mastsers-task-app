// ════════════════════════════════════════════════════════════════════════
//  GS MASTERS — Field App → GSM Builder sync
//  POST { type: 'receipt'|'log'|'task_done', gsmJobId, data }
//  Writes field activity into GSM Builder's app_data STATE JSON blob.
//  Uses anon key (same Supabase project, same permissions as client).
// ════════════════════════════════════════════════════════════════════════

const SB_URL = "https://mkibgjnzbgfqjkhowafr.supabase.co";
const SB_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_zh5Soyi6iNGd8CLxPfD9Lg_dVdAwDe7";

const sbHeaders = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

async function getGSMState() {
  const res = await fetch(`${SB_URL}/rest/v1/app_data?id=eq.gsm-v1&select=data`, { headers: sbHeaders });
  const rows = await res.json();
  return rows?.[0]?.data || null;
}

async function saveGSMState(data) {
  await fetch(`${SB_URL}/rest/v1/app_data?id=eq.gsm-v1`, {
    method: "PATCH",
    headers: { ...sbHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
  });
}

export default async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  let body;
  try { body = await req.json(); }
  catch { return new Response("Bad JSON", { status: 400 }); }

  const { type, gsmJobId, data } = body;
  if (!type || !gsmJobId || !data) {
    return new Response(JSON.stringify({ error: "Need type, gsmJobId, data" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const STATE = await getGSMState();
    if (!STATE) return new Response(JSON.stringify({ error: "GSM Builder state not found" }), { status: 404, headers: { "Content-Type": "application/json" } });

    if (type === "receipt") {
      if (!STATE.expenses) STATE.expenses = [];
      const dupeId = "fe-" + data.id;
      if (!STATE.expenses.find(e => e.id === dupeId)) {
        STATE.expenses.push({
          id: dupeId,
          date: data.createdAt || new Date().toISOString().split("T")[0],
          vendor: data.store || "Field Crew",
          cat: "Miscellaneous / Contingency",
          job: gsmJobId,
          amount: parseFloat(data.amount) || 0,
          receipt: true,
          note: `[Field App] ${data.note || ""}`.trim(),
          source: "field_app",
        });
      }
    }

    if (type === "log" || type === "task_done") {
      if (!STATE.logs) STATE.logs = [];
      const logId = (type === "task_done" ? "ftd-" : "fl-") + data.id;
      if (!STATE.logs.find(l => l.id === logId)) {
        const notes = type === "task_done"
          ? `[Field App] Task completed: ${data.taskTitle || ""}`
          : `[Field App] ${data.en || data.es || ""}`;
        STATE.logs.push({
          id: logId,
          date: data.date || new Date().toISOString().split("T")[0],
          job: gsmJobId,
          crew: data.crewName || "Field Crew",
          hours: 0,
          notes,
          notesEs: data.es || "",
          flag: false,
          source: "field_app",
        });
      }
    }

    STATE._savedAt = Date.now();
    await saveGSMState(STATE);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
