// Logika rozpoznawania kart — klucze API są na serwerze (api/gemini.js)
// Frontend NIE ma dostępu do kluczy Gemini

// Licznik kluczy — atomowo inkrementowany przy każdym requeście
let aktualnyKluczIdx = 0;
function nastepnyKlucz() {
  return aktualnyKluczIdx++;
}

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
  const kluczIdx = nastepnyKlucz(); // pobierz indeks przed requestem (thread-safe)
  const response = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, base64, mimeType, kluczIdx })
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

// Ile równoległych requestów wysyłamy naraz
// 3 = bezpieczny limit przy 5 kluczach (każdy klucz ~7 req/min, limit to 10)
const ROWNOLEGLE = 3;

// Pauza między grupami — daje czas serwerowi na reset okna limitów
const PAUZA_MIEDZY_GRUPAMI = 1500; // ms

// Przeanalizuj jeden plik z retry przy limicie
async function analyzeImageZRetry(file, wszystkieTalie, onSingleProgress) {
  for (let proba = 0; proba < 3; proba++) {
    try {
      const wynik = await analyzeImage(file, wszystkieTalie);
      if (wynik.sukces) return wynik;

      // Limit API — czekaj i spróbuj ponownie
      if (wynik.blad?.includes("⏳") || wynik.blad?.includes("limit") || wynik.blad?.includes("429")) {
        const czekaj = Math.min(60, 20 * (proba + 1));
        onSingleProgress?.(`⏳ Limit — czekam ${czekaj}s...`);
        await new Promise(r => setTimeout(r, czekaj * 1000));
        continue;
      }

      // Inny błąd — zwróć od razu
      return wynik;
    } catch (e) {
      if (proba < 2) await new Promise(r => setTimeout(r, 8000));
    }
  }
  return { sukces: false, blad: "Nie udało się po 3 próbach", fileName: file.name };
}

export async function analyzeMultiple(files, wszystkieTalie, onProgress) {
  if (files.length === 0) return [];

  // Wyniki w oryginalnej kolejności plików
  const wyniki = new Array(files.length);
  let ukonczono = 0;
  let kolejneBledy = 0;

  // Podziel pliki na grupy po ROWNOLEGLE
  for (let start = 0; start < files.length; start += ROWNOLEGLE) {
    const grupa = files.slice(start, start + ROWNOLEGLE);
    const indeksy = grupa.map((_, gi) => start + gi);

    // Aktywne nazwy plików w tej grupie
    const nazwyGrupy = grupa.map(f => f.name.length > 15 ? f.name.slice(0, 13) + "…" : f.name).join(", ");
    onProgress?.(
      ukonczono,
      files.length,
      `🤖 Analizuję ${ukonczono + 1}–${Math.min(ukonczono + grupa.length, files.length)}/${files.length}: ${nazwyGrupy}`
    );

    // Capture w const przed callbackiem — fix no-loop-func
    const offsetUkonczono = ukonczono;

    // Wszystkie pliki w grupie analizowane równolegle
    const rezultaty = await Promise.all(
      grupa.map((file, gi) =>
        analyzeImageZRetry(file, wszystkieTalie, (msg) => {
          onProgress?.(offsetUkonczono + gi, files.length, msg);
        })
      )
    );

    // Zapisz wyniki zachowując kolejność
    let noweBledy = 0;
    rezultaty.forEach((wynik, gi) => {
      wyniki[indeksy[gi]] = wynik;
      if (!wynik.sukces) noweBledy++;
    });
    if (noweBledy > 0) kolejneBledy += noweBledy;
    else kolejneBledy = 0;

    ukonczono += grupa.length;

    // Zbyt wiele błędów z rzędu — przerywamy
    if (kolejneBledy >= 6) {
      onProgress?.(files.length, files.length, "❌ Zbyt wiele błędów z rzędu — przerywam");
      break;
    }

    // Pauza między grupami (nie po ostatniej)
    if (start + ROWNOLEGLE < files.length) {
      onProgress?.(ukonczono, files.length, `⏱️ Pauza...`);
      await new Promise(r => setTimeout(r, PAUZA_MIEDZY_GRUPAMI));
    }
  }

  onProgress?.(files.length, files.length, "✓ Zakończono");
  // Wypełnij ewentualne luki (przerwane przez błędy)
  return wyniki.map((w, i) => w || { sukces: false, blad: "Pominięto", fileName: files[i].name });
}

