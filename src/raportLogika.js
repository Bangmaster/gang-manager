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
export function zbudujRaport({ tryb, czlonkowie, przyrosty = {}, obrazenia = {}, lacznaWalka = 0, karty = {}, prog = {}, heist = 0 }) {
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
  const medKrag = Math.round(mediana(Object.values(karty).map((k) => k.krag || 1)));

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
    if (odchylKart != null && odchylKart <= -P.kartyDeficyt) flagi.push({ typ: "karty", tekst: `karty: ${(-odchylKart).toFixed(1)} kręgu za medianą (K${k.krag}, ${k.diamRazem ? `💎 ${k.diamPos}/${k.diamRazem}` : k.procent + "%"})` });
    return { nazwa: n, glowna: g ?? null, ratio, udzial, karty: k ? { krag: k.krag || 1, procent: k.procent || 0, diamPos: k.diamPos ?? null, diamRazem: k.diamRazem ?? null, postep: postep[n], odchylenie: odchylKart } : null, flagi };
  });

  const zDanymi = wiersze.filter((w) => w.glowna != null && w.glowna > 0 && w.ratio != null);
  const pochwaly = [...zDanymi].filter((w) => w.ratio >= P.wysokoRatio).sort((a, b) => b.glowna - a.glowna).slice(0, 3);
  const kartyTop = wiersze.filter((w) => w.karty && w.karty.odchylenie != null && w.karty.odchylenie >= P.kartyPochwala).sort((a, b) => b.karty.odchylenie - a.karty.odchylenie).slice(0, 2);
  const upomnienia = wiersze.filter((w) => w.flagi.length).sort((a, b) => b.flagi.length - a.flagi.length || (a.ratio ?? 9) - (b.ratio ?? 9));
  const bezDanych = wiersze.filter((w) => w.glowna == null && !(tryb === "europa" && lacznaWalka >= 3));
  return { tryb, wiersze, pochwaly, kartyTop, upomnienia, bezDanych, medGlowna, medKarty, medKrag, lacznaWalka, heist };
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

