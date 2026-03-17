import { httpsCallable } from "firebase/functions";
import { auth, functions } from "./firebase";

export type InviteDoc = {
  id: string;
  createdBy: string;
  createdAt?: any;
  usedBy?: string | null;
  usedAt?: any;
  expiresAt?: any;
};

function myUid() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Nejsi přihlášený.");
  return uid;
}

/**
 * Creates a shareable friend invite via Cloud Function.
 * QR should contain the inviteId (or a deep link that includes it).
 */
export async function createInviteToken() {
  myUid();
  const call = httpsCallable(functions, "createFriendInvite");
  const res: any = await call({});
  const inviteId = String((res?.data as any)?.inviteId ?? "").trim();
  if (!inviteId) throw new Error("Nepodařilo se vytvořit pozvánku.");
  return inviteId;
}

/**
 * Redeem an invite token (inviteId) via Cloud Function.
 * Po úspěchu se uživatelé ihned přidají jako přátelé (accepted).
 */
export async function redeemInviteToken(tokenRaw: string) {
  myUid();
  const inviteId = tokenRaw.trim();
  if (!inviteId) throw new Error("Pozvánka je prázdná.");
  const call = httpsCallable(functions, "acceptFriendInvite");
  await call({ inviteId });
}
