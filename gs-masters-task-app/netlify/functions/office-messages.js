const SB_URL = process.env.SUPABASE_URL || "https://mkibgjnzbgfqjkhowafr.supabase.co";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1raWJnam56YmdmcWpraG93YWZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NDM3NDMsImV4cCI6MjA4OTExOTc0M30.dFNsD-3JkDCChaVlWlJY5Ff_HtkWvNU6m9nbkNWNkow";
const BUILDER_URL = (process.env.GSM_BUILDER_URL || "https://app.gsmastersinc.com").replace(/\/$/, "");
const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

const out = (statusCode, body) => ({ statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) });

async function sb(path, bearer, options = {}) {
  const response = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...options.headers,
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : [];
  if (!response.ok) throw Object.assign(new Error(data.message || data.error || `Database request failed (${response.status})`), { status: response.status });
  return data;
}

async function authorize(event) {
  const jwt = String(event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw Object.assign(new Error("Sign-in required"), { status: 401 });
  const response = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt}` } });
  if (!response.ok) throw Object.assign(new Error("Invalid session"), { status: 401 });
  const authUser = await response.json();
  const profileId = String(authUser.email || "").endsWith("@gsm.internal") ? authUser.email.slice(0, -13) : "";
  const profiles = profileId ? await sb(`field_profiles?id=eq.${encodeURIComponent(profileId)}&select=id,name,role,is_supervisor,active,archived`, jwt) : [];
  const profile = profiles[0];
  if (!profile || profile.active === false || profile.archived === true || (profile.role !== "admin" && profile.is_supervisor !== true)) {
    throw Object.assign(new Error("Admin or superintendent access required"), { status: 403 });
  }
  return { jwt, profile };
}

async function listMessages(jwt) {
  const [bidRows, portalRows] = await Promise.all([
    sb("bid_message_alerts?status=eq.pending&select=question_id,request_id,created_at,bid_questions!inner(body,sender,created_at),bid_requests!inner(vendor_name,room_id,bid_rooms!inner(job_code,project_name),bid_trade_packages!inner(trade))&order=created_at.desc", jwt),
    sb("office_message_alerts?status=in.(pending,bypassed)&select=message_id,status,updated_at,portal_messages!inner(id,job_id,sender_name,body,created_at)&order=updated_at.desc", jwt),
  ]);

  const jobIds = [...new Set(portalRows.map(row => row.portal_messages?.job_id).filter(Boolean))];
  const jobs = jobIds.length
    ? await sb(`gsm_jobs?id=in.(${jobIds.map(id => `\"${String(id).replace(/\"/g, "")}\"`).join(",")})&select=id,data`, jwt)
    : [];
  const jobNames = new Map(jobs.map(job => [job.id, job.data?.name || job.id]));

  const bids = bidRows.map(row => {
    const question = row.bid_questions || {};
    const request = row.bid_requests || {};
    const room = request.bid_rooms || {};
    const trade = request.bid_trade_packages || {};
    return {
      id: row.question_id,
      requestId: row.request_id,
      kind: "bid",
      source: "Bid Room",
      title: room.project_name || "Bid Room",
      meta: [room.job_code, trade.trade, request.vendor_name].filter(Boolean).join(" · "),
      body: question.body || "",
      sender: question.sender || request.vendor_name || "Bidder",
      createdAt: question.created_at || row.created_at,
      href: `${BUILDER_URL}/bids.html?room=${encodeURIComponent(request.room_id || "")}&request=${encodeURIComponent(row.request_id)}`,
    };
  });

  const portals = portalRows.map(row => {
    const message = row.portal_messages || {};
    return {
      id: row.message_id,
      jobId: message.job_id,
      kind: "portal",
      source: "Client Portal",
      title: jobNames.get(message.job_id) || message.job_id || "Client Portal",
      meta: `${message.sender_name || "Client"}${row.status === "bypassed" ? " · Bypassed" : ""}`,
      body: message.body || "",
      sender: message.sender_name || "Client",
      createdAt: message.created_at || row.updated_at,
      href: `${BUILDER_URL}/portal.html?job=${encodeURIComponent(message.job_id || "")}&section=messages`,
    };
  });

  return [...bids, ...portals].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function forwardReply(jwt, input) {
  const body = String(input.body || "").trim();
  if (!body || body.length > 2000) throw Object.assign(new Error("Reply must contain 1 to 2,000 characters"), { status: 400 });
  let path, payload;
  if (input.kind === "bid") {
    if (!input.requestId) throw Object.assign(new Error("Bid request missing"), { status: 400 });
    path = "/.netlify/functions/bid-question-reply";
    payload = { request_id: input.requestId, body };
  } else if (input.kind === "portal") {
    if (!input.id) throw Object.assign(new Error("Portal message missing"), { status: 400 });
    path = "/.netlify/functions/office-message";
    payload = { message_id: input.id, action: "reply", body };
  } else {
    throw Object.assign(new Error("Unsupported message type"), { status: 400 });
  }
  const response = await fetch(`${BUILDER_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `Reply failed (${response.status})`), { status: response.status });
  return data;
}

exports.handler = async event => {
  try {
    const { jwt } = await authorize(event);
    if (event.httpMethod === "GET") return out(200, { ok: true, messages: await listMessages(jwt) });
    if (event.httpMethod !== "POST") return out(405, { error: "Method not allowed" });
    let input;
    try { input = JSON.parse(event.body || "{}"); } catch { return out(400, { error: "Invalid JSON" }); }
    const result = await forwardReply(jwt, input);
    return out(200, { ok: true, result });
  } catch (error) {
    console.error("Office messages:", error.message);
    return out(error.status || 500, { error: error.message || "Message request failed" });
  }
};
