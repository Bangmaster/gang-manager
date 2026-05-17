import { useState } from "react";

// Klucze API — te same co w gemini.js
const KLUCZE = [
  process.env.REACT_APP_GEMINI_API_KEY || "",
  process.env.REACT_APP_GEMINI_API_KEY_2 || "",
  process.env.REACT_APP_GEMINI_API_KEY_3 || "",
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
export default function WalkiView({ czlonkowie, walki, zapiszWalki, isAdmin }) {
  const [pliki, setPliki] = useState([]);
  const [podgladURL, setPodgladURL] = useState([]);
  const [analizujac, setAnalizujac] = useState(false);
  const [wyniki, setWyniki] = useState(null);
  const [nazwaWalki, setNazwaWalki] = useState("");
  const [podglad, setPodglad] = useState("ranking");
  const [podsumowanieSezonu, setPodsumowanieSezonu] = useState(null);
  const [edytowanyGracz, setEdytowanyGracz] = useState(null);
  const [aktywnyScreen, setAktywnyScreen] = useState(0);

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
    }];
    await zapiszWalki(noweWalki);
    setWyniki(null);
    setPliki([]);
    setNazwaWalki("");
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
      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          { id: "ranking", label: "📤 Wgraj walkę" },
          { id: "historia", label: `📜 Historia (${(walki || []).length})` },
          { id: "sezon", label: "🏆 Podsumowanie sezonu" },
        ].map(t => (
          <button key={t.id} onClick={() => { setPodglad(t.id); if (t.id === "sezon") generujPodsumowanie(); }} style={{
            padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12,
            background: podglad === t.id ? "rgba(255,215,0,0.15)" : "rgba(255,255,255,0.05)",
            border: podglad === t.id ? "1px solid #ffd700" : "1px solid #2a2a3a",
            color: podglad === t.id ? "#ffd700" : "#888",
          }}>{t.label}</button>
        ))}
      </div>

      {podglad === "ranking" && (
        <>
          <div style={{ background: "rgba(255,215,0,0.06)", border: "1px solid #b8860b33", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#ffd700" }}>
            🎯 <strong>Analiza walki gangu</strong> — wgraj 1-3 screeny rankingu po walce
            <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
              Jeśli na 1 screenie nie mieszczą się wszyscy gracze, wgraj 2-3 screeny — apka scali graczy automatycznie.
            </div>
          </div>

          <div style={{ background: "rgba(0,0,0,0.25)", border: "1px solid #2a2a3a", borderRadius: 10, padding: 14, marginBottom: 14 }}>
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
        <HistoriaWalk walki={walki || []} usunWalke={usunWalke} isAdmin={isAdmin} />
      )}

      {podglad === "sezon" && (
        <PodsumowanieSezonu podsumowanie={podsumowanieSezonu} zapiszWalki={zapiszWalki} walki={walki || []} />
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
    setTempVal({ nazwa: gracze[i].nazwa, obrazenia: fmt(gracze[i].obrazenia), tarcze: String(gracze[i].tarcze) });
  };

  const zapiszEdycje = (i) => {
    const now = [...gracze];
    now[i] = { ...now[i], nazwa: tempVal.nazwa || now[i].nazwa, obrazenia: parseLiczbe(tempVal.obrazenia), tarcze: parseInt(tempVal.tarcze) || 0 };
    // Posortuj ponownie po obrażeniach
    now.sort((a, b) => b.obrazenia - a.obrazenia);
    onChange(now);
    setEdytowanyGracz(null);
  };

  const usun = (i) => onChange(gracze.filter((_, idx) => idx !== i));

  const dodajGracza = () => {
    const now = [...gracze, { nazwa: "Nowy gracz", poziom: 0, obrazenia: 0, tarcze: 0 }];
    onChange(now);
    setEdytowanyGracz(now.length - 1);
    setTempVal({ nazwa: "", obrazenia: "0", tarcze: "0" });
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
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: "#888", marginBottom: 2 }}>🔫 Obrażenia (np. 27,25M lub 828k)</div>
                      <input value={tempVal.obrazenia} onChange={e => setTempVal(v => ({ ...v, obrazenia: e.target.value }))}
                        style={{ width: "100%", padding: "5px 8px", background: "#12122a", border: "1px solid #444", borderRadius: 4, color: "#ffd700", fontSize: 12, boxSizing: "border-box" }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: "#888", marginBottom: 2 }}>🛡️ Tarcze</div>
                      <input value={tempVal.tarcze} onChange={e => setTempVal(v => ({ ...v, tarcze: e.target.value }))}
                        style={{ width: "100%", padding: "5px 8px", background: "#12122a", border: "1px solid #444", borderRadius: 4, color: "#87CEEB", fontSize: 12, boxSizing: "border-box" }} />
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
  const max = Math.max(1, ...gracze.map(g => g.obrazenia));
  return (
    <div>
      {gracze.map((g, i) => {
        const kolor = i === 0 ? "#ffd700" : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : "#888";
        return (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
            background: i < 3 ? `linear-gradient(90deg,${kolor}11,transparent)` : "rgba(255,255,255,0.02)",
            borderLeft: `3px solid ${kolor}`, borderRadius: 6, marginBottom: 4, position: "relative", overflow: "hidden",
          }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(g.obrazenia / max) * 100}%`, background: `${kolor}08`, zIndex: 0 }} />
            <span style={{ fontSize: 13, color: kolor, fontWeight: "bold", width: 24, zIndex: 1 }}>{i + 1}.</span>
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

function HistoriaWalk({ walki, usunWalke, isAdmin }) {
  const [rozwiniete, setRozwiniete] = useState(null);

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
      {sorted.map(w => (
        <div key={w.id} style={{ background: "rgba(0,0,0,0.25)", border: "1px solid #2a2a3a", borderRadius: 8, padding: 12, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: "bold", color: "#ffd700", fontSize: 13 }}>{w.nazwa}</div>
              <div style={{ fontSize: 10, color: "#666" }}>{new Date(w.data).toLocaleString("pl-PL")} • {w.gracze.length} graczy</div>
            </div>
            <button onClick={() => setRozwiniete(rozwiniete === w.id ? null : w.id)} style={{
              padding: "4px 10px", background: "rgba(255,215,0,0.1)", border: "1px solid #b8860b55", borderRadius: 5, color: "#b8860b", cursor: "pointer", fontSize: 11,
            }}>{rozwiniete === w.id ? "Zwiń" : "Pokaż"}</button>
            {isAdmin && (
              <button onClick={() => usunWalke(w.id)} style={{
                padding: "4px 8px", background: "rgba(255,50,50,0.1)", border: "1px solid #f5544455", borderRadius: 5, color: "#f55", cursor: "pointer", fontSize: 11,
              }}>🗑</button>
            )}
          </div>
          {rozwiniete === w.id && (
            <div style={{ marginTop: 12 }}>
              <RankingTabela gracze={w.gracze} edytowalne={false} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Liczy statystyki sezonu z wszystkich walk
function obliczPodsumowanieSezonu(walki, czlonkowie) {
  if (walki.length === 0) return null;

  // Zbierz wszystkich graczy z różnych walk
  const statystyki = {};
  walki.forEach(w => {
    w.gracze.forEach(g => {
      if (!statystyki[g.nazwa]) {
        statystyki[g.nazwa] = {
          nazwa: g.nazwa,
          poziomy: [],
          obrazeniaLacznie: 0,
          tarczeLacznie: 0,
          uczestnictwa: 0,
          miejsca: [],
          historiaObr: [],
        };
      }
      const s = statystyki[g.nazwa];
      s.poziomy.push(g.poziom);
      s.obrazeniaLacznie += g.obrazenia;
      s.tarczeLacznie += g.tarcze;
      s.uczestnictwa++;
      s.miejsca.push(g.miejsce);
      s.historiaObr.push({ data: w.data, obr: g.obrazenia });
    });
  });

  const wszyscy = Object.values(statystyki);

  // Sortuj wg łącznych obrażeń
  wszyscy.sort((a, b) => b.obrazeniaLacznie - a.obrazeniaLacznie);

  // Oblicz ciekawostki
  const ciekawostki = [];

  // 1. Król obrażeń
  if (wszyscy[0]) {
    ciekawostki.push({ ikona: "👑", tytul: "Król obrażeń", opis: `${wszyscy[0].nazwa} — ${formatLiczby(wszyscy[0].obrazeniaLacznie)} łącznych obrażeń w ${wszyscy[0].uczestnictwa} walkach` });
  }

  // 2. Mistrz tarcz
  const mistrzTarcz = [...wszyscy].sort((a, b) => b.tarczeLacznie - a.tarczeLacznie)[0];
  if (mistrzTarcz && mistrzTarcz.tarczeLacznie > 0) {
    ciekawostki.push({ ikona: "🛡️", tytul: "Mistrz tarcz", opis: `${mistrzTarcz.nazwa} — zdjął ${mistrzTarcz.tarczeLacznie} tarcz przeciwnikom` });
  }

  // 3. Największy awans (różnica między najwyższym a najniższym poziomem)
  const awanse = wszyscy.map(g => ({
    nazwa: g.nazwa,
    awans: g.poziomy.length > 1 ? Math.max(...g.poziomy) - Math.min(...g.poziomy) : 0,
  })).filter(a => a.awans > 0).sort((a, b) => b.awans - a.awans);
  if (awanse[0]) {
    ciekawostki.push({ ikona: "📈", tytul: "Największy awans", opis: `${awanse[0].nazwa} — awansował o ${awanse[0].awans} poziomów w tym sezonie` });
  }

  // 4. Najczęstszy uczestnik
  const najwiecejWalk = [...wszyscy].sort((a, b) => b.uczestnictwa - a.uczestnictwa)[0];
  if (najwiecejWalk) {
    ciekawostki.push({ ikona: "🎮", tytul: "Najaktywniejszy", opis: `${najwiecejWalk.nazwa} — uczestniczył w ${najwiecejWalk.uczestnictwa} z ${walki.length} walk` });
  }

  // 5. Wzrastająca forma (porównanie ostatnich 3 walk vs poprzednich)
  if (walki.length >= 4) {
    const polowa = Math.floor(walki.length / 2);
    const formaWynik = wszyscy.map(g => {
      const sorted = [...g.historiaObr].sort((a, b) => new Date(a.data) - new Date(b.data));
      const starsze = sorted.slice(0, polowa);
      const nowsze = sorted.slice(polowa);
      if (starsze.length === 0 || nowsze.length === 0) return null;
      const srStarsze = starsze.reduce((s, x) => s + x.obr, 0) / starsze.length;
      const srNowsze = nowsze.reduce((s, x) => s + x.obr, 0) / nowsze.length;
      const zmiana = srStarsze > 0 ? ((srNowsze - srStarsze) / srStarsze) * 100 : 0;
      return { nazwa: g.nazwa, zmiana };
    }).filter(Boolean);
    const najlepszaForma = [...formaWynik].sort((a, b) => b.zmiana - a.zmiana)[0];
    const najgorszaForma = [...formaWynik].sort((a, b) => a.zmiana - b.zmiana)[0];
    if (najlepszaForma && najlepszaForma.zmiana > 10) {
      ciekawostki.push({ ikona: "🔥", tytul: "Wzrastająca forma", opis: `${najlepszaForma.nazwa} — +${najlepszaForma.zmiana.toFixed(0)}% obrażeń w drugiej połowie sezonu` });
    }
    if (najgorszaForma && najgorszaForma.zmiana < -10) {
      ciekawostki.push({ ikona: "📉", tytul: "Spadająca forma", opis: `${najgorszaForma.nazwa} — ${najgorszaForma.zmiana.toFixed(0)}% obrażeń w drugiej połowie sezonu` });
    }
  }

  // 6. Brak aktywności — członkowie nieobecni w walkach
  const nieobecni = czlonkowie.filter(c => !statystyki[c.nazwa]).map(c => c.nazwa);
  if (nieobecni.length > 0) {
    ciekawostki.push({ ikona: "👻", tytul: "Nieaktywni", opis: `${nieobecni.length} osób bez żadnej walki: ${nieobecni.slice(0, 5).join(", ")}${nieobecni.length > 5 ? "..." : ""}` });
  }

  // 7. Najmniej zaangażowani (są w walce, ale mało obrażeń)
  const malo = wszyscy.filter(g => g.obrazeniaLacznie < 100000 && g.uczestnictwa >= 2);
  if (malo.length > 0) {
    ciekawostki.push({ ikona: "💤", tytul: "Mało zaangażowani", opis: `${malo.length} osób z bardzo niskimi obrażeniami (poniżej 100k): ${malo.slice(0, 3).map(g => g.nazwa).join(", ")}` });
  }

  return { wszyscy, ciekawostki, lacznaWalka: walki.length };
}

function formatLiczby(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(2).replace(".", ",") + "M";
  if (n >= 1000) return (n / 1000).toFixed(2).replace(".", ",") + "k";
  return n.toString();
}

function PodsumowanieSezonu({ podsumowanie, zapiszWalki, walki }) {
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
        <div style={{ fontSize: 13, fontWeight: "bold", color: "#ffd700", marginBottom: 8 }}>✨ Najciekawsze</div>
        {ciekawostki.map((c, i) => (
          <div key={i} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid #2a2a3a", borderRadius: 8, padding: 10, marginBottom: 6, display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{ fontSize: 20 }}>{c.ikona}</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: "bold", color: "#ffd700" }}>{c.tytul}</div>
              <div style={{ fontSize: 11, color: "#ccc", marginTop: 2 }}>{c.opis}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Pełny ranking z edycją */}
      <div>
        <div style={{ fontSize: 13, fontWeight: "bold", color: "#ffd700", marginBottom: 8 }}>📊 Łączny ranking sezonu</div>
        {wszyscy.map((g, i) => {
          const kolor = i === 0 ? "#ffd700" : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : "#888";
          const sredniaObr = Math.round(g.obrazeniaLacznie / g.uczestnictwa);
          const sredniaTarcz = (g.tarczeLacznie / g.uczestnictwa).toFixed(1);
          const edytuje = edycjaGracza === g.nazwa;

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
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Tekst do wklejenia */}
      <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid #2a2a3a", borderRadius: 10, padding: 14, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: "bold", color: "#ffd700", fontSize: 13 }}>📋 Tekst do wklejenia na grupę</div>
          <button onClick={() => {
            const tekst = generujTekstPodsumowania(podsumowanie);
            navigator.clipboard?.writeText(tekst);
          }} style={{ padding: "4px 10px", background: "rgba(255,215,0,0.1)", border: "1px solid #b8860b", borderRadius: 5, color: "#ffd700", cursor: "pointer", fontSize: 11 }}>📋 Kopiuj</button>
        </div>
        <pre style={{ fontSize: 11, color: "#bbb", whiteSpace: "pre-wrap", margin: 0, fontFamily: "monospace", maxHeight: 200, overflow: "auto", background: "rgba(0,0,0,0.3)", padding: 8, borderRadius: 4 }}>
          {generujTekstPodsumowania(podsumowanie)}
        </pre>
      </div>
    </div>
  );
}

function generujTekstPodsumowania(p) {
  if (!p) return "";
  let t = `🏆 PODSUMOWANIE SEZONU 🏆\nAnaliza z ${p.lacznaWalka} walk\n\n`;
  t += "✨ NAJCIEKAWSZE:\n";
  p.ciekawostki.forEach(c => { t += `${c.ikona} ${c.tytul}: ${c.opis}\n`; });
  t += "\n📊 RANKING SEZONU (TOP 10):\n";
  p.wszyscy.slice(0, 10).forEach((g, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
    t += `${medal} ${g.nazwa} — 🔫 ${formatLiczby(g.obrazeniaLacznie)} | 🛡️ ${g.tarczeLacznie} | ${g.uczestnictwa} walk\n`;
  });
  return t;
}
