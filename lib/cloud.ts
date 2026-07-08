import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import type { AppState } from "./storage";

export const APP_STATE_SCHEMA_VERSION = 1;
export const APP_STATE_DOC_ID = "main";

export type CloudUserDoc = {
  schemaVersion: number;
  clientUpdatedAtISO: string;
  updatedAt: unknown;
  state: AppState;
};

export type CloudAppStateDoc = CloudUserDoc;

export function appStateDocRef(uid: string) {
  return doc(db, "users", uid, "appState", APP_STATE_DOC_ID);
}

function stateForFirestore(state: AppState): AppState {
  return JSON.parse(JSON.stringify(state)) as AppState;
}

export async function fetchCloudState(uid: string): Promise<CloudAppStateDoc | null> {
  const snap = await getDoc(appStateDocRef(uid));
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<CloudAppStateDoc>;
  if (!data?.state) return null;

  return {
    schemaVersion: Number(data.schemaVersion ?? APP_STATE_SCHEMA_VERSION),
    clientUpdatedAtISO:
      typeof data.clientUpdatedAtISO === "string" ? data.clientUpdatedAtISO : "",
    updatedAt: data.updatedAt,
    state: data.state as AppState,
  };
}

export async function writeCloudState(uid: string, state: AppState, clientUpdatedAtISO: string): Promise<void> {
  const payload: CloudAppStateDoc = {
    schemaVersion: APP_STATE_SCHEMA_VERSION,
    clientUpdatedAtISO,
    updatedAt: serverTimestamp(),
    state: stateForFirestore(state),
  };
  await setDoc(appStateDocRef(uid), payload, { merge: true });
}

export async function deleteCloudUserDoc(uid: string): Promise<void> {
  await deleteDoc(appStateDocRef(uid));
}
