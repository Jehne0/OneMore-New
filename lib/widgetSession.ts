import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearAccountSnapshot } from "./accountSnapshot";
import { getNativeWidgetActiveUid, setNativeWidgetActiveUid } from "./widgetSessionNative";

export const WIDGET_ACTIVE_UID_KEY = "onemore_widget_active_uid";
export const WIDGET_SHARED_PREFERENCES_NAME = "onemore_widget_session";

type Store = Pick<typeof AsyncStorage, "getItem" | "setItem" | "removeItem">;

export async function readWidgetActiveUid(store: Store = AsyncStorage): Promise<string | null> {
  const nativeUid = await getNativeWidgetActiveUid();
  if (nativeUid) return nativeUid;
  const legacyUid = await store.getItem(WIDGET_ACTIVE_UID_KEY);
  if (legacyUid) await setNativeWidgetActiveUid(legacyUid).catch(() => {});
  return legacyUid;
}

export async function setWidgetActiveUid(uid: string | null, store: Store = AsyncStorage): Promise<void> {
  if (uid) await store.setItem(WIDGET_ACTIVE_UID_KEY, uid);
  else await store.removeItem(WIDGET_ACTIVE_UID_KEY);
  await setNativeWidgetActiveUid(uid);
}

/** Reserved for an explicit logout, account deletion, or confirmed invalid account. */
export async function clearWidgetSessionForExplicitSignOut(store: Store = AsyncStorage): Promise<void> {
  const uid = await readWidgetActiveUid(store);
  await setWidgetActiveUid(null, store);
  if (uid) await clearAccountSnapshot(uid, store);
}

export type WidgetAuthState =
  | { kind: "restoringLocalSession" }
  | { kind: "restoringFirebaseAuth"; uid: string | null }
  | { kind: "authenticated"; uid: string }
  | { kind: "cachedAuthenticated"; uid: string }
  | { kind: "confirmedSignedOut" }
  | { kind: "errorWithValidCache"; uid: string }
  | { kind: "errorWithoutCache" };

export async function resolveWidgetAuthState(options: {
  activeUid: string | null;
  waitForAuthReady: () => Promise<void>;
  getAuthenticatedUid: () => string | null;
  persistActiveUid: (uid: string) => Promise<void>;
  hasCachedAccount?: boolean;
}): Promise<WidgetAuthState> {
  try {
    await options.waitForAuthReady();
    const authenticatedUid = options.getAuthenticatedUid();
    if (!authenticatedUid) {
      return options.activeUid && options.hasCachedAccount
        ? { kind: "cachedAuthenticated", uid: options.activeUid }
        : { kind: "confirmedSignedOut" };
    }

    // Firebase is authoritative after initialization. Persisting through the
    // shared helper prevents stale cached data from another account being used.
    if (options.activeUid !== authenticatedUid) {
      await options.persistActiveUid(authenticatedUid);
    }
    return { kind: "authenticated", uid: authenticatedUid };
  } catch {
    return options.activeUid && options.hasCachedAccount
      ? { kind: "errorWithValidCache", uid: options.activeUid }
      : { kind: "errorWithoutCache" };
  }
}
