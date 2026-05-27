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

// ============================================================
// PROMPT — przepisany od nowa na podstawie analizy kart
// ============================================================
function buildPromptJeden(wszystkieTalie) {
  const info = wszystkieTalie.map(t =>
    `"${t.nazwa}": ${t.karty.map(k => `"${k.nazwa}"(${k.typ === "złota" ? "złota" : "diamentowa"})`).join(", ")}`
  ).join("\n");

  return `Jesteś ekspertem od rozpoznawania kart z gry mobilnej "The Gang".
Na screenie widać siatkę 3x3 z 9 kartami. Każda karta ma:
- nazwę na dole (pomarańczowy pasek)
- gwiazdki NA GÓRZE karty (ponad obrazkiem)
- opcjonalnie: żółtą liczbę z plusem w prawym dolnym rogu (np. +1, +2, +3)

=== KROK 1: NAZWA TALII ===
Nazwa talii jest wyświetlona na górze EKRANU (nad siatką kart), nie na kartach.
Dopasuj ją do jednej z baz poniżej (ignoruj wielkość liter i polskie znaki).

=== KROK 2: TYP KARTY (złota vs diamentowa) ===
Patrz na KOLOR gwiazdek na górze karty:
- Gwiazdki ŻÓŁTE / ZŁOTE = karta złota
- Gwiazdki FIOLETOWE / NIEBIESKIE / BŁĘKITNE = karta diamentowa
Ramka karty też daje wskazówkę: złota = żółta ramka z brokatem, diamentowa = fioletowa/niebieska ramka z iskierkami.
UWAGA: typ bierz z OBRAZKA, nie z bazy — baza służy tylko do dopasowania nazwy.

=== KROK 3: POSIADANIE ===
Patrz na WYPEŁNIENIE gwiazdek NA GÓRZE karty:
- Gwiazdki WYPEŁNIONE KOLOREM (żółtym lub fioletowym, zależnie od typu) = posiadana: true
- Gwiazdki SZARE / PUSTE / tylko zarys = posiadana: false
Wszystkie gwiazdki na jednej karcie są albo wszystkie kolorowe albo wszystkie szare.

=== KROK 4: DUPLIKATY ===
Szukaj żółtej liczby z plusem (+1, +2, +3 itd.) w PRAWYM DOLNYM ROGU karty.
- Widzisz "+2" = duplikaty: 2
- Widzisz "+1" = duplikaty: 1
- Brak takiej liczby = duplikaty: 0
WAŻNE: ignoruj poziom gracza (duże cyfry przy awatarze), liczniki amunicji i inne cyfry.
Szukaj TYLKO małej żółtej cyfry z plusem w rogu karty.

=== BAZA TALII ===
${info}

=== FORMAT ODPOWIEDZI ===
Zwróć WYŁĄCZNIE poprawny JSON, bez markdown, bez komentarzy:
{
  "talia": "dokładna nazwa talii z bazy",
  "karty": [
    {
      "nazwa": "dokładna nazwa karty z bazy",
      "typ": "złota|diamentowa",
      "posiadana": true|false,
      "duplikaty": 0,
      "pewnosc": "wysoka|srednia|niska"
    }
  ]
}

Zwróć dokładnie 9 kart (lub tyle ile widać). Nazwy przepisuj DOKŁADNIE z bazy.`;
}

// Prompt do rozpoznawania struktury talii (zakładka OCR struktury)
function buildPromptStruktura() {
  return `Jesteś ekspertem od rozpoznawania kart z gry mobilnej "The Gang".
Na screenie widać ekran talii: nazwa talii na górze, siatka 3x3 z 9 kartami.

Dla każdej karty rozpoznaj:
1. NAZWĘ — tekst z pomarańczowego paska na dole karty
2. TYP — patrz na kolor gwiazdek NA GÓRZE karty:
   - Gwiazdki ŻÓŁTE/ZŁOTE = "złota"
   - Gwiazdki FIOLETOWE/NIEBIESKIE = "diamentowa"
   Ramka karty to potwierdza: złota ramka = złota karta, fioletowa ramka = diamentowa karta.

Zwróć WYŁĄCZNIE JSON:
{"talia":"nazwa talii","karty":[{"nazwa":"...","typ":"złota|diamentowa"}]}`;
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
      else msg = `Błąd ${response.status}: ${(j.error || "").substring(0, 100)}`;
    } catch {}
    throw new Error(msg);
  }

  const data = await response.json();
  let text = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
  // Usuń markdown code block jeśli Gemini go doda
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
    const text = await geminiRequest(buildPromptStruktura(), base64, mimeType);
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
  const n = normalizujOCR(ocrWynik.dane.talia || "");
  // 1. Dokładne trafienie
  let t = wszystkieTalie.find(t => normalizujOCR(t.nazwa) === n);
  if (t) return t;
  // 2. Jeden zawiera drugi
  t = wszystkieTalie.find(t => {
    const tn = normalizujOCR(t.nazwa);
    return tn.includes(n) || n.includes(tn);
  });
  if (t) return t;
  // 3. Dopasowanie po słowach kluczowych (min 4 znaki)
  const slowa = n.split(/\s+/).filter(w => w.length >= 4);
  if (slowa.length > 0) {
    let best = null, bestScore = 0;
    wszystkieTalie.forEach(talia => {
      const tn = normalizujOCR(talia.nazwa);
      let score = slowa.filter(w => tn.includes(w)).length;
      if (score > bestScore) { bestScore = score; best = talia; }
    });
    if (bestScore > 0) return best;
  }
  return null;
}

export function matchKarta(nazwaOCR, talia) {
  if (!talia) return null;
  const norm = normalizujOCR(nazwaOCR || "");
  if (!norm) return null;
  // 1. Dokładne trafienie
  let k = talia.karty.find(k => normalizujOCR(k.nazwa) === norm);
  if (k) return k;
  // 2. Jeden zawiera drugi
  k = talia.karty.find(k => {
    const kn = normalizujOCR(k.nazwa);
    return kn.includes(norm) || norm.includes(kn);
  });
  if (k) return k;
  // 3. Scoring po słowach (min 3 znaki)
  let best = null, bestScore = 0;
  talia.karty.forEach(kk => {
    const kn = normalizujOCR(kk.nazwa);
    let score = 0;
    norm.split(/\s+/).forEach(w => {
      if (w.length >= 3 && kn.includes(w)) score += w.length;
    });
    if (score > bestScore) { bestScore = score; best = kk; }
  });
  return bestScore >= 3 ? best : null;
}

// Normalizacja do porównań — usuwa polskie znaki, małe litery, trim
function normalizujOCR(s) {
  return (s || "")
    .toLowerCase()
    .trim()
    .replace(/ą/g, "a").replace(/ć/g, "c").replace(/ę/g, "e")
    .replace(/ł/g, "l").replace(/ń/g, "n").replace(/ó/g, "o")
    .replace(/ś/g, "s").replace(/ź/g, "z").replace(/ż/g, "z")
    .replace(/\s+/g, " ");
}
