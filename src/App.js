import { useState, useEffect } from "react";
import { loadGangData, saveGangData, subscribeGangData, setCardField, setStructure, setOnline, setOffline, subscribeOnline } from "./firebase";
import OcrView from "./OcrView";
import WalkiView from "./WalkiView";

const ADMIN_CREDENTIALS = [
  { login: "admin", haslo: "Twojastara00", rola: "admin" },
  { login: "zastepca", haslo: "Twojastara00", rola: "zastepca" },
];

// Normalizuje tekst do porównania — usuwa polskie znaki i zamienia na małe litery
function normalizuj(s) {
  return (s||"").toLowerCase()
    .replace(/ą/g,"a").replace(/ć/g,"c").replace(/ę/g,"e")
    .replace(/ł/g,"l").replace(/ń/g,"n").replace(/ó/g,"o")
    .replace(/ś/g,"s").replace(/ź/g,"z").replace(/ż/g,"z");
}

const TRUDNE_NUMERY = [10, 11, 12, 14, 15];

const DOMYSLNE_TALIE = [
  { id: "miejskie_legendy", numer: 1, nazwa: "Miejskie legendy", nagroda_amunicja: 500, karty: [
    {nazwa:"Tajemnicze zniknięcia",typ:"złota"},{nazwa:"Obserwacje kryptydów",typ:"złota"},{nazwa:"Nawiedzone lokacje",typ:"złota"},
    {nazwa:"Przeklęte przedmioty",typ:"złota"},{nazwa:"Istoty nadprzyrodzone",typ:"złota"},{nazwa:"Miejskie legendy",typ:"złota"},
    {nazwa:"Tajne stowarzyszenia",typ:"złota"},{nazwa:"Widmowe zjawy",typ:"złota"},{nazwa:"Niewyjaśnione zjawiska",typ:"złota"},
  ]},
  { id: "szkolne_rywalizacje", numer: 2, nazwa: "Szkolne rywalizacje", nagroda_amunicja: 750, karty: [
    {nazwa:"Zawody Maskotek",typ:"złota"},{nazwa:"Tygodnie duchów",typ:"złota"},{nazwa:"Wiece motywacyjne",typ:"złota"},
    {nazwa:"Wojny na żarty",typ:"złota"},{nazwa:"Gry Powrotu do Domu",typ:"złota"},{nazwa:"Bitwy cheerleaderek",typ:"złota"},
    {nazwa:"Barwy szkoły",typ:"złota"},{nazwa:"Rywalizacje absolwentów",typ:"złota"},{nazwa:"Wyzwania akademickie",typ:"złota"},
  ]},
  { id: "lokalne_firmy", numer: 3, nazwa: "Lokalne firmy", nagroda_amunicja: 1000, karty: [
    {nazwa:"Relacje z klientami",typ:"złota"},{nazwa:"Zaangażowanie społeczności",typ:"złota"},{nazwa:"Zrównoważone praktyki",typ:"złota"},
    {nazwa:"Lokalne zaopatrzenie",typ:"złota"},{nazwa:"Wyjątkowe oferty",typ:"złota"},{nazwa:"Reputacja na rynku",typ:"złota"},
    {nazwa:"Zdolność adaptacji biznesu",typ:"złota"},{nazwa:"Programy lojalnościowe dla klientów",typ:"złota"},
    {nazwa:"Satysfakcja pracowników",typ:"diamentowa"},
  ]},
  { id: "ukryte_ogrody", numer: 4, nazwa: "Ukryte ogrody", nagroda_amunicja: 1500, karty: [
    {nazwa:"Sekretne ścieżki",typ:"złota"},{nazwa:"Szepczące listowie",typ:"złota"},{nazwa:"Zaczarowane kwiaty",typ:"złota"},
    {nazwa:"Ukryte zakamarki",typ:"złota"},{nazwa:"Ciche zakątki",typ:"złota"},{nazwa:"Botaniczne labirynty",typ:"złota"},
    {nazwa:"Zielone sanktuaria",typ:"złota"},{nazwa:"Spokojne kryjówki",typ:"diamentowa"},{nazwa:"Starożytna mądrość",typ:"diamentowa"},
  ]},
  { id: "najgoretsze_miejsca", numer: 5, nazwa: "Najgorętsze miejsca nocnego życia", nagroda_amunicja: 1500, karty: [
    {nazwa:"Parkiety taneczne",typ:"złota"},{nazwa:"Popisowe koktajle",typ:"złota"},{nazwa:"Widoki z dachu",typ:"złota"},
    {nazwa:"Line-upy DJ-ów",typ:"złota"},{nazwa:"Dekoracja tematyczna",typ:"złota"},{nazwa:"Sekcje VIP",typ:"złota"},
    {nazwa:"Występy na żywo",typ:"złota"},{nazwa:"Neonowe oświetlenie",typ:"złota"},{nazwa:"Późnonocny posiłek",typ:"diamentowa"},
  ]},
  { id: "kolorowe_murale", numer: 6, nazwa: "Kolorowe murale", nagroda_amunicja: 2500, karty: [
    {nazwa:"Miejska estetyka",typ:"złota"},{nazwa:"Historie społeczności",typ:"złota"},{nazwa:"Tożsamość kulturowa",typ:"złota"},
    {nazwa:"Techniki artystyczne",typ:"złota"},{nazwa:"Wpływ historyczny",typ:"złota"},{nazwa:"Tematy środowiskowe",typ:"złota"},
    {nazwa:"Zaangażowanie społeczne",typ:"diamentowa"},{nazwa:"Sztuka współpracy",typ:"diamentowa"},{nazwa:"Efekt wizualny",typ:"diamentowa"},
  ]},
  { id: "miejska_dzika_przyroda", numer: 7, nazwa: "Miejska dzika przyroda", nagroda_amunicja: 3000, karty: [
    {nazwa:"Przystosowania zwierząt",typ:"złota"},{nazwa:"Miejskie ekosystemy",typ:"złota"},{nazwa:"Nocne zachowanie",typ:"złota"},
    {nazwa:"Korytarze dla dzikiej przyrody",typ:"złota"},{nazwa:"Źródła żywności",typ:"złota"},
    {nazwa:"Lokalizacje schronów",typ:"diamentowa"},{nazwa:"Interakcja człowieka z dziką przyrodą",typ:"diamentowa"},
    {nazwa:"Ekosystemy na dachach",typ:"diamentowa"},{nazwa:"Zachowanie szopa",typ:"diamentowa"},
  ]},
  { id: "artysci_uliczni", numer: 8, nazwa: "Artyści uliczni", nagroda_amunicja: 3500, karty: [
    {nazwa:"Busking",typ:"złota"},{nazwa:"Sztuka cyrku",typ:"złota"},{nazwa:"Żywe posągi",typ:"złota"},
    {nazwa:"Improwizacja teatralna",typ:"złota"},{nazwa:"Taniec uliczny",typ:"złota"},
    {nazwa:"Magia uliczna",typ:"diamentowa"},{nazwa:"Malarstwo na ciele",typ:"diamentowa"},
    {nazwa:"Muzyka etniczna",typ:"diamentowa"},{nazwa:"Akrobacje",typ:"diamentowa"},
  ]},
  { id: "festiwale_sasiedzkie", numer: 9, nazwa: "Festiwale sąsiedzkie", nagroda_amunicja: 4000, karty: [
    {nazwa:"Platformy paradne",typ:"złota"},{nazwa:"Parada zwierzaków",typ:"złota"},{nazwa:"Występy kulturalne",typ:"złota"},
    {nazwa:"Jarmarki rzemieślnicze",typ:"diamentowa"},{nazwa:"Tradycyjne gry",typ:"diamentowa"},{nazwa:"Warsztaty społeczności",typ:"diamentowa"},
    {nazwa:"Muzyka na żywo",typ:"diamentowa"},{nazwa:"Dekoracje uliczne",typ:"diamentowa"},{nazwa:"Aktywności rodzinne",typ:"diamentowa"},
  ]},
  { id: "targowiska_uliczne", numer: 10, nazwa: "Targowiska uliczne", nagroda_amunicja: 4000, karty: [
    {nazwa:"Lokalne rzemiosło",typ:"złota"},{nazwa:"Świeże produkty",typ:"złota"},{nazwa:"Egzotyczne przyprawy",typ:"złota"},
    {nazwa:"Jedzenie uliczne",typ:"złota"},{nazwa:"Odzież vintage",typ:"złota"},{nazwa:"Ręcznie robiona biżuteria",typ:"złota"},
    {nazwa:"Stoiska z sztuką",typ:"diamentowa"},{nazwa:"Polowanie na okazje",typ:"diamentowa"},{nazwa:"Różnorodność kulturowa",typ:"diamentowa"},
  ]},
  { id: "zabytki_historyczne", numer: 11, nazwa: "Zabytki historyczne", nagroda_amunicja: 4500, karty: [
    {nazwa:"Styl architektoniczny",typ:"złota"},{nazwa:"Znaczenie kulturowe",typ:"złota"},{nazwa:"Epoka historyczna",typ:"złota"},
    {nazwa:"Ewolucja architektoniczna",typ:"diamentowa"},{nazwa:"Atrakcja turystyczna",typ:"diamentowa"},
    {nazwa:"Obiekt światowego dziedzictwa",typ:"diamentowa"},{nazwa:"Wycieczki z przewodnikiem",typ:"diamentowa"},
    {nazwa:"Monumentalna skala",typ:"diamentowa"},{nazwa:"Projekty renowacji",typ:"diamentowa"},
  ]},
  { id: "tradycyjne_rzemioslo", numer: 12, nazwa: "Tradycyjne rzemiosło", nagroda_amunicja: 6000, karty: [
    {nazwa:"Techniki tkackie",typ:"diamentowa"},{nazwa:"Szkliwienie ceramiki",typ:"diamentowa"},{nazwa:"Style plecionkarstwa",typ:"diamentowa"},
    {nazwa:"Garbarstwo",typ:"diamentowa"},{nazwa:"Kucie metalu",typ:"diamentowa"},{nazwa:"Rzeźbienie w drewnie",typ:"diamentowa"},
    {nazwa:"Barwienie tekstyliów",typ:"diamentowa"},{nazwa:"Wzory haftu",typ:"diamentowa"},{nazwa:"Wydmuchiwanie szkła",typ:"diamentowa"},
  ]},
  { id: "liderzy_spolecznosci", numer: 13, nazwa: "Liderzy społeczności", nagroda_amunicja: 500, karty: [
    {nazwa:"Empatia",typ:"złota"},{nazwa:"Wizja",typ:"złota"},{nazwa:"Wpływ",typ:"złota"},
    {nazwa:"Adaptacyjność",typ:"złota"},{nazwa:"Rozwiązywanie konfliktów",typ:"złota"},{nazwa:"Inkluzywność",typ:"złota"},
    {nazwa:"Współpraca",typ:"złota"},{nazwa:"Podejmowanie decyzji",typ:"złota"},{nazwa:"Mentoring",typ:"złota"},
  ]},
  { id: "spotkania_rodzinne", numer: 14, nazwa: "Spotkania rodzinne", nagroda_amunicja: 6000, karty: [
    {nazwa:"Wspólne posiłki",typ:"diamentowa"},{nazwa:"Tradycje opowiadania historii",typ:"diamentowa"},{nazwa:"Więź międzypokoleniowa",typ:"diamentowa"},
    {nazwa:"Rytuały kulturowe",typ:"diamentowa"},{nazwa:"Rodzinne przepisy",typ:"diamentowa"},{nazwa:"Świąteczne uroczystości",typ:"diamentowa"},
    {nazwa:"Dyskusje o pochodzeniu",typ:"diamentowa"},{nazwa:"Albumy ze zdjęciami",typ:"diamentowa"},{nazwa:"Gry spotkania",typ:"diamentowa"},
  ]},
  { id: "lokalna_kuchnia", numer: 15, nazwa: "Lokalna kuchnia", nagroda_amunicja: 10000, karty: [
    {nazwa:"Regionalne składniki",typ:"diamentowa"},{nazwa:"Techniki gotowania",typ:"diamentowa"},{nazwa:"Tradycyjne potrawy",typ:"diamentowa"},
    {nazwa:"Etykieta przy stole",typ:"diamentowa"},{nazwa:"Profil smakowy",typ:"diamentowa"},{nazwa:"Historia kulinarna",typ:"diamentowa"},
    {nazwa:"Lokalne produkty",typ:"diamentowa"},{nazwa:"Sezonowe warianty",typ:"diamentowa"},{nazwa:"Festiwale jedzenia",typ:"diamentowa"},
  ]},
];

