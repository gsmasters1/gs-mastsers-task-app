// ════════════════════════════════════════════════════════════════════════
//  GS MASTERS FIELD APP — Daily Reminder + Auto Clock-Out
//  Scheduled Netlify Function — 22:30 UTC ≈ 5:30 PM Central (CDT)
//  1. Texts crew who are still clocked in — "time to check out"
//  2. Auto-closes all open check-ins (marks auto_closed = true)
//  3. Texts crew who haven't logged today
//  4. Sends admin daily summary
// ════════════════════════════════════════════════════════════════════════

// Falls back to the anon key (RLS allows full anon access on all field_* tables)
const SB_URL   = process.env.SUPABASE_URL || "https://mkibgjnzbgfqjkhowafr.supabase.co";
const SB_KEY   = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "sb_publishable_zh5Soyi6iNGd8CLxPfD9Lg_dVdAwDe7";
const TW_SID   = process.env.TWILIO_ACCOUNT_SID;
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TW_FROM  = process.env.TWILIO_FROM;
const APP_URL  = process.env.APP_URL || "https://quiet-seahorse-2ba028.netlify.app";
const TZ_OFFSET = parseInt(process.env.REMINDER_TZ_OFFSET || "-5", 10);

function localDate() {
  const now = new Date();
  return new Date(now.getTime() + TZ_OFFSET * 3600 * 1000).toISOString().split("T")[0];
}

async function sbGet(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase GET ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sbPatch(path, body) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${res.status}: ${await res.text()}`);
}

async function sendSMS(to, body) {
  if (!TW_SID || !TW_TOKEN || !TW_FROM) return;
  const creds = Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString("base64");
  const params = new URLSearchParams({ To: to, From: TW_FROM, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
  return res.json();
}

export default async (req) => {
  const today = localDate();
  const now = new Date().toISOString();
  const results = { date: today, checkoutReminders: [], autoClosed: [], logReminders: [], adminSummary: null };

  try {
    // ── 1. FIND CREW STILL CLOCKED IN ────────────────────────────────
    const openCheckins = await sbGet(`field_checkins?check_out=is.null&select=id,check_in,crew_id,job_id`);

    // ── 2. SEND CHECK-OUT REMINDER to anyone still on the clock ──────
    if (TW_SID && openCheckins?.length) {
      const profileIds = [...new Set(openCheckins.map(c => c.crew_id))];
      const jobIds     = [...new Set(openCheckins.map(c => c.job_id))];
      const [profiles, jobs] = await Promise.all([
        sbGet(`field_profiles?id=in.(${profileIds.join(",")})&select=id,name,phone,preferred_lang`),
        sbGet(`field_jobs?id=in.(${jobIds.join(",")})&select=id,name`),
      ]);
      const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));
      const jobMap     = Object.fromEntries((jobs || []).map(j => [j.id, j]));

      for (const ci of openCheckins) {
        const p = profileMap[ci.crew_id];
        const j = jobMap[ci.job_id];
        if (!p?.phone) continue;
        const es = p.preferred_lang === "es";
        const hrs = Math.round((new Date(now) - new Date(ci.check_in)) / 36000) / 100;
        const msg = es
          ? `Hola ${p.name.split(" ")[0]}, llevas ${hrs.toFixed(1)} hrs en ${j?.name || "el trabajo"}. ¡No olvides registrar tu salida! ${APP_URL}`
          : `Hi ${p.name.split(" ")[0]}, you've been clocked in ${hrs.toFixed(1)} hrs at ${j?.name || "the job"}. Don't forget to clock out! ${APP_URL}`;
        try {
          await sendSMS(p.phone, msg);
          results.checkoutReminders.push({ name: p.name, sent: true });
        } catch (e) {
          results.checkoutReminders.push({ name: p.name, sent: false, error: e.message });
        }
      }
    }

    // ── 3. AUTO-CLOSE all open check-ins ─────────────────────────────
    for (const ci of (openCheckins || [])) {
      const hrs = Math.round((new Date(now) - new Date(ci.check_in)) / 36000) / 100;
      try {
        await sbPatch(`field_checkins?id=eq.${ci.id}`, {
          check_out: now, hours: hrs, auto_closed: true, method: "auto",
        });
        results.autoClosed.push({ id: ci.id, closed: true });
      } catch (e) {
        results.autoClosed.push({ id: ci.id, closed: false, error: e.message });
      }
    }

    // ── 4. LOG REMINDERS to crew who haven't logged today ─────────────
    if (TW_SID) {
      const crew = await sbGet(`field_profiles?role=eq.crew&active=eq.true&select=id,name,phone,preferred_lang`);
      const todaysLogs = await sbGet(`field_logs?log_date=eq.${today}&select=crew_id`);
      const loggedIds = new Set((todaysLogs || []).map(l => l.crew_id));

      for (const member of (crew || [])) {
        if (loggedIds.has(member.id) || !member.phone) continue;
        const es = member.preferred_lang === "es";
        const link = `${APP_URL}/?log=1`;
        const body = es
          ? `Hola ${member.name.split(" ")[0]}, no olvides registrar tu trabajo de hoy. Toca aquí: ${link}`
          : `Hi ${member.name.split(" ")[0]}, don't forget to log today's work. Tap here: ${link}`;
        try {
          await sendSMS(member.phone, body);
          results.logReminders.push({ name: member.name, sent: true });
        } catch (e) {
          results.logReminders.push({ name: member.name, sent: false, error: e.message });
        }
      }

      // ── 5. DAILY SUMMARY to admin ──────────────────────────────────
      const adminProfile = await sbGet(`field_profiles?role=eq.admin&active=eq.true&select=id,name,phone&limit=1`);
      const admin = adminProfile?.[0];
      if (admin?.phone) {
        try {
          const [checkins, receipts, issues, mats] = await Promise.all([
            sbGet(`field_checkins?work_date=eq.${today}&check_out=not.is.null&auto_closed=eq.false&select=crew_id,hours`),
            sbGet(`field_receipts?created_at=gte.${today}&select=amount&limit=100`),
            sbGet(`field_logs?log_date=eq.${today}&text_en=ilike.*ISSUE*&select=id`),
            sbGet(`field_material_requests?fulfilled=eq.false&select=id`),
          ]);
          const totalHours = (checkins || []).reduce((s, c) => s + (+(c.hours || 0)), 0);
          const workedToday = new Set((checkins || []).map(c => c.crew_id)).size;
          const receiptTotal = (receipts || []).reduce((s, r) => s + (+(r.amount || 0)), 0);
          const summary = [
            `📋 GSM Daily Summary — ${today}`,
            `👷 ${workedToday} crew worked · ${totalHours.toFixed(1)} hrs total`,
            receiptTotal > 0 ? `🧾 Receipts: $${receiptTotal.toFixed(2)}` : "",
            issues?.length ? `🚩 ${issues.length} issue(s) flagged` : "",
            mats?.length ? `🔧 ${mats.length} material request(s) pending` : "",
            `📱 ${APP_URL}`,
          ].filter(Boolean).join("\n");
          await sendSMS(admin.phone, summary);
          results.adminSummary = { sent: true };
        } catch (e) {
          results.adminSummary = { sent: false, error: e.message };
        }
      }
    }

    return new Response(JSON.stringify(results, null, 2),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};

// ── SCHEDULE ──────────────────────────────────────────────────────────
// 22:30 UTC = 5:30 PM CDT (UTC-5, Alabama summer). For CST (winter): "30 23 * * *"
export const config = {
  schedule: "30 22 * * *",
};
