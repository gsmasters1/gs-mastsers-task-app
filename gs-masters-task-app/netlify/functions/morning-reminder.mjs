// ════════════════════════════════════════════════════════════════════════
//  GS MASTERS — 7am morning check-in reminder
//  Runs Mon–Sat at 12:00 UTC (7am CDT / 6am CST)
//  Texts active crew who haven't checked in yet: check in when you arrive.
//  Also: tasks due today / overdue for that person (no extra text -- it's
//  folded into this one), plus one overdue summary text to the office.
// ════════════════════════════════════════════════════════════════════════

const SB_URL  = process.env.SUPABASE_URL || "https://mkibgjnzbgfqjkhowafr.supabase.co";
const SB_KEY  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "sb_publishable_zh5Soyi6iNGd8CLxPfD9Lg_dVdAwDe7";
const TW_SID  = process.env.TWILIO_ACCOUNT_SID;
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TW_FROM = process.env.TWILIO_FROM;
const APP_URL = process.env.APP_URL || "https://quiet-seahorse-2ba028.netlify.app";
const ADMIN_PHONE = process.env.ADMIN_PHONE || "+12053699710";

// DST-proof: real Central time, not a fixed offset
const localDate  = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
const centralHour = () => parseInt(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }).format(new Date()), 10);

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase GET ${r.status}: ${await r.text()}`);
  return r.json();
}

async function sendSMS(to, body) {
  const digits = to.replace(/\D/g, "");
  const normalized = digits.length === 10 ? `+1${digits}` : `+${digits}`;
  const creds = Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString("base64");
  const params = new URLSearchParams({ To: normalized, From: TW_FROM, Body: body });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!r.ok) throw new Error(`Twilio ${r.status}: ${await r.text()}`);
  return r.json();
}

export default async () => {
  if (!TW_SID || !TW_TOKEN || !TW_FROM) return new Response("Missing Twilio env", { status: 500 });
  // Cron fires at both UTC hours; only the one that is 7am Central proceeds
  if (centralHour() !== 7) return new Response(JSON.stringify({ skipped: "not 7am Central" }), { status: 200 });
  const today = localDate();
  const results = { date: today, sent: [], skipped: [] };

  try {
    const [crew, todaysCheckins, dispatches, jobs, dueTasks] = await Promise.all([
      sbGet(`field_profiles?role=eq.crew&active=eq.true&select=id,name,phone,preferred_lang`),
      sbGet(`field_checkins?work_date=eq.${today}&select=crew_id`),
      sbGet(`field_dispatch?date=eq.${today}&select=crew_id,job_ids`),
      sbGet(`field_jobs?status=neq.closed&select=id,name`),
      // Due today or overdue, still open (recurring tasks have no real due date)
      sbGet(`field_tasks?status=eq.pending&recurring=eq.false&due_date=lte.${today}&select=id,title,title_es,due_date,assigned_to,job_id`).catch(() => []),
    ]);
    const checkedIn = new Set((todaysCheckins || []).map(c => c.crew_id));
    const jobMap = Object.fromEntries((jobs || []).map(j => [j.id, j.name]));

    for (const p of (crew || [])) {
      if (!p.phone) { results.skipped.push({ name: p.name, reason: "no phone" }); continue; }
      if (checkedIn.has(p.id)) { results.skipped.push({ name: p.name, reason: "already checked in" }); continue; }

      const first = p.name.split(" ")[0];
      const es = p.preferred_lang === "es";
      const disp = (dispatches || []).find(d => d.crew_id === p.id);
      const stops = (disp?.job_ids || []).map(id => jobMap[id]?.split(",")[0]).filter(Boolean);
      const stopLine = stops.length
        ? (es ? `Hoy: ${stops.join(" → ")}. ` : `Today: ${stops.join(" → ")}. `)
        : "";
      const mine = (dueTasks || []).filter(t => (t.assigned_to || []).includes(p.id));
      const dueToday = mine.filter(t => t.due_date === today).map(t => (es && t.title_es) || t.title);
      const overdueN = mine.filter(t => t.due_date < today).length;
      const dueLine = (dueToday.length ? (es ? `Vence hoy: ${dueToday.slice(0, 3).join(", ")}${dueToday.length > 3 ? "…" : ""}. ` : `Due today: ${dueToday.slice(0, 3).join(", ")}${dueToday.length > 3 ? "…" : ""}. `) : "")
        + (overdueN ? (es ? `${overdueN} tarea(s) atrasada(s). ` : `${overdueN} overdue task${overdueN !== 1 ? "s" : ""}. `) : "");

      const msg = es
        ? `GS Masters: Buenos días ${first}. ${stopLine}${dueLine}Registra tu entrada al llegar al trabajo y anota tu trabajo del día. → ${APP_URL}`
        : `GS Masters: Good morning ${first}. ${stopLine}${dueLine}Check in when you arrive at the job, and don't forget to log your work today. → ${APP_URL}`;

      try { await sendSMS(p.phone, msg); results.sent.push(p.name); }
      catch (e) { results.skipped.push({ name: p.name, reason: e.message }); }
    }

    // One summary to the office when anything is overdue.
    const overdue = (dueTasks || []).filter(t => t.due_date < today);
    if (overdue.length) {
      const nameOf = id => (crew || []).find(c => c.id === id)?.name?.split(" ")[0] || "?";
      const lines = overdue.slice(0, 5).map(t => `• ${t.title} (${(t.assigned_to || []).map(nameOf).join("/") || "unassigned"}, due ${t.due_date.slice(5)})`);
      const body = `GS Field: ${overdue.length} overdue task${overdue.length !== 1 ? "s" : ""}:\n${lines.join("\n")}${overdue.length > 5 ? `\n+${overdue.length - 5} more` : ""}`;
      try { await sendSMS(ADMIN_PHONE, body); results.adminSummary = overdue.length; }
      catch (e) { results.adminSummaryError = e.message; }
    }

    return new Response(JSON.stringify(results, null, 2), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};

// Fires 12:00 + 13:00 UTC Mon-Sat; centralHour() guard picks whichever is 7am CT (CDT or CST). No Sunday texts.
export const config = { schedule: "0 12,13 * * 1-6" };
