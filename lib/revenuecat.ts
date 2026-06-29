import Purchases, { type CustomerInfo } from "react-native-purchases";
import { Linking, Platform } from "react-native";
import { onAuthStateChanged } from "firebase/auth";
import {
  applyPremiumEntitlement,
  resetPremiumStateForAuthChange,
} from "./premium";
import { auth } from "./firebase";

const ENTITLEMENT_ID = "premium";

// RevenueCat Test Store key (development only).
const TEST_API_KEY = "test_xYHcUmOjDUuuTuZcuFxAMynxvKe";

// Production RevenueCat public SDK keys.
const ANDROID_API_KEY = "goog_qBDfAHXdhHnQlqwvyXKYRHVTGtq";
const IOS_API_KEY = "appl_iqHdLUlZeNUdRvTWTDVLDpoKpdX";

const REVENUECAT_ENABLED = true;
const USE_REVENUECAT_TEST_STORE = false;

let configured = false;
let listenerAdded = false;
let configuringPromise: Promise<void> | null = null;
let authListenerAdded = false;
let expectedFirebaseUid: string | null | undefined;
let identityGeneration = 0;
let identityQueue: Promise<void> = Promise.resolve();
let activeIdentityPromise: Promise<void> | null = null;
let activeIdentityPromiseUid: string | null = null;

export type PremiumSubscriptionState = {
  loaded: boolean;
  willRenew: boolean | null;
  expirationDate: string | null;
  managementURL: string | null;
};

type PremiumSubscriptionListener = (state: PremiumSubscriptionState) => void;

let premiumSubscriptionState: PremiumSubscriptionState = {
  loaded: false,
  willRenew: null,
  expirationDate: null,
  managementURL: null,
};
const premiumSubscriptionListeners = new Set<PremiumSubscriptionListener>();

export function getPremiumSubscriptionState(): PremiumSubscriptionState {
  return premiumSubscriptionState;
}

export function subscribePremiumSubscriptionState(
  listener: PremiumSubscriptionListener
): () => void {
  premiumSubscriptionListeners.add(listener);
  listener(premiumSubscriptionState);
  return () => premiumSubscriptionListeners.delete(listener);
}

function updatePremiumSubscriptionState(state: PremiumSubscriptionState) {
  premiumSubscriptionState = state;
  for (const listener of Array.from(premiumSubscriptionListeners)) {
    listener(state);
  }
}

function resetPremiumSubscriptionState() {
  updatePremiumSubscriptionState({
    loaded: false,
    willRenew: null,
    expirationDate: null,
    managementURL: null,
  });
}

function hasActivePremiumEntitlement(info: CustomerInfo): boolean {
  const entitlement =
    info.entitlements.active[ENTITLEMENT_ID] ??
    info.entitlements.all[ENTITLEMENT_ID];

  return entitlement?.isActive === true;
}

async function applyCustomerInfoForUid(
  info: CustomerInfo,
  uid: string,
  generation: number
) {
  const appUserID = await Purchases.getAppUserID();

  if (
    generation !== identityGeneration ||
    expectedFirebaseUid !== uid ||
    auth.currentUser?.uid !== uid ||
    appUserID !== uid
  ) {
    if (__DEV__) {
      console.log("[RC CUSTOMER INFO IGNORED]", {
        firebaseUid: auth.currentUser?.uid ?? null,
        expectedFirebaseUid,
        appUserID,
      });
    }
    return false;
  }

  const entitlement =
    info.entitlements.active[ENTITLEMENT_ID] ??
    info.entitlements.all[ENTITLEMENT_ID];
  const isPremium = entitlement?.isActive === true;

  await applyPremiumEntitlement({
    uid,
    isPremium,
    entitlementId: entitlement?.identifier ?? ENTITLEMENT_ID,
    expiresDate: entitlement?.expirationDate ?? null,
    lastVerifiedAt: info.requestDate || new Date().toISOString(),
  });

  if (
    generation !== identityGeneration ||
    expectedFirebaseUid !== uid ||
    auth.currentUser?.uid !== uid
  ) {
    return false;
  }

  updatePremiumSubscriptionState({
    loaded: true,
    willRenew:
      typeof entitlement?.willRenew === "boolean" ? entitlement.willRenew : null,
    expirationDate: entitlement?.expirationDate ?? null,
    managementURL: info.managementURL ?? null,
  });

  if (__DEV__) {
    console.log("[RC PREMIUM ENTITLEMENT]", {
      firebaseUid: uid,
      appUserID,
      active: isPremium,
    });
  }

  return true;
}

