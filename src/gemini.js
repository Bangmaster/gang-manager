// Logika rozpoznawania kart z screenów przez Google Gemini Vision API
// Wersja 3.0 — kolaż (wiele talii w 1 zapytaniu) + 2 klucze API naprzemiennie

const KLUCZE_API = [
  process.env.REACT_APP_GEMINI_API_KEY || "",
  process.env.REACT_APP_GEMINI_API_KEY_2 || "",
  process.env.REACT_APP_GEMINI_API_KEY_3 || "",
].filter(k => k.length > 0);

const GEMINI_MODEL = "gemini-2.5-flash-lite";
let aktualnyKluczIdx = 0;

function pobierzURL() {
  const klucz = KLUCZE_API[aktualnyKluczIdx % KLUCZE_API.length];
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${klucz}`;
}

function nastepnyKlucz() {
  aktualnyKluczIdx = (aktualnyKluczIdx + 1) % Math.max(1, KLUCZE_API.length);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ base64: reader.result.split(",")[1], mimeType: file.type });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Skleja wiele screenów w jeden kolaż (siatka 2 kolumny)
export async function scaleObrazki(files) {
  const W = 390, H = 700, COLS = 2;
  const rows = Math.ceil(files.length / COLS);
  const canvas = document.createElement("canvas");
  canvas.width = W * COLS;
  canvas.height = H * rows;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await Promise.all(files.map((file, i) => new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const col = i % COLS, row = Math.floor(i / COLS);
      const x = col * W, y = row * H;
      const scale = Math.min(W / img.width, H / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, x + (W - w) / 2, y + (H - h) / 2, w, h);
      ctx.strokeStyle = "#444"; ctx.lineWidth = 1;
      ctx.strokeRect(x, y, W, H);
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(x + 4, y + 4, 24, 18);
      ctx.fillStyle = "#ffd700"; ctx.font = "bold 12px sans-serif";
      ctx.fillText(`${i + 1}`, x + 8, y + 17);
      URL.revokeObjectURL(url);
      resolve();
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
    img.src = url;
  })));

  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
}

function buildPromptKolaz(wszystkieTalie, n) {
  const info = wszystkieTalie.map(t =>
    `${t.nazwa}: ${t.karty.map(k => `"${k.nazwa}"(${k.typ[0]})`).join(",")}`
  ).join("\n");
  return `Analizujesz kolaż ${n} screenów z gry The Gang. Każdy screen = jedna talia (nr 1-${n} w lewym górnym rogu).

Stan karty: POSIADANA=kolorowa z grafiką, DUPLIKAT=posiadana+cyfra+1/+2 w rogu, BRAK=szara "GANG".
Typy: złota=żółta/złota ramka, diamentowa=niebiesko-biała holograficzna.

Talie i karty:
${info}

Dla KAŻDEGO z ${n} screenów rozpoznaj talię i stan 9 kart.
Zwróć WYŁĄCZNIE tablicę JSON (bez markdown, ${n} obiektów po kolei):
[{"talia":"nazwa","karty":[{"nazwa":"...","typ":"złota|diamentowa","posiadana":true|false,"duplikaty":0,"pewnosc":"wysoka|srednia|niska"}]},...]`;
}

function buildPromptJeden(wszystkieTalie) {
  const info = wszystkieTalie.map(t =>
    `${t.nazwa}: ${t.karty.map(k => `"${k.nazwa}"(${k.typ[0]})`).join(",")}`
  ).join("\n");
  return `Rozpoznaj karty z gry The Gang. Stan: POSIADANA=kolorowa, DUPLIKAT=posiadana+cyfra+1/+2, BRAK=szara GANG. Typy: złota=żółta ramka, diamentowa=niebiesko-biała.
Talie: ${info}
Zidentyfikuj talię z górnego paska. Zwróć WYŁĄCZNIE JSON: {"talia":"nazwa","karty":[{"nazwa":"...","typ":"złota|diamentowa","posiadana":true|false,"duplikaty":0,"pewnosc":"wysoka|srednia|niska"}]}`;
}

async function geminiRequest(prompt, base64, mimeType) {
  if (KLUCZE_API.length === 0) throw new Error("🔑 Brak klucza API — ustaw REACT_APP_GEMINI_API_KEY w Vercel");
  const url = pobierzURL();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
    })
  });
  if (!response.ok) {
    const errText = await response.text();
    console.error("Gemini błąd:", errText);
    let msg = `Błąd ${response.status}`;
    try {
      const j = JSON.parse(errText);
      const code = j.error?.code, m = j.error?.message || "";
      if (code === 429) {
        if (m.includes("limit: 0")) msg = "❌ Model niedostępny w darmowym planie";
        else if (m.includes("per day")) msg = "⏰ Dzienny limit wyczerpany — spróbuj jutro";
        else msg = "⏳ Limit tokenów/min — czekaj";
      } else if (code === 403) msg = `🔑 ${m.substring(0, 100)}`;
      else msg = `Błąd ${code}: ${m.substring(0, 100)}`;
    } catch {}
    throw new Error(msg);
  }
  const data = await response.json();
  let text = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
  if (text.startsWith("```json")) text = text.slice(7);
  else if (text.startsWith("```")) text = text.slice(3);
  if (text.endsWith("```")) text = text.slice(0, -3);
  return text.trim();
}

