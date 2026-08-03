import { httpsCallable } from "firebase/functions";
import { Platform } from "react-native";
import { auth, functions } from "./firebase";
import {
  clearIosWidgetAccessGrant,
  prepareIosWidgetAccessKey,
  readIosWidgetAccessGrant,
  storeIosWidgetAccessGrant,
} from "./iosWidgetNative";

type PreparedKey = { keyId: string; publicKeyBase64: string };
type WidgetGrant = {
  grantId: string; uid: string; keyId: string; expiresAtISO: string;
  issuedAtISO?: string; rotateAfterISO?: string;
};

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

export async function ensureIosWidgetAccessGrant(uid: string): Promise<void> {
  if (Platform.OS !== "ios" || !uid || auth.currentUser?.uid !== uid) return;
  const current = parseJson<WidgetGrant>(await readIosWidgetAccessGrant());
  const prepared = parseJson<PreparedKey>(await prepareIosWidgetAccessKey());
  if (!prepared?.keyId || !prepared.publicKeyBase64) throw new Error("iOS widget signing key is unavailable");
  if (current?.uid === uid && current.keyId === prepared.keyId
      && Date.parse(current.expiresAtISO) > Date.now() + 24 * 60 * 60 * 1000
      && Date.parse(current.rotateAfterISO ?? "") > Date.now()) return;
  const issue = httpsCallable<PreparedKey, WidgetGrant>(functions, "issueIosWidgetAccessGrant");
  const response = await issue(prepared);
  if (response.data.uid !== uid || response.data.keyId !== prepared.keyId) {
    throw new Error("iOS widget grant scope mismatch");
  }
  await storeIosWidgetAccessGrant(JSON.stringify(response.data));
}

export async function revokeIosWidgetAccessGrant(): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    if (auth.currentUser?.uid) {
      const revoke = httpsCallable(functions, "revokeIosWidgetAccessGrants");
      await revoke({});
    }
  } finally {
    // A failed network revocation still destroys the non-exportable private
    // key locally. Server grants are short lived and become unusable here.
    await clearIosWidgetAccessGrant();
  }
}