async function refreshAfterConfirmedCustomerInfo(
  info: CustomerInfo,
  source: "purchase" | "restore"
) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  try {
    await syncPremiumFromRevenueCat();
  } catch (error) {
    if (!hasActivePremiumEntitlement(info)) throw error;

    if (__DEV__) {
      console.log(`[RC ${source.toUpperCase()} FOLLOW-UP SYNC ERROR]`, error);
    }
  }
}

function ensureCustomerInfoListener() {
  if (listenerAdded) return;

  Purchases.addCustomerInfoUpdateListener(() => {
    const uid = auth.currentUser?.uid;
    const generation = identityGeneration;
    if (!uid || expectedFirebaseUid !== uid) return;

    void (async () => {
      try {
        const appUserID = await Purchases.getAppUserID();
        if (
          generation !== identityGeneration ||
          auth.currentUser?.uid !== uid ||
          appUserID !== uid
        ) {
          return;
        }

        const info = await Purchases.getCustomerInfo();
        await applyCustomerInfoForUid(info, uid, generation);
      } catch (error) {
        if (__DEV__) {
          console.log("[RC CUSTOMER INFO LISTENER ERROR]", error);
        }
      }
    })();
  });

  listenerAdded = true;
}

function getRevenueCatApiKey() {
  if (USE_REVENUECAT_TEST_STORE) return TEST_API_KEY;

  if (Platform.OS === "android") return ANDROID_API_KEY;
  return IOS_API_KEY;
}

function buildRevenueCatErrorMessage(e: any) {
  const code = e?.code ?? "none";
  const readable = e?.readableErrorCode || e?.readable_error_code || "none";
  const message = e?.message || "none";

  const underlying =
    e?.underlyingErrorMessage ||
    e?.userInfo?.underlyingErrorMessage ||
    e?.userInfo?.NSUnderlyingError ||
    e?.nativeStackAndroid ||
    "none";

  let fullJson = "";

  try {
    fullJson = JSON.stringify(e, null, 2);
  } catch {
    fullJson = "JSON stringify failed";
  }

  return (
    "RC_FULL_DETAIL_BUILD_2026_05_14\n\n" +
    "code: " +
    String(code) +
    "\n" +
    "readable: " +
    String(readable) +
    "\n" +
    "message: " +
    String(message) +
    "\n" +
    "underlying: " +
    String(underlying) +
    "\n\nFULL:\n" +
    fullJson
  );
}

function setExpectedFirebaseUid(
  uid: string | null,
  source: string
): number {
  if (expectedFirebaseUid === uid) return identityGeneration;

  const previousUid = expectedFirebaseUid;
  expectedFirebaseUid = uid;
  identityGeneration += 1;
  resetPremiumStateForAuthChange();
  resetPremiumSubscriptionState();

  if (__DEV__) {
    console.log("[RC PREMIUM STATE RESET]", {
      source,
      previousFirebaseUid: previousUid ?? null,
      firebaseUid: uid,
    });
  }

  return identityGeneration;
}

function requireFirebaseUid(): string {
  const uid = auth.currentUser?.uid?.trim();
  if (!uid) throw new Error("REVENUECAT_FIREBASE_UID_REQUIRED");
  return uid;
}

export function initRevenueCatAuth() {
  if (authListenerAdded) return;
  authListenerAdded = true;

  onAuthStateChanged(auth, (user) => {
    const uid = user?.uid ?? null;

    if (__DEV__) {
      console.log("[RC FIREBASE AUTH CHANGED]", { firebaseUid: uid });
    }

    if (!uid) {
      setExpectedFirebaseUid(null, "firebase-auth");
      return;
    }

    void revenueCatLogin(uid).catch((error) => {
      if (__DEV__) {
        console.log("[RC AUTH LOGIN ERROR]", {
          firebaseUid: uid,
          error: String((error as any)?.message ?? error),
        });
      }
    });
  });
}

export async function configureRevenueCat() {
  if (configured) return;
  if (configuringPromise) return configuringPromise;

  configuringPromise = (async () => {
    if (!REVENUECAT_ENABLED) {
      configured = true;
      return;
    }

    const uid = requireFirebaseUid();
    const apiKey = getRevenueCatApiKey();

    Purchases.setLogLevel(__DEV__ ? Purchases.LOG_LEVEL.DEBUG : Purchases.LOG_LEVEL.WARN);

    await Purchases.configure({ apiKey, appUserID: uid });
    configured = true;

    ensureCustomerInfoListener();

    const appUserID = await Purchases.getAppUserID();
    if (__DEV__) {
      console.log("[RC CONFIGURED]", {
        firebaseUid: uid,
        appUserID,
      });
    }
  })();

  try {
    await configuringPromise;
  } finally {
    configuringPromise = null;
  }
}