// ---------- opisy w naszym stylu (czarny humor, lekki pojazd po ambicji) ----------
// Każda osoba dostaje inny tekst (w obrębie jednego raportu żaden szablon się nie powtarza), a główne zdanie
// dotyczy tego, co ma NAJGORSZE. Teksty są neutralne co do płci. Placeholdery: {n} nick, {w} wynik, {p} % mediany,
// {med} mediana, {roz} różnica do mediany, {kr}/{mk} krąg osoby / mediana, {d} diamenty, {brak} brakujące diamenty,
// {hs} „3 Card Heisty”, {u} obecność „3 z 10”, {l} liczba walk.
const haszuj = (s) => String(s).split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const POOLE = {
  lvlZero: [
    "{n}: 0 lvl w całym okresie. To już nie lenistwo, to styl życia.",
    "{n}: 0 lvl. Stabilność godna nekrologu. Ktoś sprawdzi, czy w ogóle jeszcze gra?",
    "{n}: poziom ani drgnął, a mediana gangu to {med}. Linia EKG poziomów wygląda tu jak u denata.",
    "{n}: 0 lvl. Można by zamrozić konto i nikt nie zauważy różnicy.",
    "{n}: zero. Gang rośnie o {med} lvl na głowę, a tu wiecznie ten sam wynik. To wygląda na zasadę, nie na pecha.",
    "{n}: 0 lvl. Gra się zainstalowała, ale chyba jeszcze się nie uruchomiła.",
  ],
  lvlSlabo: [
    "{n}: {w}, czyli {p}% mediany ({med}). Rośnie tak szybko, że mech na kamieniu zrobiłby większy progres.",
    "{n}: {w} przy medianie {med}. Gra, czy trzyma aplikację otwartą, żeby ekran nie zasnął?",
    "{n}: {w}. Ambicja na poziomie lampki nocnej: świeci, ale nikomu to nie pomaga.",
    "{n}: {w} ({p}% mediany). Poziomy rosną tu z prędkością urzędu skarbowego w piątek po 14.",
    "{n}: {w}, {roz}. Matematyka jest bezlitosna, w przeciwieństwie do gangu, który jeszcze nic nie powiedział.",
    "{n}: {w} przy medianie {med}. Tempo godne ślimaka z kontuzją.",
    "{n}: {w}, {p}% normy. Gang liczy na rozwój, a tu ciągle faza wstępna.",
    "{n}: {w}. Statystycznie to błąd pomiaru, praktycznie to wizytówka.",
    "{n}: {w}, {p}% mediany. Gdyby poziomy były wzrostem, to byłby to wzrost bonsai.",
    "{n}: {w} przy medianie {med}. Do pełni gry brakuje jeszcze samej gry.",
    "{n}: {w}. Poziom podnosi się tu jak most zwodzony: raz na jakiś czas i z wielkim hałasem, a efektu brak.",
    "{n}: {w} ({p}% mediany). Wynik, który można pomylić z zerem po zaokrągleniu.",
  ],
  lvlOdstaje: [
    "{n}: {w} ({p}% mediany). Idzie do przodu, ale w tempie żałoby.",
    "{n}: {w}, {roz} niż mediana. Reszta dawno w drodze, a tu jeszcze trwa szukanie mapy.",
    "{n}: {w}, czyli {p}% mediany. Potencjał jest. Głęboko. Pod ziemią.",
    "{n}: {w} przy medianie {med}. Gra na pół gwizdka, a gwizdek też na pół.",
    "{n}: {w} ({p}%). Połowa wysiłku to jeszcze nie połowa sukcesu, to po prostu połowa.",
    "{n}: {w}, {roz}. Ambicja w trybie oszczędzania baterii.",
    "{n}: {w} przy medianie {med}. Zaangażowanie jak w grupie na WhatsAppie: obecny, ale nic z tego nie wynika.",
    "{n}: {w} ({p}% mediany). Wysiłek widać, tylko trzeba przyjść z lupą.",
    "{n}: {w}, {roz}. Wszyscy w gangu zdążyli zrobić pół kółka więcej.",
    "{n}: {w}. Tempo spaceru po deszczu, bez parasola i bez celu.",
  ],
  dmgSlabo: [
    "{n}: {w}, czyli {p}% mediany ({med}). Bije z taką siłą, że przeciwnik pewnie myślał, że to masaż.",
    "{n}: {w} przy medianie {med}. Wchodzi do walki jak na wycieczkę: zwiedza, robi zdjęcia, nic nie niszczy.",
    "{n}: {w}. Obrażenia tak niskie, że bossowi się pasek życia nie zorientował.",
    "{n}: {w} ({p}% mediany). Walczy z gracją tancerza i skutecznością tancerza.",
    "{n}: {w}, {roz}. Gdyby obrażenia były pieniędzmi, trzeba by zrobić zrzutkę.",
    "{n}: {w}. Najgroźniejsze, co tu poleciało, to zażenowanie.",
    "{n}: {w} przy medianie {med}. Boss wysłał podziękowania za wyrozumiałość.",
    "{n}: {w}, {p}% normy. Pojawia się w walce, jakby ktoś kazał, a nikt nie sprawdza, czy robi.",
    "{n}: {w} ({p}% mediany). Bossowi chyba bardziej przeszkadzały muchy.",
    "{n}: {w} przy medianie {med}. Obrażenia policzone z pewnością, ale chyba tylko z grzeczności.",
    "{n}: {w}, {roz}. Walka w tym wydaniu to forma terapii dla bossa.",
    "{n}: {w}. W pełni zaangażowany w idee, mniej w obrażenia.",
  ],
  dmgOdstaje: [
    "{n}: {w} ({p}% mediany). Walczy z taką pasją, jakby ktoś kazał.",
    "{n}: {w}, {roz} niż mediana. Ma potencjał, ale chyba trzyma go na czarną godzinę, która nie nadchodzi.",
    "{n}: {w} przy medianie {med}. Boss kiwa głową z politowaniem, ale nie z uznaniem.",
    "{n}: {w}, czyli {p}% normy. Bardziej widz niż uczestnik.",
    "{n}: {w}. Ambicja na poziomie przeciętnego poniedziałku.",
    "{n}: {w} przy medianie {med}. Nie tragedia, ale gang czeka na ambicję, a ona jeszcze się nie spakowała.",
    "{n}: {w}, {p}% mediany. Dokłada się do walki jak do zrzutki na prezent: symbolicznie.",
    "{n}: {w}. Bije regularnie, tylko że łagodnie.",
  ],
  obecnosc: [
    "{n}: obecność {u} walk. Wpada jak teściowa: rzadko, bez zapowiedzi i nikt się nie cieszy.",
    "{n}: {u} walk. Gang to nie hotel, niech ktoś to przekaże.",
    "{n}: był na {u} walk. Reszta zdążyła się zżyć z samym bossem.",
    "{n}: {u} walk. Frekwencja jak na zebraniu wspólnoty w sylwestra.",
    "{n}: tylko {u} walk. Można by zgłosić zaginięcie, ale kto by zauważył?",
    "{n}: {u} walk. Walki odbywały się też w Twojej obecności, tylko że fizycznie byłeś gdzie indziej.",
    "{n}: {u}. Wychodzi na to, że wolny wybór kończy się tam, gdzie zaczyna się gang.",
    "{n}: {u} walk. Konto aktywne, osoba okazjonalna.",
    "{n}: obecność {u}. Gang zaczyna się już łączyć w pary bez tej osoby.",
    "{n}: {u} walk. Nazwać to zaangażowaniem to zbyt duża uprzejmość.",
  ],
  brakWalk: [
    "{n}: ani śladu w ostatnich {l} walkach. Szukamy świadków, ktokolwiek widział?",
    "{n}: 0 z {l} walk. Gang robi się kompaktowy, a tu ktoś zniknął jak wypłata.",
    "{n}: nie ma w żadnej z ostatnich {l} walk. Czy konto jeszcze oddycha?",
    "{n}: pusto w {l} ostatnich walkach. Można by tu zrobić ognisko pamięci.",
    "{n}: {l} walk bez nicku w zestawieniu. Lista płac dalej na niego czeka, a on na nic.",
  ],
  kartyDalej: [
    "{n}: K{kr} przy medianie gangu K{mk} i tylko {d} 💎. Reszta już zbiera od nowa, a tu ktoś dopiero próbuje zrozumieć, czym jest paczka.",
    "{n}: K{kr} gdy gang siedzi w K{mk}, {d} 💎. Złote same wpadają, a diamenty trzeba chcieć. Chyba nikt nie chciał.",
    "{n}: tylko {d} 💎 i K{kr} wobec K{mk} reszty. Ktoś pokazał, że karty można otwierać? Bo na razie wyglądają na ozdobę ekranu.",
    "{n}: {d} 💎, K{kr}. Gang już w K{mk}, a tu jeszcze rozgrzewka z pierwszym kręgiem.",
    "{n}: K{kr} kontra K{mk} całej reszty. Brakuje {brak} diamentów. To nie pech, to niezłe zaangażowanie w brak zaangażowania.",
    "{n}: {d} 💎 w K{kr}. Gang poszedł do K{mk}, a tu dalej zbieranie plastikowych wiadereczek.",
    "{n}: K{kr}, {d} 💎, brakuje {brak}. Pozostali już zaczynają nowy krąg, a tu jeszcze oglądanie instrukcji.",
    "{n}: K{kr} (mediana K{mk}), {d} 💎. Z talii zbieranych kart zostały tu głównie wspomnienia.",
    "{n}: K{kr} wobec K{mk} gangu i {d} 💎. Paczki chyba leżą nieotwarte jak prezent od kogoś, kogo się nie lubi.",
    "{n}: {d} 💎 w K{kr}, a gang już w K{mk}. Diamenty szukają tu kogoś, kto je zbierze, i na razie bez skutku.",
    "{n}: K{kr}, {d} 💎, brakuje {brak}. Ktoś tu zamknął krąg w głowie, a w grze jeszcze nie.",
    "{n}: K{kr} przy K{mk} reszty. Po tylu tygodniach to już nie opóźnienie, to alternatywna linia czasowa.",
    "{n}: {d} 💎 i K{kr}. Do poziomu reszty ({mk}) zostało dużo, ale kto by liczył.",
    "{n}: K{kr} gdy inni w K{mk}. Z kolekcji kart zbiera głównie okazje do żartów.",
  ],
  kartyBlisko: [
    "{n}: {d} 💎 w K{kr}, brakuje {brak}. Ten sam krąg co reszta, tylko że reszta ma więcej diamentów. Przypadek?",
    "{n}: w K{kr} tylko {d} 💎. Diament jest cierpliwy, ale ma limit.",
    "{n}: {d} 💎, a gang ma więcej. Brakuje {brak} sztuk, nie oczekujemy cudów, tylko paczek.",
    "{n}: K{kr}, {d} 💎. Brak diamentów to nie wyrok, ale kierunek jest niepokojący.",
    "{n}: {d} 💎 w K{kr}, brakuje {brak}. Do reszty gangu jeszcze nie daleko, ale kierunek podejrzany.",
    "{n}: K{kr}, {d} 💎. Poniżej mediany, ale wciąż w zasięgu wzroku. Dla kogoś, kto wie, gdzie patrzeć.",
    "{n}: {d} 💎. Reszta zrobiła krok do przodu, a tu poszła krótka przerwa na kawę.",
    "{n}: w K{kr} brakuje {brak} 💎. Diament nie ucieka, ale zaczyna się niecierpliwić.",
  ],
  kartyHeist: [
    "{n}: K{kr} (mediana K{mk}), {d} 💎. Przez {hs} z paczki z nową diamentową leciały dwie karty, a tu efekt, jakby paczek nie otwierano.",
    "{n}: {d} 💎 mimo {hs}. Przy podwójnych diamentach da się nie dać rady tylko przy dużej determinacji.",
    "{n}: brakuje {brak} 💎 po {hs}. To nie jest brak szczęścia, to konsekwentny brak działania.",
    "{n}: {hs} za nami, a tu {d} 💎 i K{kr} wobec K{mk} reszty. Ktoś umówił się z paczkami, że ich nie otworzy.",
    "{n}: po {hs} wynik to {d} 💎. Przy tylu okazjach to już osiągnięcie.",
    "{n}: K{kr} przy medianie K{mk}, mimo {hs}. Gang dostał dwa razy więcej diamentów, a ktoś dwa razy mniej chciał.",
    "{n}: {d} 💎 w K{kr} przy {hs}. Przy podwójnych diamentach tak niski wynik to już statystyczny ewenement.",
    "{n}: K{kr} (mediana K{mk}), brakuje {brak} 💎. {hs}, a tu wynik jak na wydarzeniu poświęconym czemuś zupełnie innemu.",
    "{n}: {hs} i tylko {d} 💎. Paczki były dwa razy hojniejsze, a efekt dwa razy mniejszy.",
    "{n}: {d} 💎 w K{kr}, gang w K{mk}. Przy {hs} to musiał być bardzo konsekwentny sposób unikania paczek.",
    "{n}: po {hs} wynik {d} 💎 i K{kr}. Ktoś zdecydował się dać szansę wszystkim paczkom z wyjątkiem tych w grze.",
    "{n}: {hs} minęło, a tu dalej {d} 💎. Wydarzenie dla kolekcjonerów przeszło obok jak tramwaj o 23.",
    "{n}: K{kr} wobec K{mk}, brakuje {brak} 💎 mimo {hs}. Takiej wytrwałości w nicnierobieniu nie spotyka się często.",
    "{n}: {d} 💎 przy {hs}. Z darmowej okazji zrobiono sztukę odmawiania.",
  ],
  dod: [
    "Do kompletu: {x}.",
    "Na deser: {x}.",
    "I jeszcze: {x}.",
    "Plus: {x}.",
    "Dorzućmy: {x}.",
    "Bonus: {x}.",
    "Nie zapominajmy: {x}.",
    "A przy okazji: {x}.",
  ],
  komplet: [
    "Odstaje wszędzie. Jeśli to taktyka, jest bardzo odważna.",
    "Komplet punktów ujemnych. Gratulacje za konsekwencję.",
    "Wynik we wszystkich kategoriach: jest szansa tylko w górę.",
    "Pełen pakiet. Ktoś tu naprawdę poszedł na całość.",
  ],
  pochTop: [
    "{n}: {w} ({p}% mediany). Ktoś tu najwyraźniej nie ma życia towarzyskiego i dobrze, gang dziękuje za poświęcenie.",
    "{n}: {w}. Taki progres to albo pasja, albo ucieczka od rzeczywistości. Gang nie pyta, tylko zbiera owoce.",
    "{n}: {w} ({p}% mediany). Wiadomo, kto robi robotę. Reszta robi tło.",
    "{n}: {w}. Boss po walce prosi o zwolnienie lekarskie.",
    "{n}: {w}, {p}% mediany. Reszta gangu może tu patrzeć, najlepiej ze wstydem.",
  ],
  pochDobry: [
    "{n}: {w} ({p}% mediany). Solidnie. Tak się rośnie, a nie „wchodzę na chwilę”.",
    "{n}: {w}. Widać ambicję. Reszta niech bierze przykład, najlepiej z zazdrością.",
    "{n}: {w}, {p}% mediany. Walczy, a nie tylko kibicuje. Szacunek.",
    "{n}: {w}. Takich w gangu trzymamy, resztę da się negocjować.",
    "{n}: {w} ({p}% mediany). Dobry wynik i jeszcze nikt nie musiał prosić.",
    "{n}: {w}. Wynik z gatunku „nikt nie musiał tłumaczyć, ale ktoś musiał się postarać”.",
  ],
  pochKarty: [
    "{n} (K{kr}, 💎 {d}): zbiera karty, jakby od tego zależało życie. Reszta gangu niech się zawstydzi.",
    "{n} (K{kr}, 💎 {d}): diamenty same przychodzą. Pytanie, co im się mówi.",
    "{n} (K{kr}, 💎 {d}): z paczek wychodzi to, co trzeba, i to bez narzekania.",
    "{n} (K{kr}, 💎 {d}): karty są tu zbierane z ambicją, której reszta nie widziała od premiery.",
    "{n} (K{kr}, 💎 {d}): kolekcja jak z katalogu, a katalog nie ma jeszcze takiej strony.",
  ],
  zamkniecie: [
    "Zero obrazy. Po prostu mierzymy. Liczby nie kłamią, w przeciwieństwie do wymówek.",
    "Jeśli ktoś się znalazł na liście i chce się wybronić: najlepsza obrona to nowy wynik w następnym raporcie.",
    "Nikt nie jest skreślony. Jeszcze. Następny raport już się liczy, ruszcie się.",
    "Opisy dobrane z miłością. Zaręczam, że dane z jeszcze większą.",
  ],
};
const plHeist = (h) => `${h}× Card Heist`;
const podstaw = (t, d) => t.replace(/\{(\w+)\}/g, (_, k) => (d[k] == null ? "" : d[k]));
function unikat(nazwaPuli, klucz, uzyte) {
  const pula = POOLE[nazwaPuli];
  const start = haszuj(klucz + nazwaPuli) % pula.length;
  for (let i = 0; i < pula.length; i++) {
    const idx = (start + i) % pula.length;
    if (!uzyte.has(nazwaPuli + idx)) { uzyte.add(nazwaPuli + idx); return pula[idx]; }
  }
  return pula[start];          // pula wyczerpana — dopuszczamy powtórkę, ale dopiero wtedy
}
function dane(w, r) {
  const azja = r.tryb === "azja";
  const k = w.karty;
  return {
    n: w.nazwa,
    w: w.glowna == null ? "" : azja ? `+${fmt(w.glowna)} lvl` : `śr. ${fmt(w.glowna)} obrażeń`,
    p: w.ratio == null ? "" : Math.round(w.ratio * 100),
    med: azja ? fmt(r.medGlowna) : fmt(r.medGlowna),
    roz: w.glowna == null ? "" : `${fmt(Math.abs(r.medGlowna - w.glowna))} ${azja ? "lvl" : "obrażeń"} ${w.glowna < r.medGlowna ? "mniej od mediany" : "więcej"}`,
    kr: k ? k.krag : "", mk: r.medKrag,
    d: k && k.diamRazem ? `${k.diamPos}/${k.diamRazem}` : k ? `${k.procent}%` : "",
    brak: k && k.diamRazem ? k.diamRazem - k.diamPos : "",
    hs: r.heist > 0 ? plHeist(r.heist) : "",
    u: w.udzial != null ? `${Math.round(w.udzial * r.lacznaWalka)} z ${r.lacznaWalka}` : "",
    l: r.lacznaWalka,
  };
}

