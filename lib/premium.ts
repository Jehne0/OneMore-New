import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth } from "./firebase";

export const PREMIUM_KEY = "onemore_premium_active";

/**
 * Premium flag uložený lokálně.
 * Owner účet má vždy Premium.
 */

type PremiumListener = (active: boolean) => void;
const listeners = new Set<PremiumListener>();

// 🔒 SEM DEJ SVÉ UID z Firebase Auth
const OWNER_UID = "SEM_TVE_UID";

export function subscribePremium(listener: PremiumListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(v: boolean) {
  for (const l of Array.from(listeners)) {
    try {
      l(v);
    } catch {}
  }
}

function isOwner(): boolean {
  return auth.currentUser?.uid === "1MPxefEFRqhFoqaNnt6nuQjsJCC3";
}

export async function isPremiumActive(): Promise<boolean> {
  if (isOwner()) return true;

  try {
    const v = await AsyncStorage.getItem(PREMIUM_KEY);
    return v === "1";
  } catch {
    return false;
  }
}

/** kompatibilita se starším kódem */
export async function setPremiumActive(v: boolean): Promise<void> {
  if (v) return activatePremium();
  return cancelPremium();
}

/** zavolat po úspěšné platbě */
export async function activatePremium(): Promise<void> {
  if (isOwner()) {
    emit(true);
    return;
  }

  try {
    await AsyncStorage.setItem(PREMIUM_KEY, "1");
  } catch {}

  emit(true);
}

/** zrušení premium */
export async function cancelPremium(): Promise<void> {
  if (isOwner()) {
    emit(true);
    return;
  }

  try {
    await AsyncStorage.removeItem(PREMIUM_KEY);
  } catch {}

  emit(false);
}

/** znovu načte stav ze storage a emituje ho do UI */
export async function restorePremium(): Promise<boolean> {
  const v = await isPremiumActive();
  emit(v);
  return v;
}