const DOMYSLNI_CZLONKOWIE = Array.from({length:20},(_,i)=>({id:i+1,nazwa:`Osoba ${i+1}`}));

const DOMYSLNE_DANE = {
  talie: DOMYSLNE_TALIE,
  czlonkowie: DOMYSLNI_CZLONKOWIE,
  posiadane: {},
  duplikaty: {},
  walki: [],
};

export default function App() {
  const [zalogowany, setZalogowany] = useState(() => {
    try { const z = localStorage.getItem("gang_user"); return z ? JSON.parse(z) : null; } catch { return null; }
  });
  const [dane, setDane] = useState(null); // null = loading
  const [zakładka, setZakładka] = useState("dane");
  const [typWymiany, setTypWymiany] = useState("złote");
  const [wynik, setWynik] = useState(null);
  const [trybWymiany, setTrybWymiany] = useState("priorytet");
  const [statusZapisu, setStatusZapisu] = useState("");

  const [statusOnline, setStatusOnline] = useState({});

  // Heartbeat obecności — co 30 sekund zapisuj że jesteś online
  useEffect(() => {
    if (!zalogowany) return;
    const login = zalogowany.login;
    setOnline(login);
    const interval = setInterval(() => setOnline(login), 30000);
    // Subskrybuj listę online
    const unsub = subscribeOnline(setStatusOnline);
    // Wyloguj się z online przy zamknięciu okna
    const handleUnload = () => setOffline(login);
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      clearInterval(interval);
      unsub();
      window.removeEventListener("beforeunload", handleUnload);
      setOffline(login);
    };
  }, [zalogowany]);

  // Subskrypcja na żywo z Firebase — zawsze ufamy serwerowi
  useEffect(() => {
    let unsub = null;
    (async () => {
      const start = await loadGangData();
      if (!start) {
        await saveGangData(DOMYSLNE_DANE);
        setDane(DOMYSLNE_DANE);
      } else {
        // Połącz domyślne dane (jeśli brak pól) z tym co jest w bazie
        setDane({
          talie: start.talie || DOMYSLNE_DANE.talie,
          czlonkowie: start.czlonkowie || DOMYSLNE_DANE.czlonkowie,
          posiadane: start.posiadane || {},
          duplikaty: start.duplikaty || {},
          walki: start.walki || [],
          aktywnaWymiana: start.aktywnaWymiana || null,
        });
      }
      unsub = subscribeGangData((d) => {
        // ZAWSZE aktualizuj — nawet po własnym zapisie. Server jest źródłem prawdy.
        setDane({
          talie: d.talie || DOMYSLNE_DANE.talie,
          czlonkowie: d.czlonkowie || DOMYSLNE_DANE.czlonkowie,
          posiadane: d.posiadane || {},
          duplikaty: d.duplikaty || {},
          walki: d.walki || [],
          aktywnaWymiana: d.aktywnaWymiana || null,
        });
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
    setStatusZapisu(ok ? "✓ Zapisano" : "❌ Błąd");
    setTimeout(() => setStatusZapisu(""), 1200);
  };

  // Zapis loginu
  useEffect(() => {
    try {
      if (zalogowany) localStorage.setItem("gang_user", JSON.stringify(zalogowany));
      else localStorage.removeItem("gang_user");
    } catch {}
  }, [zalogowany]);

  if (!zalogowany) return <LoginScreen onLogin={setZalogowany} czlonkowie={dane?.czlonkowie||[]}/>;  
  if (!dane) return <LoadingScreen/>;

  const isAdmin = zalogowany.rola === "admin" || zalogowany.rola === "zastepca";
  const talieSorted = [...dane.talie].sort((a,b)=>(a.numer||99)-(b.numer||99));

  const tabs = [
    {id:"dane",label:"📋 Dane gangu"},
    {id:"duplikaty",label:"🔄 Duplikaty"},
    {id:"aktywna",label:dane?.aktywnaWymiana?"📋 ROZPISKA ●":"📋 ROZPISKA"},
    {id:"walki",label:"🎯 Walki"},
    ...(isAdmin?[
      {id:"wynik",label:"⚡ Generuj"},
      {id:"ocr",label:"📸 OCR talii"},
      {id:"edycja",label:"⚙️ Talie"},
      {id:"czlonkowie",label:"👥 Członkowie"},
    ]:[]),
  ];

  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0f0c29,#302b63,#24243e)",fontFamily:"'Georgia',serif",color:"#f0e6d3"}}>
      <div style={{background:"rgba(0,0,0,0.75)",padding:"12px 16px",borderBottom:"2px solid #b8860b",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:19,fontWeight:"bold",color:"#ffd700",letterSpacing:2}}>🃏 GANG — MENADŻER WYMIAN</div>
          <div style={{fontSize:11,color:"#666",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginTop:2}}>
            <span><span style={{color:"#ffd700"}}>{zalogowany.login}</span> <span style={{color:"#888"}}>({zalogowany.rola})</span></span>
            {statusZapisu && <span style={{color:statusZapisu.includes("✓")?"#0c6":statusZapisu.includes("❌")?"#f55":"#fa0"}}>{statusZapisu}</span>}
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
          <button onClick={()=>setTypWymiany(t=>t==="złote"?"diamentowe":"złote")} style={{
            padding:"6px 12px",borderRadius:20,fontSize:12,fontWeight:"bold",cursor:"pointer",border:"none",
            background:typWymiany==="złote"?"linear-gradient(135deg,#b8860b,#ffd700)":"linear-gradient(135deg,#1a3a8f,#87CEEB)",
            color:typWymiany==="złote"?"#000":"#fff",
          }}>{typWymiany==="złote"?"⭐ ZŁOTE":"💎 DIAMENTOWE"}</button>
          <button onClick={()=>setZalogowany(null)} style={{padding:"5px 10px",background:"rgba(255,50,50,0.2)",border:"1px solid #f55",borderRadius:6,color:"#f55",cursor:"pointer",fontSize:11}}>Wyloguj</button>
        </div>
      </div>

      <div style={{display:"flex",background:"rgba(0,0,0,0.4)",borderBottom:"1px solid #2a2a3a",overflowX:"auto"}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setZakładka(t.id)} style={{
            padding:"10px 18px",background:"transparent",border:"none",
            borderBottom:zakładka===t.id?"2px solid #ffd700":"2px solid transparent",
            color:zakładka===t.id?"#ffd700":"#666",cursor:"pointer",fontSize:13,
            fontWeight:zakładka===t.id?"bold":"normal",whiteSpace:"nowrap",
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{padding:16,maxWidth:900,margin:"0 auto"}}>
        {zakładka==="dane"&&<DaneView
          talie={talieSorted} czlonkowie={dane.czlonkowie}
          posiadane={dane.posiadane||{}} duplikaty={dane.duplikaty||{}}
          typWymiany={typWymiany} zalogowany={zalogowany}
          zapiszKarte={zapiszKarte}
        />}
        {zakładka==="duplikaty"&&<DuplikatyView
          talie={talieSorted} czlonkowie={dane.czlonkowie}
          duplikaty={dane.duplikaty||{}}
        />}
        {zakładka==="aktywna"&&<AktywnaWymiana
          aktywnaWymiana={dane.aktywnaWymiana}
          zalogowany={zalogowany}
          czlonkowie={dane.czlonkowie}
          talie={talieSorted}
          posiadane={dane.posiadane||{}}
          duplikaty={dane.duplikaty||{}}
          typWymiany={typWymiany}
          isAdmin={isAdmin}
          zapiszAktywna={(w)=>zapiszStrukture("aktywnaWymiana",w)}
        />}
        {zakładka==="walki"&&<WalkiView
          czlonkowie={dane.czlonkowie} walki={dane.walki||[]}
          zapiszWalki={(now)=>zapiszStrukture("walki",now)}
          isAdmin={isAdmin}
        />}
        {zakładka==="wynik"&&!isAdmin&&<div style={{textAlign:"center",padding:60,color:"#555"}}><div style={{fontSize:36}}>🔒</div><div style={{marginTop:12}}>Tylko admin może generować wymianę.</div></div>}
        {zakładka==="wynik"&&isAdmin&&<WynikView
          talie={talieSorted} czlonkowie={dane.czlonkowie}
          posiadane={dane.posiadane||{}} duplikaty={dane.duplikaty||{}}
          typWymiany={typWymiany} wynik={wynik} setWynik={setWynik}
          trybWymiany={trybWymiany} setTrybWymiany={setTrybWymiany}
          zapiszAktywna={(w)=>zapiszStrukture("aktywnaWymiana",w)}
          przejdzDoAktywnej={()=>setZakładka("aktywna")}
        />}
        {zakładka==="edycja"&&isAdmin&&<EdycjaTalii
          talie={dane.talie} zapisz={(noweTalie)=>zapiszStrukture("talie",noweTalie)}
        />}
        {zakładka==="ocr"&&isAdmin&&<OcrView
          talie={talieSorted} czlonkowie={dane.czlonkowie}
          posiadane={dane.posiadane||{}} duplikaty={dane.duplikaty||{}}
          zapiszKarte={zapiszKarte}
        />}
        {zakładka==="czlonkowie"&&isAdmin&&<EdycjaCzlonkow
          czlonkowie={dane.czlonkowie} zapisz={(now)=>zapiszStrukture("czlonkowie",now)}
        />}
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0f0c29,#302b63,#24243e)",display:"flex",alignItems:"center",justifyContent:"center",color:"#ffd700",fontFamily:"'Georgia',serif"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:44,marginBottom:10}}>🃏</div>
        <div style={{fontSize:16}}>Ładowanie danych gangu...</div>
        <div style={{fontSize:11,color:"#666",marginTop:8}}>Łączenie z bazą Firebase</div>
      </div>
    </div>
  );
}

function LoginScreen({onLogin, czlonkowie}) {
  const [login,setLogin]=useState("");
  const [haslo,setHaslo]=useState("");
  const [blad,setBlad]=useState("");

  const zaloguj=()=>{
    const u=ADMIN_CREDENTIALS.find(c=>c.login===login&&c.haslo===haslo);
    if(u){onLogin(u);return;}
    if(login.trim().length>=2&&haslo===""){
      // Znajdź oryginalny nick w bazie (case-insensitive)
      const oryginalny=czlonkowie.find(c=>normalizuj(c.nazwa)===normalizuj(login.trim()));
      onLogin({login: oryginalny ? oryginalny.nazwa : login.trim(), rola:"czlonek"});
      return;
    }
    setBlad("Błędne dane. Członek: tylko nick (bez hasła). Admin: login + hasło.");
  };

  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0f0c29,#302b63,#24243e)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Georgia',serif",padding:20}}>
      <div style={{background:"rgba(0,0,0,0.65)",border:"2px solid #b8860b",borderRadius:16,padding:32,width:"100%",maxWidth:320,textAlign:"center",boxSizing:"border-box"}}>
        <div style={{fontSize:44,marginBottom:6}}>🃏</div>
        <div style={{fontSize:22,fontWeight:"bold",color:"#ffd700",marginBottom:2}}>GANG</div>
        <div style={{fontSize:12,color:"#666",marginBottom:24}}>Menadżer wymian kart</div>
        <input value={login} onChange={e=>setLogin(e.target.value)} placeholder="Twój nick / login admina"
          style={{width:"100%",padding:"10px 12px",background:"#12122a",border:"1px solid #333",borderRadius:8,color:"#fff",fontSize:14,marginBottom:10,boxSizing:"border-box"}}/>
        <input value={haslo} onChange={e=>setHaslo(e.target.value)} type="password" placeholder="Hasło (tylko admin)"
          onKeyDown={e=>e.key==="Enter"&&zaloguj()}
          style={{width:"100%",padding:"10px 12px",background:"#12122a",border:"1px solid #333",borderRadius:8,color:"#fff",fontSize:14,marginBottom:10,boxSizing:"border-box"}}/>
        {blad&&<div style={{color:"#f55",fontSize:12,marginBottom:10}}>{blad}</div>}
        <button onClick={zaloguj} style={{width:"100%",padding:12,background:"linear-gradient(135deg,#b8860b,#ffd700)",border:"none",borderRadius:8,fontWeight:"bold",fontSize:15,cursor:"pointer",color:"#000"}}>Wejdź</button>
        <div style={{fontSize:11,color:"#444",marginTop:16,lineHeight:1.6}}>Członek: wpisz nick, bez hasła.<br/>Admin: login + hasło.</div>
      </div>
    </div>
  );
}

function DaneView({talie,czlonkowie,posiadane,duplikaty,typWymiany,zapiszKarte,zalogowany}) {
  const isAdmin = zalogowany.rola==="admin"||zalogowany.rola==="zastepca";

  // Członek może edytować tylko swoje (po nazwie)
  const swojaOsoba = czlonkowie.find(c=>normalizuj(c.nazwa)===normalizuj(zalogowany.login));
  const startIdx = swojaOsoba && !isAdmin ? czlonkowie.indexOf(swojaOsoba) : 0;
  const [wybranaOsoba,setWybranaOsoba]=useState(startIdx);

  const toggleKarta=(osobaId,taliaId,kartaNazwa,tryb)=>{
    const key=`${osobaId}_${taliaId}_${kartaNazwa}`;
    if(tryb==="posiadane"){
      if(posiadane[key]){
        // Odznacz kartę i równocześnie usuń ją z duplikatów
        zapiszKarte("posiadane", key, null);
        if(duplikaty[key]) zapiszKarte("duplikaty", key, null);
      } else {
        zapiszKarte("posiadane", key, true);
      }
    } else {
      // duplikat
      if(duplikaty[key]) zapiszKarte("duplikaty", key, null);
      else zapiszKarte("duplikaty", key, true);
    }
  };

  const osoba=czlonkowie[wybranaOsoba];
  const typ=typWymiany==="złote"?"złota":"diamentowa";
  // Tylko admin i zastępca mogą edytować karty
  const mozeEdytowac = isAdmin;

  return (
    <div>
      <div style={{background:"rgba(255,215,0,0.06)",border:"1px solid #b8860b33",borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:12,color:"#ffd700"}}>
        Tryb: <strong>{typWymiany==="złote"?"⭐ ZŁOTE":"💎 DIAMENTOWE"}</strong>
        {!isAdmin && <span style={{color:"#aaa",marginLeft:10}}>— możesz edytować tylko swoje karty</span>}
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
        {czlonkowie.map((c,i)=>{
          const swoja = swojaOsoba && c.id===swojaOsoba.id;
          return (
            <button key={c.id} onClick={()=>setWybranaOsoba(i)} style={{
              padding:"5px 10px",borderRadius:6,cursor:"pointer",fontSize:12,
              background:wybranaOsoba===i?"linear-gradient(135deg,#b8860b,#ffd700)":swoja?"rgba(0,200,100,0.15)":"rgba(255,255,255,0.07)",
              border:wybranaOsoba===i?"none":swoja?"1px solid #0c655":"1px solid #2a2a3a",
              color:wybranaOsoba===i?"#000":swoja?"#0c6":"#aaa",fontWeight:wybranaOsoba===i?"bold":"normal",
            }}>{swoja?"⭐ ":""}{c.nazwa}</button>
          );
        })}
      </div>

      {osoba&&(
        <div style={{background:"rgba(0,0,0,0.2)",border:"1px solid #2a2a3a",borderRadius:10,padding:14}}>
          <div style={{fontSize:15,fontWeight:"bold",color:"#ffd700",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
            <span>✏️ {osoba.nazwa}</span>
            {!mozeEdytowac && <span style={{fontSize:11,color:"#f55",fontWeight:"normal"}}>🔒 tylko podgląd</span>}
          </div>
          {talie.map(talia=>{
            const kartyT=talia.karty.filter(k=>k.typ===typ);
            if(!kartyT.length) return null;
            const posC=kartyT.filter(k=>posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]).length;
            const dupC=kartyT.filter(k=>duplikaty[`${osoba.id}_${talia.id}_${k.nazwa}`]).length;
            const brak=kartyT.length-posC;
            const trudna=TRUDNE_NUMERY.includes(talia.numer);
            return (
              <div key={talia.id} style={{
                marginBottom:10,borderRadius:8,padding:"10px 12px",
                background:brak===0?"rgba(0,200,100,0.1)":brak<=2?"rgba(255,165,0,0.09)":"rgba(255,255,255,0.02)",
                border:brak===0?"1px solid #0c655":brak<=2?"1px solid #fa050":"1px solid #202035",
              }}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,flexWrap:"wrap",gap:4}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    <span style={{fontSize:10,background:trudna?"rgba(255,50,50,0.18)":"rgba(255,215,0,0.1)",border:`1px solid ${trudna?"#f55":"#b8860b"}`,borderRadius:4,padding:"1px 5px",color:trudna?"#f55":"#b8860b"}}>#{talia.numer}</span>
                    <span style={{fontWeight:"bold",fontSize:13}}>{talia.nazwa}</span>
                    <span style={{fontSize:11,color:"#666"}}>🎯{talia.nagroda_amunicja?.toLocaleString()}</span>
                  </div>
                  <div style={{fontSize:12}}>
                    <span style={{color:brak===0?"#0c6":"#ffd700"}}>{posC}/{kartyT.length}</span>
                    {dupC>0&&<span style={{color:"#87CEEB",marginLeft:6}}>+{dupC}dup</span>}
                    {brak===0&&<span style={{color:"#0c6",marginLeft:8}}>✓</span>}
                    {brak>0&&brak<=2&&<span style={{color:"#fa0",marginLeft:8}}>⚡{brak} brak</span>}
                  </div>
                </div>
                <div style={{height:3,background:"#12122a",borderRadius:2,marginBottom:8}}>
                  <div style={{height:"100%",width:`${kartyT.length?(posC/kartyT.length)*100:0}%`,background:brak===0?"#0c6":"linear-gradient(90deg,#b8860b,#ffd700)",borderRadius:2}}/>
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {kartyT.map(karta=>{
                    const key=`${osoba.id}_${talia.id}_${karta.nazwa}`;
                    const ma=posiadane[key];const dup=duplikaty[key];
                    return (
                      <div key={karta.nazwa} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                        <button disabled={!mozeEdytowac} onClick={()=>toggleKarta(osoba.id,talia.id,karta.nazwa,"posiadane")} style={{
                          padding:"3px 7px",fontSize:10,borderRadius:5,cursor:mozeEdytowac?"pointer":"not-allowed",maxWidth:90,textAlign:"center",lineHeight:1.2,
                          background:ma?(karta.typ==="złota"?"linear-gradient(135deg,#b8860b,#ffd700)":"linear-gradient(135deg,#1a3a8f,#87CEEB)"):"rgba(255,255,255,0.04)",
                          border:ma?"none":"1px solid #2a2a3a",
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function generujAlgorytm({talie,czlonkowie,posiadane,duplikaty,typWymiany,tryb,vipKolejka=[]}) {
  const typ=typWymiany==="złote"?"złota":"diamentowa";
  const oppTyp=typWymiany==="złote"?"diamentowa":"złota";

  // TRYB VIP — kolejka priorytetów
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
        const brakT=talia.karty.filter(k=>k.typ===typ&&!posiadane[`${vipId}_${talia.id}_${k.nazwa}`]);
        brakT.forEach(karta=>{
          potrzeby.push({talia,karta,nagroda:talia.nagroda_amunicja||0,trudna:TRUDNE_NUMERY.includes(talia.numer)});
        });
      });
      potrzeby.sort((a,b)=>{
        if(b.nagroda!==a.nagroda) return b.nagroda-a.nagroda;
        return (a.trudna?1:0)-(b.trudna?1:0);
      });
      potrzeby.forEach(({talia,karta,nagroda,trudna})=>{
        let dawca=null;
        for(const o2 of czlonkowie){
          if(o2.id===vipId||wysylajacy.has(o2.id)) continue;
          if(duplikaty[`${o2.id}_${talia.id}_${karta.nazwa}`]){dawca=o2;break;}
        }
        if(dawca){
          wysylajacy.add(dawca.id);
          planoweWymiany.push({od:dawca.nazwa,do:vip.nazwa,karta:karta.nazwa,talia:talia.nazwa,nagroda,faza:20,brakTCount:1,brakOCount:0,trudna});
        } else {
          nieobsluzone.push({osoba:vip,talia,karta,brakTCount:1});
        }
      });
    }

    // Po kolejce — pozostali dawcy do reszty gangu (fazy 1-2)
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
        const faza=obliczFaze(brakT.length,brakO.length);
        if(faza>2) return;
        brakT.forEach(karta=>{
          kandydaciReszta.push({osoba,talia,karta,faza,nagroda:talia.nagroda_amunicja||0,trudna:TRUDNE_NUMERY.includes(talia.numer),brakTCount:brakT.length,brakOCount:brakO.length});
        });
      });
    });
    kandydaciReszta.sort((a,b)=>{
      if(a.faza!==b.faza) return a.faza-b.faza;
      if(b.nagroda!==a.nagroda) return b.nagroda-a.nagroda;
      return (a.trudna?1:0)-(b.trudna?1:0);
    });
    for(const k of kandydaciReszta){
      let dawca=null;
      for(const o2 of czlonkowie){
        if(o2.id===k.osoba.id||wysylajacy.has(o2.id)) continue;
        if(duplikaty[`${o2.id}_${k.talia.id}_${k.karta.nazwa}`]){dawca=o2;break;}
      }
      if(dawca){
        wysylajacy.add(dawca.id);
        planoweWymiany.push({od:dawca.nazwa,do:k.osoba.nazwa,karta:k.karta.nazwa,talia:k.talia.nazwa,nagroda:k.nagroda,faza:21,brakTCount:k.brakTCount,brakOCount:k.brakOCount,trudna:k.trudna});
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
        if(brakPrzed.length>0&&brakPo.length===0) zamknieteTalie.push({osoba:osoba.nazwa,talia:talia.nazwa,nagroda:talia.nagroda_amunicja||0});
      });
    });
    return {planoweWymiany,nieobsluzone,zamknieciaInfo:zamknieteTalie};
  }

  // Zbierz stan każdej talii dla każdej osoby
  const staneTalii = []; // {osoba, talia, brakT, brakO, nagroda, trudna, kompletOpp}
  czlonkowie.forEach(osoba => {
    talie.forEach(talia => {
      const kartyT = talia.karty.filter(k => k.typ === typ);
      const kartyO = talia.karty.filter(k => k.typ === oppTyp);
      if (!kartyT.length) return;
      const brakT = kartyT.filter(k => !posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]);
      const brakO = kartyO.filter(k => !posiadane[`${osoba.id}_${talia.id}_${k.nazwa}`]);
      if (!brakT.length) return;
      staneTalii.push({
        osoba, talia,
        brakT, brakO,
        nagroda: talia.nagroda_amunicja || 0,
        trudna: TRUDNE_NUMERY.includes(talia.numer),
        kompletOpp: kartyO.length === 0 || brakO.length === 0,
      });
    });
  });

  const wysylajacy = new Set();
  const planoweWymiany = [];
  const nieobsluzone = [];

  if (tryb === "zamknij") {
    // TRYB "ZAMKNIJ COKOLWIEK"
    // Priorytetyzuj talie które MOŻNA zamknąć w tej wymianie (komplet opp już zebrany)
    // Wśród nich — największa nagroda, potem najmniej brakuje
    // Dla każdej talii pakuj WIELE kart (od różnych dawców) żeby ją domknąć

    const dozamkniecia = staneTalii
      .filter(s => s.kompletOpp) // tylko talie z kompletem drugiego typu — można je realnie zamknąć
      .sort((a, b) => {
        // Najpierw największa nagroda
        if (b.nagroda !== a.nagroda) return b.nagroda - a.nagroda;
        // Potem najmniej brakuje
        if (a.brakT.length !== b.brakT.length) return a.brakT.length - b.brakT.length;
        // Talie trudne na końcu
        const aT = a.trudna ? 1 : 0, bT = b.trudna ? 1 : 0;
        return aT - bT;
      });

    // Próbuj zamknąć talie po kolei
    for (const s of dozamkniecia) {
      const potrzebne = [...s.brakT]; // kopia
      const wymianyDlaTejTalii = [];
      for (const karta of potrzebne) {
        // Znajdź dawcę dla tej karty
        let dawca = null;
        for (const o2 of czlonkowie) {
          if (o2.id === s.osoba.id || wysylajacy.has(o2.id)) continue;
          if (duplikaty[`${o2.id}_${s.talia.id}_${karta.nazwa}`]) {
            dawca = o2; break;
          }
        }
        if (dawca) {
          wymianyDlaTejTalii.push({ dawca, karta });
        } else {
          // Brak dawcy dla tej karty — talia nie zostanie zamknięta tą wymianą
          // (i tak dodaj resztę kart które mają dawców)
        }
      }
      // Zatwierdź wszystkie znalezione wymiany dla tej talii
      // (nawet jeśli nie zamkniemy 100%, dajemy ile się da)
      wymianyDlaTejTalii.forEach(({ dawca, karta }) => {
        wysylajacy.add(dawca.id);
        planoweWymiany.push({
          od: dawca.nazwa, do: s.osoba.nazwa,
          karta: karta.nazwa, talia: s.talia.nazwa,
          nagroda: s.nagroda, faza: 10,
          brakTCount: s.brakT.length, brakOCount: s.brakO.length,
          trudna: s.trudna,
        });
      });
      // Brakujące potrzeby (kart bez dawcy)
      s.brakT.forEach(karta => {
        if (!wymianyDlaTejTalii.find(w => w.karta.nazwa === karta.nazwa)) {
          nieobsluzone.push({ osoba: s.osoba, talia: s.talia, karta, brakTCount: s.brakT.length });
        }
      });
    }

    // POTEM też talie z brakiem opp (nie da się domknąć, ale gracz może być blisko)
    const reszta = staneTalii.filter(s => !s.kompletOpp).sort((a, b) => {
      if (b.nagroda !== a.nagroda) return b.nagroda - a.nagroda;
      return a.brakT.length - b.brakT.length;
    });
    for (const s of reszta) {
      for (const karta of s.brakT) {
        let dawca = null;
        for (const o2 of czlonkowie) {
          if (o2.id === s.osoba.id || wysylajacy.has(o2.id)) continue;
          if (duplikaty[`${o2.id}_${s.talia.id}_${karta.nazwa}`]) {
            dawca = o2; break;
          }
        }
        if (dawca) {
          wysylajacy.add(dawca.id);
          planoweWymiany.push({
            od: dawca.nazwa, do: s.osoba.nazwa,
            karta: karta.nazwa, talia: s.talia.nazwa,
            nagroda: s.nagroda, faza: 11,
            brakTCount: s.brakT.length, brakOCount: s.brakO.length,
            trudna: s.trudna,
          });
        }
      }
    }
  } else {
    // TRYB "PRIORYTET" (1-2 brakujące) — bez zmian
    const kandidaci = [];
    staneTalii.forEach(s => {
      const faza = obliczFaze(s.brakT.length, s.brakO.length);
      s.brakT.forEach(karta => {
        kandidaci.push({
          osoba: s.osoba, talia: s.talia, karta, faza,
          brakTCount: s.brakT.length, brakOCount: s.brakO.length,
          nagroda: s.nagroda, trudna: s.trudna,
        });
      });
    });

    kandidaci.sort((a, b) => {
      if (a.faza !== b.faza) return a.faza - b.faza;
      const aT = a.trudna ? 1 : 0, bT = b.trudna ? 1 : 0;
      if (aT !== bT) return aT - bT;
      if (b.nagroda !== a.nagroda) return b.nagroda - a.nagroda;
      return a.brakTCount - b.brakTCount;
    });

    for (const k of kandidaci) {
      const key = `${k.osoba.id}_${k.talia.id}_${k.karta.nazwa}`;
      if (posiadane[key]) continue;
      let dawca = null;
      for (const o2 of czlonkowie) {
        if (o2.id === k.osoba.id || wysylajacy.has(o2.id)) continue;
        if (duplikaty[`${o2.id}_${k.talia.id}_${k.karta.nazwa}`]) { dawca = o2; break; }
      }
      if (dawca) {
        wysylajacy.add(dawca.id);
        planoweWymiany.push({
          od: dawca.nazwa, do: k.osoba.nazwa,
          karta: k.karta.nazwa, talia: k.talia.nazwa,
          nagroda: k.nagroda, faza: k.faza,
          brakTCount: k.brakTCount, brakOCount: k.brakOCount,
          trudna: k.trudna,
        });
      } else if (k.brakTCount <= 2) {
        nieobsluzone.push(k);
      }
    }
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
      if(!kPrzed&&kPo) zamknieciaInfo.push({osoba:osoba.nazwa,talia:talia.nazwa,nagroda:talia.nagroda_amunicja});
    });
  });

  return {planoweWymiany,nieobsluzone,zamknieciaInfo};
}

function obliczFaze(brakT,brakO){
  // FAZA 1-2: Talia może zostać ZAMKNIĘTA tą wymianą (komplet drugiego typu już zebrany)
  if(brakT===1&&brakO===0) return 1; // Wymiana zamknie talię! NAJWYŻSZY PRIORYTET
  if(brakT===2&&brakO===0) return 2; // Brakuje 2, ale druga karta przyjdzie w kolejnej wymianie

  // FAZA 3-4: Talia BLISKO zamknięcia (brakuje też 1-2 drugiego typu)
  // Osoba może domknąć talię gdy dostanie też brakujące diamentowe innym dniem
  if(brakT===1&&brakO>=1&&brakO<=2) return 3;
  if(brakT===2&&brakO>=1&&brakO<=2) return 4;

  // FAZA 5: Daleko od zamknięcia (brakuje też 3+ drugiego typu lub brakuje 3+ tego typu)
  return 5;
}

function WynikView({talie,czlonkowie,posiadane,duplikaty,typWymiany,wynik,setWynik,trybWymiany,setTrybWymiany,zapiszAktywna,przejdzDoAktywnej}) {
  const [skopiowano,setSkopiowano]=useState(false);
  const [publikowanie,setPublikowanie]=useState(false);
  const [wylaczoneTalie,setWylaczoneTalie]=useState(new Set());
  const [vipKolejka,setVipKolejka]=useState([]); // lista id osób w kolejności priorytetu

  const toggleTalia=(id)=>{
    setWylaczoneTalie(prev=>{
      const n=new Set(prev);
      n.has(id)?n.delete(id):n.add(id);
      return n;
    });
  };

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
    const oppTyp=typWymiany==="złote"?"diamentowa":"złota";

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
          const faza=obliczFaze(brakT.length,brakO.length);
          kandydaci.push({
            od:dawcaNazwa, do:odbiorca.nazwa,
            karta:karta.nazwa, talia:talia.nazwa,
            nagroda:talia.nagroda_amunicja||0, faza,
            brakTCount:brakT.length, brakOCount:brakO.length,
            trudna:TRUDNE_NUMERY.includes(talia.numer),
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

    // Wyklucz wymiany które już są w planie (ten dawca już wysyła tę kartę)
    const juzWysylane=new Set(wynik.planoweWymiany.filter(w=>w.od===dawcaNazwa).map(w=>`${w.do}_${w.karta}`));
    return kandydaci.filter(k=>`${k.do}_${k.karta}`!==juzWysylane.values().next().value).slice(0,5);
  };

  const podmienWymiane=(idx,nowaWymiana)=>{
    setWynik(prev=>({
      ...prev,
      planoweWymiany: prev.planoweWymiany.map((w,i)=>i===idx?nowaWymiana:w)
    }));
    setPodmienDawce(null);
  };

  const usunWymiane=(idx)=>{
    setWynik(prev=>({
      ...prev,
      planoweWymiany: prev.planoweWymiany.filter((_,i)=>i!==idx)
    }));
  };

  const generuj=()=>{
    const aktywne=talie.filter(t=>!wylaczoneTalie.has(t.id));
    setWynik(generujAlgorytm({talie:aktywne,czlonkowie,posiadane,duplikaty,typWymiany,tryb:trybWymiany,vipKolejka:trybWymiany==="vip"?vipKolejka:[]}));
  };

  const tekstMessenger=wynik?wynik.planoweWymiany.map(w=>`${w.od} ➡️ ${w.do}: ${w.karta}`).join("\n"):"";

  const kopiuj=()=>{
    navigator.clipboard?.writeText(tekstMessenger).then(()=>{setSkopiowano(true);setTimeout(()=>setSkopiowano(false),2000);});
  };

  const etykietyFaz={
    1:{t:"🔴 FAZA 1 — ZAMKNIE TALIĘ! Brakuje 1 karty + komplet innych typów",k:"#f55"},
    2:{t:"🟠 FAZA 2 — Brakuje 2 kart + komplet innych typów (talia blisko)",k:"#ff7a00"},
    3:{t:"🟡 FAZA 3 — Brakuje 1 karty + 1-2 innych typów do uzupełnienia",k:"#fa0"},
    4:{t:"🟡 FAZA 4 — Brakuje 2 kart + 1-2 innych typów do uzupełnienia",k:"#d4b800"},
    5:{t:"🔵 FAZA 5 — Talia daleka od zamknięcia (3+ braków)",k:"#6af"},
    10:{t:"🔓 ZAMKNIE TALIĘ — pakiet kart na zamknięcie talii (komplet innych typów już ma)",k:"#bb88ff"},
    11:{t:"🔓 Dodatkowo — brakuje też kart innego typu, ale wysyłamy bo nie ma lepszych",k:"#888bff"},
    20:{t:"👑 VIP — karty dla wybranej osoby priorytetowej",k:"#ffd700"},
    21:{t:"👥 Reszta gangu — pozostali dawcy po obsłudze VIP-a",k:"#aaa"},
  };

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
        {[
          {id:"priorytet",label:"🎯 Priorytet (1-2 brakujące)"},
          {id:"zamknij",label:"🔓 Zamknij cokolwiek"},
          {id:"vip",label:"👑 VIP — dobij jedną osobę"},
        ].map(t=>(
          <button key={t.id} onClick={()=>setTrybWymiany(t.id)} style={{
            padding:"8px 14px",borderRadius:8,cursor:"pointer",fontSize:12,
            background:trybWymiany===t.id?"rgba(255,215,0,0.14)":"rgba(255,255,255,0.05)",
            border:trybWymiany===t.id?"1px solid #ffd700":"1px solid #2a2a3a",
            color:trybWymiany===t.id?"#ffd700":"#666",
          }}>{t.label}</button>
        ))}
      </div>

      {/* Panel VIP — kolejka priorytetów */}
      {trybWymiany==="vip"&&(
        <div style={{background:"rgba(255,215,0,0.06)",border:"1px solid #ffd70044",borderRadius:10,padding:12,marginBottom:12}}>
          <div style={{fontSize:12,fontWeight:"bold",color:"#ffd700",marginBottom:4}}>
            👑 Kolejka priorytetów — zaznacz osoby i ustaw kolejność
          </div>
          <div style={{fontSize:11,color:"#888",marginBottom:10}}>
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
                  background:wKolejce?"linear-gradient(135deg,#b8860b,#ffd700)":"rgba(255,255,255,0.05)",
                  border:wKolejce?"none":"1px solid #2a2a3a",
                  color:wKolejce?"#000":"#888",
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
              <div style={{fontSize:11,color:"#ffd700",marginBottom:6}}>📋 Kolejność obsługi:</div>
              {vipKolejka.map((id,idx)=>{
                const osoba=czlonkowie.find(c=>c.id===id);
                const typ=typWymiany==="złote"?"złota":"diamentowa";
                const brakCount=talie.filter(t=>!wylaczoneTalie.has(t.id)).reduce((s,talia)=>
                  s+talia.karty.filter(k=>k.typ===typ&&!posiadane[`${id}_${talia.id}_${k.nazwa}`]).length
                ,0);
                return (
                  <div key={id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 8px",background:"rgba(255,215,0,0.06)",borderRadius:6,marginBottom:4}}>
                    <span style={{fontSize:14,fontWeight:"bold",color:"#ffd700",width:20}}>{idx+1}.</span>
                    <span style={{flex:1,fontSize:12,color:"#ddd"}}>{osoba?.nazwa}</span>
                    <span style={{fontSize:11,color:"#f55"}}>−{brakCount} kart</span>
                    <div style={{display:"flex",gap:2}}>
                      <button onClick={()=>przesunVip(id,-1)} disabled={idx===0}
                        style={{padding:"2px 7px",background:"rgba(255,255,255,0.07)",border:"none",borderRadius:3,color:idx===0?"#333":"#aaa",cursor:idx===0?"default":"pointer",fontSize:11}}>▲</button>
                      <button onClick={()=>przesunVip(id,1)} disabled={idx===vipKolejka.length-1}
                        style={{padding:"2px 7px",background:"rgba(255,255,255,0.07)",border:"none",borderRadius:3,color:idx===vipKolejka.length-1?"#333":"#aaa",cursor:idx===vipKolejka.length-1?"default":"pointer",fontSize:11}}>▼</button>
                      <button onClick={()=>toggleVip(id)}
                        style={{padding:"2px 7px",background:"rgba(255,50,50,0.1)",border:"none",borderRadius:3,color:"#f5544488",cursor:"pointer",fontSize:11}}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {vipKolejka.length===0&&<div style={{fontSize:11,color:"#555",marginTop:4}}>← Kliknij osoby powyżej żeby dodać do kolejki</div>}
        </div>
      )}

      {/* Panel wyłączania talii */}
      <div style={{background:"rgba(0,0,0,0.25)",border:"1px solid #2a2a3a",borderRadius:10,padding:12,marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{fontSize:12,fontWeight:"bold",color:"#ffd700"}}>
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
                background:wylaczona?"rgba(255,50,50,0.15)":"rgba(255,255,255,0.05)",
                border:wylaczona?"1px solid #f5544488":"1px solid #2a2a3a",
                color:wylaczona?"#f55":"#888",
                textDecoration:wylaczona?"line-through":"none",
              }}>
                {wylaczona?"🚫 ":""}{t.nazwa}
              </button>
            );
          })}
        </div>
        {wylaczoneTalie.size>0&&(
          <div style={{fontSize:10,color:"#666",marginTop:6}}>
            Wyłączone talie są ignorowane przy generowaniu wymian.
          </div>
        )}
      </div>

      <button onClick={generuj} style={{
        width:"100%",padding:14,background:"linear-gradient(135deg,#b8860b,#ffd700,#b8860b)",
        border:"none",borderRadius:10,color:"#000",fontSize:15,fontWeight:"bold",
        cursor:"pointer",letterSpacing:2,marginBottom:16,
      }}>⚡ GENERUJ ({typWymiany==="złote"?"⭐ ZŁOTE":"💎 DIAMENTOWE"}) ⚡</button>

      {wynik&&<>
        {wynik.zamknieciaInfo.length>0&&(
          <div style={{background:"rgba(0,200,100,0.1)",border:"1px solid #0c6",borderRadius:10,padding:"12px 16px",marginBottom:14}}>
            <div style={{fontWeight:"bold",color:"#0c6",marginBottom:8,fontSize:14}}>🏆 Po tej wymianie gang zamknie talie:</div>
            {wynik.zamknieciaInfo.map((z,i)=>(
              <div key={i} style={{fontSize:13,padding:"3px 0",color:"#ccc"}}>
                🎉 <strong style={{color:"#ffd700"}}>{z.osoba}</strong> zamknie <strong>{z.talia}</strong>
                <span style={{color:"#0c6",marginLeft:6}}>+{z.nagroda?.toLocaleString()} amunicji!</span>
              </div>
            ))}
            <div style={{marginTop:8,fontWeight:"bold",color:"#0c6",fontSize:14}}>
              Łącznie: +{wynik.zamknieciaInfo.reduce((s,z)=>s+(z.nagroda||0),0).toLocaleString()} amunicji dla gangu 🎯
            </div>
          </div>
        )}

        <div style={{background:"rgba(0,0,0,0.3)",border:"1px solid #2a2a3a",borderRadius:10,padding:14,marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:6}}>
            <div style={{fontWeight:"bold",color:"#ffd700",fontSize:13}}>📋 Tekst na Messengera</div>
            <button onClick={kopiuj} style={{
              padding:"5px 14px",background:skopiowano?"rgba(0,200,100,0.2)":"rgba(255,215,0,0.12)",
              border:`1px solid ${skopiowano?"#0c6":"#b8860b"}`,borderRadius:6,
              color:skopiowano?"#0c6":"#ffd700",cursor:"pointer",fontSize:11,fontWeight:"bold",
            }}>{skopiowano?"✓ Skopiowano!":"📋 Kopiuj"}</button>
          </div>
          <pre style={{fontSize:13,color:"#ddd",whiteSpace:"pre-wrap",margin:0,fontFamily:"monospace",lineHeight:2,background:"rgba(0,0,0,0.2)",padding:10,borderRadius:6,overflow:"auto"}}>
            {tekstMessenger||"Brak wymian"}
          </pre>
        </div>

        <div style={{fontSize:12,color:"#888",marginBottom:10}}>
          Zaplanowane wymiany: <strong style={{color:"#ffd700"}}>{wynik.planoweWymiany.length}</strong>
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
            setPublikowanie(false);
            przejdzDoAktywnej();
          }} style={{
            marginLeft:"auto",padding:"5px 14px",
            background:"linear-gradient(135deg,#0c6,#0fa)",
            border:"none",borderRadius:6,color:"#000",
            cursor:"pointer",fontSize:12,fontWeight:"bold",
          }}>{publikowanie?"⏳ Zapisuję...":"📤 Opublikuj dla gangu"}</button>
        </div>

        {[1,2,3,4,5,10,11,20,21].map(faza=>{
          const w=wynik.planoweWymiany.filter(x=>x.faza===faza);
          if(!w.length) return null;
          const e=etykietyFaz[faza]||{t:`Faza ${faza}`,k:"#aaa"};
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
                        <span style={{background:"rgba(255,215,0,0.1)",border:"1px solid #b8860b",padding:"2px 8px",borderRadius:20,fontSize:12,color:"#ffd700",fontWeight:"bold"}}>{x.od}</span>
                        <span style={{color:"#444"}}>→</span>
                        <span style={{background:`${e.k}18`,border:`1px solid ${e.k}`,padding:"2px 8px",borderRadius:20,fontSize:12,color:e.k,fontWeight:"bold"}}>{x.do}</span>
                        <span style={{fontSize:12,color:"#ddd"}}><strong>{x.karta}</strong></span>
                        <span style={{fontSize:11,color:"#555"}}>[{x.talia}]</span>
                        {x.brakOCount>0&&<span style={{fontSize:10,color:"#87CEEB",background:"rgba(65,105,225,0.12)",padding:"1px 6px",borderRadius:10}}>jeszcze brak {x.brakOCount} {typWymiany==="złote"?"💎":"⭐"}</span>}
                        {x.trudna&&<span style={{fontSize:10,color:"#f55"}}>⚠️trudna</span>}
                        <span style={{fontSize:11,color:"#fa0"}}>🎯{x.nagroda?.toLocaleString()}</span>
                        <div style={{marginLeft:"auto",display:"flex",gap:4}}>
                          <button onClick={()=>setPodmienDawce(pokazujPodmien?null:{globalIdx,dawca:x.od})} style={{
                            padding:"2px 8px",background:pokazujPodmien?"rgba(255,215,0,0.2)":"rgba(255,165,0,0.1)",
                            border:`1px solid ${pokazujPodmien?"#ffd700":"#fa055"}`,borderRadius:4,
                            color:pokazujPodmien?"#ffd700":"#fa0",cursor:"pointer",fontSize:10,
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
                            <div style={{fontSize:11,color:"#666"}}>Brak alternatyw — {x.od} nie ma innych duplikatów które ktoś potrzebuje</div>
                          ):alternatywy.map((alt,ai)=>(
                            <div key={ai} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 0",flexWrap:"wrap"}}>
                              <span style={{fontSize:11,color:["#f55","#ff7a00","#fa0","#d4b800","#6af"][Math.min(alt.faza-1,4)]||"#aaa"}}>F{alt.faza}</span>
                              <span style={{fontSize:11,color:"#888"}}>→ <strong style={{color:"#ddd"}}>{alt.do}</strong>: {alt.karta}</span>
                              <span style={{fontSize:10,color:"#666"}}>[{alt.talia}]</span>
                              <span style={{fontSize:10,color:"#fa0"}}>🎯{alt.nagroda?.toLocaleString()}</span>
                              <button onClick={()=>podmienWymiane(globalIdx,alt)} style={{
                                marginLeft:"auto",padding:"2px 10px",background:"rgba(0,200,100,0.15)",
                                border:"1px solid #0c644",borderRadius:4,color:"#0c6",cursor:"pointer",fontSize:10,fontWeight:"bold",
                              }}>Wybierz</button>
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

        {wynik.nieobsluzone.length>0&&(
          <div style={{background:"rgba(255,165,0,0.06)",border:"1px solid #b8860b55",borderRadius:10,padding:14}}>
            <div style={{fontWeight:"bold",color:"#fa0",marginBottom:8,fontSize:13}}>⚠️ Potrzeby bez dawcy (brak duplikatów):</div>
            {wynik.nieobsluzone.map((p,i)=>(
              <div key={i} style={{fontSize:12,color:"#aaa",padding:"3px 0",borderBottom:"1px solid #12122a"}}>
                <span style={{color:"#ffd700"}}>{p.osoba.nazwa}</span> potrzebuje <strong style={{color:"#ddd"}}>{p.karta.nazwa}</strong> z <em>{p.talia.nazwa}</em>
                <span style={{color:"#666",marginLeft:6}}>(brakuje {p.brakTCount})</span>
              </div>
            ))}
          </div>
        )}
      </>}
    </div>
  );
}

function EdycjaTalii({talie,zapisz}) {
  const [wybranaIdx,setWybranaIdx]=useState(0);
  const [nowaKarta,setNowaKarta]=useState({nazwa:"",typ:"złota"});
  const [nowyModal,setNowyModal]=useState(false);
  const [nowaTalia,setNowaTalia]=useState({nazwa:"",numer:"",nagroda_amunicja:""});

  const sorted=[...talie].sort((a,b)=>(a.numer||99)-(b.numer||99));
  const talia=sorted[wybranaIdx];

  const dodajKarte=()=>{
    if(!nowaKarta.nazwa.trim()) return;
    zapisz(talie.map(t=>t.id===talia.id?{...t,karty:[...t.karty,{nazwa:nowaKarta.nazwa.trim(),typ:nowaKarta.typ}]}:t));
    setNowaKarta(k=>({...k,nazwa:""}));
  };
  const usunKarte=n=>zapisz(talie.map(t=>t.id===talia.id?{...t,karty:t.karty.filter(k=>k.nazwa!==n)}:t));
  const zmienTyp=(n,typ)=>zapisz(talie.map(t=>t.id===talia.id?{...t,karty:t.karty.map(k=>k.nazwa===n?{...k,typ}:k)}:t));
  const zapiszPole=(pole,val)=>zapisz(talie.map(t=>t.id===talia.id?{...t,[pole]:pole==="numer"?parseInt(val)||t.numer:parseInt(val)||t.nagroda_amunicja}:t));
  const dodajTalie=()=>{
    if(!nowaTalia.nazwa.trim()) return;
    const id=nowaTalia.nazwa.toLowerCase().replace(/\s+/g,"_")+"_"+Date.now();
    zapisz([...talie,{id,nazwa:nowaTalia.nazwa.trim(),numer:parseInt(nowaTalia.numer)||99,nagroda_amunicja:parseInt(nowaTalia.nagroda_amunicja)||0,karty:[]}]);
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
        <div style={{fontSize:14,fontWeight:"bold",color:"#ffd700"}}>⚙️ Talie ({talie.length})</div>
        <button onClick={()=>setNowyModal(true)} style={{padding:"6px 14px",background:"rgba(0,200,100,0.12)",border:"1px solid #0c655",borderRadius:8,color:"#0c6",cursor:"pointer",fontSize:12}}>+ Nowa talia</button>
      </div>

      {nowyModal&&(
        <div style={{background:"rgba(0,0,0,0.4)",border:"1px solid #0c655",borderRadius:10,padding:16,marginBottom:14}}>
          <div style={{fontWeight:"bold",color:"#0c6",marginBottom:10}}>Nowa talia</div>
          {[{p:"nazwa",l:"Nazwa"},{p:"numer",l:"Numer"},{p:"nagroda_amunicja",l:"Nagroda (amunicja)"}].map(f=>(
            <input key={f.p} value={nowaTalia[f.p]} onChange={e=>setNowaTalia(n=>({...n,[f.p]:e.target.value}))} placeholder={f.l}
              style={{display:"block",width:"100%",marginBottom:8,padding:"8px 10px",background:"#12122a",border:"1px solid #333",borderRadius:6,color:"#fff",fontSize:13,boxSizing:"border-box"}}/>
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
            background:wybranaIdx===i?"rgba(255,215,0,0.12)":"rgba(255,255,255,0.05)",
            border:wybranaIdx===i?"1px solid #ffd700":"1px solid #2a2a3a",
            color:wybranaIdx===i?"#ffd700":"#888",
          }}>#{t.numer} {t.nazwa}</button>
        ))}
      </div>

      {talia&&(
        <div style={{background:"rgba(0,0,0,0.2)",border:"1px solid #2a2a3a",borderRadius:10,padding:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,flexWrap:"wrap",gap:8}}>
            <div style={{fontSize:15,fontWeight:"bold",color:"#ffd700"}}>{talia.nazwa} <span style={{fontSize:12,color:"#888"}}>({talia.karty.length} kart)</span></div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
              <label style={{fontSize:11,color:"#aaa"}}>Nr: <input type="number" defaultValue={talia.numer} onBlur={e=>zapiszPole("numer",e.target.value)} style={{width:45,padding:"3px 5px",background:"#12122a",border:"1px solid #333",borderRadius:4,color:"#fff",fontSize:11}}/></label>
              <label style={{fontSize:11,color:"#aaa"}}>Nagroda: <input type="number" defaultValue={talia.nagroda_amunicja} onBlur={e=>zapiszPole("nagroda_amunicja",e.target.value)} style={{width:70,padding:"3px 5px",background:"#12122a",border:"1px solid #333",borderRadius:4,color:"#fff",fontSize:11}}/></label>
              <button onClick={()=>usunTalie(talia.id)} style={{padding:"4px 10px",background:"rgba(255,50,50,0.12)",border:"1px solid #f5544455",borderRadius:6,color:"#f55",cursor:"pointer",fontSize:11}}>🗑 Usuń</button>
            </div>
          </div>
          {talia.karty.map((k,ki)=>(
            <div key={ki} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid #12122a"}}>
              <span style={{flex:1,fontSize:12,color:"#ccc"}}>{k.nazwa}</span>
              <select value={k.typ} onChange={e=>zmienTyp(k.nazwa,e.target.value)} style={{padding:"3px 6px",background:"#12122a",border:"1px solid #333",borderRadius:4,color:k.typ==="złota"?"#ffd700":"#87CEEB",fontSize:11,cursor:"pointer"}}>
                <option value="złota">⭐ Złota</option>
                <option value="diamentowa">💎 Diamentowa</option>
              </select>
              <button onClick={()=>usunKarte(k.nazwa)} style={{padding:"2px 8px",background:"rgba(255,50,50,0.1)",border:"none",borderRadius:4,color:"#f5544488",cursor:"pointer",fontSize:11}}>✕</button>
            </div>
          ))}
          <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
            <input value={nowaKarta.nazwa} onChange={e=>setNowaKarta(k=>({...k,nazwa:e.target.value}))} placeholder="Nazwa karty"
              onKeyDown={e=>e.key==="Enter"&&dodajKarte()}
              style={{flex:1,minWidth:120,padding:"7px 10px",background:"#12122a",border:"1px solid #333",borderRadius:6,color:"#fff",fontSize:12}}/>
            <select value={nowaKarta.typ} onChange={e=>setNowaKarta(k=>({...k,typ:e.target.value}))} style={{padding:"7px 8px",background:"#12122a",border:"1px solid #333",borderRadius:6,color:nowaKarta.typ==="złota"?"#ffd700":"#87CEEB",fontSize:12,cursor:"pointer"}}>
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

  return (
    <div>
      <div style={{fontSize:14,fontWeight:"bold",color:"#ffd700",marginBottom:12}}>👥 Członkowie ({czlonkowie.length})</div>
      {czlonkowie.map((c,i)=>(
        <div key={c.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 0",borderBottom:"1px solid #12122a"}}>
          <span style={{fontSize:12,color:"#555",width:22}}>{i+1}.</span>
          {edytujId===c.id?(
            <>
              <input value={tempNazwa} onChange={e=>setTempNazwa(e.target.value)} onKeyDown={e=>e.key==="Enter"&&zapiszN(c.id)}
                style={{flex:1,padding:"5px 8px",background:"#12122a",border:"1px solid #ffd700",borderRadius:5,color:"#fff",fontSize:13}}/>
              <button onClick={()=>zapiszN(c.id)} style={{padding:"5px 10px",background:"#ffd700",border:"none",borderRadius:5,cursor:"pointer",fontSize:12,color:"#000",fontWeight:"bold"}}>OK</button>
            </>
          ):(
            <>
              <span style={{flex:1,fontSize:13,color:"#ddd"}}>{c.nazwa}</span>
              <button onClick={()=>{setEdytujId(c.id);setTempNazwa(c.nazwa);}} style={{padding:"3px 8px",background:"rgba(255,215,0,0.08)",border:"1px solid #b8860b33",borderRadius:5,color:"#b8860b",cursor:"pointer",fontSize:11}}>✏️</button>
              <button onClick={()=>usun(c.id)} style={{padding:"3px 8px",background:"rgba(255,50,50,0.08)",border:"1px solid #f5544433",borderRadius:5,color:"#f5544488",cursor:"pointer",fontSize:11}}>🗑</button>
            </>
          )}
        </div>
      ))}
      <div style={{display:"flex",gap:8,marginTop:14}}>
        <input value={nowyNick} onChange={e=>setNowyNick(e.target.value)} placeholder="Nick nowego członka"
          onKeyDown={e=>e.key==="Enter"&&dodaj()}
          style={{flex:1,padding:"8px 10px",background:"#12122a",border:"1px solid #333",borderRadius:6,color:"#fff",fontSize:13}}/>
        <button onClick={dodaj} style={{padding:"8px 16px",background:"rgba(0,200,100,0.12)",border:"1px solid #0c655",borderRadius:6,color:"#0c6",cursor:"pointer",fontWeight:"bold",fontSize:13}}>+ Dodaj</button>
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
        <div style={{fontSize:14,fontWeight:"bold",color:"#ffd700",marginBottom:2}}>🔄 Wszystkie duplikaty w gangu</div>
        <div style={{fontSize:11,color:"#aaa"}}>Karty które ktoś posiada w nadmiarze i może wysłać innym</div>
      </div>

      {/* Filtry */}
      <div style={{background:"rgba(0,0,0,0.25)",border:"1px solid #2a2a3a",borderRadius:10,padding:12,marginBottom:12}}>
        <textarea
          value={szukaj} onChange={e=>setSzukaj(e.target.value)}
          placeholder={"🔍 Wpisz nazwy kart — każda w osobnej linii:\n\nWystępy mimów\nAkrobatyczne popisy\nSztuka kredowa"}
          rows={4}
          style={{width:"100%",padding:"8px 12px",background:"#12122a",border:"1px solid #333",borderRadius:6,color:"#fff",fontSize:12,marginBottom:10,boxSizing:"border-box",resize:"vertical",fontFamily:"inherit",lineHeight:1.5}}
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
              background:filtrTyp===f.id?"rgba(255,215,0,0.15)":"rgba(255,255,255,0.05)",
              border:filtrTyp===f.id?"1px solid #ffd700":"1px solid #2a2a3a",
              color:filtrTyp===f.id?"#ffd700":"#888",
            }}>{f.label}</button>
          ))}
          <select value={filtrTalia} onChange={e=>setFiltrTalia(e.target.value)} style={{
            padding:"4px 10px",borderRadius:20,fontSize:11,cursor:"pointer",
            background:"rgba(255,255,255,0.05)",border:"1px solid #2a2a3a",color:"#888",
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
          <div style={{fontSize:18,fontWeight:"bold",color:"#ffd700"}}>{filtered.length}</div>
          <div style={{fontSize:10,color:"#888"}}>różnych kart</div>
        </div>
        <div style={{background:"rgba(0,200,100,0.08)",border:"1px solid #0c644",borderRadius:8,padding:"8px 14px",flex:1,minWidth:100}}>
          <div style={{fontSize:18,fontWeight:"bold",color:"#0c6"}}>{lacznie}</div>
          <div style={{fontSize:10,color:"#888"}}>duplikatów łącznie</div>
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
          <div key={i} style={{background:"rgba(0,0,0,0.25)",border:"1px solid #2a2a3a",borderRadius:8,padding:"10px 12px",marginBottom:6}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
              <span style={{fontSize:10,color:d.kartaTyp==="złota"?"#ffd700":"#87CEEB"}}>
                {d.kartaTyp==="złota"?"⭐":"💎"}
              </span>
              <span style={{flex:1,fontSize:13,fontWeight:"bold",color:"#ddd"}}>{d.kartaNazwa}</span>
              <span style={{fontSize:11,color:"#888"}}>#{d.taliaNum} {d.taliaNazwa}</span>
              <span style={{
                fontSize:12,fontWeight:"bold",padding:"2px 10px",borderRadius:12,
                background:"rgba(0,200,100,0.15)",border:"1px solid #0c644",color:"#0c6",
              }}>×{d.lacznie}</span>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {d.posiadacze.map((p,j)=>(
                <span key={j} style={{
                  fontSize:11,padding:"3px 10px",borderRadius:14,
                  background:"rgba(255,255,255,0.05)",border:"1px solid #2a2a3a",color:"#bbb",
                }}>
                  {p.nick}
                  {p.ile>1&&<span style={{marginLeft:4,color:"#ffd700",fontWeight:"bold"}}>×{p.ile}</span>}
                </span>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function AktywnaWymiana({aktywnaWymiana,zalogowany,czlonkowie,talie,posiadane,duplikaty,typWymiany,isAdmin,zapiszAktywna}) {
  const [zamykanie,setZamykanie]=useState(false);
  const [podmienIdx,setPodmienIdx]=useState(null); // indeks wymiany do podmiany

  if(!aktywnaWymiana) return (
    <div style={{textAlign:"center",padding:50,color:"#555"}}>
      <div style={{fontSize:40,marginBottom:10}}>📭</div>
      <div style={{fontSize:14,color:"#666"}}>Brak aktywnej wymiany</div>
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
    await zapiszAktywna({...aktywnaWymiana,potwierdzone:{...potwierdzone,[mojNick]:true}});
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
    const oppTyp=typAkt==="złote"?"diamentowa":"złota";
    // Kto już wysyła (nie licząc podmieniany wymiany)
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
          // Nie proponuj tej samej wymiany co jest już w planie
          const juzJest=wymiany.some((w,i)=>i!==wykluczonaWymiana._idx&&w.od===dawcaNazwa&&w.do===odbiorca.nazwa&&w.karta===karta.nazwa);
          if(juzJest) return;
          const faza=obliczFaze(brakT.length,brakO.length);
          const zamknieTalie=brakT.length===1&&brakO.length===0;
          kandydaci.push({od:dawcaNazwa,do:odbiorca.nazwa,karta:karta.nazwa,talia:talia.nazwa,nagroda:talia.nagroda_amunicja||0,faza,brakTCount:brakT.length,brakOCount:brakO.length,trudna:TRUDNE_NUMERY.includes(talia.numer),zamknieTalie});
        });
      });
    });
    return kandydaci.sort((a,b)=>{
      // Najpierw te które zamkną talię
      if(b.zamknieTalie!==a.zamknieTalie) return (b.zamknieTalie?1:0)-(a.zamknieTalie?1:0);
      if(a.faza!==b.faza) return a.faza-b.faza;
      if(b.nagroda!==a.nagroda) return b.nagroda-a.nagroda;
      return a.brakTCount-b.brakTCount;
    }).slice(0,6);
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
      {/* Nagłówek */}
      <div style={{background:"linear-gradient(135deg,rgba(0,200,100,0.1),rgba(0,100,50,0.1))",border:"1px solid #0c6",borderRadius:10,padding:14,marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
          <div>
            <div style={{fontSize:15,fontWeight:"bold",color:"#0c6"}}>📤 Aktywna wymiana</div>
            <div style={{fontSize:11,color:"#888",marginTop:2}}>
              {typAkt==="złote"?"⭐ Złote":"💎 Diamentowe"} • {new Date(data).toLocaleString("pl-PL")} • {wymiany.length} wymian
            </div>
          </div>
          {isAdmin&&(
            <button onClick={zamknijWymiane} disabled={zamykanie} style={{padding:"5px 12px",background:"rgba(255,50,50,0.15)",border:"1px solid #f5544488",borderRadius:6,color:"#f55",cursor:"pointer",fontSize:11}}>
              {zamykanie?"⏳":"🗑"} Zamknij wymianę
            </button>
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

      {/* Moja wymiana */}
      {mojePozycje?(
        <div style={{background:czyPotwierdzilem?"rgba(0,200,100,0.1)":"rgba(255,215,0,0.1)",border:`2px solid ${czyPotwierdzilem?"#0c6":"#ffd700"}`,borderRadius:10,padding:14,marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:"bold",color:czyPotwierdzilem?"#0c6":"#ffd700",marginBottom:8}}>
            {czyPotwierdzilem?"✅ Twoja wymiana — POTWIERDZONA":"👋 Twoja wymiana — wyślij kartę!"}
          </div>
          {mojePozycje.map((w,i)=>(
            <div key={i} style={{fontSize:13,color:"#ddd",padding:"5px 0",borderBottom:"1px solid #12122a"}}>
              Wyślij <strong style={{color:"#ffd700"}}>{w.karta}</strong> do <strong style={{color:"#0c6"}}>{w.do}</strong>
              <span style={{fontSize:11,color:"#666",marginLeft:6}}>[{w.talia}]</span>
            </div>
          ))}
          <div style={{marginTop:12}}>
            {!czyPotwierdzilem?(
              <button onClick={potwierdz} style={{width:"100%",padding:12,background:"linear-gradient(135deg,#0c6,#0fa)",border:"none",borderRadius:8,color:"#000",fontSize:14,fontWeight:"bold",cursor:"pointer"}}>
                ✅ Potwierdzam — wysłałem kartę!
              </button>
            ):(
              <button onClick={cofnijPotwierdzenie} style={{width:"100%",padding:8,background:"rgba(255,255,255,0.05)",border:"1px solid #333",borderRadius:8,color:"#666",fontSize:12,cursor:"pointer"}}>
                ↩️ Cofnij potwierdzenie
              </button>
            )}
          </div>
        </div>
      ):(
        <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid #2a2a3a",borderRadius:8,padding:12,marginBottom:14,textAlign:"center"}}>
          <div style={{fontSize:12,color:"#666"}}>Nie masz żadnej wymiany do wykonania w tej rundzie</div>
          <div style={{fontSize:10,color:"#444",marginTop:4}}>Szukam po nicku: <span style={{color:"#888"}}>{mojNick}</span></div>
          <div style={{fontSize:9,color:"#333",marginTop:2}}>Nadawcy w planie: {Object.keys(poNadawcach).join(", ")}</div>
        </div>
      )}

      {/* Status wszystkich — z podmianą dla admina */}
      <div style={{background:"rgba(0,0,0,0.25)",border:"1px solid #2a2a3a",borderRadius:10,padding:14}}>
        <div style={{fontSize:13,fontWeight:"bold",color:"#ffd700",marginBottom:10}}>
          📋 Status wszystkich wysyłek
          {isAdmin&&<span style={{fontSize:10,color:"#888",fontWeight:"normal",marginLeft:8}}>— ✅/⏳ kliknij żeby zaznaczyć • 🔄 podmień jeśli karta wpadła z paczki</span>}
        </div>

        {Object.entries(poNadawcach).sort(([a],[b])=>(potwierdzone[b]?1:0)-(potwierdzone[a]?1:0)).map(([nadawca,ws])=>{
          const potw=potwierdzone[nadawca];
          return (
            <div key={nadawca} style={{background:potw?"rgba(0,200,100,0.06)":"rgba(255,255,255,0.02)",borderLeft:`3px solid ${potw?"#0c6":"#333"}`,borderRadius:6,marginBottom:6,overflow:"hidden"}}>
              {/* Nagłówek nadawcy */}
              <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px"}}>
                {isAdmin?(
                  <button onClick={()=>zapiszAktywna({...aktywnaWymiana,potwierdzone:{...potwierdzone,[nadawca]:!potw}})}
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
                      <span style={{fontSize:11,color:"#888"}}>→</span>
                      <span style={{fontSize:12,color:"#ddd",flex:1}}>
                        <strong style={{color:"#ffd700"}}>{w.karta}</strong>
                        <span style={{color:"#888",fontSize:11}}> do </span>
                        <strong>{w.do}</strong>
                        <span style={{fontSize:10,color:"#555",marginLeft:6}}>[{w.talia}]</span>
                      </span>
                      {isAdmin&&(
                        <div style={{display:"flex",gap:4}}>
                          <button onClick={()=>setPodmienIdx(pokazPodmien?null:w._idx)} style={{
                            padding:"2px 8px",fontSize:10,borderRadius:4,cursor:"pointer",
                            background:pokazPodmien?"rgba(255,215,0,0.2)":"rgba(255,165,0,0.08)",
                            border:`1px solid ${pokazPodmien?"#ffd700":"#fa055"}`,
                            color:pokazPodmien?"#ffd700":"#fa0",
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
                            background:alt.zamknieTalie?"rgba(0,200,100,0.05)":"transparent",
                          }}>
                            {alt.zamknieTalie&&(
                              <span style={{fontSize:10,padding:"2px 8px",borderRadius:8,background:"rgba(0,200,100,0.2)",border:"1px solid #0c6",color:"#0c6",fontWeight:"bold",width:"100%",marginBottom:2}}>
                                🏆 ZAMKNIE TALIĘ — +{alt.nagroda?.toLocaleString()} amunicji dla gangu!
                              </span>
                            )}
                            <span style={{fontSize:10,padding:"1px 6px",borderRadius:8,background:"rgba(255,255,255,0.05)",color:["#f55","#ff7a00","#fa0","#d4b800","#6af"][Math.min(alt.faza-1,4)]||"#aaa"}}>F{alt.faza}</span>
                            <span style={{fontSize:11,flex:1,color:"#ddd"}}>
                              <strong style={{color:"#ffd700"}}>{alt.karta}</strong>
                              <span style={{color:"#888"}}> → {alt.do}</span>
                              <span style={{fontSize:10,color:"#555",marginLeft:4}}>[{alt.talia}]</span>
                            </span>
                            {!alt.zamknieTalie&&<span style={{fontSize:10,color:"#fa0"}}>🎯{alt.nagroda?.toLocaleString()}</span>}
                            <button onClick={()=>podmienWymiane(w._idx,alt)} style={{
                              padding:"3px 10px",fontSize:11,fontWeight:"bold",borderRadius:4,cursor:"pointer",
                              background:alt.zamknieTalie?"rgba(0,200,100,0.25)":"rgba(0,200,100,0.15)",
                              border:`1px solid ${alt.zamknieTalie?"#0c6":"#0c644"}`,color:"#0c6",
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
