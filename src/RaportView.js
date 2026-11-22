import { useState, useMemo } from "react";
import { obliczPodsumowanieSezonu, obliczDaneKartowe } from "./WalkiView";
import * as R from "./raportLogika";

// Raport „jak komu idzie”: pochwały dla najlepszych i upomnienia dla tych, którzy odstają.
// Wszystkie dane pochodzą z zakładki Walki (poziomy i obrażenia graczy zapisane przy walkach).
// Tryb azja (lvlowanie): przyrost poziomów w okresie. Tryb europa (liga): obrażenia i obecność w walkach. Karty — w obu trybach, z uwzględnieniem kręgu.

const karta = { background: "rgba(0,0,0,0.25)", border: "1px solid var(--border)", borderRadius: 10, padding: 14, marginBottom: 14 };
const przycisk = (kolor) => ({ padding: "6px 12px", background: `rgba(${kolor},0.14)`, border: `1px solid rgba(${kolor},0.6)`, borderRadius: 8, color: `rgb(${kolor})`, fontWeight: "bold", cursor: "pointer", fontSize: 12 });
const fmt = (n) => (n == null || Number.isNaN(n) ? "—" : Math.round(n).toLocaleString("pl-PL"));

function odczyt(klucz, domyslna) {
  try { return localStorage.getItem(klucz) || domyslna; } catch (e) { return domyslna; }
}
function zapis(klucz, v) {
  try { localStorage.setItem(klucz, v); } catch (e) { /* brak dostępu do pamięci przeglądarki — nic się nie dzieje */ }
}

// Karty członków: krąg + diamentowe (najważniejsze) i złote. Zwraca {karty, zlote}.
function zbierzKarty(czlonkowie, talie, posiadane, duplikaty) {
  const bazowe = obliczDaneKartowe(czlonkowie, talie, posiadane, duplikaty);
  const karty = {}, zlote = {};
  czlonkowie.forEach((c) => {
    const b = bazowe[c.nazwa || c.id];
    if (!b) return;
    let razem = 0, pos = 0, zRazem = 0, zPos = 0;
    talie.forEach((t) => (t.karty || []).forEach((k) => {
      const mam = !!posiadane[`${c.id}_${t.id}_${k.nazwa}`];
      if (k.typ === "diamentowa") { razem++; if (mam) pos++; }
      else if (k.typ === "złota") { zRazem++; if (mam) zPos++; }
    }));
    karty[c.nazwa || c.id] = razem > 0 ? { krag: b.krag, procent: Math.round((pos / razem) * 100), diamPos: pos, diamRazem: razem } : { krag: b.krag, procent: b.procent };
    if (zRazem > 0) zlote[c.nazwa || c.id] = { pos: zPos, razem: zRazem };
  });
  return { karty, zlote };
}

