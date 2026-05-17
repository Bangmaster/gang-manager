import { useState } from "react";
import { analyzeMultiple, matchTalia, matchKarta } from "./gemini";

// Komponent zakładki OCR (dla admina/zastępcy)
export default function OcrView({ talie, czlonkowie, posiadane, duplikaty, zapiszKarte }) {
  const [wybranaOsoba, setWybranaOsoba] = useState(czlonkowie[0]?.id || null);
  const [pliki, setPliki] = useState([]);
  const [analizujac, setAnalizujac] = useState(false);
  const [progress, setProgress] = useState({ aktualny: 0, total: 0, plik: "" });
  const [wyniki, setWyniki] = useState(null); // { wymianyDoZatwierdzenia, surowe }
  const [zapisywanie, setZapisywanie] = useState(false);

  const osoba = czlonkowie.find(c => c.id === wybranaOsoba);

  const handleFiles = (e) => {
    const fs = Array.from(e.target.files || []);
    setPliki(fs);
    setWyniki(null);
  };

  const analizuj = async () => {
    if (!osoba || pliki.length === 0) return;
    setAnalizujac(true);
    setProgress({ aktualny: 0, total: pliki.length, plik: "" });
    setWyniki(null);

    const rawWyniki = await analyzeMultiple(pliki, talie, (i, total, plik) => {
      setProgress({ aktualny: i, total, plik });
    });

    // Przetwórz wyniki na listę propozycji zmian
    const propozycje = []; // { taliaId, kartaNazwa, typ, ma, dup, pewnosc, fileName }
    const bledy = [];

    rawWyniki.forEach(w => {
      if (!w.sukces) {
        bledy.push({ fileName: w.fileName, blad: w.blad });
        return;
      }
      const talia = matchTalia(w, talie);
      if (!talia) {
        bledy.push({ fileName: w.fileName, blad: `Nie rozpoznano talii: ${w.dane.talia}` });
        return;
      }
      (w.dane.karty || []).forEach(k => {
        const karta = matchKarta(k.nazwa, talia);
        if (!karta) {
          // dodaj jako nieznaną, ale nie zatrzymuj
          return;
        }
        propozycje.push({
          taliaId: talia.id,
          taliaNazwa: talia.nazwa,
          kartaNazwa: karta.nazwa,
          typ: karta.typ,
          ma: !!k.posiadana,
          dup: Math.max(0, parseInt(k.duplikaty) || 0),
          pewnosc: k.pewnosc || "srednia",
          fileName: w.fileName,
        });
      });
    });

    setWyniki({ propozycje, bledy });
    setAnalizujac(false);
  };

  const togglePropozycja = (idx, pole) => {
    setWyniki(w => {
      const p = [...w.propozycje];
      if (pole === "ma") p[idx] = { ...p[idx], ma: !p[idx].ma };
      else if (pole === "dup") p[idx] = { ...p[idx], dup: p[idx].dup > 0 ? 0 : 1 };
      else if (pole === "odrzuc") p[idx] = { ...p[idx], odrzucona: !p[idx].odrzucona };
      return { ...w, propozycje: p };
    });
  };

  const zatwierdz = async () => {
    if (!wyniki || !osoba) return;
    setZapisywanie(true);
    let zapisane = 0;
    for (const p of wyniki.propozycje) {
      if (p.odrzucona) continue;
      const key = `${osoba.id}_${p.taliaId}_${p.kartaNazwa}`;
      // Posiadanie
      if (p.ma) {
        await zapiszKarte("posiadane", key, true);
      } else {
        await zapiszKarte("posiadane", key, null);
        await zapiszKarte("duplikaty", key, null);
      }
      // Duplikat
      if (p.ma && p.dup > 0) {
        await zapiszKarte("duplikaty", key, true);
      } else if (p.ma && p.dup === 0) {
        await zapiszKarte("duplikaty", key, null);
      }
      zapisane++;
      await new Promise(r => setTimeout(r, 30)); // małe opóźnienie żeby nie przeciążyć Firebase
    }
    setZapisywanie(false);
    setWyniki(null);
    setPliki([]);
    alert(`✓ Zapisano ${zapisane} zmian dla osoby ${osoba.nazwa}`);
  };

  const liczbaNiepewnych = wyniki?.propozycje.filter(p => p.pewnosc === "niska" || p.pewnosc === "srednia").length || 0;
  const liczbaDoZapisu = wyniki?.propozycje.filter(p => !p.odrzucona).length || 0;

  return (
    <div>
      <div style={{ background: "rgba(255,215,0,0.06)", border: "1px solid #b8860b33", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#ffd700" }}>
        📸 <strong>Tryb OCR (Gemini Vision)</strong> — wgraj screeny talii osoby, AI rozpozna karty automatycznie
        <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>Każdy screen = jedna talia. Możesz wgrać od 1 do 14 screenów naraz dla wybranej osoby.</div>
      </div>

      {/* Wybór osoby */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: "#aaa", marginBottom: 6 }}>Wybierz osobę dla której wgrywasz screeny:</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {czlonkowie.map(c => (
            <button key={c.id} onClick={() => setWybranaOsoba(c.id)} style={{
              padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12,
              background: wybranaOsoba === c.id ? "linear-gradient(135deg,#b8860b,#ffd700)" : "rgba(255,255,255,0.06)",
              border: wybranaOsoba === c.id ? "none" : "1px solid #2a2a3a",
              color: wybranaOsoba === c.id ? "#000" : "#aaa",
              fontWeight: wybranaOsoba === c.id ? "bold" : "normal",
            }}>{c.nazwa}</button>
          ))}
        </div>
      </div>

      {/* Wybór plików */}
      <div style={{ background: "rgba(0,0,0,0.25)", border: "1px solid #2a2a3a", borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: "bold", color: "#ffd700", marginBottom: 8 }}>📁 Wybierz screeny talii</div>
        <input type="file" accept="image/*" multiple onChange={handleFiles}
          style={{ width: "100%", padding: 8, background: "#12122a", border: "1px solid #333", borderRadius: 6, color: "#fff", fontSize: 12, marginBottom: 10 }} />
        {pliki.length > 0 && (
          <div style={{ fontSize: 12, color: "#0c6", marginBottom: 10 }}>
            Wybrano {pliki.length} {pliki.length === 1 ? "plik" : "plików"}: {pliki.map(p => p.name).join(", ")}
          </div>
        )}
        <button onClick={analizuj} disabled={!osoba || pliki.length === 0 || analizujac}
          style={{
            width: "100%", padding: 12,
            background: !osoba || pliki.length === 0 || analizujac ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,#b8860b,#ffd700)",
            border: "none", borderRadius: 8, color: !osoba || pliki.length === 0 || analizujac ? "#666" : "#000",
            fontSize: 14, fontWeight: "bold", cursor: !osoba || pliki.length === 0 || analizujac ? "not-allowed" : "pointer",
            letterSpacing: 1,
          }}>
          {analizujac ? `⏳ Analizuję ${progress.aktualny}/${progress.total}...` : `🤖 Analizuj ${pliki.length} screen${pliki.length === 1 ? "" : "ów"} dla ${osoba?.nazwa || "?"}`}
        </button>
        {analizujac && (
          <div style={{ marginTop: 10 }}>
            <div style={{ height: 6, background: "#12122a", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(progress.aktualny / Math.max(1, progress.total)) * 100}%`, background: "linear-gradient(90deg,#b8860b,#ffd700)", transition: "width 0.3s" }} />
            </div>
            <div style={{ fontSize: 11, color: "#aaa", marginTop: 4, textAlign: "center" }}>{progress.plik}</div>
          </div>
        )}
      </div>

      {/* Wyniki */}
      {wyniki && (
        <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid #2a2a3a", borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: "bold", color: "#ffd700" }}>📋 Podgląd rozpoznanych kart dla {osoba?.nazwa}</div>
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>
                {wyniki.propozycje.length} kart rozpoznanych
                {liczbaNiepewnych > 0 && <span style={{ color: "#fa0" }}> · {liczbaNiepewnych} wymaga weryfikacji</span>}
              </div>
            </div>
            <button onClick={zatwierdz} disabled={zapisywanie}
              style={{
                padding: "10px 20px", background: zapisywanie ? "rgba(255,255,255,0.1)" : "linear-gradient(135deg,#0c6,#0fa)",
                border: "none", borderRadius: 8, color: zapisywanie ? "#666" : "#000",
                fontSize: 13, fontWeight: "bold", cursor: zapisywanie ? "not-allowed" : "pointer",
              }}>
              {zapisywanie ? "⏳ Zapisywanie..." : `✓ Zatwierdź i zapisz (${liczbaDoZapisu})`}
            </button>
          </div>

          {/* Błędy */}
          {wyniki.bledy.length > 0 && (
            <div style={{ background: "rgba(255,50,50,0.08)", border: "1px solid #f5544455", borderRadius: 8, padding: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: "bold", color: "#f55", marginBottom: 4 }}>⚠️ Błędy analizy ({wyniki.bledy.length})</div>
              {wyniki.bledy.map((b, i) => (
                <div key={i} style={{ fontSize: 11, color: "#aaa" }}>{b.fileName}: {b.blad}</div>
              ))}
            </div>
          )}

          {/* Grupuj wg talii */}
          {Array.from(new Set(wyniki.propozycje.map(p => p.taliaId))).map(taliaId => {
            const talia = talie.find(t => t.id === taliaId);
            const kartyTalii = wyniki.propozycje.map((p, i) => ({ ...p, idx: i })).filter(p => p.taliaId === taliaId);
            return (
              <div key={taliaId} style={{ marginBottom: 12, background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: 10 }}>
                <div style={{ fontWeight: "bold", color: "#ffd700", fontSize: 13, marginBottom: 8 }}>
                  #{talia?.numer} {talia?.nazwa || taliaId}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {kartyTalii.map(p => {
                    const kolorPewnosc = p.pewnosc === "wysoka" ? "#0c6" : p.pewnosc === "srednia" ? "#fa0" : "#f55";
                    const ikonaPewnosc = p.pewnosc === "wysoka" ? "✓" : p.pewnosc === "srednia" ? "⚠️" : "❓";
                    return (
                      <div key={p.idx} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "5px 8px",
                        background: p.odrzucona ? "rgba(255,50,50,0.05)" : "rgba(0,0,0,0.2)",
                        borderRadius: 6,
                        opacity: p.odrzucona ? 0.5 : 1,
                        borderLeft: `3px solid ${kolorPewnosc}`,
                      }}>
                        <span style={{ fontSize: 11, color: kolorPewnosc }} title={p.pewnosc}>{ikonaPewnosc}</span>
                        <span style={{ flex: 1, fontSize: 12, color: "#ddd", textDecoration: p.odrzucona ? "line-through" : "none" }}>
                          {p.kartaNazwa}
                          <span style={{ fontSize: 10, color: p.typ === "złota" ? "#ffd700" : "#87CEEB", marginLeft: 6 }}>
                            {p.typ === "złota" ? "⭐" : "💎"}
                          </span>
                        </span>
                        <button onClick={() => togglePropozycja(p.idx, "ma")} style={{
                          padding: "3px 8px", fontSize: 11, borderRadius: 4, cursor: "pointer",
                          background: p.ma ? "linear-gradient(135deg,#b8860b,#ffd700)" : "rgba(255,255,255,0.08)",
                          border: p.ma ? "none" : "1px solid #333",
                          color: p.ma ? "#000" : "#888", fontWeight: p.ma ? "bold" : "normal",
                        }}>{p.ma ? "✓ Ma" : "Nie ma"}</button>
                        {p.ma && (
                          <button onClick={() => togglePropozycja(p.idx, "dup")} style={{
                            padding: "3px 8px", fontSize: 11, borderRadius: 4, cursor: "pointer",
                            background: p.dup > 0 ? "linear-gradient(135deg,#4169E1,#87CEEB)" : "rgba(65,105,225,0.1)",
                            border: p.dup > 0 ? "none" : "1px dashed #4169E155",
                            color: p.dup > 0 ? "#fff" : "#4169E1",
                          }}>{p.dup > 0 ? `💎+${p.dup}` : "+dup"}</button>
                        )}
                        <button onClick={() => togglePropozycja(p.idx, "odrzuc")} style={{
                          padding: "3px 6px", fontSize: 10, borderRadius: 4, cursor: "pointer",
                          background: p.odrzucona ? "rgba(0,200,100,0.15)" : "rgba(255,50,50,0.1)",
                          border: p.odrzucona ? "1px solid #0c6" : "1px solid #f5544455",
                          color: p.odrzucona ? "#0c6" : "#f55",
                        }}>{p.odrzucona ? "↩" : "✕"}</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div style={{ marginTop: 12, padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 6, fontSize: 11, color: "#888" }}>
            💡 Sprawdź wyniki, popraw jeśli AI się pomyliła (kliknij "Ma" / "Nie ma" / "+dup" / ✕ żeby odrzucić). Kolor po lewej oznacza pewność: 🟢 wysoka, 🟡 średnia, 🔴 niska. Po sprawdzeniu kliknij "Zatwierdź i zapisz".
          </div>
        </div>
      )}
    </div>
  );
}
