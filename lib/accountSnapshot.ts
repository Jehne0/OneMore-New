import AsyncStorage from "@react-native-async-storage/async-storage";
import { getNativeAccountSnapshot, setNativeAccountSnapshot } from "./widgetSessionNative";

export const ACCOUNT_SNAPSHOT_SCHEMA = 1;
export const ACCOUNT_SNAPSHOT_PREFIX = "onemore_account_snapshot";
export type AccountPremiumState = "checking" | "free" | "premium";
export type AccountSnapshot = {
  schemaVersion: 1;
  activeUid: string;
  displayNameFallback: string | null;
  premiumState: AccountPremiumState;
  expirationDate: string | null;
  lifetime: boolean;
  willRenew: boolean | null;
  managementURL: string | null;
  checkedAt: string;
  stateRevision: number;
};

type Store = Pick<typeof AsyncStorage, "getItem" | "setItem" | "removeItem">;
const key = (uid: string) => `${ACCOUNT_SNAPSHOT_PREFIX}:${uid}`;

export function parseAccountSnapshot(value: unknown, uid: string): AccountSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<AccountSnapshot>;
  if (item.schemaVersion !== 1 || item.activeUid !== uid || !Number.isSafeInteger(item.stateRevision) || (item.stateRevision ?? -1) < 0) return null;
  if (item.premiumState !== "checking" && item.premiumState !== "free" && item.premiumState !== "premium") return null;
  if (item.expirationDate !== null && typeof item.expirationDate !== "string") return null;
  if (typeof item.checkedAt !== "string") return null;
  return {
    schemaVersion: 1, activeUid: uid,
    displayNameFallback: typeof item.displayNameFallback === "string" && item.displayNameFallback.trim() ? item.displayNameFallback.trim() : null,
    premiumState: item.premiumState,
    expirationDate: item.expirationDate ?? null,
    lifetime: item.lifetime === true,
    willRenew: typeof item.willRenew === "boolean" ? item.willRenew : null,
    managementURL: typeof item.managementURL === "string" ? item.managementURL : null,
    checkedAt: item.checkedAt,
    stateRevision: item.stateRevision!,
  };
}

export function isAccountSnapshotPremiumAt(snapshot: AccountSnapshot, now = Date.now()): boolean {
  if (snapshot.premiumState !== "premium") return false;
  if (snapshot.lifetime) return true;
  if (!snapshot.expirationDate) return false;
  const expiration = Date.parse(snapshot.expirationDate);
  return Number.isFinite(expiration) && expiration > now;
}

export function resolveAccountPremiumBootstrapState(snapshot: AccountSnapshot | null, now = Date.now()): AccountPremiumState {
  if (!snapshot || snapshot.premiumState === "checking") return "checking";
  return isAccountSnapshotPremiumAt(snapshot, now) ? "premium" : "free";
}

export async function readAccountSnapshot(uid: string, store: Store = AsyncStorage): Promise<AccountSnapshot | null> {
  try {
    const nativeRaw = await getNativeAccountSnapshot(uid);
    if (nativeRaw) {
      const parsed = parseAccountSnapshot(JSON.parse(nativeRaw), uid);
      if (parsed) return parsed;
    }
    const asyncRaw = await store.getItem(key(uid));
    if (!asyncRaw) return null;
    const parsed = parseAccountSnapshot(JSON.parse(asyncRaw), uid);
    if (parsed && nativeRaw !== undefined) await setNativeAccountSnapshot(uid, JSON.stringify(parsed)).catch(() => {});
    return parsed;
  } catch { return null; }
}

export async function writeAccountSnapshot(input: Omit<AccountSnapshot, "schemaVersion" | "stateRevision">, store: Store = AsyncStorage): Promise<AccountSnapshot> {
  const previous = await readAccountSnapshot(input.activeUid, store);
  const snapshot: AccountSnapshot = { ...input, schemaVersion: 1, stateRevision: (previous?.stateRevision ?? 0) + 1 };
  const serialized = JSON.stringify(snapshot);
  await store.setItem(key(input.activeUid), serialized);
  await setNativeAccountSnapshot(input.activeUid, serialized);
  return snapshot;
}

export async function updateAccountDisplayName(uid: string, displayName: string | null, store: Store = AsyncStorage) {
  const previous = await readAccountSnapshot(uid, store);
  return writeAccountSnapshot({
    activeUid: uid, displayNameFallback: displayName?.trim() || previous?.displayNameFallback || null,
    premiumState: previous?.premiumState ?? "checking", expirationDate: previous?.expirationDate ?? null,
    lifetime: previous?.lifetime ?? false, willRenew: previous?.willRenew ?? null,
    managementURL: previous?.managementURL ?? null, checkedAt: previous?.checkedAt ?? new Date().toISOString(),
  }, store);
}

export async function clearAccountSnapshot(uid: string, store: Store = AsyncStorage) {
  await store.removeItem(key(uid));
  await setNativeAccountSnapshot(uid, null);
}
