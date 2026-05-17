// Logika rozpoznawania kart z screenów przez Google Gemini Vision API

// Klucz API z zmiennej środowiskowej Vercel (bezpieczne!)
const GEMINI_API_KEY = process.env.REACT_APP_GEMINI_API_KEY || "";
const GEMINI_MODEL = "gemini-2.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// Konwertuje plik obrazu na base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const base64 = result.split(",")[1];
      resolve({ base64, mimeType: file.type });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Generuje prompt dla Gemini z listą oczekiwanych kart
function buildPrompt(wszystkieTalie) {
  const taliaInfo = wszystkieTalie.map(t => {
    const karty = t.karty.map(k => `"${k.nazwa}"(${k.typ[0]})`).join(",");
    return `${t.nazwa}: ${karty}`;
  }).join("\n");

  return `Rozpoznaj karty z gry The Gang na screenie talii.

Stan karty:
- POSIADANA: kolorowa z grafiką i nazwą
- DUPLIKAT: posiadana + cyfra "+1/+2/+3" w prawym dolnym rogu
- BRAK: szara z napisem GANG

Typy: złota = żółta ramka, diamentowa = niebiesko-biała holograficzna ramka.

Znane talie (format: nazwa: "karta"(z=złota/d=diamentowa)):
${taliaInfo}

Zidentyfikuj nazwę talii z górnego paska (po "TALIA WYDARZENIA:"). Dla każdej z 9 kart określ stan.

Zwróć WYŁĄCZNIE JSON (bez markdown, bez tekstu poza JSON):
{"talia":"nazwa","karty":[{"nazwa":"...","typ":"złota|diamentowa","posiadana":true|false,"duplikaty":0,"pewnosc":"wysoka|srednia|niska"}]}

Dopasuj nazwy do znanych. Zwróć wszystkie 9 kart talii. Pewność "niska" gdy tekst nieczytelny.`;
}

// Analizuje jeden screen
export async function analyzeImage(file, wszystkieTalie) {
  try {
    if (!GEMINI_API_KEY) {
      return { sukces: false, blad: "🔑 Brak klucza API — admin musi ustawić REACT_APP_GEMINI_API_KEY w Vercel", fileName: file.name };
    }
    const { base64, mimeType } = await fileToBase64(file);
    const prompt = buildPrompt(wszystkieTalie);

    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Pełny błąd Gemini API:", errText);
      // Parsuj błąd dla lepszego komunikatu
      let userMessage = `Gemini API error ${response.status}`;
      try {
        const errJson = JSON.parse(errText);
        const code = errJson.error?.code;
        const msg = errJson.error?.message || "";
        if (code === 429) {
          if (msg.includes("free_tier") && msg.includes("limit: 0")) {
            userMessage = "❌ Ten model nie jest dostępny w darmowym planie.";
          } else if (msg.includes("per day") || msg.includes("RPD")) {
            userMessage = "⏰ Wyczerpany dzienny limit zapytań. Spróbuj jutro.";
          } else {
            userMessage = "⏳ Za szybkie zapytania (limit ~15/min). Poczekaj minutę.";
          }
        } else if (code === 400) {
          userMessage = `❌ Błąd: ${msg.substring(0, 100)}`;
        } else if (code === 403) {
          userMessage = `🔑 ${msg.substring(0, 150)}`;
        } else {
          userMessage = `Błąd ${code}: ${msg.substring(0, 150)}`;
        }
      } catch {}
      throw new Error(userMessage);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Wyciągnij JSON z odpowiedzi (czasem Gemini dodaje markdown)
    let jsonText = text.trim();
    if (jsonText.startsWith("```json")) jsonText = jsonText.slice(7);
    else if (jsonText.startsWith("```")) jsonText = jsonText.slice(3);
    if (jsonText.endsWith("```")) jsonText = jsonText.slice(0, -3);
    jsonText = jsonText.trim();

    const parsed = JSON.parse(jsonText);
    return { sukces: true, dane: parsed, fileName: file.name };
  } catch (e) {
    console.error("Błąd analizy obrazu:", e);
    return { sukces: false, blad: e.message, fileName: file.name };
  }
}

