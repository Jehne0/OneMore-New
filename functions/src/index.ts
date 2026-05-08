import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
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

    const ticketRef = await db.collection("supportTickets").add({
      uid: request.auth.uid,
      fromEmail: email,
      subject,
      message,
      createdAt: FieldValue.serverTimestamp(),
      userAgent: safeStr(request.rawRequest?.headers?.["user-agent"], 500),
      app: "OneMore",
    });

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

async function sendPushToUser(
  uid: string,
  title: string,
  body: string,
  data: Record<string, any> = {}
) {
  const tokenSet = new Set<string>();

  const userSnap = await db.collection("users").doc(uid).get();
  const userData = userSnap.exists ? (userSnap.data() as any) : null;

  const directToken = safeStr(userData?.expoPushToken, 500);
  if (directToken) {
    tokenSet.add(directToken);
  }

  const snap = await db.collection("users").doc(uid).collection("pushTokens").get();

  snap.docs.forEach((doc) => {
    const token = String(doc.data()?.token ?? doc.id).trim();
    if (token) tokenSet.add(token);
  });

  const tokens = Array.from(tokenSet);

  console.log("[push] uid:", uid, "tokens:", tokens);

  if (!tokens.length) {
    console.log("[push] no tokens for uid:", uid);
    return;
  }

  const messages = tokens.map((token) => ({
    to: token,
    sound: "default",
    title,
    body,
    data,
    channelId: "default",
  }));

  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });

  const json = await res.json();
  console.log("[push] sent:", JSON.stringify(json));
}

export const requestFriend = onCall({ region: "europe-west1" }, async (request) => {
  const uid = assertAuth(request);
  const otherUid = normUid((request.data ?? {}).otherUid);

  console.log("[requestFriend] called from:", uid, "to:", otherUid);

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

  try {
    console.log("[requestFriend] sending push from:", uid, "to:", otherUid);

    await sendPushToUser(
      otherUid,
      "Nová žádost o přátelství",
      "Máš novou žádost o přátelství.",
      {
        type: "friend_request",
        fromUid: uid,
      }
    );
  } catch (e) {
    console.error("[push] friend request error:", e);
  }

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

export const sendTestPush = onCall({ region: "europe-west1" }, async (request) => {
  const uid = assertAuth(request);
  const token = safeStr((request.data ?? {}).token, 500);

  if (!token) {
    throw new HttpsError("invalid-argument", "Chybí push token.");
  }

  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: token,
      sound: "default",
      title: "OneMore",
      body: "Test push notifikace funguje 🔥",
      data: {
        type: "test",
        uid,
      },
    }),
  });

  const json = await res.json();

  console.log("[push test]", json);

  return {
    ok: true,
    result: json,
  };
});

export const deleteMyAccount = onCall({ region: "europe-west1" }, async (request) => {
  const uid = assertAuth(request);

  const authTime = Number(request.auth?.token?.auth_time ?? 0);
  const nowSec = Math.floor(Date.now() / 1000);

  if (!authTime || nowSec - authTime > 300) {
    throw new HttpsError(
      "failed-precondition",
      "Z bezpečnostních důvodů se prosím znovu přihlas a potom účet smaž."
    );
  }

  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  const userData = userSnap.exists ? (userSnap.data() as any) : null;

  const usernameLower = safeStr(
    userData?.profile?.usernameLower ?? userData?.usernameLower,
    128
  );

  if (usernameLower) {
    const usernameRef = db.collection("usernames").doc(usernameLower);
    const usernameSnap = await usernameRef.get();

    if (!usernameSnap.exists || String(usernameSnap.data()?.uid ?? "") === uid) {
      await usernameRef.delete().catch(() => {});
    }
  }

  await db.collection("publicProfiles").doc(uid).delete().catch(() => {});

  const myFriendsSnap = await db.collection("friends").doc(uid).collection("list").get();

  await Promise.all(
    myFriendsSnap.docs.map(async (friendDoc) => {
      const otherUid = friendDoc.id;

      await db
        .collection("friends")
        .doc(otherUid)
        .collection("list")
        .doc(uid)
        .delete()
        .catch(() => {});
    })
  );

  await db.recursiveDelete(db.collection("friends").doc(uid)).catch(() => {});
  await db.recursiveDelete(userRef).catch(() => {});

  await getAuth().deleteUser(uid);

  return {
    ok: true,
    deletedUid: uid,
    deletedUsername: usernameLower || null,
  };
});