// Web Worker — liczy wymiany poza głównym wątkiem, żeby ekran nie zamarzał.
// Wersję w adresie zmieniaj razem z algorytmy.js, żeby przeglądarka nie trzymała starej kopii.
importScripts("/algorytmy.js?v=20261020");

self.onmessage = function (e) {
  const { id, wersja, parametry } = e.data || {};
  try {
    let wynik;
    if (wersja === "v3") {
      const v1 = generujAlgorytm(parametry);
      const v3 = generujAlgorytmV3(parametry);
      wynik = Object.assign({}, v3, { v1: v1 });
    } else {
      wynik = generujAlgorytm(parametry);
    }
    self.postMessage({ id: id, ok: true, wynik: wynik });
  } catch (err) {
    self.postMessage({ id: id, ok: false, error: String((err && err.message) || err) });
  }
};
