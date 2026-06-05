import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, onSnapshot, getDoc, updateDoc, deleteField, arrayUnion, collection, getDocs, query, orderBy, limit as firestoreLimit, deleteDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBFkrpSF7BX4VNbbNRPYg5I30T0OZmODbs",
  authDomain: "gang-wymiana.firebaseapp.com",
  projectId: "gang-wymiana",
  storageBucket: "gang-wymiana.firebasestorage.app",
  messagingSenderId: "563645431220",
  appId: "1:563645431220:web:f5a98aff554858737dc6e1"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

const GANG_DOC = doc(db, "gang", "main");
const ONLINE_DOC = doc(db, "gang", "online");
const KALENDARZ_DOC = doc(db, "gang", "kalendarz"); // osobny dokument dla kalendarza

// === KALENDARZ ===
export async function zapiszKalendarz(eventy) {
  try {
    await setDoc(KALENDARZ_DOC, { eventy: JSON.stringify(eventy) });
    return true;
  } catch (e) {
    console.error("Błąd zapisu kalendarza:", e);
    return false;
  }
}

export function subscribeKalendarz(callback) {
  return onSnapshot(KALENDARZ_DOC, (snap) => {
    if (snap.exists()) {
      try {
        const eventy = JSON.parse(snap.data().eventy || "{}");
        callback(eventy);
      } catch { callback({}); }
    } else {
      callback({});
    }
  }, (err) => console.error("Błąd subskrypcji kalendarza:", err));
}

export async function loadGangData() {
  try {
    const snap = await getDoc(GANG_DOC);
    if (snap.exists()) return snap.data();
    return null; // dokument naprawdę nie istnieje
  } catch (e) {
    console.error("Błąd ładowania:", e);
    // WAŻNE: rzuć błąd dalej — nie zwracaj null bo apka pomyśli że bazy nie ma
    // i nadpisze dane domyślnymi!
    throw e;
  }
}

// Zapisuje cały obiekt (do inicjalizacji)
export async function saveGangData(data) {
  try {
    await setDoc(GANG_DOC, data, { merge: true });
    return true;
  } catch (e) {
    console.error("Błąd zapisu:", e);
    return false;
  }
}

// === SYSTEM PIN ===
const PINY_DOC = doc(db, "gang_data", "piny");

// Hash PIN przez Web Crypto (SHA-256)
export async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode("FAMILY_GANG_" + pin); // salt
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// Zapisz PIN dla nicka
export async function zapiszPin(nick, pin) {
  try {
    const hash = await hashPin(pin);
    await setDoc(PINY_DOC, { [nick]: hash }, { merge: true });
    return true;
  } catch(e) { console.error(e); return false; }
}

// Sprawdź PIN
export async function sprawdzPin(nick, pin) {
  try {
    const snap = await getDoc(PINY_DOC);
    if (!snap.exists()) return false;
    const hash = await hashPin(pin);
    return snap.data()[nick] === hash;
  } catch(e) { return false; }
}

// Sprawdź czy nick ma PIN
export async function maPin(nick) {
  try {
    const snap = await getDoc(PINY_DOC);
    if (!snap.exists()) return false;
    return !!snap.data()[nick];
  } catch(e) { return false; }
}

// Resetuj PIN (admin) - null = brak PINu
export async function resetujPin(nick) {
  try {
    await updateDoc(PINY_DOC, { [nick]: deleteField() });
    return true;
  } catch(e) { console.error(e); return false; }
}

// Pobierz listę nicków z PINem
export async function pobierzStatusyPinow() {
  try {
    const snap = await getDoc(PINY_DOC);
    if (!snap.exists()) return {};
    const data = snap.data();
    // Zwróć tylko info czy mają PIN (nie hashe!)
    return Object.fromEntries(Object.keys(data).map(k => [k, true]));
  } catch(e) { return {}; }
}

// === AUTO-BACKUP ===
const BACKUP_COL = "gang_backupy";
const MAX_BACKUPOW = 10; // trzymamy max 10 snapshotów

// Sprawdź czy dane wyglądają jak domyślne (guard przed nadpisaniem)
function czyDomyslneDane(data) {
  if (!data?.czlonkowie) return false;
  const domyslne = data.czlonkowie.filter(c =>
    c.nazwa && c.nazwa.match(/^Osoba \d+$/)
  );
  // Jeśli ponad połowa członków ma domyślne nazwy = podejrzane
  return domyslne.length > (data.czlonkowie.length / 2);
}