// Zwraca {upom: {nazwa: tekst}, poch: {nazwa: tekst}, karty: {nazwa: tekst}} — wszystkie opisy raportu, bez powtórek szablonów.
export function opisyHumoru(r) {
  const azja = r.tryb === "azja";
  const uzyte = new Set();
  const wynik = { upom: {}, poch: {}, karty: {} };
  r.pochwaly.forEach((w, i) => { wynik.poch[w.nazwa] = podstaw(unikat(i === 0 ? "pochTop" : "pochDobry", w.nazwa, uzyte), dane(w, r)); });
  r.kartyTop.forEach((w) => { wynik.karty[w.nazwa] = podstaw(unikat("pochKarty", w.nazwa, uzyte), dane(w, r)); });
  r.upomnienia.forEach((w) => {
    const d = dane(w, r);
    // kandydaci: [dotkliwość 0..1, pula, krótki opis na dokładkę]
    const kand = [];
    if (w.ratio != null && w.flagi.some((f) => /mediany/.test(f.tekst) && !/karty/.test(f.tekst))) {
      const slabo = w.flagi.some((f) => f.typ === "slabo");
      const pula = azja ? (w.glowna === 0 ? "lvlZero" : slabo ? "lvlSlabo" : "lvlOdstaje") : (slabo ? "dmgSlabo" : "dmgOdstaje");
      kand.push([w.glowna === 0 ? 1.3 : 1 - w.ratio, pula, azja ? `${d.w} (${d.p}% mediany)` : `${d.w} (${d.p}% mediany)`]);
    }
    const fo = w.flagi.find((f) => /obecny w/.test(f.tekst));
    if (fo) kand.push([1 - (w.udzial ?? 0), "obecnosc", `obecność ${d.u} walk`]);
    if (w.flagi.some((f) => /brak w ostatnich/.test(f.tekst))) kand.push([1, "brakWalk", `ani śladu w ostatnich ${d.l} walkach`]);
    if (w.flagi.some((f) => f.typ === "karty") && w.karty) {
      const pula = r.heist > 0 ? "kartyHeist" : w.karty.krag < r.medKrag ? "kartyDalej" : "kartyBlisko";
      kand.push([Math.min(1.2, (-w.karty.odchylenie / 3) * (1 + 0.2 * (r.heist || 0))), pula, `K${d.kr}, ${d.d} 💎`]);
    }
    kand.sort((a, b) => b[0] - a[0]);
    const czesci = [];
    kand.forEach(([sev, pula, krotko], i) => {
      if (i === 0) czesci.push(podstaw(unikat(pula, w.nazwa, uzyte), d));
      else czesci.push(podstaw(unikat("dod", w.nazwa + i, uzyte), { x: krotko }));
    });
    if (kand.length >= 3) czesci.push(unikat("komplet", w.nazwa, uzyte));
    wynik.upom[w.nazwa] = czesci.join(" ");
  });
  return wynik;
}

