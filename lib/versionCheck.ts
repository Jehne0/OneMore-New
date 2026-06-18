import Constants from "expo-constants";
import * as Application from "expo-application";
import { Platform } from "react-native";
import { doc, getDoc } from "firebase/firestore";

import { db } from "./firebase";
import type { Lang } from "./i18n";

export type VersionCheckResult = {
  level: "recommended" | "required";
  latestVersionName: string;
  message?: string;
  updateUrl?: string;
};

type VersionConfig = {
  latestVersionCode?: unknown;
  minimumRequiredVersionCode?: unknown;
  latestVersionName?: unknown;
  updateUrlAndroid?: unknown;
  updateUrlIos?: unknown;
  message?: Partial<Record<Lang, unknown>>;
};

function toPositiveNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function getCurrentVersionCode(): number {
  const c = Constants as any;
  const nativeBuildVersion =
    toPositiveNumber(Application.nativeBuildVersion) ||
    toPositiveNumber(c?.nativeBuildVersion);

  if (nativeBuildVersion) return nativeBuildVersion;

  if (Platform.OS === "android") {
    return (
      toPositiveNumber(c?.platform?.android?.versionCode) ||
      toPositiveNumber(c?.expoConfig?.android?.versionCode) ||
      toPositiveNumber(c?.manifest?.android?.versionCode) ||
      toPositiveNumber(c?.manifest2?.extra?.expoClient?.android?.versionCode) ||
      toPositiveNumber(c?.easConfig?.android?.versionCode)
    );
  }

  if (Platform.OS === "ios") {
    return (
      toPositiveNumber(c?.expoConfig?.ios?.buildNumber) ||
      toPositiveNumber(c?.manifest?.ios?.buildNumber) ||
      toPositiveNumber(c?.manifest2?.extra?.expoClient?.ios?.buildNumber)
    );
  }

  return 0;
}

export async function checkRemoteAppVersion(lang: Lang): Promise<VersionCheckResult | null> {
  try {
    const snap = await getDoc(doc(db, "appConfig", "versionCheck"));
    if (!snap.exists()) return null;

    const data = snap.data() as VersionConfig;
    const currentVersionCode = getCurrentVersionCode();
    const latestVersionCode = toPositiveNumber(data.latestVersionCode);
    const minimumRequiredVersionCode = toPositiveNumber(data.minimumRequiredVersionCode);

    if (!currentVersionCode) {
      if (__DEV__) {
        console.log("[versionCheck]", {
          currentVersionCode: null,
          latestVersionCode,
          minimumRequiredVersionCode,
          updateType: "none",
        });
      }
      return null;
    }

    const latestVersionName =
      typeof data.latestVersionName === "string" ? data.latestVersionName.trim() : "";
    const messageValue = data.message?.[lang];
    const message = typeof messageValue === "string" ? messageValue.trim() : undefined;
    const updateUrlRaw = Platform.OS === "ios" ? data.updateUrlIos : data.updateUrlAndroid;
    const updateUrl = typeof updateUrlRaw === "string" ? updateUrlRaw.trim() : undefined;

    if (minimumRequiredVersionCode > currentVersionCode) {
      if (__DEV__) {
        console.log("[versionCheck]", {
          currentVersionCode,
          latestVersionCode,
          minimumRequiredVersionCode,
          updateType: "required",
        });
      }
      return { level: "required", latestVersionName, message, updateUrl };
    }

    if (latestVersionCode > currentVersionCode) {
      if (__DEV__) {
        console.log("[versionCheck]", {
          currentVersionCode,
          latestVersionCode,
          minimumRequiredVersionCode,
          updateType: "recommended",
        });
      }
      return { level: "recommended", latestVersionName, message, updateUrl };
    }

    if (__DEV__) {
      console.log("[versionCheck]", {
        currentVersionCode,
        latestVersionCode,
        minimumRequiredVersionCode,
        updateType: "none",
      });
    }

    return null;
  } catch {
    return null;
  }
}
