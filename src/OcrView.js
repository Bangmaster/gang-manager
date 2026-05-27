import { useState, useEffect } from "react";
import { analyzeMultiple, matchTalia, matchKarta } from "./gemini";

// ============================================================
// TRYB MASOWY — zbierasz screeny dla wielu osób, analizujesz
// wszystko jednym kliknięciem
// ============================================================

export default function OcrView({ talie, czlonkowie, posiadane, duplikaty, zapiszKarte }) {
  // Tryb: "pojedynczy" lub "masowy"
  const [tryb, setTryb] = useState("masowy");

  // === TRYB MASOWY ===
  // kolejka: [{ osobaId, pliki: File[] }]
  const [kolejka, setKolejka] = useState([]);
  const [wybranaOsobaMasowa, setWybranaOsobaMasowa] = useState(czlonkowie[0]?.id || null);

  // === TRYB POJEDYNCZY (stary) ===
  const [wybranaOsoba, setWybranaOsoba] = useState(czlonkowie[0]?.id || null);
  const [pliki, setPliki] = useState([]);

  // === WSPÓLNE ===
  const [analizujac, setAnalizujac] = useState(false);
  const [progress, setProgress] = useState({ aktualny: 0, total: 0, plik: "", osobaNazwa: "" });
  const [wyniki, setWyniki] = useState(null); // { osobaId, propozycje, bledy }[]
  const [aktywnyWynikIdx, setAktywnyWynikIdx] = useState(0);
  const [zapisywanie, setZapisywanie] = useState(false);
  const [zapisaneOsoby, setZapisaneOsoby] = useState([]); // id osób już zapisanych

  const [cooldownDo, setCooldownDo] = useState(null);
  const [pozostalo, setPozostalo] = useState(0);
  const [cooldownAktywowanyZBleduLimitu, setCooldownAktywowanyZBleduLimitu] = useState(false);

  useEffect(() => {
    if (!cooldownDo) return;
    const interval = setInterval(() => {
      const sek = Math.max(0, Math.ceil((cooldownDo - Date.now()) / 1000));
      setPozostalo(sek);
      if (sek === 0) { setCooldownDo(null); setCooldownAktywowanyZBleduLimitu(false); }
    }, 500);
    return () => clearInterval(interval);
  }, [cooldownDo]);

  const formatCzas = (sek) => {
    const m = Math.floor(sek / 60);
    const s = sek % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // ============================================================
  // MASOWY — dodaj pliki dla osoby do kolejki
  // ============================================================
  const dodajDoKolejki = (e) => {
    const fs = Array.from(e.target.files || []);
    if (!wybranaOsobaMasowa || fs.length === 0) return;
    e.target.value = ""; // reset inputu żeby można było dodać tę samą osobę ponownie

    setKolejka(prev => {
      const existing = prev.findIndex(q => q.osobaId === wybranaOsobaMasowa);
      if (existing >= 0) {
        // Dodaj pliki do istniejącej pozycji (nie nadpisuj)
        const updated = [...prev];
        updated[existing] = {
          ...updated[existing],
          pliki: [...updated[existing].pliki, ...fs],
        };
        return updated;
      } else {
        return [...prev, { osobaId: wybranaOsobaMasowa, pliki: fs }];
      }
    });
  };

  const usunZKolejki = (osobaId) => {
    setKolejka(prev => prev.filter(q => q.osobaId !== osobaId));
  };

  const usunPlikZKolejki = (osobaId, plikIdx) => {
    setKolejka(prev => prev.map(q => {
      if (q.osobaId !== osobaId) return q;
      const nowyPliki = q.pliki.filter((_, i) => i !== plikIdx);
      return nowyPliki.length > 0 ? { ...q, pliki: nowyPliki } : null;
    }).filter(Boolean));
  };

  const laczbnaScreenow = kolejka.reduce((s, q) => s + q.pliki.length, 0);

  // ============================================================
  // PRZETWÓRZ wyniki surowe na propozycje dla danej osoby
  // ============================================================
  const przetworz = (rawWyniki, osobaId) => {
    const propozycje = [];
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
        if (!karta) return;
        const key = `${osobaId}_${talia.id}_${karta.nazwa}`;
        const poprzednioMial = !!posiadane[key];
        const poprzednioDup = !!duplikaty[key];
        const ma = !!k.posiadana;
        const dup = (parseInt(k.duplikaty) || 0) >= 1 ? 1 : 0;
        propozycje.push({
          taliaId: talia.id,
          taliaNazwa: talia.nazwa,
          kartaNazwa: karta.nazwa,
          typ: karta.typ,
          ma, dup,
          pewnosc: k.pewnosc || "srednia",
          fileName: w.fileName,
          zmiana: !poprzednioMial && ma ? "nowa"
                : poprzednioMial && !ma ? "usunieta"
                : poprzednioMial && ma && !poprzednioDup && dup > 0 ? "nowy_duplikat"
                : poprzednioMial && ma && poprzednioDup && dup === 0 ? "usuniety_duplikat"
                : "bez_zmian",
        });
      });
    });

    return { propozycje, bledy };
  };

  // ============================================================
  // ANALIZUJ MASOWO
  // ============================================================
  const analizujMasowo = async () => {
    if (kolejka.length === 0) return;
    setAnalizujac(true);
    setWyniki(null);
    setZapisaneOsoby([]);
    setAktywnyWynikIdx(0);

    const wszystkieWyniki = [];
    let globalnyNr = 0;
    const globalnyTotal = laczbnaScreenow;

    for (const pozycja of kolejka) {
      const osoba = czlonkowie.find(c => c.id === pozycja.osobaId);
      const rawWyniki = await analyzeMultiple(
        pozycja.pliki,
        talie,
        (i, total, plik) => {
          setProgress({
            aktualny: globalnyNr + i,
            total: globalnyTotal,
            plik,
            osobaNazwa: osoba?.nazwa || "?",
          });
        }
      );
      globalnyNr += pozycja.pliki.length;

      const { propozycje, bledy } = przetworz(rawWyniki, pozycja.osobaId);
      wszystkieWyniki.push({ osobaId: pozycja.osobaId, propozycje, bledy });

      // Sprawdź limit
      const bladLimitu = bledy.some(b => b.blad?.includes("⏳") || b.blad?.includes("limit"));
      if (bladLimitu) {
        setCooldownAktywowanyZBleduLimitu(true);
        setCooldownDo(Date.now() + 10 * 60 * 1000);
        // Nie przerywaj — kontynuuj dla reszty osób
      }
    }

    setWyniki(wszystkieWyniki);
    setAnalizujac(false);
  };

  // ============================================================
  // ANALIZUJ POJEDYNCZO (stary tryb)
  // ============================================================
  const analizujPojedynczo = async () => {
    const osoba = czlonkowie.find(c => c.id === wybranaOsoba);
    if (!osoba || pliki.length === 0) return;
    setAnalizujac(true);
    setProgress({ aktualny: 0, total: pliki.length, plik: "", osobaNazwa: osoba.nazwa });
    setWyniki(null);
    setZapisaneOsoby([]);
    setAktywnyWynikIdx(0);

    const rawWyniki = await analyzeMultiple(pliki, talie, (i, total, plik) => {
      setProgress({ aktualny: i, total, plik, osobaNazwa: osoba.nazwa });
    });

    const { propozycje, bledy } = przetworz(rawWyniki, wybranaOsoba);
    setWyniki([{ osobaId: wybranaOsoba, propozycje, bledy }]);
    setAnalizujac(false);

    const bladLimitu = bledy.some(b => b.blad?.includes("limit") || b.blad?.includes("⏳"));
    if (bladLimitu) {
      setCooldownAktywowanyZBleduLimitu(true);
      setCooldownDo(Date.now() + 10 * 60 * 1000);
    }
  };

  // ============================================================
  // TOGGLE propozycji w wynikach
  // ============================================================
  const togglePropozycja = (wynikIdx, propIdx, pole) => {
    setWyniki(prev => {
      const nowe = prev.map((w, wi) => {
        if (wi !== wynikIdx) return w;
        const p = w.propozycje.map((item, pi) => {
          if (pi !== propIdx) return item;
          let updated = { ...item };
          if (pole === "ma") updated.ma = !updated.ma;
          else if (pole === "dup") updated.dup = updated.dup > 0 ? 0 : 1;
          else if (pole === "odrzuc") updated.odrzucona = !updated.odrzucona;
          // Przelicz zmianę
          const key = `${w.osobaId}_${updated.taliaId}_${updated.kartaNazwa}`;
          const poprzednioMial = !!posiadane[key];
          const poprzednioDup = !!duplikaty[key];
          updated.zmiana = !poprzednioMial && updated.ma ? "nowa"
            : poprzednioMial && !updated.ma ? "usunieta"
            : poprzednioMial && updated.ma && !poprzednioDup && updated.dup > 0 ? "nowy_duplikat"
            : poprzednioMial && updated.ma && poprzednioDup && updated.dup === 0 ? "usuniety_duplikat"
            : "bez_zmian";
          return updated;
        });
        return { ...w, propozycje: p };
      });
      return nowe;
    });
  };

  // ============================================================
  // ZATWIERDŹ dla jednej osoby
  // ============================================================
  const zatwierdzOsobe = async (wynikIdx) => {
    if (!wyniki?.[wynikIdx]) return;
    const w = wyniki[wynikIdx];
    const osoba = czlonkowie.find(c => c.id === w.osobaId);
    setZapisywanie(true);
    let zapisane = 0;

    for (const p of w.propozycje) {
      if (p.odrzucona) continue;
      const key = `${w.osobaId}_${p.taliaId}_${p.kartaNazwa}`;
      if (p.ma) {
        await zapiszKarte("posiadane", key, true);
      } else {
        await zapiszKarte("posiadane", key, null);
        await zapiszKarte("duplikaty", key, null);
      }
      if (p.ma && p.dup > 0) {
        await zapiszKarte("duplikaty", key, true);
      } else if (p.ma && p.dup === 0) {
        await zapiszKarte("duplikaty", key, null);
      }
      zapisane++;
      await new Promise(r => setTimeout(r, 30));
    }

    setZapisane(osoba?.id);
    setZapisywanie(false);

    // Przejdź do następnej niezapisanej osoby
    const nastepny = wyniki.findIndex((_, i) => i > wynikIdx && !zapisaneOsoby.includes(wyniki[i]?.osobaId));
    if (nastepny >= 0) setAktywnyWynikIdx(nastepny);
    else if (wynikIdx < wyniki.length - 1) setAktywnyWynikIdx(wynikIdx + 1);

    alert(`✓ Zapisano ${zapisane} zmian dla ${osoba?.nazwa}`);
  };

  const setZapisane = (osobaId) => {
    setZapisaneOsoby(prev => [...new Set([...prev, osobaId])]);
  };

  // ============================================================
  // ZATWIERDŹ WSZYSTKICH naraz
  // ============================================================
  const zatwierdzWszystkich = async () => {
    if (!wyniki) return;
    setZapisywanie(true);
    let lacznieZapisane = 0;
    const podsumowanie = [];

    for (const w of wyniki) {
      if (zapisaneOsoby.includes(w.osobaId)) continue;
      const osoba = czlonkowie.find(c => c.id === w.osobaId);
      let zapisane = 0;
      for (const p of w.propozycje) {
        if (p.odrzucona) continue;
        const key = `${w.osobaId}_${p.taliaId}_${p.kartaNazwa}`;
        if (p.ma) {
          await zapiszKarte("posiadane", key, true);
        } else {
          await zapiszKarte("posiadane", key, null);
          await zapiszKarte("duplikaty", key, null);
        }
        if (p.ma && p.dup > 0) {
          await zapiszKarte("duplikaty", key, true);
        } else if (p.ma && p.dup === 0) {
          await zapiszKarte("duplikaty", key, null);
        }
        zapisane++;
        await new Promise(r => setTimeout(r, 30));
      }
      lacznieZapisane += zapisane;
      podsumowanie.push(`${osoba?.nazwa}: ${zapisane}`);
      setZapisane(w.osobaId);
    }

    setZapisywanie(false);
    alert(`✅ Zapisano zmiany dla ${podsumowanie.length} osób:\n${podsumowanie.join("\n")}\n\nŁącznie: ${lacznieZapisane} wpisów`);
  };

  // ============================================================
  // SZACOWANY CZAS
  // ============================================================
  const szacujCzas = (liczbaScreenow) => {
    // ~5s na screen + 2s pauza = ~7s/screen
    const sekundy = liczbaScreenow * 7;
    const min = Math.floor(sekundy / 60);
    const sek = sekundy % 60;
    return min > 0 ? `~${min} min ${sek > 0 ? sek + "s" : ""}` : `~${sek}s`;
  };

  // ============================================================
  // RENDER
  // ============================================================
  const aktywnyWynik = wyniki?.[aktywnyWynikIdx];
  const aktywnaOsoba = aktywnyWynik ? czlonkowie.find(c => c.id === aktywnyWynik.osobaId) : null;

  return (
    <div>
      {/* Nagłówek */}
      <div style={{ background: "rgba(255,215,0,0.06)", border: "1px solid #b8860b33", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#ffd700" }}>
        📸 <strong>OCR kart (Gemini 2.5 Flash)</strong> — AI rozpoznaje karty ze screenów automatycznie
        <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
          Tryb masowy: przygotuj screeny dla wszystkich członków, analizuj jednym kliknięciem.
        </div>
      </div>

      {/* Przełącznik trybu */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[
          { id: "masowy", label: "🚀 Tryb masowy", opis: "Wiele osób naraz" },
          { id: "pojedynczy", label: "👤 Tryb pojedynczy", opis: "Jedna osoba" },
        ].map(t => (
          <button key={t.id} onClick={() => { setTryb(t.id); setWyniki(null); }} style={{
            flex: 1, padding: "10px 12px", borderRadius: 8, cursor: "pointer", textAlign: "center",
            background: tryb === t.id ? "linear-gradient(135deg,#b8860b,#ffd700)" : "rgba(255,255,255,0.05)",
            border: tryb === t.id ? "none" : "1px solid #2a2a3a",
            color: tryb === t.id ? "#000" : "#aaa",
            fontWeight: tryb === t.id ? "bold" : "normal",
          }}>
            <div style={{ fontSize: 13 }}>{t.label}</div>
            <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{t.opis}</div>
          </button>
        ))}
      </div>

      {/* ========== TRYB MASOWY ========== */}
      {tryb === "masowy" && !wyniki && !analizujac && (
        <div>
          {/* Instrukcja */}
          <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid #2a2a3a", borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: "bold", color: "#ffd700", marginBottom: 10 }}>
              📋 Jak używać trybu masowego:
            </div>
            <div style={{ fontSize: 12, color: "#aaa", lineHeight: 1.8 }}>
              1️⃣ Wybierz osobę z listy poniżej<br />
              2️⃣ Wgraj jej screeny (1–15 talii)<br />
              3️⃣ Przejdź do następnej osoby, powtórz<br />
              4️⃣ Gdy masz wszystkich — kliknij <strong style={{ color: "#ffd700" }}>Analizuj wszystko</strong><br />
              5️⃣ Poczekaj (AI analizuje kolejno), potem sprawdź wyniki i zapisz
            </div>
          </div>

          {/* Wybór osoby */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#aaa", marginBottom: 6 }}>Wybierz osobę:</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {czlonkowie.map(c => {
                const wKolejce = kolejka.find(q => q.osobaId === c.id);
                return (
                  <button key={c.id} onClick={() => setWybranaOsobaMasowa(c.id)} style={{
                    padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12,
                    background: wybranaOsobaMasowa === c.id
                      ? "linear-gradient(135deg,#b8860b,#ffd700)"
                      : wKolejce ? "rgba(0,200,100,0.15)" : "rgba(255,255,255,0.06)",
                    border: wybranaOsobaMasowa === c.id ? "none"
                      : wKolejce ? "1px solid #0c655" : "1px solid #2a2a3a",
                    color: wybranaOsobaMasowa === c.id ? "#000" : wKolejce ? "#0c6" : "#aaa",
                    fontWeight: wybranaOsobaMasowa === c.id ? "bold" : "normal",
                    position: "relative",
                  }}>
                    {c.nazwa}
                    {wKolejce && (
                      <span style={{
                        fontSize: 9, background: "#0c6", color: "#000", borderRadius: 10,
                        padding: "0 4px", marginLeft: 4, fontWeight: "bold",
                      }}>{wKolejce.pliki.length}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Wgraj screeny dla wybranej osoby */}
          {wybranaOsobaMasowa && (
            <div style={{ background: "rgba(0,0,0,0.25)", border: "1px solid #2a2a3a", borderRadius: 8, padding: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: "#ffd700", marginBottom: 8 }}>
                📁 Screeny dla: <strong>{czlonkowie.find(c => c.id === wybranaOsobaMasowa)?.nazwa}</strong>
              </div>
              <label style={{
                display: "block", padding: "10px 14px", background: "rgba(184,134,11,0.1)",
                border: "2px dashed #b8860b55", borderRadius: 8, cursor: "pointer",
                textAlign: "center", fontSize: 12, color: "#b8860b", marginBottom: 8,
              }}>
                📷 Kliknij żeby dodać screeny (możesz wgrać wiele naraz)
                <input type="file" accept="image/*" multiple onChange={dodajDoKolejki} style={{ display: "none" }} />
              </label>
              {kolejka.find(q => q.osobaId === wybranaOsobaMasowa) && (
                <div style={{ fontSize: 11, color: "#0c6" }}>
                  ✓ Dodano {kolejka.find(q => q.osobaId === wybranaOsobaMasowa).pliki.length} screenów
                </div>
              )}
            </div>
          )}

          {/* Podgląd kolejki */}
          {kolejka.length > 0 && (
            <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid #2a2a3a", borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: "bold", color: "#ffd700", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>📦 Kolejka do analizy ({kolejka.length} {kolejka.length === 1 ? "osoba" : "osób"}, {laczbnaScreenow} screenów)</span>
                <span style={{ fontSize: 11, color: "#888" }}>{szacujCzas(laczbnaScreenow)}</span>
              </div>

              {kolejka.map((q) => {
                const osoba = czlonkowie.find(c => c.id === q.osobaId);
                return (
                  <div key={q.osobaId} style={{
                    background: "rgba(255,255,255,0.03)", border: "1px solid #1a1a2e",
                    borderRadius: 8, padding: "8px 12px", marginBottom: 6,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: "bold", color: "#ddd" }}>{osoba?.nazwa}</span>
                      <span style={{ fontSize: 11, color: "#0c6", background: "rgba(0,200,100,0.1)", padding: "2px 8px", borderRadius: 10 }}>
                        {q.pliki.length} screen{q.pliki.length !== 1 ? "ów" : ""}
                      </span>
                      <button onClick={() => usunZKolejki(q.osobaId)} style={{
                        padding: "2px 8px", fontSize: 10, borderRadius: 4, cursor: "pointer",
                        background: "rgba(255,50,50,0.1)", border: "1px solid #f5544455", color: "#f55",
                      }}>✕ Usuń</button>
                    </div>
                    {/* Lista plików */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {q.pliki.map((f, fi) => (
                        <span key={fi} style={{
                          fontSize: 10, padding: "2px 6px", borderRadius: 4,
                          background: "rgba(255,215,0,0.08)", border: "1px solid #ffd70022",
                          color: "#aaa", display: "flex", alignItems: "center", gap: 4,
                        }}>
                          📄 {f.name.length > 20 ? f.name.slice(0, 18) + "…" : f.name}
                          <button onClick={() => usunPlikZKolejki(q.osobaId, fi)} style={{
                            background: "none", border: "none", color: "#f55", cursor: "pointer",
                            padding: 0, fontSize: 10, lineHeight: 1,
                          }}>✕</button>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Przycisk ANALIZUJ WSZYSTKO */}
              <button
                onClick={analizujMasowo}
                disabled={analizujac || pozostalo > 0}
                style={{
                  width: "100%", marginTop: 10, padding: 14,
                  background: analizujac || pozostalo > 0
                    ? "rgba(255,255,255,0.05)"
                    : "linear-gradient(135deg,#0c6,#0fa)",
                  border: "none", borderRadius: 8,
                  color: analizujac || pozostalo > 0 ? "#666" : "#000",
                  fontSize: 15, fontWeight: "bold", cursor: analizujac || pozostalo > 0 ? "not-allowed" : "pointer",
                  letterSpacing: 1,
                }}>
                {pozostalo > 0
                  ? `⏱️ Cooldown ${formatCzas(pozostalo)}`
                  : `🚀 Analizuj wszystko — ${kolejka.length} ${kolejka.length === 1 ? "osoba" : "osób"}, ${laczbnaScreenow} screenów (${szacujCzas(laczbnaScreenow)})`}
              </button>
            </div>
          )}

          {kolejka.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: "#555", fontSize: 13 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
              Kolejka jest pusta. Wybierz osobę i wgraj jej screeny.
            </div>
          )}
        </div>
      )}

      {/* ========== TRYB POJEDYNCZY ========== */}
      {tryb === "pojedynczy" && !wyniki && !analizujac && (
        <div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: "#aaa", marginBottom: 6 }}>Wybierz osobę:</div>
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

          <div style={{ background: "rgba(0,0,0,0.25)", border: "1px solid #2a2a3a", borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: "bold", color: "#ffd700", marginBottom: 8 }}>📁 Wybierz screeny talii</div>
            <input type="file" accept="image/*" multiple onChange={e => { setPliki(Array.from(e.target.files || [])); setWyniki(null); }}
              style={{ width: "100%", padding: 8, background: "#12122a", border: "1px solid #333", borderRadius: 6, color: "#fff", fontSize: 12, marginBottom: 10 }} />
            {pliki.length > 0 && (
              <div style={{ fontSize: 12, color: "#0c6", marginBottom: 10 }}>
                Wybrano {pliki.length} {pliki.length === 1 ? "plik" : "plików"}: {pliki.map(p => p.name).join(", ")}
              </div>
            )}
            <button onClick={analizujPojedynczo} disabled={!wybranaOsoba || pliki.length === 0 || analizujac || pozostalo > 0}
              style={{
                width: "100%", padding: 12,
                background: !wybranaOsoba || pliki.length === 0 || analizujac || pozostalo > 0 ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,#b8860b,#ffd700)",
                border: "none", borderRadius: 8,
                color: !wybranaOsoba || pliki.length === 0 || analizujac || pozostalo > 0 ? "#666" : "#000",
                fontSize: 14, fontWeight: "bold", cursor: "pointer", letterSpacing: 1,
              }}>
              {analizujac
                ? `⏳ Analizuję ${progress.aktualny}/${progress.total}...`
                : pozostalo > 0 ? `⏱️ Cooldown ${formatCzas(pozostalo)}`
                : `🤖 Analizuj ${pliki.length} screen${pliki.length === 1 ? "" : "ów"}`}
            </button>
          </div>
        </div>
      )}

      {/* ========== PROGRESS ========== */}
      {analizujac && (
        <div style={{ background: "rgba(0,0,0,0.4)", border: "1px solid #2a2a3a", borderRadius: 10, padding: 20, marginBottom: 14, textAlign: "center" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🤖</div>
          <div style={{ fontSize: 14, fontWeight: "bold", color: "#ffd700", marginBottom: 4 }}>
            Analizuję karty... {progress.aktualny}/{progress.total}
          </div>
          {progress.osobaNazwa && (
            <div style={{ fontSize: 12, color: "#aaa", marginBottom: 8 }}>
              Aktualnie: <strong style={{ color: "#ffd700" }}>{progress.osobaNazwa}</strong>
              {progress.plik && <span> — {progress.plik}</span>}
            </div>
          )}
          <div style={{ height: 10, background: "#12122a", borderRadius: 5, overflow: "hidden", marginBottom: 8 }}>
            <div style={{
              height: "100%",
              width: `${(progress.aktualny / Math.max(1, progress.total)) * 100}%`,
              background: "linear-gradient(90deg,#b8860b,#ffd700)",
              transition: "width 0.3s",
            }} />
          </div>
          <div style={{ fontSize: 11, color: "#555" }}>
            Pozostało ~{szacujCzas(Math.max(0, progress.total - progress.aktualny))}
          </div>
        </div>
      )}

      {/* ========== WYNIKI ========== */}
      {wyniki && !analizujac && (
        <div>
          {/* Podsumowanie wszystkich osób */}
          <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid #2a2a3a", borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: "bold", color: "#ffd700", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <span>📊 Wyniki analizy — {wyniki.length} {wyniki.length === 1 ? "osoba" : "osób"}</span>
              {wyniki.length > 1 && (
                <button onClick={zatwierdzWszystkich} disabled={zapisywanie}
                  style={{
                    padding: "8px 16px", fontSize: 12, fontWeight: "bold",
                    background: zapisywanie ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,#0c6,#0fa)",
                    border: "none", borderRadius: 8, cursor: zapisywanie ? "not-allowed" : "pointer",
                    color: zapisywanie ? "#666" : "#000",
                  }}>
                  {zapisywanie ? "⏳ Zapisywanie..." : "✅ Zatwierdź WSZYSTKICH"}
                </button>
              )}
            </div>

            {/* Zakładki osób */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 14 }}>
              {wyniki.map((w, i) => {
                const osoba = czlonkowie.find(c => c.id === w.osobaId);
                const noweKarty = w.propozycje.filter(p => p.zmiana === "nowa").length;
                const noweDup = w.propozycje.filter(p => p.zmiana === "nowy_duplikat").length;
                const bledy = w.bledy.length;
                const zapisana = zapisaneOsoby.includes(w.osobaId);
                return (
                  <button key={w.osobaId} onClick={() => setAktywnyWynikIdx(i)} style={{
                    padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, textAlign: "left",
                    background: aktywnyWynikIdx === i
                      ? "linear-gradient(135deg,#b8860b,#ffd700)"
                      : zapisana ? "rgba(0,200,100,0.1)" : "rgba(255,255,255,0.06)",
                    border: aktywnyWynikIdx === i ? "none"
                      : zapisana ? "1px solid #0c655" : "1px solid #2a2a3a",
                    color: aktywnyWynikIdx === i ? "#000" : zapisana ? "#0c6" : "#aaa",
                    fontWeight: aktywnyWynikIdx === i ? "bold" : "normal",
                  }}>
                    <span>{zapisana ? "✅ " : ""}{osoba?.nazwa}</span>
                    {(noweKarty > 0 || noweDup > 0) && (
                      <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.8 }}>
                        {noweKarty > 0 && `+${noweKarty}🆕`}{noweDup > 0 && ` +${noweDup}💎`}
                      </span>
                    )}
                    {bledy > 0 && <span style={{ fontSize: 10, color: aktywnyWynikIdx === i ? "#a00" : "#f55", marginLeft: 4 }}>⚠️{bledy}</span>}
                  </button>
                );
              })}
            </div>

            {/* Przycisk "Wróć do kolejki" */}
            <button onClick={() => { setWyniki(null); setKolejka([]); setZapisaneOsoby([]); }} style={{
              padding: "6px 14px", fontSize: 12, borderRadius: 6, cursor: "pointer",
              background: "rgba(255,255,255,0.05)", border: "1px solid #2a2a3a", color: "#888",
            }}>
              ← Nowa analiza
            </button>
          </div>

          {/* Szczegóły aktywnej osoby */}
          {aktywnyWynik && (
            <WynikOsoby
              wynik={aktywnyWynik}
              wynikIdx={aktywnyWynikIdx}
              osoba={aktywnaOsoba}
              talie={talie}
              posiadane={posiadane}
              duplikaty={duplikaty}
              zapisana={zapisaneOsoby.includes(aktywnyWynik?.osobaId)}
              zapisywanie={zapisywanie}
              onToggle={togglePropozycja}
              onZatwierdz={zatwierdzOsobe}
            />
          )}
        </div>
      )}

      {/* Cooldown panel */}
      {pozostalo > 0 && !analizujac && (
        <div style={{
          marginTop: 10,
          background: cooldownAktywowanyZBleduLimitu ? "rgba(255,50,50,0.08)" : "rgba(255,165,0,0.08)",
          border: cooldownAktywowanyZBleduLimitu ? "1px solid #f5544455" : "1px solid #fa050",
          borderRadius: 8, padding: 12,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: "bold", color: cooldownAktywowanyZBleduLimitu ? "#f55" : "#fa0" }}>
              {cooldownAktywowanyZBleduLimitu ? "🚫 Limit Google przekroczony" : "⏱️ Cooldown"}
            </div>
            <div style={{ fontSize: 18, fontWeight: "bold", color: "#ffd700", fontFamily: "monospace" }}>
              {formatCzas(pozostalo)}
            </div>
          </div>
          <div style={{ height: 6, background: "#12122a", borderRadius: 3, overflow: "hidden", marginBottom: 6 }}>
            <div style={{
              height: "100%",
              width: `${(pozostalo / (cooldownAktywowanyZBleduLimitu ? 600 : 300)) * 100}%`,
              background: "linear-gradient(90deg,#f55,#fa0)",
              transition: "width 1s linear",
            }} />
          </div>
          {!cooldownAktywowanyZBleduLimitu && (
            <button onClick={() => { setCooldownDo(null); setPozostalo(0); }}
              style={{ marginTop: 8, padding: "4px 10px", background: "rgba(255,255,255,0.05)", border: "1px solid #444", borderRadius: 5, color: "#888", cursor: "pointer", fontSize: 10 }}>
              ⚠️ Pomiń cooldown
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Komponent wyników dla jednej osoby
// ============================================================
function WynikOsoby({ wynik, wynikIdx, osoba, talie, posiadane, duplikaty, zapisana, zapisywanie, onToggle, onZatwierdz }) {
  if (!wynik) return null;

  const aktywne = wynik.propozycje.filter(p => !p.odrzucona);
  const nowe = aktywne.filter(p => p.zmiana === "nowa");
  const noweDup = aktywne.filter(p => p.zmiana === "nowy_duplikat");
  const usuniete = aktywne.filter(p => p.zmiana === "usunieta");
  const liczbaNiepewnych = wynik.propozycje.filter(p => p.pewnosc === "niska" || p.pewnosc === "srednia").length;
  const lacznieZmian = nowe.length + noweDup.length + usuniete.length;

  return (
    <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid #2a2a3a", borderRadius: 10, padding: 14 }}>
      {/* Nagłówek osoby */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: "bold", color: "#ffd700" }}>
            {zapisana ? "✅ " : ""}{osoba?.nazwa}
          </div>
          <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>
            {wynik.propozycje.length} kart · {lacznieZmian} zmian
            {liczbaNiepewnych > 0 && <span style={{ color: "#fa0" }}> · {liczbaNiepewnych} do weryfikacji</span>}
          </div>
        </div>
        {!zapisana && (
          <button onClick={() => onZatwierdz(wynikIdx)} disabled={zapisywanie}
            style={{
              padding: "10px 20px",
              background: zapisywanie ? "rgba(255,255,255,0.1)" : "linear-gradient(135deg,#0c6,#0fa)",
              border: "none", borderRadius: 8,
              color: zapisywanie ? "#666" : "#000",
              fontSize: 13, fontWeight: "bold", cursor: zapisywanie ? "not-allowed" : "pointer",
            }}>
            {zapisywanie ? "⏳ Zapisywanie..." : `✓ Zatwierdź ${osoba?.nazwa}`}
          </button>
        )}
        {zapisana && (
          <div style={{ padding: "8px 16px", background: "rgba(0,200,100,0.15)", border: "1px solid #0c6", borderRadius: 8, fontSize: 12, color: "#0c6", fontWeight: "bold" }}>
            ✅ Zapisano
          </div>
        )}
      </div>

      {/* Podsumowanie zmian */}
      {lacznieZmian > 0 && (
        <div style={{ background: "rgba(0,200,100,0.06)", border: "1px solid #0c655", borderRadius: 8, padding: "10px 14px", marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: "bold", color: "#0c6", marginBottom: 6 }}>
            📊 {lacznieZmian} zmian:
          </div>
          {nowe.length > 0 && (
            <div style={{ fontSize: 11, color: "#bbb", marginBottom: 3 }}>
              🆕 <strong style={{ color: "#0c6" }}>{nowe.length}</strong> nowych kart
            </div>
          )}
          {noweDup.length > 0 && (
            <div style={{ fontSize: 11, color: "#bbb", marginBottom: 3 }}>
              💎 <strong style={{ color: "#87CEEB" }}>{noweDup.length}</strong> nowych duplikatów
            </div>
          )}
          {usuniete.length > 0 && (
            <div style={{ fontSize: 11, color: "#fa0" }}>
              ⚠️ {usuniete.length} kart oznaczonych jako utracone — sprawdź!
            </div>
          )}
        </div>
      )}
      {lacznieZmian === 0 && (
        <div style={{ background: "rgba(100,180,255,0.06)", border: "1px solid #6af55", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "#6af" }}>
          ℹ️ Brak nowych zmian
        </div>
      )}

      {/* Błędy */}
      {wynik.bledy.length > 0 && (
        <div style={{ background: "rgba(255,50,50,0.08)", border: "1px solid #f5544455", borderRadius: 8, padding: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: "bold", color: "#f55", marginBottom: 4 }}>⚠️ Błędy ({wynik.bledy.length})</div>
          {wynik.bledy.map((b, i) => (
            <div key={i} style={{ fontSize: 11, color: "#aaa" }}>{b.fileName}: {b.blad}</div>
          ))}
        </div>
      )}

      {/* Karty pogrupowane wg talii */}
      {Array.from(new Set(wynik.propozycje.map(p => p.taliaId))).map(taliaId => {
        const talia = talie.find(t => t.id === taliaId);
        const kartyTalii = wynik.propozycje.map((p, i) => ({ ...p, idx: i })).filter(p => p.taliaId === taliaId);
        const zmianWTalii = kartyTalii.filter(p => !p.odrzucona && p.zmiana !== "bez_zmian").length;
        return (
          <div key={taliaId} style={{ marginBottom: 12, background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: 10 }}>
            <div style={{ fontWeight: "bold", color: "#ffd700", fontSize: 13, marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span>#{talia?.numer} {talia?.nazwa || taliaId}</span>
              {zmianWTalii > 0 && (
                <span style={{ fontSize: 10, padding: "2px 7px", background: "rgba(0,200,100,0.15)", border: "1px solid #0c655", borderRadius: 10, color: "#0c6", fontWeight: "bold" }}>
                  {zmianWTalii} zmian
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
                    <button onClick={() => onToggle(wynikIdx, p.idx, "ma")} style={{
                      padding: "3px 8px", fontSize: 11, borderRadius: 4, cursor: "pointer",
                      background: p.ma ? "linear-gradient(135deg,#b8860b,#ffd700)" : "rgba(255,255,255,0.08)",
                      border: p.ma ? "none" : "1px solid #333",
                      color: p.ma ? "#000" : "#888", fontWeight: p.ma ? "bold" : "normal",
                    }}>{p.ma ? "✓ Ma" : "Nie ma"}</button>
                    {p.ma && (
                      <button onClick={() => onToggle(wynikIdx, p.idx, "dup")} style={{
                        padding: "3px 8px", fontSize: 11, borderRadius: 4, cursor: "pointer",
                        background: p.dup > 0 ? "linear-gradient(135deg,#4169E1,#87CEEB)" : "rgba(65,105,225,0.1)",
                        border: p.dup > 0 ? "none" : "1px dashed #4169E155",
                        color: p.dup > 0 ? "#fff" : "#4169E1",
                      }}>{p.dup > 0 ? `💎+${p.dup}` : "+dup"}</button>
                    )}
                    <button onClick={() => onToggle(wynikIdx, p.idx, "odrzuc")} style={{
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
        💡 Sprawdź wyniki, popraw jeśli AI się pomyliła. 🟢 wysoka pewność · 🟡 średnia · 🔴 niska. Kliknij <strong>Zatwierdź</strong> żeby zapisać.
      </div>
    </div>
  );
}