export function tekstHumor(r, opis = "") {
  const o = opisyHumoru(r);
  const L = [];
  L.push(`📋 RAPORT GANGU${opis ? " (" + opis + ")" : ""}`);
  L.push(r.tryb === "azja" ? "Tryb: lvlowanie. Rośniemy albo gnijemy." : "Tryb: liga. Liczą się obrażenia, a nie dobre chęci.");
  if (r.heist > 0) L.push(`🔥 Card Heistów w okresie: ${r.heist}. Z każdej paczki z nową diamentową lecą 2 karty. Wymówki nie przyjmowane.`);
  if (r.pochwaly.length) {
    L.push("", "🏆 CHWAŁA NAJLEPSZYM:");
    r.pochwaly.forEach((w, i) => L.push(`${["🥇", "🥈", "🥉"][i]} ${o.poch[w.nazwa]}`));
  }
  if (r.kartyTop.length) {
    L.push("", "🃏 KARTY: jest ktoś, kto się stara:");
    r.kartyTop.forEach((w) => L.push(`• ${o.karty[w.nazwa]}`));
  }
  if (r.upomnienia.length) {
    L.push("", "💀 WALL OF SHAME (kto odstaje i dlaczego):");
    r.upomnienia.forEach((w) => L.push(`• ${o.upom[w.nazwa]}`));
    L.push("", POOLE.zamkniecie[haszuj(String(r.upomnienia.length)) % POOLE.zamkniecie.length]);
  } else {
    L.push("", "✅ Nikt nie odstaje. Podejrzanie dobrze. Kto za tym stoi?");
  }
  return L.join("\n");
}

