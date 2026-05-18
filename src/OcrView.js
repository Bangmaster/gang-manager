import { useState, useEffect } from "react";
import { analyzeMultiple, matchTalia, matchKarta } from "./gemini";

// Komponent zakładki OCR (dla admina/zastępcy)
export default function OcrView({ talie, czlonkowie, posiadane, duplikaty, zapiszKarte }) {
  const [wybranaOsoba, setWybranaOsoba] = useState(czlonkowie[0]?.id || null);
  const [pliki, setPliki] = useState([]);
  const [analizujac, setAnalizujac] = useState(false);
  const [progress, setProgress] = useState({ aktualny: 0, total: 0, plik: "" });
  const [wyniki, setWyniki] = useState(null);
  const [zapisywanie, setZapisywanie] = useState(false);
  // Cooldown timer — pozwala wgrać kolejną partię dopiero po X sekundach
  const [cooldownDo, setCooldownDo] = useState(null); // timestamp
  const [pozostalo, setPozostalo] = useState(0);
  const [cooldownAktywowanyZBleduLimitu, setCooldownAktywowanyZBleduLimitu] = useState(false);

  // Aktualizuj licznik co sekundę
  useEffect(() => {
    if (!cooldownDo) return;
    const interval = setInterval(() => {
      const sek = Math.max(0, Math.ceil((cooldownDo - Date.now()) / 1000));
      setPozostalo(sek);
      if (sek === 0) {
        setCooldownDo(null);
        setCooldownAktywowanyZBleduLimitu(false);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [cooldownDo]);

  const formatCzas = (sek) => {
    const m = Math.floor(sek / 60);
    const s = sek % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

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
        const key = `${wybranaOsoba}_${talia.id}_${karta.nazwa}`;
        const poprzednioMial = !!posiadane[key];
        const poprzednioDup = !!duplikaty[key];
        const ma = !!k.posiadana;
        // Duplikaty: tylko 0 lub 1 — wystarczy wiedzieć czy ma duplikat
        const dup = (parseInt(k.duplikaty) || 0) >= 1 ? 1 : 0;
        propozycje.push({
          taliaId: talia.id,
          taliaNazwa: talia.nazwa,
          kartaNazwa: karta.nazwa,
          typ: karta.typ,
          ma,
          dup,
          pewnosc: k.pewnosc || "srednia",
          fileName: w.fileName,
          // Status zmiany:
          zmiana: !poprzednioMial && ma ? "nowa"
                : poprzednioMial && !ma ? "usunieta"
                : poprzednioMial && ma && !poprzednioDup && dup > 0 ? "nowy_duplikat"
                : poprzednioMial && ma && poprzednioDup && dup === 0 ? "usuniety_duplikat"
                : "bez_zmian",
        });
      });
    });

    setWyniki({ propozycje, bledy });
    setAnalizujac(false);

    // Cooldown tylko po błędzie limitu
    const wystapilBladLimitu = bledy.some(b => b.blad?.includes("limit") || b.blad?.includes("⏳") || b.blad?.includes("⏰"));
    if (wystapilBladLimitu) {
      setCooldownAktywowanyZBleduLimitu(true);
      setCooldownDo(Date.now() + 10 * 60 * 1000);
    }
    // Bez cooldownu przy normalnym zakończeniu — 3 klucze rotacyjne wystarczają
  };

  const togglePropozycja = (idx, pole) => {
    setWyniki(w => {
      const p = [...w.propozycje];
      let item = { ...p[idx] };
      if (pole === "ma") item.ma = !item.ma;
      else if (pole === "dup") item.dup = item.dup > 0 ? 0 : 1;
      else if (pole === "odrzuc") item.odrzucona = !item.odrzucona;
      // Przelicz status zmiany na podstawie aktualnych wartości i poprzedniego stanu w bazie
      const key = `${wybranaOsoba}_${item.taliaId}_${item.kartaNazwa}`;
      const poprzednioMial = !!posiadane[key];
      const poprzednioDup = !!duplikaty[key];
      item.zmiana = !poprzednioMial && item.ma ? "nowa"
                  : poprzednioMial && !item.ma ? "usunieta"
                  : poprzednioMial && item.ma && !poprzednioDup && item.dup > 0 ? "nowy_duplikat"
                  : poprzednioMial && item.ma && poprzednioDup && item.dup === 0 ? "usuniety_duplikat"
                  : "bez_zmian";
      p[idx] = item;
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
        📸 <strong>Tryb OCR (Gemini 2.5 Flash-Lite)</strong> — wgraj screeny talii osoby, AI rozpozna karty automatycznie
        <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>Każdy screen = jedna talia. Możesz wgrać 1-14 screenów dla osoby.</div>
        <div style={{ fontSize: 10, color: "#888", marginTop: 4, lineHeight: 1.5 }}>
          ⚙️ Każdy screen analizowany osobno — pełna dokładność.<br/>
          🔑 Klucze API rotują między screenami — krótsze przerwy przy 2-3 kluczach.<br/>
          💡 Po błędzie limitu apka automatycznie zmienia klucz i ponawia.
        </div>
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
        <button onClick={analizuj} disabled={!osoba || pliki.length === 0 || analizujac || pozostalo > 0}
          style={{
            width: "100%", padding: 12,
            background: !osoba || pliki.length === 0 || analizujac || pozostalo > 0 ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,#b8860b,#ffd700)",
            border: "none", borderRadius: 8, color: !osoba || pliki.length === 0 || analizujac || pozostalo > 0 ? "#666" : "#000",
            fontSize: 14, fontWeight: "bold", cursor: !osoba || pliki.length === 0 || analizujac || pozostalo > 0 ? "not-allowed" : "pointer",
            letterSpacing: 1,
          }}>
          {analizujac ? `⏳ Analizuję ${progress.aktualny}/${progress.total}...`
            : pozostalo > 0 ? `⏱️ Cooldown ${formatCzas(pozostalo)} — czekaj`
            : `🤖 Analizuj ${pliki.length} screen${pliki.length === 1 ? "" : "ów"} dla ${osoba?.nazwa || "?"}`}
        </button>

        {/* Cooldown timer panel */}
        {pozostalo > 0 && !analizujac && (
          <div style={{
            marginTop: 10,
            background: cooldownAktywowanyZBleduLimitu ? "rgba(255,50,50,0.08)" : "rgba(255,165,0,0.08)",
            border: cooldownAktywowanyZBleduLimitu ? "1px solid #f5544455" : "1px solid #fa050",
            borderRadius: 8, padding: 12,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: "bold", color: cooldownAktywowanyZBleduLimitu ? "#f55" : "#fa0" }}>
                {cooldownAktywowanyZBleduLimitu ? "🚫 Limit Google przekroczony" : "⏱️ Cooldown między partiami"}
              </div>
              <div style={{ fontSize: 18, fontWeight: "bold", color: cooldownAktywowanyZBleduLimitu ? "#f55" : "#ffd700", fontFamily: "monospace" }}>
                {formatCzas(pozostalo)}
              </div>
            </div>
            <div style={{ height: 6, background: "#12122a", borderRadius: 3, overflow: "hidden", marginBottom: 6 }}>
              <div style={{
                height: "100%",
                width: `${(pozostalo / ((cooldownAktywowanyZBleduLimitu ? 600 : 300))) * 100}%`,
                background: cooldownAktywowanyZBleduLimitu ? "linear-gradient(90deg,#f55,#fa0)" : "linear-gradient(90deg,#fa0,#ffd700)",
                transition: "width 1s linear",
              }} />
            </div>
            <div style={{ fontSize: 10, color: "#888" }}>
              {cooldownAktywowanyZBleduLimitu
                ? "Google nałożył dłuższy cool-down. Po czasie spróbuj wgrać kolejną partię."
                : "Po czasie możesz wgrywać kolejnych graczy. Możesz też pominąć cooldown przyciskiem poniżej (na własne ryzyko)."}
            </div>
            {!cooldownAktywowanyZBleduLimitu && (
              <button onClick={() => { setCooldownDo(null); setPozostalo(0); }}
                style={{ marginTop: 8, padding: "4px 10px", background: "rgba(255,255,255,0.05)", border: "1px solid #444", borderRadius: 5, color: "#888", cursor: "pointer", fontSize: 10 }}>
                ⚠️ Pomiń cooldown
              </button>
            )}
          </div>
        )}

        {analizujac && (
          <div style={{ marginTop: 10 }}>
            <div style={{ height: 8, background: "#12122a", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(progress.aktualny / Math.max(1, progress.total)) * 100}%`, background: "linear-gradient(90deg,#b8860b,#ffd700)", transition: "width 0.3s" }} />
            </div>
            <div style={{ fontSize: 11, color: "#aaa", marginTop: 6, textAlign: "center" }}>
              📸 Screen {progress.aktualny + 1}/{progress.total}: <strong style={{ color: "#ffd700" }}>{progress.plik}</strong>
            </div>
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

          {/* Podsumowanie zmian */}
          {(() => {
            const aktywne = wyniki.propozycje.filter(p => !p.odrzucona);
            const nowe = aktywne.filter(p => p.zmiana === "nowa");
            const noweDup = aktywne.filter(p => p.zmiana === "nowy_duplikat");
            const usuniete = aktywne.filter(p => p.zmiana === "usunieta");
            const usunieteDup = aktywne.filter(p => p.zmiana === "usuniety_duplikat");
            const bezZmian = aktywne.filter(p => p.zmiana === "bez_zmian").length;
            const lacznieZmian = nowe.length + noweDup.length + usuniete.length + usunieteDup.length;

            if (lacznieZmian === 0) {
              return (
                <div style={{ background: "rgba(100,180,255,0.06)", border: "1px solid #6af55", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#6af" }}>
                  ℹ️ Brak nowych zmian — {bezZmian} kart bez zmian względem aktualnego stanu w bazie
                </div>
              );
            }

            return (
              <div style={{ background: "rgba(0,200,100,0.06)", border: "1px solid #0c655", borderRadius: 8, padding: "10px 14px", marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: "bold", color: "#0c6", marginBottom: 8 }}>
                  📊 Wykryto {lacznieZmian} {lacznieZmian === 1 ? "zmianę" : "zmian"} względem bazy:
                </div>

                {nowe.length > 0 && (
                  <details style={{ marginBottom: 6 }}>
                    <summary style={{ fontSize: 12, color: "#0c6", cursor: "pointer", padding: "2px 0" }}>
                      🆕 <strong>{nowe.length}</strong> {nowe.length === 1 ? "nowa karta" : nowe.length < 5 ? "nowe karty" : "nowych kart"}
                    </summary>
                    <div style={{ paddingLeft: 16, marginTop: 4 }}>
                      {Object.entries(nowe.reduce((acc, p) => {
                        if (!acc[p.taliaNazwa]) acc[p.taliaNazwa] = [];
                        acc[p.taliaNazwa].push(p);
                        return acc;
                      }, {})).map(([talia, karty]) => (
                        <div key={talia} style={{ fontSize: 11, color: "#bbb", marginBottom: 2 }}>
                          <span style={{ color: "#888" }}>{talia}:</span>{" "}
                          {karty.map((p, i) => (
                            <span key={i}>
                              {i > 0 && ", "}
                              <span style={{ color: p.typ === "złota" ? "#ffd700" : "#87CEEB" }}>
                                {p.typ === "złota" ? "⭐" : "💎"} {p.kartaNazwa}
                              </span>
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {noweDup.length > 0 && (
                  <details style={{ marginBottom: 6 }}>
                    <summary style={{ fontSize: 12, color: "#4169E1", cursor: "pointer", padding: "2px 0" }}>
                      💎 <strong>{noweDup.length}</strong> {noweDup.length === 1 ? "nowy duplikat" : "nowych duplikatów"}
                    </summary>
                    <div style={{ paddingLeft: 16, marginTop: 4 }}>
                      {Object.entries(noweDup.reduce((acc, p) => {
                        if (!acc[p.taliaNazwa]) acc[p.taliaNazwa] = [];
                        acc[p.taliaNazwa].push(p);
                        return acc;
                      }, {})).map(([talia, karty]) => (
                        <div key={talia} style={{ fontSize: 11, color: "#bbb", marginBottom: 2 }}>
                          <span style={{ color: "#888" }}>{talia}:</span>{" "}
                          {karty.map((p, i) => (
                            <span key={i}>
                              {i > 0 && ", "}
                              <span style={{ color: "#87CEEB" }}>{p.kartaNazwa}</span>
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {(usuniete.length > 0 || usunieteDup.length > 0) && (
                  <details style={{ marginBottom: 6 }}>
                    <summary style={{ fontSize: 12, color: "#fa0", cursor: "pointer", padding: "2px 0" }}>
                      ⚠️ <strong>{usuniete.length + usunieteDup.length}</strong> kart oznaczonych jako utracone
                    </summary>
                    <div style={{ paddingLeft: 16, marginTop: 4, fontSize: 11, color: "#aaa" }}>
                      {usuniete.length > 0 && <div>Karty: {usuniete.map(p => `${p.kartaNazwa} [${p.taliaNazwa}]`).join(", ")}</div>}
                      {usunieteDup.length > 0 && <div>Duplikaty: {usunieteDup.map(p => `${p.kartaNazwa} [${p.taliaNazwa}]`).join(", ")}</div>}
                      <div style={{ marginTop: 4, color: "#888", fontStyle: "italic" }}>(Sprawdź — może AI źle rozpoznała, a karta jednak jest)</div>
                    </div>
                  </details>
                )}

                <div style={{ fontSize: 11, color: "#666", marginTop: 4, paddingTop: 6, borderTop: "1px solid #0c633" }}>
                  Bez zmian: {bezZmian} kart
                </div>
              </div>
            );
          })()}

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
            const zmianWTalii = kartyTalii.filter(p => !p.odrzucona && p.zmiana !== "bez_zmian").length;
            return (
              <div key={taliaId} style={{ marginBottom: 12, background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: 10 }}>
                <div style={{ fontWeight: "bold", color: "#ffd700", fontSize: 13, marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>#{talia?.numer} {talia?.nazwa || taliaId}</span>
                  {zmianWTalii > 0 && (
                    <span style={{ fontSize: 10, padding: "2px 7px", background: "rgba(0,200,100,0.15)", border: "1px solid #0c655", borderRadius: 10, color: "#0c6", fontWeight: "bold" }}>
                      {zmianWTalii} {zmianWTalii === 1 ? "zmiana" : "zmian"}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {kartyTalii.map(p => {
                    const kolorPewnosc = p.pewnosc === "wysoka" ? "#0c6" : p.pewnosc === "srednia" ? "#fa0" : "#f55";
                    const ikonaPewnosc = p.pewnosc === "wysoka" ? "✓" : p.pewnosc === "srednia" ? "⚠️" : "❓";
                    const badgeZmiany = p.odrzucona ? null
                      : p.zmiana === "nowa" ? { tekst: "🆕 NOWA", kolor: "#0c6", bg: "rgba(0,200,100,0.15)" }
                      : p.zmiana === "usunieta" ? { tekst: "⚠️ utracona", kolor: "#fa0", bg: "rgba(255,165,0,0.12)" }
                      : p.zmiana === "nowy_duplikat" ? { tekst: "💎 nowy dup", kolor: "#4169E1", bg: "rgba(65,105,225,0.15)" }
                      : p.zmiana === "usuniety_duplikat" ? { tekst: "dup utracony", kolor: "#aaa", bg: "rgba(255,255,255,0.05)" }
                      : null;
                    return (
                      <div key={p.idx} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "5px 8px",
                        background: p.odrzucona ? "rgba(255,50,50,0.05)" : p.zmiana === "nowa" ? "rgba(0,200,100,0.06)" : "rgba(0,0,0,0.2)",
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
                          {badgeZmiany && (
                            <span style={{ fontSize: 9, padding: "1px 6px", background: badgeZmiany.bg, border: `1px solid ${badgeZmiany.kolor}55`, borderRadius: 8, color: badgeZmiany.kolor, marginLeft: 6, fontWeight: "bold" }}>
                              {badgeZmiany.tekst}
                            </span>
                          )}
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
