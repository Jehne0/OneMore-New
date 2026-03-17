import Purchases from "react-native-purchases";
import { Linking, Platform } from "react-native";
import { activatePremium, cancelPremium } from "./premium";
import { auth } from "./firebase";

const ENTITLEMENT_ID = "premium";

// 🔴 DEV key (Test Store – používá se jen při vývoji)
const TEST_API_KEY = "test_xYHcUmOjDUuuTuZcuFxAMynxvKe";

// 🟢 Produkční klíče (doplníš později z RevenueCat dashboardu)
const ANDROID_API_KEY = "goog_xxxxxxxxx";
const IOS_API_KEY = "appl_xxxxxxxxx";

let configured = false;
let listenerAdded = false;

function ensureCustomerInfoListener() {
  if (listenerAdded) return;

  Purchases.addCustomerInfoUpdateListener(async (info) => {
    const active = !!info.entitlements.active[ENTITLEMENT_ID];
    if (active) await activatePremium();
    else await cancelPremium();
  });

  listenerAdded = true;
}

export async function configureRevenueCat() {
  if (configured) return;

  // vyber správný klíč
  const apiKey = __DEV__
    ? TEST_API_KEY
    : Platform.OS === "android"
      ? ANDROID_API_KEY
      : IOS_API_KEY;

  await Purchases.configure({ apiKey });

  const uid = auth.currentUser?.uid;

  // ⚠️ Pokud ještě nemáme UID (auth se teprve načítá), NESHazuj premium dolů.
  // Sync + listener připojíme až po revenueCatLogin(uid).
  if (!uid) {
    configured = true;
    return;
  }

  // Máme UID → přihlásit do RevenueCat a teprve pak sync
  try {
    await Purchases.logIn(uid);
  } catch {}

  await syncPremiumFromRevenueCat();
  ensureCustomerInfoListener();

  configured = true;
}

export async function syncPremiumFromRevenueCat() {
  const info = await Purchases.getCustomerInfo();
  const active = !!info.entitlements.active[ENTITLEMENT_ID];
  if (active) await activatePremium();
  else await cancelPremium();
}

export async function getOfferingPackages() {
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  return current?.availablePackages ?? [];
}

export async function purchasePackage(pkg: any) {
  const res = await Purchases.purchasePackage(pkg);
  const active = !!res.customerInfo.entitlements.active[ENTITLEMENT_ID];
  if (active) await activatePremium();
  else await cancelPremium();
}

export async function restorePurchases() {
  const info = await Purchases.restorePurchases();
  const active = !!info.entitlements.active[ENTITLEMENT_ID];
  if (active) await activatePremium();
  else await cancelPremium();
}

// ✅ otevře systémovou správu předplatného (zrušení se dělá jen přes Store)
export async function openCancelSubscription() {
  if (Platform.OS === "android") {
    await Linking.openURL("https://play.google.com/store/account/subscriptions");
    return;
  }
  await Linking.openURL("https://apps.apple.com/account/subscriptions");
}

// ✅ Zavolej po úspěšném Firebase loginu
export async function revenueCatLogin(uid: string) {
  try {
    await Purchases.logIn(uid);
  } catch {}

  await syncPremiumFromRevenueCat();
  ensureCustomerInfoListener();
}

// ✅ Zavolej při logout
export async function revenueCatLogout() {
  try {
    await Purchases.logOut();
  } catch {}

  await cancelPremium();
}