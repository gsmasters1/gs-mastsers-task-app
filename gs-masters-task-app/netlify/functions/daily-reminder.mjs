// ════════════════════════════════════════════════════════════════════════
//  GS MASTERS FIELD APP — Daily Log Reminder (Scheduled Netlify Function)
//  Runs on a cron schedule. Checks which active crew haven't logged today,
//  and texts them via Twilio with a deep link straight to their log screen.
// ════════════════════════════════════════════════════════════════════════

// Env vars to set in Netlify → Site settings → Environment variables:
//   SUPABASE_URL            e.g. https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY    (service_role key — server side only, never in the app)
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM             your GS Masters Twilio number, e.g. +12055550100
//   APP_URL                 e.g. https://gsmfield.netlify.app
//   REMINDER_TZ_OFFSET      hours from UTC for Central (Alabama). CST=-6, CDT=-5. Default -5.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const TW_SID = process.env.TWILIO_ACCOUNT_SID;
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TW_FROM = process.env.TWILIO_FROM;
const APP_URL = process.env.APP_URL || "";
const TZ_OFFSET = parseInt(process.env.REMINDER_TZ_OFFSET || "-5", 10);

// Local date string (YYYY-MM-DD) in Alabama time
function localDate() {
  const now = new Date();
  const local = new Date(now.getTime() + TZ_OFFSET * 3600 * 1000);
  return local.toISOString().split("T")[0];
}

async function sbGet(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sendSMS(to, body) {
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
  if (!SB_URL || !TW_SID) {
    return new Response("Missing env vars", { status: 500 });
  }

  const today = localDate();
  const results = [];

  try {
    // Active crew members with a phone number
    const crew = await sbGet(`profiles?role=eq.crew&active=eq.true&select=id,name,phone,preferred_lang`);
    // Everyone who has already logged today
    const todaysLogs = await sbGet(`daily_logs?log_date=eq.${today}&select=crew_id`);
    const loggedIds = new Set(todaysLogs.map((l) => l.crew_id));

    for (const member of crew) {
      if (loggedIds.has(member.id)) continue;   // already logged — skip
      if (!member.phone) continue;              // no phone on file — skip

      const es = member.preferred_lang === "es";
      const link = `${APP_URL}/?log=1`;         // deep link to the log screen
      const body = es
        ? `Hola ${member.name.split(" ")[0]}, no olvides registrar tu trabajo de hoy antes de salir. Toca aquí: ${link}`
        : `Hi ${member.name.split(" ")[0]}, don't forget to log today's work before you head out. Tap here: ${link}`;

      try {
        await sendSMS(member.phone, body);
        results.push({ name: member.name, sent: true });
      } catch (e) {
        results.push({ name: member.name, sent: false, error: e.message });
      }
    }

    return new Response(JSON.stringify({ date: today, reminded: results }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};

// ── SCHEDULE ──────────────────────────────────────────────────────────
// Runs at 17:00 Central. Netlify cron is UTC, so 17:00 CDT = 22:00 UTC.
// Adjust to "23 * * *" style if you want a different minute.
export const config = {
  schedule: "0 22 * * *",   // 22:00 UTC  ≈ 5:00 PM Central (CDT)
};
