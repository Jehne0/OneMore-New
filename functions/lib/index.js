"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.acceptFriendInvite = exports.createFriendInvite = exports.blockFriend = exports.removeFriend = exports.declineFriend = exports.acceptFriend = exports.requestFriend = exports.sendSupportEmail = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
//
// Podpora (z aplikace)
// - vždy uloží ticket do Firestore (admin)
// - pokud je nastaven RESEND_API_KEY, pošle i e-mail
//
const RESEND_API_KEY = (0, params_1.defineSecret)("RESEND_API_KEY");
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)();
function safeStr(v, max = 4000) {
    const s = String(v ?? "").trim();
    return s.length > max ? s.slice(0, max) : s;
}
exports.sendSupportEmail = (0, https_1.onCall)({ region: "europe-west1", secrets: [RESEND_API_KEY] }, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError("unauthenticated", "Musíš být přihlášený/á.");
    }
    const data = (request.data ?? {});
    const email = safeStr(data.email, 320);
    const subject = safeStr(data.subject, 200);
    const message = safeStr(data.message, 8000);
    if (!email || !subject || !message) {
        throw new https_1.HttpsError("invalid-argument", "Chybí e-mail / předmět / zpráva.");
    }
    // 1) vždy uložíme ticket (funguje i bez e-mail providera)
    const ticketRef = await db.collection("supportTickets").add({
        uid: request.auth.uid,
        fromEmail: email,
        subject,
        message,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        userAgent: safeStr(request.rawRequest?.headers?.["user-agent"], 500),
        app: "OneMore",
    });
    // 2) pokus o odeslání e-mailu přes Resend (pokud je nastavený secret)
    let emailSent = false;
    let emailError = null;
    const apiKey = RESEND_API_KEY.value();
    const to = "info@desigame.eu";
    const from = "OneMore Support <info@desigame.eu>";
    console.log("[support] ticketId:", ticketRef.id);
    console.log("[support] apiKey exists:", !!apiKey);
    console.log("[support] to:", to);
    console.log("[support] from:", from);
    let resendId = null;
    if (apiKey) {
        try {
            const { Resend } = await Promise.resolve().then(() => __importStar(require("resend")));
            const resend = new Resend(apiKey);
            const result = await resend.emails.send({
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
        }
        catch (e) {
            emailSent = false;
            emailError = String(e?.message ?? e);
            console.error("[support] resend error:", emailError);
        }
    }
    else {
        console.warn("[support] RESEND_API_KEY is missing (secret not loaded).");
    }
    // Uložíme výsledek odeslání do ticketu (ať to jde dohledat v konzoli)
    await ticketRef.set({
        emailSent,
        emailError,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
        to,
        from,
        resendId,
    }, { merge: true });
    return { ok: true, ticketId: ticketRef.id, emailSent, resendId };
});
function assertAuth(request) {
    const uid = request.auth?.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "Musíš být přihlášený/á.");
    return uid;
}
function normUid(v, field = "otherUid") {
    const uid = safeStr(v, 128);
    if (!uid)
        throw new https_1.HttpsError("invalid-argument", `Chybí ${field}.`);
    return uid;
}
function friendEdgeRef(uid, otherUid) {
    return db.collection("friends").doc(uid).collection("list").doc(otherUid);
}
function setFriendEdge(tx, uid, otherUid, patch) {
    tx.set(friendEdgeRef(uid, otherUid), patch, { merge: true });
}
exports.requestFriend = (0, https_1.onCall)({ region: "europe-west1" }, async (request) => {
    const uid = assertAuth(request);
    const otherUid = normUid((request.data ?? {}).otherUid);
    if (otherUid === uid)
        throw new https_1.HttpsError("invalid-argument", "Nemůžeš přidat sám sebe.");
    await db.runTransaction(async (tx) => {
        const mineRef = friendEdgeRef(uid, otherUid);
        const theirsRef = friendEdgeRef(otherUid, uid);
        const [mineSnap, theirSnap] = await Promise.all([tx.get(mineRef), tx.get(theirsRef)]);
        const mineStatus = mineSnap.exists ? mineSnap.data()?.status : null;
        const theirStatus = theirSnap.exists ? theirSnap.data()?.status : null;
        if (mineStatus === "blocked" || theirStatus === "blocked") {
            throw new https_1.HttpsError("failed-precondition", "Tento kontakt je blokovaný.");
        }
        if (mineStatus === "accepted" || theirStatus === "accepted")
            return;
        const now = firestore_1.FieldValue.serverTimestamp();
        setFriendEdge(tx, uid, otherUid, {
            status: "pending",
            initiatedBy: uid,
            createdAt: now,
            updatedAt: now,
        });
        setFriendEdge(tx, otherUid, uid, {
            status: "pending",
            initiatedBy: uid,
            createdAt: now,
            updatedAt: now,
        });
    });
    return { ok: true };
});
exports.acceptFriend = (0, https_1.onCall)({ region: "europe-west1" }, async (request) => {
    const uid = assertAuth(request);
    const otherUid = normUid((request.data ?? {}).otherUid);
    await db.runTransaction(async (tx) => {
        const mineRef = friendEdgeRef(uid, otherUid);
        const theirsRef = friendEdgeRef(otherUid, uid);
        const [mineSnap, theirSnap] = await Promise.all([tx.get(mineRef), tx.get(theirsRef)]);
        if (!mineSnap.exists || !theirSnap.exists) {
            throw new https_1.HttpsError("not-found", "Žádost už neexistuje.");
        }
        const mineStatus = mineSnap.data()?.status;
        const theirStatus = theirSnap.data()?.status;
        if (mineStatus === "blocked" || theirStatus === "blocked") {
            throw new https_1.HttpsError("failed-precondition", "Kontakt je blokovaný.");
        }
        const now = firestore_1.FieldValue.serverTimestamp();
        tx.set(mineRef, { status: "accepted", updatedAt: now }, { merge: true });
        tx.set(theirsRef, { status: "accepted", updatedAt: now }, { merge: true });
    });
    return { ok: true };
});
exports.declineFriend = (0, https_1.onCall)({ region: "europe-west1" }, async (request) => {
    const uid = assertAuth(request);
    const otherUid = normUid((request.data ?? {}).otherUid);
    await db.runTransaction(async (tx) => {
        tx.delete(friendEdgeRef(uid, otherUid));
        tx.delete(friendEdgeRef(otherUid, uid));
    });
    return { ok: true };
});
// ✅ NOVĚ: Odebrání přítele (symetricky smaže obě strany)
exports.removeFriend = (0, https_1.onCall)({ region: "europe-west1" }, async (request) => {
    const uid = assertAuth(request);
    const otherUid = normUid((request.data ?? {}).otherUid);
    await db.runTransaction(async (tx) => {
        tx.delete(friendEdgeRef(uid, otherUid));
        tx.delete(friendEdgeRef(otherUid, uid));
    });
    return { ok: true };
});
exports.blockFriend = (0, https_1.onCall)({ region: "europe-west1" }, async (request) => {
    const uid = assertAuth(request);
    const otherUid = normUid((request.data ?? {}).otherUid);
    await db.runTransaction(async (tx) => {
        const now = firestore_1.FieldValue.serverTimestamp();
        tx.set(friendEdgeRef(uid, otherUid), { status: "blocked", initiatedBy: uid, updatedAt: now, createdAt: now }, { merge: true });
        tx.set(friendEdgeRef(otherUid, uid), { status: "blocked", initiatedBy: uid, updatedAt: now, createdAt: now }, { merge: true });
    });
    return { ok: true };
});
exports.createFriendInvite = (0, https_1.onCall)({ region: "europe-west1" }, async (request) => {
    const uid = assertAuth(request);
    const inviteRef = db.collection("friendInvites").doc();
    await inviteRef.set({
        createdBy: uid,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        usedBy: null,
        usedAt: null,
    });
    return { ok: true, inviteId: inviteRef.id };
});
exports.acceptFriendInvite = (0, https_1.onCall)({ region: "europe-west1" }, async (request) => {
    const uid = assertAuth(request);
    const inviteId = safeStr((request.data ?? {}).inviteId, 256);
    if (!inviteId)
        throw new https_1.HttpsError("invalid-argument", "Chybí inviteId.");
    const inviteRef = db.collection("friendInvites").doc(inviteId);
    let otherUid = null;
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(inviteRef);
        if (!snap.exists)
            throw new https_1.HttpsError("not-found", "Pozvánka neexistuje (nebo už vypršela).");
        const data = snap.data();
        otherUid = String(data?.createdBy ?? "").trim();
        if (!otherUid)
            throw new https_1.HttpsError("failed-precondition", "Neplatná pozvánka.");
        if (otherUid === uid)
            throw new https_1.HttpsError("invalid-argument", "Tohle je tvoje vlastní pozvánka.");
        if (data?.usedBy)
            throw new https_1.HttpsError("failed-precondition", "Pozvánka už byla použitá.");
        const now = firestore_1.FieldValue.serverTimestamp();
        tx.set(inviteRef, { usedBy: uid, usedAt: now }, { merge: true });
        // ✅ Atomicky vytvoříme přátelství (accepted) na obou stranách
        tx.set(friendEdgeRef(uid, otherUid), { status: "accepted", initiatedBy: otherUid, createdAt: now, updatedAt: now }, { merge: true });
        tx.set(friendEdgeRef(otherUid, uid), { status: "accepted", initiatedBy: otherUid, createdAt: now, updatedAt: now }, { merge: true });
    });
    return { ok: true, otherUid };
});
