import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth } from "./firebase";
import { Platform } from "react-native";
import { isWidgetPremiumCacheActiveAt } from "./widgetAccess";
import { isPremiumSnapshotActiveAt, readPremiumSnapshot, writePremiumSnapshot, type PremiumSnapshot, type PremiumSnapshotSource } from "./premiumSnapshot";
import { readAccountSnapshot, writeAccountSnapshot } from "./accountSnapshot";

export const PREMIUM_KEY = "onemore_premium_active";

export type PremiumCache = {
  uid: string;
  isPremium: boolean;
  entitlementId: string | null;
  expiresDate: string | null;
  lastVerifiedAt: string;
};

type PremiumListener = (active: boolean) => void;
const listeners = new Set<PremiumListener>();

let expirationTimer: ReturnType<typeof setTimeout> | null = null;
let currentVerifiedPremium: boolean | null = null;
let currentVerifiedUid: string | null = null;

// Intentional owner/developer Premium override, independent of RevenueCat.
const OWNER_DEVELOPER_UID = "1MPxefEFRqhFoqaNnt6nuQjsJCC3";

export function subscribePremium(listener: PremiumListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(v: boolean) {
  for (const listener of Array.from(listeners)) {
    try {
      listener(v);
    } catch {}
  }
  if (Platform.OS === "android" || Platform.OS === "ios") {
    void import("../widgets/widgetService")
      .then(({ updateAllOneMoreWidgets }) => updateAllOneMoreWidgets())
      .catch(() => {});
  }
}

function isOwner(uid = auth.currentUser?.uid ?? null): boolean {
  return uid === OWNER_DEVELOPER_UID;
}

function premiumKeyForUid(uid: string): string {
  return `${PREMIUM_KEY}:${uid}`;
}

function parseFutureExpiration(expiresDate: string | null): number | null {
  if (!expiresDate) return null;

  const expiresAt = Date.parse(expiresDate);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  return expiresAt;
}

export function isPremiumCacheActiveAt(cache: PremiumCache, uid: string, now = Date.now()): boolean {
  return isWidgetPremiumCacheActiveAt(cache, uid, now);
}

function isCacheActive(cache: PremiumCache, uid: string): boolean {
  return isPremiumCacheActiveAt(cache, uid);
}

async function readPremiumCache(uid: string): Promise<PremiumCache | null> {
  try {
    const raw = await AsyncStorage.getItem(premiumKeyForUid(uid));
    if (!raw || raw === "1") return null;

    const parsed = JSON.parse(raw) as Partial<PremiumCache>;
    if (
      parsed.uid !== uid ||
      typeof parsed.isPremium !== "boolean" ||
      typeof parsed.lastVerifiedAt !== "string"
    ) {
      return null;
    }

    return {
      uid,
      isPremium: parsed.isPremium,
      entitlementId:
        typeof parsed.entitlementId === "string" ? parsed.entitlementId : null,
      expiresDate: typeof parsed.expiresDate === "string" ? parsed.expiresDate : null,
      lastVerifiedAt: parsed.lastVerifiedAt,
    };
  } catch {
    return null;
  }
}

/** Security boundary for Android widget rendering/clicks. Always re-reads UID-scoped cache. */
export async function isPremiumConfirmedForUid(uid: string): Promise<boolean> {
  if (!uid) return false;
  if (isOwner(uid)) return true;
  const snapshot = await readPremiumSnapshot(uid);
  if (snapshot) return isPremiumSnapshotActiveAt(snapshot, uid);
  const cache = await readPremiumCache(uid);
  if (!cache) return false;
  await writePremiumSnapshot({
    schemaVersion: 2, uid, revenueCatAppUserId: uid, isPremiumActive: cache.isPremium,
    expirationDate: cache.expiresDate, willRenew: null, managementURL: null,
    checkedAt: cache.lastVerifiedAt, source: "migration", entitlementIdentifier: cache.entitlementId,
    isLifetime: false,
  }).catch(() => {});
  return isCacheActive(cache, uid);
}

export { readPremiumSnapshot } from "./premiumSnapshot";

function clearExpirationTimer() {
  if (expirationTimer) {
    clearTimeout(expirationTimer);
    expirationTimer = null;
  }
}

function scheduleExpiration(expiresDate: string | null, uid: string) {
  clearExpirationTimer();

  const expiresAt = parseFutureExpiration(expiresDate);
  if (expiresAt === null) return;

  const maxDelay = 2_147_000_000;
  const delay = Math.min(expiresAt - Date.now() + 250, maxDelay);

  expirationTimer = setTimeout(() => {
    expirationTimer = null;
    void (async () => {
      const cache = await readPremiumCache(uid);
      if (
        auth.currentUser?.uid !== uid ||
        !cache ||
        cache.expiresDate !== expiresDate
      ) {
        return;
      }

      if (isCacheActive(cache, uid)) {
        scheduleExpiration(cache.expiresDate, uid);
        return;
      }

      await AsyncStorage.setItem(
        premiumKeyForUid(uid),
        JSON.stringify({ ...cache, isPremium: false })
      ).catch(() => {});
      if (auth.currentUser?.uid !== uid) return;
      currentVerifiedPremium = false;
      currentVerifiedUid = uid;
      emit(false);
    })();
  }, Math.max(delay, 0));
}

export async function isPremiumActive(): Promise<boolean> {
  const uid = auth.currentUser?.uid ?? null;
  if (!uid) return false;
  if (isOwner(uid)) return true;
  if (currentVerifiedUid === uid && currentVerifiedPremium !== null) {
    return currentVerifiedPremium;
  }

  const snapshot = await readPremiumSnapshot(uid);
  if (snapshot) {
    const active = isPremiumSnapshotActiveAt(snapshot, uid);
    currentVerifiedPremium = active;
    currentVerifiedUid = uid;
    if (active) scheduleExpiration(snapshot.expirationDate, uid);
    emit(active);
    return active;
  }

  const cache = await readPremiumCache(uid);
  if (!cache) {
    currentVerifiedPremium = false;
    currentVerifiedUid = uid;
    emit(false);
    return false;
  }

  const active = isCacheActive(cache, uid);
  if (auth.currentUser?.uid !== uid) return false;

  currentVerifiedPremium = active;
  currentVerifiedUid = uid;
  if (active) scheduleExpiration(cache.expiresDate, uid);
  emit(active);

  return active;
}

export async function applyPremiumEntitlement(params: {
  uid: string;
  isPremium: boolean;
  entitlementId: string | null;
  expiresDate: string | null;
  lastVerifiedAt?: string;
  revenueCatAppUserId?: string;
  willRenew?: boolean | null;
  managementURL?: string | null;
  source?: PremiumSnapshotSource;
  isLifetime?: boolean;
}): Promise<void> {
  const uid = params.uid;
  if (!uid || auth.currentUser?.uid !== uid) return;

  if (isOwner(uid)) {
    currentVerifiedPremium = true;
    currentVerifiedUid = uid;
    emit(true);
    return;
  }

  const cache: PremiumCache = {
    uid,
    isPremium: params.isPremium,
    entitlementId: params.entitlementId,
    expiresDate: params.expiresDate,
    lastVerifiedAt: params.lastVerifiedAt ?? new Date().toISOString(),
  };

  const snapshot: PremiumSnapshot = {
    schemaVersion: 2,
    uid,
    revenueCatAppUserId: params.revenueCatAppUserId ?? uid,
    isPremiumActive: params.isPremium,
    expirationDate: params.expiresDate,
    willRenew: params.willRenew ?? null,
    managementURL: params.managementURL ?? null,
    checkedAt: params.lastVerifiedAt ?? new Date().toISOString(),
    source: params.source ?? "customerInfo",
    entitlementIdentifier: params.entitlementId,
    isLifetime: params.isLifetime === true,
  };

  try {
    await AsyncStorage.setItem(premiumKeyForUid(uid), JSON.stringify(cache));
    await writePremiumSnapshot(snapshot);
    const previousAccount = await readAccountSnapshot(uid);
    await writeAccountSnapshot({
      activeUid: uid,
      displayNameFallback: auth.currentUser?.displayName?.trim() || previousAccount?.displayNameFallback || null,
      premiumState: params.isPremium ? "premium" : "free",
      expirationDate: params.expiresDate,
      lifetime: params.isLifetime === true,
      willRenew: params.willRenew ?? null,
      managementURL: params.managementURL ?? null,
      checkedAt: params.lastVerifiedAt ?? new Date().toISOString(),
    });
  } catch {}

  if (auth.currentUser?.uid !== uid) return;

  currentVerifiedPremium = params.isPremium;
  currentVerifiedUid = uid;
  if (params.isPremium) scheduleExpiration(params.expiresDate, uid);
  else clearExpirationTimer();

  emit(params.isPremium);
}

export async function clearPremiumState(): Promise<void> {
  const uid = auth.currentUser?.uid ?? null;
  if (isOwner(uid)) {
    emit(true);
    return;
  }

  clearExpirationTimer();
  currentVerifiedPremium = false;
  currentVerifiedUid = uid;

  try {
    await AsyncStorage.multiRemove([
      PREMIUM_KEY,
      ...(uid ? [premiumKeyForUid(uid)] : []),
    ]);
  } catch {}

  emit(false);
}

export function resetPremiumStateForAuthChange(): void {
  clearExpirationTimer();
  currentVerifiedPremium = false;
  currentVerifiedUid = null;
  void AsyncStorage.removeItem(PREMIUM_KEY).catch(() => {});
  emit(false);
}

/** Compatibility with older callers. RevenueCat should use applyPremiumEntitlement. */
export async function setPremiumActive(v: boolean): Promise<void> {
  if (!v) return clearPremiumState();

  // Never create indefinite Premium without a verified expiration date.
  emit(isOwner());
}

/** Re-read the cached state and publish it to the UI. */
export async function restorePremium(): Promise<boolean> {
  const active = await isPremiumActive();
  emit(active);
  return active;
}
