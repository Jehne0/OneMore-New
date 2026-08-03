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
exports.notifySharedChallengeProgress = exports.notifySharedChallengeCreated = exports.declineSharedChallengeMemberInvite = exports.acceptSharedChallengeMemberInvite = exports.inviteSharedChallengeMember = exports.deleteMyAccount = exports.sendTestPush = exports.acceptFriendInvite = exports.createFriendInvite = exports.blockFriend = exports.removeFriend = exports.declineFriend = exports.acceptFriend = exports.requestFriend = exports.iosWidgetGateway = exports.revokeIosWidgetAccessGrants = exports.issueIosWidgetAccessGrant = exports.completeSharedChallengeFromWidget = exports.sendSupportEmail = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const params_1 = require("firebase-functions/params");
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const firestore_2 = require("firebase-admin/firestore");
const sharedChallengePermissions_1 = require("./sharedChallengePermissions");
const node_crypto_1 = require("node:crypto");
//
// Podpora (z aplikace)
// - vždy uloží ticket do Firestore (admin)
// - pokud je nastaven RESEND_API_KEY, pošle i e-mail
//
const RESEND_API_KEY = (0, params_1.defineSecret)("RESEND_API_KEY");
const REVENUECAT_SECRET_API_KEY = (0, params_1.defineSecret)("REVENUECAT_SECRET_API_KEY");
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
function widgetDateIsActive(challenge, dateISO) {
    if (challenge.enabled === false || challenge.status !== "active")
        return false;
    const period = challenge.period === "every2" || challenge.period === "custom" ? challenge.period : "daily";
    if (period === "daily")
        return true;
    const value = new Date(`${dateISO}T00:00:00Z`);
    if (!Number.isFinite(value.getTime()))
        return false;
    if (period === "every2") {
        const anchorISO = /^\d{4}-\d{2}-\d{2}$/.test(String(challenge.periodAnchor ?? ""))
            ? String(challenge.periodAnchor) : dateISO;
        const anchor = new Date(`${anchorISO}T00:00:00Z`);
        return Math.abs(Math.floor((value.getTime() - anchor.getTime()) / 86400000)) % 2 === 0;
    }
    const mondayZero = (value.getUTCDay() + 6) % 7;
    const days = Array.isArray(challenge.customDays)
        ? challenge.customDays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        : [];
    return days.includes(mondayZero);
}
/**
 * Authenticated replay endpoint for iOS widget outbox mutations. The native
 * extension never receives Firebase credentials; the main app calls this only
 * after Auth restoration. Every membership/schedule check is repeated here.
 */
