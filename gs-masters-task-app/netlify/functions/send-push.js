// GS Masters — Web Push Sender (CommonJS so Netlify bundles web-push correctly)
const webpush = require("web-push");

const SB_URL  = "https://mkibgjnzbgfqjkhowafr.supabase.co";
const SB_KEY  = process.env.SUPABASE_ANON_KEY || "sb_publishable_zh5Soyi6iNGd8CLxPfD9Lg_dVdAwDe7";
const VAPID_PUB  = (process.env.VAPID_PUBLIC_KEY  || "BNuhXdjrECrBVABmhVdEe-qy4OMKQnkIZek8scMjJQ-xHg6zTX7-VEIQ2BadiWDh_kCvO1gs9MSboG77Xfl-b9o").replace(/\s/g, "");
const VAPID_PRIV = (process.env.VAPID_PRIVATE_KEY || "yTqYUeCzXIg9BAGzBJaW41hnBgN_LRtWU8AztIRB7zY").replace(/\s/g, "");

webpush.setVapidDetails("mailto:gsmastersinc@gmail.com", VAPID_PUB, VAPID_PRIV);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: "Bad JSON" }; }

  const { crewIds, title, bodyText, url } = body || {};
  if (!crewIds?.length || !title) return { statusCode: 400, body: "Need crewIds and title" };

  // Fetch subscriptions for these crew members
  const ids = crewIds.map(id => `"${id}"`).join(",");
  const res = await fetch(
    `${SB_URL}/rest/v1/push_subscriptions?crew_id=in.(${ids})&select=crew_id,subscription`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
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
      if (err.statusCode === 410 || err.statusCode === 404) stale.push(row.subscription?.endpoint);
    }
  }));

  // Remove expired subscriptions
  for (const ep of stale) {
    try {
      await fetch(`${SB_URL}/rest/v1/push_subscriptions?subscription->>endpoint=eq.${encodeURIComponent(ep)}`, {
        method: "DELETE",
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: "return=minimal" },
      });
    } catch {}
  }

  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, sent, failed, total: subs.length }) };
};
