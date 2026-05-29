import { useState, useEffect } from "react";

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
export default function WalkiView({ czlonkowie, walki, zapiszWalki, isAdmin, archiwumWalk=[] }) {
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
    });
  });

  const wszyscy = Object.values(statystyki);
  wszyscy.sort((a, b) => b.obrazeniaLacznie - a.obrazeniaLacznie);

  // Pozycja w łącznym rankingu sezonu (indeks w posortowanej liście)
  wszyscy.forEach((g, i) => { g.pozycjaSezonu = i + 1; });

  const lacznaWalka = walki.length;
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

  // 4. Najaktywniejszy — max uczestnictwa (cap do liczby walk)
  const najwiecejWalk = [...wszyscy].sort((a, b) => b.uczestnictwa - a.uczestnictwa)[0];
  if (najwiecejWalk) {
    const procent = Math.round((najwiecejWalk.uczestnictwa / lacznaWalka) * 100);
    ciekawostki.push({ ikona: "🎮", tytul: "Najaktywniejszy", opis: `${najwiecejWalk.nazwa} — był w ${najwiecejWalk.uczestnictwa} z ${lacznaWalka} walk (${procent}%)` });
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

  // 6. Brak obrażeń — nieobecni lub z zerowymi obrażeniami
  const bezObr = czlonkowie.filter(c => {
    const s = statystyki[c.nazwa];
    return !s || s.obrazeniaLacznie === 0;
  }).map(c => c.nazwa);
  if (bezObr.length > 0) {
    ciekawostki.push({ ikona: "💀", tytul: "Brak obrażeń", opis: `${bezObr.length} osób bez ani jednego obrażenia w sezonie: ${bezObr.slice(0, 5).join(", ")}${bezObr.length > 5 ? "..." : ""}` });
  }

  // 7. Mało zaangażowani
  const malo = wszyscy.filter(g => g.obrazeniaLacznie < 500000 && g.uczestnictwa >= 2);
  if (malo.length > 0) {
    ciekawostki.push({ ikona: "💤", tytul: "Mało zaangażowani", opis: `${malo.map(g => `${g.nazwa} (${formatLiczby(g.obrazeniaLacznie)})`).slice(0, 3).join(", ")}` });
  }

  // 8. Śmieszne ciekawostki — więcej i bardziej czarne 😄
  const ostatniaWalka = [...walki].sort((a, b) => new Date(b.data) - new Date(a.data))[0];
  if (ostatniaWalka) {
    const ostatniRanking = [...ostatniaWalka.gracze].sort((a, b) => b.obrazenia - a.obrazenia);
    const ostatniMiejsce = ostatniRanking[ostatniRanking.length - 1];
    const pierwszeMiejsce = ostatniRanking[0];

    if (ostatniMiejsce && pierwszeMiejsce && ostatniMiejsce.obrazenia < 10000) {
      ciekawostki.push({ ikona: "🥄", tytul: "Złota łyżka", opis: `${ostatniMiejsce.nazwa} zdobył tylko ${formatLiczby(ostatniMiejsce.obrazenia)} obrażeń w ostatniej walce. Telefon się rozładował? Pies zjadł ładowarkę? 📱` });
    }

    // Ktoś zrobił 0 obrażeń
    const zerObr = ostatniRanking.filter(g => g.obrazenia === 0);
    if (zerObr.length > 0) {
      ciekawostki.push({ ikona: "👁️", tytul: "Świadek walki", opis: `${zerObr.map(g=>g.nazwa).join(", ")} ${zerObr.length===1?"obserwował":"obserwowali"} walkę z boku z 0 obrażeniami. Może następnym razem weźcie udział? 😂` });
    }
  }

  // Ktoś nigdy nie zdjął tarcz
  const zerTarcz = wszyscy.filter(g => g.tarczeLacznie === 0 && g.uczestnictwa >= 3);
  if (zerTarcz.length > 0) {
    ciekawostki.push({ ikona: "🫧", tytul: "Tarcze? Co to jest?", opis: `${zerTarcz.map(g => g.nazwa).join(", ")} przez cały sezon nie zdjął ani jednej tarczy. Czy w ogóle walczysz, czy tylko pozujesz? 😂` });
  }

  // Największa różnica między najlepszym a najgorszym
  if (wszyscy.length > 2) {
    const ostatni = wszyscy[wszyscy.length - 1];
    const najlepszy = wszyscy[0];
    if (ostatni.obrazeniaLacznie > 0) {
      const stosunek = Math.round(najlepszy.obrazeniaLacznie / Math.max(1, ostatni.obrazeniaLacznie));
      if (stosunek >= 10) {
        ciekawostki.push({ ikona: "🐢", tytul: "Żółwik sezonu", opis: `${ostatni.nazwa} robi ${stosunek}× mniej obrażeń niż lider ${najlepszy.nazwa}. Może zamiast grać w The Gang, grasz w The Nap? 😴` });
      }
    }
  }

  // Ktoś jest zawsze w top 3
  if (lacznaWalka >= 3) {
    const zawszeTop3 = wszyscy.filter(g =>
      g.uczestnictwa >= Math.ceil(lacznaWalka * 0.7) &&
      g.historiaObr.filter(h => {
        const walka = walki.find(w => w.data === h.data || w.gracze.some(gr => gr.nazwa === g.nazwa && gr.obrazenia === h.obr));
        if (!walka) return false;
        const ranking = [...walka.gracze].sort((a,b) => b.obrazenia - a.obrazenia);
        const pozycja = ranking.findIndex(gr => gr.nazwa === g.nazwa);
        return pozycja <= 2;
      }).length >= Math.ceil(g.uczestnictwa * 0.6)
    );
    if (zawszeTop3.length > 0) {
      ciekawostki.push({ ikona: "🦁", tytul: "Niezniszczalny", opis: `${zawszeTop3[0].nazwa} regularnie kończy w TOP 3. Reszta gangu zastanawia się czy grasz fair czy po prostu masz lepszy telefon 📱` });
    }
  }

  // Ktoś zrobił dokładnie tyle samo obrażeń w każdej walce (konsekwentny)
  if (lacznaWalka >= 3) {
    const konsekwentny = wszyscy.filter(g => {
      if (g.uczestnictwa < 3) return false;
      const obr = g.historiaObr.map(h => h.obr);
      const srednia = obr.reduce((s,o)=>s+o,0)/obr.length;
      const odchylenie = Math.sqrt(obr.reduce((s,o)=>s+Math.pow(o-srednia,2),0)/obr.length);
      return odchylenie < srednia * 0.1 && srednia > 5000;
    });
    if (konsekwentny.length > 0) {
      ciekawostki.push({ ikona: "🤖", tytul: "Robot sezonu", opis: `${konsekwentny[0].nazwa} robi prawie identyczne obrażenia w każdej walce. Bot? Autokliker? A może po prostu masz to perfekcyjnie opanowane 🤔` });
    }
  }

  // Ktoś poprawił się najbardziej w ciągu sezonu
  if (lacznaWalka >= 4) {
    const poprawil = wszyscy.filter(g => {
      if (g.historiaObr.length < 4) return false;
      const polowa = Math.floor(g.historiaObr.length / 2);
      const pierwszaPolowa = g.historiaObr.slice(0, polowa).reduce((s,h)=>s+h.obr,0)/polowa;
      const drugaPolowa = g.historiaObr.slice(polowa).reduce((s,h)=>s+h.obr,0)/(g.historiaObr.length-polowa);
      return drugaPolowa > pierwszaPolowa * 1.5;
    });
    if (poprawil.length > 0) {
      ciekawostki.push({ ikona: "📈", tytul: "Glow up sezonu", opis: `${poprawil[0].nazwa} zaczął sezon słabo ale teraz miażdży. Może w końcu przeczytał tutorial? 😄` });
    }
  }

  // Ktoś zrobił więcej tarcz niż obrażeń
  const tarczo_maniacy = wszyscy.filter(g => g.tarczeLacznie > 0 && g.obrazeniaLacznie > 0 && g.tarczeLacznie * 50000 > g.obrazeniaLacznie);
  if (tarczo_maniacy.length > 0) {
    ciekawostki.push({ ikona: "🛡️", tytul: "Pacyfista gangu", opis: `${tarczo_maniacy[0].nazwa} zdejmuje tarcze zamiast zadawać obrażenia. Może zmień grę na Candy Crush? 🍬` });
  }

  // Najbardziej nieregularny gracz
  if (lacznaWalka >= 5) {
    const nieregularny = wszyscy.find(g => {
      if (g.uczestnictwa < 2) return false;
      const max = Math.max(...g.historiaObr.map(h=>h.obr));
      const min = Math.min(...g.historiaObr.map(h=>h.obr));
      return max > min * 10;
    });
    if (nieregularny) {
      ciekawostki.push({ ikona: "🎲", tytul: "Chaos wcielony", opis: `${nieregularny.nazwa} raz jest bogiem walki, raz robi 0 obrażeń. Losuje wyniki kością? Może zależy od pogody? ⛈️` });
    }
  }

  // Ktoś zawsze ostatni potwierdza wymiany (jeśli mamy dane)
  const srednieObr = wszyscy.length > 0 ? wszyscy.reduce((s,g)=>s+g.obrazeniaLacznie,0)/wszyscy.length : 0;
  const ponizejSredniej = wszyscy.filter(g => g.uczestnictwa >= 3 && g.obrazeniaLacznie < srednieObr * 0.5);
  if (ponizejSredniej.length > 0) {
    ciekawostki.push({ ikona: "💤", tytul: "Drużyna B", opis: `${ponizejSredniej.map(g=>g.nazwa).join(", ")} ${ponizejSredniej.length===1?"robi":"robią"} mniej niż połowę średniej gangu. Wiemy że grasz, ale czy TY wiesz że grasz? 🤷` });
  }

  // Ktoś bił rekordy
  if (lacznaWalka >= 2) {
    const rekordzista = wszyscy[0];
    const maxWalka = rekordzista?.historiaObr.reduce((max,h)=>h.obr>max?h.obr:max, 0);
    if (maxWalka > 200000) {
      ciekawostki.push({ ikona: "💥", tytul: "Absolutny władca", opis: `${rekordzista.nazwa} zadał aż ${formatLiczby(maxWalka)} obrażeń w jednej walce. Czy to w ogóle legalne? 😱` });
    }
  }

  // Suchy żart o całym gangu
  const lacznie = wszyscy.reduce((s, g) => s + g.obrazeniaLacznie, 0);
  const srWalka = lacznaWalka > 0 ? Math.round(lacznie / lacznaWalka) : 0;
  const zartySezonu = [
    `Gang zadał łącznie ${formatLiczby(lacznie)} obrażeń w ${lacznaWalka} walkach. To jak ${Math.round(lacznie/1000000)} razy uderzyć mokrą gazetą 🗞️`,
    `${formatLiczby(lacznie)} obrażeń łącznie. Dla porównania: mały palec u nogi wytrzymuje ~${Math.round(lacznie/200)} razy tyle siły. Wnioski: nieznane 🦶`,
    `Średnio ${formatLiczby(srWalka)} obrażeń na walkę. Statystycznie co najmniej 1 osoba w gangu nie wie jak się gra. Statystyki nie kłamią 📊`,
  ];
  ciekawostki.push({ ikona: "📊", tytul: "Statystyka sezonu", opis: zartySezonu[lacznaWalka % zartySezonu.length] });

  return { wszyscy, ciekawostki, lacznaWalka };
}

function formatLiczby(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(2).replace(".", ",") + "M";
  if (n >= 1000) return (n / 1000).toFixed(2).replace(".", ",") + "k";
  return n.toString();
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

    </div>
  );
}