async function completeSharedChallengeForWidget(uid, challengeId, dateISO, mutationId, expectedDoneBefore) {
    if (!challengeId || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || !mutationId) {
        throw new https_1.HttpsError("invalid-argument", "Invalid widget completion.");
    }
    const challengeRef = db.collection("sharedChallenges").doc(challengeId);
    const progressRef = challengeRef.collection("progress").doc(dateISO);
    return db.runTransaction(async (tx) => {
        const challengeSnap = await tx.get(challengeRef);
        if (!challengeSnap.exists)
            throw new https_1.HttpsError("not-found", "Shared challenge not found.");
        const challenge = challengeSnap.data();
        const memberUids = Array.isArray(challenge.memberUids) ? challenge.memberUids.map(String) : [];
        const acceptedBy = Array.isArray(challenge.acceptedBy) ? challenge.acceptedBy.map(String) : [];
        const pending = Array.isArray(challenge.pendingInviteUids) ? challenge.pendingInviteUids.map(String) : [];
        const left = Array.isArray(challenge.leftBy) ? challenge.leftBy.map(String) : [];
        if (!memberUids.includes(uid) || !acceptedBy.includes(uid) || pending.includes(uid) || left.includes(uid)) {
            throw new https_1.HttpsError("permission-denied", "User cannot complete this shared challenge.");
        }
        if (!widgetDateIsActive(challenge, dateISO)) {
            throw new https_1.HttpsError("failed-precondition", "Shared challenge is not active on this date.");
        }
        const progressSnap = await tx.get(progressRef);
        const users = progressSnap.exists ? (progressSnap.data()?.users ?? {}) : {};
        const mine = users[uid] ?? {};
        const count = Math.max(0, Math.floor(Number(mine.completedCount ?? 0)));
        const target = Math.max(1, Math.min(20, Math.floor(Number(challenge.targetPerDay ?? 1))));
        const mutationIds = Array.isArray(mine.mutationIds) ? mine.mutationIds.map(String).slice(-40) : [];
        if (mutationIds.includes(mutationId))
            return { status: "already-completed", count };
        if (expectedDoneBefore !== undefined && count !== expectedDoneBefore) {
            throw new https_1.HttpsError("failed-precondition", "Shared challenge progress changed.");
        }
        const next = Math.min(target, count + 1);
        tx.set(progressRef, {
            date: dateISO,
            users: { [uid]: {
                    completedCount: next,
                    completed: next >= target,
                    mutationIds: [...mutationIds, mutationId].slice(-40),
                    updatedAt: firestore_2.FieldValue.serverTimestamp(),
                } },
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        }, { merge: true });
        return { status: next === count ? "already-completed" : "completed", count: next };
    });
}
exports.completeSharedChallengeFromWidget = (0, https_1.onCall)({ region: "europe-west1" }, async (request) => {
    const uid = assertAuth(request);
    return completeSharedChallengeForWidget(uid, safeStr(request.data?.challengeId, 160), safeStr(request.data?.date, 10), safeStr(request.data?.mutationId, 300));
});
const WIDGET_GRANTS = "iosWidgetAccessGrants";
const WIDGET_GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
function sha256Hex(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value).digest("hex");
}
function stableJson(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(",")}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}
function p256PublicKey(rawBase64) {
    const raw = Buffer.from(rawBase64, "base64");
    if (raw.length !== 65 || raw[0] !== 4)
        throw new https_1.HttpsError("invalid-argument", "Invalid widget public key.");
    const spkiPrefix = Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex");
    return (0, node_crypto_1.createPublicKey)({ key: Buffer.concat([spkiPrefix, raw]), format: "der", type: "spki" });
}
async function revenueCatPremium(uid) {
    const secret = REVENUECAT_SECRET_API_KEY.value();
    if (!secret)
        throw new https_1.HttpsError("unavailable", "Premium verification is temporarily unavailable.");
    const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`, {
        headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
    });
    if (response.status === 404)
        return { state: "free", expirationDate: null, lifetime: false };
    if (!response.ok)
        throw new https_1.HttpsError("unavailable", "Premium verification is temporarily unavailable.");
    const body = await response.json();
    const entitlement = body?.subscriber?.entitlements?.premium;
    if (!entitlement)
        return { state: "free", expirationDate: null, lifetime: false };
    const rawExpiration = entitlement.expires_date ?? entitlement.expiration_date ?? null;
    const expiration = typeof rawExpiration === "string" && Number.isFinite(Date.parse(rawExpiration))
        ? new Date(rawExpiration).toISOString() : null;
    const lifetime = expiration === null;
    return {
        state: lifetime || Date.parse(expiration) > Date.now() ? "premium" : "free",
        expirationDate: expiration,
        lifetime,
    };
}
function localDateInTimeZone(timeZone, date = new Date()) {
    try {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone, year: "numeric", month: "2-digit", day: "2-digit",
        }).formatToParts(date);
        const part = (type) => parts.find((value) => value.type === type)?.value ?? "";
        const result = `${part("year")}-${part("month")}-${part("day")}`;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(result))
            throw new Error("date");
        return result;
    }
    catch {
        throw new https_1.HttpsError("invalid-argument", "Invalid widget time zone.");
    }
}
function localTimeInTimeZone(timeZone, date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date);
    const part = (type) => parts.find((value) => value.type === type)?.value ?? "00";
    return `${part("hour")}:${part("minute")}`;
}
function addIsoDays(dateISO, days) {
    const value = new Date(`${dateISO}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}
