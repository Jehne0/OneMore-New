import Purchases, { type CustomerInfo } from "react-native-purchases";
import { Linking, Platform } from "react-native";
import { applyPremiumEntitlement, clearPremiumState } from "./premium";
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

function hasActivePremiumEntitlement(info: CustomerInfo): boolean {
  const entitlement =
    info.entitlements.active[ENTITLEMENT_ID] ??
    info.entitlements.all[ENTITLEMENT_ID];

  return entitlement?.isActive === true;
}

async function applyCustomerInfo(info: CustomerInfo) {
  const entitlement =
    info.entitlements.active[ENTITLEMENT_ID] ??
    info.entitlements.all[ENTITLEMENT_ID];

  await applyPremiumEntitlement({
    isPremium: entitlement?.isActive === true,
    entitlementId: entitlement?.identifier ?? ENTITLEMENT_ID,
    expiresDate: entitlement?.expirationDate ?? null,
    lastVerifiedAt: info.requestDate || new Date().toISOString(),
  });

  updatePremiumSubscriptionState({
    loaded: true,
    willRenew:
      typeof entitlement?.willRenew === "boolean" ? entitlement.willRenew : null,
    expirationDate: entitlement?.expirationDate ?? null,
    managementURL: info.managementURL ?? null,
  });
}

async function refreshAfterConfirmedCustomerInfo(
  info: CustomerInfo,
  source: "purchase" | "restore"
) {
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

  Purchases.addCustomerInfoUpdateListener((info) => {
    void applyCustomerInfo(info);
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

export async function configureRevenueCat() {
  if (configured) return;
  if (configuringPromise) return configuringPromise;

  configuringPromise = (async () => {
    if (!REVENUECAT_ENABLED) {
      configured = true;
      return;
    }

    const apiKey = getRevenueCatApiKey();

    Purchases.setLogLevel(__DEV__ ? Purchases.LOG_LEVEL.DEBUG : Purchases.LOG_LEVEL.WARN);

    await Purchases.configure({ apiKey });

    ensureCustomerInfoListener();

    const uid = auth.currentUser?.uid;

    if (uid) {
      try {
        await Purchases.logIn(uid);
      } catch {
        if (__DEV__) {
          console.log("[RC LOGIN ERROR]");
        }
      }
    }

    configured = true;

    try {
      const info = await Purchases.getCustomerInfo();
      await applyCustomerInfo(info);
    } catch {
      // Keep a still-valid local cache when RevenueCat is temporarily unavailable.
      if (__DEV__) {
        console.log("[RC CUSTOMER INFO ERROR]");
      }
    }
  })();

  try {
    await configuringPromise;
  } finally {
    configuringPromise = null;
  }
}

export async function syncPremiumFromRevenueCat() {
  if (!REVENUECAT_ENABLED) return;

  await configureRevenueCat();

  await Purchases.invalidateCustomerInfoCache();
  const info = await Purchases.getCustomerInfo();
  await applyCustomerInfo(info);
}

export async function getOfferingPackages() {
  if (!REVENUECAT_ENABLED) return [];

  await configureRevenueCat();

  const offerings = await Purchases.getOfferings();
  const current = offerings.current;

  return current?.availablePackages ?? [];
}

export async function purchasePackage(pkg: any) {
  if (!REVENUECAT_ENABLED) return;

  await configureRevenueCat();

  try {
    const result = await Purchases.purchasePackage(pkg);
    await applyCustomerInfo(result.customerInfo);
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

  await configureRevenueCat();

  const info = await Purchases.restorePurchases();
  await applyCustomerInfo(info);
  await refreshAfterConfirmedCustomerInfo(info, "restore");
  return info;
}

export async function openCancelSubscription(managementURL?: string | null) {
  if (Platform.OS === "ios") {
    try {
      await configureRevenueCat();
      await Purchases.showManageSubscriptions();
      return;
    } catch {
      // Fall through to the native App Store URL schemes below.
    }

    const appStoreSubscriptionUrls = [
      "itms-apps://apps.apple.com/account/subscriptions",
      "https://apps.apple.com/account/subscriptions",
    ];

    for (const url of appStoreSubscriptionUrls) {
      try {
        const canOpen = await Linking.canOpenURL(url);
        if (!canOpen) continue;
        await Linking.openURL(url);
        return;
      } catch {
        // Try the next App Store fallback.
      }
    }

    throw new Error("IOS_SUBSCRIPTION_MANAGEMENT_UNAVAILABLE");
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

export async function revenueCatLogin(uid: string) {
  if (!REVENUECAT_ENABLED) return;

  await configureRevenueCat();

  try {
    await Purchases.logIn(uid);
  } catch {
    if (__DEV__) {
      console.log("[RC LOGIN ERROR]");
    }
  }

  await syncPremiumFromRevenueCat();
  ensureCustomerInfoListener();
}

export async function revenueCatLogout() {
  if (!REVENUECAT_ENABLED) {
    await clearPremiumState();
    updatePremiumSubscriptionState({
      loaded: false,
      willRenew: null,
      expirationDate: null,
      managementURL: null,
    });
    return;
  }

  await configureRevenueCat();

  try {
    await Purchases.logOut();
  } catch {
    if (__DEV__) {
      console.log("[RC LOGOUT ERROR]");
    }
  }

  await clearPremiumState();
  updatePremiumSubscriptionState({
    loaded: false,
    willRenew: null,
    expirationDate: null,
    managementURL: null,
  });
}
