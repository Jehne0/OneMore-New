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
exports.notifySharedChallengeProgress = exports.notifySharedChallengeCreated = exports.declineSharedChallengeMemberInvite = exports.acceptSharedChallengeMemberInvite = exports.inviteSharedChallengeMember = exports.deleteMyAccount = exports.sendTestPush = exports.acceptFriendInvite = exports.createFriendInvite = exports.blockFriend = exports.removeFriend = exports.declineFriend = exports.acceptFriend = exports.requestFriend = exports.sendSupportEmail = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const params_1 = require("firebase-functions/params");
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const firestore_2 = require("firebase-admin/firestore");
//
// Podpora (z aplikace)
// - vždy uloží ticket do Firestore (admin)
// - pokud je nastaven RESEND_API_KEY, pošle i e-mail
//
const RESEND_API_KEY = (0, params_1.defineSecret)("RESEND_API_KEY");
(0, app_1.initializeApp)();
const db = (0, firestore_2.getFirestore)();
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
    const ticketRef = await db.collection("supportTickets").add({
        uid: request.auth.uid,
        fromEmail: email,
        subject,
        message,
        createdAt: firestore_2.FieldValue.serverTimestamp(),
        userAgent: safeStr(request.rawRequest?.headers?.["user-agent"], 500),
        app: "OneMore",
    });
    let emailSent = false;
    let emailError = null;
    const apiKey = RESEND_API_KEY.value();
    const to = "info@desigame.eu";
    const from = "OneMore Support <info@desigame.eu>";
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
            resendId = typeof result?.id === "string" ? result.id : null;
            emailSent = true;
        }
        catch (e) {
            emailSent = false;
            emailError = String(e?.message ?? e);
            console.error("[support] email send failed");
        }
    }
    else {
        console.warn("[support] RESEND_API_KEY is missing (secret not loaded).");
    }
    await ticketRef.set({
        emailSent,
        emailError,
        updatedAt: firestore_2.FieldValue.serverTimestamp(),
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
function friendStatus(snap) {
    return snap.exists ? (snap.data()?.status ?? null) : null;
}
async function sendPushToUser(uid, title, body, data = {}, requiredSettings = []) {
    const tokenSet = new Set();
    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() : null;
    const notificationSettings = userData?.notificationSettings ?? {};
    const disabledByUser = requiredSettings.some((key) => notificationSettings?.[key] === false);
    if (disabledByUser) {
        return;
    }
    const directToken = safeStr(userData?.expoPushToken, 500);
    if (directToken) {
        tokenSet.add(directToken);
    }
    const snap = await db.collection("users").doc(uid).collection("pushTokens").get();
    snap.docs.forEach((doc) => {
        const token = String(doc.data()?.token ?? doc.id).trim();
        if (token)
            tokenSet.add(token);
    });
    const tokens = Array.from(tokenSet);
    if (!tokens.length) {
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
    await res.json().catch(() => null);
}
function arr(v) {
    return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
}
async function getUsernameForPush(uid) {
    try {
        const snap = await db.collection("users").doc(uid).get();
        const data = snap.exists ? snap.data() : null;
        return (safeStr(data?.profile?.username, 80) ||
            safeStr(data?.username, 80) ||
            "Kamarád");
    }
    catch {
        return "Kamarád";
    }
}
function isSharedDone(v) {
    if (v === true)
        return true;
    if (!v || typeof v !== "object")
        return false;
    return (v.done === true ||
        v.completed === true ||
        v.isDone === true ||
        v.status === "done" ||
        v.status === "completed" ||
        !!v.completedAt);
}
const MAX_SHARED_MEMBERS = 10;
function sharedChallengeRef(challengeId) {
    return db.collection("sharedChallenges").doc(challengeId);
}
function uniqueUids(values) {
    return Array.from(new Set(values.map((x) => String(x ?? "").trim()).filter(Boolean)));
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
        const mineStatus = friendStatus(mineSnap);
        const theirStatus = friendStatus(theirSnap);
        if (mineStatus === "blocked" || theirStatus === "blocked") {
            throw new https_1.HttpsError("failed-precondition", "Tento kontakt je blokovaný.");
        }
        if (mineStatus === "accepted" || theirStatus === "accepted")
            return;
        const now = firestore_2.FieldValue.serverTimestamp();
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
    try {
        await sendPushToUser(otherUid, "Nová žádost o přátelství", "Máš novou žádost o přátelství.", {
            type: "friend_request",
            fromUid: uid,
        }, ["friendRequests"]);
    }
    catch {
        console.error("[push] friend request notification failed");
    }
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
        const mineStatus = friendStatus(mineSnap);
        const theirStatus = friendStatus(theirSnap);
        if (mineStatus === "blocked" || theirStatus === "blocked") {
            throw new https_1.HttpsError("failed-precondition", "Kontakt je blokovaný.");
        }
        const now = firestore_2.FieldValue.serverTimestamp();
        tx.set(mineRef, { status: "accepted", updatedAt: now }, { merge: true });
        tx.set(theirsRef, { status: "accepted", updatedAt: now }, { merge: true });
    });
    return { ok: true };
});
exports.declineFriend = (0, https_1.onCall)({ region: "europe-west1" }, async (request) => {
    const uid = assertAuth(request);
    const otherUid = normUid((request.data ?? {}).otherUid);
    await db.runTransaction(async (tx) => {
        const mineRef = friendEdgeRef(uid, otherUid);
        const theirsRef = friendEdgeRef(otherUid, uid);
        const [mineSnap, theirSnap] = await Promise.all([tx.get(mineRef), tx.get(theirsRef)]);
        const mineStatus = friendStatus(mineSnap);
        const theirStatus = friendStatus(theirSnap);
        if (mineStatus === "accepted" || theirStatus === "accepted") {
            throw new https_1.HttpsError("failed-precondition", "Potvrzené přátelství lze jen odebrat.");
        }
        if (mineStatus === "blocked" || theirStatus === "blocked") {
            throw new https_1.HttpsError("failed-precondition", "Blokovaný kontakt nelze odmítnout jako žádost.");
        }
        if (mineStatus === "pending" || theirStatus === "pending") {
            tx.delete(mineRef);
            tx.delete(theirsRef);
        }
    });
    return { ok: true };
});
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
        const now = firestore_2.FieldValue.serverTimestamp();
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
        createdAt: firestore_2.FieldValue.serverTimestamp(),
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
        const usedBy = String(data?.usedBy ?? "").trim();
        if (usedBy && usedBy !== uid)
            throw new https_1.HttpsError("failed-precondition", "Pozvánka už byla použitá.");
        if (usedBy === uid)
            return;
        const mineRef = friendEdgeRef(uid, otherUid);
        const theirsRef = friendEdgeRef(otherUid, uid);
        const [mineSnap, theirSnap] = await Promise.all([tx.get(mineRef), tx.get(theirsRef)]);
        const mineStatus = friendStatus(mineSnap);
        const theirStatus = friendStatus(theirSnap);
        if (mineStatus === "blocked" || theirStatus === "blocked") {
            throw new https_1.HttpsError("failed-precondition", "Kontakt je blokovaný.");
        }
        const now = firestore_2.FieldValue.serverTimestamp();
        tx.set(inviteRef, { usedBy: uid, usedAt: now }, { merge: true });
        tx.set(mineRef, { status: "accepted", initiatedBy: otherUid, createdAt: now, updatedAt: now }, { merge: true });
        tx.set(theirsRef, { status: "accepted", initiatedBy: otherUid, createdAt: now, updatedAt: now }, { merge: true });
    });
    return { ok: true, otherUid };
});
exports.sendTestPush = (0, https_1.onCall)({ region: "europe-west1" }, async (request) => {
    const uid = assertAuth(request);
    const token = safeStr((request.data ?? {}).token, 500);
    if (!token) {
        throw new https_1.HttpsError("invalid-argument", "Chybí push token.");
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
    return {
        ok: true,
        result: json,
    };
});
exports.deleteMyAccount = (0, https_1.onCall)({ region: "europe-west1" }, async (request) => {
    const uid = assertAuth(request);
    const authTime = Number(request.auth?.token?.auth_time ?? 0);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!authTime || nowSec - authTime > 300) {
        throw new https_1.HttpsError("failed-precondition", "Z bezpečnostních důvodů se prosím znovu přihlas a potom účet smaž.");
    }
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : null;
    const usernameLower = safeStr(userData?.profile?.usernameLower ?? userData?.usernameLower, 128);
    if (usernameLower) {
        const usernameRef = db.collection("usernames").doc(usernameLower);
        const usernameSnap = await usernameRef.get();
        if (!usernameSnap.exists || String(usernameSnap.data()?.uid ?? "") === uid) {
            await usernameRef.delete().catch(() => { });
        }
    }
    await db.collection("publicProfiles").doc(uid).delete().catch(() => { });
    const myFriendsSnap = await db.collection("friends").doc(uid).collection("list").get();
    await Promise.all(myFriendsSnap.docs.map(async (friendDoc) => {
        const otherUid = friendDoc.id;
        await db
            .collection("friends")
            .doc(otherUid)
            .collection("list")
            .doc(uid)
            .delete()
            .catch(() => { });
    }));
    await db.recursiveDelete(db.collection("friends").doc(uid)).catch(() => { });
    await db.recursiveDelete(userRef).catch(() => { });
    await (0, auth_1.getAuth)().deleteUser(uid);
    return {
        ok: true,
        deletedUid: uid,
        deletedUsername: usernameLower || null,
    };
});
exports.inviteSharedChallengeMember = (0, https_1.onCall)({ region: "europe-west1" }, async (request) => {
    const uid = assertAuth(request);
    const challengeId = safeStr((request.data ?? {}).challengeId, 256);
    const friendUid = normUid((request.data ?? {}).friendUid, "friendUid");
    if (!challengeId)
        throw new https_1.HttpsError("invalid-argument", "Chybi challengeId.");
    if (friendUid === uid)
        throw new https_1.HttpsError("invalid-argument", "Nemuzes pozvat sam sebe.");
    let challengeTitle = "Spolecna vyzva";
    await db.runTransaction(async (tx) => {
        const challengeRef = sharedChallengeRef(challengeId);
        const [challengeSnap, mineFriendSnap, theirFriendSnap] = await Promise.all([
            tx.get(challengeRef),
            tx.get(friendEdgeRef(uid, friendUid)),
            tx.get(friendEdgeRef(friendUid, uid)),
        ]);
        if (!challengeSnap.exists) {
            throw new https_1.HttpsError("not-found", "Spolecna vyzva nebyla nalezena.");
        }
        const data = challengeSnap.data();
        const memberUids = uniqueUids(arr(data?.memberUids));
        const acceptedBy = uniqueUids(arr(data?.acceptedBy));
        const pendingInviteUids = uniqueUids(arr(data?.pendingInviteUids));
        if (!memberUids.includes(uid) || !acceptedBy.includes(uid)) {
            throw new https_1.HttpsError("permission-denied", "Pozvat muze jen prijaty ucastnik vyzvy.");
        }
        if (data?.enabled === false || data?.status === "declined") {
            throw new https_1.HttpsError("failed-precondition", "Tato vyzva uz neni aktivni.");
        }
        if (friendStatus(mineFriendSnap) !== "accepted" || friendStatus(theirFriendSnap) !== "accepted") {
            throw new https_1.HttpsError("failed-precondition", "Pozvat lze jen prijateho pritele.");
        }
        if (memberUids.includes(friendUid)) {
            throw new https_1.HttpsError("already-exists", "Tento uzivatel uz je ucastnik.");
        }
        if (pendingInviteUids.includes(friendUid)) {
            throw new https_1.HttpsError("already-exists", "Tento uzivatel uz ma pozvanku.");
        }
        if (uniqueUids([...memberUids, ...pendingInviteUids]).length >= MAX_SHARED_MEMBERS) {
            throw new https_1.HttpsError("failed-precondition", "Spolecna vyzva uz ma maximalni pocet clenu.");
        }
        challengeTitle = safeStr(data?.title, 120) || challengeTitle;
        tx.set(challengeRef, {
            pendingInviteUids: [...pendingInviteUids, friendUid],
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        }, { merge: true });
    });
    try {
        const fromName = await getUsernameForPush(uid);
        await sendPushToUser(friendUid, "Nova spolecna vyzva", `${fromName} te pozval/a do spolecne vyzvy: ${challengeTitle}.`, {
            type: "shared_challenge_invite",
            challengeId,
            fromUid: uid,
        }, ["sharedChallenges", "incomingChallenges"]);
    }
    catch {
        console.error("[push] shared challenge member invite notification failed");
    }
    return { ok: true };
});
exports.acceptSharedChallengeMemberInvite = (0, https_1.onCall)({ region: "europe-west1" }, async (request) => {
    const uid = assertAuth(request);
    const challengeId = safeStr((request.data ?? {}).challengeId, 256);
    if (!challengeId)
        throw new https_1.HttpsError("invalid-argument", "Chybi challengeId.");
    await db.runTransaction(async (tx) => {
        const challengeRef = sharedChallengeRef(challengeId);
        const challengeSnap = await tx.get(challengeRef);
        if (!challengeSnap.exists) {
            throw new https_1.HttpsError("not-found", "Spolecna vyzva nebyla nalezena.");
        }
        const data = challengeSnap.data();
        const memberUids = uniqueUids(arr(data?.memberUids));
        const acceptedBy = uniqueUids(arr(data?.acceptedBy));
        const pendingInviteUids = uniqueUids(arr(data?.pendingInviteUids));
        const leftBy = uniqueUids(arr(data?.leftBy)).filter((memberUid) => memberUid !== uid);
        if (data?.enabled === false || data?.status === "declined") {
            throw new https_1.HttpsError("failed-precondition", "Tato vyzva uz neni aktivni.");
        }
        const alreadyMember = memberUids.includes(uid);
        if (!alreadyMember && !pendingInviteUids.includes(uid)) {
            throw new https_1.HttpsError("permission-denied", "Pro tuto vyzvu nemas pozvanku.");
        }
        if (!alreadyMember && memberUids.length >= MAX_SHARED_MEMBERS) {
            throw new https_1.HttpsError("failed-precondition", "Spolecna vyzva uz ma maximalni pocet clenu.");
        }
        const nextMemberUids = alreadyMember ? memberUids : [...memberUids, uid];
        const nextAcceptedBy = uniqueUids([...acceptedBy, uid]).filter((memberUid) => nextMemberUids.includes(memberUid));
        const nextPendingInviteUids = pendingInviteUids.filter((memberUid) => memberUid !== uid);
        const everyoneAccepted = nextMemberUids.every((memberUid) => nextAcceptedBy.includes(memberUid));
        const wasActive = data?.status === "active";
        tx.set(challengeRef, {
            memberUids: nextMemberUids,
            acceptedBy: nextAcceptedBy,
            pendingInviteUids: nextPendingInviteUids,
            leftBy,
            status: wasActive || everyoneAccepted ? "active" : "pending",
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        }, { merge: true });
    });
    return { ok: true };
});
exports.declineSharedChallengeMemberInvite = (0, https_1.onCall)({ region: "europe-west1" }, async (request) => {
    const uid = assertAuth(request);
    const challengeId = safeStr((request.data ?? {}).challengeId, 256);
    if (!challengeId)
        throw new https_1.HttpsError("invalid-argument", "Chybi challengeId.");
    await db.runTransaction(async (tx) => {
        const challengeRef = sharedChallengeRef(challengeId);
        const challengeSnap = await tx.get(challengeRef);
        if (!challengeSnap.exists) {
            throw new https_1.HttpsError("not-found", "Spolecna vyzva nebyla nalezena.");
        }
        const data = challengeSnap.data();
        const memberUids = uniqueUids(arr(data?.memberUids));
        const acceptedBy = uniqueUids(arr(data?.acceptedBy));
        const pendingInviteUids = uniqueUids(arr(data?.pendingInviteUids));
        const leftBy = uniqueUids(arr(data?.leftBy));
        if (!pendingInviteUids.includes(uid)) {
            if (memberUids.includes(uid)) {
                throw new https_1.HttpsError("failed-precondition", "Ucastnik musi vyzvu opustit.");
            }
            return;
        }
        const nextMemberUids = memberUids.filter((memberUid) => memberUid !== uid);
        const nextAcceptedBy = acceptedBy.filter((memberUid) => memberUid !== uid);
        const nextPendingInviteUids = pendingInviteUids.filter((memberUid) => memberUid !== uid);
        const nextLeftBy = memberUids.includes(uid) ? uniqueUids([...leftBy, uid]) : leftBy;
        const nextData = {
            pendingInviteUids: nextPendingInviteUids,
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        };
        if (memberUids.includes(uid)) {
            nextData.memberUids = nextMemberUids;
            nextData.acceptedBy = nextAcceptedBy;
            nextData.leftBy = nextLeftBy;
            if (nextMemberUids.length < 2) {
                nextData.enabled = false;
                nextData.status = "declined";
            }
        }
        tx.set(challengeRef, nextData, { merge: true });
    });
    return { ok: true };
});
exports.notifySharedChallengeCreated = (0, firestore_1.onDocumentCreated)({
    region: "europe-west1",
    document: "sharedChallenges/{challengeId}",
}, async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const challengeId = String(event.params.challengeId);
    const data = snap.data();
    const createdBy = safeStr(data?.createdBy, 128);
    const memberUids = arr(data?.memberUids);
    if (!createdBy || !memberUids.length) {
        return;
    }
    const fromName = await getUsernameForPush(createdBy);
    const recipients = memberUids.filter((uid) => uid && uid !== createdBy);
    await Promise.all(recipients.map((uid) => sendPushToUser(uid, "Nová společná výzva", `${fromName} tě vyzval/a ke společné výzvě.`, {
        type: "shared_challenge_invite",
        challengeId,
        fromUid: createdBy,
    }, ["sharedChallenges", "incomingChallenges"])));
});
exports.notifySharedChallengeProgress = (0, firestore_1.onDocumentWritten)({
    region: "europe-west1",
    document: "sharedChallenges/{challengeId}/progress/{dateISO}",
}, async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after)
        return;
    const challengeId = String(event.params.challengeId);
    const dateISO = String(event.params.dateISO);
    const beforeUsers = before?.users ?? {};
    const afterUsers = after?.users ?? {};
    const newlyCompletedUids = Object.keys(afterUsers).filter((uid) => {
        const wasDone = isSharedDone(beforeUsers?.[uid]);
        const isDone = isSharedDone(afterUsers?.[uid]);
        return !wasDone && isDone;
    });
    if (!newlyCompletedUids.length)
        return;
    const challengeSnap = await db.collection("sharedChallenges").doc(challengeId).get();
    const challenge = challengeSnap.exists ? challengeSnap.data() : null;
    const memberUids = arr(challenge?.memberUids);
    if (!memberUids.length) {
        return;
    }
    for (const completedUid of newlyCompletedUids) {
        const completedName = await getUsernameForPush(completedUid);
        const recipients = memberUids.filter((uid) => uid && uid !== completedUid);
        await Promise.all(recipients.map((uid) => sendPushToUser(uid, "Kamarád splnil společnou výzvu", `${completedName} právě splnil/a společnou výzvu.`, {
            type: "shared_challenge_completed",
            challengeId,
            dateISO,
            completedBy: completedUid,
        }, ["sharedChallenges", "friendCompletedSharedChallenge"])));
    }
});
