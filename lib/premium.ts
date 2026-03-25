import AsyncStorage from "@react-native-async-storage/async-storage";

export const PREMIUM_KEY = "onemore_premium_active";

/**
 * Premium flag uložený lokálně (zatím bez IAP).
 *
 * - isPremiumActive(): aktuální stav
 * - activatePremium(): zavolat po úspěšné platbě (zatím demo)
 * - cancelPremium(): zrušení premium (demo)
 * - restorePremium(): znovu načte stav ze storage (připraveno pro "Obnovit nákup")
 *
 * Má i jednoduchý subscribe mechanismus, aby se UI aktualizovalo hned.
 */
type PremiumListener = (active: boolean) => void;
const listeners = new Set<PremiumListener>();

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

export async function isPremiumActive(): Promise<boolean> {
  return true;

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
  try {
    await AsyncStorage.setItem(PREMIUM_KEY, "1");
  } catch {}
  emit(true);
}

/** zrušení premium (demo; v reálu podle store subscription) */
export async function cancelPremium(): Promise<void> {
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
