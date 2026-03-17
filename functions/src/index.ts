import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, type Transaction } from "firebase-admin/firestore";

//
// Podpora (z aplikace)
// - vždy uloží ticket do Firestore (admin)
// - pokud je nastaven RESEND_API_KEY, pošle i e-mail
//

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");

initializeApp();
const db = getFirestore();

type SupportPayload = {
  email: string;
  subject: string;
  message: string;
};

function safeStr(v: unknown, max = 4000): string {
  const s = String(v ?? "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

export const sendSupportEmail = onCall(
  { region: "europe-west1", secrets: [RESEND_API_KEY] },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Musíš být přihlášený/á.");
    }

    const data = (request.data ?? {}) as Partial<SupportPayload>;

    const email = safeStr(data.email, 320);
    const subject = safeStr(data.subject, 200);
    const message = safeStr(data.message, 8000);

    if (!email || !subject || !message) {
      throw new HttpsError("invalid-argument", "Chybí e-mail / předmět / zpráva.");
    }

    // 1) vždy uložíme ticket (funguje i bez e-mail providera)
    const ticketRef = await db.collection("supportTickets").add({
      uid: request.auth.uid,
      fromEmail: email,
      subject,
      message,
      createdAt: FieldValue.serverTimestamp(),
      userAgent: safeStr(request.rawRequest?.headers?.["user-agent"], 500),
      app: "OneMore",
    });

    // 2) pokus o odeslání e-mailu přes Resend (pokud je nastavený secret)
    let emailSent = false;
    let emailError: string | null = null;

    const apiKey = RESEND_API_KEY.value();

    const to = "info@desigame.eu";
    const from = "OneMore Support <info@desigame.eu>";

    console.log("[support] ticketId:", ticketRef.id);
    console.log("[support] apiKey exists:", !!apiKey);
    console.log("[support] to:", to);
    console.log("[support] from:", from);

    let resendId: string | null = null;

    if (apiKey) {
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(apiKey);

        const result: any = await resend.emails.send({
          to,
          from,
          replyTo: email,
          subject: `[OneMore] ${subject}`,
          text: `UID: ${request.auth.uid}\nReply-to: ${email}\nTicket: ${ticketRef.id}\n\n${message}`,
        });

        // Resend obvykle vrací { id: "..." }
        resendId = typeof result?.id === "string" ? result.id : null;
        console.log("[support] resend result:", result);

        emailSent = true;
      } catch (e: any) {
        emailSent = false;
        emailError = String(e?.message ?? e);
        console.error("[support] resend error:", emailError);
      }
    } else {
      console.warn("[support] RESEND_API_KEY is missing (secret not loaded).");
    }

    // Uložíme výsledek odeslání do ticketu (ať to jde dohledat v konzoli)
    await ticketRef.set(
      {
        emailSent,
        emailError,
        updatedAt: FieldValue.serverTimestamp(),
        to,
        from,
        resendId,
      },
      { merge: true }
    );

    return { ok: true, ticketId: ticketRef.id, emailSent, resendId };
  }
);

//
// Přátelé
// - veškeré mutace přes Cloud Functions (atomicky a bez děr v rules)
// - data: friends/{uid}/list/{friendUid}
// - pozvánky: friendInvites/{inviteId}
//

type FriendStatus = "pending" | "accepted" | "blocked";

function assertAuth(request: any) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Musíš být přihlášený/á.");
  return uid as string;
}

function normUid(v: unknown, field = "otherUid") {
  const uid = safeStr(v, 128);
  if (!uid) throw new HttpsError("invalid-argument", `Chybí ${field}.`);
  return uid;
}

function friendEdgeRef(uid: string, otherUid: string) {
  return db.collection("friends").doc(uid).collection("list").doc(otherUid);
}

function setFriendEdge(tx: Transaction, uid: string, otherUid: string, patch: Record<string, any>) {
  tx.set(friendEdgeRef(uid, otherUid), patch, { merge: true });
}

export const requestFriend = onCall({ region: "europe-west1" }, async (request) => {
  const uid = assertAuth(request);
  const otherUid = normUid((request.data ?? {}).otherUid);

  if (otherUid === uid) throw new HttpsError("invalid-argument", "Nemůžeš přidat sám sebe.");

  await db.runTransaction(async (tx) => {
    const mineRef = friendEdgeRef(uid, otherUid);
    const theirsRef = friendEdgeRef(otherUid, uid);

    const [mineSnap, theirSnap] = await Promise.all([tx.get(mineRef), tx.get(theirsRef)]);
    const mineStatus = mineSnap.exists ? (mineSnap.data() as any)?.status : null;
    const theirStatus = theirSnap.exists ? (theirSnap.data() as any)?.status : null;

    if (mineStatus === "blocked" || theirStatus === "blocked") {
      throw new HttpsError("failed-precondition", "Tento kontakt je blokovaný.");
    }

    if (mineStatus === "accepted" || theirStatus === "accepted") return;

    const now = FieldValue.serverTimestamp();

    setFriendEdge(tx, uid, otherUid, {
      status: "pending" as FriendStatus,
      initiatedBy: uid,
      createdAt: now,
      updatedAt: now,
    });
    setFriendEdge(tx, otherUid, uid, {
      status: "pending" as FriendStatus,
      initiatedBy: uid,
      createdAt: now,
      updatedAt: now,
    });
  });

  return { ok: true };
});

