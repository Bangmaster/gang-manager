// api/gemini-upload.js
// Obsługuje chunked upload wideo do Google Files API
// Każdy chunk max 4MB — mieści się w limicie Vercela

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const klucz = process.env.REACT_APP_GEMINI_API_KEY;
  if (!klucz) return res.status(500).json({ error: "Brak klucza API" });

  try {
    const { action, mimeType, fileSize, displayName, uploadUrl, chunkData, chunkOffset, chunkSize, totalSize, isLast } = req.body;

    // === AKCJA 1: Zainicjuj upload, dostań uploadUrl od Google ===
    if (action === "init") {
      const initResponse = await fetch(
        `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=resumable&key=${klucz}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": String(fileSize),
            "X-Goog-Upload-Header-Content-Type": mimeType,
          },
          body: JSON.stringify({ file: { display_name: displayName || "video" } }),
        }
      );

      if (!initResponse.ok) {
        const err = await initResponse.text();
        return res.status(initResponse.status).json({ error: `Init failed: ${err.substring(0, 200)}` });
      }

      const newUploadUrl = initResponse.headers.get("x-goog-upload-url");
      if (!newUploadUrl) {
        return res.status(500).json({ error: "Brak upload URL w odpowiedzi Google" });
      }

      return res.status(200).json({ uploadUrl: newUploadUrl });
    }

    // === AKCJA 2: Wyślij chunk przez serwer do Google ===
    if (action === "chunk") {
      if (!uploadUrl || !chunkData) {
        return res.status(400).json({ error: "Brak uploadUrl lub chunkData" });
      }

      // Dekoduj base64 chunk
      const buffer = Buffer.from(chunkData, "base64");
      const command = isLast ? "upload, finalize" : "upload";

      const chunkResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Type": mimeType || "video/mp4",
          "X-Goog-Upload-Command": command,
          "X-Goog-Upload-Offset": String(chunkOffset),
          "Content-Length": String(buffer.length),
        },
        body: buffer,
      });

      if (!chunkResponse.ok && chunkResponse.status !== 308) {
        const err = await chunkResponse.text();
        return res.status(chunkResponse.status).json({ error: `Chunk upload failed: ${err.substring(0, 200)}` });
      }

      // Ostatni chunk — Google zwraca fileUri
      if (isLast) {
        const data = await chunkResponse.json();
        const fileUri = data?.file?.uri;
        if (!fileUri) {
          return res.status(500).json({ error: `Brak fileUri: ${JSON.stringify(data).substring(0, 200)}` });
        }
        return res.status(200).json({ fileUri, done: true });
      }

      // Pośredni chunk — zwróć potwierdzenie
      return res.status(200).json({ done: false, offset: chunkOffset + buffer.length });
    }

    return res.status(400).json({ error: `Nieznana akcja: ${action}` });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