// GŁÓWNA FUNKCJA: wiele screenów → kolaże → min zapytań
export async function analyzeMultiple(files, wszystkieTalie, onProgress) {
  if (files.length === 0) return [];
  const GRUPA = 6;
  const grupy = [];
  for (let i = 0; i < files.length; i += GRUPA) grupy.push(files.slice(i, i + GRUPA));

  const wyniki = [];
  let bledy = 0;

  for (let g = 0; g < grupy.length; g++) {
    const gr = grupy[g];
    const start = g * GRUPA;
    onProgress?.(start, files.length, `📸 Sklejam kolaż ${g + 1}/${grupy.length} (${gr.length} talii)...`);

    let proba = 0;
    while (proba < 3) {
      try {
        const base64 = await scaleObrazki(gr);
        onProgress?.(start, files.length, `🤖 Analizuję grupę ${g + 1}/${grupy.length} (${gr.length} talii naraz)...`);
        const prompt = gr.length === 1 ? buildPromptJeden(wszystkieTalie) : buildPromptKolaz(wszystkieTalie, gr.length);
        const json = await geminiRequest(prompt, base64, "image/jpeg");
        let parsed;
        try { parsed = JSON.parse(json); }
        catch { throw new Error("Niepoprawny JSON od AI"); }
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        gr.forEach((f, i) => {
          wyniki.push(arr[i]
            ? { sukces: true, dane: arr[i], fileName: f.name }
            : { sukces: false, blad: "Brak wyniku dla tego screena", fileName: f.name }
          );
        });
        nastepnyKlucz();
        bledy = 0;
        break;
      } catch (e) {
        proba++;
        bledy++;
        if (e.message.includes("⏳") || e.message.includes("limit")) {
          const czekaj = Math.min(60, 15 * proba);
          onProgress?.(start, files.length, `⏳ Limit — czekam ${czekaj}s (próba ${proba}/3)...`);
          await new Promise(r => setTimeout(r, czekaj * 1000));
          nastepnyKlucz(); // Spróbuj drugim kluczem
        } else {
          gr.forEach(f => wyniki.push({ sukces: false, blad: e.message, fileName: f.name }));
          break;
        }
        if (proba >= 3) {
          gr.forEach(f => wyniki.push({ sukces: false, blad: e.message, fileName: f.name }));
        }
      }
    }
    if (bledy >= 3) { onProgress?.(files.length, files.length, "❌ Zbyt wiele błędów — przerywam"); break; }
    if (g < grupy.length - 1) {
      onProgress?.(start + gr.length, files.length, `⏱️ Pauza 8s...`);
      await new Promise(r => setTimeout(r, 8000));
    }
  }
  onProgress?.(files.length, files.length, "✓ Zakończono");
  return wyniki;
}

export async function analyzeImage(file, wszystkieTalie) {
  try {
    if (KLUCZE_API.length === 0) return { sukces: false, blad: "🔑 Brak klucza API", fileName: file.name };
    const { base64, mimeType } = await fileToBase64(file);
    const json = await geminiRequest(buildPromptJeden(wszystkieTalie), base64, mimeType);
    return { sukces: true, dane: JSON.parse(json), fileName: file.name };
  } catch (e) {
    return { sukces: false, blad: e.message, fileName: file.name };
  }
}

export function matchTalia(ocrWynik, wszystkieTalie) {
  if (!ocrWynik.sukces) return null;
  const n = (ocrWynik.dane.talia || "").toLowerCase().trim();
  return wszystkieTalie.find(t => t.nazwa.toLowerCase() === n)
    || wszystkieTalie.find(t => t.nazwa.toLowerCase().includes(n) || n.includes(t.nazwa.toLowerCase()))
    || null;
}

export function matchKarta(nazwaOCR, talia) {
  if (!talia) return null;
  const norm = (nazwaOCR || "").toLowerCase().trim();
  if (!norm) return null;
  let k = talia.karty.find(k => k.nazwa.toLowerCase() === norm);
  if (k) return k;
  let best = null, bestScore = 0;
  talia.karty.forEach(kk => {
    const kn = kk.nazwa.toLowerCase();
    let score = 0;
    if (kn.includes(norm) || norm.includes(kn)) score = Math.min(kn.length, norm.length);
    norm.split(" ").forEach(w => { if (w.length > 3 && kn.includes(w)) score += w.length; });
    if (score > bestScore) { bestScore = score; best = kk; }
  });
  return bestScore > 2 ? best : null;
}
