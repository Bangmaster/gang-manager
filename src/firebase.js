import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, onSnapshot, getDoc, updateDoc, deleteField } from "firebase/firestore";

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
    return null;
  } catch (e) {
    console.error("Błąd ładowania:", e);
    return null;
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
