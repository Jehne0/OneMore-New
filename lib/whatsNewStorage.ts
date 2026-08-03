import AsyncStorage from "@react-native-async-storage/async-storage";
import { CURRENT_WHATS_NEW_ID } from "./whatsNew";

type Store = Pick<typeof AsyncStorage, "getAllKeys" | "getItem" | "setItem">;

const INSTALL_CLASSIFICATION_KEY = "onemore_whats_new_install_2026_07";
const LEGACY_GLOBAL_KEYS = new Set([
  "onemore_state",
  "onemore_state_backup",
  "onemore_challenges_v1",
  "onemore_challengeStats_v1",
]);

// Starts at module evaluation, before startup services can create storage for a new install.
const startupKeysPromise = AsyncStorage.getAllKeys().catch(() => [] as string[]);

export function seenKey(uid: string, id = CURRENT_WHATS_NEW_ID): string {
  return `onemore_whats_new_seen:${id}:${uid}`;
}

export function hadDataBeforeUpdate(keys: readonly string[], uid: string): boolean {
  return keys.some((key) =>
    LEGACY_GLOBAL_KEYS.has(key) ||
    key === `onemore_state_${uid}` ||
    key === `onemore_state_backup_${uid}` ||
    key === `onemore_challenges_v1_${uid}` ||
    key === `onemore_challengeStats_v1_${uid}`
  );
}

export async function shouldAutoShowWhatsNew(
  uid: string,
  store: Store = AsyncStorage,
  startupKeys?: readonly string[]
): Promise<boolean> {
  if (!uid) return false;
  if (await store.getItem(seenKey(uid))) return false;

  let classification = await store.getItem(INSTALL_CLASSIFICATION_KEY);
  if (!classification) {
    const keys = startupKeys ?? await startupKeysPromise;
    classification = hadDataBeforeUpdate(keys, uid) ? "existing" : "new";
    await store.setItem(INSTALL_CLASSIFICATION_KEY, classification);
  }
  return classification === "existing";
}

export async function markWhatsNewSeen(uid: string, store: Store = AsyncStorage): Promise<void> {
  if (uid) await store.setItem(seenKey(uid), "1");
}