export default function RaportView({ czlonkowie = [], walki = [], talie = [], posiadane = {}, duplikaty = {} }) {
  const [tryb, setTryb] = useState(() => odczyt("raport_tryb", "azja"));
  const [dni, setDni] = useState(() => Number(odczyt("raport_dni", "14")));
  const [skopiowano, setSkopiowano] = useState(false);
  const [heist, setHeist] = useState(() => Math.max(0, parseInt(odczyt("raport_heist_n", "0"), 10) || 0));
  const [wybranyCzlonek, setWybranyCzlonek] = useState("");
  const [skopiowanoInd, setSkopiowanoInd] = useState("");
  const [humor, setHumor] = useState(() => odczyt("raport_humor", "1") === "1");

  const ustawTryb = (t) => { setTryb(t); zapis("raport_tryb", t); };

  const dane = useMemo(() => {
    const karty = zbierzKarty(czlonkowie, talie, posiadane, duplikaty).karty;
    const { wybrane, od, do: doTs } = R.walkiZOkresu(walki, dni);
    const okres = od != null ? { od, do: doTs } : null;
    if (tryb === "azja") {
      const { delty: przyrosty, szczegoly } = R.przyrostyZWalk(walki, czlonkowie, dni ? od : null);
      const ile = Object.keys(przyrosty).length;
      return { raport: R.zbudujRaport({ tryb, czlonkowie, przyrosty, karty, heist }), szczegoly, okres, ileWalk: wybrane.length, brak: !walki.length ? "Brak zapisanych walk." : ile < 3 ? "Za mało danych o poziomach graczy w walkach z tego okresu (potrzebne są poziomy zapisane przy co najmniej dwóch walkach). Wybierz dłuższy okres." : null };
    }
    const pod = wybrane.length ? obliczPodsumowanieSezonu(wybrane, czlonkowie) : null;
    const obrazenia = {};
    (pod?.wszyscy || []).forEach((g) => { obrazenia[g.nazwa] = { lacznie: g.obrazeniaLacznie, uczestnictwa: g.uczestnictwa, srednia: g.uczestnictwa ? g.obrazeniaLacznie / g.uczestnictwa : 0 }; });
    return { raport: R.zbudujRaport({ tryb, czlonkowie, obrazenia, lacznaWalka: wybrane.length, karty, heist }), okres, ileWalk: wybrane.length, brak: !wybrane.length ? "Brak walk w wybranym okresie." : null };
  }, [tryb, czlonkowie, talie, posiadane, duplikaty, walki, dni, heist]);

  const indyw = useMemo(() => {
    const { karty, zlote } = zbierzKarty(czlonkowie, talie, posiadane, duplikaty);
    const { wybrane, od } = R.walkiZOkresu(walki, dni);
    const { delty: przyrosty, szczegoly: szczLvl } = R.przyrostyZWalk(walki, czlonkowie, dni ? od : null);
    const pod = wybrane.length ? obliczPodsumowanieSezonu(wybrane, czlonkowie) : null;
    const obrazenia = {}, maxObr = {}, lacznieObr = {};
    (pod?.wszyscy || []).forEach((g) => {
      obrazenia[g.nazwa] = { lacznie: g.obrazeniaLacznie, uczestnictwa: g.uczestnictwa, srednia: g.uczestnictwa ? g.obrazeniaLacznie / g.uczestnictwa : 0 };
      lacznieObr[g.nazwa] = g.obrazeniaLacznie;
      maxObr[g.nazwa] = (g.historiaObr || []).reduce((m, h) => (h.obr > m ? h.obr : m), 0);
    });
    const rA = R.zbudujRaport({ tryb: "azja", czlonkowie, przyrosty, karty, heist });
    const rE = R.zbudujRaport({ tryb: "europa", czlonkowie, obrazenia, lacznaWalka: wybrane.length, karty, heist });
    const profile = R.zbudujProfile({ rA, rE, szczegolyLvl: szczLvl, dodatki: { maxObr, lacznieObr, zlote }, heist });
    return { profile, opisyInd: R.opisyIndywidualne(profile, rA, rE) };
  }, [czlonkowie, talie, posiadane, duplikaty, walki, dni, heist]);

  const { raport, okres, brak } = dane;
  const szczegoly = dane.szczegoly || {};
  const opis = okres ? `${new Date(okres.od).toLocaleDateString("pl-PL")} – ${new Date(okres.do).toLocaleDateString("pl-PL")}, ${dane.ileWalk} walk` : "";
  const opisy = useMemo(() => R.opisyHumoru(raport), [raport]);
  const tekst = humor ? R.tekstHumor(raport, opis) : R.tekstRaportu(raport, opis);

  const kopiuj = async () => {
    try { await navigator.clipboard.writeText(tekst); setSkopiowano(true); setTimeout(() => setSkopiowano(false), 2000); }
    catch (e) { window.prompt("Skopiuj raport (Ctrl+C):", tekst); }
  };

  const kopiujInd = async (klucz, tekstInd) => {
    try { await navigator.clipboard.writeText(tekstInd); setSkopiowanoInd(klucz); setTimeout(() => setSkopiowanoInd(""), 2000); }
    catch (e) { window.prompt("Skopiuj raport (Ctrl+C):", tekstInd); }
  };
  const tekstOsoby = (p) => R.tekstIndywidualny(p, indyw.opisyInd[p.nazwa], opis, humor);
  const profileLista = [...indyw.profile].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const wybraneProfile = wybranyCzlonek === "__wszyscy" ? profileLista : profileLista.filter((p) => p.nazwa === wybranyCzlonek);
  const kartaOsoby = (p) => (
    <div key={p.nazwa} style={{ background: "rgba(0,0,0,0.2)", border: "1px solid #ffffff14", borderRadius: 8, padding: 12, marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: "bold" }}>{R.ikonaTier(p.tier)} {p.nazwa} <span style={{ fontSize: 11, color: "#888", fontWeight: "normal" }}>({R.etykietaTier(p.tier)})</span></div>
        <button onClick={() => kopiujInd(p.nazwa, tekstOsoby(p))} style={przycisk("0,200,100")}>{skopiowanoInd === p.nazwa ? "✅ Skopiowano" : "📋 Kopiuj"}</button>
      </div>
      <div style={{ marginTop: 8 }}>
        {R.faktyProfilu(p).map((f, i) => <div key={i} style={{ fontSize: 12, padding: "2px 0" }}>{f.ikona} {f.tekst}</div>)}
      </div>
      {humor && (indyw.opisyInd[p.nazwa] || []).length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #ffffff10" }}>
          {indyw.opisyInd[p.nazwa].map((l, i) => <div key={i} style={{ fontSize: 12, lineHeight: 1.55, padding: "2px 0", color: i === indyw.opisyInd[p.nazwa].length - 1 ? "#c792ea" : "var(--text)" }}>{l}</div>)}
        </div>
      )}
    </div>
  );

  const wartosc = (w) => (w.glowna == null ? "—" : tryb === "azja" ? `+${fmt(w.glowna)}` : fmt(w.glowna));
  const wiersze = [...raport.wiersze].sort((a, b) => (b.glowna ?? -1) - (a.glowna ?? -1));
  const kolorRatio = (r) => (r == null ? "#666" : r >= 1.15 ? "#0c6" : r < 0.35 ? "#f55" : r < 0.6 ? "#fa0" : "var(--text)");

  return (
    <div>
      <div style={{ ...karta, background: "rgba(255,215,0,0.05)", border: "1px solid #b8860b55" }}>
        <div style={{ fontSize: 15, fontWeight: "bold", color: "var(--accent)", marginBottom: 4 }}>📋 Raport: jak komu idzie</div>
        <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.6, marginBottom: 10 }}>
          Dane z zakładki Walki. Chwali najlepszych i wskazuje tych, którzy odstają od mediany gangu. Karty są oceniane z uwzględnieniem kręgu (osoba z 4. kręgu i z 1. kręgu nie są porównywane „na oko”).
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          <button onClick={() => ustawTryb("azja")} style={{ ...przycisk("255,215,0"), opacity: tryb === "azja" ? 1 : 0.45 }}>🌏 Lvlujemy (serwer azjatycki)</button>
          <button onClick={() => ustawTryb("europa")} style={{ ...przycisk("77,184,255"), opacity: tryb === "europa" ? 1 : 0.45 }}>🇪🇺 Liga (serwer europejski)</button>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: "#ff8a3d", display: "inline-flex", alignItems: "center", gap: 6 }}>
            🔥 Card Heistów w okresie:
            <button onClick={() => { const n = Math.max(0, heist - 1); setHeist(n); zapis("raport_heist_n", String(n)); }} style={{ ...przycisk("255,138,61"), padding: "2px 10px" }}>−</button>
            <b style={{ minWidth: 16, textAlign: "center" }}>{heist}</b>
            <button onClick={() => { const n = Math.min(20, heist + 1); setHeist(n); zapis("raport_heist_n", String(n)); }} style={{ ...przycisk("255,138,61"), padding: "2px 10px" }}>+</button>
          </span>
          <label style={{ fontSize: 12, color: "#c792ea", cursor: "pointer" }}><input type="checkbox" checked={humor} onChange={(e) => { setHumor(e.target.checked); zapis("raport_humor", e.target.checked ? "1" : "0"); }} /> 😈 Opisy z humorem</label>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>Okres (od ostatniej walki wstecz):</span>
          {[[7, "7 dni"], [14, "14 dni"], [30, "30 dni"], [0, "cały sezon"]].map(([d, t]) => (
            <button key={d} onClick={() => { setDni(d); zapis("raport_dni", String(d)); }} style={{ ...przycisk("150,150,150"), opacity: dni === d ? 1 : 0.45 }}>{t}</button>
          ))}
        </div>
      </div>

      {brak ? (
        <div style={{ textAlign: "center", padding: 24, color: "#888", fontSize: 13 }}>{brak}</div>
      ) : (
        <>
          <div style={karta}>
            {raport.pochwaly.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: "bold", color: "#0c6", marginBottom: 4 }}>🏆 Najlepsi</div>
                {raport.pochwaly.map((w, i) => (
                  <div key={w.nazwa} style={{ fontSize: 13, padding: "2px 0" }}>{["🥇", "🥈", "🥉"][i]} {humor ? opisy.poch[w.nazwa] : <><b>{w.nazwa}</b> — {tryb === "azja" ? `+${fmt(w.glowna)} lvl` : `śr. ${fmt(w.glowna)} obr.`} <span style={{ color: "#888", fontSize: 11 }}>({Math.round(w.ratio * 100)}% mediany)</span></>}</div>
                ))}
              </div>
            )}
            {raport.kartyTop.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: "bold", color: "#0c6", marginBottom: 4 }}>🃏 Karty — brawo</div>
                {raport.kartyTop.map((w) => <div key={w.nazwa} style={{ fontSize: 13 }}>• {humor ? opisy.karty[w.nazwa] : <><b>{w.nazwa}</b> <span style={{ color: "#888", fontSize: 11 }}>(K{w.karty.krag}, {w.karty.diamRazem ? `💎 ${w.karty.diamPos}/${w.karty.diamRazem}` : `${w.karty.procent}%`})</span></>}</div>)}
              </div>
            )}
            <div style={{ fontSize: 13, fontWeight: "bold", color: raport.upomnienia.length ? "#fa0" : "#0c6", marginBottom: 4 }}>{raport.upomnienia.length ? "⚠️ Do poprawy" : "✅ Nikt nie odstaje"}</div>
            {raport.upomnienia.map((w) => (
              <div key={w.nazwa} style={{ fontSize: 12, padding: "3px 0", lineHeight: 1.5 }}>• {humor ? opisy.upom[w.nazwa] : <><b>{w.nazwa}</b>: {w.flagi.map((f) => f.tekst).join("; ")}</>}</div>
            ))}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
              <button onClick={kopiuj} style={przycisk("0,200,100")}>{skopiowano ? "✅ Skopiowano" : "📋 Kopiuj raport (tekst do czatu)"}</button>
              <span style={{ fontSize: 10, color: "#666" }}>Mediana gangu: {tryb === "azja" ? `+${fmt(raport.medGlowna)} lvl` : `${fmt(raport.medGlowna)} obr. / walkę`}</span>
            </div>
          </div>

          <div style={karta}>
            <div style={{ fontSize: 13, fontWeight: "bold", color: "var(--accent)", marginBottom: 6 }}>Wszyscy po kolei</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ color: "var(--muted)", textAlign: "left", fontSize: 11 }}><th>Gracz</th><th>{tryb === "azja" ? "Lvl" : "Obr./walkę"}</th><th>% med.</th>{tryb === "europa" && <th>Walki</th>}<th>Karty</th></tr></thead>
                <tbody>
                  {wiersze.map((w) => (
                    <tr key={w.nazwa} style={{ borderTop: "1px solid #12122a" }}>
                      <td style={{ padding: "5px 0" }}>{w.nazwa}</td>
                      <td>{wartosc(w)}{tryb === "azja" && szczegoly[w.nazwa] && <div style={{ fontSize: 10, color: "#777" }}>{szczegoly[w.nazwa].od} → {szczegoly[w.nazwa].do} <span title="data ostatniego poziomu zapisanego przy walce">({new Date(szczegoly[w.nazwa].tDo).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" })})</span></div>}</td>
                      <td style={{ color: kolorRatio(w.ratio), fontWeight: "bold" }}>{w.ratio == null ? "—" : `${Math.round(w.ratio * 100)}%`}</td>
                      {tryb === "europa" && <td>{w.udzial == null ? "—" : `${Math.round(w.udzial * raport.lacznaWalka)}/${raport.lacznaWalka}`}</td>}
                      <td style={{ color: w.karty && w.karty.odchylenie <= -0.75 ? "#fa0" : "var(--text)" }}>{w.karty ? `K${w.karty.krag} · ${w.karty.diamRazem ? `💎 ${w.karty.diamPos}/${w.karty.diamRazem}` : w.karty.procent + "%"}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 10, color: "#555", marginTop: 8, lineHeight: 1.6 }}>
              „% med.” to wynik względem mediany gangu. Poniżej 60% = odstaje, poniżej 35% = mocno odstaje. Karty: ocena liczy zamknięte kręgi plus diamentowe karty w obecnym kręgu (złote zbierają się same), więc ktoś tuż po zamknięciu kręgu nie jest karany. Osoby bez danych (np. nowe) nie są oceniane.
            </div>
          </div>
        </>
      )}

      <div style={karta}>
        <div style={{ fontSize: 13, fontWeight: "bold", color: "var(--accent)", marginBottom: 6 }}>👤 Raporty indywidualne</div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8, lineHeight: 1.6 }}>Wszystkie dane jednej osoby naraz (poziomy, obrażenia, obecność, karty, miejsca w gangu) z opisem w naszym stylu. Okres i liczba Card Heistów jak w raporcie wyżej.</div>
        <select value={wybranyCzlonek} onChange={(e) => setWybranyCzlonek(e.target.value)} style={{ padding: "6px 8px", background: "var(--card-solid)", border: "1px solid #333", borderRadius: 6, color: "var(--text)", fontSize: 12, width: "100%", boxSizing: "border-box" }}>
          <option value="">— wybierz osobę —</option>
          <option value="__wszyscy">👥 Wszyscy (od najlepszych)</option>
          {[...indyw.profile].sort((a, b) => a.nazwa.localeCompare(b.nazwa, "pl")).map((p) => <option key={p.nazwa} value={p.nazwa}>{p.nazwa}</option>)}
        </select>
        {wybranyCzlonek === "__wszyscy" && (
          <button onClick={() => kopiujInd("__wszyscy", profileLista.map(tekstOsoby).join("\n\n"))} style={{ ...przycisk("0,200,100"), marginTop: 8 }}>{skopiowanoInd === "__wszyscy" ? "✅ Skopiowano" : "📋 Kopiuj wszystkie raporty"}</button>
        )}
        {wybraneProfile.map(kartaOsoby)}
      </div>
    </div>
  );
}
