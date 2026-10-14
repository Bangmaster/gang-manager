// api/generate-announcement.js
// Vercel serverless function — generuje ogłoszenie na Messengera przez Anthropic API

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch(e) { body = {}; }
  }
  body = body || {};

  const { prompt, adminKey } = body;
  const ADMIN_KEY = process.env.ADMIN_NOTIF_KEY || "family_admin_2024";

  if (!adminKey || adminKey !== ADMIN_KEY) {
    return res.status(401).json({ error: "Brak autoryzacji" });
  }

  if (!prompt) {
    return res.status(400).json({ error: "Brak promptu" });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: "Brak klucza Anthropic API w zmiennych środowiskowych" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic API error:", err);
      return res.status(500).json({ error: `Anthropic API error: ${response.status}` });
    }

    const data = await response.json();
    const tekst = data.content?.map(c => c.text || "").join("") || "";
    return res.status(200).json({ success: true, tekst: tekst.trim() });
  } catch(e) {
    console.error("Generate announcement error:", e);
    return res.status(500).json({ error: e.message });
  }
};
