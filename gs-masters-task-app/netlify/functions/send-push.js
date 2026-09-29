// GS Masters — Web Push Sender (CommonJS so Netlify bundles web-push correctly)
const webpush = require("web-push");

const SB_URL  = "https://mkibgjnzbgfqjkhowafr.supabase.co";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1raWJnam56YmdmcWpraG93YWZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NDM3NDMsImV4cCI6MjA4OTExOTc0M30.dFNsD-3JkDCChaVlWlJY5Ff_HtkWvNU6m9nbkNWNkow";
const WORKER_SECRET = String(process.env.OFFICE_PUSH_SECRET || "");
// No fallback values here on purpose -- a hardcoded VAPID private key was
// committed to this repo (which is public on GitHub) until 2026-09-20. That
// key is compromised and must be rotated in Netlify env vars; this function
// now fails loudly instead of silently falling back to a known-exposed key.
const VAPID_PUB  = (process.env.VAPID_PUBLIC_KEY  || "").replace(/\s/g, "");
const VAPID_PRIV = (process.env.VAPID_PRIVATE_KEY || "").replace(/\s/g, "");

exports.handler = async (event) => {
  if (!VAPID_PUB || !VAPID_PRIV) return { statusCode: 500, body: "Push not configured -- set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Netlify env vars (rotate, don't reuse the old committed key)" };
  if (event.httpMethod === "GET") return { statusCode: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify({ publicKey: VAPID_PUB }) };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };
  if (!WORKER_SECRET) return { statusCode: 500, body: "Push worker secret missing" };
  webpush.setVapidDetails("mailto:gsmastersinc@gmail.com", VAPID_PUB, VAPID_PRIV);

  // push_subscriptions RLS only grants authenticated crew read/write to
  // their own row (or admin) -- there is no anon access at all. This used
  // to call Supabase with the anon key, which RLS silently filtered to zero
  // rows every time (PostgREST returns 200 with an empty array, not an
  // error), so push notifications have never actually worked. Every caller
  // of sendPush() in the client is an admin-only action (dispatch, task
  // creation, admin replies -- all already gated at the DB level by their
  // own tables' RLS), so this verifies a real admin JWT, then does the
  // cross-crew read/send/cleanup with the service role key.
  const jwt = String(event.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return { statusCode: 401, body: "Sign-in required" };
  const userRes = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt}` } });
  if (!userRes.ok) return { statusCode: 401, body: "Invalid session" };
  const user = await userRes.json();
  const profileId = String(user.email || "").endsWith("@gsm.internal") ? user.email.slice(0, -13) : "";
  const profileRes = profileId ? await fetch(`${SB_URL}/rest/v1/field_profiles?id=eq.${encodeURIComponent(profileId)}&select=role,is_supervisor,active,archived`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt}` } }) : null;
  const profiles = profileRes?.ok ? await profileRes.json() : [];
  const profile = profiles[0];
  if (!profile || profile.active === false || profile.archived === true || (profile.role !== "admin" && profile.is_supervisor !== true)) return { statusCode: 403, body: "Admin or superintendent access required" };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: "Bad JSON" }; }

  const { crewIds, title, bodyText, url } = body || {};
  if (!crewIds?.length || !title) return { statusCode: 400, body: "Need crewIds and title" };

  // Fetch subscriptions through a narrow server-only RPC. The service-role key never lives in this site.
  const res = await fetch(`${SB_URL}/rest/v1/rpc/field_push_subscriptions`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_secret: WORKER_SECRET, p_profile_ids: crewIds }),
  });
  if (!res.ok) return { statusCode: 502, body: "Failed to fetch subscriptions" };
  const subs = await res.json();

  if (!subs.length) return { statusCode: 200, body: JSON.stringify({ ok: true, sent: 0, total: 0, note: "No subscriptions found" }) };

  const payload = JSON.stringify({ title, body: bodyText || "", icon: "/icon-admin.png", badge: "/icon-admin.png", url: url || "/" });

  let sent = 0, failed = 0;
  const stale = [];

  await Promise.all(subs.map(async (row) => {
    try {
      await webpush.sendNotification(row.subscription, payload);
      sent++;
    } catch (err) {
      failed++;
      if (err.statusCode === 410 || err.statusCode === 404) stale.push(row.id);
    }
  }));

  // Remove expired subscriptions
  if (stale.length) {
    try {
      await fetch(`${SB_URL}/rest/v1/rpc/field_office_push_complete`, {
        method: "POST",
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_secret: WORKER_SECRET, p_question_ids: [], p_message_ids: [], p_stale_ids: stale }),
      });
    } catch {}
  }

  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, sent, failed, total: subs.length }) };
};
