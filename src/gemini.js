// Logika rozpoznawania kart — klucze API są na serwerze (api/gemini.js)
// Frontend NIE ma dostępu do kluczy Gemini

function nastepnyKlucz() {} // no-op — rotacja kluczy jest na serwerze

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ base64: reader.result.split(",")[1], mimeType: file.type });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function buildPromptJeden(wszystkieTalie) {
  const info = wszystkieTalie.map(t =>
    `${t.nazwa}: ${t.karty.map(k => `"${k.nazwa}"(${k.typ[0]})`).join(",")}`
  ).join("\n");
  return `Każda karta w grze The Gang ma na górze GWIAZDKI. Patrz TYLKO na gwiazdki.

POSIADANIE — wypełnienie gwiazdek:
- Gwiazdki KOLOROWE (wypełnione żółtym, złotym lub fioletowym kolorem) = posiadana: true
- Gwiazdki SZARE (puste, tylko kontur, bez koloru w środku) = posiadana: false

DUPLIKAT — żółta cyfra (1-9) widoczna gdziekolwiek na karcie:
- Widzisz cyfrę = duplikaty: 1
- Brak cyfry = duplikaty: 0

Typ karty (złota/diamentowa) — weź z bazy poniżej, NIE zgaduj.

Talie (z=złota, d=diamentowa):
${info}

Zidentyfikuj talię z napisu na górze ekranu. Zwróć WYŁĄCZNIE JSON:
{"talia":"nazwa","karty":[{"nazwa":"...","typ":"złota|diamentowa","posiadana":true|false,"duplikaty":0,"pewnosc":"wysoka|srednia|niska"}]}`;
}

async function geminiRequest(prompt, base64, mimeType) {
  const response = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, base64, mimeType })
  });

  if (!response.ok) {
    const errText = await response.text();
    let msg = `Błąd ${response.status}`;
    try {
      const j = JSON.parse(errText);
      if (response.status === 429) msg = "⏳ Limit tokenów/min — czekaj";
      else if (response.status === 403) msg = "🔑 Błąd autoryzacji API";
      else msg = `Błąd ${response.status}: ${(j.error||"").substring(0, 100)}`;
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

export async function analyzeMultiple(files, wszystkieTalie, onProgress) {
  if (files.length === 0) return [];
  const PAUZA = 2000;
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
          nastepnyKlucz();
          break;
        } else if (wynik.blad?.includes("⏳") || wynik.blad?.includes("limit")) {
          const czekaj = Math.min(60, 15 * (proba + 1));
          onProgress?.(i, files.length, `⏳ Limit — czekam ${czekaj}s... (próba ${proba + 2}/3)`);
          await new Promise(r => setTimeout(r, czekaj * 1000));
        } else {
          wyniki.push(wynik);
          sukces = true;
          break;
        }
      } catch (e) {
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

    if (i < files.length - 1) {
      onProgress?.(i + 1, files.length, `⏱️ Pauza ${PAUZA / 1000}s...`);
      await new Promise(r => setTimeout(r, PAUZA));
    }
  }

  onProgress?.(files.length, files.length, "✓ Zakończono");
  return wyniki;
}

export async function analyzeDeckStructure(file) {
  try {
    const { base64, mimeType } = await fileToBase64(file);
    const prompt = `Rozpoznaj strukturę talii z gry The Gang. Na screenie widać ekran talii z nazwą u góry i 9 kartami w siatce 3x3. Rozpoznaj nazwę talii i dla każdej z 9 kart: nazwę i typ (złota=żółte gwiazdki, diamentowa=fioletowe gwiazdki). Zwróć WYŁĄCZNIE JSON: {"talia":"nazwa talii","karty":[{"nazwa":"...","typ":"złota|diamentowa"}]}`;
    const text = await geminiRequest(prompt, base64, mimeType);
    const parsed = JSON.parse(text);
    return { sukces: true, dane: parsed };
  } catch (e) {
    return { sukces: false, blad: e.message };
  }
}

export async function analyzeImage(file, wszystkieTalie) {
  try {
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
