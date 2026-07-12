// ════════════════════════════════════════════════════════════════════════
//  GS MASTERS — 6pm checkout reminder
//  Runs daily at 23:00 UTC (6pm CDT / 5pm CST)
//  Texts any crew still clocked in with a link to fix it.
// ════════════════════════════════════════════════════════════════════════

const SB_URL  = "https://mkibgjnzbgfqjkhowafr.supabase.co";
const SB_KEY  = process.env.SUPABASE_ANON_KEY || "sb_publishable_zh5Soyi6iNGd8CLxPfD9Lg_dVdAwDe7";
const TW_SID  = process.env.TWILIO_ACCOUNT_SID;
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TW_FROM = process.env.TWILIO_FROM;
const APP_URL  = "https://quiet-seahorse-2ba028.netlify.app";

async function sbFetch(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
  });
  return r.json();
}

async function sendSMS(to, body) {
  const digits = to.replace(/\D/g, "");
  const normalized = digits.length === 10 ? `+1${digits}` : `+${digits}`;
  const creds = Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString("base64");
  const params = new URLSearchParams({ To: normalized, From: TW_FROM, Body: body });
  const r = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`,
    { method: "POST", headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() }
  );
  return r.json();
}

const centralHour = () => parseInt(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }).format(new Date()), 10);

export default async () => {
  if (!TW_SID) return new Response("Missing Twilio env", { status: 500 });
  // Cron fires at both UTC hours; only the one that is 6pm Central proceeds
  if (centralHour() !== 18) return new Response(JSON.stringify({ skipped: "not 6pm Central" }), { status: 200 });

  // Today in Central time (DST-proof)
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());

  const checkins = await sbFetch(`field_checkins?work_date=eq.${today}&check_out=is.null&select=id,crew_id,job_id,check_in`);
  if (!checkins?.length) return new Response(JSON.stringify({ sent: 0, note: "No open check-ins" }), { status: 200 });

  const crewIds = [...new Set(checkins.map(c => c.crew_id))].join(",");
  const jobIds  = [...new Set(checkins.map(c => c.job_id))].join(",");

  const [profiles, jobs] = await Promise.all([
    sbFetch(`field_profiles?id=in.(${crewIds})&select=id,name,phone`),
    sbFetch(`field_jobs?id=in.(${jobIds})&select=id,name`)
  ]);

  const sent = [];
  for (const ci of checkins) {
    const p = profiles.find(x => x.id === ci.crew_id);
    const j = jobs.find(x => x.id === ci.job_id);
    if (!p?.phone) continue;

    const firstName = p.name.split(" ")[0];
    const jobName   = j?.name?.split(",")[0] || "your job";
    const inTime    = new Date(ci.check_in).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

    const msg = `GS Masters: Hey ${firstName}, you're still clocked in at ${jobName} (since ${inTime}). Open the app to enter your actual checkout time → ${APP_URL}`;

    await sendSMS(p.phone, msg);
    sent.push(p.name);
  }

  return new Response(JSON.stringify({ sent, count: sent.length }), { status: 200, headers: { "Content-Type": "application/json" } });
};

// Fires 23:00 + 00:00 UTC; centralHour() guard picks whichever is 6pm CT (CDT or CST).
export const config = { schedule: "0 0,23 * * *" };
