import { useState, useEffect } from "react";
import { zapiszAutoBackup } from "./firebase";

// Klucze API — te same co w gemini.js
const KLUCZE = [
  process.env.REACT_APP_GEMINI_API_KEY || "",
  process.env.REACT_APP_GEMINI_API_KEY_2 || "",
  process.env.REACT_APP_GEMINI_API_KEY_3 || "",
  process.env.REACT_APP_GEMINI_API_KEY_4 || "",
  process.env.REACT_APP_GEMINI_API_KEY_5 || "",
].filter(k => k.length > 0);
let kluczIdx = 0;
function pobierzURL() {
  const k = KLUCZE[kluczIdx % Math.max(1, KLUCZE.length)];
  return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${k}`;
}
function nastepnyKlucz() { kluczIdx = (kluczIdx + 1) % Math.max(1, KLUCZE.length); }

// Skleja screeny walki pionowo (ranking jest pionowy więc lepiej niż siatka)
async function scaleScreenyWalki(files) {
  const SZEROKOSC = 520;

  // Załaduj wszystkie obrazy
  const obrazy = await Promise.all(files.map(f => new Promise((res) => {
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); res(null); };
    img.src = url;
  })));

  // Oblicz wysokości zachowując proporcje
  const wysok = obrazy.map(img => img ? Math.round((img.height / img.width) * SZEROKOSC) : 0);
  const lacznie = wysok.reduce((s, h) => s + h, 0);

  const canvas = document.createElement("canvas");
  canvas.width = SZEROKOSC;
  canvas.height = lacznie;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0a0a1a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let y = 0;
  obrazy.forEach((img, i) => {
    if (!img) return;
    ctx.drawImage(img, 0, y, SZEROKOSC, wysok[i]);
    // Cienka linia między screenami
    if (i < obrazy.length - 1) {
      ctx.strokeStyle = "#ffd70066";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, y + wysok[i]);
      ctx.lineTo(SZEROKOSC, y + wysok[i]);
      ctx.stroke();
    }
    y += wysok[i];
  });

  return canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
}

// Prompt dla screenów aktywności członków
function buildActivityPrompt(ileScreenow) {
  const wieloInfo = ileScreenow > 1
    ? `Masz ${ileScreenow} screeny złączone pionowo. Każdego gracza zwróć TYLKO RAZ.`
    : "Masz jeden screen z listą członków gangu.";

  return `Rozpoznaj listę członków gangu z gry The Gang. ${wieloInfo}

Każdy wiersz zawiera:
- numer porządkowy (1, 2, 3...)
- poziom gracza (liczba przy avatarze, np. 1552, 921, 330)
- nazwa gracza (np. "SaMaNtA", "™FAM™Fallven") — skopiuj DOKŁADNIE
- czas ostatniej aktywności: "teraz", "X s. temu", "X min. temu", "X godz. temu", "Xg Ym temu"

Zamień czas na minuty:
- "teraz" lub "online" = 0
- "X s. temu" = 0 (zaokrąglij do 0)
- "X min. temu" = X
- "X godz. temu" = X * 60
- "Xg Ym temu" = X*60 + Y
- "godzinę temu" = 60
- "2 godziny temu" = 120

Zwróć WYŁĄCZNIE JSON (bez markdown):
{"czlonkowie":[{"nazwa":"SaMaNtA","minutTemu":4,"poziom":1392},{"nazwa":"™FAM™Fallven","minutTemu":120,"poziom":1552}]}

Zwróć każdego gracza TYLKO RAZ. Ignoruj graczy bez czasu aktywności.`;
}

// Analizuje screeny aktywności członków
async function analyzeActivityImages(files, onProgress) {
  if (KLUCZE.length === 0) {
    return { sukces: false, blad: "🔑 Brak klucza API", czlonkowie: [] };
  }

  try {
    onProgress?.(`📸 Scalanie ${files.length} screen${files.length === 1 ? "u" : "ów"} aktywności...`);
    const base64 = files.length === 1
      ? await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result.split(",")[1]);
          r.onerror = rej;
          r.readAsDataURL(files[0]);
        })
      : await scaleScreenyWalki(files); // ta sama funkcja skalowania

    onProgress?.("🤖 Analizuję aktywność członków...");

    let ostatniBladMsg = "";
    for (let proba = 0; proba < 3; proba++) {
      try {
        const url = pobierzURL();
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [
              { text: buildActivityPrompt(files.length) },
              { inline_data: { mime_type: "image/jpeg", data: base64 } }
            ]}],
            generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          let msg = `Błąd ${response.status}`;
          try {
            const j = JSON.parse(errText);
            const code = j.error?.code, m = j.error?.message || "";
            if (code === 429) msg = "⏳ Limit — czekaj";
            else if (code === 403) msg = "🔑 Klucz zablokowany";
            else msg = `Błąd ${code}: ${m.substring(0, 80)}`;
          } catch {}
          ostatniBladMsg = msg;
          nastepnyKlucz();
          if (proba < 2) {
            onProgress?.(`${msg} — próba ${proba + 2}/3 za 10s...`);
            await new Promise(r => setTimeout(r, 10000));
          }
          continue;
        }

        const data = await response.json();
        let text = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
        if (text.startsWith("```json")) text = text.slice(7);
        else if (text.startsWith("```")) text = text.slice(3);
        if (text.endsWith("```")) text = text.slice(0, -3);
        const parsed = JSON.parse(text.trim());
        nastepnyKlucz();
        return { sukces: true, czlonkowie: parsed.czlonkowie || [] };

      } catch (e) {
        ostatniBladMsg = e.message;
        nastepnyKlucz();
        if (proba < 2) {
          onProgress?.(`Błąd — próba ${proba + 2}/3 za 10s...`);
          await new Promise(r => setTimeout(r, 10000));
        }
      }
    }
    return { sukces: false, blad: ostatniBladMsg, czlonkowie: [] };

  } catch (e) {
    return { sukces: false, blad: e.message, czlonkowie: [] };
  }
}

// Prompt dla scalonego rankingu
function buildBattlePrompt(ileScreenow) {
  const wieloInfo = ileScreenow > 1
    ? `Masz ${ileScreenow} screeny złączone pionowo (oddzielone złotą linią). UWAGA: gracze mogą się powtarzać na granicy screenów — każdego gracza zwróć TYLKO RAZ.`
    : "Masz jeden screen rankingu.";

  return `Rozpoznaj ranking z podsumowania walki gangu w grze The Gang. ${wieloInfo}

Każdy wiersz zawiera:
- miejsce w rankingu (1-20)
- avatar z poziomem gracza (cyfra na avatarze, np. 1349)
- nazwa gracza (np. "SaMaNtA", "™FAM™Fallven") — skopiuj DOKŁADNIE z prefiksami klanu
- obrażenia obok ikony pistoletu
- zdjęte tarcze obok ikony błyskawicy

Format liczb: M=miliony (75,15M=75150000), k=tysiące (828,52k=828520), bez jednostki=dokładna (1 717=1717).
Ignoruj dodatkowe ikonki (korona, tarcza, wózki) — nie zmieniają liczb.

Zwróć WYŁĄCZNIE JSON (bez markdown):
{"gracze":[{"miejsce":1,"nazwa":"SaMaNtA","poziom":1349,"obrazenia":75150000,"tarcze":24}]}

Zwróć każdego gracza TYLKO RAZ (bez duplikatów).`;
}

// Analizuje screeny walki (scala je najpierw w jeden obraz)
async function analyzeBattleImages(files, onProgress) {
  if (KLUCZE.length === 0) {
    return { sukces: false, blad: "🔑 Brak klucza API", gracze: [] };
  }

  try {
    onProgress?.(`📸 Scalanie ${files.length} screen${files.length === 1 ? "u" : "ów"}...`);
    const base64 = files.length === 1
      ? await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result.split(",")[1]);
          r.onerror = rej;
          r.readAsDataURL(files[0]);
        })
      : await scaleScreenyWalki(files);

    onProgress?.("🤖 Analizuję ranking...");

    let ostatniBladMsg = "";
    for (let proba = 0; proba < 3; proba++) {
      try {
        const url = pobierzURL();
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [
              { text: buildBattlePrompt(files.length) },
              { inline_data: { mime_type: "image/jpeg", data: base64 } }
            ]}],
            generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          let msg = `Błąd ${response.status}`;
          try {
            const j = JSON.parse(errText);
            const code = j.error?.code, m = j.error?.message || "";
            if (code === 429) msg = "⏳ Limit — czekaj";
            else if (code === 403) msg = "🔑 Klucz API zablokowany";
            else msg = `Błąd ${code}: ${m.substring(0, 80)}`;
          } catch {}
          ostatniBladMsg = msg;
          nastepnyKlucz();
          if (proba < 2) {
            onProgress?.(`${msg} — próba ${proba + 2}/3 za 10s...`);
            await new Promise(r => setTimeout(r, 10000));
          }
          continue;
        }

        const data = await response.json();
        let text = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
        if (text.startsWith("```json")) text = text.slice(7);
        else if (text.startsWith("```")) text = text.slice(3);
        if (text.endsWith("```")) text = text.slice(0, -3);
        const parsed = JSON.parse(text.trim());
        const gracze = (parsed.gracze || []).sort((a, b) => b.obrazenia - a.obrazenia);
        nastepnyKlucz();
        return { sukces: true, gracze };

      } catch (e) {
        ostatniBladMsg = e.message;
        nastepnyKlucz();
        if (proba < 2) {
          onProgress?.(`Błąd — próba ${proba + 2}/3 za 10s...`);
          await new Promise(r => setTimeout(r, 10000));
        }
      }
    }
    return { sukces: false, blad: ostatniBladMsg, gracze: [] };

  } catch (e) {
    return { sukces: false, blad: e.message, gracze: [] };
  }
}