// Zapisz snapshot do kolekcji backupów
export async function zapiszAutoBackup(powod = "auto") {
  try {
    const snap = await getDoc(GANG_DOC);
    if (!snap.exists()) return;
    const dane = snap.data();

    // Nie backupuj domyślnych danych
    if (czyDomyslneDane(dane)) return;

    const timestamp = Date.now();
    const backupDoc = doc(db, BACKUP_COL, String(timestamp));
    await setDoc(backupDoc, {
      timestamp,
      powod,
      data: new Date(timestamp).toLocaleString("pl-PL"),
      main: dane,
    });

    // Usuń stare backupy powyżej limitu
    const q = query(collection(db, BACKUP_COL), orderBy("timestamp", "desc"), firestoreLimit(100));
    const wszystkie = await getDocs(q);
    const docs = wszystkie.docs;
    if (docs.length > MAX_BACKUPOW) {
      const doUsuniecia = docs.slice(MAX_BACKUPOW);
      await Promise.all(doUsuniecia.map(d => deleteDoc(d.ref)));
    }
  } catch (e) {
    console.error("Błąd auto-backupu:", e);
  }
}

// Pobierz listę backupów
export async function pobierzListeBackupow() {
  try {
    const q = query(collection(db, BACKUP_COL), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error("Błąd pobierania backupów:", e);
    return [];
  }
}

// Przywróć konkretny backup
export async function przywrocAutoBackup(backupId) {
  try {
    const backupDoc = doc(db, BACKUP_COL, backupId);
    const snap = await getDoc(backupDoc);
    if (!snap.exists()) throw new Error("Backup nie istnieje");
    const { main } = snap.data();
    if (main) {
      await setDoc(GANG_DOC, main, { merge: false });
    }
    return true;
  } catch (e) {
    console.error("Błąd przywracania:", e);
    throw e;
  }
}

// === ZAZNACZ / ODZNACZ KARTĘ ===
// Zaznacz lub odznacz pojedynczą kartę (atomowa operacja — nie nadpisuje innych zmian)
export async function setCardField(typ, key, value) {
  try {
    const fieldPath = `${typ}.${key}`;
    if (value === null) {
      await updateDoc(GANG_DOC, { [fieldPath]: deleteField() });
    } else {
      await updateDoc(GANG_DOC, { [fieldPath]: value });
    }
    return true;
  } catch (e) {
    console.error("Błąd ustawienia karty:", e);
    return false;
  }
}

// Zapis strukturalny (talie, członkowie) — całe pole naraz
export async function setStructure(pole, wartosc) {
  try {
    // GUARD: jeśli zapisujemy czlonkowie z domyślnymi nazwami, sprawdź czy nie nadpisujemy prawdziwych
    if (pole === "czlonkowie" && wartosc) {
      const domyslne = wartosc.filter(c => c.nazwa?.match(/^Osoba \d+$/));
      if (domyslne.length > wartosc.length / 2) {
        // Sprawdź co jest w bazie
        const snap = await getDoc(GANG_DOC);
        if (snap.exists()) {
          const obecne = snap.data().czlonkowie || [];
          const obecnePrawdziwe = obecne.filter(c => !c.nazwa?.match(/^Osoba \d+$/));
          if (obecnePrawdziwe.length > 3) {
            console.error("GUARD: Blokada zapisu domyślnych danych — w bazie są prawdziwe dane!");
            return false;
          }
        }
      }
    }
    await setDoc(GANG_DOC, { [pole]: wartosc }, { merge: true });
    return true;
  } catch (e) {
    console.error("Błąd zapisu struktury:", e);
    return false;
  }
}

export function subscribeGangData(callback) {
  return onSnapshot(GANG_DOC, (snap) => {
    if (snap.exists()) callback(snap.data());
  }, (err) => console.error("Błąd subskrypcji:", err));
}

// === OBECNOŚĆ ONLINE ===
// Zapisuje że użytkownik jest online (timestamp ostatniej aktywności)
export async function setOnline(login) {
  if (!login) return;
  try {
    await setDoc(ONLINE_DOC, {
      [login]: Date.now()
    }, { merge: true });
  } catch (e) {
    console.error("Błąd obecności:", e);
  }
}

// Usuwa użytkownika z listy online
export async function setOffline(login) {
  if (!login) return;
  try {
    await updateDoc(ONLINE_DOC, { [login]: deleteField() });
  } catch (e) {
    console.error("Błąd offline:", e);
  }
}

// Subskrybuje listę online — callback dostaje obiekt {login: timestamp}
export function subscribeOnline(callback) {
  return onSnapshot(ONLINE_DOC, (snap) => {
    callback(snap.exists() ? snap.data() : {});
  }, (err) => console.error("Błąd subskrypcji online:", err));
}

// === LOGI LOGOWAŃ ===
const LOGI_DOC = doc(db, "gang", "logi");

export async function zapiszLog(wpis) {
  try {
    const snap = await getDoc(LOGI_DOC);
    const stare = snap.exists() ? (snap.data().logi || []) : [];
    // Max 200 wpisów
    const nowe = [wpis, ...stare].slice(0, 200);
    await setDoc(LOGI_DOC, { logi: nowe });
    return true;
  } catch(e) { console.error("Błąd zapisu logu:", e); return false; }
}

export function subscribeLogi(callback) {
  return onSnapshot(LOGI_DOC, (snap) => {
    if (snap.exists()) callback(snap.data().logi || []);
    else callback([]);
  });
}

// Fingerprint urządzenia — unikalny identyfikator bez IP
export function getFingerprint() {
  const parts = [
    navigator.userAgent,
    navigator.language,
    window.screen.width + "x" + window.screen.height,
    window.screen.colorDepth,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 0,
    navigator.platform || "",
  ];
  // Prosty hash
  let hash = 0;
  const str = parts.join("|");
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

// Pobierz znane fingerprinty dla każdego nicka
export async function pobierzFingerprinty() {
  try {
    const snap = await getDoc(LOGI_DOC);
    return snap.exists() ? (snap.data().fingerprinty || {}) : {};
  } catch { return {}; }
}

export async function zapiszFingerprint(nick, fp) {
  try {
    // Atomowy zapis - nie nadpisuje innych nicków
    await setDoc(LOGI_DOC, {
      fingerprinty: { [nick]: arrayUnion(fp) }
    }, { merge: true });
  } catch(e) { console.error(e); }
}

// Czarna lista urządzeń - zablokowane fingerprinty
export async function zablokujUrządzenie(fp, nick, powod="") {
  try {
    await setDoc(LOGI_DOC, {
      zablokowane: arrayUnion({ fp, nick, czas: Date.now(), powod })
    }, { merge: true });
    return true;
  } catch(e) { console.error(e); return false; }
}

export async function odblokujUrządzenie(fp) {
  try {
    const snap = await getDoc(LOGI_DOC);
    const zablokowane = snap.exists() ? (snap.data().zablokowane || []) : [];
    const nowe = zablokowane.filter(z => z.fp !== fp);
    await setDoc(LOGI_DOC, { zablokowane: nowe }, { merge: true });
    return true;
  } catch(e) { console.error(e); return false; }
}

export async function pobierzZablokowane() {
  try {
    const snap = await getDoc(LOGI_DOC);
    return snap.exists() ? (snap.data().zablokowane || []) : [];
  } catch { return []; }
}

export function subscribeZablokowane(callback) {
  return onSnapshot(LOGI_DOC, (snap) => {
    callback(snap.exists() ? (snap.data().zablokowane || []) : []);
  });
}

// === ARCHIWUM WALK (poprzednie sezony) ===
export async function zapiszArchiwumWalk(sezon) {
  try {
    await setDoc(GANG_DOC, {
      archiwumWalk: arrayUnion(sezon)
    }, { merge: true });
    return true;
  } catch(e) { console.error("Błąd zapisu archiwum:", e); return false; }
}

export function subscribeArchiwumWalk(callback) {
  return onSnapshot(GANG_DOC, (snap) => {
    callback(snap.exists() ? (snap.data().archiwumWalk || []) : []);
  });
}

// === HISTORIA WYMIAN ===
const HISTORIA_DOC = doc(db, "gang", "historia");

export async function zapiszHistorieWymian(historia) {
  try {
    await setDoc(HISTORIA_DOC, { historia: JSON.stringify(historia) });
    return true;
  } catch(e) { console.error("Błąd zapisu historii:", e); return false; }
}

export async function pobierzHistorieWymian() {
  try {
    const snap = await getDoc(HISTORIA_DOC);
    if (!snap.exists()) return [];
    return JSON.parse(snap.data().historia || "[]");
  } catch { return []; }
}

export function subscribeHistoria(callback) {
  return onSnapshot(HISTORIA_DOC, (snap) => {
    if (snap.exists()) {
      try { callback(JSON.parse(snap.data().historia || "[]")); }
      catch { callback([]); }
    } else { callback([]); }
  });
}

// Oblicz ile razy każda osoba dostała kartę w historii
export function obliczLicznikOtrzymanych(historia) {
  const licznik = {}; // {nazwa: count}
  historia.forEach(wymiana => {
    (wymiana.wymiany || []).forEach(w => {
      if (w.do) licznik[w.do] = (licznik[w.do] || 0) + 1;
    });
  });
  return licznik;
}

// === CHAT ===
const CHAT_DOC = doc(db, "gang_data", "chat");

export async function zapiszWiadomosc(wiadomosc) {
  try {
    const snap = await getDoc(CHAT_DOC);
    const stare = snap.exists() ? (snap.data().wiadomosci || []) : [];
    const nowe = [...stare, wiadomosc].slice(-100);
    await setDoc(CHAT_DOC, { wiadomosci: nowe }, { merge: true });
    return true;
  } catch(e) { console.error(e); return false; }
}

export function subscribeChat(callback) {
  return onSnapshot(CHAT_DOC, (snap) => {
    callback(snap.exists() ? (snap.data().wiadomosci || []) : []);
  });
}

// === PEŁNY BACKUP ===
export async function pobierzPelnyBackup() {
  const wyniki = {};
  try {
    // Główne dane gangu
    const main = await getDoc(GANG_DOC);
    if (main.exists()) wyniki.main = main.data();

    // Historia wymian
    const historia = await getDoc(HISTORIA_DOC);
    if (historia.exists()) wyniki.historia = historia.data();

    // Kalendarz
    const kalendarz = await getDoc(KALENDARZ_DOC);
    if (kalendarz.exists()) wyniki.kalendarz = kalendarz.data();

    // Taktyka
    const taktykaDoc = doc(db, "gang_data", "taktyka");
    const taktyka = await getDoc(taktykaDoc);
    if (taktyka.exists()) wyniki.taktyka = taktyka.data();

    // Chat (ostatnie 100 wiadomości)
    const chatDoc = doc(db, "gang_data", "chat");
    const chat = await getDoc(chatDoc);
    if (chat.exists()) wyniki.chat = chat.data();

    return wyniki;
  } catch(e) {
    console.error("Błąd pobierania backupu:", e);
    throw e;
  }
}

export async function przywrocPelnyBackup(backup, zapiszStruktureFn) {
  if (backup.main) {
    const d = backup.main;
    if (d.talie) await zapiszStruktureFn("talie", d.talie);
    if (d.czlonkowie) await zapiszStruktureFn("czlonkowie", d.czlonkowie);
    if (d.posiadane) await zapiszStruktureFn("posiadane", d.posiadane);
    if (d.duplikaty) await zapiszStruktureFn("duplikaty", d.duplikaty);
    if (d.walki) await zapiszStruktureFn("walki", d.walki);
  }
  if (backup.historia) {
    await setDoc(HISTORIA_DOC, backup.historia, { merge: false });
  }
  if (backup.kalendarz) {
    await setDoc(KALENDARZ_DOC, backup.kalendarz, { merge: false });
  }
  if (backup.taktyka) {
    const taktykaDoc = doc(db, "gang_data", "taktyka");
    await setDoc(taktykaDoc, backup.taktyka, { merge: false });
  }
}

// === TAKTYKA ===
const TAKTYKA_DOC = doc(db, "gang_data", "taktyka");

export function subscribeTaktyka(callback) {
  return onSnapshot(TAKTYKA_DOC, (snap) => {
    callback(snap.exists() ? snap.data() : { notatki: "", sojusznicy: [], wrogowie: [], plany: [] });
  });
}

export async function zapiszTaktyke(dane) {
  try {
    await setDoc(TAKTYKA_DOC, dane, { merge: true });
    return true;
  } catch(e) { console.error(e); return false; }
}
