// api/get-upload-url.js
// Zwraca jednorazowy URL do uploadu wideo bezpośrednio do Google Files API

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const klucz = process.env.REACT_APP_GEMINI_API_KEY;
  if (!klucz) return res.status(500).json({ error: "Brak klucza API" });

  try {
    const { mimeType, displayName, fileSize } = req.body;
    if (!mimeType || !fileSize) {
      return res.status(400).json({ error: "Brak mimeType lub fileSize" });
    }

    // Zainicjuj resumable upload w Google Files API
    const initResponse = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=resumable&key=${klucz}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": fileSize,
          "X-Goog-Upload-Header-Content-Type": mimeType,
        },
        body: JSON.stringify({
          file: { display_name: displayName || "video" }
        }),
      }
    );

    if (!initResponse.ok) {
      const err = await initResponse.text();
      return res.status(initResponse.status).json({ error: err });
    }

    // Google zwraca upload URL w headerze
    const uploadUrl = initResponse.headers.get("x-goog-upload-url");
    if (!uploadUrl) {
      return res.status(500).json({ error: "Brak upload URL w odpowiedzi Google" });
    }

    return res.status(200).json({ uploadUrl });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
