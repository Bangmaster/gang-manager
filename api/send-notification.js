const admin = require("firebase-admin");

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch(e) {
    console.error("Firebase Admin init error:", e.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { title, body, adminKey } = req.body || {};
  const ADMIN_KEY = process.env.ADMIN_NOTIF_KEY || "family_admin_2024";

  if (adminKey !== ADMIN_KEY) {
    return res.status(401).json({ error: "Brak autoryzacji" });
  }
  if (!title || !body) {
    return res.status(400).json({ error: "Brak tytułu lub treści" });
  }

  try {
    const db = admin.firestore();
    const tokensSnap = await db.collection("fcm_tokens").get();
    const tokens = [];
    tokensSnap.forEach(doc => {
      const t = doc.data().token;
      if (t) tokens.push(t);
    });

    if (tokens.length === 0) {
      return res.status(200).json({ success: true, sent: 0, message: "Brak tokenów FCM" });
    }

    // Wysyłaj w paczkach po 500
    let totalSent = 0, totalFailed = 0;
    for (let i = 0; i < tokens.length; i += 500) {
      const chunk = tokens.slice(i, i + 500);
      const response = await admin.messaging().sendEachForMulticast({
        tokens: chunk,
        notification: { title, body },
        webpush: {
          notification: {
            title, body,
            icon: "/logo192.png",
            badge: "/logo192.png",
            vibrate: [200, 100, 200],
          },
          fcm_options: { link: "https://gang-manager-beta.vercel.app" },
        },
      });

      totalSent += response.successCount;
      totalFailed += response.failureCount;

      // Usuń nieważne tokeny
      const toDelete = [];
      response.responses.forEach((r, idx) => {
        if (!r.success) {
          const code = r.error?.code || "";
          if (code.includes("invalid") || code.includes("not-registered")) {
            toDelete.push(chunk[idx]);
          }
        }
      });
      for (const t of toDelete) {
        const q = await db.collection("fcm_tokens").where("token", "==", t).get();
        q.forEach(d => d.ref.delete());
      }
    }

    // Zapisz historię
    await db.collection("powiadomienia").add({
      title, body,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      sent: totalSent,
      failed: totalFailed,
    });

    return res.status(200).json({ success: true, sent: totalSent, failed: totalFailed });
  } catch(e) {
    console.error("Send notification error:", e);
    return res.status(500).json({ error: e.message });
  }
};
