// ════════════════════════════════════════════════════════════════════════
//  GS MASTERS — AI receipt read (Groq vision)
//  POST { "dataUrl": "data:image/jpeg;base64,..." }
//  Returns { vendor, amount, date, note, category } — category is one of
//  "Office" | "Auto" | "Tools" | "Side Job" | "Job" | null.
//  Used by AdminReceipts (Add Receipt modal) and AdminFieldMode (Receipt tab)
//  to pre-fill the form right after a photo is captured; admin still reviews
//  and can edit every field before saving.
// ════════════════════════════════════════════════════════════════════════

import { requireSession } from "../lib/require-session.mjs";

const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

const PROMPT = `You are reading a purchase receipt photo for a construction company (G.S. Masters, Inc.).
Extract and return ONLY a JSON object with this exact structure, no markdown, no explanation:
{
  "vendor": "store/vendor name or null",
  "amount": 0,
  "date": "YYYY-MM-DD or null",
  "note": "short 3-6 word summary of what was purchased, e.g. 'Lumber, screws, paint'",
  "category": one of "Office", "Auto", "Tools", "Side Job", "Job", or null — pick "Office" for office
    supplies, "Auto" for fuel/vehicle/parts, "Tools" for tool purchases or rentals, "Side Job" only if
    clearly unrelated to a job site, otherwise "Job" for general construction materials/supplies
}
"amount" must be the final total paid, as a plain number (no currency symbol).`;

export default async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!GROQ_KEY) return new Response(JSON.stringify({ error: "GROQ_API_KEY not set in Netlify env" }), { status: 500, headers: { "Content-Type": "application/json" } });
  const auth = await requireSession(req);
  if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: { "Content-Type": "application/json" } });

  let dataUrl;
  try { ({ dataUrl } = await req.json()); }
  catch { return new Response(JSON.stringify({ error: "Bad JSON" }), { status: 400, headers: { "Content-Type": "application/json" } }); }
  if (!dataUrl) return new Response(JSON.stringify({ error: "Missing dataUrl" }), { status: 400, headers: { "Content-Type": "application/json" } });

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GROQ_VISION_MODEL,
        max_tokens: 400,
        temperature: 0.1,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        }],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Groq error (${res.status})`);

    const raw = data.choices?.[0]?.message?.content || "";
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch { return new Response(JSON.stringify({ error: "Could not parse AI response" }), { status: 502, headers: { "Content-Type": "application/json" } }); }

    return new Response(JSON.stringify({ success: true, result: parsed }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
