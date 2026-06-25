/* Netlify Function: /api/groq
   Holds the Groq key server-side (env var GROQ_API_KEY) so it is never exposed
   in the browser. The front-end posts the same body it would send to Groq; this
   adds the Authorization header and forwards to Groq, passing the status through
   (so a 429 rate-limit still reaches the app's fallback logic). */

const ALLOWED = new Set([
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "meta-llama/llama-4-scout-17b-16e-instruct",
]);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { error: "Method not allowed" });

  const key = process.env.GROQ_API_KEY;
  if (!key) return reply(500, { error: "Server is missing GROQ_API_KEY" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return reply(400, { error: "Bad JSON" }); }

  const payload = {
    model: ALLOWED.has(body.model) ? body.model : "llama-3.3-70b-versatile",
    messages: Array.isArray(body.messages) ? body.messages : [],
    temperature: typeof body.temperature === "number" ? body.temperature : 0.4,
    max_tokens: Math.min(Number(body.max_tokens) || 2200, 4000),
  };
  if (body.response_format) payload.response_format = body.response_format;

  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    return { statusCode: r.status, headers: { "Content-Type": "application/json" }, body: text };
  } catch {
    return reply(502, { error: "Upstream error reaching Groq" });
  }
};

function reply(code, obj) {
  return { statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
