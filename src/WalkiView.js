import { useState, useEffect } from "react";
import { analyzeMultiple } from "./gemini";
import { setStructure } from "./firebase";

// Prompt do rozpoznawania rankingu walki
function buildBattlePrompt() {
  return `Rozpoznaj ranking z podsumowania walki gangu w grze The Gang.

Każdy wiersz zawiera:
- miejsce w rankingu (cyfra 1-20)
- avatar z poziomem gracza (mała cyfra na avatarze, np. 1349, 1526)
- nazwa gracza (np. "SaMaNtA", "™FAM™Fallven", "fAM™Szczawo")
- obrażenia obok ikony pistoletu (np. "75,15M" = 75150000, "828,52k" = 828520, "1 717" = 1717)
- zdjęte tarcze obok ikony błyskawicy (np. "24", "0", "3")

Format wartości:
- "M" = miliony (75,15M = 75150000)
- "k" = tysiące (828,52k = 828520, 39,24k = 39240)
- liczba bez jednostki = dokładna wartość (1 717 = 1717)

Mogą być dodatkowe ikonki obok obrażeń/tarcz (korona, tarcza, wózki) — IGNORUJ je, nie wpływają na liczby.

Zwróć WYŁĄCZNIE JSON (bez markdown):
{"gracze":[{"miejsce":1,"nazwa":"SaMaNtA","poziom":1349,"obrazenia":75150000,"tarcze":24}]}

Zwróć wszystkich widocznych graczy. Nazwę gracza skopiuj DOKŁADNIE jak na screenie (z prefixami klanu typu ™FAM™).`;
}

