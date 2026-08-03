import { HttpsError } from "firebase-functions/v2/https";

type SharedChallengeInviteData = {
  createdBy?: unknown;
  memberUids?: unknown;
  acceptedBy?: unknown;
  pendingInviteUids?: unknown;
  leftBy?: unknown;
  enabled?: unknown;
  status?: unknown;
};

export type SharedChallengeMemberInviteUpdate = {
  acceptedBy: string[];
  pendingInviteUids: string[];
  leftBy: string[];
};

function uniqueStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))
  );
}

export function prepareSharedChallengeMemberInviteUpdate(
  challenge: SharedChallengeInviteData,
  requesterUid: string,
  friendUid: string,
  maxMembers: number
): SharedChallengeMemberInviteUpdate {
  const safeRequesterUid = String(requesterUid ?? "").trim();
  const safeFriendUid = String(friendUid ?? "").trim();
  const founderUid = String(challenge.createdBy ?? "").trim();
  const memberUids = uniqueStringList(challenge.memberUids);
  const acceptedBy = uniqueStringList(challenge.acceptedBy);
  const pendingInviteUids = uniqueStringList(challenge.pendingInviteUids);
  const leftBy = uniqueStringList(challenge.leftBy);

  if (!founderUid || safeRequesterUid !== founderUid) {
    throw new HttpsError(
      "permission-denied",
      "Do spolecne vyzvy muze zvat pouze jeji puvodni zakladatel."
    );
  }

  if (!memberUids.includes(safeRequesterUid) || !acceptedBy.includes(safeRequesterUid)) {
    throw new HttpsError(
      "permission-denied",
      "Zakladatel neni aktivnim prijatym ucastnikem teto vyzvy."
    );
  }

  if (challenge.enabled === false || challenge.status === "declined") {
    throw new HttpsError("failed-precondition", "Tato vyzva uz neni aktivni.");
  }

  if (pendingInviteUids.includes(safeFriendUid)) {
    throw new HttpsError("already-exists", "Tento uzivatel uz ma pozvanku.");
  }

  if (memberUids.includes(safeFriendUid)) {
    throw new HttpsError("already-exists", "Tento uzivatel uz je ucastnik.");
  }

  if (uniqueStringList([...memberUids, ...pendingInviteUids, safeFriendUid]).length > maxMembers) {
    throw new HttpsError("failed-precondition", "Spolecna vyzva uz ma maximalni pocet clenu.");
  }

  return {
    acceptedBy: acceptedBy.filter((memberUid) => memberUid !== safeFriendUid),
    pendingInviteUids: uniqueStringList([...pendingInviteUids, safeFriendUid]),
    leftBy: leftBy.filter((memberUid) => memberUid !== safeFriendUid),
  };
}
