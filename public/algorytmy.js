// ═══════════════════════════════════════════════════════════════════
// algorytmy.js — algorytmy wymiany (V1 i V3), uruchamiane w Web Workerze
// Plik klasyczny (bez importów), ładowany przez algorytmWorker.js (importScripts)
// oraz awaryjnie na głównym wątku. NIE jest przetwarzany przez bundler/lint.
// ═══════════════════════════════════════════════════════════════════

const TRUDNE_NUMERY = [10, 11, 12, 14, 15];

function pobierzNagrode(talia, krag) {
  const k = Math.min(Math.max(parseInt(krag) || 1, 1), 5);
  for (let i = k; i >= 2; i--) {
    const v = talia[`nagroda_amunicja_k${i}`];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return talia.nagroda_amunicja || 0;
}

const PROGI = [
  {prog:20, ammo:100},
  {prog:40, ammo:250},
  {prog:60, ammo:500},
  {prog:80, ammo:1000},
  {prog:100, ammo:2500},
  {prog:110, ammo:3500},
  {prog:120, ammo:5000},
  {prog:135, ammo:2000}, // KOMPLET — wszystkie karty
];

const PROGI_EVENT = [
  {prog:5,  ammo:100},
  {prog:15, ammo:250},
  {prog:25, ammo:500},
  {prog:35, ammo:0},
  {prog:45, ammo:0},
  {prog:55, ammo:2000},
  {prog:63, ammo:0, komplet:true}, // KOMPLET — nowy diament
];

function liczKartyOsoby(osobaId, talie, posiadane) {
  let count=0;
  talie.forEach(talia=>{
    talia.karty.forEach(karta=>{
      if(posiadane[`${osobaId}_${talia.id}_${karta.nazwa}`]) count++;
    });
  });
  return count;
}

function obliczProg(obecnaLiczba) {
  const nastepny = PROGI.find(p => p.prog > obecnaLiczba);
  const ostatni = [...PROGI].reverse().find(p => p.prog <= obecnaLiczba);
  return {
    obecna: obecnaLiczba,
    nastepnyProg: nastepny || null,
    brakujeDoProg: nastepny ? nastepny.prog - obecnaLiczba : 0,
    ostatniProg: ostatni || null,
    ammoProg: nastepny ? nastepny.ammo : 0,
  };
}

function obliczProgEvent(obecnaLiczba) {
  const nastepny = PROGI_EVENT.find(p => p.prog > obecnaLiczba);
  const ostatni = [...PROGI_EVENT].reverse().find(p => p.prog <= obecnaLiczba);
  return {
    obecna: obecnaLiczba,
    nastepnyProg: nastepny || null,
    brakujeDoProg: nastepny ? nastepny.prog - obecnaLiczba : 0,
    ostatniProg: ostatni || null,
    ammoProg: nastepny ? nastepny.ammo : 0,
  };
}

function obliczFaze(brakT, brakO, typWymiany) {
  // Priorytet dynamiczny: im mniej brakuje łącznie tym wyższy priorytet
  // Format: brakT * 10 + brakO → np. 1+0=10, 1+1=11, 2+0=20, 2+1=21 itd.
  // Fazy specjalne dla diamentowych gdzie brakO=0 i brakT=2 → 2 osoby wyślą po 1 karcie
  if (brakT === 0) return 0; // już ma wszystkie
  return brakT * 10 + brakO;
}

function obliczLicznikOtrzymanych(historia) {
  const licznik = {}; // {nazwa: count}
  historia.forEach(wymiana => {
    (wymiana.wymiany || []).forEach(w => {
      if (w.do) licznik[w.do] = (licznik[w.do] || 0) + 1;
    });
  });
  return licznik;
}

function generujAlgorytm({talie,czlonkowie,wszyscyCzlonkowie,posiadane,duplikaty,typWymiany,tryb,vipKolejka=[],celowaKolejka={},ignorujTrudne=false,historiaWymian=[],sprawiedliwe=false,maxKartNaOsobe=0,limitKartOsoby={},paczkiDiament={}}) {
  // czlonkowie = odbiorcy (aktywni), wszyscyCzlonkowie = dawcy (wszyscy łącznie z wyłączonymi)
  const dawcy = wszyscyCzlonkowie || czlonkowie;
  // Licznik kart przydzielonych per odbiorca (do limitu maxKartNaOsobe)
  const kartDlaosoby = {}; // osobaId -> count
  // Oblicz ile kart diamentowych brakuje danej osobie (do zamknięcia kręgu)
  // Ile diamentowych kart brakuje osobie do zamknięcia kręgu (łącznie we wszystkich taliach)
  const brakDiamentOsoby = (osobaId) => {
    if (typWymiany !== "diamentowe") return 0;
    return talie.reduce((sum,t)=>sum+(t.karty.filter(k=>k.typ==="diamentowa"&&!posiadane[osobaId+"_"+t.id+"_"+k.nazwa]).length),0);
  };

  // Ile jeszcze kart potrzeba po odjęciu paczek
  const brakPoOdjęciuPaczek = (osobaId) => {
    if (tryb !== "paczki_diament") return null;
    const paczki = paczkiDiament[osobaId] || 0;
    const brakLacznie = brakDiamentOsoby(osobaId);
    return Math.max(0, brakLacznie - paczki);
  };

  // Limit kart dla trybu paczki — ile kart max może dostać osoba w tej wymianie
  const limitPaczkiDiament = (osobaId) => {
    if (tryb !== "paczki_diament" || !(osobaId in paczkiDiament)) return null;
    const brakEfektywny = brakPoOdjęciuPaczek(osobaId);
    // Wyklucz jeśli paczki pokrywają cały brak
    if (brakEfektywny === 0) return 0;
    // Obsługuj tylko jeśli brak efektywny <= 4 (nie przepalamy wymian)
    if (brakEfektywny > 4) return 0;
    return brakEfektywny; // max tyle kart ile faktycznie potrzeba
  };

  const czyMozeDostac = (osobaId) => {
    const ile = kartDlaosoby[osobaId] || 0;
    // Tryb paczki
    if (tryb === "paczki_diament" && osobaId in paczkiDiament) {
      const limit = limitPaczkiDiament(osobaId);
      if (limit === 0) return false; // wykluczona
      if (limit !== null) return ile < limit;
    }
    // Indywidualny limit per osoba
    if (limitKartOsoby[osobaId] !== undefined) return ile < limitKartOsoby[osobaId];
    return maxKartNaOsobe <= 0 || ile < maxKartNaOsobe;
  };
  const zaznaczDostala = (osobaId) => { kartDlaosoby[osobaId] = (kartDlaosoby[osobaId]||0) + 1; };

  // TRYB SPRAWIEDLIWY — oblicz "dług" każdej osoby
  // Dług = ile kart poniżej średniej gangu dana osoba otrzymała w historii
  // Wyższy dług = wyższy priorytet przy konflikcie o duplikat
  const dlugOsob = {}; // {nazwa: liczba} — im wyższy tym bardziej "poszkodowany"
  if (sprawiedliwe && historiaWymian.length > 0) {
    const licznikOtrzymanych = obliczLicznikOtrzymanych(historiaWymian);
    // Łączna liczba kart rozdanych
    const lacznieRozdano = Object.values(licznikOtrzymanych).reduce((s,v)=>s+v, 0);
    // Średnia na osobę (biorąc pod uwagę wszystkich członków)
    const srednia = lacznieRozdano / Math.max(1, czlonkowie.length);
    czlonkowie.forEach(c => {
      const dostala = licznikOtrzymanych[c.nazwa] || 0;
      dlugOsob[c.nazwa] = srednia - dostala; // ujemny = dostała więcej niż średnia
    });
  }

  // Zwraca priorytet sprawiedliwości dla osoby (wyższy = wyższy priorytet)
  // Używane przy konflikcie o ten sam duplikat
  const priorytetSprawiedliwy = (nazwaosoby) => {
    if (!sprawiedliwe) return 0;
    return dlugOsob[nazwaosoby] || 0;
  };
  const isEvent = typWymiany === "event";
  const typ=typWymiany==="złote"?"złota":isEvent?"diamentowa":"diamentowa";
  const oppTyp=typWymiany==="złote"?"diamentowa":isEvent?null:"złota";

  // Oblicz progi dla każdej osoby
  // W EVENCIE progi celowo NIE są brane pod uwagę przy generowaniu rozpiski —
  // zwracamy neutralny obiekt (brak "następnego progu"), co automatycznie wyłącza
  // bonus za zbliżanie się do progu, sortowanie po progu i tryb "Dobij progi".
  // Tryb zwykły (złote/diamentowe) działa bez zmian.
  const progiOsob={};
  czlonkowie.forEach(osoba=>{
    if(isEvent){
      progiOsob[osoba.id]={obecna:0,nastepnyProg:null,brakujeDoProg:0,ostatniProg:null,ammoProg:0};
    } else {
      const liczba=liczKartyOsoby(osoba.id,talie,posiadane);
      progiOsob[osoba.id]=obliczProg(liczba);
    }
  });

  // Oblicz efektywną nagrodę: nagroda talii + ewentualna nagroda za próg
  const obliczEfektywnaНagrode=(osobaId, taliaId, brakujaceKarty)=>{
    const prog=progiOsob[osobaId];
    const nagrodaTalii=talie.find(t=>t.id===taliaId); const _osobaObj=czlonkowie.find(c=>c.id===osobaId); const nagroda=nagrodaTalii?pobierzNagrode(nagrodaTalii,_osobaObj?.krag||1):0;
    // Czy ta wymiana (dostając brakujace karty) przekroczy próg?
    let bonusProg=0;
    if(prog.nastepnyProg && prog.brakujeDoProg<=brakujaceKarty){
      bonusProg=prog.ammoProg;
    }
    return nagroda+bonusProg;
  };

  // TRYB VIP — kolejka priorytetów
  // ============================================================
  // HELPER: sprawdza czy dawca jest potrzebny do zamknięcia cenniejszej talii
  // Zdefiniowany wcześniej bo używany w trybie celowanym i reszcie algorytmu
  const staneTaliiRef = { list: [] };
  const dawcaRezerwowany = (dawcaId, nagroda) => {
    return staneTaliiRef.list.some(st => {
      if (st.nagroda <= nagroda) return false;
      if (wysylajacy.has(dawcaId)) return false;
      return st.brakT.some(k =>
        duplikaty[`${dawcaId}_${st.talia.id}_${k.nazwa}`]
      );
    });
  };

  if(tryb==="vip" && vipKolejka.length>0) {
    const planoweWymiany=[];
    const nieobsluzone=[];
    const wysylajacy=new Set();

    // Obsługuj osoby po kolei wg kolejki
    for(const vipId of vipKolejka){
      const vip=czlonkowie.find(c=>c.id===vipId);
      if(!vip) continue;
      const potrzeby=[];
      talie.forEach(talia=>{
        const kartyT=talia.karty.filter(k=>k.typ===typ);
        const kartyO=talia.karty.filter(k=>k.typ===oppTyp);
        const brakT=kartyT.filter(k=>!posiadane[`${vipId}_${talia.id}_${k.nazwa}`]);
        const brakO=kartyO.filter(k=>!posiadane[`${vipId}_${talia.id}_${k.nazwa}`]);
        if(!brakT.length) return;
        const faza=obliczFaze(brakT.length,brakO.length,typWymiany);
        const kompletOpp=brakO.length===0;
        brakT.forEach(karta=>{
          potrzeby.push({talia,karta,faza,kompletOpp,nagroda:pobierzNagrode(talia,vip.krag||1),trudna:TRUDNE_NUMERY.includes(talia.numer),brakTCount:brakT.length,brakOCount:brakO.length});
        });
      });
      // Sortuj VIP tak samo jak normalny tryb:
      // 1. Talie do zamknięcia (brakuje tylko kilku kart + ma komplet drugiego typu)
      // 2. Faza (im niższa tym bliżej zamknięcia)
      // 3. Nagroda (wyższa lepsza)
      potrzeby.sort((a,b)=>{
        if(a.kompletOpp!==b.kompletOpp) return a.kompletOpp?-1:1;
        if(a.faza!==b.faza) return a.faza-b.faza;
        if(b.nagroda!==a.nagroda) return b.nagroda-a.nagroda;
        return ignorujTrudne ? 0 : (a.trudna?1:0)-(b.trudna?1:0);
      });
      potrzeby.forEach((p)=>{
        const {talia,karta,nagroda,trudna}=p;
        let dawca=null;
        for(const o2 of dawcy){
          if(o2.id===vipId||wysylajacy.has(o2.id)) continue;
          if(duplikaty[`${o2.id}_${talia.id}_${karta.nazwa}`]){dawca=o2;break;}
        }
        if(dawca && czyMozeDostac(vip.id)){
          wysylajacy.add(dawca.id);
          zaznaczDostala(vip.id);
          planoweWymiany.push({od:dawca.nazwa,do:vip.nazwa,karta:karta.nazwa,talia:talia.nazwa,nagroda,faza:200,brakTCount:p.brakTCount||1,brakOCount:p.brakOCount||0,trudna});
        } else {
          nieobsluzone.push({osoba:vip,talia,karta,brakTCount:1});
        }
      });
    }

    // Po kolejce VIP — reszta gangu normalnym algorytmem (wszystkie fazy, bez ograniczeń)
    const vipSet=new Set(vipKolejka);
    const kandydaciReszta=[];
    czlonkowie.filter(c=>!vipSet.has(c.id)).forEach(osoba=>{
      talie.forEach(talia=>{
        const kartyT=talia.karty.filter(k=>k.typ===typ);
        const kartyO=talia.karty.filter(k=>k.typ===oppTyp);
        if(!kartyT.length) return;
        const brakT=kartyT.filter(k=>!posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]);
        const brakO=kartyO.filter(k=>!posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]);
        if(!brakT.length) return;
        const faza=obliczFaze(brakT.length,brakO.length,typWymiany);
        const kompletOpp = brakO.length === 0;
        brakT.forEach(karta=>{
          kandydaciReszta.push({osoba,talia,karta,faza,kompletOpp,nagroda:pobierzNagrode(talia,osoba.krag),trudna:TRUDNE_NUMERY.includes(talia.numer),brakTCount:brakT.length,brakOCount:brakO.length});
        });
      });
    });
    // Sortuj jak normalny tryb: najpierw talie do zamknięcia (kompletOpp), potem faza, potem nagroda
    kandydaciReszta.sort((a,b)=>{
      if(a.kompletOpp!==b.kompletOpp) return a.kompletOpp?-1:1;
      if(a.faza!==b.faza) return a.faza-b.faza;
      if(b.nagroda!==a.nagroda) return b.nagroda-a.nagroda;
      return ignorujTrudne ? 0 : (a.trudna?1:0)-(b.trudna?1:0);
    });
    for(const k of kandydaciReszta){
      let dawca=null;
      for(const o2 of dawcy){
        if(o2.id===k.osoba.id||wysylajacy.has(o2.id)) continue;
        if(duplikaty[`${o2.id}_${k.talia.id}_${k.karta.nazwa}`]){dawca=o2;break;}
      }
      if(dawca && czyMozeDostac(k.osoba.id)){
        wysylajacy.add(dawca.id);
        zaznaczDostala(k.osoba.id);
        planoweWymiany.push({od:dawca.nazwa,do:k.osoba.nazwa,karta:k.karta.nazwa,talia:k.talia.nazwa,nagroda:k.nagroda,faza:210,brakTCount:k.brakTCount,brakOCount:k.brakOCount,trudna:k.trudna});
      }
    }

    // Zamknięte talie
    const symPos={...posiadane};
    planoweWymiany.forEach(w=>{
      const o=czlonkowie.find(c=>c.nazwa===w.do);
      const t=talie.find(t=>t.nazwa===w.talia);
      if(o&&t) symPos[`${o.id}_${t.id}_${w.karta}`]=true;
    });
    const zamknieteTalie=[];
    talie.forEach(talia=>{
      czlonkowie.forEach(osoba=>{
        const brakPrzed=talia.karty.filter(k=>!posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]);
        const brakPo=talia.karty.filter(k=>!symPos[`${osoba.id}_${talia.id}_${k.nazwa}`]);
        if(brakPrzed.length>0&&brakPo.length===0) zamknieteTalie.push({osoba:osoba.nazwa,talia:talia.nazwa,nagroda:pobierzNagrode(talia,osoba.krag)});
      });
    });
    return {planoweWymiany,nieobsluzone,zamknieciaInfo:zamknieteTalie};
  }

  // Zbierz stan każdej talii dla każdej osoby
  // Dla faz 20+ (brakuje 2+ kart) — rozbij na osobne wpisy per karta
  // żeby każda karta konkurowała o dawcę równorzędnie z innymi fazami 10
  const staneTalii = [];
  czlonkowie.forEach(osoba => {
    talie.forEach(talia => {
      const kartyT = talia.karty.filter(k => k.typ === typ);
      const kartyO = talia.karty.filter(k => k.typ === oppTyp);
      if (!kartyT.length) return;
      const brakT = kartyT.filter(k => !posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]);
      const brakO = kartyO.filter(k => !posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]);
      if (!brakT.length) return;
      const nagroda = pobierzNagrode(talia, osoba.krag);
      const trudna = TRUDNE_NUMERY.includes(talia.numer);
      // kompletOpp = gracz ma WSZYSTKIE karty drugiego typu → talia może być zamknięta
      const kompletOpp = brakO.length === 0;
      staneTalii.push({ osoba, talia, brakT, brakO, nagroda, trudna, kompletOpp });
    });
  });

  const wysylajacy = new Set();
  const planoweWymiany = [];

  // Tryb paczki — sortuj osoby z paczkami na koniec (niższy priorytet)
  if (tryb === "paczki_diament") {
    staneTalii.sort((a, b) => {
      const aPaczki = a.osoba.id in paczkiDiament;
      const bPaczki = b.osoba.id in paczkiDiament;
      if (aPaczki !== bPaczki) return aPaczki ? 1 : -1; // osoby bez paczek pierwsze
      return 0;
    });
  }

  staneTaliiRef.list = staneTalii; // Wypełnij przed trybem celowanym

  // ============================================================
  // TRYB CELOWANY — wybrane osoby dostają priorytetowo X kart
  // ============================================================
  if(tryb==="celowany" && Object.keys(celowaKolejka).some(k=>celowaKolejka[k]>0)) {
    // Sortuj celowane osoby po sumie nagród (najcenniejsze pierwsze)
    const celowani = Object.entries(celowaKolejka)
      .filter(([,ile])=>ile>0)
      .map(([osobaId,ile])=>({
        osoba: czlonkowie.find(c=>c.id===parseInt(osobaId)||c.id===osobaId),
        ile,
      }))
      .filter(x=>x.osoba);

    for(const {osoba,ile} of celowani) {
      // Zbierz wszystkie możliwe karty dla tej osoby posortowane jak normalny algorytm
      const kandydaci=[];
      talie.forEach(talia=>{
        const kartyT=talia.karty.filter(k=>k.typ===typ);
        const kartyO=talia.karty.filter(k=>k.typ===oppTyp);
        const brakT=kartyT.filter(k=>!posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]);
        const brakO=kartyO.filter(k=>!posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]);
        if(!brakT.length) return;
        const faza=obliczFaze(brakT.length,brakO.length,typWymiany);
        const kompletOpp=brakO.length===0;
        brakT.forEach(karta=>{
          kandydaci.push({
            talia,karta,faza,kompletOpp,
            nagroda:pobierzNagrode(talia,osoba.krag),
            trudna:TRUDNE_NUMERY.includes(talia.numer),
            brakTCount:brakT.length,brakOCount:brakO.length,
          });
        });
      });

      // Sortuj: zamknięcia pierwsze, potem faza, potem nagroda
      kandydaci.sort((a,b)=>{
        if(a.kompletOpp!==b.kompletOpp) return a.kompletOpp?-1:1;
        if(a.faza!==b.faza) return a.faza-b.faza;
        if(b.nagroda!==a.nagroda) return b.nagroda-a.nagroda;
        return ignorujTrudne?0:(a.trudna?1:0)-(b.trudna?1:0);
      });

      // Przydziel do `ile` kart
      let przydzielono=0;
      for(const k of kandydaci) {
        if(przydzielono>=ile) break;
        if(!czyMozeDostac(osoba.id)) break;
        // Szukaj wolnego dawcy — preferuj niezarezerwowanych dla zamknięć talii
        let dawca=null;
        let dawcaFallback=null;
        for(const o2 of dawcy){
          if(o2.id===osoba.id||wysylajacy.has(o2.id)) continue;
          if(!duplikaty[`${o2.id}_${k.talia.id}_${k.karta.nazwa}`]) continue;
          // Nie bierz dawcy który jest potrzebny do zamknięcia talii komuś innemu
          if(dawcaRezerwowany(o2.id, k.nagroda)){
            if(!dawcaFallback) dawcaFallback=o2;
            continue;
          }
          dawca=o2; break;
        }
        // Fallback — użyj zarezerwowanego gdy nie ma innego
        if(!dawca) dawca=dawcaFallback;
        if(!dawca) continue;
        wysylajacy.add(dawca.id);
        zaznaczDostala(osoba.id);
        przydzielono++;
        planoweWymiany.push({
          od:dawca.nazwa,do:osoba.nazwa,
          karta:k.karta.nazwa,talia:k.talia.nazwa,
          nagroda:k.nagroda,faza:k.faza,
          brakTCount:k.brakTCount,brakOCount:k.brakOCount,
          trudna:k.trudna,
        });
      }
    }
    // Po obsłużeniu celowanych — reszta gangu normalnie (tryb priorytet)
  }


  const nieobsluzone = [];

  if (tryb === "zamknij") {
    // TRYB "ZAMKNIJ COKOLWIEK"
    // Priorytetyzuj talie które MOŻNA zamknąć w tej wymianie (komplet opp już zebrany)
    // Wśród nich — największa nagroda, potem najmniej brakuje
    // Dla każdej talii pakuj WIELE kart (od różnych dawców) żeby ją domknąć

    // Sprawdź czy dawca jest potrzebny dla cenniejszej talii w dozamkniecia
    // Definiujemy jako funkcję lazy — dozamkniecia obliczane poniżej
    const dozamknieciaRef = { list: [] };
    const dawcaRezerwowanyDozamkniecia = (dawcaId, nagroda) => {
      return dozamknieciaRef.list.some(st => {
        if (st.nagroda <= nagroda) return false;
        return st.brakT.some(k =>
          duplikaty[`${dawcaId}_${st.talia.id}_${k.nazwa}`] &&
          !wysylajacy.has(dawcaId)
        );
      });
    };

    const dozamkniecia = staneTalii
      .filter(s => s.kompletOpp) // tylko talie z kompletem drugiego typu — można je realnie zamknąć
      .sort((a, b) => {
        // Najpierw największa nagroda
        if (b.nagroda !== a.nagroda) return b.nagroda - a.nagroda;
        // Potem najmniej brakuje
        if (a.brakT.length !== b.brakT.length) return a.brakT.length - b.brakT.length;
        // Talie trudne na końcu
        const aT = a.trudna ? 1 : 0, bT = b.trudna ? 1 : 0;
        return ignorujTrudne ? 0 : aT - bT;
      });

    dozamknieciaRef.list = dozamkniecia;

    // DWUPRZEBIEGOWY algorytm dla dozamkniecia:
    // Przebieg 1: znajdź optymalne przypisanie dawców (nie blokuj)
    // Przebieg 2: zatwierdź przypisania

    // Krok 1: dla każdej karty w dozamkniecia znajdź najlepszego wolnego dawcę
    // Sortujemy globalnie po nagrodzie — najcenniejsze pierwsze
    const przypisania = []; // { dawca, odbiorca: s.osoba, karta, talia, nagroda, trudna, brakT }
    const zajenciDawcy = new Set();

    for (const s of dozamkniecia) {
      if (!czyMozeDostac(s.osoba.id)) continue;
      for (const karta of s.brakT) {
        // Znajdź wolnego dawcę który nie jest już zaplanowany dla tej rundy
        let dawca = null;
        let dawcaFallback = null;
        for (const o2 of dawcy) {
          if (o2.id === s.osoba.id || wysylajacy.has(o2.id) || zajenciDawcy.has(o2.id)) continue;
          if (!duplikaty[`${o2.id}_${s.talia.id}_${karta.nazwa}`]) continue;
          // Preferuj dawcę który NIE jest potrzebny dla cenniejszej wymiany
          if (dawcaRezerwowanyDozamkniecia(o2.id, s.nagroda)) {
            if (!dawcaFallback) dawcaFallback = o2;
            continue;
          }
          dawca = o2; break;
        }
        if (!dawca) dawca = dawcaFallback;
        if (dawca) {
          zajenciDawcy.add(dawca.id);
          przypisania.push({ dawca, odbiorca: s.osoba, karta, s });
        } else {
          nieobsluzone.push({ osoba: s.osoba, talia: s.talia, karta, brakTCount: s.brakT.length });
        }
      }
    }

    // Krok 2: zatwierdź wszystkie przypisania
    przypisania.forEach(({ dawca, odbiorca, karta, s }) => {
      wysylajacy.add(dawca.id);
      zaznaczDostala(odbiorca.id);
      planoweWymiany.push({
        od: dawca.nazwa, do: odbiorca.nazwa,
        karta: karta.nazwa, talia: s.talia.nazwa,
        nagroda: s.nagroda, faza: 100,
        brakTCount: s.brakT.length, brakOCount: s.brakO.length,
        trudna: s.trudna,
      });
    });

    // POTEM też talie z brakiem opp (nie da się domknąć, ale gracz może być blisko)
    const reszta = staneTalii.filter(s => !s.kompletOpp).sort((a, b) => {
      if (b.nagroda !== a.nagroda) return b.nagroda - a.nagroda;
      return a.brakT.length - b.brakT.length;
    });

    for (const s of reszta) {
      for (const karta of s.brakT) {
        let dawca = null;
        for (const o2 of dawcy) {
          if (o2.id === s.osoba.id || wysylajacy.has(o2.id)) continue;
          if (!duplikaty[`${o2.id}_${s.talia.id}_${karta.nazwa}`]) continue;
          // Nie używaj dawcy jeśli jest rezerwowany dla cenniejszej wymiany
          if (dawcaRezerwowany(o2.id, s.nagroda)) continue;
          dawca = o2; break;
        }
        // Jeśli nie znaleziono niezarezerwowanego — użyj dowolnego
        if (!dawca) {
          for (const o2 of dawcy) {
            if (o2.id === s.osoba.id || wysylajacy.has(o2.id)) continue;
            if (duplikaty[`${o2.id}_${s.talia.id}_${karta.nazwa}`]) {
              dawca = o2; break;
            }
          }
        }
        if (dawca && czyMozeDostac(s.osoba.id)) {
          wysylajacy.add(dawca.id);
          zaznaczDostala(s.osoba.id);
          planoweWymiany.push({
            od: dawca.nazwa, do: s.osoba.nazwa,
            karta: karta.nazwa, talia: s.talia.nazwa,
            nagroda: s.nagroda, faza: 110,
            brakTCount: s.brakT.length, brakOCount: s.brakO.length,
            trudna: s.trudna,
          });
        }
      }
    }
  } else if (tryb === "progi") {
    // TRYB "DOBIJ PROGI"
    // Priorytet: osoby najbliższe progu (1-5 kart)
    // Sortuj po: brakujeDoProg ASC (najmniej brakuje = najwyższy priorytet)
    // Potem po ammoProg DESC (większa nagroda za próg = wyższy priorytet)
    // Wysyłaj DOWOLNĄ kartę której brakuje — niekoniecznie zamykającą talię

    const progiKandydaci = [];

    czlonkowie.forEach(osoba => {
      const progInfo = progiOsob[osoba.id];
      if (!progInfo?.nastepnyProg) return; // już ma wszystkie progi

      talie.forEach(talia => {
        const kartyT = talia.karty.filter(k => k.typ === typ);
        kartyT.forEach(karta => {
          const key = `${osoba.id}_${talia.id}_${karta.nazwa}`;
          if (posiadane[key]) return; // już ma
          progiKandydaci.push({
            osoba, talia, karta,
            brakujeDoProg: progInfo.brakujeDoProg,
            ammoProg: progInfo.ammoProg,
            nastepnyProg: progInfo.nastepnyProg,
            nagroda: pobierzNagrode(talia, osoba?.krag || 1),
            trudna: TRUDNE_NUMERY.includes(talia.numer),
          });
        });
      });
    });

    // Sortuj: najmniej brakuje do progu → największa nagroda za próg → nagroda talii
    progiKandydaci.sort((a, b) => {
      if (a.brakujeDoProg !== b.brakujeDoProg) return a.brakujeDoProg - b.brakujeDoProg;
      if (b.ammoProg !== a.ammoProg) return b.ammoProg - a.ammoProg;
      if (b.nagroda !== a.nagroda) return b.nagroda - a.nagroda;
      if (!ignorujTrudne) { const aT=a.trudna?1:0,bT=b.trudna?1:0; if(aT!==bT) return aT-bT; }
      return 0;
    });

    // Przydziel dawców — ta sama logika rekurencyjna
    const _znajdzAlternDawceProgi = (wymiana) => { // eslint-disable-line no-unused-vars
      const t = talie.find(t => t.nazwa === wymiana.talia);
      if (!t) return null;
      const odbiorca = czlonkowie.find(c => c.nazwa === wymiana.do);
      for (const o2 of dawcy) {
        if (!odbiorca || o2.id === odbiorca.id) continue;
        if (o2.nazwa === wymiana.od) continue;
        if (wysylajacy.has(o2.id)) continue;
        if (duplikaty[`${o2.id}_${t.id}_${wymiana.karta}`]) return o2;
      }
      return null;
    };

    const probujUwolnicProgi = (potrzebnyDawca, wykluczonaOsobaId, odwiedzone = new Set()) => {
      if (odwiedzone.has(potrzebnyDawca.nazwa)) return false;
      odwiedzone.add(potrzebnyDawca.nazwa);
      const jegaWymiana = planoweWymiany.find(w => w.od === potrzebnyDawca.nazwa);
      if (!jegaWymiana) return false;
      const t = talie.find(t => t.nazwa === jegaWymiana.talia);
      if (!t) return false;
      const odbiorca = czlonkowie.find(c => c.nazwa === jegaWymiana.do);
      for (const o2 of dawcy) {
        if (!odbiorca || o2.id === odbiorca.id) continue;
        if (o2.nazwa === jegaWymiana.od) continue;
        if (o2.id === wykluczonaOsobaId) continue;
        if (odwiedzone.has(o2.nazwa)) continue;
        if (!duplikaty[`${o2.id}_${t.id}_${jegaWymiana.karta}`]) continue;
        if (!wysylajacy.has(o2.id)) {
          const idx = planoweWymiany.indexOf(jegaWymiana);
          planoweWymiany[idx] = { ...jegaWymiana, od: o2.nazwa };
          wysylajacy.delete(potrzebnyDawca.id);
          wysylajacy.add(o2.id);
          return true;
        }
      }
      for (const o2 of dawcy) {
        if (!odbiorca || o2.id === odbiorca.id) continue;
        if (o2.nazwa === jegaWymiana.od) continue;
        if (o2.id === wykluczonaOsobaId) continue;
        if (odwiedzone.has(o2.nazwa)) continue;
        if (!duplikaty[`${o2.id}_${t.id}_${jegaWymiana.karta}`]) continue;
        if (!wysylajacy.has(o2.id)) continue;
        if (probujUwolnicProgi(o2, wykluczonaOsobaId, odwiedzone)) {
          const idx = planoweWymiany.indexOf(jegaWymiana);
          planoweWymiany[idx] = { ...jegaWymiana, od: o2.nazwa };
          wysylajacy.delete(potrzebnyDawca.id);
          wysylajacy.add(o2.id);
          return true;
        }
      }
      return false;
    };

    // Śledź ile kart już idzie do każdej osoby (żeby wiedzieć kiedy próg przekroczony)
    const kartIdaceDo = {}; // osobaId -> count

    for (const k of progiKandydaci) {
      const key = `${k.osoba.id}_${k.talia.id}_${k.karta.nazwa}`;
      if (posiadane[key]) continue;
      if (planoweWymiany.some(w => w.do === k.osoba.nazwa && w.talia === k.talia.nazwa && w.karta === k.karta.nazwa)) continue;

      // Sprawdź czy ta osoba już osiągnie próg dzięki kartom już zaplanowanym
      const juzIdzie = kartIdaceDo[k.osoba.id] || 0;
      const progInfo = progiOsob[k.osoba.id];
      if (juzIdzie >= progInfo.brakujeDoProg) continue; // próg już osiągnięty przez inne karty

      let dawca = null;
      for (const o2 of dawcy) {
        if (o2.id === k.osoba.id || wysylajacy.has(o2.id)) continue;
        if (duplikaty[`${o2.id}_${k.talia.id}_${k.karta.nazwa}`]) { dawca = o2; break; }
      }

      if (!dawca) {
        for (const o2 of dawcy) {
          if (o2.id === k.osoba.id || !wysylajacy.has(o2.id)) continue;
          if (!duplikaty[`${o2.id}_${k.talia.id}_${k.karta.nazwa}`]) continue;
          if (probujUwolnicProgi(o2, k.osoba.id, new Set())) { dawca = o2; break; }
        }
      }

      if (dawca && czyMozeDostac(k.osoba.id)) {
        wysylajacy.add(dawca.id);
        zaznaczDostala(k.osoba.id);
        kartIdaceDo[k.osoba.id] = (kartIdaceDo[k.osoba.id] || 0) + 1;
        const faza = obliczFaze(
          k.talia.karty.filter(c=>c.typ===typ&&!posiadane[`${k.osoba.id}_${k.talia.id}_${c.nazwa}`]).length,
          k.talia.karty.filter(c=>c.typ!==typ&&!posiadane[`${k.osoba.id}_${k.talia.id}_${c.nazwa}`]).length,
          typWymiany
        );
        planoweWymiany.push({
          od: dawca.nazwa, do: k.osoba.nazwa,
          karta: k.karta.nazwa, talia: k.talia.nazwa,
          nagroda: k.nagroda, faza,
          brakTCount: 1, brakOCount: 0,
          trudna: k.trudna,
          progBonus: k.ammoProg,
          bliskoProg: true,
          doProgu: k.brakujeDoProg,
        });
      }
    }
  } else {
    // Gdy brak wolnego dawcy — sprawdź czy zajęty dawca ma alternatywę
    // i jeśli tak, podmień go tam gdzie jest mniej ważny

    // ============================================================
    // TRYB 7-9 — priorytetowo obsługuje talie z kręgów 7, 8, 9
    // ============================================================
    if (tryb === "krag79") {
      const priorytet79 = (st) => {
        const brakT = st.brakT.length;
        const brakO = st.brakO.length;
        let grupa;
        if (brakT === 1 && brakO === 0) grupa = 1;
        else if (brakT === 2 && brakO === 0) grupa = 2;
        else if (brakT === 1 && brakO === 1) grupa = 3;
        else if ((brakT === 2 && brakO === 1) || (brakT === 1 && brakO === 2)) grupa = 4;
        else if (brakT === 2 && brakO === 2) grupa = 5;
        else return null; // 3+ brakujących → normalna pętla
        return grupa * 1000000 - st.nagroda;
      };

      const stany79 = staneTalii
        .filter(st => [7,8,9].includes(st.talia.numer) && priorytet79(st) !== null)
        .sort((a, b) => priorytet79(a) - priorytet79(b));

      for (const st of stany79) {
        if (!czyMozeDostac(st.osoba.id)) continue;
        const karta = st.brakT[0];
        if (!karta) continue;
        let dawca = null;
        let dawcaFallback = null;
        for (const o2 of dawcy) {
          if (o2.id === st.osoba.id || wysylajacy.has(o2.id)) continue;
          if (!duplikaty[`${o2.id}_${st.talia.id}_${karta.nazwa}`]) continue;
          if (dawcaRezerwowany(o2.id, st.nagroda)) {
            if (!dawcaFallback) dawcaFallback = o2;
            continue;
          }
          dawca = o2; break;
        }
        if (!dawca) dawca = dawcaFallback;
        if (!dawca) continue;
        wysylajacy.add(dawca.id);
        zaznaczDostala(st.osoba.id);
        planoweWymiany.push({
          od: dawca.nazwa, do: st.osoba.nazwa,
          karta: karta.nazwa, talia: st.talia.nazwa,
          nagroda: st.nagroda,
          faza: obliczFaze(st.brakT.length, st.brakO.length, typWymiany),
          brakTCount: st.brakT.length, brakOCount: st.brakO.length,
          trudna: st.trudna,
        });
      }

      // Talie 7-9 z 3+ brakującymi pozostają w staneTalii dla normalnej pętli
      // Usuń ze staneTalii te które już obsłużyliśmy (zostały wysłane)

      // staneTalii zostaje niezmienione — normalna pętla obsłuży resztę
    }

    const priorytetFazy = (faza) => {
      const kolejnosc = [10,20,11,21,12,22,30,31,32,41,42,51,52];
      const idx = kolejnosc.indexOf(faza);
      return idx === -1 ? 99 : idx;
    };

    // Sprawdź czy talia może być faktycznie zamknięta — czy wszystkie brakujące karty mają potencjalnych dawców

    const potrzebyGrup = staneTalii
      .map(s => {
        const efNagroda = obliczEfektywnaНagrode(s.osoba.id, s.talia.id, s.brakT.length);
        const faza = obliczFaze(s.brakT.length, s.brakO.length, typWymiany);
        const progInfo = progiOsob[s.osoba.id];
        // Sprawdź czy talia może być faktycznie zamknięta
        // Każda brakująca karta musi mieć WOLNEGO i INNEGO dawcę
        const moznaZamknac = (() => {
          const uzyteDawcy = new Set();
          return s.brakT.every(karta => {
            // Wolny dawca = nie jest w wysylajacy i nie jest już użyty dla innej karty tej samej osoby
            const dawca = czlonkowie.find(o2 =>
              o2.id !== s.osoba.id &&
              !uzyteDawcy.has(o2.id) &&
              !wysylajacy.has(o2.id) &&
              duplikaty[`${o2.id}_${s.talia.id}_${karta.nazwa}`]
            );
            if (dawca) { uzyteDawcy.add(dawca.id); return true; }
            return false;
          });
        })();
        return { ...s, faza, efNagroda, moznaZamknac,
          bliskoProg: !!(progInfo?.nastepnyProg && progInfo.brakujeDoProg <= 2),
          progBonus: efNagroda - s.nagroda
        };
      })
      .sort((a, b) => {
        const pa = priorytetFazy(a.faza), pb = priorytetFazy(b.faza);
        const aZamknie = a.faza === 10 || a.faza === 20;
        const bZamknie = b.faza === 10 || b.faza === 20;
        if (aZamknie && bZamknie) {
          // Najpierw te które MOGĄ być faktycznie zamknięte (wszyscy dawcy dostępni)
          if (a.moznaZamknac !== b.moznaZamknac) return b.moznaZamknac ? 1 : -1;
          // Ammo per dawca
          const aPerDawca = a.efNagroda / Math.max(1, a.brakT.length);
          const bPerDawca = b.efNagroda / Math.max(1, b.brakT.length);
          if (Math.round(bPerDawca) !== Math.round(aPerDawca)) return bPerDawca - aPerDawca;
          if (pa !== pb) return pa - pb;
          return 0;
        }
        if (aZamknie !== bZamknie) return aZamknie ? -1 : 1;
        if (pa !== pb) return pa - pb;
        if (b.efNagroda !== a.efNagroda) return b.efNagroda - a.efNagroda;
        if (!ignorujTrudne) { const aT=a.trudna?1:0,bT=b.trudna?1:0; if(aT!==bT) return aT-bT; }
        return 0;
      });

    // Rekurencyjny solver łańcucha podmian
    // Próbuje uwolnić dawcę poprzez podmianę łańcucha przydziałów
    // odwiedzone = Set nazw dawców których już sprawdzaliśmy (zapobiega nieskończonej pętli)
    const probujUwolnicDawce = (potrzebnyDawca, wykluczonaOsobaId, odwiedzone = new Set(), naszAktFaza = 99) => {
      if (odwiedzone.has(potrzebnyDawca.nazwa)) return false;
      odwiedzone.add(potrzebnyDawca.nazwa);

      const jegaWymiana = planoweWymiany.find(w => w.od === potrzebnyDawca.nazwa);
      if (!jegaWymiana) return false;

      const t = talie.find(t => t.nazwa === jegaWymiana.talia);
      if (!t) return false;

      // Nie podmieniaj jeśli tamta wymiana jest wyższego priorytetu (niższa faza = wyższy priorytet)
      const priorytetTamtej = priorytetFazy(jegaWymiana.faza || 99);
      const priorytetNaszej = priorytetFazy(naszAktFaza);
      if (priorytetTamtej < priorytetNaszej) return false; // tamta ważniejsza

      const odbiorca = czlonkowie.find(c => c.nazwa === jegaWymiana.do);

      // Szukaj wolnego zastępcy dla jego wymiany
      for (const o2 of dawcy) {
        if (!odbiorca || o2.id === odbiorca.id) continue;
        if (o2.nazwa === jegaWymiana.od) continue;
        if (o2.id === wykluczonaOsobaId) continue;
        if (odwiedzone.has(o2.nazwa)) continue;
        if (!duplikaty[`${o2.id}_${t.id}_${jegaWymiana.karta}`]) continue;

        if (!wysylajacy.has(o2.id)) {
          // Znaleziono wolnego zastępcę — podmień
          const idx = planoweWymiany.indexOf(jegaWymiana);
          planoweWymiany[idx] = { ...jegaWymiana, od: o2.nazwa };
          wysylajacy.delete(potrzebnyDawca.id);
          wysylajacy.add(o2.id);
          return true;
        }
      }

      // Brak wolnego zastępcy — spróbuj rekurencyjnie uwolnić kogoś zajętego
      for (const o2 of dawcy) {
        if (!odbiorca || o2.id === odbiorca.id) continue;
        if (o2.nazwa === jegaWymiana.od) continue;
        if (o2.id === wykluczonaOsobaId) continue;
        if (odwiedzone.has(o2.nazwa)) continue;
        if (!duplikaty[`${o2.id}_${t.id}_${jegaWymiana.karta}`]) continue;
        if (!wysylajacy.has(o2.id)) continue;

        // o2 jest zajęty — próbuj go uwolnić rekurencyjnie
        if (probujUwolnicDawce(o2, wykluczonaOsobaId, odwiedzone, naszAktFaza)) {
          // Udało się uwolnić o2 — teraz podmień
          const idx = planoweWymiany.indexOf(jegaWymiana);
          planoweWymiany[idx] = { ...jegaWymiana, od: o2.nazwa };
          wysylajacy.delete(potrzebnyDawca.id);
          wysylajacy.add(o2.id);
          return true;
        }
      }

      return false;
    };

    // Iterujemy dynamicznie — po każdym przydziale re-sortujemy żeby uwzględnić
    // aktualny stan wysylajacy (kto jest wolny) przy obliczaniu moznaZamknac
    let pozostale = [...potrzebyGrup.flatMap(s => s.brakT.map(karta => ({...s, kartaDoObs: karta})))];

    while (pozostale.length > 0) {
      // Re-oblicz moznaZamknac dla każdego kandydata z aktualnym stanem wysylajacy
      pozostale = pozostale
        .filter(k => {
          const key = `${k.osoba.id}_${k.talia.id}_${k.kartaDoObs.nazwa}`;
          if (posiadane[key]) return false;
          if (planoweWymiany.some(w => w.do===k.osoba.nazwa && w.talia===k.talia.nazwa && w.karta===k.kartaDoObs.nazwa)) return false;
          return true;
        })
        .map(k => {
          const juzIdzie = planoweWymiany.filter(w => w.do===k.osoba.nazwa && w.talia===k.talia.nazwa).length;
          const aktBrakT = Math.max(1, k.brakT.length - juzIdzie);
          const aktFaza = obliczFaze(aktBrakT, k.brakO.length, typWymiany);
          // Dla ammo per dawca: liczymy jakby ta karta była ostatnią brakującą
          // żeby każda karta z fazy 20 konkurowała równorzędnie z fazą 10
          const aktEfNagroda = obliczEfektywnaНagrode(k.osoba.id, k.talia.id, 1);
          // Ile wolnych dawców dla tej karty
          const maWolnegoDawce = czlonkowie.some(o2 =>
            o2.id !== k.osoba.id && !wysylajacy.has(o2.id) &&
            duplikaty[`${o2.id}_${k.talia.id}_${k.kartaDoObs.nazwa}`]
          );
          // Czy cała talia mozna zamknac (wszystkie brakujące karty mają wolnych dawców)
          const pozostaleBrakT = k.brakT.filter(kk => {
            const key = `${k.osoba.id}_${k.talia.id}_${kk.nazwa}`;
            return !posiadane[key] && !planoweWymiany.some(w => w.do===k.osoba.nazwa && w.talia===k.talia.nazwa && w.karta===kk.nazwa);
          });
          const uzyteDawcy = new Set();
          const moznaZamknac = pozostaleBrakT.every(kk => {
            const d = czlonkowie.find(o2 =>
              o2.id !== k.osoba.id && !uzyteDawcy.has(o2.id) && !wysylajacy.has(o2.id) &&
              duplikaty[`${o2.id}_${k.talia.id}_${kk.nazwa}`]
            );
            if (d) { uzyteDawcy.add(d.id); return true; }
            return false;
          });
          return {...k, aktBrakT, aktFaza, aktEfNagroda, moznaZamknac, maWolnegoDawce};
        })
        .sort((a, b) => {
          const pa = priorytetFazy(a.aktFaza), pb = priorytetFazy(b.aktFaza);
          const aZamknie = a.aktFaza===10||a.aktFaza===20;
          const bZamknie = b.aktFaza===10||b.aktFaza===20;
          if (aZamknie && bZamknie) {
            // Najpierw te które MOGĄ być zamknięte (wolni dawcy dla wszystkich kart)
            if (a.moznaZamknac !== b.moznaZamknac) return b.moznaZamknac ? 1 : -1;
            const aPerDawca = a.aktEfNagroda / Math.max(1, a.aktBrakT);
            const bPerDawca = b.aktEfNagroda / Math.max(1, b.aktBrakT);
            if (Math.round(bPerDawca) !== Math.round(aPerDawca)) return bPerDawca - aPerDawca;
            // TIEBREAKER: kto ma większy dług (rzadziej dostawał karty) → wyższy priorytet
            const dlugA = priorytetSprawiedliwy(a.osoba.nazwa);
            const dlugB = priorytetSprawiedliwy(b.osoba.nazwa);
            if (Math.abs(dlugB - dlugA) > 0.5) return dlugB - dlugA;
            if (pa !== pb) return pa - pb;
            return 0;
          }
          if (aZamknie !== bZamknie) return aZamknie ? -1 : 1;
          if (pa !== pb) return pa - pb;
          if (b.aktEfNagroda !== a.aktEfNagroda) return b.aktEfNagroda - a.aktEfNagroda;
          if (!ignorujTrudne) { const aT=a.trudna?1:0,bT=b.trudna?1:0; if(aT!==bT) return aT-bT; }
          return 0;
        });

      if (pozostale.length === 0) break;

      // Tryb sprawiedliwy: przy wielu kandydatach na tę samą kartę
      // wybierz osobę z największym "długiem" (najrzadziej dostawała karty)
      // Capture w const przed callbackiem — fix no-loop-func
      const pozostaleSnapshot = pozostale;
      const pierwszyKandydat = pozostaleSnapshot[0];
      let wybranyKandydat = pierwszyKandydat;

      if (sprawiedliwe && pozostaleSnapshot.length > 1) {
        // Znajdź wszystkich kandydatów którzy chcą TĄ SAMĄ kartę z TEJ SAMEJ talii
        const nazwaKarty = pierwszyKandydat.kartaDoObs.nazwa;
        const taliaId = pierwszyKandydat.talia.id;
        const duplikacyCandidates = pozostaleSnapshot.filter(k2 =>
          k2.kartaDoObs.nazwa === nazwaKarty &&
          k2.talia.id === taliaId &&
          k2.osoba.id !== pierwszyKandydat.osoba.id &&
          czyMozeDostac(k2.osoba.id) &&
          dawcy.some(o2 => o2.id !== k2.osoba.id && !wysylajacy.has(o2.id) && duplikaty[`${o2.id}_${k2.talia.id}_${k2.kartaDoObs.nazwa}`])
        );
        if (duplikacyCandidates.length > 1) {
          duplikacyCandidates.sort((a, b) => {
            const dlugA = priorytetSprawiedliwy(a.osoba.nazwa);
            const dlugB = priorytetSprawiedliwy(b.osoba.nazwa);
            if (Math.abs(dlugB - dlugA) > 0.5) return dlugB - dlugA;
            return 0;
          });
          wybranyKandydat = duplikacyCandidates[0];
          pozostale = [wybranyKandydat, ...pozostaleSnapshot.filter(k2 => k2 !== wybranyKandydat)];
        }
      }

      const k = pozostale[0];
      pozostale = pozostale.slice(1);

      const s = k;
      const karta = k.kartaDoObs;
      const aktBrakT = k.aktBrakT;
      const aktFaza = k.aktFaza;
      const aktEfNagroda = k.aktEfNagroda;

        // Poziom 1: wolny dawca
        let dawca = null;
        for (const o2 of dawcy) {
          if (o2.id === s.osoba.id || wysylajacy.has(o2.id)) continue;
          if (duplikaty[`${o2.id}_${s.talia.id}_${karta.nazwa}`]) { dawca = o2; break; }
        }

        // Poziom 2: zajęty dawca → próbuj uwolnić przez łańcuch podmian
        if (!dawca) {
          for (const o2 of dawcy) {
            if (o2.id === s.osoba.id || !wysylajacy.has(o2.id)) continue;
            if (!duplikaty[`${o2.id}_${s.talia.id}_${karta.nazwa}`]) continue;

          if (probujUwolnicDawce(o2, s.osoba.id, new Set(), aktFaza)) {
              dawca = o2;
              break;
            }
          }
        }

        if (dawca && czyMozeDostac(s.osoba.id)) {
          wysylajacy.add(dawca.id);
          zaznaczDostala(s.osoba.id);
          planoweWymiany.push({
            od: dawca.nazwa, do: s.osoba.nazwa,
            karta: karta.nazwa, talia: s.talia.nazwa,
            nagroda: s.nagroda, faza: aktFaza,
            brakTCount: aktBrakT, brakOCount: s.brakO.length,
            trudna: s.trudna, progBonus: aktEfNagroda - s.nagroda,
            bliskoProg: s.bliskoProg||false,
          });
        } else if (s.brakT.length <= 3) {
          nieobsluzone.push({ osoba: s.osoba, talia: s.talia, karta, brakTCount: s.brakT.length });
        }
    } // end while
  }

  const symPos={...posiadane};
  planoweWymiany.forEach(w=>{
    const o=czlonkowie.find(c=>c.nazwa===w.do);
    const t=talie.find(t=>t.nazwa===w.talia);
    if(o&&t) symPos[`${o.id}_${t.id}_${w.karta}`]=true;
  });
  const zamknieciaInfo=[];
  czlonkowie.forEach(osoba=>{
    talie.forEach(talia=>{
      const kPrzed=talia.karty.every(k=>posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]);
      const kPo=talia.karty.every(k=>symPos[`${osoba.id}_${talia.id}_${k.nazwa}`]);
      if(!kPrzed&&kPo){
        // Sprawdź czy przy okazji przekroczy próg
        const liczbaPoWymianie=liczKartyOsoby(osoba.id,talie,symPos);
        const obliczProgFn = isEvent ? obliczProgEvent : obliczProg;
        const progPrzed=obliczProgFn(liczKartyOsoby(osoba.id,talie,posiadane));
        const progPo=obliczProgFn(liczbaPoWymianie);
        const nowyProg=progPo.ostatniProg?.prog > (progPrzed.ostatniProg?.prog||0);
        zamknieciaInfo.push({
          osoba:osoba.nazwa, talia:talia.nazwa, nagroda:pobierzNagrode(talia,osoba.krag),
          nowyProg: nowyProg ? progPo.ostatniProg : null,
        });
      }
    });
  });

  return {planoweWymiany,nieobsluzone,zamknieciaInfo};
}

