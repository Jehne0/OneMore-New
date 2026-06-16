import Purchases from "react-native-purchases";
import { Linking, Platform } from "react-native";
import { activatePremium, cancelPremium } from "./premium";
import { auth } from "./firebase";

const ENTITLEMENT_ID = "premium";

// 🔴 DEV key (Test Store – používá se jen při vývoji)
const TEST_API_KEY = "test_xYHcUmOjDUuuTuZcuFxAMynxvKe";

// 🟢 Produkční klíče z RevenueCat dashboardu
const ANDROID_API_KEY = "goog_qBDfAHXdhHnQlqwvyXKYRHVTGtq";
const IOS_API_KEY = "appl_iqHdLUlZeNUdRvTWTDVLDpoKpdX";

// ✅ RevenueCat je zapnutý
const REVENUECAT_ENABLED = true;

// ✅ false = Google Play / App Store
// ✅ true = RevenueCat Test Store
const USE_REVENUECAT_TEST_STORE = false;

let configured = false;
let listenerAdded = false;
let configuringPromise: Promise<void> | null = null;

async function applyCustomerInfo(info: any) {
  const active = !!info.entitlements.active[ENTITLEMENT_ID];

  if (active) await activatePremium();
  else await cancelPremium();
}

function ensureCustomerInfoListener() {
  if (listenerAdded) return;

  Purchases.addCustomerInfoUpdateListener(async (info) => {
    await applyCustomerInfo(info);
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
    const res = await Purchases.purchasePackage(pkg);
    await applyCustomerInfo(res.customerInfo);
    return res;
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
}

// ✅ otevře systémovou správu předplatného
export async function openCancelSubscription() {
  if (Platform.OS === "android") {
    await Linking.openURL("https://play.google.com/store/account/subscriptions");
    return;
  }

  await Linking.openURL("https://apps.apple.com/account/subscriptions");
}

// ✅ Zavolej po úspěšném Firebase loginu
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

// ✅ Zavolej při logout
export async function revenueCatLogout() {
  if (!REVENUECAT_ENABLED) {
    await cancelPremium();
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

  await cancelPremium();
}