export const acceptFriend = onCall({ region: "europe-west1" }, async (request) => {
  const uid = assertAuth(request);
  const otherUid = normUid((request.data ?? {}).otherUid);

  await db.runTransaction(async (tx) => {
    const mineRef = friendEdgeRef(uid, otherUid);
    const theirsRef = friendEdgeRef(otherUid, uid);
    const [mineSnap, theirSnap] = await Promise.all([tx.get(mineRef), tx.get(theirsRef)]);

    if (!mineSnap.exists || !theirSnap.exists) {
      throw new HttpsError("not-found", "Žádost už neexistuje.");
    }
    const mineStatus = (mineSnap.data() as any)?.status;
    const theirStatus = (theirSnap.data() as any)?.status;
    if (mineStatus === "blocked" || theirStatus === "blocked") {
      throw new HttpsError("failed-precondition", "Kontakt je blokovaný.");
    }

    const now = FieldValue.serverTimestamp();
    tx.set(mineRef, { status: "accepted" as FriendStatus, updatedAt: now }, { merge: true });
    tx.set(theirsRef, { status: "accepted" as FriendStatus, updatedAt: now }, { merge: true });
  });

  return { ok: true };
});

export const declineFriend = onCall({ region: "europe-west1" }, async (request) => {
  const uid = assertAuth(request);
  const otherUid = normUid((request.data ?? {}).otherUid);

  await db.runTransaction(async (tx) => {
    tx.delete(friendEdgeRef(uid, otherUid));
    tx.delete(friendEdgeRef(otherUid, uid));
  });

  return { ok: true };
});

// ✅ NOVĚ: Odebrání přítele (symetricky smaže obě strany)
export const removeFriend = onCall({ region: "europe-west1" }, async (request) => {
  const uid = assertAuth(request);
  const otherUid = normUid((request.data ?? {}).otherUid);

  await db.runTransaction(async (tx) => {
    tx.delete(friendEdgeRef(uid, otherUid));
    tx.delete(friendEdgeRef(otherUid, uid));
  });

  return { ok: true };
});

export const blockFriend = onCall({ region: "europe-west1" }, async (request) => {
  const uid = assertAuth(request);
  const otherUid = normUid((request.data ?? {}).otherUid);

  await db.runTransaction(async (tx) => {
    const now = FieldValue.serverTimestamp();
    tx.set(
      friendEdgeRef(uid, otherUid),
      { status: "blocked" as FriendStatus, initiatedBy: uid, updatedAt: now, createdAt: now },
      { merge: true }
    );
    tx.set(
      friendEdgeRef(otherUid, uid),
      { status: "blocked" as FriendStatus, initiatedBy: uid, updatedAt: now, createdAt: now },
      { merge: true }
    );
  });

  return { ok: true };
});

export const createFriendInvite = onCall({ region: "europe-west1" }, async (request) => {
  const uid = assertAuth(request);
  const inviteRef = db.collection("friendInvites").doc();

  await inviteRef.set({
    createdBy: uid,
    createdAt: FieldValue.serverTimestamp(),
    usedBy: null,
    usedAt: null,
  });

  return { ok: true, inviteId: inviteRef.id };
});

export const acceptFriendInvite = onCall({ region: "europe-west1" }, async (request) => {
  const uid = assertAuth(request);
  const inviteId = safeStr((request.data ?? {}).inviteId, 256);
  if (!inviteId) throw new HttpsError("invalid-argument", "Chybí inviteId.");

  const inviteRef = db.collection("friendInvites").doc(inviteId);

  let otherUid: string | null = null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(inviteRef);
    if (!snap.exists) throw new HttpsError("not-found", "Pozvánka neexistuje (nebo už vypršela).");
    const data = snap.data() as any;

    otherUid = String(data?.createdBy ?? "").trim();
    if (!otherUid) throw new HttpsError("failed-precondition", "Neplatná pozvánka.");
    if (otherUid === uid) throw new HttpsError("invalid-argument", "Tohle je tvoje vlastní pozvánka.");

    if (data?.usedBy) throw new HttpsError("failed-precondition", "Pozvánka už byla použitá.");

    const now = FieldValue.serverTimestamp();
    tx.set(inviteRef, { usedBy: uid, usedAt: now }, { merge: true });

    // ✅ Atomicky vytvoříme přátelství (accepted) na obou stranách
    tx.set(
      friendEdgeRef(uid, otherUid),
      { status: "accepted" as FriendStatus, initiatedBy: otherUid, createdAt: now, updatedAt: now },
      { merge: true }
    );
    tx.set(
      friendEdgeRef(otherUid, uid),
      { status: "accepted" as FriendStatus, initiatedBy: otherUid, createdAt: now, updatedAt: now },
      { merge: true }
    );
  });

  return { ok: true, otherUid };
});