// Upload wideo do Google Files API przez nasz proxy
// Zwraca fileUri który można przekazać do Gemini
async function uploadVideoDoGoogle(file, onProgress) {
  const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB — bezpieczny limit dla Vercela (body = chunk + base64 overhead + JSON)
  const mimeType = file.type || "video/mp4";

  // Krok 1: Zainicjuj upload przez nasz serwer
  onProgress?.("📡 Krok 1/3: Inicjuję upload...");
  let initResp;
  try {
    initResp = await fetch("/api/gemini-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "init",
        mimeType,
        fileSize: file.size,
        displayName: file.name,
      }),
    });
  } catch (e) {
    throw new Error(`INIT_FETCH: ${e.message}`);
  }

  if (!initResp.ok) {
    const err = await initResp.text();
    throw new Error(`INIT_HTTP_${initResp.status}: ${err.substring(0, 200)}`);
  }

  const { uploadUrl } = await initResp.json();
  if (!uploadUrl) throw new Error("INIT: Brak uploadUrl");

  // Krok 2: Wyślij plik w chunkach przez nasz serwer
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  let offset = 0;
  let fileUri = null;

  for (let i = 0; i < totalChunks; i++) {
    const isLast = i === totalChunks - 1;
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    onProgress?.(`⬆️ Krok 2/3: Wysyłam ${i + 1}/${totalChunks} (${Math.round((offset / file.size) * 100)}%)...`);

    // Konwertuj chunk do base64
    const chunkBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(chunk);
    });

    let chunkResp;
    try {
      chunkResp = await fetch("/api/gemini-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chunk",
          uploadUrl,
          mimeType,
          chunkData: chunkBase64,
          chunkOffset: offset,
          chunkSize: chunk.size,
          totalSize: file.size,
          isLast,
        }),
      });
    } catch (e) {
      throw new Error(`CHUNK_${i}_FETCH: ${e.message}`);
    }

    if (!chunkResp.ok) {
      const err = await chunkResp.text();
      throw new Error(`CHUNK_${i}_HTTP_${chunkResp.status}: ${err.substring(0, 200)}`);
    }

    const chunkData = await chunkResp.json();
    if (isLast) {
      fileUri = chunkData.fileUri;
      if (!fileUri) throw new Error(`CHUNK_LAST: Brak fileUri: ${JSON.stringify(chunkData).substring(0, 100)}`);
    }

    offset += chunk.size;
  }

  onProgress?.("🤖 Krok 3/3: Analizuję film...");
  return { fileUri, mimeType };
}

export async function analyzeVideo(file, wszystkieTalie, onProgress) {
  try {
    // Upload przez Files API — omija limit 4.5MB Vercela
    const { fileUri, mimeType } = await uploadVideoDoGoogle(file, onProgress);

    const info = wszystkieTalie.map(t =>
      `"${t.nazwa}": ${t.karty.map(k => `"${k.nazwa}"(${k.typ === "złota" ? "złota" : "diamentowa"})`).join(", ")}`
    ).join("\n");

    const prompt = `Jesteś ekspertem od gry mobilnej "The Gang: Street Mafia Wars".
Na nagraniu widać gracza który powoli przewija swoją kolekcję kart przez wszystkie talie.

Dla każdej widocznej talii i każdej karty w niej określ:

=== TYP KARTY ===
- Gwiazdki ŻÓŁTE/ZŁOTE na górze karty = karta złota
- Gwiazdki FIOLETOWE/NIEBIESKIE na górze karty = karta diamentowa

=== POSIADANIE ===
- Gwiazdki WYPEŁNIONE KOLOREM = posiadana: true
- Gwiazdki SZARE/PUSTE = posiadana: false

=== DUPLIKATY ===
- Żółta liczba "+1"/"+2"/"+3" w prawym dolnym rogu karty = duplikaty: ta liczba
- Brak takiej liczby = duplikaty: 0

=== BAZA TALII ===
${info}

Przeanalizuj CAŁE nagranie i zwróć wyniki dla WSZYSTKICH talii które widzisz.
Jeśli ta sama talia pojawi się kilka razy — weź stan z ostatniego wyraźnego ujęcia.

Zwróć WYŁĄCZNIE JSON (bez markdown):
{
  "talie": [
    {
      "talia": "nazwa talii z bazy",
      "karty": [
        { "nazwa": "...", "typ": "złota|diamentowa", "posiadana": true|false, "duplikaty": 0, "pewnosc": "wysoka|srednia|niska" }
      ]
    }
  ]
}`;

    const response = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, fileUri, mimeType, kluczIdx: 0 })
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
      return { sukces: false, blad: msg, fileName: file.name };
    }

    const data = await response.json();
    let text = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    if (text.startsWith("```json")) text = text.slice(7);
    else if (text.startsWith("```")) text = text.slice(3);
    if (text.endsWith("```")) text = text.slice(0, -3);
    text = text.trim();

    const parsed = JSON.parse(text);

    // Rozbij na osobne wyniki per talia (tak jak analyzeImage zwraca per talia)
    const wyniki = (parsed.talie || []).map(t => ({
      sukces: true,
      dane: { talia: t.talia, karty: t.karty },
      fileName: file.name,
    }));

    return { sukces: true, wieleTalii: true, wyniki, fileName: file.name };
  } catch (e) {
    return { sukces: false, blad: e.message, fileName: file.name };
  }
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