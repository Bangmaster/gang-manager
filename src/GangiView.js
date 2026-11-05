import { useState, useEffect, useMemo } from "react";
import { subscribePorownanie, zapiszGangPorownanie, usunGangPorownanie } from "./firebase";
import { wolajGeminiObraz, nastepnyKlucz } from "./WalkiView";
import * as L from "./gangiLogika";

// ============================================================
// PORÓWNANIE GANGÓW
// Admin wgrywa screeny listy członków (zakładka CZŁONKOWIE) obcych gangów i naszego.
// Każdy zestaw screenów = jedno "zdjęcie stanu" (data, moc, lista graczy z poziomami).
// ============================================================

const KOLORY = ["#4db8ff", "#ff6b6b", "#7bd88f", "#c792ea", "#ffa94d", "#f06595", "#63e6be", "#a9a9ff"];
const NASZ_KOLOR = "#ffd700";

const PROMPT_GANG = `Rozpoznaj ekran gangu z gry The Gang (zakładka CZŁONKOWIE).

NAGŁÓWEK (u góry):
- nazwa gangu (skopiuj DOKŁADNIE, razem ze znakami specjalnymi)
- dywizja (cyfra obok napisu DYWIZJA)
- moc gangu: liczba obok ikony mięśnia (np. 25266)
- liczba członków obok ikony postaci (np. 20/20)

LISTA CZŁONKÓW — każdy wiersz zawiera:
- miejsce (numer 1, 2, 3...)
- poziom gracza: liczba na dole avatara (np. 2084). To NAJWAŻNIEJSZA wartość — czytaj ją bardzo uważnie, cyfra po cyfrze
- nazwa gracza (skopiuj DOKŁADNIE, łącznie z prefiksem gangu i znakami specjalnymi, np. "THC☆Mr☆Burza"); jeśli czcionka jest ozdobna, zapisz najlepiej jak potrafisz
Ignoruj flagi, napisy BOSS / CPT, czas ostatniej aktywności i grafiki postaci.

Jeśli na screenie widać tylko fragment listy, zwróć tylko widocznych graczy.

Zwróć WYŁĄCZNIE JSON (bez markdown), liczby bez spacji:
{"gang":{"nazwa":"Happy☆Trip Cartel","dywizja":1,"moc":25266,"czlonkow":20,"max":20},"gracze":[{"miejsce":1,"nazwa":"SH2 giermek","poziom":2084}]}`;

const czekaj = (ms) => new Promise((r) => setTimeout(r, ms));

// zmniejsza obraz do rozsądnego rozmiaru i zamienia na JPEG (base64 bez nagłówka)
async function plikDoBase64(plik) {
  const url = URL.createObjectURL(plik);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const skala = Math.min(1, 1100 / img.width);
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * skala);
    c.height = Math.round(img.height * skala);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.92).split(",")[1];
  } finally { URL.revokeObjectURL(url); }
}

async function odczytajScreen(plik, onProgress) {
  const base64 = await plikDoBase64(plik);
  let blad = "";
  for (let proba = 0; proba < 3; proba++) {
    try {
      const odp = await wolajGeminiObraz(PROMPT_GANG, base64);
      if (!odp.ok) {
        const t = await odp.text();
        blad = `Błąd ${odp.status}: ${String(t).slice(0, 120)}`;
        nastepnyKlucz();
        if (proba < 2) { onProgress?.(`${blad} — ponawiam za 8 s...`); await czekaj(8000); }
        continue;
      }
      const dane = await odp.json();
      let tekst = (dane.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      tekst = tekst.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
      const wynik = JSON.parse(tekst);
      nastepnyKlucz();
      return wynik;
    } catch (e) {
      blad = e.message;
      nastepnyKlucz();
      if (proba < 2) { onProgress?.(`Błąd odczytu (${blad}) — ponawiam za 8 s...`); await czekaj(8000); }
    }
  }
  throw new Error(blad || "Nie udało się odczytać screena");
}

const fmt = (n) => (n == null || Number.isNaN(n) ? "—" : Math.round(n).toLocaleString("pl-PL"));
const fmtData = (ts) => new Date(ts).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "2-digit" });
const znak = (n) => (n > 0 ? "+" : n < 0 ? "−" : "");
const kolorDelta = (n) => (n > 0 ? "#0c6" : n < 0 ? "#f55" : "#888");

const karta = { background: "rgba(0,0,0,0.25)", border: "1px solid var(--border)", borderRadius: 10, padding: 14, marginBottom: 14 };
const przycisk = (kolor, wyl) => ({ padding: "8px 14px", background: `rgba(${kolor},0.14)`, border: `1px solid rgba(${kolor},0.6)`, borderRadius: 8, color: `rgb(${kolor})`, fontWeight: "bold", cursor: wyl ? "default" : "pointer", fontSize: 12, opacity: wyl ? 0.5 : 1 });
const pole = { padding: "6px 8px", background: "var(--card-solid)", border: "1px solid #333", borderRadius: 6, color: "var(--text)", fontSize: 12, boxSizing: "border-box" };