function personalDateIsActive(challenge, dateISO) {
    if (challenge.enabled === false || challenge.deletedAt)
        return false;
    return widgetDateIsActive({ ...challenge, status: "active" }, dateISO);
}
function previousPersonalActiveDate(challenge, dateISO) {
    for (let offset = 1; offset <= 14; offset += 1) {
        const candidate = addIsoDays(dateISO, -offset);
        if (personalDateIsActive(challenge, candidate))
            return candidate;
    }
    return addIsoDays(dateISO, -1);
}
async function completePersonalChallengeForWidget(uid, challengeId, dateISO, mutationId, expectedDoneBefore, timeZone) {
    const stateRef = db.collection("users").doc(uid).collection("appState").doc("main");
    return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(stateRef);
        if (!snapshot.exists)
            throw new https_1.HttpsError("not-found", "Personal challenge state not found.");
        const document = snapshot.data();
        const state = document.state;
        if (!state)
            throw new https_1.HttpsError("not-found", "Personal challenge state not found.");
        const challenge = (Array.isArray(state.challenges) ? state.challenges : [])
            .find((item) => String(item?.id ?? "") === challengeId);
        if (!challenge)
            throw new https_1.HttpsError("not-found", "Personal challenge not found.");
        if (!personalDateIsActive(challenge, dateISO)) {
            throw new https_1.HttpsError("failed-precondition", "Personal challenge is not active on this date.");
        }
        const history = Array.isArray(state.history) ? state.history : [];
        if (history.some((entry) => entry.widgetMutationId === mutationId)) {
            const count = history.filter((entry) => entry.date === dateISO && entry.status === "completed"
                && String(entry.challengeId ?? "") === challengeId).length;
            return { status: "already-completed", count };
        }
        const count = history.filter((entry) => entry.date === dateISO && entry.status === "completed"
            && String(entry.challengeId ?? "") === challengeId).length;
        if (count !== expectedDoneBefore)
            throw new https_1.HttpsError("failed-precondition", "Personal challenge progress changed.");
        const target = Math.max(1, Math.min(20, Math.floor(Number(challenge.targetPerDay ?? 1))));
        if (count >= target)
            return { status: "already-completed", count };
        const nextCount = count + 1;
        const completedDay = nextCount >= target;
        const now = new Date();
        const withoutSkip = history.filter((entry) => !(entry.date === dateISO && entry.status === "skipped"
            && String(entry.challengeId ?? "") === challengeId));
        const nextEntry = {
            date: dateISO,
            time: localTimeInTimeZone(timeZone, now),
            atISO: now.toISOString(),
            challengeId,
            challengeText: safeStr(challenge.text, 500),
            status: "completed",
            partial: !completedDay,
            widgetMutationId: mutationId,
        };
        const nextState = { ...state, history: [nextEntry, ...withoutSkip] };
        if (completedDay) {
            const statsMap = { ...(state.challengeStats ?? {}) };
            const previous = statsMap[challengeId] ?? {};
            const completedCount = Math.max(0, Math.floor(Number(previous.completedCount ?? 0))) + 1;
            const easy = challenge.easyMode === true || (Array.isArray(state.easyModeChallengeIds)
                && state.easyModeChallengeIds.map(String).includes(challengeId));
            if (easy) {
                statsMap[challengeId] = { ...previous, completedCount, lastCompletedDay: dateISO };
            }
            else {
                const dayAlreadyCounted = previous.lastCompletedDay === dateISO;
                const previousActive = previousPersonalActiveDate(challenge, dateISO);
                const lastStreakDay = previous.lastStreakDay ?? previous.lastCompletedDay;
                const current = Math.max(0, Math.floor(Number(previous.currentStreak ?? 0)));
                const nextStreak = dayAlreadyCounted ? current : lastStreakDay === previousActive ? current + 1 : 1;
                statsMap[challengeId] = {
                    ...previous,
                    completedCount,
                    skippedCount: Math.max(0, Math.floor(Number(previous.skippedCount ?? 0))),
                    lastCompletedDay: dateISO,
                    lastStreakDay: dateISO,
                    currentStreak: nextStreak,
                    bestStreak: Math.max(Math.max(0, Math.floor(Number(previous.bestStreak ?? 0))), nextStreak),
                    skipCredits: nextStreak > 0 && nextStreak % 10 === 0
                        ? 1 : Math.min(1, Math.max(0, Math.floor(Number(previous.skipCredits ?? 0)))),
                };
                nextState.lastCompletedDate = dateISO;
            }
            nextState.challengeStats = statsMap;
            const ever = new Set(Array.isArray(state.everCompletedKeys) ? state.everCompletedKeys.map(String) : []);
            ever.add(`id:${challengeId}`);
            nextState.everCompletedKeys = Array.from(ever);
        }
        tx.set(stateRef, {
            ...document,
            schemaVersion: Number(document.schemaVersion ?? 1),
            clientUpdatedAtISO: now.toISOString(),
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
            state: nextState,
        });
        return { status: "completed", count: nextCount };
    });
}
exports.issueIosWidgetAccessGrant = (0, https_1.onCall)({ region: "europe-west1" }, async (request) => {
    const uid = assertAuth(request);
    const publicKeyBase64 = safeStr(request.data?.publicKeyBase64, 256);
    const keyId = safeStr(request.data?.keyId, 128);
    const raw = Buffer.from(publicKeyBase64, "base64");
    p256PublicKey(publicKeyBase64);
    if (!keyId || keyId !== sha256Hex(raw))
        throw new https_1.HttpsError("invalid-argument", "Widget key identifier mismatch.");
    const [existingForUid, existingForKey] = await Promise.all([
        db.collection(WIDGET_GRANTS).where("uid", "==", uid).get(),
        db.collection(WIDGET_GRANTS).where("keyId", "==", keyId).get(),
    ]);
    const batch = db.batch();
    const oldGrantRefs = new Map();
    [...existingForUid.docs, ...existingForKey.docs].forEach((grant) => oldGrantRefs.set(grant.ref.path, grant.ref));
    for (const grant of oldGrantRefs.values())
        batch.update(grant, { revokedAt: firestore_2.FieldValue.serverTimestamp() });
    const grantId = (0, node_crypto_1.randomUUID)();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + WIDGET_GRANT_TTL_MS);
    const rotateAfter = new Date(issuedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    batch.set(db.collection(WIDGET_GRANTS).doc(grantId), {
        uid, keyId, publicKeyBase64, createdAt: firestore_2.FieldValue.serverTimestamp(), issuedAtISO: issuedAt.toISOString(),
        expiresAtISO: expiresAt.toISOString(), rotateAfterISO: rotateAfter.toISOString(), revokedAt: null, recentNonces: [],
    });
    await batch.commit();
    return {
        grantId, uid, keyId, issuedAtISO: issuedAt.toISOString(),
        rotateAfterISO: rotateAfter.toISOString(), expiresAtISO: expiresAt.toISOString(),
    };
});
exports.revokeIosWidgetAccessGrants = (0, https_1.onCall)({ region: "europe-west1" }, async (request) => {
    const uid = assertAuth(request);
    const existing = await db.collection(WIDGET_GRANTS).where("uid", "==", uid).get();
    const batch = db.batch();
    for (const grant of existing.docs)
        batch.update(grant.ref, { revokedAt: firestore_2.FieldValue.serverTimestamp() });
    await batch.commit();
    return { ok: true, revoked: existing.size };
});
function widgetHttpStatus(error) {
    if (!(error instanceof https_1.HttpsError))
        return 500;
    if (error.code === "invalid-argument")
        return 400;
    if (error.code === "unauthenticated")
        return 401;
    if (error.code === "permission-denied")
        return 403;
    if (error.code === "not-found")
        return 404;
    if (error.code === "failed-precondition" || error.code === "already-exists")
        return 409;
    if (error.code === "unavailable")
        return 503;
    return 500;
}
exports.iosWidgetGateway = (0, https_1.onRequest)({ region: "europe-west1", secrets: [REVENUECAT_SECRET_API_KEY], timeoutSeconds: 15 }, async (request, response) => {
    try {
        if (request.method !== "POST") {
            response.status(405).json({ ok: false, permanent: true });
            return;
        }
        const body = request.body;
        const grantId = safeStr(body?.grantId, 128);
        const nonce = safeStr(body?.nonce, 128);
        const action = safeStr(body?.action, 32);
        const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};
        const payloadHash = safeStr(body?.payloadHash, 64);
        const signature = safeStr(body?.signature, 512);
        const timestamp = Math.floor(Number(body?.timestamp));
        if (!grantId || !/^[a-f0-9-]{20,128}$/i.test(nonce) || !["status", "complete"].includes(action)
            || !Number.isFinite(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300
            || payloadHash !== sha256Hex(stableJson(payload))) {
            throw new https_1.HttpsError("invalid-argument", "Invalid signed widget request.");
        }
        const grantRef = db.collection(WIDGET_GRANTS).doc(grantId);
        const grant = await db.runTransaction(async (tx) => {
            const snapshot = await tx.get(grantRef);
            if (!snapshot.exists)
                throw new https_1.HttpsError("unauthenticated", "Widget grant not found.");
            const value = snapshot.data();
            if (value.revokedAt || Date.parse(String(value.expiresAtISO ?? "")) <= Date.now()) {
                throw new https_1.HttpsError("unauthenticated", "Widget grant expired or revoked.");
            }
            const canonical = `v1\n${grantId}\n${timestamp}\n${nonce}\n${action}\n${payloadHash}`;
            const valid = (0, node_crypto_1.verify)("sha256", Buffer.from(canonical), p256PublicKey(String(value.publicKeyBase64 ?? "")), Buffer.from(signature, "base64"));
            if (!valid)
                throw new https_1.HttpsError("unauthenticated", "Invalid widget signature.");
            const recent = Array.isArray(value.recentNonces) ? value.recentNonces.map(String).slice(-39) : [];
            if (recent.includes(nonce))
                throw new https_1.HttpsError("already-exists", "Widget request was already used.");
            const grantExpiresAtISO = new Date(Date.now() + WIDGET_GRANT_TTL_MS).toISOString();
            tx.update(grantRef, { recentNonces: [...recent, nonce], expiresAtISO: grantExpiresAtISO, lastUsedAt: firestore_2.FieldValue.serverTimestamp() });
            return { uid: String(value.uid ?? ""), keyId: String(value.keyId ?? ""), grantExpiresAtISO };
        });
        if (!grant.uid)
            throw new https_1.HttpsError("unauthenticated", "Invalid widget grant scope.");
        const authUser = await (0, auth_1.getAuth)().getUser(grant.uid).catch(() => null);
        if (!authUser || authUser.disabled)
            throw new https_1.HttpsError("unauthenticated", "Widget account is no longer active.");
        const premium = await revenueCatPremium(grant.uid);
        if (action === "status") {
            response.status(200).json({ ok: true, status: "status", premium, grantExpiresAtISO: grant.grantExpiresAtISO });
            return;
        }
        if (premium.state !== "premium") {
            response.status(403).json({
                ok: false, permanent: true, status: "rejected", premium,
                grantExpiresAtISO: grant.grantExpiresAtISO,
            });
            return;
        }
        const timeZone = safeStr(payload.timeZoneIdentifier, 100);
        const dateISO = safeStr(payload.date, 10);
        const challengeId = safeStr(payload.challengeId, 160);
        const challengeType = safeStr(payload.challengeType, 16);
        const mutationId = safeStr(payload.mutationId, 300);
        const expectedDoneBefore = Math.floor(Number(payload.expectedDoneBefore));
        if (dateISO !== localDateInTimeZone(timeZone) || !Number.isInteger(expectedDoneBefore) || expectedDoneBefore < 0
            || mutationId !== `ios:${grant.uid}:${challengeType}:${challengeId}:${dateISO}:${expectedDoneBefore}`) {
            throw new https_1.HttpsError("failed-precondition", "Widget completion is not valid for today.");
        }
        const result = challengeType === "shared"
            ? await completeSharedChallengeForWidget(grant.uid, challengeId, dateISO, mutationId, expectedDoneBefore)
            : challengeType === "personal"
                ? await completePersonalChallengeForWidget(grant.uid, challengeId, dateISO, mutationId, expectedDoneBefore, timeZone)
                : (() => { throw new https_1.HttpsError("invalid-argument", "Invalid challenge type."); })();
        response.status(200).json({ ok: true, ...result, premium, grantExpiresAtISO: grant.grantExpiresAtISO });
    }
    catch (error) {
        const status = widgetHttpStatus(error);
        console.error("[ios-widget-gateway] request rejected", error instanceof https_1.HttpsError ? error.code : "internal");
        response.status(status).json({ ok: false, permanent: status >= 400 && status < 500, status: "rejected" });
    }
});
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
    const widgetGrants = await db.collection(WIDGET_GRANTS).where("uid", "==", uid).get();
    const widgetGrantBatch = db.batch();
    widgetGrants.docs.forEach((grant) => widgetGrantBatch.delete(grant.ref));
    await widgetGrantBatch.commit().catch(() => { });
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
        const challengeSnap = await tx.get(challengeRef);
        if (!challengeSnap.exists) {
            throw new https_1.HttpsError("not-found", "Spolecna vyzva nebyla nalezena.");
        }
        const data = challengeSnap.data();
        const inviteUpdate = (0, sharedChallengePermissions_1.prepareSharedChallengeMemberInviteUpdate)(data, uid, friendUid, MAX_SHARED_MEMBERS);
        const [mineFriendSnap, theirFriendSnap] = await Promise.all([
            tx.get(friendEdgeRef(uid, friendUid)),
            tx.get(friendEdgeRef(friendUid, uid)),
        ]);
        if (friendStatus(mineFriendSnap) !== "accepted" || friendStatus(theirFriendSnap) !== "accepted") {
            throw new https_1.HttpsError("failed-precondition", "Pozvat lze jen prijateho pritele.");
        }
        challengeTitle = safeStr(data?.title, 120) || challengeTitle;
        tx.set(challengeRef, {
            ...inviteUpdate,
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
