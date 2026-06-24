import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth } from "./firebase";

export const PREMIUM_KEY = "onemore_premium_active";

export type PremiumCache = {
  isPremium: boolean;
  entitlementId: string | null;
  expiresDate: string | null;
  lastVerifiedAt: string;
};

type PremiumListener = (active: boolean) => void;
const listeners = new Set<PremiumListener>();

let expirationTimer: ReturnType<typeof setTimeout> | null = null;
let currentVerifiedPremium: boolean | null = null;

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
}

function isOwner(): boolean {
  return auth.currentUser?.uid === OWNER_DEVELOPER_UID;
}

function parseFutureExpiration(expiresDate: string | null): number | null {
  if (!expiresDate) return null;

  const expiresAt = Date.parse(expiresDate);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  return expiresAt;
}

function isCacheActive(cache: PremiumCache): boolean {
  return cache.isPremium === true && parseFutureExpiration(cache.expiresDate) !== null;
}

async function readPremiumCache(): Promise<PremiumCache | null> {
  try {
    const raw = await AsyncStorage.getItem(PREMIUM_KEY);
    if (!raw || raw === "1") return null;

    const parsed = JSON.parse(raw) as Partial<PremiumCache>;
    if (typeof parsed.isPremium !== "boolean" || typeof parsed.lastVerifiedAt !== "string") {
      return null;
    }

    return {
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

function clearExpirationTimer() {
  if (expirationTimer) {
    clearTimeout(expirationTimer);
    expirationTimer = null;
  }
}

function scheduleExpiration(expiresDate: string | null) {
  clearExpirationTimer();

  const expiresAt = parseFutureExpiration(expiresDate);
  if (expiresAt === null) return;

  const maxDelay = 2_147_000_000;
  const delay = Math.min(expiresAt - Date.now() + 250, maxDelay);

  expirationTimer = setTimeout(() => {
    expirationTimer = null;
    void (async () => {
      const cache = await readPremiumCache();
      if (!cache || cache.expiresDate !== expiresDate) return;

      if (isCacheActive(cache)) {
        scheduleExpiration(cache.expiresDate);
        return;
      }

      await AsyncStorage.setItem(
        PREMIUM_KEY,
        JSON.stringify({ ...cache, isPremium: false })
      ).catch(() => {});
      currentVerifiedPremium = false;
      emit(false);
    })();
  }, Math.max(delay, 0));
}

export async function isPremiumActive(): Promise<boolean> {
  if (isOwner()) return true;
  if (currentVerifiedPremium !== null) return currentVerifiedPremium;

  const cache = await readPremiumCache();
  if (!cache) return false;

  const active = isCacheActive(cache);
  currentVerifiedPremium = active;
  if (active) scheduleExpiration(cache.expiresDate);

  return active;
}

export async function applyPremiumEntitlement(params: {
  isPremium: boolean;
  entitlementId: string | null;
  expiresDate: string | null;
  lastVerifiedAt?: string;
}): Promise<void> {
  if (isOwner()) {
    emit(true);
    return;
  }

  const cache: PremiumCache = {
    isPremium: params.isPremium,
    entitlementId: params.entitlementId,
    expiresDate: params.expiresDate,
    lastVerifiedAt: params.lastVerifiedAt ?? new Date().toISOString(),
  };

  try {
    await AsyncStorage.setItem(PREMIUM_KEY, JSON.stringify(cache));
  } catch {}

  currentVerifiedPremium = params.isPremium;
  if (params.isPremium) scheduleExpiration(params.expiresDate);
  else clearExpirationTimer();

  emit(params.isPremium);
}

export async function clearPremiumState(): Promise<void> {
  if (isOwner()) {
    emit(true);
    return;
  }

  clearExpirationTimer();
  currentVerifiedPremium = false;

  try {
    await AsyncStorage.removeItem(PREMIUM_KEY);
  } catch {}

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
