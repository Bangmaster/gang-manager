// Czysta logika raportu „jak komu idzie” — bez Reacta i Firebase, żeby dało się ją przetestować.
// Tryby: "azja" = liczy się przyrost poziomów, "europa" = liczą się obrażenia w walkach (liga).
// Karty ocenia zawsze, z uwzględnieniem kręgu: postęp = zamknięte kręgi + odsetek zebranych kart w obecnym kręgu.

export const norm = (s) => String(s || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/ł/gi, "l").toLowerCase().replace(/[^a-z0-9]/g, "");

export function mediana(arr) {
  const a = arr.filter((x) => typeof x === "number" && !Number.isNaN(x)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// nick z gry („™FAM™Tatuś”, „TM FAM™ Szumi”) -> nazwa członka z aplikacji („Tatuś”, „Szumi”)
export function dopasujDoCzlonkow(nick, czlonkowie) {
  const n = norm(nick);
  if (!n) return null;
  const kand = (czlonkowie || []).map((c) => ({ nazwa: c.nazwa, k: norm(c.nazwa) })).filter((x) => x.k.length >= 3);
  const dokladne = kand.find((x) => x.k === n);
  if (dokladne) return dokladne.nazwa;
  // nick z tagiem gangu na początku kończy się nazwą członka; wygrywa najdłuższe dopasowanie
  const konc = kand.filter((x) => n.endsWith(x.k)).sort((a, b) => b.k.length - a.k.length);
  if (konc.length && (konc.length === 1 || konc[0].k.length > konc[1].k.length)) return konc[0].nazwa;
  return null;
}

// przyrosty graczy z porównywarki (mapa: znormalizowany nick -> {delta}) -> mapa nazwa członka -> przyrost
export function przyrostyDlaCzlonkow(przyrostyGraczyMapa, nickiOryginalne, czlonkowie) {
  const wynik = {};
  Object.entries(przyrostyGraczyMapa || {}).forEach(([klucz, v]) => {
    const nick = nickiOryginalne?.[klucz] || klucz;
    const c = dopasujDoCzlonkow(nick, czlonkowie);
    if (c && v && v.delta != null && v.pewne !== false) wynik[c] = v.delta;
  });
  return wynik;
}

const ts = (d) => { const t = new Date(d).getTime(); return Number.isNaN(t) ? null : t; };

// Walki z ostatnich `dni` dni liczonych od NAJNOWSZEJ walki (0 = wszystkie). Zwraca {wybrane, od, do}.
export function walkiZOkresu(walki, dni) {
  const z = (walki || []).map((w) => ({ w, t: ts(w.data) })).filter((x) => x.t != null);
  if (!z.length) return { wybrane: [], od: null, do: null };
  const doTs = Math.max(...z.map((x) => x.t));
  const od = dni ? doTs - dni * 86400000 : Math.min(...z.map((x) => x.t));
  return { wybrane: z.filter((x) => x.t >= od).map((x) => x.w), od, do: doTs };
}

// Przyrost poziomu każdego gracza w okresie, z poziomów zapisanych przy walkach (poziomAkt / poziom) — tak samo jak
// „Progres lvl” w podsumowaniu sezonu (pierwszy → ostatni poziom). Punkt startowy: ostatni znany poziom sprzed okresu
// (jeśli jest), inaczej pierwszy w okresie. Zwraca {delty: {nazwa: przyrost}, szczegoly: {nazwa: {od, do, tOd, tDo, punkty}}}.
export function przyrostyZWalk(walki, czlonkowie, odTs) {
  const punkty = {};
  const nazwyCzl = (czlonkowie || []).map((x) => x.nazwa);
  (walki || []).forEach((w, idx) => {
    const t = ts(w.data);
    if (t == null) return;
    const wWalce = {};      // jeden wpis na gracza w walce (ten sam gracz może być na dwóch screenach)
    (w.gracze || []).forEach((g) => { if (!wWalce[g.nazwa] || (g.poziomAkt || g.poziom || 0) > (wWalce[g.nazwa].poziomAkt || wWalce[g.nazwa].poziom || 0)) wWalce[g.nazwa] = g; });
    Object.values(wWalce).forEach((g) => {
      const lvl = g.poziomAkt || g.poziom;
      if (!lvl) return;
      const c = nazwyCzl.includes(g.nazwa) ? g.nazwa : dopasujDoCzlonkow(g.nazwa, czlonkowie);
      if (!c) return;
      (punkty[c] = punkty[c] || []).push({ t, lvl, idx });
    });
  });
  const delty = {}, szczegoly = {};
  Object.entries(punkty).forEach(([c, arr]) => {
    arr.sort((a, b) => a.t - b.t || a.idx - b.idx);
    const koniec = arr[arr.length - 1];
    const przed = odTs == null ? [] : arr.filter((x) => x.t < odTs);
    const wOkr = odTs == null ? arr : arr.filter((x) => x.t >= odTs);
    const start = przed.length ? przed[przed.length - 1] : wOkr[0];
    if (!start || (start.t === koniec.t && start.idx === koniec.idx) || koniec.t < (odTs ?? 0)) return;
    delty[c] = Math.max(0, koniec.lvl - start.lvl);
    szczegoly[c] = { od: start.lvl, do: koniec.lvl, tOd: start.t, tDo: koniec.t, punkty: arr.length };
  });
  return { delty, szczegoly };
}

const DOMYSLNE = { niskoRatio: 0.6, bardzoNiskoRatio: 0.35, wysokoRatio: 1.15, kartyDeficyt: 0.75, kartyPochwala: 0.5, minUdzial: 0.5 };

/**
 * @param {object} p
 *  tryb: "azja" | "europa"
 *  czlonkowie: [{nazwa, krag}]
 *  przyrosty: {nazwa: deltaLvl}                         (tryb azja)
 *  obrazenia: {nazwa: {lacznie, uczestnictwa, srednia}} (tryb europa)
 *  lacznaWalka: liczba walk branych pod uwagę           (tryb europa)
 *  karty: {nazwa: {krag, procent}}
 */
export function zbudujRaport({ tryb, czlonkowie, przyrosty = {}, obrazenia = {}, lacznaWalka = 0, karty = {}, prog = {} }) {
  const P = { ...DOMYSLNE, ...prog };
  const nazwy = (czlonkowie || []).map((c) => c.nazwa);
  const glowna = {};
  nazwy.forEach((n) => {
    if (tryb === "azja") { if (przyrosty[n] != null) glowna[n] = przyrosty[n]; }
    else if (obrazenia[n]) glowna[n] = obrazenia[n].srednia;
  });
  const medGlowna = mediana(Object.values(glowna));
  const postep = {};
  nazwy.forEach((n) => { const k = karty[n]; if (k) postep[n] = Math.max(0, (k.krag || 1) - 1) + (k.procent || 0) / 100; });
  const medKarty = mediana(Object.values(postep));

  const wiersze = nazwy.map((n) => {
    const g = glowna[n];
    const ratio = g != null && medGlowna > 0 ? g / medGlowna : null;
    const udzial = tryb === "europa" && lacznaWalka > 0 && obrazenia[n] ? obrazenia[n].uczestnictwa / lacznaWalka : null;
    const k = karty[n];
    const odchylKart = postep[n] != null ? postep[n] - medKarty : null;
    const flagi = [];
    if (ratio != null) {
      if (ratio < P.bardzoNiskoRatio) flagi.push({ typ: "slabo", tekst: tryb === "azja" ? `lvl: tylko ${Math.round(ratio * 100)}% mediany gangu` : `obrażenia: tylko ${Math.round(ratio * 100)}% mediany gangu` });
      else if (ratio < P.niskoRatio) flagi.push({ typ: "odstaje", tekst: tryb === "azja" ? `lvl: ${Math.round(ratio * 100)}% mediany gangu` : `obrażenia: ${Math.round(ratio * 100)}% mediany gangu` });
    }
    if (tryb === "europa" && lacznaWalka >= 3 && udzial != null && udzial < P.minUdzial) flagi.push({ typ: "odstaje", tekst: `obecny w ${obrazenia[n].uczestnictwa} z ${lacznaWalka} walk` });
    if (tryb === "europa" && lacznaWalka >= 3 && !obrazenia[n]) flagi.push({ typ: "slabo", tekst: `brak w ostatnich ${lacznaWalka} walkach` });
    if (odchylKart != null && odchylKart <= -P.kartyDeficyt) flagi.push({ typ: "karty", tekst: `karty: ${(-odchylKart).toFixed(1)} kręgu za medianą (K${k.krag}, ${k.procent}%)` });
    return { nazwa: n, glowna: g ?? null, ratio, udzial, karty: k ? { krag: k.krag || 1, procent: k.procent || 0, postep: postep[n], odchylenie: odchylKart } : null, flagi };
  });

  const zDanymi = wiersze.filter((w) => w.glowna != null && w.glowna > 0 && w.ratio != null);
  const pochwaly = [...zDanymi].filter((w) => w.ratio >= P.wysokoRatio).sort((a, b) => b.glowna - a.glowna).slice(0, 3);
  const kartyTop = wiersze.filter((w) => w.karty && w.karty.odchylenie != null && w.karty.odchylenie >= P.kartyPochwala).sort((a, b) => b.karty.odchylenie - a.karty.odchylenie).slice(0, 2);
  const upomnienia = wiersze.filter((w) => w.flagi.length).sort((a, b) => b.flagi.length - a.flagi.length || (a.ratio ?? 9) - (b.ratio ?? 9));
  const bezDanych = wiersze.filter((w) => w.glowna == null && !(tryb === "europa" && lacznaWalka >= 3));
  return { tryb, wiersze, pochwaly, kartyTop, upomnienia, bezDanych, medGlowna, medKarty, lacznaWalka };
}

const fmt = (n) => Math.round(n).toLocaleString("pl-PL");

export function tekstRaportu(r, opis = "") {
  const wartosc = (w) => (r.tryb === "azja" ? `+${fmt(w.glowna)} lvl` : `śr. ${fmt(w.glowna)} obr.`);
  const L = [];
  L.push(`📋 RAPORT GANGU${opis ? " — " + opis : ""}`);
  L.push(r.tryb === "azja" ? "Tryb: lvlowanie (liczy się przyrost poziomów)" : "Tryb: liga (liczą się obrażenia w walkach)");
  if (r.pochwaly.length) {
    L.push("", "🏆 NAJLEPSI:");
    r.pochwaly.forEach((w, i) => L.push(`${["🥇", "🥈", "🥉"][i]} ${w.nazwa} — ${wartosc(w)} (${Math.round(w.ratio * 100)}% mediany)`));
  }
  if (r.kartyTop.length) {
    L.push("", "🃏 KARTY — brawo:");
    r.kartyTop.forEach((w) => L.push(`• ${w.nazwa} (K${w.karty.krag}, ${w.karty.procent}%)`));
  }
  if (r.upomnienia.length) {
    L.push("", "⚠️ DO POPRAWY:");
    r.upomnienia.forEach((w) => L.push(`• ${w.nazwa}: ${w.flagi.map((f) => f.tekst).join("; ")}`));
  } else {
    L.push("", "✅ Nikt nie odstaje — dobra robota!");
  }
  L.push("", "Mediana gangu: " + (r.tryb === "azja" ? `+${fmt(r.medGlowna)} lvl` : `${fmt(r.medGlowna)} obr. na walkę`));
  return L.join("\n");
}