async function performRevenueCatLogin(
  uid: string,
  generation: number
): Promise<void> {
  await configureRevenueCat();

  if (
    generation !== identityGeneration ||
    expectedFirebaseUid !== uid ||
    auth.currentUser?.uid !== uid
  ) {
    return;
  }

  let appUserID = await Purchases.getAppUserID();
  let info: CustomerInfo | null = null;

  if (appUserID !== uid) {
    const result = await Purchases.logIn(uid);
    info = result.customerInfo;
    appUserID = await Purchases.getAppUserID();
  }

  if (__DEV__) {
    console.log("[RC APP USER ID]", {
      firebaseUid: uid,
      appUserID,
    });
  }

  if (appUserID !== uid) {
    throw new Error("REVENUECAT_APP_USER_ID_MISMATCH");
  }

  if (
    generation !== identityGeneration ||
    expectedFirebaseUid !== uid ||
    auth.currentUser?.uid !== uid
  ) {
    return;
  }

  await Purchases.invalidateCustomerInfoCache();
  info = await Purchases.getCustomerInfo();
  await applyCustomerInfoForUid(info, uid, generation);
}

export async function revenueCatLogin(uid: string) {
  if (!REVENUECAT_ENABLED) return;

  const normalizedUid = uid.trim();
  if (!normalizedUid || auth.currentUser?.uid !== normalizedUid) {
    throw new Error("REVENUECAT_FIREBASE_UID_MISMATCH");
  }

  const generation = setExpectedFirebaseUid(normalizedUid, "login");

  if (
    activeIdentityPromise &&
    activeIdentityPromiseUid === normalizedUid
  ) {
    return activeIdentityPromise;
  }

  const operation = identityQueue
    .catch(() => {})
    .then(() => performRevenueCatLogin(normalizedUid, generation));

  identityQueue = operation;
  activeIdentityPromise = operation;
  activeIdentityPromiseUid = normalizedUid;

  try {
    await operation;
  } finally {
    if (activeIdentityPromise === operation) {
      activeIdentityPromise = null;
      activeIdentityPromiseUid = null;
    }
  }
}

export async function syncPremiumFromRevenueCat() {
  if (!REVENUECAT_ENABLED) return;
  await revenueCatLogin(requireFirebaseUid());
}

export async function getOfferingPackages() {
  if (!REVENUECAT_ENABLED) return [];

  await revenueCatLogin(requireFirebaseUid());

  const offerings = await Purchases.getOfferings();
  const current = offerings.current;

  return current?.availablePackages ?? [];
}

export async function purchasePackage(pkg: any) {
  if (!REVENUECAT_ENABLED) return;

  const uid = requireFirebaseUid();
  await revenueCatLogin(uid);
  const generation = identityGeneration;

  try {
    const result = await Purchases.purchasePackage(pkg);
    await applyCustomerInfoForUid(result.customerInfo, uid, generation);
    await refreshAfterConfirmedCustomerInfo(result.customerInfo, "purchase");
    return result;
  } catch (e: any) {
    const fullMessage = buildRevenueCatErrorMessage(e);

    throw {
      ...e,
      code: "RC_FULL_DETAIL",
      message: fullMessage,
      originalError: e,
    };
  }
}

export async function restorePurchases() {
  if (!REVENUECAT_ENABLED) return;

  const uid = requireFirebaseUid();
  await revenueCatLogin(uid);
  const generation = identityGeneration;

  const info = await Purchases.restorePurchases();
  await applyCustomerInfoForUid(info, uid, generation);
  await refreshAfterConfirmedCustomerInfo(info, "restore");
  return info;
}

export async function openCancelSubscription(managementURL?: string | null) {
  if (Platform.OS === "ios") {
    await Linking.openURL(
      "itms-apps://apps.apple.com/account/subscriptions"
    );
    return;
  }

  if (managementURL) {
    await Linking.openURL(managementURL);
    return;
  }

  if (Platform.OS === "android") {
    await Linking.openURL("https://play.google.com/store/account/subscriptions");
    return;
  }

  await Linking.openURL("https://apps.apple.com/account/subscriptions");
}

export async function revenueCatLogout() {
  setExpectedFirebaseUid(null, "logout");
  resetPremiumSubscriptionState();

  if (__DEV__) {
    console.log("[RC LOGOUT LOCAL RESET]", {
      firebaseUid: auth.currentUser?.uid ?? null,
    });
  }
}