// ---------- wykres liniowy (SVG, bez bibliotek) ----------
function Wykres({ serie, wzgledne }) {
  const W = 640, H = 300, L_ = 56, R_ = 14, T_ = 14, B_ = 34;
  const punkty = serie.flatMap((s) => s.punkty);
  if (punkty.length < 2) return <div style={{ fontSize: 12, color: "var(--muted)", padding: 20, textAlign: "center" }}>Za mało danych na wykres — potrzeba co najmniej dwóch zdjęć stanu.</div>;
  let x0 = Math.min(...punkty.map((p) => p.ts)), x1 = Math.max(...punkty.map((p) => p.ts));
  if (x0 === x1) x1 = x0 + 86400000;
  let y0 = Math.min(...punkty.map((p) => p.wartosc)), y1 = Math.max(...punkty.map((p) => p.wartosc));
  if (wzgledne) y0 = Math.min(y0, 0);
  if (y0 === y1) y1 = y0 + 1;
  const margines = (y1 - y0) * 0.08;
  y0 -= wzgledne ? 0 : margines; y1 += margines;
  const sx = (t) => L_ + ((t - x0) / (x1 - x0)) * (W - L_ - R_);
  const sy = (v) => T_ + (1 - (v - y0) / (y1 - y0)) * (H - T_ - B_);
  const siatka = [0, 1, 2, 3, 4].map((i) => y0 + ((y1 - y0) * i) / 4);
  const fmtY = (v) => (wzgledne ? `${v >= 0 ? "+" : ""}${v.toFixed(Math.abs(y1 - y0) < 10 ? 1 : 0)}%` : Math.round(v).toLocaleString("pl-PL"));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {siatka.map((v, i) => (
        <g key={i}>
          <line x1={L_} x2={W - R_} y1={sy(v)} y2={sy(v)} stroke="#2a2a3a" strokeWidth="1" />
          <text x={L_ - 6} y={sy(v) + 4} fill="#888" fontSize="10" textAnchor="end">{fmtY(v)}</text>
        </g>
      ))}
      {wzgledne && y0 < 0 && y1 > 0 && <line x1={L_} x2={W - R_} y1={sy(0)} y2={sy(0)} stroke="#555" strokeWidth="1.5" strokeDasharray="4 3" />}
      {[x0, (x0 + x1) / 2, x1].map((t, i) => (
        <text key={i} x={sx(t)} y={H - 10} fill="#888" fontSize="10" textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}>{fmtData(t)}</text>
      ))}
      {serie.map((s) => (
        <g key={s.id}>
          <polyline fill="none" stroke={s.kolor} strokeWidth={s.nasz ? 3.5 : 2} strokeLinejoin="round" points={s.punkty.map((p) => `${sx(p.ts)},${sy(p.wartosc)}`).join(" ")} />
          {s.punkty.map((p, i) => <circle key={i} cx={sx(p.ts)} cy={sy(p.wartosc)} r={s.nasz ? 4 : 3} fill={s.kolor} />)}
        </g>
      ))}
    </svg>
  );
}

