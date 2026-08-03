import type { SharedChallenge } from "./sharedChallenges";

type SharedChallengeInvitePermissionData = Pick<
  SharedChallenge,
  | "id"
  | "createdBy"
  | "memberUids"
  | "acceptedBy"
  | "pendingInviteUids"
  | "leftBy"
  | "enabled"
  | "status"
>;

export function isSharedChallengeFounder(
  challenge: Pick<SharedChallenge, "createdBy">,
  uid: string
): boolean {
  const safeUid = String(uid ?? "").trim();
  return !!safeUid && String(challenge.createdBy ?? "").trim() === safeUid;
}

export function canInviteSharedChallengeMembers(
  challenge: SharedChallengeInvitePermissionData,
  uid: string
): boolean {
  const safeUid = String(uid ?? "").trim();
  if (!safeUid || !String(challenge.id ?? "").trim()) return false;
  if (!isSharedChallengeFounder(challenge, safeUid)) return false;
  if (challenge.enabled === false || challenge.status !== "active") return false;
  if (!Array.isArray(challenge.memberUids) || !challenge.memberUids.includes(safeUid)) return false;
  if (!Array.isArray(challenge.acceptedBy) || !challenge.acceptedBy.includes(safeUid)) return false;
  if (challenge.pendingInviteUids?.includes(safeUid)) return false;
  if (challenge.leftBy?.includes(safeUid)) return false;
  return true;
}
