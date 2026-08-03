"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareSharedChallengeMemberInviteUpdate = prepareSharedChallengeMemberInviteUpdate;
const https_1 = require("firebase-functions/v2/https");
function uniqueStringList(value) {
    if (!Array.isArray(value))
        return [];
    return Array.from(new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean)));
}
function prepareSharedChallengeMemberInviteUpdate(challenge, requesterUid, friendUid, maxMembers) {
    const safeRequesterUid = String(requesterUid ?? "").trim();
    const safeFriendUid = String(friendUid ?? "").trim();
    const founderUid = String(challenge.createdBy ?? "").trim();
    const memberUids = uniqueStringList(challenge.memberUids);
    const acceptedBy = uniqueStringList(challenge.acceptedBy);
    const pendingInviteUids = uniqueStringList(challenge.pendingInviteUids);
    const leftBy = uniqueStringList(challenge.leftBy);
    if (!founderUid || safeRequesterUid !== founderUid) {
        throw new https_1.HttpsError("permission-denied", "Do spolecne vyzvy muze zvat pouze jeji puvodni zakladatel.");
    }
    if (!memberUids.includes(safeRequesterUid) || !acceptedBy.includes(safeRequesterUid)) {
        throw new https_1.HttpsError("permission-denied", "Zakladatel neni aktivnim prijatym ucastnikem teto vyzvy.");
    }
    if (challenge.enabled === false || challenge.status === "declined") {
        throw new https_1.HttpsError("failed-precondition", "Tato vyzva uz neni aktivni.");
    }
    if (pendingInviteUids.includes(safeFriendUid)) {
        throw new https_1.HttpsError("already-exists", "Tento uzivatel uz ma pozvanku.");
    }
    if (memberUids.includes(safeFriendUid)) {
        throw new https_1.HttpsError("already-exists", "Tento uzivatel uz je ucastnik.");
    }
    if (uniqueStringList([...memberUids, ...pendingInviteUids, safeFriendUid]).length > maxMembers) {
        throw new https_1.HttpsError("failed-precondition", "Spolecna vyzva uz ma maximalni pocet clenu.");
    }
    return {
        acceptedBy: acceptedBy.filter((memberUid) => memberUid !== safeFriendUid),
        pendingInviteUids: uniqueStringList([...pendingInviteUids, safeFriendUid]),
        leftBy: leftBy.filter((memberUid) => memberUid !== safeFriendUid),
    };
}
