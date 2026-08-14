// lib/cloudState.ts
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { APP_STATE_DOC_ID } from "./cloud";
import type { AppState } from "./storage";
import { assertCloudAccessVerified } from "./cloudAccessGate";

const USER_STATE_VERSION = 1;

type CloudStateDoc = {
  version: number;
  state: AppState;
  updatedAt: unknown;
};

function uidOrThrow(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");
  return uid;
}

export function userStateDocRef() {
  const uid = uidOrThrow();
  return doc(db, "users", uid, "appState", APP_STATE_DOC_ID);
}

/**
 * Načte state z cloudu (nebo null, pokud ještě neexistuje).
 */
export async function loadCloudState(): Promise<{ state: AppState; updatedAtMillis: number } | null> {
  assertCloudAccessVerified();
  const ref = userStateDocRef();
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const data = snap.data() as Partial<CloudStateDoc>;
  if (!data?.state) return null;

  // Firestore Timestamp -> millis
  const ts: any = (data as any).updatedAt;
  const updatedAtMillis =
    typeof ts?.toMillis === "function" ? ts.toMillis() : Date.now();

  return { state: data.state as AppState, updatedAtMillis };
}

/**
 * Uloží state do cloudu (merge).
 */
export async function saveCloudState(state: AppState): Promise<void> {
  assertCloudAccessVerified();
  const ref = userStateDocRef();
  const payload: CloudStateDoc = {
    version: USER_STATE_VERSION,
    state: JSON.parse(JSON.stringify(state)) as AppState,
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, payload, { merge: true });
}
