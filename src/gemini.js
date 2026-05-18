// Logika rozpoznawania kart z screenów przez Google Gemini Vision API
// Wersja 3.0 — kolaż (wiele talii w 1 zapytaniu) + 2 klucze API naprzemiennie

const KLUCZE_API = [
  process.env.REACT_APP_GEMINI_API_KEY || "",
  process.env.REACT_APP_GEMINI_API_KEY_2 || "",
  process.env.REACT_APP_GEMINI_API_KEY_3 || "",
  process.env.REACT_APP_GEMINI_API_KEY_4 || "",
  process.env.REACT_APP_GEMINI_API_KEY_5 || "",
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
function buildPromptJeden(wszystkieTalie) {
  const info = wszystkieTalie.map(t =>
    `${t.nazwa}: ${t.karty.map(k => `"${k.nazwa}"(${k.typ[0]})`).join(",")}`
  ).join("\n");
  return `Analizuj karty w grze The Gang. Każda karta ma gwiazdki na górze.

ZASADA 1 — POSIADANIE (patrz TYLKO na kolor gwiazdek):
- Gwiazdki ŻÓŁTE/ZŁOTE = karta złota, posiadana: true
- Gwiazdki FIOLETOWE/RÓŻOWE = karta diamentowa, posiadana: true  
- Gwiazdki SZARE = karta nieposiadana: false

ZASADA 2 — DUPLIKAT:
- Żółta cyfra (+1, +2 itd.) przecinająca prawą ramkę karty = duplikaty: 1
- Brak cyfry = duplikaty: 0

Talie:
${info}

Zwróć WYŁĄCZNIE JSON:
{"talia":"nazwa","karty":[{"nazwa":"...","typ":"złota|diamentowa","posiadana":true|false,"duplikaty":0,"pewnosc":"wysoka|srednia|niska"}]}`;
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
  // Przerwa zależy od liczby kluczy — więcej kluczy = krótsza przerwa
  // 1 klucz=6s, 2=4s, 3=3s, 4=2s, 5+=2s (bezpieczny bufor)
  const PAUZA = KLUCZE_API.length >= 4 ? 2000 : KLUCZE_API.length === 3 ? 3000 : KLUCZE_API.length === 2 ? 4000 : 6000;

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

// OCR nowej talii — rozpoznaje nazwę talii i karty ze screena
export async function analyzeDeckStructure(file) {
  if (KLUCZE_API.length === 0) return { sukces: false, blad: "🔑 Brak klucza API" };
  try {
    const { base64, mimeType } = await fileToBase64(file);
    const prompt = `Rozpoznaj strukturę talii z gry The Gang.

Na screenie widać ekran talii z nazwą u góry i 9 kartami w siatce 3x3.

Rozpoznaj:
1. Nazwę talii z napisu "TALIA WYDARZEŃ:" na górze
2. Dla każdej z 9 kart:
   - Nazwę (z paska na dole karty)
   - Typ: złota (żółte gwiazdki) lub diamentowa (fioletowe gwiazdki)

Karty mogą być posiadane lub nie — nie ważne, rozpoznaj WSZYSTKIE 9.

Zwróć WYŁĄCZNIE JSON (bez markdown):
{"talia":"nazwa talii","karty":[{"nazwa":"...","typ":"złota|diamentowa"},{"nazwa":"...","typ":"złota|diamentowa"}]}

Zwróć dokładnie 9 kart.`;

    const url = pobierzURL();
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
      })
    });
    if (!response.ok) throw new Error(`Błąd ${response.status}`);
    const data = await response.json();
    let text = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    if (text.startsWith("```json")) text = text.slice(7);
    else if (text.startsWith("```")) text = text.slice(3);
    if (text.endsWith("```")) text = text.slice(0, -3);
    const parsed = JSON.parse(text.trim());
    nastepnyKlucz();
    return { sukces: true, dane: parsed };
  } catch (e) {
    return { sukces: false, blad: e.message };
  }
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
