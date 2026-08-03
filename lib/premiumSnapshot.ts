import AsyncStorage from "@react-native-async-storage/async-storage";

export const PREMIUM_SNAPSHOT_SCHEMA = 2;
export const PREMIUM_SNAPSHOT_PREFIX = "onemore_premium_snapshot";

export type PremiumSnapshotSource = "customerInfo" | "purchase" | "restore" | "migration";
export type PremiumSnapshot = {
  schemaVersion: 2;
  uid: string;
  revenueCatAppUserId: string;
  isPremiumActive: boolean;
  expirationDate: string | null;
  willRenew: boolean | null;
  managementURL: string | null;
  checkedAt: string;
  source: PremiumSnapshotSource;
  entitlementIdentifier: string | null;
  isLifetime: boolean;
};

export type PremiumAccessState =
  | "unknown"
  | "restoringSession"
  | "checkingPremium"
  | "free"
  | "premium"
  | "errorWithValidCache"
  | "errorWithoutCache";

type Store = Pick<typeof AsyncStorage, "getItem" | "setItem">;
export const premiumSnapshotKey = (uid: string) => `${PREMIUM_SNAPSHOT_PREFIX}:${uid}`;

export function parsePremiumSnapshot(value: unknown, uid: string): PremiumSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<PremiumSnapshot>;
  if (item.schemaVersion !== PREMIUM_SNAPSHOT_SCHEMA || item.uid !== uid) return null;
  if (typeof item.revenueCatAppUserId !== "string" || item.revenueCatAppUserId !== uid) return null;
  if (typeof item.isPremiumActive !== "boolean" || typeof item.checkedAt !== "string") return null;
  if (item.expirationDate !== null && typeof item.expirationDate !== "string") return null;
  return {
    schemaVersion: PREMIUM_SNAPSHOT_SCHEMA,
    uid,
    revenueCatAppUserId: uid,
    isPremiumActive: item.isPremiumActive,
    expirationDate: item.expirationDate ?? null,
    willRenew: typeof item.willRenew === "boolean" ? item.willRenew : null,
    managementURL: typeof item.managementURL === "string" ? item.managementURL : null,
    checkedAt: item.checkedAt,
    source: item.source === "purchase" || item.source === "restore" || item.source === "migration" ? item.source : "customerInfo",
    entitlementIdentifier: typeof item.entitlementIdentifier === "string" ? item.entitlementIdentifier : null,
    isLifetime: item.isLifetime === true,
  };
}

export function isPremiumSnapshotActiveAt(snapshot: PremiumSnapshot, uid: string, now = Date.now()): boolean {
  if (snapshot.uid !== uid || snapshot.revenueCatAppUserId !== uid || !snapshot.isPremiumActive) return false;
  if (snapshot.isLifetime) return true;
  if (!snapshot.expirationDate) return false;
  const expiration = Date.parse(snapshot.expirationDate);
  return Number.isFinite(expiration) && expiration > now;
}

export function resolveCachedPremiumState(snapshot: PremiumSnapshot | null, uid: string, now = Date.now()): PremiumAccessState {
  if (!snapshot) return "checkingPremium";
  return isPremiumSnapshotActiveAt(snapshot, uid, now) ? "premium" : "checkingPremium";
}

export async function readPremiumSnapshot(uid: string, store: Store = AsyncStorage): Promise<PremiumSnapshot | null> {
  try {
    const raw = await store.getItem(premiumSnapshotKey(uid));
    return raw ? parsePremiumSnapshot(JSON.parse(raw), uid) : null;
  } catch {
    return null;
  }
}

export async function writePremiumSnapshot(snapshot: PremiumSnapshot, store: Store = AsyncStorage): Promise<void> {
  const valid = parsePremiumSnapshot(snapshot, snapshot.uid);
  if (!valid) throw new Error("INVALID_PREMIUM_SNAPSHOT");
  await store.setItem(premiumSnapshotKey(snapshot.uid), JSON.stringify(valid));
}
