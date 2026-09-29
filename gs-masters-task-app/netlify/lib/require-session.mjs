// Shared guard for browser-callable functions: caller must send a valid
// Supabase session token from an active, non-archived field profile.
// Without this, anyone who found the URL could send texts from the company
// Twilio number (send-sms) or burn the Groq quota (scan-receipt).
const SB_URL = process.env.SUPABASE_URL || "https://mkibgjnzbgfqjkhowafr.supabase.co";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1raWJnam56YmdmcWpraG93YWZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NDM3NDMsImV4cCI6MjA4OTExOTc0M30.dFNsD-3JkDCChaVlWlJY5Ff_HtkWvNU6m9nbkNWNkow";

export async function requireSession(req) {
  const jwt = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return { error: "Sign-in required", status: 401 };
  const userRes = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt}` } });
  if (!userRes.ok) return { error: "Invalid session", status: 401 };
  const user = await userRes.json();
  const profileId = String(user.email || "").endsWith("@gsm.internal") ? user.email.slice(0, -13) : "";
  if (!profileId) return { error: "Not a field app account", status: 403 };
  const profRes = await fetch(`${SB_URL}/rest/v1/field_profiles?id=eq.${encodeURIComponent(profileId)}&select=id,active,archived`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt}` } });
  const rows = profRes.ok ? await profRes.json() : [];
  const profile = rows[0];
  if (!profile || profile.active === false || profile.archived === true) return { error: "Account inactive", status: 403 };
  return { profile };
}