// Główny komponent
export default function WalkiView({ czlonkowie, walki, zapiszWalki, isAdmin, archiwumWalk=[] }) {
  const [pliki, setPliki] = useState([]);
  const [podgladURL, setPodgladURL] = useState([]);
  const [analizujac, setAnalizujac] = useState(false);
  const [wyniki, setWyniki] = useState(null);
  const [nazwaWalki, setNazwaWalki] = useState("");
  const [wynikWalki, setWynikWalki] = useState(null); // null=nieokreślony, true=wygrana, false=przegrana
  const [podglad, setPodglad] = useState("ranking");
  const [podsumowanieSezonu, setPodsumowanieSezonu] = useState(null);
  const [podgladLigi, setPodgladLigi] = useState("ocr"); // ocr / historia
  const [edytowanyGracz, setEdytowanyGracz] = useState(null);
  const [aktywnyScreen, setAktywnyScreen] = useState(0);
  const [plikiAktywnosci, setPlikiAktywnosci] = useState([]);
  const [podgladAktywnosci, setPodgladAktywnosci] = useState([]);
  const [analizujacAktywnosc, setAnalizujacAktywnosc] = useState(false);
  const [wynikiAktywnosci, setWynikiAktywnosci] = useState(null);
  const [opoznienie, setOpoznienie] = useState("0");
  const [progressAkt, setProgressAkt] = useState("");

  const handleFiles = (e) => {
    const fs = Array.from(e.target.files || []);
    // Zwolnij stare URL-e
    podgladURL.forEach(u => URL.revokeObjectURL(u));
    const urls = fs.map(f => URL.createObjectURL(f));
    setPliki(fs);
    setPodgladURL(urls);
    setWyniki(null);
  };

  const [progressMsg, setProgressMsg] = useState("");

  const analizuj = async () => {
    if (pliki.length === 0) return;
    setAnalizujac(true);
    setProgressMsg("");

    const wynik = await analyzeBattleImages(pliki, setProgressMsg);

    if (!wynik.sukces) {
      setWyniki({ gracze: [], bledy: [{ blad: wynik.blad }], dataAnalizy: new Date().toISOString() });
    } else {
      setWyniki({ gracze: wynik.gracze, bledy: [], dataAnalizy: new Date().toISOString() });
    }
    setAnalizujac(false);
  };

  const handleAktywnosc = (e) => {
    const fs = Array.from(e.target.files || []);
    podgladAktywnosci.forEach(u => URL.revokeObjectURL(u));
    setPlikiAktywnosci(fs);
    setPodgladAktywnosci(fs.map(f => URL.createObjectURL(f)));
    setWynikiAktywnosci(null);
  };

  const analizujAktywnosc = async () => {
    if (plikiAktywnosci.length === 0) return;
    setAnalizujacAktywnosc(true);
    setProgressAkt("");
    const wynik = await analyzeActivityImages(plikiAktywnosci, setProgressAkt);
    if (wynik.sukces) {
      const opozn = parseInt(opoznienie) || 0;
      const PROG = 30 + opozn; // walka trwa 30 min + opóźnienie screena
      const przetworzone = wynik.czlonkowie
        .filter(c => c.nazwa && c.nazwa.toLowerCase() !== "mob")
        .map(c => ({
          ...c,
          bylNaWalce: c.minutTemu <= PROG,
          poziom: c.poziom || null,
        }));
      setWynikiAktywnosci(przetworzone);
    }
    setAnalizujacAktywnosc(false);
  };

  const dołączAktywnoscDoWalki = () => {
    if (!wynikiAktywnosci || !wyniki) return;
    // Dołącz info o aktywności do graczy w wynikach walki
    const aktMap = {};
    wynikiAktywnosci.forEach(c => { aktMap[c.nazwa.toLowerCase()] = c; });
    const zaktualizowani = wyniki.gracze.map(g => {
      const akt = aktMap[g.nazwa.toLowerCase()];
      return akt ? { ...g, bylNaWalce: akt.bylNaWalce, minutTemu: akt.minutTemu } : g;
    });
    // Dodaj też tych co są na aktywności ale nie na rankingu walki (0 obrażeń)
    wynikiAktywnosci.forEach(c => {
      const jestNaRankingu = wyniki.gracze.some(g => g.nazwa.toLowerCase() === c.nazwa.toLowerCase());
      if (!jestNaRankingu && c.bylNaWalce) {
        zaktualizowani.push({ nazwa: c.nazwa, obrazenia: 0, tarcze: 0, bylNaWalce: true, minutTemu: c.minutTemu, miejsce: 99 });
      }
    });
    setWyniki(prev => ({ ...prev, gracze: zaktualizowani }));
    alert(`✅ Dołączono dane aktywności. ${wynikiAktywnosci.filter(c=>c.bylNaWalce).length} osób było na walce.`);
  };

  const zapiszWalke = async () => {
    if (!wyniki || !nazwaWalki.trim()) {
      alert("Wpisz nazwę/datę walki przed zapisaniem!");
      return;
    }
    const noweWalki = [...(walki || []), {
      id: Date.now(),
      nazwa: nazwaWalki.trim(),
      data: wyniki.dataAnalizy,
      gracze: wyniki.gracze,
      wygrana: wynikWalki,
    }];
    await zapiszWalki(noweWalki);
    zapiszAutoBackup("zapis_walki");
    setWyniki(null);
    setPliki([]);
    setNazwaWalki("");
    setWynikWalki(null);
    alert(`✓ Zapisano walkę "${nazwaWalki.trim()}"`);
  };

  const usunWalke = async (id) => {
    if (!window.confirm("Usunąć tę walkę?")) return;
    await zapiszWalki((walki || []).filter(w => w.id !== id));
  };

  const generujPodsumowanie = () => {
    setPodsumowanieSezonu(obliczPodsumowanieSezonu(walki || [], czlonkowie));
    setPodglad("sezon");
  };

  return (
    <div>
      {/* Tabs — wgrywanie tylko dla admina */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          ...(isAdmin ? [{ id: "ranking", label: "📤 Wgraj walkę" }] : []),
          { id: "historia", label: `📜 Historia (${(walki || []).length})` },
          { id: "sezon", label: "🏆 Podsumowanie sezonu" },
          ...(archiwumWalk.length > 0 ? [{ id: "archiwum", label: `📚 Poprzednie sezony (${archiwumWalk.length})` }] : []),
        ].map(t => (
          <button key={t.id} onClick={() => { setPodglad(t.id); if (t.id === "sezon") generujPodsumowanie(); }} style={{
            padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12,
            background: podglad === t.id ? "rgba(255,215,0,0.15)" : "rgba(255,255,255,0.05)",
            border: podglad === t.id ? "1px solid #ffd700" : "1px solid #2a2a3a",
            color: podglad === t.id ? "#ffd700" : "#888",
          }}>{t.label}</button>
        ))}
      </div>

      {podglad === "ranking" && isAdmin && (
        <>
          <div style={{ background: "rgba(255,215,0,0.06)", border: "1px solid #b8860b33", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#ffd700" }}>
            🎯 <strong>Analiza walki gangu</strong> — wgraj 1-3 screeny rankingu po walce
            <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
              Jeśli na 1 screenie nie mieszczą się wszyscy gracze, wgraj 2-3 screeny — apka scali graczy automatycznie.
            </div>
          </div>

          <div style={{ background: "rgba(0,0,0,0.25)", border: "1px solid #2a2a3a", borderRadius: 10, padding: 14, marginBottom: 14 }}>
            {/* Wynik walki */}
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "#aaa", alignSelf: "center", flexShrink: 0 }}>Wynik:</div>
              {[
                { val: true, label: "🏆 Wygrana", c: "#0c6", bg: "rgba(0,200,100,0.15)" },
                { val: null, label: "⬜ Nieokreślony", c: "#555", bg: "rgba(255,255,255,0.05)" },
                { val: false, label: "💀 Przegrana", c: "#f55", bg: "rgba(255,50,50,0.12)" },
              ].map(opt => (
                <button key={String(opt.val)} onClick={() => setWynikWalki(opt.val)} style={{
                  flex: 1, padding: "6px 4px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: wynikWalki === opt.val ? "bold" : "normal",
                  background: wynikWalki === opt.val ? opt.bg : "rgba(255,255,255,0.03)",
                  border: `1px solid ${wynikWalki === opt.val ? opt.c : "#2a2a3a"}`,
                  color: wynikWalki === opt.val ? opt.c : "#444",
                }}>{opt.label}</button>
              ))}
            </div>
            <input type="text" value={nazwaWalki} onChange={e => setNazwaWalki(e.target.value)}
              placeholder="Nazwa/data walki, np. Walka z 17.05.2026"
              style={{ width: "100%", padding: "8px 10px", background: "#12122a", border: "1px solid #333", borderRadius: 6, color: "#fff", fontSize: 13, marginBottom: 10, boxSizing: "border-box" }} />

            <input type="file" accept="image/*" multiple onChange={handleFiles}
              style={{ width: "100%", padding: 8, background: "#12122a", border: "1px solid #333", borderRadius: 6, color: "#fff", fontSize: 12, marginBottom: 10 }} />

            {pliki.length > 0 && (
              <div style={{ fontSize: 12, color: "#0c6", marginBottom: 10 }}>
                Wybrano {pliki.length} {pliki.length === 1 ? "plik" : "plików"}
              </div>
            )}

            <button onClick={analizuj} disabled={pliki.length === 0 || analizujac}
              style={{
                width: "100%", padding: 12,
                background: pliki.length === 0 || analizujac ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,#b8860b,#ffd700)",
                border: "none", borderRadius: 8, color: pliki.length === 0 || analizujac ? "#666" : "#000",
                fontSize: 14, fontWeight: "bold", cursor: pliki.length === 0 || analizujac ? "not-allowed" : "pointer",
              }}>
              {analizujac ? `⏳ Analizuję...` : `🤖 Analizuj ${pliki.length > 1 ? `${pliki.length} screeny (scalone)` : "screen"}`}
            </button>

            {analizujac && (
              <div style={{ marginTop: 10, background: "rgba(255,215,0,0.06)", border: "1px solid #b8860b33", borderRadius: 6, padding: 10 }}>
                <div style={{ fontSize: 12, color: "#ffd700", textAlign: "center" }}>{progressMsg || "⏳ Przetwarzam..."}</div>
                <div style={{ height: 4, background: "#12122a", borderRadius: 2, overflow: "hidden", marginTop: 8 }}>
                  <div style={{ height: "100%", width: "100%", background: "linear-gradient(90deg,#b8860b,#ffd700)", animation: "pulse 1.5s ease-in-out infinite" }} />
                </div>
              </div>
            )}
          </div>

          {/* Sekcja aktywności członków */}
          <div style={{ background: "rgba(0,100,200,0.06)", border: "1px solid #6496ff33", borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: "bold", color: "#6496ff", marginBottom: 8 }}>
              👥 Aktywność członków <span style={{ fontSize: 10, color: "#555", fontWeight: "normal" }}>(opcjonalne)</span>
            </div>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 10, lineHeight: 1.6 }}>
              Wgraj screeny z zakładki <strong style={{ color: "#aaa" }}>Członkowie</strong> gangu zrobione zaraz po walce.
              Apka sprawdzi kto był aktywny w trakcie walki (30 min + opóźnienie).
            </div>

            {/* Opóźnienie */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "#aaa", flexShrink: 0 }}>Ile minut po walce robisz screen?</div>
              <input type="number" value={opoznienie} onChange={e => setOpoznienie(e.target.value)}
                min="0" max="60" style={{
                  width: 60, padding: "4px 8px", background: "#12122a", border: "1px solid #6496ff44",
                  borderRadius: 6, color: "#6496ff", fontSize: 14, fontWeight: "bold", textAlign: "center"
                }}/>
              <div style={{ fontSize: 10, color: "#555" }}>min (próg: {30 + (parseInt(opoznienie)||0)} min)</div>
            </div>

            <input type="file" accept="image/*" multiple onChange={handleAktywnosc}
              style={{ width: "100%", padding: 8, background: "#12122a", border: "1px solid #333", borderRadius: 6, color: "#fff", fontSize: 12, marginBottom: 8 }} />

            {plikiAktywnosci.length > 0 && (
              <div style={{ fontSize: 11, color: "#6496ff", marginBottom: 8 }}>
                Wybrano {plikiAktywnosci.length} {plikiAktywnosci.length === 1 ? "plik" : "pliki"} aktywności
              </div>
            )}

            <button onClick={analizujAktywnosc} disabled={plikiAktywnosci.length === 0 || analizujacAktywnosc}
              style={{
                width: "100%", padding: 10,
                background: plikiAktywnosci.length === 0 || analizujacAktywnosc ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,#1a3a8f,#6496ff)",
                border: "none", borderRadius: 8,
                color: plikiAktywnosci.length === 0 || analizujacAktywnosc ? "#666" : "#fff",
                fontSize: 13, fontWeight: "bold",
                cursor: plikiAktywnosci.length === 0 || analizujacAktywnosc ? "not-allowed" : "pointer",
              }}>
              {analizujacAktywnosc ? "⏳ Analizuję aktywność..." : "🤖 Analizuj aktywność"}
            </button>

            {progressAkt && (
              <div style={{ marginTop: 8, fontSize: 11, color: "#6496ff", textAlign: "center" }}>{progressAkt}</div>
            )}

            {/* Wyniki aktywności */}
            {wynikiAktywnosci && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: "#aaa", marginBottom: 6 }}>
                  ✅ <strong style={{ color: "#0c6" }}>{wynikiAktywnosci.filter(c=>c.bylNaWalce).length} było</strong> na walce ·
                  <strong style={{ color: "#f55" }}> {wynikiAktywnosci.filter(c=>!c.bylNaWalce).length} nieobecnych</strong>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                  {wynikiAktywnosci.map(c => (
                    <div key={c.nazwa} style={{
                      fontSize: 10, padding: "2px 8px", borderRadius: 12,
                      background: c.bylNaWalce ? "rgba(0,200,100,0.15)" : "rgba(255,50,50,0.12)",
                      border: `1px solid ${c.bylNaWalce ? "#0c633" : "#f5544433"}`,
                      color: c.bylNaWalce ? "#0c6" : "#f55",
                    }}>
                      {c.bylNaWalce ? "✓" : "✗"} {c.nazwa}
                      <span style={{ color: "#555", marginLeft: 3 }}>{c.minutTemu}min</span>
                      {c.poziom && <span style={{ color: "#6496ff", marginLeft: 3 }}>L{c.poziom}</span>}
                    </div>
                  ))}
                </div>
                {wyniki && (
                  <button onClick={dołączAktywnoscDoWalki} style={{
                    width: "100%", padding: 8, background: "rgba(0,200,100,0.15)",
                    border: "1px solid #0c633", borderRadius: 6,
                    color: "#0c6", fontSize: 12, fontWeight: "bold", cursor: "pointer",
                  }}>
                    ➕ Dołącz aktywność do wyników walki
                  </button>
                )}
              </div>
            )}
          </div>

          {wyniki && (
            <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid #2a2a3a", borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                <div style={{ fontWeight: "bold", color: "#ffd700", fontSize: 14 }}>📊 Ranking — {wyniki.gracze.length} graczy</div>
                <button onClick={zapiszWalke} style={{
                  padding: "8px 16px", background: "linear-gradient(135deg,#0c6,#0fa)", border: "none", borderRadius: 8,
                  color: "#000", fontSize: 12, fontWeight: "bold", cursor: "pointer",
                }}>✓ Zapisz walkę</button>
              </div>

              {wyniki.bledy.length > 0 && (
                <div style={{ background: "rgba(255,50,50,0.08)", border: "1px solid #f5544455", borderRadius: 6, padding: 8, marginBottom: 10, fontSize: 11, color: "#f55" }}>
                  ⚠️ Błędy: {wyniki.bledy.map(b => b.blad).join(", ")}
                </div>
              )}

              {/* Podgląd screena(ów) */}
              {podgladURL.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {podgladURL.length > 1 && (
                    <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                      {podgladURL.map((_, i) => (
                        <button key={i} onClick={() => setAktywnyScreen(i)} style={{
                          padding: "3px 10px", fontSize: 11, borderRadius: 5, cursor: "pointer",
                          background: aktywnyScreen === i ? "rgba(255,215,0,0.2)" : "rgba(255,255,255,0.05)",
                          border: aktywnyScreen === i ? "1px solid #ffd700" : "1px solid #333",
                          color: aktywnyScreen === i ? "#ffd700" : "#888",
                        }}>Screen {i + 1}</button>
                      ))}
                    </div>
                  )}
                  <img
                    src={podgladURL[aktywnyScreen]}
                    alt={`Screen ${aktywnyScreen + 1}`}
                    style={{ width: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 8, border: "1px solid #333", background: "#0a0a1a" }}
                  />
                  <div style={{ fontSize: 10, color: "#555", textAlign: "center", marginTop: 4 }}>
                    📸 Oryginał — porównaj z rozpoznanymi wynikami poniżej
                  </div>
                </div>
              )}

              <div style={{ fontSize: 12, color: "#aaa", marginBottom: 8 }}>
                ✏️ Kliknij gracza żeby edytować • ✕ żeby usunąć z listy
              </div>
              <RankingTabelaEdycja
                gracze={wyniki.gracze}
                edytowanyGracz={edytowanyGracz}
                setEdytowanyGracz={setEdytowanyGracz}
                onChange={(now) => setWyniki(w => ({ ...w, gracze: now }))}
              />
            </div>
          )}
        </>
      )}

      {podglad === "historia" && (
        <HistoriaWalk walki={walki || []} usunWalke={usunWalke} isAdmin={isAdmin} zapiszWalki={zapiszWalki} />
      )}

      {podglad === "sezon" && (
        <PodsumowanieSezonu podsumowanie={podsumowanieSezonu} zapiszWalki={zapiszWalki} walki={walki || []} />
      )}

      {podglad === "liga" && (
        <LigaView isAdmin={isAdmin} zapiszWalki={zapiszWalki} walki={walki || []} />
      )}

      {podglad === "archiwum" && (
        <ArchiwumSezonow archiwum={archiwumWalk} czlonkowie={czlonkowie} />
      )}
    </div>
  );
}

