const webpush = require("web-push");

const SB_URL = process.env.SUPABASE_URL || "https://mkibgjnzbgfqjkhowafr.supabase.co";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1raWJnam56YmdmcWpraG93YWZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NDM3NDMsImV4cCI6MjA4OTExOTc0M30.dFNsD-3JkDCChaVlWlJY5Ff_HtkWvNU6m9nbkNWNkow";
const WORKER_SECRET = String(process.env.OFFICE_PUSH_SECRET || "");
const VAPID_PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || "").replace(/\s/g, "");
const VAPID_PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || "").replace(/\s/g, "");

async function rpc(name, body) {
  const response = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || data?.error || `Database request failed (${response.status})`);
  return data;
}

exports.handler = async () => {
  try {
    if (!WORKER_SECRET || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) throw new Error("Push environment is incomplete");
    webpush.setVapidDetails("mailto:gsmastersinc@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const batch = await rpc("field_office_push_batch", { p_secret: WORKER_SECRET });
    const bidRows = batch?.bids || [];
    const portalRows = batch?.portals || [];
    const subscriptions = batch?.subscriptions || [];
    const count = bidRows.length + portalRows.length;
    if (!count || !subscriptions.length) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, sent: 0, messages: count, note: subscriptions.length ? "No new messages" : "No office devices registered" }) };
    }

    const latestPortal = portalRows[portalRows.length - 1];
    const latestBid = bidRows[bidRows.length - 1];
    const source = latestPortal ? "Client Portal" : "Bid Room";
    const detail = latestPortal
      ? `${latestPortal.sender_name || "Client"}: ${latestPortal.body || "New message"}`
      : `${latestBid.project_name || "Bid Room"} · ${latestBid.trade || latestBid.vendor_name || "New question"}`;
    const payload = JSON.stringify({
      title: count === 1 ? `New ${source} message` : `${count} new office messages`,
      body: detail.slice(0, 180),
      icon: "/icon-admin.png",
      badge: "/icon-admin.png",
      url: "/?tab=messages",
    });

    let sent = 0;
    const staleIds = [];
    await Promise.all(subscriptions.map(async row => {
      try {
        await webpush.sendNotification(row.subscription, payload);
        sent++;
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) staleIds.push(row.id);
        else console.error("Office push delivery:", error.message);
      }
    }));

    await rpc("field_office_push_complete", {
      p_secret: WORKER_SECRET,
      p_question_ids: sent > 0 ? bidRows.map(row => row.question_id) : [],
      p_message_ids: sent > 0 ? portalRows.map(row => row.message_id) : [],
      p_stale_ids: staleIds,
    });
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, sent, messages: count }) };
  } catch (error) {
    console.error("Office push:", error.message);
    return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: error.message }) };
  }
};
