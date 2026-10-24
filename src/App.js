import React, { useState, useEffect, useRef, useMemo, startTransition } from "react";

import { createPortal } from "react-dom";
import "./gangStyles.css";
import { loadGangData, saveGangData, subscribeGangData, setCardField, setStructure, setOnline, setOffline, subscribeOnline, zapiszKalendarz, subscribeKalendarz, zapiszLog, subscribeLogi, getFingerprint, pobierzFingerprinty, zapiszFingerprint, zapiszHistorieWymian, pobierzHistorieWymian, subscribeHistoria, obliczLicznikOtrzymanych, zablokujUrządzenie, odblokujUrządzenie, pobierzZablokowane, subscribeZablokowane, zapiszArchiwumWalk, subscribeArchiwumWalk, zapiszWiadomosc, subscribeChat, pobierzPelnyBackup, przywrocPelnyBackup, zapiszAutoBackup, pobierzListeBackupow, przywrocAutoBackup, zapiszPin, sprawdzPin, maPin, resetujPin, pobierzStatusyPinow, registerFCMToken, unregisterFCMToken, onForegroundMessage, loadEventData, setEventCardField, setEventStructure, subscribeEventData } from "./firebase"; // eslint-disable-line no-unused-vars
import OcrView from "./OcrView";
import WalkiView from "./WalkiView";
import { analyzeDeckStructure } from "./gemini";

// Page Visibility API — zapobiega lagowi przy powrocie do karty
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      // Karta nieaktywna — pauzuj animacje
      document.body.style.animationPlayState = "paused";
    } else {
      // Powrót do karty — przez 400ms wyłącz transitions żeby nie było skoku
      document.body.classList.add("reducing-motion");
      document.body.style.animationPlayState = "running";
      setTimeout(() => {
        document.body.classList.remove("reducing-motion");
      }, 400);
    }
  });
}


// ============================================================
// EFEKTY — dźwięki, animacje, konfetti
// ============================================================

// Dźwięk syntetyczny przez Web Audio API
function playSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (type === "ding") {
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.start(); osc.stop(ctx.currentTime + 0.6);
    } else if (type === "success") {
      osc.frequency.setValueAtTime(523, ctx.currentTime);
      osc.frequency.setValueAtTime(659, ctx.currentTime + 0.1);
      osc.frequency.setValueAtTime(784, ctx.currentTime + 0.2);
      osc.type = "sine";
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      osc.start(); osc.stop(ctx.currentTime + 0.8);
    } else if (type === "gold") {
      // Złoty fanfar
      osc.frequency.setValueAtTime(659, ctx.currentTime);
      osc.frequency.setValueAtTime(784, ctx.currentTime + 0.08);
      osc.frequency.setValueAtTime(1047, ctx.currentTime + 0.16);
      osc.type = "triangle";
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0);
      osc.start(); osc.stop(ctx.currentTime + 1.0);
    } else if (type === "click") {
      osc.frequency.value = 440;
      osc.type = "square";
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start(); osc.stop(ctx.currentTime + 0.08);
    }
  } catch(e) {}
}

// Konfetti — złote cząsteczki
function launchConfetti(duration = 2500) {
  const colors = ["var(--accent)","#ffaa00","#fff8dc","#b8860b","#0c6","#87CEEB","#da70d6"];
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999;overflow:hidden";
  document.body.appendChild(container);
  for (let i = 0; i < 80; i++) {
    const el = document.createElement("div");
    const color = colors[Math.floor(Math.random() * colors.length)];
    const size = 6 + Math.random() * 8;
    const x = Math.random() * 100;
    const delay = Math.random() * 600;
    const rot = Math.random() * 360;
    const shape = Math.random() > 0.5 ? "50%" : "2px";
    el.style.cssText = `
      position:absolute;top:-20px;left:${x}%;
      width:${size}px;height:${size}px;
      background:${color};border-radius:${shape};
      animation:confettiFall ${1200 + Math.random() * 1000}ms ${delay}ms ease-in forwards;
      transform:rotate(${rot}deg);
    `;
    container.appendChild(el);
  }
  const style = document.createElement("style");
  style.textContent = `@keyframes confettiFall {
    0% { transform: translateY(-20px) rotate(0deg); opacity:1; }
    100% { transform: translateY(100vh) rotate(${Math.random()*720}deg); opacity:0; }
  }`;
  document.head.appendChild(style);
  setTimeout(() => { container.remove(); style.remove(); }, duration + 800);
}


// Normalizuje tekst do porównania — usuwa polskie znaki i zamienia na małe litery
function normalizuj(s) {
  return (s||"").toLowerCase()
    .replace(/ą/g,"a").replace(/ć/g,"c").replace(/ę/g,"e")
    .replace(/ł/g,"l").replace(/ń/g,"n").replace(/ó/g,"o")
    .replace(/ś/g,"s").replace(/ź/g,"z").replace(/ż/g,"z");
}

const TRUDNE_NUMERY = [10, 11, 12, 14, 15];

// Zwraca nagrodę amunicji uwzględniając krąg gracza (kręgi 1-5)
// krag=1 → nagroda_amunicja, krag=N → nagroda_amunicja_kN; brak wartości → najbliższy niższy krąg
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

// Liczy unikalne posiadane karty osoby (bez duplikatów)
function liczKartyOsoby(osobaId, talie, posiadane) {
  let count=0;
  talie.forEach(talia=>{
    talia.karty.forEach(karta=>{
      if(posiadane[`${osobaId}_${talia.id}_${karta.nazwa}`]) count++;
    });
  });
  return count;
}

// Sprawdza najbliższy próg i ile kart brakuje
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

const DOMYSLNE_TALIE = [
  { id: "miejskie_legendy", numer: 1, nazwa: "Miejskie legendy", nagroda_amunicja: 500, nagroda_amunicja_k2: 500, nagroda_amunicja_k3: 1000, karty: [
    {nazwa:"Tajemnicze zniknięcia",typ:"złota"},{nazwa:"Obserwacje kryptydów",typ:"złota"},{nazwa:"Nawiedzone lokacje",typ:"złota"},
    {nazwa:"Przeklęte przedmioty",typ:"złota"},{nazwa:"Istoty nadprzyrodzone",typ:"złota"},{nazwa:"Miejskie legendy",typ:"złota"},
    {nazwa:"Tajne stowarzyszenia",typ:"złota"},{nazwa:"Widmowe zjawy",typ:"złota"},{nazwa:"Niewyjaśnione zjawiska",typ:"złota"},
  ]},
  { id: "szkolne_rywalizacje", numer: 2, nazwa: "Szkolne rywalizacje", nagroda_amunicja: 750, nagroda_amunicja_k2: 750, nagroda_amunicja_k3: 500, karty: [
    {nazwa:"Zawody Maskotek",typ:"złota"},{nazwa:"Tygodnie duchów",typ:"złota"},{nazwa:"Wiece motywacyjne",typ:"złota"},
    {nazwa:"Wojny na żarty",typ:"złota"},{nazwa:"Gry Powrotu do Domu",typ:"złota"},{nazwa:"Bitwy cheerleaderek",typ:"złota"},
    {nazwa:"Barwy szkoły",typ:"złota"},{nazwa:"Rywalizacje absolwentów",typ:"złota"},{nazwa:"Wyzwania akademickie",typ:"złota"},
  ]},
  { id: "lokalne_firmy", numer: 3, nazwa: "Lokalne firmy", nagroda_amunicja: 1000, nagroda_amunicja_k2: 1000, nagroda_amunicja_k3: 1500, karty: [
    {nazwa:"Relacje z klientami",typ:"złota"},{nazwa:"Zaangażowanie społeczności",typ:"złota"},{nazwa:"Zrównoważone praktyki",typ:"złota"},
    {nazwa:"Lokalne zaopatrzenie",typ:"złota"},{nazwa:"Wyjątkowe oferty",typ:"złota"},{nazwa:"Reputacja na rynku",typ:"złota"},
    {nazwa:"Zdolność adaptacji biznesu",typ:"złota"},{nazwa:"Programy lojalnościowe dla klientów",typ:"złota"},
    {nazwa:"Satysfakcja pracowników",typ:"diamentowa"},
  ]},
  { id: "ukryte_ogrody", numer: 4, nazwa: "Ukryte ogrody", nagroda_amunicja: 1500, nagroda_amunicja_k2: 1500, nagroda_amunicja_k3: 2500, karty: [
    {nazwa:"Sekretne ścieżki",typ:"złota"},{nazwa:"Szepczące listowie",typ:"złota"},{nazwa:"Zaczarowane kwiaty",typ:"złota"},
    {nazwa:"Ukryte zakamarki",typ:"złota"},{nazwa:"Ciche zakątki",typ:"złota"},{nazwa:"Botaniczne labirynty",typ:"złota"},
    {nazwa:"Zielone sanktuaria",typ:"złota"},{nazwa:"Spokojne kryjówki",typ:"diamentowa"},{nazwa:"Starożytna mądrość",typ:"diamentowa"},
  ]},
  { id: "najgoretsze_miejsca", numer: 5, nazwa: "Najgorętsze miejsca nocnego życia", nagroda_amunicja: 1500, nagroda_amunicja_k2: 2500, nagroda_amunicja_k3: 4000, karty: [
    {nazwa:"Parkiety taneczne",typ:"złota"},{nazwa:"Popisowe koktajle",typ:"złota"},{nazwa:"Widoki z dachu",typ:"złota"},
    {nazwa:"Line-upy DJ-ów",typ:"złota"},{nazwa:"Dekoracja tematyczna",typ:"złota"},{nazwa:"Sekcje VIP",typ:"złota"},
    {nazwa:"Występy na żywo",typ:"złota"},{nazwa:"Neonowe oświetlenie",typ:"złota"},{nazwa:"Późnonocny posiłek",typ:"diamentowa"},
  ]},
  { id: "kolorowe_murale", numer: 6, nazwa: "Kolorowe murale", nagroda_amunicja: 2500, nagroda_amunicja_k2: 3000, nagroda_amunicja_k3: 4000, karty: [
    {nazwa:"Miejska estetyka",typ:"złota"},{nazwa:"Historie społeczności",typ:"złota"},{nazwa:"Tożsamość kulturowa",typ:"złota"},
    {nazwa:"Techniki artystyczne",typ:"złota"},{nazwa:"Wpływ historyczny",typ:"złota"},{nazwa:"Tematy środowiskowe",typ:"złota"},
    {nazwa:"Zaangażowanie społeczne",typ:"diamentowa"},{nazwa:"Sztuka współpracy",typ:"diamentowa"},{nazwa:"Efekt wizualny",typ:"diamentowa"},
  ]},
  { id: "miejska_dzika_przyroda", numer: 7, nazwa: "Miejska dzika przyroda", nagroda_amunicja: 3000, nagroda_amunicja_k2: 3500, nagroda_amunicja_k3: 6000, karty: [
    {nazwa:"Przystosowania zwierząt",typ:"złota"},{nazwa:"Miejskie ekosystemy",typ:"złota"},{nazwa:"Nocne zachowanie",typ:"złota"},
    {nazwa:"Korytarze dla dzikiej przyrody",typ:"złota"},{nazwa:"Źródła żywności",typ:"złota"},
    {nazwa:"Lokalizacje schronów",typ:"diamentowa"},{nazwa:"Interakcja człowieka z dziką przyrodą",typ:"diamentowa"},
    {nazwa:"Ekosystemy na dachach",typ:"diamentowa"},{nazwa:"Zachowanie szopa",typ:"diamentowa"},
  ]},
  { id: "artysci_uliczni", numer: 8, nazwa: "Artyści uliczni", nagroda_amunicja: 3500, nagroda_amunicja_k2: 4000, nagroda_amunicja_k3: 6000, karty: [
    {nazwa:"Busking",typ:"złota"},{nazwa:"Sztuka cyrku",typ:"złota"},{nazwa:"Żywe posągi",typ:"złota"},
    {nazwa:"Improwizacja teatralna",typ:"złota"},{nazwa:"Taniec uliczny",typ:"złota"},
    {nazwa:"Magia uliczna",typ:"diamentowa"},{nazwa:"Malarstwo na ciele",typ:"diamentowa"},
    {nazwa:"Muzyka etniczna",typ:"diamentowa"},{nazwa:"Akrobacje",typ:"diamentowa"},
  ]},
  { id: "festiwale_sasiedzkie", numer: 9, nazwa: "Festiwale sąsiedzkie", nagroda_amunicja: 4000, nagroda_amunicja_k2: 6000, nagroda_amunicja_k3: 6000, karty: [
    {nazwa:"Platformy paradne",typ:"złota"},{nazwa:"Parada zwierzaków",typ:"złota"},{nazwa:"Występy kulturalne",typ:"złota"},
    {nazwa:"Jarmarki rzemieślnicze",typ:"diamentowa"},{nazwa:"Tradycyjne gry",typ:"diamentowa"},{nazwa:"Warsztaty społeczności",typ:"diamentowa"},
    {nazwa:"Muzyka na żywo",typ:"diamentowa"},{nazwa:"Dekoracje uliczne",typ:"diamentowa"},{nazwa:"Aktywności rodzinne",typ:"diamentowa"},
  ]},
  { id: "targowiska_uliczne", numer: 10, nazwa: "Targowiska uliczne", nagroda_amunicja: 4000, nagroda_amunicja_k2: 6000, nagroda_amunicja_k3: 10000, karty: [
    {nazwa:"Lokalne rzemiosło",typ:"złota"},{nazwa:"Świeże produkty",typ:"złota"},{nazwa:"Egzotyczne przyprawy",typ:"złota"},
    {nazwa:"Jedzenie uliczne",typ:"złota"},{nazwa:"Odzież vintage",typ:"złota"},{nazwa:"Ręcznie robiona biżuteria",typ:"złota"},
    {nazwa:"Stoiska z sztuką",typ:"diamentowa"},{nazwa:"Polowanie na okazje",typ:"diamentowa"},{nazwa:"Różnorodność kulturowa",typ:"diamentowa"},
  ]},
  { id: "zabytki_historyczne", numer: 11, nazwa: "Zabytki historyczne", nagroda_amunicja: 4500, nagroda_amunicja_k2: 10000, nagroda_amunicja_k3: 12000, karty: [
    {nazwa:"Styl architektoniczny",typ:"złota"},{nazwa:"Znaczenie kulturowe",typ:"złota"},{nazwa:"Epoka historyczna",typ:"złota"},
    {nazwa:"Ewolucja architektoniczna",typ:"diamentowa"},{nazwa:"Atrakcja turystyczna",typ:"diamentowa"},
    {nazwa:"Obiekt światowego dziedzictwa",typ:"diamentowa"},{nazwa:"Wycieczki z przewodnikiem",typ:"diamentowa"},
    {nazwa:"Monumentalna skala",typ:"diamentowa"},{nazwa:"Projekty renowacji",typ:"diamentowa"},
  ]},
  { id: "tradycyjne_rzemioslo", numer: 12, nazwa: "Tradycyjne rzemiosło", nagroda_amunicja: 6000, nagroda_amunicja_k2: 12000, nagroda_amunicja_k3: 15000, karty: [
    {nazwa:"Techniki tkackie",typ:"diamentowa"},{nazwa:"Szkliwienie ceramiki",typ:"diamentowa"},{nazwa:"Style plecionkarstwa",typ:"diamentowa"},
    {nazwa:"Garbarstwo",typ:"diamentowa"},{nazwa:"Kucie metalu",typ:"diamentowa"},{nazwa:"Rzeźbienie w drewnie",typ:"diamentowa"},
    {nazwa:"Barwienie tekstyliów",typ:"diamentowa"},{nazwa:"Wzory haftu",typ:"diamentowa"},{nazwa:"Wydmuchiwanie szkła",typ:"diamentowa"},
  ]},
  { id: "liderzy_spolecznosci", numer: 13, nazwa: "Liderzy społeczności", nagroda_amunicja: 1500, nagroda_amunicja_k2: 2500, nagroda_amunicja_k3: 3000, karty: [
    {nazwa:"Empatia",typ:"złota"},{nazwa:"Wizja",typ:"złota"},{nazwa:"Wpływ",typ:"złota"},
    {nazwa:"Adaptacyjność",typ:"złota"},{nazwa:"Rozwiązywanie konfliktów",typ:"złota"},{nazwa:"Inkluzywność",typ:"złota"},
    {nazwa:"Współpraca",typ:"złota"},{nazwa:"Podejmowanie decyzji",typ:"złota"},{nazwa:"Mentoring",typ:"złota"},
  ]},
  { id: "spotkania_rodzinne", numer: 14, nazwa: "Spotkania rodzinne", nagroda_amunicja: 6000, nagroda_amunicja_k2: 4500, nagroda_amunicja_k3: 6000, karty: [
    {nazwa:"Wspólne posiłki",typ:"diamentowa"},{nazwa:"Tradycje opowiadania historii",typ:"diamentowa"},{nazwa:"Więź międzypokoleniowa",typ:"diamentowa"},
    {nazwa:"Rytuały kulturowe",typ:"diamentowa"},{nazwa:"Rodzinne przepisy",typ:"diamentowa"},{nazwa:"Świąteczne uroczystości",typ:"diamentowa"},
    {nazwa:"Dyskusje o pochodzeniu",typ:"diamentowa"},{nazwa:"Albumy ze zdjęciami",typ:"diamentowa"},{nazwa:"Gry spotkania",typ:"diamentowa"},
  ]},
  { id: "lokalna_kuchnia", numer: 15, nazwa: "Lokalna kuchnia", nagroda_amunicja: 10000, nagroda_amunicja_k2: 6000, nagroda_amunicja_k3: 6000, karty: [
    {nazwa:"Regionalne składniki",typ:"diamentowa"},{nazwa:"Techniki gotowania",typ:"diamentowa"},{nazwa:"Tradycyjne potrawy",typ:"diamentowa"},
    {nazwa:"Etykieta przy stole",typ:"diamentowa"},{nazwa:"Profil smakowy",typ:"diamentowa"},{nazwa:"Historia kulinarna",typ:"diamentowa"},
    {nazwa:"Lokalne produkty",typ:"diamentowa"},{nazwa:"Sezonowe warianty",typ:"diamentowa"},{nazwa:"Festiwale jedzenia",typ:"diamentowa"},
  ]},
];

const DOMYSLNI_CZLONKOWIE = Array.from({length:20},(_,i)=>({id:i+1,nazwa:`Osoba ${i+1}`}));

// Uzupełnij talie z Firebase o pola których może brakować (np. nagroda_amunicja_k2)
// Dane w Firebase mogły być zapisane przed dodaniem nowych pól
function uzupelnijTalie(talieZBazy) {
  if (!talieZBazy) return DOMYSLNE_TALIE;
  return talieZBazy.map(t => {
    const domyslna = DOMYSLNE_TALIE.find(d => d.id === t.id || d.numer === t.numer);
    if (!domyslna) return t;
    return {
      ...t,
      // Uzupełnij nagroda_amunicja_k2 TYLKO jeśli brakuje w Firebase
      // Jeśli admin edytował przez UI — Firebase ma wyższy priorytet
      nagroda_amunicja_k2: t.nagroda_amunicja_k2 !== undefined
        ? t.nagroda_amunicja_k2
        : domyslna.nagroda_amunicja_k2,
      nagroda_amunicja_k3: t.nagroda_amunicja_k3 !== undefined
        ? t.nagroda_amunicja_k3
        : domyslna.nagroda_amunicja_k3,
    };
  });
}

const DOMYSLNE_DANE = {
  talie: DOMYSLNE_TALIE,
  czlonkowie: DOMYSLNI_CZLONKOWIE,
  posiadane: {},
  duplikaty: {},
  walki: [],
};

const CYTATY=[
  // Ogólne
  "Nie pytaj co gang może zrobić dla Ciebie — pytaj komu możesz wysłać duplikat.",
  "Witaj w gangu. Twoje karty nas interesują bardziej niż Ty.",
  "™FAM™ — bo rodzina to ci co wysyłają karty na czas. I nie dezerterują do AnyFam.",
  "Uwaga: admin widzi wszystko. Łącznie z tym że nie potwierdziłeś wymiany od 3 dni.",
  "Sezon się kończy. Talie nie zamykają się same. Mamy cię na oku.",
  "Wysłałeś kartę? Brawo. Teraz potwierdź to w apce, bo Bangmasta nie wróżbita.",
  // SaMaNtA
  "SaMaNtA ma nieograniczone ammo i nieograniczoną cierpliwość. Ta druga kończy się po 3 sekundach.",
  "SaMaNtA: dentysta, sadystka, właścicielka arsenału. Nie wysyłaj kart z nieznieczulonym sumieniem.",
  "Gdy SaMaNtA mówi 'otwórz szerzej' — nie wiadomo czy chodzi o usta czy o zakładkę DUPLIKATY.",
  // Fallven
  "Fallven ma flagę Hiszpanii i twarz kogoś kto nigdy Hiszpanii nie widział. Piękna rozbieżność.",
  "Fallven: wysoki lvl, hiszpańska flaga, twarz która sugeruje inne klimaty. Zagadka sezonu.",
  "Fallven analizuje wymianę tak długo jak Tatuś analizuje krypto. Wynik podobny.",
  // Sonny
  "Sonny szuka drogi do własnej głowy od 2019 roku. Aplikacja go nie znajdzie, ale kartę musi wysłać.",
  "Sonny po cichu kocha Domcię. Domcia po cichu wzięła tabletkę i poszła do łóżka.",
  "Sonny wyszedł na chwilę. Wrócił po 4 godzinach z uśmiechem i bez karty. Klasyk.",
  // BUBU
  "BUBU zdezerterował do AnyFam. Wrócił. Nikt nie pyta dlaczego. Wszyscy wiedzą dlaczego.",
  "BUBU i Bastek — weterani AnyFam, którzy wrócili. Gang przyjął. Gang nie zapomniał.",
  "BUBU wrócił jak pies z podkulonym ogonem. Pies jest teraz w gangu i wysyła karty. Psie.",
  // Kickboxer
  "Kickboxer kopie w powietrze z pełnym zaangażowaniem. Powietrze jeszcze nie złożyło skargi.",
  "Kickboxer zakręcił się, kopnął, przewrócił i... zapomniał wysłać kartę. Znowu.",
  "Kickboxer lubi Sonię. Sonia uciekła do AnyFam. Kickboxer kopie w powietrze z żalu.",
  // Kristoforo
  "Kristoforo chciał wylecieć z gangu całym sercem. Gang w końcu spełnił to marzenie. Oboje zadowoleni.",
  "Kristoforo robił turnieje po 10 osób i myślał że to hit. Przyszło 3. Wyleciał zanim turniej się skończył.",
  "Holenderski wiatrak przestał się kręcić w FAM. Kristoforo wyleciał na zbity pysk. Sam się o to prosił.",
  // Artatuś
  "Artatuś siedzi w Hadze i milczy. Mówi tylko: 'Wysłałem' i 'Napiję się'. W tej kolejności.",
  "Artatuś potwierdza wymianę cicho. Bez fanfar. Bez komentarza. Mistrz gatunku.",
  // CHMARSONN
  "CHMARSONN nie ogląda telewizji. Zamiast tego bije i wysyła karty. Produktywny człowiek.",
  "Tomeczek nie potrzebuje TV. Ma gang, ma walki, ma krypto Tatusia do analizy.",
  // Kasia
  "Kasia jest wszędzie i nigdzie. Cicha nimfomanka gangu — nie bije ale w każdej fotce jest.",
  "Kasia milczy, obserwuje i wie wszystko. Najniebezpieczniejszy typ w gangu.",
  // Krime
  "Krime istnieje. Bije się dobrze. Reszta to tajemnica otoczona zagadką.",
  "Nikt nie wie kim jest Krime. Krime wie kim jesteś Ty. I wie że nie wysłałeś karty.",
  // Szczawo
  "Szczawo ma dwa imiona: Szczawiński i Gorzała. Gorzała to nie przydomek, to styl życia.",
  "Szczawo zatwierdził wymianę między pierwszym a drugim kieliszkiem. Precyzja czasowa.",
  // Tatuś
  "Tatuś przeanalizował wymianę 7 razy z każdej strony. Wynik: wyślij kartę.",
  "Tatuś gra na giełdzie, handluje krypto i zarządza gangiem. Portfolio zróżnicowane.",
  "Tatuś jest Bossem. Lubi żarówki i krypto. Żarówki przynajmniej się nie krasują.",
  // Ponton i KaY4k
  "Ponton i KaY4k — bracia w Niemczech, bracia w podcietych tylkach, bracia w kartach.",
  "KaY4k pracuje u Pontona bez pensji. Przynajmniej wie że karta do niego trafi.",
  "Ponton pokazał wymiankę swojemu kotu. Kot mruknął aprobująco. Kot ma rację.",
  // Bodek
  "Bodek: Białorusin, wieczorami zajęty. Pytasz o co? Nie pytaj o co.",
  "Bodek wysłał kartę zanim dzieci poszły spać. Priorytety ustawione prawidłowo.",
  // Joker
  "Joker nigdy nie schodzi z kasy w Lidlu. Mimo to wysłał kartę. Multitasking na poziomie.",
  "Joker zeskanował kartę, zapakował zakupy i potwierdził wymianę. Kasa numer 4 nadal czynna.",
  // Bangmasta
  "Bangmasta stworzył tę apkę. Jeśli coś nie działa — jego wina. Jeśli działa — jego zasługa.",
  "Bangmasta: spec od AI, twórca apki, Pinglorz z okularami. Przystojny. Sam tak mówi.",
  // Krystian i Domcia
  "Krystek i Domcia w Anglii — oboje na emeryturze gangowej. Wspominają stare czasy i nie wysyłają kart.",
  "Domcia założyła gang i odeszła. Zostawiła Krystiana, tabletki i Sonny'ego z jego uczuciami.",
  "Domcia nie gra już z nami. Specjalistka od białych proszków ma ważniejsze sprawy. Poważne.",
  "Krystek i Domcia siedzą w Anglii i wspominają jak pięknie było w FAM. Kart nie wysyłają. Przynajmniej jest o czym gadać.",
  "Domcia ma zawsze dobrą radę. Zazwyczaj w formie małej białej tabletki.",
  // Sonia i Bastek
  "Sonia: siedzi w AnyFam sama. Devil, Marysia i Zielu wrócili do FAM. Kickboxer przestał kopić z tęsknoty. Zaczął z przyzwyczajenia.",
  "Bastek wyszedł z AnyFam i wrócił do FAM pierwszy. Devil, Marysia i Zielu poszli w jego ślady. Koło się zatoczyło.",
  "Sonia siedzi w AnyFam sama. BUBU wrócił. Bastek wrócił. Devil i Marysia wrócili. Jedna osoba zostaje przy swoim zdaniu.",
  // Kombinowane
  "Holenderskie duo: Artatuś i Młody. Jeden milczy, drugi szuka drogi do domu. Wiatrak odleciał gdzie indziej.",
  "Sonny kocha Domcię. Domcia wzięła tabletkę i wyjechała do Anglii. Krystek tam już był. Siedzą i wspominają.",
  "Kickboxer, Sonny i Młody to trio które razem mogłoby nie trafić do własnych mieszkań.",
  "Ponton, KaY4k i gebelsy — historia rodziny która podcięła sobie razem.",
  "SaMaNtA z wiertłem, Bangmasta z aplikacją, Tatuś z analizą — gang ma narzędzia. Użyjcie ich.",
  "BUBU wrócił. Bastek wrócił. Devil i Marysia wrócili. Sonia sama w AnyFam. ™FAM™ widocznie ciągnie.",
  "Kasia obserwuje, Krime milczy, Bodek topi, Joker kasuje. ™FAM™ — różnorodność to nasza siła.",
  // Nowe po powrocie Bastka
  "Bastek wrócił. Gang nie pytał dlaczego. Zapytał tylko czy karty idą na czas. Idą.",
  "Devil założył AnyFam bo się obraził. Marysia poszła z nim. Oboje wrócili. Obraza minęła, karty znów lecą.",
  "AnyFam: założone z dumy przez Devila i Marysię. Dziś zostaje tam już tylko Sonia i uparty opór.",
  "Bastek wrócił do korzeni pierwszy. Devil i Marysia poszli w jego ślady. I tak lepiej.",
  "Devil stworzył AnyFam z obrazy. ™FAM™ i tak go odzyskało — razem z Marysią i Zielu. Obraza nie trwa wiecznie.",
  "Krystek i Domcia w Anglii — ona odeszła, on odszedł, oboje wspominają. Gang gra dalej bez nostalgii.",
  "Kristoforo tak bardzo chciał wylecieć że w końcu mu się udało. Mission accomplished.",
  "Marysia i Devil wrócili z AnyFam do FAM. Rachunek się zamknął, karty znów płyną.",
  "Krystek i Domcia w Anglii — siedzą, piją herbatę i wspominają jak FAM wygrywał. Gang nie potrzebuje wspomnień. Potrzebuje kart.",
  "Domcia założyła FAM, Krystek był wierny jak pies. Oboje odeszli. Bastek wrócił. Różne priorytety.",
  "Krystek i Domcia na gangowej emeryturze w Anglii. Mają czas. Kart nie mają.",
  "Domcia mówi Krystowi o starych czasach w FAM. Krystek słucha. Żadne z nich nie wysyła kart. Piękna historia.",
  // Więcej o CHMARSONN
  "CHMARSONN to Tomeczek który nie ogląda TV. Zamiast tego bije. I bije dobrze. I tyle o tym.",
  "Tomeczek powiedział kiedyś że TV to opium dla mas. Gang przytaknął i poszedł bić.",
  "CHMARSONN na walce robi robotę bez zbędnych słów. Gdyby gang składał się z samych Tomeczków — wróg by płakał.",
  "CHMARSONN nie oglada telewizji bo woli robić to co w niej pokazują — bić ludzi.",
  // Więcej o Młodym
  "Młody to nowy nabytek z Holandii. Świr ale swój. Tych dwóch przymiotników nie da się od siebie oddzielić.",
  "Młody pali, kręci się, gubi, ale wysyła karty. Gang docenia przynajmniej ten jeden talent.",
  "Młody i Artatuś — ostatni z holenderskiej mafii. Jeden pali i milczy, drugi tylko milczy. Organizator turniejów wyleciał.",
  "Holenderskie duo: Artatuś milczy, Młody szuka wyjścia z pokoju. Organizatora turniejów już nie ma.",
  // Więcej o Bastku i Sonii
  "Bastek wrócił do FAM pierwszy. Devil i Marysia wrócili zaraz po nim. AnyFam zostaje z samą Sonią.",
  "Sonia sama w AnyFam. Devil i Marysia wrócili do FAM. Kickboxer kopie w powietrze. Gang gra dalej.",
  "Bastek, Devil i Marysia wrócili! ™FAM™ pomnik przemianowało na: Sonia — ty jeszcze zostań.",
  // Chupacabra
  "Chupacabra dołączył do gangu. Samanta przedstawiła go osobiście. Teraz obaj mają dostęp do jej wiertła.",
  "Chupacabra gra, gang obserwuje z zainteresowaniem. Nowy układ sił w gangowej parze.",
  // SaMaNtA przerwa
  "SaMaNtA zrobiła sobie przerwę. Wiertło odpoczywa. Gang czeka cierpliwie, bo wie że wróci.",
  // Dawid Kluseczka
  "Dawid Kluseczka wrócił do FAM. Online lubi się zabawić, w grze bije mocno. Priorytety jasne.",
  "Kluseczka zniknął, Kluseczka wrócił. Gang przyjął bez pytań — bije za dobrze żeby pytać o resztę.",
  // Czubak
  "Czubak wyleciał za brak aktywności na ważnych walkach. Ścięty bez sentymentów. Taki los nieobecnych.",
  // Trójkąt
  "Pojawił się Trójkąt. Nikt nie wie skąd, kiedy ani kto to właściwie jest. Gang przyjął z otwartymi ramionami i samymi pytaniami.",
  // Chmarsonn kapitan
  "CHMARSONN został kapitanem gangu. Tomcio rządzi — czasem mu się odkleja wieczorem, ale to już chyba norma na tym stanowisku.",
  // Sonny wieczorami
  "Sonny rozkręca się na grupie wieczorami i mu się odkleja pod kopułą. Gang czyta, kiwa głową, czeka na kartę rano.",
  // Podwójne karty
  "Wszyscy pytają kiedy będą podwójne karty. Gang nie wie. Bangmasta nie wie. Nawet apka nie wie. Czekamy razem.",
  // Więcej o Szczawie
  "Szczawo i Artatuś — obaj mają słabość do trunku. Jeden mówi o tym głośno, drugi milczy i pije.",
  "Szczawo Szczawiński. Gorzała Gorzałowa. Dwie strony tego samego człowieka.",
  "Szczawo wysyła karty gdy jest trzeźwy. Na szczęście trafia się to wystarczająco często.",
  // Więcej o Krimie
  "Krime jest zagadką owiniętą w tajemnicę i wsadzoną w grę mobilną. Ale bije się dobrze.",
  "Nikt nie zna prawdziwej tożsamości Krime. Krime zna twoją. I wie że karta czeka na wysłanie.",
  "Krime pojawia się na walce, bije, znika. Jak duch — tyle że z obrażeniami w statystykach.",
  // Więcej o Kasii
  "Kasia jest wszędzie. Nawet teraz. Zwłaszcza teraz. Widzisz ją? Ona widzi ciebie.",
  "Cicha nimfomanka gangu — Kasia. Nie krzyczy, nie wymaga, po prostu wie wszystko o wszystkich.",
  "Kasia milczy więcej niż Artatuś. A to jest bardzo wysoka poprzeczka.",
  // Więcej kombinowanych
  "Tatuś analizuje, Bangmasta koduje, SaMaNtA wierci — gang ma specjalistów od wszystkiego.",
  "Sonny szuka Domci. Domcia i Krystek w Anglii, na emeryturze. Kickboxer kopie. Gang gra.",
  "Ponton, KaY4k i gebels — familijny biznes bez pensji i bez żalu. Przynajmniej jeden z dwóch.",
  "SaMaNtA wyrwieje ząb, Szczawo to przepije, Sonny tego nie zauważy. Trójca gangowa.",
  "Joker na kasie, Bangmasta przy kodzie, Kickboxer w powietrzu — każdy robi co umie.",
  "BUBU wrócił, Krystek wspomina w Anglii, Tatuś analizuje, Krime milczy. Normalny dzień w FAMILY.",
];

// Teksty do rozpiski — pokazywane przy aktywnej wymianie
const TEKSTY_ROZPISKI = [
  "Karta się sama nie wyśle. Sonny sprawdzał — jest gdzieś w połowie drogi do własnej głowy.",
  "Bangmasta patrzy. Aplikacja pamięta. Kasia obserwuje. Wyślij kartę.",
  "SaMaNtA wysłała zanim skończyła wiercić. Masz mniej wymówek niż jej pacjenci.",
  "Kickboxer skopał powietrze i potwierdził. Powietrze nic nie zrobiło. Ty coś zrób.",
  "BUBU wrócił po dezerterskiej przygodzie. Najmniej co może zrobić — to wysłać kartę.",
  "Tatuś przeanalizował wymianę 7 razy. Wynik każdej analizy: wyślij kartę.",
  "Dawid Kluseczka pije online ale bije mocno i wysyła kartę. Weź przykład.",
  "Ponton pokazał wymiankę kotu. Kot mruknął: wyślij. Kot mądrzejszy od połowy gangu.",
  "Joker jest na kasie w Lidlu. Zdążył potwierdzić. Zastanów się nad swoim życiem.",
  "Szczawo wysłał między pierwszym a drugim. Chwila precyzji w morzu gorzały.",
  "Artatuś nic nie mówi. Po prostu wysyła. Naśladować. Nie podziwiać. Wysyłać.",
  "Domcia odeszła i Krystek za nią. Zasada została: wysyłasz kartę bo inaczej kto przyjedzie? Nikt. Wysyłasz kartę.",
  "Kasia jest wszędzie. Zwłaszcza tutaj. Zwłaszcza teraz. Wyślij.",
  "Bodek wysłał zanim zaczął topić. Priorytety ustawione wzorowo.",
  "Sonia jest w AnyFam. Nie wróciła. Kickboxer kopie w powietrze i czeka.",
  "Krystian ma ripostę na każdą wymówkę. Nie testuj. Wyślij kartę.",
  "Bastek, Devil i Marysia wrócili i wysyłają karty. Sonia sama w AnyFam. Kickboxer kopie już tylko za połowę.",
  "KaY4k nie dostaje pensji od Pontona, ale kartę wysyła. Charakter.",
  "CHMARSONN nie marnuje słów. Ani na pogaduszki, ani na wymówki. Wyślij kartę.",
  "Młody jest nowy. Jeszcze się uczy. Mimo to wysłał. Ty grasz dłużej — co masz do powiedzenia?",
  "Krystek ma ripostę gotową ale siedzi w Anglii i jej nie używa. Wysyłasz kartę bez strachu.",
  "Szczawo wysłał między kieliszkami. Trzeźwy czy nie — obowiązek obowiązuje.",
  "Krime wysłał bez słowa. Bez pytania. Bez wymówki. Weź przykład z człowieka-zagadki.",
  "Tatuś przeanalizował Twój brak akcji. Wyniki: nieoptymalne. Rozwiązanie: wyślij kartę.",
  "Holenderskie duo wysłało. Artatuś milczy, Młody szuka przycisku. Ale wysłali.",
];

const TIPY=[
  "💡 Tip dnia: Zakładka ROZPISKA — sprawdź czy masz coś do wysłania!",
  "💡 Tip dnia: Duplikaty to waluta gangu. Im więcej masz tym bardziej jesteś lubiany.",
  "💡 Tip dnia: Użyj skanera w zakładce TESTY — 15 talii w 30 sekund!",
  "💡 Tip dnia: Złote dni i diamentowe dni — przełączaj przycisk ZŁOTE/DIAMENTOWE.",
  "💡 Tip dnia: Jeśli karta wpadła z paczki — admin może podmienić wymianę w ROZPISCE.",
  "💡 Tip dnia: Im szybciej potwierdzisz wymianę tym szybciej gang dostanie ammo.",
  "💡 Tip dnia: Sprawdź zakładkę Duplikaty — może ktoś szuka karty którą masz!",
  "💡 Tip dnia: Podsumowanie sezonu w zakładce Walki — kto jest królem obrażeń?",
  "💡 Tip dnia: Talia zamknięta przez cały gang = nagroda dla wszystkich. Warto się starać!",
  "💡 Tip dnia: Admin może zaznaczać potwierdzenia za innych w ROZPISCE — popros jeśli nie możesz.",
  "💡 Fallven tip: Wysoki lvl nie gwarantuje mądrości. Wysyłanie kart — tak.",
  "💡 Tip dnia: BUBU wrócił. Teraz czas żebyś Ty wrócił do wysyłania kart.",
  "💡 Sonny tip: Zanim zaczniesz szukać drogi do własnej głowy — potwierdź wymianę.",
  "💡 Tip dnia: SaMaNtA ma nieograniczone ammo. Ty masz kartę do wysłania. Priorytety.",
  "💡 Kickboxer tip: Kopiąc w powietrze nie wyślesz karty. Tutaj jest przycisk.",
];

// Mapa avatarów członków gangu
const AVATARY = {
  "samanta": "🦷",        // dentysta sadystka
  "fallven": "🇪🇸🤨",     // hiszpańska flaga + zdezorientowany
  "sonny": "🚬😵‍💫",      // dymek + zagubiony
  "bubu": "🔄",           // powrót do gangu
  "kickboxer": "🥋",      // sztuki walki
  "kristoforo": "🌷🌀",   // tulipan + wiatrak
  "artatuś": "🍺🤫",     // piwo + cisza
  "chmarsonn": "📺❌",    // brak TV
  "kasia": "👀",          // obserwuje wszystkich
  "krime": "❓🥷",        // tajemniczy
  "szczawo": "🥃",        // gorzała
  "tatuś": "💡📊",        // żarówki + analiza
  "ponton": "🐱🇩🇪",     // kot + Niemcy
  "bodek": "🇧🇾",         // Białorusin
  "joker": "🛒",          // kasa Lidla
  "krystian": "👨‍🦲",    // łysy z brodą
  "bangmasta": "🤓",      // okulary
  "kay4k": "💸❌",        // brak pensji
  "młody": "🇳🇱🚬",      // Holandia + dymek
  "domcia": "💊",         // tabletki
  "sonia": "🏃‍♀️",       // uciekła
  "bastek": "🏃",         // uciekł
  "leonidas": "⚔️",       // nowy member
};

// eslint-disable-next-line no-unused-vars
function getAvatar(nazwa) {
  if (!nazwa) return "";
  const key = nazwa.toLowerCase()
    .replace(/™fam™|fam™|™fam/gi, "")
    .replace(/\s+/g, "")
    .trim();
  // Szukaj po kluczu lub częściowym dopasowaniu
  if (AVATARY[key]) return AVATARY[key];
  for (const [k, v] of Object.entries(AVATARY)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return "👤";
}

// ============================================================
// SYSTEM MOTYWÓW
// ============================================================
const MOTYWY = {
  gold:     { nazwa:"Gold & Black",  emoji:"🥇", bg:"#0a0a12", card:"rgba(255,215,0,0.06)", border:"rgba(255,215,0,0.18)", accent:"#ffd700", accent2:"#b8860b", text:"#f0e6d3", muted:"#666", header:"linear-gradient(135deg,#1a0a00,#2a1500)", btn:"linear-gradient(135deg,#b8860b,#ffd700)", btnText:"#000", font:"'Georgia',serif" },
  gangster: { nazwa:"Gangster",      emoji:"🔴", bg:"#0d0000", card:"rgba(180,0,0,0.08)",   border:"rgba(180,0,0,0.3)",   accent:"#cc0000", accent2:"#8a0000", text:"#f5e6d0", muted:"#7a5a5a", header:"linear-gradient(135deg,#2a0000,#8a0000)", btn:"linear-gradient(135deg,#8a0000,#cc0000)", btnText:"#fff" , font:"'Georgia',serif" },
  cyberpunk:{ nazwa:"Cyberpunk",     emoji:"🔵", bg:"#050510", card:"rgba(0,200,255,0.05)",  border:"rgba(0,200,255,0.2)", accent:"#00c8ff", accent2:"#0066cc", text:"#e0f0ff", muted:"#3a6a8a", header:"linear-gradient(135deg,#000a2a,#001a4a)", btn:"linear-gradient(135deg,#0044aa,#00c8ff)", btnText:"#000" , font:"'Courier New',monospace" },
  purple:   { nazwa:"Purple Crime",  emoji:"🟣", bg:"#0a0010", card:"rgba(150,0,255,0.06)", border:"rgba(150,0,255,0.22)",accent:"#aa00ff", accent2:"#6600cc", text:"#f0e0ff", muted:"#6a4a8a", header:"linear-gradient(135deg,#1a0030,#4a0080)", btn:"linear-gradient(135deg,#4a0080,#aa00ff)", btnText:"#fff" , font:"'Georgia',serif" },
  military: { nazwa:"Military",      emoji:"🟢", bg:"#080c08", card:"rgba(80,120,40,0.07)", border:"rgba(80,120,40,0.28)",accent:"#6aa020", accent2:"#3a6010", text:"#d0e0c0", muted:"#4a6040", header:"linear-gradient(135deg,#0a1408,#1a2a10)", btn:"linear-gradient(135deg,#3a6010,#6aa020)", btnText:"#fff" , font:"'Courier New',monospace" },
  minimal:  { nazwa:"Minimalist",    emoji:"⚫", bg:"#0f0f0f", card:"rgba(255,255,255,0.03)",border:"rgba(255,255,255,0.1)",accent:"#ffffff",accent2:"#aaaaaa", text:"#e8e8e8", muted:"#555",   header:"linear-gradient(135deg,#1a1a1a,#0f0f0f)", btn:"linear-gradient(135deg,#444,#fff)", btnText:"#000" , font:"'Arial',sans-serif" },
  vice:     { nazwa:"Vice City",     emoji:"🌴", bg:"#080014", card:"rgba(255,50,180,0.05)",border:"rgba(255,50,180,0.18)",accent:"#ff3eb5",accent2:"#00eeff", text:"#ffe0f5", muted:"#7a4a6a", header:"linear-gradient(135deg,#1a0028,#3a0050)", btn:"linear-gradient(135deg,#aa0080,#ff3eb5)", btnText:"#000" , font:"'Georgia',serif" },
};

const ROZMIARY = { mały: 12, normalny: 14, duży: 16 };

function useWyglad() {
  const key = "gang_wyglad_v2";
  const [wyglad, setWygladState] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key)) || { motyw:"gold", uklad:"top", rozmiar:"normalny" }; }
    catch { return { motyw:"gold", uklad:"top", rozmiar:"normalny" }; }
  });
  const setWyglad = (nowy) => {
    const merged = { ...wyglad, ...nowy };
    setWygladState(merged);
    localStorage.setItem(key, JSON.stringify(merged));
  };
  const m = MOTYWY[wyglad.motyw] || MOTYWY.gold;
  return [wyglad, setWyglad, m];
}

// Wstrzykuje CSS zmienne dla aktywnego motywu
function MotywStyle({ motyw, rozmiar }) {
  const r = ROZMIARY[rozmiar] || 14;
  const fnt = motyw.font || "'Georgia',serif";
  const parts = [
    ":root{",
    "--bg:"+motyw.bg+";",
    "--card:"+motyw.card+";",
    "--border:"+motyw.border+";",
    "--accent:"+motyw.accent+";",
    "--accent2:"+motyw.accent2+";",
    "--text:"+motyw.text+";",
    "--muted:"+motyw.muted+";",
    "--btn:"+motyw.btn+";",
    "--btn-text:"+motyw.btnText+";",
    "--fnt:"+r+"px;",
    "--font:"+fnt+";",
    "--card-solid:color-mix(in srgb,"+motyw.bg+" 80%,white 20%);",
    "}",
    "html{font-size:"+r+"px!important;-webkit-text-size-adjust:"+r+"px!important}",
    ".gang-main-content *{font-size:inherit}",
    "body,#root{background:"+motyw.bg+"!important;color:"+motyw.text+"!important;font-family:"+fnt+"!important;font-size:"+r+"px!important}",
    "div,span,p,label,li{font-family:"+fnt+"!important}",
    "button{font-family:"+fnt+"!important;font-size:"+r+"px}",
    "input,textarea,select{background:color-mix(in srgb,"+motyw.bg+" 85%,white 15%)!important;color:"+motyw.text+"!important;border-color:"+motyw.border+"!important;font-family:"+fnt+"!important;font-size:"+r+"px!important}",
    "input::placeholder,textarea::placeholder{color:"+motyw.muted+"!important;opacity:1!important}",
    "::-webkit-scrollbar{width:3px;height:3px}",
    "::-webkit-scrollbar-track{background:"+motyw.bg+"}",
    "::-webkit-scrollbar-thumb{background:"+motyw.border+";border-radius:2px}",
    "::selection{background:"+motyw.accent+"44;color:"+motyw.text+"}",
  ].join("");
  return <style>{parts}</style>;
}

function App() {
  // sessionStorage = auto-wylogowanie przy zamknięciu karty/przeglądarki
  const [zalogowany, setZalogowany] = useState(() => {
    try { 
      // Admini mogą być zapamiętani (localStorage), członkowie muszą się logować każdym razem (sessionStorage)
      const zSession = sessionStorage.getItem("gang_user");
      if (zSession) return JSON.parse(zSession);
      const zLocal = localStorage.getItem("gang_user");
      if (zLocal) {
        const u = JSON.parse(zLocal);
        // Tylko admin może być zapamiętany
        if (u.rola === "admin" || u.rola === "zastepca") return u;
        // Członkowie — usuń stary zapis i wymuś logowanie
        localStorage.removeItem("gang_user");
        return null;
      }
      return null;
    } catch { return null; }
  });
  const [wyglad, setWyglad, motyw] = useWyglad();
  const [historiaPush, setHistoriaPush] = useState([]); // eslint-disable-line no-unused-vars

  const [dane, setDane] = useState(null); // null = loading
  const [zakładka, setZakładka] = useState(() => {
    // Jeśli jest aktywna wymiana — otwórz od razu rozpiskę
    // (sprawdzimy po załadowaniu danych przez useEffect)
    return "dane";
  });
  const [typWymiany, setTypWymiany] = useState("złote");
  const [historiaWymian, setHistoriaWymian] = useState([]);

  // === DANE EVENTOWE ===
  const [daneEvent, setDaneEvent] = useState(null);

  useEffect(() => {
    let unsub = null;
    (async () => {
      try {
        const start = await loadEventData();
        if (start) setDaneEvent(start);
        else setDaneEvent({ talieEvent: [], posiadaneEvent: {}, duplikatyEvent: {} });
      } catch(e) { setDaneEvent({ talieEvent: [], posiadaneEvent: {}, duplikatyEvent: {} }); }
      unsub = subscribeEventData((d) => {
        if (d) startTransition(() => setDaneEvent(d));
      });
    })();
    return () => { if (unsub) unsub(); };
  }, []);

  useEffect(() => {
    const unsub = subscribeHistoria(d => startTransition(() => setHistoriaWymian(d)));
    return () => unsub();
  }, []);

  // Foreground FCM handler — gdy apka jest otwarta FCM nie pokazuje powiadomienia,
  // musimy to zrobić ręcznie. Na Androidzie new Notification() jest zablokowane —
  // używamy SW.showNotification() który działa wszędzie.
  useEffect(() => {
    try {
      const unsub = onForegroundMessage((payload) => {
        if (Notification.permission !== "granted") return;
        const title = payload.notification?.title || "™FAM™";
        const opts = {
          body: payload.notification?.body || "",
          icon: "/logo192.png",
          badge: "/logo192.png",
          vibrate: [200, 100, 200],
        };
        // SW.showNotification działa na mobile i desktop
        // new Notification() jest zablokowane na Androidzie Chrome
        navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js")
          .then(reg => {
            if (reg) {
              reg.showNotification(title, opts);
            } else {
              new Notification(title, opts); // fallback desktop
            }
          })
          .catch(() => {
            try { new Notification(title, opts); } catch(e2) { /* Safari bez SW */ }
          });
      });
      return () => unsub();
    } catch(e) { /* messaging niedostępny (np. Safari) */ }
  }, []);
  const [wynik, setWynik] = useState(null);
  const [trybWymiany, setTrybWymiany] = useState("priorytet");
  const [wynikV3, setWynikV3] = useState(null);
  const [trybV3, setTrybV3] = useState("priorytet");
  const [paczkiDiament, setPaczkiDiament] = useState({}); // {osobaId: liczba paczek nowych diamentowych}
  const [statusZapisu, setStatusZapisu] = useState("");

  const [statusOnline, setStatusOnline] = useState({});
  const [zablokowane, setZablokowane] = useState([]);
  const [archiwumWalk, setArchiwumWalk] = useState([]);
  const [alertNoweUrzadzenie, setAlertNoweUrzadzenie] = useState(null); // {nick, fp, czas}

  // Heartbeat obecności — co 30 sekund zapisuj że jesteś online
  useEffect(() => {
    if (!zalogowany) return;
    const login = zalogowany.login;
    setOnline(login);
    const interval = setInterval(() => {
      if (!document.hidden) setOnline(login); // tylko gdy karta aktywna
    }, 30000);
    let lastOnlineUpdate = 0;
    const unsub = subscribeOnline((newStatus) => {
      const now = Date.now();
      if (now - lastOnlineUpdate > 10000) {
        lastOnlineUpdate = now;
        startTransition(() => setStatusOnline(newStatus));
      }
    });
    const unsubArchiwum = subscribeArchiwumWalk(d => startTransition(() => setArchiwumWalk(d)));
    const handleUnload = () => setOffline(login);
    window.addEventListener("beforeunload", handleUnload);

    // Zapisz log wejścia
    (async () => {
      try {
        const fp = getFingerprint();
        await zapiszLog({
          nick: login,
          rola: zalogowany.rola || "czlonek",
          czas: Date.now(),
          fp,
          typ: "wejscie",
        });
      } catch(e) { console.error("Błąd zapisu logu wejścia:", e); }
    })();

    // Admin: subskrybuj logi żeby wykrywać nowe urządzenia w czasie rzeczywistym
    let unsubLogi = null;
    if (zalogowany.rola === "admin") {
      const { subscribeLogi: subLogi } = require("./firebase");
      let poprzednieLogi = null;
      unsubLogi = subLogi((logi) => {
        if (poprzednieLogi === null) { poprzednieLogi = logi; return; }
        // Znajdź nowe wpisy z nowym urządzeniem których wcześniej nie było
        const noweAlerty = logi.filter(l =>
          l.noweUrzadzenie &&
          !poprzednieLogi.some(p => p.fp === l.fp && p.nick === l.nick && p.czas === l.czas)
        );
        if (noweAlerty.length > 0) {
          setAlertNoweUrzadzenie(noweAlerty[0]);
        }
        poprzednieLogi = logi;
      });
      // Subskrybuj czarną listę
      subscribeZablokowane(d => startTransition(() => setZablokowane(d)));
    }

    return () => {
      clearInterval(interval);
      unsub();
      unsubArchiwum();
      if (unsubLogi) unsubLogi();
      window.removeEventListener("beforeunload", handleUnload);
      setOffline(login);
    };
  }, [zalogowany]);

  // Subskrypcja na żywo z Firebase — zawsze ufamy serwerowi
  useEffect(() => {
    let unsub = null;
    (async () => {
      try {
        const start = await loadGangData();
        if (start === null) {
          // Dokument naprawdę nie istnieje w bazie — inicjalizuj (tylko przy pierwszym uruchomieniu)
          await saveGangData(DOMYSLNE_DANE);
          setDane(DOMYSLNE_DANE);
        } else {
          // Dokument istnieje — użyj danych z bazy
          setDane({
            talie: uzupelnijTalie(start.talie) || DOMYSLNE_DANE.talie,
            czlonkowie: start.czlonkowie || DOMYSLNE_DANE.czlonkowie,
            posiadane: start.posiadane || {},
            duplikaty: start.duplikaty || {},
            walki: start.walki || [],
            aktywnaWymiana: start.aktywnaWymiana || null,
          });
        }
      } catch (e) {
        // Błąd sieci — NIE inicjalizuj danych, poczekaj na subskrypcję
        console.error("Błąd inicjalizacji Firebase:", e);
      }

      // Subskrypcja real-time — niezależna od błędu inicjalizacji
      let pendingDane = null;
      let daneTimer = null;
      unsub = subscribeGangData((d) => {
        pendingDane = {
          talie: uzupelnijTalie(d.talie) || DOMYSLNE_DANE.talie,
          czlonkowie: d.czlonkowie || DOMYSLNE_DANE.czlonkowie,
          posiadane: d.posiadane || {},
          duplikaty: d.duplikaty || {},
          walki: d.walki || [],
          aktywnaWymiana: d.aktywnaWymiana || null,
        };
        // Debounce — aktualizuj state max raz na 500ms
        if (daneTimer) clearTimeout(daneTimer);
        daneTimer = setTimeout(() => {
          if (pendingDane) startTransition(() => setDane(pendingDane));
          pendingDane = null;
        }, 300);
      });
    })();
    return () => { if (unsub) unsub(); };
  }, []);

  // Atomowy zapis pojedynczej karty (bez nadpisywania innych zmian)
  const zapiszKarte = async (typ, key, value) => {
    setStatusZapisu("⏳ Zapisywanie...");
    const ok = await setCardField(typ, key, value);
    setStatusZapisu(ok ? "✓ Zapisano" : "❌ Błąd");
    setTimeout(() => setStatusZapisu(""), 1200);
  };

  // Zapis strukturalny (talie, członkowie)
  const zapiszStrukture = async (pole, wartosc) => {
    setStatusZapisu("⏳ Zapisywanie...");
    const ok = await setStructure(pole, wartosc);
    if (ok === "konflikt") {
      setStatusZapisu("⚠️ Ktoś właśnie zmienił te dane");
      alert("⚠️ Ktoś inny właśnie zmienił te same dane. Odświeżyłem widok do najnowszej wersji — powtórz swoją zmianę, żeby nie nadpisać cudzej.");
      setTimeout(() => setStatusZapisu(""), 3000);
      return;
    }
    setStatusZapisu(ok ? "✓ Zapisano" : "❌ Błąd");
    setTimeout(() => setStatusZapisu(""), 1200);
  };

  // Zapis kart eventowych
  // WAŻNE: dokument eventowy trzyma dane pod polami "posiadaneEvent"/"duplikatyEvent",
  // a wspólny komponent DaneView zawsze woła zapiszKarte z typem "posiadane"/"duplikaty"
  // (tak samo jak w trybie zwykłym) — trzeba więc przemapować nazwę pola przed zapisem,
  // inaczej zapis trafia do nieistniejącego (nieczytanego przez UI) pola.
  const zapiszKarteEvent = async (typ, key, value) => {
    const pole = typ === "posiadane" ? "posiadaneEvent" : typ === "duplikaty" ? "duplikatyEvent" : typ;
    setStatusZapisu("⏳ Zapisywanie...");
    const ok = await setEventCardField(pole, key, value);
    setStatusZapisu(ok ? "✓ Zapisano" : "❌ Błąd");
    setTimeout(() => setStatusZapisu(""), 1200);
  };

  // Zapis struktury eventowej (talieEvent)
  const zapiszStrukturEvent = async (pole, wartosc) => {
    setStatusZapisu("⏳ Zapisywanie...");
    const ok = await setEventStructure(pole, wartosc);
    if (ok === "konflikt") {
      setStatusZapisu("⚠️ Ktoś właśnie zmienił te dane");
      alert("⚠️ Ktoś inny właśnie zmienił te same dane eventu. Odświeżyłem widok — powtórz swoją zmianę.");
      setTimeout(() => setStatusZapisu(""), 3000);
      return;
    }
    setStatusZapisu(ok ? "✓ Zapisano" : "❌ Błąd");
    setTimeout(() => setStatusZapisu(""), 1200);
  };

  // Zapis loginu
  useEffect(() => {
    try {
      if (zalogowany) {
        if (zalogowany.rola === "admin" || zalogowany.rola === "zastepca") {
          localStorage.setItem("gang_user", JSON.stringify(zalogowany)); // admin zapamiętany
        } else {
          sessionStorage.setItem("gang_user", JSON.stringify(zalogowany)); // członek tylko na sesję
          localStorage.removeItem("gang_user"); // wyczyść stary zapis
        }
      } else {
        sessionStorage.removeItem("gang_user");
        localStorage.removeItem("gang_user");
      }
    } catch {}
  }, [zalogowany]);

  // Memoizuj przed early return (reguły hooków)
  const talieSorted = useMemo(
    () => dane ? [...dane.talie].sort((a,b)=>(a.numer||99)-(b.numer||99)) : [],
    [dane]
  );
  const posiadaneMemo = useMemo(() => dane?.posiadane || {}, [dane]);
  const duplikatyMemo = useMemo(() => dane?.duplikaty || {}, [dane]);
  const czlonkowieMemo = useMemo(() => dane?.czlonkowie || [], [dane]);
  // W evencie obowiązuje osobny krąg gracza (kragEvent) — nagrody talii liczone wg niego
  const czlonkowieTyp = useMemo(
    () => typWymiany === "event" ? (dane?.czlonkowie || []).map(c => ({ ...c, krag: c.kragEvent || 1 })) : (dane?.czlonkowie || []),
    [dane, typWymiany]
  );

  // Memoizuj dane eventowe
  const talieEventSorted = useMemo(
    () => daneEvent ? [...(daneEvent.talieEvent||[])].sort((a,b)=>(a.numer||99)-(b.numer||99)) : [],
    [daneEvent]
  );
  const posiadaneEventMemo = useMemo(() => daneEvent?.posiadaneEvent || {}, [daneEvent]);
  const duplikatyEventMemo = useMemo(() => daneEvent?.duplikatyEvent || {}, [daneEvent]);

  // Przełącz na rozpiskę przy pierwszym załadowaniu jeśli jest aktywna wymiana
  useEffect(()=>{
    if (dane?.aktywnaWymiana && zakładka === "dane") {
      setZakładka("aktywna");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dane?.aktywnaWymiana]);

  if (!zalogowany) return <LoginScreen onLogin={setZalogowany} czlonkowie={dane?.czlonkowie||[]}/>;  
  if (!dane) return <LoadingScreen/>;

  const isAdmin = zalogowany.rola === "admin" || zalogowany.rola === "zastepca";




  const tabs = [
    {id:"dane",label:"📋 Dane gangu"},
    {id:"duplikaty",label:"🔄 Duplikaty"},
    {id:"aktywna",label:dane?.aktywnaWymiana?"📋 ROZPISKA ●":"📋 ROZPISKA"},
    {id:"walki",label:"🎯 Walki"},
    {id:"chat",label:"💬 Chat"},
    ...(isAdmin?[
      {id:"wynik",label:"⚡ Generuj"},
      {id:"wynikV3",label:"🧠 Generuj V3"},
      {id:"ocr",label:"📸 OCR talii"},
      {id:"edycja",label:"⚙️ Talie"},
      {id:"edycja_event",label:"🎉 Talie EVENT"},
      {id:"czlonkowie",label:"👥 Członkowie"},
      {id:"testy",label:"🧪 TESTY"},
    ]:[]),
  ];

  const handleZablokuj = async (fp, nick) => {
    if (!window.confirm(`Zablokować urządzenie (${fp}) użytkownika ${nick}?\n\nOsoba nie będzie mogła się zalogować z tego urządzenia.`)) return;
    await zablokujUrządzenie(fp, nick, "Zablokowane przez admina");
    setAlertNoweUrzadzenie(null);
    alert("✅ Urządzenie zablokowane.");
  };

  return (
    <div style={{height:"100dvh",display:"flex",flexDirection:"column",background:"var(--bg)",color:"var(--text)",overflow:"hidden"}}>
      <MotywStyle motyw={motyw} rozmiar={wyglad.rozmiar}/>
      <div style={{flex:1,overflowY:"auto",overflowX:"hidden",WebkitOverflowScrolling:"touch",minHeight:0}}>

      {/* Tło */}
      <div style={{
        position:"fixed",top:0,left:0,right:0,bottom:0,
        background:"var(--bg)",
        zIndex:0,pointerEvents:"none",
        transform:"translateZ(0)",
      }}/>



      <div style={{position:"relative",zIndex:1,isolation:"isolate"}}>

      {/* Alert nowego urządzenia — tylko dla admina */}
      {alertNoweUrzadzenie && zalogowany?.rola === "admin" && (
        <div style={{
          position:"fixed",top:0,left:0,right:0,zIndex:9999,
          background:"linear-gradient(135deg,#7a0000,#b00000)",
          borderBottom:"2px solid #f55",padding:"12px 16px",
          display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",
          boxShadow:"0 4px 20px rgba(255,50,50,0.4)",
        }}>
          <span style={{fontSize:20}}>🔴</span>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:"bold",color:"#fff"}}>
              NOWE URZĄDZENIE: <strong>{alertNoweUrzadzenie.nick}</strong>
            </div>
            <div style={{fontSize:11,color:"#ffaaaa",marginTop:2}}>
              Fingerprint: {alertNoweUrzadzenie.fp} · {new Date(alertNoweUrzadzenie.czas).toLocaleString("pl-PL")}
            </div>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            <button onClick={()=>handleZablokuj(alertNoweUrzadzenie.fp, alertNoweUrzadzenie.nick)}
              style={{padding:"7px 14px",background:"#f55",border:"none",borderRadius:6,color:"#fff",cursor:"pointer",fontSize:12,fontWeight:"bold"}}>
              🚫 Zablokuj urządzenie
            </button>
            <button onClick={()=>setAlertNoweUrzadzenie(null)}
              style={{padding:"7px 14px",background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.3)",borderRadius:6,color:"#fff",cursor:"pointer",fontSize:12}}>
              ✓ To ja / Zignoruj
            </button>
          </div>
        </div>
      )}

      <div style={{
        background:"rgba(0,0,0,0.95)",
        padding:"12px 16px",
        borderBottom:"2px solid #b8860b",
        display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,
        position:"sticky",top:0,zIndex:100,
        transform:"translateZ(0)",
        willChange:"transform",
      }}>
        <div>
          <div style={{
            fontSize:18,fontWeight:"bold",letterSpacing:3,
            background:"linear-gradient(90deg,#ffd700,#fff8dc,#ffd700)",
            WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
          }}>⚔ FAMILY — MENADŻER</div>
          <div style={{fontSize:11,color:"var(--muted)",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginTop:2}}>
            <span><span style={{color:"var(--accent)"}}>{zalogowany.login}</span> <span style={{color:"var(--muted)"}}>({zalogowany.rola})</span></span>
            {statusZapisu && <span style={{color:statusZapisu.includes("✓")?"#0c6":statusZapisu.includes("❌")?"#f55":"#fa0"}}>{statusZapisu}</span>}
            {/* Tip dnia */}
            <span style={{fontSize:10,color:"#444",fontStyle:"italic",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
              title={TIPY[Math.floor(Date.now()/43200000)%TIPY.length]}>
              {TIPY[Math.floor(Date.now()/43200000)%TIPY.length]}
            </span>
            {/* Wskaźnik online */}
            {(()=>{
              const PROG = 90000; // 90 sekund = online
              const teraz = Date.now();
              const onlineNicki = Object.entries(statusOnline)
                .filter(([,ts]) => teraz - ts < PROG)
                .map(([nick]) => nick);
              const liczba = onlineNicki.length;
              return (
                <span
                  title={`Online: ${onlineNicki.join(", ") || "brak"}`}
                  style={{
                    display:"inline-flex",alignItems:"center",gap:4,
                    padding:"2px 8px",borderRadius:12,
                    background:"rgba(0,200,100,0.1)",border:"1px solid #0c633",
                    cursor:"default",
                  }}>
                  <span style={{width:7,height:7,borderRadius:"50%",background:"#0c6",display:"inline-block",boxShadow:"0 0 4px #0c6"}}/>
                  <span style={{color:"#0c6",fontWeight:"bold"}}>{liczba}</span>
                  <span style={{color:"#555"}}>online</span>
                </span>
              );
            })()}
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={()=>setTypWymiany(t=>{
            const nowy = t==="złote"?"diamentowe":t==="diamentowe"?"event":"złote";
            if(nowy==="event" && trybWymiany==="progi") setTrybWymiany("priorytet");
            if(nowy==="event" && trybV3==="progi") setTrybV3("priorytet");
            return nowy;
          })} style={{
            padding:"6px 12px",borderRadius:20,fontSize:12,fontWeight:"bold",cursor:"pointer",border:"none",
            background:typWymiany==="złote"?"linear-gradient(135deg,#b8860b,#ffd700)":typWymiany==="diamentowe"?"linear-gradient(135deg,#1a3a8f,#87CEEB)":"linear-gradient(135deg,#1a6b3a,#00e676)",
            color:typWymiany==="złote"?"#000":"#fff",
          }}>{typWymiany==="złote"?"⭐ ZŁOTE":typWymiany==="diamentowe"?"💎 DIAMENTOWE":"🎉 EVENT"}</button>
          <button onClick={()=>setZakładka("wyglad")} style={{
            padding:"5px 10px",
            background:zakładka==="wyglad"?`${motyw.accent}22`:"var(--card)",
            border:`1px solid ${zakładka==="wyglad"?motyw.accent:"rgba(255,255,255,0.15)"}`,
            borderRadius:6,color:zakładka==="wyglad"?motyw.accent:"var(--muted)",
            fontSize:16,cursor:"pointer",lineHeight:1,
          }}>⚙️</button>
          <button onClick={()=>setZalogowany(null)} style={{padding:"5px 10px",background:"rgba(255,50,50,0.2)",border:"1px solid #f55",borderRadius:6,color:"#f55",cursor:"pointer",fontSize:11}}>Wyloguj</button>
        </div>
      </div>

      {/* Pasek z cytatem nad zakładkami */}
      <div style={{
        background:"rgba(184,134,11,0.06)",borderBottom:"1px solid rgba(184,134,11,0.15)",
        padding:"4px 16px",fontSize:11,color:"var(--muted)",fontStyle:"italic",
        textAlign:"center",minHeight:"auto",overflow:"hidden",whiteSpace:"normal",wordBreak:"break-word",
      }}>
        {CYTATY[Math.floor(Date.now()/3600000)%CYTATY.length]}
      </div>

      {wyglad.uklad!=="bottom"&&(<div style={{display:"flex",background:"rgba(0,0,0,0.4)",borderBottom:"1px solid var(--border)",overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setZakładka(t.id)} style={{
            padding:"10px 16px",background:"transparent",border:"none",
            borderBottom:zakładka===t.id?"2px solid #ffd700":"2px solid transparent",
            borderTop:zakładka===t.id?"2px solid rgba(184,134,11,0.3)":"2px solid transparent",
            color:zakładka===t.id?"var(--accent)":"#555",cursor:"pointer",fontSize:12,
            fontWeight:zakładka===t.id?"bold":"normal",whiteSpace:"nowrap",
            letterSpacing:zakładka===t.id?1:0,
            textShadow:zakładka===t.id?"0 0 12px rgba(255,215,0,0.5)":"none",
            transition:"all 0.15s",
            position:"relative",
          }}>
            {t.id==="aktywna"&&dane?.aktywnaWymiana&&(
              <span style={{position:"absolute",top:6,right:4,width:6,height:6,background:"#f55",borderRadius:"50%",boxShadow:"0 0 5px #f55"}}/>
            )}
            {t.label}
          </button>
        ))}
      </div>)}

      <div className="gang-main-content" style={{padding:14,maxWidth:900,margin:"0 auto"}}>
        {zakładka==="wyglad"&&<WygladView wyglad={wyglad} setWyglad={setWyglad} motyw={motyw}/>}
        {zakładka==="dane"&&<DaneView
          talie={typWymiany==="event" ? talieEventSorted : talieSorted}
          czlonkowie={czlonkowieTyp} czlonkowieOryg={czlonkowieMemo} typWymiany={typWymiany}
          posiadane={typWymiany==="event" ? posiadaneEventMemo : posiadaneMemo}
          duplikaty={typWymiany==="event" ? duplikatyEventMemo : duplikatyMemo}
          zalogowany={zalogowany}
          zapiszKarte={typWymiany==="event" ? zapiszKarteEvent : zapiszKarte}
          zapiszStrukture={zapiszStrukture}
          isAdmin={isAdmin}
        />}
        {zakładka==="duplikaty"&&<DuplikatyView
          talie={talieSorted} czlonkowie={dane.czlonkowie}
          duplikaty={dane.duplikaty||{}}
        />}
        {zakładka==="aktywna"&&<AktywnaWymiana
          aktywnaWymiana={dane.aktywnaWymiana}
          zalogowany={zalogowany}
          czlonkowie={czlonkowieTyp}
          talie={typWymiany==="event" ? talieEventSorted : talieSorted}
          posiadane={typWymiany==="event" ? (daneEvent?.posiadaneEvent||{}) : (dane.posiadane||{})}
          duplikaty={typWymiany==="event" ? (daneEvent?.duplikatyEvent||{}) : (dane.duplikaty||{})}
          typWymiany={typWymiany}
          isAdmin={isAdmin}
          zapiszAktywna={(w)=>zapiszStrukture("aktywnaWymiana",w)}
          zapiszKarte={typWymiany==="event" ? zapiszKarteEvent : zapiszKarte}
        />}
        {zakładka==="chat"&&<GangChat zalogowany={zalogowany} czlonkowie={dane.czlonkowie}/>}

        {zakładka==="walki"&&<WalkiView
          czlonkowie={dane.czlonkowie} walki={dane.walki||[]}
          zapiszWalki={(now)=>zapiszStrukture("walki",now)}
          archiwumWalk={archiwumWalk}
          isAdmin={isAdmin}
          talie={dane.talie||[]}
          posiadane={dane.posiadane||{}}
          duplikaty={dane.duplikaty||{}}
        />}
        {zakładka==="wynik"&&!isAdmin&&<div style={{textAlign:"center",padding:60,color:"#555"}}><div style={{fontSize:36}}>🔒</div><div style={{marginTop:12}}>Tylko admin może generować wymianę.</div></div>}
        {zakładka==="wynik"&&isAdmin&&<WynikView
          talie={typWymiany==="event" ? talieEventSorted : talieSorted}
          czlonkowie={czlonkowieTyp}
          posiadane={typWymiany==="event" ? (daneEvent?.posiadaneEvent||{}) : (dane.posiadane||{})}
          duplikaty={typWymiany==="event" ? (daneEvent?.duplikatyEvent||{}) : (dane.duplikaty||{})}
          typWymiany={typWymiany} wynik={wynik} setWynik={setWynik}
          trybWymiany={trybWymiany} setTrybWymiany={setTrybWymiany}
          zapiszAktywna={(w)=>zapiszStrukture("aktywnaWymiana",w)}
          przejdzDoAktywnej={()=>setZakładka("aktywna")}
          historiaWymian={historiaWymian}
          paczkiDiament={paczkiDiament} setPaczkiDiament={setPaczkiDiament}
        />}
        {zakładka==="wynikV3"&&isAdmin&&<WynikView
          wersja="v3"
          talie={typWymiany==="event" ? talieEventSorted : talieSorted}
          czlonkowie={czlonkowieTyp}
          posiadane={typWymiany==="event" ? (daneEvent?.posiadaneEvent||{}) : (dane.posiadane||{})}
          duplikaty={typWymiany==="event" ? (daneEvent?.duplikatyEvent||{}) : (dane.duplikaty||{})}
          typWymiany={typWymiany} wynik={wynikV3} setWynik={setWynikV3}
          trybWymiany={trybV3} setTrybWymiany={setTrybV3}
          zapiszAktywna={(w)=>zapiszStrukture("aktywnaWymiana",w)}
          przejdzDoAktywnej={()=>setZakładka("aktywna")}
          historiaWymian={historiaWymian}
          paczkiDiament={paczkiDiament} setPaczkiDiament={setPaczkiDiament}
        />}
        {zakładka==="edycja"&&isAdmin&&<EdycjaTalii
          talie={dane.talie} zapisz={(noweTalie)=>zapiszStrukture("talie",noweTalie)}
          talieEvent={daneEvent?.talieEvent||[]} zapiszEvent={(noweTalie)=>zapiszStrukturEvent("talieEvent",noweTalie)}
        />}
        {zakładka==="edycja_event"&&isAdmin&&<EdycjaTaliiEvent
          talieEvent={daneEvent?.talieEvent||[]}
          zapisz={(noweTalie)=>zapiszStrukturEvent("talieEvent",noweTalie)}
        />}
        {zakładka==="ocr"&&isAdmin&&<OcrView
          talie={talieSorted} czlonkowie={dane.czlonkowie}
          posiadane={dane.posiadane||{}} duplikaty={dane.duplikaty||{}}
          zapiszKarte={zapiszKarte}
        />}
        {zakładka==="czlonkowie"&&isAdmin&&<EdycjaCzlonkow
          czlonkowie={dane.czlonkowie} zapisz={(now)=>zapiszStrukture("czlonkowie",now)}
        />}
        {zakładka==="testy"&&isAdmin&&<TestyView
          zalogowany={zalogowany}
          historiaWymian={historiaWymian}
          statusOnline={statusOnline}
          talie={talieSorted} czlonkowie={dane.czlonkowie}
          posiadane={dane.posiadane||{}} duplikaty={dane.duplikaty||{}}
          zapiszKarte={zapiszKarte}
          zapiszStrukture={zapiszStrukture}
          aktywnaWymiana={dane.aktywnaWymiana}
          walki={dane.walki||[]}
          typWymiany={typWymiany}
          dane={dane}
          isAdmin={isAdmin}
          zablokowane={zablokowane}
          onZablokuj={async(fp,nick)=>{if(!window.confirm(`Zablokować urządzenie ${fp} (${nick})?`)) return; await zablokujUrządzenie(fp,nick,"Zablokowane z logów"); alert("✅ Zablokowano");}}
          onOdblokuj={async(fp)=>{if(!window.confirm(`Odblokować urządzenie ${fp}?`)) return; await odblokujUrządzenie(fp); alert("✅ Odblokowano");}}
          historiaPush={historiaPush}
          archiwumWalk={archiwumWalk}
        />}
      </div>
      </div>
      </div>{/* koniec scroll div */}
      {/* DOLNY PASEK - przyklejony na dole, scrolluje z treścią */}
      {wyglad.uklad==="bottom"&&(
        <nav style={{
          flexShrink:0,
          position:"sticky",
          bottom:0,
          zIndex:9999,
          display:"flex",
          overflowX:"auto",
          WebkitOverflowScrolling:"touch",
          background:"var(--bg)",
          borderTop:"2px solid var(--border)",
          boxShadow:"0 -4px 20px rgba(0,0,0,0.8)",
          padding:"6px 4px 14px",
          minHeight:64,
        }}>
            {tabs.map(t=>(
              <button key={t.id} onClick={()=>setZakładka(t.id)} style={{
                flexShrink:0,
                minWidth:64,
                flex:1,
                border:"none",
                background:zakładka===t.id?"var(--card)":"transparent",
                cursor:"pointer",
                display:"flex",
                flexDirection:"column",
                alignItems:"center",
                gap:3,
                padding:"6px 6px 4px",
                borderRadius:10,
                margin:"0 2px",
                transition:"background 0.15s",
              }}>
                <span style={{fontSize:24,lineHeight:1}}>{t.label.split(" ")[0]}</span>
                <span style={{
                  fontSize:10,
                  color:zakładka===t.id?"var(--accent)":"var(--muted)",
                  fontWeight:zakładka===t.id?"bold":"normal",
                  whiteSpace:"nowrap",
                }}>
                  {t.label.split(" ").slice(1).join(" ")}
                </span>
                {zakładka===t.id&&<div style={{
                  width:20,height:3,borderRadius:2,
                  background:"var(--accent)",
                  boxShadow:"0 0 6px var(--accent)",
                }}/>}
              </button>
            ))}
          </nav>
      )}
    </div>


  );
}

function LoadingScreen() {
  return (
    <div style={{minHeight:"100vh",background:"radial-gradient(ellipse at center,#0d0820 0%,#0a0a12 100%)",display:"flex",flexDirection:"column"}}>
      {/* Nagłówek */}
      <div style={{padding:"16px 16px 10px",borderBottom:"1px solid #1a1a2e"}}>
        <div style={{height:18,width:"60%",borderRadius:6,background:"linear-gradient(90deg,#1a1a2e 25%,#252540 50%,#1a1a2e 75%)",backgroundSize:"200% 100%",animation:"shimmer 1.5s infinite"}}/>
        <div style={{height:10,width:"35%",borderRadius:4,marginTop:8,background:"linear-gradient(90deg,#12122a 25%,#1e1e35 50%,#12122a 75%)",backgroundSize:"200% 100%",animation:"shimmer 1.5s infinite"}}/>
      </div>
      {/* Skeleton cards */}
      <div style={{padding:16,flex:1}}>
        {[1,2,3,4].map(i=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
            <div style={{width:40,height:40,borderRadius:"50%",flexShrink:0,background:"linear-gradient(90deg,#12122a 25%,#1e1e35 50%,#12122a 75%)",backgroundSize:"200% 100%",animation:`shimmer 1.5s infinite ${i*0.15}s`}}/>
            <div style={{flex:1}}>
              <div style={{height:13,width:`${55+i*8}%`,borderRadius:5,marginBottom:7,background:"linear-gradient(90deg,#12122a 25%,#1e1e35 50%,#12122a 75%)",backgroundSize:"200% 100%",animation:`shimmer 1.5s infinite ${i*0.15}s`}}/>
              <div style={{height:9,width:`${30+i*5}%`,borderRadius:4,background:"linear-gradient(90deg,#0e0e1e 25%,#181830 50%,#0e0e1e 75%)",backgroundSize:"200% 100%",animation:`shimmer 1.5s infinite ${i*0.15}s`}}/>
            </div>
          </div>
        ))}
        <div style={{height:80,borderRadius:10,marginBottom:10,background:"linear-gradient(90deg,#12122a 25%,#1e1e35 50%,#12122a 75%)",backgroundSize:"200% 100%",animation:"shimmer 1.5s infinite 0.3s"}}/>
        <div style={{height:80,borderRadius:10,background:"linear-gradient(90deg,#12122a 25%,#1e1e35 50%,#12122a 75%)",backgroundSize:"200% 100%",animation:"shimmer 1.5s infinite 0.45s"}}/>
      </div>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
    </div>
  );
}







function LoginScreen({onLogin, czlonkowie}) {
  const [krok, setKrok] = useState("nick"); // nick → pin / ustawPin
  const [login, setLogin] = useState("");
  const [haslo, setHaslo] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [blad, setBlad] = useState("");
  const [ladowanie, setLadowanie] = useState(false);
  const cytat = CYTATY[Math.floor(Date.now()/86400000)%CYTATY.length];
  const tip = TIPY[Math.floor(Date.now()/43200000)%TIPY.length];

  const zalogujAdmin = async () => {
    const fp = getFingerprint();
    const teraz = new Date().toISOString();
    setBlad(""); setLadowanie(true);
    let u = null;
    try {
      // Hasło jest sprawdzane na serwerze (api/admin-login.js) — nie ma go w kodzie aplikacji
      const r = await fetch("/api/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: login.trim().toLowerCase(), haslo }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) u = { login: d.login, rola: d.rola, adminKey: d.adminKey };
      else { setBlad(d.error || "Błędne hasło admina."); setLadowanie(false); return; }
    } catch (e) {
      setBlad("Brak połączenia z serwerem logowania."); setLadowanie(false); return;
    }
    setLadowanie(false);
    const zablok = await pobierzZablokowane();
    if (zablok.some(z => z.fp === fp)) { setBlad("🚫 Urządzenie zablokowane."); return; }
    const znane = await pobierzFingerprinty();
    const noweUrz = (znane[u.login]||[]).length > 0 && !(znane[u.login]||[]).includes(fp);
    await zapiszLog({ nick: u.login, rola: u.rola, czas: teraz, fp, typ: noweUrz?"login_nowe_urzadzenie":"login", noweUrzadzenie: noweUrz });
    await zapiszFingerprint(u.login, fp);
    onLogin(u);
  };

  const sprawdzNick = async () => {
    setBlad(""); setLadowanie(true);
    const oryginalny = czlonkowie.find(c => normalizuj(c.nazwa) === normalizuj(login.trim()));
    if (!oryginalny) { setBlad(`Nick "${login.trim()}" nie istnieje w gangu.`); setLadowanie(false); return; }
    const fp = getFingerprint();
    const zablokowane = await pobierzZablokowane();
    if (zablokowane.some(z => z.fp === fp)) { setBlad("🚫 Urządzenie zablokowane."); setLadowanie(false); return; }
    // Sprawdź czy ma PIN
    const hasPin = await maPin(oryginalny.nazwa);
    setLadowanie(false);
    if (hasPin) {
      setKrok("pin");
    } else {
      setKrok("ustawPin");
    }
  };

  const zalogujPinem = async () => {
    setBlad(""); setLadowanie(true);
    const oryginalny = czlonkowie.find(c => normalizuj(c.nazwa) === normalizuj(login.trim()));
    if (pin.length < 4) { setBlad("PIN musi mieć minimum 4 cyfry."); setLadowanie(false); return; }
    const ok = await sprawdzPin(oryginalny.nazwa, pin);
    if (!ok) { setBlad("❌ Błędny PIN. Spróbuj ponownie."); setLadowanie(false); return; }
    const fp = getFingerprint();
    const teraz = new Date().toISOString();
    const znane = await pobierzFingerprinty();
    const noweUrzadzenie = (znane[oryginalny.nazwa]||[]).length > 0 && !(znane[oryginalny.nazwa]||[]).includes(fp);
    await zapiszLog({ nick: oryginalny.nazwa, rola:"czlonek", czas:teraz, fp, typ: noweUrzadzenie?"login_nowe_urzadzenie":"login", noweUrzadzenie });
    await zapiszFingerprint(oryginalny.nazwa, fp);
    setLadowanie(false);
    onLogin({ login: oryginalny.nazwa, rola:"czlonek", noweUrzadzenie });
  };

  const ustawNowPin = async () => {
    setBlad("");
    if (pin.length < 4) { setBlad("PIN musi mieć minimum 4 cyfry."); return; }
    if (pin !== pin2) { setBlad("PINy się nie zgadzają."); return; }
    if (!/^\d+$/.test(pin)) { setBlad("PIN może zawierać tylko cyfry."); return; }
    setLadowanie(true);
    const oryginalny = czlonkowie.find(c => normalizuj(c.nazwa) === normalizuj(login.trim()));
    await zapiszPin(oryginalny.nazwa, pin);
    const fp = getFingerprint();
    const teraz = new Date().toISOString();
    await zapiszLog({ nick: oryginalny.nazwa, rola:"czlonek", czas:teraz, fp, typ:"pin_ustawiony" });
    await zapiszFingerprint(oryginalny.nazwa, fp);
    setLadowanie(false);
    onLogin({ login: oryginalny.nazwa, rola:"czlonek" });
  };

  const inputStyle = {width:"100%",padding:"12px 14px",background:"var(--card-solid)",border:"1px solid #333",borderRadius:8,color:"#fff",fontSize:16,boxSizing:"border-box",textAlign:"center",letterSpacing:2};
  const btnStyle = {width:"100%",padding:13,background:"linear-gradient(135deg,#b8860b,#ffd700)",border:"none",borderRadius:8,fontWeight:"bold",fontSize:15,cursor:"pointer",color:"#000"};

  return (
    <div style={{minHeight:"100vh",background:"radial-gradient(ellipse at 50% 30%,#130d2e 0%,#0a0a12 60%,#0d0a10 100%)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Georgia,serif",padding:20}}>
      <div style={{width:"100%",maxWidth:340,display:"flex",flexDirection:"column",gap:12}}>

        {/* Cytat */}
        <div style={{background:"rgba(0,0,0,0.5)",border:"1px solid rgba(184,134,11,0.2)",borderRadius:10,padding:"12px 16px",textAlign:"center"}}>
          <div style={{fontSize:11,color:"#b8860b",fontStyle:"italic",lineHeight:1.5}}>"{cytat}"</div>
        </div>

        {/* Panel */}
        <div style={{background:"linear-gradient(160deg,rgba(10,5,25,0.95),rgba(5,5,15,0.98))",border:"1px solid rgba(184,134,11,0.4)",borderRadius:16,padding:28,textAlign:"center",boxSizing:"border-box"}}>
          <div style={{fontSize:24,fontWeight:"bold",letterSpacing:4,marginBottom:2,background:"linear-gradient(180deg,#fff8dc,#ffd700,#b8860b)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>⚔ FAMILY ⚔</div>
          <div style={{fontSize:10,color:"#444",marginBottom:20,letterSpacing:3}}>MENADŻER WYMIAN KART</div>

          {/* KROK 1: wpisz nick */}
          {krok==="nick"&&(
            <>
              <input value={login} onChange={e=>setLogin(e.target.value)} placeholder="Twój nick"
                onKeyDown={e=>e.key==="Enter"&&(haslo?zalogujAdmin():sprawdzNick())}
                style={{...inputStyle,marginBottom:10,letterSpacing:1}}/>
              <input value={haslo} onChange={e=>setHaslo(e.target.value)} type="password"
                placeholder="Hasło admina (tylko admin)"
                onKeyDown={e=>e.key==="Enter"&&zalogujAdmin()}
                style={{...inputStyle,marginBottom:10}}/>
              {blad&&<div style={{color:"#f55",fontSize:12,marginBottom:10}}>{blad}</div>}
              <button onClick={haslo?zalogujAdmin:sprawdzNick} disabled={ladowanie}
                style={{...btnStyle,opacity:ladowanie?0.6:1}}>
                {ladowanie?"⏳ Sprawdzam...":"Dalej →"}
              </button>
              <div style={{fontSize:10,color:"#444",marginTop:12}}>Członek: wpisz nick i kliknij Dalej<br/>Admin: nick + hasło</div>
            </>
          )}

          {/* KROK 2a: wpisz PIN */}
          {krok==="pin"&&(
            <>
              <div style={{fontSize:13,color:"var(--accent)",marginBottom:16}}>👤 {login}</div>
              <div style={{fontSize:12,color:"#aaa",marginBottom:10}}>🔐 Wpisz swój PIN</div>
              <input value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,""))}
                type="password" inputMode="numeric" placeholder="••••"
                maxLength={8}
                onKeyDown={e=>e.key==="Enter"&&zalogujPinem()}
                style={{...inputStyle,marginBottom:10,fontSize:24,letterSpacing:8}}/>
              {blad&&<div style={{color:"#f55",fontSize:12,marginBottom:10}}>{blad}</div>}
              <button onClick={zalogujPinem} disabled={ladowanie} style={{...btnStyle,marginBottom:8,opacity:ladowanie?0.6:1}}>
                {ladowanie?"⏳ Sprawdzam...":"Wejdź 💪"}
              </button>
              <button onClick={()=>{setKrok("nick");setPin("");setBlad("");}}
                style={{background:"none",border:"none",color:"#555",fontSize:11,cursor:"pointer"}}>
                ← Zmień nick
              </button>
              <div style={{fontSize:10,color:"#444",marginTop:8}}>Zapomniałeś PINu? Zgłoś się do admina.</div>
            </>
          )}

          {/* KROK 2b: ustaw nowy PIN */}
          {krok==="ustawPin"&&(
            <>
              <div style={{fontSize:13,color:"var(--accent)",marginBottom:8}}>👤 {login}</div>
              <div style={{fontSize:12,color:"#0c6",marginBottom:4}}>🔐 Pierwsze logowanie — ustaw swój PIN</div>
              <div style={{fontSize:10,color:"#555",marginBottom:14}}>PIN będzie wymagany przy każdym logowaniu.<br/>Zapamiętaj go!</div>
              <input value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,""))}
                type="password" inputMode="numeric" placeholder="Wpisz PIN (4-8 cyfr)"
                maxLength={8}
                style={{...inputStyle,marginBottom:8}}/>
              <input value={pin2} onChange={e=>setPin2(e.target.value.replace(/\D/g,""))}
                type="password" inputMode="numeric" placeholder="Powtórz PIN"
                maxLength={8}
                onKeyDown={e=>e.key==="Enter"&&ustawNowPin()}
                style={{...inputStyle,marginBottom:10}}/>
              {blad&&<div style={{color:"#f55",fontSize:12,marginBottom:10}}>{blad}</div>}
              <button onClick={ustawNowPin} disabled={ladowanie} style={{...btnStyle,opacity:ladowanie?0.6:1}}>
                {ladowanie?"⏳ Zapisuję...":"Ustaw PIN i wejdź 💪"}
              </button>
            </>
          )}
        </div>

        <div style={{background:"rgba(0,0,0,0.3)",border:"1px solid var(--border)",borderRadius:8,padding:"10px 14px",textAlign:"center"}}>
          <div style={{fontSize:11,color:"var(--muted)",lineHeight:1.5}}>{tip}</div>
        </div>
      </div>
    </div>
  );
}


function WygladView({ wyglad, setWyglad, motyw }) {
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 16, fontWeight: "bold", color: "var(--accent)", marginBottom: 4 }}>⚙️ Wygląd aplikacji</div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 20 }}>Personalizacja widoczna tylko dla Ciebie — zapisuje się automatycznie.</div>

      {/* MOTYWY */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: "bold", color: motyw.mutedLight, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>🎨 Motyw kolorystyczny</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {Object.entries(MOTYWY).map(([id, m]) => (
            <button key={id} onClick={() => setWyglad({ motyw: id })} style={{
              padding: "12px 10px", borderRadius: 10, cursor: "pointer", textAlign: "left",
              background: wyglad.motyw === id ? `${m.accent}22` : `${m.bg}cc`,
              border: `2px solid ${wyglad.motyw === id ? m.accent : m.border}`,
              transition: "all 0.2s",
            }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>{m.emoji}</div>
              <div style={{ fontSize: 12, fontWeight: "bold", color: m.accent }}>{m.nazwa}</div>
              <div style={{ display: "flex", gap: 3, marginTop: 6 }}>
                {[m.bg, m.accent, m.accent2, m.text].map((c,i) => (
                  <div key={i} style={{ width: 16, height: 16, borderRadius: 4, background: c, border: "1px solid rgba(255,255,255,0.15)" }}/>
                ))}
              </div>
              {wyglad.motyw === id && <div style={{ fontSize: 9, color: m.accent, marginTop: 4 }}>✓ aktywny</div>}
            </button>
          ))}
        </div>
      </div>

      {/* UKŁADY NAWIGACJI */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: "bold", color: motyw.mutedLight, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>📐 Układ nawigacji</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            {id:"top",    icon:"📱", nazwa:"Zakładki na górze",  opis:"Poziomy pasek przewijany — klasyczny układ"},
            {id:"bottom", icon:"⬇️", nazwa:"Pasek na dole",      opis:"Główne zakładki przy kciuku — jak Instagram"},
          ].map(({id,icon,nazwa,opis}) => (
            <button key={id} onClick={() => setWyglad({ uklad: id })} style={{
              padding: "10px 14px", borderRadius: 8, cursor: "pointer", textAlign: "left",
              background: wyglad.uklad === id ? "var(--card)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${wyglad.uklad === id ? "var(--accent)" : "var(--border)"}`,
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <span style={{ fontSize: 22 }}>{icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: "bold", color: wyglad.uklad === id ? "var(--accent)" : "var(--text)" }}>{nazwa}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{opis}</div>
              </div>
              {wyglad.uklad === id && <span style={{ color: "var(--accent)", fontSize: 16 }}>✓</span>}
            </button>
          ))}
        </div>
      </div>

      {/* ROZMIAR CZCIONKI */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: "bold", color: motyw.mutedLight, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>🔤 Rozmiar tekstu</div>
        <div style={{ display: "flex", gap: 8 }}>
          {Object.entries(ROZMIARY).map(([id, size]) => (
            <button key={id} onClick={() => setWyglad({ rozmiar: id })} style={{
              flex: 1, padding: "12px 8px", borderRadius: 8, cursor: "pointer",
              background: wyglad.rozmiar === id ? "var(--card)" : "var(--card)",
              border: `1px solid ${wyglad.rozmiar === id ? "var(--accent)" : "var(--border)"}`,
              color: wyglad.rozmiar === id ? "var(--accent)" : "var(--muted)",
              fontSize: size, fontWeight: "bold",
            }}>
              {id === "mały" ? "Aa" : id === "normalny" ? "Aa" : "Aa"}
              <div style={{ fontSize: 9, marginTop: 2, fontWeight: "normal" }}>{id}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Reset */}
      <button onClick={() => setWyglad({ motyw: "gold", uklad: "top", rozmiar: "normalny" })} style={{
        width: "100%", padding: 10, borderRadius: 8, cursor: "pointer",
        background: "rgba(255,50,50,0.08)", border: "1px solid rgba(255,50,50,0.2)",
        color: "#f5544488", fontSize: 11,
      }}>↺ Przywróć domyślny wygląd (Gold & Black)</button>
    </div>
  );
}

function DaneView({talie,czlonkowie,czlonkowieOryg,typWymiany,posiadane,duplikaty,zapiszKarte,zalogowany,zapiszStrukture}) {
  const isAdmin = zalogowany.rola==="admin"||zalogowany.rola==="zastepca";
  const swojaOsoba = czlonkowie.find(c=>normalizuj(c.nazwa)===normalizuj(zalogowany.login));
  const startIdx = swojaOsoba && !isAdmin ? czlonkowie.indexOf(swojaOsoba) : 0;
  const [wybranaOsoba,setWybranaOsoba]=useState(startIdx);
  const [filtrTyp,setFiltrTyp]=useState("wszystkie"); // wszystkie / złote / diamentowe
  const [tooltip,setTooltip]=useState(null);
  const [pokazProfil,setPokazProfil]=useState(null);

  const toggleKarta=(osobaId,taliaId,kartaNazwa,tryb)=>{
    const key=`${osobaId}_${taliaId}_${kartaNazwa}`;
    if(tryb==="posiadane"){
      if(posiadane[key]){
        zapiszKarte("posiadane", key, null);
        if(duplikaty[key]) zapiszKarte("duplikaty", key, null);
      } else {
        zapiszKarte("posiadane", key, true);
      }
    } else {
      if(duplikaty[key]) zapiszKarte("duplikaty", key, null);
      else zapiszKarte("duplikaty", key, true);
    }
  };

  const osoba=czlonkowie[wybranaOsoba];
  const mozeEdytowac = isAdmin;

  return (
    <div>
      {/* Filtry typów */}
      <div style={{display:"flex",gap:6,marginBottom:10}}>
        {[
          {id:"wszystkie",label:"🃏 Wszystkie"},
          {id:"złote",label:"⭐ Złote"},
          {id:"diamentowe",label:"💎 Diamentowe"},
        ].map(f=>(
          <button key={f.id} onClick={()=>setFiltrTyp(f.id)} style={{
            padding:"5px 12px",borderRadius:6,cursor:"pointer",fontSize:12,
            background:filtrTyp===f.id?"rgba(255,215,0,0.15)":"var(--card)",
            border:filtrTyp===f.id?"1px solid #ffd700":"1px solid var(--border)",
            color:filtrTyp===f.id?"var(--accent)":"var(--muted)",
          }}>{f.label}</button>
        ))}
        {!isAdmin && <span style={{fontSize:11,color:"#555",alignSelf:"center",marginLeft:4}}>🔒 tylko podgląd</span>}
      </div>

      {/* Lista członków */}
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
        {czlonkowie.map((c,i)=>{
          const swoja = swojaOsoba && c.id===swojaOsoba.id;
          return (
            <button key={c.id}
            onClick={()=>setWybranaOsoba(i)}
            onDoubleClick={()=>setPokazProfil(c.id)}
            title="Kliknij 2x żeby zobaczyć profil"
            style={{
              padding:"5px 10px",borderRadius:6,cursor:"pointer",fontSize:12,
              background:wybranaOsoba===i?"linear-gradient(135deg,#b8860b,#ffd700)":swoja?"rgba(0,200,100,0.15)":"rgba(255,255,255,0.07)",
              border:wybranaOsoba===i?"none":swoja?"1px solid #0c655":"1px solid var(--border)",
              color:wybranaOsoba===i?"#000":swoja?"#0c6":"#aaa",fontWeight:wybranaOsoba===i?"bold":"normal",
            }}>{swoja?"⭐ ":""}{c.nazwa}</button>
          );
        })}
      </div>

      {osoba&&(
        <div style={{background:"rgba(0,0,0,0.2)",border:"1px solid var(--border)",borderRadius:10,padding:14}}>
          <div style={{fontSize:15,fontWeight:"bold",color:"var(--accent)",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
            <span>✏️ {osoba.nazwa}</span>
            {!mozeEdytowac && <span style={{fontSize:11,color:"#f55",fontWeight:"normal"}}>🔒 tylko podgląd</span>}
          </div>
          <OsiagnieciaWidget talie={talie} czlonkowie={czlonkowie} posiadane={posiadane} duplikaty={duplikaty} zalogowany={zalogowany}/>
          {talie.map(talia=>{
            // Filtruj karty wg wybranego typu
            const kartyAll = talia.karty.filter(k=>
              filtrTyp==="wszystkie" ? true :
              filtrTyp==="złote" ? k.typ==="złota" : k.typ==="diamentowa"
            );
            if(!kartyAll.length) return null;

            const kartyZlote = kartyAll.filter(k=>k.typ==="złota");
            const kartyDia = kartyAll.filter(k=>k.typ==="diamentowa");
            const posC = kartyAll.filter(k=>posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]).length;
            const dupC = kartyAll.filter(k=>duplikaty[`${osoba.id}_${talia.id}_${k.nazwa}`]).length;
            const brak = kartyAll.length - posC;
            const trudna = TRUDNE_NUMERY.includes(talia.numer);

            const renderKarty=(karty)=>(
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                {karty.map(karta=>{
                  const key=`${osoba.id}_${talia.id}_${karta.nazwa}`;
                  const ma=posiadane[key]; const dup=duplikaty[key];
                  return (
                    <div key={karta.nazwa} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                      <button
                        onClick={mozeEdytowac?(e)=>{
                          toggleKarta(osoba.id,talia.id,karta.nazwa,"posiadane");
                          if(navigator.vibrate) navigator.vibrate(30);
                          const btn=e.currentTarget;
                          btn.style.transform="scale(1.15)";
                          setTimeout(()=>{btn.style.transform="scale(1)";},150);
                        }:undefined}
                        onMouseEnter={(e)=>{
                          if(ma) return;
                          const dawcy=czlonkowie.filter(c=>c.id!==osoba.id&&duplikaty[`${c.id}_${talia.id}_${karta.nazwa}`]).map(c=>c.nazwa);
                          setTooltip({kartaNazwa:karta.nazwa,dawcy,x:e.clientX,y:e.clientY});
                        }}
                        onMouseMove={(e)=>{
                          if(!ma) setTooltip(p=>p?{...p,x:e.clientX,y:e.clientY}:null);
                        }}
                        onMouseLeave={()=>setTooltip(null)}

                        style={{
                          padding:"3px 7px",fontSize:10,borderRadius:5,cursor:mozeEdytowac?"pointer":"not-allowed",
                          maxWidth:90,textAlign:"center",lineHeight:1.2,
                          transition:"transform 0.15s ease, background 0.15s",
                          background:ma?(karta.typ==="złota"?"linear-gradient(135deg,#b8860b,#ffd700)":"linear-gradient(135deg,#1a3a8f,#87CEEB)"):"var(--card)",
                          border:ma?"none":(!ma&&czlonkowie.some(c=>c.id!==osoba.id&&duplikaty[`${c.id}_${talia.id}_${karta.nazwa}`]))?"1px solid #0c633":"1px solid var(--border)",
                          color:ma?(karta.typ==="złota"?"#000":"#fff"):"#444",
                          fontWeight:ma?"bold":"normal",opacity:mozeEdytowac?1:0.7,
                        }}>{karta.nazwa}</button>
                      {ma&&<button disabled={!mozeEdytowac} onClick={()=>toggleKarta(osoba.id,talia.id,karta.nazwa,"duplikat")} style={{
                        padding:"1px 6px",fontSize:9,borderRadius:4,cursor:mozeEdytowac?"pointer":"not-allowed",
                        background:dup?"linear-gradient(135deg,#4169E1,#87CEEB)":"rgba(65,105,225,0.1)",
                        border:dup?"none":"1px dashed #4169E155",color:dup?"#fff":"#4169E1",opacity:mozeEdytowac?1:0.7,
                      }}>{dup?"💎dup":"+dup"}</button>}
                    </div>
                  );
                })}
              </div>
            );

            // Kolor ramki: zamknięta=zielona, blisko=pomarańczowa, reszta=kolor motywu
            const taliaAkcentKolor = brak===0?"#0c6":brak<=2?"#fa0":"var(--accent)";
            const taliaBgGrad = brak===0
              ? "linear-gradient(135deg,rgba(0,200,100,0.08) 0%,transparent 60%)"
              : brak<=2
              ? "linear-gradient(135deg,rgba(255,165,0,0.07) 0%,transparent 60%)"
              : "linear-gradient(135deg,var(--card) 0%,transparent 70%)";

            return (
              <div key={talia.id} className="gang-talia-card" style={{
                marginBottom:10,borderRadius:10,padding:"10px 12px",
                background:taliaBgGrad,
                border:`1px solid ${brak===0?"#0c655":brak<=2?"#fa040":"var(--border)"}`,
                borderTop:`2px solid ${taliaAkcentKolor}`,
                boxShadow:`0 2px 12px rgba(0,0,0,0.3), inset 0 0 30px ${brak===0?"rgba(0,200,100,0.03)":brak<=2?"rgba(255,165,0,0.03)":"var(--card)"}`,
                position:"relative",overflow:"hidden",
              }}>
              <div style={{
                position:"absolute",top:0,left:0,right:0,height:1,
                background:`linear-gradient(90deg,transparent,${taliaAkcentKolor}88,transparent)`,
                pointerEvents:"none",
              }}/>
                {/* Nagłówek talii */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,flexWrap:"wrap",gap:4}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    <span style={{fontSize:10,background:trudna?"rgba(255,50,50,0.18)":"rgba(255,215,0,0.1)",border:`1px solid ${trudna?"#f55":"#b8860b"}`,borderRadius:4,padding:"1px 5px",color:trudna?"#f55":"#b8860b"}}>#{talia.numer}</span>
                    <span style={{fontWeight:"bold",fontSize:13}}>{talia.nazwa}</span>
                    <span style={{fontSize:11,color:"var(--muted)"}}>🎯{talia.nagroda_amunicja?.toLocaleString()}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <div style={{fontSize:12}}>
                      <span style={{color:brak===0?"#0c6":"var(--accent)"}}>{posC}/{kartyAll.length}</span>
                      {dupC>0&&<span style={{color:"#87CEEB",marginLeft:6}}>+{dupC}dup</span>}
                      {brak===0&&<span style={{color:"#0c6",marginLeft:8}}>✓</span>}
                      {brak>0&&brak<=2&&<span style={{color:"#fa0",marginLeft:8}}>⚡{brak} brak</span>}
                    </div>
                    {mozeEdytowac&&(
                      <div style={{display:"flex",gap:4}}>
                        <button onClick={()=>{
                          if(!window.confirm(`Oznaczyć WSZYSTKIE karty talii "${talia.nazwa}" jako posiadane + duplikaty?`)) return;
                          talia.karty.forEach(k=>{
                            const key=`${osoba.id}_${talia.id}_${k.nazwa}`;
                            if(!posiadane[key]) zapiszKarte("posiadane", key, true);
                            if(!duplikaty[key]) zapiszKarte("duplikaty", key, true);
                          });
                        }} style={{
                          padding:"2px 8px",fontSize:10,borderRadius:5,cursor:"pointer",
                          background:"rgba(0,200,100,0.12)",border:"1px solid #0c644",
                          color:"#0c6",whiteSpace:"nowrap",
                        }}>⚡ Uzupełnij</button>
                        <button onClick={()=>{
                          if(!window.confirm(`Usunąć WSZYSTKIE karty talii "${talia.nazwa}"?`)) return;
                          talia.karty.forEach(k=>{
                            const key=`${osoba.id}_${talia.id}_${k.nazwa}`;
                            if(posiadane[key]) zapiszKarte("posiadane", key, null);
                            if(duplikaty[key]) zapiszKarte("duplikaty", key, null);
                          });
                        }} style={{
                          padding:"2px 8px",fontSize:10,borderRadius:5,cursor:"pointer",
                          background:"rgba(255,50,50,0.1)",border:"1px solid #f5544433",
                          color:"#f55",whiteSpace:"nowrap",
                        }}>🗑 Usuń</button>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{height:3,background:"var(--card-solid)",borderRadius:2,marginBottom:8}}>
                  <div style={{height:"100%",width:`${kartyAll.length?(posC/kartyAll.length)*100:0}%`,background:brak===0?"#0c6":"linear-gradient(90deg,#b8860b,#ffd700)",borderRadius:2}}/>
                </div>

                {/* Złote karty */}
                {kartyZlote.length>0&&(
                  <div style={{marginBottom:kartyDia.length>0?8:0}}>
                    {filtrTyp==="wszystkie"&&<div style={{fontSize:10,color:"#b8860b",marginBottom:4}}>⭐ Złote</div>}
                    {renderKarty(kartyZlote)}
                  </div>
                )}

                {/* Separator jeśli oba typy */}
                {kartyZlote.length>0&&kartyDia.length>0&&(
                  <div style={{borderTop:"1px solid #1a1a2e",marginBottom:8}}/>
                )}

                {/* Diamentowe karty */}
                {kartyDia.length>0&&(
                  <div>
                    {filtrTyp==="wszystkie"&&<div style={{fontSize:10,color:"#87CEEB",marginBottom:4}}>💎 Diamentowe</div>}
                    {renderKarty(kartyDia)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* Modal profilu gracza */}
      {pokazProfil&&(()=>{
        const os=czlonkowie.find(c=>c.id===pokazProfil);
        if(!os) return null;
        const zamkniete=talie.filter(t=>t.karty.length>0&&t.karty.every(k=>posiadane[`${os.id}_${t.id}_${k.nazwa}`]));
        const totalKarty=talie.reduce((s,t)=>s+t.karty.length,0);
        const posKarty=talie.reduce((s,t)=>s+t.karty.filter(k=>posiadane[`${os.id}_${t.id}_${k.nazwa}`]).length,0);
        const dupCount=talie.reduce((s,t)=>s+t.karty.filter(k=>duplikaty[`${os.id}_${t.id}_${k.nazwa}`]).length,0);
        const ammo=zamkniete.reduce((s,t)=>s+pobierzNagrode(t,os.krag||1),0);
        const pct=totalKarty?Math.round((posKarty/totalKarty)*100):0;
        const krag=os.krag||1;
        return (
          <div onClick={()=>setPokazProfil(null)} style={{
            position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:9998,
            display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)",
          }}>
            <div onClick={e=>e.stopPropagation()} style={{
              background:"linear-gradient(160deg,#0a0518,#150a2e)",
              border:"1px solid rgba(184,134,11,0.5)",borderRadius:16,padding:24,
              width:"100%",maxWidth:360,
              boxShadow:"0 0 60px rgba(184,134,11,0.2)",
              animation:"bounceIn 0.3s ease",
            }}>
              {/* Nagłówek */}
              <div style={{textAlign:"center",marginBottom:20}}>
                <div style={{
                  width:64,height:64,borderRadius:"50%",margin:"0 auto 10px",
                  background:"linear-gradient(135deg,#b8860b,#ffd700)",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:28,fontWeight:"bold",color:"#000",
                  boxShadow:"0 0 20px rgba(255,215,0,0.4)",
                }}>
                  {os.nazwa[0]?.toUpperCase()}
                </div>
                <div style={{fontSize:20,fontWeight:"bold",color:"var(--accent)",letterSpacing:1}}>{os.nazwa}</div>
                {isAdmin && zapiszStrukture ? (
                  <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginTop:6}}>
                    <span style={{fontSize:11,color:"#da70d6"}}>{typWymiany==="event"?"🎉 Krąg eventu:":"💜 Krąg:"}</span>
                    {(typWymiany==="event"?[1,2,3]:[1,2,3,4,5]).map(k=>(
                      <button key={k} onClick={()=>{
                        // zapisujemy zawsze na ORYGINALNEJ liście członków (w evencie zmieniamy tylko kragEvent)
                        const nowyList = (czlonkowieOryg||czlonkowie).map(c=>c.id===os.id?(typWymiany==="event"?{...c,kragEvent:k}:{...c,krag:k}):c);
                        zapiszStrukture("czlonkowie", nowyList);
                      }} style={{
                        padding:"2px 10px",borderRadius:10,cursor:"pointer",fontSize:12,fontWeight:"bold",
                        background:krag===k?"rgba(138,43,226,0.35)":"rgba(255,255,255,0.05)",
                        border:krag===k?"1px solid #da70d6":"1px solid #333",
                        color:krag===k?"#da70d6":"#555",
                      }}>{k}</button>
                    ))}
                  </div>
                ) : (
                  krag>1&&<div style={{fontSize:11,color:"#da70d6",marginTop:2}}>💜 Krąg {krag}</div>
                )}
              </div>

              {/* Pasek postępu */}
              <div style={{marginBottom:16}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--muted)",marginBottom:4}}>
                  <span>Postęp kolekcji</span>
                  <span style={{color:"var(--accent)",fontWeight:"bold"}}>{pct}%</span>
                </div>
                <div style={{height:8,background:"var(--card-solid)",borderRadius:4,overflow:"hidden"}}>
                  <div style={{
                    height:"100%",width:`${pct}%`,borderRadius:4,
                    background:"linear-gradient(90deg,#b8860b,#ffd700)",
                    transition:"width 1s ease",
                  }}/>
                </div>
              </div>

              {/* Statystyki */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
                {[
                  {label:"Kart zebranych",val:`${posKarty}/${totalKarty}`,color:"var(--accent)"},
                  {label:"Talie zamknięte",val:`${zamkniete.length}/${talie.length}`,color:"#0c6"},
                  {label:"Duplikaty",val:dupCount,color:"#87CEEB"},
                  {label:"Amunicja zdobyta",val:ammo.toLocaleString()+" 💰",color:"#fa0"},
                ].map(s=>(
                  <div key={s.label} style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 12px",textAlign:"center"}}>
                    <div style={{fontSize:16,fontWeight:"bold",color:s.color}}>{s.val}</div>
                    <div style={{fontSize:10,color:"#555",marginTop:2}}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Osiągnięcia */}
              <div style={{marginBottom:16}}>
                <div style={{fontSize:11,color:"var(--muted)",marginBottom:6}}>🏆 Osiągnięcia:</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {zamkniete.length>=10&&<span style={{fontSize:10,padding:"2px 8px",background:"rgba(255,215,0,0.15)",border:"1px solid #b8860b55",borderRadius:10,color:"var(--accent)"}}>👑 Mega Kolekcjoner</span>}
                  {zamkniete.length>=5&&<span style={{fontSize:10,padding:"2px 8px",background:"rgba(255,215,0,0.1)",border:"1px solid #b8860b33",borderRadius:10,color:"var(--accent)"}}>🏆 Kolekcjoner</span>}
                  {dupCount>=10&&<span style={{fontSize:10,padding:"2px 8px",background:"rgba(135,206,235,0.1)",border:"1px solid #87CEEB33",borderRadius:10,color:"#87CEEB"}}>📦 Magazynier</span>}
                  {pct>=90&&<span style={{fontSize:10,padding:"2px 8px",background:"rgba(0,200,100,0.1)",border:"1px solid #0c633",borderRadius:10,color:"#0c6"}}>💎 Perfekcjonista</span>}
                  {zamkniete.length===0&&posKarty===0&&<span style={{fontSize:10,padding:"2px 8px",background:"rgba(255,50,50,0.1)",border:"1px solid #f5544433",borderRadius:10,color:"#f55"}}>🐣 Nowicjusz</span>}
                </div>
              </div>

              <button onClick={()=>setPokazProfil(null)} style={{
                width:"100%",padding:10,background:"rgba(255,215,0,0.1)",
                border:"1px solid #b8860b55",borderRadius:8,color:"var(--accent)",
                cursor:"pointer",fontSize:12,
              }}>Zamknij</button>
            </div>
          </div>
        );
      })()}

      {tooltip && createPortal(
        <div style={{
          position:"fixed",
          left:Math.min(tooltip.x+14, window.innerWidth-220),
          top:Math.min(tooltip.y+14, window.innerHeight-150),
          zIndex:2147483647,
          pointerEvents:"none",
          background:"#0a0518",
          border:"1px solid #ffd700",
          borderRadius:8,
          padding:"8px 12px",
          boxShadow:"0 4px 20px rgba(0,0,0,0.9)",
          minWidth:150,
          maxWidth:210,
          fontFamily:"Georgia,serif",
        }}>
          <div style={{fontSize:11,color:"var(--accent)",fontWeight:"bold",marginBottom:3}}>💎 Kto ma duplikat:</div>
          <div style={{fontSize:10,color:"#555",marginBottom:4,fontStyle:"italic"}}>{tooltip.kartaNazwa}</div>
          {tooltip.dawcy.length===0
            ?<div style={{fontSize:11,color:"var(--muted)"}}>Nikt nie ma duplikatu</div>
            :tooltip.dawcy.map(d=><div key={d} style={{fontSize:12,color:"#0c6",padding:"1px 0"}}>✓ {d}</div>)
          }
        </div>,
        document.body
      )}
    </div>
  );
}




// ═══ Obliczanie wymian w Web Workerze (public/algorytmWorker.js + public/algorytmy.js) ═══
// Algorytmy V1/V3 nie są już w tym pliku — liczą się w tle, więc ekran nie zamarza.
const ALG_WERSJA = "20261020";
let _algWorker = null;
let _algKod = null;

function policzNaGlownymWatku(wersja, parametry) {
  const pobierz = _algKod
    ? Promise.resolve(_algKod)
    : fetch("/algorytmy.js?v=" + ALG_WERSJA).then(r => {
        if (!r.ok) throw new Error("Nie można pobrać algorytmów (/algorytmy.js)");
        return r.text();
      }).then(t => { _algKod = t; return t; });
  return pobierz.then(kod => {
    // eslint-disable-next-line no-new-func
    const A = new Function(kod + "\nreturn { generujAlgorytm, generujAlgorytmV3 };")();
    if (wersja === "v3") {
      const v1 = A.generujAlgorytm(parametry);
      return { ...A.generujAlgorytmV3(parametry), v1 };
    }
    return A.generujAlgorytm(parametry);
  });
}

function policzWymiane(wersja, parametry) {
  return new Promise((resolve, reject) => {
    let skonczone = false;
    const koniec = (fn, arg) => { if (skonczone) return; skonczone = true; clearTimeout(zegar); fn(arg); };
    const awaryjnie = () => policzNaGlownymWatku(wersja, parametry).then(w => koniec(resolve, w)).catch(e => koniec(reject, e));
    const zegar = setTimeout(() => koniec(reject, new Error("Przekroczono czas obliczeń (90 s)")), 90000);
    try {
      if (!_algWorker) _algWorker = new Worker("/algorytmWorker.js");
      const w = _algWorker;
      const id = Date.now() + Math.random();
      const naWiadomosc = (e) => {
        if (!e.data || e.data.id !== id) return;
        w.removeEventListener("message", naWiadomosc);
        w.removeEventListener("error", naBlad);
        if (e.data.ok) koniec(resolve, e.data.wynik);
        else koniec(reject, new Error(e.data.error));
      };
      const naBlad = () => {
        w.removeEventListener("message", naWiadomosc);
        w.removeEventListener("error", naBlad);
        _algWorker = null;
        awaryjnie();
      };
      w.addEventListener("message", naWiadomosc);
      w.addEventListener("error", naBlad);
      w.postMessage({ id, wersja, parametry });
    } catch (e) {
      _algWorker = null;
      awaryjnie();
    }
  });
}

function obliczFaze(brakT, brakO, typWymiany) {
  // Priorytet dynamiczny: im mniej brakuje łącznie tym wyższy priorytet
  // Format: brakT * 10 + brakO → np. 1+0=10, 1+1=11, 2+0=20, 2+1=21 itd.
  // Fazy specjalne dla diamentowych gdzie brakO=0 i brakT=2 → 2 osoby wyślą po 1 karcie
  if (brakT === 0) return 0; // już ma wszystkie
  return brakT * 10 + brakO;
}

function opisFazy(faza, typWymiany) {
  const isDiament = typWymiany === "diamentowe" || typWymiany === "event";
  const isEvent = typWymiany === "event";
  const brakT = Math.floor(faza / 10);
  const brakO = faza % 10;
  const typT = isDiament ? "💎" : "⭐";
  const typO = isDiament ? "⭐" : "💎";

  if (brakT === 1 && brakO === 0) return {
    t: isEvent
      ? `🔴 FAZA 1 — ZAMKNIE TALIĘ! Brakuje 1 ${typT}`
      : `🔴 FAZA 1 — ZAMKNIE TALIĘ! Brakuje 1 ${typT} + komplet ${typO}`, k: "#f55"
  };
  if (brakT === 2 && brakO === 0) return {
    t: isEvent
      ? `🟠 FAZA 2 — Brakuje 2 ${typT} → 2 wymiany do zamknięcia`
      : isDiament
        ? `🟠 FAZA 2 — Brakuje 2 ${typT} + komplet ${typO} → 2 osoby wyślą po 1 ${typT} = ZAMKNIE TALIĘ`
        : `🟠 FAZA 2 — Brakuje 2 ${typT} + komplet ${typO} → 2 wymiany do zamknięcia`,
    k: "#ff7a00"
  };
  if (brakT === 1 && brakO === 1) return {
    t: isEvent
      ? `🟡 FAZA 3 — Brakuje 1 ${typT}`
      : isDiament
        ? `💎 FAZA 3 — Brakuje 1 ${typT} + 1 ${typO} → wyślij ${typT} teraz, ${typO} w następnej wymianie`
        : `🟡 FAZA 3 — Brakuje 1 ${typT} + 1 ${typO}`,
    k: isDiament && !isEvent ? "#ff4488" : "#fa0"
  };

  // Generyczne etykiety dla pozostałych faz
  const kolorFazy = brakT <= 2 ? "#fa0" : brakT <= 3 ? "#d4b800" : "#6af";
  const nrFazy = brakT === 1 ? (brakO + 2) : brakT === 2 ? (brakO + 4) : brakT === 3 ? (brakO + 6) : (brakT * 2 + brakO);
  return {
    t: isEvent
      ? `FAZA ${nrFazy} — Brakuje ${brakT} ${typT}`
      : `FAZA ${nrFazy} — Brakuje ${brakT} ${typT} + ${brakO} ${typO}`,
    k: kolorFazy
  };
}

// Porównanie wyniku V1 i V3 (te same ustawienia, te same dane)
function metrykiWyniku(w) {
  const zam = w.zamknieciaInfo || [];
  const kasaTalie = zam.reduce((s, z) => s + (z.nagroda || 0), 0);
  const zal = new Set();
  let kasaProgi = 0;
  zam.filter(z => z.nowyProg).forEach(z => {
    const k = `${z.osoba}_${z.nowyProg.prog}`;
    if (zal.has(k)) return;
    zal.add(k); kasaProgi += z.nowyProg.ammo || 0;
  });
  return { wymian: w.planoweWymiany.length, zamkniec: zam.length, kasaTalie, kasaProgi, razem: kasaTalie + kasaProgi, bezDawcy: (w.nieobsluzone || []).length };
}

function PorownanieV1V3({ v1, v3 }) {
  const m1 = metrykiWyniku(v1), m3 = metrykiWyniku(v3);
  const wiersze = [
    ["Wymian", m1.wymian, m3.wymian, true],
    ["Zamkniętych talii", m1.zamkniec, m3.zamkniec, true],
    ["💰 z talii", m1.kasaTalie, m3.kasaTalie, true],
    ["💰 z progów", m1.kasaProgi, m3.kasaProgi, true],
    ["💰 RAZEM", m1.razem, m3.razem, true],
    ["Bez dawcy", m1.bezDawcy, m3.bezDawcy, false],
  ];
  const klucz = e => `${e.do}|${e.talia}|${e.karta}`;
  const mapa1 = {}; v1.planoweWymiany.forEach(e => { mapa1[klucz(e)] = e; });
  const mapa3 = {}; v3.planoweWymiany.forEach(e => { mapa3[klucz(e)] = e; });
  const tylkoV3 = v3.planoweWymiany.filter(e => !mapa1[klucz(e)]);
  const tylkoV1 = v1.planoweWymiany.filter(e => !mapa3[klucz(e)]);
  const innyDawca = v3.planoweWymiany.filter(e => mapa1[klucz(e)] && mapa1[klucz(e)].od !== e.od);
  const identyczne = tylkoV3.length === 0 && tylkoV1.length === 0 && innyDawca.length === 0;
  const p = v3.v3Info?.pelna;
  const delta = (a, b, wiecejLepiej) => {
    const d = b - a;
    if (d === 0) return <span style={{ color: "#777" }}>=</span>;
    const dobrze = wiecejLepiej ? d > 0 : d < 0;
    return <span style={{ color: dobrze ? "#0c6" : "#f55", fontWeight: "bold" }}>{d > 0 ? "+" : ""}{d.toLocaleString()}</span>;
  };
  return (
    <div style={{ background: "rgba(20,184,166,0.07)", border: "1px solid #14b8a655", borderRadius: 10, padding: 12, marginBottom: 14 }}>
      <div style={{ fontWeight: "bold", color: "#5eead4", fontSize: 14, marginBottom: 8 }}>🧠 Pełne porównanie V1 ↔ V3</div>
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr", gap: "4px 8px", fontSize: 12, alignItems: "center" }}>
        <div style={{ color: "#777" }}></div><div style={{ color: "#aaa", textAlign: "right" }}>V1</div><div style={{ color: "#5eead4", textAlign: "right" }}>V3</div><div style={{ color: "#777", textAlign: "right" }}>różnica</div>
        {wiersze.map(([n, a, b, wl]) => (
          <React.Fragment key={n}>
            <div style={{ color: "#ccc" }}>{n}</div>
            <div style={{ textAlign: "right", color: "#aaa" }}>{a.toLocaleString()}</div>
            <div style={{ textAlign: "right", color: "#fff", fontWeight: "bold" }}>{b.toLocaleString()}</div>
            <div style={{ textAlign: "right" }}>{delta(a, b, wl)}</div>
          </React.Fragment>
        ))}
      </div>
      {identyczne ? (
        <div style={{ marginTop: 8, fontSize: 11, color: "#888" }}>V3 nie znalazł nic do poprawy — oba plany są identyczne.</div>
      ) : (
        <div style={{ marginTop: 10, fontSize: 11, lineHeight: 1.6 }}>
          {tylkoV3.map((e, i) => <div key={"n" + i} style={{ color: "#0c6" }}>➕ tylko V3: {e.od} ➜ {e.do}: {e.karta} [{e.talia}]</div>)}
          {tylkoV1.map((e, i) => <div key={"s" + i} style={{ color: "#f77" }}>➖ tylko V1: {e.od} ➜ {e.do}: {e.karta} [{e.talia}]</div>)}
          {innyDawca.map((e, i) => <div key={"d" + i} style={{ color: "#5eead4" }}>🔀 inny dawca: {e.do}: {e.karta} [{e.talia}] — V1: {mapa1[klucz(e)].od}, V3: {e.od}</div>)}
        </div>
      )}
      {p && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#888" }}>
          🧮 Pełna analiza: sprawdzono {p.wezly.toLocaleString()} układów ({p.kandydatow} talii do zamknięcia) w {p.ms} ms
          {p.przerwano ? " — przerwano na limicie czasu, wynik może nie być idealny" : " — przeszukano wszystko"}
          {p.poprawiono ? " — znalazła lepszy układ." : " — lepszego układu nie ma."}
        </div>
      )}
    </div>
  );
}

function WynikView({wersja="v1",talie,czlonkowie,posiadane,duplikaty,typWymiany,wynik,setWynik,trybWymiany,setTrybWymiany,zapiszAktywna,przejdzDoAktywnej,historiaWymian=[],paczkiDiament={},setPaczkiDiament=()=>{}}) {
  const [skopiowano,setSkopiowano]=useState(false);
  const [liczy,setLiczy]=useState(false);
  const [historiaWyniku,setHistoriaWyniku]=useState([]);
  const [publikowanie,setPublikowanie]=useState(false);
  const [wylaczoneTalie,setWylaczoneTalie]=useState(new Set());
  const [wylaczoneOsoby,setWylaczoneOsoby]=useState(new Set());
  const [wylaczoneDawcy,setWylaczoneDawcy]=useState(new Set());
  const [pokazWylaczenia,setPokazWylaczenia]=useState(false);
  const [limitKartOsoby,setLimitKartOsoby]=useState({});

  const toggleTalia=id=>setWylaczoneTalie(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const [ignorujTrudne,setIgnorujTrudne]=useState(false);
  const [maxKartNaOsobe,setMaxKartNaOsobe]=useState(0); // 0 = bez limitu
  const [sprawiedliwe,setSprawiedliwe]=useState(false);
  const [vipKolejka,setVipKolejka]=useState([]); // lista id osób w kolejności priorytetu
  const [celowaKolejka,setCelowaKolejka]=useState({}); // {osobaId: liczbaKart} — tryb celowany



  const toggleVip=(id)=>{
    setVipKolejka(prev=>{
      if(prev.includes(id)) return prev.filter(x=>x!==id);
      return [...prev,id];
    });
  };

  const przesunVip=(id,kierunek)=>{
    setVipKolejka(prev=>{
      const idx=prev.indexOf(id);
      if(idx===-1) return prev;
      const n=[...prev];
      const nowyIdx=idx+kierunek;
      if(nowyIdx<0||nowyIdx>=n.length) return prev;
      [n[idx],n[nowyIdx]]=[n[nowyIdx],n[idx]];
      return n;
    });
  };

  const [podmienDawce,setPodmienDawce]=useState(null); // {dawcaNazwa, idx}

  // Znajdź alternatywną wymianę dla dawcy
  const znajdzAlternatywe=(dawcaNazwa)=>{
    // Znajdź dawcę w liście członków
    const dawca=czlonkowie.find(c=>c.nazwa===dawcaNazwa);
    if(!dawca) return null;

    // Szukaj kogokolwiek kto POTRZEBUJE karty którą dawca ma jako duplikat
    // Priorytet: fazy 1-2, największa nagroda
    const kandydaci=[];
    const typ=typWymiany==="złote"?"złota":"diamentowa";
    const oppTyp=typWymiany==="złote"?"diamentowa":typWymiany==="event"?null:"złota";

    czlonkowie.forEach(odbiorca=>{
      if(odbiorca.id===dawca.id) return; // nie sam do siebie
      talie.forEach(talia=>{
        const kartyT=talia.karty.filter(k=>k.typ===typ);
        const kartyO=talia.karty.filter(k=>k.typ===oppTyp);
        const brakT=kartyT.filter(k=>!posiadane[`${odbiorca.id}_${talia.id}_${k.nazwa}`]);
        const brakO=kartyO.filter(k=>!posiadane[`${odbiorca.id}_${talia.id}_${k.nazwa}`]);
        brakT.forEach(karta=>{
          // Dawca musi mieć duplikat tej karty
          if(!duplikaty[`${dawca.id}_${talia.id}_${karta.nazwa}`]) return;
          const faza=obliczFaze(brakT.length,brakO.length,typWymiany);
          // Oblicz czy ta wymiana daje próg amunicji odbiorcy
          const kartyOdbiorcyLacznie = talie.reduce((s,t)=>
            s+t.karty.filter(k=>posiadane[`${odbiorca.id}_${t.id}_${k.nazwa}`]).length, 0
          );
          const progPoWymianie = typWymiany==="event" ? null : PROGI.find(p=>p.prog>kartyOdbiorcyLacznie && p.prog<=kartyOdbiorcyLacznie+1);
          kandydaci.push({
            od:dawcaNazwa, do:odbiorca.nazwa,
            karta:karta.nazwa, talia:talia.nazwa,
            nagroda:pobierzNagrode(talia, odbiorca?.krag||1), faza,
            brakTCount:brakT.length, brakOCount:brakO.length,
            trudna:TRUDNE_NUMERY.includes(talia.numer),
            nastepnyProg: progPoWymianie || null,
            ammoProg: progPoWymianie?.ammo || 0,
          });
        });
      });
    });

    // Sortuj po fazie i nagrodzie
    kandydaci.sort((a,b)=>{
      if(a.faza!==b.faza) return a.faza-b.faza;
      if(b.nagroda!==a.nagroda) return b.nagroda-a.nagroda;
      return a.brakTCount-b.brakTCount;
    });

    // Wyklucz wymiany które już są w planie:
    // 1. Ten dawca już wysyła tę kartę do tej osoby
    const juzWysylane=new Set(wynik.planoweWymiany.filter(w=>w.od===dawcaNazwa).map(w=>`${w.do}_${w.karta}`));
    // 2. Odbiorca już dostaje tę kartę od kogokolwiek w rozpisce
    const juzOtrzymuje=new Set(wynik.planoweWymiany.map(w=>`${w.do}_${w.karta}`));
    // 3. Ten dawca już jest zajęty (wysyła coś innemu)
    return kandydaci
      .filter(k=>!juzWysylane.has(`${k.do}_${k.karta}`))
      .filter(k=>!juzOtrzymuje.has(`${k.do}_${k.karta}`))
      .filter(k=>k.faza<=20) // max faza 20 — wyżej nie ma sensu
      .sort((a,b)=>{
        // 1. Talie do zamknięcia (faza 1 + kompletOpp) pierwsze
        const aZamknie = a.faza===1 && a.brakOCount===0;
        const bZamknie = b.faza===1 && b.brakOCount===0;
        if(aZamknie!==bZamknie) return aZamknie?-1:1;
        // 2. Faza rosnąco
        if(a.faza!==b.faza) return a.faza-b.faza;
        // 3. Nagroda malejąco
        if(b.nagroda!==a.nagroda) return b.nagroda-a.nagroda;
        return 0;
      });
  };

  // Przelicz zamknieciaInfo po zmianie listy wymian
  const przeliczZamkniecia = (noweWymiany) => {
    const symPos={...posiadane};
    noweWymiany.forEach(w=>{
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
          const liczbaPoWymianie=liczKartyOsoby(osoba.id,talie,symPos);
          const obliczProgFn = typWymiany==="event" ? obliczProgEvent : obliczProg;
          const progPrzed=obliczProgFn(liczKartyOsoby(osoba.id,talie,posiadane));
          const progPo=obliczProgFn(liczbaPoWymianie);
          const nowyProg=progPo.ostatniProg?.prog>(progPrzed.ostatniProg?.prog||0);
          zamknieciaInfo.push({
            osoba:osoba.nazwa, talia:talia.nazwa, nagroda:pobierzNagrode(talia,osoba.krag),
            nowyProg: nowyProg ? progPo.ostatniProg : null,
          });
        }
      });
    });
    return zamknieciaInfo;
  };

  const cofnijEdycje=()=>{
    if(!historiaWyniku.length) return;
    setWynik(historiaWyniku[historiaWyniku.length-1]);
    setHistoriaWyniku(h=>h.slice(0,-1));
  };

  const podmienWymiane=(idx,nowaWymiana)=>{
    if(wynik) setHistoriaWyniku(h=>[...h.slice(-19),wynik]);
    setWynik(prev=>{
      const noweWymiany = prev.planoweWymiany.map((w,i)=>i===idx?nowaWymiana:w);
      return {
        ...prev,
        planoweWymiany: noweWymiany,
        zamknieciaInfo: przeliczZamkniecia(noweWymiany),
      };
    });
    setPodmienDawce(null);
  };

  const usunWymiane=(idx)=>{
    if(wynik) setHistoriaWyniku(h=>[...h.slice(-19),wynik]);
    setWynik(prev=>{
      const noweWymiany = prev.planoweWymiany.filter((_,i)=>i!==idx);
      return {
        ...prev,
        planoweWymiany: noweWymiany,
        zamknieciaInfo: przeliczZamkniecia(noweWymiany),
      };
    });
  };

  const generuj=()=>{
    playSound("ding");
    const aktywne=talie.filter(t=>!wylaczoneTalie.has(t.id));
    // Oblicz łączną liczbę kart per osoba do filtrowania trybu wylacz110
    const kartyLaczniePer = (osobaId) => talie.reduce((s,t)=>
      s+t.karty.filter(k=>posiadane[`${osobaId}_${t.id}_${k.nazwa}`]).length, 0
    );
    const aktywniCzlonkowie=czlonkowie.filter(c=>{
      if(wylaczoneOsoby.has(c.id)) return false;
      if(trybWymiany==="wylacz110"){
        const karty=kartyLaczniePer(c.id);
        if(karty>=110 && karty<=120) return false; // wyklucz 110-120
      }
      return true;
    }); // odbiorcy
    // Dawcami mogą być WSZYSCY (też wyłączeni z wymiany — mają duplikaty które inni mogą dostać)
    const aktywniDawcy=czlonkowie.filter(c=>!wylaczoneDawcy.has(c.id));
    const parametry={talie:aktywne,czlonkowie:aktywniCzlonkowie,wszyscyCzlonkowie:aktywniDawcy,posiadane,duplikaty,typWymiany,tryb:trybWymiany,vipKolejka:trybWymiany==="vip"?vipKolejka:[],celowaKolejka:trybWymiany==="celowany"?celowaKolejka:{},ignorujTrudne,historiaWymian,sprawiedliwe,maxKartNaOsobe,limitKartOsoby,paczkiDiament:trybWymiany==="paczki_diament"?paczkiDiament:{}};
    setLiczy(true);
    policzWymiane(wersja==="v3"?"v3":"v1",parametry)
      .then(w=>{setHistoriaWyniku([]);setWynik(w);})
      .catch(e=>alert("❌ Nie udało się wygenerować wymiany: "+e.message))
      .finally(()=>setLiczy(false));
  };

  const tekstMessenger=wynik?wynik.planoweWymiany.map(w=>`${w.od} ➡️ ${w.do}: ${w.karta}`).join("\n"):"";

  const kopiuj=()=>{
    navigator.clipboard?.writeText(tekstMessenger).then(()=>{setSkopiowano(true);setTimeout(()=>setSkopiowano(false),2000);});
  };

  const etykietyFaz={
    10:{t:"🔴 FAZA 1 — ZAMKNIE TALIĘ! Brakuje 1 karty + komplet innych typów",k:"#f55"},
    20:{t:"🟠 FAZA 2 — Brakuje 2 kart + komplet innych typów",k:"#ff7a00"},
    11:{t:"🟡 FAZA 3 — Brakuje 1 karty + 1 innego typu",k:"#ff4488"},
    12:{t:"🟡 FAZA 4 — Brakuje 1 karty + 2 innych typów",k:"#fa0"},
    21:{t:"🟡 FAZA 5 — Brakuje 2 kart + 1 innego typu",k:"#fa0"},
    22:{t:"🟡 FAZA 6 — Brakuje 2 kart + 2 innych typów",k:"#d4b800"},
    31:{t:"🔵 FAZA 7 — Brakuje 3 kart + 1 innego typu",k:"#6af"},
    30:{t:"🔵 FAZA 6.5 — Brakuje 3 kart + komplet innych typów",k:"#6af"},
    32:{t:"🔵 FAZA 8 — Brakuje 3 kart + 2 innych typów",k:"#6af"},
    100:{t:"🔓 ZAMKNIE TALIĘ — pakiet kart na zamknięcie talii",k:"#bb88ff"},
    110:{t:"🔓 Dodatkowo — wysyłamy bo nie ma lepszych",k:"#888bff"},
    200:{t:"👑 VIP — karty dla wybranej osoby priorytetowej",k:"var(--accent)"},
    210:{t:"👥 Reszta gangu — pozostali dawcy po obsłudze VIP-a",k:"#aaa"},
  };

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
        {[
          {id:"priorytet",label:"🎯 Priorytet (1-2 brakujące)"},
          {id:"zamknij",label:"🔓 Zamknij cokolwiek"},
          {id:"progi",label:"📈 Dobij progi"},
          {id:"vip",label:"👑 VIP — dobij jedną osobę"},
          {id:"celowany",label:"🎯 Celowany — wybierz osoby"},
          {id:"wylacz110",label:"🚫 Wyłącz 110-120"},
          {id:"krag79",label:"7️⃣ Tryb 7-9"},
          {id:"paczki_diament",label:"📦 Paczki nowych diamentowych"},
        ].filter(t=>!(t.id==="progi"&&typWymiany==="event")).map(t=>(
          <button key={t.id} onClick={()=>setTrybWymiany(t.id)} style={{
            padding:"8px 14px",borderRadius:8,cursor:"pointer",fontSize:12,
            background:trybWymiany===t.id?"rgba(255,215,0,0.14)":"var(--card)",
            border:trybWymiany===t.id?"1px solid #ffd700":"1px solid var(--border)",
            color:trybWymiany===t.id?"var(--accent)":"var(--muted)",
          }}>{t.label}</button>
        ))}
      </div>

      {/* Panel paczek diamentowych */}
      {trybWymiany==="paczki_diament"&&typWymiany==="diamentowe"&&(
        <div style={{marginBottom:12,background:"var(--card)",border:"1px solid #87CEEB33",borderRadius:10,padding:12}}>
          <div style={{fontSize:12,color:"#87CEEB",fontWeight:"bold",marginBottom:8}}>
            📦 Nowe diamentowe w paczkach — wpisz ile kto ma
          </div>
          <div style={{fontSize:10,color:"var(--muted)",marginBottom:10}}>
            Osoby które mają wystarczająco paczek żeby zamknąć krąg są <strong style={{color:"#0c6"}}>wykluczone z wymiany</strong> jako odbiorcy. Reszta dostaje karty z niskim priorytetem.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {czlonkowie.map(c=>{
              const brakDiam = talie.reduce((sum,t)=>sum+(t.karty.filter(k=>k.typ==="diamentowa"&&!posiadane[c.id+"_"+t.id+"_"+k.nazwa]).length),0);
              const ilePaczek = paczkiDiament[c.id]||0;
              const maPaczki = c.id in paczkiDiament;
              const brakEfekt = Math.max(0, brakDiam - ilePaczek);
              const zamknieSam = maPaczki && brakEfekt===0 && brakDiam>0;
              const dostaniePriorytet = maPaczki && brakEfekt>0 && brakEfekt<=4;
              const pomijamy = maPaczki && brakEfekt>4;
              return(
                <div key={c.id} style={{display:"flex",alignItems:"center",gap:8,
                  padding:"4px 6px",borderRadius:6,
                  background:zamknieSam?"rgba(0,200,100,0.06)":dostaniePriorytet?"rgba(255,165,0,0.05)":"transparent"
                }}>
                  <span style={{flex:1,fontSize:11,color:zamknieSam?"#0c6":dostaniePriorytet?"#fa0":"var(--muted)"}}>{c.nazwa.replace(/™FAM™|fAM™|FAM™/g,"")}</span>
                  <span style={{fontSize:10,color:"var(--muted)",minWidth:50}}>brak: {brakDiam}💎</span>
                  <input type="number" min="0" max="99"
                    value={ilePaczek||""}
                    placeholder="0"
                    onChange={e=>setPaczkiDiament(p=>({...p,[c.id]:parseInt(e.target.value)||0}))}
                    style={{width:46,padding:"3px 5px",borderRadius:5,border:"1px solid #87CEEB44",background:"rgba(135,206,235,0.08)",color:"#87CEEB",fontSize:12,textAlign:"center"}}
                  />
                  <span style={{fontSize:9,minWidth:80,color:zamknieSam?"#0c6":dostaniePriorytet?"#fa0":pomijamy?"var(--muted)":"var(--muted)"}}>
                    {!maPaczki?"–":zamknieSam?"✓ zamknie sam":dostaniePriorytet?"dostanie "+brakEfekt+"💎":pomijamy?"⏭ pomijamy":""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Opcje dodatkowe */}
      <div style={{marginBottom:12,display:"flex",gap:8,flexWrap:"wrap"}}>
        <button onClick={()=>setIgnorujTrudne(p=>!p)} style={{
          padding:"6px 14px",borderRadius:8,cursor:"pointer",fontSize:12,
          background:ignorujTrudne?"rgba(255,100,0,0.2)":"var(--card)",
          border:ignorujTrudne?"1px solid #ff6400":"1px solid var(--border)",
          color:ignorujTrudne?"#ff6400":"#555",
        }}>
          {ignorujTrudne?"🔥 Trudne = zwykłe (wł.)":"⚠️ Ignoruj trudne talie"}
        </button>
        <button onClick={()=>setSprawiedliwe(p=>!p)} style={{
          padding:"6px 14px",borderRadius:8,cursor:"pointer",fontSize:12,
          background:sprawiedliwe?"rgba(0,200,100,0.15)":"var(--card)",
          border:sprawiedliwe?"1px solid #0c6":"1px solid var(--border)",
          color:sprawiedliwe?"#0c6":"#555",
        }}>
          {sprawiedliwe?"⚖️ Sprawiedliwe wymiany (wł.)":"⚖️ Sprawiedliwe wymiany"}
        </button>
      </div>
      {sprawiedliwe&&(
        <div style={{fontSize:11,color:"var(--muted)",marginBottom:10,padding:"6px 10px",background:"rgba(0,200,100,0.05)",border:"1px solid #0c633",borderRadius:6}}>
          ⚖️ <strong style={{color:"#0c6"}}>Jak działa tryb sprawiedliwy:</strong><br/>
          Gdy kilka osób chce tę samą kartę (1 duplikat, 3 chętnych) — wygrywa osoba która <strong>najrzadziej dostawała karty</strong> w poprzednich wymianach. Liczone jako odchylenie od średniej gangu — kto jest poniżej średniej, ma wyższy priorytet. Wymaga zarchiwizowanej historii.
        </div>
      )}

      {/* Max kart na osobę */}
      <div style={{marginBottom:14,padding:"10px 14px",background:"var(--card)",border:"1px solid var(--border)",borderRadius:8}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:maxKartNaOsobe>0?8:0}}>
          <span style={{fontSize:12,color:"#aaa",flex:1}}>🃏 Max kart na osobę:</span>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {[0,1,2,3,4,5].map(v=>(
              <button key={v} onClick={()=>setMaxKartNaOsobe(v)} style={{
                padding:"4px 10px",borderRadius:6,cursor:"pointer",fontSize:12,
                background:maxKartNaOsobe===v?"linear-gradient(135deg,#b8860b,#ffd700)":"var(--card)",
                border:maxKartNaOsobe===v?"none":"1px solid var(--border)",
                color:maxKartNaOsobe===v?"#000":"var(--muted)",
                fontWeight:maxKartNaOsobe===v?"bold":"normal",
              }}>{v===0?"∞":v}</button>
            ))}
          </div>
        </div>
        {maxKartNaOsobe>0&&(
          <div style={{fontSize:11,color:"#fa0"}}>
            ⚠️ Każda osoba dostanie max {maxKartNaOsobe} {maxKartNaOsobe===1?"kartę":maxKartNaOsobe<5?"karty":"kart"} — reszta puli trafi do innych.
          </div>
        )}
        {maxKartNaOsobe===0&&(
          <div style={{fontSize:11,color:"#555"}}>
            Bez limitu — jedna osoba może dostać tyle kart ile ma dostępnych dawców.
          </div>
        )}
      </div>
      {trybWymiany==="wylacz110"&&(
        <div style={{background:"rgba(255,50,50,0.06)",border:"1px solid #f5544433",borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:"#aaa"}}>
          🚫 <strong style={{color:"#f55"}}>Tryb Wyłącz 110-120</strong> — osoby które mają od 110 do 120 kart nie dostają kart w tej wymianie. Reszta gangu dostaje normalnie według faz.
          <div style={{marginTop:4,fontSize:10,color:"#555"}}>
            Wykluczone: {czlonkowie.filter(c=>{const k=talie.reduce((s,t)=>s+t.karty.filter(kk=>posiadane[`${c.id}_${t.id}_${kk.nazwa}`]).length,0); return k>=110&&k<=120;}).map(c=>c.nazwa).join(", ")||"(brak osób w tym zakresie)"}
          </div>
        </div>
      )}

      {trybWymiany==="celowany"&&(
        <div style={{background:"rgba(0,0,0,0.25)",border:"1px solid var(--border)",borderRadius:10,padding:14,marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:"bold",color:"var(--accent)",marginBottom:8}}>
            🎯 Celowany — wybierz osoby i ile kart mają dostać
          </div>
          <div style={{fontSize:11,color:"var(--muted)",marginBottom:10}}>
            Zaznaczone osoby dostaną priorytetowo podaną liczbę kart. Reszta gangu dostaje normalnie według faz.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {czlonkowie.filter(c=>!wylaczoneOsoby.has(c.id)).map(c=>{
              const ile = celowaKolejka[c.id] || 0;
              const zaznaczona = ile > 0;
              return (
                <div key={c.id} style={{
                  display:"flex",alignItems:"center",gap:8,padding:"6px 10px",
                  background:zaznaczona?"rgba(255,215,0,0.06)":"rgba(255,255,255,0.02)",
                  border:zaznaczona?"1px solid #ffd70033":"1px solid #1a1a2e",
                  borderRadius:6,
                }}>
                  <span style={{flex:1,fontSize:12,color:zaznaczona?"var(--text)":"var(--muted)"}}>{c.nazwa}</span>
                  {[0,1,2,3,4].map(n=>(
                    <button key={n} onClick={()=>setCelowaKolejka(prev=>({...prev,[c.id]:n}))} style={{
                      padding:"3px 10px",borderRadius:5,cursor:"pointer",fontSize:12,
                      background:ile===n
                        ? n===0?"var(--card)":"linear-gradient(135deg,#b8860b,#ffd700)"
                        : "var(--card)",
                      border:ile===n&&n>0?"none":"1px solid var(--border)",
                      color:ile===n&&n>0?"#000":ile===n?"#555":"#555",
                      fontWeight:ile===n&&n>0?"bold":"normal",
                    }}>{n===0?"✕":n}</button>
                  ))}
                </div>
              );
            })}
          </div>
          {Object.values(celowaKolejka).some(v=>v>0)&&(
            <div style={{marginTop:8,fontSize:11,color:"#0c6"}}>
              ✓ {Object.entries(celowaKolejka).filter(([,v])=>v>0).length} osób w kolejce celowanej
            </div>
          )}
        </div>
      )}

      {trybWymiany==="vip"&&(
        <div style={{background:"rgba(255,215,0,0.06)",border:"1px solid #ffd70044",borderRadius:10,padding:12,marginBottom:12}}>
          <div style={{fontSize:12,fontWeight:"bold",color:"var(--accent)",marginBottom:4}}>
            👑 Kolejka priorytetów — zaznacz osoby i ustaw kolejność
          </div>
          <div style={{fontSize:11,color:"var(--muted)",marginBottom:10}}>
            Pierwsza osoba dostaje ile możliwe, potem druga, potem trzecia... Reszta dawców idzie do gangu normalnie.
          </div>

          {/* Przyciski wyboru */}
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
            {czlonkowie.map(c=>{
              const pos=vipKolejka.indexOf(c.id);
              const wKolejce=pos!==-1;
              return (
                <button key={c.id} onClick={()=>toggleVip(c.id)} style={{
                  padding:"6px 12px",borderRadius:20,fontSize:12,cursor:"pointer",
                  background:wKolejce?"linear-gradient(135deg,#b8860b,#ffd700)":"var(--card)",
                  border:wKolejce?"none":"1px solid var(--border)",
                  color:wKolejce?"#000":"var(--muted)",
                  fontWeight:wKolejce?"bold":"normal",
                }}>
                  {wKolejce&&<span style={{marginRight:4,background:"rgba(0,0,0,0.3)",borderRadius:"50%",padding:"0 5px",fontSize:10}}>{pos+1}</span>}
                  {c.nazwa}
                </button>
              );
            })}
          </div>

          {/* Kolejka z możliwością przestawienia */}
          {vipKolejka.length>0&&(
            <div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:10}}>
              <div style={{fontSize:11,color:"var(--accent)",marginBottom:6}}>📋 Kolejność obsługi:</div>
              {vipKolejka.map((id,idx)=>{
                const osoba=czlonkowie.find(c=>c.id===id);
                const typ=typWymiany==="złote"?"złota":"diamentowa";
                const brakCount=talie.filter(t=>!wylaczoneTalie.has(t.id)).reduce((s,talia)=>
                  s+talia.karty.filter(k=>k.typ===typ&&!posiadane[`${id}_${talia.id}_${k.nazwa}`]).length
                ,0);
                const progInfo=(typWymiany==="event"?obliczProgEvent:obliczProg)(liczKartyOsoby(id,talie,posiadane));
                // Breakdown talii per faza dla VIP
                const aktywneT = talie.filter(t=>!wylaczoneTalie.has(t.id));
                const vipOppTyp = typWymiany==="złote"?"diamentowa":"złota";
                const talieVip = aktywneT.map(talia=>{
                  const kartyT = talia.karty.filter(k=>k.typ===typ);
                  const kartyO = talia.karty.filter(k=>k.typ===vipOppTyp);
                  const brakT = kartyT.filter(k=>!posiadane[`${id}_${talia.id}_${k.nazwa}`]);
                  const brakO = kartyO.filter(k=>!posiadane[`${id}_${talia.id}_${k.nazwa}`]);
                  if(!brakT.length) return null;
                  const faza = obliczFaze(brakT.length, brakO.length, typWymiany);
                  const kompletOpp = brakO.length===0;
                  return {talia, brakT: brakT.length, brakO: brakO.length, faza, kompletOpp, nagroda: pobierzNagrode(talia, osoba?.krag||1)};
                }).filter(Boolean).sort((a,b)=>{
                  if(a.kompletOpp!==b.kompletOpp) return a.kompletOpp?-1:1;
                  if(a.faza!==b.faza) return a.faza-b.faza;
                  return b.nagroda-a.nagroda;
                });
                const moznaZamknac = talieVip.filter(t=>t.kompletOpp);
                const bliskie = talieVip.filter(t=>!t.kompletOpp && t.faza<=3);
                return (
                  <div key={id} style={{padding:"8px 10px",background:"rgba(255,215,0,0.06)",border:"1px solid #ffd70022",borderRadius:8,marginBottom:6}}>
                    {/* Nagłówek */}
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                      <span style={{fontSize:14,fontWeight:"bold",color:"var(--accent)",width:20}}>{idx+1}.</span>
                      <span style={{flex:1,fontSize:13,fontWeight:"bold",color:"var(--text)"}}>{osoba?.nazwa}</span>
                      {(osoba?.krag||1)>1&&(
                        <span style={{fontSize:10,padding:"1px 6px",background:"rgba(138,43,226,0.2)",border:"1px solid #da70d655",borderRadius:10,color:"#da70d6",fontWeight:"bold"}}>
                          Krąg {osoba?.krag}
                        </span>
                      )}
                      <span style={{fontSize:11,color:"#f55"}}>−{brakCount} kart łącznie</span>
                      <div style={{display:"flex",gap:2}}>
                        <button onClick={()=>przesunVip(id,-1)} disabled={idx===0}
                          style={{padding:"2px 7px",background:"rgba(255,255,255,0.07)",border:"none",borderRadius:3,color:idx===0?"#333":"#aaa",cursor:idx===0?"default":"pointer",fontSize:11}}>▲</button>
                        <button onClick={()=>przesunVip(id,1)} disabled={idx===vipKolejka.length-1}
                          style={{padding:"2px 7px",background:"rgba(255,255,255,0.07)",border:"none",borderRadius:3,color:idx===vipKolejka.length-1?"#333":"#aaa",cursor:idx===vipKolejka.length-1?"default":"pointer",fontSize:11}}>▼</button>
                        <button onClick={()=>toggleVip(id)}
                          style={{padding:"2px 7px",background:"rgba(255,50,50,0.1)",border:"none",borderRadius:3,color:"#f5544488",cursor:"pointer",fontSize:11}}>✕</button>
                      </div>
                    </div>

                    {/* Próg amunicji */}
                    {progInfo.nastepnyProg&&(
                      <div style={{fontSize:10,color:"#fa0",marginBottom:5,padding:"2px 7px",background:"rgba(255,165,0,0.08)",borderRadius:4,display:"inline-block"}}>
                        🎯 próg {progInfo.nastepnyProg.prog}: brakuje {progInfo.brakujeDoProg} kart (+{progInfo.ammoProg.toLocaleString()} amunicji)
                      </div>
                    )}

                    {/* Talie do zamknięcia */}
                    {moznaZamknac.length>0&&(
                      <div style={{marginBottom:4}}>
                        <div style={{fontSize:10,color:"#0c6",fontWeight:"bold",marginBottom:3}}>
                          🔒 Do zamknięcia ({moznaZamknac.length}):
                        </div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                          {moznaZamknac.map(t=>(
                            <span key={t.talia.id} style={{fontSize:10,padding:"2px 7px",background:"rgba(0,200,100,0.12)",border:"1px solid #0c633",borderRadius:4,color:"#0c6"}}>
                              {t.talia.nazwa} <strong>−{t.brakT}</strong>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Talie bliskie zamknięcia (faza 1-3) */}
                    {bliskie.length>0&&(
                      <div style={{marginBottom:4}}>
                        <div style={{fontSize:10,color:"#fa0",fontWeight:"bold",marginBottom:3}}>
                          ⚡ Bliskie zamknięcia faza 1-3 ({bliskie.length}):
                        </div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                          {bliskie.map(t=>(
                            <span key={t.talia.id} style={{fontSize:10,padding:"2px 7px",background:"rgba(255,165,0,0.08)",border:"1px solid #fa033",borderRadius:4,color:"#fa0"}}>
                              {t.talia.nazwa} −{t.brakT}kart (f{t.faza})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Pozostałe talie — skrócone */}
                    {talieVip.filter(t=>!t.kompletOpp&&t.faza>3).length>0&&(
                      <div style={{fontSize:10,color:"#555"}}>
                        Pozostałe: {talieVip.filter(t=>!t.kompletOpp&&t.faza>3).map(t=>`${t.talia.nazwa.split(" ")[0]} −${t.brakT}(f${t.faza})`).join(" · ")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {vipKolejka.length===0&&<div style={{fontSize:11,color:"#555",marginTop:4}}>← Kliknij osoby powyżej żeby dodać do kolejki</div>}
        </div>
      )}

      {/* Panel wyłączania talii */}
      <div style={{background:"rgba(0,0,0,0.25)",border:"1px solid var(--border)",borderRadius:10,padding:12,marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{fontSize:12,fontWeight:"bold",color:"var(--accent)"}}>
            🚫 Wyłącz talie z generowania
            {wylaczoneTalie.size>0&&<span style={{marginLeft:8,fontSize:11,color:"#fa0"}}>({wylaczoneTalie.size} wyłączone)</span>}
          </div>
          {wylaczoneTalie.size>0&&(
            <button onClick={()=>setWylaczoneTalie(new Set())} style={{fontSize:10,padding:"2px 8px",background:"rgba(255,165,0,0.1)",border:"1px solid #fa055",borderRadius:4,color:"#fa0",cursor:"pointer"}}>
              Włącz wszystkie
            </button>
          )}
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {talie.map(t=>{
            const wylaczona=wylaczoneTalie.has(t.id);
            return (
              <button key={t.id} onClick={()=>toggleTalia(t.id)} style={{
                padding:"4px 10px",borderRadius:20,fontSize:11,cursor:"pointer",
                background:wylaczona?"rgba(255,50,50,0.15)":"var(--card)",
                border:wylaczona?"1px solid #f5544488":"1px solid var(--border)",
                color:wylaczona?"#f55":"var(--muted)",
                textDecoration:wylaczona?"line-through":"none",
              }}>
                {wylaczona?"🚫 ":""}{t.nazwa}
              </button>
            );
          })}
        </div>
        {wylaczoneTalie.size>0&&(
          <div style={{fontSize:10,color:"var(--muted)",marginTop:6}}>
            Wyłączone talie są ignorowane przy generowaniu wymian.
          </div>
        )}
      </div>

      {/* Wyłącz osoby — rozwijane menu */}
      <div style={{background:"var(--card)",border:"1px solid #1a1a2e",borderRadius:8,marginBottom:12,overflow:"hidden"}}>
        {/* Nagłówek — klikalny */}
        <div onClick={()=>setPokazWylaczenia(p=>!p)} style={{
          display:"flex",justifyContent:"space-between",alignItems:"center",
          padding:"10px 12px",cursor:"pointer",
          background:pokazWylaczenia?"rgba(255,215,0,0.04)":"transparent",
        }}>
          <div style={{fontSize:12,fontWeight:"bold",color:"var(--accent)",display:"flex",alignItems:"center",gap:8}}>
            🚫 Wyłącz graczy
            {(wylaczoneOsoby.size>0||wylaczoneDawcy.size>0)&&(
              <span style={{fontSize:10,color:"#fa0",fontWeight:"normal"}}>
                {wylaczoneOsoby.size>0&&`${wylaczoneOsoby.size}× brak odbioru`}
                {wylaczoneOsoby.size>0&&wylaczoneDawcy.size>0&&" · "}
                {wylaczoneDawcy.size>0&&`${wylaczoneDawcy.size}× brak dawcy`}
                {Object.keys(limitKartOsoby).length>0&&` · ${Object.keys(limitKartOsoby).length}× limit kart`}
              </span>
            )}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {(wylaczoneOsoby.size>0||wylaczoneDawcy.size>0||Object.keys(limitKartOsoby).length>0)&&(
              <button onClick={e=>{e.stopPropagation();setWylaczoneOsoby(new Set());setWylaczoneDawcy(new Set());setLimitKartOsoby({});}}
                style={{fontSize:10,padding:"2px 8px",background:"rgba(255,50,50,0.1)",border:"1px solid #f5544433",borderRadius:4,color:"#f55",cursor:"pointer"}}>
                Resetuj
              </button>
            )}
            <span style={{fontSize:12,color:"#555"}}>{pokazWylaczenia?"▲":"▼"}</span>
          </div>
        </div>

        {/* Rozwijana lista */}
        {pokazWylaczenia&&(
          <div style={{padding:"0 12px 12px",borderTop:"1px solid #1a1a2e"}}>
            {/* Legenda */}
            <div style={{display:"flex",gap:10,marginBottom:8,marginTop:8,fontSize:10,color:"#555"}}>
              <span>Kliknij żeby zmienić tryb wyłączenia:</span>
              <span style={{color:"var(--muted)"}}>⬜ aktywny</span>
              <span style={{color:"#f55"}}>🚫 bez odbioru</span>
              <span style={{color:"#fa0"}}>📤 bez dawcy</span>
              <span style={{color:"#a55"}}>⛔ oba</span>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {czlonkowie.map(c=>{
                const bezOdbioru = wylaczoneOsoby.has(c.id);
                const bezDawcy = wylaczoneDawcy.has(c.id);
                const obie = bezOdbioru && bezDawcy;

                // Cykl: aktywny → bez odbioru → bez dawcy → oba → aktywny
                const handleClick = () => {
                  if (!bezOdbioru && !bezDawcy) {
                    // aktywny → bez odbioru
                    setWylaczoneOsoby(prev=>{const n=new Set(prev);n.add(c.id);return n;});
                  } else if (bezOdbioru && !bezDawcy) {
                    // bez odbioru → bez dawcy
                    setWylaczoneOsoby(prev=>{const n=new Set(prev);n.delete(c.id);return n;});
                    setWylaczoneDawcy(prev=>{const n=new Set(prev);n.add(c.id);return n;});
                  } else if (!bezOdbioru && bezDawcy) {
                    // bez dawcy → oba
                    setWylaczoneOsoby(prev=>{const n=new Set(prev);n.add(c.id);return n;});
                  } else {
                    // oba → aktywny
                    setWylaczoneOsoby(prev=>{const n=new Set(prev);n.delete(c.id);return n;});
                    setWylaczoneDawcy(prev=>{const n=new Set(prev);n.delete(c.id);return n;});
                  }
                };

                const ikona = obie?"⛔":bezOdbioru?"🚫":bezDawcy?"📤":"";
                const kolor = obie?"#a55":bezOdbioru?"#f55":bezDawcy?"#fa0":"var(--muted)";
                const bg = obie?"rgba(180,50,50,0.15)":bezOdbioru?"rgba(255,50,50,0.12)":bezDawcy?"rgba(255,165,0,0.12)":"var(--card)";
                const border = obie?"1px solid #a5544488":bezOdbioru?"1px solid #f5544488":bezDawcy?"1px solid #fa055":"1px solid var(--border)";

                const limitOsoby = limitKartOsoby[c.id];
                return (
                  <div key={c.id} style={{display:"flex",alignItems:"center",gap:3}}>
                    <button onClick={handleClick} title={
                      obie?"Kliknij → aktywny":
                      bezOdbioru?"Kliknij → bez dawcy":
                      bezDawcy?"Kliknij → oba wyłączone":
                      "Kliknij → bez odbioru"
                    } style={{
                      padding:"4px 10px",borderRadius:20,fontSize:11,cursor:"pointer",
                      background:bg, border, color:kolor,
                      textDecoration:(bezOdbioru||obie)?"line-through":"none",
                    }}>
                      {ikona&&<span style={{marginRight:3}}>{ikona}</span>}
                      {c.nazwa}
                      {(c.krag||1)>1&&<span style={{fontSize:9,color:"#da70d6",marginLeft:3}}>K{c.krag}</span>}
                    </button>
                    {!obie&&!bezOdbioru&&(
                      <select value={limitOsoby??""} onChange={e=>{
                        const val=e.target.value;
                        setLimitKartOsoby(prev=>{const n={...prev};if(val==="")delete n[c.id];else n[c.id]=parseInt(val);return n;});
                      }} title="Max kart dla tej osoby" style={{
                        padding:"2px 4px",background:"var(--card-solid)",
                        border:`1px solid ${limitOsoby?"#fa0":"var(--border)"}`,
                        borderRadius:4,color:limitOsoby?"#fa0":"#444",
                        fontSize:10,cursor:"pointer",width:42,
                      }}>
                        <option value="">∞</option>
                        {[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{marginTop:8,fontSize:10,color:"#555",lineHeight:1.6}}>
              🚫 <strong style={{color:"#f55"}}>bez odbioru</strong> — nie dostaje kart (może wysyłać) ·
              📤 <strong style={{color:"#fa0"}}>bez dawcy</strong> — nie wysyła kart (może dostać) ·
              ⛔ <strong style={{color:"#a55"}}>oba</strong> — całkowicie wyłączony z wymiany
            </div>
          </div>
        )}
      </div>

      <button onClick={generuj} disabled={liczy} style={{
        width:"100%",padding:14,background:"linear-gradient(135deg,#b8860b,#ffd700,#b8860b)",
        border:"none",borderRadius:10,color:"#000",fontSize:15,fontWeight:"bold",
        cursor:"pointer",letterSpacing:2,marginBottom:16,
      }}>{liczy?(wersja==="v3"?"⏳ Liczę (do ok. 10 s)...":"⏳ Liczę..."):wersja==="v3"?"🧠 GENERUJ V3":"⚡ GENERUJ"} ({typWymiany==="złote"?"⭐ ZŁOTE":"💎 DIAMENTOWE"}) {wersja==="v3"?"🧠":"⚡"}</button>

      {wynik&&<>
        {wersja==="v3"&&wynik.v1&&<PorownanieV1V3 v1={wynik.v1} v3={wynik} />}
        {wynik.zamknieciaInfo.length>0&&(
          <div style={{background:"rgba(0,200,100,0.1)",border:"1px solid #0c6",borderRadius:10,padding:"12px 16px",marginBottom:14,animation:"pulseGold 2s ease-in-out"}}>
            <div style={{fontWeight:"bold",color:"#0c6",marginBottom:8,fontSize:14}}>🏆 Po tej wymianie gang zamknie talie:</div>
            {wynik.zamknieciaInfo.map((z,i)=>(
              <div key={i} style={{fontSize:13,padding:"4px 0",color:"#ccc",borderBottom:"1px solid #12122a",animation:`slideInUp 0.3s ${i*0.05}s both`}}>
                🎉 <strong style={{color:"var(--accent)"}}>{z.osoba}</strong> zamknie <strong>{z.talia}</strong>
                <span style={{color:"#0c6",marginLeft:6,animation:"countUp 0.4s ease both"}}>+{z.nagroda?.toLocaleString()} 💰</span>
                {z.nowyProg&&(
                  <span style={{marginLeft:8,background:"rgba(255,165,0,0.2)",border:"1px solid #fa0",borderRadius:6,padding:"1px 6px",fontSize:11,color:"#fa0"}}>
                    🎯 PRÓG {z.nowyProg.prog} kart! +{z.nowyProg.ammo.toLocaleString()} 💰
                  </span>
                )}
              </div>
            ))}
            <div style={{marginTop:8,fontWeight:"bold",color:"#0c6",fontSize:13}}>
              Łącznie z talii: +{wynik.zamknieciaInfo.reduce((s,z)=>s+(z.nagroda||0),0).toLocaleString()} 💰
              {wynik.zamknieciaInfo.some(z=>z.nowyProg)&&(
                <span style={{color:"#fa0",marginLeft:8}}>
                  + progi: +{(()=>{
                // Deduplikuj — każda osoba może zaliczyć dany próg tylko raz
                const zaliczone=new Set();
                return wynik.zamknieciaInfo.filter(z=>z.nowyProg).reduce((s,z)=>{
                  const key=`${z.osoba}_${z.nowyProg.prog}`;
                  if(zaliczone.has(key)) return s;
                  zaliczone.add(key);
                  return s+z.nowyProg.ammo;
                },0);
              })().toLocaleString()} 💰
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── PODSUMOWANIE ODBIORCÓW ── */}
        {(()=>{
          const perOdbiorca = {};
          wynik.planoweWymiany.forEach(w=>{
            if(!perOdbiorca[w.do]) perOdbiorca[w.do]=[];
            perOdbiorca[w.do].push(w);
          });

          // Symuluj stan po WSZYSTKICH wymianach (do obliczeń progu)
          const symPos={...posiadane};
          wynik.planoweWymiany.forEach(w=>{
            const o=czlonkowie.find(c=>c.nazwa===w.do);
            const t=talie.find(t2=>t2.nazwa===w.talia);
            if(o&&t){
              const k=t.karty.find(k2=>k2.nazwa===w.karta);
              if(k) symPos[`${o.id}_${t.id}_${k.nazwa}`]=true;
            }
          });

          const typ    = typWymiany==="złote" ? "złota"     : "diamentowa";
          const oppTyp = typWymiany==="złote" ? "diamentowa": "złota";
          const ikonaT = typWymiany==="złote" ? "⭐" : "💎";
          const ikonaO = typWymiany==="złote" ? "💎" : "⭐";

          return (
            <div style={{background:"rgba(0,0,0,0.25)",border:"1px solid var(--border)",borderRadius:10,padding:14,marginBottom:14}}>
              <div style={{fontWeight:"bold",color:"var(--accent)",fontSize:13,marginBottom:10}}>
                👥 Podsumowanie odbiorców
              </div>
              {Object.entries(perOdbiorca).map(([nazwa, wymianyOsoby])=>{
                const osoba=czlonkowie.find(c=>c.nazwa===nazwa);
                const oId=osoba?.id;

                const kartyPrzed=osoba?liczKartyOsoby(oId,talie,posiadane):0;
                const kartyPo   =osoba?liczKartyOsoby(oId,talie,symPos)   :0;
                const obliczProgFn = typWymiany==="event" ? obliczProgEvent : obliczProg;
                const progPrzed =obliczProgFn(kartyPrzed);
                const progPo    =obliczProgFn(kartyPo);
                const nowyProg  =progPo.ostatniProg?.prog>(progPrzed.ostatniProg?.prog||0);

                return (
                  <div key={nazwa} style={{
                    padding:"8px 0",borderBottom:"1px solid #12122a",
                  }}>
                    {/* Nagłówek osoby */}
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
                      <span style={{fontWeight:"bold",color:"var(--accent)",fontSize:13}}>{nazwa}</span>
                      <span style={{fontSize:11,color:"#777"}}>
                        dostaje <strong style={{color:"#fff"}}>{wymianyOsoby.length}</strong> {wymianyOsoby.length===1?"kartę":wymianyOsoby.length<5?"karty":"kart"}
                      </span>
                      {nowyProg&&(
                        <span style={{fontSize:11,color:"#fa0",background:"rgba(255,165,0,0.12)",padding:"2px 8px",borderRadius:10,border:"1px solid #fa033",fontWeight:"bold"}}>
                          🎯 PRÓG {progPo.ostatniProg.prog}! +{progPo.ostatniProg.ammo.toLocaleString()} 💰
                        </span>
                      )}
                    </div>

                    {/* Karty per talia */}
                    <div style={{display:"flex",flexWrap:"wrap",gap:5,marginLeft:8}}>
                      {wymianyOsoby.map((w,i)=>{
                        const t=talie.find(t2=>t2.nazwa===w.talia);
                        const kartyT=t?t.karty.filter(k=>k.typ===typ):[];
                        const kartyO=t?t.karty.filter(k=>k.typ===oppTyp):[];
                        // Stan PRZED wymianą tej konkretnej karty
                        const brakTPrzed=t?kartyT.filter(k=>!posiadane[`${oId}_${t.id}_${k.nazwa}`]).length:null;
                        const brakOPrzed=t?kartyO.filter(k=>!posiadane[`${oId}_${t.id}_${k.nazwa}`]).length:null;
                        // Stan PO wymianie (symulacja)
                        const brakTPo=t?kartyT.filter(k=>!symPos[`${oId}_${t.id}_${k.nazwa}`]).length:null;
                        const brakOPo=t?kartyO.filter(k=>!symPos[`${oId}_${t.id}_${k.nazwa}`]).length:null;

                        const zamknieTalie=brakTPo===0&&brakOPo===0;
                        const tylkoOppBrakuje=brakTPo===0&&brakOPo>0;

                        const kolorBadge=zamknieTalie?"#0c6":brakTPrzed===1&&brakOPrzed===0?"#f55":brakTPrzed<=2?"#fa0":"#6af";
                        const bgBadge=zamknieTalie?"rgba(0,200,100,0.12)":brakTPrzed===1&&brakOPrzed===0?"rgba(255,50,50,0.1)":brakTPrzed<=2?"rgba(255,165,0,0.08)":"rgba(100,170,255,0.08)";

                        return (
                          <div key={i} style={{
                            fontSize:11,padding:"4px 9px",borderRadius:6,
                            background:bgBadge,
                            border:`1px solid ${kolorBadge}55`,
                            color:"var(--text)",
                          }}>
                            <span style={{fontWeight:"bold"}}>{w.karta}</span>
                            <span style={{color:"#555",marginLeft:4}}>[{w.talia}]</span>
                            <span style={{marginLeft:6,color:kolorBadge,fontWeight:"bold"}}>
                              {zamknieTalie
                                ? "🏆 KOMPLET!"
                                : tylkoOppBrakuje
                                  ? `brak ${brakOPo}${ikonaO}`
                                  : brakTPo===0
                                    ? `komplet ${ikonaT}`
                                    : `po wymianie: −${brakTPo}${ikonaT}${brakOPo>0?` −${brakOPo}${ikonaO}`:` komplet${ikonaO}`}`
                              }
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
        {/* ── KONIEC PODSUMOWANIA ODBIORCÓW ── */}

        <div style={{background:"rgba(0,0,0,0.3)",border:"1px solid var(--border)",borderRadius:10,padding:14,marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:6}}>
            <div style={{fontWeight:"bold",color:"var(--accent)",fontSize:13}}>📋 Tekst na Messengera</div>
            {historiaWyniku.length>0&&<button onClick={cofnijEdycje} style={{padding:"5px 14px",background:"rgba(255,140,0,0.15)",border:"1px solid #ff8c00",borderRadius:6,color:"#ff8c00",cursor:"pointer",fontSize:11,fontWeight:"bold"}}>↩️ Cofnij ({historiaWyniku.length})</button>}
            <button onClick={kopiuj} style={{
              padding:"5px 14px",background:skopiowano?"rgba(0,200,100,0.2)":"rgba(255,215,0,0.12)",
              border:`1px solid ${skopiowano?"#0c6":"#b8860b"}`,borderRadius:6,
              color:skopiowano?"#0c6":"var(--accent)",cursor:"pointer",fontSize:11,fontWeight:"bold",
            }}>{skopiowano?"✓ Skopiowano!":"📋 Kopiuj"}</button>
          </div>
          <pre style={{fontSize:13,color:"var(--text)",whiteSpace:"pre-wrap",margin:0,fontFamily:"monospace",lineHeight:2,background:"rgba(0,0,0,0.2)",padding:10,borderRadius:6,overflow:"auto"}}>
            {tekstMessenger||"Brak wymian"}
          </pre>
        </div>

        <div style={{fontSize:12,color:"var(--muted)",marginBottom:10}}>
          Zaplanowane wymiany: <strong style={{color:"var(--accent)"}}>{wynik.planoweWymiany.length}</strong>
          {wynik.nieobsluzone.length>0&&<span style={{color:"#fa0",marginLeft:12}}>⚠️ {wynik.nieobsluzone.length} bez dawcy</span>}
          <button onClick={async()=>{
            setPublikowanie(true);
            const aktywna={
              wymiany: wynik.planoweWymiany,
              typWymiany,
              data: new Date().toISOString(),
              potwierdzone: {},
            };
            await zapiszAktywna(aktywna);
            zapiszAutoBackup("publikacja_wymiany");
            setPublikowanie(false);
            playSound("gold");
            launchConfetti(1500);
            przejdzDoAktywnej();
          }} style={{
            marginLeft:"auto",padding:"5px 14px",
            background:"linear-gradient(135deg,#0c6,#0fa)",
            border:"none",borderRadius:6,color:"#000",
            cursor:"pointer",fontSize:12,fontWeight:"bold",
          }}>{publikowanie?"⏳ Zapisuję...":"📤 Opublikuj dla gangu"}</button>
        </div>

        {[10,20,11,21,12,22,30,31,32,100,110,200,210].map(faza=>{
          const w=wynik.planoweWymiany.filter(x=>x.faza===faza);
          if(!w.length) return null;
          const e=etykietyFaz[faza]||opisFazy(faza,typWymiany);
          return (
            <div key={faza} style={{marginBottom:12,background:"rgba(0,0,0,0.15)",border:`1px solid ${e.k}33`,borderRadius:10,overflow:"hidden"}}>
              <div style={{padding:"8px 14px",background:`${e.k}15`,color:e.k,fontWeight:"bold",fontSize:12,borderBottom:`1px solid ${e.k}25`}}>{e.t}</div>
              {w.map((x,i)=>{
                  const globalIdx=wynik.planoweWymiany.indexOf(x);
                  const pokazujPodmien=podmienDawce?.globalIdx===globalIdx;
                  const alternatywy=pokazujPodmien?znajdzAlternatywe(x.od):[];
                  return (
                    <div key={i}>
                      <div style={{padding:"8px 14px",borderBottom:(!pokazujPodmien&&i<w.length-1)?"1px solid #12122a":"none",display:"flex",flexWrap:"wrap",alignItems:"center",gap:8}}>
                        <span style={{background:"rgba(255,215,0,0.1)",border:"1px solid #b8860b",padding:"2px 8px",borderRadius:20,fontSize:12,color:"var(--accent)",fontWeight:"bold"}}>{x.od}</span>
                        <span style={{color:"#444"}}>→</span>
                        <span style={{background:`${e.k}18`,border:`1px solid ${e.k}`,padding:"2px 8px",borderRadius:20,fontSize:12,color:e.k,fontWeight:"bold"}}>{x.do}</span>
                        <span style={{fontSize:12,color:"var(--text)"}}><strong>{x.karta}</strong></span>
                        <span style={{fontSize:11,color:"#555"}}>[{x.talia}]</span>
                        {x.brakOCount>0&&<span style={{fontSize:10,color:"#87CEEB",background:"rgba(65,105,225,0.12)",padding:"1px 6px",borderRadius:10}}>jeszcze brak {x.brakOCount} {typWymiany==="złote"?"💎":"⭐"}</span>}
                        {x.trudna&&<span style={{fontSize:10,color:"#f55"}}>⚠️trudna</span>}
                        {x.bliskoProg&&x.progBonus>0&&<span style={{fontSize:10,color:"#fa0",background:"rgba(255,165,0,0.15)",padding:"1px 6px",borderRadius:10,border:"1px solid #fa055"}}>🎯 +{x.progBonus.toLocaleString()} próg!</span>}
                        <span style={{fontSize:11,color:"#fa0"}}>🎯{x.nagroda?.toLocaleString()}</span>
                        <div style={{marginLeft:"auto",display:"flex",gap:4}}>
                          <button onClick={()=>setPodmienDawce(pokazujPodmien?null:{globalIdx,dawca:x.od})} style={{
                            padding:"2px 8px",background:pokazujPodmien?"rgba(255,215,0,0.2)":"rgba(255,165,0,0.1)",
                            border:`1px solid ${pokazujPodmien?"var(--accent)":"#fa055"}`,borderRadius:4,
                            color:pokazujPodmien?"var(--accent)":"#fa0",cursor:"pointer",fontSize:10,
                          }}>🔄 Podmień</button>
                          <button onClick={()=>usunWymiane(globalIdx)} style={{
                            padding:"2px 6px",background:"rgba(255,50,50,0.1)",border:"none",
                            borderRadius:4,color:"#f5544488",cursor:"pointer",fontSize:10,
                          }}>✕</button>
                        </div>
                      </div>
                      {pokazujPodmien&&(
                        <div style={{padding:"8px 14px",background:"rgba(255,165,0,0.05)",borderBottom:i<w.length-1?"1px solid #12122a":"none"}}>
                          <div style={{fontSize:11,color:"#fa0",marginBottom:6}}>
                            🔄 Alternatywne wymiany dla <strong>{x.od}</strong> — karta wpadła odbiorcy z paczki?
                          </div>
                          {alternatywy.length===0?(
                            <div style={{fontSize:11,color:"var(--muted)"}}>Brak alternatyw — {x.od} nie ma innych duplikatów które ktoś potrzebuje (faza ≤20)</div>
                          ):alternatywy.map((alt,ai)=>{
                            const zamknieTalie = alt.faza===1 && alt.brakOCount===0;
                            const progInfo = alt.nastepnyProg ? ` 🎯+${alt.ammoProg?.toLocaleString()} próg!` : "";
                            return (
                            <div key={ai} style={{
                              display:"flex",alignItems:"center",gap:6,
                              padding:"6px 8px",marginBottom:3,borderRadius:6,flexWrap:"wrap",
                              background: zamknieTalie
                                ? "rgba(0,200,100,0.08)"
                                : alt.faza<=2 ? "rgba(255,165,0,0.05)" : "rgba(255,255,255,0.02)",
                              border: zamknieTalie
                                ? "1px solid #0c633"
                                : alt.faza<=2 ? "1px solid #fa055" : "1px solid #1a1a2e",
                            }}>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",marginBottom:2}}>
                                  <strong style={{fontSize:12,color:"var(--text)"}}>{alt.do}</strong>
                                  <span style={{fontSize:10,color:"var(--muted)"}}>← {alt.karta}</span>
                                  <span style={{fontSize:10,color:"#555"}}>[{alt.talia}]</span>
                                </div>
                                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                                  {zamknieTalie?(
                                    <span style={{fontSize:11,fontWeight:"bold",color:"#0c6",background:"rgba(0,200,100,0.12)",padding:"1px 6px",borderRadius:4}}>
                                      🎉 ZAMKNIE TALIĘ +{alt.nagroda?.toLocaleString()} 💰
                                    </span>
                                  ):(()=>{
                                    const brakT2 = alt.brakTCount||1;
                                    const brakO2 = alt.brakOCount||0;
                                    const maKomplet = brakO2===0;
                                    const ikona = brakT2===1?"🟢":brakT2===2?"🟡":"🔴";
                                    const kolorT = brakT2===1?"#0c6":brakT2===2?"#fa0":"#f55";
                                    const opisBrak = brakT2===1?"Brakuje 1":brakT2===2?"Brakuje 2":brakT2===3?"Brakuje 3":`Brakuje ${brakT2}`;
                                    const opisOpp = maKomplet?" + komplet drugich":` + brakuje ${brakO2} drugich`;
                                    return (
                                      <span style={{fontSize:11,color:kolorT}}>
                                        {ikona} {opisBrak}{opisOpp}
                                      </span>
                                    );
                                  })()}
                                  {!zamknieTalie&&<span style={{fontSize:10,color:"var(--muted)"}}>💰{alt.nagroda?.toLocaleString()}</span>}
                                  {progInfo&&<span style={{fontSize:10,color:"#fa0",fontWeight:"bold"}}>{progInfo}</span>}
                                </div>
                              </div>
                              <button onClick={()=>podmienWymiane(globalIdx,alt)} style={{
                                flexShrink:0,padding:"4px 12px",
                                background: zamknieTalie?"linear-gradient(135deg,#0c6,#0fa)":"rgba(0,200,100,0.12)",
                                border:"1px solid #0c644",borderRadius:5,
                                color: zamknieTalie?"#000":"#0c6",
                                cursor:"pointer",fontSize:11,fontWeight:"bold",
                              }}>Wybierz</button>
                            </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}

        {wynik.nieobsluzone.length>0&&(
          <div style={{background:"rgba(255,165,0,0.06)",border:"1px solid #b8860b55",borderRadius:10,padding:14}}>
            <div style={{fontWeight:"bold",color:"#fa0",marginBottom:8,fontSize:13}}>⚠️ Potrzeby bez dawcy (brak duplikatów):</div>
            {wynik.nieobsluzone.map((p,i)=>(
              <div key={i} style={{fontSize:12,color:"#aaa",padding:"3px 0",borderBottom:"1px solid #12122a"}}>
                <span style={{color:"var(--accent)"}}>{p.osoba.nazwa}</span> potrzebuje <strong style={{color:"var(--text)"}}>{p.karta.nazwa}</strong> z <em>{p.talia.nazwa}</em>
                <span style={{color:"var(--muted)",marginLeft:6}}>(brakuje {p.brakTCount})</span>
              </div>
            ))}
          </div>
        )}
      </>}
    </div>
  );
}

function EdycjaTalii({talie,zapisz,talieEvent=[],zapiszEvent=()=>{}}) {
  const [wybranaIdx,setWybranaIdx]=useState(0);
  const [nowaKarta,setNowaKarta]=useState({nazwa:"",typ:"złota"});
  const [nowyModal,setNowyModal]=useState(false);
  const [nowaTalia,setNowaTalia]=useState({nazwa:"",numer:"",nagroda_amunicja:""});
  const [ocrMode,setOcrMode]=useState(false);
  const [ocrAnalizuje,setOcrAnalizuje]=useState(false);
  const [ocrWynik,setOcrWynik]=useState(null); // {talia, karty}
  const [ocrNumer,setOcrNumer]=useState("");
  const [ocrNagroda,setOcrNagroda]=useState("");
  const [ocrEvent,setOcrEvent]=useState(false); // czy zapisać jako eventową

  const analizujScreenTalii=async(e)=>{
    const file=e.target.files?.[0];
    if(!file) return;
    setOcrAnalizuje(true);
    setOcrWynik(null);
    const wynik=await analyzeDeckStructure(file);
    if(wynik.sukces){
      setOcrWynik(wynik.dane);
      setOcrNumer("");
      setOcrNagroda("");
    } else {
      alert("Błąd OCR: "+wynik.blad);
    }
    setOcrAnalizuje(false);
  };

  const zatwierdzeOcrTalie=()=>{
    if(!ocrWynik) return;
    const id=(ocrEvent?"event_":"")+ocrWynik.talia.toLowerCase().replace(/\s+/g,"_")+"_"+Date.now();
    const nowaTaliaOcr={
      id, nazwa:ocrWynik.talia,
      numer:parseInt(ocrNumer)||99,
      nagroda_amunicja:parseInt(ocrNagroda)||0,
      karty:ocrWynik.karty.map(k=>({nazwa:k.nazwa,typ:ocrEvent?"diamentowa":k.typ}))
    };
    if(ocrEvent){
      // Zapisz do talii eventowych
      const istnieje=talieEvent.find(t=>normalizuj(t.nazwa)===normalizuj(ocrWynik.talia));
      if(istnieje){
        if(!window.confirm(`Talia eventowa "${ocrWynik.talia}" już istnieje. Nadpisać karty?`)) return;
        zapiszEvent(talieEvent.map(t=>normalizuj(t.nazwa)===normalizuj(ocrWynik.talia)?{...t,karty:nowaTaliaOcr.karty}:t));
      } else {
        zapiszEvent([...talieEvent,nowaTaliaOcr]);
      }
    } else {
      // Zapisz do zwykłych talii
      const istnieje=talie.find(t=>normalizuj(t.nazwa)===normalizuj(ocrWynik.talia));
      if(istnieje){
        if(!window.confirm(`Talia "${ocrWynik.talia}" już istnieje. Nadpisać karty?`)) return;
        zapisz(talie.map(t=>normalizuj(t.nazwa)===normalizuj(ocrWynik.talia)?{...t,karty:nowaTaliaOcr.karty}:t));
      } else {
        zapisz([...talie,nowaTaliaOcr]);
      }
    }
    setOcrWynik(null);
    setOcrMode(false);
  };

  const sorted=[...talie].sort((a,b)=>(a.numer||99)-(b.numer||99));
  const talia=sorted[wybranaIdx];

  const dodajKarte=()=>{
    if(!nowaKarta.nazwa.trim()) return;
    zapisz(talie.map(t=>t.id===talia.id?{...t,karty:[...t.karty,{nazwa:nowaKarta.nazwa.trim(),typ:nowaKarta.typ}]}:t));
    setNowaKarta(k=>({...k,nazwa:""}));
  };
  const usunKarte=n=>zapisz(talie.map(t=>t.id===talia.id?{...t,karty:t.karty.filter(k=>k.nazwa!==n)}:t));
  const zmienTyp=(n,typ)=>zapisz(talie.map(t=>t.id===talia.id?{...t,karty:t.karty.map(k=>k.nazwa===n?{...k,typ}:k)}:t));
  const [edytujKarte,setEdytujKarte]=useState(null); // nazwa karty którą edytujemy
  const [tempNazwaKarty,setTempNazwaKarty]=useState("");
  const zmienNazweKarty=(stara,nowa)=>{
    const nowaNazwa=nowa.trim();
    if(!nowaNazwa||nowaNazwa===stara){setEdytujKarte(null);return;}
    if(talia.karty.find(k=>k.nazwa===nowaNazwa)){alert("Karta o tej nazwie już istnieje!");return;}
    zapisz(talie.map(t=>t.id===talia.id?{...t,karty:t.karty.map(k=>k.nazwa===stara?{...k,nazwa:nowaNazwa}:k)}:t));
    setEdytujKarte(null);
  };
  const zapiszPole=(pole,val)=>zapisz(talie.map(t=>{
    if(t.id!==talia.id) return t;
    if(pole.startsWith("nagroda_amunicja_k")&&(val===""||val===null||isNaN(parseInt(val)))){const kopia={...t};delete kopia[pole];return kopia;}
    return {...t,[pole]:pole==="numer"?parseInt(val)||t.numer:parseInt(val)||0};
  }));
  const dodajTalie=()=>{
    if(!nowaTalia.nazwa.trim()) return;
    const id=nowaTalia.nazwa.toLowerCase().replace(/\s+/g,"_")+"_"+Date.now();
    const nagrodyKregow={};
    [2,3,4,5].forEach(n=>{const v=parseInt(nowaTalia[`nagroda_amunicja_k${n}`]);if(!isNaN(v))nagrodyKregow[`nagroda_amunicja_k${n}`]=v;});
    zapisz([...talie,{id,nazwa:nowaTalia.nazwa.trim(),numer:parseInt(nowaTalia.numer)||99,nagroda_amunicja:parseInt(nowaTalia.nagroda_amunicja)||0,...nagrodyKregow,karty:[]}]);
    setNowaTalia({nazwa:"",numer:"",nagroda_amunicja:""});
    setNowyModal(false);
  };
  const usunTalie=id=>{
    if(!window.confirm("Usunąć tę talię?")) return;
    zapisz(talie.filter(t=>t.id!==id));
    setWybranaIdx(0);
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:14,fontWeight:"bold",color:"var(--accent)"}}>⚙️ Talie ({talie.length})</div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>{setOcrMode(!ocrMode);setOcrWynik(null);}} style={{padding:"6px 14px",background:ocrMode?"rgba(255,215,0,0.15)":"rgba(255,165,0,0.1)",border:`1px solid ${ocrMode?"var(--accent)":"#fa055"}`,borderRadius:8,color:ocrMode?"var(--accent)":"#fa0",cursor:"pointer",fontSize:12}}>📸 OCR nowej talii</button>
          <button onClick={()=>setNowyModal(true)} style={{padding:"6px 14px",background:"rgba(0,200,100,0.12)",border:"1px solid #0c655",borderRadius:8,color:"#0c6",cursor:"pointer",fontSize:12}}>+ Ręcznie</button>
        </div>
      </div>

      {/* Panel OCR nowej talii */}
      {ocrMode&&(
        <div style={{background:"rgba(255,165,0,0.06)",border:"1px solid #fa033",borderRadius:10,padding:14,marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:"bold",color:"#fa0",marginBottom:8}}>📸 OCR nowej talii — wgraj screen z ekranu talii</div>
          <div style={{fontSize:11,color:"var(--muted)",marginBottom:10}}>AI rozpozna nazwę talii i wszystkie 9 kart automatycznie. Potem ustawisz numer i nagrodę.</div>

          <input type="file" accept="image/*" onChange={analizujScreenTalii} disabled={ocrAnalizuje}
            style={{width:"100%",padding:8,background:"var(--card-solid)",border:"1px solid #333",borderRadius:6,color:"#fff",fontSize:12,marginBottom:8,boxSizing:"border-box"}}/>

          {ocrAnalizuje&&<div style={{textAlign:"center",padding:12,color:"#fa0",fontSize:12}}>🤖 Analizuję screen...</div>}

          {ocrWynik&&(
            <div style={{marginTop:10}}>
              <div style={{fontSize:13,fontWeight:"bold",color:"var(--accent)",marginBottom:8}}>
                ✅ Rozpoznano: <span style={{color:"#0c6"}}>{ocrWynik.talia}</span>
              </div>
              <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                <label style={{fontSize:11,color:"#aaa"}}>Numer talii:
                  <input type="number" value={ocrNumer} onChange={e=>setOcrNumer(e.target.value)} placeholder="np. 8"
                    style={{display:"block",marginTop:4,width:70,padding:"5px 8px",background:"var(--card-solid)",border:"1px solid #333",borderRadius:4,color:"#fff",fontSize:12}}/>
                </label>
                <label style={{fontSize:11,color:"#aaa"}}>Nagroda (amunicja):
                  <input type="number" value={ocrNagroda} onChange={e=>setOcrNagroda(e.target.value)} placeholder="np. 3500"
                    style={{display:"block",marginTop:4,width:90,padding:"5px 8px",background:"var(--card-solid)",border:"1px solid #333",borderRadius:4,color:"#fff",fontSize:12}}/>
                </label>
              </div>
              <div style={{marginBottom:10}}>
                {ocrWynik.karty.map((k,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0",borderBottom:"1px solid #12122a"}}>
                    <span style={{fontSize:10,color:k.typ==="złota"?"var(--accent)":"#87CEEB"}}>{k.typ==="złota"?"⭐":"💎"}</span>
                    <span style={{flex:1,fontSize:12,color:"var(--text)"}}>{k.nazwa}</span>
                    <select value={k.typ} onChange={e=>{const n=[...ocrWynik.karty];n[i]={...n[i],typ:e.target.value};setOcrWynik({...ocrWynik,karty:n});}}
                      style={{padding:"2px 5px",background:"var(--card-solid)",border:"1px solid #333",borderRadius:4,color:k.typ==="złota"?"var(--accent)":"#87CEEB",fontSize:11}}>
                      <option value="złota">⭐ Złota</option>
                      <option value="diamentowa">💎 Diamentowa</option>
                    </select>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,padding:"8px 12px",background:"rgba(0,230,118,0.06)",border:"1px solid #00e67633",borderRadius:8}}>
                <input type="checkbox" id="ocrEventChk" checked={ocrEvent} onChange={e=>setOcrEvent(e.target.checked)}
                  style={{width:16,height:16,cursor:"pointer",accentColor:"#00e676"}}/>
                <label htmlFor="ocrEventChk" style={{cursor:"pointer",fontSize:12,color:ocrEvent?"#00e676":"var(--muted)",fontWeight:ocrEvent?"bold":"normal"}}>
                  🎉 Zapisz jako talia <strong>EVENTOWA</strong>
                  {ocrEvent&&<span style={{fontSize:10,color:"#555",marginLeft:6}}>(wszystkie karty → diamentowe, zapis do gang/event)</span>}
                </label>
              </div>
              <button onClick={zatwierdzeOcrTalie} style={{width:"100%",padding:10,background:ocrEvent?"linear-gradient(135deg,#00e676,#0fa)":"linear-gradient(135deg,#0c6,#0fa)",border:"none",borderRadius:8,color:"#000",fontWeight:"bold",cursor:"pointer",fontSize:13}}>
                ✓ Zatwierdź i dodaj {ocrEvent?"talię eventową":"talię"}
              </button>
            </div>
          )}
        </div>
      )}

      {nowyModal&&(
        <div style={{background:"rgba(0,0,0,0.4)",border:"1px solid #0c655",borderRadius:10,padding:16,marginBottom:14}}>
          <div style={{fontWeight:"bold",color:"#0c6",marginBottom:10}}>Nowa talia</div>
          {[{p:"nazwa",l:"Nazwa"},{p:"numer",l:"Numer"},{p:"nagroda_amunicja",l:"Nagroda K1 (amunicja)"},{p:"nagroda_amunicja_k2",l:"Nagroda K2"},{p:"nagroda_amunicja_k3",l:"Nagroda K3"},{p:"nagroda_amunicja_k4",l:"Nagroda K4"},{p:"nagroda_amunicja_k5",l:"Nagroda K5"}].map(f=>(
            <input key={f.p} value={nowaTalia[f.p]||""} onChange={e=>setNowaTalia(n=>({...n,[f.p]:e.target.value}))} placeholder={f.l}
              style={{display:"block",width:"100%",marginBottom:8,padding:"8px 10px",background:"var(--card-solid)",border:`1px solid ${f.p==="nagroda_amunicja_k2"?"#da70d655":"#333"}`,borderRadius:6,color:f.p==="nagroda_amunicja_k2"?"#da70d6":"#fff",fontSize:13,boxSizing:"border-box"}}/>
          ))}
          <div style={{display:"flex",gap:8}}>
            <button onClick={dodajTalie} style={{padding:"8px 16px",background:"#0c6",border:"none",borderRadius:6,color:"#fff",cursor:"pointer",fontWeight:"bold"}}>Dodaj</button>
            <button onClick={()=>setNowyModal(false)} style={{padding:"8px 16px",background:"rgba(255,50,50,0.15)",border:"1px solid #f55",borderRadius:6,color:"#f55",cursor:"pointer"}}>Anuluj</button>
          </div>
        </div>
      )}

      <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:12}}>
        {sorted.map((t,i)=>(
          <button key={t.id} onClick={()=>setWybranaIdx(i)} style={{
            padding:"4px 9px",borderRadius:6,cursor:"pointer",fontSize:11,
            background:wybranaIdx===i?"rgba(255,215,0,0.12)":"var(--card)",
            border:wybranaIdx===i?"1px solid #ffd700":"1px solid var(--border)",
            color:wybranaIdx===i?"var(--accent)":"var(--muted)",
          }}>#{t.numer} {t.nazwa}</button>
        ))}
      </div>

      {talia&&(
        <div style={{background:"rgba(0,0,0,0.2)",border:"1px solid var(--border)",borderRadius:10,padding:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,flexWrap:"wrap",gap:8}}>
            <div style={{fontSize:15,fontWeight:"bold",color:"var(--accent)"}}>
              {talia.nazwa} <span style={{fontSize:12,color:"var(--muted)"}}>({talia.karty.length} kart)</span>
              <span style={{fontSize:11,color:"var(--accent)",marginLeft:8}}>K1: {(talia.nagroda_amunicja||0).toLocaleString()} 💰</span>
              {[2,3,4,5].map(n=>talia[`nagroda_amunicja_k${n}`]!==undefined&&<span key={n} style={{fontSize:11,color:"#da70d6",marginLeft:6}}>K{n}: {Number(talia[`nagroda_amunicja_k${n}`]).toLocaleString()} 💜</span>)}
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
              <label style={{fontSize:11,color:"#aaa"}}>Nr: <input key={`nr-${talia.id}`} type="number" defaultValue={talia.numer} onBlur={e=>zapiszPole("numer",e.target.value)} style={{width:45,padding:"3px 5px",background:"var(--card-solid)",border:"1px solid #333",borderRadius:4,color:"#fff",fontSize:11}}/></label>
              <label style={{fontSize:11,color:"#aaa"}}>
                K1 💰: <input key={`k1-${talia.id}`} type="number" defaultValue={talia.nagroda_amunicja} onBlur={e=>zapiszPole("nagroda_amunicja",e.target.value)} style={{width:65,padding:"3px 5px",background:"var(--card-solid)",border:"1px solid #333",borderRadius:4,color:"var(--accent)",fontSize:11}}/>
              </label>
              <label style={{fontSize:11,color:"#aaa"}}>
                K2 💜: <input key={`k2-${talia.id}`} type="number" defaultValue={talia.nagroda_amunicja_k2??""} placeholder="K2" onBlur={e=>zapiszPole("nagroda_amunicja_k2",e.target.value)} style={{width:65,padding:"3px 5px",background:"var(--card-solid)",border:"1px solid #da70d655",borderRadius:4,color:"#da70d6",fontSize:11}}/>
              </label>
              <label style={{fontSize:11,color:"#aaa"}}>
                K3 💜: <input key={`k3-${talia.id}`} type="number" defaultValue={talia.nagroda_amunicja_k3??""} placeholder="K3" onBlur={e=>zapiszPole("nagroda_amunicja_k3",e.target.value)} style={{width:65,padding:"3px 5px",background:"var(--card-solid)",border:"1px solid #da70d655",borderRadius:4,color:"#da70d6",fontSize:11}}/>
              </label>
              <label style={{fontSize:11,color:"#aaa"}}>
                K4 💜: <input key={`k4-${talia.id}`} type="number" defaultValue={talia.nagroda_amunicja_k4??""} placeholder="K4" onBlur={e=>zapiszPole("nagroda_amunicja_k4",e.target.value)} style={{width:65,padding:"3px 5px",background:"var(--card-solid)",border:"1px solid #da70d655",borderRadius:4,color:"#da70d6",fontSize:11}}/>
              </label>
              <label style={{fontSize:11,color:"#aaa"}}>
                K5 💜: <input key={`k5-${talia.id}`} type="number" defaultValue={talia.nagroda_amunicja_k5??""} placeholder="K5" onBlur={e=>zapiszPole("nagroda_amunicja_k5",e.target.value)} style={{width:65,padding:"3px 5px",background:"var(--card-solid)",border:"1px solid #da70d655",borderRadius:4,color:"#da70d6",fontSize:11}}/>
              </label>
              <button onClick={()=>usunTalie(talia.id)} style={{padding:"4px 10px",background:"rgba(255,50,50,0.12)",border:"1px solid #f5544455",borderRadius:6,color:"#f55",cursor:"pointer",fontSize:11}}>🗑 Usuń</button>
            </div>
          </div>
          {talia.karty.map((k,ki)=>(
            <div key={ki} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 0",borderBottom:"1px solid #12122a"}}>
              {edytujKarte===k.nazwa?(
                <input
                  autoFocus
                  value={tempNazwaKarty}
                  onChange={e=>setTempNazwaKarty(e.target.value)}
                  onBlur={()=>zmienNazweKarty(k.nazwa,tempNazwaKarty)}
                  onKeyDown={e=>{
                    if(e.key==="Enter") zmienNazweKarty(k.nazwa,tempNazwaKarty);
                    if(e.key==="Escape"){setEdytujKarte(null);}
                  }}
                  style={{flex:1,padding:"3px 8px",background:"#1a1a3a",border:"1px solid #ffd700",borderRadius:4,color:"#fff",fontSize:12}}
                />
              ):(
                <span
                  onClick={()=>{setEdytujKarte(k.nazwa);setTempNazwaKarty(k.nazwa);}}
                  title="Kliknij żeby edytować nazwę"
                  style={{flex:1,fontSize:12,color:"#ccc",cursor:"text",padding:"2px 4px",borderRadius:3,transition:"background 0.15s"}}
                  onMouseEnter={e=>e.target.style.background="rgba(255,215,0,0.07)"}
                  onMouseLeave={e=>e.target.style.background="transparent"}
                >
                  {k.nazwa} <span style={{fontSize:9,color:"#444",marginLeft:2}}>✏️</span>
                </span>
              )}
              <select value={k.typ} onChange={e=>zmienTyp(k.nazwa,e.target.value)} style={{padding:"3px 6px",background:"var(--card-solid)",border:"1px solid #333",borderRadius:4,color:k.typ==="złota"?"var(--accent)":"#87CEEB",fontSize:11,cursor:"pointer"}}>
                <option value="złota">⭐ Złota</option>
                <option value="diamentowa">💎 Diamentowa</option>
              </select>
              <button onClick={()=>usunKarte(k.nazwa)} style={{padding:"2px 8px",background:"rgba(255,50,50,0.1)",border:"none",borderRadius:4,color:"#f5544488",cursor:"pointer",fontSize:11}}>✕</button>
            </div>
          ))}
          <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
            <input value={nowaKarta.nazwa} onChange={e=>setNowaKarta(k=>({...k,nazwa:e.target.value}))} placeholder="Nazwa karty"
              onKeyDown={e=>e.key==="Enter"&&dodajKarte()}
              style={{flex:1,minWidth:120,padding:"7px 10px",background:"var(--card-solid)",border:"1px solid #333",borderRadius:6,color:"#fff",fontSize:12}}/>
            <select value={nowaKarta.typ} onChange={e=>setNowaKarta(k=>({...k,typ:e.target.value}))} style={{padding:"7px 8px",background:"var(--card-solid)",border:"1px solid #333",borderRadius:6,color:nowaKarta.typ==="złota"?"var(--accent)":"#87CEEB",fontSize:12,cursor:"pointer"}}>
              <option value="złota">⭐ Złota</option>
              <option value="diamentowa">💎 Diamentowa</option>
            </select>
            <button onClick={dodajKarte} style={{padding:"7px 14px",background:"rgba(0,200,100,0.12)",border:"1px solid #0c655",borderRadius:6,color:"#0c6",cursor:"pointer",fontWeight:"bold",fontSize:12}}>+ Dodaj</button>
          </div>
        </div>
      )}
    </div>
  );
}

function EdycjaCzlonkow({czlonkowie,zapisz}) {
  const zapiszKrag = (id, krag) => zapisz(czlonkowie.map(c => c.id===id ? {...c, krag: parseInt(krag)||1} : c));
  const zapiszKragEvent = (id, krag) => zapisz(czlonkowie.map(c => c.id===id ? {...c, kragEvent: parseInt(krag)||1} : c));
  const [nowyNick,setNowyNick]=useState("");
  const [edytujId,setEdytujId]=useState(null);
  const [tempNazwa,setTempNazwa]=useState("");

  const dodaj=()=>{
    if(!nowyNick.trim()) return;
    zapisz([...czlonkowie,{id:Date.now(),nazwa:nowyNick.trim()}]);
    setNowyNick("");
  };
  const usun=id=>{
    if(!window.confirm("Usunąć?")) return;
    zapisz(czlonkowie.filter(c=>c.id!==id));
  };
  const zapiszN=id=>{
    zapisz(czlonkowie.map(c=>c.id===id?{...c,nazwa:tempNazwa}:c));
    setEdytujId(null);
  };
  const przesun=(idx,kierunek)=>{
    const nowe=[...czlonkowie];
    const doIdx=idx+kierunek;
    if(doIdx<0||doIdx>=nowe.length) return;
    [nowe[idx],nowe[doIdx]]=[nowe[doIdx],nowe[idx]];
    zapisz(nowe);
  };

  const RANGI=[
    {min:1,max:1,ikona:"👑",nazwa:"Lider"},
    {min:2,max:3,ikona:"⚔️",nazwa:"Zastępca"},
    {min:4,max:6,ikona:"🔥",nazwa:"Kapitan"},
    {min:7,max:10,ikona:"💪",nazwa:"Weteran"},
    {min:11,max:15,ikona:"🛡️",nazwa:"Żołnierz"},
    {min:16,max:99,ikona:"🥾",nazwa:"Rekrut"},
  ];
  const rangaDla=(idx)=>RANGI.find(r=>idx+1>=r.min&&idx+1<=r.max)||RANGI[RANGI.length-1];

  return (
    <div>
      <div style={{fontSize:14,fontWeight:"bold",color:"var(--accent)",marginBottom:4}}>👥 Członkowie ({czlonkowie.length})</div>
      <div style={{fontSize:11,color:"var(--muted)",marginBottom:12}}>Użyj ▲▼ żeby ustawić kolejność według poziomu w grze. Kolejność wpływa na rangi.</div>
      {czlonkowie.map((c,i)=>{
        const ranga=rangaDla(i);
        return (
          <div key={c.id} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 0",borderBottom:"1px solid #12122a"}}>
            {/* Przyciski góra/dół */}
            <div style={{display:"flex",flexDirection:"column",gap:1}}>
              <button onClick={()=>przesun(i,-1)} disabled={i===0} style={{padding:"0 5px",background:"none",border:"none",color:i===0?"#222":"var(--muted)",cursor:i===0?"default":"pointer",fontSize:10,lineHeight:1.2}}>▲</button>
              <button onClick={()=>przesun(i,1)} disabled={i===czlonkowie.length-1} style={{padding:"0 5px",background:"none",border:"none",color:i===czlonkowie.length-1?"#222":"var(--muted)",cursor:i===czlonkowie.length-1?"default":"pointer",fontSize:10,lineHeight:1.2}}>▼</button>
            </div>
            {/* Ranga */}
            <span title={ranga.nazwa} style={{fontSize:14,width:20,textAlign:"center"}}>{ranga.ikona}</span>
            <span style={{fontSize:11,color:"#555",width:20}}>{i+1}.</span>
            {edytujId===c.id?(
              <>
                <input value={tempNazwa} onChange={e=>setTempNazwa(e.target.value)} onKeyDown={e=>e.key==="Enter"&&zapiszN(c.id)}
                  style={{flex:1,padding:"5px 8px",background:"var(--card-solid)",border:"1px solid #ffd700",borderRadius:5,color:"#fff",fontSize:13}}/>
                <button onClick={()=>zapiszN(c.id)} style={{padding:"5px 10px",background:"var(--accent)",border:"none",borderRadius:5,cursor:"pointer",fontSize:12,color:"#000",fontWeight:"bold"}}>OK</button>
              </>
            ):(
              <>
                <span style={{flex:1,fontSize:13,color:"var(--text)"}}>{c.nazwa}</span>
                {(c.krag||1) > 1 && (
                  <span style={{fontSize:10,padding:"1px 6px",background:"rgba(138,43,226,0.2)",border:"1px solid #8a2be255",borderRadius:10,color:"#da70d6",fontWeight:"bold"}}>
                    K{c.krag||1}
                  </span>
                )}
                <span style={{fontSize:10,color:"#555"}}>{ranga.nazwa}</span>
                {/* Selector kręgu */}
                <select value={c.krag||1} onChange={e=>zapiszKrag(c.id,e.target.value)}
                  style={{padding:"2px 4px",background:"var(--card-solid)",border:"1px solid #333",borderRadius:4,color:"#aaa",fontSize:10,cursor:"pointer"}}>
                  <option value={1}>K1</option>
                  <option value={2}>K2</option>
                  <option value={3}>K3</option>
                  <option value={4}>K4</option>
                  <option value={5}>K5</option>
                </select>
                {/* Krąg w evencie (osobny od zwykłych kart) */}
                <select value={c.kragEvent||1} onChange={e=>zapiszKragEvent(c.id,e.target.value)} title="Krąg w evencie"
                  style={{padding:"2px 4px",background:"var(--card-solid)",border:"1px solid #00e67655",borderRadius:4,color:"#00e676",fontSize:10,cursor:"pointer"}}>
                  <option value={1}>🎉K1</option>
                  <option value={2}>🎉K2</option>
                  <option value={3}>🎉K3</option>
                </select>
                <button onClick={()=>{setEdytujId(c.id);setTempNazwa(c.nazwa);}} style={{padding:"3px 8px",background:"rgba(255,215,0,0.08)",border:"1px solid #b8860b33",borderRadius:5,color:"#b8860b",cursor:"pointer",fontSize:11}}>✏️</button>
                <button onClick={()=>usun(c.id)} style={{padding:"3px 8px",background:"rgba(255,50,50,0.08)",border:"1px solid #f5544433",borderRadius:5,color:"#f5544488",cursor:"pointer",fontSize:11}}>🗑</button>
              </>
            )}
          </div>
        );
      })}
      <div style={{display:"flex",gap:8,marginTop:14}}>
        <input value={nowyNick} onChange={e=>setNowyNick(e.target.value)} placeholder="Nick nowego członka"
          onKeyDown={e=>e.key==="Enter"&&dodaj()}
          style={{flex:1,padding:"8px 10px",background:"var(--card-solid)",border:"1px solid #333",borderRadius:6,color:"#fff",fontSize:13}}/>
        <button onClick={dodaj} style={{padding:"8px 16px",background:"rgba(0,200,100,0.12)",border:"1px solid #0c655",borderRadius:6,color:"#0c6",cursor:"pointer",fontWeight:"bold",fontSize:13}}>+ Dodaj</button>
      </div>
      <div style={{marginTop:14,padding:10,background:"rgba(0,0,0,0.2)",borderRadius:8}}>
        <div style={{fontSize:11,color:"var(--muted)",marginBottom:6}}>Rangi według pozycji:</div>
        {RANGI.map((r,i)=>(
          <div key={i} style={{fontSize:11,color:"#555",padding:"1px 0"}}>
            {r.ikona} <span style={{color:"var(--muted)"}}>{r.nazwa}</span> — pozycja {r.min}{r.max<99?`-${r.max}`:`+`}
          </div>
        ))}
      </div>
    </div>
  );
}

function DuplikatyView({talie,czlonkowie,duplikaty}) {
  const [szukaj,setSzukaj]=useState("");
  const [filtrTyp,setFiltrTyp]=useState("wszystkie"); // wszystkie | złota | diamentowa
  const [filtrTalia,setFiltrTalia]=useState("wszystkie");

  // Zbierz wszystkie duplikaty w jeden flat list
  const wszystkieDup=[];
  talie.forEach(talia=>{
    talia.karty.forEach(karta=>{
      const posiadacze=[];
      czlonkowie.forEach(czl=>{
        const val=duplikaty[`${czl.id}_${talia.id}_${karta.nazwa}`];
        // Duplikaty mogą być zapisane jako true (1 dup) lub liczba (2,3...)
        const ile = val===true ? 1 : (parseInt(val)||0);
        if(ile>0) posiadacze.push({nick:czl.nazwa,ile});
      });
      if(posiadacze.length>0){
        wszystkieDup.push({
          taliaNazwa:talia.nazwa,taliaId:talia.id,taliaNum:talia.numer,
          kartaNazwa:karta.nazwa,kartaTyp:karta.typ,
          posiadacze,
          lacznie:posiadacze.reduce((s,p)=>s+p.ile,0),
        });
      }
    });
  });

  // Filtruj
  const frazy=szukaj.split("\n").map(l=>normalizuj(l.trim())).filter(l=>l.length>0);
  const filtered=wszystkieDup.filter(d=>{
    if(filtrTyp!=="wszystkie"&&d.kartaTyp!==filtrTyp) return false;
    if(filtrTalia!=="wszystkie"&&d.taliaId!==filtrTalia) return false;
    if(frazy.length>0){
      const pasuje=frazy.some(f=>
        normalizuj(d.kartaNazwa).includes(f)||
        normalizuj(d.taliaNazwa).includes(f)||
        d.posiadacze.some(p=>normalizuj(p.nick).includes(f))
      );
      if(!pasuje) return false;
    }
    return true;
  }).sort((a,b)=>b.lacznie-a.lacznie);

  const lacznie=filtered.reduce((s,d)=>s+d.lacznie,0);

  return (
    <div>
      <div style={{background:"rgba(255,215,0,0.06)",border:"1px solid #b8860b33",borderRadius:8,padding:"10px 14px",marginBottom:14}}>
        <div style={{fontSize:14,fontWeight:"bold",color:"var(--accent)",marginBottom:2}}>🔄 Wszystkie duplikaty w gangu</div>
        <div style={{fontSize:11,color:"#aaa"}}>Karty które ktoś posiada w nadmiarze i może wysłać innym</div>
      </div>

      {/* Filtry */}
      <div style={{background:"rgba(0,0,0,0.25)",border:"1px solid var(--border)",borderRadius:10,padding:12,marginBottom:12}}>
        <textarea
          value={szukaj} onChange={e=>setSzukaj(e.target.value)}
          placeholder={"🔍 Wpisz nazwy kart — każda w osobnej linii:\n\nWystępy mimów\nAkrobatyczne popisy\nSztuka kredowa"}
          rows={4}
          style={{width:"100%",padding:"8px 12px",background:"var(--card-solid)",border:"1px solid #333",borderRadius:6,color:"#fff",fontSize:12,marginBottom:10,boxSizing:"border-box",resize:"vertical",fontFamily:"inherit",lineHeight:1.5}}
        />
        <div style={{fontSize:10,color:"#555",marginBottom:10}}>
          💡 Jedna nazwa per linijka — znajdzie karty pasujące do którejkolwiek z wpisanych fraz
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {[
            {id:"wszystkie",label:"Wszystkie"},
            {id:"złota",label:"⭐ Złote"},
            {id:"diamentowa",label:"💎 Diamentowe"},
          ].map(f=>(
            <button key={f.id} onClick={()=>setFiltrTyp(f.id)} style={{
              padding:"4px 12px",borderRadius:20,fontSize:11,cursor:"pointer",
              background:filtrTyp===f.id?"rgba(255,215,0,0.15)":"var(--card)",
              border:filtrTyp===f.id?"1px solid #ffd700":"1px solid var(--border)",
              color:filtrTyp===f.id?"var(--accent)":"var(--muted)",
            }}>{f.label}</button>
          ))}
          <select value={filtrTalia} onChange={e=>setFiltrTalia(e.target.value)} style={{
            padding:"4px 10px",borderRadius:20,fontSize:11,cursor:"pointer",
            background:"var(--card)",border:"1px solid var(--border)",color:"var(--muted)",
            outline:"none",
          }}>
            <option value="wszystkie">Wszystkie talie</option>
            {talie.map(t=><option key={t.id} value={t.id}>#{t.numer} {t.nazwa}</option>)}
          </select>
        </div>
      </div>

      {/* Statystyki */}
      <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap"}}>
        <div style={{background:"rgba(255,215,0,0.08)",border:"1px solid #b8860b44",borderRadius:8,padding:"8px 14px",flex:1,minWidth:100}}>
          <div style={{fontSize:18,fontWeight:"bold",color:"var(--accent)"}}>{filtered.length}</div>
          <div style={{fontSize:10,color:"var(--muted)"}}>różnych kart</div>
        </div>
        <div style={{background:"rgba(0,200,100,0.08)",border:"1px solid #0c644",borderRadius:8,padding:"8px 14px",flex:1,minWidth:100}}>
          <div style={{fontSize:18,fontWeight:"bold",color:"#0c6"}}>{lacznie}</div>
          <div style={{fontSize:10,color:"var(--muted)"}}>duplikatów łącznie</div>
        </div>
      </div>

      {/* Lista duplikatów */}
      {filtered.length===0?(
        <div style={{textAlign:"center",padding:40,color:"#555"}}>
          <div style={{fontSize:32,marginBottom:8}}>🔍</div>
          <div style={{fontSize:13}}>Brak duplikatów{frazy.length>0?` dla ${frazy.length} ${frazy.length===1?"frazy":"fraz"}`:""}</div>
        </div>
      ):(
        filtered.map((d,i)=>(
          <div key={i} style={{background:"rgba(0,0,0,0.25)",border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px",marginBottom:6}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
              <span style={{fontSize:10,color:d.kartaTyp==="złota"?"var(--accent)":"#87CEEB"}}>
                {d.kartaTyp==="złota"?"⭐":"💎"}
              </span>
              <span style={{flex:1,fontSize:13,fontWeight:"bold",color:"var(--text)"}}>{d.kartaNazwa}</span>
              <span style={{fontSize:11,color:"var(--muted)"}}>#{d.taliaNum} {d.taliaNazwa}</span>
              <span style={{
                fontSize:12,fontWeight:"bold",padding:"2px 10px",borderRadius:12,
                background:"rgba(0,200,100,0.15)",border:"1px solid #0c644",color:"#0c6",
              }}>×{d.lacznie}</span>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {d.posiadacze.map((p,j)=>(
                <span key={j} style={{
                  fontSize:11,padding:"3px 10px",borderRadius:14,
                  background:"var(--card)",border:"1px solid var(--border)",color:"#bbb",
                }}>
                  {p.nick}
                  {p.ile>1&&<span style={{marginLeft:4,color:"var(--accent)",fontWeight:"bold"}}>×{p.ile}</span>}
                </span>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function AktywnaWymiana({aktywnaWymiana,zalogowany,czlonkowie,talie,posiadane,duplikaty,typWymiany,isAdmin,zapiszAktywna,zapiszKarte}) {
  const [zamykanie,setZamykanie]=useState(false);
  const [podmienIdx,setPodmienIdx]=useState(null);
  const [streak, setStreak] = useState(0);

  const loginLowerHook = normalizuj(zalogowany.login);
  useEffect(() => {
    if (!aktywnaWymiana) return;
    const wymianyNick = Object.keys(
      (aktywnaWymiana.wymiany||[]).reduce((acc,w)=>{acc[w.od]=1;return acc;},{})
    ).find(nick => normalizuj(nick) === loginLowerHook) || zalogowany.login;
    pobierzHistorieWymian().then(historia => {
      let s = 0;
      for (const w of historia) {
        const kPotw = Object.keys(w.potwierdzone||{}).find(k => normalizuj(k) === normalizuj(wymianyNick));
        if (kPotw && w.potwierdzone[kPotw]) s++;
        else break;
      }
      setStreak(s);
    }).catch(()=>{});
  }, [aktywnaWymiana, loginLowerHook, zalogowany.login]); // eslint-disable-line react-hooks/exhaustive-deps

  if(!aktywnaWymiana) return (
    <div style={{textAlign:"center",padding:50,color:"#555"}}>
      <div style={{fontSize:40,marginBottom:10}}>📭</div>
      <div style={{fontSize:14,color:"var(--muted)"}}>Brak aktywnej wymiany</div>
      <div style={{fontSize:11,color:"#555",marginTop:6}}>Admin generuje wymianę w zakładce ⚡ Generuj i publikuje ją tutaj</div>
    </div>
  );

  const {wymiany,data,potwierdzone={}} = aktywnaWymiana;
  const typAkt=aktywnaWymiana.typWymiany||typWymiany;

  // Dopasowanie nicku bez uwzględnienia wielkości liter
  const loginLower = normalizuj(zalogowany.login);
  const mojNick = Object.keys(
    wymiany.reduce((acc,w)=>{acc[w.od]=1;return acc;},{})
  ).find(nick => normalizuj(nick) === loginLower) || zalogowany.login;
  // Klucz potwierdzenia też szukamy case-insensitive + bez polskich znaków
  const mojKluczPotw = Object.keys(potwierdzone)
    .find(k => normalizuj(k) === loginLower) || zalogowany.login;

  const czyPotwierdzilem=potwierdzone[mojKluczPotw];
  const poNadawcach={};
  wymiany.forEach((w,i)=>{
    if(!poNadawcach[w.od]) poNadawcach[w.od]=[];
    poNadawcach[w.od].push({...w,_idx:i});
  });
  const mojePozycje = poNadawcach[mojNick];
  const potwierdzonychCount=Object.keys(potwierdzone).filter(k=>potwierdzone[k]).length;


  const wszystkichNadawcow=Object.keys(poNadawcach).length;

  const potwierdz=async()=>{
    zapiszAutoBackup("potwierdzenie");
    // Efekty
    playSound("success");
    launchConfetti(2000);
    // 1. Oznacz jako potwierdzone
    await zapiszAktywna({...aktywnaWymiana,potwierdzone:{...potwierdzone,[mojNick]:true}});

    // 2. Automatycznie zaznacz kartę jako posiadaną przez odbiorcę w danych gangu
    if(mojePozycje&&zapiszKarte){
      for(const w of mojePozycje){
        const odbiorca=czlonkowie.find(c=>normalizuj(c.nazwa)===normalizuj(w.do));
        const talia=talie.find(t=>normalizuj(t.nazwa)===normalizuj(w.talia));
        if(odbiorca&&talia){
          const karta=talia.karty.find(k=>normalizuj(k.nazwa)===normalizuj(w.karta));
          if(karta){
            const key=`${odbiorca.id}_${talia.id}_${karta.nazwa}`;
            if(!posiadane[key]) await zapiszKarte("posiadane", key, true);
          }
        }
      }
    }
  };
  const potwierdzeZaKogos=async(nadawca,wartoscPotw)=>{
    await zapiszAktywna({...aktywnaWymiana,potwierdzone:{...potwierdzone,[nadawca]:wartoscPotw}});
    // Jeśli admin potwierdza (nie cofa) — zaznacz kartę w danych gangu
    if(wartoscPotw&&zapiszKarte){
      const wymianyNadawcy=poNadawcach[nadawca]||[];
      for(const w of wymianyNadawcy){
        const odbiorca=czlonkowie.find(c=>normalizuj(c.nazwa)===normalizuj(w.do));
        const talia=talie.find(t=>normalizuj(t.nazwa)===normalizuj(w.talia));
        if(odbiorca&&talia){
          const karta=talia.karty.find(k=>normalizuj(k.nazwa)===normalizuj(w.karta));
          if(karta){
            const key=`${odbiorca.id}_${talia.id}_${karta.nazwa}`;
            if(!posiadane[key]) await zapiszKarte("posiadane", key, true);
          }
        }
      }
    }
  };
  const cofnijPotwierdzenie=async()=>{
    await zapiszAktywna({...aktywnaWymiana,potwierdzone:{...potwierdzone,[mojNick]:false}});
  };

  const zamknijWymiane=async()=>{
    if(!window.confirm("Zamknąć aktywną wymianę? Zniknie dla wszystkich.")) return;
    setZamykanie(true);
    await zapiszAktywna(null);
    setZamykanie(false);
  };

  // Znajdź alternatywy dla dawcy (karta wpadła z paczki)
  const znajdzAlternatywy=(dawcaNazwa,wykluczonaWymiana)=>{
    const dawca=czlonkowie.find(c=>c.nazwa===dawcaNazwa);
    if(!dawca||!talie) return [];
    const typ=typAkt==="złote"?"złota":"diamentowa";
    const oppTyp=typAkt==="złote"?"diamentowa":typAkt==="event"?null:"złota";

    // Zbuduj mapę: kto już dostaje jaką kartę (z pominięciem podmienianej wymiany)
    const juzOtrzymuje=new Set();
    // Symuluj posiadane PO wszystkich wymianach (bez podmienianej)
    const symPosiadane={...posiadane};
    wymiany.forEach((w,i)=>{
      if(i!==wykluczonaWymiana._idx){
        juzOtrzymuje.add(`${w.do}_${w.talia}_${w.karta}`);
        // Zaznacz kartę jako posiadaną w symulacji
        const odbiorca=czlonkowie.find(c=>c.nazwa===w.do);
        const talia=talie.find(t=>t.nazwa===w.talia);
        if(odbiorca&&talia){
          const karta=talia.karty.find(k=>k.nazwa===w.karta);
          if(karta) symPosiadane[`${odbiorca.id}_${talia.id}_${karta.nazwa}`]=true;
        }
      }
    });

    const kandydaci=[];
    czlonkowie.forEach(odbiorca=>{
      if(odbiorca.id===dawca.id) return;
      talie.forEach(talia=>{
        const kartyT=talia.karty.filter(k=>k.typ===typ);
        const kartyO=talia.karty.filter(k=>k.typ===oppTyp);
        const brakT=kartyT.filter(k=>!posiadane[`${odbiorca.id}_${talia.id}_${k.nazwa}`]);
        const brakO=kartyO.filter(k=>!posiadane[`${odbiorca.id}_${talia.id}_${k.nazwa}`]);
        brakT.forEach(karta=>{
          if(!duplikaty[`${dawca.id}_${talia.id}_${karta.nazwa}`]) return;
          if(juzOtrzymuje.has(`${odbiorca.nazwa}_${talia.nazwa}_${karta.nazwa}`)) return;
          const faza=obliczFaze(brakT.length,brakO.length,typWymiany);
          const zamknieTalie=brakT.length===1&&brakO.length===0;
          // Prog liczony PO wszystkich wymianach w planie (symulacja) — pomijany w evencie
          const liczbaPoWymianach=liczKartyOsoby(odbiorca.id,talie,symPosiadane);
          const liczbaPoTejKarcie=liczbaPoWymianach+(posiadane[`${odbiorca.id}_${talia.id}_${karta.nazwa}`]?0:1);
          let progBonus=0,brakujeDoProg=null,nastepnyProg=null;
          if(typAkt!=="event"){
            const progInfo=obliczProg(liczbaPoWymianach);
            const progPrzed=obliczProg(liczbaPoWymianach);
            const progPo=obliczProg(liczbaPoTejKarcie);
            const nowyProgTaKarta=progPo.ostatniProg?.prog>(progPrzed.ostatniProg?.prog||0);
            progBonus=nowyProgTaKarta?(progPo.ostatniProg?.ammo||0):0;
            brakujeDoProg=progInfo.brakujeDoProg;
            nastepnyProg=progInfo.nastepnyProg;
          }
          kandydaci.push({
            od:dawcaNazwa,do:odbiorca.nazwa,karta:karta.nazwa,talia:talia.nazwa,
            nagroda:pobierzNagrode(talia,odbiorca?.krag||1),faza,brakTCount:brakT.length,
            brakOCount:brakO.length,trudna:TRUDNE_NUMERY.includes(talia.numer),
            zamknieTalie,progBonus,brakujeDoProg,nastepnyProg,
          });
        });
      });
    });
    return kandydaci.sort((a,b)=>{
      if(b.zamknieTalie!==a.zamknieTalie) return (b.zamknieTalie?1:0)-(a.zamknieTalie?1:0);
      if(b.progBonus!==a.progBonus) return b.progBonus-a.progBonus;
      const fa=a.faza, fb=b.faza;
      if(fa!==fb) return fa-fb;
      if(b.nagroda!==a.nagroda) return b.nagroda-a.nagroda;
      return a.brakTCount-b.brakTCount;
    }).slice(0,8);
  };

  const podmienWymiane=async(staryIdx,nowaWymiana)=>{
    const noweWymiany=[...wymiany];
    noweWymiany[staryIdx]={...nowaWymiana};
    // Resetuj potwierdzenie dawcy bo musi wysłać inną kartę
    const nowePotwierdzone={...potwierdzone,[nowaWymiana.od]:false};
    await zapiszAktywna({...aktywnaWymiana,wymiany:noweWymiany,potwierdzone:nowePotwierdzone});
    setPodmienIdx(null);
  };

  const usunWymiane=async(idx)=>{
    const noweWymiany=wymiany.filter((_,i)=>i!==idx);
    await zapiszAktywna({...aktywnaWymiana,wymiany:noweWymiany});
    if(podmienIdx===idx) setPodmienIdx(null);
  };

  return (
    <div>
      {/* Badge typu wymiany */}
      <div style={{
        display:"flex",alignItems:"center",justifyContent:"center",gap:8,
        padding:"9px 14px",marginBottom:10,borderRadius:10,fontWeight:"bold",fontSize:13,
        ...(typAkt==="złote"
          ? {background:"linear-gradient(135deg,rgba(184,134,11,0.25),rgba(255,215,0,0.1))",border:"1px solid #ffd70055",color:"#ffd700"}
          : typAkt==="event"
          ? {background:"linear-gradient(135deg,rgba(0,200,100,0.2),rgba(0,230,118,0.1))",border:"1px solid #00e67655",color:"#00e676"}
          : {background:"linear-gradient(135deg,rgba(26,58,143,0.25),rgba(135,206,235,0.1))",border:"1px solid #87CEEB55",color:"#87CEEB"}
        )
      }}>
        {typAkt==="złote"?"⭐ WYMIANA ZŁOTYCH":typAkt==="event"?"🎉 WYMIANA EVENTOWA":"💎 WYMIANA DIAMENTOWYCH"}
      </div>
      {/* Nagłówek */}
      <div style={{background:"linear-gradient(135deg,rgba(0,200,100,0.1),rgba(0,100,50,0.1))",border:"1px solid #0c6",borderRadius:10,padding:14,marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
          <div>
            <div style={{fontSize:15,fontWeight:"bold",color:"#0c6"}}>📤 Aktywna wymiana</div>
            <div style={{fontSize:11,color:"var(--muted)",marginTop:2}}>
              {typAkt==="złote"?"⭐ Złote":"💎 Diamentowe"} • {new Date(data).toLocaleString("pl-PL")} • {wymiany.length} wymian
            </div>
          </div>
          {isAdmin&&(
            <div style={{display:"flex",gap:6}}>
              <button onClick={async()=>{
                const historia = await pobierzHistorieWymian();
                const wpis={
                  id:Date.now(),
                  data:aktywnaWymiana.data||new Date().toISOString(),
                  typWymiany:aktywnaWymiana.typWymiany,
                  wymiany:aktywnaWymiana.wymiany||[],
                  potwierdzone:aktywnaWymiana.potwierdzone||{},
                  potwierdzonychCount:Object.values(aktywnaWymiana.potwierdzone||{}).filter(Boolean).length,
                  lacznieWymian:(aktywnaWymiana.wymiany||[]).length,
                };
                await zapiszHistorieWymian([wpis,...historia].slice(0,50));
                alert("✅ Zarchiwizowano!");
              }} style={{padding:"5px 12px",background:"rgba(135,206,235,0.15)",border:"1px solid #87CEEB88",borderRadius:6,color:"#87CEEB",cursor:"pointer",fontSize:11}}>
                📥 Archiwizuj
              </button>
              <button onClick={zamknijWymiane} disabled={zamykanie} style={{padding:"5px 12px",background:"rgba(255,50,50,0.15)",border:"1px solid #f5544488",borderRadius:6,color:"#f55",cursor:"pointer",fontSize:11}}>
                {zamykanie?"⏳":"🗑"} Zamknij
              </button>
            </div>
          )}
        </div>
        <div style={{marginTop:12}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#aaa",marginBottom:4}}>
            <span>Potwierdzenia: <strong style={{color:"#0c6"}}>{potwierdzonychCount}</strong>/{wszystkichNadawcow}</span>
            <span>{Math.round((potwierdzonychCount/Math.max(1,wszystkichNadawcow))*100)}%</span>
          </div>
          <div style={{height:8,background:"rgba(0,0,0,0.3)",borderRadius:4,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${(potwierdzonychCount/Math.max(1,wszystkichNadawcow))*100}%`,background:"linear-gradient(90deg,#0c6,#0fa)",transition:"width 0.5s",borderRadius:4}}/>
          </div>
        </div>
      </div>

      {/* Tekst rozpiski */}
      <div style={{fontSize:11,color:"#555",fontStyle:"italic",marginBottom:8,padding:"5px 10px",background:"rgba(255,255,255,0.02)",borderRadius:5,borderLeft:"2px solid #333"}}>
        {TEKSTY_ROZPISKI[Math.floor(Date.now()/3600000)%TEKSTY_ROZPISKI.length]}
      </div>

      {/* Moja wymiana */}
      {mojePozycje?(
        <div style={{background:czyPotwierdzilem?"rgba(0,200,100,0.1)":"rgba(255,215,0,0.1)",border:`2px solid ${czyPotwierdzilem?"#0c6":"var(--accent)"}`,borderRadius:10,padding:14,marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
            <div style={{fontSize:13,fontWeight:"bold",color:czyPotwierdzilem?"#0c6":"var(--accent)",flex:1}}>
              {czyPotwierdzilem?"✅ Twoja wymiana — POTWIERDZONA":"👋 Twoja wymiana — wyślij kartę!"}
            </div>
            {streak>0&&(
              <div style={{
                fontSize:11,padding:"3px 10px",borderRadius:12,
                background:streak>=5?"linear-gradient(135deg,#b8860b,#ffd700)":streak>=3?"rgba(255,165,0,0.2)":"rgba(255,255,255,0.08)",
                border:streak>=5?"none":streak>=3?"1px solid #fa055":"1px solid #333",
                color:streak>=5?"#000":streak>=3?"#fa0":"var(--muted)",
                fontWeight:"bold",animation:streak>=5?"pulseGold 2s infinite":"none",
              }}>
                {streak>=10?"🔥":streak>=5?"⚡":streak>=3?"✨":""}
                {streak} wymian z rzędu
              </div>
            )}
          </div>
          {mojePozycje.map((w,i)=>(
            <div key={i} style={{fontSize:13,color:"var(--text)",padding:"5px 0",borderBottom:"1px solid #12122a"}}>
              Wyślij <strong style={{color:"var(--accent)"}}>{w.karta}</strong> do <strong style={{color:"#0c6"}}>{w.do}</strong>
              <span style={{fontSize:11,color:"var(--muted)",marginLeft:6}}>[{w.talia}]</span>
            </div>
          ))}
          <div style={{marginTop:12}}>
            {!czyPotwierdzilem?(
              <button onClick={potwierdz} style={{
                width:"100%",padding:12,
                background:"linear-gradient(135deg,#0c6,#0fa)",
                border:"none",borderRadius:8,color:"#000",fontSize:14,fontWeight:"bold",
                cursor:"pointer",
                animation:"pulseGreen 1.5s ease-in-out 5",
                boxShadow:"0 0 20px rgba(0,200,100,0.4)",
              }}>
                ✅ Potwierdzam — wysłałem kartę!
              </button>
            ):(
              <button onClick={cofnijPotwierdzenie} style={{width:"100%",padding:8,background:"var(--card)",border:"1px solid #333",borderRadius:8,color:"var(--muted)",fontSize:12,cursor:"pointer"}}>
                ↩️ Cofnij potwierdzenie
              </button>
            )}
          </div>
        </div>
      ):(
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:8,padding:12,marginBottom:14,textAlign:"center",fontSize:12,color:"var(--muted)"}}>
          Nie masz żadnej wymiany do wykonania w tej rundzie
        </div>
      )}

      {/* Status wszystkich — z podmianą dla admina */}
      <div style={{background:"rgba(0,0,0,0.25)",border:"1px solid var(--border)",borderRadius:10,padding:14}}>
        <div style={{fontSize:13,fontWeight:"bold",color:"var(--accent)",marginBottom:10}}>
          📋 Status wszystkich wysyłek
          {isAdmin&&<span style={{fontSize:10,color:"var(--muted)",fontWeight:"normal",marginLeft:8}}>— ✅/⏳ kliknij żeby zaznaczyć • 🔄 podmień jeśli karta wpadła z paczki</span>}
        </div>

        {Object.entries(poNadawcach).sort(([a],[b])=>(potwierdzone[b]?1:0)-(potwierdzone[a]?1:0)).map(([nadawca,ws])=>{
          const potw=potwierdzone[nadawca];
          return (
            <div key={nadawca} style={{background:potw?"rgba(0,200,100,0.06)":"rgba(255,255,255,0.02)",borderLeft:`3px solid ${potw?"#0c6":"#333"}`,borderRadius:6,marginBottom:6,overflow:"hidden"}}>
              {/* Nagłówek nadawcy */}
              <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px"}}>
                {isAdmin?(
                  <button onClick={()=>potwierdzeZaKogos(nadawca,!potw)}
                    style={{fontSize:16,background:"none",border:"none",cursor:"pointer",padding:0}}
                    title={potw?"Cofnij potwierdzenie":"Potwierdź za tę osobę"}>
                    {potw?"✅":"⏳"}
                  </button>
                ):(
                  <span style={{fontSize:16}}>{potw?"✅":"⏳"}</span>
                )}
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:"bold",color:potw?"#0c6":"#aaa"}}>{nadawca}</div>
                </div>
              </div>

              {/* Wymiany tego nadawcy */}
              {ws.map((w)=>{
                const pokazPodmien=podmienIdx===w._idx;
                const alternatywy=isAdmin&&pokazPodmien?znajdzAlternatywy(nadawca,w):[];
                return (
                  <div key={w._idx}>
                    <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px 5px 38px",borderTop:"1px solid #12122a",flexWrap:"wrap"}}>
                      <span style={{fontSize:11,color:"var(--muted)"}}>→</span>
                      <span style={{fontSize:12,color:"var(--text)",flex:1}}>
                        <strong style={{color:"var(--accent)"}}>{w.karta}</strong>
                        <span style={{color:"var(--muted)",fontSize:11}}> do </span>
                        <strong>{w.do}</strong>
                        <span style={{fontSize:10,color:"#555",marginLeft:6}}>[{w.talia}]</span>
                      </span>
                      {isAdmin&&(
                        <div style={{display:"flex",gap:4}}>
                          <button onClick={()=>setPodmienIdx(pokazPodmien?null:w._idx)} style={{
                            padding:"2px 8px",fontSize:10,borderRadius:4,cursor:"pointer",
                            background:pokazPodmien?"rgba(255,215,0,0.2)":"rgba(255,165,0,0.08)",
                            border:`1px solid ${pokazPodmien?"var(--accent)":"#fa055"}`,
                            color:pokazPodmien?"var(--accent)":"#fa0",
                          }}>🔄 Podmień</button>
                          <button onClick={()=>usunWymiane(w._idx)} style={{padding:"2px 6px",fontSize:10,borderRadius:4,cursor:"pointer",background:"rgba(255,50,50,0.08)",border:"none",color:"#f5544488"}}>✕</button>
                        </div>
                      )}
                    </div>

                    {/* Panel alternatyw */}
                    {isAdmin&&pokazPodmien&&(
                      <div style={{padding:"8px 10px 10px 38px",background:"rgba(255,165,0,0.05)",borderTop:"1px solid #fa022"}}>
                        <div style={{fontSize:11,color:"#fa0",marginBottom:6}}>
                          🔄 Karta <strong>{w.karta}</strong> wpadła {w.do} z paczki? Wybierz alternatywę dla <strong>{nadawca}</strong>:
                        </div>
                        {alternatywy.length===0?(
                          <div style={{fontSize:11,color:"#555"}}>Brak alternatyw — {nadawca} nie ma innych duplikatów których ktoś potrzebuje</div>
                        ):alternatywy.map((alt,ai)=>(
                          <div key={ai} style={{
                            display:"flex",alignItems:"center",gap:6,padding:"6px 0",
                            borderBottom:"1px solid #12122a22",flexWrap:"wrap",
                            background:alt.zamknieTalie?"rgba(0,200,100,0.05)":alt.progBonus?"rgba(255,165,0,0.03)":"transparent",
                          }}>
                            {alt.zamknieTalie&&(
                              <span style={{fontSize:10,padding:"2px 8px",borderRadius:8,background:"rgba(0,200,100,0.2)",border:"1px solid #0c6",color:"#0c6",fontWeight:"bold",width:"100%",marginBottom:2}}>
                                🏆 ZAMKNIE TALIĘ — +{alt.nagroda?.toLocaleString()} amunicji!
                              </span>
                            )}
                            {!alt.zamknieTalie&&alt.progBonus>0&&(
                              <span style={{fontSize:10,padding:"2px 8px",borderRadius:8,background:"rgba(255,165,0,0.15)",border:"1px solid #fa055",color:"#fa0",fontWeight:"bold",width:"100%",marginBottom:2}}>
                                🎯 PRÓG {alt.nastepnyProg?.prog} kart — brakuje {alt.brakujeDoProg} do progu (+{alt.progBonus.toLocaleString()} ammo)
                              </span>
                            )}
                            <span style={{fontSize:10,padding:"1px 6px",borderRadius:8,background:"var(--card)",color:opisFazy(alt.faza,typWymiany)?.k||"#aaa"}}>
                              F{Math.floor(alt.faza/10)}.{alt.faza%10||"0"}
                            </span>
                            <span style={{fontSize:11,flex:1,color:"var(--text)"}}>
                              <strong style={{color:"var(--accent)"}}>{alt.karta}</strong>
                              <span style={{color:"var(--muted)"}}> → {alt.do}</span>
                              <span style={{fontSize:10,color:"#555",marginLeft:4}}>[{alt.talia}]</span>
                            </span>
                            {!alt.zamknieTalie&&!alt.progBonus&&<span style={{fontSize:10,color:"#fa0"}}>🎯{alt.nagroda?.toLocaleString()}</span>}
                            <button onClick={()=>podmienWymiane(w._idx,alt)} style={{
                              padding:"3px 10px",fontSize:11,fontWeight:"bold",borderRadius:4,cursor:"pointer",
                              background:alt.zamknieTalie?"rgba(0,200,100,0.25)":alt.progBonus?"rgba(255,165,0,0.2)":"rgba(0,200,100,0.15)",
                              border:`1px solid ${alt.zamknieTalie?"#0c6":alt.progBonus?"#fa0":"#0c644"}`,
                              color:alt.zamknieTalie?"#0c6":alt.progBonus?"#fa0":"#0c6",
                            }}>✓ Wybierz</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// TESTY — wszystkie eksperymenty
// ============================================================
function TestyView({talie,czlonkowie,posiadane,duplikaty,zapiszKarte,zapiszStrukture,aktywnaWymiana,walki,typWymiany,dane,isAdmin=false,zablokowane=[],onZablokuj,onOdblokuj,zalogowany={},historiaWymian=[],statusOnline={},historiaPush=[],archiwumWalk=[]}) {
  const [tryb,setTryb]=useState("szybkie");
  const [wybranaOsoba,setWybranaOsoba]=useState(0);
  const [wybranaTalia,setWybranaTalia]=useState(0);

  const przyciski=[
    {id:"szybkie",label:"⚡ Szybkie"},
    {id:"postep",label:"📊 Postęp"},
    {id:"historia",label:"📜 Historia"},
    {id:"reset",label:"🔄 Reset"},
    {id:"backup",label:"💾 Backup"},
    {id:"push",label:"🔔 Powiadomienia"},
    {id:"duple",label:"🃏 Duple"},
    {id:"logi",label:"🔒 Logi logowań"},
    {id:"kalendarz",label:"📅 Kalendarz"},
    {id:"dashboard",label:"📊 Dashboard"},
    {id:"kalkulator_event",label:"🧮 Kalkulator eventu"},
    {id:"tracker_krecen",label:"🎯 Tracker kręceń"},
    {id:"rzadkie_karty",label:"💎 Rzadkie karty"},
  ];

  return (
    <div>
      <div style={{background:"rgba(255,165,0,0.08)",border:"1px solid #fa055",borderRadius:10,padding:12,marginBottom:14}}>
        <div style={{fontSize:13,fontWeight:"bold",color:"#fa0",marginBottom:4}}>🧪 Strefa testów</div>
        <div style={{fontSize:11,color:"var(--muted)"}}>Eksperymenty i nowe funkcje. Działają równolegle z normalną apką.</div>
      </div>

      <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
        {przyciski.map(p=>(
          <button key={p.id} onClick={()=>setTryb(p.id)} style={{
            padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:12,
            background:tryb===p.id?"rgba(255,215,0,0.15)":"var(--card)",
            border:tryb===p.id?"1px solid #ffd700":"1px solid var(--border)",
            color:tryb===p.id?"var(--accent)":"var(--muted)",
          }}>{p.label}</button>
        ))}
      </div>

      {tryb==="szybkie"&&<SzybkieWprowadzanie talie={talie} czlonkowie={czlonkowie} posiadane={posiadane} duplikaty={duplikaty} zapiszKarte={zapiszKarte} wybranaOsoba={wybranaOsoba} setWybranaOsoba={setWybranaOsoba} wybranaTalia={wybranaTalia} setWybranaTalia={setWybranaTalia}/>}
      {tryb==="postep"&&<PostepSezonu talie={talie} czlonkowie={czlonkowie} posiadane={posiadane}/>}
      {tryb==="historia"&&<HistoriaWymian zapiszStrukture={zapiszStrukture} aktywnaWymiana={aktywnaWymiana} czlonkowie={czlonkowie}/>}
      {tryb==="reset"&&<ResetSezonu talie={talie} czlonkowie={czlonkowie} zapiszStrukture={zapiszStrukture} walki={dane.walki||[]}/>}
      {tryb==="backup"&&<BackupDanych dane={dane} zapiszStrukture={zapiszStrukture}/>}
      {tryb==="push"&&<PowiadomieniaPush zalogowany={zalogowany} isAdmin={isAdmin} historiaPush={historiaPush}/>}
      {tryb==="duple"&&<DupleView czlonkowie={czlonkowie} talie={talie} duplikaty={duplikaty}/>}
      {tryb==="logi"&&<>
        <ZarzadzajiePinami czlonkowie={czlonkowie}/>
        <LogiLogowan isAdmin={isAdmin} zablokowane={zablokowane} onZablokuj={onZablokuj} onOdblokuj={onOdblokuj}/>
      </>}
      {tryb==="kalendarz"&&<KalendarzEventow/>}
      {tryb==="dashboard"&&<AdminDashboard
        dane={dane} talie={talie}
        historiaWymian={historiaWymian}
        statusOnline={statusOnline}
        zapiszStrukture={zapiszStrukture}
        walki={dane?.walki||[]}
        archiwumWalk={archiwumWalk}
      />}
      {tryb==="kalkulator_event"&&<KalkulatorEventu/>}
      {tryb==="tracker_krecen"&&<TrackerKrecen/>}
      {tryb==="rzadkie_karty"&&<RzadkieKarty talie={talie} czlonkowie={czlonkowie} posiadane={posiadane} duplikaty={duplikaty}/>}
    </div>
  );
}

// ---- POMYSŁ 1: Szybkie wprowadzanie ----
function SzybkieWprowadzanie({talie,czlonkowie,posiadane,duplikaty,zapiszKarte,wybranaOsoba,setWybranaOsoba,wybranaTalia,setWybranaTalia}) {
  const osoba=czlonkowie[wybranaOsoba];
  const talia=talie[wybranaTalia];
  const [masowe, setMasowe] = useState(false);
  const [masowePoster, setMasowePoster] = useState("");

  // Zaznacz typ kart (złote/diamentowe) dla WSZYSTKICH członków
  const zaznaczMasowo = async (typ) => {
    const etykieta = typ === "złota" ? "⭐ złote" : "💎 diamentowe";
    if (!window.confirm(`Zaznaczyć WSZYSTKIE karty ${etykieta} dla WSZYSTKICH ${czlonkowie.length} członków?

To doda ${talie.reduce((s,t)=>s+t.karty.filter(k=>k.typ===typ).length,0)} kart × ${czlonkowie.length} osób.`)) return;
    setMasowe(true);
    setMasowePoster(`Zaznaczam ${etykieta} dla wszystkich...`);
    let count = 0;
    for (const c of czlonkowie) {
      for (const t of talie) {
        for (const k of t.karty.filter(kk=>kk.typ===typ)) {
          const key = `${c.id}_${t.id}_${k.nazwa}`;
          if (!posiadane[key]) {
            await zapiszKarte("posiadane", key, true);
            count++;
          }
        }
      }
      setMasowePoster(`Zaznaczam ${etykieta}... ${czlonkowie.indexOf(c)+1}/${czlonkowie.length} osób`);
    }
    setMasowe(false);
    setMasowePoster(`✅ Gotowe — zaznaczono ${count} kart`);
    setTimeout(() => setMasowePoster(""), 3000);
  };

  const odznaczMasowo = async (typ) => {
    const etykieta = typ === "złota" ? "⭐ złote" : "💎 diamentowe";
    if (!window.confirm(`Odznaczyć WSZYSTKIE karty ${etykieta} dla WSZYSTKICH członków?`)) return;
    setMasowe(true);
    setMasowePoster(`Odznaczam ${etykieta} dla wszystkich...`);
    let count = 0;
    for (const c of czlonkowie) {
      for (const t of talie) {
        for (const k of t.karty.filter(kk=>kk.typ===typ)) {
          const key = `${c.id}_${t.id}_${k.nazwa}`;
          if (posiadane[key]) {
            await zapiszKarte("posiadane", key, null);
            if (duplikaty[key]) await zapiszKarte("duplikaty", key, null); // FIX: czyść duplikat razem z posiadanym
            count++;
          }
        }
      }
    }
    setMasowe(false);
    setMasowePoster(`✅ Odznaczono ${count} kart`);
    setTimeout(() => setMasowePoster(""), 3000);
  };

  const zaznaczWszystkie=(typ)=>{
    if(!osoba||!talia) return;
    const karty=talia.karty.filter(k=>k.typ===typ);
    karty.forEach(k=>{
      const key=`${osoba.id}_${talia.id}_${k.nazwa}`;
      if(!posiadane[key]) zapiszKarte("posiadane",key,true);
    });
  };

  const odznaczWszystkie=(typ)=>{
    if(!osoba||!talia) return;
    const karty=talia.karty.filter(k=>k.typ===typ);
    karty.forEach(k=>{
      const key=`${osoba.id}_${talia.id}_${k.nazwa}`;
      if(posiadane[key]) zapiszKarte("posiadane",key,null);
      if(duplikaty[key]) zapiszKarte("duplikaty",key,null); // FIX: czyść duplikat razem z posiadanym
    });
  };

  const toggle=(kartaNazwa)=>{
    if(!osoba||!talia) return;
    const key=`${osoba.id}_${talia.id}_${kartaNazwa}`;
    if(posiadane[key]){
      zapiszKarte("posiadane",key,null);
      if(duplikaty[key]) zapiszKarte("duplikaty",key,null); // FIX: czyść duplikat razem z posiadanym
    } else {
      zapiszKarte("posiadane",key,true);
    }
  };

  const kartyZlote=talia?.karty.filter(k=>k.typ==="złota")||[];
  const kartyDia=talia?.karty.filter(k=>k.typ==="diamentowa")||[];

  return (
    <div>
      <div style={{background:"rgba(255,215,0,0.06)",border:"1px solid #b8860b33",borderRadius:10,padding:12,marginBottom:12}}>
        <div style={{fontSize:12,fontWeight:"bold",color:"var(--accent)",marginBottom:8}}>⚡ Szybkie wprowadzanie — zaznacz wszystkie karty osoby dla jednej talii</div>
        <div style={{fontSize:11,color:"var(--muted)"}}>Wybierz osobę i talię → kliknij karty które ma lub użyj przycisków "Zaznacz wszystkie"</div>
      </div>

      {/* MASOWE WPROWADZANIE — dla wszystkich naraz */}
      <div style={{background:"rgba(255,50,50,0.06)",border:"1px solid #f5544433",borderRadius:10,padding:12,marginBottom:12}}>
        <div style={{fontSize:12,fontWeight:"bold",color:"#f88",marginBottom:6}}>
          ⚡ Masowe wprowadzanie — dla WSZYSTKICH członków naraz
        </div>
        <div style={{fontSize:11,color:"#555",marginBottom:10}}>
          Używaj gdy wszyscy dostali ten sam zestaw kart (np. początek sezonu).
        </div>
        {masowePoster && (
          <div style={{fontSize:11,color:masowePoster.startsWith("✅")?"#0c6":"#fa0",
            marginBottom:8,padding:"4px 8px",background:"rgba(0,0,0,0.2)",borderRadius:4}}>
            {masowePoster}
          </div>
        )}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
          <button onClick={()=>zaznaczMasowo("złota")} disabled={masowe} style={{
            padding:"10px 8px",borderRadius:8,cursor:masowe?"wait":"pointer",fontSize:12,fontWeight:"bold",
            background:"linear-gradient(135deg,#b8860b,#ffd700)",border:"none",color:"#000",
            opacity:masowe?0.5:1,
          }}>⭐ Zaznacz złote<br/><span style={{fontSize:9,fontWeight:"normal"}}>dla wszystkich</span></button>
          <button onClick={()=>zaznaczMasowo("diamentowa")} disabled={masowe} style={{
            padding:"10px 8px",borderRadius:8,cursor:masowe?"wait":"pointer",fontSize:12,fontWeight:"bold",
            background:"linear-gradient(135deg,#1a3a8f,#87CEEB)",border:"none",color:"#fff",
            opacity:masowe?0.5:1,
          }}>💎 Zaznacz diamentowe<br/><span style={{fontSize:9,fontWeight:"normal"}}>dla wszystkich</span></button>
          <button onClick={()=>odznaczMasowo("złota")} disabled={masowe} style={{
            padding:"8px 8px",borderRadius:8,cursor:masowe?"wait":"pointer",fontSize:11,
            background:"rgba(255,215,0,0.08)",border:"1px solid #b8860b44",color:"#b8860b",
            opacity:masowe?0.5:1,
          }}>⭐ Odznacz złote</button>
          <button onClick={()=>odznaczMasowo("diamentowa")} disabled={masowe} style={{
            padding:"8px 8px",borderRadius:8,cursor:masowe?"wait":"pointer",fontSize:11,
            background:"rgba(135,206,235,0.08)",border:"1px solid #87CEEB44",color:"#87CEEB",
            opacity:masowe?0.5:1,
          }}>💎 Odznacz diamentowe</button>
        </div>
      </div>

      {/* Wybór osoby */}
      <div style={{marginBottom:10}}>
        <div style={{fontSize:11,color:"#aaa",marginBottom:6}}>👤 Osoba:</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
          {czlonkowie.map((c,i)=>(
            <button key={c.id} onClick={()=>setWybranaOsoba(i)} style={{
              padding:"4px 10px",borderRadius:6,fontSize:11,cursor:"pointer",
              background:wybranaOsoba===i?"linear-gradient(135deg,#b8860b,#ffd700)":"rgba(255,255,255,0.06)",
              border:wybranaOsoba===i?"none":"1px solid var(--border)",
              color:wybranaOsoba===i?"#000":"var(--muted)",fontWeight:wybranaOsoba===i?"bold":"normal",
            }}>{c.nazwa}</button>
          ))}
        </div>
      </div>

      {/* Wybór talii */}
      <div style={{marginBottom:12}}>
        <div style={{fontSize:11,color:"#aaa",marginBottom:6}}>🃏 Talia:</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
          {talie.map((t,i)=>{
            const pos=t.karty.filter(k=>posiadane[`${osoba?.id}_${t.id}_${k.nazwa}`]).length;
            const pct=t.karty.length?Math.round((pos/t.karty.length)*100):0;
            return (
              <button key={t.id} onClick={()=>setWybranaTalia(i)} style={{
                padding:"4px 10px",borderRadius:6,fontSize:11,cursor:"pointer",
                background:wybranaTalia===i?"rgba(255,215,0,0.15)":"var(--card)",
                border:wybranaTalia===i?"1px solid #ffd700":"1px solid var(--border)",
                color:wybranaTalia===i?"var(--accent)":"var(--muted)",
              }}>{t.nazwa} <span style={{color:pct===100?"#0c6":"#555",fontSize:10}}>{pct}%</span></button>
            );
          })}
        </div>
      </div>

      {osoba&&talia&&(
        <div style={{background:"rgba(0,0,0,0.2)",border:"1px solid var(--border)",borderRadius:10,padding:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:6}}>
            <div style={{fontSize:13,fontWeight:"bold",color:"var(--accent)"}}>{osoba.nazwa} — {talia.nazwa}</div>
          </div>

          {/* Złote karty */}
          {kartyZlote.length>0&&(
            <div style={{marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                <span style={{fontSize:11,color:"#b8860b",fontWeight:"bold"}}>⭐ Złote ({kartyZlote.filter(k=>posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]).length}/{kartyZlote.length})</span>
                <button onClick={()=>zaznaczWszystkie("złota")} style={{padding:"2px 8px",fontSize:10,borderRadius:4,background:"rgba(255,215,0,0.15)",border:"1px solid #b8860b",color:"var(--accent)",cursor:"pointer"}}>✓ Wszystkie</button>
                <button onClick={()=>odznaczWszystkie("złota")} style={{padding:"2px 8px",fontSize:10,borderRadius:4,background:"rgba(255,50,50,0.1)",border:"1px solid #f5544455",color:"#f55",cursor:"pointer"}}>✗ Wyczyść</button>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {kartyZlote.map(k=>{
                  const ma=posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`];
                  return (
                    <button key={k.nazwa} onClick={()=>toggle(k.nazwa)} style={{
                      padding:"6px 10px",borderRadius:6,fontSize:11,cursor:"pointer",
                      background:ma?"linear-gradient(135deg,#b8860b,#ffd700)":"var(--card)",
                      border:ma?"none":"2px dashed #333",
                      color:ma?"#000":"#444",fontWeight:ma?"bold":"normal",
                      transition:"all 0.15s",
                    }}>{ma?"✓ ":""}{k.nazwa}</button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Diamentowe karty */}
          {kartyDia.length>0&&(
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                <span style={{fontSize:11,color:"#87CEEB",fontWeight:"bold"}}>💎 Diamentowe ({kartyDia.filter(k=>posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]).length}/{kartyDia.length})</span>
                <button onClick={()=>zaznaczWszystkie("diamentowa")} style={{padding:"2px 8px",fontSize:10,borderRadius:4,background:"rgba(135,206,235,0.15)",border:"1px solid #87CEEB55",color:"#87CEEB",cursor:"pointer"}}>✓ Wszystkie</button>
                <button onClick={()=>odznaczWszystkie("diamentowa")} style={{padding:"2px 8px",fontSize:10,borderRadius:4,background:"rgba(255,50,50,0.1)",border:"1px solid #f5544455",color:"#f55",cursor:"pointer"}}>✗ Wyczyść</button>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {kartyDia.map(k=>{
                  const ma=posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`];
                  return (
                    <button key={k.nazwa} onClick={()=>toggle(k.nazwa)} style={{
                      padding:"6px 10px",borderRadius:6,fontSize:11,cursor:"pointer",
                      background:ma?"linear-gradient(135deg,#1a3a8f,#87CEEB)":"var(--card)",
                      border:ma?"none":"2px dashed #333",
                      color:ma?"#fff":"#444",fontWeight:ma?"bold":"normal",
                      transition:"all 0.15s",
                    }}>{ma?"✓ ":""}{k.nazwa}</button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// POSTĘP SEZONU
// ============================================================
function PostepSezonu({talie,czlonkowie,posiadane}) {
  const lacznaMozliwa=talie.reduce((s,t)=>s+(t.nagroda_amunicja||0),0);
  const kartyTotal135=talie.reduce((s,t)=>s+t.karty.length,0); // łącznie 135

  // Statystyki per osoba — z uwzględnieniem kręgu
  const stats=czlonkowie.map(osoba=>{
    const krag=osoba.krag||1;
    let zamkniete=0,ammo=0,kartyPosiadane=0;
    talie.forEach(talia=>{
      const wszystkie=talia.karty.length;
      const pos=talia.karty.filter(k=>posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]).length;
      kartyPosiadane+=pos;
      if(pos===wszystkie&&wszystkie>0){zamkniete++;ammo+=pobierzNagrode(talia,osoba.krag);}
    });
    // Łączny wynik z kręgami: każdy pełny krąg = 135 kart + pełna amunicja
    const kartyLacznie = (krag-1)*kartyTotal135 + kartyPosiadane;
    // Amunicja z ukończonych wcześniej kręgów: nagrody każdego kręgu osobno (K1, K2, ... K(krag-1))
    let ammoUkonczone = 0;
    for (let n = 1; n < krag; n++) ammoUkonczone += talie.reduce((s2,t)=>s2+pobierzNagrode(t,n),0);
    const ammoLacznie = ammoUkonczone + ammo;
    const pct=kartyTotal135?Math.round((kartyPosiadane/kartyTotal135)*100):0;
    return {nazwa:osoba.nazwa,krag,zamkniete,ammo,ammoLacznie,kartyPosiadane,kartyLacznie,kartyTotal135,pct};
  // Sortuj: wyższy krąg × 135 + karty posiadane
  }).sort((a,b)=>b.kartyLacznie-a.kartyLacznie);

  const talieStats=talie.map(talia=>{
    const zamkniete=czlonkowie.filter(o=>talia.karty.length>0&&talia.karty.every(k=>posiadane[`${o.id}_${talia.id}_${k.nazwa}`])).length;
    return {...talia,zamkniete,pct:Math.round((zamkniete/Math.max(1,czlonkowie.length))*100)};
  }).sort((a,b)=>b.pct-a.pct);

  return (
    <div>
      <div style={{background:"rgba(255,215,0,0.06)",border:"1px solid #b8860b33",borderRadius:10,padding:14,marginBottom:14}}>
        <div style={{fontSize:14,fontWeight:"bold",color:"var(--accent)",marginBottom:10}}>📊 Postęp sezonu gangu</div>
        <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
          <div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 14px",flex:1,minWidth:120}}>
            <div style={{fontSize:22,fontWeight:"bold",color:"var(--accent)"}}>{talie.length}</div>
            <div style={{fontSize:11,color:"var(--muted)"}}>talii w sezonie</div>
          </div>
          <div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 14px",flex:1,minWidth:120}}>
            <div style={{fontSize:22,fontWeight:"bold",color:"#0c6"}}>{lacznaMozliwa.toLocaleString()}</div>
            <div style={{fontSize:11,color:"var(--muted)"}}>max amunicja</div>
          </div>
          <div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px 14px",flex:1,minWidth:120}}>
            <div style={{fontSize:22,fontWeight:"bold",color:"#87CEEB"}}>{czlonkowie.length}</div>
            <div style={{fontSize:11,color:"var(--muted)"}}>członków</div>
          </div>
        </div>
      </div>

      {/* Ranking członków */}
      <div style={{marginBottom:14}}>
        <div style={{fontSize:13,fontWeight:"bold",color:"var(--accent)",marginBottom:8}}>🏆 Ranking postępu</div>
        {stats.map((s,i)=>{
          const kragKolor = s.krag>=3?"var(--accent)":s.krag===2?"#da70d6":"transparent";
          const kragBorder = s.krag>1?`1px solid ${kragKolor}55`:"1px solid var(--border)";
          return (
          <div key={s.nazwa} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",marginBottom:4,background:s.krag>1?"rgba(138,43,226,0.06)":"rgba(0,0,0,0.2)",border:kragBorder,borderRadius:8}}>
            <span style={{fontSize:12,color:"var(--muted)",width:20}}>{i+1}.</span>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <span style={{fontSize:12,color:"var(--text)"}}>{s.nazwa}</span>
                {s.krag>1&&(
                  <span style={{fontSize:10,padding:"1px 5px",background:"rgba(138,43,226,0.25)",border:`1px solid ${kragKolor}55`,borderRadius:10,color:kragKolor,fontWeight:"bold"}}>
                    Krąg {s.krag}
                  </span>
                )}
              </div>
              <div style={{fontSize:10,color:"#555",marginTop:1}}>
                {s.krag>1?`${(s.krag-1)*135}+${s.kartyPosiadane} kart łącznie`:`${s.kartyPosiadane}/${s.kartyTotal135} kart`}
              </div>
            </div>
            <span style={{fontSize:11,color:"var(--accent)"}}>{s.zamkniete}/{talie.length} talii</span>
            <span style={{fontSize:11,color:"#0c6",marginLeft:4}}>{s.ammo.toLocaleString()} 💰</span>
            <div style={{width:50,height:6,background:"var(--card-solid)",borderRadius:3,overflow:"hidden",marginLeft:4}}>
              <div style={{height:"100%",width:`${s.pct}%`,background:s.krag>1?"linear-gradient(90deg,#8a2be2,#da70d6)":"linear-gradient(90deg,#b8860b,#ffd700)",borderRadius:3}}/>
            </div>
            <span style={{fontSize:10,color:"#555",width:30}}>{s.pct}%</span>
          </div>
          );
        })}
      </div>

      {/* Postęp talii */}
      <div>
        <div style={{fontSize:13,fontWeight:"bold",color:"var(--accent)",marginBottom:8}}>📋 Postęp talii (% gangu ma zamkniętą)</div>
        {talieStats.map(t=>(
          <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",marginBottom:3,background:"rgba(0,0,0,0.15)",borderRadius:6}}>
            <span style={{fontSize:11,flex:1,color:t.pct===100?"#0c6":t.pct>=50?"var(--accent)":"var(--muted)"}}>{t.nazwa}</span>
            <span style={{fontSize:11,color:"var(--muted)"}}>{t.zamkniete}/{czlonkowie.length}</span>
            <div style={{width:80,height:5,background:"var(--card-solid)",borderRadius:3,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${t.pct}%`,background:t.pct===100?"#0c6":"linear-gradient(90deg,#b8860b,#ffd700)",borderRadius:3}}/>
            </div>
            <span style={{fontSize:10,color:t.pct===100?"#0c6":"#555",width:35}}>{t.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// HISTORIA WYMIAN
// ============================================================
function HistoriaWymian({zapiszStrukture,aktywnaWymiana,czlonkowie=[]}) {
  const [historia,setHistoria]=useState([]);

  useEffect(()=>{
    // Migruj z localStorage do Firebase — SCALAJ z istniejącą historią
    const stara = localStorage.getItem("gang_historia_wymian");
    if (stara) {
      try {
        const parsed = JSON.parse(stara);
        if (parsed.length > 0) {
          pobierzHistorieWymian().then(istniejaca => {
            // Scal — stare z localStorage + istniejące w Firebase, bez duplikatów
            const istniejaceIds = new Set(istniejaca.map(w=>w.id));
            const doMigracji = parsed.filter(w=>!istniejaceIds.has(w.id));
            if (doMigracji.length > 0) {
              const scalona = [...istniejaca, ...doMigracji]
                .sort((a,b)=>b.id-a.id).slice(0,50);
              zapiszHistorieWymian(scalona);
            }
          });
          localStorage.removeItem("gang_historia_wymian");
        }
      } catch {}
    }
    const unsub = subscribeHistoria(d => startTransition(() => setHistoria(d)));
    return () => unsub();
  }, []);

  const archiwizuj=async()=>{
    if(!aktywnaWymiana) return;
    const wpis={
      id:Date.now(),
      data:aktywnaWymiana.data||new Date().toISOString(),
      typWymiany:aktywnaWymiana.typWymiany,
      wymiany:aktywnaWymiana.wymiany||[],
      potwierdzone:aktywnaWymiana.potwierdzone||{},
      potwierdzonychCount:Object.values(aktywnaWymiana.potwierdzone||{}).filter(Boolean).length,
      lacznieWymian:(aktywnaWymiana.wymiany||[]).length,
    };
    const nowaHistoria=[wpis,...historia].slice(0,50);
    await zapiszHistorieWymian(nowaHistoria);
    alert("✅ Wymiana zarchiwizowana!");
  };

  const usunWpis=async(id)=>{
    const nowa=historia.filter(w=>w.id!==id);
    await zapiszHistorieWymian(nowa);
  };

  return (
    <div>
      <div style={{background:"rgba(135,206,235,0.06)",border:"1px solid #87CEEB33",borderRadius:10,padding:14,marginBottom:14}}>
        <div style={{fontSize:14,fontWeight:"bold",color:"#87CEEB",marginBottom:6}}>📜 Historia wymian</div>
        <div style={{fontSize:11,color:"var(--muted)",marginBottom:10}}>Archiwum poprzednich wymian. Synchronizowane przez Firebase — widoczne na wszystkich urządzeniach.</div>
        {aktywnaWymiana?(
          <button onClick={archiwizuj} style={{padding:"8px 16px",background:"linear-gradient(135deg,#87CEEB,#4169E1)",border:"none",borderRadius:6,color:"#fff",cursor:"pointer",fontSize:12,fontWeight:"bold"}}>
            📥 Archiwizuj aktywną wymianę
          </button>
        ):(
          <div style={{fontSize:11,color:"#555"}}>Brak aktywnej wymiany do archiwizacji</div>
        )}
      </div>

      {/* Ranking długu */}
      {historia.length>0&&(()=>{
        const licznik = obliczLicznikOtrzymanych(historia);
        const lacznieRozdano = Object.values(licznik).reduce((s,v)=>s+v,0);
        const srednia = lacznieRozdano / Math.max(1, czlonkowie.length);
        const ranking = czlonkowie.map(c=>({
          nazwa: c.nazwa,
          dostala: licznik[c.nazwa]||0,
          dług: srednia - (licznik[c.nazwa]||0),
        })).sort((a,b)=>b.dług-a.dług);
        const maxDług = Math.max(...ranking.map(r=>Math.abs(r.dług)),0.1);
        return (
          <div style={{background:"rgba(0,0,0,0.25)",border:"1px solid var(--border)",borderRadius:10,padding:14,marginBottom:14}}>
            <div style={{fontSize:13,fontWeight:"bold",color:"var(--accent)",marginBottom:4}}>
              ⚖️ Sprawiedliwość wymian
            </div>
            <div style={{fontSize:11,color:"var(--muted)",marginBottom:10}}>
              Średnia: <strong style={{color:"var(--text)"}}>{srednia.toFixed(1)}</strong> kart/osoba z {historia.length} wymian.
              Dług = ile poniżej średniej — im wyższy tym bardziej pominięty.
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {ranking.map((r,i)=>{
                const kolor = r.dług>1?"#f55":r.dług>0?"#fa0":r.dług<-1?"#0c6":"#87CEEB";
                const ikonka = r.dług>=1?"🔴":r.dług>0?"🟡":r.dług<=-1?"🟢":r.dług<0?"🟢":"⚪";
                const szerokoscPaska = Math.min(100, Math.abs(r.dług)/maxDług*100);
                return (
                  <div key={r.nazwa} style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:11,width:16,textAlign:"center"}}>{ikonka}</span>
                    <span style={{fontSize:12,color:"var(--text)",width:90,flexShrink:0}}>{r.nazwa}</span>
                    <span style={{fontSize:11,color:"var(--muted)",width:50,flexShrink:0,textAlign:"right"}}>{r.dostala} kart</span>
                    {/* Pasek długu */}
                    <div style={{flex:1,height:6,background:"var(--card-solid)",borderRadius:3,overflow:"hidden"}}>
                      <div style={{
                        height:"100%",
                        width:`${szerokoscPaska}%`,
                        background:kolor,
                        marginLeft: r.dług>=0?"0":"auto",
                        borderRadius:3,
                        transition:"width 0.3s",
                      }}/>
                    </div>
                    <span style={{
                      fontSize:11,fontWeight:"bold",color:kolor,
                      width:50,flexShrink:0,textAlign:"right",
                    }}>
                      {r.dług>0?"+":""}{r.dług.toFixed(1)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{fontSize:10,color:"#555",marginTop:8}}>
              🔴 Pominięty (dostał mniej niż średnia) · 🟡 Lekko pominięty · 🟢 Uprzywilejowany (dostał więcej) · ⚪ W normie
            </div>
          </div>
        );
      })()}

      {historia.length===0?(
        <div style={{textAlign:"center",padding:30,color:"#555",fontSize:12}}>Brak zapisanych wymian</div>
      ):historia.map(w=>(
        <div key={w.id} style={{marginBottom:8,padding:"10px 12px",background:"rgba(0,0,0,0.2)",border:"1px solid var(--border)",borderRadius:8}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <div>
              <span style={{fontSize:12,fontWeight:"bold",color:"var(--text)"}}>{new Date(w.data).toLocaleString("pl-PL")}</span>
              <span style={{fontSize:11,color:"var(--muted)",marginLeft:8}}>{w.typWymiany==="złote"?"⭐ Złote":"💎 Diamentowe"}</span>
            </div>
            <button onClick={()=>usunWpis(w.id)} style={{background:"none",border:"none",color:"#f5544466",cursor:"pointer",fontSize:12}}>✕</button>
          </div>
          <div style={{fontSize:11,color:"#aaa",marginBottom:6}}>
            📤 {w.lacznieWymian} wymian • ✅ {w.potwierdzonychCount}/{w.lacznieWymian} potwierdziło
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
            {(w.wymiany||[]).map((x,i)=>(
              <span key={i} style={{
                fontSize:10,padding:"1px 6px",borderRadius:4,
                background:w.potwierdzone?.[x.od]?"rgba(0,200,100,0.1)":"var(--card)",
                border:w.potwierdzone?.[x.od]?"1px solid #0c633":"1px solid var(--border)",
                color:w.potwierdzone?.[x.od]?"#0c6":"#555",
              }}>{x.od}→{x.do}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// BACKUP DANYCH
// ============================================================
function AutoBackupPanel() {
  const [backupy, setBackupy] = useState([]);
  const [ladowanie, setLadowanie] = useState(false);
  const [rozwiniety, setRozwiniety] = useState(false);

  const zaladuj = async () => {
    setLadowanie(true);
    const lista = await pobierzListeBackupow();
    setBackupy(lista);
    setLadowanie(false);
  };

  const przywroc = async (backup) => {
    if (!window.confirm(`Przywrócić dane z ${backup.data}?\n\nTo NADPISZE wszystkie obecne dane gangu!`)) return;
    try {
      await przywrocAutoBackup(backup.id);
      alert("✅ Dane przywrócone! Odśwież stronę.");
    } catch(e) {
      alert("Błąd: " + e.message);
    }
  };

  return (
    <div style={{background:"rgba(100,150,255,0.06)",border:"1px solid #6496ff33",borderRadius:8,padding:10,marginBottom:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontSize:12,fontWeight:"bold",color:"#6496ff"}}>
          🔒 Auto-backupy Firebase
          <span style={{fontSize:10,color:"#555",marginLeft:6,fontWeight:"normal"}}>— tworzone automatycznie</span>
        </div>
        <button onClick={()=>{setRozwiniety(p=>!p);if(!rozwiniety)zaladuj();}} style={{
          fontSize:10,padding:"3px 8px",background:"rgba(100,150,255,0.1)",
          border:"1px solid #6496ff44",borderRadius:4,color:"#6496ff",cursor:"pointer"
        }}>{rozwiniety?"▲ Schowaj":"▼ Pokaż"}</button>
      </div>
      {rozwiniety&&(
        <div style={{marginTop:8}}>
          {ladowanie&&<div style={{fontSize:11,color:"#555"}}>⏳ Ładowanie...</div>}
          {!ladowanie&&backupy.length===0&&(
            <div style={{fontSize:11,color:"#555"}}>
              Brak auto-backupów. Tworzone są automatycznie po każdej publikacji wymiany i potwierdzeniu.
            </div>
          )}
          {backupy.map(b=>(
            <div key={b.id} style={{
              display:"flex",justifyContent:"space-between",alignItems:"center",
              padding:"6px 8px",marginBottom:4,borderRadius:6,
              background:"rgba(0,0,0,0.2)",border:"1px solid var(--border)",
            }}>
              <div>
                <div style={{fontSize:11,color:"var(--text)"}}>{b.data}</div>
                <div style={{fontSize:9,color:"#555"}}>{b.powod}</div>
              </div>
              <button onClick={()=>przywroc(b)} style={{
                fontSize:10,padding:"3px 10px",background:"rgba(100,150,255,0.15)",
                border:"1px solid #6496ff44",borderRadius:4,color:"#6496ff",cursor:"pointer"
              }}>Przywróć</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BackupDanych({dane, zapiszStrukture}) {
  const [ostatniBackup, setOstatniBackup] = useState(() => {
    return localStorage.getItem("gang_ostatni_backup") || null;
  });
  const [eksportuje, setEksportuje] = useState(false);

  const eksportuj = async () => {
    setEksportuje(true);
    try {
      const pelnyBackup = await pobierzPelnyBackup();
      const backup = {
        wersja: "2.0",
        data: new Date().toISOString(),
        ...pelnyBackup,
      };
      const json = JSON.stringify(backup, null, 2);
      const blob = new Blob([json], {type: "application/json"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gang-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      const teraz = new Date().toLocaleString("pl-PL");
      localStorage.setItem("gang_ostatni_backup", teraz);
      setOstatniBackup(teraz);
    } catch(e) {
      alert("Błąd eksportu: " + e.message);
    }
    setEksportuje(false);
  };



  const [przywracanie, setPrzywracanie] = useState(false);

  const importuj = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const backup = JSON.parse(ev.target.result);
        if (!backup.dane) { alert("Nieprawidłowy plik backup!"); return; }
        const dataBackup = new Date(backup.data).toLocaleString("pl-PL");
        const czlonkowieCount = backup.dane.czlonkowie?.length || 0;
        const posiadaneCount = Object.keys(backup.dane.posiadane || {}).length;
        const dupCount2 = Object.keys(backup.dane.duplikaty || {}).length;
        if (!window.confirm(
          `Przywrócić dane z ${dataBackup}?

Członków: ${czlonkowieCount}
Kart posiadanych: ${posiadaneCount}
Duplikatów: ${dupCount2}

To NADPISZE wszystkie obecne dane gangu!`
        )) return;
        setPrzywracanie(true);
        try {
          // Obsłuż oba formaty: stary (backup.dane) i nowy (backup.main)
          if (backup.wersja === "2.0") {
            await przywrocPelnyBackup(backup, zapiszStrukture);
          } else if (backup.dane) {
            if (backup.dane.talie) await zapiszStrukture("talie", backup.dane.talie);
            if (backup.dane.czlonkowie) await zapiszStrukture("czlonkowie", backup.dane.czlonkowie);
            if (backup.dane.posiadane) await zapiszStrukture("posiadane", backup.dane.posiadane);
            if (backup.dane.duplikaty) await zapiszStrukture("duplikaty", backup.dane.duplikaty);
            if (backup.dane.walki) await zapiszStrukture("walki", backup.dane.walki);
          }
          alert("✅ Dane przywrócone! Odśwież stronę.");
        } catch(err) {
          alert("Błąd przywracania: " + err.message);
        }
        setPrzywracanie(false);
      } catch { alert("Błąd odczytu pliku!"); }
    };
    reader.readAsText(file);
  };

  const kartyCount = dane.posiadane ? Object.keys(dane.posiadane).length : 0;
  const dupCount = dane.duplikaty ? Object.keys(dane.duplikaty).length : 0;

  return (
    <div>
      <div style={{background:"rgba(0,200,100,0.06)",border:"1px solid #0c633",borderRadius:10,padding:14,marginBottom:14}}>
        <div style={{fontSize:14,fontWeight:"bold",color:"#0c6",marginBottom:4}}>💾 Backup danych gangu</div>
        <div style={{fontSize:11,color:"#555",lineHeight:1.6}}>
          Eksportuj dane do pliku JSON na dysk. Rób backup regularnie — szczególnie po każdej wymianie kart.
        </div>
      </div>

      {/* Stan danych */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
        {[
          {label:"Członków",val:dane.czlonkowie?.length||0,color:"var(--accent)"},
          {label:"Kart posiadanych",val:kartyCount,color:"#0c6"},
          {label:"Duplikatów",val:dupCount,color:"#87CEEB"},
        ].map(s=>(
          <div key={s.label} style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px",textAlign:"center"}}>
            <div style={{fontSize:20,fontWeight:"bold",color:s.color}}>{s.val}</div>
            <div style={{fontSize:10,color:"#555"}}>{s.label}</div>
          </div>
        ))}
      </div>

      {ostatniBackup && (
        <div style={{fontSize:11,color:"#0c6",marginBottom:10,padding:"6px 10px",background:"rgba(0,200,100,0.08)",borderRadius:6,border:"1px solid #0c633"}}>
          ✅ Ostatni backup: {ostatniBackup}
        </div>
      )}

      {!ostatniBackup && (
        <div style={{fontSize:11,color:"#f55",marginBottom:10,padding:"6px 10px",background:"rgba(255,50,50,0.08)",borderRadius:6,border:"1px solid #f5544433"}}>
          ⚠️ Nie masz jeszcze żadnego backupu! Zrób go teraz.
        </div>
      )}

      <button onClick={eksportuj} disabled={eksportuje} style={{
        width:"100%",padding:14,
        background:eksportuje?"rgba(0,200,100,0.3)":"linear-gradient(135deg,#0c6,#0fa)",
        border:"none",borderRadius:10,color:"#000",fontSize:15,fontWeight:"bold",
        cursor:eksportuje?"wait":"pointer",marginBottom:10,
      }}>
        {eksportuje ? "⏳ Pobieranie danych..." : "📥 Pobierz pełny backup (JSON)"}
      </button>

      {/* Auto-backupy Firebase */}
      <AutoBackupPanel/>

      {/* Przywróć z backupu */}
      <div style={{marginBottom:10}}>
        <div style={{fontSize:11,color:"#aaa",marginBottom:6,fontWeight:"bold"}}>🔄 Przywróć z pliku</div>
        <label style={{
          display:"block",width:"100%",padding:12,
          background:przywracanie?"rgba(255,165,0,0.1)":"var(--card)",
          border:"2px dashed #333",borderRadius:10,
          color:przywracanie?"#fa0":"var(--muted)",fontSize:13,
          cursor:"pointer",textAlign:"center",boxSizing:"border-box",
        }}>
          {przywracanie ? "⏳ Przywracam dane..." : "📂 Kliknij i wybierz plik backup (.json)"}
          <input type="file" accept=".json" onChange={importuj} disabled={przywracanie}
            style={{display:"none"}}/>
        </label>
      </div>

      <div style={{padding:12,background:"rgba(0,0,0,0.2)",border:"1px solid var(--border)",borderRadius:8,fontSize:11,color:"#555",lineHeight:1.7}}>
        <strong style={{color:"#aaa"}}>Co zawiera backup:</strong><br/>
        • Talie z nagrodami K1/K2 ✓<br/>
        • Członkowie i kręgi ✓<br/>
        • Posiadane karty i duplikaty ✓<br/>
        • Walki sezonu ✓<br/>
        • Historia wymian ✓<br/>
        • Kalendarz eventów ✓<br/>
        • Taktyka sezonu ✓<br/><br/>
        <strong style={{color:"#aaa"}}>Kiedy robić backup?</strong><br/>
        Po każdej wymianie · Po OCR · Przed resetem<br/><br/>
        <strong style={{color:"#aaa"}}>Gdzie trzymać?</strong><br/>
        Google Drive, e-mail, pendrive — poza telefonem.
      </div>
    </div>
  );
}

// ============================================================
// RESET SEZONU
// ============================================================
function ResetSezonu({talie,czlonkowie,zapiszStrukture,walki=[]}) {
  const [krok,setKrok]=useState(0); // 0=info, 1=potwierdzenie, 2=sukces
  const [resetujace,setResetujace]=useState(false);

  const wykonajReset=async()=>{
    setResetujace(true);
    // Przenieś aktualne walki do archiwum przed kasowaniem
    if (walki && walki.length > 0) {
      const dataSezonu = new Date().toLocaleDateString("pl-PL");
      await zapiszArchiwumWalk({
        sezon: dataSezonu,
        data: Date.now(),
        walki: walki,
      });
    }
    await zapiszStrukture("posiadane",{});
    await zapiszStrukture("duplikaty",{});
    await zapiszStrukture("aktywnaWymiana",null);
    await zapiszStrukture("walki",[]);
    // Kasuj nazwy talii i kart, ale zachowaj nagrody K1/K2
    const talieZachowaneNagrody = talie.map(t => ({
      id: t.id,
      numer: t.numer,
      nazwa: "",
      nagroda_amunicja: t.nagroda_amunicja || 0,
      nagroda_amunicja_k2: t.nagroda_amunicja_k2,
      nagroda_amunicja_k3: t.nagroda_amunicja_k3,
      nagroda_amunicja_k4: t.nagroda_amunicja_k4,
      nagroda_amunicja_k5: t.nagroda_amunicja_k5,
      karty: [],
    }));
    await zapiszStrukture("talie", talieZachowaneNagrody);
    setResetujace(false);
    setKrok(2);
  };

  const kartyCount=talie.reduce((s,t)=>s+t.karty.length,0);

  if(krok===2) return (
    <div style={{textAlign:"center",padding:30}}>
      <div style={{fontSize:40,marginBottom:10}}>🎉</div>
      <div style={{fontSize:16,fontWeight:"bold",color:"#0c6",marginBottom:8}}>Reset sezonu zakończony!</div>
      <div style={{fontSize:12,color:"var(--muted)",marginBottom:16}}>Reset zakończony. Nagrody za talie zachowane. Wgraj nowe karty przez OCR w zakładce ⚙️ Talie.</div>
      <button onClick={()=>setKrok(0)} style={{padding:"8px 16px",background:"rgba(255,215,0,0.15)",border:"1px solid #b8860b",borderRadius:6,color:"var(--accent)",cursor:"pointer",fontSize:12}}>
        ← Wróć
      </button>
    </div>
  );

  if(krok===1) return (
    <div style={{background:"rgba(255,50,50,0.08)",border:"2px solid #f55",borderRadius:10,padding:20}}>
      <div style={{fontSize:14,fontWeight:"bold",color:"#f55",marginBottom:10}}>⚠️ Ostatnia szansa — jesteś pewny?</div>
      <div style={{fontSize:12,color:"#aaa",marginBottom:16,lineHeight:1.6}}>
        Zostaną wymazane:<br/>
        • <strong style={{color:"#f55"}}>Wszystkie posiadane karty i duplikaty</strong><br/>
        • <strong style={{color:"#f55"}}>Nazwy talii i kart ({talie.length} talii, {kartyCount} kart)</strong><br/>
        • Aktywna wymiana<br/><br/>
        Zostaną zachowane:<br/>
        • <strong style={{color:"#0c6"}}>Nagrody za talie K1 i K2</strong><br/>
        • Członkowie gangu<br/>
        • Historia walk<br/><br/>
        <strong>Tej operacji nie można cofnąć!</strong>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={wykonajReset} disabled={resetujace} style={{flex:1,padding:12,background:"linear-gradient(135deg,#f55,#f00)",border:"none",borderRadius:8,color:"#fff",fontWeight:"bold",cursor:"pointer",fontSize:13}}>
          {resetujace?"⏳ Resetuję...":"🗑️ TAK, resetuj sezon"}
        </button>
        <button onClick={()=>setKrok(0)} style={{padding:"12px 20px",background:"var(--card)",border:"1px solid #333",borderRadius:8,color:"var(--muted)",cursor:"pointer",fontSize:13}}>
          Anuluj
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <div style={{background:"rgba(255,50,50,0.06)",border:"1px solid #f5544433",borderRadius:10,padding:14,marginBottom:14}}>
        <div style={{fontSize:14,fontWeight:"bold",color:"#f55",marginBottom:8}}>🔄 Reset sezonu</div>
        <div style={{fontSize:11,color:"var(--muted)",lineHeight:1.7}}>
          Używasz gdy zaczyna się nowy sezon i chcesz wyczyścić dane kart.<br/>
          <strong style={{color:"#aaa"}}>Co zostanie wyczyszczone:</strong><br/>
          • Wszystkie posiadane karty i duplikaty<br/>
          • Nazwy talii i kart (nowy sezon = nowe karty)<br/>
          • Aktywna wymiana<br/>
          • Walki bieżącego sezonu (przeniesione do archiwum)<br/><br/>
          <strong style={{color:"#aaa"}}>Co zostanie zachowane:</strong><br/>
          • <strong style={{color:"#0c6"}}>Nagrody za talie K1 i K2</strong><br/>
          • <strong style={{color:"#0c6"}}>Historia walk → zakładka Poprzednie sezony</strong><br/>
          • Członkowie gangu ({czlonkowie.length} osób)<br/>
          • Kalendarz eventów
        </div>
      </div>
      <button onClick={()=>setKrok(1)} style={{width:"100%",padding:14,background:"rgba(255,50,50,0.15)",border:"2px solid #f5544455",borderRadius:10,color:"#f55",cursor:"pointer",fontSize:14,fontWeight:"bold"}}>
        🔄 Rozpocznij reset sezonu
      </button>
    </div>
  );
}

// ============================================================
// POWIADOMIENIA PUSH
// ============================================================
function PowiadomieniaPush({ zalogowany, isAdmin, historiaPush }) {
  const [status, setStatus] = useState("idle"); // idle / requesting / granted / denied
  const [pushTytul, setPushTytul] = useState("📢 Ważna informacja od admina");
  const [pushTresc, setPushTresc] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  useEffect(() => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "denied") { setStatus("denied"); return; }
    if (Notification.permission === "granted") {
      // Pozwolenie już jest — zarejestruj token automatycznie (może być nowy SW)
      setStatus("requesting");
      registerFCMToken(zalogowany?.login || "unknown")
        .then(token => setStatus(token ? "granted" : "error"))
        .catch(() => setStatus("error"));
    }
  }, [zalogowany]);

  const wlaczPowiadomienia = async () => {
    if (!("Notification" in window)) { setStatus("denied"); return; }
    setStatus("requesting");
    try {
      const token = await registerFCMToken(zalogowany?.login || "unknown");
      if (token) {
          setStatus("granted");
      } else {
        setStatus(Notification.permission === "denied" ? "denied" : "error");
      }
    } catch(e) {
      console.error(e);
      setStatus("denied");
    }
  };

  const wylaczPowiadomienia = async () => {
    await unregisterFCMToken(zalogowany?.login || "unknown");
    setStatus("idle");
  };

  const wyslijPush = async () => {
    if (!pushTresc.trim()) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/send-notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: pushTytul,
          body: pushTresc,
          adminKey: zalogowany?.adminKey || "",
        }),
      });
      const data = await res.json();
      setSendResult(data);
      if (data.success) setPushTresc("");
    } catch(e) {
      setSendResult({ error: e.message });
    }
    setSending(false);
  };

  return (
    <div>
      {/* INFO */}
      <div style={{background:"rgba(255,165,0,0.06)",border:"1px solid #fa033",borderRadius:10,padding:14,marginBottom:14}}>
        <div style={{fontSize:14,fontWeight:"bold",color:"#fa0",marginBottom:6}}>🔔 Powiadomienia push</div>
        <div style={{fontSize:11,color:"var(--muted)",lineHeight:1.6}}>
          Prawdziwe powiadomienia na telefonie — nawet gdy apka jest <strong>zamknięta</strong>.<br/>
          Każdy musi raz włączyć powiadomienia poniżej.
        </div>
      </div>

      {/* WŁĄCZ/WYŁĄCZ dla członka */}
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:14,marginBottom:14}}>
        <div style={{fontSize:12,fontWeight:"bold",color:"var(--text)",marginBottom:10}}>👤 Twoje powiadomienia</div>
        {status === "idle" && (
          <button onClick={wlaczPowiadomienia} style={{
            width:"100%",padding:"12px",background:"linear-gradient(135deg,#fa0,#f80)",
            border:"none",borderRadius:8,color:"#000",fontWeight:"bold",cursor:"pointer",fontSize:14
          }}>🔔 Włącz powiadomienia push</button>
        )}
        {status === "requesting" && (
          <div style={{textAlign:"center",color:"#fa0",fontSize:13,padding:10}}>
            ⏳ Rejestruję urządzenie...
          </div>
        )}
        {status === "granted" && (
          <div>
            <div style={{textAlign:"center",marginBottom:10}}>
              <div style={{fontSize:32}}>✅</div>
              <div style={{fontSize:13,fontWeight:"bold",color:"#0c6"}}>Powiadomienia włączone!</div>
              <div style={{fontSize:10,color:"var(--muted)",marginTop:4}}>Dostaniesz powiadomienie nawet gdy apka jest zamknięta</div>
            </div>
            <button onClick={wylaczPowiadomienia} style={{
              width:"100%",padding:"8px",background:"rgba(255,50,50,0.1)",
              border:"1px solid #f5544433",borderRadius:6,color:"#f5544488",cursor:"pointer",fontSize:11
            }}>Wyłącz powiadomienia</button>
          </div>
        )}
        {status === "denied" && (
          <div style={{textAlign:"center",padding:10}}>
            <div style={{fontSize:32}}>❌</div>
            <div style={{fontSize:12,fontWeight:"bold",color:"#f55",marginBottom:6}}>Powiadomienia zablokowane</div>
            <div style={{fontSize:10,color:"var(--muted)",lineHeight:1.5}}>
              Żeby odblokować: Ustawienia przeglądarki → Powiadomienia → gang-manager-beta.vercel.app → Zezwól
            </div>
          </div>
        )}
        {status === "error" && (
          <div style={{textAlign:"center",color:"#f55",fontSize:11,padding:10}}>
            ❌ Błąd rejestracji. Sprawdź czy VAPID key jest ustawiony w firebase.js
          </div>
        )}
      </div>

      {/* PANEL ADMINA — wyślij powiadomienie */}
      {isAdmin && (
        <div style={{background:"rgba(255,215,0,0.04)",border:"1px solid var(--border)",borderRadius:10,padding:14,marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:"bold",color:"var(--accent)",marginBottom:10}}>
            👑 Admin — wyślij powiadomienie do gangu
          </div>
          <input
            type="text"
            value={pushTytul}
            onChange={e => setPushTytul(e.target.value)}
            placeholder="Tytuł powiadomienia"
            style={{width:"100%",padding:"8px 10px",background:"var(--card-solid)",border:"1px solid var(--border)",
              borderRadius:6,color:"var(--text)",fontSize:12,marginBottom:8,boxSizing:"border-box"}}
          />
          <textarea
            value={pushTresc}
            onChange={e => setPushTresc(e.target.value)}
            placeholder="Treść powiadomienia... np. Nowa rozpiska! Sprawdźcie RASPISKĘ w apce."
            rows={3}
            style={{width:"100%",padding:"8px 10px",background:"var(--card-solid)",border:"1px solid var(--border)",
              borderRadius:6,color:"var(--text)",fontSize:12,marginBottom:8,resize:"vertical",boxSizing:"border-box"}}
          />
          <button
            onClick={wyslijPush}
            disabled={sending || !pushTresc.trim()}
            style={{
              width:"100%",padding:"12px",
              background:sending||!pushTresc.trim()?"rgba(255,255,255,0.05)":"linear-gradient(135deg,var(--accent2),var(--accent))",
              border:"none",borderRadius:8,
              color:sending||!pushTresc.trim()?"var(--muted)":"var(--btn-text)",
              fontWeight:"bold",cursor:sending||!pushTresc.trim()?"not-allowed":"pointer",fontSize:13,
            }}
          >
            {sending ? "⏳ Wysyłam..." : "📤 Wyślij do wszystkich"}
          </button>
          {sendResult && (
            <div style={{marginTop:8,padding:"6px 10px",borderRadius:6,fontSize:11,
              background:sendResult.success?"rgba(0,200,100,0.1)":"rgba(255,50,50,0.1)",
              border:sendResult.success?"1px solid #0c633":"1px solid #f5544433",
              color:sendResult.success?"#0c6":"#f55"
            }}>
              {sendResult.success
                ? `✓ Wysłano do ${sendResult.sent} urządzeń${sendResult.failed>0?` (${sendResult.failed} błędów)`:""}`
                : `❌ Błąd: ${sendResult.error}`}
            </div>
          )}

          {/* Historia powiadomień */}
          {historiaPush && historiaPush.length > 0 && (
            <div style={{marginTop:12}}>
              <div style={{fontSize:10,color:"var(--muted)",marginBottom:6}}>📋 Historia (ostatnie 5):</div>
              {historiaPush.slice(0,5).map(p => (
                <div key={p.id} style={{fontSize:10,color:"var(--muted)",padding:"4px 0",borderBottom:"1px solid var(--border)"}}>
                  <strong style={{color:"var(--text)"}}>{p.title}</strong> — {p.body?.slice(0,40)}...
                  <span style={{color:"#0c6",marginLeft:6}}>✓{p.sent}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isAdmin && <GeneratorOgloszen/>}
    </div>
  );
}

// ============================================================
// GENERATOR OGŁOSZEŃ AI
// ============================================================
const TEMATY_OGLOSZEN = [
  { id:"wymiana",    emoji:"🔄", label:"Aktywna wymiana",      opis:"Nowa wymiana jest gotowa, sprawdźcie rozpiskę w apce" },
  { id:"ammo",       emoji:"📊", label:"Prośba o stan ammo",   opis:"Poproś członków o aktualizację stanu kart w apce" },
  { id:"event",      emoji:"⚔️",  label:"Nadchodzący event",    opis:"Informacja o nadchodzącym evencie/wojnie w grze" },
  { id:"karty",      emoji:"🃏", label:"Nowe karty w sezonie", opis:"Nowe karty w sezonie, aktualizujcie dane w apce" },
  { id:"przypomnienie", emoji:"⏰", label:"Przypomnienie",     opis:"Ogólne przypomnienie dla członków gangu" },
  { id:"gratulacje", emoji:"🏆", label:"Gratulacje",           opis:"Pochwal kogoś za wynik lub zamknięcie talii" },
  { id:"inne",       emoji:"📝", label:"Inne",                 opis:"Własny temat — opisz co chcesz ogłosić" },
];

function GeneratorOgloszen() {
  const [temat, setTemat]       = useState(null);
  const [opis, setOpis]         = useState("");
  const [wynik, setWynik]       = useState("");
  const [ladowanie, setLadowanie] = useState(false);
  const [skopiowano, setSkopiowano] = useState(false);

  const generuj = async () => {
    if (!temat) return;
    setLadowanie(true);
    setWynik("");
    setSkopiowano(false);
    try {
      const tematObj = TEMATY_OGLOSZEN.find(t => t.id === temat);
      const prompt = `Jesteś administratorem gangu ™FAM™ w grze mobilnej "The Gang: Street Mafia Wars". 
Musisz napisać ogłoszenie na grupę Messenger dla ~20 członków gangu.

Temat ogłoszenia: ${tematObj?.label}
${opis ? `Dodatkowe informacje od admina: ${opis}` : `Kontekst: ${tematObj?.opis}`}

Link do apki Gang Managera: https://gang-manager-beta.vercel.app

Zasady:
- Pisz po polsku, w stylu gangsterskim ale przyjaznym
- Użyj emoji żeby było czytelne
- Maksymalnie 6-8 linijek
- Na końcu daj link do apki jeśli pasuje do tematu
- Bądź konkretny i na temat
- Możesz użyć charakterystycznych zwrotów gangu jak "Bracia", "FAM", "™FAM™"
- Nie pisz nic poza samym ogłoszeniem (bez "Oto ogłoszenie:" itp.)`;

      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Błąd serwera");
      const tekst = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      if (!tekst) throw new Error("Pusta odpowiedź");
      setWynik(tekst);
    } catch(e) {
      setWynik("❌ Błąd generowania. Spróbuj ponownie.");
    }
    setLadowanie(false);
  };

  const kopiuj = () => {
    navigator.clipboard.writeText(wynik).then(() => {
      setSkopiowano(true);
      setTimeout(() => setSkopiowano(false), 2000);
    });
  };

  return (
    <div style={{marginTop:16,background:"rgba(0,0,0,0.3)",border:"1px solid var(--border)",borderRadius:10,padding:14}}>
      <div style={{fontWeight:"bold",color:"var(--accent)",fontSize:14,marginBottom:12}}>
        ✍️ Generator ogłoszeń AI
      </div>

      {/* Wybór tematu */}
      <div style={{fontSize:11,color:"var(--muted)",marginBottom:8}}>Wybierz temat:</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>
        {TEMATY_OGLOSZEN.map(t => (
          <button key={t.id} onClick={() => { setTemat(t.id); setWynik(""); }}
            style={{
              padding:"6px 12px",borderRadius:8,fontSize:12,cursor:"pointer",
              background: temat===t.id ? "rgba(255,215,0,0.2)" : "rgba(255,255,255,0.04)",
              border: temat===t.id ? "1px solid var(--accent)" : "1px solid var(--border)",
              color: temat===t.id ? "var(--accent)" : "var(--text)",
              fontWeight: temat===t.id ? "bold" : "normal",
            }}>
            {t.emoji} {t.label}
          </button>
        ))}
      </div>

      {/* Opcjonalny opis */}
      {temat && (
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:"var(--muted)",marginBottom:6}}>
            Dodaj szczegóły <span style={{color:"#555"}}>(opcjonalnie)</span>:
          </div>
          <textarea
            value={opis}
            onChange={e => setOpis(e.target.value)}
            placeholder={TEMATY_OGLOSZEN.find(t=>t.id===temat)?.opis || "Opisz co chcesz ogłosić..."}
            rows={2}
            style={{
              width:"100%",boxSizing:"border-box",
              background:"rgba(0,0,0,0.3)",border:"1px solid var(--border)",
              borderRadius:8,padding:"8px 10px",color:"var(--text)",
              fontSize:12,resize:"none",fontFamily:"inherit",
            }}
          />
        </div>
      )}

      {/* Przycisk generuj */}
      {temat && (
        <button onClick={generuj} disabled={ladowanie} style={{
          width:"100%",padding:"10px",borderRadius:8,fontSize:13,
          fontWeight:"bold",cursor:ladowanie?"wait":"pointer",
          background: ladowanie ? "rgba(255,215,0,0.08)" : "rgba(255,215,0,0.15)",
          border:"1px solid var(--accent)",color:"var(--accent)",
          marginBottom:12,
        }}>
          {ladowanie ? "⏳ Generuję ogłoszenie..." : "✨ Generuj ogłoszenie"}
        </button>
      )}

      {/* Wynik */}
      {wynik && (
        <div>
          <div style={{
            background:"rgba(0,0,0,0.4)",border:"1px solid var(--border)",
            borderRadius:8,padding:12,fontSize:13,color:"var(--text)",
            whiteSpace:"pre-wrap",lineHeight:1.6,marginBottom:8,fontFamily:"inherit",
          }}>
            {wynik}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={kopiuj} style={{
              flex:1,padding:"8px",borderRadius:8,fontSize:12,fontWeight:"bold",cursor:"pointer",
              background: skopiowano?"rgba(0,200,100,0.2)":"rgba(255,215,0,0.12)",
              border:`1px solid ${skopiowano?"#0c6":"var(--accent)"}`,
              color: skopiowano?"#0c6":"var(--accent)",
            }}>
              {skopiowano ? "✓ Skopiowano!" : "📋 Kopiuj"}
            </button>
            <button onClick={generuj} disabled={ladowanie} style={{
              flex:1,padding:"8px",borderRadius:8,fontSize:12,cursor:"pointer",
              background:"rgba(255,255,255,0.04)",border:"1px solid var(--border)",color:"var(--muted)",
            }}>
              🔄 Generuj ponownie
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
// ============================================================
const OSIAGNIECIA_DEF=[
  {id:"kolekcjoner",ikona:"🏆",nazwa:"Kolekcjoner",opis:"Zamknij 5 talii",check:(s)=>s.zamkniete>=5},
  {id:"mega_kolekcjoner",ikona:"👑",nazwa:"Mega Kolekcjoner",opis:"Zamknij 10 talii",check:(s)=>s.zamkniete>=10},
  {id:"legenda",ikona:"🌟",nazwa:"Legenda gangu",opis:"Zamknij wszystkie talie",check:(s,total)=>s.zamkniete>=total},
  {id:"hojny",ikona:"🎁",nazwa:"Hojny dawca",opis:"Potwierdź 10 wymian",check:(s)=>s.wyslanychKart>=10},
  {id:"mega_hojny",ikona:"💝",nazwa:"Filantrop",opis:"Potwierdź 25 wymian",check:(s)=>s.wyslanychKart>=25},
  {id:"kompletny",ikona:"💎",nazwa:"Perfekcjonista",opis:"Miej ponad 90% kart jednego typu",check:(s)=>s.pctKart>=90},
  {id:"duplikator",ikona:"📦",nazwa:"Magazynier",opis:"Miej 10+ duplikatów",check:(s)=>s.duplikaty>=10},
  {id:"speedrun",ikona:"⚡",nazwa:"Speedrunner",opis:"Potwierdź wymianę w pierwszym dniu",check:(s)=>s.szybkiePotw>0},
];

function OsiagnieciaWidget({talie,czlonkowie,posiadane,duplikaty,zalogowany}) {
  const osoba=czlonkowie.find(c=>normalizuj(c.nazwa)===normalizuj(zalogowany.login));
  if(!osoba) return null;

  const zamkniete=talie.filter(t=>t.karty.every(k=>posiadane[`${osoba.id}_${t.id}_${k.nazwa}`])).length;
  const duplikatyCount=Object.keys(duplikaty).filter(k=>k.startsWith(osoba.id)).length;
  const allKarty=talie.reduce((s,t)=>s+t.karty.length,0);
  const posKarty=talie.reduce((s,t)=>s+t.karty.filter(k=>posiadane[`${osoba.id}_${t.id}_${k.nazwa}`]).length,0);
  const stats={zamkniete,duplikaty:duplikatyCount,pctKart:allKarty?Math.round((posKarty/allKarty)*100):0,wyslanychKart:0,szybkiePotw:0};

  const odblokowane=OSIAGNIECIA_DEF.filter(a=>a.check(stats,talie.length));
  if(!odblokowane.length) return null;

  return (
    <div style={{background:"rgba(255,215,0,0.06)",border:"1px solid #b8860b33",borderRadius:8,padding:"8px 12px",marginBottom:10}}>
      <div style={{fontSize:11,color:"#b8860b",marginBottom:6}}>🏆 Twoje osiągnięcia</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
        {odblokowane.map(a=>(
          <span key={a.id} title={a.opis} style={{fontSize:11,padding:"3px 8px",background:"rgba(255,215,0,0.1)",border:"1px solid #b8860b55",borderRadius:12,color:"var(--accent)",cursor:"default"}}>
            {a.ikona} {a.nazwa}
          </span>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// KALENDARZ EVENTÓW
// ============================================================
function KalendarzEventow() {
  const dzis = new Date();
  const [rok, setRok] = useState(dzis.getFullYear());
  const [miesiac, setMiesiac] = useState(dzis.getMonth());
  const [wybranyDzien, setWybranyDzien] = useState(null);
  const [nowyEvent, setNowyEvent] = useState("");
  const [typEvent, setTypEvent] = useState("złote");
  const [eventy, setEventy] = useState({});

  // Subskrypcja osobnego dokumentu kalendarza
  useEffect(() => {
    const unsub = subscribeKalendarz(d => startTransition(() => setEventy(d)));
    return () => unsub();
  }, []);

  const nazwyMiesiecy = ["Styczeń","Luty","Marzec","Kwiecień","Maj","Czerwiec","Lipiec","Sierpień","Wrzesień","Październik","Listopad","Grudzień"];
  const nazwyDni = ["Pn","Wt","Śr","Cz","Pt","Sb","Nd"];
  const pierwszyDzien = new Date(rok, miesiac, 1).getDay();
  const offsetPn = (pierwszyDzien === 0 ? 6 : pierwszyDzien - 1);
  const liczbaDni = new Date(rok, miesiac + 1, 0).getDate();
  const kluczDnia = (d) => `${rok}-${String(miesiac+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

  const zapiszEventy = (nowe) => {
    setEventy(nowe); // natychmiastowa aktualizacja UI
    zapiszKalendarz(nowe);
  };

  const dodajEvent = () => {
    if (!nowyEvent.trim() || !wybranyDzien) return;
    const klucz = kluczDnia(wybranyDzien);
    const aktualne = eventy[klucz] || [];
    const nowe = { ...eventy, [klucz]: [...aktualne, { tekst: nowyEvent.trim(), typ: typEvent, id: Date.now() }] };
    zapiszEventy(nowe);
    setNowyEvent("");
  };

  const usunEvent = (klucz, id) => {
    const nowe = { ...eventy };
    nowe[klucz] = (nowe[klucz] || []).filter(e => e.id !== id);
    if (!nowe[klucz].length) delete nowe[klucz];
    zapiszEventy(nowe);
  };

  const kolorTypu = { złote: "var(--accent)", diamentowe: "#87CEEB", "event6h_tak": "#0c6", "event6h_nie": "#f55", "karty2x": "#ff6dff", inne: "#fa0" };
  const ikonTypu = { złote: "⭐", diamentowe: "💎", "event6h_tak": "✅", "event6h_nie": "❌", "karty2x": "🃏", inne: "📌" };
  const labelTypu = { złote: "Złote", diamentowe: "Diamentowe", "event6h_tak": "Event 6H ✅", "event6h_nie": "Event 6H ❌", "karty2x": "Karty 2x", inne: "Inne" };

  const wybranyKlucz = wybranyDzien ? kluczDnia(wybranyDzien) : null;
  const eventyWybranego = wybranyKlucz ? (eventy[wybranyKlucz] || []) : [];
  const dzisiajKlucz = `${dzis.getFullYear()}-${String(dzis.getMonth()+1).padStart(2,"0")}-${String(dzis.getDate()).padStart(2,"0")}`;

  return (
    <div>
      <div style={{background:"rgba(100,150,255,0.06)",border:"1px solid #6496ff33",borderRadius:10,padding:12,marginBottom:14}}>
        <div style={{fontSize:14,fontWeight:"bold",color:"#6496ff",marginBottom:4}}>📅 Kalendarz eventów gangu</div>
        <div style={{fontSize:11,color:"var(--muted)"}}>Zapisuj złote/diamentowe dni wymiany i inne eventy. Widoczne dla wszystkich adminów w czasie rzeczywistym.</div>
      </div>

      {/* Nawigacja miesiąca */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <button onClick={()=>{ if(miesiac===0){setMiesiac(11);setRok(r=>r-1);}else setMiesiac(m=>m-1); }} style={{padding:"6px 12px",background:"rgba(255,255,255,0.07)",border:"1px solid var(--border)",borderRadius:6,color:"#aaa",cursor:"pointer",fontSize:13}}>◀</button>
        <div style={{fontSize:15,fontWeight:"bold",color:"var(--accent)"}}>{nazwyMiesiecy[miesiac]} {rok}</div>
        <button onClick={()=>{ if(miesiac===11){setMiesiac(0);setRok(r=>r+1);}else setMiesiac(m=>m+1); }} style={{padding:"6px 12px",background:"rgba(255,255,255,0.07)",border:"1px solid var(--border)",borderRadius:6,color:"#aaa",cursor:"pointer",fontSize:13}}>▶</button>
      </div>

      {/* Siatka kalendarza */}
      <div style={{marginBottom:14}}>
        {/* Nagłówki dni */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
          {nazwyDni.map(d=>(
            <div key={d} style={{textAlign:"center",fontSize:11,color:"#555",padding:"4px 0"}}>{d}</div>
          ))}
        </div>
        {/* Dni */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
          {/* Puste komórki przed pierwszym dniem */}
          {Array(offsetPn).fill(null).map((_,i)=>(
            <div key={`empty-${i}`}/>
          ))}
          {/* Dni miesiąca */}
          {Array(liczbaDni).fill(null).map((_,i)=>{
            const d = i+1;
            const klucz = kluczDnia(d);
            const dniEventy = eventy[klucz] || [];
            const jestDzis = klucz === dzisiajKlucz;
            const wybrany = wybranyDzien === d;
            return (
              <div key={d} onClick={()=>setWybranyDzien(wybrany?null:d)} style={{
                borderRadius:6,padding:"4px 2px",minHeight:44,cursor:"pointer",textAlign:"center",
                background:wybrany?"rgba(255,215,0,0.2)":jestDzis?"rgba(0,200,100,0.1)":"var(--card)",
                border:wybrany?"1px solid #ffd700":jestDzis?"1px solid #0c655":"1px solid #1a1a2e",
                transition:"all 0.1s",
              }}>
                <div style={{fontSize:12,fontWeight:jestDzis?"bold":"normal",color:jestDzis?"#0c6":wybrany?"var(--accent)":"#aaa",marginBottom:2}}>{d}</div>
                <div style={{display:"flex",flexWrap:"wrap",justifyContent:"center",gap:1}}>
                  {dniEventy.slice(0,3).map(e=>(
                    <span key={e.id} style={{fontSize:8,color:kolorTypu[e.typ]||"#aaa"}}>{ikonTypu[e.typ]||"•"}</span>
                  ))}
                  {dniEventy.length>3&&<span style={{fontSize:8,color:"#555"}}>+{dniEventy.length-3}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Panel wybranego dnia */}
      {wybranyDzien&&(
        <div style={{background:"rgba(0,0,0,0.25)",border:"1px solid var(--border)",borderRadius:10,padding:14}}>
          <div style={{fontSize:13,fontWeight:"bold",color:"var(--accent)",marginBottom:10}}>
            📅 {wybranyDzien} {nazwyMiesiecy[miesiac]} {rok}
            {wybranyKlucz===dzisiajKlucz&&<span style={{marginLeft:8,fontSize:11,color:"#0c6"}}>• Dzisiaj</span>}
          </div>

          {/* Istniejące eventy */}
          {eventyWybranego.length===0?(
            <div style={{fontSize:12,color:"#555",marginBottom:10,textAlign:"center"}}>Brak eventów tego dnia</div>
          ):eventyWybranego.map(e=>(
            <div key={e.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",marginBottom:4,background:"var(--card)",border:`1px solid ${kolorTypu[e.typ]||"#333"}33`,borderRadius:6}}>
              <span style={{fontSize:14}}>{ikonTypu[e.typ]||"📌"}</span>
              <span style={{flex:1,fontSize:12,color:"var(--text)"}}>{e.tekst}</span>
              <span style={{fontSize:10,padding:"1px 6px",borderRadius:4,background:`${kolorTypu[e.typ]||"#aaa"}22`,color:kolorTypu[e.typ]||"#aaa"}}>{labelTypu[e.typ]||e.typ}</span>
              <button onClick={()=>usunEvent(wybranyKlucz,e.id)} style={{background:"none",border:"none",color:"#f5544466",cursor:"pointer",fontSize:13}}>✕</button>
            </div>
          ))}

          {/* Dodaj nowy event */}
          <div style={{marginTop:10,borderTop:"1px solid #1a1a2e",paddingTop:10}}>
            <div style={{fontSize:11,color:"#aaa",marginBottom:6}}>+ Dodaj event:</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:6}}>
              {Object.entries(labelTypu).map(([typ,label])=>(
                <button key={typ} onClick={()=>setTypEvent(typ)} style={{
                  padding:"4px 10px",borderRadius:6,fontSize:11,cursor:"pointer",
                  background:typEvent===typ?`${kolorTypu[typ]}22`:"var(--card)",
                  border:typEvent===typ?`1px solid ${kolorTypu[typ]}`:"1px solid var(--border)",
                  color:typEvent===typ?kolorTypu[typ]:"var(--muted)",
                }}>{ikonTypu[typ]} {label}</button>
              ))}
            </div>
            <div style={{display:"flex",gap:6}}>
              <input value={nowyEvent} onChange={e=>setNowyEvent(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&dodajEvent()}
                placeholder="Opis eventu..." style={{
                  flex:1,padding:"8px 10px",background:"var(--card-solid)",border:"1px solid #333",
                  borderRadius:6,color:"#fff",fontSize:12,
                }}/>
              <button onClick={dodajEvent} style={{padding:"8px 14px",background:"linear-gradient(135deg,#b8860b,#ffd700)",border:"none",borderRadius:6,color:"#000",fontWeight:"bold",cursor:"pointer",fontSize:12}}>
                + Dodaj
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Nadchodzące eventy */}
      {(()=>{
        const nadchodzace=[];
        for(let d=0;d<30;d++){
          const dt=new Date(dzis);
          dt.setDate(dt.getDate()+d);
          const k=`d${dt.getFullYear()}_${String(dt.getMonth()+1).padStart(2,"0")}_${String(dt.getDate()).padStart(2,"0")}`;
          if(eventy[k]?.length){
            nadchodzace.push({data:dt,klucz:k,eventy:eventy[k],dzisiaj:k===dzisiajKlucz});
          }
        }
        if(!nadchodzace.length) return null;
        return (
          <div style={{marginTop:14,background:"rgba(0,0,0,0.2)",border:"1px solid var(--border)",borderRadius:10,padding:12}}>
            <div style={{fontSize:12,fontWeight:"bold",color:"#6496ff",marginBottom:8}}>📋 Nadchodzące eventy (30 dni)</div>
            {nadchodzace.map(({data,klucz,eventy:ev,dzisiaj})=>(
              <div key={klucz} style={{marginBottom:6,padding:"6px 8px",background:"var(--card)",borderRadius:6,borderLeft:`3px solid ${dzisiaj?"#0c6":"#6496ff"}`}}>
                <div style={{fontSize:11,color:dzisiaj?"#0c6":"#6496ff",fontWeight:"bold",marginBottom:3}}>
                  {dzisiaj?"🟢 Dzisiaj":"📅"} {data.getDate()} {nazwyMiesiecy[data.getMonth()]}
                </div>
                {ev.map(e=>(
                  <div key={e.id} style={{fontSize:11,color:"#aaa",display:"flex",alignItems:"center",gap:4}}>
                    <span>{ikonTypu[e.typ]}</span>
                    <span style={{color:kolorTypu[e.typ]||"#aaa"}}>[{labelTypu[e.typ]||e.typ}]</span>
                    <span>{e.tekst}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

// ============================================================
// LOGI LOGOWAŃ
// ============================================================
function LogiLogowan({isAdmin=false, zablokowane=[], onZablokuj, onOdblokuj}) {
  const [logi, setLogi] = useState([]);
  const [filtrNick, setFiltrNick] = useState("");
  const [pokazTylkoNowe, setPokazTylkoNowe] = useState(false);

  useEffect(() => {
    const unsub = subscribeLogi(d => startTransition(() => setLogi(d)));
    return () => unsub();
  }, []);

  const filtered = logi
    .filter(l => !filtrNick || normalizuj(l.nick||"").includes(normalizuj(filtrNick)))
    .filter(l => !pokazTylkoNowe || l.noweUrzadzenie);

  const formatCzas = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString("pl-PL");
    } catch { return iso; }
  };

  // Statystyki
  const noweUrzadzenia = logi.filter(l => l.noweUrzadzenie);
  const unikalne = [...new Set(logi.map(l=>l.nick))];

  return (
    <div>
      <div style={{background:"rgba(255,50,50,0.06)",border:"1px solid #f5544433",borderRadius:10,padding:14,marginBottom:14}}>
        <div style={{fontSize:14,fontWeight:"bold",color:"#f55",marginBottom:8}}>🔒 Logi logowań</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"8px 14px",flex:1}}>
            <div style={{fontSize:22,fontWeight:"bold",color:"var(--accent)"}}>{logi.length}</div>
            <div style={{fontSize:11,color:"var(--muted)"}}>logowań łącznie</div>
          </div>
          <div style={{background:"rgba(255,50,50,0.1)",border:"1px solid #f5544433",borderRadius:8,padding:"8px 14px",flex:1}}>
            <div style={{fontSize:22,fontWeight:"bold",color:"#f55"}}>{noweUrzadzenia.length}</div>
            <div style={{fontSize:11,color:"var(--muted)"}}>nowych urządzeń</div>
          </div>
          <div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"8px 14px",flex:1}}>
            <div style={{fontSize:22,fontWeight:"bold",color:"#0c6"}}>{unikalne.length}</div>
            <div style={{fontSize:11,color:"var(--muted)"}}>unikalnych nicków</div>
          </div>
        </div>
      </div>

      {noweUrzadzenia.length>0&&(
        <div style={{background:"rgba(255,50,50,0.1)",border:"2px solid #f55",borderRadius:10,padding:12,marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:"bold",color:"#f55",marginBottom:8}}>⚠️ Wykryto logowania z nowych urządzeń!</div>
          {noweUrzadzenia.slice(0,5).map((l,i)=>(
            <div key={i} style={{fontSize:12,color:"#fa0",padding:"3px 0",borderBottom:"1px solid #f5544422"}}>
              🔴 <strong>{l.nick}</strong> — nowe urządzenie [{l.fp}] — {formatCzas(l.czas)}
            </div>
          ))}
        </div>
      )}

      {/* Filtry */}
      <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
        <input value={filtrNick} onChange={e=>setFiltrNick(e.target.value)}
          placeholder="Szukaj nicku..."
          style={{flex:1,padding:"7px 10px",background:"var(--card-solid)",border:"1px solid #333",borderRadius:6,color:"#fff",fontSize:12}}/>
        <button onClick={()=>setPokazTylkoNowe(p=>!p)} style={{
          padding:"7px 12px",borderRadius:6,fontSize:12,cursor:"pointer",
          background:pokazTylkoNowe?"rgba(255,50,50,0.2)":"var(--card)",
          border:pokazTylkoNowe?"1px solid #f55":"1px solid #333",
          color:pokazTylkoNowe?"#f55":"var(--muted)",
        }}>⚠️ Tylko nowe urządzenia</button>
      </div>

      {/* Lista logów */}
      <div style={{maxHeight:400,overflowY:"auto"}}>
        {filtered.length===0?(
          <div style={{textAlign:"center",padding:20,color:"#555",fontSize:12}}>Brak logów</div>
        ):filtered.map((l,i)=>(
          <div key={i} style={{
            display:"flex",alignItems:"center",gap:8,padding:"8px 10px",marginBottom:3,
            background:l.noweUrzadzenie?"rgba(255,50,50,0.08)":"var(--card)",
            border:`1px solid ${l.noweUrzadzenie?"#f5544433":"#1a1a2e"}`,
            borderRadius:6,
          }}>
            <span style={{fontSize:14}}>
              {l.noweUrzadzenie?"🔴":l.typ==="wejscie"?"🟢":l.rola==="admin"?"👑":l.rola==="zastepca"?"⚔️":"👤"}
            </span>
            <div style={{flex:1}}>
              <div style={{fontSize:12,fontWeight:"bold",color:l.noweUrzadzenie?"#f55":"var(--text)"}}>
                {l.nick}
                {l.noweUrzadzenie&&<span style={{fontSize:10,color:"#f55",marginLeft:6,background:"rgba(255,50,50,0.15)",padding:"1px 5px",borderRadius:4}}>NOWE URZĄDZENIE!</span>}
                {l.typ==="wejscie"&&<span style={{fontSize:10,color:"#0c6",marginLeft:6,background:"rgba(0,200,100,0.1)",padding:"1px 5px",borderRadius:4}}>wejście</span>}
                {l.typ==="login"&&<span style={{fontSize:10,color:"var(--muted)",marginLeft:6,background:"var(--card)",padding:"1px 5px",borderRadius:4}}>logowanie</span>}
                {l.typ==="login_nowe_urzadzenie"&&<span style={{fontSize:10,color:"#f55",marginLeft:6,background:"rgba(255,50,50,0.1)",padding:"1px 5px",borderRadius:4}}>nowe urządzenie</span>}
                <span style={{fontSize:10,color:"#555",marginLeft:6}}>{l.rola}</span>
                {l.noweUrzadzenie&&isAdmin&&(
                  <button
                    onClick={()=>onZablokuj(l.fp, l.nick)}
                    style={{fontSize:9,padding:"1px 6px",background:"rgba(255,50,50,0.15)",border:"1px solid #f5544455",borderRadius:3,color:"#f55",cursor:"pointer",marginLeft:4}}>
                    🚫 Zablokuj
                  </button>
                )}
              </div>
              <div style={{fontSize:10,color:"#555",display:"flex",gap:8}}>
                <span>🕐 {formatCzas(l.czas)}</span>
                <span>🔑 {l.fp}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Zablokowane urządzenia */}
      {isAdmin && zablokowane.length > 0 && (
        <div style={{marginTop:16,background:"rgba(255,50,50,0.06)",border:"1px solid #f5544433",borderRadius:10,padding:14}}>
          <div style={{fontSize:13,fontWeight:"bold",color:"#f55",marginBottom:10}}>
            🚫 Zablokowane urządzenia ({zablokowane.length})
          </div>
          {zablokowane.map((z,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:"rgba(0,0,0,0.2)",borderRadius:6,marginBottom:4}}>
              <div style={{flex:1}}>
                <span style={{fontSize:12,color:"#f88",fontWeight:"bold"}}>{z.nick}</span>
                <span style={{fontSize:10,color:"#555",marginLeft:8}}>fp: {z.fp}</span>
                {z.czas&&<span style={{fontSize:10,color:"#444",marginLeft:8}}>{new Date(z.czas).toLocaleDateString("pl-PL")}</span>}
              </div>
              <button onClick={()=>onOdblokuj(z.fp)}
                style={{fontSize:10,padding:"3px 8px",background:"rgba(0,200,100,0.1)",border:"1px solid #0c633",borderRadius:4,color:"#0c6",cursor:"pointer"}}>
                ✓ Odblokuj
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ============================================================
// ADMIN DASHBOARD
// ============================================================
function ZarzadzajiePinami({czlonkowie}) {
  const [statusy, setStatusy] = useState({});
  const [ladowanie, setLadowanie] = useState(false);
  const [resetowany, setResetowany] = useState(null);

  useEffect(()=>{
    pobierzStatusyPinow().then(setStatusy);
  },[]);

  const resetPin = async (nick) => {
    if (!window.confirm(`Zresetować PIN dla ${nick}?\n\nPrzy następnym logowaniu będzie musiał ustawić nowy.`)) return;
    setResetowany(nick);
    await resetujPin(nick);
    setStatusy(prev => {const n={...prev}; delete n[nick]; return n;});
    setResetowany(null);
  };

  const odswież = async () => {
    setLadowanie(true);
    const s = await pobierzStatusyPinow();
    setStatusy(s);
    setLadowanie(false);
  };

  return (
    <div style={{marginBottom:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div style={{fontSize:13,fontWeight:"bold",color:"var(--accent)"}}>🔐 PINy członków</div>
        <button onClick={odswież} style={{fontSize:10,padding:"3px 8px",background:"rgba(255,215,0,0.1)",border:"1px solid #ffd70033",borderRadius:4,color:"var(--accent)",cursor:"pointer"}}>
          {ladowanie?"⏳":"🔄"} Odśwież
        </button>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
        {czlonkowie.map(c=>{
          const maPIN = statusy[c.nazwa];
          return (
            <div key={c.id} style={{
              display:"flex",alignItems:"center",gap:6,
              padding:"5px 10px",borderRadius:8,
              background:maPIN?"rgba(0,200,100,0.08)":"rgba(255,50,50,0.08)",
              border:maPIN?"1px solid #0c633":"1px solid #f5544433",
            }}>
              <span style={{fontSize:11,color:maPIN?"#0c6":"#f55"}}>
                {maPIN?"🔐":"⚠️"} {c.nazwa}
              </span>
              {maPIN&&(
                <button onClick={()=>resetPin(c.nazwa)} disabled={resetowany===c.nazwa}
                  style={{fontSize:9,padding:"1px 6px",background:"rgba(255,50,50,0.15)",border:"1px solid #f5544433",borderRadius:3,color:"#f55",cursor:"pointer"}}>
                  {resetowany===c.nazwa?"...":"reset"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div style={{fontSize:10,color:"#555",marginTop:8}}>
        🔐 PIN ustawiony · ⚠️ Brak PINu (przy logowaniu będzie musiał ustawić)
      </div>
    </div>
  );
}

function AdminDashboard({dane, talie, historiaWymian, statusOnline, zapiszStrukture, walki=[], archiwumWalk=[]}) {
  const czlonkowie = dane?.czlonkowie || [];
  const posiadane = dane?.posiadane || {};
  const duplikaty = dane?.duplikaty || {};
  const aktywnaWymiana = dane?.aktywnaWymiana;

  const teraz = Date.now();
  const ONLINE_PROG = 90000;

  // Ranking wojowników — uczestnictwo w walkach
  const udzialWalkach = {};
  walki.forEach(w => {
    (w.uczestnicy || []).forEach(nick => {
      if (!udzialWalkach[nick]) udzialWalkach[nick] = 0;
      udzialWalkach[nick]++;
    });
  });
  const rankingWojownikow = czlonkowie
    .map(c => ({ c, udzial: udzialWalkach[c.nazwa] || 0 }))
    .sort((a,b) => b.udzial - a.udzial);
  const maxUdzial = Math.max(...rankingWojownikow.map(r => r.udzial), 1);

  // === ONLINE ===
  const onlineNicki = Object.entries(statusOnline)
    .filter(([,ts]) => teraz - ts < ONLINE_PROG)
    .map(([nick]) => nick);

  // === STATYSTYKI KART ===
  const statKarty = czlonkowie.map(c => {
    const karty = talie.reduce((s,t) => s + t.karty.filter(k => posiadane[`${c.id}_${t.id}_${k.nazwa}`]).length, 0);
    const total = talie.reduce((s,t) => s + t.karty.length, 0);
    const dup = talie.reduce((s,t) => s + t.karty.filter(k => duplikaty[`${c.id}_${t.id}_${k.nazwa}`]).length, 0);
    const zamkniete = talie.filter(t => t.karty.length > 0 && t.karty.every(k => posiadane[`${c.id}_${t.id}_${k.nazwa}`])).length;
    const ammo = talie.filter(t => t.karty.every(k => posiadane[`${c.id}_${t.id}_${k.nazwa}`]))
      .reduce((s,t) => s + pobierzNagrode(t, c.krag||1), 0);
    return { c, karty, total, dup, zamkniete, ammo, pct: total ? Math.round(karty/total*100) : 0 };
  }).sort((a,b) => b.karty - a.karty);

  // === AKTYWNOŚĆ Z HISTORII ===
  const aktywnosc = {}; // nick → {potwierdzone, ostatnia}
  historiaWymian.forEach(w => {
    const potw = w.potwierdzone || {};
    Object.entries(potw).forEach(([nick, val]) => {
      if (!aktywnosc[nick]) aktywnosc[nick] = { potwierdzone: 0, ostatnia: null };
      if (val) {
        aktywnosc[nick].potwierdzone++;
        const data = new Date(w.data);
        if (!aktywnosc[nick].ostatnia || data > aktywnosc[nick].ostatnia)
          aktywnosc[nick].ostatnia = data;
      }
    });
  });

  // Nieaktywni — brak potwierdzenia w ostatnich 2 wymianach
  const ostatnie2 = historiaWymian.slice(0, 2);
  const nieaktywni = czlonkowie.filter(c => {
    return ostatnie2.some(w => {
      // Czy ten czlonek był w tej wymianie i nie potwierdził?
      const byW = (w.wymiany||[]).some(x => normalizuj(x.od) === normalizuj(c.nazwa));
      const potw = Object.entries(w.potwierdzone||{}).find(([k]) => normalizuj(k) === normalizuj(c.nazwa));
      return byW && (!potw || !potw[1]);
    });
  });

  // === AMMO GANGU ŁĄCZNIE ===
  const ammoGangu = statKarty.reduce((s,x) => s + x.ammo, 0);
  const kartyGangu = statKarty.reduce((s,x) => s + x.karty, 0);
  const totalKartyMax = statKarty.reduce((s,x) => s + x.total, 0);

  // Niepotwierdzona wymiana
  const niepotwierdzonychCount = aktywnaWymiana
    ? Object.keys(aktywnaWymiana.wymiany?.reduce((a,w)=>{a[w.od]=1;return a;},{})||{})
        .filter(n => !(aktywnaWymiana.potwierdzone||{})[n]).length
    : 0;

  // Formatowanie daty
  const dataTemu = (d) => {
    if (!d) return "nigdy";
    const diff = Math.floor((teraz - d.getTime()) / 86400000);
    if (diff === 0) return "dzisiaj";
    if (diff === 1) return "wczoraj";
    return `${diff} dni temu`;
  };

  // Ranking aktywności
  const rankingAktywnosci = czlonkowie.map(c => {
    const a = aktywnosc[c.nazwa] || { potwierdzone: 0, ostatnia: null };
    return { c, ...a };
  }).sort((a,b) => b.potwierdzone - a.potwierdzone);

  const maxPotw = Math.max(...rankingAktywnosci.map(r => r.potwierdzone), 1);

  // Najlepsza/najgorsza talia gangu
  const talieStats = talie.map(t => {
    const zamkniete = czlonkowie.filter(c => t.karty.every(k => posiadane[`${c.id}_${t.id}_${k.nazwa}`])).length;
    return { t, zamkniete, pct: Math.round(zamkniete/Math.max(1,czlonkowie.length)*100) };
  }).sort((a,b) => b.pct - a.pct);

  return (
    <div style={{animation:"fadeIn 0.3s ease"}}>
      <div style={{fontSize:16,fontWeight:"bold",color:"var(--accent)",marginBottom:14,display:"flex",alignItems:"center",gap:8}}>
        📊 Dashboard admina
        <span style={{fontSize:11,color:"#555",fontWeight:"normal"}}>— dane na żywo</span>
      </div>

      {/* === ROW 1: Kafelki główne === */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8,marginBottom:12}}>
        {/* Online */}
        <div style={{background:"rgba(0,200,100,0.08)",border:"1px solid #0c644",borderRadius:10,padding:12}}>
          <div style={{fontSize:11,color:"#0c6",marginBottom:4}}>🟢 Online teraz</div>
          <div style={{fontSize:28,fontWeight:"bold",color:"#0c6"}}>{onlineNicki.length}</div>
          <div style={{fontSize:10,color:"#555"}}>z {czlonkowie.length} członków</div>
          <div style={{marginTop:6,display:"flex",flexWrap:"wrap",gap:3}}>
            {onlineNicki.map(n => (
              <span key={n} style={{fontSize:9,padding:"1px 6px",background:"rgba(0,200,100,0.15)",borderRadius:8,color:"#0c6"}}>{n}</span>
            ))}
          </div>
        </div>

        {/* Aktywna wymiana */}
        <div style={{
          background: aktywnaWymiana ? "rgba(255,215,0,0.08)" : "var(--card)",
          border: aktywnaWymiana ? "1px solid #ffd70044" : "1px solid #1a1a2e",
          borderRadius:10,padding:12,
        }}>
          <div style={{fontSize:11,color:"var(--accent)",marginBottom:4}}>📋 Aktywna wymiana</div>
          {aktywnaWymiana ? (
            <>
              <div style={{fontSize:22,fontWeight:"bold",color:"var(--accent)"}}>
                {Object.values(aktywnaWymiana.potwierdzone||{}).filter(Boolean).length}
                <span style={{fontSize:13,color:"var(--muted)",fontWeight:"normal"}}>/{Object.keys(aktywnaWymiana.wymiany?.reduce((a,w)=>{a[w.od]=1;return a;},{}) || {}).length}</span>
              </div>
              <div style={{fontSize:10,color:"var(--muted)"}}>potwierdzeń</div>
              {niepotwierdzonychCount > 0 && (
                <div style={{marginTop:4,fontSize:10,color:"#f55",background:"rgba(255,50,50,0.1)",padding:"2px 6px",borderRadius:4,display:"inline-block"}}>
                  ⚠️ {niepotwierdzonychCount} nie potwierdziło
                </div>
              )}
            </>
          ) : (
            <div style={{fontSize:12,color:"#555",marginTop:6}}>Brak aktywnej wymiany</div>
          )}
        </div>

        {/* Ammo gangu */}
        <div style={{background:"rgba(255,165,0,0.06)",border:"1px solid #fa033",borderRadius:10,padding:12}}>
          <div style={{fontSize:11,color:"#fa0",marginBottom:4}}>💰 Ammo gangu (sezon)</div>
          <div style={{fontSize:22,fontWeight:"bold",color:"#fa0"}}>{ammoGangu.toLocaleString()}</div>
          <div style={{fontSize:10,color:"#555"}}>łącznie zdobyte</div>
          <div style={{marginTop:4,fontSize:10,color:"var(--muted)"}}>{historiaWymian.length} wymian w historii</div>
        </div>

        {/* Postęp kart */}
        <div style={{background:"rgba(135,206,235,0.06)",border:"1px solid #87CEEB33",borderRadius:10,padding:12}}>
          <div style={{fontSize:11,color:"#87CEEB",marginBottom:4}}>🃏 Karty gangu</div>
          <div style={{fontSize:22,fontWeight:"bold",color:"#87CEEB"}}>{Math.round(kartyGangu/Math.max(1,totalKartyMax/czlonkowie.length*czlonkowie.length)*100)}%</div>
          <div style={{fontSize:10,color:"#555"}}>{kartyGangu.toLocaleString()} / {totalKartyMax.toLocaleString()} łącznie</div>
          <div style={{height:4,background:"var(--card-solid)",borderRadius:2,marginTop:6,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${kartyGangu/Math.max(1,totalKartyMax)*100}%`,background:"linear-gradient(90deg,#4169E1,#87CEEB)",borderRadius:2}}/>
          </div>
        </div>
      </div>

      {/* === NIEAKTYWNI ALERT === */}
      {nieaktywni.length > 0 && (
        <div style={{background:"rgba(255,50,50,0.08)",border:"1px solid #f5544433",borderRadius:10,padding:12,marginBottom:12}}>
          <div style={{fontSize:12,fontWeight:"bold",color:"#f55",marginBottom:6}}>
            ⚠️ Nie potwierdzili ostatnich wymian ({nieaktywni.length} osób)
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
            {nieaktywni.map(c => (
              <span key={c.id} style={{fontSize:11,padding:"2px 8px",background:"rgba(255,50,50,0.15)",border:"1px solid #f5544433",borderRadius:6,color:"#f88"}}>{c.nazwa}</span>
            ))}
          </div>
        </div>
      )}

      {/* === RANKING KART === */}
      <div style={{background:"rgba(0,0,0,0.2)",border:"1px solid var(--border)",borderRadius:10,padding:12,marginBottom:12}}>
        <div style={{fontSize:13,fontWeight:"bold",color:"var(--accent)",marginBottom:10}}>🏆 Ranking — postęp kolekcji</div>
        {statKarty.map((s,i) => {
          const isOnline = onlineNicki.some(n => normalizuj(n) === normalizuj(s.c.nazwa));
          return (
            <div key={s.c.id} style={{
              display:"flex",alignItems:"center",gap:8,padding:"6px 8px",marginBottom:3,
              background:i===0?"rgba(255,215,0,0.06)":"rgba(255,255,255,0.02)",
              borderRadius:6,border:i===0?"1px solid #ffd70022":"1px solid transparent",
            }}>
              <span style={{fontSize:11,color:"#555",width:18,textAlign:"right"}}>{i+1}.</span>
              <div style={{width:6,height:6,borderRadius:"50%",background:isOnline?"#0c6":"#333",flexShrink:0,boxShadow:isOnline?"0 0 4px #0c6":"none"}}/>
              <span style={{flex:1,fontSize:12,color:i===0?"var(--accent)":"var(--text)"}}>{s.c.nazwa}</span>
              {s.c.krag > 1 && <span style={{fontSize:9,color:"#da70d6"}}>K{s.c.krag}</span>}
              <span style={{fontSize:10,color:"#555"}}>{s.zamkniete}/{talie.length} talii</span>
              <div style={{width:60,height:5,background:"var(--card-solid)",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${s.pct}%`,background:s.pct===100?"#0c6":"linear-gradient(90deg,#b8860b,#ffd700)",borderRadius:3}}/>
              </div>
              <span style={{fontSize:11,color:"var(--muted)",width:32,textAlign:"right"}}>{s.pct}%</span>
              {s.dup > 0 && <span style={{fontSize:9,color:"#87CEEB88"}}>+{s.dup}dup</span>}
            </div>
          );
        })}
      </div>

      {/* === RANKING WOJOWNIKÓW === */}
      {walki.length > 0 && czlonkowie.length > 0 && (
        <div style={{background:"rgba(0,0,0,0.2)",border:"1px solid var(--border)",borderRadius:10,padding:12,marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:"bold",color:"var(--accent)",marginBottom:10}}>
            🏅 Ranking wojowników
            <span style={{fontSize:10,color:"#555",fontWeight:"normal",marginLeft:6}}>uczestnictwo w walkach</span>
          </div>
          {rankingWojownikow.map((r,i) => {
            const pct = Math.round(r.udzial / maxUdzial * 100);
            const pctWalk = walki.length > 0 ? Math.round(r.udzial / walki.length * 100) : 0;
            const kolor = pct >= 80 ? "#0c6" : pct >= 40 ? "#fa0" : "#f55";
            const medal = i===0?"🥇":i===1?"🥈":i===2?"🥉":`${i+1}.`;
            return (
              <div key={r.c.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",marginBottom:3,borderRadius:6,background:i<3?"rgba(255,255,255,0.03)":"transparent"}}>
                <span style={{fontSize:i<3?14:11,width:22,textAlign:"center",flexShrink:0}}>{medal}</span>
                <span style={{flex:1,fontSize:12,color:"var(--text)"}}>{r.c.nazwa}</span>
                <div style={{width:70,height:5,background:"var(--card-solid)",borderRadius:3,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${pct}%`,background:kolor,borderRadius:3}}/>
                </div>
                <span style={{fontSize:11,color:kolor,fontWeight:"bold",width:34,textAlign:"right"}}>{r.udzial}/{walki.length}</span>
                {r.udzial === 0
                  ? <span style={{fontSize:9,padding:"1px 6px",borderRadius:10,background:"rgba(255,50,50,0.1)",border:"1px solid #f5544433",color:"#f55"}}>🤔 nieobecny</span>
                  : pctWalk >= 80
                  ? <span style={{fontSize:9,padding:"1px 6px",borderRadius:10,background:"rgba(0,200,100,0.12)",border:"1px solid #0c633",color:"#0c6"}}>🔥 aktywny</span>
                  : pctWalk < 40
                  ? <span style={{fontSize:9,padding:"1px 6px",borderRadius:10,background:"rgba(255,165,0,0.1)",border:"1px solid #fa055",color:"#fa0"}}>😴 rzadki</span>
                  : null
                }
              </div>
            );
          })}
        </div>
      )}

      {/* === AKTYWNOŚĆ WYMIAN === */}
      <div style={{background:"rgba(0,0,0,0.2)",border:"1px solid var(--border)",borderRadius:10,padding:12,marginBottom:12}}>
        <div style={{fontSize:13,fontWeight:"bold",color:"var(--accent)",marginBottom:10}}>
          📈 Aktywność — potwierdzenia wymian
          <span style={{fontSize:10,color:"#555",fontWeight:"normal",marginLeft:6}}>({historiaWymian.length} wymian w historii)</span>
        </div>
        {rankingAktywnosci.map((r,i) => {
          const pct = Math.round(r.potwierdzone / maxPotw * 100);
          const isOnline = onlineNicki.some(n => normalizuj(n) === normalizuj(r.c.nazwa));
          const kolor = r.potwierdzone >= maxPotw * 0.8 ? "#0c6" : r.potwierdzone >= maxPotw * 0.4 ? "#fa0" : "#f55";
          return (
            <div key={r.c.id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 8px",marginBottom:2,borderRadius:5}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:isOnline?"#0c6":"#333",flexShrink:0}}/>
              <span style={{flex:1,fontSize:12,color:"var(--text)"}}>{r.c.nazwa}</span>
              <span style={{fontSize:10,color:"#555",width:60,textAlign:"right"}}>{r.ostatnia ? dataTemu(r.ostatnia) : "brak"}</span>
              <div style={{width:80,height:5,background:"var(--card-solid)",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${pct}%`,background:kolor,borderRadius:3}}/>
              </div>
              <span style={{fontSize:11,fontWeight:"bold",color:kolor,width:28,textAlign:"right"}}>{r.potwierdzone}</span>
            </div>
          );
        })}
      </div>

      {/* === TALIE GANGU === */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
        <div style={{background:"rgba(0,200,100,0.06)",border:"1px solid #0c633",borderRadius:10,padding:12}}>
          <div style={{fontSize:11,color:"#0c6",fontWeight:"bold",marginBottom:6}}>✅ Najlepiej opanowane talie</div>
          {talieStats.slice(0,3).map(s => (
            <div key={s.t.id} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"3px 0",borderBottom:"1px solid #0c61122"}}>
              <span style={{color:"#aaa",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.t.nazwa}</span>
              <span style={{color:"#0c6",fontWeight:"bold",marginLeft:6}}>{s.pct}%</span>
            </div>
          ))}
        </div>
        <div style={{background:"rgba(255,50,50,0.06)",border:"1px solid #f5544433",borderRadius:10,padding:12}}>
          <div style={{fontSize:11,color:"#f55",fontWeight:"bold",marginBottom:6}}>❌ Najtrudniejsze talie</div>
          {talieStats.slice(-3).reverse().map(s => (
            <div key={s.t.id} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"3px 0",borderBottom:"1px solid #f5544411"}}>
              <span style={{color:"#aaa",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.t.nazwa}</span>
              <span style={{color:"#f55",fontWeight:"bold",marginLeft:6}}>{s.pct}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* === EFEKTYWNOŚĆ WYMIAN === */}
      {historiaWymian.length > 0 && (
        <div style={{background:"rgba(0,0,0,0.2)",border:"1px solid var(--border)",borderRadius:10,padding:12}}>
          <div style={{fontSize:13,fontWeight:"bold",color:"var(--accent)",marginBottom:10}}>📊 Efektywność wymian</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
            {[
              {
                label:"Śr. potwierdzeń",
                val: Math.round(historiaWymian.reduce((s,w) =>
                  s + Object.values(w.potwierdzone||{}).filter(Boolean).length, 0
                ) / historiaWymian.length) + "%",
                color:"#0c6",
              },
              {
                label:"Śr. wymian/sesja",
                val: Math.round(historiaWymian.reduce((s,w) => s + (w.lacznieWymian||0), 0) / historiaWymian.length),
                color:"var(--accent)",
              },
              {
                label:"Sesji łącznie",
                val: historiaWymian.length,
                color:"#87CEEB",
              },
            ].map(s => (
              <div key={s.label} style={{textAlign:"center",background:"rgba(0,0,0,0.2)",borderRadius:8,padding:"10px 6px"}}>
                <div style={{fontSize:20,fontWeight:"bold",color:s.color}}>{s.val}</div>
                <div style={{fontSize:9,color:"#555",marginTop:2}}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ============================================================
// KALKULATOR OPŁACALNOŚCI EVENTU
// ============================================================
function RzadkieKarty({ talie, czlonkowie, posiadane, duplikaty }) {
  const [filtr, setFiltr] = useState("rzadkie"); // rzadkie / duplikaty / brakuje
  const [filtrTalia, setFiltrTalia] = useState("wszystkie");
  const [filtrTyp, setFiltrTyp] = useState("wszystkie"); // wszystkie / złota / diamentowa
  const [limit, setLimit] = useState(20);

  const totalOsob = czlonkowie.length;

  // Oblicz statystyki dla każdej karty
  const statystyki = [];
  talie.forEach(talia => {
    talia.karty.forEach(karta => {
      const ilePosiada = czlonkowie.filter(c =>
        posiadane[`${c.id}_${talia.id}_${karta.nazwa}`]
      ).length;
      const ileDuplikatow = czlonkowie.filter(c =>
        duplikaty[`${c.id}_${talia.id}_${karta.nazwa}`]
      ).length;
      const procent = Math.round(ilePosiada / totalOsob * 100);

      statystyki.push({
        talia: talia.nazwa,
        taliaId: talia.id,
        taliaNumer: talia.numer || 99,
        karta: karta.nazwa,
        typ: karta.typ,
        ilePosiada,
        ileDuplikatow,
        brakuje: totalOsob - ilePosiada,
        procent,
      });
    });
  });

  // Filtruj
  let filtered = statystyki;
  if (filtrTalia !== "wszystkie") filtered = filtered.filter(s => s.taliaNumer === parseInt(filtrTalia));
  if (filtrTyp !== "wszystkie") filtered = filtered.filter(s => s.typ === filtrTyp);

  // Sortuj wg trybu
  let sorted;
  if (filtr === "rzadkie") {
    sorted = [...filtered].sort((a, b) => a.ilePosiada - b.ilePosiada || a.taliaNumer - b.taliaNumer);
  } else if (filtr === "duplikaty") {
    sorted = [...filtered].sort((a, b) => a.ileDuplikatow - b.ileDuplikatow || a.taliaNumer - b.taliaNumer);
  } else {
    sorted = [...filtered].sort((a, b) => b.brakuje - a.brakuje || a.taliaNumer - b.taliaNumer);
  }

  const pokazywane = sorted.slice(0, limit);

  // Kolory
  const kolorProcent = (p) => p <= 20 ? "#f55" : p <= 50 ? "#fa0" : p <= 80 ? "var(--accent)" : "#0c6";
  const kolorTyp = (typ) => typ === "złota" ? "var(--accent)" : "#87CEEB";

  return (
    <div>
      <div style={{background:"rgba(100,150,255,0.06)",border:"1px solid #6496ff33",borderRadius:10,padding:12,marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:"bold",color:"#6496ff",marginBottom:2}}>💎 Rzadkie karty gangu</div>
        <div style={{fontSize:11,color:"#555"}}>
          Analiza na podstawie danych {totalOsob} członków · {statystyki.length} kart łącznie
        </div>
      </div>

      {/* Tryb widoku */}
      <div style={{display:"flex",gap:5,marginBottom:10,flexWrap:"wrap"}}>
        {[
          {id:"rzadkie", label:"💎 Najrzadsze", opis:"kto najmniej posiada"},
          {id:"duplikaty", label:"📦 Brak duplikatów", opis:"najmniej duplikatów"},
          {id:"brakuje", label:"❌ Brakuje", opis:"ile osób nie ma"},
        ].map(t=>(
          <button key={t.id} onClick={()=>setFiltr(t.id)} style={{
            padding:"6px 12px",borderRadius:7,cursor:"pointer",fontSize:11,fontWeight:"bold",
            background:filtr===t.id?"linear-gradient(135deg,#1a3a8f,#6496ff)":"var(--card)",
            border:filtr===t.id?"none":"1px solid var(--border)",
            color:filtr===t.id?"#fff":"var(--muted)",
          }}>
            {t.label}
            <div style={{fontSize:9,fontWeight:"normal",color:filtr===t.id?"#aaa":"#444"}}>{t.opis}</div>
          </button>
        ))}
      </div>

      {/* Filtry */}
      <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
        <select value={filtrTalia} onChange={e=>setFiltrTalia(e.target.value)}
          style={{padding:"5px 8px",background:"var(--card-solid)",border:"1px solid #333",borderRadius:5,color:"#aaa",fontSize:11}}>
          <option value="wszystkie">Wszystkie talie</option>
          {[...talie].sort((a,b)=>(a.numer||99)-(b.numer||99)).map(t=>(
            <option key={t.id} value={t.numer||99}>#{t.numer||"?"} {t.nazwa}</option>
          ))}
        </select>
        <select value={filtrTyp} onChange={e=>setFiltrTyp(e.target.value)}
          style={{padding:"5px 8px",background:"var(--card-solid)",border:"1px solid #333",borderRadius:5,color:"#aaa",fontSize:11}}>
          <option value="wszystkie">Złote + Diamentowe</option>
          <option value="złota">⭐ Tylko złote</option>
          <option value="diamentowa">💎 Tylko diamentowe</option>
        </select>
      </div>

      {/* Lista kart */}
      <div style={{marginBottom:10}}>
        {/* Nagłówek */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 80px 80px 80px",gap:4,padding:"4px 8px",marginBottom:4}}>
          {["Karta","Posiada","Duplikaty","Brakuje"].map(h=>(
            <div key={h} style={{fontSize:9,color:"#444",textAlign:"center"}}>{h}</div>
          ))}
        </div>

        {pokazywane.map((s,i)=>{
          const kolor = kolorProcent(s.procent);
          const pasek = `${s.procent}%`;
          return (
            <div key={`${s.taliaId}_${s.karta}`} style={{
              display:"grid",gridTemplateColumns:"1fr 80px 80px 80px",
              gap:4,padding:"7px 8px",marginBottom:3,borderRadius:7,
              background:"rgba(0,0,0,0.2)",
              border:`1px solid ${s.procent<=20?"#f5544422":s.procent<=50?"#fa055":"var(--border)"}`,
              position:"relative",overflow:"hidden",alignItems:"center",
            }}>
              {/* Pasek tła */}
              <div style={{position:"absolute",left:0,top:0,bottom:0,width:pasek,background:`${kolor}08`,zIndex:0}}/>
              {/* Nazwa karty */}
              <div style={{zIndex:1}}>
                <div style={{fontSize:11,color:"var(--text)",fontWeight:s.procent<=20?"bold":"normal"}}>
                  <span style={{fontSize:9,color:kolorTyp(s.typ),marginRight:4}}>
                    {s.typ==="złota"?"⭐":"💎"}
                  </span>
                  {s.karta}
                </div>
                <div style={{fontSize:9,color:"#444"}}>#{s.taliaNumer} {s.talia}</div>
              </div>
              {/* Posiada */}
              <div style={{textAlign:"center",zIndex:1}}>
                <div style={{fontSize:12,fontWeight:"bold",color:kolor}}>{s.ilePosiada}/{totalOsob}</div>
                <div style={{fontSize:8,color:"#555"}}>{s.procent}%</div>
              </div>
              {/* Duplikaty */}
              <div style={{textAlign:"center",zIndex:1}}>
                <div style={{fontSize:12,fontWeight:"bold",color:s.ileDuplikatow>0?"#87CEEB":"#333"}}>
                  {s.ileDuplikatow>0?s.ileDuplikatow:"—"}
                </div>
              </div>
              {/* Brakuje */}
              <div style={{textAlign:"center",zIndex:1}}>
                <div style={{fontSize:12,fontWeight:"bold",color:s.brakuje>0?"#f55":"#0c6"}}>
                  {s.brakuje>0?s.brakuje:"✓"}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pokaż więcej */}
      {sorted.length > limit && (
        <button onClick={()=>setLimit(l=>l+20)} style={{
          width:"100%",padding:8,background:"var(--card)",border:"1px solid var(--border)",
          borderRadius:6,color:"var(--muted)",cursor:"pointer",fontSize:11,
        }}>
          Pokaż więcej ({sorted.length - limit} pozostałych)
        </button>
      )}

      {/* Podsumowanie */}
      <div style={{marginTop:10,padding:"8px 12px",background:"rgba(0,0,0,0.2)",borderRadius:8,border:"1px solid var(--border)",fontSize:11,color:"#555",lineHeight:1.8}}>
        🔴 Czerwone (0-20%) — super rzadkie, priorytet w wymianach<br/>
        🟡 Żółte (21-50%) — rzadkie, warto celować<br/>
        🟡 Złote (51-80%) — powszechne<br/>
        🟢 Zielone (81-100%) — prawie wszyscy mają
      </div>
    </div>
  );
}

function TrackerKrecen() {
  const MNOZNIKI = [1,2,3,5,10,15,25,30,50];
  const [sesja, setSesja] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tracker_sesja")) || []; } catch { return []; }
  });
  const [historia, setHistoria] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tracker_historia")) || []; } catch { return []; }
  });
  const [aktMnoznik, setAktMnoznik] = useState(1);
  const [ammo, setAmmo] = useState(() => localStorage.getItem("tracker_ammo") || "5000");
  const [pokazAnalize, setPokazAnalize] = useState(false);

  const zapiszStan = (nowaSesja, nowaHistoria, noweAmmo) => {
    if (nowaSesja !== undefined) localStorage.setItem("tracker_sesja", JSON.stringify(nowaSesja));
    if (nowaHistoria !== undefined) localStorage.setItem("tracker_historia", JSON.stringify(nowaHistoria));
    if (noweAmmo !== undefined) localStorage.setItem("tracker_ammo", noweAmmo);
  };

  const dodajKrecenie = (krytyk = false) => {
    const noweKrecenie = { mnoznik: aktMnoznik, krytyk, nr: sesja.length + 1 };
    const nowaSesja = [...sesja, noweKrecenie];
    setSesja(nowaSesja);
    const noweAmmo = String(Math.max(0, parseInt(ammo) - aktMnoznik));
    setAmmo(noweAmmo);
    zapiszStan(nowaSesja, undefined, noweAmmo);
  };

  const zapiszSesje = () => {
    if (sesja.length === 0) return;
    const nowaHistoria = [...historia, { data: new Date().toISOString(), krecenia: sesja }];
    setHistoria(nowaHistoria);
    setSesja([]);
    zapiszStan([], nowaHistoria);
  };

  const resetujSesje = () => {
    if (!window.confirm("Wyczyścić aktualną sesję?")) return;
    setSesja([]);
    zapiszStan([], undefined);
  };

  const wyczyścHistorie = () => {
    if (!window.confirm("Wyczyścić całą historię? Stracisz wszystkie zebrane dane.")) return;
    setHistoria([]);
    setSesja([]);
    zapiszStan([], []);
  };

  // Analiza danych
  const analizuj = () => {
    const wszystkieKrecenia = [...historia.flatMap(s => s.krecenia), ...sesja];
    if (wszystkieKrecenia.length === 0) return null;

    // Ile kręceń między krytykami
    const odleglosci = [];
    let licznik = 0;
    for (const k of wszystkieKrecenia) {
      licznik++;
      if (k.krytyk) { odleglosci.push(licznik); licznik = 0; }
    }

    // Sekwencje mnożników przed krytykiem
    const sekwencje = {};
    for (let i = 0; i < wszystkieKrecenia.length; i++) {
      if (wszystkieKrecenia[i].krytyk) {
        const okno = wszystkieKrecenia.slice(Math.max(0, i-3), i+1).map(k => `×${k.mnoznik}`).join("→");
        sekwencje[okno] = (sekwencje[okno] || 0) + 1;
      }
    }

    const krytyków = wszystkieKrecenia.filter(k => k.krytyk).length;
    const srOdleglosc = odleglosci.length > 0 ? (odleglosci.reduce((s,v)=>s+v,0)/odleglosci.length).toFixed(1) : "?";
    const srAmmo = odleglosci.length > 0
      ? (wszystkieKrecenia.filter(k=>k.krytyk).map((k,i) => {
          const start = i === 0 ? 0 : wszystkieKrecenia.indexOf(wszystkieKrecenia.filter(x=>x.krytyk)[i-1]) + 1;
          const koniec = wszystkieKrecenia.indexOf(k);
          return wszystkieKrecenia.slice(start, koniec+1).reduce((s,x)=>s+x.mnoznik, 0);
        }).reduce((s,v)=>s+v,0) / krytyków).toFixed(0)
      : "?";

    // Top sekwencje
    const topSek = Object.entries(sekwencje).sort((a,b)=>b[1]-a[1]).slice(0,5);

    return { krytyków, łącznie: wszystkieKrecenia.length, srOdleglosc, srAmmo, topSek, odleglosci };
  };

  const analiza = analizuj();
  const ostatnie10 = sesja.slice(-10);

  return (
    <div>
      <div style={{background:"rgba(255,215,0,0.06)",border:"1px solid #ffd70033",borderRadius:10,padding:12,marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:"bold",color:"var(--accent)",marginBottom:2}}>🎯 Tracker kręceń — szukamy wzorca</div>
        <div style={{fontSize:11,color:"#555",lineHeight:1.6}}>
          Klikaj mnożnik przed każdym kręceniem, potem "Kręcenie" lub "KRYTYK" jeśli wypadły 3× celowniki. Po kilku sesjach analiza pokaże czy jest wzorzec.
        </div>
      </div>

      {/* Ammo */}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,padding:"8px 12px",background:"rgba(255,165,0,0.08)",borderRadius:8,border:"1px solid #fa033"}}>
        <span style={{fontSize:11,color:"#fa0",flexShrink:0}}>🔫 Ammo:</span>
        <input type="number" value={ammo} onChange={e=>{setAmmo(e.target.value);localStorage.setItem("tracker_ammo",e.target.value);}}
          style={{flex:1,padding:"4px 8px",background:"var(--card-solid)",border:"1px solid #fa033",borderRadius:5,color:"#fa0",fontSize:16,fontWeight:"bold"}}/>
        <span style={{fontSize:10,color:"#555"}}>sesja: {sesja.length} kręceń</span>
      </div>

      {/* Wybór mnożnika */}
      <div style={{marginBottom:10}}>
        <div style={{fontSize:11,color:"#aaa",marginBottom:6}}>Wybierz mnożnik:</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
          {MNOZNIKI.map(m=>(
            <button key={m} onClick={()=>setAktMnoznik(m)} style={{
              padding:"8px 12px",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:"bold",
              background:aktMnoznik===m?"linear-gradient(135deg,#b8860b,#ffd700)":"var(--card)",
              border:aktMnoznik===m?"none":"1px solid var(--border)",
              color:aktMnoznik===m?"#000":"var(--muted)",
            }}>×{m}</button>
          ))}
        </div>
      </div>

      {/* Przyciski akcji */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
        <button onClick={()=>dodajKrecenie(false)} style={{
          padding:16,background:"rgba(255,255,255,0.06)",border:"1px solid #333",
          borderRadius:10,color:"var(--muted)",fontSize:14,cursor:"pointer",fontWeight:"bold",
        }}>
          🎰 Kręcenie ×{aktMnoznik}
          <div style={{fontSize:10,color:"#555",marginTop:2}}>−{aktMnoznik} ammo</div>
        </button>
        <button onClick={()=>dodajKrecenie(true)} style={{
          padding:16,background:"rgba(255,50,50,0.15)",border:"2px solid #f55",
          borderRadius:10,color:"#f55",fontSize:14,cursor:"pointer",fontWeight:"bold",
        }}>
          🎯 KRYTYK! ×{aktMnoznik}
          <div style={{fontSize:10,color:"#f5544488",marginTop:2}}>3× celownik!</div>
        </button>
      </div>

      {/* Ostatnie 10 kręceń */}
      {ostatnie10.length > 0 && (
        <div style={{marginBottom:12,padding:"8px 10px",background:"rgba(0,0,0,0.2)",borderRadius:8,border:"1px solid var(--border)"}}>
          <div style={{fontSize:10,color:"#555",marginBottom:5}}>Ostatnie {ostatnie10.length} kręceń:</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
            {ostatnie10.map((k,i)=>(
              <div key={i} style={{
                fontSize:11,padding:"2px 7px",borderRadius:12,fontWeight:"bold",
                background:k.krytyk?"rgba(255,50,50,0.2)":"var(--card)",
                border:k.krytyk?"1px solid #f55":"1px solid #333",
                color:k.krytyk?"#f55":"var(--muted)",
              }}>
                {k.krytyk?"🎯":"🎰"} ×{k.mnoznik}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Przyciski sesji */}
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        <button onClick={zapiszSesje} disabled={sesja.length===0} style={{
          flex:1,padding:10,
          background:sesja.length>0?"linear-gradient(135deg,#0c6,#0fa)":"var(--card)",
          border:"none",borderRadius:8,color:sesja.length>0?"#000":"#444",
          fontWeight:"bold",fontSize:12,cursor:sesja.length>0?"pointer":"not-allowed",
        }}>💾 Zapisz sesję ({sesja.length} kręceń)</button>
        <button onClick={resetujSesje} disabled={sesja.length===0} style={{
          padding:"10px 12px",background:"rgba(255,50,50,0.1)",border:"1px solid #f5544433",
          borderRadius:8,color:"#f55",cursor:"pointer",fontSize:11,
        }}>🗑 Reset</button>
      </div>

      {/* Analiza */}
      {historia.length > 0 && analiza && (
        <div style={{background:"rgba(100,150,255,0.06)",border:"1px solid #6496ff33",borderRadius:10,padding:12,marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:pokazAnalize?10:0}}>
            <div style={{fontSize:12,fontWeight:"bold",color:"#6496ff"}}>
              📊 Analiza ({historia.length} sesji, {analiza.łącznie} kręceń, {analiza.krytyków} krytyków)
            </div>
            <button onClick={()=>setPokazAnalize(p=>!p)} style={{
              fontSize:10,padding:"2px 8px",background:"rgba(100,150,255,0.1)",border:"1px solid #6496ff33",
              borderRadius:4,color:"#6496ff",cursor:"pointer",
            }}>{pokazAnalize?"▲":"▼"}</button>
          </div>
          {pokazAnalize&&(
            <div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
                {[
                  {label:"Krytyk co śr.",val:`${analiza.srOdleglosc} kręceń`,c:"#f55"},
                  {label:"Ammo na krytyk",val:`~${analiza.srAmmo}`,c:"#fa0"},
                  {label:"Skuteczność",val:`${((analiza.krytyków/analiza.łącznie)*100).toFixed(1)}%`,c:"#0c6"},
                ].map(s=>(
                  <div key={s.label} style={{background:"rgba(0,0,0,0.3)",borderRadius:6,padding:"8px",textAlign:"center"}}>
                    <div style={{fontSize:15,fontWeight:"bold",color:s.c}}>{s.val}</div>
                    <div style={{fontSize:9,color:"#555"}}>{s.label}</div>
                  </div>
                ))}
              </div>

              {analiza.topSek.length > 0 && (
                <div>
                  <div style={{fontSize:11,color:"#aaa",marginBottom:6}}>🔍 Najczęstsze sekwencje przed krytykiem:</div>
                  {analiza.topSek.map(([sek, ile])=>(
                    <div key={sek} style={{display:"flex",justifyContent:"space-between",padding:"4px 8px",marginBottom:3,background:"rgba(255,50,50,0.08)",borderRadius:5,border:"1px solid #f5544422"}}>
                      <span style={{fontSize:11,color:"var(--text)",fontFamily:"monospace"}}>{sek}</span>
                      <span style={{fontSize:11,color:"#f55",fontWeight:"bold"}}>{ile}×</span>
                    </div>
                  ))}
                  <div style={{fontSize:10,color:"#555",marginTop:6}}>
                    Im więcej danych tym bardziej miarodajna analiza. Cel: min 200 kręceń.
                  </div>
                </div>
              )}

              {analiza.odleglosci.length >= 5 && (
                <div style={{marginTop:8,padding:"6px 8px",background:"rgba(0,0,0,0.2)",borderRadius:5,fontSize:10,color:"var(--muted)"}}>
                  Odległości między krytykami: {analiza.odleglosci.slice(-10).join(", ")} (ostatnie 10)
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {historia.length > 0 && (
        <button onClick={wyczyścHistorie} style={{
          width:"100%",padding:8,background:"rgba(255,50,50,0.08)",border:"1px solid #f5544422",
          borderRadius:6,color:"#f5544466",fontSize:11,cursor:"pointer",
        }}>🗑 Wyczyść całą historię ({historia.length} sesji)</button>
      )}

      {historia.length === 0 && sesja.length === 0 && (
        <div style={{textAlign:"center",padding:20,color:"#555",fontSize:11}}>
          Zacznij kręcić i zbieraj dane. Po kilku sesjach analiza pokaże czy jest wzorzec w sekwencjach mnożników.
        </div>
      )}
    </div>
  );
}

function KalkulatorEventu() {
  // Progi łączone — kręcisz cały czas w górę, po drodze zbierasz nagrody
  const TYPY_NAGRODY = [
    {id:"paczki", label:"📦 Paczki", kolor:"#87CEEB", waga:10},
    {id:"klucze",  label:"🗝️ Klucze",  kolor:"var(--accent)", waga:6},
    {id:"ammo",   label:"🔫 Ammo",    kolor:"#fa0",    waga:3},
    {id:"hajs",   label:"💵 Hajs",    kolor:"var(--muted)",    waga:1},
    {id:"inne",   label:"🎁 Inne",    kolor:"#555",    waga:0},
  ];

  const [mnoznik, setMnoznik] = useState("10");
  const [szansa1, setSzansa1] = useState(()=>localStorage.getItem("slot_s1")||"40");
  const [szansa2, setSzansa2] = useState(()=>localStorage.getItem("slot_s2")||"15");
  const [szansa3, setSzansa3] = useState(()=>localStorage.getItem("slot_s3")||"5");
  const [ammoMam, setAmmoMam] = useState(()=>localStorage.getItem("slot_ammo")||"5000");
  const [paczkiMam, setPaczkiMam] = useState(()=>localStorage.getItem("slot_paczki")||"0");
  const [licz0, setLicz0] = useState(0);
  const [licz1, setLicz1] = useState(0);
  const [licz2, setLicz2] = useState(0);
  const [licz3, setLicz3] = useState(0);
  const [pokazLicznik, setPokazLicznik] = useState(false);
  // Szablony eventów
  const SZABLONY_EVENTOW = {
    "Prison Break": [
      {id:101, punkty:50,    nagroda:10,  typ:"ammo",   opis:""},
      {id:102, punkty:100,   nagroda:15,  typ:"ammo",   opis:""},
      {id:103, punkty:250,   nagroda:1,   typ:"klucze", opis:"+ 25 ammo"},
      {id:104, punkty:450,   nagroda:10,  typ:"ammo",   opis:"+ 3M exp"},
      {id:105, punkty:650,   nagroda:1,   typ:"paczki", opis:"1 karta"},
      {id:106, punkty:850,   nagroda:25,  typ:"ammo",   opis:""},
      {id:107, punkty:1050,  nagroda:1,   typ:"paczki", opis:"1 karta"},
      {id:108, punkty:2000,  nagroda:1,   typ:"paczki", opis:"2 karty + 50 ammo"},
      {id:109, punkty:2400,  nagroda:1,   typ:"klucze", opis:""},
      {id:110, punkty:2800,  nagroda:25,  typ:"ammo",   opis:"+ 8M exp"},
      {id:111, punkty:3200,  nagroda:1,   typ:"paczki", opis:"1 karta + 3M exp"},
      {id:112, punkty:3600,  nagroda:50,  typ:"ammo",   opis:""},
      {id:113, punkty:6000,  nagroda:1,   typ:"paczki", opis:"6 kart + klucz"},
      {id:114, punkty:6500,  nagroda:1,   typ:"paczki", opis:"2 karty + 8M exp"},
      {id:115, punkty:7300,  nagroda:1,   typ:"klucze", opis:"+ 50 ammo"},
      {id:116, punkty:7950,  nagroda:1,   typ:"paczki", opis:"6 kart"},
      {id:117, punkty:8600,  nagroda:50,  typ:"ammo",   opis:"+ 16M exp"},
      {id:118, punkty:13000, nagroda:1,   typ:"paczki", opis:"🌟 NOWA ZŁOTA + 100 ammo"},
      {id:119, punkty:14000, nagroda:1,   typ:"paczki", opis:"💎 DIAMENTOWA + 75 ammo"},
      {id:120, punkty:15000, nagroda:1,   typ:"paczki", opis:"6 kart"},
      {id:121, punkty:16000, nagroda:2,   typ:"klucze", opis:""},
      {id:122, punkty:17000, nagroda:1,   typ:"paczki", opis:"6 kart + 150 ammo"},
      {id:123, punkty:27500, nagroda:1,   typ:"paczki", opis:"💎💎 NOWA DIAMENTOWA + 555 ammo"},
    ],
    "Perfect Masterplan": [
      {id:201, punkty:50,    nagroda:1,  typ:"klucze", opis:""},
      {id:202, punkty:100,   nagroda:1,  typ:"klucze", opis:""},
      {id:203, punkty:250,   nagroda:1,  typ:"klucze", opis:""},
      {id:204, punkty:450,   nagroda:1,  typ:"klucze", opis:""},
      {id:205, punkty:650,   nagroda:1,  typ:"klucze", opis:""},
      {id:206, punkty:850,   nagroda:1,  typ:"klucze", opis:""},
      {id:207, punkty:1050,  nagroda:1,  typ:"klucze", opis:""},
      {id:208, punkty:2000,  nagroda:2,  typ:"klucze", opis:""},
      {id:209, punkty:2400,  nagroda:1,  typ:"klucze", opis:""},
      {id:210, punkty:2800,  nagroda:1,  typ:"klucze", opis:""},
      {id:211, punkty:3200,  nagroda:1,  typ:"klucze", opis:""},
      {id:212, punkty:3600,  nagroda:1,  typ:"klucze", opis:""},
      {id:213, punkty:6000,  nagroda:3,  typ:"klucze", opis:""},
      {id:214, punkty:6500,  nagroda:1,  typ:"klucze", opis:""},
      {id:215, punkty:7300,  nagroda:1,  typ:"klucze", opis:""},
      {id:216, punkty:7950,  nagroda:1,  typ:"klucze", opis:""},
      {id:217, punkty:8600,  nagroda:1,  typ:"klucze", opis:""},
      {id:218, punkty:13000, nagroda:4,  typ:"klucze", opis:""},
      {id:219, punkty:14000, nagroda:1,  typ:"klucze", opis:""},
      {id:220, punkty:15000, nagroda:1,  typ:"klucze", opis:""},
      {id:221, punkty:16000, nagroda:1,  typ:"klucze", opis:""},
      {id:222, punkty:17000, nagroda:1,  typ:"klucze", opis:""},
      {id:223, punkty:27500, nagroda:5,  typ:"klucze", opis:""},
    ],
  };

  const [aktywnyEvent, setAktywnyEvent] = useState(null);
  const [progi, setProgi] = useState([
    {id:1, punkty:500,   nagroda:1,  typ:"paczki", opis:""},
    {id:2, punkty:1000,  nagroda:2,  typ:"paczki", opis:""},
    {id:3, punkty:2000,  nagroda:1,  typ:"klucze", opis:""},
    {id:4, punkty:3500,  nagroda:4,  typ:"paczki", opis:""},
    {id:5, punkty:5000,  nagroda:80, typ:"ammo",   opis:""},
    {id:6, punkty:7500,  nagroda:6,  typ:"paczki", opis:""},
    {id:7, punkty:10000, nagroda:20, typ:"paczki", opis:"WIELKA NAGRODA"},
  ]);
  const [nowyProg, setNowyProg] = useState({punkty:"", nagroda:"", typ:"paczki", opis:""});
  const [pokazDodaj, setPokazDodaj] = useState(false);
  const [edytujSzablony] = useState(false); // eslint-disable-line no-unused-vars

  const m = parseFloat(mnoznik) || 1;
  const paczkiJuzMam = parseInt(paczkiMam) || 0;
  const p1 = parseFloat(szansa1)/100 || 0;
  const p2 = parseFloat(szansa2)/100 || 0;
  const p3 = parseFloat(szansa3)/100 || 0;
  const ammo = parseFloat(ammoMam) || 0;
  const lacznieObs = licz0+licz1+licz2+licz3;

  // Oczekiwane pkt/ammo (niezależne od mnożnika)
  const ePktNaAmmo = p1*1 + p2*2 + p3*10;

  const aktualizujSzanse = () => {
    if (!lacznieObs) return;
    const s1 = ((licz1/lacznieObs)*100).toFixed(1);
    const s2 = ((licz2/lacznieObs)*100).toFixed(1);
    const s3 = ((licz3/lacznieObs)*100).toFixed(1);
    setSzansa1(s1); setSzansa2(s2); setSzansa3(s3);
    localStorage.setItem("slot_s1",s1);
    localStorage.setItem("slot_s2",s2);
    localStorage.setItem("slot_s3",s3);
  };

  const progsSorted = [...progi].sort((a,b) => a.punkty - b.punkty);

  // Dla każdego progu — ile ammo łącznie trzeba wydać żeby go osiągnąć
  const analiza = progsSorted.map((p, i) => {
    const ammoDoProg = ePktNaAmmo > 0 ? Math.ceil(p.punkty / ePktNaAmmo) : 999999;
    const mozna = ammo >= ammoDoProg;
    // Zlicz paczki i klucze od progu 1 do tego progu
    const paczkiDoProg = progsSorted.slice(0, i+1)
      .filter(pp => pp.typ === "paczki")
      .reduce((s, pp) => s + (parseFloat(pp.nagroda)||0), 0);
    // Łącznie paczek z już zebranych + z eventów
    const paczkiLacznie = paczkiJuzMam + paczkiDoProg;
    const kluczeDoProg = progsSorted.slice(0, i+1)
      .filter(pp => pp.typ === "klucze")
      .reduce((s, pp) => s + (parseFloat(pp.nagroda)||0), 0);
    const ammoDodatkowe = progsSorted.slice(0, i+1)
      .filter(pp => pp.typ === "ammo")
      .reduce((s, pp) => s + (parseFloat(pp.nagroda)||0), 0);
    // Efektywny koszt = ammo wydane minus ammo odzyskane
    const efektywnyKoszt = Math.max(0, ammoDoProg - ammoDodatkowe);
    // Paczki na 1000 ammo efektywnego
    const paczkiNa1000 = efektywnyKoszt > 0 ? (paczkiDoProg / efektywnyKoszt * 1000).toFixed(1) : "∞";
    return {...p, ammoDoProg, mozna, paczkiDoProg, kluczeDoProg, ammoDodatkowe, efektywnyKoszt, paczkiNa1000, paczkiLacznie};
  });

  // Znajdź najdalszy osiągalny próg (maksymalne paczki za posiadane ammo)
  const osiagalne = analiza.filter(a => a.mozna);
  // Priorytet: próg z diamentową jeśli osiągalny, inaczej najdalszy możliwy
  const zDiamentowa = osiagalne.filter(a => a.opis && (a.opis.includes("DIAMENTOWA") || a.opis.includes("💎")));
  const optymalny = zDiamentowa.length > 0
    ? zDiamentowa[zDiamentowa.length - 1] // ostatnia diamentowa którą możemy osiągnąć
    : osiagalne.length > 0
      ? osiagalne[osiagalne.length - 1] // najdalszy osiągalny próg
      : analiza[0];

  const dodajProg = () => {
    if (!nowyProg.punkty || !nowyProg.nagroda) return;
    setProgi(prev => [...prev, {id:Date.now(), punkty:parseInt(nowyProg.punkty), nagroda:parseFloat(nowyProg.nagroda), typ:nowyProg.typ, opis:nowyProg.opis}]
      .sort((a,b)=>a.punkty-b.punkty));
    setNowyProg({punkty:"", nagroda:"", typ:"paczki", opis:""});
    setPokazDodaj(false);
  };

  const MNOZNIKI = [1,2,3,5,10,15,25,30,50];

  return (
    <div>
      <div style={{background:"rgba(100,150,255,0.06)",border:"1px solid #6496ff33",borderRadius:10,padding:12,marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:"bold",color:"#6496ff",marginBottom:2}}>🎰 Kalkulator eventu</div>
        <div style={{fontSize:11,color:"#555",lineHeight:1.6}}>
          Cel: jak najwięcej paczek za jak najmniej ammo. Wpisz progi eventu, ustaw swoje ammo i szanse — apka wskaże optymalny próg.
        </div>
      </div>

      {/* AMMO + PACZKI */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
        <div style={{background:"rgba(255,165,0,0.06)",border:"1px solid #fa033",borderRadius:8,padding:10}}>
          <div style={{fontSize:11,color:"#fa0",marginBottom:4,fontWeight:"bold"}}>🔫 Posiadane ammo</div>
          <input type="number" value={ammoMam} onChange={e=>{setAmmoMam(e.target.value);localStorage.setItem("slot_ammo",e.target.value);}}
            style={{width:"100%",padding:"10px 8px",background:"var(--card-solid)",border:"1px solid #fa033",
              borderRadius:6,color:"#fa0",fontSize:18,fontWeight:"bold",boxSizing:"border-box"}}/>
        </div>
        <div style={{background:"rgba(135,206,235,0.06)",border:"1px solid #87CEEB33",borderRadius:8,padding:10}}>
          <div style={{fontSize:11,color:"#87CEEB",marginBottom:4,fontWeight:"bold"}}>📦 Paczki już zebrane</div>
          <input type="number" value={paczkiMam} onChange={e=>{setPaczkiMam(e.target.value);localStorage.setItem("slot_paczki",e.target.value);}}
            min="0" style={{width:"100%",padding:"10px 8px",background:"var(--card-solid)",border:"1px solid #87CEEB33",
              borderRadius:6,color:"#87CEEB",fontSize:18,fontWeight:"bold",boxSizing:"border-box"}}/>
        </div>
      </div>

      {/* MNOŻNIK */}
      <div style={{background:"rgba(0,0,0,0.2)",border:"1px solid var(--border)",borderRadius:8,padding:10,marginBottom:10}}>
        <div style={{fontSize:11,color:"#aaa",marginBottom:6,fontWeight:"bold"}}>⚡ Mnożnik kręcenia</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
          {MNOZNIKI.map(n=>(
            <button key={n} onClick={()=>setMnoznik(String(n))} style={{
              padding:"5px 11px",borderRadius:5,cursor:"pointer",fontSize:12,fontWeight:"bold",
              background:parseFloat(mnoznik)===n?"linear-gradient(135deg,#b8860b,#ffd700)":"var(--card)",
              border:parseFloat(mnoznik)===n?"none":"1px solid var(--border)",
              color:parseFloat(mnoznik)===n?"#000":"var(--muted)",
            }}>×{n}</button>
          ))}
        </div>
        <div style={{fontSize:10,color:"#555",marginTop:6}}>
          💡 Mnożnik nie zmienia opłacalności — tylko przyspiesza. Używaj najwyższego na który Cię stać.
        </div>
      </div>

      {/* LICZNIK OBSERWACJI */}
      <div style={{background:"rgba(0,0,0,0.2)",border:"1px solid var(--border)",borderRadius:8,padding:10,marginBottom:10}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:pokazLicznik?8:0}}>
          <div style={{fontSize:11,fontWeight:"bold",color:"#aaa"}}>
            📋 Licznik kręceń
            {lacznieObs>0&&<span style={{fontSize:10,color:"#0c6",marginLeft:6,fontWeight:"normal"}}>{lacznieObs} obs.</span>}
          </div>
          <button onClick={()=>setPokazLicznik(p=>!p)} style={{
            fontSize:10,padding:"2px 8px",borderRadius:4,cursor:"pointer",
            background:pokazLicznik?"rgba(255,215,0,0.1)":"var(--card)",
            border:pokazLicznik?"1px solid #ffd70055":"1px solid #333",
            color:pokazLicznik?"var(--accent)":"#555",
          }}>{pokazLicznik?"▼ Schowaj":"▶ Licz kręcenia"}</button>
        </div>
        {pokazLicznik&&(
          <div>
            <div style={{fontSize:10,color:"#555",marginBottom:8}}>Kręć na ×1 i klikaj wynik po każdym kręceniu. Potem "Zastosuj".</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:8}}>
              {[
                {label:"💨 Nic",count:licz0,set:setLicz0,c:"#555"},
                {label:"🍋 Jeden",count:licz1,set:setLicz1,c:"#fa0"},
                {label:"🍋🍋 Dwa",count:licz2,set:setLicz2,c:"var(--accent)"},
                {label:"🍋🍋🍋 JACKPOT",count:licz3,set:setLicz3,c:"#0c6"},
              ].map(b=>(
                <div key={b.label} style={{textAlign:"center"}}>
                  <button onClick={()=>b.set(p=>p+1)} style={{
                    width:"100%",padding:"10px 2px",borderRadius:6,cursor:"pointer",
                    background:`${b.c}18`,border:`2px solid ${b.c}44`,color:b.c,
                  }}>
                    <div style={{fontSize:8,marginBottom:2}}>{b.label}</div>
                    <div style={{fontSize:24,fontWeight:"bold"}}>{b.count}</div>
                  </button>
                  <button onClick={()=>b.set(p=>Math.max(0,p-1))}
                    style={{marginTop:2,fontSize:9,padding:"0 6px",background:"none",
                      border:"none",color:"#f5544466",cursor:"pointer"}}>−1</button>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{flex:1,fontSize:10,color:"#555"}}>{lacznieObs} kręceń · {ePktNaAmmo>0?ePktNaAmmo.toFixed(2):"?"} pkt/ammo</span>
              <button onClick={()=>{setLicz0(0);setLicz1(0);setLicz2(0);setLicz3(0);}}
                style={{fontSize:10,padding:"4px 8px",background:"rgba(255,50,50,0.1)",
                  border:"1px solid #f5544433",borderRadius:4,color:"#f55",cursor:"pointer"}}>Reset</button>
              <button onClick={aktualizujSzanse} disabled={!lacznieObs} style={{
                fontSize:10,padding:"4px 12px",
                background:lacznieObs?"linear-gradient(135deg,#0c6,#0fa)":"var(--card)",
                border:"none",borderRadius:4,color:lacznieObs?"#000":"#444",
                cursor:lacznieObs?"pointer":"default",fontWeight:"bold"}}>✓ Zastosuj</button>
            </div>
          </div>
        )}
      </div>

      {/* SZANSE */}
      <div style={{background:"rgba(0,0,0,0.2)",border:"1px solid var(--border)",borderRadius:8,padding:10,marginBottom:10}}>
        <div style={{fontSize:11,fontWeight:"bold",color:"#aaa",marginBottom:8}}>🎲 Szanse losowania (%)</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
          {[
            {label:`🍋 1 symbol = ×${m} pkt`,val:szansa1,set:(v)=>{setSzansa1(v);localStorage.setItem("slot_s1",v);},c:"#fa0"},
            {label:`🍋🍋 2 symbole = ×${m*2} pkt`,val:szansa2,set:(v)=>{setSzansa2(v);localStorage.setItem("slot_s2",v);},c:"var(--accent)"},
            {label:`🍋🍋🍋 JACKPOT = ×${m*10} pkt`,val:szansa3,set:(v)=>{setSzansa3(v);localStorage.setItem("slot_s3",v);},c:"#0c6"},
          ].map(f=>(
            <div key={f.label}>
              <div style={{fontSize:9,color:f.c,marginBottom:3}}>{f.label}</div>
              <div style={{display:"flex",alignItems:"center",gap:3}}>
                <input type="number" value={f.val} onChange={e=>f.set(e.target.value)} min="0" max="100"
                  style={{width:"100%",padding:"5px 6px",background:"var(--card-solid)",border:`1px solid ${f.c}44`,
                    borderRadius:4,color:f.c,fontSize:14,fontWeight:"bold",textAlign:"center"}}/>
                <span style={{fontSize:10,color:"#555"}}>%</span>
              </div>
            </div>
          ))}
        </div>
        {ePktNaAmmo > 0 && (
          <div style={{marginTop:8,fontSize:11,color:"var(--muted)",textAlign:"center"}}>
            Oczekiwane: <strong style={{color:"var(--accent)"}}>{ePktNaAmmo.toFixed(3)}</strong> pkt/ammo ·
            za {ammo.toLocaleString()} ammo ≈ <strong style={{color:"#0c6"}}>{Math.round(ammo*ePktNaAmmo).toLocaleString()}</strong> pkt łącznie
          </div>
        )}
      </div>

      {/* GŁÓWNY EVENT 7-DNIOWY */}
      <div style={{background:"rgba(255,50,150,0.06)",border:"1px solid #ff328055",borderRadius:8,padding:10,marginBottom:10}}>
        <div style={{fontSize:11,fontWeight:"bold",color:"#ff6ab0",marginBottom:4}}>🏆 Główny event 7-dniowy — progi paczek</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {[
            {prog:60, nagroda:"1 💎 nowa diamentowa", kolor:"#87CEEB"},
            {prog:90, nagroda:"2 💎 nowe diamentowe", kolor:"#64c8ff"},
            {prog:120, nagroda:"3 💎 nowe diamentowe", kolor:"var(--accent)"},
          ].map(p => {
            const brakuje = Math.max(0, p.prog - paczkiJuzMam);
            const osiagniety = paczkiJuzMam >= p.prog;
            return (
              <div key={p.prog} style={{flex:1,minWidth:80,padding:"8px 6px",borderRadius:6,textAlign:"center",
                background:osiagniety?"rgba(0,200,100,0.1)":"rgba(0,0,0,0.3)",
                border:`1px solid ${osiagniety?"#0c6":p.kolor}33`}}>
                <div style={{fontSize:12,fontWeight:"bold",color:osiagniety?"#0c6":p.kolor}}>{p.prog} 📦</div>
                <div style={{fontSize:10,color:"#aaa",margin:"2px 0"}}>{p.nagroda}</div>
                {osiagniety
                  ? <div style={{fontSize:9,color:"#0c6"}}>✓ osiągnięty!</div>
                  : <div style={{fontSize:10,color:"#fa0",fontWeight:"bold"}}>brakuje: {brakuje} 📦</div>
                }
              </div>
            );
          })}
        </div>
        <div style={{fontSize:10,color:"#555",marginTop:6}}>
          Każda paczka z eventów pobocznych liczy się do tego licznika. Cel: 120 paczek = 3 nowe diamentowe 💎
        </div>
      </div>

      {/* WYBÓR SZABLONU EVENTU */}
      <div style={{background:"rgba(0,0,0,0.2)",border:"1px solid var(--border)",borderRadius:8,padding:10,marginBottom:10}}>
        <div style={{fontSize:11,fontWeight:"bold",color:"#aaa",marginBottom:8}}>📋 Wybierz event poboczny</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {Object.keys(SZABLONY_EVENTOW).map(nazwa => (
            <button key={nazwa} onClick={() => {
              setProgi(SZABLONY_EVENTOW[nazwa]);
              setAktywnyEvent(nazwa);
            }} style={{
              padding:"6px 12px",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:"bold",
              background:aktywnyEvent===nazwa?"linear-gradient(135deg,#b8860b,#ffd700)":"var(--card)",
              border:aktywnyEvent===nazwa?"none":"1px solid var(--border)",
              color:aktywnyEvent===nazwa?"#000":"var(--muted)",
            }}>{nazwa}</button>
          ))}
          <button onClick={() => { setAktywnyEvent(null); }} style={{
            padding:"6px 12px",borderRadius:6,cursor:"pointer",fontSize:11,
            background:"rgba(255,50,50,0.08)",border:"1px solid #f5544433",color:"#f5544488",
          }}>✕ Własny</button>
        </div>
        {aktywnyEvent && (
          <div style={{fontSize:10,color:"#555",marginTop:6}}>
            Wczytano: <strong style={{color:"var(--accent)"}}>{aktywnyEvent}</strong> · {progi.length} progów ·
            Paczki łącznie: <strong style={{color:"#87CEEB"}}>
              {progi.filter(p=>p.typ==="paczki").reduce((s,p)=>s+(parseFloat(p.nagroda)||0),0)} 📦
            </strong>
            {progi.some(p=>p.opis.includes("DIAMENTOWA")) && (
              <span style={{color:"#64c8ff",marginLeft:6}}>· 💎 Zawiera diamentowe!</span>
            )}
          </div>
        )}
      </div>

      {/* PROGI EVENTU */}
      <div style={{background:"rgba(0,0,0,0.2)",border:"1px solid var(--border)",borderRadius:8,padding:10,marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:"bold",color:"#aaa"}}>
            📊 Progi eventu
            <span style={{fontSize:9,color:"#555",marginLeft:6,fontWeight:"normal"}}>— wpisz z aktualnego eventu</span>
          </div>
          <button onClick={()=>setPokazDodaj(p=>!p)} style={{
            fontSize:10,padding:"3px 8px",background:"rgba(255,215,0,0.1)",
            border:"1px solid #b8860b55",borderRadius:4,color:"var(--accent)",cursor:"pointer"}}>+ Dodaj próg</button>
        </div>

        {pokazDodaj&&(
          <div style={{display:"flex",gap:5,marginBottom:8,flexWrap:"wrap",padding:8,
            background:"rgba(255,215,0,0.03)",border:"1px solid #ffd70022",borderRadius:6}}>
            <input type="number" value={nowyProg.punkty} onChange={e=>setNowyProg(p=>({...p,punkty:e.target.value}))}
              placeholder="Pkt progu" style={{width:80,padding:"5px 6px",background:"var(--card-solid)",border:"1px solid #333",borderRadius:4,color:"#fff",fontSize:12}}/>
            <input type="number" value={nowyProg.nagroda} onChange={e=>setNowyProg(p=>({...p,nagroda:e.target.value}))}
              placeholder="Ile" style={{width:55,padding:"5px 6px",background:"var(--card-solid)",border:"1px solid #333",borderRadius:4,color:"#fff",fontSize:12}}/>
            <select value={nowyProg.typ} onChange={e=>setNowyProg(p=>({...p,typ:e.target.value}))}
              style={{padding:"5px 6px",background:"var(--card-solid)",border:"1px solid #333",borderRadius:4,color:"#87CEEB",fontSize:12}}>
              {TYPY_NAGRODY.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <input value={nowyProg.opis} onChange={e=>setNowyProg(p=>({...p,opis:e.target.value}))}
              placeholder="Opis (opcja)" style={{flex:1,minWidth:60,padding:"5px 6px",background:"var(--card-solid)",border:"1px solid #333",borderRadius:4,color:"#aaa",fontSize:11}}/>
            <button onClick={dodajProg} style={{padding:"5px 10px",background:"rgba(0,200,100,0.15)",
              border:"1px solid #0c633",borderRadius:4,color:"#0c6",cursor:"pointer",fontWeight:"bold"}}>✓</button>
          </div>
        )}

        {/* Nagłówek */}
        <div style={{display:"grid",gridTemplateColumns:"50px 70px 75px 60px 60px 20px",gap:4,padding:"2px 6px",marginBottom:3}}>
          {["Pkt","Nagroda","Ammo koszt","📦 sum","pkt/ammo",""].map(h=>(
            <div key={h} style={{fontSize:8,color:"#333",textAlign:"center"}}>{h}</div>
          ))}
        </div>

        {analiza.map((a,i)=>{
          const isOpt = optymalny && a.id===optymalny.id;
          const typInfo = TYPY_NAGRODY.find(t=>t.id===a.typ)||TYPY_NAGRODY[0];
          return (
            <div key={a.id} style={{
              display:"grid",gridTemplateColumns:"50px 70px 75px 60px 60px 20px",
              gap:4,padding:"7px 6px",marginBottom:3,borderRadius:6,alignItems:"center",
              background:isOpt?"rgba(255,215,0,0.08)":a.mozna?"rgba(0,200,100,0.02)":"rgba(255,255,255,0.02)",
              border:isOpt?"1px solid #ffd70055":a.mozna?"1px solid #0c6118":"1px solid transparent",
            }}>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:11,fontWeight:"bold",color:a.mozna?"var(--text)":"#444"}}>{a.punkty.toLocaleString()}</div>
                {a.opis&&<div style={{fontSize:8,color:
                  a.opis.includes("DIAMENTOWA")||a.opis.includes("💎")?"#64c8ff":
                  a.opis.includes("ZŁOTA")||a.opis.includes("🌟")?"var(--accent)":"var(--muted)"
                }}>{a.opis}</div>}
              </div>
              <div style={{textAlign:"center"}}>
                <span style={{fontSize:11,fontWeight:"bold",color:
                  a.opis.includes("DIAMENTOWA")||a.opis.includes("💎")?"#64c8ff":
                  a.opis.includes("ZŁOTA")||a.opis.includes("🌟")?"var(--accent)":typInfo.kolor
                }}>{a.nagroda} {typInfo.label.split(" ")[0]}</span>
              </div>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:11,color:a.mozna?"#fa0":"#555",fontWeight:"bold"}}>{a.ammoDoProg.toLocaleString()}</div>
                {a.ammoDodatkowe>0&&<div style={{fontSize:8,color:"#0c6"}}>−{a.ammoDodatkowe} odzysk</div>}
              </div>
              <div style={{textAlign:"center"}}>
                <span style={{fontSize:12,fontWeight:"bold",color:"#87CEEB"}}>{a.paczkiDoProg}</span>
                {paczkiJuzMam>0&&<span style={{fontSize:9,color:"#0c6",marginLeft:2}}>={a.paczkiLacznie}📦</span>}
                {a.kluczeDoProg>0&&<span style={{fontSize:9,color:"var(--accent)",marginLeft:3}}>+{a.kluczeDoProg}🗝️</span>}
              </div>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:11,fontWeight:"bold",
                  color:parseFloat(a.paczkiNa1000)>=1?"#0c6":parseFloat(a.paczkiNa1000)>=0.5?"#fa0":"#f55"}}>
                  {a.paczkiNa1000}
                </div>
                {isOpt&&<div style={{fontSize:7,color:"var(--accent)"}}>★ NAJLEPSZY</div>}
              </div>
              <button onClick={()=>setProgi(p=>p.filter(x=>x.id!==a.id))}
                style={{background:"none",border:"none",color:"#f5544433",cursor:"pointer",fontSize:10}}>✕</button>
            </div>
          );
        })}
      </div>

      {/* REKOMENDACJA */}
      {optymalny&&ePktNaAmmo>0&&(
        <div style={{background:"rgba(255,215,0,0.08)",border:"2px solid #ffd70044",borderRadius:12,padding:14}}>
          <div style={{fontSize:13,fontWeight:"bold",color:"var(--accent)",marginBottom:10}}>🎯 Rekomendacja</div>
          <div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:12,marginBottom:8,fontSize:12,color:"var(--text)",lineHeight:1.8}}>
            <div>Graj do progu: <strong style={{color:"var(--accent)"}}>{optymalny.punkty.toLocaleString()} pkt</strong>
              {optymalny.opis&&<span style={{color:"#fa0",marginLeft:6}}>({optymalny.opis})</span>}
            </div>
            <div>Wydasz: <strong style={{color:optymalny.mozna?"#fa0":"#f55"}}>{optymalny.ammoDoProg.toLocaleString()} ammo</strong>
              {!optymalny.mozna&&<span style={{color:"#f55"}}> ❌ brakuje {(optymalny.ammoDoProg-ammo).toLocaleString()}</span>}
              {optymalny.ammoDodatkowe>0&&<span style={{color:"#0c6",marginLeft:4}}>(odzyskasz {optymalny.ammoDodatkowe} z nagród)</span>}
            </div>
            <div>Zbierzesz z eventu: <strong style={{color:"#87CEEB"}}>{optymalny.paczkiDoProg} 📦 paczek</strong>
              {paczkiJuzMam>0&&<span style={{color:"#0c6"}}> → łącznie {optymalny.paczkiLacznie} 📦</span>}
              {optymalny.kluczeDoProg>0&&<span style={{color:"var(--accent)"}}> + {optymalny.kluczeDoProg} 🗝️ kluczy</span>}
            </div>
            <div>Efektywność: <strong style={{color:"#0c6"}}>{optymalny.paczkiNa1000} paczek / 1000 ammo</strong></div>
            <div style={{marginTop:4,fontSize:11,color:"#555"}}>
              Mnożnik ×{m} → {Math.ceil(optymalny.ammoDoProg/m).toLocaleString()} kręceń ·
              jackpoty: ~{(Math.ceil(optymalny.ammoDoProg/m)*p3).toFixed(0)} szt.
            </div>
          </div>

          {/* Wszystkie nagrody po drodze */}
          <div style={{fontSize:11,color:"var(--muted)",marginBottom:6}}>Nagrody po drodze:</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
            {progsSorted.slice(0, progsSorted.indexOf(optymalny)+1).map(p=>{
              const t = TYPY_NAGRODY.find(x=>x.id===p.typ)||TYPY_NAGRODY[0];
              return (
                <div key={p.id} style={{
                  fontSize:10,padding:"3px 8px",borderRadius:6,
                  background:`${t.kolor}18`,border:`1px solid ${t.kolor}33`,color:t.kolor,
                }}>
                  {p.nagroda} {t.label} @ {p.punkty.toLocaleString()}pkt
                  {p.opis&&<span style={{color:"var(--accent)",marginLeft:3}}>★</span>}
                </div>
              );
            })}
          </div>

          {/* Następny event info */}
          <div style={{marginTop:10,padding:"6px 10px",background:"var(--card)",borderRadius:6,
            border:"1px solid #1a1a2e",fontSize:10,color:"#555",lineHeight:1.5}}>
            💡 Progi mogą się różnić w każdym evencie. Gdy przyjdzie nowy — zaktualizuj listę progów.
            Szanse losowania pozostają podobne dla slotów tego samego typu.
          </div>
        </div>
      )}

      {ePktNaAmmo===0&&(
        <div style={{textAlign:"center",padding:20,color:"#555",fontSize:12}}>
          ⬆️ Ustaw szanse losowania żeby zobaczyć obliczenia
        </div>
      )}

    </div>
  );
}


// ============================================================
// GANG CHAT — live czat przez Firebase
// ============================================================
function GangChat({zalogowany, czlonkowie}) {
  const [wiadomosci, setWiadomosci] = useState([]);
  const [tekst, setTekst] = useState("");
  const [wysylanie, setWysylanie] = useState(false);
  const bottomRef = useRef(null);
  const nick = zalogowany?.login || "?";

  useEffect(() => {
    const unsub = subscribeChat(msgs => startTransition(() => setWiadomosci(msgs.slice(-100))));
    return () => unsub();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [wiadomosci]);

  const wyslij = async () => {
    if (!tekst.trim() || wysylanie) return;
    setWysylanie(true);
    playSound("click");
    const nowaWiad = { id: Date.now(), nick, tekst: tekst.trim(), czas: Date.now() };
    await zapiszWiadomosc(nowaWiad);
    setTekst("");
    setWysylanie(false);
  };

  const formatCzas = (ts) => {
    const d = new Date(ts);
    const teraz = new Date();
    const sameDay = d.toDateString() === teraz.toDateString();
    if (sameDay) return d.toLocaleTimeString("pl-PL", { hour:"2-digit", minute:"2-digit" });
    return d.toLocaleDateString("pl-PL", { day:"numeric", month:"short" }) + " " + d.toLocaleTimeString("pl-PL", { hour:"2-digit", minute:"2-digit" });
  };

  // Kolory nicków
  const nickColor = (n) => {
    const colors = ["var(--accent)","#0c6","#87CEEB","#da70d6","#fa0","#f55","#0ff","#ff69b4"];
    let hash = 0;
    for (let i = 0; i < n.length; i++) hash = n.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  // Grupuj kolejne wiadomości tego samego autora
  const grouped = [];
  wiadomosci.forEach((w, i) => {
    const prev = wiadomosci[i-1];
    const samaNick = prev?.nick === w.nick;
    const blisko = prev && (w.czas - prev.czas) < 60000; // 1 minuta
    grouped.push({ ...w, showNick: !samaNick || !blisko });
  });

  return (
    <div style={{display:"flex",flexDirection:"column",height:"70vh",maxHeight:600}}>
      <div style={{background:"rgba(255,215,0,0.06)",border:"1px solid #ffd70033",borderRadius:10,padding:"10px 14px",marginBottom:10}}>
        <div style={{fontSize:13,fontWeight:"bold",color:"var(--accent)"}}>💬 Chat gangu — na żywo</div>
        <div style={{fontSize:10,color:"#555"}}>Wiadomości widoczne dla wszystkich adminów • ostatnie 100</div>
      </div>

      {/* Lista wiadomości */}
      <div style={{flex:1,overflowY:"auto",background:"rgba(0,0,0,0.2)",borderRadius:10,border:"1px solid #1a1a2e",padding:"10px 12px",marginBottom:10}}>
        {wiadomosci.length === 0 && (
          <div style={{textAlign:"center",padding:30,color:"#444",fontSize:12}}>
            Brak wiadomości — napisz pierwszą! 👋
          </div>
        )}
        {grouped.map((w, i) => {
          const moja = normalizuj(w.nick) === normalizuj(nick);
          const kolor = nickColor(w.nick);
          return (
            <div key={w.id} style={{
              marginBottom: w.showNick ? 8 : 2,
              display:"flex",
              flexDirection: moja ? "row-reverse" : "row",
              alignItems:"flex-end",gap:6,
            }}>
              {/* Avatar */}
              {w.showNick && !moja && (
                <div style={{
                  width:28,height:28,borderRadius:"50%",flexShrink:0,
                  background:`${kolor}22`,border:`1px solid ${kolor}55`,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:11,fontWeight:"bold",color:kolor,
                }}>
                  {w.nick[0]?.toUpperCase()}
                </div>
              )}
              {!w.showNick && !moja && <div style={{width:28,flexShrink:0}}/>}

              <div style={{maxWidth:"75%"}}>
                {w.showNick && !moja && (
                  <div style={{fontSize:10,color:kolor,fontWeight:"bold",marginBottom:2,marginLeft:4}}>
                    {w.nick}
                  </div>
                )}
                <div style={{
                  padding:"7px 12px",borderRadius: moja ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                  background: moja
                    ? "linear-gradient(135deg,#b8860b,#ffd700)"
                    : "rgba(255,255,255,0.07)",
                  border: moja ? "none" : "1px solid var(--border)",
                  color: moja ? "#000" : "var(--text)",
                  fontSize:13,lineHeight:1.4,wordBreak:"break-word",
                }}>
                  {w.tekst}
                </div>
                <div style={{fontSize:9,color:"#444",marginTop:2,textAlign:moja?"right":"left",marginLeft:moja?0:4}}>
                  {formatCzas(w.czas)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div style={{display:"flex",gap:8}}>
        <input
          value={tekst}
          onChange={e=>setTekst(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();wyslij();}}}
          placeholder="Napisz wiadomość..."
          maxLength={500}
          style={{
            flex:1,padding:"10px 14px",background:"rgba(0,0,0,0.4)",
            border:"1px solid var(--border)",borderRadius:24,color:"#fff",fontSize:13,
            outline:"none",
          }}
        />
        <button onClick={wyslij} disabled={wysylanie||!tekst.trim()} style={{
          padding:"10px 18px",borderRadius:24,border:"none",cursor:"pointer",
          background:tekst.trim()?"linear-gradient(135deg,#b8860b,#ffd700)":"var(--card)",
          color:tekst.trim()?"#000":"#444",fontWeight:"bold",fontSize:13,
          transition:"all 0.15s",
        }}>
          {wysylanie?"⏳":"➤"}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// DUPLE — kto ile ma duplikatów
// ============================================================
function DupleView({czlonkowie, talie, duplikaty}) {
  const [filtrTyp, setFiltrTyp] = useState("wszystkie");
  const [filtrTalia, setFiltrTalia] = useState("wszystkie");

  // Policz duplikaty per osoba
  const statystyki = czlonkowie.map(c => {
    const klucze = Object.entries(duplikaty).filter(([k, v]) => v && k.startsWith(`${c.id}_`));
    const zlote = klucze.filter(([k]) => {
      const [,taliaId,kartaNazwa] = k.split("_");
      const talia = talie.find(t => t.id === taliaId);
      const karta = talia?.karty.find(k2 => k2.nazwa === kartaNazwa);
      return karta?.typ === "złota";
    });
    const diamentowe = klucze.filter(([k]) => {
      const [,taliaId,kartaNazwa] = k.split("_");
      const talia = talie.find(t => t.id === taliaId);
      const karta = talia?.karty.find(k2 => k2.nazwa === kartaNazwa);
      return karta?.typ === "diamentowa";
    });

    // Szczegóły per talia
    const perTalia = talie.map(t => {
      const duple = t.karty.filter(k => duplikaty[`${c.id}_${t.id}_${k.nazwa}`]);
      return { talia: t, duple };
    }).filter(x => x.duple.length > 0);

    return {
      czlonek: c,
      lacznie: klucze.length,
      zlote: zlote.length,
      diamentowe: diamentowe.length,
      perTalia,
    };
  }).sort((a,b) => b.lacznie - a.lacznie);

  const filtered = statystyki.filter(s => {
    if (filtrTyp === "złote" && s.zlote === 0) return false;
    if (filtrTyp === "diamentowe" && s.diamentowe === 0) return false;
    if (filtrTalia !== "wszystkie") {
      return s.perTalia.some(p => p.talia.id === filtrTalia);
    }
    return true;
  });

  const lacznie = statystyki.reduce((s,x)=>s+x.lacznie,0);
  const lacznieZlote = statystyki.reduce((s,x)=>s+x.zlote,0);
  const lacznie_dia = statystyki.reduce((s,x)=>s+x.diamentowe,0);

  return (
    <div>
      <div style={{background:"rgba(255,215,0,0.06)",border:"1px solid #ffd70033",borderRadius:10,padding:14,marginBottom:14}}>
        <div style={{fontSize:14,fontWeight:"bold",color:"var(--accent)",marginBottom:8}}>🃏 Ranking duplikatów</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"8px 14px",flex:1,textAlign:"center"}}>
            <div style={{fontSize:24,fontWeight:"bold",color:"var(--accent)"}}>{lacznie}</div>
            <div style={{fontSize:11,color:"var(--muted)"}}>duplikatów łącznie</div>
          </div>
          <div style={{background:"rgba(255,215,0,0.08)",borderRadius:8,padding:"8px 14px",flex:1,textAlign:"center"}}>
            <div style={{fontSize:24,fontWeight:"bold",color:"var(--accent)"}}>{lacznieZlote} ⭐</div>
            <div style={{fontSize:11,color:"var(--muted)"}}>złotych</div>
          </div>
          <div style={{background:"rgba(135,206,235,0.08)",borderRadius:8,padding:"8px 14px",flex:1,textAlign:"center"}}>
            <div style={{fontSize:24,fontWeight:"bold",color:"#87CEEB"}}>{lacznie_dia} 💎</div>
            <div style={{fontSize:11,color:"var(--muted)"}}>diamentowych</div>
          </div>
        </div>
      </div>

      {/* Filtry */}
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
        {["wszystkie","złote","diamentowe"].map(t=>(
          <button key={t} onClick={()=>setFiltrTyp(t)} style={{
            padding:"6px 12px",borderRadius:6,fontSize:12,cursor:"pointer",
            background:filtrTyp===t?"rgba(255,215,0,0.15)":"var(--card)",
            border:filtrTyp===t?"1px solid #ffd700":"1px solid var(--border)",
            color:filtrTyp===t?"var(--accent)":"var(--muted)",
          }}>{t==="złote"?"⭐ Złote":t==="diamentowe"?"💎 Diamentowe":"🃏 Wszystkie"}</button>
        ))}
        <select value={filtrTalia} onChange={e=>setFiltrTalia(e.target.value)} style={{
          padding:"6px 10px",background:"var(--card-solid)",border:"1px solid var(--border)",
          borderRadius:6,color:"var(--muted)",fontSize:12,cursor:"pointer",
        }}>
          <option value="wszystkie">Wszystkie talie</option>
          {talie.map(t=><option key={t.id} value={t.id}>{t.nazwa}</option>)}
        </select>
      </div>

      {/* Ranking */}
      {filtered.map((s,i) => (
        <div key={s.czlonek.id} style={{
          background:"var(--card)",border:"1px solid #1a1a2e",
          borderRadius:8,padding:"10px 12px",marginBottom:6,
        }}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:s.perTalia.length>0?6:0}}>
            <span style={{fontSize:12,color:"#555",width:22,textAlign:"right"}}>{i+1}.</span>
            <span style={{flex:1,fontSize:13,fontWeight:"bold",color:"var(--text)"}}>{s.czlonek.nazwa}</span>
            <span style={{fontSize:12,color:"var(--accent)",background:"rgba(255,215,0,0.1)",padding:"2px 8px",borderRadius:6}}>
              {s.lacznie} duple
            </span>
            {s.zlote>0&&<span style={{fontSize:11,color:"var(--accent)"}}>⭐{s.zlote}</span>}
            {s.diamentowe>0&&<span style={{fontSize:11,color:"#87CEEB"}}>💎{s.diamentowe}</span>}
          </div>
          {/* Szczegóły per talia */}
          {s.perTalia.length>0&&(filtrTalia!=="wszystkie"?s.perTalia.filter(p=>p.talia.id===filtrTalia):s.perTalia).map(p=>(
            <div key={p.talia.id} style={{
              marginLeft:30,marginTop:3,display:"flex",flexWrap:"wrap",gap:4,alignItems:"center",
            }}>
              <span style={{fontSize:10,color:"var(--muted)",minWidth:100}}>{p.talia.nazwa}:</span>
              {p.duple.map(k=>(
                <span key={k.nazwa} style={{
                  fontSize:10,padding:"1px 6px",borderRadius:4,
                  background:k.typ==="złota"?"rgba(255,215,0,0.1)":"rgba(135,206,235,0.1)",
                  color:k.typ==="złota"?"#ffd70099":"#87CEEB99",
                  border:`1px solid ${k.typ==="złota"?"#ffd70022":"#87CEEB22"}`,
                }}>{k.nazwa}</span>
              ))}
            </div>
          ))}
        </div>
      ))}
      {filtered.length===0&&(
        <div style={{textAlign:"center",padding:30,color:"#555",fontSize:13}}>
          Brak duplikatów dla wybranych filtrów
        </div>
      )}
    </div>
  );
}

// ============================================================
// EDYCJA TALII EVENTOWYCH
// ============================================================
function EdycjaTaliiEvent({ talieEvent, zapisz }) {
  const [wybranaIdx, setWybranaIdx] = useState(0);
  const [nowyModal, setNowyModal] = useState(false);
  const [nowaTalia, setNowaTalia] = useState({ nazwa: "", numer: "", nagroda_amunicja: "" });
  const [nowaKarta, setNowaKarta] = useState("");

  const sorted = [...talieEvent].sort((a, b) => (a.numer || 99) - (b.numer || 99));
  const talia = sorted[wybranaIdx] || null;

  const dodajTalie = () => {
    if (!nowaTalia.nazwa.trim()) return;
    const id = "event_" + nowaTalia.nazwa.toLowerCase().replace(/\s+/g, "_") + "_" + Date.now();
    zapisz([...talieEvent, {
      id, nazwa: nowaTalia.nazwa.trim(),
      numer: parseInt(nowaTalia.numer) || 99,
      nagroda_amunicja: parseInt(nowaTalia.nagroda_amunicja) || 0,
      ...[2, 3].reduce((acc, n) => {
        const v = parseInt(nowaTalia[`nagroda_amunicja_k${n}`]);
        if (!isNaN(v)) acc[`nagroda_amunicja_k${n}`] = v;
        return acc;
      }, {}),
      karty: [],
    }]);
    setNowaTalia({ nazwa: "", numer: "", nagroda_amunicja: "" });
    setNowyModal(false);
    setWybranaIdx(talieEvent.length);
  };

  const usunTalie = (id) => {
    if (!window.confirm("Usunąć tę talię eventową?")) return;
    const nowe = talieEvent.filter(t => t.id !== id);
    zapisz(nowe);
    setWybranaIdx(0);
  };

  const dodajKarte = () => {
    const nazwa = nowaKarta.trim();
    if (!nazwa || !talia) return;
    if (talia.karty.find(k => k.nazwa === nazwa)) { alert("Karta już istnieje!"); return; }
    zapisz(talieEvent.map(t => t.id === talia.id
      ? { ...t, karty: [...t.karty, { nazwa, typ: "diamentowa" }] }
      : t
    ));
    setNowaKarta("");
  };

  const usunKarte = (nazwa) => {
    zapisz(talieEvent.map(t => t.id === talia.id
      ? { ...t, karty: t.karty.filter(k => k.nazwa !== nazwa) }
      : t
    ));
  };

  const dodaj9Kart = () => {
    if (!talia) return;
    const nazwy = Array.from({ length: 9 }, (_, i) => `Karta ${i + 1}`);
    const noweKarty = nazwy
      .filter(n => !talia.karty.find(k => k.nazwa === n))
      .map(n => ({ nazwa: n, typ: "diamentowa" }));
    if (!noweKarty.length) { alert("Wszystkie karty już istnieją!"); return; }
    zapisz(talieEvent.map(t => t.id === talia.id
      ? { ...t, karty: [...t.karty, ...noweKarty] }
      : t
    ));
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: "bold", color: "var(--accent)", fontSize: 15, marginBottom: 12 }}>
        🎉 Talie eventowe
      </div>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 14 }}>
        Karty eventowe są niezależne od zwykłych talii. Wszystkie karty są diamentowe.<br />
        Po przełączeniu na tryb <strong style={{ color: "#00e676" }}>EVENT</strong> w zakładce Dane i Generuj używane są tylko te talie.
      </div>

      {/* Lista talii */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
        {sorted.map((t, i) => (
          <button key={t.id} onClick={() => setWybranaIdx(i)} style={{
            padding: "6px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer",
            background: wybranaIdx === i ? "rgba(0,230,118,0.15)" : "rgba(255,255,255,0.04)",
            border: wybranaIdx === i ? "1px solid #00e676" : "1px solid var(--border)",
            color: wybranaIdx === i ? "#00e676" : "var(--text)",
            fontWeight: wybranaIdx === i ? "bold" : "normal",
          }}>
            {t.numer}. {t.nazwa} <span style={{ color: "#555" }}>({t.karty.length}/9)</span>
          </button>
        ))}
        <button onClick={() => setNowyModal(true)} style={{
          padding: "6px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer",
          background: "rgba(0,230,118,0.08)", border: "1px dashed #00e67655", color: "#00e676",
        }}>+ Nowa talia</button>
      </div>

      {/* Modal nowej talii */}
      {nowyModal && (
        <div style={{ background: "rgba(0,0,0,0.4)", border: "1px solid #00e67655", borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ fontWeight: "bold", color: "#00e676", marginBottom: 10 }}>Nowa talia eventowa</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <input value={nowaTalia.nazwa} onChange={e => setNowaTalia(p => ({ ...p, nazwa: e.target.value }))}
              placeholder="Nazwa talii" style={{ flex: 2, minWidth: 150, padding: "7px 10px", borderRadius: 7, background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 13 }} />
            <input value={nowaTalia.numer} onChange={e => setNowaTalia(p => ({ ...p, numer: e.target.value }))}
              placeholder="Nr" type="number" style={{ width: 60, padding: "7px 10px", borderRadius: 7, background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 13 }} />
            <input value={nowaTalia.nagroda_amunicja} onChange={e => setNowaTalia(p => ({ ...p, nagroda_amunicja: e.target.value }))}
              placeholder="Nagroda ammo" type="number" style={{ width: 110, padding: "7px 10px", borderRadius: 7, background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 13 }} />
            <input value={nowaTalia.nagroda_amunicja_k2 || ""} onChange={e => setNowaTalia(p => ({ ...p, nagroda_amunicja_k2: e.target.value }))}
              placeholder="Nagroda K2" type="number" style={{ width: 110, padding: "7px 10px", borderRadius: 7, background: "rgba(0,0,0,0.3)", border: "1px solid #da70d655", color: "#da70d6", fontSize: 13 }} />
            <input value={nowaTalia.nagroda_amunicja_k3 || ""} onChange={e => setNowaTalia(p => ({ ...p, nagroda_amunicja_k3: e.target.value }))}
              placeholder="Nagroda K3" type="number" style={{ width: 110, padding: "7px 10px", borderRadius: 7, background: "rgba(0,0,0,0.3)", border: "1px solid #da70d655", color: "#da70d6", fontSize: 13 }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={dodajTalie} style={{ padding: "7px 16px", borderRadius: 7, background: "rgba(0,230,118,0.15)", border: "1px solid #00e676", color: "#00e676", cursor: "pointer", fontWeight: "bold" }}>✓ Dodaj</button>
            <button onClick={() => setNowyModal(false)} style={{ padding: "7px 16px", borderRadius: 7, background: "rgba(255,50,50,0.1)", border: "1px solid #f5544455", color: "#f55", cursor: "pointer" }}>✗ Anuluj</button>
          </div>
        </div>
      )}

      {/* Edycja wybranej talii */}
      {talia && (
        <div style={{ background: "rgba(0,0,0,0.25)", border: "1px solid #00e67633", borderRadius: 10, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontWeight: "bold", color: "#00e676", fontSize: 14 }}>{talia.numer}. {talia.nazwa}</span>
              <span style={{ fontSize: 11, color: "#666" }}>{talia.karty.length}/9 kart</span>
              <label style={{ fontSize: 11, color: "#fa0", display: "flex", alignItems: "center", gap: 4 }}>
                Nr:
                <input type="number" defaultValue={talia.numer} key={`nr-${talia.id}`}
                  onBlur={e => zapisz(talieEvent.map(t => t.id === talia.id ? { ...t, numer: parseInt(e.target.value) || t.numer } : t))}
                  style={{ width: 45, padding: "2px 5px", background: "rgba(0,0,0,0.3)", border: "1px solid #333", borderRadius: 4, color: "#fff", fontSize: 11 }} />
              </label>
              <label style={{ fontSize: 11, color: "#fa0", display: "flex", alignItems: "center", gap: 4 }}>
                💰 Nagroda K1:
                <input type="number" defaultValue={talia.nagroda_amunicja || 0} key={`nagroda-${talia.id}`}
                  onBlur={e => zapisz(talieEvent.map(t => t.id === talia.id ? { ...t, nagroda_amunicja: parseInt(e.target.value) || 0 } : t))}
                  style={{ width: 80, padding: "2px 5px", background: "rgba(0,0,0,0.3)", border: "1px solid #fa055", borderRadius: 4, color: "#fa0", fontSize: 11 }} />
              </label>
              <label style={{ fontSize: 11, color: "#da70d6", display: "flex", alignItems: "center", gap: 4 }}>
                K2 💜:
                <input type="number" defaultValue={talia.nagroda_amunicja_k2 ?? ""} placeholder="K2" key={`nagroda-k2-${talia.id}`}
                  onBlur={e => zapisz(talieEvent.map(t => {
                    if (t.id !== talia.id) return t;
                    const v = parseInt(e.target.value);
                    if (isNaN(v)) { const kopia = { ...t }; delete kopia.nagroda_amunicja_k2; return kopia; }
                    return { ...t, nagroda_amunicja_k2: v };
                  }))}
                  style={{ width: 80, padding: "2px 5px", background: "rgba(0,0,0,0.3)", border: "1px solid #da70d655", borderRadius: 4, color: "#da70d6", fontSize: 11 }} />
              </label>
              <label style={{ fontSize: 11, color: "#da70d6", display: "flex", alignItems: "center", gap: 4 }}>
                K3 💜:
                <input type="number" defaultValue={talia.nagroda_amunicja_k3 ?? ""} placeholder="K3" key={`nagroda-k3-${talia.id}`}
                  onBlur={e => zapisz(talieEvent.map(t => {
                    if (t.id !== talia.id) return t;
                    const v = parseInt(e.target.value);
                    if (isNaN(v)) { const kopia = { ...t }; delete kopia.nagroda_amunicja_k3; return kopia; }
                    return { ...t, nagroda_amunicja_k3: v };
                  }))}
                  style={{ width: 80, padding: "2px 5px", background: "rgba(0,0,0,0.3)", border: "1px solid #da70d655", borderRadius: 4, color: "#da70d6", fontSize: 11 }} />
              </label>
            </div>
            <button onClick={() => usunTalie(talia.id)} style={{ padding: "4px 12px", borderRadius: 6, background: "rgba(255,50,50,0.1)", border: "1px solid #f5544455", color: "#f55", cursor: "pointer", fontSize: 11 }}>🗑️ Usuń talię</button>
          </div>

          {/* Lista kart */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {talia.karty.map((k, i) => (
              <div key={k.nazwa} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: "rgba(135,206,235,0.08)", border: "1px solid #87CEEB33", fontSize: 12 }}>
                <span style={{ color: "#87CEEB" }}>💎</span>
                <span>{i + 1}. {k.nazwa}</span>
                <button onClick={() => usunKarte(k.nazwa)} style={{ marginLeft: 4, background: "none", border: "none", color: "#f55", cursor: "pointer", fontSize: 12, padding: 0 }}>✗</button>
              </div>
            ))}
          </div>

          {/* Dodaj kartę */}
          {talia.karty.length < 9 && (
            <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <input value={nowaKarta} onChange={e => setNowaKarta(e.target.value)}
                onKeyDown={e => e.key === "Enter" && dodajKarte()}
                placeholder="Nazwa karty..." style={{ flex: 1, minWidth: 150, padding: "7px 10px", borderRadius: 7, background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 13 }} />
              <button onClick={dodajKarte} style={{ padding: "7px 14px", borderRadius: 7, background: "rgba(0,230,118,0.12)", border: "1px solid #00e67655", color: "#00e676", cursor: "pointer", fontWeight: "bold" }}>+ Dodaj</button>
              {talia.karty.length === 0 && (
                <button onClick={dodaj9Kart} style={{ padding: "7px 14px", borderRadius: 7, background: "rgba(255,165,0,0.1)", border: "1px solid #fa055", color: "#fa0", cursor: "pointer", fontSize: 12 }}>⚡ Dodaj 9 pustych</button>
              )}
            </div>
          )}
          {talia.karty.length >= 9 && (
            <div style={{ fontSize: 12, color: "#0c6", textAlign: "center", padding: 8 }}>✅ Talia kompletna (9/9 kart)</div>
          )}
        </div>
      )}

      {talieEvent.length === 0 && !nowyModal && (
        <div style={{ textAlign: "center", padding: 40, color: "#555", fontSize: 13 }}>
          Brak talii eventowych. Dodaj pierwszą talię przyciskiem powyżej.
        </div>
      )}
    </div>
  );
}

export default App;
