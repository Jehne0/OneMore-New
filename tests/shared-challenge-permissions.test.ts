import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canInviteSharedChallengeMembers } from "../lib/sharedChallengePermissions";
import { prepareSharedChallengeMemberInviteUpdate } from "../functions/src/sharedChallengePermissions";

const founderUid = "founder-uid";
const memberUid = "accepted-member-uid";
const friendUid = "friend-uid";

const activeChallenge = {
  id: "shared-challenge-1",
  createdBy: founderUid,
  // The accepted member is deliberately first: order must never grant founder rights.
  memberUids: [memberUid, founderUid],
  acceptedBy: [memberUid, founderUid],
  pendingInviteUids: [] as string[],
  leftBy: [] as string[],
  enabled: true,
  status: "active" as const,
};

test("only the canonical founder can see and use the existing-challenge invite action", () => {
  assert.equal(canInviteSharedChallengeMembers(activeChallenge, founderUid), true);
  assert.equal(canInviteSharedChallengeMembers(activeChallenge, memberUid), false);

  const update = prepareSharedChallengeMemberInviteUpdate(
    activeChallenge,
    founderUid,
    friendUid,
    10
  );
  assert.deepEqual(update.pendingInviteUids, [friendUid]);
});

test("an accepted member direct backend call fails with a safe permission error", () => {
  assert.throws(
    () => prepareSharedChallengeMemberInviteUpdate(activeChallenge, memberUid, friendUid, 10),
    (error: any) => {
      assert.equal(error?.code, "permission-denied");
      return true;
    }
  );
});

test("the founder can invite a user again after that user leaves", () => {
  const afterLeave = {
    ...activeChallenge,
    memberUids: [memberUid, founderUid],
    acceptedBy: [memberUid, founderUid],
    pendingInviteUids: [],
    leftBy: [friendUid],
  };

  const update = prepareSharedChallengeMemberInviteUpdate(
    afterLeave,
    founderUid,
    friendUid,
    10
  );
  assert.deepEqual(update.pendingInviteUids, [friendUid]);
  assert.deepEqual(update.leftBy, []);
});

test("the callable enforces createdBy and never derives the founder from member order", async () => {
  const [callableSource, permissionSource, sharedSource, rules] = await Promise.all([
    readFile("functions/src/index.ts", "utf8"),
    readFile("functions/src/sharedChallengePermissions.ts", "utf8"),
    readFile("lib/sharedChallenges.ts", "utf8"),
    readFile("firestore.rules", "utf8"),
  ]);

  const inviteSection = callableSource.slice(
    callableSource.indexOf("export const inviteSharedChallengeMember"),
    callableSource.indexOf("export const acceptSharedChallengeMemberInvite")
  );

  assert.match(inviteSection, /prepareSharedChallengeMemberInviteUpdate\(\s*data,\s*uid,/);
  assert.match(permissionSource, /founderUid = String\(challenge\.createdBy/);
  assert.doesNotMatch(permissionSource, /memberUids\s*\[\s*0\s*\]/);
  assert.match(sharedSource, /createdBy:\s*uid/);
  assert.match(rules, /request\.resource\.data\.createdBy == request\.auth\.uid/);
  assert.match(rules, /request\.resource\.data\.createdBy == resource\.data\.createdBy/);
});

test("accept, decline, and leave membership transitions remain intact", async () => {
  const [backendSource, clientSource] = await Promise.all([
    readFile("functions/src/index.ts", "utf8"),
    readFile("lib/sharedChallenges.ts", "utf8"),
  ]);

  const acceptSection = backendSource.slice(
    backendSource.indexOf("export const acceptSharedChallengeMemberInvite"),
    backendSource.indexOf("export const declineSharedChallengeMemberInvite")
  );
  const declineSection = backendSource.slice(
    backendSource.indexOf("export const declineSharedChallengeMemberInvite"),
    backendSource.indexOf("export const notifySharedChallengeCreated")
  );
  const leaveSection = clientSource.slice(
    clientSource.indexOf("export async function leaveSharedChallenge"),
    clientSource.indexOf("export async function inviteSharedChallengeMember")
  );

  assert.match(acceptSection, /pendingInviteUids\.includes\(uid\)/);
  assert.match(acceptSection, /nextMemberUids = alreadyMember \? memberUids : \[\.\.\.memberUids, uid\]/);
  assert.match(acceptSection, /nextAcceptedBy = uniqueUids\(\[\.\.\.acceptedBy, uid\]\)/);
  assert.match(acceptSection, /pendingInviteUids\.filter\(\(memberUid\) => memberUid !== uid\)/);

  assert.match(declineSection, /pendingInviteUids\.includes\(uid\)/);
  assert.match(declineSection, /pendingInviteUids\.filter\(\(memberUid\) => memberUid !== uid\)/);

  assert.match(leaveSection, /memberUids\.filter\(\(memberUid\) => memberUid !== uid\)/);
  assert.match(leaveSection, /acceptedBy \?\? \[\]\)\.filter\(\(memberUid\) => memberUid !== uid\)/);
  assert.match(leaveSection, /pendingInviteUids \?\? \[\]\)\.filter\(/);
});
