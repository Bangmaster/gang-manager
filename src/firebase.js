import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, onSnapshot, getDoc } from "firebase/firestore";

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

// Główny dokument z danymi gangu
const GANG_DOC = doc(db, "gang", "main");

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

export async function saveGangData(data) {
  try {
    await setDoc(GANG_DOC, data, { merge: true });
    return true;
  } catch (e) {
    console.error("Błąd zapisu:", e);
    return false;
  }
}

export function subscribeGangData(callback) {
  return onSnapshot(GANG_DOC, (snap) => {
    if (snap.exists()) callback(snap.data());
  }, (err) => console.error("Błąd subskrypcji:", err));
}
