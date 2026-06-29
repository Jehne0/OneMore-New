import AsyncStorage from "@react-native-async-storage/async-storage";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";
import { fetchCloudState, writeCloudState } from "./cloud";
import {
  activateUserState,
  clearInMemoryState,
  loadStateForUid,
  localUpdatedAtKeyForUid,
  saveStateForUid,
  subscribeState,
  type AppState,
} from "./storage";
import { registerPushTokenForCurrentUser } from "./pushTokens";
import { cancelScheduledPersonalReminderNotifications } from "./reminders";

let _unsubState: (() => void) | null = null;
let _timer: any = null;
let _pending: { uid: string; state: AppState; iso: string } | null = null;
let _authGeneration = 0;
let _lastUid: string | null = null;

export async function getLocalUpdatedAtISO(uid: string): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(localUpdatedAtKeyForUid(uid));
    return v ? String(v) : null;
  } catch {
    return null;
  }
}

export async function setLocalUpdatedAtISO(uid: string, iso: string): Promise<void> {
  try {
    await AsyncStorage.setItem(localUpdatedAtKeyForUid(uid), iso);
  } catch {}
}

function isIsoNewer(a?: string | null, b?: string | null): boolean {
  // true pokud a > b (a novější)
  if (!a) return false;
  if (!b) return true;
  return String(a) > String(b);
}

function hasMeaningfulState(state?: AppState | null): boolean {
  if (!state) return false;

  return (
    (state.challenges ?? []).length > 0 ||
    (state.history ?? []).length > 0 ||
    Object.keys(state.challengeStats ?? {}).length > 0 ||
    (state.archivedChallenges ?? []).length > 0 ||
    Number(state.streak ?? 0) > 0 ||
    (state.everCompletedKeys ?? []).length > 0
  );
}

/**
 * 1) když cloud prázdný -> upload lokálu
 * 2) když cloud novější -> download do lokálu
 * 3) když lokál novější -> upload
 */
export async function syncNow(expectedUid?: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  const uid = user.uid;
  if (expectedUid && expectedUid !== uid) return;

  const local = await loadStateForUid(uid);
  const localISO = await getLocalUpdatedAtISO(uid);

  const cloud = await fetchCloudState(uid);
  if (auth.currentUser?.uid !== uid) return;
  const cloudISO = cloud?.clientUpdatedAtISO ?? null;

  if (!cloud?.state) {
    // cloud je prázdný -> nahraj lokál (pokud něco máme)
    const iso = localISO ?? new Date().toISOString();
    await writeCloudState(uid, local, iso);
    await setLocalUpdatedAtISO(uid, iso);
    return;
  }

  if (hasMeaningfulState(cloud.state) && !hasMeaningfulState(local)) {
    // Po reinstalaci muze lokal stihnout ulozit prazdny default state.
    // Smysluplny cloud ma v takovem pripade vzdy prednost.
    await saveStateForUid(cloud.state, uid);
    await setLocalUpdatedAtISO(uid, cloudISO || new Date().toISOString());
    return;
  }

  if (isIsoNewer(cloudISO, localISO)) {
    // cloud je novější -> přepiš lokál cloudem
    await saveStateForUid(cloud.state, uid);
    await setLocalUpdatedAtISO(uid, cloudISO || new Date().toISOString());
    return;
  }

  if (isIsoNewer(localISO, cloudISO)) {
    // lokál je novější -> nahraj lokál
    const iso = localISO ?? new Date().toISOString();
    await writeCloudState(uid, local, iso);
    await setLocalUpdatedAtISO(uid, iso);
  }
}

function scheduleUpload(uid: string, state: AppState) {
  const iso = new Date().toISOString();
  _pending = { uid, state, iso };

  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(async () => {
    const user = auth.currentUser;
    const p = _pending;
    _pending = null;
    if (!user || !p || user.uid !== p.uid) return;
    try {
      await writeCloudState(p.uid, p.state, p.iso);
      await setLocalUpdatedAtISO(p.uid, p.iso);
    } catch {
      // ignore (offline apod.)
    }
  }, 900);
}

export function startCloudAutoSync() {
  if (_unsubState) return;

  _unsubState = subscribeState((s) => {
    // upload jen když je user přihlášený
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    scheduleUpload(uid, s);
  });
}

export function stopCloudAutoSync() {
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
  _pending = null;
  _unsubState?.();
  _unsubState = null;
}

/**
 * Inicializace pro app root: reaguje na login/logout.
 */
export function initCloudSync() {
  onAuthStateChanged(auth, async (user) => {
    const generation = ++_authGeneration;
    const uid = user?.uid ?? null;
    const previousUid = _lastUid;
    _lastUid = uid;

    stopCloudAutoSync();
    clearInMemoryState();

    if (previousUid && previousUid !== uid) {
      try {
        await cancelScheduledPersonalReminderNotifications();
      } catch {
        // ignore
      }
    }

    if (!user || generation !== _authGeneration) return;

    try {
      await activateUserState(user.uid);
    } catch {
      // A missing UID-scoped state intentionally remains clean.
    }

    if (generation !== _authGeneration || auth.currentUser?.uid !== user.uid) return;

    try {
      await syncNow(user.uid);
    } catch {
      // ignore
    }

    if (generation !== _authGeneration || auth.currentUser?.uid !== user.uid) return;

    try {
      await registerPushTokenForCurrentUser();
    } catch {
      if (__DEV__) {
        console.log("Push token registration failed");
      }
    }

    if (generation === _authGeneration && auth.currentUser?.uid === user.uid) {
      startCloudAutoSync();
    }
  });
}
