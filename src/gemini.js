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

// GŁÓWNA FUNKCJA: każdy screen osobno, klucze rotacyjnie (3 klucze = 3x limit TPM)
// Przy 3 kluczach możemy wysyłać co ~2 sek bez ryzyka limitu
export async function analyzeMultiple(files, wszystkieTalie, onProgress) {
  if (files.length === 0) return [];

  // Oblicz pauzę na podstawie liczby kluczy
  // 1 klucz = 6s, 2 klucze = 3s, 3+ klucze = 2s
  const PAUZA = KLUCZE_API.length >= 3 ? 2000 : KLUCZE_API.length === 2 ? 3000 : 6000;

  const wyniki = [];
  let kolejneBledy = 0;

  for (let i = 0; i < files.length; i++) {
    onProgress?.(i, files.length, `🤖 Analizuję screen ${i + 1}/${files.length}: ${files[i].name}`);

    let sukces = false;
    for (let proba = 0; proba < 3; proba++) {
      try {
        const wynik = await analyzeImage(files[i], wszystkieTalie);
        if (wynik.sukces) {
          wyniki.push(wynik);
          kolejneBledy = 0;
          sukces = true;
          nastepnyKlucz(); // rotuj klucz po każdym zapytaniu
          break;
        } else if (wynik.blad?.includes("⏳") || wynik.blad?.includes("limit")) {
          // Rate limit — czekaj i zmień klucz
          const czekaj = Math.min(60, 15 * (proba + 1));
          onProgress?.(i, files.length, `⏳ Limit — czekam ${czekaj}s, zmieniam klucz... (próba ${proba + 2}/3)`);
          nastepnyKlucz();
          await new Promise(r => setTimeout(r, czekaj * 1000));
        } else {
          // Inny błąd — nie ponawiaj
          wyniki.push(wynik);
          sukces = true;
          break;
        }
      } catch (e) {
        nastepnyKlucz();
        if (proba < 2) await new Promise(r => setTimeout(r, 10000));
      }
    }

    if (!sukces) {
      wyniki.push({ sukces: false, blad: "Nie udało się po 3 próbach", fileName: files[i].name });
      kolejneBledy++;
    }

    if (kolejneBledy >= 3) {
      onProgress?.(files.length, files.length, "❌ Zbyt wiele błędów z rzędu — przerywam");
      break;
    }

    // Pauza między screenami (krótsza przy więcej kluczach)
    if (i < files.length - 1) {
      onProgress?.(i + 1, files.length, `⏱️ Pauza ${PAUZA / 1000}s (klucz ${(aktualnyKluczIdx % KLUCZE_API.length) + 1}/${KLUCZE_API.length})...`);
      await new Promise(r => setTimeout(r, PAUZA));
    }
  }

  onProgress?.(files.length, files.length, "✓ Zakończono");
  return wyniki;
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
  if (k) return k
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
