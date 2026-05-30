// ════════════════════════════════════════════════════════════════════════
//  GS MASTERS — Send a single SMS on demand (test or manual nudge)
//  POST { "to": "+1205...", "body": "message" }
//  Used by the admin "Send test reminder" button and manual nudges.
// ════════════════════════════════════════════════════════════════════════

const TW_SID = process.env.TWILIO_ACCOUNT_SID;
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TW_FROM = process.env.TWILIO_FROM;

export default async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!TW_SID) return new Response("Missing Twilio env vars", { status: 500 });

  let to, body;
  try { ({ to, body } = await req.json()); }
  catch { return new Response("Bad JSON", { status: 400 }); }
  if (!to || !body) return new Response("Need 'to' and 'body'", { status: 400 });

  const creds = Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString("base64");
  const params = new URLSearchParams({ To: to, From: TW_FROM, Body: body });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await res.json();
  return new Response(JSON.stringify({ ok: res.ok, sid: data.sid, error: data.message || null }),
    { status: res.ok ? 200 : 502, headers: { "Content-Type": "application/json" } });
};
