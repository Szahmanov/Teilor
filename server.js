/* Render (or any Node host) server for Tailor.
   Serves the static files AND proxies /api/groq using the secret GROQ_API_KEY
   env var, so the key never reaches the browser.
   Render: New > Web Service > connect repo > Build "npm install", Start "npm start",
   add env var GROQ_API_KEY. (Netlify users can ignore this file.) */

const express = require("express");
const path = require("path");
const app = express();
app.use(express.json({ limit: "1mb" }));

const ALLOWED = new Set([
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "meta-llama/llama-4-scout-17b-16e-instruct",
]);

app.post("/api/groq", async (req, res) => {
  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(500).json({ error: "Server is missing GROQ_API_KEY" });

  const b = req.body || {};
  const payload = {
    model: ALLOWED.has(b.model) ? b.model : "llama-3.3-70b-versatile",
    messages: Array.isArray(b.messages) ? b.messages : [],
    temperature: typeof b.temperature === "number" ? b.temperature : 0.4,
    max_tokens: Math.min(Number(b.max_tokens) || 2200, 4000),
  };
  if (b.response_format) payload.response_format = b.response_format;

  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    res.status(r.status).type("application/json").send(text);
  } catch {
    res.status(502).json({ error: "Upstream error reaching Groq" });
  }
});

// static site
app.use(express.static(path.join(__dirname)));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Tailor running on port " + PORT));