function RankingTabelaEdycja({ gracze, edytowanyGracz, setEdytowanyGracz, onChange }) {
  const [tempVal, setTempVal] = useState({});

  const fmt = (n) => {
    if (n >= 1000000) return (n / 1000000).toFixed(2).replace(".", ",") + "M";
    if (n >= 1000) return (n / 1000).toFixed(2).replace(".", ",") + "k";
    return n.toString();
  };

  const parseLiczbe = (s) => {
    const clean = s.replace(",", ".").trim();
    if (clean.endsWith("M") || clean.endsWith("m")) return Math.round(parseFloat(clean) * 1000000);
    if (clean.endsWith("K") || clean.endsWith("k")) return Math.round(parseFloat(clean) * 1000);
    return parseInt(clean) || 0;
  };

  const startEdycji = (i) => {
    setEdytowanyGracz(i);
    setTempVal({ nazwa: gracze[i].nazwa, obrazenia: fmt(gracze[i].obrazenia), tarcze: String(gracze[i].tarcze), poziom: String(gracze[i].poziom || "") });
  };

  const zapiszEdycje = (i) => {
    const now = [...gracze];
    now[i] = { ...now[i], nazwa: tempVal.nazwa || now[i].nazwa, obrazenia: parseLiczbe(tempVal.obrazenia), tarcze: parseInt(tempVal.tarcze) || 0, poziom: parseInt(tempVal.poziom) || now[i].poziom || 0, poziomAkt: parseInt(tempVal.poziom) || now[i].poziomAkt || 0 };
    now.sort((a, b) => b.obrazenia - a.obrazenia);
    onChange(now);
    setEdytowanyGracz(null);
  };

  const usun = (i) => onChange(gracze.filter((_, idx) => idx !== i));

  const dodajGracza = () => {
    const now = [...gracze, { nazwa: "Nowy gracz", poziom: 0, obrazenia: 0, tarcze: 0 }];
    onChange(now);
    setEdytowanyGracz(now.length - 1);
    setTempVal({ nazwa: "", obrazenia: "0", tarcze: "0", poziom: "" });
  };

  const max = Math.max(1, ...gracze.map(g => g.obrazenia));

  return (
    <div>
      {gracze.map((g, i) => {
        const kolor = i === 0 ? "#ffd700" : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : "#888";
        const edytuje = edytowanyGracz === i;
        return (
          <div key={i} style={{
            borderLeft: `3px solid ${kolor}`, borderRadius: 6, marginBottom: 4,
            background: edytuje ? "rgba(255,215,0,0.08)" : i < 3 ? `linear-gradient(90deg,${kolor}11,transparent)` : "rgba(255,255,255,0.02)",
            border: edytuje ? `1px solid ${kolor}88` : undefined,
          }}>
            {edytuje ? (
              // TRYB EDYCJI
              <div style={{ padding: "8px 10px" }}>
                <div style={{ fontSize: 11, color: "#ffd700", marginBottom: 6 }}>✏️ Edytujesz gracza #{i + 1}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <input value={tempVal.nazwa} onChange={e => setTempVal(v => ({ ...v, nazwa: e.target.value }))}
                    placeholder="Nazwa gracza"
                    style={{ padding: "5px 8px", background: "#12122a", border: "1px solid #444", borderRadius: 4, color: "#fff", fontSize: 12 }} />
                  <div style={{ display: "flex", gap: 6 }}>
                    <div style={{ flex: 2 }}>
                      <div style={{ fontSize: 10, color: "#888", marginBottom: 2 }}>🔫 Obrażenia (np. 27,25M lub 828k)</div>
                      <input value={tempVal.obrazenia} onChange={e => setTempVal(v => ({ ...v, obrazenia: e.target.value }))}
                        style={{ width: "100%", padding: "5px 8px", background: "#12122a", border: "1px solid #444", borderRadius: 4, color: "#ffd700", fontSize: 12, boxSizing: "border-box" }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: "#888", marginBottom: 2 }}>🛡️ Tarcze</div>
                      <input value={tempVal.tarcze} onChange={e => setTempVal(v => ({ ...v, tarcze: e.target.value }))}
                        style={{ width: "100%", padding: "5px 8px", background: "#12122a", border: "1px solid #444", borderRadius: 4, color: "#87CEEB", fontSize: 12, boxSizing: "border-box" }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: "#888", marginBottom: 2 }}>⚡ Poziom (lvl)</div>
                      <input type="number" value={tempVal.poziom} onChange={e => setTempVal(v => ({ ...v, poziom: e.target.value }))}
                        placeholder="np. 550"
                        style={{ width: "100%", padding: "5px 8px", background: "#12122a", border: "1px solid #6496ff44", borderRadius: 4, color: "#6496ff", fontSize: 12, boxSizing: "border-box" }} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => zapiszEdycje(i)} style={{ flex: 1, padding: "6px", background: "rgba(0,200,100,0.15)", border: "1px solid #0c6", borderRadius: 5, color: "#0c6", cursor: "pointer", fontSize: 12, fontWeight: "bold" }}>✓ Zapisz</button>
                    <button onClick={() => setEdytowanyGracz(null)} style={{ padding: "6px 12px", background: "rgba(255,255,255,0.05)", border: "1px solid #444", borderRadius: 5, color: "#888", cursor: "pointer", fontSize: 12 }}>Anuluj</button>
                  </div>
                </div>
              </div>
            ) : (
              // TRYB WIDOKU
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(g.obrazenia / max) * 100}%`, background: `${kolor}08`, zIndex: 0 }} />
                <span style={{ fontSize: 13, color: kolor, fontWeight: "bold", width: 24, zIndex: 1 }}>{i + 1}.</span>
                <span style={{ flex: 1, fontSize: 12, color: "#ddd", fontWeight: i < 3 ? "bold" : "normal", zIndex: 1 }}>
                  {g.bylNaWalce !== undefined && (
                    <span title={g.bylNaWalce ? `Był na walce (${g.minutTemu} min temu)` : "Nieobecny na walce"}
                      style={{ marginRight: 4, fontSize: 11 }}>
                      {g.bylNaWalce ? "🟢" : "🔴"}
                    </span>
                  )}
                  {g.nazwa} <span style={{ fontSize: 10, color: "#555" }}>L{g.poziom}</span>
                </span>
                <span style={{ fontSize: 12, color: "#ffd700", zIndex: 1 }}>🔫 {fmt(g.obrazenia)}</span>
                <span style={{ fontSize: 12, color: "#87CEEB", minWidth: 40, textAlign: "right", zIndex: 1 }}>🛡️ {g.tarcze}</span>
                <button onClick={() => startEdycji(i)} style={{ padding: "2px 7px", background: "rgba(255,215,0,0.1)", border: "none", borderRadius: 3, color: "#b8860b", cursor: "pointer", fontSize: 10, zIndex: 1 }}>✏️</button>
                <button onClick={() => usun(i)} style={{ padding: "2px 6px", background: "rgba(255,50,50,0.1)", border: "none", borderRadius: 3, color: "#f5544488", cursor: "pointer", fontSize: 10, zIndex: 1 }}>✕</button>
              </div>
            )}
          </div>
        );
      })}
      <button onClick={dodajGracza} style={{ width: "100%", marginTop: 6, padding: "7px", background: "rgba(255,255,255,0.03)", border: "1px dashed #333", borderRadius: 6, color: "#555", cursor: "pointer", fontSize: 12 }}>
        + Dodaj gracza ręcznie
      </button>
    </div>
  );
}

function RankingTabela({ gracze, edytowalne, onChange }) {
  const fmt = (n) => {
    if (n >= 1000000) return (n / 1000000).toFixed(2).replace(".", ",") + "M";
    if (n >= 1000) return (n / 1000).toFixed(2).replace(".", ",") + "k";
    return n.toString();
  };
  // Sortuj wg obrażeń malejąco
  const posortowani = [...gracze].sort((a, b) => b.obrazenia - a.obrazenia);
  const max = Math.max(1, ...posortowani.map(g => g.obrazenia));
  return (
    <div>
      {posortowani.map((g, i) => {
        const kolor = i === 0 ? "#ffd700" : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : "#888";
        const obecnosc = g.bylNaWalce;
        return (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
            background: i < 3 ? `linear-gradient(90deg,${kolor}11,transparent)` : "rgba(255,255,255,0.02)",
            borderLeft: `3px solid ${kolor}`, borderRadius: 6, marginBottom: 4, position: "relative", overflow: "hidden",
          }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(g.obrazenia / max) * 100}%`, background: `${kolor}08`, zIndex: 0 }} />
            <span style={{ fontSize: 13, color: kolor, fontWeight: "bold", width: 24, zIndex: 1 }}>{i + 1}.</span>
            {obecnosc !== undefined && (
              <span style={{ fontSize: 9, zIndex: 1 }} title={obecnosc ? "Był na walce" : "Nie był na walce"}>
                {obecnosc ? "🟢" : "🔴"}
              </span>
            )}
            <span style={{ flex: 1, fontSize: 12, color: "#ddd", fontWeight: i < 3 ? "bold" : "normal", zIndex: 1 }}>
              {g.nazwa} <span style={{ fontSize: 10, color: "#666" }}>L{g.poziom}</span>
            </span>
            <span style={{ fontSize: 12, color: "#ffd700", minWidth: 70, textAlign: "right", zIndex: 1 }}>🔫 {fmt(g.obrazenia)}</span>
            <span style={{ fontSize: 12, color: "#87CEEB", minWidth: 40, textAlign: "right", zIndex: 1 }}>🛡️ {g.tarcze}</span>
          </div>
        );
      })}
    </div>
  );
}


// Prompt OCR dla screena ligi
function buildLigaPrompt(ileScreenow) {
  const multi = ileScreenow > 1
    ? `Masz ${ileScreenow} screeny połączone pionowo. Każdy gang zwróć TYLKO RAZ.`
    : "Masz jeden screen z rankingiem ligi.";
  return `Odczytaj ranking ligi z gry The Gang. ${multi}

Każdy wiersz zawiera:
- pozycja (#1, #2, #3...)
- nazwa gangu (skopiuj DOKŁADNIE)
- liczba wygranych (ikona korony, np. 5)
- liczba punktów (ikona skrzyżowanych kijów, np. 85)

Zwróć WYŁĄCZNIE JSON (bez markdown):
{"gangi":[{"pozycja":1,"nazwa":"Ludwig Von","wygrane":5,"punkty":85},{"pozycja":3,"nazwa":"Family","wygrane":4,"punkty":70}]}

Nasz gang to "Family". Zwróć wszystkie gangi które widzisz.`;
}

// OCR ligi
async function analyzeLigaImages(files, onProgress) {
  if (KLUCZE.length === 0) return { sukces: false, blad: "Brak klucza API", gangi: [] };
  try {
    onProgress?.(`📸 Scalanie ${files.length} screenu ligi...`);
    const base64 = files.length === 1
      ? await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(files[0]); })
      : await scaleScreenyWalki(files);

    onProgress?.("🤖 Analizuję ranking ligi...");
    for (let proba = 0; proba < 3; proba++) {
      try {
        const url = pobierzURL();
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: buildLigaPrompt(files.length) }, { inline_data: { mime_type: "image/jpeg", data: base64 } }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
          }),
        });
        if (!response.ok) { nastepnyKlucz(); if (proba < 2) { await new Promise(r => setTimeout(r, 10000)); } continue; }
        const data = await response.json();
        let text = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
        if (text.startsWith("```json")) text = text.slice(7);
        if (text.startsWith("```")) text = text.slice(3);
        if (text.endsWith("```")) text = text.slice(0, -3);
        const parsed = JSON.parse(text.trim());
        nastepnyKlucz();
        return { sukces: true, gangi: parsed.gangi || [] };
      } catch (e) {
        nastepnyKlucz();
        if (proba < 2) { onProgress?.(`Błąd — próba ${proba + 2}/3...`); await new Promise(r => setTimeout(r, 10000)); }
      }
    }
    return { sukces: false, blad: "Nie udało się po 3 próbach", gangi: [] };
  } catch (e) {
    return { sukces: false, blad: e.message, gangi: [] };
  }
}