// ---------- raporty indywidualne: wszystkie dane jednej osoby + opis w naszym stylu ----------
Object.assign(POOLE, {
  otwGwiazda: [
    "{n} to w tym gangu zjawisko: wyniki takie, że reszta może tylko udawać, że też coś robi.",
    "{n} gra w tej lidze, w której reszta dopiero wyrabia kartę członkowską.",
    "{n} ma w tym raporcie tyle plusów, że księgowy by się pogubił.",
    "{n}: jeśli gang ma twarz, to dzisiaj wygląda właśnie tak.",
  ],
  otwSolid: [
    "{n} trzyma się środka stawki. Nie wstyd, ale i nie powód do pomnika.",
    "{n} jest w tym gangu jak dobrze wypieczona bułka: nikt nie narzeka, nikt nie zachwyca.",
    "{n} robi swoje. Bez fajerwerków, bez skandali, za to z regularnością, o której reszta może pomarzyć.",
    "{n}: średnia ocena „przyzwoicie”. W tym gangu to już awans.",
  ],
  otwOdstaje: [
    "{n} jest w tej tabeli tam, gdzie zwykle ląduje nadzieja.",
    "{n} to ten typ gracza, o którym gang mówi „jeszcze się rozkręca”. Od dłuższego czasu.",
    "{n}: wyniki wskazują na ambicje, które chwilowo są na urlopie.",
    "{n} ma potencjał. Jak wiele rzeczy w życiu: głównie w teorii.",
  ],
  otwOgon: [
    "{n}: ogon gangu. W tym raporcie to już nie punkt, tylko całe zagadnienie.",
    "{n} ma wyniki, o których zwykle mówi się szeptem i z pochylonymi głowami.",
    "{n}: statystyki były wyrozumiałe jak mogły, ale ile można.",
    "{n} to dowód, że w grze zespołowej da się grać solo, i to tak, żeby nikt nie zauważył.",
  ],
  srLvl: [
    "{n}: poziomy rosną w tempie, które nikogo nie zachwyca i nikogo nie boli.",
    "{n}: lvl w normie gangu. Normalność ma swoje uroki, głównie nudne.",
    "{n}: progres poziomów solidny jak umowa o pracę: stabilnie i bez emocji.",
  ],
  srDmg: [
    "{n}: obrażenia przeciętne. Boss ani się nie śmieje, ani nie płacze.",
    "{n}: wynik w walkach taki, jaki trzeba, żeby nikt nie zadawał pytań.",
    "{n}: obrażenia jak z podręcznika: dokładnie tyle, ile wypada.",
  ],
  srKarty: [
    "{n}: z kartami jest tak, że nikt się nie spodziewa niespodzianek.",
    "{n}: kolekcja kart na poziomie reszty gangu. Ani to wstyd, ani to chluba.",
    "{n}: karty w normie. Dla kogoś, kto ma jeszcze wolne paczki, to dobry znak.",
  ],
  frekwDobra: [
    "{n}: obecność na walkach wzorowa. Wiadomo, że można na tę osobę liczyć, o ile nie liczy się wyłącznie na obrażenia.",
    "{n}: nie opuszcza walk. Albo wielkie zaangażowanie, albo brak innych planów.",
    "{n}: frekwencja jak na szkolnym apelu przed świętem: wszyscy są, bo ktoś patrzy.",
  ],
  radaLvl: [
    "Plan na tydzień: wejść do gry, kliknąć coś, co daje poziomy, powtórzyć.",
    "Rada: lvl same się nie podniosą, chociaż aplikacja wyraźnie próbuje je podnieść.",
    "Prosty plan: więcej godzin w grze, mniej godzin w planowaniu tych godzin.",
  ],
  radaDmg: [
    "Plan na następną walkę: pojawić się, kliknąć, zadać obrażenia. Kolejność obowiązkowa.",
    "Rada: obrażenia da się zwiększyć, podobno wystarczy robić to, co robią inni.",
    "Prosty plan: mniej obserwowania bossa, więcej zadawania mu bólu.",
  ],
  radaObec: [
    "Plan: być na walce. Nic więcej. Tak, tyle wystarczy na początek.",
    "Rada: kalendarz przypomnień i budzik robią cuda. Sprawdzone na innych.",
    "Prosty plan: wpaść na walkę, zanim boss zacznie pytać, kim jesteś.",
  ],
  radaKarty: [
    "Plan: otwierać paczki, a diamenty zostawić tam, gdzie je znaleziono, czyli w paczce, która ma być otwarta.",
    "Rada: pierwsza nowa diamentowa w paczce wystarczy, żeby załapać bakcyla. Potem już samo idzie.",
    "Prosty plan: żadnego odkładania paczek na później. Później bywa za późno.",
  ],
  radaOk: [
    "Plan: jechać dalej, nic nie psuć, od czasu do czasu zaskoczyć.",
    "Rada: wszystko gra. Szkoda tylko, że nikt nie dostanie za to medalu.",
  ],
});