function generujAlgorytmV3({talie,czlonkowie,wszyscyCzlonkowie,posiadane,duplikaty,typWymiany,tryb,vipKolejka=[],celowaKolejka={},ignorujTrudne=false,historiaWymian=[],sprawiedliwe=false,maxKartNaOsobe=0,limitKartOsoby={},paczkiDiament={}}) {
  // czlonkowie = odbiorcy (aktywni), wszyscyCzlonkowie = dawcy (wszyscy łącznie z wyłączonymi)
  const dawcy = wszyscyCzlonkowie || czlonkowie;
  // Licznik kart przydzielonych per odbiorca (do limitu maxKartNaOsobe)
  const kartDlaosoby = {}; // osobaId -> count
  // Oblicz ile kart diamentowych brakuje danej osobie (do zamknięcia kręgu)
  // Ile diamentowych kart brakuje osobie do zamknięcia kręgu (łącznie we wszystkich taliach)
  const brakDiamentOsoby = (osobaId) => {
    if (typWymiany !== "diamentowe") return 0;
    return talie.reduce((sum,t)=>sum+(t.karty.filter(k=>k.typ==="diamentowa"&&!posiadane[osobaId+"_"+t.id+"_"+k.nazwa]).length),0);
  };

  // Ile jeszcze kart potrzeba po odjęciu paczek
  const brakPoOdjęciuPaczek = (osobaId) => {
    if (tryb !== "paczki_diament") return null;
    const paczki = paczkiDiament[osobaId] || 0;
    const brakLacznie = brakDiamentOsoby(osobaId);
    return Math.max(0, brakLacznie - paczki);
  };

  // Limit kart dla trybu paczki — ile kart max może dostać osoba w tej wymianie
  const limitPaczkiDiament = (osobaId) => {
    if (tryb !== "paczki_diament" || !(osobaId in paczkiDiament)) return null;
    const brakEfektywny = brakPoOdjęciuPaczek(osobaId);
    // Wyklucz jeśli paczki pokrywają cały brak
    if (brakEfektywny === 0) return 0;
    // Obsługuj tylko jeśli brak efektywny <= 4 (nie przepalamy wymian)
    if (brakEfektywny > 4) return 0;
    return brakEfektywny; // max tyle kart ile faktycznie potrzeba
  };

  const czyMozeDostac = (osobaId) => {
    const ile = kartDlaosoby[osobaId] || 0;
    // Tryb paczki
    if (tryb === "paczki_diament" && osobaId in paczkiDiament) {
      const limit = limitPaczkiDiament(osobaId);
      if (limit === 0) return false; // wykluczona
      if (limit !== null) return ile < limit;
    }
    // Indywidualny limit per osoba
    if (limitKartOsoby[osobaId] !== undefined) return ile < limitKartOsoby[osobaId];
    return maxKartNaOsobe <= 0 || ile < maxKartNaOsobe;
  };
  const zaznaczDostala = (osobaId) => { kartDlaosoby[osobaId] = (kartDlaosoby[osobaId]||0) + 1; };

  // TRYB SPRAWIEDLIWY — oblicz "dług" każdej osoby
  // Dług = ile kart poniżej średniej gangu dana osoba otrzymała w historii
  // Wyższy dług = wyższy priorytet przy konflikcie o duplikat
  const dlugOsob = {}; // {nazwa: liczba} — im wyższy tym bardziej "poszkodowany"
  if (sprawiedliwe && historiaWymian.length > 0) {
    const licznikOtrzymanych = obliczLicznikOtrzymanych(historiaWymian);
    // Łączna liczba kart rozdanych
    const lacznieRozdano = Object.values(licznikOtrzymanych).reduce((s,v)=>s+v, 0);
    // Średnia na osobę (biorąc pod uwagę wszystkich członków)
    const srednia = lacznieRozdano / Math.max(1, czlonkowie.length);
    czlonkowie.forEach(c => {
      const dostala = licznikOtrzymanych[c.nazwa] || 0;
      dlugOsob[c.nazwa] = srednia - dostala; // ujemny = dostała więcej niż średnia
    });
  }

  // Zwraca priorytet sprawiedliwości dla osoby (wyższy = wyższy priorytet)
  // Używane przy konflikcie o ten sam duplikat
  const priorytetSprawiedliwy = (nazwaosoby) => {
    if (!sprawiedliwe) return 0;
    return dlugOsob[nazwaosoby] || 0;
  };
  const isEvent = typWymiany === "event";
  const typ=typWymiany==="złote"?"złota":isEvent?"diamentowa":"diamentowa";
  const oppTyp=typWymiany==="złote"?"diamentowa":isEvent?null:"złota";

  // Oblicz progi dla każdej osoby
  // W EVENCIE progi celowo NIE są brane pod uwagę przy generowaniu rozpiski —
  // zwracamy neutralny obiekt (brak "następnego progu"), co automatycznie wyłącza
  // bonus za zbliżanie się do progu, sortowanie po progu i tryb "Dobij progi".
  // Tryb zwykły (złote/diamentowe) działa bez zmian.
  const progiOsob={};
  czlonkowie.forEach(osoba=>{
    if(isEvent){
      progiOsob[osoba.id]={obecna:0,nastepnyProg:null,brakujeDoProg:0,ostatniProg:null,ammoProg:0};
    } else {
      const liczba=liczKartyOsoby(osoba.id,talie,posiadane);
      progiOsob[osoba.id]=obliczProg(liczba);
    }
  });

  // Oblicz efektywną nagrodę: nagroda talii + ewentualna nagroda za próg
  const obliczEfektywnaНagrode=(osobaId, taliaId, brakujaceKarty)=>{
    const prog=progiOsob[osobaId];
    const nagrodaTalii=talie.find(t=>t.id===taliaId); const _osobaObj=czlonkowie.find(c=>c.id===osobaId); const nagroda=nagrodaTalii?pobierzNagrode(nagrodaTalii,_osobaObj?.krag||1):0;
    // Czy ta wymiana (dostając brakujace karty) przekroczy próg?
    let bonusProg=0;
    if(prog.nastepnyProg && prog.brakujeDoProg<=brakujaceKarty){
      bonusProg=prog.ammoProg;
    }
    return nagroda+bonusProg;
  };

  // TRYB VIP — kolejka priorytetów
  // ============================================================
  // HELPER: sprawdza czy dawca jest potrzebny do zamknięcia cenniejszej talii
  // Zdefiniowany wcześniej bo używany w trybie celowanym i reszcie algorytmu
  const staneTaliiRef = { list: [] };
  const dawcaRezerwowany = (dawcaId, nagroda) => {
    return staneTaliiRef.list.some(st => {
      if (st.nagroda <= nagroda) return false;
      if (wysylajacy.has(dawcaId)) return false;
      return st.brakT.some(k =>
        duplikaty[`${dawcaId}_${st.talia.id}_${k.nazwa}`]
      );
    });
  };

  if(tryb==="vip" && vipKolejka.length>0) {
    const planoweWymiany=[];
    const nieobsluzone=[];
    const wysylajacy=new Set();

    // Obsługuj osoby po kolei wg kolejki
    for(const vipId of vipKolejka){
      const vip=czlonkowie.find(c=>c.id===vipId);
      if(!vip) continue;
      const potrzeby=[];
      talie.forEach(talia=>{
        const kartyT=talia.karty.filter(k=>k.typ===typ);
        const kartyO=talia.karty.filter(k=>k.typ===oppTyp);
        const brakT=kartyT.filter(k=>!posiadane[`${vipId}_${talia.id}_${k.nazwa}`]);
        const brakO=kartyO.filter(k=>!posiadane[`${vipId}_${talia.id}_${k.nazwa}`]);
        if(!brakT.length) return;
        const faza=obliczFaze(brakT.length,brakO.length,typWymiany);
        const kompletOpp=brakO.length===0;
        brakT.forEach(karta=>{
          potrzeby.push({talia,karta,faza,kompletOpp,nagroda:pobierzNagrode(talia,vip.krag||1),trudna:TRUDNE_NUMERY.includes(talia.numer),brakTCount:brakT.length,brakOCount:brakO.length});
        });
      });
      // Sortuj VIP tak samo jak normalny tryb:
      // 1. Talie do zamknięcia (brakuje tylko kilku kart + ma komplet drugiego typu)
      // 2. Faza (im niższa tym bliżej zamknięcia)
      // 3. Nagroda (wyższa lepsza)
      potrzeby.sort((a,b)=>{
        if(a.kompletOpp!==b.kompletOpp) return a.kompletOpp?-1:1;
        if(a.faza!==b.faza) return a.faza-b.faza;
        if(b.nagroda!==a.nagroda) return b.nagroda-a.nagroda;
        return ignorujTrudne ? 0 : (a.trudna?1:0)-(b.trudna?1:0);
      });
      potrzeby.forEach((p)=>{
        const {talia,karta,nagroda,trudna}=p;
        let dawca=null;
        for(const o2 of dawcy){
          if(o2.id===vipId||wysylajacy.has(o2.id)) continue;
          if(duplikaty[`${o2.id}_${talia.id}_${karta.nazwa}`]){dawca=o2;break;}
        }
        if(dawca && czyMozeDostac(vip.id)){
          wysylajacy.add(dawca.id);
          zaznaczDostala(vip.id);
          planoweWymiany.push({od:dawca.nazwa,do:vip.nazwa,karta:karta.nazwa,talia:talia.nazwa,nagroda,faza:200,brakTCount:p.brakTCount||1,brakOCount:p.brakOCount||0,trudna});
        } else {
          nieobsluzone.push({osoba:vip,talia,karta,brakTCount:1});
        }
      });
    }

    // Po kolejce VIP — reszta gangu normalnym algorytmem (wszystkie fazy, bez ograniczeń)
    const vipSet=new Set(vipKolejka);
    const kandydaciReszta=[];
    czlonkowie.filter(c=>!vipSet.has(c.id)).forEach(osoba=>{
      talie.forEach(talia=>{
        const kartyT=talia.karty.filter(k=>k.typ===typ);
        const kartyO=talia.karty.filter(k=>k.typ===oppTyp);
        if(!kartyT.length) return;
        const brakT=kartyT.filter(k=>!posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]);
        const brakO=kartyO.filter(k=>!posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]);
        if(!brakT.length) return;
        const faza=obliczFaze(brakT.length,brakO.length,typWymiany);
        const kompletOpp = brakO.length === 0;
        brakT.forEach(karta=>{
          kandydaciReszta.push({osoba,talia,karta,faza,kompletOpp,nagroda:pobierzNagrode(talia,osoba.krag),trudna:TRUDNE_NUMERY.includes(talia.numer),brakTCount:brakT.length,brakOCount:brakO.length});
        });
      });
    });
    // Sortuj jak normalny tryb: najpierw talie do zamknięcia (kompletOpp), potem faza, potem nagroda
    kandydaciReszta.sort((a,b)=>{
      if(a.kompletOpp!==b.kompletOpp) return a.kompletOpp?-1:1;
      if(a.faza!==b.faza) return a.faza-b.faza;
      if(b.nagroda!==a.nagroda) return b.nagroda-a.nagroda;
      return ignorujTrudne ? 0 : (a.trudna?1:0)-(b.trudna?1:0);
    });
    for(const k of kandydaciReszta){
      let dawca=null;
      for(const o2 of dawcy){
        if(o2.id===k.osoba.id||wysylajacy.has(o2.id)) continue;
        if(duplikaty[`${o2.id}_${k.talia.id}_${k.karta.nazwa}`]){dawca=o2;break;}
      }
      if(dawca && czyMozeDostac(k.osoba.id)){
        wysylajacy.add(dawca.id);
        zaznaczDostala(k.osoba.id);
        planoweWymiany.push({od:dawca.nazwa,do:k.osoba.nazwa,karta:k.karta.nazwa,talia:k.talia.nazwa,nagroda:k.nagroda,faza:210,brakTCount:k.brakTCount,brakOCount:k.brakOCount,trudna:k.trudna});
      }
    }

    // Zamknięte talie
    const symPos={...posiadane};
    planoweWymiany.forEach(w=>{
      const o=czlonkowie.find(c=>c.nazwa===w.do);
      const t=talie.find(t=>t.nazwa===w.talia);
      if(o&&t) symPos[`${o.id}_${t.id}_${w.karta}`]=true;
    });
    const zamknieteTalie=[];
    talie.forEach(talia=>{
      czlonkowie.forEach(osoba=>{
        const brakPrzed=talia.karty.filter(k=>!posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]);
        const brakPo=talia.karty.filter(k=>!symPos[`${osoba.id}_${talia.id}_${k.nazwa}`]);
        if(brakPrzed.length>0&&brakPo.length===0) zamknieteTalie.push({osoba:osoba.nazwa,talia:talia.nazwa,nagroda:pobierzNagrode(talia,osoba.krag)});
      });
    });
    return {planoweWymiany,nieobsluzone,zamknieciaInfo:zamknieteTalie};
  }

  // Zbierz stan każdej talii dla każdej osoby
  // Dla faz 20+ (brakuje 2+ kart) — rozbij na osobne wpisy per karta
  // żeby każda karta konkurowała o dawcę równorzędnie z innymi fazami 10
  const staneTalii = [];
  czlonkowie.forEach(osoba => {
    talie.forEach(talia => {
      const kartyT = talia.karty.filter(k => k.typ === typ);
      const kartyO = talia.karty.filter(k => k.typ === oppTyp);
      if (!kartyT.length) return;
      const brakT = kartyT.filter(k => !posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]);
      const brakO = kartyO.filter(k => !posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]);
      if (!brakT.length) return;
      const nagroda = pobierzNagrode(talia, osoba.krag);
      const trudna = TRUDNE_NUMERY.includes(talia.numer);
      // kompletOpp = gracz ma WSZYSTKIE karty drugiego typu → talia może być zamknięta
      const kompletOpp = brakO.length === 0;
      staneTalii.push({ osoba, talia, brakT, brakO, nagroda, trudna, kompletOpp });
    });
  });

  const wysylajacy = new Set();
  const planoweWymiany = [];

  // Tryb paczki — sortuj osoby z paczkami na koniec (niższy priorytet)
  if (tryb === "paczki_diament") {
    staneTalii.sort((a, b) => {
      const aPaczki = a.osoba.id in paczkiDiament;
      const bPaczki = b.osoba.id in paczkiDiament;
      if (aPaczki !== bPaczki) return aPaczki ? 1 : -1; // osoby bez paczek pierwsze
      return 0;
    });
  }

  staneTaliiRef.list = staneTalii; // Wypełnij przed trybem celowanym

  // ============================================================
  // TRYB CELOWANY — wybrane osoby dostają priorytetowo X kart
  // ============================================================
  if(tryb==="celowany" && Object.keys(celowaKolejka).some(k=>celowaKolejka[k]>0)) {
    // Sortuj celowane osoby po sumie nagród (najcenniejsze pierwsze)
    const celowani = Object.entries(celowaKolejka)
      .filter(([,ile])=>ile>0)
      .map(([osobaId,ile])=>({
        osoba: czlonkowie.find(c=>c.id===parseInt(osobaId)||c.id===osobaId),
        ile,
      }))
      .filter(x=>x.osoba);

    for(const {osoba,ile} of celowani) {
      // Zbierz wszystkie możliwe karty dla tej osoby posortowane jak normalny algorytm
      const kandydaci=[];
      talie.forEach(talia=>{
        const kartyT=talia.karty.filter(k=>k.typ===typ);
        const kartyO=talia.karty.filter(k=>k.typ===oppTyp);
        const brakT=kartyT.filter(k=>!posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]);
        const brakO=kartyO.filter(k=>!posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]);
        if(!brakT.length) return;
        const faza=obliczFaze(brakT.length,brakO.length,typWymiany);
        const kompletOpp=brakO.length===0;
        brakT.forEach(karta=>{
          kandydaci.push({
            talia,karta,faza,kompletOpp,
            nagroda:pobierzNagrode(talia,osoba.krag),
            trudna:TRUDNE_NUMERY.includes(talia.numer),
            brakTCount:brakT.length,brakOCount:brakO.length,
          });
        });
      });

      // Sortuj: zamknięcia pierwsze, potem faza, potem nagroda
      kandydaci.sort((a,b)=>{
        if(a.kompletOpp!==b.kompletOpp) return a.kompletOpp?-1:1;
        if(a.faza!==b.faza) return a.faza-b.faza;
        if(b.nagroda!==a.nagroda) return b.nagroda-a.nagroda;
        return ignorujTrudne?0:(a.trudna?1:0)-(b.trudna?1:0);
      });

      // Przydziel do `ile` kart
      let przydzielono=0;
      for(const k of kandydaci) {
        if(przydzielono>=ile) break;
        if(!czyMozeDostac(osoba.id)) break;
        // Szukaj wolnego dawcy — preferuj niezarezerwowanych dla zamknięć talii
        let dawca=null;
        let dawcaFallback=null;
        for(const o2 of dawcy){
          if(o2.id===osoba.id||wysylajacy.has(o2.id)) continue;
          if(!duplikaty[`${o2.id}_${k.talia.id}_${k.karta.nazwa}`]) continue;
          // Nie bierz dawcy który jest potrzebny do zamknięcia talii komuś innemu
          if(dawcaRezerwowany(o2.id, k.nagroda)){
            if(!dawcaFallback) dawcaFallback=o2;
            continue;
          }
          dawca=o2; break;
        }
        // Fallback — użyj zarezerwowanego gdy nie ma innego
        if(!dawca) dawca=dawcaFallback;
        if(!dawca) continue;
        wysylajacy.add(dawca.id);
        zaznaczDostala(osoba.id);
        przydzielono++;
        planoweWymiany.push({
          od:dawca.nazwa,do:osoba.nazwa,
          karta:k.karta.nazwa,talia:k.talia.nazwa,
          nagroda:k.nagroda,faza:k.faza,
          brakTCount:k.brakTCount,brakOCount:k.brakOCount,
          trudna:k.trudna,
        });
      }
    }
    // Po obsłużeniu celowanych — reszta gangu normalnie (tryb priorytet)
  }


  const nieobsluzone = [];

  if (tryb === "zamknij") {
    // TRYB "ZAMKNIJ COKOLWIEK"
    // Priorytetyzuj talie które MOŻNA zamknąć w tej wymianie (komplet opp już zebrany)
    // Wśród nich — największa nagroda, potem najmniej brakuje
    // Dla każdej talii pakuj WIELE kart (od różnych dawców) żeby ją domknąć

    // Sprawdź czy dawca jest potrzebny dla cenniejszej talii w dozamkniecia
    // Definiujemy jako funkcję lazy — dozamkniecia obliczane poniżej
    const dozamknieciaRef = { list: [] };
    const dawcaRezerwowanyDozamkniecia = (dawcaId, nagroda) => {
      return dozamknieciaRef.list.some(st => {
        if (st.nagroda <= nagroda) return false;
        return st.brakT.some(k =>
          duplikaty[`${dawcaId}_${st.talia.id}_${k.nazwa}`] &&
          !wysylajacy.has(dawcaId)
        );
      });
    };

    const dozamkniecia = staneTalii
      .filter(s => s.kompletOpp) // tylko talie z kompletem drugiego typu — można je realnie zamknąć
      .sort((a, b) => {
        // Najpierw największa nagroda
        if (b.nagroda !== a.nagroda) return b.nagroda - a.nagroda;
        // Potem najmniej brakuje
        if (a.brakT.length !== b.brakT.length) return a.brakT.length - b.brakT.length;
        // Talie trudne na końcu
        const aT = a.trudna ? 1 : 0, bT = b.trudna ? 1 : 0;
        return ignorujTrudne ? 0 : aT - bT;
      });

    dozamknieciaRef.list = dozamkniecia;

    // DWUPRZEBIEGOWY algorytm dla dozamkniecia:
    // Przebieg 1: znajdź optymalne przypisanie dawców (nie blokuj)
    // Przebieg 2: zatwierdź przypisania

    // Krok 1: dla każdej karty w dozamkniecia znajdź najlepszego wolnego dawcę
    // Sortujemy globalnie po nagrodzie — najcenniejsze pierwsze
    const przypisania = []; // { dawca, odbiorca: s.osoba, karta, talia, nagroda, trudna, brakT }
    const zajenciDawcy = new Set();

    for (const s of dozamkniecia) {
      if (!czyMozeDostac(s.osoba.id)) continue;
      for (const karta of s.brakT) {
        // Znajdź wolnego dawcę który nie jest już zaplanowany dla tej rundy
        let dawca = null;
        let dawcaFallback = null;
        for (const o2 of dawcy) {
          if (o2.id === s.osoba.id || wysylajacy.has(o2.id) || zajenciDawcy.has(o2.id)) continue;
          if (!duplikaty[`${o2.id}_${s.talia.id}_${karta.nazwa}`]) continue;
          // Preferuj dawcę który NIE jest potrzebny dla cenniejszej wymiany
          if (dawcaRezerwowanyDozamkniecia(o2.id, s.nagroda)) {
            if (!dawcaFallback) dawcaFallback = o2;
            continue;
          }
          dawca = o2; break;
        }
        if (!dawca) dawca = dawcaFallback;
        if (dawca) {
          zajenciDawcy.add(dawca.id);
          przypisania.push({ dawca, odbiorca: s.osoba, karta, s });
        } else {
          nieobsluzone.push({ osoba: s.osoba, talia: s.talia, karta, brakTCount: s.brakT.length });
        }
      }
    }

    // Krok 2: zatwierdź wszystkie przypisania
    przypisania.forEach(({ dawca, odbiorca, karta, s }) => {
      wysylajacy.add(dawca.id);
      zaznaczDostala(odbiorca.id);
      planoweWymiany.push({
        od: dawca.nazwa, do: odbiorca.nazwa,
        karta: karta.nazwa, talia: s.talia.nazwa,
        nagroda: s.nagroda, faza: 100,
        brakTCount: s.brakT.length, brakOCount: s.brakO.length,
        trudna: s.trudna,
      });
    });

    // POTEM też talie z brakiem opp (nie da się domknąć, ale gracz może być blisko)
    const reszta = staneTalii.filter(s => !s.kompletOpp).sort((a, b) => {
      if (b.nagroda !== a.nagroda) return b.nagroda - a.nagroda;
      return a.brakT.length - b.brakT.length;
    });

    for (const s of reszta) {
      for (const karta of s.brakT) {
        let dawca = null;
        for (const o2 of dawcy) {
          if (o2.id === s.osoba.id || wysylajacy.has(o2.id)) continue;
          if (!duplikaty[`${o2.id}_${s.talia.id}_${karta.nazwa}`]) continue;
          // Nie używaj dawcy jeśli jest rezerwowany dla cenniejszej wymiany
          if (dawcaRezerwowany(o2.id, s.nagroda)) continue;
          dawca = o2; break;
        }
        // Jeśli nie znaleziono niezarezerwowanego — użyj dowolnego
        if (!dawca) {
          for (const o2 of dawcy) {
            if (o2.id === s.osoba.id || wysylajacy.has(o2.id)) continue;
            if (duplikaty[`${o2.id}_${s.talia.id}_${karta.nazwa}`]) {
              dawca = o2; break;
            }
          }
        }
        if (dawca && czyMozeDostac(s.osoba.id)) {
          wysylajacy.add(dawca.id);
          zaznaczDostala(s.osoba.id);
          planoweWymiany.push({
            od: dawca.nazwa, do: s.osoba.nazwa,
            karta: karta.nazwa, talia: s.talia.nazwa,
            nagroda: s.nagroda, faza: 110,
            brakTCount: s.brakT.length, brakOCount: s.brakO.length,
            trudna: s.trudna,
          });
        }
      }
    }
  } else if (tryb === "progi") {
    // TRYB "DOBIJ PROGI"
    // Priorytet: osoby najbliższe progu (1-5 kart)
    // Sortuj po: brakujeDoProg ASC (najmniej brakuje = najwyższy priorytet)
    // Potem po ammoProg DESC (większa nagroda za próg = wyższy priorytet)
    // Wysyłaj DOWOLNĄ kartę której brakuje — niekoniecznie zamykającą talię

    const progiKandydaci = [];

    czlonkowie.forEach(osoba => {
      const progInfo = progiOsob[osoba.id];
      if (!progInfo?.nastepnyProg) return; // już ma wszystkie progi

      talie.forEach(talia => {
        const kartyT = talia.karty.filter(k => k.typ === typ);
        kartyT.forEach(karta => {
          const key = `${osoba.id}_${talia.id}_${karta.nazwa}`;
          if (posiadane[key]) return; // już ma
          progiKandydaci.push({
            osoba, talia, karta,
            brakujeDoProg: progInfo.brakujeDoProg,
            ammoProg: progInfo.ammoProg,
            nastepnyProg: progInfo.nastepnyProg,
            nagroda: pobierzNagrode(talia, osoba?.krag || 1),
            trudna: TRUDNE_NUMERY.includes(talia.numer),
          });
        });
      });
    });

    // Sortuj: najmniej brakuje do progu → największa nagroda za próg → nagroda talii
    progiKandydaci.sort((a, b) => {
      if (a.brakujeDoProg !== b.brakujeDoProg) return a.brakujeDoProg - b.brakujeDoProg;
      if (b.ammoProg !== a.ammoProg) return b.ammoProg - a.ammoProg;
      if (b.nagroda !== a.nagroda) return b.nagroda - a.nagroda;
      if (!ignorujTrudne) { const aT=a.trudna?1:0,bT=b.trudna?1:0; if(aT!==bT) return aT-bT; }
      return 0;
    });

    // Przydziel dawców — ta sama logika rekurencyjna
    const _znajdzAlternDawceProgi = (wymiana) => { // eslint-disable-line no-unused-vars
      const t = talie.find(t => t.nazwa === wymiana.talia);
      if (!t) return null;
      const odbiorca = czlonkowie.find(c => c.nazwa === wymiana.do);
      for (const o2 of dawcy) {
        if (!odbiorca || o2.id === odbiorca.id) continue;
        if (o2.nazwa === wymiana.od) continue;
        if (wysylajacy.has(o2.id)) continue;
        if (duplikaty[`${o2.id}_${t.id}_${wymiana.karta}`]) return o2;
      }
      return null;
    };

    const probujUwolnicProgi = (potrzebnyDawca, wykluczonaOsobaId, odwiedzone = new Set()) => {
      if (odwiedzone.has(potrzebnyDawca.nazwa)) return false;
      odwiedzone.add(potrzebnyDawca.nazwa);
      const jegaWymiana = planoweWymiany.find(w => w.od === potrzebnyDawca.nazwa);
      if (!jegaWymiana) return false;
      const t = talie.find(t => t.nazwa === jegaWymiana.talia);
      if (!t) return false;
      const odbiorca = czlonkowie.find(c => c.nazwa === jegaWymiana.do);
      for (const o2 of dawcy) {
        if (!odbiorca || o2.id === odbiorca.id) continue;
        if (o2.nazwa === jegaWymiana.od) continue;
        if (o2.id === wykluczonaOsobaId) continue;
        if (odwiedzone.has(o2.nazwa)) continue;
        if (!duplikaty[`${o2.id}_${t.id}_${jegaWymiana.karta}`]) continue;
        if (!wysylajacy.has(o2.id)) {
          const idx = planoweWymiany.indexOf(jegaWymiana);
          planoweWymiany[idx] = { ...jegaWymiana, od: o2.nazwa };
          wysylajacy.delete(potrzebnyDawca.id);
          wysylajacy.add(o2.id);
          return true;
        }
      }
      for (const o2 of dawcy) {
        if (!odbiorca || o2.id === odbiorca.id) continue;
        if (o2.nazwa === jegaWymiana.od) continue;
        if (o2.id === wykluczonaOsobaId) continue;
        if (odwiedzone.has(o2.nazwa)) continue;
        if (!duplikaty[`${o2.id}_${t.id}_${jegaWymiana.karta}`]) continue;
        if (!wysylajacy.has(o2.id)) continue;
        if (probujUwolnicProgi(o2, wykluczonaOsobaId, odwiedzone)) {
          const idx = planoweWymiany.indexOf(jegaWymiana);
          planoweWymiany[idx] = { ...jegaWymiana, od: o2.nazwa };
          wysylajacy.delete(potrzebnyDawca.id);
          wysylajacy.add(o2.id);
          return true;
        }
      }
      return false;
    };

    // Śledź ile kart już idzie do każdej osoby (żeby wiedzieć kiedy próg przekroczony)
    const kartIdaceDo = {}; // osobaId -> count

    for (const k of progiKandydaci) {
      const key = `${k.osoba.id}_${k.talia.id}_${k.karta.nazwa}`;
      if (posiadane[key]) continue;
      if (planoweWymiany.some(w => w.do === k.osoba.nazwa && w.talia === k.talia.nazwa && w.karta === k.karta.nazwa)) continue;

      // Sprawdź czy ta osoba już osiągnie próg dzięki kartom już zaplanowanym
      const juzIdzie = kartIdaceDo[k.osoba.id] || 0;
      const progInfo = progiOsob[k.osoba.id];
      if (juzIdzie >= progInfo.brakujeDoProg) continue; // próg już osiągnięty przez inne karty

      let dawca = null;
      for (const o2 of dawcy) {
        if (o2.id === k.osoba.id || wysylajacy.has(o2.id)) continue;
        if (duplikaty[`${o2.id}_${k.talia.id}_${k.karta.nazwa}`]) { dawca = o2; break; }
      }

      if (!dawca) {
        for (const o2 of dawcy) {
          if (o2.id === k.osoba.id || !wysylajacy.has(o2.id)) continue;
          if (!duplikaty[`${o2.id}_${k.talia.id}_${k.karta.nazwa}`]) continue;
          if (probujUwolnicProgi(o2, k.osoba.id, new Set())) { dawca = o2; break; }
        }
      }

      if (dawca && czyMozeDostac(k.osoba.id)) {
        wysylajacy.add(dawca.id);
        zaznaczDostala(k.osoba.id);
        kartIdaceDo[k.osoba.id] = (kartIdaceDo[k.osoba.id] || 0) + 1;
        const faza = obliczFaze(
          k.talia.karty.filter(c=>c.typ===typ&&!posiadane[`${k.osoba.id}_${k.talia.id}_${c.nazwa}`]).length,
          k.talia.karty.filter(c=>c.typ!==typ&&!posiadane[`${k.osoba.id}_${k.talia.id}_${c.nazwa}`]).length,
          typWymiany
        );
        planoweWymiany.push({
          od: dawca.nazwa, do: k.osoba.nazwa,
          karta: k.karta.nazwa, talia: k.talia.nazwa,
          nagroda: k.nagroda, faza,
          brakTCount: 1, brakOCount: 0,
          trudna: k.trudna,
          progBonus: k.ammoProg,
          bliskoProg: true,
          doProgu: k.brakujeDoProg,
        });
      }
    }
  } else {
    // Gdy brak wolnego dawcy — sprawdź czy zajęty dawca ma alternatywę
    // i jeśli tak, podmień go tam gdzie jest mniej ważny

    // ============================================================
    // TRYB 7-9 — priorytetowo obsługuje talie z kręgów 7, 8, 9
    // ============================================================
    if (tryb === "krag79") {
      const priorytet79 = (st) => {
        const brakT = st.brakT.length;
        const brakO = st.brakO.length;
        let grupa;
        if (brakT === 1 && brakO === 0) grupa = 1;
        else if (brakT === 2 && brakO === 0) grupa = 2;
        else if (brakT === 1 && brakO === 1) grupa = 3;
        else if ((brakT === 2 && brakO === 1) || (brakT === 1 && brakO === 2)) grupa = 4;
        else if (brakT === 2 && brakO === 2) grupa = 5;
        else return null; // 3+ brakujących → normalna pętla
        return grupa * 1000000 - st.nagroda;
      };

      const stany79 = staneTalii
        .filter(st => [7,8,9].includes(st.talia.numer) && priorytet79(st) !== null)
        .sort((a, b) => priorytet79(a) - priorytet79(b));

      for (const st of stany79) {
        if (!czyMozeDostac(st.osoba.id)) continue;
        const karta = st.brakT[0];
        if (!karta) continue;
        let dawca = null;
        let dawcaFallback = null;
        for (const o2 of dawcy) {
          if (o2.id === st.osoba.id || wysylajacy.has(o2.id)) continue;
          if (!duplikaty[`${o2.id}_${st.talia.id}_${karta.nazwa}`]) continue;
          if (dawcaRezerwowany(o2.id, st.nagroda)) {
            if (!dawcaFallback) dawcaFallback = o2;
            continue;
          }
          dawca = o2; break;
        }
        if (!dawca) dawca = dawcaFallback;
        if (!dawca) continue;
        wysylajacy.add(dawca.id);
        zaznaczDostala(st.osoba.id);
        planoweWymiany.push({
          od: dawca.nazwa, do: st.osoba.nazwa,
          karta: karta.nazwa, talia: st.talia.nazwa,
          nagroda: st.nagroda,
          faza: obliczFaze(st.brakT.length, st.brakO.length, typWymiany),
          brakTCount: st.brakT.length, brakOCount: st.brakO.length,
          trudna: st.trudna,
        });
      }

      // Talie 7-9 z 3+ brakującymi pozostają w staneTalii dla normalnej pętli
      // Usuń ze staneTalii te które już obsłużyliśmy (zostały wysłane)

      // staneTalii zostaje niezmienione — normalna pętla obsłuży resztę
    }

    const priorytetFazy = (faza) => {
      const kolejnosc = [10,20,11,21,12,22,30,31,32,41,42,51,52];
      const idx = kolejnosc.indexOf(faza);
      return idx === -1 ? 99 : idx;
    };

    // Sprawdź czy talia może być faktycznie zamknięta — czy wszystkie brakujące karty mają potencjalnych dawców

    const potrzebyGrup = staneTalii
      .map(s => {
        const efNagroda = obliczEfektywnaНagrode(s.osoba.id, s.talia.id, s.brakT.length);
        const faza = obliczFaze(s.brakT.length, s.brakO.length, typWymiany);
        const progInfo = progiOsob[s.osoba.id];
        // Sprawdź czy talia może być faktycznie zamknięta
        // Każda brakująca karta musi mieć WOLNEGO i INNEGO dawcę
        const moznaZamknac = (() => {
          const uzyteDawcy = new Set();
          return s.brakT.every(karta => {
            // Wolny dawca = nie jest w wysylajacy i nie jest już użyty dla innej karty tej samej osoby
            const dawca = czlonkowie.find(o2 =>
              o2.id !== s.osoba.id &&
              !uzyteDawcy.has(o2.id) &&
              !wysylajacy.has(o2.id) &&
              duplikaty[`${o2.id}_${s.talia.id}_${karta.nazwa}`]
            );
            if (dawca) { uzyteDawcy.add(dawca.id); return true; }
            return false;
          });
        })();
        return { ...s, faza, efNagroda, moznaZamknac,
          bliskoProg: !!(progInfo?.nastepnyProg && progInfo.brakujeDoProg <= 2),
          progBonus: efNagroda - s.nagroda
        };
      })
      .sort((a, b) => {
        const pa = priorytetFazy(a.faza), pb = priorytetFazy(b.faza);
        const aZamknie = a.faza === 10 || a.faza === 20;
        const bZamknie = b.faza === 10 || b.faza === 20;
        if (aZamknie && bZamknie) {
          // Najpierw te które MOGĄ być faktycznie zamknięte (wszyscy dawcy dostępni)
          if (a.moznaZamknac !== b.moznaZamknac) return b.moznaZamknac ? 1 : -1;
          // Ammo per dawca
          const aPerDawca = a.efNagroda / Math.max(1, a.brakT.length);
          const bPerDawca = b.efNagroda / Math.max(1, b.brakT.length);
          if (Math.round(bPerDawca) !== Math.round(aPerDawca)) return bPerDawca - aPerDawca;
          if (pa !== pb) return pa - pb;
          return 0;
        }
        if (aZamknie !== bZamknie) return aZamknie ? -1 : 1;
        if (pa !== pb) return pa - pb;
        if (b.efNagroda !== a.efNagroda) return b.efNagroda - a.efNagroda;
        if (!ignorujTrudne) { const aT=a.trudna?1:0,bT=b.trudna?1:0; if(aT!==bT) return aT-bT; }
        return 0;
      });

    // Rekurencyjny solver łańcucha podmian
    // Próbuje uwolnić dawcę poprzez podmianę łańcucha przydziałów
    // odwiedzone = Set nazw dawców których już sprawdzaliśmy (zapobiega nieskończonej pętli)
    const probujUwolnicDawce = (potrzebnyDawca, wykluczonaOsobaId, odwiedzone = new Set(), naszAktFaza = 99) => {
      if (odwiedzone.has(potrzebnyDawca.nazwa)) return false;
      odwiedzone.add(potrzebnyDawca.nazwa);

      const jegaWymiana = planoweWymiany.find(w => w.od === potrzebnyDawca.nazwa);
      if (!jegaWymiana) return false;

      const t = talie.find(t => t.nazwa === jegaWymiana.talia);
      if (!t) return false;

      // Nie podmieniaj jeśli tamta wymiana jest wyższego priorytetu (niższa faza = wyższy priorytet)
      const priorytetTamtej = priorytetFazy(jegaWymiana.faza || 99);
      const priorytetNaszej = priorytetFazy(naszAktFaza);
      if (priorytetTamtej < priorytetNaszej) return false; // tamta ważniejsza

      const odbiorca = czlonkowie.find(c => c.nazwa === jegaWymiana.do);

      // Szukaj wolnego zastępcy dla jego wymiany
      for (const o2 of dawcy) {
        if (!odbiorca || o2.id === odbiorca.id) continue;
        if (o2.nazwa === jegaWymiana.od) continue;
        if (o2.id === wykluczonaOsobaId) continue;
        if (odwiedzone.has(o2.nazwa)) continue;
        if (!duplikaty[`${o2.id}_${t.id}_${jegaWymiana.karta}`]) continue;

        if (!wysylajacy.has(o2.id)) {
          // Znaleziono wolnego zastępcę — podmień
          const idx = planoweWymiany.indexOf(jegaWymiana);
          planoweWymiany[idx] = { ...jegaWymiana, od: o2.nazwa };
          wysylajacy.delete(potrzebnyDawca.id);
          wysylajacy.add(o2.id);
          return true;
        }
      }

      // Brak wolnego zastępcy — spróbuj rekurencyjnie uwolnić kogoś zajętego
      for (const o2 of dawcy) {
        if (!odbiorca || o2.id === odbiorca.id) continue;
        if (o2.nazwa === jegaWymiana.od) continue;
        if (o2.id === wykluczonaOsobaId) continue;
        if (odwiedzone.has(o2.nazwa)) continue;
        if (!duplikaty[`${o2.id}_${t.id}_${jegaWymiana.karta}`]) continue;
        if (!wysylajacy.has(o2.id)) continue;

        // o2 jest zajęty — próbuj go uwolnić rekurencyjnie
        if (probujUwolnicDawce(o2, wykluczonaOsobaId, odwiedzone, naszAktFaza)) {
          // Udało się uwolnić o2 — teraz podmień
          const idx = planoweWymiany.indexOf(jegaWymiana);
          planoweWymiany[idx] = { ...jegaWymiana, od: o2.nazwa };
          wysylajacy.delete(potrzebnyDawca.id);
          wysylajacy.add(o2.id);
          return true;
        }
      }

      return false;
    };

    // Iterujemy dynamicznie — po każdym przydziale re-sortujemy żeby uwzględnić
    // aktualny stan wysylajacy (kto jest wolny) przy obliczaniu moznaZamknac
    let pozostale = [...potrzebyGrup.flatMap(s => s.brakT.map(karta => ({...s, kartaDoObs: karta})))];

    while (pozostale.length > 0) {
      // Re-oblicz moznaZamknac dla każdego kandydata z aktualnym stanem wysylajacy
      pozostale = pozostale
        .filter(k => {
          const key = `${k.osoba.id}_${k.talia.id}_${k.kartaDoObs.nazwa}`;
          if (posiadane[key]) return false;
          if (planoweWymiany.some(w => w.do===k.osoba.nazwa && w.talia===k.talia.nazwa && w.karta===k.kartaDoObs.nazwa)) return false;
          return true;
        })
        .map(k => {
          const juzIdzie = planoweWymiany.filter(w => w.do===k.osoba.nazwa && w.talia===k.talia.nazwa).length;
          const aktBrakT = Math.max(1, k.brakT.length - juzIdzie);
          const aktFaza = obliczFaze(aktBrakT, k.brakO.length, typWymiany);
          // Dla ammo per dawca: liczymy jakby ta karta była ostatnią brakującą
          // żeby każda karta z fazy 20 konkurowała równorzędnie z fazą 10
          const aktEfNagroda = obliczEfektywnaНagrode(k.osoba.id, k.talia.id, 1);
          // Ile wolnych dawców dla tej karty
          const maWolnegoDawce = czlonkowie.some(o2 =>
            o2.id !== k.osoba.id && !wysylajacy.has(o2.id) &&
            duplikaty[`${o2.id}_${k.talia.id}_${k.kartaDoObs.nazwa}`]
          );
          // Czy cała talia mozna zamknac (wszystkie brakujące karty mają wolnych dawców)
          const pozostaleBrakT = k.brakT.filter(kk => {
            const key = `${k.osoba.id}_${k.talia.id}_${kk.nazwa}`;
            return !posiadane[key] && !planoweWymiany.some(w => w.do===k.osoba.nazwa && w.talia===k.talia.nazwa && w.karta===kk.nazwa);
          });
          const uzyteDawcy = new Set();
          const moznaZamknac = pozostaleBrakT.every(kk => {
            const d = czlonkowie.find(o2 =>
              o2.id !== k.osoba.id && !uzyteDawcy.has(o2.id) && !wysylajacy.has(o2.id) &&
              duplikaty[`${o2.id}_${k.talia.id}_${kk.nazwa}`]
            );
            if (d) { uzyteDawcy.add(d.id); return true; }
            return false;
          });
          return {...k, aktBrakT, aktFaza, aktEfNagroda, moznaZamknac, maWolnegoDawce};
        })
        .sort((a, b) => {
          const pa = priorytetFazy(a.aktFaza), pb = priorytetFazy(b.aktFaza);
          const aZamknie = a.aktFaza===10||a.aktFaza===20;
          const bZamknie = b.aktFaza===10||b.aktFaza===20;
          if (aZamknie && bZamknie) {
            // Najpierw te które MOGĄ być zamknięte (wolni dawcy dla wszystkich kart)
            if (a.moznaZamknac !== b.moznaZamknac) return b.moznaZamknac ? 1 : -1;
            const aPerDawca = a.aktEfNagroda / Math.max(1, a.aktBrakT);
            const bPerDawca = b.aktEfNagroda / Math.max(1, b.aktBrakT);
            if (Math.round(bPerDawca) !== Math.round(aPerDawca)) return bPerDawca - aPerDawca;
            // TIEBREAKER: kto ma większy dług (rzadziej dostawał karty) → wyższy priorytet
            const dlugA = priorytetSprawiedliwy(a.osoba.nazwa);
            const dlugB = priorytetSprawiedliwy(b.osoba.nazwa);
            if (Math.abs(dlugB - dlugA) > 0.5) return dlugB - dlugA;
            if (pa !== pb) return pa - pb;
            return 0;
          }
          if (aZamknie !== bZamknie) return aZamknie ? -1 : 1;
          if (pa !== pb) return pa - pb;
          if (b.aktEfNagroda !== a.aktEfNagroda) return b.aktEfNagroda - a.aktEfNagroda;
          if (!ignorujTrudne) { const aT=a.trudna?1:0,bT=b.trudna?1:0; if(aT!==bT) return aT-bT; }
          return 0;
        });

      if (pozostale.length === 0) break;

      // Tryb sprawiedliwy: przy wielu kandydatach na tę samą kartę
      // wybierz osobę z największym "długiem" (najrzadziej dostawała karty)
      // Capture w const przed callbackiem — fix no-loop-func
      const pozostaleSnapshot = pozostale;
      const pierwszyKandydat = pozostaleSnapshot[0];
      let wybranyKandydat = pierwszyKandydat;

      if (sprawiedliwe && pozostaleSnapshot.length > 1) {
        // Znajdź wszystkich kandydatów którzy chcą TĄ SAMĄ kartę z TEJ SAMEJ talii
        const nazwaKarty = pierwszyKandydat.kartaDoObs.nazwa;
        const taliaId = pierwszyKandydat.talia.id;
        const duplikacyCandidates = pozostaleSnapshot.filter(k2 =>
          k2.kartaDoObs.nazwa === nazwaKarty &&
          k2.talia.id === taliaId &&
          k2.osoba.id !== pierwszyKandydat.osoba.id &&
          czyMozeDostac(k2.osoba.id) &&
          dawcy.some(o2 => o2.id !== k2.osoba.id && !wysylajacy.has(o2.id) && duplikaty[`${o2.id}_${k2.talia.id}_${k2.kartaDoObs.nazwa}`])
        );
        if (duplikacyCandidates.length > 1) {
          duplikacyCandidates.sort((a, b) => {
            const dlugA = priorytetSprawiedliwy(a.osoba.nazwa);
            const dlugB = priorytetSprawiedliwy(b.osoba.nazwa);
            if (Math.abs(dlugB - dlugA) > 0.5) return dlugB - dlugA;
            return 0;
          });
          wybranyKandydat = duplikacyCandidates[0];
          pozostale = [wybranyKandydat, ...pozostaleSnapshot.filter(k2 => k2 !== wybranyKandydat)];
        }
      }

      const k = pozostale[0];
      pozostale = pozostale.slice(1);

      const s = k;
      const karta = k.kartaDoObs;
      const aktBrakT = k.aktBrakT;
      const aktFaza = k.aktFaza;
      const aktEfNagroda = k.aktEfNagroda;

        // Poziom 1: wolny dawca
        let dawca = null;
        for (const o2 of dawcy) {
          if (o2.id === s.osoba.id || wysylajacy.has(o2.id)) continue;
          if (duplikaty[`${o2.id}_${s.talia.id}_${karta.nazwa}`]) { dawca = o2; break; }
        }

        // Poziom 2: zajęty dawca → próbuj uwolnić przez łańcuch podmian
        if (!dawca) {
          for (const o2 of dawcy) {
            if (o2.id === s.osoba.id || !wysylajacy.has(o2.id)) continue;
            if (!duplikaty[`${o2.id}_${s.talia.id}_${karta.nazwa}`]) continue;

          if (probujUwolnicDawce(o2, s.osoba.id, new Set(), aktFaza)) {
              dawca = o2;
              break;
            }
          }
        }

        if (dawca && czyMozeDostac(s.osoba.id)) {
          wysylajacy.add(dawca.id);
          zaznaczDostala(s.osoba.id);
          planoweWymiany.push({
            od: dawca.nazwa, do: s.osoba.nazwa,
            karta: karta.nazwa, talia: s.talia.nazwa,
            nagroda: s.nagroda, faza: aktFaza,
            brakTCount: aktBrakT, brakOCount: s.brakO.length,
            trudna: s.trudna, progBonus: aktEfNagroda - s.nagroda,
            bliskoProg: s.bliskoProg||false,
          });
        } else if (s.brakT.length <= 3) {
          nieobsluzone.push({ osoba: s.osoba, talia: s.talia, karta, brakTCount: s.brakT.length });
        }
    } // end while
  }

  // ═══════════════════════════════════════════════════════════════════
  // V3 OPTYMALIZATOR — dopracowanie planu po zakończeniu pracy algorytmu V1
  // 1) Ścieżki naprzemienne (Kuhn): pominięta karta dostaje dawcę nawet gdy
  //    jedyny dawca jest zajęty — jego wymiana jest przepinana na innego
  //    dawcę, rekurencyjnie (do głębokości 6), dla DOWOLNYCH kart/talii.
  // 2) Wymiana wartościowa: jeśli nie ma przepięcia, a pominięta karta
  //    zamyka talię / przekracza próg (wartość 💰 wyższa) — wypiera
  //    mniej wartościową wymianę tego dawcy.
  // Każda zmiana musi poprawić ocenę planu — plan nigdy nie jest gorszy.
  // ═══════════════════════════════════════════════════════════════════
  const v3Info = { dodane: 0, przepiete: 0, wyparte: 0, log: [] };
  if (tryb !== "vip") {
    const progFnV3 = isEvent ? obliczProgEvent : obliczProg;
    const dawcaPoNazwie = {};
    dawcy.forEach(d => { dawcaPoNazwie[d.nazwa] = d; });
    const odbPoNazwie = {};
    czlonkowie.forEach(c => { odbPoNazwie[c.nazwa] = c; });
    const taliaPoNazwie = {};
    talie.forEach(t => { taliaPoNazwie[t.nazwa] = t; });

    const klonuj = (pl) => pl.map(e => ({ ...e }));
    const ocenaPlanu = (pl) => {
      const sp = { ...posiadane };
      pl.forEach(e => {
        const o = odbPoNazwie[e.do]; const t = taliaPoNazwie[e.talia];
        if (o && t) sp[`${o.id}_${t.id}_${e.karta}`] = true;
      });
      let kasa = 0;
      const odb = new Set(pl.map(e => e.do));
      odb.forEach(nazwa => {
        const o = odbPoNazwie[nazwa]; if (!o) return;
        talie.forEach(t => {
          if (!t.karty.length) return;
          if (t.karty.every(k => posiadane[`${o.id}_${t.id}_${k.nazwa}`])) return;
          if (t.karty.every(k => sp[`${o.id}_${t.id}_${k.nazwa}`])) kasa += pobierzNagrode(t, o.krag) || 0;
        });
        const pr = progFnV3(liczKartyOsoby(o.id, talie, posiadane));
        const pp = progFnV3(liczKartyOsoby(o.id, talie, sp));
        if ((pp.ostatniProg?.prog || 0) > (pr.ostatniProg?.prog || 0)) kasa += pp.ostatniProg.ammo || 0;
      });
      return kasa * 1000 + pl.length;
    };

    // nowa=true: optymalizator chce DODAĆ kartę — w trybie celowanym nie przekraczamy wybranej liczby kart
    const mozeV3 = (osobaId, ile, nowa = true) => {
      const stary = kartDlaosoby[osobaId];
      kartDlaosoby[osobaId] = ile;
      const r = czyMozeDostac(osobaId);
      kartDlaosoby[osobaId] = stary;
      if (r && nowa && tryb === "celowany") {
        const cel = celowaKolejka[osobaId] || 0;
        if (cel > 0 && ile >= cel) return false;
      }
      return r;
    };
    const ileOdbiera = (pl, nazwa) => pl.filter(e => e.do === nazwa).length;

    // Szuka dawcy dla pozycji (kto, talia, karta). Zajętych dawców uwalnia przez
    // przepięcie ich wymian na innych dawców (zmienia plan `w` w miejscu).
    const szukajDawcy = (it, w, odwiedzeni, gl) => {
      if (gl > 6) return null;
      const kand = dawcy.filter(d => d.id !== it.odbId
        && duplikaty[`${d.id}_${it.taliaId}_${it.karta}`] && !odwiedzeni.has(d.id));
      const zajeta = (d) => w.find(e => e.od === d.nazwa);
      for (const d of kand) {
        if (!zajeta(d)) { odwiedzeni.add(d.id); return d; }
      }
      for (const d of kand) {
        if (odwiedzeni.has(d.id)) continue;
        odwiedzeni.add(d.id);
        const e = zajeta(d);
        if (!e) return d;
        const odb = odbPoNazwie[e.do]; const t = taliaPoNazwie[e.talia];
        if (!odb || !t) continue;
        const nd = szukajDawcy({ odbId: odb.id, taliaId: t.id, karta: e.karta }, w, odwiedzeni, gl + 1);
        if (nd) {
          if (!e.v3Bylo) e.v3Bylo = e.od;
          e.od = nd.nazwa; e.v3Przepiete = true;
          return d;
        }
      }
      return null;
    };

    const nowaWymiana = (u, dawca) => {
      const o = u.osoba; const t = u.talia;
      const brakO = oppTyp ? t.karty.filter(k => k.typ === oppTyp && !posiadane[`${o.id}_${t.id}_${k.nazwa}`]).length : 0;
      return {
        od: dawca.nazwa, do: o.nazwa, karta: u.karta.nazwa || u.karta, talia: t.nazwa,
        nagroda: pobierzNagrode(t, o.krag) || 0, faza: 98,
        brakTCount: u.brakTCount || 1, brakOCount: brakO, trudna: t.trudna, v3Dodana: true,
      };
    };

    const T0 = Date.now();
    let plan = klonuj(planoweWymiany);
    // kolejka pominiętych (bez duplikatów)
    let kolejka = [];
    const widziane = new Set();
    nieobsluzone.forEach(u => {
      const kn = u.karta?.nazwa || u.karta;
      const key = `${u.osoba.id}_${u.talia.id}_${kn}`;
      if (widziane.has(key)) return;
      widziane.add(key);
      kolejka.push({ ...u, karta: kn });
    });
    kolejka.sort((a, b) => (a.brakTCount || 9) - (b.brakTCount || 9));

    for (let przebieg = 0; przebieg < 4 && kolejka.length; przebieg++) {
      let zmiana = false;
      const pozostale = [];
      for (const u of kolejka) {
        if (Date.now() - T0 > 3000) { pozostale.push(u); continue; }
        const o = u.osoba; const t = u.talia;
        if (posiadane[`${o.id}_${t.id}_${u.karta}`]) continue;
        if (plan.some(e => e.do === o.nazwa && e.talia === t.nazwa && e.karta === u.karta)) continue;
        const item = { odbId: o.id, taliaId: t.id, karta: u.karta };
        const bazowa = ocenaPlanu(plan);
        // 1) ścieżka naprzemienna
        if (mozeV3(o.id, ileOdbiera(plan, o.nazwa))) {
          const w = klonuj(plan);
          const d = szukajDawcy(item, w, new Set(), 0);
          if (d) {
            w.push(nowaWymiana(u, d));
            if (ocenaPlanu(w) >= bazowa) {
              const planPrzed = plan;
              const przep = w.filter((e, i) => e.v3Przepiete && !planPrzed[i]?.v3Przepiete).length;
              plan = w; zmiana = true;
              v3Info.dodane++; v3Info.przepiete += przep;
              v3Info.log.push(`➕ ${d.nazwa} ➜ ${o.nazwa}: ${u.karta} [${t.nazwa}]${przep ? ` (przepięto ${przep} wymian)` : ""}`);
              continue;
            }
          }
        }
        // 2) wyparcie mniej wartościowej wymiany
        let najlepszy = null, najOcena = bazowa;
        for (const d of dawcy) {
          if (d.id === o.id || !duplikaty[`${d.id}_${t.id}_${u.karta}`]) continue;
          const e = plan.find(x => x.od === d.nazwa);
          if (!e) continue; // wolny dawca byłby już użyty w kroku 1 (blokada limitu odbiorcy)
          const w = klonuj(plan).filter(x => !(x.od === e.od && x.do === e.do && x.karta === e.karta && x.talia === e.talia));
          if (!mozeV3(o.id, ileOdbiera(w, o.nazwa))) continue;
          w.push({ ...nowaWymiana(u, d), v3Wyparla: `${e.do}: ${e.karta}` });
          const oc = ocenaPlanu(w);
          if (oc > najOcena + 1e-9) { najOcena = oc; najlepszy = { w, e }; }
        }
        if (najlepszy) {
          plan = najlepszy.w; zmiana = true;
          v3Info.dodane++; v3Info.wyparte++;
          const eo = odbPoNazwie[najlepszy.e.do]; const et = taliaPoNazwie[najlepszy.e.talia];
          v3Info.log.push(`⚖️ ${o.nazwa}: ${u.karta} [${t.nazwa}] wypiera ${najlepszy.e.do}: ${najlepszy.e.karta} (wyższa wartość)`);
          if (eo && et) pozostale.push({ osoba: eo, talia: et, karta: najlepszy.e.karta, brakTCount: najlepszy.e.brakTCount || 3 });
          continue;
        }
        pozostale.push(u);
      }
      kolejka = pozostale;
      if (!zmiana) break;
    }

    // ── PEŁNA ANALIZA: dokładne przeszukanie zamknięć talii (z limitem czasu) ──
    // Wybiera zbiór talii do zamknięcia tak, by suma 💰 (talie + progi) była największa,
    // z gwarancją że każdy dawca wysyła max 1 kartę (dopasowanie). Resztę wymian dokłada jak wyżej.
    const odbPoId = {}; czlonkowie.forEach(c => { odbPoId[c.id] = c; });
    const taliaPoId = {}; talie.forEach(t => { taliaPoId[t.id] = t; });
    const dawcaPoId = {}; dawcy.forEach(d => { dawcaPoId[d.id] = d; });

    const dopasujDawcow = (pozycje) => {
      const wlasciciel = {};
      const wynikD = new Array(pozycje.length).fill(null);
      const probuj = (i, odw) => {
        for (const d of pozycje[i].dawcy) {
          if (odw.has(d)) continue;
          odw.add(d);
          if (wlasciciel[d] === undefined || probuj(wlasciciel[d], odw)) {
            wlasciciel[d] = i; wynikD[i] = d; return true;
          }
        }
        return false;
      };
      for (let i = 0; i < pozycje.length; i++) {
        if (!probuj(i, new Set())) return null;
      }
      return wynikD;
    };

    const zbudujPlanZPozycji = (pozycje, przyp, planWej, kolejkaWej, pelny) => {
      const w = [];
      const uzyteDawcy = new Set();
      const klucze = new Set();
      for (let i = 0; i < pozycje.length; i++) {
        const p = pozycje[i];
        const d = dawcaPoId[przyp[i]];
        const o = odbPoId[p.odbId]; const t = taliaPoId[p.taliaId];
        const klucz = `${o.nazwa}|${t.nazwa}|${p.karta}`;
        const istn = planWej.find(e => `${e.do}|${e.talia}|${e.karta}` === klucz);
        w.push(istn ? { ...istn, od: d.nazwa } : nowaWymiana({ osoba: o, talia: t, karta: p.karta, brakTCount: p.brakTCount }, d));
        uzyteDawcy.add(d.id); klucze.add(klucz);
      }
      const doObsluzenia = [];
      for (const e of planWej) {
        const klucz = `${e.do}|${e.talia}|${e.karta}`;
        if (klucze.has(klucz)) continue;
        const d = dawcaPoNazwie[e.od];
        const o = odbPoNazwie[e.do]; const t = taliaPoNazwie[e.talia];
        if (!d || !o || !t) continue;
        if (uzyteDawcy.has(d.id) || !mozeV3(o.id, ileOdbiera(w, o.nazwa), false)) {
          doObsluzenia.push({ osoba: o, talia: t, karta: e.karta, brakTCount: e.brakTCount || 3 });
          continue;
        }
        w.push({ ...e }); uzyteDawcy.add(d.id); klucze.add(klucz);
      }
      if (!pelny) return { plan: w, niezalatwione: [] };
      kolejkaWej.forEach(u => doObsluzenia.push(u));
      const niezalatwione = [];
      for (const u of doObsluzenia) {
        const o = u.osoba; const t = u.talia;
        const klucz = `${o.nazwa}|${t.nazwa}|${u.karta}`;
        if (klucze.has(klucz) || posiadane[`${o.id}_${t.id}_${u.karta}`]) continue;
        if (!mozeV3(o.id, ileOdbiera(w, o.nazwa))) { niezalatwione.push(u); continue; }
        const dd = szukajDawcy({ odbId: o.id, taliaId: t.id, karta: u.karta }, w, new Set(), 0);
        if (dd) { w.push(nowaWymiana(u, dd)); klucze.add(klucz); }
        else niezalatwione.push(u);
      }
      return { plan: w, niezalatwione };
    };

    const dokladnaAnaliza = (planWej, kolejkaWej) => {
      const start = Date.now();
      const LIMIT_WEZLOW = 2000000;
      const LIMIT_MS = Math.min(8000, Math.max(500, 11000 - (Date.now() - T0)));
      const stan = { wezly: 0, przerwano: false };
      const kand = [];
      czlonkowie.forEach(o => {
        talie.forEach(t => {
          if (!t.karty.length) return;
          const braki = t.karty.filter(k => !posiadane[`${o.id}_${t.id}_${k.nazwa}`]);
          if (braki.length === 0 || braki.length > 4) return;
          if (braki.some(k => k.typ !== typ)) return;
          const pozycje = [];
          for (const k of braki) {
            const dd = dawcy.filter(d => d.id !== o.id && duplikaty[`${d.id}_${t.id}_${k.nazwa}`]).map(d => d.id);
            if (!dd.length) return;
            pozycje.push({ odbId: o.id, taliaId: t.id, karta: k.nazwa, dawcy: dd, brakTCount: braki.length });
          }
          kand.push({ o, t, pozycje, nagroda: pobierzNagrode(t, o.krag) || 0 });
        });
      });
      if (!kand.length) return { wezly: 0, ms: 0, przerwano: false, kandydatow: 0, wynik: null };
      kand.sort((a, b) => b.nagroda - a.nagroda);
      // górne ograniczenie premii za progi (każda osoba max raz)
      let zapasProgi = 0;
      const osobyKand = new Set(kand.map(c => c.o.id));
      osobyKand.forEach(id => {
        const sp = { ...posiadane };
        kand.filter(c => c.o.id === id).forEach(c => c.pozycje.forEach(p => { sp[`${id}_${p.taliaId}_${p.karta}`] = true; }));
        const pr = progFnV3(liczKartyOsoby(id, talie, posiadane));
        const pp = progFnV3(liczKartyOsoby(id, talie, sp));
        if ((pp.ostatniProg?.prog || 0) > (pr.ostatniProg?.prog || 0)) zapasProgi += pp.ostatniProg.ammo || 0;
      });
      const sumaPozostalo = new Array(kand.length + 1).fill(0);
      for (let i = kand.length - 1; i >= 0; i--) sumaPozostalo[i] = sumaPozostalo[i + 1] + kand[i].nagroda;

      let najlepszaOcena = ocenaPlanu(planWej);
      const ocenaStartowa = najlepszaOcena;
      let najlepszyWynik = null;
      let najlepszeWybory = null;
      const wybrane = [];

      const rec = (idx, suma, pozycje, przyp) => {
        if (stan.przerwano) return;
        stan.wezly++;
        if (stan.wezly > LIMIT_WEZLOW || ((stan.wezly & 31) === 0 && Date.now() - start > LIMIT_MS)) { stan.przerwano = true; return; }
        if (wybrane.length) {
          const zb = zbudujPlanZPozycji(pozycje, przyp, planWej, kolejkaWej, false);
          const oc = ocenaPlanu(zb.plan);
          if (oc > najlepszaOcena + 1e-9) { najlepszaOcena = oc; najlepszeWybory = { pozycje, przyp }; }
        }
        if (idx >= kand.length) return;
        if ((suma + sumaPozostalo[idx] + zapasProgi) * 1000 + 1000 <= najlepszaOcena) return;
        const c = kand[idx];
        const nowe = pozycje.concat(c.pozycje);
        const przypNowe = dopasujDawcow(nowe);
        const ileOdb = nowe.filter(p => p.odbId === c.o.id).length;
        if (przypNowe && mozeV3(c.o.id, ileOdb - 1)) {
          wybrane.push(idx);
          rec(idx + 1, suma + c.nagroda, nowe, przypNowe);
          wybrane.pop();
        }
        rec(idx + 1, suma, pozycje, przyp);
      };
      rec(0, 0, [], []);
      let poprawaFinal = 0;
      if (najlepszeWybory) {
        const pelnyPlan = zbudujPlanZPozycji(najlepszeWybory.pozycje, najlepszeWybory.przyp, planWej, kolejkaWej, true);
        const ocPelna = ocenaPlanu(pelnyPlan.plan);
        if (ocPelna > ocenaStartowa + 1e-9) { najlepszyWynik = pelnyPlan; poprawaFinal = ocPelna - ocenaStartowa; }
      }
      return { wezly: stan.wezly, ms: Date.now() - start, przerwano: stan.przerwano, kandydatow: kand.length, wynik: najlepszyWynik, poprawa: poprawaFinal };
    };

    const dok = tryb === "progi" ? { wezly: 0, ms: 0, przerwano: false, kandydatow: 0, wynik: null } : dokladnaAnaliza(plan, kolejka);
    v3Info.pelna = { wezly: dok.wezly, ms: dok.ms, przerwano: dok.przerwano, kandydatow: dok.kandydatow, poprawiono: false };
    if (dok.wynik) {
      plan = dok.wynik.plan;
      kolejka = dok.wynik.niezalatwione;
      v3Info.pelna.poprawiono = true;
      v3Info.log.push(`🧮 Pełna analiza znalazła lepszy układ zamknięć (+${Math.round(dok.poprawa / 1000).toLocaleString()} 💰)`);
    }

    planoweWymiany.length = 0;
    plan.forEach(e => planoweWymiany.push(e));
    nieobsluzone.length = 0;
    kolejka.forEach(u => nieobsluzone.push(u));
    wysylajacy.clear();
    planoweWymiany.forEach(e => { const d = dawcaPoNazwie[e.od]; if (d) wysylajacy.add(d.id); });
  }

  const symPos={...posiadane};
  planoweWymiany.forEach(w=>{
    const o=czlonkowie.find(c=>c.nazwa===w.do);
    const t=talie.find(t=>t.nazwa===w.talia);
    if(o&&t) symPos[`${o.id}_${t.id}_${w.karta}`]=true;
  });
  const zamknieciaInfo=[];
  czlonkowie.forEach(osoba=>{
    talie.forEach(talia=>{
      const kPrzed=talia.karty.every(k=>posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]);
      const kPo=talia.karty.every(k=>symPos[`${osoba.id}_${talia.id}_${k.nazwa}`]);
      if(!kPrzed&&kPo){
        // Sprawdź czy przy okazji przekroczy próg
        const liczbaPoWymianie=liczKartyOsoby(osoba.id,talie,symPos);
        const obliczProgFn = isEvent ? obliczProgEvent : obliczProg;
        const progPrzed=obliczProgFn(liczKartyOsoby(osoba.id,talie,posiadane));
        const progPo=obliczProgFn(liczbaPoWymianie);
        const nowyProg=progPo.ostatniProg?.prog > (progPrzed.ostatniProg?.prog||0);
        zamknieciaInfo.push({
          osoba:osoba.nazwa, talia:talia.nazwa, nagroda:pobierzNagrode(talia,osoba.krag),
          nowyProg: nowyProg ? progPo.ostatniProg : null,
        });
      }
    });
  });

  return {planoweWymiany,nieobsluzone,zamknieciaInfo,v3Info};
}