function LigaView({ isAdmin, walki, zapiszWalki }) {
  const [tryb, setTryb] = useState("historia"); // historia / ocr
  const [pliki, setPliki] = useState([]);
  const [analizujac, setAnalizujac] = useState(false);
  const [progress, setProgress] = useState("");
  const [wyniki, setWyniki] = useState(null);
  const [nazwaLigi, setNazwaLigi] = useState("");
  const [sezonLigi, setSezonLigi] = useState("");

  // Historia lig z walki (zapisana per sezon)
  const historiaLig = (walki || [])
    .filter(w => w.ligaSnapshot)
    .map(w => w.ligaSnapshot)
    .filter((v, i, a) => a.findIndex(x => x.id === v.id) === i)
    .sort((a, b) => new Date(b.data) - new Date(a.data));

  const analizujLige = async () => {
    if (pliki.length === 0) return;
    setAnalizujac(true);
    setProgress("");
    const wynik = await analyzeLigaImages(pliki, setProgress);
    if (wynik.sukces) setWyniki(wynik.gangi);
    setAnalizujac(false);
  };

  const zapiszLige = async () => {
    if (!wyniki || !nazwaLigi.trim()) { alert("Wpisz nazwę/sezon ligi!"); return; }
    const snapshot = {
      id: Date.now(),
      nazwa: nazwaLigi.trim(),
      sezon: sezonLigi.trim(),
      data: new Date().toISOString(),
      gangi: wyniki,
    };
    // Zapisz do pierwszej walki jako ligaSnapshot (lub osobny klucz)
    const noweWalki = walki.length > 0
      ? walki.map((w, i) => i === 0 ? { ...w, ligaSnapshot: snapshot } : w)
      : walki;
    // Właściwie lepiej trzymać w osobnej tablicy — dodajemy do walki[0] jako ligSnapshots
    const aktWalki = walki.map((w, i) => {
      if (i !== 0) return w;
      const snapshots = w.ligSnapshots || [];
      return { ...w, ligSnapshots: [...snapshots, snapshot] };
    });
    await zapiszWalki(aktWalki.length > 0 ? aktWalki : walki);
    alert(`✅ Zapisano ranking ligi "${nazwaLigi.trim()}"`);
    setWyniki(null);
    setNazwaLigi("");
    setPliki([]);
    setTryb("historia");
  };

  // Zbierz wszystkie snapshoty lig z walk
  const wszystkieSnapshoty = [];
  (walki || []).forEach(w => {
    if (w.ligSnapshots) wszystkieSnapshoty.push(...w.ligSnapshots);
  });
  wszystkieSnapshoty.sort((a, b) => new Date(b.data) - new Date(a.data));

  const naszGang = (gangi) => gangi.find(g => g.nazwa.toLowerCase().includes("family"));
  const fmt = (g) => g ? `#${g.pozycja} · 🏆${g.wygrane} · ⚔️${g.punkty}` : "—";

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {[{ id: "historia", label: "📊 Historia ligi" }, ...(isAdmin ? [{ id: "ocr", label: "📸 Wgraj ranking" }] : [])].map(t => (
          <button key={t.id} onClick={() => setTryb(t.id)} style={{
            padding: "7px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: tryb === t.id ? "bold" : "normal",
            background: tryb === t.id ? "linear-gradient(135deg,#b8860b,#ffd700)" : "rgba(255,255,255,0.05)",
            border: tryb === t.id ? "none" : "1px solid #2a2a3a",
            color: tryb === t.id ? "#000" : "#888",
          }}>{t.label}</button>
        ))}
      </div>

      {/* OCR */}
      {tryb === "ocr" && isAdmin && (
        <div>
          <div style={{ fontSize: 11, color: "#555", marginBottom: 10 }}>
            Wgraj screeny z rankingu ligi (scalone automatycznie). Gemini odczyta pozycje, wygrane i punkty wszystkich gangów.
          </div>
          <input type="file" accept="image/*" multiple onChange={e => setPliki(Array.from(e.target.files || []))}
            style={{ width: "100%", padding: 8, background: "#12122a", border: "1px solid #333", borderRadius: 6, color: "#fff", fontSize: 12, marginBottom: 8 }} />
          {pliki.length > 0 && <div style={{ fontSize: 11, color: "#ffd700", marginBottom: 8 }}>Wybrano {pliki.length} {pliki.length === 1 ? "plik" : "pliki"}</div>}
          <button onClick={analizujLige} disabled={pliki.length === 0 || analizujac} style={{
            width: "100%", padding: 10, borderRadius: 8, border: "none", fontSize: 13, fontWeight: "bold", cursor: pliki.length === 0 || analizujac ? "not-allowed" : "pointer",
            background: pliki.length === 0 || analizujac ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,#b8860b,#ffd700)",
            color: pliki.length === 0 || analizujac ? "#555" : "#000",
          }}>{analizujac ? "⏳ Analizuję..." : "🤖 Analizuj ranking ligi"}</button>
          {progress && <div style={{ fontSize: 11, color: "#ffd700", marginTop: 6, textAlign: "center" }}>{progress}</div>}

          {wyniki && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: "#aaa", marginBottom: 8 }}>
                Odczytano <strong style={{ color: "#ffd700" }}>{wyniki.length}</strong> gangów
                {naszGang(wyniki) && <span style={{ color: "#0c6", marginLeft: 8 }}>· Family: {fmt(naszGang(wyniki))}</span>}
              </div>
              {/* Tabela */}
              <div style={{ marginBottom: 12 }}>
                {wyniki.map((g, i) => {
                  const jestNasz = g.nazwa.toLowerCase().includes("family");
                  return (
                    <div key={i} style={{
                      display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", marginBottom: 3, borderRadius: 6,
                      background: jestNasz ? "rgba(255,215,0,0.08)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${jestNasz ? "#ffd70033" : "#2a2a3a"}`,
                    }}>
                      <span style={{ fontSize: 12, color: g.pozycja <= 3 ? "#ffd700" : "#666", width: 28, fontWeight: "bold" }}>#{g.pozycja}</span>
                      <span style={{ flex: 1, fontSize: 11, color: jestNasz ? "#ffd700" : "#ddd" }}>{g.nazwa}</span>
                      <span style={{ fontSize: 11, color: "#fa0" }}>🏆{g.wygrane}</span>
                      <span style={{ fontSize: 11, color: "#87CEEB" }}>⚔️{g.punkty}</span>
                    </div>
                  );
                })}
              </div>
              {/* Zapis */}
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <input type="text" value={nazwaLigi} onChange={e => setNazwaLigi(e.target.value)} placeholder="Nazwa (np. Sezon 51 Mundial)"
                  style={{ flex: 1, padding: "6px 10px", background: "#12122a", border: "1px solid #444", borderRadius: 6, color: "#fff", fontSize: 12 }} />
                <input type="text" value={sezonLigi} onChange={e => setSezonLigi(e.target.value)} placeholder="Sezon"
                  style={{ width: 70, padding: "6px 10px", background: "#12122a", border: "1px solid #444", borderRadius: 6, color: "#fff", fontSize: 12 }} />
              </div>
              <button onClick={zapiszLige} style={{
                width: "100%", padding: 10, background: "linear-gradient(135deg,#0c6,#0fa)", border: "none", borderRadius: 8,
                color: "#000", fontSize: 13, fontWeight: "bold", cursor: "pointer",
              }}>💾 Zapisz ranking ligi</button>
            </div>
          )}
        </div>
      )}

      {/* Historia */}
      {tryb === "historia" && (
        <div>
          {wszystkieSnapshoty.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#555" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>⚔️</div>
              <div style={{ fontSize: 13 }}>Brak zapisanych rankingów ligi</div>
              <div style={{ fontSize: 11, color: "#444", marginTop: 4 }}>Wgraj screen z rankingu ligi w zakładce "Wgraj ranking"</div>
            </div>
          ) : (
            wszystkieSnapshoty.map(snap => {
              const nasz = naszGang(snap.gangi || []);
              return (
                <div key={snap.id} style={{ background: "rgba(0,0,0,0.25)", border: "1px solid #2a2a3a", borderRadius: 8, padding: 12, marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 4 }}>
                    <div>
                      <div style={{ fontWeight: "bold", color: "#ffd700", fontSize: 13 }}>{snap.nazwa}</div>
                      <div style={{ fontSize: 10, color: "#555" }}>{new Date(snap.data).toLocaleDateString("pl-PL")} · {snap.gangi?.length || 0} gangów</div>
                    </div>
                    {nasz && (
                      <div style={{ padding: "4px 10px", background: "rgba(255,215,0,0.1)", border: "1px solid #ffd70033", borderRadius: 6, fontSize: 11, color: "#ffd700" }}>
                        Family: #{nasz.pozycja} · 🏆{nasz.wygrane} · ⚔️{nasz.punkty}
                      </div>
                    )}
                  </div>
                  <div>
                    {(snap.gangi || []).map((g, i) => {
                      const jestNasz = g.nazwa.toLowerCase().includes("family");
                      return (
                        <div key={i} style={{
                          display: "flex", gap: 8, alignItems: "center", padding: "4px 8px", borderRadius: 4,
                          background: jestNasz ? "rgba(255,215,0,0.06)" : "transparent",
                        }}>
                          <span style={{ fontSize: 11, color: g.pozycja <= 3 ? "#ffd700" : "#555", width: 24 }}>#{g.pozycja}</span>
                          <span style={{ flex: 1, fontSize: 11, color: jestNasz ? "#ffd700" : "#888" }}>{g.nazwa}</span>
                          <span style={{ fontSize: 10, color: "#fa0" }}>🏆{g.wygrane}</span>
                          <span style={{ fontSize: 10, color: "#87CEEB" }}>⚔️{g.punkty}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function HistoriaWalk({ walki, usunWalke, isAdmin, zapiszWalki }) {
  const [rozwiniete, setRozwiniete] = useState(null);
  const [trybEdycji, setTrybEdycji] = useState(null); // id walki w trybie edycji obecności
  const [trybEdycjiLvl, setTrybEdycjiLvl] = useState(null); // id walki w trybie edycji lvl
  const [edytowaneLvl, setEdytowaneLvl] = useState({}); // {nazwa: lvl}

  const otworzyjedycjeLvl = (walka) => {
    const init = {};
    walka.gracze.forEach(g => { init[g.nazwa] = String(g.poziomAkt || g.poziom || ""); });
    setEdytowaneLvl(init);
    setTrybEdycjiLvl(walka.id);
    setRozwiniete(walka.id);
  };

  const zapiszLvl = async (walkaId) => {
    const noweWalki = walki.map(w => {
      if (w.id !== walkaId) return w;
      return {
        ...w,
        gracze: w.gracze.map(g => ({
          ...g,
          poziomAkt: parseInt(edytowaneLvl[g.nazwa]) || g.poziomAkt || g.poziom || 0,
          poziom: parseInt(edytowaneLvl[g.nazwa]) || g.poziom || 0,
        }))
      };
    });
    await zapiszWalki(noweWalki);
    setTrybEdycjiLvl(null);
  };

  const toggleObecnosc = async (walkaId, graczNazwa) => {
    const noweWalki = walki.map(w => {
      if (w.id !== walkaId) return w;
      return {
        ...w,
        gracze: w.gracze.map(g => {
          if (g.nazwa !== graczNazwa) return g;
          const obecny = g.bylNaWalce;
          // Cykl: ⚪ nieznana → 🟢 był → 🔴 nie był → ⚠️ usprawiedliwiony → ⚪
          let nowa;
          if (obecny === undefined) nowa = true;
          else if (obecny === true) nowa = false;
          else if (obecny === false) nowa = "U"; // usprawiedliwiony
          else nowa = undefined;
          return { ...g, bylNaWalce: nowa };
        })
      };
    });
    await zapiszWalki(noweWalki);
  };

  if (walki.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 40, color: "#666" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
        <div style={{ fontSize: 13 }}>Brak zapisanych walk</div>
        <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>Wgraj screen z pierwszej walki w zakładce "Wgraj walkę"</div>
      </div>
    );
  }

  const sorted = [...walki].sort((a, b) => new Date(b.data) - new Date(a.data));

  return (
    <div>
      <div style={{ fontSize: 12, color: "#aaa", marginBottom: 10 }}>Zapisano <strong style={{ color: "#ffd700" }}>{walki.length}</strong> walk</div>
      {sorted.map(w => {
        const bylaNaWalce = w.gracze.filter(g => g.bylNaWalce === true || g.bylNaWalce === "U").length;
        const niebylo = w.gracze.filter(g => g.bylNaWalce === false).length;
        const usprawiedliwieni = w.gracze.filter(g => g.bylNaWalce === "U").length;
        const wygranaInfo = w.wygrana === true ? "🏆" : w.wygrana === false ? "💀" : null;
        const maObecnosc = w.gracze.some(g => g.bylNaWalce !== undefined);
        return (
          <div key={w.id} style={{ background: "rgba(0,0,0,0.25)", border: "1px solid #2a2a3a", borderRadius: 8, padding: 12, marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: "bold", color: "#ffd700", fontSize: 13 }}>{w.nazwa}</span>
                  {wygranaInfo && <span style={{ fontSize: 14 }} title={w.wygrana ? "Wygrana" : "Przegrana"}>{wygranaInfo}</span>}
                </div>
                <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>
                  {new Date(w.data).toLocaleString("pl-PL")} • {w.gracze.length} graczy
                  {maObecnosc && <span style={{ marginLeft: 8 }}>
                    <span style={{ color: "#0c6" }}>🟢{bylaNaWalce}</span>
                    <span style={{ color: "#f55", marginLeft: 4 }}>🔴{niebylo}</span>
                    {usprawiedliwieni > 0 && <span style={{ color: "#fa0", marginLeft: 4 }}>⚠️{usprawiedliwieni}</span>}
                  </span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 5 }}>
                {isAdmin && (
                  <button onClick={() => {
                    const noweWalki = walki.map(x => x.id !== w.id ? x : {
                      ...x, wygrana: x.wygrana === undefined ? true : x.wygrana === true ? false : undefined
                    });
                    zapiszWalki(noweWalki);
                  }} style={{
                    padding: "4px 8px", borderRadius: 5, cursor: "pointer", fontSize: 11,
                    background: w.wygrana === true ? "rgba(0,200,100,0.2)" : w.wygrana === false ? "rgba(255,50,50,0.15)" : "rgba(255,255,255,0.05)",
                    border: `1px solid ${w.wygrana === true ? "#0c6" : w.wygrana === false ? "#f55" : "#333"}`,
                    color: w.wygrana === true ? "#0c6" : w.wygrana === false ? "#f55" : "#555",
                  }}>{w.wygrana === true ? "🏆 Wygrana" : w.wygrana === false ? "💀 Przegrana" : "⬜ Wynik"}</button>
                )}
                {isAdmin && (
                  <button onClick={() => otworzyjedycjeLvl(w)} style={{
                    padding: "4px 8px", borderRadius: 5, cursor: "pointer", fontSize: 11,
                    background: trybEdycjiLvl === w.id ? "rgba(100,200,255,0.2)" : "rgba(100,200,255,0.08)",
                    border: `1px solid ${trybEdycjiLvl === w.id ? "#64c8ff" : "#64c8ff33"}`,
                    color: "#64c8ff",
                  }}>⚡ Lvl</button>
                )}
                {isAdmin && (
                  <button onClick={() => setTrybEdycji(trybEdycji === w.id ? null : w.id)} style={{
                    padding: "4px 8px", borderRadius: 5, cursor: "pointer", fontSize: 11,
                    background: trybEdycji === w.id ? "rgba(100,150,255,0.2)" : "rgba(100,150,255,0.08)",
                    border: `1px solid ${trybEdycji === w.id ? "#6496ff" : "#6496ff33"}`,
                    color: "#6496ff",
                  }}>👥 Obecność</button>
                )}
                <button onClick={() => setRozwiniete(rozwiniete === w.id ? null : w.id)} style={{
                  padding: "4px 10px", background: "rgba(255,215,0,0.1)", border: "1px solid #b8860b55", borderRadius: 5, color: "#b8860b", cursor: "pointer", fontSize: 11,
                }}>{rozwiniete === w.id ? "Zwiń" : "Pokaż"}</button>
                {isAdmin && (
                  <button onClick={() => usunWalke(w.id)} style={{
                    padding: "4px 8px", background: "rgba(255,50,50,0.1)", border: "1px solid #f5544455", borderRadius: 5, color: "#f55", cursor: "pointer", fontSize: 11,
                  }}>🗑</button>
                )}
              </div>
            </div>

            {/* Edycja lvl */}
            {trybEdycjiLvl === w.id && (
              <div style={{ marginTop: 10, padding: 10, background: "rgba(100,200,255,0.06)", border: "1px solid #64c8ff22", borderRadius: 6 }}>
                <div style={{ fontSize: 11, color: "#64c8ff", marginBottom: 8, fontWeight: "bold" }}>
                  ⚡ Edycja poziomów — wpisz lvl dla każdego gracza
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginBottom: 8 }}>
                  {w.gracze.sort((a,b)=>a.nazwa.localeCompare(b.nazwa)).map(g => (
                    <div key={g.nazwa} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ fontSize: 10, color: "#aaa", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {g.nazwa.replace(/™FAM™|fAM™|FAM™/g, "")}
                      </span>
                      <input
                        type="number"
                        value={edytowaneLvl[g.nazwa] || ""}
                        onChange={e => setEdytowaneLvl(prev => ({ ...prev, [g.nazwa]: e.target.value }))}
                        placeholder="lvl"
                        style={{ width: 65, padding: "3px 6px", background: "#12122a", border: "1px solid #64c8ff44", borderRadius: 4, color: "#64c8ff", fontSize: 12, textAlign: "center" }}
                      />
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => zapiszLvl(w.id)} style={{
                    flex: 1, padding: "6px", background: "rgba(100,200,255,0.15)",
                    border: "1px solid #64c8ff44", borderRadius: 5,
                    color: "#64c8ff", cursor: "pointer", fontWeight: "bold", fontSize: 12,
                  }}>✓ Zapisz poziomy</button>
                  <button onClick={() => setTrybEdycjiLvl(null)} style={{
                    padding: "6px 12px", background: "rgba(255,255,255,0.05)",
                    border: "1px solid #444", borderRadius: 5, color: "#888", cursor: "pointer", fontSize: 12,
                  }}>Anuluj</button>
                </div>
              </div>
            )}

            {/* Edycja obecności */}
            {trybEdycji === w.id && (
              <div style={{ marginTop: 10, padding: 10, background: "rgba(100,150,255,0.06)", border: "1px solid #6496ff22", borderRadius: 6 }}>
                <div style={{ fontSize: 11, color: "#6496ff", marginBottom: 8, fontWeight: "bold" }}>
                  👥 Edycja obecności — kliknij gracza żeby zmienić status
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {w.gracze.sort((a,b)=>a.nazwa.localeCompare(b.nazwa)).map(g => {
                    const byl = g.bylNaWalce;
                    const kolor = byl === true ? "#0c6" : byl === false ? "#f55" : byl === "U" ? "#fa0" : "#888";
                    const bg = byl === true ? "rgba(0,200,100,0.12)" : byl === false ? "rgba(255,50,50,0.1)" : byl === "U" ? "rgba(255,165,0,0.12)" : "rgba(255,255,255,0.05)";
                    const ikona = byl === true ? "🟢" : byl === false ? "🔴" : byl === "U" ? "⚠️" : "⚪";
                    const label = byl === "U" ? "USP." : g.nazwa.replace(/™FAM™|fAM™|FAM™/g, "");
                    return (
                      <button key={g.nazwa} onClick={() => toggleObecnosc(w.id, g.nazwa)} title={byl === "U" ? "Usprawiedliwiony" : ""} style={{
                        padding: "4px 10px", borderRadius: 16, cursor: "pointer", fontSize: 11,
                        background: bg, border: `1px solid ${kolor}44`, color: kolor,
                      }}>
                        {ikona} {label}
                      </button>
                    );
                  })}
                  <div style={{ fontSize: 10, color: "#555", marginTop: 6, width: "100%" }}>
                    ⚪ nieznana → 🟢 był → 🔴 nie był → ⚠️ usprawiedliwiony → ⚪
                  </div>
                </div>
                <div style={{ fontSize: 10, color: "#555", marginTop: 6 }}>
                  ⚪ nieznana · 🟢 był · 🔴 nie był — zmiany zapisują się automatycznie
                </div>
              </div>
            )}

            {rozwiniete === w.id && (
              <div style={{ marginTop: 12 }}>
                <RankingTabela gracze={w.gracze} edytowalne={false} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Liczy statystyki sezonu z wszystkich walk
function ArchiwumSezonow({ archiwum, czlonkowie }) {
  const [wybranyIdx, setWybranyIdx] = useState(0);
  const [podsumowanie, setPodsumowanie] = useState(null);

  const sezon = archiwum[wybranyIdx];

  useEffect(() => {
    if (sezon) setPodsumowanie(obliczPodsumowanieSezonu(sezon.walki || [], czlonkowie));
  }, [wybranyIdx, sezon, czlonkowie]);

  if (!archiwum.length) return null;

  // Sortuj od najnowszego
  const posortowane = [...archiwum].sort((a, b) => (b.data || 0) - (a.data || 0));

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: "bold", color: "#ffd700", marginBottom: 10 }}>
        📚 Poprzednie sezony ({archiwum.length})
      </div>

      {/* Wybór sezonu */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        {posortowane.map((s, i) => (
          <button key={i} onClick={() => setWybranyIdx(archiwum.indexOf(s))} style={{
            padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12,
            background: wybranyIdx === archiwum.indexOf(s) ? "linear-gradient(135deg,#b8860b,#ffd700)" : "rgba(255,255,255,0.05)",
            border: wybranyIdx === archiwum.indexOf(s) ? "none" : "1px solid #2a2a3a",
            color: wybranyIdx === archiwum.indexOf(s) ? "#000" : "#888",
            fontWeight: wybranyIdx === archiwum.indexOf(s) ? "bold" : "normal",
          }}>
            📅 {s.sezon} ({(s.walki || []).length} walk)
          </button>
        ))}
      </div>

      {/* Podsumowanie wybranego sezonu */}
      {podsumowanie && (
        <div>
          <div style={{ fontSize: 12, color: "#888", marginBottom: 10, padding: "6px 12px", background: "rgba(255,215,0,0.05)", border: "1px solid #ffd70022", borderRadius: 6 }}>
            📅 Sezon: <strong style={{ color: "#ffd700" }}>{sezon?.sezon}</strong> · {(sezon?.walki || []).length} walk
          </div>
          <PodsumowanieSezonu
            podsumowanie={podsumowanie}
            zapiszWalki={null}
            walki={sezon?.walki || []}
            readonly={true}
          />
        </div>
      )}
    </div>
  );
}

function obliczPodsumowanieSezonu(walki, czlonkowie) {
  if (walki.length === 0) return null;

  const statystyki = {};
  walki.forEach(w => {
    // Deduplikuj graczy w ramach jednej walki (mogą być na 2 screenach)
    const graczeWWalce = {};
    w.gracze.forEach(g => {
      if (!graczeWWalce[g.nazwa] || g.obrazenia > graczeWWalce[g.nazwa].obrazenia) {
        graczeWWalce[g.nazwa] = g;
      }
    });

    Object.values(graczeWWalce).forEach(g => {
      if (!statystyki[g.nazwa]) {
        statystyki[g.nazwa] = {
          nazwa: g.nazwa,
          obrazeniaLacznie: 0,
          tarczeLacznie: 0,
          uczestnictwa: 0,
          miejsca: [],
          historiaObr: [],
          historiaPozyc: [], // pozycja w rankingu per walka
        };
      }
      const s = statystyki[g.nazwa];
      s.obrazeniaLacznie += g.obrazenia;
      s.tarczeLacznie += g.tarcze;
      s.uczestnictwa++;
      s.miejsca.push(g.miejsce || 99);
      s.historiaObr.push({ data: w.data, obr: g.obrazenia, walkaId: w.id });
      s.historiaPozyc.push({ data: w.data, walkaId: w.id, obrazenia: g.obrazenia });
      // Zapisz poziom jeśli dostępny (z danych aktywności)
      const poziomGracza = g.poziomAkt || g.poziom || null;
      if (poziomGracza) {
        if (!s.historiaPoziomow) s.historiaPoziomow = [];
        s.historiaPoziomow.push({ data: w.data, poziom: poziomGracza });
      }
      // Jeśli mamy dane aktywności — zapisz obecność (bylNaWalce)
      if (g.bylNaWalce !== undefined) {
        s.obecnosciLacznie = (s.obecnosciLacznie || 0) + (g.bylNaWalce ? 1 : 0);
        s.maObecnoscDane = true;
      }
    });
  });

  const wszyscy = Object.values(statystyki);
  wszyscy.sort((a, b) => b.obrazeniaLacznie - a.obrazeniaLacznie);

  // Pozycja w łącznym rankingu sezonu (indeks w posortowanej liście)
  wszyscy.forEach((g, i) => { g.pozycjaSezonu = i + 1; });

  const lacznaWalka = walki.length;
  // Helper: prawdziwa frekwencja (z bylNaWalce) lub uczestnictwa jako fallback
  const getFrekwencja = (g) => {
    if (g.maObecnoscDane) return { liczba: g.obecnosciLacznie || 0, zDanych: true };
    return { liczba: g.uczestnictwa, zDanych: false };
  };
  const ciekawostki = [];

  // 1. Król obrażeń
  if (wszyscy[0]) {
    ciekawostki.push({ ikona: "👑", tytul: "Król obrażeń", opis: `${wszyscy[0].nazwa} — ${formatLiczby(wszyscy[0].obrazeniaLacznie)} łącznych obrażeń (śr. ${formatLiczby(Math.round(wszyscy[0].obrazeniaLacznie / wszyscy[0].uczestnictwa))} na walkę)` });
  }

  // 2. Mistrz tarcz
  const mistrzTarcz = [...wszyscy].sort((a, b) => b.tarczeLacznie - a.tarczeLacznie)[0];
  if (mistrzTarcz && mistrzTarcz.tarczeLacznie > 0) {
    ciekawostki.push({ ikona: "🛡️", tytul: "Mistrz tarcz", opis: `${mistrzTarcz.nazwa} — zdjął ${mistrzTarcz.tarczeLacznie} tarcz (śr. ${(mistrzTarcz.tarczeLacznie / mistrzTarcz.uczestnictwa).toFixed(1)} na walkę)` });
  }

  // 3. Największy awans w RANKINGU (porównanie pozycji w 1. połowie vs 2. połowie sezonu)
  if (lacznaWalka >= 4) {
    const polowa = Math.floor(lacznaWalka / 2);
    const walkiSortowane = [...walki].sort((a, b) => new Date(a.data) - new Date(b.data));
    const walkiPierwsze = walkiSortowane.slice(0, polowa);
    const walkiDrugie = walkiSortowane.slice(polowa);

    const awanseRankingowe = wszyscy.map(g => {
      const obrPierwsze = walkiPierwsze
        .map(w => w.gracze.find(gr => gr.nazwa === g.nazwa)?.obrazenia || 0)
        .filter(x => x > 0);
      const obrDrugie = walkiDrugie
        .map(w => w.gracze.find(gr => gr.nazwa === g.nazwa)?.obrazenia || 0)
        .filter(x => x > 0);
      if (obrPierwsze.length === 0 || obrDrugie.length === 0) return null;
      const srPierwsze = obrPierwsze.reduce((s, x) => s + x, 0) / obrPierwsze.length;
      const srDrugie = obrDrugie.reduce((s, x) => s + x, 0) / obrDrugie.length;
      const zmiana = srPierwsze > 0 ? ((srDrugie - srPierwsze) / srPierwsze) * 100 : 0;
      return { nazwa: g.nazwa, zmiana, srPierwsze, srDrugie };
    }).filter(Boolean);

    const najlepszaForma = [...awanseRankingowe].sort((a, b) => b.zmiana - a.zmiana)[0];
    const najgorszaForma = [...awanseRankingowe].sort((a, b) => a.zmiana - b.zmiana)[0];

    if (najlepszaForma && najlepszaForma.zmiana > 15) {
      ciekawostki.push({ ikona: "📈", tytul: "Największy awans formy", opis: `${najlepszaForma.nazwa} — wzrost o ${najlepszaForma.zmiana.toFixed(0)}% (śr. ${formatLiczby(Math.round(najlepszaForma.srPierwsze))} → ${formatLiczby(Math.round(najlepszaForma.srDrugie))} na walkę)` });
    }
    if (najgorszaForma && najgorszaForma.zmiana < -15) {
      ciekawostki.push({ ikona: "📉", tytul: "Największy spadek formy", opis: `${najgorszaForma.nazwa} — spadek o ${Math.abs(najgorszaForma.zmiana).toFixed(0)}% (śr. ${formatLiczby(Math.round(najgorszaForma.srPierwsze))} → ${formatLiczby(Math.round(najgorszaForma.srDrugie))} na walkę)` });
    }
  }

  // 3a. Awanse poziomów w sezonie
  const awansePoziomu = [];
  wszyscy.forEach(g => {
    const hist = g.historiaPoziomow || [];
    if (hist.length >= 2) {
      const pierwszy = hist[0].poziom;
      const ostatni = hist[hist.length - 1].poziom;
      const roznica = ostatni - pierwszy;
      if (roznica > 0) {
        awansePoziomu.push({ nazwa: g.nazwa, pierwszy, ostatni, roznica });
      }
    }
  });

  if (awansePoziomu.length > 0) {
    const maxAwans = [...awansePoziomu].sort((a, b) => b.roznica - a.roznica)[0];
    ciekawostki.push({
      ikona: "⬆️",
      tytul: "Największy awans poziomów",
      opis: `${maxAwans.nazwa} — awansował z L${maxAwans.pierwszy} na L${maxAwans.ostatni} (+${maxAwans.roznica} lvl w sezonie)`
    });
    if (awansePoziomu.length > 1) {
      const lista = awansePoziomu.slice(1, 5).map(a => `${a.nazwa.replace(/™FAM™|fAM™|FAM™/g,"")} +${a.roznica}`).join(", ");
      ciekawostki.push({
        ikona: "📈",
        tytul: "Postęp poziomów sezonu",
        opis: lista + (awansePoziomu.length > 5 ? ` i ${awansePoziomu.length - 5} innych` : "")
      });
    }
  }

  // 3b. Awanse i spadki pozycji w rankingu między 1. a ostatnią walką
  if (lacznaWalka >= 2) {
    const walkiSort = [...walki].sort((a, b) => new Date(a.data) - new Date(b.data));
    const pierwszaWalka = walkiSort[0];
    const ostatniaWalka = walkiSort[walkiSort.length - 1];

    // Ranking w pierwszej walce
    const rankPierwsza = [...pierwszaWalka.gracze]
      .sort((a, b) => b.obrazenia - a.obrazenia)
      .map((g, i) => ({ nazwa: g.nazwa, poz: i + 1 }));

    // Ranking w ostatniej walce
    const rankOstatnia = [...ostatniaWalka.gracze]
      .sort((a, b) => b.obrazenia - a.obrazenia)
      .map((g, i) => ({ nazwa: g.nazwa, poz: i + 1 }));

    // Oblicz zmianę pozycji dla każdego gracza
    const zmianyPozycji = [];
    rankOstatnia.forEach(ro => {
      const rp = rankPierwsza.find(r => r.nazwa === ro.nazwa);
      if (!rp) return;
      const zmiana = rp.poz - ro.poz; // dodatnia = awans (był wyżej numerycznie = gorzej)
      if (Math.abs(zmiana) >= 2) {
        zmianyPozycji.push({ nazwa: ro.nazwa, zmiana, pozPierwsza: rp.poz, pozOstatnia: ro.poz });
      }
    });

    if (zmianyPozycji.length > 0) {
      const awanse = zmianyPozycji.filter(z => z.zmiana > 0).sort((a, b) => b.zmiana - a.zmiana);
      const spadki = zmianyPozycji.filter(z => z.zmiana < 0).sort((a, b) => a.zmiana - b.zmiana);

      if (awanse.length > 0) {
        const a = awanse[0];
        ciekawostki.push({
          ikona: "🚀",
          tytul: "Największy awans sezonu",
          opis: `${a.nazwa} — z #${a.pozPierwsza} na #${a.pozOstatnia} (+${a.zmiana} miejsc między 1. a ostatnią walką)`
        });
      }
      if (spadki.length > 0) {
        const s = spadki[0];
        ciekawostki.push({
          ikona: "📉",
          tytul: "Największy spadek sezonu",
          opis: `${s.nazwa} — z #${s.pozPierwsza} na #${s.pozOstatnia} (${s.zmiana} miejsc między 1. a ostatnią walką)`
        });
      }

      // Wszyscy co awansowali/spadli — krótka lista
      if (awanse.length > 1) {
        const lista = awanse.slice(1, 4).map(a => `${a.nazwa} +${a.zmiana}`).join(", ");
        ciekawostki.push({
          ikona: "⬆️",
          tytul: "Gracze w formie wzrostowej",
          opis: `${lista}${awanse.length > 4 ? ` i ${awanse.length - 4} innych` : ""}`
        });
      }
      if (spadki.length > 1) {
        const lista = spadki.slice(1, 4).map(s => `${s.nazwa} ${s.zmiana}`).join(", ");
        ciekawostki.push({
          ikona: "⬇️",
          tytul: "Gracze w formie spadkowej",
          opis: `${lista}${spadki.length > 4 ? ` i ${spadki.length - 4} innych` : ""}`
        });
      }
    }
  }

  // 4. Najaktywniejszy — używaj bylNaWalce jeśli dostępne
  const sortWgAktywnosci = [...wszyscy].sort((a, b) => {
    const fa = getFrekwencja(a);
    const fb = getFrekwencja(b);
    return fb.liczba - fa.liczba;
  });
  const najwiecejWalk = sortWgAktywnosci[0];
  if (najwiecejWalk) {
    const fr = getFrekwencja(najwiecejWalk);
    const procent = Math.round((fr.liczba / lacznaWalka) * 100);
    const label = fr.zDanych ? "obecny na" : "w rankingu";
    ciekawostki.push({ ikona: "🎮", tytul: "Najaktywniejszy", opis: `${najwiecejWalk.nazwa} — ${label} ${fr.liczba} z ${lacznaWalka} walk (${procent}%)` });
  }

  // 5. Konsekwentny gracz — najmniejsza wariancja wyników (stabilna forma)
  if (lacznaWalka >= 3) {
    const stabilni = wszyscy.filter(g => g.uczestnictwa >= Math.ceil(lacznaWalka * 0.6)).map(g => {
      const sr = g.obrazeniaLacznie / g.uczestnictwa;
      const wariancja = g.historiaObr.reduce((s, h) => s + Math.pow(h.obr - sr, 2), 0) / g.historiaObr.length;
      const odchylenie = Math.sqrt(wariancja);
      const wskaznik = sr > 0 ? (odchylenie / sr) * 100 : 999; // niższy = bardziej stabilny
      return { nazwa: g.nazwa, wskaznik, sr };
    }).sort((a, b) => a.wskaznik - b.wskaznik);
    if (stabilni[0] && stabilni[0].wskaznik < 30) {
      ciekawostki.push({ ikona: "🎯", tytul: "Żelazna konsekwencja", opis: `${stabilni[0].nazwa} — najbardziej stabilny gracz, odchylenie tylko ${stabilni[0].wskaznik.toFixed(0)}% od swojej średniej ${formatLiczby(Math.round(stabilni[0].sr))}` });
    }
  }

  // 7. Mało zaangażowani
  const malo = wszyscy.filter(g => g.obrazeniaLacznie < 500000 && g.uczestnictwa >= 2);
  if (malo.length > 0) {
    ciekawostki.push({ ikona: "💤", tytul: "Mało zaangażowani", opis: `${malo.map(g => `${g.nazwa} (${formatLiczby(g.obrazeniaLacznie)})`).slice(0, 3).join(", ")}` });
  }

  // Pasożyt eventu — stosunek obrażeń do zdobytych lvl
  const graczeZLvl = wszyscy.filter(g => {
    const hist = g.historiaPoziomow || [];
    return hist.length >= 2 && g.uczestnictwa >= 2 && (hist[hist.length-1].poziom - hist[0].poziom) > 0;
  });

  if (graczeZLvl.length >= 2) {
    // Oblicz obrażenia/lvl dla każdego
    const stosunki = graczeZLvl.map(g => {
      const hist = g.historiaPoziomow;
      const przyrost = hist[hist.length-1].poziom - hist[0].poziom;
      return { ...g, przyrostLvl: przyrost, obrNaLvl: g.obrazeniaLacznie / przyrost };
    });

    // Mediana stosunku gangu
    const sortowane = [...stosunki].sort((a,b) => a.obrNaLvl - b.obrNaLvl);
    const mediana = sortowane[Math.floor(sortowane.length/2)].obrNaLvl;

    // Pasożyt = poniżej 25% mediany
    const pasozyt = stosunki
      .filter(g => g.obrNaLvl < mediana * 0.25)
      .sort((a,b) => a.obrNaLvl - b.obrNaLvl);

    if (pasozyt.length > 0) {
      const lista = pasozyt.map(g =>
        `${g.nazwa} (${formatLiczby(Math.round(g.obrNaLvl))} obr/lvl)`
      ).join(", ");
      ciekawostki.push({
        ikona: "🪱",
        tytul: "Pasożyt eventu",
        opis: `${lista}. Zdobywają lvl ale nie w walkach gangowych. Aktywnie grają — tylko nie dla gangu.`
      });
    }

    // Top gracz — najlepszy stosunek obr/lvl
    const najlepszy = stosunki.sort((a,b) => b.obrNaLvl - a.obrNaLvl)[0];
    if (najlepszy) {
      ciekawostki.push({
        ikona: "⚔️",
        tytul: "Walczy dla gangu",
        opis: `${najlepszy.nazwa} — ${formatLiczby(Math.round(najlepszy.obrNaLvl))} obrażeń na każdy zdobyty lvl. Gra dla gangu, nie dla rankingów.`
      });
    }
  }

  // 8. CZARNY HUMOR — ostro po bandzie
  const ostatniaWalka = [...walki].sort((a, b) => new Date(b.data) - new Date(a.data))[0];
  const lacznie = wszyscy.reduce((s, g) => s + g.obrazeniaLacznie, 0);
  const srWalka = lacznaWalka > 0 ? Math.round(lacznie / lacznaWalka) : 0;
  const srednieObr = wszyscy.length > 0 ? lacznie / wszyscy.length : 0;

  if (ostatniaWalka) {
    const ostatniRanking = [...ostatniaWalka.gracze].sort((a, b) => b.obrazenia - a.obrazenia);
    const ostatniMiejsce = ostatniRanking[ostatniRanking.length - 1];

    if (ostatniMiejsce && ostatniMiejsce.obrazenia < 10000) {
      const zlosliwe = [
        `${ostatniMiejsce.nazwa} skończył ostatni z ${formatLiczby(ostatniMiejsce.obrazenia)} obrażeniami. Twój telefon walczył dzielniej niż Ty.`,
        `${ostatniMiejsce.nazwa} — ${formatLiczby(ostatniMiejsce.obrazenia)} obrażeń. Nawet autokliker by się wstydził.`,
        `${ostatniMiejsce.nazwa} zarobił ostatnie miejsce z ${formatLiczby(ostatniMiejsce.obrazenia)} obrażeniami. Gratulacje, to wymaga talentu.`,
        `${ostatniMiejsce.nazwa} i jego ${formatLiczby(ostatniMiejsce.obrazenia)} obrażeń. Czy to celowe? Bo jeśli tak, to szczyt kunsztu.`,
      ];
      ciekawostki.push({ ikona: "🥄", tytul: "Złota łyżka — ostatnie miejsce", opis: zlosliwe[lacznaWalka % zlosliwe.length] });
    }

    const zerObr = ostatniRanking.filter(g => g.obrazenia === 0);
    if (zerObr.length > 0) {
      const zeroTeksty = [
        `${zerObr.map(g=>g.nazwa).join(", ")} zrobiło 0 obrażeń. Zero. Null. Void. Nie wiadomo czy grał czy tylko patrzył.`,
        `${zerObr.map(g=>g.nazwa).join(", ")} — 0 obrażeń w walce. Spektakularne osiągnięcie w złym kierunku.`,
        `${zerObr.map(g=>g.nazwa).join(", ")} osiągnął matematyczne minimum możliwego wkładu. Brawo.`,
      ];
      ciekawostki.push({ ikona: "👻", tytul: "Duch gangu", opis: zeroTeksty[lacznaWalka % zeroTeksty.length] });
    }
  }

  // Tarcze zamiast obrażeń
  const zerTarcz = wszyscy.filter(g => g.tarczeLacznie === 0 && g.uczestnictwa >= 3);
  if (zerTarcz.length > 0) {
    ciekawostki.push({ ikona: "🫧", tytul: "Co to są tarcze?", opis: `${zerTarcz.map(g => g.nazwa).join(", ")} przez cały sezon nie zdjął ani jednej tarczy. Może myślisz że tarcze to dekoracje? 🎨` });
  }

  // Ogromna przepaść lider vs ostatni
  if (wszyscy.length > 2) {
    const ostatni = wszyscy[wszyscy.length - 1];
    const najlepszy = wszyscy[0];
    if (ostatni.obrazeniaLacznie > 0) {
      const stosunek = Math.round(najlepszy.obrazeniaLacznie / Math.max(1, ostatni.obrazeniaLacznie));
      if (stosunek >= 5) {
        const przepasc = [
          `${najlepszy.nazwa} robi ${stosunek}× więcej niż ${ostatni.nazwa}. Grają w tę samą grę? Dowody sugerują inaczej.`,
          `${stosunek}× — taka różnica między ${najlepszy.nazwa} a ${ostatni.nazwa}. Jeden z nich gra, drugi udaje.`,
          `${ostatni.nazwa} kontra ${najlepszy.nazwa}: stosunek ${stosunek}:1. W sporcie to się nazywa walkowerem.`,
        ];
        ciekawostki.push({ ikona: "🐢", tytul: "Żółwik sezonu", opis: przepasc[lacznaWalka % przepasc.length] });
      }
    }
  }

  // Zawsze w top 3
  if (lacznaWalka >= 3) {
    const zawszeTop3 = wszyscy.filter(g =>
      g.uczestnictwa >= Math.ceil(lacznaWalka * 0.7) &&
      g.historiaObr.filter(h => {
        const walka = walki.find(w => w.gracze.some(gr => gr.nazwa === g.nazwa && gr.obrazenia === h.obr));
        if (!walka) return false;
        const ranking = [...walka.gracze].sort((a,b) => b.obrazenia - a.obrazenia);
        return ranking.findIndex(gr => gr.nazwa === g.nazwa) <= 2;
      }).length >= Math.ceil(g.uczestnictwa * 0.6)
    );
    if (zawszeTop3.length > 0) {
      ciekawostki.push({ ikona: "🦁", tytul: "Niezniszczalny", opis: `${zawszeTop3[0].nazwa} regularnie w TOP 3. Reszta gangu już przestała się zastanawiać dlaczego — po prostu to akceptuje.` });
    }
  }

  // Robot — stałe wyniki
  if (lacznaWalka >= 3) {
    const konsekwentny = wszyscy.filter(g => {
      if (g.uczestnictwa < 3) return false;
      const obr = g.historiaObr.map(h => h.obr);
      const srednia = obr.reduce((s,o)=>s+o,0)/obr.length;
      const odchylenie = Math.sqrt(obr.reduce((s,o)=>s+Math.pow(o-srednia,2),0)/obr.length);
      return odchylenie < srednia * 0.1 && srednia > 5000;
    });
    if (konsekwentny.length > 0) {
      ciekawostki.push({ ikona: "🤖", tytul: "Bot sezonu", opis: `${konsekwentny[0].nazwa} robi identyczne wyniki w każdej walce. Albo to talent, albo autokliker. Nie osądzamy. Naprawdę.` });
    }
  }

  // Glow up
  if (lacznaWalka >= 4) {
    const poprawil = wszyscy.filter(g => {
      if (g.historiaObr.length < 4) return false;
      const polowa = Math.floor(g.historiaObr.length / 2);
      const sr1 = g.historiaObr.slice(0, polowa).reduce((s,h)=>s+h.obr,0)/polowa;
      const sr2 = g.historiaObr.slice(polowa).reduce((s,h)=>s+h.obr,0)/(g.historiaObr.length-polowa);
      return sr2 > sr1 * 1.5;
    });
    if (poprawil.length > 0) {
      ciekawostki.push({ ikona: "📈", tytul: "Glow up sezonu", opis: `${poprawil[0].nazwa} zaczął jak praktykant, skończył jak CEO. Może w końcu odczytał powiadomienia z apki?` });
    }
  }

  // Pacyfista
  const tarczo_maniacy = wszyscy.filter(g => g.tarczeLacznie > 0 && g.obrazeniaLacznie > 0 && g.tarczeLacznie * 50000 > g.obrazeniaLacznie);
  if (tarczo_maniacy.length > 0) {
    ciekawostki.push({ ikona: "🌸", tytul: "Pacyfista gangu", opis: `${tarczo_maniacy[0].nazwa} zdejmuje tarcze zamiast zadawać obrażenia. Piękna dusza. Kompletnie bezużyteczna w walce, ale piękna.` });
  }

  // Chaos
  if (lacznaWalka >= 5) {
    const nieregularny = wszyscy.find(g => {
      if (g.uczestnictwa < 2) return false;
      const max = Math.max(...g.historiaObr.map(h=>h.obr));
      const min = Math.min(...g.historiaObr.map(h=>h.obr));
      return max > min * 10;
    });
    if (nieregularny) {
      const chaosOpisy = [
        `${nieregularny.nazwa} — raz bóg, raz złom. Nikt nie wie która wersja przyjdzie na walkę. Łącznie z nim.`,
        `${nieregularny.nazwa} ma styl "albo wszystko, albo nic". Statystycznie częściej nic.`,
        `${nieregularny.nazwa} robi wyniki od zera do bohatera. Szkoda że "bohater" zdarza się raz na 5 walk.`,
      ];
      ciekawostki.push({ ikona: "🎲", tytul: "Szaman chaosu", opis: chaosOpisy[lacznaWalka % chaosOpisy.length] });
    }
  }

  // Poniżej średniej
  const ponizejSredniej = wszyscy.filter(g => g.uczestnictwa >= 3 && g.obrazeniaLacznie < srednieObr * 0.5);
  if (ponizejSredniej.length > 0) {
    const druzyna = ponizejSredniej.map(g=>g.nazwa).join(", ");
    const lajtOpisy = [
      `${druzyna} robi mniej niż połowę średniej gangu. Obecność odnotowana, wkład — mniej.`,
      `${druzyna} gra, ale gang tego prawie nie widzi. Jak drzewo w lesie które pada bez świadków.`,
      `${druzyna} poniżej 50% średniej. W szkole to byłaby dwója. Tutaj to "pełnoprawny uczestnik".`,
    ];
    ciekawostki.push({ ikona: "💤", tytul: "Drużyna Widmo", opis: lajtOpisy[lacznaWalka % lajtOpisy.length] });
  }

  // Rekord absolutny
  if (lacznaWalka >= 2) {
    const rekordzista = wszyscy[0];
    const maxWalka = rekordzista?.historiaObr.reduce((max,h)=>h.obr>max?h.obr:max, 0) || 0;
    if (maxWalka > 100000) {
      ciekawostki.push({ ikona: "💥", tytul: "Absolutny psychopata walki", opis: `${rekordzista.nazwa} zadał ${formatLiczby(maxWalka)} obrażeń w jednej walce. Nielegalne? Prawdopodobnie. Imponujące? Bezspornie.` });
    }
  }

  // Maruder — gra najrzadziej
  const maruder = [...wszyscy].sort((a,b)=>a.uczestnictwa-b.uczestnictwa)[0];
  if (maruder && maruder.uczestnictwa < lacznaWalka * 0.5 && lacznaWalka >= 4) {
    ciekawostki.push({ ikona: "🏖️", tytul: "Urlopowicz sezonu", opis: `${maruder.nazwa} był na ${maruder.uczestnictwa} z ${lacznaWalka} walk. Odpoczynek jest ważny. Ale chyba nie AŻ TAK ważny.` });
  }

  // Ktoś pogorszył się spektakularnie
  if (lacznaWalka >= 4) {
    const pogorszyl = wszyscy.filter(g => {
      if (g.historiaObr.length < 4) return false;
      const polowa = Math.floor(g.historiaObr.length / 2);
      const sr1 = g.historiaObr.slice(0, polowa).reduce((s,h)=>s+h.obr,0)/polowa;
      const sr2 = g.historiaObr.slice(polowa).reduce((s,h)=>s+h.obr,0)/(g.historiaObr.length-polowa);
      return sr1 > sr2 * 1.5 && sr1 > 10000;
    });
    if (pogorszyl.length > 0) {
      ciekawostki.push({ ikona: "📉", tytul: "Reverse glow up", opis: `${pogorszyl[0].nazwa} zaczął sezon jak rakieta, skończył jak mokra zapałka. Co się stało? Gang chce wiedzieć.` });
    }
  }

  // Żart o całym gangu
  const zartySezonu = [
    `Gang zadał łącznie ${formatLiczby(lacznie)} obrażeń w ${lacznaWalka} walkach. ${Math.round(lacznie/1000000)}M obrażeń. Jakby ktoś pytał. Nikt nie pyta, ale mamy liczby.`,
    `${formatLiczby(lacznie)} obrażeń łącznie. Średnio ${formatLiczby(srWalka)} na walkę. ${lacznie > 50000000 ? "Imponujące. Naprawdę." : "Mogło być gorzej. Ale mogło być dużo lepiej."}`,
    `${lacznaWalka} walk, ${formatLiczby(lacznie)} obrażeń. Statystycznie każdy w gangu ma swój wkład. Niektórzy mają go więcej. Dużo więcej.`,
    `Sezon w liczbach: ${lacznaWalka} walk, ${formatLiczby(lacznie)} obrażeń, ${wszyscy.length} graczy. Część z nich to aktywni wojownicy. Część to ambasadorzy dobrej woli. Wiadomo kto jest kim.`,
  ];
  ciekawostki.push({ ikona: "📊", tytul: "Raport końcowy", opis: zartySezonu[lacznaWalka % zartySezonu.length] });

  return { wszyscy, ciekawostki, lacznaWalka };
}

function formatLiczby(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(2).replace(".", ",") + "M";
  if (n >= 1000) return (n / 1000).toFixed(2).replace(".", ",") + "k";
  return n.toString();
}

function GraczRaport({ g, i, linie, kolor, total }) {
  const [rozwiniety, setRozwiniety] = useState(false);
  return (
    <div style={{ marginBottom: 8, borderRadius: 8, overflow: "hidden", border: `1px solid ${kolor}33`, background: "rgba(0,0,0,0.2)" }}>
      <div onClick={() => setRozwiniety(p=>!p)} style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 12px", cursor: "pointer",
        background: rozwiniety ? `${kolor}11` : "transparent",
      }}>
        <div style={{ fontSize: 16, width: 24, textAlign: "center", flexShrink: 0 }}>
          {i===0?"👑":i===1?"🥈":i===2?"🥉":i>=19?"🥄":"👤"}
        </div>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 13, fontWeight: "bold", color: kolor }}>{g.nazwa}</span>
          <span style={{ fontSize: 10, color: "#555", marginLeft: 8 }}>
            #{g.pozycjaSezonu} · {formatLiczby(g.obrazeniaLacznie)} obrażeń · {g.uczestnictwa} walk
          </span>
        </div>
        <div style={{ fontSize: 11, color: "#555" }}>{rozwiniety ? "▲" : "▼"}</div>
      </div>
      {rozwiniety && (
        <div style={{ padding: "0 12px 12px", borderTop: `1px solid ${kolor}22` }}>
          {linie.map((l, li) => (
            <div key={li} style={{
              fontSize: 11, color: "#bbb", lineHeight: 1.7,
              padding: "6px 0",
              borderBottom: li < linie.length-1 ? "1px solid #1a1a2e" : "none",
            }}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function generujOsobistePodsuamowanie(g, wszyscy, lacznaWalka) {
  const pozycja = g.pozycjaSezonu;
  const total = wszyscy.length;
  const srednia = Math.round(g.obrazeniaLacznie / Math.max(g.uczestnictwa, 1));
  const sredniaGangu = Math.round(wszyscy.reduce((s,x)=>s+x.obrazeniaLacznie,0) / Math.max(wszyscy.reduce((s,x)=>s+x.uczestnictwa,0),1));
  const frekwencja = lacznaWalka > 0 ? Math.round(g.uczestnictwa / lacznaWalka * 100) : 0;

  const maxWalka = g.historiaObr.length > 0 ? Math.max(...g.historiaObr.map(h=>h.obr)) : 0;
  const minWalka = g.historiaObr.length > 0 ? Math.min(...g.historiaObr.map(h=>h.obr)) : 0;
  const rozpitosc = maxWalka > 0 ? Math.round(maxWalka / Math.max(minWalka, 1)) : 1;

  // Pozycja vs poprzedni sezon (pierwsza vs ostatnia walka)
  const histPoz = g.historiaPozyc || [];
  let zmianaPoz = null;
  if (histPoz.length >= 2) {

    // Oszacuj pozycję przez porównanie z innymi
    const rankPierwsza = [...wszyscy]
      .sort((a, b) => (b.historiaPozyc[0]?.obrazenia||0) - (a.historiaPozyc[0]?.obrazenia||0))
      .findIndex(x => x.nazwa === g.nazwa) + 1;
    const rankOstatnia = [...wszyscy]
      .sort((a, b) => {
        const ao = a.historiaPozyc[a.historiaPozyc.length-1]?.obrazenia||0;
        const bo = b.historiaPozyc[b.historiaPozyc.length-1]?.obrazenia||0;
        return bo - ao;
      })
      .findIndex(x => x.nazwa === g.nazwa) + 1;
    if (rankPierwsza > 0 && rankOstatnia > 0) {
      zmianaPoz = rankPierwsza - rankOstatnia; // dodatnia = awans
    }
  }

  // Trend — porównaj pierwszą i drugą połowę walk
  let trend = "stały";
  if (g.historiaObr.length >= 4) {
    const pol = Math.floor(g.historiaObr.length / 2);
    const sr1 = g.historiaObr.slice(0, pol).reduce((s,h)=>s+h.obr,0)/pol;
    const sr2 = g.historiaObr.slice(pol).reduce((s,h)=>s+h.obr,0)/(g.historiaObr.length-pol);
    if (sr2 > sr1 * 1.3) trend = "rosnący";
    else if (sr2 < sr1 * 0.7) trend = "spadający";
  }

  const linie = [];

  // Pozycja w rankingu
  if (pozycja === 1) {
    linie.push("Najlepszy w gangu w tym sezonie. Albo faktycznie dobry, albo reszta się nie starała. Prawdopodobnie jedno i drugie.");
  } else if (pozycja <= 3) {
    linie.push(`TOP ${pozycja} gangu. Blisko szczytu. Dalej jest tylko ${wszyscy[0].nazwa} — ale o tym raczej wiadomo.`);
  } else if (pozycja > total - 2) {
    linie.push(`Pozycja ${pozycja} z ${total}. Podium jest w tej samej galaktyce, ale na innej planecie.`);
  } else {
    linie.push(`Pozycja ${pozycja} z ${total}. Środek stawki — bezpieczna strefa dla tych co nie chcą się wyróżniać ani za bardzo, ani za mało.`);
  }

  // Obecność — użyj bylNaWalce jeśli dostępne
  if (g.maObecnoscDane && lacznaWalka > 0) {
    const obecnoscLiczba = g.obecnosciLacznie || 0;
    const frekAkt = Math.round(obecnoscLiczba / lacznaWalka * 100);
    const label = `${obecnoscLiczba}/${lacznaWalka} walk`;
    if (frekAkt === 100) {
      linie.push(`Obecność: ${label} (100%) — był na każdej walce. Niezawodny jak szwajcarski zegarek. Albo po prostu nie ma co robić.`);
    } else if (frekAkt >= 80) {
      linie.push(`Obecność: ${label} (${frekAkt}%) — prawie zawsze tam gdzie trzeba.`);
    } else if (frekAkt >= 50) {
      linie.push(`Obecność: ${label} (${frekAkt}%). Pojawia się gdy chce. Gang walczy gdy musi. Matematyka jest bezlitosna.`);
    } else if (frekAkt > 0) {
      linie.push(`Obecność: ${label} (${frekAkt}%). Oficjalnie członek. Nieoficjalnie — obserwator.`);
    } else {
      linie.push(`Obecność: 0/${lacznaWalka} walk. Był zarejestrowany. Fizycznie — nieobecny. Mamy dane.`);
    }
  } else {
    const label = `${g.uczestnictwa}/${lacznaWalka} walk`;
    if (frekwencja === 100) {
      linie.push(`W rankingu: ${label} (100%) — zadawał obrażenia w każdej walce.`);
    } else if (frekwencja >= 80) {
      linie.push(`W rankingu: ${label} (${frekwencja}%) — prawie zawsze aktywny.`);
    } else if (frekwencja >= 50) {
      linie.push(`W rankingu: ${label} (${frekwencja}%). Grał kiedy chciał. Gang walczył kiedy musiał.`);
    } else {
      linie.push(`W rankingu: ${label} (${frekwencja}%). Był tu. Czasem. Głównie duchem.`);
    }
  }

  // Obrażenia vs średnia gangu
  const stosunekDoSredniej = srednia / Math.max(sredniaGangu, 1);
  if (stosunekDoSredniej > 1.5) {
    linie.push(`Średnio ${formatLiczby(srednia)} obrażeń na walkę — ${Math.round((stosunekDoSredniej-1)*100)}% powyżej średniej gangu. Liczby nie kłamią, choć czasem chciałyby.`);
  } else if (stosunekDoSredniej > 1.1) {
    linie.push(`Średnio ${formatLiczby(srednia)} obrażeń na walkę — lekko powyżej przeciętnej. Gang docenia. Ale po cichu.`);
  } else if (stosunekDoSredniej > 0.7) {
    linie.push(`Średnio ${formatLiczby(srednia)} obrażeń na walkę — w okolicach średniej gangu. Solidna mediokerność, jak to się mówi.`);
  } else {
    linie.push(`Średnio ${formatLiczby(srednia)} obrażeń na walkę — ${Math.round((1-stosunekDoSredniej)*100)}% poniżej średniej. Statystyki wolą nie komentować. My też.`);
  }

  // Tarcze
  if (g.tarczeLacznie > 0) {
    const tarczNaWalke = (g.tarczeLacznie / g.uczestnictwa).toFixed(1);
    if (parseFloat(tarczNaWalke) >= 2) {
      linie.push(`${g.tarczeLacznie} tarcz w sezonie (${tarczNaWalke} na walkę). Entuzjasta defensywy. Albo po prostu lubi klikać w tarcze.`);
    } else if (g.tarczeLacznie > 0) {
      linie.push(`${g.tarczeLacznie} tarcz w sezonie. Zdarzało się. Głównie przez przypadek, ale liczy się wynik.`);
    }
  } else if (g.uczestnictwa >= 3) {
    linie.push(`Zero tarcz w całym sezonie. Konsekwentne podejście. Można to nazwać stylem.`);
  }

  // Trend
  if (trend === "rosnący") {
    linie.push(`Forma wzrostowa w drugiej połowie sezonu. Późny rozkwit? Może. Albo w końcu przeczytał jak grać.`);
  } else if (trend === "spadający") {
    linie.push(`Forma spadkowa w drugiej połowie. Wypalenie, nuda, inne priorytety? Dane milczą. My nie.`);
  }

  // Rozpiętość wyników
  if (rozpitosc >= 10 && g.uczestnictwa >= 3) {
    linie.push(`Rozpiętość wyników ${formatLiczby(minWalka)}–${formatLiczby(maxWalka)}. Można grać jak bóg albo jak obserwator. I jedno i drugie ma miejsce w tej historii.`);
  } else if (rozpitosc <= 2 && g.uczestnictwa >= 3 && srednia > 10000) {
    linie.push(`Wyniki równe jak stół. ${formatLiczby(minWalka)}–${formatLiczby(maxWalka)}. Regularność godna szacunku. Albo autokliker. Nie osądzamy.`);
  }

  // Progres poziomów walka po walce
  const histLvl = g.historiaPoziomow || [];
  if (histLvl.length >= 2) {
    const lvlStart = histLvl[0].poziom;
    const lvlEnd = histLvl[histLvl.length - 1].poziom;
    const roznicaLvl = lvlEnd - lvlStart;
    const sekwencja = histLvl.map((h, i) => {
      if (i === 0) return `L${h.poziom}`;
      const delta = h.poziom - histLvl[i-1].poziom;
      return `L${h.poziom}${delta > 0 ? `(+${delta})` : ""}`;
    }).join(" → ");
    if (roznicaLvl > 0) {
      linie.push(`Progres lvl: ${sekwencja}. Łącznie +${roznicaLvl} lvl. ${
        roznicaLvl >= 50 ? "Intensywne granie. Widać zaangażowanie." :
        roznicaLvl >= 20 ? "Solidny progres. Gang to zauważa." :
        "Rośnie powoli. Ale rośnie."}`);
    } else {
      linie.push(`Progres lvl: ${sekwencja}. Bez zmian. Stabilizacja? Albo stagnacja. Cienka linia.`);
    }
  } else if (histLvl.length === 1) {
    linie.push(`Aktualny poziom: L${histLvl[0].poziom}. Wgrywaj screeny aktywności regularnie żeby śledzić progres walka po walce.`);
  }

  // Zmiana pozycji
  if (zmianaPoz !== null && Math.abs(zmianaPoz) >= 1 && g.uczestnictwa >= 2) {
    if (zmianaPoz > 0) {
      linie.push(`Awans o ${zmianaPoz} ${zmianaPoz===1?"miejsce":zmianaPoz<5?"miejsca":"miejsc"} w rankingu między pierwszą a ostatnią walką sezonu. Forma wzrostowa. Odnotowane.`);
    } else if (zmianaPoz < 0) {
      linie.push(`Spadek o ${Math.abs(zmianaPoz)} ${Math.abs(zmianaPoz)===1?"miejsce":Math.abs(zmianaPoz)<5?"miejsca":"miejsc"} w rankingu między pierwszą a ostatnią walką. Forma się nie poprawia. Dane też tego nie ukrywają.`);
    }
  }

  // Stosunek obrażeń do zdobytych lvl
  const histLvlOsobisty = g.historiaPoziomow || [];
  if (histLvlOsobisty.length >= 2) {
    const lvlStart2 = histLvlOsobisty[0].poziom;
    const lvlEnd2 = histLvlOsobisty[histLvlOsobisty.length-1].poziom;
    const przyrostLvl = lvlEnd2 - lvlStart2;
    if (przyrostLvl > 0) {
      const obrNaLvl = Math.round(g.obrazeniaLacznie / przyrostLvl);
      // Oblicz medianę gangu dla porównania
      const stosunkiGangu = wszyscy
        .filter(x => { const h=x.historiaPoziomow||[]; return h.length>=2 && (h[h.length-1].poziom-h[0].poziom)>0; })
        .map(x => { const h=x.historiaPoziomow; return x.obrazeniaLacznie/(h[h.length-1].poziom-h[0].poziom); })
        .sort((a,b)=>a-b);
      const medGangu = stosunkiGangu.length > 0 ? stosunkiGangu[Math.floor(stosunkiGangu.length/2)] : 0;
      const procMediany = medGangu > 0 ? Math.round(obrNaLvl/medGangu*100) : null;

      if (procMediany !== null && procMediany < 25) {
        linie.push(`${formatLiczby(obrNaLvl)} obr/lvl (+${przyrostLvl} lvl, L${lvlStart2}→L${lvlEnd2}). Tylko ${procMediany}% mediany gangu — zdobywa lvl gdzie indziej, nie w walkach. Klasyczny pasożyt eventu.`);
      } else if (procMediany !== null && procMediany >= 150) {
        linie.push(`${formatLiczby(obrNaLvl)} obr/lvl (+${przyrostLvl} lvl, L${lvlStart2}→L${lvlEnd2}). ${procMediany}% mediany gangu — walczy i walczy dobrze.`);
      } else {
        linie.push(`${formatLiczby(obrNaLvl)} obr/lvl (+${przyrostLvl} lvl, L${lvlStart2}→L${lvlEnd2}).`);
      }
    }
  }

  // Rekord
  if (maxWalka > 0 && g.uczestnictwa >= 2) {
    linie.push(`Rekord sezonu: ${formatLiczby(maxWalka)} obrażeń w jednej walce. Zapamiętany. Przynajmniej przez apkę.`);
  }

  return linie;
}

function PodsumowanieSezonu({ podsumowanie, zapiszWalki, walki, readonly=false }) {
  const [edycjaGracza, setEdycjaGracza] = useState(null);
  const [nowyNick, setNowyNick] = useState("");

  if (!podsumowanie) {
    return (
      <div style={{ textAlign: "center", padding: 40, color: "#666" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🏆</div>
        <div style={{ fontSize: 13 }}>Brak walk do analizy</div>
      </div>
    );
  }

  const { wszyscy, ciekawostki, lacznaWalka } = podsumowanie;

  // Scal wszystkie wystąpienia starego nicku na nowy we wszystkich walkach
  const scalajNick = async (staryNick, nowyNickVal) => {
    if (!nowyNickVal.trim() || staryNick === nowyNickVal.trim()) {
      setEdycjaGracza(null);
      return;
    }
    const zaktualizowane = walki.map(w => ({
      ...w,
      gracze: w.gracze.map(g =>
        g.nazwa === staryNick ? { ...g, nazwa: nowyNickVal.trim() } : g
      )
    }));
    await zapiszWalki(zaktualizowane);
    setEdycjaGracza(null);
    alert(`✓ Zmieniono "${staryNick}" → "${nowyNickVal.trim()}" we wszystkich walkach`);
  };

  return (
    <div>
      <div style={{ background: "linear-gradient(135deg, rgba(255,215,0,0.1), rgba(184,134,11,0.1))", border: "1px solid #b8860b", borderRadius: 10, padding: 14, marginBottom: 14, textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: "bold", color: "#ffd700", marginBottom: 4 }}>🏆 Podsumowanie sezonu</div>
        <div style={{ fontSize: 12, color: "#aaa" }}>Analiza z {lacznaWalka} walk gangu</div>
      </div>

      {/* Info o edycji nicków */}
      <div style={{ background: "rgba(255,165,0,0.06)", border: "1px solid #fa055", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 11, color: "#fa0" }}>
        ✏️ <strong>Kliknij gracza</strong> żeby zmienić nick — jeśli AI zapisała kogoś pod różnymi nazwami, zmień na jedną i statystyki się scalą automatycznie.
      </div>

      {/* Ciekawostki */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: "bold", color: "#ffd700", marginBottom: 10 }}>🎭 Wyróżnienia sezonu</div>
        {ciekawostki.map((c, i) => {
          // Kolory zależne od charakteru nagrody
          const ikonyZlote = ["👑","💥","🦁","🤖","📈","🎯","🛡️","🎮"];
          const ikonyRed = ["🥄","👻","🐢","💤","📉","🏖️","🌸","🎲","🫧"];
          const isGold = ikonyZlote.includes(c.ikona);
          const isRed = ikonyRed.includes(c.ikona);
          const borderColor = isGold ? "#ffd70033" : isRed ? "#f5544422" : "#2a2a3a";
          const bgColor = isGold ? "rgba(255,215,0,0.05)" : isRed ? "rgba(255,50,50,0.04)" : "rgba(255,255,255,0.03)";
          const titleColor = isGold ? "#ffd700" : isRed ? "#f88" : "#aaa";
          return (
            <div key={i} style={{
              background: bgColor, border: `1px solid ${borderColor}`,
              borderRadius: 8, padding: "10px 12px", marginBottom: 6,
              display: "flex", gap: 10, alignItems: "flex-start",
              animation: `slideInLeft 0.3s ${i * 0.04}s both`,
            }}>
              <div style={{ fontSize: 22, flexShrink: 0, width: 28, textAlign: "center" }}>{c.ikona}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: "bold", color: titleColor, marginBottom: 3 }}>{c.tytul}</div>
                <div style={{ fontSize: 11, color: "#bbb", lineHeight: 1.5 }}>{c.opis}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Obecność per walka */}
      {walki.some(w => w.gracze.some(g => g.bylNaWalce !== undefined)) && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: "bold", color: "#ffd700", marginBottom: 10 }}>👥 Obecność na walkach</div>
          {[...walki].sort((a,b) => new Date(b.data)-new Date(a.data)).map(w => {
            const maObecnosc = w.gracze.some(g => g.bylNaWalce !== undefined);
            if (!maObecnosc) return null;
            const byli = w.gracze.filter(g => g.bylNaWalce === true);
            const niebylo = w.gracze.filter(g => g.bylNaWalce === false);
            return (
              <div key={w.id} style={{ marginBottom: 8, padding: "10px 12px", borderRadius: 8, background: "rgba(0,0,0,0.2)", border: "1px solid #2a2a3a" }}>
                <div style={{ fontSize: 12, fontWeight: "bold", color: "#ffd700", marginBottom: 6 }}>
                  {w.nazwa}
                  <span style={{ fontSize: 10, fontWeight: "normal", color: "#555", marginLeft: 8 }}>
                    🟢 {byli.length} · 🔴 {niebylo.length}
                  </span>
                </div>
                {byli.length > 0 && (
                  <div style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: "#0c6", marginRight: 6 }}>Byli:</span>
                    {byli.map(g => (
                      <span key={g.nazwa} style={{ fontSize: 10, color: "#0c6", marginRight: 6 }}>
                        {g.nazwa.replace(/™FAM™|fAM™|FAM™/g, "")}
                      </span>
                    ))}
                  </div>
                )}
                {niebylo.length > 0 && (
                  <div>
                    <span style={{ fontSize: 10, color: "#f55", marginRight: 6 }}>Nie było:</span>
                    {niebylo.map(g => (
                      <span key={g.nazwa} style={{ fontSize: 10, color: "#f55", marginRight: 6 }}>
                        {g.nazwa.replace(/™FAM™|fAM™|FAM™/g, "")}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Tabela obecności wszystkich członków */}
      {wszyscy.some(g => g.maObecnoscDane) && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: "bold", color: "#ffd700", marginBottom: 10 }}>📊 Frekwencja na walkach</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "4px 10px", alignItems: "center" }}>
            <div style={{ fontSize: 10, color: "#555", paddingBottom: 4, borderBottom: "1px solid #2a2a3a" }}>Gracz</div>
            <div style={{ fontSize: 10, color: "#555", textAlign: "center", paddingBottom: 4, borderBottom: "1px solid #2a2a3a" }}>Był</div>
            <div style={{ fontSize: 10, color: "#555", textAlign: "center", paddingBottom: 4, borderBottom: "1px solid #2a2a3a" }}>Nie był</div>
            <div style={{ fontSize: 10, color: "#555", textAlign: "center", paddingBottom: 4, borderBottom: "1px solid #2a2a3a" }}>%</div>
            {[...wszyscy].sort((a,b) => (b.obecnosciLacznie||0) - (a.obecnosciLacznie||0)).map(g => {
              if (!g.maObecnoscDane) return null;
              const byl = g.obecnosciLacznie || 0;
              const nieByl = lacznaWalka - byl;
              const proc = Math.round(byl / lacznaWalka * 100);
              const kolor = proc >= 80 ? "#0c6" : proc >= 50 ? "#fa0" : "#f55";
              return [
                <div key={`n_${g.nazwa}`} style={{ fontSize: 11, color: "#ddd" }}>
                  {g.nazwa.replace(/™FAM™|fAM™|FAM™/g, "")}
                </div>,
                <div key={`b_${g.nazwa}`} style={{ fontSize: 11, color: "#0c6", textAlign: "center", fontWeight: "bold" }}>
                  🟢 {byl}
                </div>,
                <div key={`nb_${g.nazwa}`} style={{ fontSize: 11, color: "#f55", textAlign: "center" }}>
                  {nieByl > 0 ? `🔴 ${nieByl}` : "—"}
                </div>,
                <div key={`p_${g.nazwa}`} style={{ fontSize: 11, color: kolor, textAlign: "center", fontWeight: "bold" }}>
                  {proc}%
                </div>,
              ];
            })}
          </div>
        </div>
      )}

      {/* Osobiste podsumowania */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: "bold", color: "#ffd700", marginBottom: 10 }}>📋 Raporty osobiste</div>
        <div style={{ fontSize: 10, color: "#555", marginBottom: 10 }}>Indywidualna ocena każdego gracza na podstawie statystyk sezonu.</div>
        {wszyscy.map((g, i) => {
          const linie = generujOsobistePodsuamowanie(g, wszyscy, lacznaWalka);
          const kolor = i===0?"#ffd700":i===1?"#c0c0c0":i===2?"#cd7f32":i>=wszyscy.length-2?"#f55":"#888";
          return <GraczRaport key={g.nazwa} g={g} i={i} linie={linie} kolor={kolor} />;
        })}
      </div>

      {/* Pełny ranking z edycją */}
      <div>
        <div style={{ fontSize: 13, fontWeight: "bold", color: "#ffd700", marginBottom: 8 }}>⚔️ Końcowy ranking sezonu</div>
        {wszyscy.map((g, i) => {
          const kolor = i === 0 ? "#ffd700" : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : "#888";
          const sredniaObr = Math.round(g.obrazeniaLacznie / g.uczestnictwa);
          const sredniaTarcz = (g.tarczeLacznie / g.uczestnictwa).toFixed(1);
          const edytuje = edycjaGracza === g.nazwa;
          const histLvlRank = g.historiaPoziomow || [];
          const lvlStart = histLvlRank.length > 0 ? histLvlRank[0].poziom : null;
          const lvlEnd = histLvlRank.length > 0 ? histLvlRank[histLvlRank.length-1].poziom : null;

          return (
            <div key={i} style={{
              background: edytuje ? "rgba(255,215,0,0.08)" : i < 3 ? `linear-gradient(90deg, ${kolor}15, transparent)` : "rgba(255,255,255,0.02)",
              border: edytuje ? `1px solid ${kolor}88` : "1px solid #2a2a3a",
              borderLeft: `3px solid ${kolor}`,
              borderRadius: 6, padding: 10, marginBottom: 4,
            }}>
              {edytuje ? (
                // Tryb edycji nicku
                <div>
                  <div style={{ fontSize: 11, color: "#ffd700", marginBottom: 6 }}>
                    ✏️ Zmień nick gracza #{i + 1} (zmiana dotyczy WSZYSTKICH walk w historii)
                  </div>
                  <input
                    value={nowyNick}
                    onChange={e => setNowyNick(e.target.value)}
                    placeholder={g.nazwa}
                    autoFocus
                    style={{ width: "100%", padding: "6px 8px", background: "#12122a", border: "1px solid #444", borderRadius: 4, color: "#fff", fontSize: 12, marginBottom: 8, boxSizing: "border-box" }}
                  />
                  <div style={{ fontSize: 10, color: "#888", marginBottom: 8 }}>
                    💡 Jeśli AI zapisała tę samą osobę jako dwa różne nicki, wpisz poprawny nick — statystyki się scalą.
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => scalajNick(g.nazwa, nowyNick)} style={{ flex: 1, padding: "6px", background: "rgba(0,200,100,0.15)", border: "1px solid #0c6", borderRadius: 5, color: "#0c6", cursor: "pointer", fontSize: 12, fontWeight: "bold" }}>✓ Zapisz</button>
                    <button onClick={() => setEdycjaGracza(null)} style={{ padding: "6px 12px", background: "rgba(255,255,255,0.05)", border: "1px solid #444", borderRadius: 5, color: "#888", cursor: "pointer", fontSize: 12 }}>Anuluj</button>
                  </div>
                </div>
              ) : (
                // Tryb widoku
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, color: kolor, fontWeight: "bold", width: 26 }}>{i + 1}.</span>
                    <span style={{ flex: 1, fontSize: 12, color: "#ddd", fontWeight: i < 3 ? "bold" : "normal" }}>{g.nazwa}</span>
                    <span style={{ fontSize: 11, color: "#666" }}>{g.uczestnictwa}/{lacznaWalka} walk</span>
                    <button onClick={() => { setEdycjaGracza(g.nazwa); setNowyNick(g.nazwa); }}
                      style={{ padding: "2px 7px", background: "rgba(255,215,0,0.1)", border: "none", borderRadius: 3, color: "#b8860b", cursor: "pointer", fontSize: 10 }}>✏️</button>
                  </div>
                  <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#aaa", flexWrap: "wrap", paddingLeft: 34 }}>
                    <span>🔫 łącznie: <strong style={{ color: "#ffd700" }}>{formatLiczby(g.obrazeniaLacznie)}</strong></span>
                    <span>średnio: {formatLiczby(sredniaObr)}</span>
                    <span>🛡️ tarcz: <strong style={{ color: "#87CEEB" }}>{g.tarczeLacznie}</strong></span>
                    <span>śr. {sredniaTarcz}</span>
                    {lvlEnd && <span style={{ color: "#6496ff" }}>
                      L{lvlEnd}{lvlEnd - lvlStart > 0 ? <strong style={{color:"#0c6"}}> +{lvlEnd - lvlStart}</strong> : ""}
                    </span>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}