const bezNicku = (t, n) => {
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let x = t.replace(new RegExp("^" + esc + " \\((.*?)\\):\\s"), "Karty ($1): ");
  x = x.replace(new RegExp("^" + esc + "(\\s—|:)\\s"), "");
  return x.charAt(0).toUpperCase() + x.slice(1);
};
const miejsceW = (wiersze, nazwa, pole) => {
  const lst = wiersze.filter((w) => w[pole] != null).sort((a, b) => b[pole] - a[pole]);
  const i = lst.findIndex((w) => w.nazwa === nazwa);
  return i < 0 ? null : { m: i + 1, N: lst.length };
};

/**
 * Buduje profil każdego członka: wyniki z obu trybów naraz (poziomy, obrażenia, obecność, karty) + miejsca w gangu.
 * rA = zbudujRaport({tryb:"azja"...}), rE = zbudujRaport({tryb:"europa"...}),
 * szczegolyLvl = {nazwa:{od,do}}, dodatki = {maxObr:{nazwa:n}, lacznieObr:{nazwa:n}, zlote:{nazwa:{pos,razem}}}
 */
export function zbudujProfile({ rA, rE, szczegolyLvl = {}, dodatki = {}, heist = 0 }) {
  const mapaE = Object.fromEntries(rE.wiersze.map((w) => [w.nazwa, w]));
  const wynik = rA.wiersze.map((a) => {
    const e = mapaE[a.nazwa] || {};
    const lvl = a.glowna != null ? { delta: a.glowna, ratio: a.ratio, od: szczegolyLvl[a.nazwa]?.od ?? null, do: szczegolyLvl[a.nazwa]?.do ?? null, miejsce: miejsceW(rA.wiersze, a.nazwa, "glowna") } : null;
    const dmg = e.glowna != null ? { srednia: e.glowna, ratio: e.ratio, udzial: e.udzial, walk: e.udzial != null ? Math.round(e.udzial * rE.lacznaWalka) : null, lacznaWalka: rE.lacznaWalka, lacznie: dodatki.lacznieObr?.[a.nazwa] ?? null, max: dodatki.maxObr?.[a.nazwa] ?? null, miejsce: miejsceW(rE.wiersze, a.nazwa, "glowna") } : null;
    const karty = a.karty ? { ...a.karty, zlote: dodatki.zlote?.[a.nazwa] || null, miejsce: (() => { const l = rA.wiersze.filter((w) => w.karty && w.karty.postep != null).sort((x, y) => y.karty.postep - x.karty.postep); const i = l.findIndex((w) => w.nazwa === a.nazwa); return i < 0 ? null : { m: i + 1, N: l.length }; })() } : null;
    // siła każdego obszaru względem gangu (0 = dokładnie mediana), do wskazania najmocniejszej i najsłabszej strony
    const sily = [];
    if (lvl && lvl.ratio != null) sily.push({ typ: "lvl", v: lvl.ratio - 1 });
    if (dmg && dmg.ratio != null) sily.push({ typ: "dmg", v: dmg.ratio - 1 });
    if (dmg && dmg.udzial != null && rE.lacznaWalka >= 3) sily.push({ typ: "obec", v: dmg.udzial - 0.8 });
    else if (!dmg && rE.lacznaWalka >= 3) sily.push({ typ: "obec", v: -1 });
    if (karty && karty.odchylenie != null) sily.push({ typ: "karty", v: karty.odchylenie / 2 });
    const wyniki = sily.map((s) => (s.typ === "obec" ? 1 + s.v : 1 + s.v));
    const score = wyniki.length ? wyniki.reduce((x, y) => x + Math.max(0, Math.min(2, y)), 0) / wyniki.length : null;
    const tier = score == null ? null : score >= 1.15 ? "gwiazda" : score >= 0.85 ? "solid" : score >= 0.55 ? "odstaje" : "ogon";
    const sort = [...sily].sort((x, y) => y.v - x.v);
    return { nazwa: a.nazwa, lvl, dmg, karty, flagiA: a.flagi, flagiE: (e.flagi || []), score, tier, najmocniejsza: sort[0] || null, najslabsza: sort.length ? sort[sort.length - 1] : null, heist };
  });
  return wynik;
}

