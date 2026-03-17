import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import type { AppState } from "./storage";

export type CloudUserDoc = {
  schemaVersion: number;
  clientUpdatedAtISO: string;
  updatedAt: any;
  state: AppState;
};

export function userDocRef(uid: string) {
  return doc(db, "users", uid);
}

export async function fetchCloudState(uid: string): Promise<CloudUserDoc | null> {
  const snap = await getDoc(userDocRef(uid));
  if (!snap.exists()) return null;
  return snap.data() as any;
}

export async function writeCloudState(uid: string, state: AppState, clientUpdatedAtISO: string): Promise<void> {
  const payload: CloudUserDoc = {
    schemaVersion: 1,
    clientUpdatedAtISO,
    updatedAt: serverTimestamp(),
    state,
  };
  await setDoc(userDocRef(uid), payload, { merge: true });
}

export async function deleteCloudUserDoc(uid: string): Promise<void> {
  await deleteDoc(userDocRef(uid));
}
