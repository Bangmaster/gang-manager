/* Vercel API endpoint — wysyła push notyfikację do wszystkich tokenów FCM */
const admin = require("firebase-admin");

// Inicjalizuj Firebase Admin (tylko raz)
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  // Tylko POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { title, body, adminKey } = req.body || {};

  // Prosty klucz admina — ustaw w Vercel env jako ADMIN_NOTIF_KEY
  const ADMIN_KEY = process.env.ADMIN_NOTIF_KEY || "family_admin_2024";
  if (adminKey !== ADMIN_KEY) {
    return res.status(401).json({ error: "Brak autoryzacji" });
  }

  if (!title || !body) {
    return res.status(400).json({ error: "Brak tytułu lub treści" });
  }

  try {
    // Pobierz wszystkie tokeny FCM z Firestore
    const tokensSnap = await db.collection("fcm_tokens").get();
    const tokens = [];
    tokensSnap.forEach((doc) => {
      const token = doc.data().token;
      if (token) tokens.push(token);
    });

    if (tokens.length === 0) {
      return res.status(200).json({ success: true, sent: 0, message: "Brak tokenów" });
    }

    // Wyślij do wszystkich (max 500 na raz - limit FCM)
    const chunks = [];
    for (let i = 0; i < tokens.length; i += 500) {
      chunks.push(tokens.slice(i, i + 500));
    }

    let totalSent = 0;
    let totalFailed = 0;

    for (const chunk of chunks) {
      const message = {
        notification: { title, body },
        tokens: chunk,
        webpush: {
          notification: {
            title,
            body,
            icon: "/logo192.png",
            badge: "/logo192.png",
            vibrate: [200, 100, 200],
          },
          fcm_options: { link: "/" },
        },
      };

      const response = await admin.messaging().sendEachForMulticast(message);
      totalSent += response.successCount;
      totalFailed += response.failureCount;

      // Usuń nieważne tokeny
      const invalidTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const code = resp.error?.code;
          if (code === "messaging/invalid-registration-token" ||
              code === "messaging/registration-token-not-registered") {
            invalidTokens.push(chunk[idx]);
          }
        }
      });

      // Usuń z Firestore
      for (const invalidToken of invalidTokens) {
        const q = await db.collection("fcm_tokens")
          .where("token", "==", invalidToken).get();
        q.forEach((doc) => doc.ref.delete());
      }
    }

    // Zapisz historię powiadomień w Firestore
    await db.collection("powiadomienia").add({
      title,
      body,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      sent: totalSent,
      failed: totalFailed,
    });

    return res.status(200).json({ success: true, sent: totalSent, failed: totalFailed });
  } catch (error) {
    console.error("Błąd wysyłania notyfikacji:", error);
    return res.status(500).json({ error: error.message });
  }
}