const fmtL = (n) => (n == null ? "—" : Math.round(n).toLocaleString("pl-PL"));

export function faktyProfilu(p) {
  const f = [];
  if (p.lvl) f.push({ ikona: "📈", tekst: `Poziomy: ${p.lvl.od != null ? `${fmtL(p.lvl.od)} → ${fmtL(p.lvl.do)} ` : ""}(+${fmtL(p.lvl.delta)})${p.lvl.ratio != null ? `, ${Math.round(p.lvl.ratio * 100)}% mediany` : ""}${p.lvl.miejsce ? `, miejsce ${p.lvl.miejsce.m}/${p.lvl.miejsce.N}` : ""}` });
  else f.push({ ikona: "📈", tekst: "Poziomy: brak danych w tym okresie" });
  if (p.dmg) f.push({ ikona: "⚔️", tekst: `Walki: śr. ${fmtL(p.dmg.srednia)} obrażeń${p.dmg.lacznie != null ? `, razem ${fmtL(p.dmg.lacznie)}` : ""}${p.dmg.max != null ? `, rekord ${fmtL(p.dmg.max)}` : ""}${p.dmg.walk != null ? `, obecność ${p.dmg.walk}/${p.dmg.lacznaWalka}` : ""}${p.dmg.miejsce ? `, miejsce ${p.dmg.miejsce.m}/${p.dmg.miejsce.N}` : ""}` });
  else f.push({ ikona: "⚔️", tekst: `Walki: brak udziału w ${p.dmg === null && p.flagiE.length ? "ostatnich walkach" : "tym okresie"}` });
  if (p.karty) f.push({ ikona: "🃏", tekst: `Karty: K${p.karty.krag}${p.karty.diamRazem ? `, 💎 ${p.karty.diamPos}/${p.karty.diamRazem}` : ""}${p.karty.zlote ? `, złote ${p.karty.zlote.pos}/${p.karty.zlote.razem}` : ""}${p.karty.miejsce ? `, miejsce ${p.karty.miejsce.m}/${p.karty.miejsce.N}` : ""}` });
  return f;
}