// Analizuje wiele obrazów po kolei z adaptacyjnym opóźnieniem
// Limit Flash-Lite: 15 RPM, ale przy obrazach głównie problemem jest 250K TPM (tokenów/min)
// Jeden screen ~15-20K tokenów, więc bezpieczna pauza to ~6 sek
export async function analyzeMultiple(files, wszystkieTalie, onProgress) {
  const wyniki = [];
  let pauzaSekund = 6; // domyślna pauza
  let kolejneBledy429 = 0;

  for (let i = 0; i < files.length; i++) {
    onProgress?.(i, files.length, files[i].name);
    const wynik = await analyzeImage(files[i], wszystkieTalie);

    // Jeśli błąd rate limit — backoff adaptacyjny
    if (!wynik.sukces && (wynik.blad?.includes("limit") || wynik.blad?.includes("⏳") || wynik.blad?.includes("⏰"))) {
      kolejneBledy429++;
      const pauzaPoBledzie = Math.min(60, 15 * kolejneBledy429); // 15, 30, 45, max 60 sek
      onProgress?.(i, files.length, `⏳ Limit Google — czekam ${pauzaPoBledzie}s i próbuję ponownie...`);
      await new Promise(r => setTimeout(r, pauzaPoBledzie * 1000));

      // Spróbuj jeszcze raz
      const ponownie = await analyzeImage(files[i], wszystkieTalie);
      if (ponownie.sukces) {
        wyniki.push(ponownie);
        kolejneBledy429 = 0;
        pauzaSekund = Math.min(15, pauzaSekund + 2); // zwiększ stałą pauzę
      } else {
        // Drugi błąd z rzędu — zatrzymaj
        wyniki.push(ponownie);
        if (kolejneBledy429 >= 2) {
          onProgress?.(files.length, files.length, "❌ Wyczerpany limit — przerywam");
          break;
        }
      }
    } else {
      wyniki.push(wynik);
      if (wynik.sukces) kolejneBledy429 = 0;
    }

    if (i < files.length - 1) {
      onProgress?.(i + 1, files.length, `⏱️ Pauza ${pauzaSekund}s...`);
      await new Promise(r => setTimeout(r, pauzaSekund * 1000));
    }
  }
  onProgress?.(files.length, files.length, "✓ Zakończono");
  return wyniki;
}

// Dopasowuje wynik OCR do struktury talii (znajduje talię po nazwie)
export function matchTalia(ocrWynik, wszystkieTalie) {
  if (!ocrWynik.sukces) return null;
  const nazwaOCR = (ocrWynik.dane.talia || "").toLowerCase().trim();
  // Próbuj dokładnego dopasowania
  let talia = wszystkieTalie.find(t => t.nazwa.toLowerCase() === nazwaOCR);
  if (talia) return talia;
  // Próbuj częściowego
  talia = wszystkieTalie.find(t =>
    t.nazwa.toLowerCase().includes(nazwaOCR) || nazwaOCR.includes(t.nazwa.toLowerCase())
  );
  return talia || null;
}

// Dopasowuje nazwę karty do listy kart z talii
export function matchKarta(nazwaOCR, talia) {
  if (!talia) return null;
  const norm = (nazwaOCR || "").toLowerCase().trim();
  if (!norm) return null;
  // Dokładne
  let karta = talia.karty.find(k => k.nazwa.toLowerCase() === norm);
  if (karta) return karta;
  // Częściowe — szukaj największego pokrycia
  let najlepsza = null, najlepszyScore = 0;
  talia.karty.forEach(k => {
    const kn = k.nazwa.toLowerCase();
    let score = 0;
    if (kn.includes(norm) || norm.includes(kn)) score = Math.min(kn.length, norm.length);
    // Liczenie wspólnych słów
    const slowaA = kn.split(/\s+/), slowaB = norm.split(/\s+/);
    const wspolne = slowaA.filter(s => slowaB.includes(s) && s.length > 2).length;
    score += wspolne * 10;
    if (score > najlepszyScore) { najlepszyScore = score; najlepsza = k; }
  });
  return najlepszyScore > 5 ? najlepsza : null;
}