// Analizuje screen walki przez Gemini
async function analyzeBattleImage(file) {
  try {
    const { GEMINI_API_KEY, GEMINI_URL } = await getGeminiConfig();
    if (!GEMINI_API_KEY) {
      return { sukces: false, blad: "🔑 Brak klucza API", fileName: file.name };
    }
    const reader = new FileReader();
    const { base64, mimeType } = await new Promise((resolve, reject) => {
      reader.onload = () => {
        const result = reader.result;
        resolve({ base64: result.split(",")[1], mimeType: file.type });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildBattlePrompt() }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      let userMessage = `Błąd ${response.status}`;
      try {
        const errJson = JSON.parse(errText);
        const code = errJson.error?.code;
        if (code === 429) userMessage = "⏳ Limit Google — odczekaj kilka minut";
        else if (code === 403) userMessage = "🔑 Klucz API zablokowany";
      } catch {}
      throw new Error(userMessage);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    let jsonText = text.trim();
    if (jsonText.startsWith("```json")) jsonText = jsonText.slice(7);
    else if (jsonText.startsWith("```")) jsonText = jsonText.slice(3);
    if (jsonText.endsWith("```")) jsonText = jsonText.slice(0, -3);
    const parsed = JSON.parse(jsonText.trim());
    return { sukces: true, dane: parsed, fileName: file.name };
  } catch (e) {
    console.error("Błąd analizy walki:", e);
    return { sukces: false, blad: e.message, fileName: file.name };
  }
}

async function getGeminiConfig() {
  const key = process.env.REACT_APP_GEMINI_API_KEY || "";
  return {
    GEMINI_API_KEY: key,
    GEMINI_URL: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`,
  };
}

// Główny komponent
export default function WalkiView({ czlonkowie, walki, zapiszWalki, isAdmin }) {
  const [pliki, setPliki] = useState([]);
  const [analizujac, setAnalizujac] = useState(false);
  const [progress, setProgress] = useState({ aktualny: 0, total: 0, plik: "" });
  const [wyniki, setWyniki] = useState(null);
  const [nazwaWalki, setNazwaWalki] = useState("");
  const [podglad, setPodglad] = useState("ranking"); // ranking | historia | sezon
  const [podsumowanieSezonu, setPodsumowanieSezonu] = useState(null);

  const handleFiles = (e) => {
    const fs = Array.from(e.target.files || []);
    setPliki(fs);
    setWyniki(null);
  };

  const analizuj = async () => {
    if (pliki.length === 0) return;
    setAnalizujac(true);
    setProgress({ aktualny: 0, total: pliki.length, plik: "" });

    const rawWyniki = [];
    for (let i = 0; i < pliki.length; i++) {
      setProgress({ aktualny: i, total: pliki.length, plik: pliki[i].name });
      const w = await analyzeBattleImage(pliki[i]);
      rawWyniki.push(w);
      if (i < pliki.length - 1) {
        setProgress({ aktualny: i + 1, total: pliki.length, plik: "⏱️ Pauza 6s..." });
        await new Promise(r => setTimeout(r, 6000));
      }
    }
    setProgress({ aktualny: pliki.length, total: pliki.length, plik: "✓ Zakończono" });

    // Scal wszystkich graczy z różnych screenów (bez duplikatów)
    const wszyscyGracze = {};
    const bledy = [];
    rawWyniki.forEach(w => {
      if (!w.sukces) {
        bledy.push({ fileName: w.fileName, blad: w.blad });
        return;
      }
      (w.dane.gracze || []).forEach(g => {
        const klucz = g.nazwa;
        // Jeśli gracz już istnieje, weź wartość z większą wartością (lub średnią)
        if (!wszyscyGracze[klucz] || g.obrazenia > wszyscyGracze[klucz].obrazenia) {
          wszyscyGracze[klucz] = {
            nazwa: g.nazwa,
            poziom: g.poziom || 0,
            obrazenia: g.obrazenia || 0,
            tarcze: g.tarcze || 0,
            miejsce: g.miejsce || 99,
          };
        }
      });
    });

    const graczeArray = Object.values(wszyscyGracze).sort((a, b) => b.obrazenia - a.obrazenia);
    setWyniki({ gracze: graczeArray, bledy, dataAnalizy: new Date().toISOString() });
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
              {analizujac ? `⏳ ${progress.aktualny}/${progress.total}` : `🤖 Analizuj ${pliki.length} screen${pliki.length === 1 ? "" : "ów"}`}
            </button>

            {analizujac && (
              <div style={{ marginTop: 10 }}>
                <div style={{ height: 8, background: "#12122a", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(progress.aktualny / Math.max(1, progress.total)) * 100}%`, background: "linear-gradient(90deg,#b8860b,#ffd700)", transition: "width 0.3s" }} />
                </div>
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 6, textAlign: "center" }}>{progress.plik}</div>
              </div>
            )}
          </div>

          {wyniki && (
            <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid #2a2a3a", borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
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

              <RankingTabela gracze={wyniki.gracze} edytowalne={true} onChange={(novi) => setWyniki(w => ({ ...w, gracze: novi }))} />
            </div>
          )}
        </>
      )}

      {podglad === "historia" && (
        <HistoriaWalk walki={walki || []} usunWalke={usunWalke} isAdmin={isAdmin} />
      )}

      {podglad === "sezon" && (
        <PodsumowanieSezonu podsumowanie={podsumowanieSezonu} czlonkowie={czlonkowie} walki={walki || []} />
      )}
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
        const procent = (g.obrazenia / max) * 100;
        const kolor = i === 0 ? "#ffd700" : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : "#888";
        return (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
            background: i < 3 ? `linear-gradient(90deg, ${kolor}11 0%, transparent 100%)` : "rgba(255,255,255,0.02)",
            borderLeft: `3px solid ${kolor}`, borderRadius: 6, marginBottom: 4,
            position: "relative", overflow: "hidden",
          }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${procent}%`, background: `${kolor}08`, zIndex: 0 }} />
            <span style={{ fontSize: 13, color: kolor, fontWeight: "bold", width: 24, zIndex: 1 }}>{i + 1}.</span>
            <span style={{ flex: 1, fontSize: 12, color: "#ddd", fontWeight: i < 3 ? "bold" : "normal", zIndex: 1 }}>
              {g.nazwa} <span style={{ fontSize: 10, color: "#666" }}>L{g.poziom}</span>
            </span>
            <span style={{ fontSize: 12, color: "#ffd700", minWidth: 70, textAlign: "right", zIndex: 1 }}>🔫 {fmt(g.obrazenia)}</span>
            <span style={{ fontSize: 12, color: "#87CEEB", minWidth: 40, textAlign: "right", zIndex: 1 }}>⚡ {g.tarcze}</span>
            {edytowalne && (
              <button onClick={() => onChange(gracze.filter((_, idx) => idx !== i))}
                style={{ padding: "2px 6px", background: "rgba(255,50,50,0.1)", border: "none", borderRadius: 3, color: "#f5544488", cursor: "pointer", fontSize: 10, zIndex: 1 }}>✕</button>
            )}
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

function PodsumowanieSezonu({ podsumowanie, czlonkowie, walki }) {
  if (!podsumowanie) {
    return (
      <div style={{ textAlign: "center", padding: 40, color: "#666" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🏆</div>
        <div style={{ fontSize: 13 }}>Brak walk do analizy</div>
      </div>
    );
  }

  const { wszyscy, ciekawostki, lacznaWalka } = podsumowanie;

  return (
    <div>
      <div style={{ background: "linear-gradient(135deg, rgba(255,215,0,0.1), rgba(184,134,11,0.1))", border: "1px solid #b8860b", borderRadius: 10, padding: 14, marginBottom: 14, textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: "bold", color: "#ffd700", marginBottom: 4 }}>🏆 Podsumowanie sezonu</div>
        <div style={{ fontSize: 12, color: "#aaa" }}>Analiza z {lacznaWalka} walk gangu</div>
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

      {/* Pełny ranking */}
      <div>
        <div style={{ fontSize: 13, fontWeight: "bold", color: "#ffd700", marginBottom: 8 }}>📊 Łączny ranking sezonu</div>
        {wszyscy.map((g, i) => {
          const kolor = i === 0 ? "#ffd700" : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : "#888";
          const sredniaObr = Math.round(g.obrazeniaLacznie / g.uczestnictwa);
          const sredniaTarcz = (g.tarczeLacznie / g.uczestnictwa).toFixed(1);
          return (
            <div key={i} style={{
              background: i < 3 ? `linear-gradient(90deg, ${kolor}15, transparent)` : "rgba(255,255,255,0.02)",
              border: "1px solid #2a2a3a", borderLeft: `3px solid ${kolor}`,
              borderRadius: 6, padding: 10, marginBottom: 4,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: kolor, fontWeight: "bold", width: 26 }}>{i + 1}.</span>
                <span style={{ flex: 1, fontSize: 12, color: "#ddd", fontWeight: i < 3 ? "bold" : "normal" }}>{g.nazwa}</span>
                <span style={{ fontSize: 11, color: "#666" }}>{g.uczestnictwa}/{lacznaWalka} walk</span>
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#aaa", flexWrap: "wrap", paddingLeft: 34 }}>
                <span>🔫 łącznie: <strong style={{ color: "#ffd700" }}>{formatLiczby(g.obrazeniaLacznie)}</strong></span>
                <span>średnio: {formatLiczby(sredniaObr)}</span>
                <span>⚡ tarcz: <strong style={{ color: "#87CEEB" }}>{g.tarczeLacznie}</strong></span>
                <span>śr. {sredniaTarcz}</span>
              </div>
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
    t += `${medal} ${g.nazwa} — 🔫 ${formatLiczby(g.obrazeniaLacznie)} | ⚡ ${g.tarczeLacznie} | ${g.uczestnictwa} walk\n`;
  });
  return t;
}
