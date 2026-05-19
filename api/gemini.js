// Vercel Serverless Function — proxy dla Gemini API
// Klucze API są TYLKO tutaj na serwerze, niewidoczne dla przeglądarki

const GEMINI_MODEL = "gemini-2.5-flash";

// Pobierz klucz rotacyjnie
let aktualnyKluczIdx = 0;
function pobierzKlucz() {
  const klucze = [
    process.env.REACT_APP_GEMINI_API_KEY,
    process.env.REACT_APP_GEMINI_API_KEY_2,
    process.env.REACT_APP_GEMINI_API_KEY_3,
    process.env.REACT_APP_GEMINI_API_KEY_4,
    process.env.REACT_APP_GEMINI_API_KEY_5,
  ].filter(Boolean);

  if (klucze.length === 0) return null;
  const klucz = klucze[aktualnyKluczIdx % klucze.length];
  aktualnyKluczIdx++;
  return klucz;
}

export default async function handler(req, res) {
  // CORS — tylko nasza domena
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const klucz = pobierzKlucz();
  if (!klucz) {
    return res.status(500).json({ error: "🔑 Brak klucza API na serwerze" });
  }

  try {
    const { prompt, base64, mimeType } = req.body;

    if (!prompt || !base64 || !mimeType) {
      return res.status(400).json({ error: "Brak wymaganych pól: prompt, base64, mimeType" });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${klucz}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } }
          ]
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 8192 }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      // Przekaż status błędu żeby frontend mógł obsłużyć rate limit
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
