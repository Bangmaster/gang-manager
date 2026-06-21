const admin = require("firebase-admin");

if (!admin.apps.length) {
  try {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  } catch(e) {
    console.error("Firebase Admin init error:", e.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Vercel parsuje body automatycznie - ale sprawdźmy
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch(e) { body = {}; }
  }
  body = body || {};

  const { title, body: msgBody, adminKey } = body;
  const ADMIN_KEY = process.env.ADMIN_NOTIF_KEY || "family_admin_2024";

  // Debug log
  console.log("adminKey received:", adminKey);
  console.log("ADMIN_KEY from env:", ADMIN_KEY);

  if (!adminKey || adminKey !== ADMIN_KEY) {
    return res.status(401).json({ error: "Brak autoryzacji", received: adminKey, expected_length: ADMIN_KEY.length });
  }

  if (!title || !msgBody) {
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
      return res.status(200).json({ success: true, sent: 0, message: "Brak tokenów FCM — nikt nie włączył powiadomień" });
    }

    let totalSent = 0, totalFailed = 0;
    for (let i = 0; i < tokens.length; i += 500) {
      const chunk = tokens.slice(i, i + 500);
      const response = await admin.messaging().sendEachForMulticast({
        tokens: chunk,
        notification: { title, body: msgBody },
        webpush: {
          notification: { title, body: msgBody, icon: "/logo192.png", badge: "/logo192.png" },
          fcm_options: { link: "https://gang-manager-beta.vercel.app" },
        },
      });
      totalSent += response.successCount;
      totalFailed += response.failureCount;

      // Usuń nieważne tokeny
      for (let j = 0; j < response.responses.length; j++) {
        const r = response.responses[j];
        if (!r.success) {
          const code = r.error?.code || "";
          if (code.includes("invalid") || code.includes("not-registered")) {
            const q = await db.collection("fcm_tokens").where("token", "==", chunk[j]).get();
            q.forEach(d => d.ref.delete());
          }
        }
      }
    }

    await db.collection("powiadomienia").add({
      title, body: msgBody,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      sent: totalSent, failed: totalFailed,
    });

    return res.status(200).json({ success: true, sent: totalSent, failed: totalFailed });
  } catch(e) {
    console.error("Send notification error:", e);
    return res.status(500).json({ error: e.message });
  }
};