// Opisy wszystkich członków naraz — szablony nie powtarzają się między osobami.
export function opisyIndywidualne(profile, rA, rE) {
  const uzyte = new Set();
  const medKrag = rA.medKrag;
  const wynik = {};
  profile.forEach((p) => {
    const n = p.nazwa;
    const dA = dane({ nazwa: n, glowna: p.lvl?.delta ?? null, ratio: p.lvl?.ratio ?? null, karty: p.karty, flagi: [] }, rA);
    const dE = dane({ nazwa: n, glowna: p.dmg?.srednia ?? null, ratio: p.dmg?.ratio ?? null, udzial: p.dmg?.udzial ?? null, karty: p.karty, flagi: [] }, rE);
    const linie = [];
    if (p.tier) linie.push(podstaw(unikat({ gwiazda: "otwGwiazda", solid: "otwSolid", odstaje: "otwOdstaje", ogon: "otwOgon" }[p.tier], n, uzyte), { n }));
    // poziomy
    if (p.lvl) {
      const r = p.lvl.ratio;
      const pula = p.lvl.delta === 0 ? "lvlZero" : r == null ? null : r >= 1.15 ? (p.lvl.miejsce?.m === 1 ? "pochTop" : "pochDobry") : r < 0.35 ? "lvlSlabo" : r < 0.6 ? "lvlOdstaje" : "srLvl";
      if (pula) linie.push(bezNicku(podstaw(unikat(pula, n + "L", uzyte), { ...dA, w: `+${fmtL(p.lvl.delta)} lvl` }), n));
    }
    // walki
    if (p.dmg) {
      const r = p.dmg.ratio;
      const pula = r == null ? null : r >= 1.15 ? "pochDobry" : r < 0.35 ? "dmgSlabo" : r < 0.6 ? "dmgOdstaje" : "srDmg";
      if (pula) linie.push(bezNicku(podstaw(unikat(pula, n + "D", uzyte), { ...dE, w: `śr. ${fmtL(p.dmg.srednia)} obrażeń` }), n));
      const jestObecnosc = p.flagiE.find((f) => /obecny w/.test(f.tekst));
      if (jestObecnosc) linie.push(bezNicku(podstaw(unikat("obecnosc", n + "O", uzyte), dE), n));
      else if (p.dmg.udzial != null && p.dmg.udzial >= 0.9 && rE.lacznaWalka >= 3) linie.push(bezNicku(podstaw(unikat("frekwDobra", n + "F", uzyte), dE), n));
    } else if (rE.lacznaWalka >= 3) {
      linie.push(bezNicku(podstaw(unikat("brakWalk", n + "B", uzyte), dE), n));
    }
    // karty
    if (p.karty) {
      const odch = p.karty.odchylenie;
      let pula = null;
      if (p.flagiA.some((f) => f.typ === "karty")) pula = p.heist > 0 ? "kartyHeist" : p.karty.krag < medKrag ? "kartyDalej" : "kartyBlisko";
      else if (odch != null && odch >= 0.5) pula = "pochKarty";
      else pula = "srKarty";
      linie.push(bezNicku(podstaw(unikat(pula, n + "K", uzyte), dA), n));
    }
    // rada: dotyczy najsłabszej strony
    const slab = p.najslabsza;
    const radaPula = !slab || slab.v >= 0 ? "radaOk" : { lvl: "radaLvl", dmg: "radaDmg", obec: "radaObec", karty: "radaKarty" }[slab.typ];
    linie.push(unikat(radaPula, n + "R", uzyte));
    wynik[n] = linie;
  });
  return wynik;
}

const IKONY_TIER = { gwiazda: "🌟", solid: "👍", odstaje: "⚠️", ogon: "💀" };
export const etykietaTier = (t) => (t ? { gwiazda: "gwiazda gangu", solid: "solidna średnia", odstaje: "odstaje", ogon: "ogon gangu" }[t] : "brak danych");
export const ikonaTier = (t) => IKONY_TIER[t] || "❔";

export function tekstIndywidualny(p, linie, opis = "", humor = true) {
  const L = [`👤 RAPORT: ${p.nazwa} ${ikonaTier(p.tier)} (${etykietaTier(p.tier)})${opis ? " — " + opis : ""}`];
  faktyProfilu(p).forEach((f) => L.push(`${f.ikona} ${f.tekst}`));
  if (humor && linie && linie.length) { L.push(""); linie.forEach((x) => L.push(x)); }
  return L.join("\n");
}
