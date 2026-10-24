// Vercel Serverless Function — logowanie admina / zastępcy
// Hasła są TYLKO w zmiennych środowiskowych Vercel, nie w kodzie aplikacji.
//
// Wymagane zmienne środowiskowe (Vercel → Settings → Environment Variables):
//   ADMIN_PASSWORD       — hasło konta "admin"
//   ZASTEPCA_PASSWORD    — hasło konta "zastepca" (opcjonalne; domyślnie takie samo jak ADMIN_PASSWORD)
//   ADMIN_NOTIF_KEY      — klucz do wysyłania powiadomień push (ten sam, którego używa api/send-notification.js)

import crypto from "crypto";

function rowne(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { login, haslo } = body || {};

  const adminPass = process.env.ADMIN_PASSWORD;
  const zastepcaPass = process.env.ZASTEPCA_PASSWORD || adminPass;
  const notifKey = process.env.ADMIN_NOTIF_KEY;

  if (!adminPass || !notifKey) {
    return res.status(500).json({ ok: false, error: "Serwer nie jest skonfigurowany (brak ADMIN_PASSWORD lub ADMIN_NOTIF_KEY w Vercel)." });
  }

  const konta = { admin: adminPass, zastepca: zastepcaPass };
  const oczekiwane = Object.prototype.hasOwnProperty.call(konta, login) ? konta[login] : null;
  const ok = oczekiwane !== null && typeof haslo === "string" && rowne(haslo, oczekiwane);

  if (!ok) {
    // spowolnienie zgadywania hasła
    await new Promise(r => setTimeout(r, 800));
    return res.status(401).json({ ok: false, error: "Błędne hasło admina." });
  }
  return res.status(200).json({ ok: true, login, rola: login, adminKey: notifKey });
}
