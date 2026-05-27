import { useState } from "react";

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
      {/* Tabs — wgrywanie tylko dla admina */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          ...(isAdmin ? [{ id: "ranking", label: "📤 Wgraj walkę" }] : []),
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

      {podglad === "ranking" && isAdmin && (
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

  const statystyki = {};
  walki.forEach(w => {
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
          zwyciestwa: 0, // 1. miejsce w walce
          podium: 0,     // top 3
          ostatnieMiejsca: 0, // ostatnie miejsce
        };
      }
      const s = statystyki[g.nazwa];
      s.obrazeniaLacznie += g.obrazenia;
      s.tarczeLacznie += g.tarcze;
      s.uczestnictwa++;
      s.historiaObr.push({ data: w.data, obr: g.obrazenia });

      // Oblicz miejsca w tej walce
      const ranking = [...w.gracze].sort((a,b) => b.obrazenia - a.obrazenia);
      const pozycja = ranking.findIndex(gr => gr.nazwa === g.nazwa);
      s.miejsca.push(pozycja + 1);
      if (pozycja === 0) s.zwyciestwa++;
      if (pozycja < 3) s.podium++;
      if (pozycja === ranking.length - 1) s.ostatnieMiejsca++;
    });
  });

  const wszyscy = Object.values(statystyki);
  wszyscy.sort((a, b) => b.obrazeniaLacznie - a.obrazeniaLacznie);
  wszyscy.forEach((g, i) => { g.pozycjaSezonu = i + 1; });

  const lacznaWalka = walki.length;
  const lacznie = wszyscy.reduce((s, g) => s + g.obrazeniaLacznie, 0);
  const srWalka = lacznaWalka > 0 ? Math.round(lacznie / lacznaWalka) : 0;
  const srednieObr = wszyscy.length > 0 ? lacznie / wszyscy.length : 0;
  const ciekawostki = [];

  // ═══════════════════════════════════════
  // TYTUŁY — przyznawane każdemu graczowi
  // ═══════════════════════════════════════

  // 1. Król obrażeń
  if (wszyscy[0]) {
    const g = wszyscy[0];
    const srObr = Math.round(g.obrazeniaLacznie / g.uczestnictwa);
    const dominacja = lacznie > 0 ? Math.round((g.obrazeniaLacznie / lacznie) * 100) : 0;
    ciekawostki.push({ ikona: "👑", tytul: "Król obrażeń", opis: `${g.nazwa} zadał ${formatLiczby(g.obrazeniaLacznie)} obrażeń — to ${dominacja}% łącznych obrażeń gangu. Średnio ${formatLiczby(srObr)} na walkę. Reszta gangu zastanawia się czy gra w tę samą grę.`, kategoria: "top" });
  }

  // 2. Ostatnie miejsce w rankingu
  if (wszyscy.length > 1) {
    const ostatni = wszyscy[wszyscy.length - 1];
    const proporcja = wszyscy[0].obrazeniaLacznie > 0 ? Math.round(wszyscy[0].obrazeniaLacznie / Math.max(1, ostatni.obrazeniaLacznie)) : 0;
    const teksty = [
      `${ostatni.nazwa} zakończył sezon na ostatnim miejscu z ${formatLiczby(ostatni.obrazeniaLacznie)} obrażeń. Lider ma ${proporcja}× więcej. Nie, nie ma się z czego śmiać. Śmiejemy się.`,
      `${ostatni.nazwa} — ostatnie miejsce. Gratulujemy. Serio. Pojawienie się to już 50% sukcesu. Wyniki to drugie 50%. Jedno z nich wyszło.`,
      `${ostatni.nazwa} udowodnił że zawsze jest ktoś ostatni. Tym razem on. Następnym razem... też pewnie on.`,
    ];
    ciekawostki.push({ ikona: "🥄", tytul: "Złota łyżka sezonu", opis: teksty[lacznaWalka % teksty.length], kategoria: "czarny" });
  }

  // 3. Mistrz tarcz
  const mistrzTarcz = [...wszyscy].sort((a, b) => b.tarczeLacznie - a.tarczeLacznie)[0];
  if (mistrzTarcz && mistrzTarcz.tarczeLacznie > 0) {
    const srTarcz = (mistrzTarcz.tarczeLacznie / mistrzTarcz.uczestnictwa).toFixed(1);
    ciekawostki.push({ ikona: "🛡️", tytul: "Mistrz destrukcji tarcz", opis: `${mistrzTarcz.nazwa} zdjął ${mistrzTarcz.tarczeLacznie} tarcz w sezonie (${srTarcz} na walkę). Tarcze widzą go i same spadają ze strachu. Ewentualnie po prostu dużo gra — jedno z dwóch.`, kategoria: "top" });
  }

  // 4. Najaktywniejszy
  const najwiecejWalk = [...wszyscy].sort((a, b) => b.uczestnictwa - a.uczestnictwa)[0];
  if (najwiecejWalk) {
    const procent = Math.round((najwiecejWalk.uczestnictwa / lacznaWalka) * 100);
    const nieobecni = lacznaWalka - najwiecejWalk.uczestnictwa;
    const komentarz = procent === 100 ? "Nie opuścił ani jednej walki. Nie ma życia poza gangiem. Rodzina pyta gdzie jest. Gang wie." : `Opuścił ${nieobecni} walk${nieobecni===1?"ę":nieobecni<5?"i":""}. Reszta opuściła więcej. Małe zwycięstwo, ale zawsze coś.`;
    ciekawostki.push({ ikona: "🎮", tytul: "Gracz sezonu", opis: `${najwiecejWalk.nazwa} był w ${najwiecejWalk.uczestnictwa}/${lacznaWalka} walk (${procent}%). ${komentarz}`, kategoria: "top" });
  }

  // 5. Król zwycięstw
  const krolZwycieztw = [...wszyscy].sort((a,b) => b.zwyciestwa - a.zwyciestwa)[0];
  if (krolZwycieztw && krolZwycieztw.zwyciestwa > 0) {
    const procentWygr = Math.round((krolZwycieztw.zwyciestwa / krolZwycieztw.uczestnictwa) * 100);
    ciekawostki.push({ ikona: "🏅", tytul: "Król pierwszych miejsc", opis: `${krolZwycieztw.nazwa} wygrał ${krolZwycieztw.zwyciestwa} walk (${procentWygr}% swoich walk). Podium to jego prywatna własność. Reszta może oglądać z dołu.`, kategoria: "top" });
  }

  // 6. Kolekcjoner ostatnich miejsc
  const krolPorazek = [...wszyscy].sort((a,b) => b.ostatnieMiejsca - a.ostatnieMiejsca)[0];
  if (krolPorazek && krolPorazek.ostatnieMiejsca >= 2) {
    const procentOstat = Math.round((krolPorazek.ostatnieMiejsca / krolPorazek.uczestnictwa) * 100);
    const komentarze = [
      `${krolPorazek.nazwa} skończył ostatni ${krolPorazek.ostatnieMiejsca} razy (${procentOstat}% walk). Na tym etapie to już nie jest pech — to styl życia.`,
      `${krolPorazek.nazwa} zajął ostatnie miejsce ${krolPorazek.ostatnieMiejsca} razy w sezonie. Ekspert w swojej dziedzinie. Dziedzina jest tragiczna, ale ekspertyza imponuje.`,
      `${krolPorazek.nazwa} — ${krolPorazek.ostatnieMiejsca} ostatnich miejsc. Psycholodzy nazywają to "konsekwentną autoprezentacją od tyłu". My nazywamy to inaczej.`,
    ];
    ciekawostki.push({ ikona: "🪦", tytul: "Kolekcjoner klęsk", opis: komentarze[krolPorazek.ostatnieMiejsca % komentarze.length], kategoria: "czarny" });
  }

  // 7. Awans/spadek formy
  if (lacznaWalka >= 4) {
    const polowa = Math.floor(lacznaWalka / 2);
    const walkiSort = [...walki].sort((a, b) => new Date(a.data) - new Date(b.data));
    const wp = walkiSort.slice(0, polowa);
    const wd = walkiSort.slice(polowa);

    const formy = wszyscy.map(g => {
      const op = wp.map(w => w.gracze.find(gr => gr.nazwa === g.nazwa)?.obrazenia || 0).filter(x => x > 0);
      const od = wd.map(w => w.gracze.find(gr => gr.nazwa === g.nazwa)?.obrazenia || 0).filter(x => x > 0);
      if (op.length === 0 || od.length === 0) return null;
      const srP = op.reduce((s,x)=>s+x,0)/op.length;
      const srD = od.reduce((s,x)=>s+x,0)/od.length;
      const zmiana = srP > 0 ? ((srD - srP) / srP) * 100 : 0;
      return { nazwa: g.nazwa, zmiana, srP, srD };
    }).filter(Boolean);

    const najlepsza = [...formy].sort((a,b) => b.zmiana - a.zmiana)[0];
    const najgorsza = [...formy].sort((a,b) => a.zmiana - b.zmiana)[0];

    if (najlepsza && najlepsza.zmiana > 15) {
      ciekawostki.push({ ikona: "📈", tytul: "Odkrycie sezonu", opis: `${najlepsza.nazwa} urósł o ${najlepsza.zmiana.toFixed(0)}% w drugiej połowie sezonu (${formatLiczby(Math.round(najlepsza.srP))} → ${formatLiczby(Math.round(najlepsza.srD))} śr.). Albo w końcu przeczytał tutorial, albo reszta zaczęła grać gorzej. Obie opcje są możliwe.`, kategoria: "top" });
    }
    if (najgorsza && najgorsza.zmiana < -15) {
      ciekawostki.push({ ikona: "📉", tytul: "Wypalenie sezonu", opis: `${najgorsza.nazwa} stracił ${Math.abs(najgorsza.zmiana).toFixed(0)}% formy w drugiej połowie (${formatLiczby(Math.round(najgorsza.srP))} → ${formatLiczby(Math.round(najgorsza.srD))} śr.). Co się stało w drugiej połowie? Urlop? Nowa miłość? Nowa gra? Nowe życie? Cokolwiek to było — gang to odczuł.`, kategoria: "czarny" });
    }
  }

  // 8. Żelazna konsekwencja
  if (lacznaWalka >= 3) {
    const stabilni = wszyscy.filter(g => g.uczestnictwa >= Math.ceil(lacznaWalka * 0.5)).map(g => {
      const sr = g.obrazeniaLacznie / g.uczestnictwa;
      const war = g.historiaObr.reduce((s,h)=>s+Math.pow(h.obr-sr,2),0)/g.historiaObr.length;
      const wsk = sr > 0 ? (Math.sqrt(war)/sr)*100 : 999;
      return { nazwa: g.nazwa, wsk, sr };
    }).sort((a,b) => a.wsk - b.wsk);
    if (stabilni[0] && stabilni[0].wsk < 25) {
      const tytulStab = stabilni[0].wsk < 8 ? "🎯 Szwajcarski zegarek" : "🤖 Człowiek-maszyna";
      const opisStab = stabilni[0].wsk < 8
        ? `${stabilni[0].nazwa} odchyla się tylko ${stabilni[0].wsk.toFixed(1)}% od swojej średniej ${formatLiczby(Math.round(stabilni[0].sr))}. Szwajcarski zegarek ma większą wariancję. Albo bot, albo ta osoba nie ma żadnego życia poza tym jednym przyciskiem.`
        : `${stabilni[0].nazwa} odchyla się ${stabilni[0].wsk.toFixed(0)}% od swojej średniej ${formatLiczby(Math.round(stabilni[0].sr))}. Nieludzka regularność. Rodzina pyta kiedy wróci do domu. Gang wie że nigdzie nie idzie.`;
      ciekawostki.push({ ikona: stabilni[0].wsk < 8 ? "🎯" : "🤖", tytul: tytulStab, opis: opisStab, kategoria: "info" });
    }
  }

  // 9. Chaos wcielony
  if (lacznaWalka >= 4) {
    const chaotyczny = wszyscy.find(g => {
      if (g.uczestnictwa < 3) return false;
      const max = Math.max(...g.historiaObr.map(h=>h.obr));
      const min = Math.min(...g.historiaObr.filter(h=>h.obr>0).map(h=>h.obr));
      return max > min * 8 && min > 0;
    });
    if (chaotyczny) {
      const max = Math.max(...chaotyczny.historiaObr.map(h=>h.obr));
      const min = Math.min(...chaotyczny.historiaObr.filter(h=>h.obr>0).map(h=>h.obr));
      ciekawostki.push({ ikona: "🎲", tytul: "Chaos wcielony", opis: `${chaotyczny.nazwa} potrafi zrobić ${formatLiczby(min)} i ${formatLiczby(max)} w różnych walkach. Zakres ${Math.round(max/min)}×. Wyniki zależą od fazy księżyca, dnia tygodnia i tego czy zjadł śniadanie. Gang nigdy nie wie czego się spodziewać. On też nie.`, kategoria: "czarny" });
    }
  }

  // #8 Honorowi obserwatorzy — 0 obrażeń w ostatniej walce
  const ostatniaWalkaSezon = [...walki].sort((a, b) => new Date(b.data) - new Date(a.data))[0];
  if (ostatniaWalkaSezon) {
    const zerObrOstatnia = ostatniaWalkaSezon.gracze.filter(g => g.obrazenia === 0);
    if (zerObrOstatnia.length > 0) {
      const nazwyZer = zerObrOstatnia.map(g => g.nazwa).join(", ");
      const komentZer = zerObrOstatnia.length === 1
        ? `${nazwyZer} zrobił 0 obrażeń w ostatniej walce. Był obecny — to fakt. Cokolwiek robił — nie było to walka.`
        : `${nazwyZer} — ${zerObrOstatnia.length} osoby z 0 obrażeniami w ostatniej walce. To już nie jednostkowy wypadek, to ruch społeczny. Gang docenia waszą obecność. Gang kłamie.`;
      ciekawostki.push({ ikona: "👁️", tytul: "Honorowi obserwatorzy", opis: komentZer, kategoria: "czarny" });
    }
    // Złota łyżka — najsłabszy niezerowy wynik ostatniej walki
    const zObr = [...ostatniaWalkaSezon.gracze].filter(g => g.obrazenia > 0).sort((a,b) => a.obrazenia - b.obrazenia);
    const najlepszyOst = [...ostatniaWalkaSezon.gracze].sort((a,b) => b.obrazenia - a.obrazenia)[0];
    if (zObr.length > 1 && zObr[0].obrazenia < najlepszyOst.obrazenia * 0.15) {
      const stosunekOst = Math.round(najlepszyOst.obrazenia / zObr[0].obrazenia);
      ciekawostki.push({ ikona: "🥄", tytul: "Złota łyżka (ostatnia walka)", opis: `${zObr[0].nazwa} zrobił ${formatLiczby(zObr[0].obrazenia)} obrażeń gdy lider zrobił ${formatLiczby(najlepszyOst.obrazenia)}. ${stosunekOst}× mniej. Dla porównania: przypadkowe kliknięcie w ekran daje więcej. Ale się stara. Prawdopodobnie.`, kategoria: "czarny" });
    }
  }

  // 10. Nigdy nie zdjął tarcz
  const zerTarcz = wszyscy.filter(g => g.tarczeLacznie === 0 && g.uczestnictwa >= 3);
  if (zerTarcz.length > 0) {
    const nazwy = zerTarcz.map(g=>g.nazwa).join(", ");
    ciekawostki.push({ ikona: "🫧", tytul: "Tarcze? Nigdy nie słyszałem", opis: `${nazwy} przez cały sezon nie zdjął ani jednej tarczy wroga. Przez cały sezon. Ani jedna. Być może myślą że tarcze to dekoracja. Być może mają rację i po prostu grają inaczej. Nie. Nie mają racji.`, kategoria: "czarny" });
  }

  // 11. Drużyna B — poniżej połowy średniej
  const ponizejSredniej = wszyscy.filter(g => g.uczestnictwa >= 3 && g.obrazeniaLacznie < srednieObr * 0.5);
  if (ponizejSredniej.length > 0) {
    const procSr = Math.round((ponizejSredniej[0].obrazeniaLacznie / srednieObr) * 100);
    ciekawostki.push({ ikona: "💤", tytul: "Drużyna B", opis: `${ponizejSredniej.map(g=>g.nazwa).join(", ")} robi mniej niż połowę średniej gangu. ${ponizejSredniej[0].nazwa} osiąga ${procSr}% średniej. Gang wie że grasz. Wyniki nie wiedzą. Wyniki są bezlitosne i nie przepraszają.`, kategoria: "czarny" });
  }

  // 12. Brak uczestnictwa
  const bezObr = czlonkowie.filter(c => {
    const s = statystyki[c.nazwa];
    return !s || s.obrazeniaLacznie === 0;
  }).map(c => c.nazwa);
  if (bezObr.length > 0) {
    const komentarze = [
      `${bezObr.join(", ")} — ${bezObr.length===1?"zaliczył":"zaliczyli"} sezon bez żadnych obrażeń. Subtelna forma protestu czy zwykłe nieobecność? Efekt ten sam.`,
      `${bezObr.join(", ")} postanowi${bezObr.length===1?"ł":"li"} zaliczyć sezon metodą obserwatora. Zero obrażeń. Można to wpisać do CV jako "doświadczenie w analizie strategicznej".`,
    ];
    ciekawostki.push({ ikona: "👻", tytul: "Duchy sezonu", opis: komentarze[bezObr.length % komentarze.length], kategoria: "czarny" });
  }

  // 13. Pacyfista — więcej tarcz niż sens
  const pacyfista = wszyscy.find(g => g.tarczeLacznie > 0 && g.uczestnictwa >= 2 && g.tarczeLacznie * 80000 > g.obrazeniaLacznie);
  if (pacyfista) {
    ciekawostki.push({ ikona: "🕊️", tytul: "Pacyfista gangu", opis: `${pacyfista.nazwa} bardziej skupia się na tarczach niż obrażeniach. Zdejmuje tarcze zamiast zadawać obrażenia. Może to filozofia. Może to błąd. Gang przychyla się do drugiej opcji.`, kategoria: "czarny" });
  }

  // #10 Żółwik sezonu — 5× gorszy od lidera
  if (wszyscy.length > 2) {
    const lider = wszyscy[0];
    const zolwiki = wszyscy.filter((g, i) => i > 0 && g.uczestnictwa >= 2 && lider.obrazeniaLacznie / Math.max(1, g.obrazeniaLacznie) >= 5);
    if (zolwiki.length > 0) {
      const z = zolwiki[zolwiki.length - 1]; // najgorszy
      const stosunek = Math.round(lider.obrazeniaLacznie / Math.max(1, z.obrazeniaLacznie));
      const komentarze = [
        `${z.nazwa} robi ${stosunek}× mniej obrażeń niż lider ${lider.nazwa}. To nie jest przepaść — to inny kontynent. Inny wymiar. Inna gra.`,
        `${z.nazwa} vs ${lider.nazwa}: stosunek ${stosunek}:1. Dla kontekstu: tyle samo wynosi stosunek szybkości F1 do roweru. Oba dojadą. Różnica jest oczywista.`,
        `${z.nazwa} robi ${stosunek}× mniej niż lider. Statystycznie obecność ${z.nazwa} w walce nie zmienia wyniku gangu. Ale moralnie — ceniona.`,
      ];
      ciekawostki.push({ ikona: "🐢", tytul: "Żółwik sezonu", opis: komentarze[stosunek % komentarze.length], kategoria: "czarny" });
    }
  }

  // #11 Niezniszczalny — regularnie TOP 3
  if (lacznaWalka >= 3) {
    const niezniszczalni = wszyscy.filter(g => {
      if (g.uczestnictwa < Math.ceil(lacznaWalka * 0.5)) return false;
      const top3 = g.miejsca.filter(m => m <= 3).length;
      return top3 / g.uczestnictwa >= 0.6;
    });
    if (niezniszczalni.length > 0) {
      const n = niezniszczalni[0];
      const procTop3 = Math.round((n.miejsca.filter(m=>m<=3).length / n.uczestnictwa) * 100);
      ciekawostki.push({ ikona: "🦁", tytul: "Niezniszczalny", opis: `${n.nazwa} kończy w TOP 3 w ${procTop3}% swoich walk. Podium to jego prywatna własność — reszta może patrzeć. ${n.uczestnictwa - n.miejsca.filter(m=>m<=3).length} razy mu nie wyszło. Sam jest zaskoczony.`, kategoria: "top" });
    }
  }

  // #18 Zasłużony urlop — 3+ walki nieobecności z rzędu
  if (lacznaWalka >= 4) {
    const walkiSort = [...walki].sort((a,b) => new Date(a.data) - new Date(b.data));
    const urlopowicze = [];
    wszyscy.forEach(g => {
      let maxNieobecnych = 0, obecnych = 0;
      walkiSort.forEach(w => {
        const byl = w.gracze.some(gr => gr.nazwa === g.nazwa);
        if (!byl) { obecnych++; maxNieobecnych = Math.max(maxNieobecnych, obecnych); }
        else obecnych = 0;
      });
      if (maxNieobecnych >= 3) urlopowicze.push({ nazwa: g.nazwa, nieobecnych: maxNieobecnych });
    });
    if (urlopowicze.length > 0) {
      urlopowicze.sort((a,b) => b.nieobecnych - a.nieobecnych);
      const u = urlopowicze[0];
      const komentarze = [
        `${u.nazwa} opuścił ${u.nieobecnych} walk z rzędu. Nikt nie pytał. Gang sobie poradził. ${u.nazwa} wrócił. Gang udał że tęsknił.`,
        `${u.nazwa} zniknął na ${u.nieobecnych} walkach pod rząd. Telefon? Życie osobiste? Prąd? Podsumowanie: gang walczył bez niego i jakoś przeżył. Obydwoje przeżyli.`,
        `${u.nazwa} — ${u.nieobecnych} nieobecności z rzędu. Legenda mówi że wyjechał. Inne legendy mówią że grał w inny gang. Prawda jest nieznana i tak zostanie.`,
      ];
      ciekawostki.push({ ikona: "🏖️", tytul: "Zasłużony urlop", opis: komentarze[u.nieobecnych % komentarze.length], kategoria: "czarny" });
    }
  }

  // 14. Rekord pojedynczej walki
  let rekordObr = 0, rekordGracz = null, rekordData = null;
  walki.forEach(w => {
    w.gracze.forEach(g => {
      if (g.obrazenia > rekordObr) { rekordObr = g.obrazenia; rekordGracz = g.nazwa; rekordData = w.data; }
    });
  });
  if (rekordGracz && rekordObr > 100000) {
    ciekawostki.push({ ikona: "💥", tytul: "Rekord sezonu", opis: `${rekordGracz} zadał ${formatLiczby(rekordObr)} obrażeń w jednej walce${rekordData ? " ("+rekordData+")" : ""}. To jest nielegalne moralnie. Regulamin milczy ale twarz mówi wszystko.`, kategoria: "top" });
  }

  // 15. Podium procent
  if (lacznaWalka >= 3) {
    const podiumMistrzowie = [...wszyscy].filter(g=>g.uczestnictwa>=Math.ceil(lacznaWalka*0.4)).sort((a,b)=>(b.podium/b.uczestnictwa)-(a.podium/a.uczestnictwa));
    if (podiumMistrzowie[0] && podiumMistrzowie[0].podium > 0) {
      const pm = podiumMistrzowie[0];
      const proc = Math.round((pm.podium/pm.uczestnictwa)*100);
      ciekawostki.push({ ikona: "🥈", tytul: "Pan podium", opis: `${pm.nazwa} kończy w top 3 w ${proc}% swoich walk (${pm.podium}/${pm.uczestnictwa}). Inne miejsca istnieją tylko w teorii. ${pm.nazwa} ich nie potrzebuje.`, kategoria: "info" });
    }
  }

  // 16. Najbardziej poprawiony
  if (lacznaWalka >= 4) {
    const poprawil = wszyscy.filter(g => {
      if (g.historiaObr.length < 4) return false;
      const pol = Math.floor(g.historiaObr.length/2);
      const p1 = g.historiaObr.slice(0,pol).reduce((s,h)=>s+h.obr,0)/pol;
      const p2 = g.historiaObr.slice(pol).reduce((s,h)=>s+h.obr,0)/(g.historiaObr.length-pol);
      return p2 > p1 * 1.4;
    }).sort((a,b)=>{
      const polA=Math.floor(a.historiaObr.length/2);
      const polB=Math.floor(b.historiaObr.length/2);
      const p1a=a.historiaObr.slice(0,polA).reduce((s,h)=>s+h.obr,0)/polA;
      const p2a=a.historiaObr.slice(polA).reduce((s,h)=>s+h.obr,0)/(a.historiaObr.length-polA);
      const p1b=b.historiaObr.slice(0,polB).reduce((s,h)=>s+h.obr,0)/polB;
      const p2b=b.historiaObr.slice(polB).reduce((s,h)=>s+h.obr,0)/(b.historiaObr.length-polB);
      return (p2b/p1b)-(p2a/p1a);
    });
    if (poprawil.length > 0) {
      ciekawostki.push({ ikona: "🌱", tytul: "Glow up sezonu", opis: `${poprawil[0].nazwa} zaczął sezon słabo a skończył mocno. Coś się zmieniło w drugiej połowie sezonu. Nowy telefon? Okulary? Przeczytał instrukcję? Nieważne — teraz miażdży i nie ma się co czepiać.`, kategoria: "top" });
    }
  }

  // 17. Suchy żart o gangu — kilka wariantów
  const totalTarcze = wszyscy.reduce((s,g)=>s+g.tarczeLacznie,0);
  const srObr1Os = Math.round(lacznie / Math.max(1, wszyscy.length));
  // Raport końcowy — dokładnie 4 rotacje zgodnie ze specą
  const srObr1Os2 = Math.round(lacznie / Math.max(1, wszyscy.length));
  const zarty4 = [
    `Sezon zamknięty. ${lacznaWalka} walk, ${wszyscy.length} graczy, ${formatLiczby(lacznie)} obrażeń. Średnia na osobę to ${formatLiczby(srObr1Os2)}. Część gangu tę średnią przekroczyła. Część potraktowała ją jako sugestię. Wyniki mówią same za siebie i nie są dyplomatyczne. 📊`,
    `${formatLiczby(lacznie)} obrażeń łącznie. Gdyby za każde 1000 obrażeń dostać złotówkę, ${wszyscy[0]?.nazwa || "lider"} kupiłby nowy telefon. Ostatni w rankingu kupiłby może kawę. Małą. Bez cukru bo na resztę nie wystarczy. ☕`,
    `${lacznaWalka} walk, ${formatLiczby(lacznie)} obrażeń, ${totalTarcze} tarcz, ${wszyscy.length} graczy. Statystyki nie kłamią, nie przesadzają i nie oszczędzają uczuć. To samo można powiedzieć o tym podsumowaniu. Miłego sezonu. 👁️`,
    `Koniec sezonu. Ktoś dał z siebie wszystko. Ktoś dał połowę. Ktoś wyraźnie miał ważniejsze sprawy. Ranking to odzwierciedla z chirurgiczną precyzją i zerową empatią. Tak jak powinien. 🔪`,
  ];
  ciekawostki.push({ ikona: "📊", tytul: "Raport końcowy", opis: zarty4[lacznaWalka % 4], kategoria: "info" });

  return { wszyscy, ciekawostki, lacznaWalka, lacznie, srWalka, totalTarcze };
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

  const { lacznie, srWalka, totalTarcze } = podsumowanie;

  // Kolory kategorii ciekawostek
  const kategoriaStyl = {
    top:    { border: "#ffd70033", bg: "rgba(255,215,0,0.05)", kolor: "#ffd700" },
    czarny: { border: "#f5544433", bg: "rgba(255,50,50,0.04)", kolor: "#f88" },
    info:   { border: "#87CEEB33", bg: "rgba(135,206,235,0.04)", kolor: "#87CEEB" },
  };

  return (
    <div>
      {/* Nagłówek z mega-statystykami */}
      <div style={{ background: "linear-gradient(135deg, rgba(255,215,0,0.1), rgba(184,134,11,0.08))", border: "1px solid #b8860b55", borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: "bold", color: "#ffd700", marginBottom: 10, textAlign: "center" }}>🏆 Podsumowanie sezonu</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {[
            { ikona: "⚔️", label: "Walk", value: lacznaWalka },
            { ikona: "💥", label: "Łączne obr.", value: formatLiczby(lacznie || 0) },
            { ikona: "📊", label: "Śr./walkę", value: formatLiczby(srWalka || 0) },
            { ikona: "👥", label: "Graczy", value: wszyscy.length },
            { ikona: "🛡️", label: "Tarcze", value: totalTarcze || 0 },
            { ikona: "🏅", label: "Śr./osobę", value: formatLiczby(Math.round((lacznie||0)/Math.max(1,wszyscy.length))) },
          ].map((s,i) => (
            <div key={i} style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 16 }}>{s.ikona}</div>
              <div style={{ fontSize: 14, fontWeight: "bold", color: "#ffd700" }}>{s.value}</div>
              <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Ciekawostki pogrupowane */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: "bold", color: "#ffd700", marginBottom: 8 }}>✨ Wyróżnienia sezonu</div>
        {ciekawostki.map((c, i) => {
          const styl = kategoriaStyl[c.kategoria] || kategoriaStyl.info;
          return (
            <div key={i} style={{
              background: styl.bg,
              border: `1px solid ${styl.border}`,
              borderLeft: `3px solid ${styl.kolor}`,
              borderRadius: 8, padding: "10px 12px", marginBottom: 6,
              display: "flex", gap: 10, alignItems: "flex-start",
            }}>
              <div style={{ fontSize: 22, lineHeight: 1, marginTop: 1 }}>{c.ikona}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: "bold", color: styl.kolor }}>{c.tytul}</div>
                <div style={{ fontSize: 11, color: "#ccc", marginTop: 3, lineHeight: 1.5 }}>{c.opis}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Info o edycji */}
      <div style={{ background: "rgba(255,165,0,0.06)", border: "1px solid #fa055", borderRadius: 8, padding: "7px 12px", marginBottom: 10, fontSize: 10, color: "#fa0" }}>
        ✏️ Kliknij gracza żeby zmienić nick — scali statystyki z różnych zapisów AI.
      </div>

      {/* Pełny ranking */}
      <div>
        <div style={{ fontSize: 13, fontWeight: "bold", color: "#ffd700", marginBottom: 8 }}>📊 Łączny ranking sezonu</div>
        {wszyscy.map((g, i) => {
          const kolor = i === 0 ? "#ffd700" : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : "#666";
          const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i+1}.`;
          const sredniaObr = Math.round(g.obrazeniaLacznie / g.uczestnictwa);
          const sredniaTarcz = (g.tarczeLacznie / g.uczestnictwa).toFixed(1);
          const udział = lacznie > 0 ? Math.round((g.obrazeniaLacznie/lacznie)*100) : 0;
          const edytuje = edycjaGracza === g.nazwa;
          const procentWalk = Math.round((g.uczestnictwa/lacznaWalka)*100);

          return (
            <div key={i} style={{
              background: edytuje ? "rgba(255,215,0,0.08)" : i < 3 ? `linear-gradient(90deg, ${kolor}12, transparent)` : "rgba(255,255,255,0.02)",
              border: "1px solid #2a2a3a",
              borderLeft: `3px solid ${kolor}`,
              borderRadius: 6, padding: "10px 12px", marginBottom: 5,
            }}>
              {edytuje ? (
                <div>
                  <div style={{ fontSize: 11, color: "#ffd700", marginBottom: 6 }}>✏️ Zmień nick gracza #{i+1} (zmiana dotyczy WSZYSTKICH walk)</div>
                  <input value={nowyNick} onChange={e=>setNowyNick(e.target.value)} placeholder={g.nazwa} autoFocus
                    style={{ width:"100%", padding:"6px 8px", background:"#12122a", border:"1px solid #444", borderRadius:4, color:"#fff", fontSize:12, marginBottom:8, boxSizing:"border-box" }}/>
                  <div style={{ display:"flex", gap:6 }}>
                    <button onClick={()=>scalajNick(g.nazwa,nowyNick)} style={{ flex:1, padding:"6px", background:"rgba(0,200,100,0.15)", border:"1px solid #0c6", borderRadius:5, color:"#0c6", cursor:"pointer", fontSize:12, fontWeight:"bold" }}>✓ Zapisz</button>
                    <button onClick={()=>setEdycjaGracza(null)} style={{ padding:"6px 12px", background:"rgba(255,255,255,0.05)", border:"1px solid #444", borderRadius:5, color:"#888", cursor:"pointer", fontSize:12 }}>Anuluj</button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6, flexWrap:"wrap" }}>
                    <span style={{ fontSize: i<3?16:13, width:28, textAlign:"center" }}>{medal}</span>
                    <span style={{ flex:1, fontSize:13, color: i<3?"#fff":"#ddd", fontWeight: i<3?"bold":"normal" }}>{g.nazwa}</span>
                    <span style={{ fontSize:10, color:"#555", background:"rgba(255,255,255,0.04)", padding:"2px 6px", borderRadius:10 }}>{g.uczestnictwa}/{lacznaWalka} walk ({procentWalk}%)</span>
                    <button onClick={()=>{setEdycjaGracza(g.nazwa);setNowyNick(g.nazwa);}}
                      style={{ padding:"2px 7px", background:"rgba(255,215,0,0.08)", border:"none", borderRadius:3, color:"#b8860b", cursor:"pointer", fontSize:10 }}>✏️</button>
                  </div>
                  <div style={{ display:"flex", gap:10, fontSize:11, color:"#aaa", flexWrap:"wrap", paddingLeft:36 }}>
                    <span>🔫 <strong style={{ color:"#ffd700" }}>{formatLiczby(g.obrazeniaLacznie)}</strong></span>
                    <span>śr. {formatLiczby(sredniaObr)}/walkę</span>
                    <span>🛡️ <strong style={{ color:"#87CEEB" }}>{g.tarczeLacznie}</strong> ({sredniaTarcz}/w)</span>
                    <span style={{ color: udział>=20?"#ffd700":udział>=10?"#aaa":"#666" }}>📈 {udział}% gangu</span>
                    {(g.zwyciestwa||0) > 0 && <span style={{ color:"#0c6" }}>🏅 {g.zwyciestwa} wygr.</span>}
                  </div>
                  {/* Pasek udziału */}
                  <div style={{ marginTop:6, paddingLeft:36 }}>
                    <div style={{ height:3, background:"#12122a", borderRadius:2, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${udział}%`, background:`linear-gradient(90deg,${kolor},${kolor}88)`, transition:"width 0.5s" }}/>
                    </div>
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


