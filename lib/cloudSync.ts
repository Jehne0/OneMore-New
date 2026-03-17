import AsyncStorage from "@react-native-async-storage/async-storage";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";
import { fetchCloudState, writeCloudState } from "./cloud";
import { loadState, saveState, subscribeState, type AppState } from "./storage";

const LOCAL_UPDATED_AT_KEY = "onemore_local_updatedAtISO";

let _unsubState: (() => void) | null = null;
let _timer: any = null;
let _pending: { state: AppState; iso: string } | null = null;

export async function getLocalUpdatedAtISO(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(LOCAL_UPDATED_AT_KEY);
    return v ? String(v) : null;
  } catch {
    return null;
  }
}

export async function setLocalUpdatedAtISO(iso: string): Promise<void> {
  try {
    await AsyncStorage.setItem(LOCAL_UPDATED_AT_KEY, iso);
  } catch {}
}

function isIsoNewer(a?: string | null, b?: string | null): boolean {
  // true pokud a > b (a novější)
  if (!a) return false;
  if (!b) return true;
  return String(a) > String(b);
}

/**
 * 1) když cloud prázdný -> upload lokálu
 * 2) když cloud novější -> download do lokálu
 * 3) když lokál novější -> upload
 */
export async function syncNow(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  const uid = user.uid;

  const local = await loadState();
  const localISO = await getLocalUpdatedAtISO();

  const cloud = await fetchCloudState(uid);
  const cloudISO = cloud?.clientUpdatedAtISO ?? null;

  if (!cloud?.state) {
    // cloud je prázdný -> nahraj lokál (pokud něco máme)
    const iso = localISO ?? new Date().toISOString();
    await writeCloudState(uid, local, iso);
    await setLocalUpdatedAtISO(iso);
    return;
  }

  if (isIsoNewer(cloudISO, localISO)) {
    // cloud je novější -> přepiš lokál cloudem
    await saveState(cloud.state);
    await setLocalUpdatedAtISO(cloudISO || new Date().toISOString());
    return;
  }

  if (isIsoNewer(localISO, cloudISO)) {
    // lokál je novější -> nahraj lokál
    const iso = localISO ?? new Date().toISOString();
    await writeCloudState(uid, local, iso);
    await setLocalUpdatedAtISO(iso);
  }
}

function scheduleUpload(state: AppState) {
  const iso = new Date().toISOString();
  _pending = { state, iso };

  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(async () => {
    const user = auth.currentUser;
    const p = _pending;
    _pending = null;
    if (!user || !p) return;
    try {
      await writeCloudState(user.uid, p.state, p.iso);
      await setLocalUpdatedAtISO(p.iso);
    } catch {
      // ignore (offline apod.)
    }
  }, 900);
}

export function startCloudAutoSync() {
  if (_unsubState) return;

  _unsubState = subscribeState((s) => {
    // upload jen když je user přihlášený
    if (!auth.currentUser) return;
    scheduleUpload(s);
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
    stopCloudAutoSync();

    if (!user) return;

    try {
      await syncNow();
    } catch {
      // ignore
    }

    startCloudAutoSync();
  });
}