// ---------- podgląd i edycja odczytu przed zapisem ----------
function PodgladStanu({ podglad, setPodglad, gangi, onZapisz, onAnuluj, zapisuje }) {
  const [mimoBledow, setMimoBledow] = useState(false);
  const wybrany = podglad.gangId !== "nowy" ? gangi[podglad.gangId] : null;
  const poprzedni = useMemo(() => {
    if (!wybrany) return null;
    const s = L.posortowane(wybrany).filter((x) => x.data !== podglad.data);
    const przed = s.filter((x) => x.ts < L.dataNaTs(podglad.data));
    return przed.length ? przed[przed.length - 1] : null;
  }, [wybrany, podglad.data]);
  const kontrola = useMemo(() => L.sprawdzSnapshot({ moc: Number(podglad.moc) || null, liczba: Number(podglad.liczba) || null, gracze: podglad.gracze }, poprzedni), [podglad.moc, podglad.liczba, podglad.gracze, poprzedni]);
  const ustaw = (zmiany) => setPodglad((p) => ({ ...p, ...zmiany }));
  const ustawGracza = (idx, zmiany) => ustaw({ gracze: podglad.gracze.map((g, i) => (i === idx ? { ...g, ...zmiany } : g)) });
  const mozeZapisac = podglad.nazwa.trim() && L.dataNaTs(podglad.data) && podglad.gracze.length > 0 && (kontrola.bledy.length === 0 || mimoBledow);

  return (
    <div style={{ ...karta, border: "1px solid #4db8ff66" }}>
      <div style={{ fontSize: 13, fontWeight: "bold", color: "#4db8ff", marginBottom: 8 }}>🔎 Sprawdź odczyt przed zapisem</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: "var(--muted)" }}>Gang<br />
          <select value={podglad.gangId} onChange={(e) => {
            const g = e.target.value === "nowy" ? null : gangi[e.target.value];
            ustaw({ gangId: e.target.value, ...(g ? { nazwa: g.nazwa } : {}) });
          }} style={{ ...pole, minWidth: 160 }}>
            <option value="nowy">➕ Nowy gang</option>
            {Object.values(gangi).map((g) => <option key={g.id} value={g.id}>{g.nasz ? "⭐ " : ""}{g.nazwa}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, color: "var(--muted)" }}>Nazwa gangu<br />
          <input value={podglad.nazwa} onChange={(e) => ustaw({ nazwa: e.target.value })} style={{ ...pole, width: 170 }} />
        </label>
        <label style={{ fontSize: 11, color: "var(--muted)" }}>Data screena<br />
          <input type="date" value={podglad.data} onChange={(e) => ustaw({ data: e.target.value })} style={pole} />
        </label>
        <label style={{ fontSize: 11, color: "var(--muted)" }}>Moc (nagłówek)<br />
          <input type="number" value={podglad.moc ?? ""} onChange={(e) => ustaw({ moc: e.target.value })} style={{ ...pole, width: 90 }} />
        </label>
        <label style={{ fontSize: 11, color: "var(--muted)" }}>Członków<br />
          <input type="number" value={podglad.liczba ?? ""} onChange={(e) => ustaw({ liczba: e.target.value })} style={{ ...pole, width: 60 }} />
        </label>
      </div>
      {podglad.gangId === "nowy" && (
        <label style={{ fontSize: 12, color: "#ffd700", display: "block", marginBottom: 8 }}>
          <input type="checkbox" checked={podglad.nasz} onChange={(e) => ustaw({ nasz: e.target.checked })} /> To jest NASZ gang (porównujemy do niego pozostałe)
        </label>
      )}
      {podglad.uwagi.map((u, i) => <div key={i} style={{ fontSize: 11, color: "#fa0", marginBottom: 3 }}>⚠️ {u}</div>)}
      <div style={{ fontSize: 12, margin: "6px 0", color: kontrola.zgodnaSuma === true ? "#0c6" : kontrola.zgodnaSuma === false ? "#f55" : "#fa0" }}>
        Suma poziomów graczy: <b>{fmt(kontrola.sumaLvl)}</b>{podglad.moc ? <> · moc w nagłówku: <b>{fmt(Number(podglad.moc))}</b> {kontrola.zgodnaSuma ? "✅ zgadza się" : "❌ różnica " + znak(kontrola.sumaLvl - Number(podglad.moc)) + fmt(Math.abs(kontrola.sumaLvl - Number(podglad.moc)))}</> : null}
      </div>
      {kontrola.bledy.map((b, i) => <div key={i} style={{ fontSize: 11, color: "#f55", marginBottom: 3 }}>❌ {b}</div>)}
      {kontrola.ostrzezenia.map((b, i) => <div key={i} style={{ fontSize: 11, color: "#fa0", marginBottom: 3 }}>⚠️ {b}</div>)}
      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ color: "var(--muted)", textAlign: "left" }}><th style={{ padding: 4 }}>#</th><th>Nick</th><th>Poziom</th><th></th></tr></thead>
          <tbody>
            {podglad.gracze.map((g, i) => (
              <tr key={i} style={{ background: kontrola.podejrzane.has(g.m) ? "rgba(255,170,0,0.12)" : "transparent" }}>
                <td style={{ padding: 3, color: "#888" }}>{g.m}</td>
                <td><input value={g.n} onChange={(e) => ustawGracza(i, { n: e.target.value })} style={{ ...pole, width: "100%", minWidth: 130 }} /></td>
                <td><input type="number" value={g.l} onChange={(e) => ustawGracza(i, { l: parseInt(e.target.value) || 0 })} style={{ ...pole, width: 80 }} /></td>
                <td><button onClick={() => ustaw({ gracze: podglad.gracze.filter((_, k) => k !== i) })} style={{ background: "none", border: "none", color: "#f5544488", cursor: "pointer" }}>🗑</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={() => ustaw({ gracze: [...podglad.gracze, { m: podglad.gracze.length + 1, n: "", l: 0 }] })} style={{ ...przycisk("150,150,150"), marginTop: 6, padding: "4px 10px" }}>+ dodaj gracza</button>
      {kontrola.bledy.length > 0 && (
        <label style={{ fontSize: 11, color: "#fa0", display: "block", marginTop: 10 }}>
          <input type="checkbox" checked={mimoBledow} onChange={(e) => setMimoBledow(e.target.checked)} /> Zapisz mimo błędów (wiem, że dane mogą być niepełne)
        </label>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={() => onZapisz(kontrola)} disabled={!mozeZapisac || zapisuje} style={{ ...przycisk("0,200,100", !mozeZapisac || zapisuje), flex: 1 }}>{zapisuje ? "⏳ Zapisuję..." : "✅ Zapisz zdjęcie stanu"}</button>
        <button onClick={onAnuluj} style={przycisk("255,85,85")}>Anuluj</button>
      </div>
    </div>
  );
}

// ---------- szczegóły jednego gangu ----------
function SzczegolyGangu({ gang, isAdmin, onUsunSnapshot, onUsunGang, onOznaczNasz }) {
  const s = L.posortowane(gang);
  const ostatni = s[s.length - 1];
  const poprz = s.length > 1 ? s[s.length - 2] : null;
  const roznica = ostatni && poprz ? L.porownaj(poprz, ostatni) : null;
  return (
    <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: 10, marginTop: 8 }}>
      {roznica ? (
        <div style={{ fontSize: 12, marginBottom: 10 }}>
          <div style={{ marginBottom: 6 }}>
            Zmiana {fmtData(poprz.ts)} → {fmtData(ostatni.ts)}: moc <b style={{ color: kolorDelta(roznica.deltaMoc) }}>{znak(roznica.deltaMoc)}{fmt(Math.abs(roznica.deltaMoc))}</b>
          </div>
          {roznica.nowi.length > 0 && <div style={{ color: "#0c6", marginBottom: 3 }}>➕ Nowi: {roznica.nowi.map((x) => `${x.n} (${fmt(x.l)})`).join(", ")}</div>}
          {roznica.odeszli.length > 0 && <div style={{ color: "#f55", marginBottom: 3 }}>➖ Odeszli: {roznica.odeszli.map((x) => `${x.n} (${fmt(x.l)})`).join(", ")}</div>}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 6 }}>
            <thead><tr style={{ color: "var(--muted)", textAlign: "left" }}><th>Gracz</th><th>Było</th><th>Jest</th><th>Przyrost</th></tr></thead>
            <tbody>
              {[...roznica.zmiany].sort((a, b) => b.delta - a.delta).map((z, i) => (
                <tr key={i}>
                  <td style={{ padding: "2px 0" }}>{z.nick}{!z.pewne && <span title="dopasowanie niepewne (inna pisownia nicku)" style={{ color: "#fa0" }}> ?</span>}</td>
                  <td>{fmt(z.bylo)}</td><td>{fmt(z.jest)}</td>
                  <td style={{ color: kolorDelta(z.delta), fontWeight: "bold" }}>{znak(z.delta)}{fmt(Math.abs(z.delta))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Jedno zdjęcie stanu — po kolejnym wgraniu zobaczysz zmiany.</div>}
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Historia zdjęć stanu:</div>
      {[...s].reverse().map((x, i, arr) => {
        const nastepny = arr[i + 1];
        const d = nastepny ? L.mocSnapshotu(x) - L.mocSnapshotu(nastepny) : null;
        return (
          <div key={x.data} style={{ display: "flex", gap: 10, fontSize: 12, padding: "2px 0", alignItems: "center" }}>
            <span style={{ width: 70 }}>{fmtData(x.ts)}</span>
            <span style={{ width: 80 }}>{fmt(L.mocSnapshotu(x))}</span>
            <span style={{ width: 70, color: d == null ? "#555" : kolorDelta(d) }}>{d == null ? "" : `${znak(d)}${fmt(Math.abs(d))}`}</span>
            <span style={{ color: "#555", fontSize: 10 }}>{(x.gracze || []).length} graczy</span>
            {isAdmin && <button onClick={() => onUsunSnapshot(x.data)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#f5544488", cursor: "pointer" }}>🗑</button>}
          </div>
        );
      })}
      {isAdmin && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {!gang.nasz && <button onClick={onOznaczNasz} style={przycisk("255,215,0")}>⭐ To nasz gang</button>}
          <button onClick={onUsunGang} style={przycisk("255,85,85")}>🗑 Usuń gang i całą historię</button>
        </div>
      )}
    </div>
  );
}

// ---------- pojedynki: miejsce 1 vs miejsce 1, 2 vs 2... ----------
function Pojedynki({ nasz, rywal, odTs }) {
  const sn = (g) => L.posortowane(g);
  const ostN = sn(nasz).slice(-1)[0], ostR = sn(rywal).slice(-1)[0];
  if (!ostN || !ostR) return null;
  const rank = (s) => [...(s.gracze || [])].sort((a, b) => b.l - a.l);
  const start = (g) => { const x = sn(g); if (!odTs) return x.length > 1 ? x[0] : null; return x.find((y) => y.ts >= odTs) || null; };
  const sN = start(nasz), sR = start(rywal);
  const pN = sN && sN.ts < ostN.ts ? rank(sN) : null;
  const pR = sR && sR.ts < ostR.ts ? rank(sR) : null;
  const a = rank(ostN), b = rank(ostR);
  const n = Math.max(a.length, b.length);
  const wiersze = [];
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    wiersze.push({ i: i + 1, x, y, dx: x && pN && pN[i] ? x.l - pN[i].l : null, dy: y && pR && pR[i] ? y.l - pR[i].l : null });
  }
  const wygrane = wiersze.filter((w) => w.x && w.y && w.x.l > w.y.l).length;
  const przegrane = wiersze.filter((w) => w.x && w.y && w.x.l < w.y.l).length;
  return (
    <div style={karta}>
      <div style={{ fontSize: 13, fontWeight: "bold", color: "var(--accent)", marginBottom: 4 }}>⚔️ Pojedynki: miejsce do miejsca</div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
        {nasz.nazwa} ({fmtData(ostN.ts)}) vs {rywal.nazwa} ({fmtData(ostR.ts)}). Wyżej u nas: <b style={{ color: "#0c6" }}>{wygrane}</b>, wyżej u nich: <b style={{ color: "#f55" }}>{przegrane}</b>.
        {pN || pR ? " Przyrost „Δ” liczony od początku okresu." : " Przyrost pojawi się po kolejnym zdjęciu stanu."}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead><tr style={{ color: "var(--muted)", textAlign: "left" }}><th>#</th><th>My</th><th>Lvl</th><th>Δ</th><th>Oni</th><th>Lvl</th><th>Δ</th><th>Różnica</th></tr></thead>
          <tbody>
            {wiersze.map((w) => {
              const r = w.x && w.y ? w.x.l - w.y.l : null;
              return (
                <tr key={w.i} style={{ borderTop: "1px solid #12122a" }}>
                  <td style={{ padding: "3px 0", color: "#888" }}>{w.i}</td>
                  <td>{w.x ? w.x.n : "—"}</td><td>{w.x ? fmt(w.x.l) : ""}</td>
                  <td style={{ color: w.dx == null ? "#555" : kolorDelta(w.dx) }}>{w.dx == null ? "" : znak(w.dx) + fmt(Math.abs(w.dx))}</td>
                  <td>{w.y ? w.y.n : "—"}</td><td>{w.y ? fmt(w.y.l) : ""}</td>
                  <td style={{ color: w.dy == null ? "#555" : kolorDelta(w.dy) }}>{w.dy == null ? "" : znak(w.dy) + fmt(Math.abs(w.dy))}</td>
                  <td style={{ color: r == null ? "#555" : kolorDelta(r), fontWeight: "bold" }}>{r == null ? "" : znak(r) + fmt(Math.abs(r))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- krzywa dzwonowa poziomów w gangu ----------
function KrzywaDzwonowa({ gang }) {
  const [wybrany, setWybrany] = useState("");
  const s = L.posortowane(gang);
  const ost = s[s.length - 1];
  const gracze = ost ? ost.gracze || [] : [];
  if (gracze.length < 3) return null;
  const lv = gracze.map((g) => g.l);
  const sr = lv.reduce((a, b) => a + b, 0) / lv.length;
  const sd = Math.sqrt(lv.reduce((a, b) => a + (b - sr) ** 2, 0) / lv.length) || 1;
  const W = 640, H = 220, P = 24;
  const xmin = sr - 3.2 * sd, xmax = sr + 3.2 * sd;
  const sx = (v) => P + ((v - xmin) / (xmax - xmin)) * (W - 2 * P);
  const gest = (v) => Math.exp(-0.5 * ((v - sr) / sd) ** 2);
  const sy = (g) => H - 34 - g * (H - 70);
  const pkt = [];
  for (let i = 0; i <= 80; i++) { const v = xmin + ((xmax - xmin) * i) / 80; pkt.push(`${sx(v)},${sy(gest(v))}`); }
  const sel = gracze.find((g) => g.n === wybrany);
  const z = sel ? (sel.l - sr) / sd : null;
  const wyzej = sel ? gracze.filter((g) => g.l < sel.l).length : 0;
  const opis = z == null ? "" : z > 1.5 ? "🚀 daleko ponad średnią gangu" : z > 0.5 ? "💪 powyżej średniej" : z > -0.5 ? "😐 idealnie w środku dzwonu" : z > -1.5 ? "🐌 poniżej średniej" : "🦥 ogon rozkładu";
  return (
    <div style={karta}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: "bold", color: "var(--accent)" }}>🔔 Krzywa dzwonowa</div>
        <select value={wybrany} onChange={(e) => setWybrany(e.target.value)} style={pole}>
          <option value="">— wybierz gracza —</option>
          {gracze.map((g) => <option key={g.n} value={g.n}>{g.n}</option>)}
        </select>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        <polyline fill="rgba(255,215,0,0.12)" stroke="#ffd700" strokeWidth="2.5" points={`${sx(xmin)},${sy(0)} ${pkt.join(" ")} ${sx(xmax)},${sy(0)}`} />
        <line x1={sx(sr)} x2={sx(sr)} y1={sy(1)} y2={sy(0)} stroke="#888" strokeDasharray="4 3" />
        <text x={sx(sr)} y={H - 6} fill="#888" fontSize="10" textAnchor="middle">średnia {fmt(sr)}</text>
        {gracze.map((g, i) => <circle key={i} cx={sx(g.l)} cy={sy(0) - 6 - (i % 3) * 8} r="4" fill={g.n === wybrany ? "#ff4d6d" : "#4db8ff"} opacity={g.n === wybrany ? 1 : 0.7} />)}
        {sel && <text x={Math.min(Math.max(sx(sel.l), 60), W - 60)} y={sy(gest(sel.l)) - 8} fill="#ff4d6d" fontSize="12" fontWeight="bold" textAnchor="middle">{sel.n}</text>}
      </svg>
      {sel ? (
        <div style={{ fontSize: 12, marginTop: 6 }}>
          <b>{sel.n}</b>: lvl {fmt(sel.l)}, odchylenie od średniej {z >= 0 ? "+" : ""}{z.toFixed(2)} σ, wyprzedza {wyzej} z {gracze.length - 1} osób — {opis}
        </div>
      ) : <div style={{ fontSize: 11, color: "#666", marginTop: 6 }}>Wybierz zastępcę z listy, żeby zobaczyć, gdzie siedzi na dzwonie 😄</div>}
    </div>
  );
}

export default function GangiView({ isAdmin }) {
  const [gangi, setGangi] = useState({});
  const [pliki, setPliki] = useState([]);
  const [analizuje, setAnalizuje] = useState(false);
  const [postep, setPostep] = useState("");
  const [podglad, setPodglad] = useState(null);
  const [zapisuje, setZapisuje] = useState(false);
  const [okresOd, setOkresOd] = useState("");
  const [wzgledne, setWzgledne] = useState(true);
  const [otwarty, setOtwarty] = useState(null);
  const [rywalId, setRywalId] = useState("");

  useEffect(() => subscribePorownanie(setGangi), []);

  const lista = useMemo(() => Object.values(gangi), [gangi]);
  const odTs = okresOd ? L.dataNaTs(okresOd) : null;
  const najnowszyTs = useMemo(() => Math.max(0, ...lista.flatMap((g) => L.posortowane(g).map((s) => s.ts))), [lista]);

  const wiersze = useMemo(() => lista.map((g, i) => {
    const s = L.posortowane(g);
    const ost = s[s.length - 1];
    return { g, kolor: g.nasz ? NASZ_KOLOR : KOLORY[i % KOLORY.length], moc: ost ? L.mocSnapshotu(ost) : null, ostTs: ost?.ts, zdjec: s.length, w: L.wzrostOkresu(g, odTs), czlonkow: ost ? (ost.gracze || []).length : 0 };
  }).sort((a, b) => (b.moc || 0) - (a.moc || 0)), [lista, odTs]);

  const serie = useMemo(() => wiersze.map((w) => ({ id: w.g.id, nasz: w.g.nasz, kolor: w.kolor, nazwa: w.g.nazwa, punkty: L.serieDoWykresu(w.g, odTs, wzgledne) })).filter((s) => s.punkty.length > 0), [wiersze, odTs, wzgledne]);

  const nasz = wiersze.find((w) => w.g.nasz);
  const rywale = wiersze.filter((w) => !w.g.nasz && w.w);
  const sredniaRywali = rywale.length ? rywale.reduce((s, w) => s + w.w.pct, 0) / rywale.length : null;
  const ranking = nasz?.w ? [...wiersze].filter((w) => w.w).sort((a, b) => b.w.pct - a.w.pct) : [];
  const miejsceTempa = nasz?.w ? ranking.findIndex((w) => w.g.nasz) + 1 : null;

  const analizuj = async () => {
    if (!pliki.length) return;
    setAnalizuje(true);
    const odczyty = [];
    const uwagi = [];
    for (let i = 0; i < pliki.length; i++) {
      setPostep(`🤖 Czytam screen ${i + 1} z ${pliki.length}...`);
      try { odczyty.push(await odczytajScreen(pliki[i], setPostep)); }
      catch (e) { uwagi.push(`Nie udało się odczytać screena ${i + 1} (${pliki[i].name}): ${e.message}`); }
    }
    setPostep("");
    setAnalizuje(false);
    if (!odczyty.length) { alert("❌ Nie udało się odczytać żadnego screena.\n" + uwagi.join("\n")); return; }
    const scal = L.scalOdczyty(odczyty);
    const istn = L.znajdzGang(gangi, scal.nazwa);
    setPodglad({
      gangId: istn ? istn.id : "nowy", nazwa: istn ? istn.nazwa : scal.nazwa, nasz: false,
      data: L.dzisiajISO(), moc: scal.moc, liczba: scal.liczba, dywizja: scal.dywizja,
      gracze: scal.gracze, uwagi: [...uwagi, ...scal.uwagi],
    });
    setPliki([]);
  };

  const zapisz = async (kontrola) => {
    setZapisuje(true);
    const istn = podglad.gangId !== "nowy" ? gangi[podglad.gangId] : null;
    const ts = L.dataNaTs(podglad.data);
    const snap = {
      data: podglad.data, ts, moc: Number(podglad.moc) || null, mocZLvl: kontrola.sumaLvl, dywizja: podglad.dywizja || null,
      liczba: Number(podglad.liczba) || podglad.gracze.length,
      gracze: podglad.gracze.map((g, i) => ({ m: i + 1, n: g.n.trim(), l: g.l })),
      zgodnaSuma: kontrola.zgodnaSuma === true,
    };
    const id = istn ? istn.id : `${L.normNazwa(podglad.nazwa).slice(0, 24) || "gang"}_${Date.now().toString(36)}`;
    const poprzednie = (istn?.snapshoty || []).filter((x) => x.data !== snap.data);
    const gang = { id, nazwa: podglad.nazwa.trim(), nasz: istn ? !!istn.nasz : !!podglad.nasz, snapshoty: [...poprzednie, snap].sort((a, b) => a.ts - b.ts) };
    // tylko jeden gang może być "nasz"
    if (gang.nasz) await Promise.all(Object.values(gangi).filter((g) => g.nasz && g.id !== id).map((g) => zapiszGangPorownanie({ ...g, nasz: false })));
    const ok = await zapiszGangPorownanie(gang);
    setZapisuje(false);
    if (ok) { setPodglad(null); setOtwarty(id); } else alert("❌ Nie udało się zapisać. Spróbuj ponownie.");
  };

  const usunSnapshot = async (g, data) => {
    if (!window.confirm(`Usunąć zdjęcie stanu z ${data} (${g.nazwa})?`)) return;
    const reszta = g.snapshoty.filter((x) => x.data !== data);
    if (!reszta.length) { await usunGangPorownanie(g.id); return; }
    await zapiszGangPorownanie({ ...g, snapshoty: reszta });
  };

  const usunGang = async (g) => {
    if (!window.confirm(`Usunąć gang „${g.nazwa}” razem z całą historią (${g.snapshoty.length} zdjęć stanu)? Tego nie da się cofnąć.`)) return;
    await usunGangPorownanie(g.id);
    setOtwarty(null);
  };

  const oznaczNasz = async (g) => {
    await Promise.all(lista.filter((x) => x.nasz && x.id !== g.id).map((x) => zapiszGangPorownanie({ ...x, nasz: false })));
    await zapiszGangPorownanie({ ...g, nasz: true });
  };

  const ustawOkres = (dni) => {
    if (!dni) { setOkresOd(""); return; }
    const t = new Date(najnowszyTs - dni * 86400000);
    const p = (x) => String(x).padStart(2, "0");
    setOkresOd(`${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`);
  };

  return (
    <div>
      <div style={{ ...karta, background: "rgba(255,215,0,0.05)", border: "1px solid #b8860b55" }}>
        <div style={{ fontSize: 15, fontWeight: "bold", color: "var(--accent)", marginBottom: 4 }}>📈 Porównanie gangów</div>
        <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
          Wgrywaj screeny listy członków (zakładka CZŁONKOWIE) top gangów oraz naszego, mniej więcej raz w tygodniu. Moc gangu to suma poziomów graczy —
          aplikacja sprawdza to przy każdym zdjęciu stanu i pokazuje, jak szybko rośniemy względem rywali.
        </div>
      </div>

      {isAdmin && !podglad && (
        <div style={karta}>
          <div style={{ fontSize: 13, fontWeight: "bold", color: "#4db8ff", marginBottom: 6 }}>📤 Nowe zdjęcie stanu gangu</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>Wgraj 2–3 screeny jednego gangu (miejsca 1–20 w całości). Kolejność dowolna.</div>
          <input type="file" accept="image/*" multiple disabled={analizuje} onChange={(e) => setPliki([...e.target.files])}
            style={{ width: "100%", padding: 8, background: "var(--card-solid)", border: "1px solid #333", borderRadius: 6, color: "#fff", fontSize: 12, boxSizing: "border-box" }} />
          <button onClick={analizuj} disabled={!pliki.length || analizuje} style={{ ...przycisk("77,184,255", !pliki.length || analizuje), width: "100%", marginTop: 8 }}>
            {analizuje ? "⏳ Analizuję..." : `🤖 Odczytaj ${pliki.length || ""} ${pliki.length === 1 ? "screen" : "screeny"}`}
          </button>
          {postep && <div style={{ fontSize: 11, color: "#4db8ff", marginTop: 6 }}>{postep}</div>}
        </div>
      )}

      {podglad && <PodgladStanu podglad={podglad} setPodglad={setPodglad} gangi={gangi} onZapisz={zapisz} onAnuluj={() => setPodglad(null)} zapisuje={zapisuje} />}

      {lista.length === 0 ? (
        <div style={{ textAlign: "center", padding: 30, color: "#666", fontSize: 13 }}>Brak danych. Wgraj pierwszy screen gangu (najlepiej od razu naszego i 2–3 gangów do porównania).</div>
      ) : (
        <>
          <div style={karta}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Okres od:</span>
              <input type="date" value={okresOd} onChange={(e) => setOkresOd(e.target.value)} style={pole} />
              {[[0, "od początku"], [7, "7 dni"], [14, "14 dni"], [30, "30 dni"]].map(([d, t]) => (
                <button key={d} onClick={() => ustawOkres(d)} style={{ ...przycisk("150,150,150"), padding: "4px 10px" }}>{t}</button>
              ))}
            </div>
            {nasz?.w && (
              <div style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 10, padding: 10, background: "rgba(255,215,0,0.07)", borderRadius: 8 }}>
                ⭐ <b>My:</b> {znak(nasz.w.delta)}{fmt(Math.abs(nasz.w.delta))} ({znak(nasz.w.pct)}{Math.abs(nasz.w.pct).toFixed(2)}%), ok. {fmt(nasz.w.naTydzien)} na tydzień
                {sredniaRywali != null && <> · średnia rywali: {znak(sredniaRywali)}{Math.abs(sredniaRywali).toFixed(2)}% ({nasz.w.pct >= sredniaRywali ? "rośniemy szybciej o " : "rośniemy wolniej o "}<b style={{ color: nasz.w.pct >= sredniaRywali ? "#0c6" : "#f55" }}>{Math.abs(nasz.w.pct - sredniaRywali).toFixed(2)} p.p.</b>)</>}
                {miejsceTempa ? <> · tempo wzrostu: miejsce <b>{miejsceTempa}</b> z {ranking.length}</> : null}
              </div>
            )}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ color: "var(--muted)", textAlign: "left", fontSize: 11 }}>
                    <th style={{ padding: "4px 0" }}>Gang</th><th>Moc</th><th>Przyrost</th><th>%</th><th>/ tydz.</th><th>Zdjęć</th><th>Ostatnie</th>
                  </tr>
                </thead>
                <tbody>
                  {wiersze.map((w) => (
                    <tr key={w.g.id} onClick={() => setOtwarty(otwarty === w.g.id ? null : w.g.id)} style={{ cursor: "pointer", background: w.g.nasz ? "rgba(255,215,0,0.07)" : "transparent", borderTop: "1px solid #12122a" }}>
                      <td style={{ padding: "6px 0" }}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: w.kolor, marginRight: 6 }} />{w.g.nasz ? "⭐ " : ""}{w.g.nazwa}</td>
                      <td>{fmt(w.moc)}</td>
                      <td style={{ color: w.w ? kolorDelta(w.w.delta) : "#555" }}>{w.w ? `${znak(w.w.delta)}${fmt(Math.abs(w.w.delta))}` : "—"}</td>
                      <td style={{ color: w.w ? kolorDelta(w.w.pct) : "#555" }}>{w.w ? `${znak(w.w.pct)}${Math.abs(w.w.pct).toFixed(2)}%` : "—"}</td>
                      <td>{w.w ? fmt(w.w.naTydzien) : "—"}</td>
                      <td>{w.zdjec}</td>
                      <td style={{ color: "#888" }}>{w.ostTs ? fmtData(w.ostTs) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 10, color: "#555", marginTop: 6 }}>Przyrost liczony od początku okresu (przy braku zdjęcia dokładnie w tym dniu — z interpolacji między zdjęciami) do ostatniego zdjęcia danego gangu. „/ tydz.” przelicza różne rozstawy zdjęć na wspólną skalę.</div>
          </div>

          <div style={karta}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: "bold", color: "var(--accent)" }}>Siła gangów w czasie</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setWzgledne(true)} style={{ ...przycisk("150,150,150", false), padding: "4px 10px", opacity: wzgledne ? 1 : 0.5 }}>wzrost %</button>
                <button onClick={() => setWzgledne(false)} style={{ ...przycisk("150,150,150", false), padding: "4px 10px", opacity: wzgledne ? 0.5 : 1 }}>moc</button>
              </div>
            </div>
            <Wykres serie={serie} wzgledne={wzgledne} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6, fontSize: 11 }}>
              {serie.map((s) => <span key={s.id} style={{ color: s.kolor }}>● {s.nasz ? "⭐ " : ""}{s.nazwa}</span>)}
            </div>
            <div style={{ fontSize: 10, color: "#555", marginTop: 6 }}>{wzgledne ? "Wykres „wzrost %” pokazuje tempo względem startu okresu — pozwala uczciwie porównać gangi o bardzo różnej mocy." : "Wykres „moc” pokazuje bezwzględną siłę gangów."}</div>
          </div>

          {nasz && lista.length > 1 && (
            <>
              <div style={{ ...karta, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Porównaj nasz gang 1:1 z: </span>
                <select value={rywalId} onChange={(e) => setRywalId(e.target.value)} style={pole}>
                  <option value="">— wybierz gang —</option>
                  {lista.filter((g) => !g.nasz).map((g) => <option key={g.id} value={g.id}>{g.nazwa}</option>)}
                </select>
              </div>
              {rywalId && gangi[rywalId] && <Pojedynki nasz={nasz.g} rywal={gangi[rywalId]} odTs={odTs} />}
            </>
          )}
          {nasz && <KrzywaDzwonowa gang={nasz.g} />}

          {otwarty && gangi[otwarty] && (
            <div style={karta}>
              <div style={{ fontSize: 13, fontWeight: "bold", color: "var(--accent)" }}>{gangi[otwarty].nasz ? "⭐ " : ""}{gangi[otwarty].nazwa}</div>
              <SzczegolyGangu gang={gangi[otwarty]} isAdmin={isAdmin}
                onUsunSnapshot={(data) => usunSnapshot(gangi[otwarty], data)}
                onUsunGang={() => usunGang(gangi[otwarty])}
                onOznaczNasz={() => oznaczNasz(gangi[otwarty])} />
            </div>
          )}
          {!otwarty && <div style={{ fontSize: 11, color: "#555", textAlign: "center" }}>Kliknij gang w tabeli, żeby zobaczyć zmiany graczy i historię.</div>}
        </>
      )}
    </div>
  );
}
