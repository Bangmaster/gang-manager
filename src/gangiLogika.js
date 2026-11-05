// Logika porównania gangów — czyste funkcje (bez Reacta i Firebase), łatwe do przetestowania.
// Dane: gang = { id, nazwa, nasz, snapshoty:[{ data:"2026-11-05", ts, moc, mocZLvl, dywizja, liczba, gracze:[{m,n,l}] }] }

const DZIEN = 86400000;

export function dataNaTs(data) {
  const t = Date.parse(`${data}T12:00:00`);
  return Number.isFinite(t) ? t : null;
}

export function dzisiajISO() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Normalizacja nazw: bez wielkości liter, diakrytyków, spacji i ozdobników (☆, ★, ™ itp.), zostają litery i cyfry
export function normNazwa(s) {
  return String(s || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/ł/gi, "l")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function odlegloscEdycyjna(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let poprz = Array.from({ length: n + 1 }, (_, k) => k);
  for (let x = 1; x <= m; x++) {
    const biez = [x];
    for (let y = 1; y <= n; y++) {
      biez[y] = Math.min(poprz[y] + 1, biez[y - 1] + 1, poprz[y - 1] + (a[x - 1] === b[y - 1] ? 0 : 1));
    }
    poprz = biez;
  }
  return poprz[n];
}

function podobienstwo(a, b) {
  const x = normNazwa(a), y = normNazwa(b);
  const dl = Math.max(x.length, y.length);
  if (!dl) return 1;                       // obie puste: brak informacji
  return odlegloscEdycyjna(x, y) / dl;     // 0 = identyczne, 1 = zupełnie różne
}

// ---------- scalanie odczytów z kilku screenów ----------
// Wejście: tablica odczytów { gang:{nazwa,dywizja,moc,czlonkow,max}, gracze:[{miejsce,nazwa,poziom}] }
export function scalOdczyty(odczyty) {
  const ok = odczyty.filter(Boolean);
  const naglowki = ok.map((o) => o.gang || {});
  const nazwy = naglowki.map((g) => g.nazwa).filter(Boolean);
  const mocs = naglowki.map((g) => Number(g.moc)).filter((x) => Number.isFinite(x) && x > 0);
  const mocPopularna = mocs.sort((a, b) => a - b)[Math.floor(mocs.length / 2)] || null;
  const uwagi = [];
  if (new Set(mocs).size > 1) uwagi.push(`Na screenach odczytano różne wartości mocy gangu: ${[...new Set(mocs)].join(", ")}. Sprawdź nagłówek.`);
  const poMiejscu = new Map();
  ok.forEach((o) => (o.gracze || []).forEach((g) => {
    const m = Number(g.miejsce);
    if (!Number.isInteger(m) || m < 1) return;
    const wiersz = { m, n: String(g.nazwa || "").trim(), l: Math.round(Number(g.poziom)) || 0 };
    const stary = poMiejscu.get(m);
    if (!stary) poMiejscu.set(m, wiersz);
    else if (stary.l !== wiersz.l || normNazwa(stary.n) !== normNazwa(wiersz.n)) {
      uwagi.push(`Miejsce ${m} odczytano różnie na dwóch screenach (${stary.n} ${stary.l} / ${wiersz.n} ${wiersz.l}). Wybrano pierwszy odczyt.`);
    }
  }));
  const gracze = [...poMiejscu.values()].sort((a, b) => a.m - b.m);
  const g0 = naglowki.find((g) => g.nazwa) || {};
  return {
    nazwa: nazwy[0] || "",
    dywizja: Number(g0.dywizja) || null,
    moc: mocPopularna,
    liczba: Number(g0.czlonkow) || null,
    max: Number(g0.max) || null,
    gracze, uwagi,
  };
}

// ---------- kontrola poprawności zdjęcia stanu ----------
// Zwraca { bledy:[], ostrzezenia:[], podejrzane:Set<miejsce>, sumaLvl, zgodnaSuma }
export function sprawdzSnapshot(sn, poprzedni = null) {
  const bledy = [], ostrzezenia = [];
  const podejrzane = new Set();
  const g = [...(sn.gracze || [])].sort((a, b) => a.m - b.m);
  const sumaLvl = g.reduce((s, x) => s + (Number(x.l) || 0), 0);
  // 1. kolejne miejsca 1..N bez dziur
  g.forEach((x, i) => { if (x.m !== i + 1) { bledy.push(`Brak miejsca ${i + 1} (są miejsca: ${g.map((y) => y.m).join(", ")}). Wgraj brakujący screen.`); } });
  const dziury = bledy.length > 0;
  // 2. liczba graczy zgodna z nagłówkiem
  if (sn.liczba && g.length !== sn.liczba) bledy.push(`Odczytano ${g.length} graczy, a gang ma ${sn.liczba}.`);
  // 3. poziomy nie rosną wraz z miejscem (ranking jest po poziomie malejąco)
  for (let i = 1; i < g.length; i++) {
    if (g[i].l > g[i - 1].l) {
      podejrzane.add(g[i].m); podejrzane.add(g[i - 1].m);
      ostrzezenia.push(`Poziom na miejscu ${g[i].m} (${g[i].l}) jest wyższy niż na miejscu ${g[i - 1].m} (${g[i - 1].l}) — któryś odczyt jest błędny.`);
    }
  }
  // 4. suma poziomów = moc gangu
  let zgodnaSuma = null;
  const niepelne = dziury || (sn.liczba && g.length !== sn.liczba);
  if (sn.moc) {
    zgodnaSuma = sumaLvl === sn.moc;
    if (!zgodnaSuma) {
      const roz = sumaLvl - sn.moc;
      (niepelne ? ostrzezenia : bledy).push(`Suma poziomów (${sumaLvl}) nie zgadza się z mocą gangu (${sn.moc}), różnica ${roz > 0 ? "+" : ""}${roz}. Najpewniej źle odczytany jeden poziom.`);
    }
  } else {
    ostrzezenia.push("Nie odczytano mocy gangu z nagłówka — nie da się sprawdzić sumy poziomów.");
  }
  // 5. względem poprzedniego zdjęcia stanu: poziom gracza nie może spaść
  if (poprzedni) {
    const p = porownaj(poprzedni, sn);
    p.zmiany.forEach((z) => {
      if (z.delta < 0) { podejrzane.add(z.m); ostrzezenia.push(`${z.nick}: poziom spadł z ${z.bylo} do ${z.jest} — prawdopodobnie błędny odczyt.`); }
    });
  }
  return { bledy, ostrzezenia, podejrzane, sumaLvl, zgodnaSuma };
}

// ---------- porównanie dwóch zdjęć stanu tego samego gangu ----------
// Zwraca { zmiany:[{nick,m,bylo,jest,delta,pewne}], nowi:[{n,l,m}], odeszli:[{n,l,m}], deltaMoc }
export function porownaj(stare, nowe) {
  const A = (stare.gracze || []).map((x, i) => ({ ...x, i, uzyty: false }));
  const B = (nowe.gracze || []).map((x, i) => ({ ...x, i, uzyty: false }));
  const pary = [];
  const polacz = (a, b, pewne) => { a.uzyty = b.uzyty = true; pary.push({ a, b, pewne }); };

  // przebieg 1: identyczna znormalizowana nazwa (przy kilku takich samych — najbliższy poziom)
  B.forEach((b) => {
    if (b.uzyty) return;
    const nb = normNazwa(b.n);
    if (!nb) return;
    const kand = A.filter((a) => !a.uzyty && normNazwa(a.n) === nb).sort((x, y) => Math.abs(x.l - b.l) - Math.abs(y.l - b.l));
    if (kand.length) polacz(kand[0], b, true);
  });
  // przebieg 2: podobna nazwa (literówki OCR), pewne tylko gdy poziom nie spadł
  const kandydaci = [];
  B.forEach((b) => { if (!b.uzyty) A.forEach((a) => { if (!a.uzyty) {
    const d = podobienstwo(a.n, b.n);
    if (d <= 0.25) kandydaci.push({ a, b, d, gain: b.l - a.l });
  } }); });
  kandydaci.sort((x, y) => x.d - y.d || Math.abs(x.gain) - Math.abs(y.gain));
  kandydaci.forEach((c) => { if (!c.a.uzyty && !c.b.uzyty) polacz(c.a, c.b, c.gain >= 0); });
  // przebieg 3: nazwy niepodobne, ale poziom zgodny (wzrost 0..250) — pozostałe pary, oznaczone jako niepewne
  const kand3 = [];
  B.forEach((b) => { if (!b.uzyty) A.forEach((a) => { if (!a.uzyty) {
    const gain = b.l - a.l;
    if (gain >= 0 && gain <= 250 && podobienstwo(a.n, b.n) <= 0.6) kand3.push({ a, b, gain });
  } }); });
  kand3.sort((x, y) => x.gain - y.gain);
  kand3.forEach((c) => { if (!c.a.uzyty && !c.b.uzyty) polacz(c.a, c.b, false); });

  const zmiany = pary.map(({ a, b, pewne }) => ({ nick: b.n, nickPoprzedni: a.n, m: b.m, bylo: a.l, jest: b.l, delta: b.l - a.l, pewne })).sort((x, y) => x.m - y.m);
  const nowi = B.filter((b) => !b.uzyty).map((b) => ({ n: b.n, l: b.l, m: b.m }));
  const odeszli = A.filter((a) => !a.uzyty).map((a) => ({ n: a.n, l: a.l, m: a.m }));
  const moc = (s) => s.moc || (s.gracze || []).reduce((t, x) => t + x.l, 0);
  return { zmiany, nowi, odeszli, deltaMoc: moc(nowe) - moc(stare) };
}

// ---------- seria czasowa i wzrost w okresie ----------
export function mocSnapshotu(sn) {
  return sn.moc || sn.mocZLvl || (sn.gracze || []).reduce((t, x) => t + x.l, 0);
}

export function posortowane(gang) {
  return [...(gang.snapshoty || [])].map((s) => ({ ...s, ts: s.ts || dataNaTs(s.data) })).filter((s) => s.ts).sort((a, b) => a.ts - b.ts);
}

// moc w danym momencie (interpolacja liniowa); poza zakresem zwraca null
export function mocNaDzien(gang, ts) {
  const s = posortowane(gang);
  if (!s.length) return null;
  if (ts < s[0].ts || ts > s[s.length - 1].ts) return null;
  for (let i = 0; i < s.length; i++) {
    if (s[i].ts === ts) return mocSnapshotu(s[i]);
    if (s[i].ts > ts) {
      const a = s[i - 1], b = s[i];
      const t = (ts - a.ts) / (b.ts - a.ts);
      return mocSnapshotu(a) + (mocSnapshotu(b) - mocSnapshotu(a)) * t;
    }
  }
  return mocSnapshotu(s[s.length - 1]);
}

// wzrost od momentu odTs do ostatniego zdjęcia; gdy odTs jest przed pierwszym zdjęciem, liczy od pierwszego
export function wzrostOkresu(gang, odTs) {
  const s = posortowane(gang);
  if (s.length < 2) return null;
  const pierwszy = s[0], ostatni = s[s.length - 1];
  const start = odTs == null || odTs <= pierwszy.ts ? pierwszy.ts : odTs;
  if (start >= ostatni.ts) return null;
  const m0 = start === pierwszy.ts ? mocSnapshotu(pierwszy) : mocNaDzien(gang, start);
  const m1 = mocSnapshotu(ostatni);
  if (m0 == null || !m0) return null;
  const dni = (ostatni.ts - start) / DZIEN;
  return { od: start, do: ostatni.ts, dni, m0, m1, delta: m1 - m0, pct: (m1 - m0) / m0 * 100, naTydzien: dni > 0 ? (m1 - m0) / dni * 7 : 0 };
}

// punkty do wykresu: [{ts, wartosc}] — absolutne albo względne (% względem startu okresu)
export function serieDoWykresu(gang, odTs, wzgledne) {
  const s = posortowane(gang).filter((x) => odTs == null || x.ts >= odTs);
  if (!s.length) return [];
  let baza = mocSnapshotu(s[0]);
  const punkty = [];
  if (odTs != null) {
    const m = mocNaDzien(gang, odTs);
    if (m != null) { baza = m; punkty.push({ ts: odTs, wartosc: 0 }); }
  }
  s.forEach((x) => { if (!punkty.length || punkty[punkty.length - 1].ts !== x.ts) punkty.push({ ts: x.ts, wartosc: mocSnapshotu(x) }); });
  if (!wzgledne) return punkty.map((p, i) => (i === 0 && p.wartosc === 0 ? { ts: p.ts, wartosc: Math.round(baza) } : p));
  return punkty.map((p, i) => ({ ts: p.ts, wartosc: i === 0 && p.wartosc === 0 ? 0 : (p.wartosc - baza) / baza * 100 }));
}

// dopasowanie gangu po nazwie (do wskazania istniejącego gangu przy nowym screenie)
export function znajdzGang(gangi, nazwa) {
  const lista = Object.values(gangi || {});
  const nn = normNazwa(nazwa);
  if (!nn) return null;
  let naj = null, d = 1;
  lista.forEach((g) => { const x = podobienstwo(g.nazwa, nazwa); if (x < d) { d = x; naj = g; } });
  return naj && d <= 0.2 ? naj : null;
}
